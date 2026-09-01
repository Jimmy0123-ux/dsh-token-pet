import type { TokenPetTrendIndexHealth, TokenPetTrendIndexOperation, TokenPetTrendIndexResult, TokenPetTrendIndexStatus } from '../index-contract.js'

const HEALTH = new Set<TokenPetTrendIndexHealth>(['ready', 'missing', 'corrupt'])
const OPERATIONS = new Set<TokenPetTrendIndexOperation>(['idle', 'reconciling', 'rebuilding', 'repairing'])
const RESULTS = new Set<TokenPetTrendIndexResult>(['completed', 'cancelled', 'failed'])

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

export const TREND_REBUILD_CONFIRMATION = '显式重建会读取全部历史会话，并替换当前小时趋势快照。仅在索引缺失、损坏或数据明显异常时继续。\n\n确定重建吗？'

export function trendHealthLabel(status: TokenPetTrendIndexStatus | null): string {
  if (!status) return '读取中'
  if (status.health === 'ready') return '健康'
  if (status.health === 'missing') return '缺失'
  return '损坏'
}

export function trendOperationLabel(status: TokenPetTrendIndexStatus | null): string {
  if (!status) return '读取中'
  if (status.operation === 'reconciling') return '正在增量对账'
  if (status.operation === 'rebuilding') return '正在显式重建'
  if (status.operation === 'repairing') return `正在修复${status.repairCount > 1 ? `（${status.repairCount} 项）` : ''}`
  if (status.lastResult === 'completed') return '维护已完成'
  if (status.lastResult === 'cancelled') return '重建已取消'
  if (status.lastResult === 'failed') return '维护失败'
  return '空闲'
}
