import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, writeFile, utimes, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileBaselineStore } from '../src/baseline.ts'
import { FileLifetimeLedger } from '../src/lifetime-ledger.ts'
import { FileSessionUsageIndex } from '../src/session-usage-index.ts'

const createdAt = Date.parse('2025-01-02T12:00:00Z')
const usage = (inputTokens, outputTokens = 0) => ({ inputTokens, outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0 })
const event = (amount, step = 1) => ({
  type: 'assistant/message', time: createdAt + step,
  data: { turn: 1, step, usage: usage(amount) },
})
const source = (...amounts) => ({
  session: { createdAt },
  events: [
    { type: 'request/header', data: { header: { config: { provider: 'p', model: 'm' } } } },
    ...amounts.map((amount, index) => event(amount, index + 1)),
  ],
})
const record = (id, revision, eventCount = 1) => ({ header: { id, revision, eventCount, createdAt }, live: false })
async function sandbox() { return mkdtemp(join(tmpdir(), 'token-pet-lifetime-')) }
function query(records, snapshots, reads = []) {
  return {
    async listSessions() { return records },
    async readSession(id) { reads.push(id); const value = snapshots[id]; if (!value) throw new Error(`missing ${id}`); return value },
  }
}

test('deleted and archived sessions remain in Lifetime Ledger unchanged', async () => {
  const dir = await sandbox(); const ledger = new FileLifetimeLedger(dir)
  let records = [record('s1', 'r1')]
  const snapshots = { s1: source(7) }
  await ledger.refresh(query(records, snapshots))
  assert.equal((await ledger.usage()).total, 7)

  records = [] // deleted/archived from the host listing
  const absent = await ledger.refresh(query(records, snapshots))
  assert.equal(absent.updated, 0)
  assert.equal(absent.usage.total, 7)

  records = [record('s1', 'r1')] // restored archive, identical fingerprint
  const reads = []
  const restored = await ledger.refresh(query(records, snapshots, reads))
  assert.equal(restored.usage.total, 7)
  assert.deepEqual(reads, [])
})

test('snapshot usage remains readable while a writer owns the ledger lock', async () => {
  const dir = await sandbox(); const ledger = new FileLifetimeLedger(dir)
  await ledger.refresh(query([record('s1', 'r1')], { s1: source(7) }))
  const lock = `${ledger.file}.lock`
  await writeFile(lock, `${process.pid}:test-reader`)
  try { assert.equal((await ledger.usage()).total, 7) }
  finally { await unlink(lock).catch(() => {}) }
})

test('new and appended snapshots are idempotent across repeated refreshes', async () => {
  const dir = await sandbox(); const ledger = new FileLifetimeLedger(dir)
  let records = [record('s1', 'r1', 1)]
  const snapshots = { s1: source(5) }
  const reads = []
  const q = query(records, snapshots, reads)
  assert.equal((await ledger.refresh(q)).usage.total, 5)
  assert.equal((await ledger.refresh(q)).usage.total, 5)

  records.push(record('s2', 'r1', 1)); snapshots.s2 = source(3)
  assert.equal((await ledger.refresh(q)).usage.total, 8)
  assert.equal((await ledger.refresh(q)).usage.total, 8)

  records[0] = record('s1', 'r2', 2); snapshots.s1 = source(5, 4)
  assert.equal((await ledger.refresh(q)).usage.total, 12)
  assert.equal((await ledger.refresh(q)).usage.total, 12)
  assert.deepEqual(reads, ['s1', 's2', 's1'])
})

test('unchanged live sessions with reliable fingerprints are not reread', async () => {
  const dir = await sandbox(); const ledger = new FileLifetimeLedger(dir)
  const records = [{ header: { id: 'live', revision: 'r1', eventCount: 1, createdAt }, live: true }]
  const snapshots = { live: source(5) }
  const reads = []
  const q = query(records, snapshots, reads)
  assert.equal((await ledger.refresh(q)).usage.total, 5)
  assert.equal((await ledger.refresh(q)).usage.total, 5)
  assert.deepEqual(reads, ['live'])

  records[0] = { header: { id: 'live', revision: 'r2', eventCount: 2, createdAt }, live: true }
  snapshots.live = source(5, 4)
  assert.equal((await ledger.refresh(q)).usage.total, 9)
  assert.deepEqual(reads, ['live', 'live'])
})

