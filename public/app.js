const $ = id => document.getElementById(id)
let workspace
let active = 'flowkit'
let lastAnalysis

function element(tag, attrs = {}, ...children) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value
    else if (key === 'text') node.textContent = value
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value)
    else node.setAttribute(key, value)
  }
  for (const child of children) node.append(child)
  return node
}

function toast(message) {
  $('toast').textContent = message
  $('toast').classList.add('visible')
  setTimeout(() => $('toast').classList.remove('visible'), 3800)
}

async function api(path, options = {}) {
  const response = await fetch(path, { headers: options.body ? { 'Content-Type': 'application/json' } : {}, credentials: 'same-origin', ...options })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Request failed')
  return data
}

async function reload() { workspace = await api('/api/workspace'); render() }
function project() { return workspace.projects.find(p => p.id === active) }
function projectEntries() { return workspace.entries.filter(e => e.projectId === active).sort((a,b) => a.date.localeCompare(b.date)) }
function projectTasks() { return workspace.tasks.filter(t => t.projectId === active) }

function renderProjects() {
  $('projects').replaceChildren(...workspace.projects.map(p => element('button', {
    class: `project-link${p.id === active ? ' active' : ''}`,
    type: 'button',
    onclick: () => { active = p.id; lastAnalysis = null; render() },
  }, element('span', { class: 'project-dot', style: `background:${p.color}` }), p.name)))
}

function renderEntries() {
  const entries = projectEntries()
  $('entry-count').textContent = entries.length
  $('entry-pill').textContent = `${entries.length} entries`
  $('entries').replaceChildren(...entries.map(entry => element('article', { class: 'entry' },
    element('div', { class: 'entry-node' }),
    element('div', {}, element('div', { class: 'entry-head' }, element('span', { class: 'entry-id', text: entry.id.slice(0, 8) }), element('span', { class: 'entry-date', text: entry.date })), element('p', { text: entry.text })))))
}

function renderTasks() {
  const tasks = projectTasks()
  $('task-count').textContent = tasks.length
  $('next-context').textContent = tasks.length ? `Next analysis receives ${tasks.length} human-approved ${tasks.length === 1 ? 'task' : 'tasks'}, including “${tasks.at(-1).title}”, with source IDs.` : 'Approve a task above to carry that decision into the next Gemini analysis.'
  $('tasks').replaceChildren(...(tasks.length ? tasks.map(task => element('article', { class: 'task' },
    element('strong', { text: task.title }),
    element('p', { text: task.reason }),
    element('span', { text: `✓ Human approved · Evidence ${task.evidenceIds.map(id => id.slice(0, 8)).join(', ')}` }))) : [element('div', { class: 'tasks-empty', text: 'No tasks approved yet. Review a Gemini suggestion to add one.' })]))
}

function renderAnalysis() {
  if (!lastAnalysis) {
    $('analysis').className = 'analysis-empty'
    $('analysis').replaceChildren(element('div', { class: 'analysis-symbol', text: '✳' }), element('strong', { text: 'Ready when you are' }), element('p', { text: 'Run an analysis to surface grounded next steps.' }))
    return
  }
  const root = $('analysis')
  root.className = 'analysis-result'
  const nodes = [element('div', { class: 'summary', text: lastAnalysis.summary })]
  if (lastAnalysis.risks.length) {
    nodes.push(element('h4', { text: 'RISKS TO WATCH' }))
    nodes.push(...lastAnalysis.risks.map(risk => element('div', { class: 'risk', text: risk })))
  }
  nodes.push(element('h4', { text: 'DRAFT NEXT STEPS' }))
  if (!lastAnalysis.suggestions.length) nodes.push(element('p', { class: 'panel-sub', text: 'The model did not return any grounded task suggestions.' }))
  for (const suggestion of lastAnalysis.suggestions) {
    const approved = projectTasks().some(task => task.sourceSuggestionId === suggestion.id)
    const button = element('button', { class: 'approve', type: 'button', text: approved ? '✓ Approved' : 'Approve as task ↗', onclick: async () => {
      button.disabled = true
      try {
        await api('/api/tasks', { method: 'POST', body: JSON.stringify({ projectId: active, suggestion }) })
        button.textContent = '✓ Approved'
        await reload()
        toast('Task approved and saved to the board')
      } catch (error) { button.disabled = false; toast(error.message) }
    } })
    button.disabled = approved
    nodes.push(element('article', { class: 'suggestion' }, element('strong', { text: suggestion.title }), element('p', { text: suggestion.reason }),
      element('div', {}, ...suggestion.evidenceIds.map(id => element('span', { class: 'citation', text: `↳ ${id.slice(0, 8)}` }))), button))
  }
  root.replaceChildren(...nodes)
}

function render() {
  if (!project()) active = workspace.projects[0].id
  const p = project()
  renderProjects()
  $('breadcrumb-project').textContent = p.name.toUpperCase()
  $('project-name').textContent = p.name
  $('project-goal').textContent = p.goal
  $('project-glyph').textContent = p.name[0]
  $('project-glyph').style.background = p.color
  $('mode').textContent = workspace.mode === 'cloud' ? 'LIVE GOOGLE CLOUD' : 'LOCAL AI SIMULATION'
  $('mode').classList.toggle('local', workspace.mode !== 'cloud')
  renderEntries(); renderTasks(); renderAnalysis()
}

$('entry-form').addEventListener('submit', async event => {
  event.preventDefault()
  const text = $('entry-text').value.trim()
  try {
    await api('/api/entries', { method: 'POST', body: JSON.stringify({ projectId: active, text }) })
    $('entry-text').value = ''
    lastAnalysis = null
    await reload()
    toast('Update added to project evidence')
  } catch (error) { toast(error.message) }
})

$('analyze').addEventListener('click', async () => {
  const button = $('analyze')
  button.disabled = true
  button.textContent = 'Analyzing evidence…'
  try {
    lastAnalysis = await api('/api/analyze', { method: 'POST', body: JSON.stringify({ projectId: active }) })
    renderAnalysis()
  } catch (error) { toast(error.message) }
  finally { button.disabled = false; button.replaceChildren('Analyze project evidence ', element('span', { text: '✦' })) }
})

reload().catch(error => { toast(error.message); $('analysis').textContent = 'Could not load the workspace. Please refresh.' })
