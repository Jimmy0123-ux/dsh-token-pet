import { defineMessages, translate, type Language, type MessageParams } from './i18n.ts'

export const maintenanceMessages = defineMessages({
  rebuildConfirmation: { zh: '显式重建会读取全部历史会话，并替换当前小时趋势快照。仅在索引缺失、损坏或数据明显异常时继续。\n\n确定重建吗？', en: 'An explicit rebuild reads all session history and replaces the current hourly trend snapshot. Continue only if the index is missing, corrupt, or clearly inaccurate.\n\nRebuild now?' },
  lifetimeClearWarning: { zh: '此操作会永久清空终身用量账本历史，无法通过“恢复记录”找回。普通清空、恢复和刷新不会影响账本。', en: 'This permanently deletes lifetime usage ledger history. Restore records cannot recover it. Ordinary clearing, restoring, and refreshing do not affect the ledger.' },
  loading: { zh: '读取中', en: 'Loading' },
  healthy: { zh: '健康', en: 'Healthy' },
  missing: { zh: '缺失', en: 'Missing' },
  corrupt: { zh: '损坏', en: 'Corrupt' },
  reconciling: { zh: '正在增量对账', en: 'Reconciling incremental changes' },
  rebuilding: { zh: '正在显式重建', en: 'Explicit rebuild in progress' },
  repairing: { zh: '正在修复', en: 'Repairing' },
  repairingCount: { zh: '正在修复（{count} 项）', en: 'Repairing ({count} items)' },
  completed: { zh: '维护已完成', en: 'Maintenance completed' },
  cancelled: { zh: '重建已取消', en: 'Rebuild cancelled' },
  failed: { zh: '维护失败', en: 'Maintenance failed' },
  unsupported: { zh: '当前宿主的会话持久化接口不支持趋势索引', en: 'This host’s session persistence does not support the trend index' },
  idle: { zh: '空闲', en: 'Idle' },
  notGenerated: { zh: '尚未生成', en: 'Not generated yet' },
  invalidTime: { zh: '时间无效', en: 'Invalid time' },
  statusRequestFailed: { zh: '状态请求失败（{status}）', en: 'Status request failed ({status})' },
  invalidStatus: { zh: '宿主返回了无效的索引状态', en: 'The host returned an invalid index status' },
  hostError: { zh: '失败：{detail}', en: 'Failed: {detail}' },
  requestFailed: { zh: '请求失败：{detail}', en: 'Request failed: {detail}' },
  pollingPaused: { zh: '自动刷新已暂停，请手动刷新状态。', en: 'Automatic refresh paused. Please refresh the status manually.' },
  startingRebuild: { zh: '正在启动显式重建…', en: 'Starting an explicit rebuild…' },
  rebuildRequestFailed: { zh: '无法启动重建（{status}）', en: 'Unable to start the rebuild ({status})' },
  rebuildStarted: { zh: '重建已启动；完成前可取消。', en: 'Rebuild started; you can cancel before it completes.' },
  cancelling: { zh: '正在取消…', en: 'Cancelling…' },
  cancelRequestFailed: { zh: '取消失败（{status}）', en: 'Cancellation failed ({status})' },
  cancelRequested: { zh: '已请求取消重建。', en: 'Rebuild cancellation requested.' },
  title: { zh: '小时趋势索引维护', en: 'Hourly trend index maintenance' },
  health: { zh: '健康状态：{value}', en: 'Health: {value}' },
  updated: { zh: '快照更新时间：{value}', en: 'Snapshot updated: {value}' },
  operation: { zh: '维护状态：{value}', en: 'Maintenance: {value}' },
  explanation: { zh: '普通状态读取与趋势刷新只读取校验过的小时快照，不枚举会话，也不读取历史。显式重建是唯一会扫描全部历史的维护操作。', en: 'Ordinary status reads and trend refreshes only read validated hourly snapshots; they do not enumerate sessions or read history. An explicit rebuild is the only maintenance operation that scans all history.' },
  snapshotPath: { zh: '只读快照：{path}', en: 'Read-only snapshot: {path}' },
  rebuildAction: { zh: '显式重建趋势索引', en: 'Explicitly rebuild trend index' },
  cancelAction: { zh: '取消重建', en: 'Cancel rebuild' },
  refreshAction: { zh: '刷新状态', en: 'Refresh status' },
})

export type MaintenanceMessageKey = keyof typeof maintenanceMessages
/** Store message identity, not translated text, so pending feedback follows language changes. */
export interface MaintenanceFeedback {
  level: 'info' | 'warning' | 'error'
  key: MaintenanceMessageKey
  params?: MessageParams
}
export function maintenanceText(language: Language, key: MaintenanceMessageKey, params?: MessageParams): string {
  return translate(language, maintenanceMessages, key, params)
}
export function maintenanceFeedbackText(language: Language, feedback: MaintenanceFeedback): string {
  return maintenanceText(language, feedback.key, feedback.params)
}
