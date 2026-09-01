/** Durable, non-rollback lifetime token ledger. */
import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { foldSessionUsage, sessionFingerprint, summarizeUsageCells, type CumulativeUsage, type ModelDayTotals, type SessionQueryService } from './usage.js'
import type { FileSessionUsageIndex, SessionUsageFingerprint } from './session-usage-index.js'

export interface LifetimeSessionSnapshot {
  fingerprint: SessionUsageFingerprint
  live: boolean
  observed: ModelDayTotals[]
  credited: ModelDayTotals[]
  updatedAt: number
}
interface LifetimeLedgerPayload {
  version: 1
  generation: number
  sessions: Record<string, LifetimeSessionSnapshot>
  floors: Record<string, ModelDayTotals[]>
}
interface LifetimeLedgerDocument extends LifetimeLedgerPayload { checksum: string }
export interface LifetimeRefreshResult { usage: CumulativeUsage; listed: number; updated: number; retained: number; failed: number }

const MAX_LEDGER_BYTES = 64 * 1024 * 1024
const LOCK_STALE_MS = 5 * 60_000
const LOCK_HEARTBEAT_MS = 10_000
const LOCK_WAIT_MS = 10_000
const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))
function lockOwnerAlive(owner: string | undefined): boolean {
  const pid = Number(owner?.split(':', 1)[0])
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM' }
}
const emptyPayload = (generation = 0): LifetimeLedgerPayload => ({ version: 1, generation, sessions: Object.create(null) as Record<string, LifetimeSessionSnapshot>, floors: Object.create(null) as Record<string, ModelDayTotals[]> })
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const cellTotal = (cells: readonly ModelDayTotals[]): number => cells.reduce((sum, cell) => sum + cell.total, 0)
const cloneCells = (cells: readonly ModelDayTotals[]): ModelDayTotals[] => cells.map(cell => ({ ...cell, totals: { ...cell.totals } }))

function validCells(value: unknown): value is ModelDayTotals[] {
  if (!Array.isArray(value)) return false
  return value.every((raw) => {
    if (!raw || typeof raw !== 'object') return false
    const cell = raw as Partial<ModelDayTotals>; const totals = cell.totals
    return typeof cell.provider === 'string' && cell.provider !== '' && typeof cell.model === 'string' && cell.model !== '' &&
      typeof cell.day === 'string' && cell.day !== '' && totals !== undefined && finite(totals.uncachedInputTokens) &&
      finite(totals.outputTokens) && finite(totals.cacheReadTokens) && finite(totals.cacheWriteTokens) && finite(cell.total) &&
      cell.total === totals.uncachedInputTokens + totals.outputTokens + totals.cacheReadTokens + totals.cacheWriteTokens
  })
}
function validFingerprint(value: unknown): value is SessionUsageFingerprint {
  if (!value || typeof value !== 'object') return false
  const fp = value as Record<string, unknown>
  return (!('revision' in fp) || typeof fp.revision === 'string' || finite(fp.revision)) &&
    (!('updatedAt' in fp) || typeof fp.updatedAt === 'string' || finite(fp.updatedAt)) &&
    (!('eventCount' in fp) || finite(fp.eventCount))
}
function validatePayload(value: unknown): LifetimeLedgerPayload | undefined {
  if (!value || typeof value !== 'object') return undefined
  const payload = value as Partial<LifetimeLedgerPayload>
  if (payload.version !== 1 || !Number.isSafeInteger(payload.generation) || (payload.generation ?? -1) < 0 ||
      !payload.sessions || typeof payload.sessions !== 'object' || !payload.floors || typeof payload.floors !== 'object') return undefined
  const sessions: Record<string, LifetimeSessionSnapshot> = Object.create(null) as Record<string, LifetimeSessionSnapshot>
  for (const [id, raw] of Object.entries(payload.sessions)) {
    if (!id || !raw || typeof raw !== 'object') return undefined
    const item = raw as Partial<LifetimeSessionSnapshot>
    if (!validFingerprint(item.fingerprint) || typeof item.live !== 'boolean' || !validCells(item.observed) || !validCells(item.credited) || !finite(item.updatedAt)) return undefined
    sessions[id] = { fingerprint: { ...item.fingerprint }, live: item.live, observed: cloneCells(item.observed), credited: cloneCells(item.credited), updatedAt: item.updatedAt }
  }
  const floors: Record<string, ModelDayTotals[]> = Object.create(null) as Record<string, ModelDayTotals[]>
  for (const [id, cells] of Object.entries(payload.floors)) {
    if (!id || !validCells(cells)) return undefined
    floors[id] = cloneCells(cells)
  }
  return { version: 1, generation: payload.generation!, sessions, floors }
}
function encodedPayload(payload: LifetimeLedgerPayload): string { return JSON.stringify(payload) }
function checksum(payload: LifetimeLedgerPayload): string { return createHash('sha256').update(encodedPayload(payload)).digest('hex') }
function encode(payload: LifetimeLedgerPayload): string { return JSON.stringify({ ...payload, checksum: checksum(payload) }) }
function decode(raw: Buffer): LifetimeLedgerPayload | undefined {
  if (raw.byteLength > MAX_LEDGER_BYTES) return undefined
  try {
    const document = JSON.parse(raw.toString('utf8')) as Partial<LifetimeLedgerDocument>
    const payload = validatePayload(document)
    if (!payload || typeof document.checksum !== 'string' || document.checksum !== checksum(payload)) return undefined
    return payload
  } catch { return undefined }
}
function sameFingerprint(a: SessionUsageFingerprint, b: SessionUsageFingerprint): boolean {
  return a.revision === b.revision && a.updatedAt === b.updatedAt && a.eventCount === b.eventCount
}
function liveFingerprintReliable(header: { revision?: unknown; updatedAt?: unknown; eventCount?: unknown }): boolean {
  return (typeof header.updatedAt === 'string' || (typeof header.updatedAt === 'number' && Number.isFinite(header.updatedAt))) ||
    (typeof header.eventCount === 'number' && Number.isFinite(header.eventCount)) ||
    ((typeof header.revision === 'string' && !header.revision.startsWith('header:')) || typeof header.revision === 'number')
}

