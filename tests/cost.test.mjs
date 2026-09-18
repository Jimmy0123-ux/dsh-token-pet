import assert from 'node:assert/strict'
import test from 'node:test'
import {
  costOfTotals,
  costPerModel,
  dayTotalsOfCells,
  formatCost,
  monthKeyOf,
  monthlyCostOfCells,
  parsePriceTable,
  resolvePrice,
  DEFAULT_PRICES,
  DEFAULT_PRICE_TABLE_JSON,
  draftRowsToJson,
  priceRowsFromJson,
} from '../src/client/cost.ts'

const USAGE = { uncachedInputTokens: 1_000_000, outputTokens: 500_000, cacheReadTokens: 250_000, cacheWriteTokens: 0 }

test('price resolution: exact key, prefix, then fallback', () => {
  assert.equal(resolvePrice(DEFAULT_PRICES, 'deepseek-chat'), DEFAULT_PRICES['deepseek-chat'])
  const claude = resolvePrice(DEFAULT_PRICES, 'claude-3-5-sonnet-20241022')
  assert.equal(claude, DEFAULT_PRICES['claude-*'])
  assert.equal(resolvePrice(DEFAULT_PRICES, 'unknown-model-xyz'), DEFAULT_PRICES['*'])
  assert.deepEqual(resolvePrice({}, 'anything'), { input: 1, cacheRead: 0.5, cacheWrite: 1, output: 3 })
})

test('cost of a token snapshot is per-1M rates', () => {
  const price = { input: 1, cacheRead: 0.5, cacheWrite: 0.5, output: 3 }
  assert.equal(costOfTotals(USAGE, price), 1 * 1 + 3 * 0.5 + 0.5 * 0.25)
})

test('parsePriceTable validates numbers and returns null for garbage', () => {
  assert.equal(parsePriceTable('not json'), null)
  assert.equal(parsePriceTable('[]'), null)
  assert.equal(parsePriceTable('{}'), null)
  const table = parsePriceTable(JSON.stringify({ 'deepseek-chat': { input: 0.27, output: 1.1, cacheRead: 0.07, cacheWrite: 0.27 } }))
  assert.ok(table)
  assert.equal(table['deepseek-chat'].output, 1.1)
  assert.equal(parsePriceTable(JSON.stringify({ 'bad': { input: -1 } })), null, 'zero-rate entries are dropped')
  assert.equal(parsePriceTable(JSON.stringify({ 'x': { input: 'high' } })), null)
})

test('monthly cost aggregates only the current local month', () => {
  const now = Date.UTC(2026, 8, 15, 10, 0, 0) // 2026-09-15 UTC
  const cells = [
    { provider: 'p', model: 'deepseek-chat', day: '2026-09-01', totals: { uncachedInputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, total: 1_000_000 },
    { provider: 'p', model: 'deepseek-chat', day: '2026-08-31', totals: { uncachedInputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, total: 1_000_000 },
  ]
  assert.equal(monthKeyOf(now).prefix, '2026-09')
  assert.equal(monthlyCostOfCells(cells, DEFAULT_PRICES, now), 0.27)
})

test('costPerModel and dayTotals roll cells deterministically', () => {
  const cells = [
    { provider: 'p', model: 'deepseek-chat', day: '2026-09-01', totals: { uncachedInputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, total: 1_000_000 },
    { provider: 'p', model: 'deepseek-chat', day: '2026-09-02', totals: { uncachedInputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, total: 1_000_000 },
    { provider: 'q', model: 'other', day: '2026-09-01', totals: { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, total: 0 },
  ]
  const rows = costPerModel(cells, DEFAULT_PRICES)
  assert.equal(rows.length, 2)
  const deepseek = rows.find((row) => row.model === 'deepseek-chat')
  assert.equal(deepseek.total, 2_000_000)
  assert.equal(deepseek.cost, 0.54)
  const days = dayTotalsOfCells(cells)
  assert.deepEqual(days.map((row) => row.day), ['2026-09-02', '2026-09-01'])
  assert.equal(days[0].total, 1_000_000)
  assert.equal(days.find((row) => row.day === '2026-09-01').cells, 2)
})

test('formatCost renders USD and CNY', () => {
  assert.equal(formatCost(1.234, 'USD'), '$1.23')
  assert.equal(formatCost(1.234, 'CNY'), '¥8.88')
  assert.equal(formatCost(-1), '—')
  assert.equal(formatCost(Number.NaN), '—')
})

test('price editor draft helpers round-trip the persisted table', () => {
  const rows = priceRowsFromJson(DEFAULT_PRICE_TABLE_JSON)
  assert.ok(rows.length >= 5, 'defaults produce editable rows')
  assert.equal(rows.find((row) => row.key === 'deepseek-chat').input, '0.27')
  const { json, invalid } = draftRowsToJson(rows)
  assert.equal(invalid.length, 0)
  assert.equal(parsePriceTable(json)['deepseek-reasoner'].input, 0.55)
})

test('price editor rejects rows with empty keys or bad numbers and flags them', () => {
  const base = priceRowsFromJson(DEFAULT_PRICE_TABLE_JSON)
  const rows = [
    ...base.slice(0, 1),
    { id: 'bad-key', key: '../escape', input: '1', output: '2', cacheRead: '0', cacheWrite: '0' },
    { id: 'bad-num', key: 'gpt-5', input: '-1', output: '2', cacheRead: '0', cacheWrite: '0' },
    { id: 'empty-key', key: '  ', input: '1', output: '2', cacheRead: '0', cacheWrite: '0' },
  ]
  const { json, invalid } = draftRowsToJson(rows)
  assert.equal(invalid.length, 3)
  assert.ok(json !== null && parsePriceTable(json)['deepseek-chat'] !== undefined, 'valid rows still serialize')
  const empty = draftRowsToJson([{ id: 'x', key: 'k', input: 'nope', output: '2', cacheRead: '0', cacheWrite: '0' }])
  assert.equal(empty.json, null)
  assert.equal(empty.invalid.length, 1)
})
