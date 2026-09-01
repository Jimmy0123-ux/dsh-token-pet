/** Unified events understood by the token pet animation layer. */
export type PetAction =
  | 'idle' | 'working' | 'eating' | 'digesting' | 'warning' | 'evolve' | 'click' | 'archive'
  | 'tool-success' | 'tool-failure' | 'prompt-enhancing' | 'prompt-ready'

export const PET_PREVIEW_EVENT = 'dsh-token-pet-preview-action'

/** User-facing semantic runtime status (independent from visual motion policy). */
export const PET_ACTION_STATUS_LABELS: Readonly<Record<PetAction, string>> = {
  idle: '空闲',
  working: '工作中',
  eating: '压缩中',
  digesting: '整理中',
  warning: '上下文预警',
  evolve: '状态更新',
  click: '打招呼',
  archive: '已归档',
  'tool-success': '工具完成',
  'tool-failure': '工具失败',
  'prompt-enhancing': '提示生成中',
  'prompt-ready': '提示已就绪',
}

export interface PetEvent<T = unknown> {
  /** Stable event id; repeated ids are ignored by the queue. */
  id?: string
  action: PetAction
  /** Higher values interrupt lower-priority animations. */
  priority?: number
  /** Optional event payload for host integrations. */
  payload?: T
  /** Explicit user/critical action: replace the current animation immediately. */
  interrupt?: boolean
  /** Event timestamp (defaults to now). */
  timestamp?: number
  /** One-shot events can be coalesced during a short window. */
  dedupeKey?: string
}

export const PET_ACTION_PRIORITY: Readonly<Record<PetAction, number>> = {
  idle: 0, working: 20, eating: 25, digesting: 25, 'prompt-ready': 30, click: 35,
  'tool-success': 40, 'prompt-enhancing': 45, evolve: 60, archive: 65,
  warning: 80, 'tool-failure': 85,
}

export function eventPriority(event: PetEvent): number {
  return event.priority ?? PET_ACTION_PRIORITY[event.action]
}

/**
 * Normalize public DSH lifecycle names into pet actions. The adapter is
 * deliberately tolerant because host releases expose slightly different
 * event spellings; unknown events are ignored rather than inventing motion.
 */
export function petEventFromDshEvent(event: { type?: unknown; id?: unknown; data?: unknown }): PetEvent | null {
  if (typeof event.type !== 'string') return null
  const type = event.type.toLowerCase()
  const id = typeof event.id === 'string' ? event.id : undefined
  if (type === 'request/start' || type === 'request/header' || type === 'turn/start') return { action: 'working', id, dedupeKey: id ?? 'request-start' }
  if (type === 'request/error' || type === 'request/fail' || type === 'tool/error' || type === 'tool/failure') return { action: 'tool-failure', id, dedupeKey: id ?? type, payload: event.data }
  if (type === 'tool/success' || type === 'tool/result' || type === 'tool/complete') return { action: 'tool-success', id, dedupeKey: id ?? type, payload: event.data }
  if (type === 'compact/start' || type === 'compaction/start') return { action: 'eating', id, dedupeKey: id ?? 'compact-start', payload: event.data }
  if (type === 'compact/end' || type === 'compaction/end') return { action: 'digesting', id, dedupeKey: id ?? 'compact-end', payload: event.data }
  if (type === 'archive' || type === 'session/archive') return { action: 'archive', id, dedupeKey: id ?? type, payload: event.data }
  return null
}

/** Small bounded dedupe registry suitable for UI event streams. */
export class PetEventDedupe {
  private readonly seen = new Map<string, number>()
  constructor(private readonly windowMs = 1200, private readonly maxEntries = 256) {}
  accept(event: PetEvent): boolean {
    const now = event.timestamp ?? Date.now()
    const key = event.id ?? event.dedupeKey
    if (!key) return true
    const previous = this.seen.get(key)
    if (previous !== undefined && now - previous < this.windowMs) return false
    this.seen.set(key, now)
    while (this.seen.size > this.maxEntries) this.seen.delete(this.seen.keys().next().value as string)
    return true
  }
}
