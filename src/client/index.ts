/**
 * dsh-token-pet browser half — mounts a floating "用量小宠物" that is driven by
 * the active session's REAL context figures, and a context statistics panel.
 *
 * Data source: the framework standard kit. Any component registered into a
 * session-scoped slot receives `useProjection` / `useSession` / `useSessions`
 * as props (the same kit dsh-context and StatsLine consume). The pet mounts
 * into `conversation.input.dock` (session scope) precisely so it can read the
 * live projections with no host RPC and no polling:
 *
 *   useProjection('contextPressure')   → occupancy % + context window
 *   useProjection('contextBreakdown')  → system/tools/messages composition
 *   useProjection('tokenUsage')        → cumulative input/output/cache
 *   useProjection('sessionStats')      → turns/steps/timings
 *   useProjection('contextTimeline')   → history trend (dsh-context)
 *
 * The sprite + panel are rendered through a portal to `document.body` so the
 * pet floats over the whole app (like dsh-pet), while the slot registration
 * only provides the session scope. When no session is active the dock slot
 * simply does not mount, so no pet is shown — the correct semantic for a
 * usage monitor.
 * @module dsh-token-pet/client
 */
import { createElement as h, Component, Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties } from 'react'

import {
  breakdownOf,
  css,
  lifetimeLedgerOf,
  occupancyPercent,
  pressureOf,
  sessionStatsOf,
  stageForPercent,
  timelineOf,
  todayUsageBucketsOf,
  tokenUsageOf,
  totalBilled,
  type CumulativeUsage,
  type PetStageInfo,
} from './derive.ts'
import { createContextSnapshot, reduceContextSnapshot } from '../growth.ts'
import { PetSprite } from './pet.tsx'
import { usePetAnimation } from './animation.ts'
import { PET_ACTION_PRIORITY, PET_PREVIEW_EVENT, type PetAction } from './events.ts'
import { ContextPanel, type IndexProgress } from './panel.tsx'
import { PromptEnhancerPanel } from './prompt-panel.tsx'
import type { TrendBucket } from './derive.ts'
import { pushProjections, subscribeProjections, type ProjectionSnapshot } from './store.ts'
import { clampFloatingOffset, loadSettings, saveSettings, SETTINGS_EVENT, type FloatingRect, type TokenPetSettings } from './settings.ts'
import { createComposerPromptBridge } from './prompt.ts'
import { TokenPetSettingsPanel } from './settings-panel.tsx'
import { builtinSkinIndex, resolveStyleOverride, type SkinManifest } from './skin.ts'
import { injectSpriteSheetCss } from './sprite-player.tsx'
import { clearLifetimeLedgerAndReload } from './lifetime-ledger.ts'
import { canLoadTodayUsageTrend, fitPanelSizeToViewport, FLOATING_LAYER, proportionalPanelSize } from './layout.ts'
import { createPanelRequestScope, PANEL_REQUEST_TIMEOUT_MS, shouldStartPanelRequest } from './request-scope.ts'
import { canReadTokenPetIndex, todayTrendRequestUrl, tokenPetIndexStatusOf } from './index-state.ts'
import type { TokenPetIndexStatus } from '../index-contract.ts'

