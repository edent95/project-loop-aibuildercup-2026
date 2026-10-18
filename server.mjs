import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { initialState, projectById, entriesFor, addEntry, buildPrompt, normalizeAnalysis, approveTask } from './core.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
const local = process.env.DEMO_LOCAL === '1'
const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT
const region = process.env.GOOGLE_CLOUD_LOCATION || 'global'
const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
const port = Number(process.env.PORT || 8080)

if (!local && !projectId) throw new Error('GOOGLE_CLOUD_PROJECT is required outside DEMO_LOCAL mode')

const memory = new Map()
let firestore
let gemini
if (!local) {
  const [{ Firestore }, { GoogleGenAI }] = await Promise.all([
    import('@google-cloud/firestore'),
    import('@google/genai'),
  ])
  firestore = new Firestore({ projectId })
  gemini = new GoogleGenAI({ vertexai: true, project: projectId, location: region })
}

function cookieSession(req, res) {
  const existing = /(?:^|;\s*)pl_session=([0-9a-f-]{36})(?:;|$)/.exec(req.headers.cookie || '')?.[1]
  if (existing && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(existing)) return existing
  const id = crypto.randomUUID()
  const secure = req.headers['x-forwarded-proto'] === 'https' || !local
  res.setHeader('Set-Cookie', `pl_session=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${secure ? '; Secure' : ''}`)
  return id
}

async function readSession(id) {
  if (local) {
    if (!memory.has(id)) memory.set(id, initialState())
    return structuredClone(memory.get(id))
  }
  const ref = firestore.collection('projectLoopDemoSessions').doc(id)
  const snap = await ref.get()
  if (snap.exists) return snap.data()
  const state = initialState()
  await ref.create(state).catch(error => { if (error.code !== 6) throw error })
  return (await ref.get()).data()
}

async function writeSession(id, state) {
  if (local) { memory.set(id, structuredClone(state)); return }
  await firestore.collection('projectLoopDemoSessions').doc(id).set(state)
}

function json(res, code, value) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(JSON.stringify(value))
}

async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new Error('Expected JSON')
  let input = ''
  for await (const chunk of req) {
    input += chunk
    if (input.length > 8192) throw new Error('Request is too large')
  }
  try { return JSON.parse(input || '{}') } catch { throw new Error('Invalid JSON') }
}

function sameOrigin(req) {
  if (req.headers['sec-fetch-site'] === 'same-origin') return true
  const origin = req.headers.origin
  if (!origin) return false
  try { return new URL(origin).host === req.headers.host } catch { return false }
}

async function analyze(project, entries) {
  if (local) {
    const latest = entries.at(-1)
    return normalizeAnalysis({
      summary: `${project.name} has ${entries.length} documented updates. The latest update needs an explicit follow-up.`,
      risks: ['A follow-up can be missed when the update stays only in a log.'],
      suggestions: [{ title: `Review the latest ${project.name} finding`, reason: 'Assign an owner and confirm the next step before marking this finding complete.', evidenceIds: [latest.id] }],
    }, entries)
  }
  const response = await gemini.models.generateContent({
    model,
    contents: buildPrompt(project, entries),
    config: { temperature: 0.2, responseMimeType: 'application/json', maxOutputTokens: 2000 },
  })
  if (!response.text) throw new Error('Gemini returned an empty response')
  return normalizeAnalysis(JSON.parse(response.text), entries)
}

const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
])

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost')
    if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true, cloud: !local, firestore: !local, gemini: !local, model: local ? 'local simulation' : model })
    if (req.method === 'GET' && staticFiles.has(url.pathname)) {
      const [name, type] = staticFiles.get(url.pathname)
      const content = await fs.readFile(path.join(root, 'public', name))
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': name === 'index.html' ? 'no-store' : 'public, max-age=300', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'" })
      return res.end(content)
    }
    if (!url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Not found' })
    const id = cookieSession(req, res)
    if (req.method === 'GET' && url.pathname === '/api/workspace') return json(res, 200, { ...(await readSession(id)), mode: local ? 'local simulation' : 'cloud' })
    if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })
    if (!sameOrigin(req)) return json(res, 403, { error: 'Same-origin request required' })
    const input = await body(req)
    const state = await readSession(id)
    if (url.pathname === '/api/entries') {
      const entry = addEntry(state, input.projectId, input.text)
      state.pendingSuggestions = state.pendingSuggestions.filter(item => item.projectId !== input.projectId)
      await writeSession(id, state)
      return json(res, 201, entry)
    }
    if (url.pathname === '/api/analyze') {
      const project = projectById(state, input.projectId)
      if (!project) return json(res, 404, { error: 'Unknown project' })
      if (state.analyses >= 5) return json(res, 429, { error: 'This demo session has reached its AI analysis limit' })
      const entries = entriesFor(state, project.id)
      state.analyses += 1
      await writeSession(id, state)
      const result = await analyze(project, entries)
      state.pendingSuggestions = state.pendingSuggestions.filter(item => item.projectId !== project.id)
      state.pendingSuggestions.push(...result.suggestions.map(item => ({ ...item, projectId: project.id })))
      await writeSession(id, state)
      return json(res, 200, { ...result, evidence: entries.map(({ id, date, text }) => ({ id, date, text })), model: local ? 'local simulation' : model })
    }
    if (url.pathname === '/api/tasks') {
      const entries = entriesFor(state, input.projectId)
      const task = approveTask(state, input.projectId, input.suggestion, entries)
      await writeSession(id, state)
      return json(res, 201, task)
    }
    return json(res, 404, { error: 'Not found' })
  } catch (error) {
    const safe = /^(Unknown project|Update must|This demo session|Task requires|Expected JSON|Request is too large|Invalid JSON)/.test(error.message)
    console.error(error)
    json(res, safe ? 400 : 500, { error: safe ? error.message : 'The request could not be completed. Please try again.' })
  }
})

server.listen(port, '0.0.0.0', () => console.log(`Project Loop demo listening on ${port} (${local ? 'local simulation' : projectId})`))
