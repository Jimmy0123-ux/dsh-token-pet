/** Turn completion is not a running=false transition (which also means cancel/disconnect). */
export interface ConversationTurn {
  turn?: unknown
  start?: { seq?: unknown }
  end?: { seq?: unknown; type?: unknown; data?: { reason?: { kind?: unknown } } }
}
export interface ConversationTimeline { turnOrder?: readonly number[]; turns?: ReadonlyMap<number, ConversationTurn> }
export function conversationTimelineOf(state: unknown): ConversationTimeline | undefined {
  return (state as { chat?: { timeline?: ConversationTimeline } } | null)?.chat?.timeline
}
export function latestConversationTurn(state: unknown): ConversationTurn | undefined {
  const timeline = conversationTimelineOf(state)
  const order = timeline?.turnOrder
  if (!order?.length || !timeline?.turns?.get) return undefined
  const turn = order[order.length - 1]
  return turn === undefined ? undefined : timeline.turns.get(turn)
}
export interface CompletionObservation {
  sessionId?: string
  sessionEpoch?: number
  ready: boolean
  removed?: boolean
  enabled: boolean
  turn?: ConversationTurn
  timeline?: ConversationTimeline
}
/** Only notify for a successful turn whose open boundary this active feed observed. */
export function createCompletionTracker() {
  let scope: string | null = null
  let active: { turn: number; startSeq: number } | null = null
  let lastEndSeq = -1
  const reset = () => { scope = null; active = null; lastEndSeq = -1 }
  const observe = (input: CompletionObservation): string | null => {
    if (!input.sessionId || input.sessionEpoch === undefined || !input.ready || input.removed) { reset(); return null }
    const nextScope = JSON.stringify([input.sessionId, input.sessionEpoch])
    if (scope !== nextScope) { reset(); scope = nextScope }
    const turn = input.turn ?? latestConversationTurn({ chat: { timeline: input.timeline } })
    if (!turn || typeof turn.turn !== 'number' || !Number.isSafeInteger(turn.turn)) return null
    // A queued reply may start in the same publication that closes the previous
    // one. Inspect the previously observed turn by ID instead of losing its end.
    const previous = active ? input.timeline?.turns?.get(active.turn) : undefined
    const finished = previous?.end ? previous : turn
    const endSeq = finished.end?.seq
    let result: string | null = null
    if (typeof endSeq === 'number' && Number.isSafeInteger(endSeq) && endSeq > lastEndSeq) {
      lastEndSeq = endSeq
      const observed = active !== null && active.turn === finished.turn && endSeq > active.startSeq
      active = null
      // Advance while muted too: enabling sound never replays a historical finish.
      if (observed && input.enabled && finished.end?.type === 'turn/end' && finished.end.data?.reason?.kind === 'completed') {
        result = JSON.stringify([input.sessionId, input.sessionEpoch, finished.turn, endSeq])
      }
    }
    const startSeq = turn.start?.seq
    if (!turn.end && typeof startSeq === 'number' && Number.isSafeInteger(startSeq) && startSeq > lastEndSeq) active = { turn: turn.turn, startSeq }
    return result
  }
  return { observe, reset }
}
