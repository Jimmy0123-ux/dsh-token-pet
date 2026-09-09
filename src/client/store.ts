/**
 * Tiny module-level store shared between the session-scoped `input.dock`
 * component (which owns the live projection values) and the root-scoped
 * `shell.overlay` window (which renders the pet + panel and can be summoned
 * from anywhere). Root-scoped slot components do NOT receive the session kit,
 * so we bridge the live figures across the two mounts through a tiny listener.
 * @module dsh-token-pet/store
 */

export interface ProjectionSnapshot {
  sessionId?: string
  /** Mount generation: returning to the same session must not revive old UI. */
  sessionEpoch?: number
  pressure?: unknown
  breakdown?: unknown
  usage?: unknown
  stats?: unknown
  timeline?: unknown
  /** Host-owned today usage buckets; see derive.todayUsageBucketsOf. */
  todayBuckets?: unknown
  running?: boolean
  /** A ready live view and a real turn boundary, never inferred from tool status. */
  sessionReady?: boolean
  turnTimeline?: import('./completion.ts').ConversationTimeline
  promptError?: unknown
  lastToolResult?: unknown
  lastCompaction?: unknown
  removed?: boolean
  /** Current DSH composer draft, mirrored from the session input slot. */
  draft?: string
  /** Real composer action bridge; never an HTTP/host imitation. */
  applyPrompt?: (text: string) => void
  sendPrompt?: (text: string) => void | Promise<void>
}

type Listener = (snap: ProjectionSnapshot | null) => void

let current: ProjectionSnapshot | null = null
const listeners = new Set<Listener>()

function pushProjections(snap: ProjectionSnapshot | null): void {
  current = snap
  for (const l of listeners) l(snap)
}

let generation = 0
let owner: object | null = null

/** One committed dock mount owns the bridge. A superseded lease never revives. */
export function createProjectionFeed(sessionId: string) {
  const token = {}
  const sessionEpoch = ++generation
  owner = token
  let disposed = false
  const isCurrent = () => !disposed && owner === token
  // Revoke the old draft/actions immediately, before the new feed publishes.
  pushProjections(null)
  return {
    isCurrent,
    publish(snap: ProjectionSnapshot) {
      if (isCurrent()) pushProjections({ ...snap, sessionId, sessionEpoch })
    },
    dispose() {
      if (isCurrent()) {
        owner = null
        pushProjections(null)
      }
      disposed = true
    },
  }
}

export function subscribeProjections(l: Listener): () => void {
  listeners.add(l)
  l(current)
  return () => { listeners.delete(l) }
}
