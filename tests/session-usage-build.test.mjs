import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileSessionUsageIndex } from '../src/session-usage-index.ts'
import { buildSessionUsageIndex, incrementSessionUsageIndex, inspectSessionUsageIndex } from '../src/usage.ts'

const createdAt = Date.parse('2025-01-02T12:00:00Z')
const usage = { inputTokens: 2, outputTokens: 3, cacheReadTokens: 5, cacheWriteTokens: 7 }
const records = (n) => Array.from({ length: n }, (_, i) => ({
  header: { id: `s${i + 1}`, revision: `r${i + 1}`, eventCount: 2, createdAt, updatedAt: createdAt + 1000 },
}))
const source = () => ({ session: { createdAt }, events: [
  { type: 'request/header', data: { header: { config: { provider: 'p', model: 'm' } } } },
  { type: 'turn/end', time: createdAt, data: { usage } },
] })
async function sandbox() { return mkdtemp(join(tmpdir(), 'token-pet-build-')) }

 test('builds closed sessions serially, reports progress, and persists each item', async () => {
  const dir = await sandbox(); const index = new FileSessionUsageIndex(dir); const queryRecords = records(3)
  let active = 0; let maxActive = 0; const order = []; const progress = []
  const query = { async listSessions() { return queryRecords }, async readSession(id) {
    active++; maxActive = Math.max(maxActive, active); order.push(id); await new Promise(r => setTimeout(r, 2)); active--; return source()
  } }
  const result = await buildSessionUsageIndex(query, index, { onProgress: p => progress.push(p), yieldEvery: 1 })
  assert.deepEqual(result, { completed: 3, total: 3, indexed: 3, skipped: 0, failed: 0, cancelled: false })
  assert.equal(maxActive, 1); assert.deepEqual(order, ['s1', 's2', 's3'])
  assert.deepEqual(progress.map(p => [p.sessionId, p.status, p.completed]), [['s1', 'indexed', 1], ['s2', 'indexed', 2], ['s3', 'indexed', 3]])
  assert.equal(Object.keys(await index.entries()).length, 3)
})

test('cancellation retains completed entries and resume skips them by fingerprint', async () => {
  const dir = await sandbox(); const index = new FileSessionUsageIndex(dir); const queryRecords = records(3); const controller = new AbortController(); const firstReads = []
  const query = { async listSessions() { return queryRecords }, async readSession(id) { firstReads.push(id); return source() } }
  const first = await buildSessionUsageIndex(query, index, { onProgress: p => { if (p.completed === 1) controller.abort() }, signal: controller.signal })
  assert.equal(first.cancelled, true); assert.equal(first.completed, 1); assert.equal(first.indexed, 1); assert.deepEqual(firstReads, ['s1'])
  const resumedReads = []; const resumed = await buildSessionUsageIndex({ ...query, async readSession(id) { resumedReads.push(id); return source() } }, index)
  assert.equal(resumed.cancelled, false); assert.equal(resumed.skipped, 1); assert.equal(resumed.indexed, 2); assert.deepEqual(resumedReads, ['s2', 's3'])
})

test('read failures are isolated and corrupt index is rebuilt safely', async () => {
  const dir = await sandbox(); await writeFile(join(dir, 'session-usage-index.json'), '{not-json', 'utf8')
  const index = new FileSessionUsageIndex(dir); const errors = []; const query = { async listSessions() { return records(2) }, async readSession(id) { if (id === 's1') throw new Error('bad session'); return source() } }
  const result = await buildSessionUsageIndex(query, index, { onError: (id, e) => errors.push([id, e.message]) })
  assert.equal(result.failed, 1); assert.equal(result.indexed, 1); assert.deepEqual(errors, [['s1', 'bad session']])
  assert.equal((await index.lookup('s1', { revision: 'r1', eventCount: 2, updatedAt: createdAt + 1000 })), undefined)
  assert.equal((await index.lookup('s2', { revision: 'r2', eventCount: 2, updatedAt: createdAt + 1000 }))[0].total, 17)
  JSON.parse(await readFile(join(dir, 'session-usage-index.json'), 'utf8'))
})

test('real closed headers without revision receive a stable fallback fingerprint', async () => {
  const dir = await sandbox(); const index = new FileSessionUsageIndex(dir)
  const header = { id: 'closed-real', version: 3, createdAt, cwd: 'C:/project', parentSession: undefined, seedLength: 12, delegationDepth: 0 }
  let reads = 0
  const query = { async listSessions() { return [{ header, live: false }] }, async readSession() { reads++; return source() } }
  const first = await buildSessionUsageIndex(query, index)
  assert.deepEqual({ indexed: first.indexed, skipped: first.skipped, failed: first.failed }, { indexed: 1, skipped: 0, failed: 0 })
  const entry = (await index.entries())['closed-real']
  assert.match(String(entry.fingerprint.revision), /^header:/)
  const second = await buildSessionUsageIndex(query, index)
  assert.equal(second.skipped, 1); assert.equal(reads, 1)
})