/** Merge a newer observation without allowing any model/day token bucket to decrease. */
function mergeMaxCells(previous: readonly ModelDayTotals[], current: readonly ModelDayTotals[]): ModelDayTotals[] {
  const merged = new Map<string, ModelDayTotals>()
  for (const cell of [...previous, ...current]) {
    const key = `${cell.provider}\0${cell.model}\0${cell.day}`
    const old = merged.get(key)
    const totals = {
      uncachedInputTokens: Math.max(old?.totals.uncachedInputTokens ?? 0, cell.totals.uncachedInputTokens),
      outputTokens: Math.max(old?.totals.outputTokens ?? 0, cell.totals.outputTokens),
      cacheReadTokens: Math.max(old?.totals.cacheReadTokens ?? 0, cell.totals.cacheReadTokens),
      cacheWriteTokens: Math.max(old?.totals.cacheWriteTokens ?? 0, cell.totals.cacheWriteTokens),
    }
    merged.set(key, { provider: cell.provider, model: cell.model, day: cell.day, totals, total: totals.uncachedInputTokens + totals.outputTokens + totals.cacheReadTokens + totals.cacheWriteTokens })
  }
  return [...merged.values()]
}

/** Positive cell/bucket delta, capped to the source total delta. */
function afterFloor(current: readonly ModelDayTotals[], floor: readonly ModelDayTotals[]): ModelDayTotals[] {
  const wanted = Math.max(0, cellTotal(current) - cellTotal(floor)); if (wanted === 0) return []
  const prior = new Map(floor.map(cell => [`${cell.provider}\0${cell.model}\0${cell.day}`, cell]))
  const candidates: ModelDayTotals[] = []
  for (const cell of current) {
    const old = prior.get(`${cell.provider}\0${cell.model}\0${cell.day}`)
    const totals = {
      uncachedInputTokens: Math.max(0, cell.totals.uncachedInputTokens - (old?.totals.uncachedInputTokens ?? 0)),
      outputTokens: Math.max(0, cell.totals.outputTokens - (old?.totals.outputTokens ?? 0)),
      cacheReadTokens: Math.max(0, cell.totals.cacheReadTokens - (old?.totals.cacheReadTokens ?? 0)),
      cacheWriteTokens: Math.max(0, cell.totals.cacheWriteTokens - (old?.totals.cacheWriteTokens ?? 0)),
    }
    const total = totals.uncachedInputTokens + totals.outputTokens + totals.cacheReadTokens + totals.cacheWriteTokens
    if (total > 0) candidates.push({ provider: cell.provider, model: cell.model, day: cell.day, totals, total })
  }
  const available = cellTotal(candidates); if (available === wanted) return candidates
  const basis = available > 0 ? candidates : cloneCells(current); const basisTotal = Math.max(1, cellTotal(basis))
  let remaining = wanted; const out: ModelDayTotals[] = []
  for (let index = 0; index < basis.length && remaining > 0; index++) {
    const cell = basis[index]!; const sourceTotal = cell.total
    const take = index === basis.length - 1 ? remaining : Math.min(remaining, Math.floor(wanted * sourceTotal / basisTotal))
    if (take <= 0) continue
    const names = ['uncachedInputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'] as const
    const totals = { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }; let bucketRemaining = take
    for (let b = 0; b < names.length; b++) { const name = names[b]!; const amount = b === names.length - 1 ? bucketRemaining : Math.min(bucketRemaining, Math.floor(take * cell.totals[name] / Math.max(1, sourceTotal))); totals[name] = amount; bucketRemaining -= amount }
    out.push({ provider: cell.provider, model: cell.model, day: cell.day, totals, total: take }); remaining -= take
  }
  return out
}

