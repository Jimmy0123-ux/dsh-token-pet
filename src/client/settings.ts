/** Persistent token-pet preferences. Safe in SSR/headless environments. */
export interface TokenPetSettings {
  size: number
  position: { x: number; y: number }
  panelPosition: { x: number; y: number }
  panelWidth: number
  panelHeight: number
  animationSpeed: number
  lowPerformance: boolean
  language: 'zh' | 'en'
  enhancementEnabled: boolean
  enhancementTemplate: string
  enhancementModel: string
  skinId: string
}

export const DEFAULT_SETTINGS: TokenPetSettings = {
  size: 120, position: { x: 0, y: 0 }, panelPosition: { x: 0, y: 0 }, panelWidth: 500, panelHeight: 620, animationSpeed: 1,
  lowPerformance: false, language: 'zh', enhancementEnabled: true,
  enhancementTemplate: '请优化以下提示词，保留原意并提升清晰度：\n\n{{prompt}}', enhancementModel: '', skinId: 'default',
}
const KEY = 'dsh-token-pet.settings.v1'
export const SETTINGS_EVENT = 'dsh-token-pet-settings-changed'
function clamp(n: unknown, lo: number, hi: number, fallback: number) {
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback
}

export interface FloatingRect { left: number; top: number; right: number; bottom: number }
/** Keep a translated fixed element recoverable inside the current viewport. */
export function clampFloatingOffset(offset: { x: number; y: number }, base: FloatingRect, viewportWidth: number, viewportHeight: number, margin = 8) {
  const clampAxis = (value: number, min: number, max: number) => max < min ? (min + max) / 2 : Math.min(max, Math.max(min, value))
  return {
    x: clampAxis(offset.x, margin - base.left, viewportWidth - margin - base.right),
    y: clampAxis(offset.y, margin - base.top, viewportHeight - margin - base.bottom),
  }
}
export function normalizeSettings(raw: unknown): TokenPetSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<TokenPetSettings>
  return {
    ...DEFAULT_SETTINGS, ...r,
    size: clamp(r.size, 64, 320, DEFAULT_SETTINGS.size),
    animationSpeed: clamp(r.animationSpeed, 0, 3, DEFAULT_SETTINGS.animationSpeed),
    position: { x: clamp(r.position?.x, -2000, 2000, 0), y: clamp(r.position?.y, -2000, 2000, 0) },
     panelPosition: { x: clamp(r.panelPosition?.x, -2000, 2000, 0), y: clamp(r.panelPosition?.y, -2000, 2000, 0) },
     panelWidth: clamp(r.panelWidth, 360, 820, DEFAULT_SETTINGS.panelWidth),
     panelHeight: clamp(r.panelHeight, 420, 920, DEFAULT_SETTINGS.panelHeight),
    lowPerformance: typeof r.lowPerformance === 'boolean' ? r.lowPerformance : DEFAULT_SETTINGS.lowPerformance,
    enhancementEnabled: typeof r.enhancementEnabled === 'boolean' ? r.enhancementEnabled : DEFAULT_SETTINGS.enhancementEnabled,
    language: r.language === 'en' ? 'en' : 'zh',
    enhancementTemplate: typeof r.enhancementTemplate === 'string' ? r.enhancementTemplate : DEFAULT_SETTINGS.enhancementTemplate,
    enhancementModel: typeof r.enhancementModel === 'string' ? r.enhancementModel : '',
     skinId: typeof r.skinId === 'string' && /^[a-z0-9][a-z0-9._-]*$/i.test(r.skinId) ? r.skinId : 'default',
  }
}
export function loadSettings(): TokenPetSettings {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_SETTINGS, position: { ...DEFAULT_SETTINGS.position }, panelPosition: { ...DEFAULT_SETTINGS.panelPosition } }
  try { return normalizeSettings(JSON.parse(localStorage.getItem(KEY) ?? '{}')) } catch { return normalizeSettings({}) }
}
export function saveSettings(next: Partial<TokenPetSettings>): TokenPetSettings {
  const merged = normalizeSettings({ ...loadSettings(), ...next })
  if (typeof localStorage !== 'undefined') try { localStorage.setItem(KEY, JSON.stringify(merged)) } catch { /* private mode */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: merged }))
  return merged
}
export function resetSettings(): TokenPetSettings { return saveSettings(DEFAULT_SETTINGS) }