test('live sessions are not indexed, while closed sessions are retained across refreshes', async () => {
  const dir = await sandbox(); const index = new FileSessionUsageIndex(dir); let reads = 0
  const query = { async listSessions() { return [
    { header: { id: 'live-real', version: 1, createdAt, cwd: 'C:/p' }, live: true },
    { header: { id: 'closed-real', version: 1, createdAt, cwd: 'C:/p' }, live: false },
  ] }, async readSession(id) { reads++; assert.equal(id, 'closed-real'); return source() } }
  const result = await buildSessionUsageIndex(query, index)
  assert.equal(result.indexed, 1); assert.equal(result.skipped, 0); assert.equal(result.total, 1); assert.equal(reads, 1)
  assert.equal((await index.entries())['live-real'], undefined)
  const repeat = await buildSessionUsageIndex(query, index)
  assert.equal(repeat.indexed, 0); assert.equal(repeat.skipped, 1); assert.equal(repeat.total, 1); assert.equal(reads, 1)
})

test('incremental refresh reads only new or changed real headers and isolates failures', async () => {
  const dir = await sandbox(); const index = new FileSessionUsageIndex(dir); let state = [
    { header: { id: 'stable', version: 1, createdAt, cwd: 'C:/p' }, live: false },
    { header: { id: 'bad', version: 1, createdAt, cwd: 'C:/p' }, live: false },
  ]; const reads = []
  const query = { async listSessions() { return state }, async readSession(id) { reads.push(id); if (id === 'bad') throw new Error('bad log'); return source() } }
  const first = await incrementSessionUsageIndex(query, index)
  assert.equal(first.indexed, 1); assert.equal(first.failed, 1); assert.equal(first.total, 2)
  state = [
    { header: { id: 'stable', version: 2, createdAt, cwd: 'C:/p' }, live: false },
    { header: { id: 'bad', version: 1, createdAt, cwd: 'C:/p' }, live: false },
    { header: { id: 'new', version: 1, createdAt, cwd: 'C:/p' }, live: false },
  ]
  const second = await incrementSessionUsageIndex(query, index)
  assert.equal(second.indexed, 2); assert.equal(second.failed, 1); assert.equal(second.total, 3)
  assert.deepEqual(reads, ['stable', 'bad', 'stable', 'bad', 'new'])
  assert.ok((await index.entries())['stable']); assert.ok((await index.entries())['new'])
})

test('inspection pending counts only new or changed closed sessions', async () => {
  const dir = await sandbox(); const index = new FileSessionUsageIndex(dir)
  const stable = { header: { id: 'stable', revision: 'r1', eventCount: 2, createdAt }, live: false }
  const query = { async listSessions() { return [
    stable,
    { header: { id: 'changed', revision: 'r2', eventCount: 3, createdAt }, live: false },
    { header: { id: 'live', revision: 'r1', eventCount: 100, createdAt }, live: true },
  ] }, async readSession() { return source() } }
  await index.put('stable', { revision: 'r1', eventCount: 2 }, [{ provider: 'p', model: 'm', day: '2025-01-02', totals: { uncachedInputTokens: 2, outputTokens: 3, cacheReadTokens: 5, cacheWriteTokens: 7 }, total: 17 }])
  const inspection = await inspectSessionUsageIndex(query, index)
  assert.deepEqual({ closed: inspection.closed, live: inspection.live, indexed: inspection.indexed, pending: inspection.pending }, { closed: 2, live: 1, indexed: 1, pending: 1 })
  const sync = await incrementSessionUsageIndex(query, index)
  assert.deepEqual({ completed: sync.completed, total: sync.total, indexed: sync.indexed, skipped: sync.skipped }, { completed: 1, total: 1, indexed: 1, skipped: 1 })
})

test('incremental sync reuses a readiness inspection without listing sessions twice', async () => {
  const dir = await sandbox(); const index = new FileSessionUsageIndex(dir)
  let lists = 0; let reads = 0
  const query = {
    async listSessions() { lists++; return records(1).map(record => ({ ...record, live: false })) },
    async readSession() { reads++; return source() },
  }
  const inspection = await inspectSessionUsageIndex(query, index)
  const result = await incrementSessionUsageIndex(query, index, { inspection })
  assert.equal(lists, 1)
  assert.equal(reads, 1)
  assert.equal(result.indexed, 1)
})
