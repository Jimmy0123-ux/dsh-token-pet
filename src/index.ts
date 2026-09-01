/**
 * dsh-token-pet host half.
 *
 * The token pet is primarily a browser-half plugin: it reads the framework's
 * real session projections (`contextPressure`, `contextBreakdown`,
 * `tokenUsage`, `sessionStats`, `contextTimeline`) directly from the session
 * scope. The host's one job here is to serve the cross-session cumulative
 * figure and its per-model / per-day breakdown (the "DSH 累计" number that no
 * single-session projection can provide), plus the persistent 清空/恢复 baseline
 * used to zero/recover the running display.
 *
 * Endpoints:
 *   - `GET  /token-pet/usage`    → full aggregate with baseline applied
 *   - `POST /token-pet/usage/reset`   → 清空: zero the display (records offset)
 *   - `POST /token-pet/usage/restore` → 恢复: revert the last 清空
 *
 * Panel GETs never start heavy work. `/usage/lifetime` serves only the durable
 * ledger snapshot, and `/index/status` answers from the persisted index (plus
 * the last single-flight header inspection) without ever waiting on a full
 * session check. All refreshing is owned by a single-flight background
 * coordinator: one startup reconcile 2-5s after boot, merged + debounced
 * incremental syncs after `session/flush` / `session/disposed`, and a
 * low-frequency (5-10 min) fallback. An explicit `POST /index/sync` still
 * forces an immediate incremental sync and reports progress. Every coordinator
 * timer and event listener is disposed with its owning ctx effect.
 *
 * Mounted on a webServer sub-fiber so a headless host degrades gracefully.
 * Install into a profile with `dsh plugin --profile <name> add link:<this dir>`.
 * @module dsh-token-pet
 */

import type { Context } from '@deepseek-ai/cordis'
import { readFile } from 'node:fs/promises'

import { FileBaselineStore, baselineDir, resolveDshHome, type BaselineService } from './baseline.js'
import { aggregateCumulativeUsage, buildSessionUsageIndex, incrementSessionUsageIndex, inspectSessionUsageIndex, type CumulativeUsage, type SessionQueryService, type UsageBuckets, type UsageIndexBuildProgress, type UsageIndexBuildResult, type UsageIndexIncrementResult, type UsageIndexInspection } from './usage.js'
import { FileSessionUsageIndex, sessionUsageIndexPath } from './session-usage-index.js'
import { deriveTokenPetIndexState, type TokenPetIndexOperation, type TokenPetIndexTerminal } from './index-contract.js'
import { FileLifetimeLedger, lifetimeLedgerPath } from './lifetime-ledger.js'
import { LIFETIME_CLEAR_CONFIRMATION } from './lifetime-contract.js'
import { resolvePromptRoute } from './prompt-route.js'
import { StaleWhileRevalidate } from './stale-cache.js'
import { FileHourlyTrendIndex, trendRevisionKey, type SequencedUsageEvent, type TrendPersistenceService } from './hourly-trend-index.js'

// Public pure state machines used by the client and tests.
export * from './growth.js'
export * from './session-usage-index.js'
export * from './lifetime-ledger.js'
export * from './index-contract.js'
export * from './hourly-trend-index.js'

export const name = 'dsh-token-pet'

/** The twelve production actions; the same set the client registry covers. */
const STRIP_ACTIONS = [
  'idle', 'working', 'eating', 'digesting', 'warning', 'evolve',
  'click', 'archive', 'tool-success', 'tool-failure', 'prompt-enhancing', 'prompt-ready',
] as const

/** The browser half needs the slot registry; the host half needs webServer + session-query. */
export const inject: string[] = []

interface WebRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler(req: unknown, res: unknown): void
}

/** Optional host-provided model adapter; Token Pet never owns credentials. */
interface PromptEnhancerService {
  enhance(request: { prompt: string; template?: string; provider?: string; model?: string }): Promise<string | { enhanced: string; model?: string }>
}

interface LlmService {
  listProviders?(): Array<{ id: string }>
  listModels?(provider: string): Promise<Array<{ id: string }>>
  stream(options: Record<string, unknown>): AsyncIterable<{ type?: string; text?: string; reason?: { kind?: string; failure?: { message?: string } } }>
}

interface DefaultModelService {
  currentSelection?(): { provider?: string; model?: string }
}

function readJsonBody(req: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const r = req as { on?(ev: string, cb: (c: unknown) => void): void }
    if (typeof r?.on !== 'function') {
      resolve({})
      return
    }
    let data = ''
    r.on('data', (c) => { data += String(c) })
    r.on('end', () => {
      try { resolve(JSON.parse(data || '{}')) } catch { resolve({}) }
    })
  })
}

/** Subtract active baseline offsets from a raw per-(model,day) cell. */
function applyBaseline(
  rawCells: Array<{ provider: string; model: string; day: string; totals: UsageBuckets; total: number }>,
  offsets: Record<string, number>,
): Array<{ provider: string; model: string; day: string; totals: UsageBuckets; total: number }> {
  return rawCells.map((cell) => {
    const key = `${cell.provider}\u0000${cell.model}\u0000${cell.day}`
    const offset = offsets[key] ?? 0
    const remaining = Math.max(0, cell.total - offset)
    // Scale the buckets proportionally to the remaining total so the
    // per-bucket breakdown stays consistent with the headline number.
    const ratio = cell.total > 0 ? remaining / cell.total : 0
    return {
      ...cell,
      totals: {
        uncachedInputTokens: Math.round(cell.totals.uncachedInputTokens * ratio),
        outputTokens: Math.round(cell.totals.outputTokens * ratio),
        cacheReadTokens: Math.round(cell.totals.cacheReadTokens * ratio),
        cacheWriteTokens: Math.round(cell.totals.cacheWriteTokens * ratio),
      },
      total: remaining,
    }
  })
}

/**
 * Host plugin body. Registers the usage endpoints.
 * @param ctx - cordis context that owns this plugin fiber.
 */
