/** Host-side token usage aggregation and today's local-time trend. */

import type { FileSessionUsageIndex, SessionUsageFingerprint } from './session-usage-index.js'

export interface UsageBuckets {
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}
export interface ModelKey { provider: string; model: string }
export interface ModelDayTotals { provider: string; model: string; day: string; totals: UsageBuckets; total: number }
export interface CumulativeUsage {
  sessions: number; totals: UsageBuckets; total: number; byModelDay: ModelDayTotals[]
  models: Array<ModelKey & { total: number }>; days: string[]
}
export interface UsageEvent { type?: string; data?: unknown; time?: number }
export interface SessionQueryService {
  listSessions(signal?: AbortSignal): Promise<Array<{ header: { id: string; version?: unknown; createdAt?: unknown; cwd?: unknown; parentSession?: unknown; seedLength?: unknown; delegationDepth?: unknown; updatedAt?: unknown; revision?: string | number; eventCount?: number }; live?: boolean }>>
  readSession(sessionId: string): Promise<{ session: unknown; events: UsageEvent[] }>
}

/** Options for an explicit, host-controlled index build. */
export interface UsageIndexBuildOptions {
  signal?: AbortSignal
  /** Called after each item, including skipped and failed items. */
  onProgress?: (progress: UsageIndexBuildProgress) => void | Promise<void>
  /** Report an isolated read failure without aborting the build. */
  onError?: (sessionId: string, error: unknown) => void | Promise<void>
  /** Number of sessions after which the builder yields to the host event loop. */
  yieldEvery?: number
}
export interface UsageIndexBuildProgress {
  completed: number
  /** Work items for this operation: closed sessions for build, new/changed closed sessions for sync. */
  total: number
  indexed: number
  skipped: number
  failed: number
  sessionId?: string
  status?: 'indexed' | 'skipped' | 'failed' | 'building' | 'syncing' | 'ready' | 'cancelled' | 'error'
}
export interface UsageIndexBuildResult extends Omit<UsageIndexBuildProgress, 'sessionId' | 'status'> {
  cancelled: boolean
}
export interface UsageTrendPoint { hour: string; hourOfDay: number; totals: UsageBuckets; total: number; count: number }
export interface TodayUsageTrend { date: string; timeZone: string; sessions: number; totals: UsageBuckets; total: number; byHour: UsageTrendPoint[] }

