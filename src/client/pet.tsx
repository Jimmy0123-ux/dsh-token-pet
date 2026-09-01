/**
 * Token Pet renders one fixed approved identity and common action assets.
 * Context pressure bands never change identity, outfit or asset paths; they
 * only drive labels, meter progress and subdued warning visuals.
 *
 * This component is pure (no host/session access): the caller derives the
 * pressure-band-compatible {@link PetStage} and figures and hands them in.
 * @module dsh-token-pet/pet
 */
import { createElement as h, memo, useEffect, useState, type CSSProperties } from 'react'

import { css, type PetStage } from './derive.ts'
import { PET_ACTION_STATUS_LABELS, type PetAction } from './events.ts'
import { resolveStyleOverride, type SkinManifest } from './skin.ts'
import { FORMAL_PET_ASSET } from './pet-asset.generated.ts'
import { PET_ACTION_SHEET_SPECS, type ActionSheetSpec } from './pet-action-sheets.generated.ts'
import { PetActionPlayer } from './pet-action-player.tsx'

export interface PetProps {
  /** Internal pressure band; never selects a different visual identity. */
  stage: PetStage
  /** Satiation 0..1 (cumulative tokens normalised) — drives a little belly bar. */
  satiation: number
  /** Tool-fraction 0..1 (tools share of composition) — drives badge count. */
  toolShare: number
  /** Pressure 0..1 within the current stage — drives the ring arc. */
  progress: number
  /** Tool call count rendered as a badge stack. */
  toolCalls?: number
  size?: number
  /** Visual authored action; reduced-motion may force this to idle. */
  action?: PetAction
  /** Semantic runtime action used by the status badge, never altered by motion policy. */
  statusAction?: PetAction
  /** Optional skin manifest for style overrides (color-only MVP skins). */
  skin?: SkinManifest
  /** User animation multiplier; 0 freezes all pet motion. */
  animationSpeed?: number
  /** Reduced-motion and low-performance hard stop. */
  motionDisabled?: boolean
  /** Called exactly once when a non-looping action sheet finishes its last frame. */
  onActionComplete?: () => void
}

/** Per-stage visual constants. */
const STAGE_META: Record<PetStage, {
  body: string
  belly: string
  outline: string
  eye: string
  pupil: string
  accent: string
  scaleY: number
  eyeScale: number
  mouth: 'sleep' | 'smile' | 'grin' | 'worried' | 'strained' | 'alarm'
  sweat: boolean
  ring: string
  glow: boolean
}> = {
  newborn: { body: '#8fd6a8', belly: '#c9efd6', outline: '#5aa96f', eye: '#1e4a31', pupil: '#0c2a1a', accent: '#ffd27d', scaleY: 1, eyeScale: 1, mouth: 'smile', sweat: false, ring: '#8fbf9b', glow: false },
  growth: { body: '#8fd6a8', belly: '#c9efd6', outline: '#5aa96f', eye: '#1e4a31', pupil: '#0c2a1a', accent: '#ffd27d', scaleY: 1, eyeScale: 1, mouth: 'smile', sweat: false, ring: '#8fbf9b', glow: false },
  active: { body: '#8fd6a8', belly: '#c9efd6', outline: '#5aa96f', eye: '#1e4a31', pupil: '#0c2a1a', accent: '#ffd27d', scaleY: 1, eyeScale: 1, mouth: 'smile', sweat: false, ring: '#c5ae70', glow: true },
  heavy: { body: '#8fd6a8', belly: '#c9efd6', outline: '#5aa96f', eye: '#1e4a31', pupil: '#0c2a1a', accent: '#ffd27d', scaleY: 1, eyeScale: 1, mouth: 'smile', sweat: false, ring: '#c79572', glow: false },
  overload: { body: '#8fd6a8', belly: '#c9efd6', outline: '#5aa96f', eye: '#1e4a31', pupil: '#0c2a1a', accent: '#ffd27d', scaleY: 1, eyeScale: 1, mouth: 'smile', sweat: true, ring: '#d98282', glow: true },
  critical: { body: '#8fd6a8', belly: '#c9efd6', outline: '#5aa96f', eye: '#1e4a31', pupil: '#0c2a1a', accent: '#ffd27d', scaleY: 1, eyeScale: 1, mouth: 'smile', sweat: true, ring: '#c96569', glow: true },
}

