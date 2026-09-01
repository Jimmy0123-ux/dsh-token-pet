/**
 * Tiny module-level store shared between the session-scoped `input.dock`
 * component (which owns the live projection values) and the root-scoped
 * `shell.overlay` window (which renders the pet + panel and can be summoned
 * from anywhere). Root-scoped slot components do NOT receive the session kit,
 * so we bridge the live figures across the two mounts through a tiny listener.
 * @module dsh-token-pet/store
 */

export interface ProjectionSnapshot {
  pressure?: unknown
  breakdown?: unknown
  usage?: unknown
  stats?: unknown
  timeline?: unknown
  /** Host-owned today usage buckets; see derive.todayUsageBucketsOf. */
  todayBuckets?: unknown
  running?: boolean
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

export function pushProjections(snap: ProjectionSnapshot | null): void {
  current = snap
  for (const l of listeners) l(snap)
}

export function subscribeProjections(l: Listener): () => void {
  listeners.add(l)
  l(current)
  return () => { listeners.delete(l) }
}
