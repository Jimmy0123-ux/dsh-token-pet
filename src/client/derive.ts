import { growthStageAt } from '../growth'

/**
 * Pure helpers that narrow the framework's real session projections to the
 * figures the token pet renders. Every guard is fail-closed: a missing or
 * partial value degrades to `null` / defaults so the pet and panel never
 * crash on a host without a given projection key.
 *
 * Projection keys (all delivered client-side by DSH core + dsh-context):
 *   - contextPressure  { contextWindow?, pressureTokens?, projectedTokens? }
 *   - contextBreakdown { systemTokens, toolsTokens, messageTokens }
 *   - tokenUsage       { uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }
 *   - sessionStats     { turns, steps, llmMs, toolMs, ttftMs, ttftSteps, decodeMs, decodeTokens }
 *   - contextTimeline  { current:{system,tools,user,inject,assistant,tool,total}, events:[...], contextWindow? }
 *   - todayUsageBuckets { buckets:[{start,end,total,count}] } (client trend contract; epoch ms)
 * @module dsh-token-pet/derive
 */

export interface Pressure {
  contextWindow?: number
  pressureTokens?: number
  projectedTokens?: number
}

export interface Breakdown {
  systemTokens: number
  toolsTokens: number
  messageTokens: number
}

export interface TokenUsage {
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export interface SessionStats {
  turns: number
  steps: number
  llmMs: number
  toolMs: number
  ttftMs: number
  ttftSteps: number
  decodeMs: number
  decodeTokens: number
}

export interface TimelineCurrent {
  system: number
  tools: number
  user: number
  inject: number
  assistant: number
  tool: number
  total: number
}

export interface TimelineRequest {
  turn?: number
  step?: number
  time: number
  seq: number
  total: number
}

export interface Timeline {
  model?: string
  provider?: string
  contextWindow?: number
  current?: Partial<TimelineCurrent>
  requests?: Array<Partial<TimelineRequest>>
  events?: unknown[]
}

/** One local-time hour bucket supplied by the host's today trend projection. */
export interface TrendBucket {
  /** Start of the hour, epoch milliseconds (local-hour boundary). */
  start: number
  /** End of the hour (exclusive), epoch milliseconds. */
  end: number
  /** Total token usage attributed to this hour. */
  total: number
  /** Number of requests contributing to the bucket. */
  count: number
}

/**
 * Narrow the host-owned today buckets projection. The host computes local-day
 * boundaries and hourly attribution; the client only validates, sorts and caps
 * the display model so it never needs contextTimeline.requests.
 */
export function todayUsageBucketsOf(value: unknown, now = Date.now()): TrendBucket[] {
  const r = asRecord(value)
  const raw = r && Array.isArray(r.buckets) ? r.buckets : Array.isArray(value) ? value : []
  const buckets = raw.map((item) => {
    const b = asRecord(item)
    if (b === null) return null
    const start = num(b.start)
    const end = num(b.end)
    const total = num(b.total)
    const count = num(b.count)
    if (start === undefined || end === undefined || total === undefined || count === undefined || end <= start) return null
    return { start, end, total, count }
  }).filter((bucket): bucket is TrendBucket => bucket !== null && bucket.start <= now)
    .sort((a, b) => a.start - b.start)
    // Keep gaps inside the observed range, but never render leading/trailing
    // empty hours. This makes the x-axis follow actual usage data through now.
    .slice(-24)
  const first = buckets.findIndex((bucket) => bucket.total > 0 || bucket.count > 0)
  if (first < 0) return []
  let last = buckets.length - 1
  while (last > first) {
    const bucket = buckets[last]
    if (bucket === undefined || bucket.total > 0 || bucket.count > 0) break
    last -= 1
  }
  return buckets.slice(first, last + 1)
}

/** One model's cumulative total across all days. */
export interface CumulativeModel {
  provider: string
  model: string
  total: number
}

/** One (model, day) cell from the host aggregate. */
export interface CumulativeCell {
  provider: string
  model: string
  day: string
  totals: TokenUsage
  total: number
}

/** Cumulative token usage across all sessions, served by the host. */
export interface CumulativeUsage {
  sessions: number
  totals: TokenUsage
  total: number
  /** Per-model rollup (baseline-adjusted), descending total. */
  byModel?: CumulativeModel[]
  /** Distinct days present (baseline-adjusted), newest first. */
  days?: string[]
  /** Per-(model, day) cells (baseline-adjusted), for combined filtering. */
  byModelDay?: CumulativeCell[]
  /** Whether a 清空 baseline is currently applied. */
  baselineActive?: boolean
}

/** Lifetime Ledger is independent from the reversible cumulative baseline. */
export interface LifetimeLedgerUsage extends CumulativeUsage {
  clearedAt?: string
  refreshFailed?: number
  refreshListed?: number
}

/** Narrow any delivered projection value to a record, else null. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** Read a finite non-negative number from a record, else undefined. */
function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

export function pressureOf(value: unknown): Pressure | null {
  const r = asRecord(value)
  if (r === null) return null
  const out: Pressure = {}
  const cw = num(r.contextWindow)
  if (cw !== undefined) out.contextWindow = cw
  const pt = num(r.pressureTokens)
  if (pt !== undefined) out.pressureTokens = pt
  const pj = num(r.projectedTokens)
  if (pj !== undefined) out.projectedTokens = pj
  return Object.keys(out).length === 0 ? null : out
}

export function breakdownOf(value: unknown): Breakdown | null {
  const r = asRecord(value)
  if (r === null) return null
  const systemTokens = num(r.systemTokens)
  const toolsTokens = num(r.toolsTokens)
  const messageTokens = num(r.messageTokens)
  if (systemTokens === undefined || toolsTokens === undefined || messageTokens === undefined) return null
  return { systemTokens, toolsTokens, messageTokens }
}

export function tokenUsageOf(value: unknown): TokenUsage | null {
  const r = asRecord(value)
  if (r === null) return null
  const uncachedInputTokens = num(r.uncachedInputTokens)
  const outputTokens = num(r.outputTokens)
  const cacheReadTokens = num(r.cacheReadTokens)
  const cacheWriteTokens = num(r.cacheWriteTokens)
  if (uncachedInputTokens === undefined || outputTokens === undefined) return null
  return { uncachedInputTokens, outputTokens, cacheReadTokens: cacheReadTokens ?? 0, cacheWriteTokens: cacheWriteTokens ?? 0 }
}

/** Narrow the host-served cumulative figure; fail-closed to null. */
export function cumulativeOf(value: unknown): CumulativeUsage | null {
  const r = asRecord(value)
  if (r === null) return null
  const sessions = num(r.sessions)
  if (sessions === undefined) return null
  const totals = tokenUsageOf(r.totals)
  if (totals === null) return null
  const total = num(r.total)
  const out: CumulativeUsage = { sessions, totals, total: total ?? 0 }
  const modelRows = Array.isArray(r.byModel) ? r.byModel : Array.isArray(r.models) ? r.models : undefined
  if (modelRows) {
    out.byModel = modelRows
      .map((m) => {
        const mr = asRecord(m)
        if (mr === null) return null
        const t = num(mr.total)
        if (t === undefined || typeof mr.model !== 'string') return null
        return { provider: typeof mr.provider === 'string' ? mr.provider : '', model: mr.model, total: t }
      })
      .filter((x): x is CumulativeModel => x !== null)
  }
  if (Array.isArray(r.days)) out.days = r.days.filter((d): d is string => typeof d === 'string')
  if (Array.isArray(r.byModelDay)) {
    out.byModelDay = r.byModelDay
      .map((c) => {
        const cr = asRecord(c)
        if (cr === null) return null
        const total = num(cr.total)
        const totals = tokenUsageOf(cr.totals)
        if (total === undefined || typeof cr.model !== 'string' || typeof cr.day !== 'string' || totals === null) return null
        return {
          provider: typeof cr.provider === 'string' ? cr.provider : '',
          model: cr.model,
          day: cr.day,
          totals,
          total,
        }
      })
      .filter((x): x is CumulativeCell => x !== null)
  }
  if (typeof r.baselineActive === 'boolean') out.baselineActive = r.baselineActive
  return out
}

export function lifetimeLedgerOf(value: unknown): LifetimeLedgerUsage | null {
  const usage = cumulativeOf(value)
  if (usage === null) return null
  const record = asRecord(value)
  return {
    ...usage,
    ...(typeof record?.clearedAt === 'string' ? { clearedAt: record.clearedAt } : {}),
    ...(num(record?.refreshFailed) !== undefined ? { refreshFailed: num(record?.refreshFailed) } : {}),
    ...(num(record?.refreshListed) !== undefined ? { refreshListed: num(record?.refreshListed) } : {}),
  }
}

export function sessionStatsOf(value: unknown): SessionStats | null {
  const r = asRecord(value)
  if (r === null) return null
  const turns = num(r.turns)
  const steps = num(r.steps)
  if (turns === undefined || steps === undefined) return null
  return {
    turns,
    steps,
    llmMs: num(r.llmMs) ?? 0,
    toolMs: num(r.toolMs) ?? 0,
    ttftMs: num(r.ttftMs) ?? 0,
    ttftSteps: num(r.ttftSteps) ?? 0,
    decodeMs: num(r.decodeMs) ?? 0,
    decodeTokens: num(r.decodeTokens) ?? 0,
  }
}

export function timelineOf(value: unknown): Timeline | null {
  const r = asRecord(value)
  if (r === null) return null
  const out: Timeline = {}
  if (typeof r.model === 'string') out.model = r.model
  if (typeof r.provider === 'string') out.provider = r.provider
  const cw = num(r.contextWindow)
  if (cw !== undefined) out.contextWindow = cw
  const current = asRecord(r.current)
  if (current !== null) {
    const c: Partial<TimelineCurrent> = {}
    for (const k of ['system', 'tools', 'user', 'inject', 'assistant', 'tool', 'total'] as const) {
      const v = num(current[k])
      if (v !== undefined) c[k] = v
    }
    out.current = c
  }
  if (Array.isArray(r.requests)) {
    out.requests = r.requests
      .map((item) => {
        const q = asRecord(item)
        if (q === null) return null
        const total = num(q.total)
        if (total === undefined) return null
        const req: Partial<TimelineRequest> = { total, time: num(q.time) ?? 0, seq: num(q.seq) ?? 0 }
        const turn = num(q.turn)
        if (turn !== undefined) req.turn = turn
        const step = num(q.step)
        if (step !== undefined) req.step = step
        return req
      })
      .filter((x): x is Partial<TimelineRequest> => x !== null)
  }
  if (Array.isArray(r.events)) out.events = r.events
  return out
}

/** The occupancy percent (0..100), clamped. Fallback numerator: projectedTokens, then pressureTokens. */
export function occupancyPercent(pressure: Pressure | null): number | null {
  if (pressure === null) return null
  const window = pressure.contextWindow
  if (window === undefined || window <= 0) return null
  const used = pressure.projectedTokens ?? pressure.pressureTokens
  if (used === undefined) return null
  return Math.min(100, Math.max(0, (used / window) * 100))
}

/** Total billed-ish tokens for the pet's "satiety". */
export function totalBilled(usage: TokenUsage | null): number {
  if (usage === null) return 0
  return usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens + usage.outputTokens
}

/** Sum of a timeline's current composition, else 0. */
export function timelineTotal(timeline: Timeline | null): number {
  const c = timeline?.current
  if (c === undefined) return 0
  return (c.system ?? 0) + (c.tools ?? 0) + (c.user ?? 0) + (c.inject ?? 0) + (c.assistant ?? 0) + (c.tool ?? 0)
}

export type PressureBand = 'newborn' | 'growth' | 'active' | 'heavy' | 'overload' | 'critical'
/** Compatibility alias: stage now means pressure band, never visual identity. */
export type PetStage = PressureBand

export interface PetStageInfo {
  stage: PetStage
  label: string
  /** 0..1 normalized progress within the pressure band (for the meter). */
  progress: number
}

/**
 * Map context occupancy to an internal pressure band. All bands render the same
 * fixed identity and common action assets; only labels and subdued warnings vary.
 */
export function stageForPercent(percent: number | null): PetStageInfo {
  return growthStageAt(percent === null ? 0 : percent)
}

/** Format a large token count as "1.2k" / "8.4M". */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n)) return '–'
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`
  return `${(n / 1_000_000_000).toFixed(1)}B`
}

/** Format a millisecond duration compactly. */
export function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0ms'
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}

/**
 * Sanitise a style object so React never chokes on an indexed/number key or a
 * non-string/number value (which throws "Indexed property setter is not
 * supported" in React DOM). Odd keys and non-primitive values are dropped /
 * coerced so the always-mounted pet never crashes on a stray style value.
 */
export function css<T extends object>(obj: T | undefined): T {
  if (obj == null) return {} as T
  const out: Record<string, unknown> = {}
  const source = obj as Record<string, unknown>
  for (const k of Object.keys(source)) {
    const v = source[k]
    if (v == null || v === '') continue
    if (/\d+/.test(k)) continue // index-style key (style[0] = ...) would crash React DOM
    if (typeof v === 'object') out[k] = JSON.stringify(v)
    else out[k] = v
  }
  return out as T
}
