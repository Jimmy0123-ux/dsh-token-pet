import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileSessionUsageIndex } from '../src/session-usage-index.ts'
import { resolveDshHome } from '../src/baseline.ts'
import { aggregateCumulativeUsage, incrementSessionUsageIndex } from '../src/usage.ts'

const usage = { inputTokens: 2, outputTokens: 3, cacheReadTokens: 5, cacheWriteTokens: 7 }
const cells = [{
  provider: 'p', model: 'm', day: '2025-01-02',
  totals: { uncachedInputTokens: 2, outputTokens: 3, cacheReadTokens: 5, cacheWriteTokens: 7 },
  total: 17,
}]

async function sandbox() { return mkdtemp(join(tmpdir(), 'token-pet-index-')) }

test('session usage index persists entries and is idempotent across instances', async () => {
  const dir = await sandbox()
  const first = new FileSessionUsageIndex(dir)
  await first.put('s1', { revision: 'r1', updatedAt: 10, eventCount: 2 }, cells)
  const second = new FileSessionUsageIndex(dir)
  assert.deepEqual(await second.lookup('s1', { revision: 'r1', updatedAt: 10, eventCount: 2 }), cells)
  await second.put('s1', { revision: 'r1', updatedAt: 10, eventCount: 2 }, cells)
  assert.equal((await second.entries()).s1.cells[0].total, 17)
  assert.equal(JSON.parse(await readFile(join(dir, 'session-usage-index.json'), 'utf8')).version, 1)
})

test('ensurePersisted materializes an empty index and marks it persisted', async () => {
  const dir = await sandbox()
  const index = new FileSessionUsageIndex(dir)
  assert.equal(await index.isPersisted(), false)
  await index.ensurePersisted()
  assert.equal(await index.isPersisted(), true)
  const restored = new FileSessionUsageIndex(dir)
  assert.equal(await restored.isPersisted(), true)
  assert.deepEqual(Object.keys(await restored.entries()), [])
})

test('concurrent writes preserve the latest state on disk', async () => {
  const dir = await sandbox()
  const index = new FileSessionUsageIndex(dir)
  await Promise.all([
    index.put('s1', { revision: 1 }, cells),
    index.put('s2', { revision: 2 }, cells),
  ])
  const restored = new FileSessionUsageIndex(dir)
  assert.deepEqual(Object.keys(await restored.entries()).sort(), ['s1', 's2'])
})

test('malformed or incompatible index safely falls back to empty state', async () => {
  const dir = await sandbox()
  await writeFile(join(dir, 'session-usage-index.json'), '{broken', 'utf8')
  assert.equal(Object.keys(await new FileSessionUsageIndex(dir).entries()).length, 0)
  await writeFile(join(dir, 'session-usage-index.json'), JSON.stringify({ version: 999, sessions: { s: { cells } } }), 'utf8')
  assert.equal(Object.keys(await new FileSessionUsageIndex(dir).entries()).length, 0)
})

test('a structurally corrupt entry is a cache miss rather than a partial undercount', async () => {
  const dir = await sandbox()
  await writeFile(join(dir, 'session-usage-index.json'), JSON.stringify({
    version: 1,
    sessions: {
      s1: {
        fingerprint: { revision: 'r1' },
        cells: [cells[0], { provider: 'p', model: 'm2', day: '2025-01-02', totals: { outputTokens: 4 }, total: 4 }],
      },
    },
  }), 'utf8')
  assert.equal(await new FileSessionUsageIndex(dir).lookup('s1', { revision: 'r1' }), undefined)
})

test('malformed fingerprint is not treated as an empty matching fingerprint', async () => {
  const dir = await sandbox()
  await writeFile(join(dir, 'session-usage-index.json'), JSON.stringify({
    version: 1,
    sessions: { s1: { fingerprint: { revision: { bad: true } }, cells } },
  }), 'utf8')
  assert.equal(await new FileSessionUsageIndex(dir).lookup('s1', {}), undefined)
})

test('fingerprint changes invalidate stale entries, including appended event count', async () => {
  const dir = await sandbox()
  const index = new FileSessionUsageIndex(dir)
  await index.put('s1', { revision: 'r1', updatedAt: 10, eventCount: 2 }, cells)
  assert.equal(await index.lookup('s1', { revision: 'r2', updatedAt: 10, eventCount: 2 }), undefined)
  assert.equal(await index.lookup('s1', { revision: 'r1', updatedAt: 11, eventCount: 2 }), undefined)
  assert.equal(await index.lookup('s1', { revision: 'r1', updatedAt: 10, eventCount: 3 }), undefined)
})

