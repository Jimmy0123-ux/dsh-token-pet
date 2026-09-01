/** Persistent per-session usage folds with cheap incremental invalidation.
 *
 * The index is only an optimization: callers must fall back to folding the
 * session log whenever an entry is missing, malformed, or its fingerprint has
 * changed. Writes are best-effort and never make usage aggregation fail.
 */
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ModelDayTotals } from './usage.js'

export interface SessionUsageFingerprint {
  /** Source log identity when available (mtime/size or host revision). */
  revision?: string | number
  /** Header updated time; changing it invalidates a closed-session fold. */
  updatedAt?: string | number
  /** Number of events, if the host supplies it. */
  eventCount?: number
}
export interface SessionUsageIndexEntry {
  fingerprint: SessionUsageFingerprint
  cells: ModelDayTotals[]
}
export interface SessionUsageIndexState {
  version: 1
  sessions: Record<string, SessionUsageIndexEntry>
}

const EMPTY: SessionUsageIndexState = { version: 1, sessions: Object.create(null) as Record<string, SessionUsageIndexEntry> }
const MAX_INDEX_BYTES = 16 * 1024 * 1024
// All instances in this process share a per-file mutation queue. Mutations
// reload the primary file while holding it, preventing stale instance caches
// and shared temp names from losing concurrent updates.
const mutationQueues = new Map<string, Promise<void>>()
const validNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
function fingerprint(value: unknown): SessionUsageFingerprint {
  const v = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const out: SessionUsageFingerprint = {}
  if (typeof v.revision === 'string' || validNumber(v.revision)) out.revision = v.revision
  if (typeof v.updatedAt === 'string' || validNumber(v.updatedAt)) out.updatedAt = v.updatedAt
  if (validNumber(v.eventCount) && v.eventCount >= 0) out.eventCount = v.eventCount
  return out
}
function hasFingerprint(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  // Never normalize an explicitly malformed field away: it could otherwise
  // turn a corrupt fingerprint into a matching partial fingerprint.
  if ('revision' in v && !(typeof v.revision === 'string' || validNumber(v.revision))) return false
  if ('updatedAt' in v && !(typeof v.updatedAt === 'string' || validNumber(v.updatedAt))) return false
  if ('eventCount' in v && !(validNumber(v.eventCount) && v.eventCount >= 0)) return false
  const f = fingerprint(value)
  return f.revision !== undefined || f.updatedAt !== undefined || f.eventCount !== undefined
}
function sameFingerprint(a: SessionUsageFingerprint, b: SessionUsageFingerprint): boolean {
  return hasFingerprint(a) && hasFingerprint(b) && a.revision === b.revision && a.updatedAt === b.updatedAt && a.eventCount === b.eventCount
}
function cells(value: unknown): ModelDayTotals[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: ModelDayTotals[] = []
  for (const c of value) {
    if (!c || typeof c !== 'object') return undefined
    const x = c as Partial<ModelDayTotals>
    const t = x.totals
    if (typeof x.provider !== 'string' || x.provider === '' || typeof x.model !== 'string' || x.model === '' ||
      typeof x.day !== 'string' || x.day === '' || !t || !validNumber(t.uncachedInputTokens) || t.uncachedInputTokens < 0 ||
      !validNumber(t.outputTokens) || t.outputTokens < 0 || !validNumber(t.cacheReadTokens) || t.cacheReadTokens < 0 ||
      !validNumber(t.cacheWriteTokens) || t.cacheWriteTokens < 0 || !validNumber(x.total) || x.total < 0 ||
      x.total !== t.uncachedInputTokens + t.outputTokens + t.cacheReadTokens + t.cacheWriteTokens) return undefined
    out.push({ provider: x.provider, model: x.model, day: x.day, totals: { ...t }, total: x.total })
  }
  return out
}
function normalize(value: unknown): SessionUsageIndexState {
  if (!value || typeof value !== 'object') return { ...EMPTY, sessions: Object.create(null) as Record<string, SessionUsageIndexEntry> }
  const v = value as Partial<SessionUsageIndexState>
  if (v.version !== 1 || !v.sessions || typeof v.sessions !== 'object') return { ...EMPTY, sessions: Object.create(null) as Record<string, SessionUsageIndexEntry> }
  const out: Record<string, SessionUsageIndexEntry> = Object.create(null) as Record<string, SessionUsageIndexEntry>
  for (const [id, raw] of Object.entries(v.sessions)) {
    if (!raw || typeof raw !== 'object') continue
    const entry = raw as Partial<SessionUsageIndexEntry>
    const folded = cells(entry.cells)
    // A single malformed cell invalidates the complete session entry.
    if (folded !== undefined && entry.fingerprint && typeof entry.fingerprint === 'object' && hasFingerprint(entry.fingerprint)) out[id] = { fingerprint: fingerprint(entry.fingerprint), cells: folded }
  }
  return { version: 1, sessions: out }
}