/** React error boundary so the always-mounted pet NEVER disappears on a render error. */
class ErrorBoundary extends Component<{ children?: unknown }, { error: unknown }> {
  state = { error: null as unknown }
  static getDerivedStateFromError(error: unknown) { return { error } }
  render() {
    if (this.state.error !== null) {
      const e = this.state.error
      const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : `\n${JSON.stringify(e)}`
      return h('div', {
        style: { position: 'fixed', right: 18, bottom: 18, zIndex: 2147483000, background: 'rgba(40,10,10,0.97)', color: '#ffd0c8', font: '10px monospace', padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(255,120,90,0.5)', maxWidth: 380, whiteSpace: 'pre-wrap', overflow: 'auto', maxHeight: 240 },
      }, `[token-pet]\n${msg}`)
    }
    return (this.props.children as never) ?? null
  }
}

/** Slot-coupled props the framework hands every session-scoped dock component. */
interface SessionInputActions {
  setDraft(text: string): void
  submit(): void
}
interface SessionKit {
  useProjection?: (key: string) => unknown
  useSession?: <T>(sel: (s: unknown) => T) => T
  useInput?: <T>(sel: (s: unknown) => T) => T
  inputActions?: SessionInputActions
  t?: (key: string, params?: Record<string, unknown>) => string
}

/**
 * Derive the pet's presentation from the raw projection records. Purely data →
 * props; the only novel mapping is the evolution stage from occupancy.
 */
interface PetView {
  percent: number | null
  contextWindow?: number
  usedTokens?: number
  satiation: number
  toolShare: number
  progress: number
  toolCalls?: number
  stageInfo: PetStageInfo
  model?: string
  provider?: string
  breakdown: ReturnType<typeof breakdownOf>
  usage: ReturnType<typeof tokenUsageOf>
  stats: ReturnType<typeof sessionStatsOf>
  trend: TrendBucket[]
  cumulative: CumulativeUsage
}

function buildPetView(projections: {
  pressure: unknown
  breakdown: unknown
  usage: unknown
  stats: unknown
  timeline: unknown
  todayBuckets: unknown
  cumulative: CumulativeUsage | null
}): PetView {
  const pressure = pressureOf(projections.pressure)
  const timeline = timelineOf(projections.timeline)
  const trend = todayUsageBucketsOf(projections.todayBuckets)
  const breakdown = breakdownOf(projections.breakdown)
  const usage = tokenUsageOf(projections.usage)
  const stats = sessionStatsOf(projections.stats)

  const percent = occupancyPercent(pressure)
  const contextWindow = pressure?.contextWindow
  const usedTokens = pressure?.projectedTokens ?? pressure?.pressureTokens

  // Tool share: fraction of the composition that is tools.
  let toolShare = 0
  if (breakdown) {
    const total = breakdown.systemTokens + breakdown.toolsTokens + breakdown.messageTokens
    if (total > 0) toolShare = breakdown.toolsTokens / total
  } else if (timeline?.current) {
    const c = timeline.current
    const total = (c.system ?? 0) + (c.tools ?? 0) + (c.user ?? 0) + (c.inject ?? 0) + (c.assistant ?? 0) + (c.tool ?? 0)
    if (total > 0) toolShare = ((c.tools ?? 0) + (c.tool ?? 0)) / total
  }

  // Satiation: lifetime billed tokens normalised to a 0..1 display scale.
  // Prefer the cross-session DSH cumulative when available; otherwise fall back
  // to the live session's own billed total so the pet always tracks real spend.
  const sessionBilled = totalBilled(usage)
  const accountBilled = (projections.cumulative && projections.cumulative.total > 0)
    ? projections.cumulative.total
    : sessionBilled
  const satiation = Math.min(1, Math.log10(1 + accountBilled) / 7)

  // Cumulative figure for the panel: when the host-served cross-session total
  // is absent or zero (e.g. route not yet loaded), surface the live session's
  // own cumulative buckets instead so the row never shows a misleading 0.
  const sessionTotals = usage
    ? {
        uncachedInputTokens: usage.uncachedInputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
      }
    : null
  const cumulative: CumulativeUsage = projections.cumulative && projections.cumulative.total > 0
    ? projections.cumulative
    : {
        sessions: projections.cumulative?.sessions ?? 1,
        totals: sessionTotals ?? { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        total: sessionBilled,
        byModel: [],
        days: [],
      }

  const stageInfo = stageForPercent(percent)
  return {
    percent,
    contextWindow,
    usedTokens,
    satiation,
    toolShare,
    progress: stageInfo.progress,
    stageInfo,
    model: timeline?.model,
    provider: timeline?.provider,
    breakdown,
    usage,
    stats,
    trend,
    cumulative,
  }
}

/** Locale strings (zh-first; small enough to inline, no locale plugin dependency). */
const T = {
  pet: '用量小宠物',
} as const

type RequestStatus = 'idle' | 'loading' | 'ready' | 'error'

/** Lifetime Ledger has its own reload generation and never follows trend refresh. */
function useLifetimeLedger(reloadKey: number, enabled: boolean) {
  const [value, setValue] = useState<ReturnType<typeof lifetimeLedgerOf>>(null)
  const valueRef = useRef(value); valueRef.current = value
  const [status, setStatus] = useState<RequestStatus>('idle')
  const [readyKey, setReadyKey] = useState<number | null>(null)
  useEffect(() => {
    if (!shouldStartPanelRequest(enabled, readyKey, reloadKey)) return
    let cancelled = false
    const request = createPanelRequestScope(PANEL_REQUEST_TIMEOUT_MS)
    // Explicit refresh keeps the previous committed ledger visible.
    setStatus(valueRef.current ? 'ready' : 'loading')
    fetch('/token-pet/usage/lifetime', { signal: request.signal })
      .then((res) => res.ok ? res.json() : Promise.reject(new Error(`lifetime:${res.status}`)))
      .then((raw) => {
        const next = lifetimeLedgerOf(raw)
        if (next === null) throw new Error('lifetime:invalid-response')
        if (!cancelled) { setValue(next); setStatus('ready'); setReadyKey(reloadKey) }
      })
      .catch(() => {
        if (!cancelled) { setStatus(valueRef.current ? 'ready' : 'error'); setReadyKey(reloadKey) }
      })
    return () => { cancelled = true; request.dispose() }
  }, [enabled, readyKey, reloadKey])
  return { value, status }
}

/** Fetch today's real usage trend only when the panel is visible. */
function useTodayUsageTrend(reloadKey: number, enabled: boolean): { value: TrendBucket[] | null; status: RequestStatus; readyKey: number | null; refreshing: boolean } {
  const [value, setValue] = useState<TrendBucket[] | null>(null)
  const valueRef = useRef(value); valueRef.current = value
  const [status, setStatus] = useState<RequestStatus>('idle')
  const [refreshing, setRefreshing] = useState(false)
  const [readyKey, setReadyKey] = useState<number | null>(null)
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const request = createPanelRequestScope(PANEL_REQUEST_TIMEOUT_MS)
    setStatus(valueRef.current ? 'ready' : 'loading')
    const timeZone = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC'
    let attempts = 0
    const load = () => fetch(todayTrendRequestUrl(timeZone), { signal: request.signal })
      .then((res) => res.ok ? res.json() : null)
      .then((next: unknown) => {
        if (cancelled) return
        if (!next || typeof next !== 'object') throw new Error('trend:invalid-response')
        const data = next as { buckets?: unknown; date?: string; byHour?: Array<{ hour?: string; total?: number; count?: number }>; refreshing?: unknown; retryAfterMs?: unknown }
        let parsed: TrendBucket[]
        if (Array.isArray(data.buckets)) parsed = todayUsageBucketsOf(next)
        else {
          if (!Array.isArray(data.byHour)) throw new Error('trend:invalid-buckets')
          const buckets = data.byHour.map((bucket) => {
            const start = Date.parse(`${data.date ?? ''}T${String(bucket.hour ?? '').padStart(2, '0')}:00:00`)
            return { start, end: start + 60 * 60 * 1000, total: bucket.total ?? 0, count: bucket.count ?? 0 }
          }).filter((bucket) => Number.isFinite(bucket.start))
          parsed = todayUsageBucketsOf({ buckets })
        }
        // A valid persisted snapshot is immediately usable. Host maintenance is
        // represented separately and never blocks the chart behind loading UI.
        setValue(parsed); setStatus('ready'); setReadyKey(reloadKey)
        const isRefreshing = data.refreshing === true
        setRefreshing(isRefreshing)
        if (isRefreshing && attempts < 30) {
          attempts++
          const retryAfterMs = typeof data.retryAfterMs === 'number' ? Math.min(5_000, Math.max(500, data.retryAfterMs)) : 2_000
          request.schedule(load, retryAfterMs)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRefreshing(false)
          setStatus(valueRef.current ? 'ready' : 'error')
          setReadyKey(reloadKey)
        }
      })
    void load()
    return () => { cancelled = true; request.dispose() }
  }, [reloadKey, enabled])
  return { value, status, readyKey, refreshing }
}

