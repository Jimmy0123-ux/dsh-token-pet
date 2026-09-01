/** Durable, event-driven hourly usage projection.
 *
 * Normal reads only deserialize this small snapshot. Live sessions advance the
 * projection from the global `session/event` firehose; persistence `readFrom`
 * is reserved for gap repair and explicit/first-time rebuilds.
 */
import { createHash } from 'node:crypto'
import { mkdir, open, readFile, readdir, rename, stat, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { TodayUsageTrend, UsageBuckets, UsageEvent, UsageTrendPoint } from './usage.js'

export interface SequencedUsageEvent extends UsageEvent { seq?: number }
export interface TrendPersistenceSnapshot { header: { id: string }; revision: unknown }
export interface TrendPersistenceService {
  listSnapshots(signal?: AbortSignal): Promise<TrendPersistenceSnapshot[]>
  readFrom(id: string, fromSeq: number, signal?: AbortSignal): Promise<{ meta: unknown; events: SequencedUsageEvent[] }>
}
interface Observation { cell: string; totals: UsageBuckets; terminal: boolean }
interface SessionFold { nextSeq: number; revision?: string; model?: { provider: string; model: string }; observations: Record<string, Observation> }
interface HourCell { at: number; provider: string; model: string; totals: UsageBuckets; count: number }
interface Payload { sessions: Record<string, SessionFold>; cells: Record<string, HourCell>; updatedAt: number }
interface Envelope { version: 1; checksum: string; payload: Payload }
export type TrendIndexHealth = 'ready' | 'missing' | 'corrupt'
export interface TrendApplyResult { applied: boolean; repairFrom?: number }
export interface TrendIndexInspection { health: TrendIndexHealth; updatedAt: number; sessions: number; cells: number }

const ZERO = (): UsageBuckets => ({ uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
const MAX_BYTES = 8 * 1024 * 1024
const RETAIN_MS = 72 * 60 * 60 * 1000
const queues = new Map<string, Promise<void>>()
const pos = (v: unknown): number => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0
const total = (b: UsageBuckets): number => b.uncachedInputTokens + b.outputTokens + b.cacheReadTokens + b.cacheWriteTokens
const add = (a: UsageBuckets, b: UsageBuckets, sign = 1): UsageBuckets => ({
  uncachedInputTokens: Math.max(0, a.uncachedInputTokens + sign * b.uncachedInputTokens),
  outputTokens: Math.max(0, a.outputTokens + sign * b.outputTokens),
  cacheReadTokens: Math.max(0, a.cacheReadTokens + sign * b.cacheReadTokens),
  cacheWriteTokens: Math.max(0, a.cacheWriteTokens + sign * b.cacheWriteTokens),
})
function checksum(payload: Payload): string { return createHash('sha256').update(JSON.stringify(payload)).digest('hex') }
export function trendRevisionKey(revision: unknown): string { return JSON.stringify(revision) ?? String(revision) }
function blank(): Payload { return { sessions: Object.create(null) as Record<string, SessionFold>, cells: Object.create(null) as Record<string, HourCell>, updatedAt: 0 } }
function validBuckets(v: unknown): v is UsageBuckets {
  if (!v || typeof v !== 'object') return false
  const b = v as Record<string, unknown>
  return ['uncachedInputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'].every(k => typeof b[k] === 'number' && Number.isFinite(b[k]) && (b[k] as number) >= 0)
}
function validPayload(v: unknown): v is Payload {
  if (!v || typeof v !== 'object') return false
  const p = v as Partial<Payload>
  if (!p.sessions || typeof p.sessions !== 'object' || !p.cells || typeof p.cells !== 'object' || typeof p.updatedAt !== 'number') return false
  for (const s of Object.values(p.sessions)) {
    if (!s || !Number.isSafeInteger(s.nextSeq) || s.nextSeq < 0 || !s.observations || typeof s.observations !== 'object') return false
    for (const o of Object.values(s.observations)) if (!o || typeof o.cell !== 'string' || !validBuckets(o.totals) || typeof o.terminal !== 'boolean') return false
  }
  for (const c of Object.values(p.cells)) if (!c || !Number.isFinite(c.at) || typeof c.provider !== 'string' || typeof c.model !== 'string' || !validBuckets(c.totals) || !Number.isSafeInteger(c.count) || c.count < 0) return false
  return true
}
function usageOf(event: UsageEvent): Record<string, unknown> | undefined {
  const d = event.data as Record<string, unknown> | undefined
  if (event.type === 'assistant/chunk') {
    const chunk = d?.chunk as Record<string, unknown> | undefined
    const usage = chunk?.type === 'usage' ? chunk.usage : undefined
    return usage && typeof usage === 'object' ? usage as Record<string, unknown> : undefined
  }
  if (event.type === 'assistant/message' || event.type === 'step/end' || event.type === 'turn/end') {
    const usage = d?.usage ?? (d?.step as Record<string, unknown> | undefined)?.usage ?? (d?.turn as Record<string, unknown> | undefined)?.usage
    return usage && typeof usage === 'object' ? usage as Record<string, unknown> : undefined
  }
  return undefined
}
function bucket(v: Record<string, unknown>): UsageBuckets { return { uncachedInputTokens: pos(v.inputTokens), outputTokens: pos(v.outputTokens), cacheReadTokens: pos(v.cacheReadTokens), cacheWriteTokens: pos(v.cacheWriteTokens) } }
function part(v: unknown): string | number | undefined {
  if (typeof v === 'string' && v !== '') return v
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (v && typeof v === 'object') return part((v as { id?: unknown }).id)
  return undefined
}
function identity(event: UsageEvent): string | undefined {
  const d = event.data as Record<string, unknown> | undefined
  const turn = part(d?.turnId) ?? part(d?.turn); const step = part(d?.stepId) ?? part(d?.step)
  return turn !== undefined && step !== undefined ? `${String(turn)}\0${String(step)}` : undefined
}
function isTerminal(type?: string): boolean { return type === 'turn/end' || type === 'step/end' || type === 'assistant/message' }
function epochMs(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return undefined
  return v < 1e11 ? v * 1000 : v > 1e14 ? v / 1000 : v
}
function modelOf(event: UsageEvent): { provider: string; model: string } | undefined {
  if (event.type !== 'request/header') return undefined
  const h = (event.data as { header?: { config?: { provider?: unknown; model?: unknown }; provider?: unknown; model?: unknown } } | undefined)?.header
  const provider = typeof h?.config?.provider === 'string' && h.config.provider ? h.config.provider : typeof h?.provider === 'string' ? h.provider : undefined
  const model = typeof h?.config?.model === 'string' && h.config.model ? h.config.model : typeof h?.model === 'string' ? h.model : undefined
  return provider && model ? { provider, model } : undefined
}
function applyOne(payload: Payload, sessionId: string, event: SequencedUsageEvent, now = Date.now()): TrendApplyResult {
  const seq = event.seq
  const session = payload.sessions[sessionId] ?? { nextSeq: 0, observations: Object.create(null) as Record<string, Observation> }
  payload.sessions[sessionId] = session
  if (Number.isSafeInteger(seq) && (seq as number) < session.nextSeq) return { applied: false }
  if (Number.isSafeInteger(seq) && (seq as number) > session.nextSeq) return { applied: false, repairFrom: session.nextSeq }
  const model = modelOf(event); if (model) session.model = model
  const usage = usageOf(event); const at = epochMs(event.time)
  // This projection serves only local "today" views. Advance the durable
  // cursor through old history, but never retain old observations/cells.
  if (usage && at !== undefined && at >= now - RETAIN_MS) {
    const id = identity(event); const observationKey = id === undefined ? `seq:${seq ?? session.nextSeq}` : `identity:${id}`
    const terminal = isTerminal(event.type); const old = session.observations[observationKey]
    if (!old || terminal || !old.terminal) {
      if (old) {
        const oldCell = payload.cells[old.cell]
        if (oldCell) { oldCell.totals = add(oldCell.totals, old.totals, -1); oldCell.count = Math.max(0, oldCell.count - 1); if (oldCell.count === 0 && total(oldCell.totals) === 0) delete payload.cells[old.cell] }
      }
      const route = session.model ?? { provider: '(unknown)', model: '(unknown)' }
      const hour = Math.floor(at / 3_600_000) * 3_600_000
      const cellKey = `${hour}\0${route.provider}\0${route.model}`; const cell = payload.cells[cellKey] ?? { at: hour, ...route, totals: ZERO(), count: 0 }
      const totals = bucket(usage); cell.totals = add(cell.totals, totals); cell.count++; payload.cells[cellKey] = cell
      session.observations[observationKey] = { cell: cellKey, totals, terminal }
    }
  }
  session.nextSeq = Number.isSafeInteger(seq) ? (seq as number) + 1 : session.nextSeq + 1
  payload.updatedAt = now
  return { applied: true }
}
const formatters = new Map<string, Intl.DateTimeFormat>()
function prune(payload: Payload, now = Date.now()): void {
  const cutoff = now - RETAIN_MS
  for (const [key, cell] of Object.entries(payload.cells)) if (cell.at < cutoff) delete payload.cells[key]
  for (const session of Object.values(payload.sessions)) {
    for (const [key, observation] of Object.entries(session.observations)) if (!payload.cells[observation.cell]) delete session.observations[key]
  }
}

async function replaceFileWithRetry(source: string, target: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try { await rename(source, target); return } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM' || attempt >= 9) throw error
      await new Promise<void>(resolve => setTimeout(resolve, 10 * (attempt + 1)))
    }
  }
}

function local(at: number, timeZone: string): { date: string; hour: number } {
  let f = formatters.get(timeZone); if (!f) { f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }); formatters.set(timeZone, f) }
  const p: Record<string, string> = {}; for (const x of f.formatToParts(at)) if (x.type !== 'literal') p[x.type] = x.value
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) }
}