test('live sessions without a changing fingerprint remain conservatively refreshed', async () => {
  const dir = await sandbox(); const ledger = new FileLifetimeLedger(dir)
  const records = [{ header: { id: 'live-unreliable', createdAt }, live: true }]
  const snapshots = { 'live-unreliable': source(3) }
  const reads = []
  const q = query(records, snapshots, reads)
  await ledger.refresh(q)
  await ledger.refresh(q)
  assert.deepEqual(reads, ['live-unreliable', 'live-unreliable'])
})

test('ledger is monotonic when a later snapshot shrinks', async () => {
  const dir = await sandbox(); const ledger = new FileLifetimeLedger(dir)
  let records = [record('s1', 'large', 2)]
  const snapshots = { s1: source(6, 5) }
  const q = query(records, snapshots)
  assert.equal((await ledger.refresh(q)).usage.total, 11)

  records[0] = record('s1', 'smaller', 1)
  snapshots.s1 = source(4)
  const shrunk = await ledger.refresh(q)
  assert.equal(shrunk.usage.total, 11)
  assert.equal((await ledger.usage()).total, 11)
  assert.equal((await ledger.inspect()).sessions.s1.observed.reduce((n, c) => n + c.total, 0), 11)
})

test('ordinary baseline reset and restore never clear lifetime history', async () => {
  const dir = await sandbox(); const ledger = new FileLifetimeLedger(dir); const baseline = new FileBaselineStore(dir)
  await ledger.refresh(query([record('s1', 'r1')], { s1: source(9) }))
  await baseline.reset({ [`p${String.fromCharCode(0)}m${String.fromCharCode(0)}2025-01-02`]: 9 })
  assert.equal((await ledger.usage()).total, 9)
  await baseline.restore()
  assert.equal((await ledger.usage()).total, 9)
})

test('clear-history is irreversible and only later appended usage is credited', async () => {
  const dir = await sandbox(); const ledger = new FileLifetimeLedger(dir)
  let records = [record('s1', 'r1', 1)]
  const snapshots = { s1: source(10) }
  const q = query(records, snapshots)
  await ledger.refresh(q)
  assert.equal((await ledger.clearHistory()).total, 0)
  assert.equal((await ledger.usage()).total, 0)

  // Refreshing the unchanged source cannot resurrect cleared history.
  assert.equal((await ledger.refresh(q)).usage.total, 0)
  records[0] = record('s1', 'r2', 2); snapshots.s1 = source(10, 3)
  assert.equal((await ledger.refresh(q)).usage.total, 3)
  assert.equal((await ledger.refresh(q)).usage.total, 3)
  assert.equal((await ledger.inspect()).generation, 1)
})

test('later clears preserve anti-replay floors for already deleted sessions', async () => {
  const dir = await sandbox(); const ledger = new FileLifetimeLedger(dir)
  let records = [record('s1', 'r1', 1)]
  const snapshots = { s1: source(10) }
  await ledger.refresh(query(records, snapshots))
  await ledger.clearHistory()
  records = []
  await ledger.refresh(query(records, snapshots))
  await ledger.clearHistory()
  records = [record('s1', 'r1', 1)]
  assert.equal((await ledger.refresh(query(records, snapshots))).usage.total, 0)
})

test('clear-history also replaces recovery backup so corruption cannot resurrect history', async () => {
  const dir = await sandbox(); const ledger = new FileLifetimeLedger(dir)
  await ledger.refresh(query([record('s1', 'r1')], { s1: source(12) }))
  await ledger.clearHistory()
  await writeFile(join(dir, 'lifetime-ledger.json'), '{corrupt-after-clear', 'utf8')
  assert.equal((await new FileLifetimeLedger(dir).usage()).total, 0)
})

test('concurrent ledger instances merge atomically without lost updates', async () => {
  const dir = await sandbox()
  const a = new FileLifetimeLedger(dir); const b = new FileLifetimeLedger(dir)
  await Promise.all([
    a.refresh(query([record('a', 'r1')], { a: source(4) })),
    b.refresh(query([record('b', 'r1')], { b: source(7) })),
  ])
  const restored = new FileLifetimeLedger(dir)
  assert.equal((await restored.usage()).total, 11)
  assert.deepEqual(Object.keys((await restored.inspect()).sessions).sort(), ['a', 'b'])
})