/** Read the persisted host snapshot. Opening never starts sync/build work. */
function useUsageIndex(enabled: boolean): { status: TokenPetIndexStatus | null; progress: IndexProgress; usable: boolean; build: () => void; cancel: () => void } {
  const [status, setStatus] = useState<TokenPetIndexStatus | null>(null)
  const [pollFailures, setPollFailures] = useState(0)
  const requestVersion = useRef(0)
  const pollController = useRef<ReturnType<typeof createPanelRequestScope> | null>(null)
  const pollInFlight = useRef(false)
  const operationController = useRef<ReturnType<typeof createPanelRequestScope> | null>(null)
  const poll = useCallback(() => {
    if (pollInFlight.current) return
    const version = ++requestVersion.current
    const request = createPanelRequestScope(PANEL_REQUEST_TIMEOUT_MS)
    pollController.current = request
    pollInFlight.current = true
    fetch('/token-pet/index/status', { signal: request.signal }).then((r) => r.ok ? r.json() : Promise.reject(new Error('index-status'))).then((value: unknown) => {
      if (version !== requestVersion.current) return
      const next = tokenPetIndexStatusOf(value)
      if (!next) throw new Error('index-status:invalid-response')
      setStatus(next); setPollFailures(0)
    }).catch(() => {
      if (version !== requestVersion.current) return
      setPollFailures((count) => Math.min(3, count + 1))
      setStatus((current) => current ? { ...current, status: 'error', building: false, syncing: false } : null)
    }).finally(() => {
      request.dispose()
      if (pollController.current === request) {
        pollController.current = null
        pollInFlight.current = false
      }
    })
  }, [])
  useEffect(() => {
    if (!enabled) return
    poll()
    return () => {
      requestVersion.current += 1
      pollController.current?.dispose(); pollController.current = null
      pollInFlight.current = false
      operationController.current?.dispose(); operationController.current = null
    }
  }, [enabled, poll])
  useEffect(() => {
    if (!enabled || pollFailures <= 0 || pollFailures >= 3) return
    const delays = [1_000, 2_000, 5_000]
    const timer = setTimeout(poll, delays[pollFailures - 1] ?? 5_000)
    return () => clearTimeout(timer)
  }, [enabled, pollFailures, poll])
  useEffect(() => {
    if (!enabled || (status?.status !== 'building' && status?.status !== 'syncing')) return
    const timer = setInterval(poll, 1_000)
    return () => clearInterval(timer)
  }, [enabled, status?.status, poll])
  useEffect(() => {
    if (!enabled || status?.refreshing !== true || status.building || status.syncing) return
    const timer = setTimeout(poll, status.retryAfterMs ?? 1_000)
    return () => clearTimeout(timer)
  }, [enabled, status?.refreshing, status?.retryAfterMs, status?.building, status?.syncing, poll])
  const build = useCallback(() => {
    const version = ++requestVersion.current
    operationController.current?.dispose()
    const request = createPanelRequestScope(PANEL_REQUEST_TIMEOUT_MS)
    operationController.current = request
    // Explicit user action: persisted indexes sync incrementally; missing ones build.
    const endpoint = status?.persisted ? '/token-pet/index/sync' : '/token-pet/index/build'
    fetch(endpoint, { method: 'POST', signal: request.signal }).then((response) => {
      if (!response.ok) throw new Error(endpoint.endsWith('/sync') ? 'index-sync' : 'index-build')
      if (version === requestVersion.current) poll()
    }).catch(() => {
      if (version === requestVersion.current) {
        setPollFailures(3)
        setStatus((current) => current ? { ...current, status: 'error', building: false, syncing: false } : null)
      }
    }).finally(() => {
      request.dispose()
      if (operationController.current === request) operationController.current = null
    })
  }, [poll, status?.persisted])
  const cancel = useCallback(() => {
    ++requestVersion.current
    pollController.current?.dispose(); pollController.current = null
    pollInFlight.current = false
    operationController.current?.dispose()
    const request = createPanelRequestScope(PANEL_REQUEST_TIMEOUT_MS)
    operationController.current = request
    fetch('/token-pet/index/cancel', { method: 'POST', signal: request.signal }).then(() => poll()).catch(() => {}).finally(() => {
      request.dispose()
      if (operationController.current === request) operationController.current = null
    })
  }, [poll])
  const hostProgress = status?.progress
  const progress: IndexProgress = {
    status: status?.status ?? (pollFailures > 0 ? 'error' : 'unknown'),
    completed: hostProgress?.completed,
    total: hostProgress?.total,
    indexed: status?.indexed ?? hostProgress?.indexed,
    skipped: hostProgress?.skipped,
    failed: hostProgress?.failed,
    pending: status?.pending ?? hostProgress?.pending,
  }
  return { status, progress, usable: canReadTokenPetIndex(status), build, cancel }
}

/** Drag a `position: fixed` element anchored at right/bottom via a translate offset.
 * `offset` is a pixel (x, y) applied as `transform: translate`, so the default
 * (0,0) keeps the window at the CSS anchor (bottom-right) and drag moves it.
 * `consumeClick()` returns true only if the pointer did NOT move during drag,
 * which lets click-handlers ignore drag-end events.
 */
function useFloatingDrag(storageKey?: 'pet' | 'panel') {
  const [offset, setOffset] = useState(() => {
    const settings = storageKey ? loadSettings() : null
    return storageKey === 'pet' ? settings!.position : storageKey === 'panel' ? settings!.panelPosition : { x: 0, y: 0 }
  })
  const elementRef = useRef<Element | null>(null)
  const offsetRef = useRef(offset)
  offsetRef.current = offset
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number; base: FloatingRect } | null>(null)
  const movedRef = useRef(false)

  const ref = useCallback((element: Element | null) => {
    elementRef.current = element
    if (!element) return
    const rect = element.getBoundingClientRect()
    setOffset((current) => {
      const base = { left: rect.left - current.x, top: rect.top - current.y, right: rect.right - current.x, bottom: rect.bottom - current.y }
      const next = clampFloatingOffset(current, base, window.innerWidth, window.innerHeight)
      return next.x === current.x && next.y === current.y ? current : next
    })
  }, [])
  const onPointerDown = (e: { pointerId?: number; clientX: number; clientY: number; button?: number; stopPropagation?: () => void; currentTarget?: Element }) => {
    if (e.button === 2) return
    e.stopPropagation?.()
    movedRef.current = false
    try { (e.currentTarget as (Element & { setPointerCapture?: (id: number) => void }) | undefined)?.setPointerCapture?.(e.pointerId as number) } catch { /* ignore */ }
    const rect = e.currentTarget?.getBoundingClientRect()
    if (!rect) return
    const origin = offsetRef.current
    dragRef.current = {
      startX: e.clientX, startY: e.clientY, originX: origin.x, originY: origin.y,
      base: { left: rect.left - origin.x, top: rect.top - origin.y, right: rect.right - origin.x, bottom: rect.bottom - origin.y },
    }
  }

  const consumeClick = () => {
    const moved = movedRef.current
    movedRef.current = false
    return !moved
  }

  useEffect(() => {
    const keepVisible = () => {
      const element = elementRef.current
      if (!element) return
      const rect = element.getBoundingClientRect()
      const current = offsetRef.current
      const base = { left: rect.left - current.x, top: rect.top - current.y, right: rect.right - current.x, bottom: rect.bottom - current.y }
      setOffset(clampFloatingOffset(current, base, window.innerWidth, window.innerHeight))
    }
    const onPointerMove = (e: PointerEvent) => {
      const d = dragRef.current
      if (d === null) return
      const dx = e.clientX - d.startX
      const dy = e.clientY - d.startY
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) movedRef.current = true
      setOffset(clampFloatingOffset({ x: d.originX + dx, y: d.originY + dy }, d.base, window.innerWidth, window.innerHeight))
    }
    const onPointerUp = () => { dragRef.current = null }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    window.addEventListener('resize', keepVisible)
    window.visualViewport?.addEventListener('resize', keepVisible)
    keepVisible()
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
      window.removeEventListener('resize', keepVisible)
      window.visualViewport?.removeEventListener('resize', keepVisible)
    }
  }, [])
  useEffect(() => {
    if (storageKey === 'pet') saveSettings({ position: offset })
    else if (storageKey === 'panel') saveSettings({ panelPosition: offset })
  }, [offset, storageKey])

  return { offset, ref, onPointerDown, consumeClick }
}