test('cumulative aggregation preserves totals on index hit and falls back after append', async () => {
  const dir = await sandbox()
  const index = new FileSessionUsageIndex(dir)
  await index.put('s1', { revision: 'r1', eventCount: 1 }, cells)
  const query = {
    async listSessions() { return [{ header: { id: 's1', revision: 'r1', eventCount: 1 } }] },
    async readSession() { throw new Error('index hit should avoid reading') },
  }
  const hit = await aggregateCumulativeUsage(query, undefined, index)
  assert.equal(hit.sessions, 1)
  assert.equal(hit.total, 17)
  let reads = 0
  const fallbackIndex = new FileSessionUsageIndex(dir)
  await fallbackIndex.put('s2', { revision: 'r1', eventCount: 1 }, cells)
  const changedQuery = {
    async listSessions() { return [{ header: { id: 's2', revision: 'r2', eventCount: 2 } }] },
    async readSession() {
      reads++
      return { session: { createdAt: Date.parse('2025-01-02') }, events: [
        { type: 'assistant/message', time: Date.parse('2025-01-02T00:00:00Z'), data: { usage } },
        { type: 'assistant/message', time: Date.parse('2025-01-02T00:01:00Z'), data: { usage } },
      ] }
    },
  }
  const fallback = await aggregateCumulativeUsage(changedQuery, undefined, fallbackIndex)
  assert.equal(reads, 1)
  assert.equal(fallback.total, 34)
})

test('negative cells and total mismatches are rejected instead of cached', async () => {
  const dir = await sandbox()
  const index = new FileSessionUsageIndex(dir)
  await index.put('negative', { revision: 1 }, [{ ...cells[0], totals: { ...cells[0].totals, outputTokens: -1 }, total: 13 }])
  await index.put('mismatch', { revision: 1 }, [{ ...cells[0], total: 18 }])
  assert.equal(await index.lookup('negative', { revision: 1 }), undefined)
  assert.equal(await index.lookup('mismatch', { revision: 1 }), undefined)
})

test('empty fingerprint is always a cache miss', async () => {
  const dir = await sandbox()
  const index = new FileSessionUsageIndex(dir)
  await index.put('empty', {}, cells)
  assert.equal(await index.lookup('empty', {}), undefined)
})

test('leftover temporary index is discarded while primary index remains usable', async () => {
  const dir = await sandbox()
  const index = new FileSessionUsageIndex(dir)
  await index.put('s1', { revision: 1 }, cells)
  await writeFile(join(dir, 'session-usage-index.json.tmp'), '{interrupted', 'utf8')
  const restored = new FileSessionUsageIndex(dir)
  assert.equal((await restored.lookup('s1', { revision: 1 }))[0].total, 17)
  await assert.rejects(readFile(join(dir, 'session-usage-index.json.tmp'), 'utf8'))
})

test('index rejects corrupt cells and returns defensive copies', async () => {
  const dir = await sandbox()
  const index = new FileSessionUsageIndex(dir)
  await index.put('s1', { revision: 1 }, [...cells, { provider: 'bad', model: 'x', day: 'd', totals: { outputTokens: 4 }, total: 4 }])
  assert.equal(await index.lookup('s1', { revision: 1 }), undefined)
  await index.put('s2', { revision: 1 }, cells)
  const found = await index.lookup('s2', { revision: 1 })
  found[0].totals.outputTokens = 999
  assert.equal((await index.lookup('s2', { revision: 1 }))[0].totals.outputTokens, 3)
})

function record(id, revision, eventCount = 1) {
  return { header: { id, revision, eventCount, createdAt: Date.parse('2025-01-02T12:00:00Z') } }
}
function source() {
  return { session: { createdAt: Date.parse('2025-01-02T12:00:00Z') }, events: [
    { type: 'request/header', data: { header: { config: { provider: 'p', model: 'm' } } } },
    { type: 'assistant/message', time: Date.parse('2025-01-02T12:15:00Z'), data: { usage } },
  ] }
}

