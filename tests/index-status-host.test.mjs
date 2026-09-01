import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../src/index.ts'
import { baselineDir } from '../src/baseline.ts'
import { FileSessionUsageIndex } from '../src/session-usage-index.ts'
import { FileHourlyTrendIndex, hourlyTrendIndexPath } from '../src/hourly-trend-index.ts'

const totals = { uncachedInputTokens: 2, outputTokens: 3, cacheReadTokens: 5, cacheWriteTokens: 7 }

function response() {
  let statusCode = 0
  let body
  return {
    target: {
      writeHead(code) { statusCode = code },
      end(raw) { body = JSON.parse(raw) },
    },
    result() { return { statusCode, body } },
  }
}

async function call(route, method = 'GET', url = route.path) {
  const res = response()
  await route.handler({ method, url }, res.target)
  return res.result()
}

test('panel status and lifetime GETs are pure snapshots with no session scan', async () => {
  const home = await mkdtemp(join(tmpdir(), 'token-pet-ready-host-'))
  const priorHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const fingerprint = { revision: 'stable-r1', eventCount: 2 }
    const index = new FileSessionUsageIndex(baselineDir(home))
    await index.put('closed-stable', fingerprint, [{
      provider: 'p', model: 'm', day: '2025-01-02', totals, total: 17,
    }])

    let headerLists = 0
    let historyReads = 0
    const query = {
      async listSessions() {
        headerLists++
        return [{ header: { id: 'closed-stable', ...fingerprint, createdAt: 1 }, live: false }]
      },
      async readSession() {
        historyReads++
        throw new Error('ready status must never open historical session logs')
      },
    }
    const routes = new Map()
    const webServer = { register(route) { routes.set(route.path, route); return () => routes.delete(route.path) } }
    const webCtx = {
      get(name) { return name === 'webServer' ? webServer : name === 'sessionQuery' ? query : undefined },
      effect(start) { return start() },
    }
    apply({ inject(_deps, start) { start(webCtx) }, get() { return undefined } })

    const statusRoute = routes.get('/token-pet/index/status')
    const lifetimeRoute = routes.get('/token-pet/usage/lifetime')
    const buildRoute = routes.get('/token-pet/index/build')
    assert.ok(statusRoute)
    assert.ok(lifetimeRoute)
    assert.ok(buildRoute)

    const firstOpen = await call(statusRoute)
    const secondOpen = await call(statusRoute)
    const lifetime = await call(lifetimeRoute)
    assert.equal(firstOpen.statusCode, 200)
    assert.equal(firstOpen.body.status, 'ready')
    assert.equal(secondOpen.body.status, 'ready')
    assert.equal(lifetime.statusCode, 200)
    assert.equal(headerLists, 0, 'panel GETs must not enumerate session headers')
    assert.equal(historyReads, 0, 'panel GETs must never open historical session logs')

    const forbiddenBuild = await call(buildRoute, 'POST')
    assert.equal(forbiddenBuild.statusCode, 409)
    assert.match(forbiddenBuild.body.error, /usable index already exists/)
    assert.equal(historyReads, 0, 'persisted readiness rejects a full build without reading logs')
  } finally {
    if (priorHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = priorHome
  }
})

