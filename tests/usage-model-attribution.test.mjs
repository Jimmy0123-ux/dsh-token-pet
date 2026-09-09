import assert from 'node:assert/strict'
import test from 'node:test'
import { aggregateCumulativeUsage, aggregateUsageEvents, foldSessionUsage, summarizeUsageCells } from '../src/usage.ts'

const now = Date.parse('2025-01-02T12:30:00Z')
const header = (provider, model, flat = false) => ({
  type: 'request/header', data: { header: flat ? { provider, model } : { config: { provider, model } } },
})
const usage = (n) => ({ inputTokens: n, outputTokens: n * 2, cacheReadTokens: n * 3, cacheWriteTokens: n * 4 })
const chunk = (turn, step, n, time = now) => ({
  type: 'assistant/chunk', time, data: { turn, step, chunk: { type: 'usage', usage: usage(n) } },
})
const final = (turn, step, n, time = now, type = 'assistant/message') => ({
  type, time, data: { turn, step, usage: usage(n) },
})
const models = (events) => summarizeUsageCells(foldSessionUsage(events, now)).models
const expected = (provider, model, total) => ({ provider, model, total })

// Canonical DSH numeric turn/step identities, not an unkeyed approximation.
const switched = () => [
  header('p', 'first'), chunk(1, 1, 1), final(1, 1, 2),
  header('p', 'second'), chunk(2, 1, 3), final(2, 1, 4),
]

test('numeric turn/step usage stays with its request model after a switch', () => {
  assert.deepEqual(models(switched()), [expected('p', 'second', 40), expected('p', 'first', 20)])
  const cells = foldSessionUsage(switched(), now)
  assert.deepEqual(cells.find(cell => cell.model === 'first').totals, {
    uncachedInputTokens: 2, outputTokens: 4, cacheReadTokens: 6, cacheWriteTokens: 8,
  })
})

test('same model name under different providers remains separate through switches back', () => {
  const events = [
    header('provider-a', 'shared'), chunk(1, 1, 1), final(1, 1, 2),
    header('provider-b', 'shared', true), chunk(1, 2, 3), final(1, 2, 4, now, 'step/end'),
    header('provider-a', 'shared'), final(2, 1, 1, now, 'turn/end'),
  ]
  assert.deepEqual(models(events), [expected('provider-b', 'shared', 40), expected('provider-a', 'shared', 30)])
})

test('a trailing request header cannot claim earlier usage or previously unknown usage', () => {
  const events = [final(0, 0, 1), header('p', 'first'), final(1, 1, 2), header('p', 'unused')]
  assert.deepEqual(models(events), [expected('p', 'first', 20), expected('(unknown)', '(unknown)', 10)])
})

test('latest streaming snapshot wins until final; late chunks do not replace final', () => {
  const events = [
    header('p', 'streaming'), chunk(1, 1, 1), chunk(1, 1, 2),
    header('p', 'finished'), chunk(2, 1, 3), final(2, 1, 4), chunk(2, 1, 99),
    final(2, 1, 5, now, 'step/end'), chunk(2, 1, 100),
  ]
  assert.deepEqual(models(events), [expected('p', 'finished', 50), expected('p', 'streaming', 20)])
  const trend = aggregateUsageEvents(events, 'UTC', now)
  assert.equal(trend.total, 70)
  assert.equal(trend.byHour[12].count, 2)
})

test('unkeyed usage retains chronology and is not deduplicated', () => {
  const events = [
    header('p', 'first'), final(undefined, undefined, 1), final(undefined, undefined, 1),
    header('p', 'second'), final(undefined, undefined, 3),
  ]
  assert.deepEqual(models(events), [expected('p', 'second', 30), expected('p', 'first', 20)])
})

test('deduplication retains final timestamp and input event objects without mutation', () => {
  const early = Date.parse('2025-01-02T10:30:00Z')
  const events = [header('p', 'first'), chunk(1, 1, 1, early), final(1, 1, 2), header('p', 'unused')]
  const before = structuredClone(events)
  const trend = aggregateUsageEvents(events, 'UTC', now)
  assert.equal(trend.byHour[10].count, 0)
  assert.equal(trend.byHour[12].count, 1)
  assert.equal(trend.total, 20)
  foldSessionUsage(events, now)
  assert.deepEqual(events, before)
})

test('public cumulative aggregation uses the same per-model attribution as session folds', async () => {
  const result = await aggregateCumulativeUsage({
    async listSessions() { return [{ header: { id: 'switch', createdAt: now } }] },
    async readSession() { return { session: { createdAt: now }, events: switched() } },
  })
  assert.equal(result.sessions, 1)
  assert.equal(result.total, 60)
  assert.deepEqual(result.models, [expected('p', 'second', 40), expected('p', 'first', 20)])
})