/**
 * Render the SVG mouth for the given stage.
 * @param stage - pet evolution stage.
 * @param meta - the stage meta (for stroke color reuse).
 */
function mouthFor(_stage: PetStage, stroke: string) {
  const common = { fill: 'none', stroke, strokeWidth: 2.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  return h('path', { d: 'M -8 3 Q 0 9 8 3', ...common })
}

/** Fixed-identity fallback eyes; pressure bands never alter face geometry. */
function eyesFor(_stage: PetStage, meta: (typeof STAGE_META)[PetStage]) {
  const r = 6.4
  const gap = 15
  const yOff = -6
  return [h('g', { key: 'eyes' }, [
    h('circle', { cx: -gap, cy: yOff, r, fill: meta.eye }),
    h('circle', { cx: gap, cy: yOff, r, fill: meta.eye }),
    h('circle', { cx: -gap + 2.2, cy: yOff - 2.2, r: 1.9, fill: '#ffffff', opacity: 0.85 }),
    h('circle', { cx: gap + 2.2, cy: yOff - 2.2, r: 1.9, fill: '#ffffff', opacity: 0.85 }),
  ])]
}

/** Pressure bands may override only the warning ring; identity colors and geometry stay fixed. */
function stageMetaWithSkin(stage: PetStage, skin?: SkinManifest): (typeof STAGE_META)[PetStage] {
  const base = STAGE_META[stage]
  const ring = resolveStyleOverride(skin, `${stage}.ring`) ?? base.ring
  return { ...base, ring }
}

/**
 * Main pet silhouette. `progress` drives the outer ring arc; `satiation` the
 * internal fill; `toolCalls`/`toolShare` the badge stack.
 */
function SvgPetFallback(p: PetProps) {
  const meta = stageMetaWithSkin(p.stage, p.skin)
  const size = p.size ?? 120
  const R = 40
  const CIRC = 2 * Math.PI * R
  const sat = Math.min(1, Math.max(0, p.satiation))
  const arcPct = Math.min(1, Math.max(0, p.progress)) * 100
  const badges = Math.min(4, Math.round((p.toolShare ?? 0) * 4) + (p.toolCalls ?? 0) % 2)
  const badge = (i: number) => {
    const deg = (i / Math.max(1, badges || 1)) * 360 - 120
    const rad = (deg * Math.PI) / 180
    const cx = 34 + Math.cos(rad) * 40
    const cy = 18 + Math.sin(rad) * 40
    return h('g', { key: `b${i}` }, [
      h('circle', { cx, cy, r: 4.4, fill: '#ffffff', stroke: meta.accent, strokeWidth: 1.8 }),
      h('circle', { cx, cy, r: 1.8, fill: meta.accent }),
    ])
  }

  const ring = [
    h('circle', { key: 'track', cx: 36, cy: 40, r: R, fill: 'none', stroke: 'rgba(128,128,160,0.16)', strokeWidth: 5 }),
    h('circle', {
      key: 'arc',
      cx: 36,
      cy: 40,
      r: R,
      fill: 'none',
      stroke: meta.ring,
      strokeWidth: 5,
      strokeLinecap: 'round',
      strokeDasharray: `${(CIRC * arcPct) / 100} ${CIRC}`,
      transform: 'rotate(-90 36 40)',
      opacity: p.progress > 0 ? 1 : 0.25,
    }),
  ]

  const bodyStyle: CSSProperties = { transform: `scaleY(${meta.scaleY})`, transformOrigin: 'center 78%' }

  return h('svg', {
    viewBox: '0 0 72 80',
    width: size,
    height: size * (80 / 72),
    role: 'img',
    style: css({ overflow: 'visible', animation: 'none' }),
  }, [
    // Glow behind the creature at active+ stages.
    ...(meta.glow ? [h('circle', { key: 'glow', cx: 36, cy: 40, r: 34, fill: meta.body, opacity: 0.14, style: css({ filter: 'blur(6px)' }) })] : []),
    // Accessory alarm ring at critical.
    ...(p.stage === 'critical' ? [h('circle', { key: 'alarm', cx: 36, cy: 40, r: 30 + p.progress * 8, fill: 'none', stroke: meta.ring, strokeWidth: 2.4, opacity: Math.max(0, 1 - p.progress) })] : []),
    // Load ring.
    ...ring,
    // Body.
    h('g', { key: 'body', style: css(bodyStyle) }, [
      h('path', {
        d: 'M 36 14 C 24 14 12 24 12 40 C 12 54 22 66 36 66 C 50 66 60 54 60 40 C 60 24 48 14 36 14 Z',
        fill: meta.body,
        stroke: meta.outline,
        strokeWidth: 2,
      }),
      // Belly.
      h('path', {
        d: 'M 36 34 C 26 34 20 42 20 50 C 20 58 27 64 36 64 C 45 64 52 58 52 50 C 52 42 46 34 36 34 Z',
        fill: meta.belly,
        opacity: 0.9,
        style: css({ transform: `scaleY(${0.7 + sat * 0.4})`, transformOrigin: 'center bottom' }),
      }),
      // Cheeks.
      h('circle', { cx: 17, cy: 48, r: 4.2, fill: meta.accent, opacity: 0.5 }),
      h('circle', { cx: 55, cy: 48, r: 4.2, fill: meta.accent, opacity: 0.5 }),
      ...eyesFor(p.stage, meta),
      h('g', { key: 'mouth' }, mouthFor(p.stage, meta.outline)),
    ]),
    // Satiation belly meter strip at the bottom.
    h('rect', { key: 'satBg', x: 20, y: 72, width: 32, height: 3.4, rx: 1.7, fill: 'rgba(128,128,160,0.2)' }),
    h('rect', { key: 'satFill', x: 20, y: 72, width: Math.max(2, 32 * sat), height: 3.4, rx: 1.7, fill: meta.ring }),
    // Badge stack near the top-right.
    ...Array.from({ length: badges }, (_, i) => badge(i)),
    // Sweat drop at strained stages.
    ...(meta.sweat ? [
      h('path', { key: 'sweat', d: 'M 54 24 q 5 8 0 12 q -8 -1 0 -12', fill: '#7ec8e3', opacity: 0.9 }),
    ] : []),
  ])
}

const ACTION_STATUS_COLORS: Readonly<Record<PetAction, string>> = {
  idle: '#5e9b73',
  working: '#5f83cf',
  eating: '#bd8745',
  digesting: '#9a7a4f',
  warning: '#c96569',
  evolve: '#b9973e',
  click: '#d875a4',
  archive: '#70768c',
  'tool-success': '#43a96f',
  'tool-failure': '#bd555d',
  'prompt-enhancing': '#8069d9',
  'prompt-ready': '#43a96f',
}

function formalActionDecoration(action: PetAction, color: string) {
  const bubble: CSSProperties = {
    position: 'absolute', top: '17%', left: '-8%', display: 'grid', placeItems: 'center', width: 26, height: 26,
    borderRadius: '50%', color: '#fff', background: color, border: '2px solid rgba(255,255,255,.9)',
    boxShadow: `0 3px 12px ${color}`, fontWeight: 900, fontSize: 15,
  }
  if (action === 'working') return h('div', { key: 'action', 'aria-label': '工作中', style: css({
    position: 'absolute', left: '20%', right: '20%', bottom: '11%', height: '23%', borderRadius: '7px 7px 3px 3px',
    border: '2px solid #45617b', background: 'linear-gradient(145deg,#dff4ff,#8ccbe9)', boxShadow: '0 5px 10px rgba(0,0,0,.25)',
    transformOrigin: '50% 100%',
  }) }, [
    h('span', { key: 'screen', style: css({ position: 'absolute', inset: '17% 17% 25%', borderRadius: 3, background: '#1c3750' }) }),
    h('span', { key: 'line1', style: css({ position: 'absolute', left: '27%', top: '34%', width: '28%', height: 2, background: '#7fe6c4' }) }),
    h('span', { key: 'line2', style: css({ position: 'absolute', left: '35%', top: '46%', width: '34%', height: 2, background: '#91a7ff' }) }),
  ])
  if (action === 'eating') return h('span', { key: 'action', 'aria-label': '正在吃 Token', style: css({
    ...bubble, left: 'auto', right: '-10%', background: '#ffcf67', color: '#6c4210',
  }) }, 'T')
  if (action === 'digesting') return h('span', { key: 'action', 'aria-label': '正在消化', style: css({
    position: 'absolute', left: '29%', right: '29%', bottom: '20%', aspectRatio: '1', borderRadius: '50%',
    border: `3px dashed ${color}`, boxShadow: `0 0 14px ${color}`,
  }) })
  if (action === 'warning' || action === 'tool-failure') return h('span', { key: 'action', 'aria-label': '警告', style: css({ ...bubble, background: 'rgba(190,85,91,.82)', boxShadow: '0 2px 7px rgba(145,55,60,.18)' }) }, '!')
  if (action === 'tool-success' || action === 'prompt-ready') return h('span', { key: 'action', 'aria-label': '完成', style: css({ ...bubble, background: '#43b875' }) }, '✓')
  if (action === 'click') return h('span', { key: 'action', 'aria-label': '开心', style: css({ ...bubble, background: '#ef78a8' }) }, '♥')
  if (action === 'evolve') return h('span', { key: 'action', 'aria-label': '成长', style: css({
    position: 'absolute', inset: '8% -8% 5%', borderRadius: '50%', border: '3px solid #ffd76d',
    boxShadow: '0 0 24px #ffd76d, inset 0 0 20px rgba(255,215,109,.55)',
  }) })
  if (action === 'prompt-enhancing') return h('span', { key: 'action', 'aria-label': '正在增强提示词', style: css({
    ...bubble, background: '#8069d9',
  }) }, '✦')
  if (action === 'archive') return h('span', { key: 'action', 'aria-label': '已归档', style: css({ ...bubble, background: '#70768c' }) }, '↓')
  return null
}

/**
 * Formal default pet renderer. The approved character artwork supplies a clear
 * identity while real usage still drives aura, stage state, tool motes,
 * satiation and the existing action animations. SVG remains a fail-safe when
 * static plugin assets cannot be served.
 *
 * Memoized: the sprite only re-renders when a prop actually changes (snapshot
 * ticks that do not affect the pet skip it entirely). The action player is
 * canvas-driven and never re-renders per frame.
 */
export const PetSprite = memo(function PetSprite(p: PetProps) {
  const [assetReady, setAssetReady] = useState(true)
  const [stripError, setStripError] = useState<string | null>(null)
  const action = p.action ?? 'idle'
  const statusAction = p.statusAction ?? action
  const statusLabel = PET_ACTION_STATUS_LABELS[statusAction]
  const statusColor = ACTION_STATUS_COLORS[statusAction]
  // A failed strip fetch (host route not yet live, host down) falls back to the
  // static identity artwork; retry after a delay so the pet self-heals once the
  // host serves strips again.
  useEffect(() => { setStripError(null) }, [action])
  useEffect(() => {
    if (stripError !== action) return
    const timer = setTimeout(() => setStripError(null), 10_000)
    return () => clearTimeout(timer)
  }, [stripError, action])
  if (!assetReady) return h(SvgPetFallback, p)

  const meta = stageMetaWithSkin(p.stage, p.skin)
  const size = p.size ?? 120
  const height = Math.round(size * 1.46)
  const sat = Math.min(1, Math.max(0, p.satiation))
  const progress = Math.min(1, Math.max(0, p.progress))
  const motes = Math.min(4, Math.round((p.toolShare ?? 0) * 3) + ((p.toolCalls ?? 0) > 0 ? 1 : 0))
  const actionSheet = PET_ACTION_SHEET_SPECS[action] ?? null
  // The strip cell is frameH tall with the character's feet on the feetY line
  // and a bodyHeight-tall body. Scale the cell so the body fills the container
  // height, then anchor the feet line exactly on the container bottom so the
  // stage chip below can never cover the feet.
  const actionPlayerH = actionSheet ? Math.round(height * actionSheet.frameH / actionSheet.bodyHeight) : 0
  const actionPlayerW = actionSheet ? Math.max(1, Math.round(actionPlayerH * actionSheet.frameW / actionSheet.frameH)) : 0
  const actionPlayerTop = actionSheet ? Math.round(height - actionPlayerH * actionSheet.feetY / actionSheet.frameH) : 0
  const warning = p.stage === 'overload' || p.stage === 'critical'
  const warningTint = p.stage === 'critical' ? 'rgba(176,72,77,.68)' : 'rgba(193,105,108,.62)'
  const imageFilter = p.stage === 'critical'
    ? 'saturate(.88) brightness(.96) contrast(1.01) drop-shadow(0 0 7px rgba(176,72,77,.24))'
    : p.stage === 'overload'
      ? 'saturate(.84) brightness(.98) drop-shadow(0 0 6px rgba(193,105,108,.2))'
      : p.stage === 'heavy'
        ? 'saturate(.9) drop-shadow(0 7px 9px rgba(0,0,0,.2))'
        : 'drop-shadow(0 7px 9px rgba(0,0,0,.2))'

  return h('div', {
    role: 'img',
    'aria-label': `Token Pet，${statusLabel}`,
    style: css({
      position: 'relative', width: size, height, overflow: 'visible', pointerEvents: 'none',
      animation: 'none',
      transformOrigin: '50% 88%',
    }),
  }, [
    h('span', { key: 'aura', style: css({
      position: 'absolute', left: '8%', right: '8%', bottom: '5%', height: '63%', borderRadius: '50%',
      border: `2px solid ${warning ? warningTint : meta.ring}`, opacity: warning ? .1 + progress * .18 : .2 + progress * .35,
      transform: `scale(${.92 + progress * .08})`, boxShadow: warning ? `0 0 ${7 + progress * 9}px ${warningTint}` : meta.glow ? `0 0 ${12 + progress * 16}px ${meta.ring}` : 'none',
      transition: 'none',
    }) }),
    h('img', {
      key: 'character', src: FORMAL_PET_ASSET, alt: '', draggable: false,
      onError: () => setAssetReady(false),
      style: css({ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', filter: imageFilter, userSelect: 'none', display: !actionSheet || stripError === action ? 'block' : 'none' }),
    }),
    actionSheet && stripError !== action
      ? h('div', { key: 'action-player', style: css({ position: 'absolute', inset: 0 }) },
        h('div', { style: css({ position: 'absolute', top: actionPlayerTop, left: '50%', transform: 'translateX(-50%)' }) },
          h(PetActionPlayer, {
            spec: actionSheet,
            width: actionPlayerW,
            height: actionPlayerH,
            speed: p.animationSpeed ?? 1,
            disabled: p.motionDisabled === true || (p.animationSpeed ?? 1) <= 0,
            onComplete: p.onActionComplete,
            onError: () => setStripError(action),
          }),
          // Stage tint is a STATIC overlay (changes only when the stage changes);
          // the canvas below repaints every frame without any per-frame filter.
          ...(warning ? [h('div', { key: 'tint', style: css({
            position: 'absolute', inset: 0, pointerEvents: 'none', mixBlendMode: 'multiply',
            background: warningTint, opacity: .16,
          }) })] : [])))
      : null,
    actionSheet ? null : formalActionDecoration(action, meta.ring),
    h('span', { key: 'status', title: `当前状态：${statusLabel}`, style: css({
      position: 'absolute', top: '7%', right: '-4%', minWidth: 32, maxWidth: 92, padding: '3px 7px', borderRadius: 999,
      border: '1px solid rgba(255,255,255,.86)', color: '#fff', background: statusColor,
      boxShadow: `0 3px 10px ${statusColor}55`, fontSize: 10, lineHeight: 1.2, fontWeight: 800, textAlign: 'center',
      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    }) }, statusLabel),
    ...Array.from({ length: motes }, (_, index) => h('span', { key: `mote-${index}`, style: css({
      position: 'absolute', top: `${24 + index * 10}%`, left: index % 2 === 0 ? '-2%' : '94%', width: 6, height: 6,
      borderRadius: '50%', background: meta.accent, boxShadow: `0 0 8px ${meta.accent}`, opacity: .8,
    }) })),
    h('span', { key: 'meter', style: css({
      position: 'absolute', left: '18%', right: '18%', bottom: '-2px', height: 5, overflow: 'hidden',
      borderRadius: 999, background: 'rgba(128,128,160,.24)', boxShadow: '0 1px 4px rgba(0,0,0,.18)',
    }) }, h('span', { style: css({ display: 'block', width: `${Math.max(5, sat * 100)}%`, height: '100%', borderRadius: 999, background: meta.ring, transition: 'none' }) })),
  ])
})
