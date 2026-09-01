import type { TokenPetIndexState, TokenPetIndexStatus } from '../index-contract.js'

const STATES = new Set<TokenPetIndexState>(['missing', 'building', 'partial', 'syncing', 'ready', 'cancelled', 'error'])
const count = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0

/** Validate the host envelope without collapsing distinct lifecycle states. */
export function tokenPetIndexStatusOf(value: unknown): TokenPetIndexStatus | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  if (!STATES.has(source.status as TokenPetIndexState)) return null
  const status = source.status as TokenPetIndexState
  const progressSource = source.progress && typeof source.progress === 'object' ? source.progress as Record<string, unknown> : {}
  const pending = count(source.pending ?? progressSource.pending)
  const persisted = source.persisted === true
  return {
    status,
    persisted,
    usable: source.usable === true && persisted,
    building: status === 'building',
    syncing: status === 'syncing',
    listed: count(source.listed),
    closed: count(source.closed),
    live: count(source.live),
    indexed: count(source.indexed),
    pending,
    entries: count(source.entries),
    path: typeof source.path === 'string' ? source.path : '',
    progress: {
      status,
      pending,
      completed: count(progressSource.completed),
      total: count(progressSource.total),
      indexed: count(progressSource.indexed),
      skipped: count(progressSource.skipped),
      failed: count(progressSource.failed),
      ...(typeof progressSource.sessionId === 'string' ? { sessionId: progressSource.sessionId } : {}),
    },
    ...(source.refreshing === true ? { refreshing: true, retryAfterMs: Math.max(250, count(source.retryAfterMs) || 1_000) } : {}),
    ...(typeof source.error === 'string' ? { error: source.error } : {}),
  }
}

export function todayTrendRequestUrl(timeZone: string): string {
  return `/token-pet/usage/trend?timeZone=${encodeURIComponent(timeZone)}`
}

export function shouldSyncTokenPetIndex(status: TokenPetIndexStatus): boolean {
  return status.status === 'partial' && status.persisted && status.pending > 0 && status.refreshing !== true
}

/** Partial/failed syncs retain a usable durable snapshot for rendering. */
export function canReadTokenPetIndex(status: TokenPetIndexStatus | null): boolean {
  return status?.usable === true
}