test('increment reads only new and fingerprint-changed sessions, then persists them', async () => {
  const dir = await sandbox()
  const index = new FileSessionUsageIndex(dir)
  let records = [record('s1', 'r1')]
  const reads = []
  const query = { async listSessions() { return records }, async readSession(id) { reads.push(id); return source() } }
  const first = await incrementSessionUsageIndex(query, index)
  assert.deepEqual({ indexed: first.indexed, skipped: first.skipped, failed: first.failed }, { indexed: 1, skipped: 0, failed: 0 })
  records = [record('s1', 'r1'), record('s2', 'r1')]
  const second = await incrementSessionUsageIndex(query, index)
  assert.deepEqual({ indexed: second.indexed, skipped: second.skipped }, { indexed: 1, skipped: 1 })
  records[0] = record('s1', 'r2', 2)
  const third = await incrementSessionUsageIndex(query, index)
  assert.equal(third.indexed, 1)
  assert.deepEqual(reads, ['s1', 's2', 's1'])
  assert.ok(await index.lookup('s2', { revision: 'r1', eventCount: 1 }))
})

test('increment isolates a failed session and keeps successful writes', async () => {
  const dir = await sandbox()
  const index = new FileSessionUsageIndex(dir)
  const query = {
    async listSessions() { return [record('bad', 'r1'), record('good', 'r1')] },
    async readSession(id) { if (id === 'bad') throw new Error('corrupt log'); return source() },
  }
  const errors = []
  const result = await incrementSessionUsageIndex(query, index, { concurrency: 1, onError: (id) => errors.push(id) })
  assert.deepEqual({ indexed: result.indexed, failed: result.failed, completed: result.completed }, { indexed: 1, failed: 1, completed: 2 })
  assert.deepEqual(errors, ['bad'])
  assert.ok(await index.lookup('good', { revision: 'r1', eventCount: 1 }))
  assert.equal(await index.lookup('bad', { revision: 'r1', eventCount: 1 }), undefined)
})

test('increment invalidates removed sessions and ignores live sessions', async () => {
  const dir = await sandbox()
  const index = new FileSessionUsageIndex(dir)
  await index.put('removed', { revision: 'old', eventCount: 1 }, cells)
  let reads = []
  const query = {
    async listSessions() { return [{ ...record('live', 'r1'), live: true }, record('kept', 'r1')] },
    async readSession(id) { reads.push(id); return source() },
  }
  const result = await incrementSessionUsageIndex(query, index)
  assert.equal(result.removed, 1)
  assert.deepEqual(reads, ['kept'])
  assert.equal(await index.lookup('removed', { revision: 'old', eventCount: 1 }), undefined)
  assert.equal(await index.lookup('live', { revision: 'r1', eventCount: 1 }), undefined)
  assert.ok(await index.lookup('kept', { revision: 'r1', eventCount: 1 }))
})

test('resolves the DSH home instead of the operating-system home', () => {
  assert.equal(resolveDshHome({ DSH_HOME: ' C:/custom-dsh ' }), 'C:/custom-dsh')
  assert.match(resolveDshHome({ DSH_HOME: '   ' }), /[\\/]\.dsh$/)
  assert.match(resolveDshHome({}), /[\\/]\.dsh$/)
})

test('empty explicit build persists readiness marker', async () => {
  const dir = await sandbox()
  const index = new FileSessionUsageIndex(dir)
  const { buildSessionUsageIndex } = await import('../src/usage.ts')
  const result = await buildSessionUsageIndex({ async listSessions() { return [] } }, index)
  assert.equal(result.completed, 0)
  assert.equal(await index.isPersisted(), true)
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'session-usage-index.json'), 'utf8')), { version: 1, sessions: {} })
})

test('repeated increment calls do not double count cumulative usage', async () => {
  const dir = await sandbox()
  const index = new FileSessionUsageIndex(dir)
  const records = [record('s1', 'r1')]
  let reads = 0
  const query = {
    async listSessions() { return records },
    async readSession() { reads++; return source() },
  }
  await incrementSessionUsageIndex(query, index)
  const repeat = await incrementSessionUsageIndex(query, index)
  assert.equal(repeat.indexed, 0)
  assert.equal(repeat.skipped, 1)
  const cumulative = await aggregateCumulativeUsage(query, undefined, index)
  assert.equal(cumulative.total, 17)
  assert.equal(reads, 1)
})
