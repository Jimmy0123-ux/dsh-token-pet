/**
 * Sprite-sheet animation player for skin animations.
 *
 * Renders a sprite sheet image with frame-by-frame CSS animation using
 * `steps()` timing. When the sprite image is not available (e.g. built-in
 * MVP skins with no external assets), falls back gracefully to the SVG
 * PetSprite renderer.
 *
 * The player is declarative: it reads a SkinAnimationSpec and produces
 * the correct CSS background-position animation. No runtime ZIP unpacking,
 * no external image libraries.
 * @module dsh-token-pet/sprite-player
 */
import { createElement as h, useEffect, useRef, useState, type CSSProperties } from 'react'
import { css } from './derive.ts'
import type { SkinAnimationSpec } from './skin.ts'

export interface SpriteSheetPlayerProps {
  /** The animation spec from the skin manifest. */
  spec: SkinAnimationSpec
  /** The image source URL (data: URL or object URL from IndexedDB). */
  imageSrc?: string
  /** Display width. */
  width: number
  /** Display height. */
  height: number
  /** Whether reduced-motion is active. */
  reducedMotion?: boolean
  /** Whether low-performance mode is active. */
  lowPerformance?: boolean
}

/**
 * Frame-by-frame sprite player using CSS `steps()` animation on
 * `background-position`. The sprite sheet must be horizontal (one row).
 */
export function SpriteSheetPlayer(p: SpriteSheetPlayerProps) {
  const [loaded, setLoaded] = useState(false)
  const imgRef = useRef<HTMLImageElement | null>(null)

  useEffect(() => {
    if (!p.imageSrc) return
    const img = new Image()
    img.onload = () => setLoaded(true)
    img.onerror = () => setLoaded(false)
    img.src = p.imageSrc
    imgRef.current = img
    return () => { img.onload = null; img.onerror = null }
  }, [p.imageSrc])

  if (!p.imageSrc || !loaded) return null

  const { spec, width, height, reducedMotion, lowPerformance } = p
  const disabled = reducedMotion || lowPerformance
  const frameWidth = width
  const totalWidth = frameWidth * spec.frames
  const durationMs = (spec.frames / spec.fps) * 1000

  const style: CSSProperties = {
    width,
    height,
    backgroundImage: `url(${p.imageSrc})`,
    backgroundSize: `${totalWidth}px ${height}px`,
    backgroundPosition: '0 0',
    backgroundRepeat: 'no-repeat',
    overflow: 'hidden',
    flexShrink: 0,
  }

  if (!disabled && spec.frames > 1) {
    style.animation = `dsh-sprite-step ${durationMs}ms steps(${spec.frames}) ${spec.loop ? 'infinite' : '1'}`
  }

  return h('div', {
    style: css(style),
    role: 'img',
    'aria-label': `skin animation: ${spec.file}`,
  })
}

/**
 * Keyframe CSS for sprite stepping. Injected once by the skin system.
 * This animates background-position from 0 to -(frames-1)*frameWidth.
 * The actual frame count is baked into the inline style via `steps()`.
 */
export const SPRITE_SHEET_CSS = `
@keyframes dsh-sprite-step {
  from { background-position-x: 0; }
  to { background-position-x: -100%; }
}
`

/** Inject the sprite-sheet CSS keyframes into the document head (once). */
export function injectSpriteSheetCss(): void {
  if (typeof document === 'undefined') return
  if (document.querySelector('style[data-dsh-sprite-sheet="1"]') !== null) return
  const tag = document.createElement('style')
  tag.dataset.dshSpriteSheet = '1'
  tag.textContent = SPRITE_SHEET_CSS
  document.head.appendChild(tag)
}