export class FileLifetimeLedger {
  readonly file: string
  private readonly lockFile: string
  private readonly recoveryFile: string
  constructor(baseDir: string, fileName = 'lifetime-ledger.json') { this.file = join(baseDir, fileName); this.lockFile = `${this.file}.lock`; this.recoveryFile = `${this.lockFile}.recovery` }
  /** Atomic rename + checksum make snapshot reads safe without the writer lock. */
  async usage(): Promise<CumulativeUsage> { const collected = this.collect((await this.load()).sessions); return summarizeUsageCells(collected.cells, collected.sessions) }
  async refresh(sessionQuery: SessionQueryService, signal?: AbortSignal, usageIndex?: FileSessionUsageIndex): Promise<LifetimeRefreshResult> {
    return this.withLock(async () => {
      signal?.throwIfAborted(); const state = await this.load(); const records = await sessionQuery.listSessions(signal)
      let updated = 0; let retained = 0; let failed = 0
      for (const record of records) {
        signal?.throwIfAborted(); const id = record.header.id; const fp = sessionFingerprint(record); const prior = state.sessions[id]
        // Closed logs are immutable. Live logs are also safe to retain when the
        // host exposes a changing header fingerprint; reopening the panel must
        // not decompress every unchanged live transcript again.
        if (prior && sameFingerprint(prior.fingerprint, fp) && (!record.live || liveFingerprintReliable(record.header))) { retained++; continue }
        try {
          let observed: ModelDayTotals[] | undefined
          if (!record.live && usageIndex) observed = await usageIndex.lookup(id, fp)
          if (!observed) {
            const source = await sessionQuery.readSession(id)
            const createdAt = typeof (source.session as { createdAt?: unknown })?.createdAt === 'number' ? (source.session as { createdAt: number }).createdAt : 0
            observed = foldSessionUsage(source.events, createdAt)
          }
          const monotonicObserved = mergeMaxCells(prior?.observed ?? [], observed)
          const credited = mergeMaxCells(prior?.credited ?? [], afterFloor(monotonicObserved, state.floors[id] ?? []))
          state.sessions[id] = { fingerprint: fp, live: Boolean(record.live), observed: monotonicObserved, credited, updatedAt: Date.now() }; updated++
        } catch { failed++; retained++ }
      }
      if (updated > 0) await this.persist(state)
      const collected = this.collect(state.sessions)
      return { usage: summarizeUsageCells(collected.cells, collected.sessions), listed: records.length, updated, retained, failed }
    })
  }
  /** Sole destructive API. Existing sessions become anchors so only future usage is recorded. */
  async clearHistory(): Promise<CumulativeUsage> {
    return this.withLock(async () => {
      const state = await this.load(); const floors: Record<string, ModelDayTotals[]> = Object.create(null) as Record<string, ModelDayTotals[]>
      // Preserve earlier anti-replay anchors, including sessions deleted before
      // a later clear, then advance every still-observed session monotonically.
      for (const [id, floor] of Object.entries(state.floors)) floors[id] = cloneCells(floor)
      for (const [id, entry] of Object.entries(state.sessions)) floors[id] = mergeMaxCells(floors[id] ?? [], entry.observed)
      const cleared = emptyPayload(state.generation + 1); cleared.floors = floors; await this.persist(cleared)
      return summarizeUsageCells([])
    })
  }
  async inspect(): Promise<LifetimeLedgerPayload> { return this.withLock(async () => this.load()) }
  private collect(sessions: Record<string, LifetimeSessionSnapshot>): { cells: ModelDayTotals[]; sessions: number } {
    const entries = Object.values(sessions).filter(entry => entry.credited.length > 0)
    return { cells: entries.flatMap(entry => cloneCells(entry.credited)), sessions: entries.length }
  }
  private async load(): Promise<LifetimeLedgerPayload> {
    let invalid = false
    try {
      const primary = await readFile(this.file)
      const parsed = decode(primary)
      if (parsed) return parsed
      invalid = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    try {
      const backup = await readFile(`${this.file}.bak`)
      const parsed = decode(backup)
      if (parsed) return parsed
      invalid = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (invalid) throw new Error(`Lifetime Ledger is corrupt and no valid backup is available: ${this.file}`)
    return emptyPayload()
  }
  private async persist(state: LifetimeLedgerPayload): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true })
    const temp = `${this.file}.${process.pid}.${randomUUID()}.tmp`; const handle = await open(temp, 'wx')
    try { await handle.writeFile(encode(state), 'utf8'); await handle.sync() } finally { await handle.close() }
    try {
      const old = await readFile(this.file).catch(() => undefined)
      if (old && decode(old)) await copyFile(this.file, `${this.file}.bak.tmp`).then(() => rename(`${this.file}.bak.tmp`, `${this.file}.bak`)).catch(async () => { await unlink(`${this.file}.bak.tmp`).catch(() => {}) })
      await rename(temp, this.file)
      // Mirror the committed generation as a separately checksummed fallback.
      // Never retain an older valid backup after a newer generation commits:
      // that could resurrect data after an irreversible clear.
      try {
        await copyFile(this.file, `${this.file}.bak.tmp`)
        await rename(`${this.file}.bak.tmp`, `${this.file}.bak`)
      } catch (error) {
        await unlink(`${this.file}.bak.tmp`).catch(() => {})
        await unlink(`${this.file}.bak`).catch(() => {})
        throw error
      }
    } finally { await unlink(temp).catch(() => {}) }
  }
  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(dirname(this.file), { recursive: true })
    const started = Date.now()
    const owner = `${process.pid}:${randomUUID()}`
    let handle: Awaited<ReturnType<typeof open>> | undefined
    while (!handle) {
      // A short-lived recovery marker closes the gap between moving a stale
      // lock and creating its successor. Normal acquirers never enter that gap.
      if (await stat(this.recoveryFile).then(() => true).catch(() => false)) {
        if (Date.now() - started > LOCK_WAIT_MS) throw new Error(`lifetime ledger recovery lock timeout: ${this.recoveryFile}`)
        await delay(10 + Math.floor(Math.random() * 20))
        continue
      }
      let created = false
      try {
        handle = await open(this.lockFile, 'wx')
        created = true
        await handle.writeFile(owner, 'utf8')
        await handle.sync()
      } catch (error) {
        if (handle) { await handle.close().catch(() => {}); handle = undefined }
        if (created) await unlink(this.lockFile).catch(() => {})
        const code = (error as NodeJS.ErrnoException).code; if (code !== 'EEXIST') throw error
        const age = await stat(this.lockFile).then(value => Date.now() - value.mtimeMs).catch(() => 0)
        if (age > LOCK_STALE_MS) {
          const staleOwner = await readFile(this.lockFile, 'utf8').catch(() => undefined)
          if (!lockOwnerAlive(staleOwner)) {
            let recovery: Awaited<ReturnType<typeof open>> | undefined
            const recoveryOwner = `${process.pid}:${randomUUID()}`
            try {
              recovery = await open(this.recoveryFile, 'wx')
              await recovery.writeFile(recoveryOwner, 'utf8')
              await recovery.sync()
              // Re-check only after excluding normal acquirers. If another owner
              // won before the marker appeared, it remains untouched.
              const currentOwner = await readFile(this.lockFile, 'utf8').catch(() => undefined)
              const currentAge = await stat(this.lockFile).then(value => Date.now() - value.mtimeMs).catch(() => 0)
              if (currentAge > LOCK_STALE_MS && currentOwner === staleOwner && !lockOwnerAlive(currentOwner)) {
                const quarantine = `${this.lockFile}.stale.${randomUUID()}`
                const moved = await rename(this.lockFile, quarantine).then(() => true).catch(() => false)
                if (moved) await unlink(quarantine).catch(() => {})
              }
            } catch (recoveryError) {
              if ((recoveryError as NodeJS.ErrnoException).code !== 'EEXIST') throw recoveryError
            } finally {
              await recovery?.close().catch(() => {})
              const markerOwner = await readFile(this.recoveryFile, 'utf8').catch(() => undefined)
              if (markerOwner === recoveryOwner) await unlink(this.recoveryFile).catch(() => {})
            }
            continue
          }
        }
        if (Date.now() - started > LOCK_WAIT_MS) throw new Error(`lifetime ledger lock timeout: ${this.lockFile}`)
        await delay(10 + Math.floor(Math.random() * 20))
      }
    }
    // Update the owned inode, never a successor that later occupies lockFile.
    const heartbeat = setInterval(() => { void handle?.utimes(new Date(), new Date()).catch(() => {}) }, LOCK_HEARTBEAT_MS)
    heartbeat.unref?.()
    try {
      return await operation()
    } finally {
      clearInterval(heartbeat)
      await handle.close().catch(() => {})
      // Never remove a successor's lock after stale-lock recovery.
      const currentOwner = await readFile(this.lockFile, 'utf8').catch(() => undefined)
      if (currentOwner === owner) await unlink(this.lockFile).catch(() => {})
    }
  }
}
export function lifetimeLedgerPath(baseDir: string): string { return join(baseDir, 'lifetime-ledger.json') }