export function apply(ctx: Context): void {
  const home = resolveDshHome()
  const hourlyTrend = FileHourlyTrendIndex.at(baselineDir(home))
  const trendPending = new Map<string, SequencedUsageEvent[]>()
  let trendFlushFlight: Promise<void> | undefined
  let trendRebuildFlight: Promise<void> | undefined
  let trendReconcileFlight: Promise<void> | undefined
  let trendRebuildController: AbortController | undefined
  const trendRepairFlights = new Map<string, Promise<void>>()
  const trendRepairRetries = new Map<string, ReturnType<typeof setTimeout>>()
  const trendBaselineRevisions = new Map<string, Promise<string | undefined>>()
  let trendReconcileRetry: ReturnType<typeof setTimeout> | undefined
  let trendPersistence: TrendPersistenceService | undefined
  let trendMaintenanceResult: 'completed' | 'cancelled' | 'failed' | undefined
  let trendMaintenanceError: string | undefined

  const flushTrendEvents = (sessionId: string, revision: unknown): Promise<void> => {
    if (trendRebuildFlight) return trendRebuildFlight.then(() => flushTrendEvents(sessionId, revision))
    if (trendReconcileFlight) return trendReconcileFlight.then(() => flushTrendEvents(sessionId, revision))
    if (trendFlushFlight) return trendFlushFlight.then(() => flushTrendEvents(sessionId, revision))
    const events = trendPending.get(sessionId) ?? []
    trendPending.delete(sessionId)
    const promise = hourlyTrend.applyEvents(sessionId, events, false, revision).then(result => {
      if (result.repairFrom !== undefined) scheduleTrendRepair(sessionId, result.repairFrom)
    }).catch(async error => {
      const current = trendPending.get(sessionId) ?? []
      trendPending.set(sessionId, [...events, ...current])
      const checkpoint = await hourlyTrend.checkpoint(sessionId)
      scheduleTrendRepair(sessionId, checkpoint?.nextSeq ?? 0)
      throw error
    }).finally(() => { if (trendFlushFlight === promise) trendFlushFlight = undefined })
    trendFlushFlight = promise
    return promise
  }

  const durableRevision = async (persistence: TrendPersistenceService, sessionId: string, previous?: string): Promise<unknown> => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const snapshot = (await persistence.listSnapshots()).find(item => item.header.id === sessionId)
      if (snapshot && (previous === undefined || trendRevisionKey(snapshot.revision) !== previous)) return snapshot.revision
      await new Promise<void>(resolve => setTimeout(resolve, 10))
    }
    throw new Error(`session ${sessionId} did not reach a new durable revision`)
  }

  const flushAfterDurableFence = async (sessionId: string): Promise<void> => {
    if (!trendPersistence) return
    if (trendReconcileFlight) await trendReconcileFlight
    const pending = trendPending.get(sessionId) ?? []
    const checkpoint = await hourlyTrend.checkpoint(sessionId)
    const maxPendingSeq = pending.reduce((max, event) => typeof event.seq === 'number' ? Math.max(max, event.seq) : max, -1)
    // Startup reconciliation may already have folded the exact durable events
    // buffered by session/event. Never wait for a fictitious next revision.
    if (checkpoint && maxPendingSeq >= 0 && maxPendingSeq < checkpoint.nextSeq) {
      trendPending.delete(sessionId); trendBaselineRevisions.delete(sessionId); return
    }
    let previous = checkpoint?.revision ?? await trendBaselineRevisions.get(sessionId)
    if (!checkpoint) {
      // A brand-new session may not have existed when its baseline snapshot was
      // sampled. Verify its durable prefix once from cursor zero instead of
      // assuming the first visible revision is either old or new.
      const snapshot = (await trendPersistence.listSnapshots()).find(item => item.header.id === sessionId)
      if (snapshot) {
        const durable = await trendPersistence.readFrom(sessionId, 0)
        const durableMax = durable.events.reduce((max, event) => typeof event.seq === 'number' ? Math.max(max, event.seq) : max, -1)
        if (durableMax >= maxPendingSeq) {
          await hourlyTrend.applyEvents(sessionId, durable.events, true, snapshot.revision)
          trendPending.delete(sessionId); trendBaselineRevisions.delete(sessionId); return
        }
        previous = trendRevisionKey(snapshot.revision)
      }
    }
    const revision = await durableRevision(trendPersistence, sessionId, previous)
    await flushTrendEvents(sessionId, revision)
    trendBaselineRevisions.delete(sessionId)
  }
  function scheduleTrendRepair(sessionId: string, fromSeq: number): void {
    const persistence = trendPersistence
    if (!persistence || trendRepairFlights.has(sessionId) || trendRebuildFlight) return
    const retry = trendRepairRetries.get(sessionId); if (retry) { clearTimeout(retry); trendRepairRetries.delete(sessionId) }
    const anchorFrom = Math.max(0, fromSeq - 1)
    trendMaintenanceResult = undefined; trendMaintenanceError = undefined
    const promise = (async () => {
      const snapshot = (await persistence.listSnapshots()).find(item => item.header.id === sessionId)
      if (!snapshot) { await hourlyTrend.retainSessions(new Set((await persistence.listSnapshots()).map(item => item.header.id))); return }
      const tail = await persistence.readFrom(sessionId, anchorFrom)
      let needsFullRepair = false
      let suffix = tail.events
      if (fromSeq > 0) {
        const anchor = tail.events[0]
        needsFullRepair = anchor?.seq !== fromSeq - 1
        suffix = needsFullRepair ? [] : tail.events.filter(event => typeof event.seq === 'number' && event.seq >= fromSeq)
      }
      const result = needsFullRepair ? { applied: false, repairFrom: 0 } : await hourlyTrend.applyEvents(sessionId, suffix, fromSeq === 0, snapshot.revision)
      if (result.repairFrom !== undefined && fromSeq !== 0) {
        const whole = await persistence.readFrom(sessionId, 0)
        await hourlyTrend.applyEvents(sessionId, whole.events, true, snapshot.revision)
      }
      trendMaintenanceResult = 'completed'
    })().catch(error => {
      trendMaintenanceResult = 'failed'; trendMaintenanceError = error instanceof Error ? error.message : String(error)
      console.warn(`[token-pet] hourly trend repair failed for ${sessionId}:`, trendMaintenanceError)
      if (trendPersistence) trendRepairRetries.set(sessionId, setTimeout(() => { trendRepairRetries.delete(sessionId); scheduleTrendRepair(sessionId, fromSeq) }, 1_000))
    }).finally(() => { if (trendRepairFlights.get(sessionId) === promise) trendRepairFlights.delete(sessionId) })
    trendRepairFlights.set(sessionId, promise)
  }
  const rebuildTrend = (persistence: TrendPersistenceService): Promise<void> => {
    if (trendRebuildFlight) return trendRebuildFlight
    const controller = new AbortController(); trendRebuildController = controller
    trendMaintenanceResult = undefined; trendMaintenanceError = undefined
    const promise = (async () => {
      // First-time/corruption recovery is intentionally detached from both host
      // startup and panel GET response paths. Normal restarts never enter here.
      const snapshots = await persistence.listSnapshots(controller.signal)
      const sources: Array<{ sessionId: string; revision: unknown; events: SequencedUsageEvent[] }> = []
      for (const snapshot of snapshots) {
        controller.signal.throwIfAborted()
        const source = await persistence.readFrom(snapshot.header.id, 0, controller.signal)
        sources.push({ sessionId: snapshot.header.id, revision: snapshot.revision, events: source.events })
        await new Promise<void>(resolve => setImmediate(resolve))
      }
      await hourlyTrend.replaceAll(sources, controller.signal)
      trendMaintenanceResult = 'completed'
    })().catch(error => {
      if (controller.signal.aborted) trendMaintenanceResult = 'cancelled'
      else {
        trendMaintenanceResult = 'failed'; trendMaintenanceError = error instanceof Error ? error.message : String(error)
        console.warn('[token-pet] hourly trend rebuild failed:', trendMaintenanceError)
      }
    }).finally(() => {
        if (trendRebuildFlight === promise) { trendRebuildFlight = undefined; trendRebuildController = undefined }
      })
    trendRebuildFlight = promise
    return promise
  }

  const reconcileTrend = (persistence: TrendPersistenceService): Promise<void> => {
    if (trendReconcileFlight) return trendReconcileFlight
    trendMaintenanceResult = undefined; trendMaintenanceError = undefined
    const promise = (async () => {
      const snapshots = await persistence.listSnapshots()
      const ids = new Set(snapshots.map(snapshot => snapshot.header.id))
      for (const snapshot of snapshots) {
        const sessionId = snapshot.header.id
        const checkpoint = await hourlyTrend.checkpoint(sessionId)
        if (checkpoint?.revision === trendRevisionKey(snapshot.revision)) continue
        const fromSeq = checkpoint?.nextSeq ?? 0
        const source = await persistence.readFrom(sessionId, Math.max(0, fromSeq - 1))
        const anchored = fromSeq === 0 || source.events[0]?.seq === fromSeq - 1
        if (!anchored) {
          const whole = await persistence.readFrom(sessionId, 0)
          await hourlyTrend.applyEvents(sessionId, whole.events, true, snapshot.revision)
        } else {
          const suffix = fromSeq === 0 ? source.events : source.events.filter(event => typeof event.seq === 'number' && event.seq >= fromSeq)
          const result = await hourlyTrend.applyEvents(sessionId, suffix, fromSeq === 0, snapshot.revision)
          if (result.repairFrom !== undefined) scheduleTrendRepair(sessionId, result.repairFrom)
        }
        await new Promise<void>(resolve => setImmediate(resolve))
      }
      await hourlyTrend.retainSessions(ids)
      trendMaintenanceResult = 'completed'
    })().catch(error => {
      trendMaintenanceResult = 'failed'; trendMaintenanceError = error instanceof Error ? error.message : String(error)
      console.warn('[token-pet] hourly trend startup reconciliation failed:', trendMaintenanceError)
      if (!trendReconcileRetry && trendPersistence) trendReconcileRetry = setTimeout(() => { trendReconcileRetry = undefined; if (trendPersistence) void reconcileTrend(trendPersistence) }, 1_000)
    }).finally(() => { if (trendReconcileFlight === promise) trendReconcileFlight = undefined })
    trendReconcileFlight = promise
    return promise
  }

  // Cross-effect bridge: the sessionPersistence effect observes durability
  // fences (session/flush, session/disposed) and asks the index coordinator to
  // schedule a merged, debounced incremental sync. The coordinator itself is
  // owned by the webServer effect because only that effect resolves
  // `sessionQuery`; the optional notify keeps headless hosts (and effect
  // start ordering) harmless.
  const indexScheduler: { notify?: () => void } = {}

  // Eager projection drive: no polling and no transcript scan on panel reopen.
  ctx.inject(['sessionPersistence'], (persistenceCtx) => {
    persistenceCtx.effect(() => {
      const persistence = persistenceCtx.get('sessionPersistence') as TrendPersistenceService | undefined
      if (!persistence) return () => {}
      trendPersistence = persistence
      const eventContext = persistenceCtx as unknown as { on(name: string, callback: (...args: unknown[]) => unknown, options?: { global?: boolean }): () => void }
      const stopEvent = eventContext.on('session/event', (session, rawEvent) => {
        const sessionId = (session as { id?: unknown })?.id
        if (typeof sessionId !== 'string') return
        if (!trendBaselineRevisions.has(sessionId)) {
          trendBaselineRevisions.set(sessionId, persistence.listSnapshots().then(items => {
            const snapshot = items.find(item => item.header.id === sessionId)
            return snapshot ? trendRevisionKey(snapshot.revision) : undefined
          }))
        }
        const event = rawEvent as SequencedUsageEvent
        const list = trendPending.get(sessionId) ?? []; list.push(event); trendPending.set(sessionId, list)
        // Do not checkpoint on session/event: persistence may not have made that
        // sequence durable yet. session/flush/disposed are the durability fence.
      }, { global: true })
      const durableFlush = (session: unknown): Promise<void> => {
        const sessionId = (session as { id?: unknown })?.id
        // Merge + debounce an incremental index sync after every durability
        // fence. Never awaited: the fence must not stall on index work, and
        // the coordinator serializes against any running sync itself.
        indexScheduler.notify?.()
        if (typeof sessionId !== 'string' || !trendPending.has(sessionId)) return Promise.resolve()
        // Returning this promise makes SessionStore.flush await our checkpoint.
        // We first observe persistence's changed revision, establishing that the
        // source log is durable before advancing the trend cursor.
        return flushAfterDurableFence(sessionId)
      }
      const stopFlush = eventContext.on('session/flush', durableFlush, { global: true })
      const stopDisposed = eventContext.on('session/disposed', durableFlush, { global: true })
      // Snapshot load is immediate. Reconciliation is detached by one event-loop
      // turn and reads only sessions whose persisted revision changed.
      void hourlyTrend.status().then(async status => {
        await new Promise<void>(resolve => setImmediate(resolve))
        if (status === 'ready') await reconcileTrend(persistence)
        else await rebuildTrend(persistence)
      })
      return () => {
        stopEvent(); stopFlush(); stopDisposed()
        trendRebuildController?.abort()
        if (trendReconcileRetry) { clearTimeout(trendReconcileRetry); trendReconcileRetry = undefined }
        for (const timer of trendRepairRetries.values()) clearTimeout(timer)
        trendRepairRetries.clear(); trendBaselineRevisions.clear()
        if (trendPersistence === persistence) trendPersistence = undefined
      }
    }, 'token-pet: hourly trend projection')
  })

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => {
      const ws = webCtx.get('webServer') as { register(route: WebRoute): () => void } | undefined
      const sessionQuery = webCtx.get('sessionQuery') as SessionQueryService | undefined
      if (ws === undefined || sessionQuery === undefined) return () => {}

      const baseline: BaselineService = new FileBaselineStore(baselineDir(home))
      const lifetimeLedger = new FileLifetimeLedger(baselineDir(home))
      const usageIndex = new FileSessionUsageIndex(baselineDir(home))
      // Listing all session headers can itself be expensive. Keep the last
      // readiness snapshot across panel close/open cycles and refresh it in one
      // background flight instead of making every status GET synchronously
      // enumerate and compare the complete history.
      const indexInspection = new StaleWhileRevalidate(
        () => inspectSessionUsageIndex(sessionQuery, usageIndex),
        60_000,
      )

      const json = (res: unknown, code: number, payload: unknown): void => {
        const r = res as { writeHead(c: number, h: Record<string, string>): void; end(b: string): void }
        r.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        r.end(JSON.stringify(payload))
      }

      const compute = async (rawInput?: CumulativeUsage) => {
        // Reversible cumulative reads are deliberately isolated from the
        // durable Lifetime Ledger.
        const raw = rawInput ?? await aggregateCumulativeUsage(sessionQuery, undefined, usageIndex)
        const offsets = await baseline.current()
        const cells = applyBaseline(raw.byModelDay, offsets)
        const total = cells.reduce((s, c) => s + c.total, 0)
        // Rebuild per-model / per-day rollups from the baseline-adjusted cells.
        const models: Record<string, { provider: string; model: string; total: number }> = {}
        const days = new Set<string>()
        const totals: UsageBuckets = { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
        for (const c of cells) {
          const mk = `${c.provider}\u0000${c.model}`
          models[mk] = models[mk] ?? { provider: c.provider, model: c.model, total: 0 }
          models[mk].total += c.total
          days.add(c.day)
          totals.uncachedInputTokens += c.totals.uncachedInputTokens
          totals.outputTokens += c.totals.outputTokens
          totals.cacheReadTokens += c.totals.cacheReadTokens
          totals.cacheWriteTokens += c.totals.cacheWriteTokens
        }
        return {
          sessions: raw.sessions,
          totals,
          total,
          byModel: Object.values(models).sort((a, b) => b.total - a.total),
          days: [...days].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)),
          byModelDay: cells.map((c) => ({
            provider: c.provider,
            model: c.model,
            day: c.day,
            totals: c.totals,
            total: c.total,
          })),
          baselineActive: Object.keys(offsets).length > 0,
        }
      }

      const disposers: Array<() => void> = []
      // Full construction and later incremental synchronization are separate
      // operations. A durable index is never replaced by an accidental build.
      interface RunningIndexOperation {
        kind: TokenPetIndexOperation
        controller: AbortController
        progress: UsageIndexBuildProgress
        promise: Promise<unknown>
      }
      let indexOperation: RunningIndexOperation | undefined
      let indexTerminal: TokenPetIndexTerminal | undefined
      let indexError: string | undefined
      const initialIndexProgress = (status: TokenPetIndexOperation, total = 0): UsageIndexBuildProgress =>
        ({ completed: 0, total, indexed: 0, skipped: 0, failed: 0, status })

      // ---- Single-flight background index coordinator ----------------------
      // Owns every automatic maintenance timer and every Lifetime refresh.
      // GET routes only read durable snapshots (plus this coordinator's
      // single-flight header inspection) and never start heavy work here.
      const INDEX_SYNC_STARTUP_DELAY_MS = 5_000
      const INDEX_SYNC_DEBOUNCE_MS = 1_500
      const INDEX_SYNC_FALLBACK_MS = 5 * 60_000
      const LIFETIME_REFRESH_THROTTLE_MS = 60_000
      const LIFETIME_RETRY_MS = 60_000
      const LIFETIME_RETRY_BUDGET = 3
      let indexStartupTimer: ReturnType<typeof setTimeout> | undefined
      let indexFallbackTimer: ReturnType<typeof setInterval> | undefined
      let indexDebounceTimer: ReturnType<typeof setTimeout> | undefined
      let indexTrailingSync = false
      let indexInspectionRefreshing = false
      const refreshIndexInspection = (): Promise<UsageIndexInspection> => {
        indexInspectionRefreshing = true
        return indexInspection.refresh().finally(() => { indexInspectionRefreshing = false })
      }
      let lifetimeRefreshing: Promise<void> | undefined
      let lifetimeRefreshAt = 0
      let lifetimeRetryTimer: ReturnType<typeof setTimeout> | undefined
      let lifetimeRetries = 0
      let lifetimeRefreshFailed = 0
      let lifetimeRefreshListed = 0

      const beginOperation = (kind: TokenPetIndexOperation): RunningIndexOperation => {
        const operation: RunningIndexOperation = { kind, controller: new AbortController(), progress: initialIndexProgress(kind), promise: Promise.resolve() }
        // Reserve synchronously so concurrent triggers cannot pass a
        // check-then-await race.
        indexOperation = operation; indexTerminal = undefined; indexError = undefined
        return operation
      }
      // Function boundary prevents TypeScript from incorrectly retaining the
      // pre-beginOperation `indexOperation is undefined` narrowing across awaits.
      const ownsOperation = (operation: RunningIndexOperation): boolean => indexOperation === operation
      /** Merged convergence: a request that arrived mid-operation runs once more, debounced. */
      const settleTrailingSync = (): void => {
        if (!indexTrailingSync) return
        indexTrailingSync = false
        requestAutoIndexSync()
      }
      /**
       * Single-flight Lifetime follow-up. The durable ledger keeps its previous
       * snapshot on failure (it only ever persists merged observations), and a
       * bounded retry lets transient lock/read failures converge.
       */
      const refreshLifetimeLedger = (force = false): Promise<void> => {
        if (lifetimeRefreshing) return lifetimeRefreshing
        if (!force && Date.now() - lifetimeRefreshAt < LIFETIME_REFRESH_THROTTLE_MS) return Promise.resolve()
        lifetimeRefreshAt = Date.now()
        const promise = lifetimeLedger.refresh(sessionQuery, undefined, usageIndex).then(result => {
          lifetimeRefreshFailed = result.failed
          lifetimeRefreshListed = result.listed
          if (result.failed === 0) lifetimeRetries = 0
          if (lifetimeRetryTimer) { clearTimeout(lifetimeRetryTimer); lifetimeRetryTimer = undefined }
          if (result.failed > 0 && lifetimeRetries < LIFETIME_RETRY_BUDGET) {
            lifetimeRetries += 1
            lifetimeRetryTimer = setTimeout(() => { lifetimeRetryTimer = undefined; void refreshLifetimeLedger(true) }, LIFETIME_RETRY_MS)
            lifetimeRetryTimer.unref?.()
          }
        }).catch(error => {
          lifetimeRefreshFailed = 1
          console.warn('[token-pet] Lifetime Ledger background refresh failed:', error instanceof Error ? error.message : String(error))
          if (lifetimeRetries < LIFETIME_RETRY_BUDGET) {
            lifetimeRetries += 1
            if (!lifetimeRetryTimer) {
              lifetimeRetryTimer = setTimeout(() => { lifetimeRetryTimer = undefined; void refreshLifetimeLedger(true) }, LIFETIME_RETRY_MS)
              lifetimeRetryTimer.unref?.()
            }
          }
        }).finally(() => {
          if (lifetimeRefreshing === promise) lifetimeRefreshing = undefined
        })
        lifetimeRefreshing = promise
        return promise
      }
      const completeOperation = async (operation: RunningIndexOperation, result: { cancelled: boolean; failed: number }): Promise<void> => {
        if (result.cancelled) indexTerminal = 'cancelled'
        else if (result.failed > 0) { indexTerminal = 'error'; indexError = `${result.failed} session(s) failed` }
        else { indexTerminal = undefined; indexError = undefined }
        if (indexOperation === operation) indexOperation = undefined
        indexInspection.invalidate()
        void refreshIndexInspection().catch(error => {
          console.warn('[token-pet] post-sync index inspection failed:', error instanceof Error ? error.message : String(error))
        })
        settleTrailingSync()
        if (!result.cancelled) {
          try {
            await refreshLifetimeLedger(true)
          } catch {
            // refreshLifetimeLedger never rejects; guard only against an
            // unexpected throw escaping into the operation chain.
          }
        }
      }
      const failOperation = (operation: RunningIndexOperation, error: unknown): void => {
        indexTerminal = 'error'
        indexError = error instanceof Error ? error.message : String(error)
        if (indexOperation === operation) indexOperation = undefined
        settleTrailingSync()
      }
      const requestAutoIndexSync = (): void => {
        if (indexOperation) { indexTrailingSync = true; return }
        if (indexDebounceTimer) clearTimeout(indexDebounceTimer)
        indexDebounceTimer = setTimeout(() => { indexDebounceTimer = undefined; void runAutoIndexSync() }, INDEX_SYNC_DEBOUNCE_MS)
        indexDebounceTimer.unref?.()
      }
      /** One automatic reconcile pass. Single flight; explicit routes share `indexOperation`. */
      const runAutoIndexSync = async (): Promise<void> => {
        if (indexDebounceTimer) { clearTimeout(indexDebounceTimer); indexDebounceTimer = undefined }
        if (indexOperation) { indexTrailingSync = true; return }
        const operation = beginOperation('syncing')
        try {
          const persisted = await usageIndex.isPersisted()
          if (!ownsOperation(operation)) return
          let promise: Promise<UsageIndexBuildResult | UsageIndexIncrementResult>
          if (persisted) {
            // The readiness check and the incremental fold share this exact
            // inspection; it lists headers only and never opens a session log.
            const inspection = await refreshIndexInspection()
            if (!ownsOperation(operation)) return
            operation.progress = initialIndexProgress('syncing', inspection.pending)
            if (inspection.pending === 0 && inspection.removedIds.length === 0) {
              indexOperation = undefined; indexTerminal = undefined; indexError = undefined
              // Still give Lifetime one reconciliation chance (e.g. startup).
              void refreshLifetimeLedger()
              return
            }
            promise = incrementSessionUsageIndex(sessionQuery, usageIndex, {
              signal: operation.controller.signal,
              concurrency: 2,
              yieldEvery: 1,
              inspection,
              onProgress: (next) => { if (indexOperation === operation) operation.progress = { ...next, status: 'syncing' } },
            })
          } else {
            // First construction remains an explicit user action. Automatically
            // scanning the complete history five seconds after startup would
            // merely move the UI freeze away from panel-open rather than remove
            // it. Once persisted, all later convergence is automatic/incremental.
            if (ownsOperation(operation)) indexOperation = undefined
            indexTerminal = undefined; indexError = undefined
            return
          }
          operation.promise = promise
          void promise.then(result => completeOperation(operation, result), error => failOperation(operation, error))
        } catch (error) {
          failOperation(operation, error)
        }
      }
      disposers.push(ws.register({ kind: 'exact', path: '/token-pet/index/status', handler: async (req, res) => {
        if (String((req as { method?: unknown })?.method ?? '').toUpperCase() !== 'GET') { json(res, 405, { error: 'method not allowed' }); return }
        try {
          const persisted = await usageIndex.isPersisted()
          const entries = await usageIndex.entries()
          // Pure snapshot read: GET never starts header enumeration. Startup,
          // session durability events and the periodic coordinator own refresh.
          const inspection = indexInspection.peek()
          const refreshing = inspection === undefined || indexOperation !== undefined || indexInspectionRefreshing
          const pending = inspection?.pending ?? indexOperation?.progress.total ?? 0
          const indexed = inspection?.indexed ?? Object.keys(entries).length
          const closed = inspection?.closed ?? indexed + pending
          const live = inspection?.live ?? 0
          const listed = inspection?.records.length ?? closed + live
          const status = deriveTokenPetIndexState({ persisted, pending, operation: indexOperation?.kind, terminal: indexTerminal })
          const progress = indexOperation?.progress ?? {
            completed: 0,
            total: pending,
            indexed: 0,
            skipped: 0,
            failed: 0,
          }
          json(res, 200, {
            status,
            persisted,
            usable: persisted,
            building: status === 'building',
            syncing: status === 'syncing',
            refreshing,
            ...(refreshing ? { retryAfterMs: 1_000 } : {}),
            listed,
            closed,
            live,
            indexed,
            pending,
            path: sessionUsageIndexPath(baselineDir(home)),
            entries: Object.keys(entries).length,
            progress: { ...progress, pending, status },
            ...(indexError ? { error: indexError } : {}),
          })
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error)
          json(res, 500, { status: 'error', persisted: false, usable: false, error: detail })
        }
      } }))
      disposers.push(ws.register({ kind: 'exact', path: '/token-pet/index/build', handler: async (req, res) => {
        if (String((req as { method?: unknown })?.method ?? '').toUpperCase() !== 'POST') { json(res, 405, { error: 'method not allowed' }); return }
        if (indexOperation) { json(res, 409, { error: `index ${indexOperation.kind} already running`, progress: indexOperation.progress }); return }
        const operation = beginOperation('building')
        try {
          if (await usageIndex.isPersisted()) {
            if (indexOperation === operation) indexOperation = undefined
            json(res, 409, { error: 'usable index already exists; use /token-pet/index/sync' }); return
          }
          const promise = buildSessionUsageIndex(sessionQuery, usageIndex, { signal: operation.controller.signal, onProgress: (next) => { if (indexOperation === operation) operation.progress = { ...next, status: 'building' } } })
          operation.promise = promise
          void promise.then(result => completeOperation(operation, result), error => failOperation(operation, error))
          json(res, 202, { ok: true, status: 'building', progress: operation.progress })
        } catch (error) {
          failOperation(operation, error)
          json(res, 500, { error: indexError })
        }
      } }))
      disposers.push(ws.register({ kind: 'exact', path: '/token-pet/index/sync', handler: async (req, res) => {
        if (String((req as { method?: unknown })?.method ?? '').toUpperCase() !== 'POST') { json(res, 405, { error: 'method not allowed' }); return }
        if (indexOperation) { json(res, 409, { error: `index ${indexOperation.kind} already running`, progress: indexOperation.progress }); return }
        const operation = beginOperation('syncing')
        try {
          if (!await usageIndex.isPersisted()) {
            if (indexOperation === operation) indexOperation = undefined
            json(res, 409, { error: 'no usable index exists; run /token-pet/index/build first' }); return
          }
          // The endpoint's readiness check and the incremental fold share this
          // exact snapshot; previously they listed/compared every session twice.
          const inspection = await indexInspection.refresh()
          operation.progress = initialIndexProgress('syncing', inspection.pending)
          if (inspection.pending === 0 && inspection.removedIds.length === 0) {
            if (indexOperation === operation) indexOperation = undefined
            json(res, 200, { ok: true, status: 'ready', pending: 0 }); return
          }
          const promise = incrementSessionUsageIndex(sessionQuery, usageIndex, { signal: operation.controller.signal, concurrency: 2, yieldEvery: 1, inspection, onProgress: (next) => { if (indexOperation === operation) operation.progress = { ...next, status: 'syncing' } } })
          operation.promise = promise
          void promise.then(result => completeOperation(operation, result), error => failOperation(operation, error))
          json(res, 202, { ok: true, status: 'syncing', pending: inspection.pending, progress: operation.progress })
        } catch (error) {
          failOperation(operation, error)
          json(res, 500, { error: indexError })
        }
      } }))
      disposers.push(ws.register({ kind: 'exact', path: '/token-pet/index/cancel', handler: async (req, res) => {
        if (String((req as { method?: unknown })?.method ?? '').toUpperCase() !== 'POST') { json(res, 405, { error: 'method not allowed' }); return }
        if (!indexOperation) { json(res, 200, { ok: true, status: indexTerminal ?? 'ready' }); return }
        indexOperation.controller.abort()
        json(res, 202, { ok: true, status: indexOperation.kind, progress: indexOperation.progress })
      } }))
      // Trend GETs read only the FileHourlyTrendIndex durable projection;
      // session events and persistence reconciliation maintain it.

      // POST: opt-in prompt enhancement. The host adapter is optional and is
      // resolved at request time so plugin loading remains compatible with DSH
      // profiles that do not expose a model service.
      disposers.push(ws.register({
        kind: 'exact',
        path: '/token-pet/prompt/enhance',
        handler: async (req, res) => {
          if (String((req as { method?: unknown })?.method ?? '').toUpperCase() !== 'POST') { json(res, 405, { error: 'method not allowed' }); return }
          try {
            const body = await readJsonBody(req)
            if (typeof body.prompt !== 'string' || body.prompt.trim() === '') {
              json(res, 400, { error: 'prompt must be a non-empty string' })
              return
            }
            const request = {
              prompt: body.prompt,
              template: typeof body.template === 'string' ? body.template : undefined,
              provider: typeof body.provider === 'string' ? body.provider : undefined,
              model: typeof body.model === 'string' ? body.model : undefined,
            }
            const adapter = ctx.get('promptEnhancer') as PromptEnhancerService | undefined
            if (adapter && typeof adapter.enhance === 'function') {
              const result = await adapter.enhance(request)
              const enhanced = typeof result === 'string' ? result : result.enhanced
              if (typeof enhanced !== 'string') throw new Error('prompt enhancer returned no enhanced text')
              json(res, 200, { original: body.prompt, enhanced, ...(typeof result === 'string' ? {} : { model: result.model }) })
              return
            }
            const llm = ctx.get('llm') as LlmService | undefined
            const providers = llm?.listProviders?.() ?? []
            const defaults = ctx.get('agentDefaultModel') as DefaultModelService | undefined
            const defaultSelection = defaults?.currentSelection?.() ?? {}
            // An empty enhancement-model setting means the DSH default model.
            // The session timeline wins when it already exposed its routed model;
            // before the first turn, agentDefaultModel supplies that same default.
            const resolved = resolvePromptRoute(request, defaultSelection, providers)
            const provider = resolved.provider
            let model = resolved.model
            if (!model && llm && provider && typeof llm.listModels === 'function') {
              model = (await llm.listModels(provider))[0]?.id
            }
            if (!llm || !provider || !model) {
              json(res, 503, { error: 'no promptEnhancer adapter or resolvable DSH provider/model is available', provider, model })
              return
            }
            const framed = request.template?.includes('{{prompt}}')
              ? request.template.replaceAll('{{prompt}}', request.prompt)
              : `${request.template ?? '请优化以下提示词，保留原意并提升清晰度：'}\n\n${request.prompt}`
            let enhanced = ''
            for await (const chunk of llm.stream({
              provider,
              model,
              system: 'You improve user prompts. Preserve intent, add useful specificity, and return only the improved prompt.',
              messages: [{ role: 'user', content: [{ type: 'text', text: framed }], source: { kind: 'plugin', plugin: 'dsh-token-pet' } }],
              maxTokens: 2048,
              purpose: 'token-pet-prompt-enhance',
            })) {
              if (chunk.type === 'text-delta' && typeof chunk.text === 'string') enhanced += chunk.text
              if (chunk.type === 'finish' && chunk.reason?.kind === 'error') throw new Error(chunk.reason.failure?.message ?? 'DSH LLM enhancement failed')
            }
            if (enhanced.trim() === '') throw new Error('DSH LLM returned no enhanced text')
            json(res, 200, { original: body.prompt, enhanced: enhanced.trim(), model, provider })
          } catch (e) {
            const detail = e instanceof Error ? e.message : String(e)
            console.error('[token-pet] prompt enhancement failed:', detail)
            json(res, 502, { error: detail })
          }
        },
      }))

      // Lightweight maintenance metadata. It deserializes only the compact
      // projection snapshot and never enumerates sessions or reads history.
      disposers.push(ws.register({
        kind: 'exact',
        path: '/token-pet/usage/trend/status',
        handler: async (req, res) => {
          if (String((req as { method?: unknown })?.method ?? '').toUpperCase() !== 'GET') { json(res, 405, { error: 'method not allowed' }); return }
          try {
            const inspection = await hourlyTrend.inspect()
            const operation = trendRebuildFlight ? 'rebuilding' : trendReconcileFlight ? 'reconciling' : trendRepairFlights.size > 0 ? 'repairing' : 'idle'
            json(res, 200, {
              health: inspection.health,
              updatedAt: inspection.updatedAt > 0 ? inspection.updatedAt : null,
              operation,
              running: operation !== 'idle',
              reconciling: operation === 'reconciling',
              rebuilding: operation === 'rebuilding',
              repairing: operation === 'repairing',
              repairCount: trendRepairFlights.size,
              path: hourlyTrend.path,
              snapshotOnly: true,
              cancelSupported: operation === 'rebuilding' && Boolean(trendRebuildController),
              ...(trendMaintenanceResult ? { lastResult: trendMaintenanceResult } : {}),
              ...(trendMaintenanceError ? { error: trendMaintenanceError } : {}),
            })
          } catch (e) {
            json(res, 500, { error: e instanceof Error ? e.message : String(e) })
          }
        },
      }))

      // GET: today's hourly trend, grouped in the caller's IANA time zone.
      disposers.push(ws.register({
        kind: 'exact',
        path: '/token-pet/usage/trend',
        handler: async (req, res) => {
          if (String((req as { method?: unknown })?.method ?? '').toUpperCase() !== 'GET') { json(res, 405, { error: 'method not allowed' }); return }
          try {
            const url = typeof (req as { url?: unknown })?.url === 'string' ? new URL((req as { url: string }).url, 'http://localhost') : undefined
            const timeZone = url?.searchParams.get('timeZone') || Intl.DateTimeFormat().resolvedOptions().timeZone
            // Manual refresh is snapshot-only. Pending session events become
            // visible after the persistence layer emits session/flush, never
            // before their sequence is durable on disk.
            const value = await hourlyTrend.trend(timeZone, Date.now())
            const refreshing = Boolean(trendFlushFlight || trendRebuildFlight || trendReconcileFlight || trendRepairFlights.size > 0)
            json(res, 200, { ...value, refreshing, ...(refreshing ? { retryAfterMs: 500 } : {}) })
          } catch (e) {
            const detail = e instanceof Error ? e.message : String(e)
            json(res, 400, { error: detail })
          }
        },
      }))
      // Explicit maintenance escape hatch. This is the only normal route that
      // intentionally authorizes a complete historical rebuild.
      disposers.push(ws.register({
        kind: 'exact',
        path: '/token-pet/usage/trend/repair',
        handler: async (req, res) => {
          if (String((req as { method?: unknown })?.method ?? '').toUpperCase() !== 'POST') { json(res, 405, { error: 'method not allowed' }); return }
          if (!trendPersistence) { json(res, 503, { error: 'sessionPersistence is unavailable' }); return }
          if (trendRebuildFlight || trendReconcileFlight || trendRepairFlights.size > 0) { json(res, 409, { error: 'trend maintenance already running' }); return }
          void rebuildTrend(trendPersistence)
          json(res, 202, { ok: true, status: 'rebuilding', path: hourlyTrend.path })
        },
      }))
      disposers.push(ws.register({
        kind: 'exact',
        path: '/token-pet/usage/trend/repair/cancel',
        handler: async (req, res) => {
          if (String((req as { method?: unknown })?.method ?? '').toUpperCase() !== 'POST') { json(res, 405, { error: 'method not allowed' }); return }
          if (!trendRebuildController) { json(res, 200, { ok: true, status: 'ready' }); return }
          trendRebuildController.abort()
          trendMaintenanceResult = 'cancelled'; trendMaintenanceError = undefined
          json(res, 202, { ok: true, status: 'cancelled' })
        },
      }))

      // Lifetime Ledger discovery is isolated from cumulative reset/restore and
      // from the cumulative refresh button.
      disposers.push(ws.register({
        kind: 'exact',
        path: '/token-pet/usage/lifetime',
        handler: async (req, res) => {
          if (String((req as { method?: unknown })?.method ?? '').toUpperCase() !== 'GET') { json(res, 405, { error: 'method not allowed' }); return }
          try {
            // Pure durable read. Opening the panel never enumerates transcripts
            // or touches the ledger lock: the background coordinator refreshes
            // the ledger after index syncs, and this GET only mirrors its
            // last outcome.
            const usage = await lifetimeLedger.usage()
            json(res, 200, { ...usage, refreshFailed: lifetimeRefreshFailed, refreshListed: lifetimeRefreshListed, refreshing: Boolean(lifetimeRefreshing) })
          } catch (e) {
            const detail = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e)
            console.error('[token-pet] /token-pet/usage/lifetime failed:', detail)
            json(res, 500, { error: detail })
          }
        },
      }))

      // Sole irreversible operation. It has a dedicated route, exact phrase
      // confirmation, and intentionally no restore counterpart.
      disposers.push(ws.register({
        kind: 'exact',
        path: '/token-pet/usage/lifetime/clear-history',
        handler: async (req, res) => {
          const method = String((req as { method?: unknown })?.method ?? '').toUpperCase()
          if (method !== 'POST') { json(res, 405, { error: 'method not allowed' }); return }
          try {
            const body = await readJsonBody(req)
            if (body.confirmation !== LIFETIME_CLEAR_CONFIRMATION) {
              json(res, 400, { error: 'explicit Lifetime Ledger confirmation required' })
              return
            }
            const refreshed = await lifetimeLedger.refresh(sessionQuery, undefined, usageIndex)
            if (refreshed.failed > 0) {
              json(res, 409, { error: `cannot clear Lifetime Ledger: ${refreshed.failed} session(s) failed to refresh` })
              return
            }
            const usage = await lifetimeLedger.clearHistory()
            json(res, 200, { ok: true, ...usage })
          } catch (e) {
            const detail = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e)
            console.error('[token-pet] clear-history failed:', detail)
            json(res, 500, { error: detail })
          }
        },
      }))

      // GET: full aggregate with baseline applied.
      disposers.push(ws.register({
        kind: 'exact',
        path: '/token-pet/usage',
        handler: async (req, res) => {
          if (String((req as { method?: unknown })?.method ?? '').toUpperCase() !== 'GET') { json(res, 405, { error: 'method not allowed' }); return }
          try { json(res, 200, await compute()) }
          catch (e) {
            const detail = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e)
            console.error('[token-pet] /token-pet/usage failed:', detail)
            json(res, 500, { error: detail })
          }
        },
      }))

      // POST: 清空 — zero the display by recording current totals as offsets.
      disposers.push(ws.register({
        kind: 'exact',
        path: '/token-pet/usage/reset',
        handler: async (req, res) => {
          if (String((req as { method?: unknown })?.method ?? '').toUpperCase() !== 'POST') { json(res, 405, { error: 'method not allowed' }); return }
          try {
            const raw = await aggregateCumulativeUsage(sessionQuery, undefined, usageIndex)
            const offsets: Record<string, number> = {}
            for (const c of raw.byModelDay) {
              offsets[`${c.provider}\u0000${c.model}\u0000${c.day}`] = c.total
            }
            await baseline.reset(offsets)
            json(res, 200, { ok: true, ...await compute(raw) })
          } catch (e) {
            const detail = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e)
            console.error('[token-pet] /token-pet/usage/reset failed:', detail)
            json(res, 500, { error: detail })
          }
        },
      }))

      // POST: 恢复 — revert the last 清空.
      disposers.push(ws.register({
        kind: 'exact',
        path: '/token-pet/usage/restore',
        handler: async (req, res) => {
          if (String((req as { method?: unknown })?.method ?? '').toUpperCase() !== 'POST') { json(res, 405, { error: 'method not allowed' }); return }
          try {
            await baseline.restore()
            json(res, 200, { ok: true, ...await compute() })
          } catch (e) {
            const detail = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e)
            console.error('[token-pet] /token-pet/usage/restore failed:', detail)
            json(res, 500, { error: detail })
          }
        },
      }))

      // GET: composite action strips. The client fetches the WebP lazily so the
      // browser bundle stays small and strip decode never blocks startup; a long
      // immutable cache makes repeated action switches instant.
      const stripDir = new URL('../assets/pet/action-sheets/', import.meta.url)
      const stripFiles = new Set(STRIP_ACTIONS.map(action => `${action}.webp`))
      disposers.push(ws.register({
        kind: 'prefix',
        path: '/token-pet/strips/',
        handler: async (req, res) => {
          const method = String((req as { method?: unknown })?.method ?? '').toUpperCase()
          if (method !== 'GET') { json(res, 405, { error: 'method not allowed' }); return }
          const rawUrl = (req as { url?: unknown })?.url
          const url = typeof rawUrl === 'string' ? new URL(rawUrl, 'http://localhost') : null
          const file = url?.pathname.split('/').pop() ?? ''
          if (!stripFiles.has(file)) { json(res, 404, { error: 'unknown strip' }); return }
          try {
            const data = await readFile(new URL(file, stripDir))
            const sr = res as { writeHead(c: number, h: Record<string, string>): void; end(b: unknown): void }
            sr.writeHead(200, {
              'content-type': 'image/webp',
              'content-length': String(data.byteLength),
              'cache-control': 'public, max-age=31536000, immutable',
            })
            sr.end(data)
          } catch {
            json(res, 404, { error: 'strip file not found on disk' })
          }
        },
      }))

      // ---- Coordinator scheduling (background only, never from a GET) ------
      // Durability fences arrive through the shared bridge; startup and the
      // low-frequency fallback are armed here. All of these are single-flight
      // through `indexOperation` and merge into one debounced pass.
      indexScheduler.notify = requestAutoIndexSync
      indexStartupTimer = setTimeout(() => {
        indexStartupTimer = undefined
        // Startup reconcile: converge the durable index once the host is warm.
        void runAutoIndexSync()
      }, INDEX_SYNC_STARTUP_DELAY_MS)
      indexStartupTimer.unref?.()
      indexFallbackTimer = setInterval(() => { void runAutoIndexSync() }, INDEX_SYNC_FALLBACK_MS)
      indexFallbackTimer.unref?.()

      return () => {
        indexScheduler.notify = undefined
        if (indexStartupTimer) { clearTimeout(indexStartupTimer); indexStartupTimer = undefined }
        if (indexFallbackTimer) { clearInterval(indexFallbackTimer); indexFallbackTimer = undefined }
        if (indexDebounceTimer) { clearTimeout(indexDebounceTimer); indexDebounceTimer = undefined }
        if (lifetimeRetryTimer) { clearTimeout(lifetimeRetryTimer); lifetimeRetryTimer = undefined }
        indexOperation?.controller.abort()
        indexOperation = undefined
        for (const d of disposers) d()
      }
    }, 'token-pet: cumulative usage route')
  })
}