export class FileSessionUsageIndex {
  private readonly file: string
  private state: SessionUsageIndexState | undefined
  private persisted = false
  private readInFlight: Promise<SessionUsageIndexState> | undefined
  constructor(baseDir: string, fileName = 'session-usage-index.json') { this.file = join(baseDir, fileName) }
  async read(): Promise<SessionUsageIndexState> {
    if (this.state) return this.state
    if (this.readInFlight) return this.readInFlight
    this.readInFlight = (async () => {
      // Never treat an interrupted write as authoritative. A leftover temp file
      // is safe to discard; the primary index is always the source of truth.
      await unlink(`${this.file}.tmp`).catch(() => {})
      try {
        const raw = await readFile(this.file)
        if (raw.byteLength > MAX_INDEX_BYTES) throw new Error('session usage index exceeds safety limit')
        const parsed: unknown = JSON.parse(raw.toString('utf8'))
        this.state = normalize(parsed)
        // Only a structurally valid document counts as an initialized index.
        this.persisted = Boolean(parsed && typeof parsed === 'object' &&
          (parsed as { version?: unknown }).version === 1 &&
          (parsed as { sessions?: unknown }).sessions &&
          typeof (parsed as { sessions?: unknown }).sessions === 'object')
      } catch {
        this.persisted = false
        this.state = { version: 1, sessions: Object.create(null) as Record<string, SessionUsageIndexEntry> }
      }
      return this.state!
    })()
    try { return await this.readInFlight } finally { this.readInFlight = undefined }
  }
  async lookup(sessionId: string, current: SessionUsageFingerprint): Promise<ModelDayTotals[] | undefined> {
    const entry = (await this.read()).sessions[sessionId]
    // Validate the raw caller fingerprint before normalization; otherwise an
    // invalid field could be silently dropped and match a partial fingerprint.
    if (!entry || !hasFingerprint(current) || !sameFingerprint(entry.fingerprint, current)) return undefined
    return entry.cells.map(c => ({ ...c, totals: { ...c.totals } }))
  }
  async put(sessionId: string, source: SessionUsageFingerprint, folded: ModelDayTotals[]): Promise<void> {
    await this.putMany([{ sessionId, fingerprint: source, cells: folded }])
  }
  /** Store a rebuild batch with one atomic disk replacement. */
  async putMany(entries: Array<{ sessionId: string; fingerprint: SessionUsageFingerprint; cells: ModelDayTotals[] }>): Promise<void> {
    if (entries.length === 0) return
    await this.mutate((state) => {
      for (const entry of entries) {
        const folded = cells(entry.cells)
        if (folded === undefined || !hasFingerprint(entry.fingerprint)) delete state.sessions[entry.sessionId]
        else state.sessions[entry.sessionId] = { fingerprint: fingerprint(entry.fingerprint), cells: folded }
      }
    })
  }
  async invalidate(sessionId?: string): Promise<void> {
    await this.mutate((state) => {
      if (sessionId === undefined) state.sessions = Object.create(null) as Record<string, SessionUsageIndexEntry>
      else delete state.sessions[sessionId]
    })
  }
  async invalidateMany(sessionIds: readonly string[]): Promise<void> {
    if (sessionIds.length === 0) return
    await this.mutate((state) => { for (const id of sessionIds) delete state.sessions[id] })
  }
  async entries(): Promise<Record<string, SessionUsageIndexEntry>> { return (await this.read()).sessions }
  /** Whether a valid index document has been loaded or persisted. */
  async isPersisted(): Promise<boolean> { await this.read(); return this.persisted }
  /** Materialize an empty index too, so a zero-session host does not rebuild forever. */
  async ensurePersisted(): Promise<void> { await this.read(); if (!this.persisted) await this.mutate(() => {}) }
  private async loadFresh(): Promise<SessionUsageIndexState> {
    try {
      const raw = await readFile(this.file)
      if (raw.byteLength > MAX_INDEX_BYTES) throw new Error('session usage index exceeds safety limit')
      const parsed: unknown = JSON.parse(raw.toString('utf8'))
      const valid = Boolean(parsed && typeof parsed === 'object' && (parsed as { version?: unknown }).version === 1 && (parsed as { sessions?: unknown }).sessions && typeof (parsed as { sessions?: unknown }).sessions === 'object')
      this.persisted = valid
      return valid ? normalize(parsed) : { version: 1, sessions: Object.create(null) as Record<string, SessionUsageIndexEntry> }
    } catch {
      this.persisted = false
      return { version: 1, sessions: Object.create(null) as Record<string, SessionUsageIndexEntry> }
    }
  }
  private async mutate(change: (state: SessionUsageIndexState) => void): Promise<void> {
    const previous = mutationQueues.get(this.file) ?? Promise.resolve()
    const work = previous.catch(() => {}).then(async () => {
      const state = await this.loadFresh()
      change(state)
      const data = JSON.stringify(state)
      await mkdir(dirname(this.file), { recursive: true })
      const tmp = `${this.file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
      try { await writeFile(tmp, data, 'utf8'); await rename(tmp, this.file) } finally { await unlink(tmp).catch(() => {}) }
      this.state = state
      this.persisted = true
    })
    mutationQueues.set(this.file, work)
    try { await work } finally { if (mutationQueues.get(this.file) === work) mutationQueues.delete(this.file) }
  }
}

export function sessionUsageIndexPath(baseDir: string): string { return join(baseDir, 'session-usage-index.json') }
