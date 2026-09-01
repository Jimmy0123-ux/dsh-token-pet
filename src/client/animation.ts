import { createElement as h, useEffect, useRef, useState, type ReactNode } from 'react'
import { css } from './derive.ts'
import { eventPriority, PetEventDedupe, type PetAction, type PetEvent } from './events.ts'
import { PET_ACTION_SHEET_SPECS } from './pet-action-sheets.generated.ts'

export interface AnimationFrame { transform?: string; opacity?: number; durationMs?: number }
export interface AnimationSpec { frames: AnimationFrame[]; loop?: boolean; durationMs?: number }

/**
 * Placeholder motion specs (legacy; the authored sheets are the authoritative
 * motion source in PetSprite). `loop` mirrors the generated action sheets.
 * One-shot completion timing no longer comes from these `durationMs` values:
 * the queue uses {@link oneShotDurationMs} (the real 32-frame sheet totalMs),
 * and the player signals the exact end via onComplete -> returnToIdle.
 */
export const PET_ANIMATIONS: Readonly<Record<PetAction, AnimationSpec>> = {
  idle: { frames: [{ transform: 'translateY(0)' }, { transform: 'translateY(-4px)' }, { transform: 'translateY(0)' }], loop: true, durationMs: 1800 },
  working: { frames: [{ transform: 'rotate(-3deg)' }, { transform: 'rotate(3deg)' }], loop: true, durationMs: 1667 },
  eating: { frames: [{ transform: 'scale(1)' }, { transform: 'scale(1.08)' }, { transform: 'scale(1)' }], durationMs: 3750 },
  digesting: { frames: [{ transform: 'translateY(0)' }, { transform: 'translateY(-3px)' }, { transform: 'translateY(0)' }], durationMs: 2333 },
  warning: { frames: [{ transform: 'translateX(0)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(0)' }], loop: true, durationMs: 2417 },
  evolve: { frames: [{ transform: 'scale(.8)', opacity: .5 }, { transform: 'scale(1.18)', opacity: 1 }, { transform: 'scale(1)' }], durationMs: 3200 },
  click: { frames: [{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }], durationMs: 1575 },
  archive: { frames: [{ transform: 'translateY(0)', opacity: 1 }, { transform: 'translateY(8px)', opacity: .45 }], durationMs: 3575 },
  'tool-success': { frames: [{ transform: 'scale(1)' }, { transform: 'translateY(-6px) scale(1.06)' }, { transform: 'scale(1)' }], durationMs: 1283 },
  'tool-failure': { frames: [{ transform: 'rotate(0)' }, { transform: 'rotate(-8deg)' }, { transform: 'rotate(8deg)' }, { transform: 'rotate(0)' }], durationMs: 2333 },
  'prompt-enhancing': { frames: [{ transform: 'scale(1)' }, { transform: 'scale(1.04)' }], loop: true, durationMs: 2083 },
  'prompt-ready': { frames: [{ transform: 'scale(.96)' }, { transform: 'scale(1.08)' }, { transform: 'scale(1)' }], durationMs: 1625 },
}

export interface AnimationController { action: PetAction; publish(event: PetEvent): void; clear(): void; returnToIdle(): void }

/**
 * Real one-shot play duration for an action (all frames at 1x speed), taken
 * from the generated 32-frame sheet so the queue never cuts a full playback
 * short. Falls back to the legacy placeholder when a sheet is missing.
 */
export function oneShotDurationMs(action: PetAction): number {
  return PET_ACTION_SHEET_SPECS[action]?.totalMs ?? PET_ANIMATIONS[action]?.durationMs ?? 500
}

/** Generous safety net; exact completion is owned by the player's onComplete. */
export function oneShotSafetyDurationMs(action: PetAction, speed: number): number {
  if (speed <= 0) return 300
  const playMs = Math.max(1, Math.round(oneShotDurationMs(action) / Math.max(.1, speed)))
  return playMs + 5_000 // embedded 22MB strip decode must never eat playback time
}

/** Highest priority wins; equal priority keeps the latest event. */
export function selectCoalescedPetEvent(events: readonly PetEvent[]): PetEvent | null {
  let selected: PetEvent | null = null
  for (const event of events) {
    if (selected === null || eventPriority(event) >= eventPriority(selected)) selected = event
  }
  return selected
}