/** Resize from the visible grip. Proportions are preserved by default; hold Shift for free resize. */
function useFloatingResize(initialWidth: number, initialHeight: number, minW: number, maxW: number, minH: number, maxH: number) {
  const [size, setSize] = useState({ width: initialWidth, height: initialHeight })
  useEffect(() => {
    setSize((prev) => prev.width === initialWidth && prev.height === initialHeight ? prev : { width: initialWidth, height: initialHeight })
  }, [initialWidth, initialHeight])
  const resizing = useRef(false)
  const startRef = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null)

  const onResizeStart = (e: { pointerId?: number; clientX: number; clientY: number; stopPropagation?: () => void }) => {
    e.stopPropagation?.()
    resizing.current = true
    startRef.current = { startX: e.clientX, startY: e.clientY, startW: size.width, startH: size.height }
    const target = e as unknown as { currentTarget?: Element }
    try { (target.currentTarget as Element | undefined)?.setPointerCapture?.(e.pointerId as number) } catch { /* ignore */ }
  }

  useEffect(() => {
    const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
    const onPointerMove = (e: PointerEvent) => {
      const d = startRef.current
      if (!resizing.current || d === null) return
      const requestedW = d.startW + e.clientX - d.startX
      const requestedH = d.startH + e.clientY - d.startY
      if (e.shiftKey) {
        setSize({ width: clamp(requestedW, minW, maxW), height: clamp(requestedH, minH, maxH) })
        return
      }
      setSize(proportionalPanelSize(d.startW, d.startH, e.clientX - d.startX, e.clientY - d.startY, minW, maxW, minH, maxH))
    }
    const onPointerUp = () => { resizing.current = false; startRef.current = null }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    return () => { window.removeEventListener('pointermove', onPointerMove); window.removeEventListener('pointerup', onPointerUp) }
  }, [minW, maxW, minH, maxH])
  return { ...size, onResizeStart }
}

/**
 * Session-scoped feed. Mounted into `conversation.input.dock` where the session
 * kit is available; it reads the live session projections and pushes them to the
 * shared store so the always-mounted root window can render the pet + panel.
 */
function SessionProjectionFeed(props: SessionKit) {
  const useProjection = props.useProjection
  const pressure = useProjection ? useProjection('contextPressure') : undefined
  const breakdown = useProjection ? useProjection('contextBreakdown') : undefined
  const usage = useProjection ? useProjection('tokenUsage') : undefined
  const stats = useProjection ? useProjection('sessionStats') : undefined
  const timeline = useProjection ? useProjection('contextTimeline') : undefined
  // Host contract: todayUsageBuckets projection, independent of contextTimeline.
  const todayBuckets = useProjection ? useProjection('todayUsageBuckets') : undefined
  const useSession = props.useSession
  const running = useSession ? useSession((state) => Boolean((state as { running?: unknown }).running)) : undefined
  const removed = useSession ? useSession((state) => Boolean((state as { removed?: unknown }).removed)) : undefined
  const promptError = useSession ? useSession((state) => (state as { promptError?: unknown }).promptError) : undefined
  const lastToolResult = useSession ? useSession((state) => {
    const chat = (state as { chat?: { order?: readonly unknown[]; nodes?: Map<unknown, unknown> } }).chat
    const order = chat?.order
    const nodes = chat?.nodes
    if (!order || !nodes) return undefined
    for (let i = order.length - 1; i >= 0; i -= 1) {
      const node = nodes.get(order[i]) as { kind?: unknown } | undefined
      if (node?.kind === 'tool-result') return node
    }
    return undefined
  }) : undefined
  const lastCompaction = useSession ? useSession((state) => {
    const chat = (state as { chat?: { order?: readonly unknown[]; nodes?: Map<unknown, unknown> } }).chat
    const order = chat?.order
    const nodes = chat?.nodes
    if (!order || !nodes) return undefined
    for (let i = order.length - 1; i >= 0; i -= 1) {
      const node = nodes.get(order[i]) as { kind?: unknown; name?: unknown } | undefined
      if (node?.kind === 'compaction' || (node?.kind === 'command' && node.name === 'compact')) return node
    }
    return undefined
  }) : undefined
  // The conversation package exposes this session-scoped hook through the
  // standard kit. It is the only supported route for changing/submitting the
  // live composer draft (never fake this with a fetch call).
  const useInput = props.useInput
  const draft = useInput ? useInput((state) => String((state as { draft?: unknown }).draft ?? '')) : undefined
  const inputActions = props.inputActions
  const promptBridge = useMemo(() => inputActions ? createComposerPromptBridge(inputActions) : undefined, [inputActions])

  useEffect(() => {
    pushProjections({ pressure, breakdown, usage, stats, timeline, todayBuckets, running, removed, promptError, lastToolResult, lastCompaction, draft, applyPrompt: promptBridge?.apply, sendPrompt: promptBridge?.send })
  }, [pressure, breakdown, usage, stats, timeline, todayBuckets, running, removed, promptError, lastToolResult, lastCompaction, draft, promptBridge])

  // Invisible anchor — the window lives in shell.overlay; this component only
  // reports the live figures so the root window never disappears.
  return null
}

/** Root-scoped always-mounted window: separate pet buddy + a panel it toggles.
 * Pet and panel each have their own drag handle so the user can position them
 * independently; click-vs-drag is tracked so dragging the pet doesn't toggle
 * the panel by accident.
 */
