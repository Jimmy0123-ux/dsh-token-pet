/**
 * Skin manifest validation/indexing with deterministic fallback for missing actions.
 *
 * MVP skin system: declarative manifests with built-in skins, sprite-sheet
 * animation specs, stage-aware asset resolution, and a four-level fallback chain:
 *
 *   1. Current-stage specific action  (e.g. stages/newborn/idle.webp)
 *   2. Common action                  (e.g. common/idle.webp)
 *   3. Current-stage idle             (e.g. stages/newborn/idle.webp)
 *   4. Common idle                    (e.g. common/idle.webp)
 *   5. Built-in SVG fallback          (the inline PetSprite)
 *
 * No new image assets are generated; the Green Sprout MVP is a purely
 * declarative manifest that maps to the existing SVG fallback with
 * color/style overrides so the skin pipeline is testable end-to-end.
 */

import type { PetAction } from './events.ts'
import type { PetStage } from './derive.ts'

// ---- Manifest types (backward-compatible with existing simple schema) ----

/** One animation declared in a skin manifest (GDD §10.3). */
export interface SkinAnimationSpec {
  /** Path to the sprite sheet relative to skin root (e.g. "common/idle.webp"). */
  file: string
  /** Number of frames in the sprite sheet. */
  frames: number
  /** Frames per second. */
  fps: number
  /** Whether the animation loops. */
  loop?: boolean
  /** Origin offset within each frame (pixels from top-left). */
  originX?: number
  originY?: number
  /** Display scale relative to canvas. */
  scale?: number
}

/**
 * Extended skin manifest. Backward-compatible: the existing simple schema
 * ({ id, name, version, assets, actions }) remains valid. New fields are optional.
 */
export interface SkinManifest {
  id: string
  name: string
  version?: string
  /** Simple key→path asset map (existing contract). */
  assets?: Record<string, string>
  /** Simple action→path map (existing contract). */
  actions?: Record<string, string>

  // ---- GDD v0.5 extensions (all optional for backward compatibility) ----
  /** GDD schema version; currently 1. */
  schemaVersion?: number
  /** Author name. */
  author?: string
  /** License identifier (e.g. "CC-BY-4.0"). */
  license?: string
  /** Multilingual display name. */
  nameLocalized?: Record<string, string>
  /** Multilingual description. */
  description?: Record<string, string>
  /** Sprite canvas dimensions in pixels. */
  canvas?: { width: number; height: number }
  /**
   * Per-action animation specs (GDD §10.3 `animations`).
   * Keys are PetAction names (e.g. "idle", "working") or stage-qualified
   * names (e.g. "newborn/idle", "active/eating").
   */
  animations?: Record<string, SkinAnimationSpec>
  /**
   * Optional color/style overrides for the SVG fallback renderer.
   * When present, the built-in PetSprite applies these before falling back
   * to its hardcoded stage palette, enabling "color-only" skins without any
   * external image assets.
   */
  styleOverrides?: Record<string, string>
}

export interface SkinIndex { skins: Map<string, SkinManifest>; fallback: SkinManifest }

export const FALLBACK_SKIN: SkinManifest = { id: 'default', name: 'Default token pet', version: '1', assets: {}, actions: {} }

// ---- Validation ----

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object') return undefined
  const out: Record<string, string> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === 'string') out[key] = item
  }
  return out
}

export function validateSkinManifest(value: unknown): SkinManifest | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (typeof v.id !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/i.test(v.id) || typeof v.name !== 'string') return null
  const assets = v.assets && typeof v.assets === 'object' ? Object.fromEntries(Object.entries(v.assets).filter(([, x]) => typeof x === 'string')) : {}
  const actions = v.actions && typeof v.actions === 'object' ? Object.fromEntries(Object.entries(v.actions).filter(([, x]) => typeof x === 'string')) : {}

  // Optional GDD extensions — parsed when present, ignored otherwise.
  const schemaVersion = typeof v.schemaVersion === 'number' ? v.schemaVersion : undefined
  const author = typeof v.author === 'string' ? v.author : undefined
  const license = typeof v.license === 'string' ? v.license : undefined
  const nameLocalized = stringRecord(v.nameLocalized)
  const description = stringRecord(v.description)
  const canvasRaw = v.canvas && typeof v.canvas === 'object' ? v.canvas as Record<string, unknown> : undefined
  const canvas = canvasRaw && typeof canvasRaw.width === 'number' && typeof canvasRaw.height === 'number'
    ? { width: canvasRaw.width, height: canvasRaw.height }
    : undefined
  const animationsRaw = v.animations && typeof v.animations === 'object' ? v.animations as Record<string, unknown> : undefined
  const animations = animationsRaw ? parseAnimations(animationsRaw) : undefined
  const styleOverridesRaw = stringRecord(v.styleOverrides)

  const result: SkinManifest = { id: v.id, name: v.name, version: typeof v.version === 'string' ? v.version : '1', assets, actions }
  if (schemaVersion !== undefined) result.schemaVersion = schemaVersion
  if (author !== undefined) result.author = author
  if (license !== undefined) result.license = license
  if (nameLocalized !== undefined) result.nameLocalized = nameLocalized
  if (description !== undefined) result.description = description
  if (canvas !== undefined) result.canvas = canvas
  if (animations !== undefined && Object.keys(animations).length > 0) result.animations = animations
  if (styleOverridesRaw !== undefined && Object.keys(styleOverridesRaw).length > 0) result.styleOverrides = styleOverridesRaw
  return result
}