const ZERO: UsageBuckets = { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
const pos = (v: unknown): number => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0
const sumOf = (b: UsageBuckets): number => b.uncachedInputTokens + b.outputTokens + b.cacheReadTokens + b.cacheWriteTokens
function add(a: UsageBuckets, b: UsageBuckets): UsageBuckets {
  return { uncachedInputTokens: a.uncachedInputTokens + b.uncachedInputTokens, outputTokens: a.outputTokens + b.outputTokens, cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens, cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens }
}
function bucket(usage: Record<string, unknown>): UsageBuckets {
  return { uncachedInputTokens: pos(usage.inputTokens), outputTokens: pos(usage.outputTokens), cacheReadTokens: pos(usage.cacheReadTokens), cacheWriteTokens: pos(usage.cacheWriteTokens) }
}
function usageOf(event: UsageEvent): Record<string, unknown> | undefined {
  const d = event.data as Record<string, unknown> | undefined
  if (event.type === 'assistant/chunk') {
    const chunk = d?.chunk as Record<string, unknown> | undefined
    const usage = chunk?.type === 'usage' ? chunk.usage : undefined
    return typeof usage === 'object' && usage !== null ? usage as Record<string, unknown> : undefined
  }
  if (event.type === 'assistant/message' || event.type === 'step/end' || event.type === 'turn/end') {
    const usage = d?.usage ?? (d?.step as Record<string, unknown> | undefined)?.usage ?? (d?.turn as Record<string, unknown> | undefined)?.usage
    return typeof usage === 'object' && usage !== null ? usage as Record<string, unknown> : undefined
  }
  return undefined
}

function epochMs(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined
  // DSH event times are epoch milliseconds; tolerate imported epoch seconds/us.
  if (value < 1e11) return value * 1000
  if (value > 1e14) return value / 1000
  return value
}
function identityPart(value: unknown): string | number | undefined {
  if (typeof value === 'string' && value !== '') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'object' && value !== null) {
    const id = (value as { id?: unknown }).id
    if (typeof id === 'string' && id !== '') return id
    if (typeof id === 'number' && Number.isFinite(id)) return id
  }
  return undefined
}
function identity(event: UsageEvent): string | undefined {
  const d = event.data as Record<string, unknown> | undefined
  // Canonical DSH events carry numeric/string turn/step directly on data.
  // Imported or adapter events may instead expose turnId/stepId or nested ids.
  const turn = identityPart(d?.turnId) ?? identityPart(d?.turn)
  const step = identityPart(d?.stepId) ?? identityPart(d?.step)
  return turn !== undefined && step !== undefined ? `${String(turn)}\0${String(step)}` : undefined
}
function terminal(type: string | undefined): boolean { return type === 'turn/end' || type === 'step/end' || type === 'assistant/message' }
function usageEvents(events: UsageEvent[]): UsageEvent[] {
  const selected = new Map<string, { event: UsageEvent; terminal: boolean }>(); const plain: UsageEvent[] = []
  for (const event of events) {
    const usage = usageOf(event); if (!usage) { plain.push(event); continue }
    const key = identity(event); if (!key) { plain.push(event); continue }
    const old = selected.get(key); const isTerminal = terminal(event.type)
    if (!old || isTerminal || !old.terminal) selected.set(key, { event, terminal: isTerminal })
  }
  return [...plain, ...[...selected.values()].map(x => x.event)]
}
function modelOf(event: UsageEvent): ModelKey | undefined {
  if (event.type !== 'request/header') return undefined
  const h = (event.data as { header?: { config?: { provider?: unknown; model?: unknown }; provider?: unknown; model?: unknown } } | undefined)?.header
  const p = typeof h?.config?.provider === 'string' && h.config.provider ? h.config.provider : typeof h?.provider === 'string' && h.provider ? h.provider : undefined
  const m = typeof h?.config?.model === 'string' && h.config.model ? h.config.model : typeof h?.model === 'string' && h.model ? h.model : undefined
  return p && m ? { provider: p, model: m } : undefined
}
const partsFormatters = new Map<string, Intl.DateTimeFormat>()
function parts(ms: number, timeZone: string): { date: string; hour: number } {
  let formatter = partsFormatters.get(timeZone)
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
    partsFormatters.set(timeZone, formatter)
  }
  const out: Record<string, string> = {}
  for (const x of formatter.formatToParts(ms)) if (x.type !== 'literal') out[x.type] = x.value
  return { date: `${out.year}-${out.month}-${out.day}`, hour: Number(out.hour) }
}
function today(ms: number, timeZone: string): string { return parts(ms, timeZone).date }

/** Pure fold of usage events into today's 24 local clock-hour buckets. */
export function aggregateUsageEvents(events: UsageEvent[], timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone, now = Date.now()): TodayUsageTrend {
  const date = today(now, timeZone)
  const points = Array.from({ length: 24 }, (_, hour) => ({ hour: String(hour).padStart(2, '0'), hourOfDay: hour, totals: { ...ZERO }, total: 0, count: 0 }))
  let currentModel: ModelKey | undefined
  for (const event of usageEvents(events)) {
    const model = modelOf(event); if (model) currentModel = model
    const u = usageOf(event); const timestamp = epochMs(event.time); if (!u || timestamp === undefined) continue
    // Usage that arrives with a future timestamp must never appear in a
    // "today" chart (clock skew/imported data can otherwise create future
    // points). The caller's snapshot time is the upper bound.
    if (timestamp > now) continue
    const local = parts(timestamp, timeZone); if (local.date !== date) continue
    const p = points[local.hour]; if (!p) continue
    p.totals = add(p.totals, bucket(u)); p.total = sumOf(p.totals); p.count += 1
  }
  const totals = points.reduce((a, p) => add(a, p.totals), { ...ZERO })
  return { date, timeZone, sessions: 1, totals, total: sumOf(totals), byHour: points }
}

