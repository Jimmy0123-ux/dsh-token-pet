import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { apply } from '../src/index.ts'
import { baselineDir } from '../src/baseline.ts'
import { FileSessionUsageIndex } from '../src/session-usage-index.ts'

async function call(routes, path, method = 'GET') {
  let code, body
  await routes.get(path).handler({ method, url: path }, {
    writeHead(value) { code = value },
    end(value) { body = JSON.parse(value) },
  })
  assert.ok(code < 400, JSON.stringify(body))
  return body
}

async function eventually(read, accept) {
  let value
  for (let i = 0; i < 100; i++) {
    value = await read()
    if (accept(value)) return value
    await delay(10)
  }
  assert.fail(`background work did not converge: ${JSON.stringify(value)}`)
}

async function harness(t) {
  const home = await mkdtemp(join(tmpdir(), 'token-pet-bootstrap-'))
  const priorHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: Date.now() })
  const routes = new Map(), listeners = new Map(), disposers = []
  const reads = []
  const records = [
    { header: { id: 'historical', createdAt: 1, revision: 'old' }, live: false },
    { header: { id: 'current', createdAt: 1, revision: 'r1' }, live: true },
  ]
  let amount = 5, lists = 0, failCurrent = false, onRead
  const query = {
    async listSessions() { lists++; return records.map(record => ({ ...record, header: { ...record.header } })) },
    async readSession(id) {
      reads.push(id)
      if (id === 'current' && failCurrent) throw new Error('temporary read failure')
      const inputTokens = id === 'historical' ? 100 : amount
      await onRead?.(id)
      return { session: { createdAt: 1 }, events: [
        { type: 'request/header', data: { header: { config: { provider: 'p', model: 'm' } } } },
        { type: 'turn/end', time: Date.now(), data: { usage: { inputTokens } } },
      ] }
    },
  }
  // Empty trend persistence keeps this fixture focused on the Lifetime coordinator.
  const persistence = { async listSnapshots() { return [] }, async readFrom() { return { events: [] } } }
  const webServer = { register(route) { routes.set(route.path, route); return () => routes.delete(route.path) } }
  apply({
    inject(deps, start) {
      const services = deps.includes('sessionPersistence') ? { sessionPersistence: persistence } : { webServer, sessionQuery: query }
      start({
        get(name) { return services[name] },
        effect(start) { const dispose = start(); if (dispose) disposers.push(dispose) },
        on(name, fn) { listeners.set(name, fn); return () => listeners.delete(name) },
      })
    },
    get() { return undefined },
  })
  const dispose = () => { for (const stop of disposers.splice(0).reverse()) stop() }
  t.after(async () => {
    dispose()
    t.mock.timers.reset()
    if (priorHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = priorHome
    await rm(home, { recursive: true, force: true })
  })
  return {
    routes, records, reads, home, listeners, dispose,
    get lists() { return lists },
    set amount(value) { amount = value },
    set failCurrent(value) { failCurrent = value },
    set onRead(value) { onRead = value },
    usage: () => call(routes, '/token-pet/usage/lifetime'),
    status: () => call(routes, '/token-pet/index/status'),
  }
}

test('fresh install credits live usage without building or scanning historical logs', async t => {
  const h = await harness(t)
  assert.equal((await h.usage()).total, 0)
  await h.status()
  assert.equal(h.lists, 0, 'GET routes must remain pure snapshots')
  t.mock.timers.tick(5_000)
  await eventually(h.usage, usage => usage.total === 5 && !usage.refreshing)
  await eventually(h.status, status => !status.syncing)
  assert.deepEqual(h.reads, ['current'])
  assert.equal(await new FileSessionUsageIndex(baselineDir(h.home)).isPersisted(), false)
  const before = h.lists
  await h.usage(); await h.status()
  assert.equal(h.lists, before, 'reopening the panel must not trigger maintenance')

  // A normal explicit backfill must still include old logs and not credit the live one twice.
  await call(h.routes, '/token-pet/index/build', 'POST')
  await eventually(h.usage, usage => usage.total === 105)
  await eventually(h.status, status => !status.building && !status.syncing)
  assert.equal(h.reads.filter(id => id === 'historical').length, 1)
})

