/** Pure context-pressure state machines. Visual identity never changes by band. */

export const GROWTH_THRESHOLDS = [0, 20, 40, 60, 80, 95, 100] as const
export type PressureBand = 'newborn' | 'growth' | 'active' | 'heavy' | 'overload' | 'critical'
/** @deprecated Compatibility name; values now represent pressure bands, not visual growth forms. */
export type GrowthStage = PressureBand
export const PRESSURE_BANDS: readonly PressureBand[] = ['newborn', 'growth', 'active', 'heavy', 'overload', 'critical']
/** @deprecated Use PRESSURE_BANDS for new code. */
export const GROWTH_STAGES: readonly GrowthStage[] = PRESSURE_BANDS
const STAGE_LABELS: Record<GrowthStage, string> = {
  newborn: '低压', growth: '平稳', active: '活跃', heavy: '繁忙', overload: '过载', critical: '告急',
}

export interface GrowthSnapshot {
  stage: GrowthStage
  progress: number
  occupancyPercent: number
  cumulativeTokens: number
  /** Monotonic transition number, useful for animation/event deduplication. */
  transitionId: number
  /** Stable key for the current state; unchanged updates must not retrigger effects. */
  transitionKey: string
  changed: boolean
}

export function growthStageAt(percent: number): { stage: GrowthStage; progress: number; label: string } {
  const p = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0
  const i = p >= 95 ? 5 : p >= 80 ? 4 : p >= 60 ? 3 : p >= 40 ? 2 : p >= 20 ? 1 : 0
  const start = GROWTH_THRESHOLDS[i]!
  const end = GROWTH_THRESHOLDS[i + 1]!
  const stage = GROWTH_STAGES[i]!
  return { stage, progress: end > start ? Math.max(0, Math.min(1, (p - start) / (end - start))) : 0, label: STAGE_LABELS[stage] }
}

export function createGrowthSnapshot(occupancyPercent: number | null, cumulativeTokens = 0): GrowthSnapshot {
  const occupancy = Number.isFinite(occupancyPercent) ? Math.max(0, Math.min(100, occupancyPercent as number)) : 0
  const { stage, progress } = growthStageAt(occupancy)
  return { stage, progress, occupancyPercent: occupancy, cumulativeTokens: safeTokens(cumulativeTokens), transitionId: 0, transitionKey: stage, changed: true }
}

export function updateGrowthSnapshot(previous: GrowthSnapshot, occupancyPercent: number | null, cumulativeTokens = previous.cumulativeTokens): GrowthSnapshot {
  const next = createGrowthSnapshot(occupancyPercent, cumulativeTokens)
  const changed = next.stage !== previous.stage
  return { ...next, transitionId: previous.transitionId + (changed ? 1 : 0), transitionKey: changed ? `${next.stage}:${previous.transitionId + 1}` : previous.transitionKey, changed }
}

function safeTokens(n: number): number { return Number.isFinite(n) && n >= 0 ? n : 0 }

export type ContextState = 'NORMAL' | 'ARMED' | 'EATING' | 'DIGESTING'
export type ContextSignal =
  | { type: 'pressure'; occupancyPercent: number; source?: 'simulated' | 'real' }
  | { type: 'compact-start'; source: 'real' | 'simulated' }
  | { type: 'compact-end'; source: 'real' | 'simulated' }
  | { type: 'digest-end'; source?: 'real' | 'simulated' }

export interface ContextSnapshot {
  state: ContextState
  occupancyPercent: number
  /** true only when a real compact signal drove EATING/DIGESTING. */
  compactSource: 'real' | 'simulated' | null
  transitionId: number
  transitionKey: string
  changed: boolean
}

export function createContextSnapshot(occupancyPercent = 0): ContextSnapshot {
  const p = clampPercent(occupancyPercent)
  return { state: p >= 95 ? 'ARMED' : 'NORMAL', occupancyPercent: p, compactSource: null, transitionId: 0, transitionKey: p >= 95 ? 'ARMED' : 'NORMAL', changed: true }
}

/** Reduce one signal. Simulated pressure may arm the pet, but never fakes a compact. */
export function reduceContextSnapshot(previous: ContextSnapshot, signal: ContextSignal): ContextSnapshot {
  const p = signal.type === 'pressure' ? clampPercent(signal.occupancyPercent) : previous.occupancyPercent
  let state = previous.state
  let source = previous.compactSource
  if (signal.type === 'pressure') {
    if (state === 'NORMAL' && p >= 95) state = 'ARMED'
    else if (state === 'ARMED' && p < 95) state = 'NORMAL'
    else if (state === 'DIGESTING' && p < 95) state = 'NORMAL'
  } else if (signal.type === 'compact-start' && signal.source === 'real') {
    state = 'EATING'; source = 'real'
  } else if (signal.type === 'compact-end' && state === 'EATING' && signal.source === 'real') {
    state = 'DIGESTING'; source = 'real'
  } else if (signal.type === 'digest-end' && state === 'DIGESTING') {
    state = p >= 95 ? 'ARMED' : 'NORMAL'; source = null
  }
  const changed = state !== previous.state || source !== previous.compactSource
  return { state, occupancyPercent: p, compactSource: source, transitionId: previous.transitionId + (changed ? 1 : 0), transitionKey: changed ? `${state}:${previous.transitionId + 1}` : previous.transitionKey, changed }
}

export function contextStateFor(occupancyPercent: number, compact?: { phase: 'start' | 'end'; source: 'real' | 'simulated' }): ContextState {
  let snapshot = createContextSnapshot(occupancyPercent)
  if (compact?.phase === 'start') snapshot = reduceContextSnapshot(snapshot, { type: 'compact-start', source: compact.source })
  if (compact?.phase === 'end') snapshot = reduceContextSnapshot(snapshot, { type: 'compact-end', source: compact.source })
  return snapshot.state
}

function clampPercent(n: number): number { return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0 }