export function sessionFingerprint(record: { header: { id: string; version?: unknown; createdAt?: unknown; cwd?: unknown; parentSession?: unknown; seedLength?: unknown; delegationDepth?: unknown; revision?: string | number; updatedAt?: unknown; eventCount?: number } }): SessionUsageFingerprint {
  const h = record.header
  const out: SessionUsageFingerprint = {}
  if (typeof h.revision === 'string' || (typeof h.revision === 'number' && Number.isFinite(h.revision))) out.revision = h.revision
  if (typeof h.updatedAt === 'string' || (typeof h.updatedAt === 'number' && Number.isFinite(h.updatedAt))) out.updatedAt = h.updatedAt as string | number
  if (typeof h.eventCount === 'number' && Number.isFinite(h.eventCount) && h.eventCount >= 0) out.eventCount = h.eventCount
  // The released SessionHeader has no mtime/revision/eventCount. Closed logs
  // are immutable, so its canonical identity is a safe and stable fallback;
  // without this every real closed session produced an empty fingerprint and
  // was discarded by FileSessionUsageIndex.put(). Keep this deliberately
  // limited to header identity fields (not object key order or extra metadata).
  if (Object.keys(out).length === 0) {
    out.revision = `header:${JSON.stringify([h.version, h.id, h.createdAt, h.cwd, h.parentSession, h.seedLength, h.delegationDepth ?? 0])}`
  }
  return out
}
function dayOf(ms: number): string { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
function foldSession(events: UsageEvent[], fallbackDay: string, out: Map<string, ModelDayTotals>): void {
  let current: ModelKey | undefined
  for (const event of usageEvents(events)) {
    const m = modelOf(event); if (m) current = m
    const u = usageOf(event); if (!u) continue
    const key = current ?? { provider: '(unknown)', model: '(unknown)' }
    const timestamp = epochMs(event.time)
    const day = timestamp !== undefined ? dayOf(timestamp) : fallbackDay
    const id = `${key.provider}\0${key.model}\0${day}`
    let cell = out.get(id); if (!cell) { cell = { ...key, day, totals: { ...ZERO }, total: 0 }; out.set(id, cell) }
    cell.totals = add(cell.totals, bucket(u))
  }
}

/** Fold one closed or live session into a canonical ledger snapshot. */
export function foldSessionUsage(events: UsageEvent[], createdAt = 0): ModelDayTotals[] {
  const out = new Map<string, ModelDayTotals>()
  foldSession(events, dayOf(createdAt), out)
  return [...out.values()].map(cell => ({ ...cell, totals: { ...cell.totals }, total: sumOf(cell.totals) }))
}

/** Build the public cumulative shape from durable ledger cells. */
export function summarizeUsageCells(source: readonly ModelDayTotals[], sessions = source.length > 0 ? 1 : 0): CumulativeUsage {
  const map = new Map<string, ModelDayTotals>()
  for (const cell of source) {
    const id = `${cell.provider}\0${cell.model}\0${cell.day}`; const old = map.get(id)
    if (old) old.totals = add(old.totals, cell.totals)
    else map.set(id, { ...cell, totals: { ...cell.totals } })
  }
  const cells = [...map.values()]; let totals = { ...ZERO }; const models = new Map<string, { provider: string; model: string; total: number }>(); const days = new Set<string>()
  for (const cell of cells) {
    cell.total = sumOf(cell.totals); totals = add(totals, cell.totals); days.add(cell.day)
    const id = `${cell.provider}\0${cell.model}`; const model = models.get(id) ?? { provider: cell.provider, model: cell.model, total: 0 }; model.total += cell.total; models.set(id, model)
  }
  return { sessions, totals, total: sumOf(totals), byModelDay: cells, models: [...models.values()].sort((a, b) => b.total - a.total), days: [...days].sort().reverse() }
}
/**
 * Explicit safe index construction. Reads one closed session at a time and
 * persists each item before moving on; completed entries survive cancellation.
 */
export async function buildSessionUsageIndex(sessionQuery: SessionQueryService, usageIndex: FileSessionUsageIndex, options: UsageIndexBuildOptions = {}): Promise<UsageIndexBuildResult> {
  const { signal, onProgress, onError } = options
  const yieldEvery = Math.max(1, Math.floor(options.yieldEvery ?? 1))
  let records: Awaited<ReturnType<SessionQueryService['listSessions']>>
  try { records = await sessionQuery.listSessions(signal) } catch (error) {
    if (signal?.aborted) return { completed: 0, total: 0, indexed: 0, skipped: 0, failed: 0, cancelled: true }
    throw error
  }
  // Live sessions are intentionally outside the persistent closed-session
  // index. They must not inflate the first-build denominator or pending count.
  const closed = records.filter(record => !record.live)
  let completed = 0; let indexed = 0; let skipped = 0; let failed = 0
  // Persist an explicit empty document so status can distinguish "built, no
  // closed sessions" from "never built" and does not trigger a rebuild loop.
  if (closed.length === 0) await usageIndex.ensurePersisted()
  for (const record of closed) {
    if (signal?.aborted) return { completed, total: closed.length, indexed, skipped, failed, cancelled: true }
    const id = record.header.id; const fp = sessionFingerprint(record)
    let status: UsageIndexBuildProgress['status']
    if (await usageIndex.lookup(id, fp)) { skipped++; status = 'skipped' }
    else {
      try {
        const source = await sessionQuery.readSession(id)
        const created = typeof (source.session as { createdAt?: unknown })?.createdAt === 'number' ? source.session as { createdAt: number } : { createdAt: 0 }
        const local = new Map<string, ModelDayTotals>(); foldSession(source.events, dayOf(created.createdAt), local)
        // Index entries require a canonical total matching all four buckets;
        // finalize before persistence instead of leaving the fold's initial 0.
        const cells = [...local.values()].map((cell) => ({ ...cell, totals: { ...cell.totals }, total: sumOf(cell.totals) }))
        await usageIndex.put(id, fp, cells); indexed++; status = 'indexed'
      } catch (error) { failed++; status = 'failed'; await onError?.(id, error) }
    }
    completed++
    await onProgress?.({ completed, total: closed.length, indexed, skipped, failed, sessionId: id, status })
    if (completed % yieldEvery === 0) await new Promise<void>(resolve => setImmediate(resolve))
  }
  return { completed, total: closed.length, indexed, skipped, failed, cancelled: false }
}

export interface UsageIndexIncrementOptions extends UsageIndexBuildOptions {
  /** Maximum number of changed session logs read concurrently. */
  concurrency?: number
  /** Reuse a just-completed header inspection instead of listing every session twice. */
  inspection?: UsageIndexInspection
}
export interface UsageIndexIncrementResult extends Omit<UsageIndexBuildResult, 'cancelled'> {
  cancelled: boolean
  removed: number
}

export interface UsageIndexInspection {
  records: Awaited<ReturnType<SessionQueryService['listSessions']>>
  closed: number
  live: number
  indexed: number
  pending: number
  pendingRecords: Awaited<ReturnType<SessionQueryService['listSessions']>>
  removedIds: string[]
}

/** Cheap index/header comparison. It never opens a session log. */
export async function inspectSessionUsageIndex(sessionQuery: SessionQueryService, usageIndex: FileSessionUsageIndex, signal?: AbortSignal): Promise<UsageIndexInspection> {
  const records = await sessionQuery.listSessions(signal)
  const existing = await usageIndex.entries()
  const active = new Set(records.map(record => record.header.id))
  const closedRecords = records.filter(record => !record.live)
  const matches = await Promise.all(closedRecords.map(async record =>
    (await usageIndex.lookup(record.header.id, sessionFingerprint(record))) !== undefined))
  const pendingRecords = closedRecords.filter((_record, index) => !matches[index])
  return {
    records,
    closed: closedRecords.length,
    live: records.length - closedRecords.length,
    indexed: matches.filter(Boolean).length,
    pending: pendingRecords.length,
    pendingRecords,
    removedIds: Object.keys(existing).filter(id => !active.has(id)),
  }
}

/**
 * Refresh only new/changed closed sessions after an index has been built.
 * Stable headers are eliminated before progress starts, so `total` and
 * `completed` describe only new/changed work and never include live sessions.
 */
export async function incrementSessionUsageIndex(sessionQuery: SessionQueryService, usageIndex: FileSessionUsageIndex, options: UsageIndexIncrementOptions = {}): Promise<UsageIndexIncrementResult> {
  const { signal, onProgress, onError } = options
  const inspection = options.inspection ?? await inspectSessionUsageIndex(sessionQuery, usageIndex, signal)
  const pending = inspection.pendingRecords
  const removedIds = inspection.removedIds
  const writes: Array<{ sessionId: string; fingerprint: SessionUsageFingerprint; cells: ModelDayTotals[] }> = []
  let cursor = 0; let indexed = 0; const skipped = inspection.indexed; let failed = 0; let completed = 0
  const concurrency = Math.max(1, Math.min(4, Math.floor(options.concurrency ?? 2)))
  const process = async (): Promise<void> => {
    while (true) {
      if (signal?.aborted) return
      const record = pending[cursor++]
      if (!record) return
      const id = record.header.id; const fp = sessionFingerprint(record)
      try {
        const source = await sessionQuery.readSession(id)
        const created = typeof (source.session as { createdAt?: unknown })?.createdAt === 'number' ? source.session as { createdAt: number } : { createdAt: 0 }
        const local = new Map<string, ModelDayTotals>(); foldSession(source.events, dayOf(created.createdAt), local)
        const cells = [...local.values()].map(cell => ({ ...cell, totals: { ...cell.totals }, total: sumOf(cell.totals) }))
        // A missing fingerprint cannot safely be invalidated/cached.
        if (Object.keys(fp).length > 0) writes.push({ sessionId: id, fingerprint: fp, cells })
        indexed++; completed++; await onProgress?.({ completed, total: pending.length, indexed, skipped, failed, sessionId: id, status: 'indexed' })
      } catch (error) { failed++; completed++; await onError?.(id, error); await onProgress?.({ completed, total: pending.length, indexed, skipped, failed, sessionId: id, status: 'failed' }) }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, () => process()))
  if (writes.length > 0) await usageIndex.putMany(writes)
  if (removedIds.length > 0) await usageIndex.invalidateMany(removedIds)
  return { completed, total: pending.length, indexed, skipped, failed, cancelled: Boolean(signal?.aborted), removed: removedIds.length }
}

export async function aggregateCumulativeUsage(sessionQuery: SessionQueryService, signal?: AbortSignal, usageIndex?: FileSessionUsageIndex): Promise<CumulativeUsage> {
  signal?.throwIfAborted(); const records = await sessionQuery.listSessions(signal); const map = new Map<string, ModelDayTotals>(); let scanned = 0
  for (let i = 0; i < records.length; i += 4) {
    const results = await Promise.all(records.slice(i, i + 4).map(async r => {
      const fp = sessionFingerprint(r)
      if (!r.live && usageIndex) { const cached = await usageIndex.lookup(r.header.id, fp); if (cached) return cached }
      try { const source = await sessionQuery.readSession(r.header.id); const created = typeof (source.session as { createdAt?: unknown })?.createdAt === 'number' ? source.session as { createdAt: number } : { createdAt: 0 }; const local = new Map<string, ModelDayTotals>(); foldSession(source.events, dayOf(created.createdAt), local); return [...local.values()] } catch { return null }
    }))
    for (const cells of results) { if (!cells) continue; scanned++; for (const c of cells) { const id = `${c.provider}\0${c.model}\0${c.day}`; const old = map.get(id); if (old) old.totals = add(old.totals, c.totals); else map.set(id, { ...c, totals: { ...c.totals } }) } }
  }
  const cells = [...map.values()]; let totals = { ...ZERO }; const models = new Map<string, { provider: string; model: string; total: number }>(); const days = new Set<string>()
  for (const c of cells) { c.total = sumOf(c.totals); totals = add(totals, c.totals); days.add(c.day); const id = `${c.provider}\0${c.model}`; const m = models.get(id) ?? { provider: c.provider, model: c.model, total: 0 }; m.total += c.total; models.set(id, m) }
  return { sessions: scanned, totals, total: sumOf(totals), byModelDay: cells, models: [...models.values()].sort((a, b) => b.total - a.total), days: [...days].sort().reverse() }
}
