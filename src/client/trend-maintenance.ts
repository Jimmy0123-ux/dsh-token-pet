import type { TokenPetTrendIndexHealth, TokenPetTrendIndexOperation, TokenPetTrendIndexResult, TokenPetTrendIndexStatus } from '../index-contract.js'

import type { Language } from './i18n.ts'
import { maintenanceText } from './maintenance-messages.ts'

const HEALTH = new Set<TokenPetTrendIndexHealth>(['ready', 'missing', 'corrupt'])
const OPERATIONS = new Set<TokenPetTrendIndexOperation>(['idle', 'reconciling', 'rebuilding', 'repairing'])
const RESULTS = new Set<TokenPetTrendIndexResult>(['completed', 'cancelled', 'failed', 'unsupported'])

/** Validate the small host maintenance envelope before presenting it in settings. */
export function trendIndexStatusOf(value: unknown): TokenPetTrendIndexStatus | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  if (!HEALTH.has(source.health as TokenPetTrendIndexHealth) || !OPERATIONS.has(source.operation as TokenPetTrendIndexOperation) || source.snapshotOnly !== true) return null
  const operation = source.operation as TokenPetTrendIndexOperation
  const updatedAt = source.updatedAt === null ? null : typeof source.updatedAt === 'number' && Number.isFinite(source.updatedAt) && source.updatedAt >= 0 ? source.updatedAt : null
  const lastResult = RESULTS.has(source.lastResult as TokenPetTrendIndexResult) ? source.lastResult as TokenPetTrendIndexResult : undefined
  return {
    health: source.health as TokenPetTrendIndexHealth,
    updatedAt,
    operation,
    running: operation !== 'idle',
    reconciling: operation === 'reconciling',
    rebuilding: operation === 'rebuilding',
    repairing: operation === 'repairing',
    repairCount: typeof source.repairCount === 'number' && Number.isSafeInteger(source.repairCount) && source.repairCount >= 0 ? source.repairCount : 0,
    path: typeof source.path === 'string' ? source.path : '',
    snapshotOnly: true,
    cancelSupported: source.cancelSupported === true && operation === 'rebuilding',
    ...(lastResult ? { lastResult } : {}),
    ...(typeof source.error === 'string' && source.error ? { error: source.error } : {}),
  }
}

export function trendRebuildConfirmation(language: Language = 'zh'): string {
  return maintenanceText(language, 'rebuildConfirmation')
}
/** Legacy Chinese text retained for existing consumers. */
export const TREND_REBUILD_CONFIRMATION = trendRebuildConfirmation('zh')

export function trendHealthLabel(status: TokenPetTrendIndexStatus | null, language: Language = 'zh'): string {
  if (!status) return maintenanceText(language, 'loading')
  if (status.health === 'ready') return maintenanceText(language, 'healthy')
  if (status.health === 'missing') return maintenanceText(language, 'missing')
  return maintenanceText(language, 'corrupt')
}

export function trendOperationLabel(status: TokenPetTrendIndexStatus | null, language: Language = 'zh'): string {
  if (!status) return maintenanceText(language, 'loading')
  if (status.operation === 'reconciling') return maintenanceText(language, 'reconciling')
  if (status.operation === 'rebuilding') return maintenanceText(language, 'rebuilding')
  if (status.operation === 'repairing') return maintenanceText(language, status.repairCount > 1 ? 'repairingCount' : 'repairing', { count: status.repairCount })
  if (status.lastResult === 'completed') return maintenanceText(language, 'completed')
  if (status.lastResult === 'cancelled') return maintenanceText(language, 'cancelled')
  if (status.lastResult === 'failed') return maintenanceText(language, 'failed')
  if (status.lastResult === 'unsupported') return maintenanceText(language, 'unsupported')
  return maintenanceText(language, 'idle')
}
