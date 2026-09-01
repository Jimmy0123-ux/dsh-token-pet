/** Shared host/client contract for the persistent Token Pet usage index. */

export type TokenPetIndexState = 'missing' | 'building' | 'partial' | 'syncing' | 'ready' | 'cancelled' | 'error'
export type TokenPetIndexOperation = 'building' | 'syncing'
export type TokenPetIndexTerminal = 'cancelled' | 'error'

export type TokenPetTrendIndexHealth = 'ready' | 'missing' | 'corrupt'
export type TokenPetTrendIndexOperation = 'idle' | 'reconciling' | 'rebuilding' | 'repairing'
export type TokenPetTrendIndexResult = 'completed' | 'cancelled' | 'failed'

/** Lightweight hourly projection metadata. Reading it never opens session history. */
export interface TokenPetTrendIndexStatus {
  health: TokenPetTrendIndexHealth
  updatedAt: number | null
  operation: TokenPetTrendIndexOperation
  running: boolean
  reconciling: boolean
  rebuilding: boolean
  repairing: boolean
  repairCount: number
  path: string
  snapshotOnly: true
  cancelSupported: boolean
  lastResult?: TokenPetTrendIndexResult
  error?: string
}

export interface TokenPetIndexProgress {
  status: TokenPetIndexState
  completed: number
  total: number
  indexed: number
  skipped: number
  failed: number
  sessionId?: string
  /** New/changed closed sessions not represented by the durable index. */
  pending: number
}

export interface TokenPetIndexStatus {
  status: TokenPetIndexState
  /** True only when a structurally valid durable index exists. */
  persisted: boolean
  /** Persisted data can be shown even while it is partial or syncing. */
  usable: boolean
  building: boolean
  syncing: boolean
  listed: number
  closed: number
  live: number
  indexed: number
  pending: number
  entries: number
  path: string
  progress: TokenPetIndexProgress
  /** A stale readiness snapshot was served while one header scan runs. */
  refreshing?: boolean
  retryAfterMs?: number
  error?: string
}

export function deriveTokenPetIndexState(input: {
  persisted: boolean
  pending: number
  operation?: TokenPetIndexOperation
  terminal?: TokenPetIndexTerminal
}): TokenPetIndexState {
  if (input.operation) return input.operation
  if (input.terminal) return input.terminal
  if (!input.persisted) return 'missing'
  return input.pending > 0 ? 'partial' : 'ready'
}