function TokenPetWindow() {
  const [panelOpen, setPanelOpen] = useState(false)
  const [promptDrawerOpen, setPromptDrawerOpen] = useState(false)
  // Opening is split into paint-friendly phases: shell first, trend/aggregate
  // next, and prompt/settings last. This prevents a cold panel from blocking
  // the click response while large history data is parsed and rolled up.
  const [panelPhase, setPanelPhase] = useState<0 | 1 | 2>(0)
  const [trendReloadKey, setTrendReloadKey] = useState(0)
  // Lifetime refresh is independent from the trend generation.
  const [lifetimeReloadKey, setLifetimeReloadKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [filterModel, setFilterModel] = useState<string | null>(null)
  const [filterDay, setFilterDay] = useState<string | null>(null)
  const [snap, setSnap] = useState<ProjectionSnapshot | null>(null)
  const [settings, setSettings] = useState<TokenPetSettings>(loadSettings)
  const [viewport, setViewport] = useState(() => typeof window === 'undefined' ? { width: 1280, height: 800 } : { width: window.innerWidth, height: window.innerHeight })
  useEffect(() => {
    const updateViewport = () => setViewport({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', updateViewport)
    window.visualViewport?.addEventListener('resize', updateViewport)
    updateViewport()
    return () => { window.removeEventListener('resize', updateViewport); window.visualViewport?.removeEventListener('resize', updateViewport) }
  }, [])
  useEffect(() => {
    if (!panelOpen) { setPanelPhase(0); return }
    let cancelled = false
    const frame = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame(() => { if (!cancelled) setPanelPhase(1) })
      : setTimeout(() => { if (!cancelled) setPanelPhase(1) }, 0)
    return () => {
      cancelled = true
      if (typeof frame === 'number') {
        if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
        else clearTimeout(frame)
      }
    }
  }, [panelOpen])
  const { progress: indexProgress, usable: indexUsable, build: buildIndex, cancel: cancelIndex } = useUsageIndex(panelOpen)
  // Lifetime Ledger remains independent: it observes live/closed usage and
  // advances monotonically even before the optional usage index exists.
  const lifetimeLedger = useLifetimeLedger(lifetimeReloadKey, panelOpen && panelPhase >= 1)
  // Trend is backed by the durable index and is independent from Lifetime.
  const todayTrend = useTodayUsageTrend(trendReloadKey, canLoadTodayUsageTrend(panelOpen, panelPhase, indexUsable))
  const todayUsage = todayTrend.value
  // Unlock interactive tabs after the lightweight first paint. Data sections
  // own their loading/error states, so a missing index or failed request must
  // never leave Settings permanently unavailable.
  useEffect(() => {
    if (!panelOpen || panelPhase !== 1) return
    const timer = setTimeout(() => setPanelPhase(2), 0)
    return () => clearTimeout(timer)
  }, [panelOpen, panelPhase])
  useEffect(() => {
    const onSettings = (event: Event) => {
      const detail = (event as CustomEvent<TokenPetSettings>).detail
      if (detail) setSettings(detail)
    }
    window.addEventListener(SETTINGS_EVENT, onSettings)
    return () => window.removeEventListener(SETTINGS_EVENT, onSettings)
  }, [])
  const animation = usePetAnimation(undefined, settings.animationSpeed)
  const previousStage = useRef<string | null>(null)
  const previousPercent = useRef<number | null>(null)
  const previousTurns = useRef<number | null>(null)
  const previousRunning = useRef<boolean | null>(null)
  const previousRemoved = useRef<boolean | null>(null)
  const previousPromptError = useRef<unknown>(null)
  const previousToolKey = useRef<string | null>(null)
  const previousCompactionKey = useRef<string | null>(null)
  const contextBehavior = useRef(createContextSnapshot())
  const reducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const lowPerformance = settings.lowPerformance || (typeof navigator !== 'undefined' && (navigator.hardwareConcurrency ?? 8) <= 2)
  const activeAction = reducedMotion || lowPerformance ? 'idle' as const : animation.action

  // Resolve the active skin manifest (built-in + IndexedDB skins).
  const skinIndex = useMemo(() => builtinSkinIndex(), [])
  const activeSkin = useMemo<SkinManifest | undefined>(() => {
    if (settings.skinId === 'default') return undefined
    return skinIndex.skins.get(settings.skinId)
  }, [settings.skinId, skinIndex])

  useEffect(() => subscribeProjections(setSnap), [])

  // Independent drag handles: one for the pet anchor, one for the panel.
  const petDrag = useFloatingDrag('pet')
  const panelDrag = useFloatingDrag('panel')
  const { width, height, onResizeStart } = useFloatingResize(settings.panelWidth, settings.panelHeight, 360, 820, 420, 920)
  useEffect(() => { saveSettings({ panelWidth: width, panelHeight: height }) }, [width, height])
  // Never let a remembered desktop-sized panel exceed the real viewport. Do
  // not enforce a minimum here: on a short window that would make the child
  // taller than its clipped parent and hide the bottom sections permanently.
  const fittedPanel = fitPanelSizeToViewport(width, height, viewport.width, viewport.height)
  const visibleWidth = fittedPanel.width
  const visibleHeight = fittedPanel.height
  const panelContentHeight = fittedPanel.contentHeight

  // Keep projection derivation out of unrelated drag/resize/settings renders.
  // In particular, opening the panel also starts aggregate requests; memoizing
  // this pure work lets the first response update only the figures that changed.
  const view = useMemo(() => buildPetView({
    pressure: snap?.pressure,
    breakdown: snap?.breakdown,
    usage: snap?.usage,
    stats: snap?.stats,
    timeline: snap?.timeline,
    todayBuckets: todayUsage ?? snap?.todayBuckets,
    // Visible pet growth follows the same irreversible source as the panel.
    cumulative: lifetimeLedger.value,
  }), [snap?.pressure, snap?.breakdown, snap?.usage, snap?.stats, snap?.timeline, snap?.todayBuckets, todayUsage, lifetimeLedger.value])

  // Projection bridge for the event layer. These conservative signals are
  // derived only from public projections; host-specific compact/tool events can
  // publish richer PetEvents later without changing the animation API.
  useEffect(() => {
    const stage = view.stageInfo.stage
    const percent = view.percent
    const turns = view.stats?.turns ?? null
    if (previousStage.current === null) previousStage.current = stage
    else if (previousStage.current !== stage) {
      animation.publish({ action: 'evolve', dedupeKey: `evolve:${stage}` })
      previousStage.current = stage
    }
    const oldPercent = previousPercent.current
    if (percent !== null && oldPercent !== null && oldPercent < 90 && percent >= 90) {
      animation.publish({ action: 'warning', dedupeKey: 'context-warning' })
    }
    previousPercent.current = percent
    if (percent !== null) contextBehavior.current = reduceContextSnapshot(contextBehavior.current, { type: 'pressure', occupancyPercent: percent, source: 'real' })
    const oldTurns = previousTurns.current
    if (turns !== null && oldTurns !== null && turns > oldTurns) {
      animation.publish({ action: 'working', dedupeKey: `working:${turns}` })
    }
    previousTurns.current = turns
    const running = snap?.running
    if (typeof running === 'boolean') {
      if (previousRunning.current !== null && running !== previousRunning.current) {
        animation.publish({ action: running ? 'working' : 'idle', dedupeKey: `session-running:${running}:${turns ?? 0}` })
      }
      previousRunning.current = running
    }
    const removed = snap?.removed
    if (typeof removed === 'boolean') {
      if (previousRemoved.current === false && removed) {
        animation.publish({ action: 'archive', dedupeKey: `session-removed:${turns ?? 0}` })
      }
      previousRemoved.current = removed
    }
    if (snap?.promptError != null && snap.promptError !== previousPromptError.current) {
      animation.publish({ action: 'warning', dedupeKey: `prompt-error:${turns ?? 0}`, payload: snap.promptError })
    }
    previousPromptError.current = snap?.promptError ?? null
    const tool = snap?.lastToolResult as { seq?: unknown; callId?: unknown; time?: unknown; isError?: unknown } | undefined
    const toolKey = tool ? String(tool.seq ?? tool.callId ?? tool.time ?? '') : null
    if (toolKey && previousToolKey.current !== null && toolKey !== previousToolKey.current) {
      animation.publish({
        action: tool?.isError === true ? 'tool-failure' : 'tool-success',
        id: `tool-result:${toolKey}`,
        payload: tool,
      })
    }
    previousToolKey.current = toolKey
    const compact = snap?.lastCompaction as { kind?: unknown; seq?: unknown; outcome?: unknown } | undefined
    const compactPhase = compact?.kind === 'command' && compact.outcome == null ? 'start' : compact ? 'end' : null
    const compactKey = compact && compactPhase ? `${String(compact.kind)}:${String(compact.seq ?? '')}:${compactPhase}` : null
    if (compactKey && previousCompactionKey.current !== null && compactKey !== previousCompactionKey.current) {
      contextBehavior.current = reduceContextSnapshot(contextBehavior.current, {
        type: compactPhase === 'start' ? 'compact-start' : 'compact-end',
        source: 'real',
      })
      animation.publish({
        action: contextBehavior.current.state === 'EATING' ? 'eating' : 'digesting',
        id: `compaction:${compactKey}`,
        payload: { node: compact, context: contextBehavior.current },
      })
    }
    previousCompactionKey.current = compactKey
  }, [animation.publish, snap?.lastCompaction, snap?.lastToolResult, snap?.promptError, snap?.removed, snap?.running, view.percent, view.stageInfo.stage, view.stats?.turns])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const preview = (event: Event) => {
      const action = (event as CustomEvent<{ action?: unknown }>).detail?.action
      if (typeof action === 'string' && Object.prototype.hasOwnProperty.call(PET_ACTION_PRIORITY, action)) {
        animation.publish({ action: action as PetAction, id: `preview:${action}:${Date.now()}`, priority: 100, interrupt: true })
      }
    }
    window.addEventListener(PET_PREVIEW_EVENT, preview)
    return () => window.removeEventListener(PET_PREVIEW_EVENT, preview)
  }, [animation.publish])

  const doClearLifetime = async () => {
    if (busy) return false
    setBusy(true)
    const ok = await clearLifetimeLedgerAndReload(() => setLifetimeReloadKey((key) => key + 1))
    setBusy(false)
    return ok
  }

  // The pet is a SEPARATE, always-visible buddy at bottom-right. It is
  // independently draggable and toggles the panel on click (only if the
  // pointer didn't move, i.e. it was a click not a drag).
  const petNode = createPortal(
    h('div', {
      ref: petDrag.ref,
      style: css({ ...petFixed, maxWidth: 'calc(100vw - 16px)', maxHeight: 'calc(100vh - 16px)', transform: `translate(${petDrag.offset.x}px, ${petDrag.offset.y}px)` }),
      onPointerDown: petDrag.onPointerDown,
      onClick: () => { if (petDrag.consumeClick()) { animation.publish({ action: 'click', dedupeKey: 'pet-click', interrupt: true }); setPanelOpen((v) => !v) } },
      title: panelOpen ? '收起统计' : '查看用量统计',
    }, [
      h('div', { style: css({ ...petBob }) }, [
        h(PetSprite, {
          stage: view.stageInfo.stage,
          satiation: view.satiation,
          toolShare: view.toolShare,
          progress: view.progress,
          size: settings.size,
           action: activeAction,
           statusAction: animation.action,
           skin: activeSkin,
           animationSpeed: settings.animationSpeed,
           motionDisabled: reducedMotion || lowPerformance,
           onActionComplete: animation.returnToIdle,
        }),
        h('div', { style: css(stageChip), title: '当前上下文窗口占用率' }, `上下文 ${view.percent === null ? '–' : view.percent.toFixed(0)}%`),
      ]),
    ]),
    document.body,
  )

  // The panel is its own fixed-position window, independent from the pet.
  // The enhancer is an overlaid drawer, so opening it never changes or unmounts
  // the active tab. Narrow viewports use a bottom sheet; desktop uses the right.
  const narrowDrawer = viewport.width < 720 || visibleWidth < 460
  const panelNode = panelOpen ? createPortal(
    h('div', { ref: panelDrag.ref, style: css({ ...panelFixed, width: visibleWidth, height: visibleHeight, maxWidth: 'calc(100vw - 16px)', maxHeight: 'calc(100vh - 88px)', overflow: 'hidden', transform: `translate(${panelDrag.offset.x}px, ${panelDrag.offset.y}px)` }) }, [
      h('div', { style: css(dragHandle), onPointerDown: panelDrag.onPointerDown }, [
        h('span', { style: css(dragTitle) }, T.pet),
        h('div', { style: css(actionBar) }, [
          h('button', {
            onPointerDown: (e: { stopPropagation?: () => void }) => e.stopPropagation?.(),
            onClick: () => setPromptDrawerOpen((open) => !open),
            style: css({ ...actionBtn, ...enhanceActionBtn, ...(promptDrawerOpen ? enhanceActionBtnOpen : {}) }),
            'aria-expanded': promptDrawerOpen,
            'aria-controls': 'dsh-token-pet-prompt-drawer',
            title: '打开增强提示词抽屉（不会切换当前标签）',
          }, '✦ 增强提示词'),
          h('button', {
            onPointerDown: (e: { stopPropagation?: () => void }) => e.stopPropagation?.(),
            onClick: () => { setTrendReloadKey((key) => key + 1); setLifetimeReloadKey((key) => key + 1) },
            style: css(actionBtn),
            title: '刷新账本、趋势与当前会话统计',
          }, '刷新'),
          h('button', {
            onPointerDown: (e: { stopPropagation?: () => void }) => e.stopPropagation?.(),
            onClick: () => setPanelOpen(false),
            style: css(actionBtn),
            title: '收起浮窗面板（宠物仍保留）',
          }, '− 收起'),
        ]),
      ]),
      h(ContextPanel, {
        percent: view.percent,
        contextWindow: view.contextWindow,
        usedTokens: view.usedTokens,
        breakdown: view.breakdown,
        usage: view.usage,
        stats: view.stats,
        model: view.model,
        provider: view.provider,
        trend: view.trend,
        cumulative: view.cumulative,
        lifetimeLedger: lifetimeLedger.value,
        lifetimeStatus: lifetimeLedger.status,
        onClearLifetime: doClearLifetime,
        width: visibleWidth,
        height: panelContentHeight,
        filterModel,
        filterDay,
        onFilterModel: setFilterModel,
        onFilterDay: setFilterDay,
        prompt: snap?.draft,
        onApplyPrompt: snap?.applyPrompt,
        onSendPrompt: snap?.sendPrompt,
         trendStatus: todayTrend.status,
         refreshing: todayTrend.refreshing,
         indexProgress,
         onBuildIndex: buildIndex,
         onCancelIndex: cancelIndex,
         phase: panelPhase,
         onPetAction: (action) => animation.publish({ action, dedupeKey: `panel:${action}`, interrupt: true }),
        busy,
      }),
      h('aside', {
        id: 'dsh-token-pet-prompt-drawer',
        'aria-hidden': !promptDrawerOpen,
        style: css({
          ...promptDrawer,
          ...(narrowDrawer ? promptDrawerBottom : promptDrawerRight),
          ...(promptDrawerOpen ? promptDrawerVisible : (narrowDrawer ? promptDrawerBottomHidden : promptDrawerRightHidden)),
        }),
        onPointerDown: (event: { stopPropagation?: () => void }) => event.stopPropagation?.(),
      }, h('div', { style: css(promptDrawerScroller) }, h(PromptEnhancerPanel, {
        drawer: true,
        provider: view.provider,
        model: view.model,
        initial: snap?.draft,
        onApply: snap?.applyPrompt,
        onSend: snap?.sendPrompt,
        onClose: () => setPromptDrawerOpen(false),
        onAction: (action) => {
          if (action === 'prompt-enhancing' || action === 'prompt-ready') animation.publish({ action, dedupeKey: `panel:${action}`, interrupt: true })
        },
      }))),
      h('div', {
        style: css(resizeGrip),
        onPointerDown: onResizeStart,
        title: '拖动等比例缩放；按住 Shift 可自由调整宽高',
      }, '↘'),
    ]),
    document.body,
  ) : null

  return h(Fragment, null, petNode, panelNode)
}

export const name = 'dsh-token-pet'
export const inject = ['slots', 'locale']

interface SlotsService {
  inject(slot: string, register: () => unknown): void
  register(meta: Record<string, unknown>, component: unknown): unknown
}

export function apply(ctx: { slots: SlotsService }): void {
  // Inject the CSS once (keyframe for the floating bob). Guarded so a hot
  // reload/re-inject does not append a duplicate style tag.
  const CUSTOM_CSS = `
    @keyframes dsh-pet-idle { 0%,100% { transform:translateY(0) } 50% { transform:translateY(-4px) } }
     @keyframes dsh-pet-working { 0%,100% { transform:rotate(-3deg) } 50% { transform:rotate(3deg) } }
     @keyframes dsh-pet-eating { 0%,100% { transform:scale(1) } 50% { transform:scale(1.08) } }
     @keyframes dsh-pet-digesting { 0%,100% { transform:translateY(0) } 50% { transform:translateY(-3px) } }
      @keyframes dsh-pet-click { 0%,100% { transform:scale(1) } 50% { transform:scale(1.12) } }
     @keyframes dsh-pet-warning { 0%,100% { transform:translateX(0) } 25% { transform:translateX(-5px) } 75% { transform:translateX(5px) } }
     @keyframes dsh-pet-evolve { 0% { transform:scale(.8);opacity:.5 } 60% { transform:scale(1.18);opacity:1 } 100% { transform:scale(1) } }
     @keyframes dsh-pet-archive { from { opacity:1;transform:translateY(0) } to { opacity:.45;transform:translateY(8px) } }
     @keyframes dsh-pet-tool-success { 0%,100% { transform:scale(1) } 50% { transform:translateY(-6px) scale(1.06) } }
     @keyframes dsh-pet-tool-failure { 0%,100% { transform:rotate(0) } 35% { transform:rotate(-8deg) } 70% { transform:rotate(8deg) } }
     @keyframes dsh-pet-prompt-enhancing { 0%,100% { transform:scale(1) } 50% { transform:scale(1.04) } }
     @keyframes dsh-pet-prompt-ready { 0%,100% { transform:scale(1) } 50% { transform:scale(1.08) } }
     @keyframes dsh-pet-prop-working { 0%,100% { transform:rotate(-1.5deg) translateY(0) } 50% { transform:rotate(1.5deg) translateY(2px) } }
      @keyframes dsh-pet-token-feed { 0% { transform:translate(16px,-10px) scale(.7);opacity:0 } 35% { opacity:1 } 75% { transform:translate(-46px,34px) scale(.9);opacity:1 } 100% { transform:translate(-55px,38px) scale(.2);opacity:0 } }
      @keyframes dsh-pet-digest { 0% { transform:rotate(0) scale(.8);opacity:.35 } 50% { transform:rotate(180deg) scale(1.12);opacity:.9 } 100% { transform:rotate(360deg) scale(.8);opacity:.35 } }
      @keyframes dsh-pet-bubble-pop { 0% { transform:scale(.2);opacity:0 } 55% { transform:scale(1.18);opacity:1 } 100% { transform:scale(1);opacity:1 } }
      @keyframes dsh-pet-heart-float { 0% { transform:translateY(12px) scale(.4);opacity:0 } 45% { opacity:1 } 100% { transform:translateY(-18px) scale(1.05);opacity:0 } }
      @keyframes dsh-pet-evolve-ring { 0% { transform:scale(.5) rotate(0);opacity:0 } 55% { opacity:1 } 100% { transform:scale(1.18) rotate(180deg);opacity:0 } }
      @keyframes dsh-pet-magic-orbit { 0% { transform:translate(0,0) rotate(0) } 25% { transform:translate(8px,-8px) rotate(90deg) } 50% { transform:translate(18px,2px) rotate(180deg) } 75% { transform:translate(8px,10px) rotate(270deg) } 100% { transform:translate(0,0) rotate(360deg) } }
  `
  if (typeof document !== 'undefined' && document.querySelector('style[data-dsh-token-pet="1"]') == null) {
    const tag = document.createElement('style')
    tag.dataset.dshTokenPet = '1'
    tag.textContent = CUSTOM_CSS
    document.head.appendChild(tag)
  }

  // Inject sprite-sheet keyframe CSS for skins that provide sprite images.
  injectSpriteSheetCss()

  // Register a real DSH settings section in addition to the compact panel
  // details. This keeps preferences discoverable even when the floating panel
  // is closed.
  ctx.slots.inject('settings.section', () => ctx.slots.register(
    { name: 'settings.section', id: 'token-pet', order: 60, label: () => '用量小宠物' },
    TokenPetSettingsPanel,
  ))

  // Root-scoped window: ALWAYS mounted on the app shell, so the pet (and its
  // summon button when hidden) can never be lost. Wrapped in an error boundary
  // so even a panel render error never removes the pet.
  ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    { name: 'shell.overlay', id: 'token-pet', order: 50, label: () => '用量小宠物' },
    () => h(ErrorBoundary, null, h(TokenPetWindow)),
  ))

  // Session-scoped feed: reports live projection figures to the window.
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register(
    { name: 'conversation.input.dock', id: 'token-pet-feed', order: 50, label: () => '用量小宠物' },
    (props: SessionKit) => h(SessionProjectionFeed, props),
  ))
}

