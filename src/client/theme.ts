/**
 * Interface theme tokens. Every panel color is a CSS variable (--tp-*) resolved
 * on the outermost floating container / settings section, so switching between
 * dark and light is a single variable-set swap — components themselves never
 * re-render with new colors.
 *
 * The dark set preserves the original hardcoded palette exactly; the light set
 * keeps the same brand accents (blue-violet) with light surfaces.
 * @module dsh-token-pet/theme
 */

export type PetTheme = 'dark' | 'light'

export const DEFAULT_PET_THEME: PetTheme = 'dark'

export function isPetTheme(value: unknown): value is PetTheme {
  return value === 'dark' || value === 'light'
}

/** CSS custom properties injected on the panel/float/settings roots. */
export type ThemeVars = Record<string, string>

export const THEME_VARS: Record<PetTheme, ThemeVars> = {
  dark: {
    '--tp-panel-bg': 'linear-gradient(145deg,rgba(31,35,55,.98),rgba(20,22,34,.99))',
    '--tp-card-bg': 'rgba(12,15,27,.34)',
    '--tp-hero-bg': 'linear-gradient(145deg,rgba(119,87,190,.15),rgba(12,15,27,.42))',
    '--tp-solid': 'rgba(24,26,38,.96)',
    '--tp-solid-2': 'rgba(18,21,34,.98)',
    '--tp-border': 'rgba(128,128,160,.2)',
    '--tp-border-2': 'rgba(128,128,160,.28)',
    '--tp-border-strong': 'rgba(145,167,255,.28)',
    '--tp-text': '#e8eaf2',
    '--tp-text-2': '#9aa0b5',
    '--tp-text-3': '#8f96ad',
    '--tp-text-4': '#6f7895',
    '--tp-accent': '#91a7ff',
    '--tp-accent-2': '#c4a7ff',
    '--tp-accent-text': '#91a7ff',
    '--tp-accent-soft': 'rgba(124,150,255,.12)',
    '--tp-accent-soft-2': 'rgba(124,150,255,.16)',
    '--tp-on-accent': '#ffffff',
    '--tp-gold': '#ffd166',
    '--tp-success': '#9fd0a8',
    '--tp-danger': '#ffb4a8',
    '--tp-danger-2': '#ffd0c8',
    '--tp-danger-bg': 'rgba(180,42,42,.22)',
    '--tp-danger-border': 'rgba(255,100,80,.58)',
    '--tp-warn-border': 'rgba(210,128,64,.55)',
    '--tp-warn-bg': 'rgba(210,128,64,.12)',
    '--tp-input-bg': 'rgba(128,128,160,.08)',
    '--tp-track': 'rgba(128,128,160,.18)',
    '--tp-shadow': '0 10px 30px rgba(0,0,0,.35)',
    '--tp-shadow-2': '0 8px 22px rgba(0,0,0,.3)',
    '--tp-eyebrow': '#c4a7ff',
    '--tp-hover-row': 'rgba(128,128,160,.08)',
    '--tp-tab-bg': 'rgba(16,18,29,.7)',
  },
  light: {
    '--tp-panel-bg': 'linear-gradient(145deg,#fbfcff,#eef1fa)',
    '--tp-card-bg': 'rgba(255,255,255,.82)',
    '--tp-hero-bg': 'linear-gradient(145deg,rgba(150,120,220,.14),rgba(255,255,255,.86))',
    '--tp-solid': 'rgba(255,255,255,.97)',
    '--tp-solid-2': '#ffffff',
    '--tp-border': 'rgba(96,106,150,.22)',
    '--tp-border-2': 'rgba(96,106,150,.3)',
    '--tp-border-strong': 'rgba(106,91,216,.5)',
    '--tp-text': '#232842',
    '--tp-text-2': '#4d5573',
    '--tp-text-3': '#6b7390',
    '--tp-text-4': '#5f6788',
    '--tp-accent': '#6a5bd8',
    '--tp-accent-2': '#7a5fd8',
    '--tp-accent-text': '#5546c4',
    '--tp-accent-soft': 'rgba(106,91,216,.1)',
    '--tp-accent-soft-2': 'rgba(106,91,216,.22)',
    '--tp-on-accent': '#ffffff',
    '--tp-gold': '#966900',
    '--tp-success': '#2e8b57',
    '--tp-danger': '#c33f3f',
    '--tp-danger-2': '#a83232',
    '--tp-danger-bg': 'rgba(195,63,63,.1)',
    '--tp-danger-border': 'rgba(200,80,80,.6)',
    '--tp-warn-border': 'rgba(200,120,50,.65)',
    '--tp-warn-bg': 'rgba(210,128,64,.1)',
    '--tp-input-bg': 'rgba(255,255,255,.92)',
    '--tp-track': 'rgba(96,106,150,.18)',
    '--tp-shadow': '0 10px 30px rgba(60,70,120,.2)',
    '--tp-shadow-2': '0 8px 22px rgba(60,70,120,.18)',
    '--tp-eyebrow': '#6a5bd8',
    '--tp-hover-row': 'rgba(96,106,150,.08)',
    '--tp-tab-bg': 'rgba(238,241,250,.86)',
  },
}

/** The variables to inject on a themed root container. */
export function themeVars(theme: PetTheme): ThemeVars {
  return THEME_VARS[theme]
}