test('a session closed before bootstrap is credited after its durability fence, with bounded retry', async t => {
  const h = await harness(t)
  h.records[1].live = false
  h.failCurrent = true
  await h.listeners.get('session/disposed')({ id: 'current' })
  t.mock.timers.tick(1_500)
  await eventually(async () => ({ usage: await h.usage(), reads: h.reads.length }), value => value.usage.refreshFailed === 1 || value.reads > 0)
  // Let the failed refresh install its retry timer before advancing time.
  await delay(30)
  assert.equal((await h.usage()).total, 0)
  assert.ok(!h.reads.includes('historical'))
  h.failCurrent = false
  t.mock.timers.tick(60_000)
  await eventually(h.usage, usage => usage.total === 5 && !usage.refreshing)
  await eventually(h.status, status => !status.syncing)
  // A startup pass merged with the retry may leave a trailing debounce.
  t.mock.timers.tick(1_500)
  await delay(30)
  assert.ok(!h.reads.includes('historical'), 'retry must not broaden into a history backfill')

  h.amount = 9
  h.records[1].header.revision = 'r2'
  await h.listeners.get('session/flush')({ id: 'current' })
  t.mock.timers.tick(60_000)
  await eventually(h.usage, usage => usage.total === 9)
  assert.equal(await new FileSessionUsageIndex(baselineDir(h.home)).isPersisted(), false)
})

test('a newer closed-session fence arriving during refresh survives the completed generation', async t => {
  const h = await harness(t)
  h.records[1].live = false
  let release
  const gate = new Promise(resolve => { release = resolve })
  h.onRead = () => gate
  // Run the startup timer before the deliberately blocked request so it cannot
  // introduce an unrelated trailing pass when we advance the clock later.
  t.mock.timers.tick(5_000)
  await eventually(h.usage, usage => !usage.refreshing && h.lists > 0)
  await eventually(h.status, status => !status.syncing)
  t.mock.timers.tick(60_000)
  await h.listeners.get('session/flush')({ id: 'current' })
  t.mock.timers.tick(1_500)
  await eventually(async () => h.reads.length, count => count === 1)
  h.amount = 9
  h.records[1].header.revision = 'r2'
  await h.listeners.get('session/disposed')({ id: 'current' })
  h.onRead = undefined
  release()
  await eventually(h.usage, usage => usage.total === 5 && !usage.refreshing)
  await eventually(h.status, status => !status.syncing)
  t.mock.timers.tick(1_500)
  await eventually(h.status, status => !status.syncing)
  t.mock.timers.tick(60_000)
  await eventually(h.usage, usage => usage.total === 9 && !usage.refreshing)
  assert.deepEqual(h.reads, ['current', 'current'])
})

test('a fence joining a detached retry schedules the newer generation after that retry settles', async t => {
  const h = await harness(t)
  h.failCurrent = true
  t.mock.timers.tick(5_000)
  await eventually(h.usage, usage => usage.refreshFailed === 1 && !usage.refreshing)
  await eventually(h.status, status => !status.syncing)
  h.records[1].live = false
  await h.listeners.get('session/flush')({ id: 'current' })
  t.mock.timers.tick(1_500)
  await eventually(h.status, status => !status.syncing)

  let release
  const gate = new Promise(resolve => { release = resolve })
  h.failCurrent = false
  h.onRead = () => gate
  t.mock.timers.tick(60_000)
  await eventually(async () => h.reads.length, count => count === 2)
  h.amount = 9
  h.records[1].header.revision = 'r2'
  await h.listeners.get('session/disposed')({ id: 'current' })
  t.mock.timers.tick(1_500)
  await eventually(h.status, status => status.syncing)
  h.onRead = undefined
  release()
  await eventually(h.usage, usage => usage.total === 5 && !usage.refreshing)
  await eventually(h.status, status => !status.syncing)
  t.mock.timers.tick(1_500)
  await eventually(h.status, status => !status.syncing)
  t.mock.timers.tick(60_000)
  await eventually(h.usage, usage => usage.total === 9 && !usage.refreshing)
  assert.ok(h.reads.every(id => id === 'current'))
})

test('disposing the host during a failed bootstrap does not rearm background retries', async t => {
  const h = await harness(t)
  let release
  const gate = new Promise(resolve => { release = resolve })
  h.onRead = async () => { await gate; throw new Error('read failed after disposal') }
  t.mock.timers.tick(5_000)
  await eventually(async () => h.reads.length, count => count === 1)
  h.dispose()
  release()
  await delay(30)
  t.mock.timers.tick(5 * 60_000)
  await delay(30)
  assert.equal(h.reads.length, 1)
  assert.equal(h.lists, 1)
  assert.equal(h.routes.size, 0)
})

test('bootstrap refresh retries stop at the configured budget', async t => {
  const h = await harness(t)
  h.failCurrent = true
  t.mock.timers.tick(5_000)
  await eventually(h.usage, usage => usage.refreshFailed === 1 && !usage.refreshing)
  for (let attempt = 1; attempt <= 3; attempt++) {
    t.mock.timers.tick(60_000)
    await eventually(h.usage, usage => h.reads.length === attempt + 1 && !usage.refreshing)
  }
  t.mock.timers.tick(60_000)
  await delay(30)
  assert.equal(h.reads.length, 4, 'one initial attempt plus three retries before the 5-minute fallback')
  assert.ok(h.reads.every(id => id === 'current'))
})