// ---- styling -------------------------------------------------------------

const petFixed: CSSProperties = {
  position: 'fixed',
  bottom: 18,
  right: 18,
  zIndex: FLOATING_LAYER.pet,
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
  gap: 6,
  pointerEvents: 'auto',
  userSelect: 'none',
  cursor: 'pointer',
  // Keep transform free for dragging. The bob animation lives on petBob;
  // animating this element would override the drag translate transform.
  filter: 'drop-shadow(0 8px 16px rgba(0,0,0,0.28))',
}

const petBob: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
  gap: 6,
  // Motion is authored in the frame sheets only; no programmatic bob/float.
  animation: 'none',
}

const panelFixed: CSSProperties = {
  position: 'fixed',
  top: 72,
  left: 24,
  zIndex: FLOATING_LAYER.panel,
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  pointerEvents: 'auto',
  userSelect: 'none',
}

const dragHandle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  cursor: 'grab',
  padding: '5px 12px',
  borderRadius: 10,
  border: '1px solid rgba(128,128,160,0.28)',
  background: 'rgba(24,26,38,0.92)',
  boxShadow: '0 8px 22px rgba(0,0,0,0.3)',
  flexShrink: 0,
  width: '100%',
  boxSizing: 'border-box',
}

const dragTitle: CSSProperties = {
  color: '#c6c9d6',
  fontSize: 13,
  fontWeight: 600,
  whiteSpace: 'nowrap',
}

