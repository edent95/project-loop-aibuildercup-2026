import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { initialState, entriesFor, buildPrompt, normalizeAnalysis, approveTask, addEntry } from './core.mjs'

test('Gemini suggestions require exact evidence IDs and approval is idempotent', () => {
  const state = initialState()
  const entries = entriesFor(state, 'flowkit')
  const analysis = normalizeAnalysis({
    summary: 'A follow-up is needed',
    suggestions: [
      { title: 'Prepare the support handoff', reason: 'The release is ready but the handoff is missing', evidenceIds: ['f1', 'invented'] },
      { title: 'Unfounded claim', evidenceIds: ['invented'] },
    ],
  }, entries)
  assert.equal(analysis.suggestions.length, 1)
  assert.deepEqual(analysis.suggestions[0].evidenceIds, ['f1'])
  state.pendingSuggestions = [{ ...analysis.suggestions[0], projectId: 'flowkit' }]
  const first = approveTask(state, 'flowkit', analysis.suggestions[0], entries)
  const second = approveTask(state, 'flowkit', analysis.suggestions[0], entries)
  assert.equal(first.id, second.id)
  assert.equal(state.tasks.length, 1)
  assert.throws(() => approveTask(state, 'flowkit', { id: crypto.randomUUID(), title: 'Uncited task', evidenceIds: ['invented'] }, entries), /current analyzed suggestion/)
  assert.throws(() => approveTask(state, 'relay', analysis.suggestions[0], entriesFor(state, 'relay')), /current analyzed suggestion/)
})

test('project evidence is bounded and cannot cross projects', () => {
  const state = initialState()
  assert.throws(() => addEntry(state, 'missing', 'A valid but unknown project update'), /Unknown project/)
  assert.throws(() => addEntry(state, 'flowkit', 'short'), /12–500/)
  const entry = addEntry(state, 'flowkit', 'A new release handoff needs an owner.')
  assert.equal(entriesFor(state, 'flowkit').at(-1).id, entry.id)
  assert.doesNotMatch(buildPrompt(state.projects[1], entriesFor(state, 'relay')), /release handoff/i)
})

test('the next analysis receives only this project\'s approved decisions', () => {
  const state = initialState()
  const prompt = buildPrompt(state.projects[0], entriesFor(state, 'flowkit'), [
    { title: 'Prepare the support handoff', evidenceIds: ['f1'] },
  ])
  assert.match(prompt, /Human-approved tasks from prior runs:\n- Prepare the support handoff \(source IDs: f1\)/)
  assert.match(prompt, /Do not suggest a task already approved/)
  assert.doesNotMatch(buildPrompt(state.projects[1], entriesFor(state, 'relay')), /Prepare the support handoff/)
})