function parseAnimations(raw: Record<string, unknown>): Record<string, SkinAnimationSpec> | undefined {
  const out: Record<string, SkinAnimationSpec> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!value || typeof value !== 'object') continue
    const v = value as Record<string, unknown>
    if (typeof v.file !== 'string' || typeof v.frames !== 'number' || typeof v.fps !== 'number') continue
    if (v.frames < 1 || v.fps < 1) continue
    const spec: SkinAnimationSpec = {
      file: v.file,
      frames: Math.min(256, Math.max(1, Math.floor(v.frames))),
      fps: Math.min(60, Math.max(1, Math.floor(v.fps))),
    }
    if (v.loop === true) spec.loop = true
    if (typeof v.originX === 'number') spec.originX = v.originX
    if (typeof v.originY === 'number') spec.originY = v.originY
    if (typeof v.scale === 'number' && v.scale > 0) spec.scale = v.scale
    out[key] = spec
  }
  return Object.keys(out).length > 0 ? out : undefined
}

export function indexSkins(values: readonly unknown[]): SkinIndex {
  const skins = new Map<string, SkinManifest>()
  for (const value of values) { const skin = validateSkinManifest(value); if (skin && !skins.has(skin.id)) skins.set(skin.id, skin) }
  return { skins, fallback: FALLBACK_SKIN }
}

// ---- Security ----

const SKIN_FILE_RE = /^(manifest\.json|(?:common|stages|preview)\/[a-z0-9._/-]+\.(?:png|webp|gif|json))$/i
/** Reject traversal, absolute paths and executable/web content in skin bundles. */
export function isSafeSkinEntryPath(entry: string): boolean {
  if (!entry || entry.includes('\\') || entry.startsWith('/') || /^[a-z]:/i.test(entry)) return false
  const normalized = entry.split('/').filter(Boolean)
  if (normalized.some((part) => part === '.' || part === '..')) return false
  return SKIN_FILE_RE.test(normalized.join('/'))
}

export function validateSkinBundleEntries(entries: string[], maxFiles = 256): { ok: boolean; invalid: string[] } {
  const invalid = entries.filter((entry) => !isSafeSkinEntryPath(entry))
  return { ok: entries.length <= maxFiles && invalid.length === 0, invalid }
}

// ---- Import ----

export interface ImportedSkinBundle {
  manifest: SkinManifest
  files: ReadonlyMap<string, Uint8Array>
  totalBytes: number
}

/** ZIP import is intentionally host-owned: DSH client modules cannot load npm ZIP libraries. */
export function importSkinZip(_input: ArrayBuffer | Uint8Array, _limits: { maxZipBytes?: number; maxFiles?: number; maxFileBytes?: number; maxTotalBytes?: number } = {}): ImportedSkinBundle {
  throw new Error('皮肤 ZIP 导入需要宿主适配器；客户端不会加载外部 ZIP 解包模块。')
}

// ---- Built-in skins (declarative, no external image assets) ----

/**
 * Green Sprout MVP — the GDD's example skin. This is a purely declarative
 * manifest: it declares animations with color overrides for the SVG fallback
 * renderer. No image files are needed; the sprite pipeline falls through to
 * PetSprite with the green palette applied.
 */