export class FileHourlyTrendIndex {
  private payload?: Payload
  private health: TrendIndexHealth = 'missing'
  private loadFlight?: Promise<Payload>
  constructor(private readonly file: string, private readonly clock: () => number = Date.now) {}
  static at(baseDir: string): FileHourlyTrendIndex { return new FileHourlyTrendIndex(join(baseDir, 'hourly-trend-index.json')) }
  get path(): string { return this.file }
  async status(): Promise<TrendIndexHealth> { await this.read(); return this.health }
  /** Snapshot metadata only: never lists sessions or opens a transcript. */
  async inspect(): Promise<TrendIndexInspection> {
    const payload = await this.read()
    return { health: this.health, updatedAt: payload.updatedAt, sessions: Object.keys(payload.sessions).length, cells: Object.keys(payload.cells).length }
  }
  async checkpoint(sessionId: string): Promise<{ nextSeq: number; revision?: string } | undefined> {
    const session = (await this.read()).sessions[sessionId]
    return session ? { nextSeq: session.nextSeq, revision: session.revision } : undefined
  }
  async setRevision(sessionId: string, revision: unknown): Promise<void> {
    const encoded = trendRevisionKey(revision)
    await this.mutate(payload => { const session = payload.sessions[sessionId]; if (session) session.revision = encoded })
  }
  async retainSessions(sessionIds: ReadonlySet<string>): Promise<void> {
    const current = Object.keys((await this.read()).sessions)
    if (current.every(sessionId => sessionIds.has(sessionId))) return
    await this.mutate(payload => {
      for (const sessionId of Object.keys(payload.sessions)) if (!sessionIds.has(sessionId)) this.removeSession(payload, sessionId)
    })
  }
  async read(): Promise<Payload> {
    if (this.payload) return this.payload
    if (this.loadFlight) return this.loadFlight
    this.loadFlight = (async () => {
      const dir = dirname(this.file); const prefix = `${basename(this.file)}.`
      const staleBefore = Date.now() - 60_000
      await readdir(dir).then(names => Promise.all(names.filter(name => name.startsWith(prefix) && name.endsWith('.tmp')).map(async name => {
        const candidate = join(dir, name)
        const info = await stat(candidate).catch(() => undefined)
        if (info && info.mtimeMs < staleBefore) await unlink(candidate).catch(() => {})
      }))).catch(() => {})
      try {
        const raw = await readFile(this.file); if (raw.byteLength > MAX_BYTES) throw new Error('oversize')
        const parsed = JSON.parse(raw.toString('utf8')) as Partial<Envelope>
        if (parsed.version !== 1 || typeof parsed.checksum !== 'string' || !validPayload(parsed.payload) || checksum(parsed.payload) !== parsed.checksum) throw new Error('invalid trend index')
        this.health = 'ready'; return (this.payload = parsed.payload)
      } catch (error) {
        this.health = (error as NodeJS.ErrnoException)?.code === 'ENOENT' ? 'missing' : 'corrupt'
        return (this.payload = blank())
      }
    })()
    try { return await this.loadFlight } finally { this.loadFlight = undefined }
  }
  async trend(timeZone: string, now = Date.now()): Promise<TodayUsageTrend> {
    const payload = await this.read(); const date = local(now, timeZone).date
    const points = Array.from({ length: 24 }, (_, hour) => ({ hour: String(hour).padStart(2, '0'), hourOfDay: hour, totals: ZERO(), total: 0, count: 0 }))
    const sessions = new Set<string>()
    for (const [sessionId, session] of Object.entries(payload.sessions)) {
      let included = false
      for (const o of Object.values(session.observations)) { const cell = payload.cells[o.cell]; if (cell && cell.at <= now && local(cell.at, timeZone).date === date) { included = true; break } }
      if (included) sessions.add(sessionId)
    }
    for (const cell of Object.values(payload.cells)) {
      if (cell.at > now) continue
      const p = local(cell.at, timeZone); if (p.date !== date || !points[p.hour]) continue
      points[p.hour]!.totals = add(points[p.hour]!.totals, cell.totals); points[p.hour]!.count += cell.count; points[p.hour]!.total = total(points[p.hour]!.totals)
    }
    const totals = points.reduce((a, p) => add(a, p.totals), ZERO()); const first = points.findIndex(p => p.count > 0 || p.total > 0)
    if (first < 0) return { date, timeZone, sessions: sessions.size, totals, total: total(totals), byHour: [] }
    let last = 23; while (last > first && points[last]!.count === 0 && points[last]!.total === 0) last--
    return { date, timeZone, sessions: sessions.size, totals, total: total(totals), byHour: points.slice(first, last + 1) }
  }
  async applyEvent(sessionId: string, event: SequencedUsageEvent): Promise<TrendApplyResult> {
    let result: TrendApplyResult = { applied: false }
    await this.mutate(payload => { result = applyOne(payload, sessionId, event, this.clock()) })
    return result
  }
  async applyEvents(sessionId: string, events: readonly SequencedUsageEvent[], replace = false, revision?: unknown): Promise<TrendApplyResult> {
    let result: TrendApplyResult = { applied: false }
    await this.mutate(payload => {
      if (replace) this.removeSession(payload, sessionId)
      const now = this.clock()
      for (const event of events) { result = applyOne(payload, sessionId, event, now); if (result.repairFrom !== undefined) break }
      if (result.repairFrom === undefined && revision !== undefined) {
        const session = payload.sessions[sessionId]
        if (session) session.revision = trendRevisionKey(revision)
      }
    })
    return result
  }
  async replaceAll(sources: Array<{ sessionId: string; revision?: unknown; events: SequencedUsageEvent[] }>, signal?: AbortSignal): Promise<void> {
    const replacement = blank()
    const now = this.clock()
    let folded = 0
    for (const source of sources) {
      signal?.throwIfAborted()
      for (const event of source.events) {
        applyOne(replacement, source.sessionId, event, now)
        if (++folded % 1_000 === 0) await new Promise<void>(resolve => setImmediate(resolve))
      }
      const session = replacement.sessions[source.sessionId]
      if (session && source.revision !== undefined) session.revision = trendRevisionKey(source.revision)
    }
    replacement.updatedAt = now
    await this.mutate(payload => { payload.sessions = replacement.sessions; payload.cells = replacement.cells; payload.updatedAt = replacement.updatedAt })
  }
  private removeSession(payload: Payload, sessionId: string): void {
    const session = payload.sessions[sessionId]; if (!session) return
    for (const o of Object.values(session.observations)) { const cell = payload.cells[o.cell]; if (!cell) continue; cell.totals = add(cell.totals, o.totals, -1); cell.count = Math.max(0, cell.count - 1); if (cell.count === 0 && total(cell.totals) === 0) delete payload.cells[o.cell] }
    delete payload.sessions[sessionId]
  }
  private async mutate(change: (payload: Payload) => void): Promise<void> {
    const prior = queues.get(this.file) ?? Promise.resolve()
    const work = prior.catch(() => {}).then(async () => {
      const payload = await this.read(); change(payload); prune(payload, this.clock())
      const envelope: Envelope = { version: 1, checksum: checksum(payload), payload }
      await mkdir(dirname(this.file), { recursive: true }); const tmp = `${this.file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
      try {
        const handle = await open(tmp, 'w')
        try { await handle.writeFile(JSON.stringify(envelope), 'utf8'); await handle.sync() } finally { await handle.close() }
        await replaceFileWithRetry(tmp, this.file)
        const dirHandle = await open(dirname(this.file), 'r').catch(() => undefined)
        if (dirHandle) { try { await dirHandle.sync().catch(() => {}) } finally { await dirHandle.close() } }
      } finally { await unlink(tmp).catch(() => {}) }
      this.health = 'ready'
    })
    queues.set(this.file, work); try { await work } finally { if (queues.get(this.file) === work) queues.delete(this.file) }
  }
}

export function hourlyTrendIndexPath(baseDir: string): string { return join(baseDir, 'hourly-trend-index.json') }
