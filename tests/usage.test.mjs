import assert from 'node:assert/strict'
import test from 'node:test'
import { aggregateUsageEvents } from '../src/usage.ts'

const usage = { inputTokens: 2, outputTokens: 3, cacheReadTokens: 5, cacheWriteTokens: 7 }

test('usage trend groups real usage into user timezone hours', () => {
  const now = Date.parse('2025-01-02T12:30:00Z')
  const events = [
    { type: 'assistant/message', time: Date.parse('2025-01-02T04:15:00Z'), data: { usage } }, // Jan 1 20:15 PST
    { type: 'assistant/message', time: Date.parse('2025-01-02T08:15:00Z'), data: { usage } }, // Jan 2 00:15 PST
  ]
  const result = aggregateUsageEvents(events, 'America/Los_Angeles', now)
  assert.equal(result.date, '2025-01-02')
  assert.equal(result.byHour[0].total, 17)
  assert.equal(result.total, 17)
  assert.deepEqual(result.byHour[0].totals, { uncachedInputTokens: 2, outputTokens: 3, cacheReadTokens: 5, cacheWriteTokens: 7 })
})

test('pure aggregation retains zero gaps inside the observed hours', () => {
  const now = Date.parse('2025-01-02T13:30:00Z')
  const result = aggregateUsageEvents([
    { type: 'assistant/message', time: Date.parse('2025-01-02T10:15:00Z'), data: { usage } },
    { type: 'assistant/message', time: Date.parse('2025-01-02T12:15:00Z'), data: { usage } },
    { type: 'assistant/message', time: Date.parse('2025-01-02T14:15:00Z'), data: { usage } },
  ], 'UTC', now)
  assert.deepEqual(result.byHour.slice(10, 13).map((point) => point.total), [17, 0, 17])
  assert.equal(result.byHour[14].total, 0)
})

test('turn and step terminal usage wins over streaming duplicate', () => {
  const now = Date.parse('2025-01-02T12:30:00Z')
  const events = [
    { type: 'request/header', data: { header: { config: { provider: 'p', model: 'm' } } } },
    { type: 'assistant/chunk', time: now, data: { chunk: { type: 'usage', usage }, turnId: 't', stepId: 's' } },
    { type: 'step/end', time: now, data: { stepId: 's', turnId: 't', usage: { inputTokens: 4, outputTokens: 6, cacheReadTokens: 8, cacheWriteTokens: 10 } } },
  ]
  const result = aggregateUsageEvents(events, 'UTC', now)
  assert.equal(result.total, 28)
})

test('canonical DSH numeric turn/step deduplicates chunk with final assistant usage', () => {
  const now = Date.parse('2025-01-02T12:30:00Z')
  const finalUsage = { inputTokens: 4, outputTokens: 6, cacheReadTokens: 8, cacheWriteTokens: 10 }
  const result = aggregateUsageEvents([
    { type: 'assistant/chunk', time: now, data: { turn: 3, step: 2, chunk: { type: 'usage', usage } } },
    { type: 'assistant/message', time: now, data: { turn: 3, step: 2, message: { content: [] }, usage: finalUsage } },
  ], 'UTC', now)
  assert.equal(result.total, 28)
  assert.equal(result.byHour[12].count, 1)
})

test('string turn/step and nested ids remain valid dedupe identities', () => {
  const now = Date.parse('2025-01-02T12:30:00Z')
  const finalUsage = { inputTokens: 4, outputTokens: 6, cacheReadTokens: 8, cacheWriteTokens: 10 }
  const result = aggregateUsageEvents([
    { type: 'assistant/chunk', time: now, data: { turn: '3', step: '2', chunk: { type: 'usage', usage } } },
    { type: 'assistant/message', time: now, data: { turn: { id: '3' }, step: { id: '2' }, message: { content: [] }, usage: finalUsage } },
  ], 'UTC', now)
  assert.equal(result.total, 28)
  assert.equal(result.byHour[12].count, 1)
})

test('future usage is excluded from the current-day trend', () => {
  const now = Date.parse('2025-01-02T12:30:00Z')
  const result = aggregateUsageEvents([
    { type: 'assistant/message', time: now - 30 * 60 * 1000, data: { usage } },
    { type: 'assistant/message', time: now + 30 * 60 * 1000, data: { usage } },
  ], 'UTC', now)
  assert.equal(result.total, 17)
  assert.equal(result.byHour[13].total, 0)
})

test('epoch seconds are accepted and DST repeated hour is one local bucket', () => {
  const now = Date.parse('2025-11-02T17:30:00Z')
  const result = aggregateUsageEvents([
    { type: 'assistant/message', time: Date.parse('2025-11-02T08:30:00Z') / 1000, data: { usage } },
    { type: 'assistant/message', time: Date.parse('2025-11-02T09:30:00Z'), data: { usage } },
  ], 'America/Los_Angeles', now)
  assert.equal(result.date, '2025-11-02')
  assert.equal(result.byHour[1].total, 34)
})
