import { createElement as h, useEffect, useRef, useState, type ReactNode } from 'react'
import { saveSettings, resolveEnhancementTemplate, type TokenPetSettings } from './settings.ts'
import { useSettings } from './settings-hook.ts'
import { translate, type Language } from './i18n.ts'
import { settingsMessages } from './settings-messages.ts'
import { prepareCompletionSound, previewCompletionSound, stopCompletionSound } from './completion-sound.ts'
import { SkinImportPanel } from './skin-panel.tsx'
import { PET_PREVIEW_EVENT, type PetAction } from './events.ts'
import { TrendIndexMaintenancePanel } from './trend-maintenance-panel.tsx'

const fieldStyle = { display: 'grid', gap: 5, minWidth: 0 }
const inputStyle = { margin: 0, width: '100%', minWidth: 0, maxWidth: '100%', boxSizing: 'border-box' as const, color: 'inherit', background: 'rgba(128,128,160,.08)', border: '1px solid rgba(128,128,160,.35)', borderRadius: 6, padding: 7, font: 'inherit' }
const buttonStyle = { padding: '6px 9px', borderRadius: 7, border: '1px solid rgba(128,128,160,.36)', background: 'rgba(128,128,160,.12)', color: 'inherit', cursor: 'pointer', maxWidth: '100%', whiteSpace: 'normal' as const, overflowWrap: 'anywhere' as const }
/** Both settings entry points subscribe to the same persisted preferences. */
export function TokenPetSettingsPanel(p: { language?: Language }) {
  const shared = useSettings()
  const s = p.language ? { ...shared, language: p.language } : shared
  const t = (key: keyof typeof settingsMessages, params = {}) => translate(s.language, settingsMessages, key, params)
  const [soundStatus, setSoundStatus] = useState<'soundReady' | 'soundPlayed' | 'soundBlocked' | null>(null)
  const soundRequest = useRef(0)
  const soundSetting = useRef(shared.completionSound)
  useEffect(() => () => { soundRequest.current++ }, [])
  useEffect(() => {
    if (soundSetting.current !== shared.completionSound) {
      soundSetting.current = shared.completionSound
      soundRequest.current++
      setSoundStatus(null)
    }
  }, [shared.completionSound])
  const checkSound = (preview: boolean) => {
    const request = ++soundRequest.current
    const report = (ok: boolean) => {
      if (request === soundRequest.current) setSoundStatus(ok ? preview ? 'soundPlayed' : 'soundReady' : 'soundBlocked')
    }
    void (preview ? previewCompletionSound() : prepareCompletionSound()).then(report).catch(() => report(false))
  }
  const toggleSound = (enabled: boolean) => {
    soundSetting.current = enabled
    soundRequest.current++
    setSoundStatus(null)
    if (!enabled) stopCompletionSound()
    saveSettings({ completionSound: enabled })
    if (enabled) checkSound(false)
  }
  const patch = (value: Partial<TokenPetSettings>) => { saveSettings(value) }
  const preview = (action: PetAction) => {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(PET_PREVIEW_EVENT, { detail: { action } }))
  }
  const previews = ['working', 'eating', 'digesting', 'tool-success', 'tool-failure', 'warning', 'evolve', 'click', 'prompt-enhancing', 'prompt-ready'] as const
  const card = (key: 'appearance' | 'notifications' | 'enhancement' | 'advanced', children: ReactNode[]) => h('fieldset', { key, style: { display: 'grid', gap: 12, minWidth: 0, margin: 0, padding: 12, border: '1px solid rgba(128,128,160,.28)', borderRadius: 12, background: 'rgba(128,128,160,.04)' } }, [h('legend', { key: 'legend', style: { padding: '0 5px', fontWeight: 700 } }, t(key)), ...children])
  const number = (key: 'size' | 'panelWidth' | 'panelHeight' | 'animationSpeed', label: 'size' | 'panelWidth' | 'panelHeight' | 'speed', min: number, max: number) => h('label', { key, style: fieldStyle }, [t(label), h('input', { key: 'input', style: inputStyle, type: key === 'animationSpeed' ? 'range' : 'number', min, max, step: key === 'animationSpeed' ? .1 : 1, value: s[key], onChange: (e: { target: { value: string } }) => patch({ [key]: Number(e.target.value) }) })])
  const checkbox = (key: 'lowPerformance' | 'enhancementEnabled', label: 'performance' | 'enabled') => h('label', { key, style: { display: 'flex', alignItems: 'start', gap: 7, minWidth: 0 } }, [h('input', { key: 'input', type: 'checkbox', checked: s[key], onChange: (e: { target: { checked: boolean } }) => patch({ [key]: e.target.checked }) }), t(label)])
  return h('section', { 'aria-label': t('title'), style: { display: 'grid', gap: 12, padding: 8, minWidth: 0, overflowWrap: 'anywhere' } }, [
    card('appearance', [number('size', 'size', 64, 320), number('panelWidth', 'panelWidth', 360, 1200), number('panelHeight', 'panelHeight', 420, 1400), number('animationSpeed', 'speed', 0, 3), checkbox('lowPerformance', 'performance'), h(SkinImportPanel, { key: 'skins', language: s.language })]),
    card('notifications', [
      h('label', { key: 'language', style: fieldStyle }, [t('language'), h('select', { key: 'select', style: inputStyle, value: s.language, onChange: (e: { target: { value: Language } }) => patch({ language: e.target.value }) }, [h('option', { key: 'zh', value: 'zh' }, '中文'), h('option', { key: 'en', value: 'en' }, 'English')])]),
      h('label', { key: 'sound', style: { display: 'flex', gap: 7 } }, [h('input', { key: 'input', type: 'checkbox', checked: s.completionSound, onChange: (e: { target: { checked: boolean } }) => toggleSound(e.target.checked) }), t('sound')]),
      h('button', { key: 'preview', type: 'button', style: buttonStyle, onClick: () => checkSound(true) }, t('previewSound')),
      h('small', { key: 'scope', style: { opacity: .8, lineHeight: 1.5 } }, t('soundScope')),
      h('small', { key: 'hint', style: { opacity: .8, lineHeight: 1.5 } }, t('soundHint')),
      soundStatus ? h('div', { key: 'status', role: 'status' }, t(soundStatus)) : null,
    ]),
    card('enhancement', [checkbox('enhancementEnabled', 'enabled'),
      h('label', { key: 'model', style: fieldStyle }, [t('model'), h('input', { key: 'input', type: 'text', style: inputStyle, value: s.enhancementModel, placeholder: t('modelPlaceholder'), onChange: (e: { target: { value: string } }) => patch({ enhancementModel: e.target.value }) })]),
      h('label', { key: 'template', style: fieldStyle }, [t('template'), h('textarea', { key: 'input', rows: 5, style: { ...inputStyle, resize: 'vertical' }, value: resolveEnhancementTemplate(s), onChange: (e: { target: { value: string } }) => patch({ enhancementTemplate: e.target.value }) })]),
    ]),
    card('advanced', [h(TrendIndexMaintenancePanel, { key: 'trend-maintenance', language: s.language }),
      h('div', { key: 'previews', style: fieldStyle }, [h('strong', { key: 'heading' }, t('previews')), h('div', { key: 'actions', style: { display: 'flex', flexWrap: 'wrap', gap: 6 } }, previews.map(action => h('button', { key: action, type: 'button', onClick: () => preview(action), disabled: s.lowPerformance || s.animationSpeed <= 0, title: s.lowPerformance || s.animationSpeed <= 0 ? t('previewDisabled') : t('previewAction', { action: t(action) }), style: buttonStyle }, t(action))))]),
    ]),
  ])
}
