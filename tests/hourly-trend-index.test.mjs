import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { FileHourlyTrendIndex } from '../src/hourly-trend-index.ts'

const usage = (input, output = 0) => ({ inputTokens: input, outputTokens: output, cacheReadTokens: 0, cacheWriteTokens: 0 })
const route = (seq, time) => ({ seq, time, type: 'request/header', data: { header: { config: { provider: 'p', model: 'm' } } } })

test('durable trend replaces streaming usage with terminal usage and reopens from snapshot', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'token-pet-trend-'))
  try {
    const file = join(dir, 'trend.json')
    const index = new FileHourlyTrendIndex(file)
    const time = Math.floor((Date.now() - 2 * 3_600_000) / 3_600_000) * 3_600_000 + 15 * 60_000
    await index.applyEvents('s1', [
      route(0, time),
      { seq: 1, time, type: 'assistant/chunk', data: { turn: 1, step: 2, chunk: { type: 'usage', usage: usage(10, 1) } } },
      { seq: 2, time, type: 'step/end', data: { turn: 1, step: 2, usage: usage(20, 3) } },
    ])
    const first = await index.trend('UTC', time + 2 * 3_600_000)
    assert.equal(first.total, 23)
    assert.equal(first.byHour[0].count, 1)

    // A new object simulates panel/Host reopen: only the checksum-protected file
    // is read; no session query/persistence service participates.
    const reopened = new FileHourlyTrendIndex(file)
    assert.equal((await reopened.trend('UTC', time + 2 * 3_600_000)).total, 23)
    assert.equal(await reopened.status(), 'ready')
    const appended = await reopened.applyEvent('s1', { seq: 3, time: time + 1_000, type: 'turn/end', data: { turn: 2, step: 1, usage: usage(2) } })
    assert.equal(appended.applied, true)
    const afterTail = await reopened.trend('UTC', time + 2 * 3_600_000)
    assert.equal(afterTail.total, 25, 'restart resumes exactly at the persisted session cursor')
    assert.equal(afterTail.byHour[0].count, 2)
    const envelope = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(envelope.version, 1)
    assert.match(envelope.checksum, /^[a-f0-9]{64}$/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('day switches are snapshot-only and gaps request lazy repair without double counting', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'token-pet-trend-'))
  try {
    const clock = Date.parse('2025-01-02T12:00:00Z')
    const index = new FileHourlyTrendIndex(join(dir, 'trend.json'), () => clock)
    const yesterday = Date.parse('2025-01-01T23:10:00Z')
    await index.applyEvents('s', [route(0, yesterday), { seq: 1, time: yesterday, type: 'step/end', data: { turn: 1, step: 1, usage: usage(4) } }])
    const gap = await index.applyEvent('s', { seq: 4, time: Date.parse('2025-01-02T01:00:00Z'), type: 'step/end', data: { turn: 2, step: 1, usage: usage(9) } })
    assert.deepEqual(gap, { applied: false, repairFrom: 2 })
    assert.equal((await index.trend('UTC', Date.parse('2025-01-02T12:00:00Z'))).total, 0)
    assert.equal((await index.trend('UTC', Date.parse('2025-01-01T23:30:00Z'))).total, 4)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('replayed cursor events are idempotent and terminal replacement survives restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'token-pet-trend-'))
  try {
    const file = join(dir, 'trend.json')
    const now = Date.parse('2025-03-01T12:00:00Z')
    const time = now - 60_000
    const first = new FileHourlyTrendIndex(file, () => now)
    await first.applyEvents('s', [
      route(0, time),
      { seq: 1, time, type: 'assistant/chunk', data: { turn: 7, step: 1, chunk: { type: 'usage', usage: usage(10) } } },
    ])
    const reopened = new FileHourlyTrendIndex(file, () => now)
    assert.deepEqual(await reopened.applyEvent('s', { seq: 1, time, type: 'assistant/chunk', data: { turn: 7, step: 1, chunk: { type: 'usage', usage: usage(999) } } }), { applied: false })
    await reopened.applyEvent('s', { seq: 2, time, type: 'step/end', data: { turn: 7, step: 1, usage: usage(25, 2) } })
    assert.equal((await reopened.trend('UTC', now)).total, 27)
    // A later non-terminal frame for the same identity cannot replace a final.
    await reopened.applyEvent('s', { seq: 3, time, type: 'assistant/chunk', data: { turn: 7, step: 1, chunk: { type: 'usage', usage: usage(500) } } })
    assert.equal((await reopened.trend('UTC', now)).total, 27)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('suffix repair advances from the requested cursor without recounting prefix', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'token-pet-trend-'))
  try {
    const now = Date.parse('2025-04-02T12:00:00Z')
    const time = now - 60_000
    const index = new FileHourlyTrendIndex(join(dir, 'trend.json'), () => now)
    await index.applyEvents('s', [route(0, time), { seq: 1, time, type: 'step/end', data: { turn: 1, step: 1, usage: usage(4) } }])
    assert.deepEqual(await index.applyEvent('s', { seq: 4, time, type: 'turn/end', data: { turn: 2, step: 1, usage: usage(9) } }), { applied: false, repairFrom: 2 })
    const repaired = await index.applyEvents('s', [
      { seq: 2, time, type: 'request/header', data: { header: { config: { provider: 'p', model: 'm' } } } },
      { seq: 3, time, type: 'step/end', data: { turn: 2, step: 1, usage: usage(9) } },
      { seq: 4, time, type: 'turn/end', data: {} },
    ])
    assert.equal(repaired.repairFrom, undefined)
    assert.equal((await index.trend('UTC', now)).total, 13)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('UTC cells merge into the repeated local DST hour without a history read', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'token-pet-trend-'))
  try {
    const now = Date.parse('2025-11-02T17:00:00Z')
    const index = new FileHourlyTrendIndex(join(dir, 'trend.json'), () => now)
    await index.applyEvents('s', [
      route(0, Date.parse('2025-11-02T08:30:00Z')),
      { seq: 1, time: Date.parse('2025-11-02T08:30:00Z'), type: 'step/end', data: { turn: 1, step: 1, usage: usage(3) } },
      { seq: 2, time: Date.parse('2025-11-02T09:30:00Z'), type: 'step/end', data: { turn: 2, step: 1, usage: usage(5) } },
    ])
    const trend = await index.trend('America/Los_Angeles', now)
    assert.deepEqual(trend.byHour.map(point => point.hourOfDay), [1])
    assert.equal(trend.byHour[0].total, 8)
    assert.equal(trend.byHour[0].count, 2)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('large single-session rebuild yields to the HTTP event loop in bounded chunks', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'token-pet-trend-yield-'))
  try {
    const clock = Date.now()
    const index = new FileHourlyTrendIndex(join(dir, 'trend.json'), () => clock)
    const events = Array.from({ length: 5_000 }, (_, seq) => ({ seq, time: clock, type: 'user/message', data: {} }))
    let ticks = 0; let running = true
    const tick = () => { if (!running) return; ticks++; setImmediate(tick) }
    setImmediate(tick)
    await index.replaceAll([{ sessionId: 'large', revision: 'r1', events }])
    running = false
    assert.ok(ticks >= 4, `expected chunked event-loop yields, observed ${ticks}`)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('maintenance inspection exposes only compact snapshot metadata', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'token-pet-trend-inspect-'))
  try {
    const now = Date.now()
    const index = new FileHourlyTrendIndex(join(dir, 'trend.json'), () => now)
    await index.applyEvents('s', [route(0, now), { seq: 1, time: now, type: 'step/end', data: { turn: 1, step: 1, usage: usage(4) } }])
    assert.deepEqual(await index.inspect(), { health: 'ready', updatedAt: now, sessions: 1, cells: 1 })
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('checksum damage is loud and arms rebuild state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'token-pet-trend-'))
  try {
    const file = join(dir, 'trend.json')
    await writeFile(file, JSON.stringify({ version: 1, checksum: 'bad', payload: { sessions: {}, cells: {}, updatedAt: 0 } }))
    const index = new FileHourlyTrendIndex(file)
    assert.equal(await index.status(), 'corrupt')
    assert.equal((await index.trend('UTC', Date.now())).total, 0)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