test('background coordinator owns maintenance while panel GET routes stay pure', () => {
  const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
  const statusStart = source.indexOf("path: '/token-pet/index/status'")
  const statusEnd = source.indexOf("path: '/token-pet/index/build'", statusStart)
  const lifetimeStart = source.indexOf("path: '/token-pet/usage/lifetime'")
  const lifetimeEnd = source.indexOf("path: '/token-pet/usage/lifetime/clear-history'", lifetimeStart)
  const statusBlock = source.slice(statusStart, statusEnd)
  const lifetimeBlock = source.slice(lifetimeStart, lifetimeEnd)
  assert.doesNotMatch(statusBlock, /indexInspection\.(inspect|refresh)\(/)
  assert.doesNotMatch(lifetimeBlock, /lifetimeLedger\.refresh\(/)
  assert.match(source, /INDEX_SYNC_STARTUP_DELAY_MS = 5_000/)
  assert.match(source, /INDEX_SYNC_FALLBACK_MS = 5 \* 60_000/)
  assert.match(source, /indexScheduler\.notify\?\.\(\)/)
  assert.match(source, /LIFETIME_REFRESH_THROTTLE_MS = 60_000/)
})

test('today trend reopen and explicit refresh never traverse session history', async () => {
  const home = await mkdtemp(join(tmpdir(), 'token-pet-trend-host-'))
  const priorHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    let headerLists = 0
    let liveReads = 0
    const now = Date.now()
    const query = {
      async listSessions() {
        headerLists++
        return [{ header: { id: 'live-current', createdAt: now - 1_000 }, live: true }]
      },
      async readSession() {
        liveReads++
        return { session: { createdAt: now - 1_000 }, events: [
          { type: 'request/header', data: { header: { config: { provider: 'p', model: 'm' } } } },
          { type: 'turn/end', time: now - 500, data: { usage: { inputTokens: 2, outputTokens: 3 } } },
        ] }
      },
    }
    const routes = new Map()
    const webServer = { register(route) { routes.set(route.path, route); return () => routes.delete(route.path) } }
    const webCtx = {
      get(name) { return name === 'webServer' ? webServer : name === 'sessionQuery' ? query : undefined },
      effect(start) { return start() },
    }
    apply({ inject(_deps, start) { start(webCtx) }, get() { return undefined } })
    const trendRoute = routes.get('/token-pet/usage/trend')
    const statusRoute = routes.get('/token-pet/usage/trend/status')
    assert.ok(trendRoute); assert.ok(statusRoute)

    const status = await call(statusRoute, 'GET', '/token-pet/usage/trend/status')
    assert.equal(status.statusCode, 200)
    assert.equal(status.body.snapshotOnly, true)
    const cold = await call(trendRoute, 'GET', '/token-pet/usage/trend?timeZone=UTC')
    assert.equal(cold.body.total, 0)
    const reopen = await call(trendRoute, 'GET', '/token-pet/usage/trend?timeZone=UTC')
    assert.equal(reopen.body.total, 0)
    const refreshed = await call(trendRoute, 'GET', '/token-pet/usage/trend?timeZone=UTC')
    assert.equal(refreshed.body.total, 0)
    assert.equal(headerLists, 0, 'panel reads must never enumerate sessions')
    assert.equal(liveReads, 0, 'manual refresh must never reread a transcript')
  } finally {
    if (priorHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = priorHome
  }
})

test('trend maintenance status is snapshot-only and explicit rebuild can be cancelled', async () => {
  const home = await mkdtemp(join(tmpdir(), 'token-pet-trend-maintenance-'))
  const priorHome = process.env.DSH_HOME; process.env.DSH_HOME = home
  try {
    const now = Date.now(); const file = hourlyTrendIndexPath(baselineDir(home))
    const events = [
      { seq: 0, type: 'request/header', time: now, data: { header: { config: { provider: 'p', model: 'm' } } } },
      { seq: 1, type: 'turn/end', time: now, data: { turn: 1, step: 1, usage: { inputTokens: 4 } } },
    ]
    await new FileHourlyTrendIndex(file, () => now).replaceAll([{ sessionId: 's1', revision: 'r1', events }])
    let releaseRead; let readStarted
    const started = new Promise(resolve => { readStarted = resolve })
    const gate = new Promise(resolve => { releaseRead = resolve })
    let historyReads = 0
    const persistence = {
      async listSnapshots() { return [{ header: { id: 's1' }, revision: 'r1' }] },
      async readFrom() { historyReads++; readStarted(); await gate; return { meta: {}, events } },
    }
    const routes = new Map()
    const webServer = { register(route) { routes.set(route.path, route); return () => routes.delete(route.path) } }
    const query = { async listSessions() { throw new Error('status listed session headers') }, async readSession() { throw new Error('status read history') } }
    const scoped = services => ({ get(name) { return services[name] }, effect(start) { return start() }, on() { return () => {} } })
    apply({ inject(deps, start) {
      if (deps.includes('sessionPersistence')) start(scoped({ sessionPersistence: persistence }))
      else if (deps.includes('webServer')) start(scoped({ webServer, sessionQuery: query }))
    }, get() { return undefined } })
    await new Promise(resolve => setTimeout(resolve, 20))

    const statusRoute = routes.get('/token-pet/usage/trend/status')
    const repairRoute = routes.get('/token-pet/usage/trend/repair')
    const cancelRoute = routes.get('/token-pet/usage/trend/repair/cancel')
    assert.ok(statusRoute); assert.ok(repairRoute); assert.ok(cancelRoute)
    const idle = await call(statusRoute)
    assert.equal(idle.body.health, 'ready')
    assert.equal(idle.body.operation, 'idle')
    assert.equal(idle.body.updatedAt, now)
    assert.equal(idle.body.snapshotOnly, true)
    assert.equal(historyReads, 0, 'ordinary maintenance status must not read history')

    assert.equal((await call(repairRoute, 'POST')).statusCode, 202)
    await started
    const running = await call(statusRoute)
    assert.equal(running.body.operation, 'rebuilding')
    assert.equal(running.body.cancelSupported, true)
    assert.equal((await call(cancelRoute, 'POST')).statusCode, 202)
    releaseRead()
    for (let i = 0; i < 20; i++) {
      await new Promise(resolve => setTimeout(resolve, 5))
      if ((await call(statusRoute)).body.operation === 'idle') break
    }
    const cancelled = await call(statusRoute)
    assert.equal(cancelled.body.operation, 'idle')
    assert.equal(cancelled.body.lastResult, 'cancelled')
    assert.equal(historyReads, 1, 'only the explicit rebuild may open history')
  } finally {
    if (priorHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = priorHome
  }
})

test('durable flush is awaited and Host restart reconciles only a changed suffix', async () => {
  const home = await mkdtemp(join(tmpdir(), 'token-pet-trend-crash-'))
  const priorHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const file = hourlyTrendIndexPath(baselineDir(home))
    const now = Date.now()
    await new FileHourlyTrendIndex(file).replaceAll([{ sessionId: 's1', revision: 'r1', events: [
      { seq: 0, type: 'request/header', time: now, data: { header: { config: { provider: 'p', model: 'm' } } } },
      { seq: 1, type: 'turn/end', time: now, data: { turn: 1, step: 1, usage: { inputTokens: 4 } } },
    ] }])
    let revision = 'r1'
    let tailReads = 0
    const durableEvents = [
      { seq: 0, type: 'request/header', time: now, data: { header: { config: { provider: 'p', model: 'm' } } } },
      { seq: 1, type: 'turn/end', time: now, data: { turn: 1, step: 1, usage: { inputTokens: 4 } } },
    ]
    const persistence = {
      async listSnapshots() { return [{ header: { id: 's1' }, revision }] },
      async readFrom(_id, from) { tailReads++; return { meta: {}, events: durableEvents.filter(event => event.seq >= from) } },
    }
    const routes = new Map(); const listeners = new Map()
    const webServer = { register(route) { routes.set(route.path, route); return () => routes.delete(route.path) } }
    const query = { async listSessions() { throw new Error('trend GET listed sessions') }, async readSession() { throw new Error('trend GET read history') } }
    const scoped = services => ({ get(name) { return services[name] }, effect(start) { return start() }, on(name, callback) { listeners.set(name, callback); return () => listeners.delete(name) } })
    apply({
      inject(deps, start) {
        if (deps.includes('sessionPersistence')) start(scoped({ sessionPersistence: persistence }))
        else if (deps.includes('webServer')) start(scoped({ webServer, sessionQuery: query }))
      },
      get() { return undefined },
    })
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(tailReads, 0, 'matching startup revision performs no event read')

    // The flush listener returns a real promise and waits until source revision
    // changes before checkpointing the buffered event.
    listeners.get('session/event')({ id: 's1' }, { seq: 2, type: 'turn/end', time: now, data: { turn: 2, step: 1, usage: { outputTokens: 3 } } })
    let flushSettled = false
    const flushPromise = listeners.get('session/flush')({ id: 's1' }).then(() => { flushSettled = true })
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(flushSettled, false, 'trend checkpoint cannot lead the durable source revision')
    durableEvents.push({ seq: 2, type: 'turn/end', time: now, data: { turn: 2, step: 1, usage: { outputTokens: 3 } } })
    revision = 'r2'
    await flushPromise
    assert.equal((await new FileHourlyTrendIndex(file).trend('UTC', now)).total, 7)

    // Simulate a later durable suffix that missed the trend checkpoint before a crash.
    durableEvents.push({ seq: 3, type: 'turn/end', time: now, data: { turn: 3, step: 1, usage: { outputTokens: 5 } } })
    revision = 'r3'
    // A second apply simulates Host restart against the same durable index file.
    apply({
      inject(deps, start) {
        if (deps.includes('sessionPersistence')) start(scoped({ sessionPersistence: persistence }))
        else if (deps.includes('webServer')) start(scoped({ webServer, sessionQuery: query }))
      },
      get() { return undefined },
    })
    for (let i = 0; i < 30; i++) {
      await new Promise(resolve => setTimeout(resolve, 5))
      if ((await new FileHourlyTrendIndex(file).trend('UTC', now)).total === 12) break
    }
    assert.equal((await new FileHourlyTrendIndex(file).trend('UTC', now)).total, 12)
    assert.equal(tailReads, 1, 'changed revision reads exactly one anchored suffix')
  } finally {
    if (priorHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = priorHome
  }
})

test('a new session whose baseline already sees the durable revision verifies cursor zero without waiting', async () => {
  const home = await mkdtemp(join(tmpdir(), 'token-pet-trend-new-session-race-'))
  const priorHome = process.env.DSH_HOME; process.env.DSH_HOME = home
  try {
    const now = Date.now(); const file = hourlyTrendIndexPath(baselineDir(home))
    await new FileHourlyTrendIndex(file).replaceAll([])
    let present = false
    const events = [
      { seq: 0, type: 'request/header', time: now, data: { header: { config: { provider: 'p', model: 'm' } } } },
      { seq: 1, type: 'turn/end', time: now, data: { turn: 1, step: 1, usage: { inputTokens: 5 } } },
    ]
    const persistence = {
      async listSnapshots() { return present ? [{ header: { id: 'new' }, revision: 'r1' }] : [] },
      async readFrom(_id, from) { return { meta: {}, events: events.filter(event => event.seq >= from) } },
    }
    const listeners = new Map()
    const scoped = services => ({ get(name) { return services[name] }, effect(start) { return start() }, on(name, callback) { listeners.set(name, callback); return () => listeners.delete(name) } })
    apply({ inject(deps, start) {
      if (deps.includes('sessionPersistence')) start(scoped({ sessionPersistence: persistence }))
      else if (deps.includes('webServer')) start(scoped({ webServer: { register() { return () => {} } }, sessionQuery: { async listSessions() { return [] }, async readSession() { return { events: [] } } } }))
    }, get() { return undefined } })
    await new Promise(resolve => setTimeout(resolve, 20))
    present = true
    for (const event of events) listeners.get('session/event')({ id: 'new' }, event)
    await Promise.race([listeners.get('session/flush')({ id: 'new' }), new Promise((_, reject) => setTimeout(() => reject(new Error('new-session flush waited for r2')), 500))])
    assert.equal((await new FileHourlyTrendIndex(file).trend('UTC', now)).total, 5)
  } finally {
    if (priorHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = priorHome
  }
})

test('startup reconciliation absorbing a pending event does not wait for a fictitious revision', async () => {
  const home = await mkdtemp(join(tmpdir(), 'token-pet-trend-reconcile-race-'))
  const priorHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const now = Date.now(); const file = hourlyTrendIndexPath(baselineDir(home))
    const prefix = [
      { seq: 0, type: 'request/header', time: now, data: { header: { config: { provider: 'p', model: 'm' } } } },
      { seq: 1, type: 'turn/end', time: now, data: { turn: 1, step: 1, usage: { inputTokens: 4 } } },
    ]
    const appended = { seq: 2, type: 'turn/end', time: now, data: { turn: 2, step: 1, usage: { outputTokens: 3 } } }
    await new FileHourlyTrendIndex(file).replaceAll([{ sessionId: 's1', revision: 'r1', events: prefix }])
    let releaseRead; let signalRead
    const readStarted = new Promise(resolve => { signalRead = resolve })
    const readGate = new Promise(resolve => { releaseRead = resolve })
    const persistence = {
      async listSnapshots() { return [{ header: { id: 's1' }, revision: 'r2' }] },
      async readFrom(_id, from) { signalRead(); await readGate; return { meta: {}, events: [...prefix, appended].filter(event => event.seq >= from) } },
    }
    const listeners = new Map(); const routes = new Map()
    const scoped = services => ({ get(name) { return services[name] }, effect(start) { return start() }, on(name, callback) { listeners.set(name, callback); return () => listeners.delete(name) } })
    apply({
      inject(deps, start) {
        if (deps.includes('sessionPersistence')) start(scoped({ sessionPersistence: persistence }))
        else if (deps.includes('webServer')) start(scoped({ webServer: { register(route) { routes.set(route.path, route); return () => {} } }, sessionQuery: { async listSessions() { return [] }, async readSession() { throw new Error('unused') } } }))
      },
      get() { return undefined },
    })
    await readStarted
    listeners.get('session/event')({ id: 's1' }, appended)
    const flushPromise = listeners.get('session/flush')({ id: 's1' })
    releaseRead()
    await Promise.race([flushPromise, new Promise((_, reject) => setTimeout(() => reject(new Error('flush waited for nonexistent r3')), 500))])
    assert.equal((await new FileHourlyTrendIndex(file).trend('UTC', now)).total, 7)
  } finally {
    if (priorHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = priorHome
  }
})