export function isImmediatePetEvent(event: PetEvent): boolean {
  return event.interrupt === true || event.action === 'click' || eventPriority(event) >= 60
}

/** Queue controller: priority preempts current animation; baseline loops drain queued events. */
export function usePetAnimation(events: PetEvent[] = [], speed = 1): AnimationController {
  const [action, setAction] = useState<PetAction>('idle')
  const current = useRef<PetEvent | null>(null)
  const queue = useRef<PetEvent[]>([])
  const dedupe = useRef(new PetEventDedupe())
  const finishTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const coalesceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingEvents = useRef<PetEvent[]>([])
  const speedRef = useRef(speed)
  useEffect(() => { speedRef.current = speed }, [speed])

  // The controller functions close over refs only, so they are created once and
  // keep a stable identity across renders. That lets memoized consumers (the
  // pet sprite) and stable callbacks avoid needless re-renders.
  const api = useRef<Pick<AnimationController, 'publish' | 'clear' | 'returnToIdle'>>(null as never)
  if (api.current === null) {
    const start = (event: PetEvent) => {
      current.current = event
      setAction(event.action)
      if (finishTimer.current) clearTimeout(finishTimer.current)
      const spec = PET_ANIMATIONS[event.action]
      if (!spec.loop) {
        // The player itself signals the exact end via onComplete. This timer is
        // only a safety net; it includes a load grace so decoding the embedded
        // strip cannot consume playback time and cut the final frames short.
        finishTimer.current = setTimeout(
          returnToIdle,
          oneShotSafetyDurationMs(event.action, speedRef.current),
        )
      }
    }

    const returnToIdle = () => {
      if (finishTimer.current) clearTimeout(finishTimer.current)
      finishTimer.current = null
      const next = queue.current.shift()
      if (next) start(next)
      else { current.current = null; setAction('idle') }
    }

    const dispatch = (event: PetEvent, force = false) => {
      const cur = current.current
      const currentSpec = cur ? PET_ANIMATIONS[cur.action] : null
      // Explicit user/critical actions replace even an equal/higher-priority
      // one-shot. Background events keep the ordinary priority/queue contract.
      if (force || cur === null || currentSpec?.loop || eventPriority(event) > eventPriority(cur)) start(event)
      else queue.current.push(event)
    }
    const flushPending = () => {
      coalesceTimer.current = null
      const selected = selectCoalescedPetEvent(pendingEvents.current)
      pendingEvents.current = []
      if (selected) dispatch(selected)
    }
    const publish = (event: PetEvent) => {
      if (!dedupe.current.accept(event)) return
      const immediate = isImmediatePetEvent(event)
      if (immediate) {
        if (coalesceTimer.current) clearTimeout(coalesceTimer.current)
        coalesceTimer.current = null
        pendingEvents.current = []
        dispatch(event, true)
        return
      }
      pendingEvents.current.push(event)
      if (!coalesceTimer.current) coalesceTimer.current = setTimeout(flushPending, 40)
    }

    const clear = () => {
      if (finishTimer.current) clearTimeout(finishTimer.current)
      if (coalesceTimer.current) clearTimeout(coalesceTimer.current)
      finishTimer.current = null
      coalesceTimer.current = null
      pendingEvents.current = []
      queue.current = []
      current.current = null
      setAction('idle')
    }
    api.current = { publish, clear, returnToIdle }
  }

  useEffect(() => { for (const event of events) api.current.publish(event) }, [events])
  useEffect(() => () => {
    if (finishTimer.current) clearTimeout(finishTimer.current)
    if (coalesceTimer.current) clearTimeout(coalesceTimer.current)
  }, [])

  return { action, publish: api.current.publish, clear: api.current.clear, returnToIdle: api.current.returnToIdle }
}

/** SVG/DOM placeholder player. Outer drag transform remains on the parent. */
export function PetAnimationPlayer({ action, children, reducedMotion, lowPerformance }: {
  action: PetAction; children: ReactNode; reducedMotion?: boolean; lowPerformance?: boolean
}) {
  const spec = PET_ANIMATIONS[action]
  const disabled = reducedMotion || lowPerformance
  const animation = disabled || spec.frames.length < 2 ? undefined : `dsh-pet-${action} ${spec.durationMs ?? 500}ms ease-in-out ${spec.loop ? 'infinite' : '1'}`
  return h('div', { style: css({ display: 'inline-flex', transformOrigin: 'center', animation }) }, children)
}