const resizeGrip: CSSProperties = {
  position: 'absolute',
  right: 8,
  bottom: 8,
  width: 28,
  height: 28,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'nwse-resize',
  background: 'rgba(255,209,102,0.18)',
  color: '#ffd166',
  border: '1px solid rgba(255,209,102,0.9)',
  borderRadius: 7,
  fontSize: 21,
  fontWeight: 700,
  lineHeight: 1,
  zIndex: 3,
}

const stageChip: CSSProperties = {
  alignSelf: 'center',
  textAlign: 'center',
  color: '#e8eaf2',
  background: 'rgba(24,26,38,0.92)',
  border: '1px solid rgba(128,128,160,0.28)',
  padding: '2px 8px',
  borderRadius: 999,
  fontSize: 11,
  whiteSpace: 'nowrap',
  boxShadow: '0 6px 18px rgba(0,0,0,0.3)',
}

const actionBar: CSSProperties = { display: 'flex', gap: 6, minWidth: 0 }
const actionBtn: CSSProperties = {
  color: '#9aa0b5',
  background: 'rgba(24,26,38,0.9)',
  border: '1px solid rgba(128,128,160,0.28)',
  borderRadius: 8,
  padding: '3px 9px',
  fontSize: 11,
  cursor: 'pointer',
  boxShadow: '0 6px 18px rgba(0,0,0,0.3)',
  whiteSpace: 'nowrap',
}
const enhanceActionBtn: CSSProperties = { color: '#f0e8ff', background: 'linear-gradient(135deg,rgba(98,124,255,.8),rgba(128,105,217,.8))', borderColor: 'rgba(196,167,255,.72)', fontWeight: 700 }
const enhanceActionBtnOpen: CSSProperties = { color: '#fff', boxShadow: '0 0 0 2px rgba(196,167,255,.2),0 6px 18px rgba(0,0,0,.3)' }
const promptDrawer: CSSProperties = { position: 'absolute', zIndex: 6, boxSizing: 'border-box', background: 'linear-gradient(145deg,rgba(31,35,55,.995),rgba(18,20,31,.995))', border: '1px solid rgba(196,167,255,.42)', boxShadow: '-12px 0 30px rgba(0,0,0,.4)', transition: 'transform .2s ease,opacity .2s ease,visibility .2s ease', opacity: 0, visibility: 'hidden', pointerEvents: 'none', overflow: 'hidden' }
const promptDrawerRight: CSSProperties = { top: 39, right: 0, bottom: 0, width: 'min(78%, 390px)', borderRadius: '14px 0 14px 14px' }
const promptDrawerBottom: CSSProperties = { left: 0, right: 0, bottom: 0, maxHeight: '74%', borderRadius: '14px 14px 0 0', boxShadow: '0 -12px 30px rgba(0,0,0,.4)' }
const promptDrawerVisible: CSSProperties = { transform: 'translate(0,0)', opacity: 1, visibility: 'visible', pointerEvents: 'auto' }
const promptDrawerRightHidden: CSSProperties = { transform: 'translateX(104%)' }
const promptDrawerBottomHidden: CSSProperties = { transform: 'translateY(104%)' }
const promptDrawerScroller: CSSProperties = { width: '100%', height: '100%', maxHeight: '100%', boxSizing: 'border-box', overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain', padding: '12px 12px 54px', userSelect: 'text' }
