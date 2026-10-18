import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { initialState, entriesFor, buildPrompt, normalizeAnalysis, approveTask, addEntry } from './core.mjs'

test('Gemini suggestions require exact evidence IDs and approval is idempotent', () => {
  const state = initialState()
  const entries = entriesFor(state, 'atlas')
  const analysis = normalizeAnalysis({
    summary: 'A follow-up is needed',
    suggestions: [
      { title: 'Assign an owner to the focus trap', reason: 'The issue is reproducible', evidenceIds: ['a1', 'invented'] },
      { title: 'Unfounded claim', evidenceIds: ['invented'] },
    ],
  }, entries)
  assert.equal(analysis.suggestions.length, 1)
  assert.deepEqual(analysis.suggestions[0].evidenceIds, ['a1'])
  state.pendingSuggestions = [{ ...analysis.suggestions[0], projectId: 'atlas' }]
  const first = approveTask(state, 'atlas', analysis.suggestions[0], entries)
  const second = approveTask(state, 'atlas', analysis.suggestions[0], entries)
  assert.equal(first.id, second.id)
  assert.equal(state.tasks.length, 1)
  assert.throws(() => approveTask(state, 'atlas', { id: crypto.randomUUID(), title: 'Uncited task', evidenceIds: ['invented'] }, entries), /current analyzed suggestion/)
  assert.throws(() => approveTask(state, 'solara', analysis.suggestions[0], entriesFor(state, 'solara')), /current analyzed suggestion/)
})

test('project evidence is bounded and cannot cross projects', () => {
  const state = initialState()
  assert.throws(() => addEntry(state, 'missing', 'A valid but unknown project update'), /Unknown project/)
  assert.throws(() => addEntry(state, 'atlas', 'short'), /12–500/)
  const entry = addEntry(state, 'atlas', 'A new keyboard finding needs an owner.')
  assert.equal(entriesFor(state, 'atlas').at(-1).id, entry.id)
  assert.doesNotMatch(buildPrompt(state.projects[1], entriesFor(state, 'solara')), /keyboard finding/i)
})