test('competing stale-lock recovery cannot delete a successor lock', async () => {
  const dir = await sandbox()
  const lock = join(dir, 'lifetime-ledger.json.lock')
  await writeFile(lock, '999999:dead-owner', 'utf8')
  const old = new Date(Date.now() - 10 * 60_000)
  await utimes(lock, old, old)
  const a = new FileLifetimeLedger(dir); const b = new FileLifetimeLedger(dir)
  await Promise.all([
    a.refresh(query([record('a', 'r1')], { a: source(4) })),
    b.refresh(query([record('b', 'r1')], { b: source(7) })),
  ])
  assert.equal((await new FileLifetimeLedger(dir).usage()).total, 11)
})

test('changed live fingerprints update automatically and never roll back', async () => {
  const dir = await sandbox(); const ledger = new FileLifetimeLedger(dir)
  const records = [{ ...record('live', 'r1', 1), live: true }]
  const snapshots = { live: source(2) }; const q = query(records, snapshots)
  assert.equal((await ledger.refresh(q)).usage.total, 2)
  snapshots.live = source(2, 5)
  records[0] = { ...record('live', 'r2', 2), live: true }
  assert.equal((await ledger.refresh(q)).usage.total, 7)
  snapshots.live = source(1)
  records[0] = { ...record('live', 'r3', 1), live: true }
  assert.equal((await ledger.refresh(q)).usage.total, 7)
})

test('checksummed backup recovers the last committed ledger from corruption', async () => {
  const dir = await sandbox(); const ledger = new FileLifetimeLedger(dir)
  await ledger.refresh(query([record('s1', 'r1')], { s1: source(13) }))
  const file = join(dir, 'lifetime-ledger.json'); const backup = `${file}.bak`
  assert.equal(JSON.parse(await readFile(backup, 'utf8')).version, 1)
  await writeFile(file, '{corrupt-primary', 'utf8')
  assert.equal((await new FileLifetimeLedger(dir).usage()).total, 13)
  // Valid JSON with a forged payload is rejected by the checksum too.
  const forged = JSON.parse(await readFile(backup, 'utf8')); forged.sessions.s1.credited[0].total = 1
  await writeFile(file, JSON.stringify(forged), 'utf8')
  assert.equal((await new FileLifetimeLedger(dir).usage()).total, 13)
})

test('simultaneous primary and backup corruption fails loudly instead of resetting history', async () => {
  const dir = await sandbox(); const ledger = new FileLifetimeLedger(dir)
  await ledger.refresh(query([record('s1', 'r1')], { s1: source(6) }))
  await writeFile(join(dir, 'lifetime-ledger.json'), '{broken-primary', 'utf8')
  await writeFile(join(dir, 'lifetime-ledger.json.bak'), '{broken-backup', 'utf8')
  await assert.rejects(() => new FileLifetimeLedger(dir).usage(), /corrupt and no valid backup/)
})

test('initial ledger backfill reuses the closed-session index without opening history logs', async () => {
  const dir = await sandbox(); const ledger = new FileLifetimeLedger(dir); const index = new FileSessionUsageIndex(dir)
  const fp = { revision: 'r1', eventCount: 1 }
  await index.put('s1', fp, [{ provider: 'p', model: 'm', day: '2025-01-02', totals: { uncachedInputTokens: 8, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 }, total: 10 }])
  const reads = []
  const result = await ledger.refresh(query([record('s1', 'r1', 1)], {}, reads), undefined, index)
  assert.equal(result.usage.total, 10)
  assert.deepEqual(reads, [])
})

test('every model-day token bucket is monotonic even when a rewritten source shifts categories', async () => {
  const dir = await sandbox(); const ledger = new FileLifetimeLedger(dir)
  const records = [record('s1', 'r1', 1)]
  const snapshots = { s1: { session: { createdAt }, events: [
    { type: 'request/header', data: { header: { config: { provider: 'p', model: 'm' } } } },
    { type: 'assistant/message', time: createdAt + 1, data: { turn: 1, step: 1, usage: { inputTokens: 10, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } } },
  ] } }
  const q = query(records, snapshots)
  await ledger.refresh(q)
  records[0] = record('s1', 'r2', 1)
  snapshots.s1 = { session: { createdAt }, events: [
    { type: 'request/header', data: { header: { config: { provider: 'p', model: 'm' } } } },
    { type: 'assistant/message', time: createdAt + 1, data: { turn: 1, step: 1, usage: { inputTokens: 1, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 } } },
  ] }
  const result = await ledger.refresh(q)
  assert.equal(result.usage.totals.uncachedInputTokens, 10)
  assert.equal(result.usage.totals.outputTokens, 20)
  assert.equal(result.usage.total, 30)
})