export const GREEN_SPROUT_SKIN: SkinManifest = {
  id: 'example.green-sprout',
  name: '绿色小芽',
  schemaVersion: 1,
  author: 'DSH Token Pet',
  version: '1.0.0',
  license: 'MIT',
  nameLocalized: { 'zh-CN': '绿色小芽', 'en-US': 'Green Sprout' },
  description: { 'zh-CN': '单一固定外观的绿色小芽；压力档位仅改变警示环', 'en-US': 'One fixed Green Sprout identity; pressure bands only tint the warning ring' },
  canvas: { width: 72, height: 80 },
  animations: {
    idle: { file: 'common/idle.webp', frames: 12, fps: 13, loop: true },
    working: { file: 'common/working.webp', frames: 6, fps: 10, loop: true },
    eating: { file: 'common/eating.webp', frames: 6, fps: 8, loop: true },
    warning: { file: 'common/warning.webp', frames: 4, fps: 10 },
    evolve: { file: 'common/evolve.webp', frames: 8, fps: 10 },
    click: { file: 'common/click.webp', frames: 4, fps: 12 },
  },
  styleOverrides: {
    'newborn.ring': '#8fbf9b',
    'growth.ring': '#8fbf9b',
    'active.ring': '#c5ae70',
    'heavy.ring': '#c79572',
    'overload.ring': '#d98282',
    'critical.ring': '#c96569',
  },
  // No external assets; animations fall through to SVG fallback with style overrides.
  assets: {},
  actions: {},
}

/** All built-in skins, indexed by id. */
export const BUILTIN_SKINS: readonly SkinManifest[] = [GREEN_SPROUT_SKIN]

/** Create a SkinIndex from built-in skins only (no IndexedDB dependency). */
export function builtinSkinIndex(): SkinIndex {
  return indexSkins(BUILTIN_SKINS)
}

// ---- Action/asset resolution with four-level fallback ----

/**
 * Resolve an action file path for a given skin, with stage-aware fallback.
 *
 * Fallback chain (GDD §10.4):
 *   1. `stages/<stage>/<action>` or `<stage>/<action>` (stage-specific)
 *   2. `common/<action>` (shared across stages)
 *   3. `stages/<stage>/idle` (stage idle)
 *   4. `common/idle` (shared idle)
 *   5. undefined (caller uses built-in SVG fallback)
 *
 * @param skin - The active skin manifest (or fallback).
 * @param action - The current PetAction name.
 * @param stage - The current PetStage (optional, for stage-aware skins).
 */
export function resolveSkinAction(skin: SkinManifest, action: string, stage?: PetStage): string | undefined {
  // 1. Stage-specific action (animations key or actions map).
  if (stage) {
    const stageKey = `${stage}/${action}`
    const stageAnim = skin.animations?.[stageKey]
    if (stageAnim) return stageAnim.file
    const stageAction = skin.actions?.[stageKey]
    if (stageAction) return stageAction
  }
  // 2. Common action.
  const commonAnim = skin.animations?.[action]
  if (commonAnim) return commonAnim.file
  const commonAction = skin.actions?.[action]
  if (commonAction) return commonAction
  // 3. Stage idle.
  if (stage) {
    const stageIdleKey = `${stage}/idle`
    const stageIdleAnim = skin.animations?.[stageIdleKey]
    if (stageIdleAnim) return stageIdleAnim.file
    const stageIdleAction = skin.actions?.[stageIdleKey]
    if (stageIdleAction) return stageIdleAction
  }
  // 4. Common idle.
  const commonIdleAnim = skin.animations?.idle
  if (commonIdleAnim) return commonIdleAnim.file
  return skin.actions?.idle
}

/**
 * Resolve an action file path using the full index (active skin + fallback skin).
 * Maintains backward compatibility with the existing SkinIndex API.
 */
export function resolveSkinActionFromIndex(index: SkinIndex, skinId: string, action: string, stage?: PetStage): string | undefined {
  const skin = index.skins.get(skinId)
  if (skin) {
    const resolved = resolveSkinAction(skin, action, stage)
    if (resolved) return resolved
  }
  return resolveSkinAction(index.fallback, action, stage)
}

/** Resolve an asset path (non-action resources like preview images). */
export function resolveSkinAsset(index: SkinIndex, skinId: string, asset: string): string | undefined {
  return index.skins.get(skinId)?.assets?.[asset] ?? index.fallback.assets?.[asset]
}

/**
 * Get the animation spec for a given action in a skin, with fallback.
 * Returns the SkinAnimationSpec if declared, or undefined (caller uses
 * CSS keyframe animation as fallback).
 */
export function resolveAnimationSpec(skin: SkinManifest, action: string, stage?: PetStage): SkinAnimationSpec | undefined {
  if (stage) {
    const stageKey = `${stage}/${action}`
    if (skin.animations?.[stageKey]) return skin.animations[stageKey]
  }
  if (skin.animations?.[action]) return skin.animations[action]
  if (stage) {
    const stageIdleKey = `${stage}/idle`
    if (skin.animations?.[stageIdleKey]) return skin.animations[stageIdleKey]
  }
  return skin.animations?.idle
}

/**
 * Get a style override value for a given stage+property key.
 * Returns the skin-specific override or undefined (caller uses default palette).
 */
export function resolveStyleOverride(skin: SkinManifest | undefined, key: string): string | undefined {
  return skin?.styleOverrides?.[key]
}
