import { createElement as h, useEffect, useRef, useState, type ReactNode } from 'react'
import { saveSettings, resolveEnhancementTemplate, type TokenPetSettings } from './settings.ts'
import { useSettings } from './settings-hook.ts'
import { translate, type Language } from './i18n.ts'
import { settingsMessages } from './settings-messages.ts'
import { prepareCompletionSound, previewCompletionSound, stopCompletionSound } from './completion-sound.ts'
import { SkinImportPanel } from './skin-panel.tsx'
import { PET_PREVIEW_EVENT, type PetAction } from './events.ts'
import { TrendIndexMaintenancePanel } from './trend-maintenance-panel.tsx'
import { DEFAULT_PRICE_TABLE_JSON, draftRowsToJson, isNonNegativeString, priceRowsFromJson, type PriceDraftRow } from './cost.ts'
import { themeVars, type PetTheme } from './theme.ts'
import { exportLedgerCsv, exportLedgerJson } from './export-data.ts'

const fieldStyle = { display: 'grid', gap: 5, minWidth: 0 }
const inputStyle = { margin: 0, width: '100%', minWidth: 0, maxWidth: '100%', boxSizing: 'border-box' as const, color: 'inherit', background: 'var(--tp-input-bg)', border: '1px solid var(--tp-border-2)', borderRadius: 6, padding: 7, font: 'inherit' }
const buttonStyle = { padding: '6px 9px', borderRadius: 7, border: '1px solid rgba(128,128,160,.36)', background: 'rgba(124,150,255,.1)', color: '#e8eaf2', cursor: 'pointer', maxWidth: '100%', whiteSpace: 'normal' as const, overflowWrap: 'anywhere' as const }
const removeButtonStyle = { flex: '0 0 auto', width: 26, height: 26, padding: 0, borderRadius: 7, border: '1px solid rgba(255,100,80,.5)', background: 'rgba(180,42,42,.2)', color: '#ffc4ba', cursor: 'pointer', fontSize: 12, lineHeight: 1 }

/** Visual, no-JSON price editor: model key + four rate inputs per row. */
function PriceTableEditor(p: { language: Language; value: string; onSave: (json: string) => void; onReset: () => void }) {
  const t = (key: keyof typeof settingsMessages, params = {}) => translate(p.language, settingsMessages, key, params)
  const [rows, setRows] = useState<PriceDraftRow[]>(() => priceRowsFromJson(p.value))
  const [status, setStatus] = useState<'idle' | 'saved' | 'invalid'>('idle')
  const [invalidCount, setInvalidCount] = useState(0)
  useEffect(() => { setRows(priceRowsFromJson(p.value)) }, [p.value])
  const update = (id: string, patch: Partial<PriceDraftRow>) => {
    setStatus('idle')
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row))
  }
  const add = () => {
    setStatus('idle')
    setRows((current) => [...current, { id: `${Date.now()}-${current.length}`, key: '', input: '', cacheRead: '', cacheWrite: '', output: '' }])
  }
  const remove = (id: string) => {
    setStatus('idle')
    setRows((current) => current.filter((row) => row.id !== id))
  }
  const save = () => {
    const { json, invalid } = draftRowsToJson(rows)
    if (json === null || invalid.length > 0) {
      setInvalidCount(rows.length - (json === null ? 0 : rows.length - invalid.length))
      setStatus('invalid')
      return
    }
    p.onSave(json)
    setStatus('saved')
  }
  const reset = () => {
    setRows(priceRowsFromJson(DEFAULT_PRICE_TABLE_JSON))
    p.onReset()
    setStatus('idle')
  }
  const numeric = (row: PriceDraftRow, key: 'input' | 'output' | 'cacheRead' | 'cacheWrite', label: string) => h('input', {
    key, type: 'number', min: 0, step: 'any', inputMode: 'decimal', 'aria-label': label, title: label, placeholder: '0',
    value: row[key], style: { ...inputStyle, flex: '1 1 56px', minWidth: 0, ...(row[key] === '' || isNonNegativeString(row[key]) ? {} : { borderColor: 'rgba(255,100,80,.75)' }) },
    onChange: (e: { target: { value: string } }) => update(row.id, { [key]: e.target.value }),
  })
  return h('div', { key: 'editor', style: { display: 'grid', gap: 6, minWidth: 0 } }, [
    ...rows.map((row) => h('div', { key: row.id, style: { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', minWidth: 0, padding: 6, borderRadius: 8, background: 'var(--tp-hover-row)' } }, [
      h('input', { key: 'key', type: 'text', placeholder: t('priceKeyPlaceholder'), 'aria-label': t('priceColModel'), title: t('priceColModel'), spellCheck: false, value: row.key, style: { ...inputStyle, flex: '1 1 100%', minWidth: 0, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11 }, onChange: (e: { target: { value: string } }) => update(row.id, { key: e.target.value }) }),
      numeric(row, 'input', t('priceColInput')),
      numeric(row, 'output', t('priceColOutput')),
      numeric(row, 'cacheRead', t('priceColCacheRead')),
      numeric(row, 'cacheWrite', t('priceColCacheWrite')),
      h('button', { key: 'remove', type: 'button', 'aria-label': t('removePriceRow'), title: t('removePriceRow'), onClick: () => remove(row.id), style: removeButtonStyle }, '✕'),
    ])),
    h('div', { key: 'actions', style: { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' } }, [
      h('button', { key: 'add', type: 'button', style: buttonStyle, onClick: add }, t('addPriceRow')),
      h('button', { key: 'save', type: 'button', style: { ...buttonStyle, borderColor: 'var(--tp-border-strong)', background: 'var(--tp-accent-soft-2)' }, onClick: save }, t('savePrices')),
      h('button', { key: 'reset', type: 'button', style: buttonStyle, onClick: reset }, t('resetPrices')),
    ]),
    status === 'saved' ? h('div', { key: 'status', role: 'status' }, t('pricesSaved'))
      : status === 'invalid' ? h('div', { key: 'status', role: 'alert', style: { color: 'var(--tp-danger)' } }, t('invalidPriceRows', { count: invalidCount })) : null,
  ])
}
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
  const [exportStatus, setExportStatus] = useState<'idle' | 'exported' | 'error'>(() => 'idle')
  const exportRequest = useRef(0)
  const runExport = async (kind: 'json' | 'csv') => {
    const request = ++exportRequest.current
    try {
      if (kind === 'json') await exportLedgerJson()
      else await exportLedgerCsv()
      if (request === exportRequest.current) setExportStatus('exported')
    } catch (error) {
      if (request === exportRequest.current) setExportStatus('error')
      console.error('[token-pet] export failed:', error)
    }
  }
  useEffect(() => () => { exportRequest.current++ }, [])
  const patch = (value: Partial<TokenPetSettings>) => { saveSettings(value) }
  const preview = (action: PetAction) => {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(PET_PREVIEW_EVENT, { detail: { action } }))
  }
  const previews = ['working', 'eating', 'digesting', 'tool-success', 'tool-failure', 'warning', 'evolve', 'click', 'prompt-enhancing', 'prompt-ready'] as const
  const card = (key: 'appearance' | 'notifications' | 'budget' | 'enhancement' | 'advanced', children: ReactNode[]) => h('fieldset', { key, style: { display: 'grid', gap: 12, minWidth: 0, margin: 0, padding: 12, border: '1px solid var(--tp-border-2)', borderRadius: 12, background: 'var(--tp-accent-soft)' } }, [h('legend', { key: 'legend', style: { padding: '0 5px', fontWeight: 700 } }, t(key)), ...children])
  const number = (key: 'size' | 'panelWidth' | 'panelHeight' | 'animationSpeed', label: 'size' | 'panelWidth' | 'panelHeight' | 'speed', min: number, max: number) => h('label', { key, style: fieldStyle }, [t(label), h('input', { key: 'input', style: inputStyle, type: key === 'animationSpeed' ? 'range' : 'number', min, max, step: key === 'animationSpeed' ? .1 : 1, value: s[key], onChange: (e: { target: { value: string } }) => patch({ [key]: Number(e.target.value) }) })])
  const checkbox = (key: 'lowPerformance' | 'enhancementEnabled', label: 'performance' | 'enabled') => h('label', { key, style: { display: 'flex', alignItems: 'start', gap: 7, minWidth: 0 } }, [h('input', { key: 'input', type: 'checkbox', checked: s[key], onChange: (e: { target: { checked: boolean } }) => patch({ [key]: e.target.checked }) }), t(label)])
  return h('section', { 'aria-label': t('title'), style: { display: 'grid', gap: 12, padding: 8, minWidth: 0, overflowWrap: 'anywhere', ...themeVars(s.theme) } }, [
    card('appearance', [number('size', 'size', 64, 320), number('panelWidth', 'panelWidth', 360, 1200), number('panelHeight', 'panelHeight', 420, 1400), number('animationSpeed', 'speed', 0, 3), checkbox('lowPerformance', 'performance'),
      h('label', { key: 'theme', style: fieldStyle }, [t('theme'), h('select', { key: 'select', style: inputStyle, value: s.theme, onChange: (e: { target: { value: PetTheme } }) => patch({ theme: e.target.value }) }, [h('option', { key: 'dark', value: 'dark' }, t('themeDark')), h('option', { key: 'light', value: 'light' }, t('themeLight'))])]),
      h(SkinImportPanel, { key: 'skins', language: s.language })]),
    card('notifications', [
      h('label', { key: 'language', style: fieldStyle }, [t('language'), h('select', { key: 'select', style: inputStyle, value: s.language, onChange: (e: { target: { value: Language } }) => patch({ language: e.target.value }) }, [h('option', { key: 'zh', value: 'zh' }, '中文'), h('option', { key: 'en', value: 'en' }, 'English')])]),
      h('label', { key: 'sound', style: { display: 'flex', gap: 7 } }, [h('input', { key: 'input', type: 'checkbox', checked: s.completionSound, onChange: (e: { target: { checked: boolean } }) => toggleSound(e.target.checked) }), t('sound')]),
      h('label', { key: 'soundTheme', style: fieldStyle }, [t('soundTheme'), h('select', { key: 'select', style: inputStyle, value: s.completionSoundTheme, onChange: (e: { target: { value: 'chime' | 'pop' | 'soft' } }) => patch({ completionSoundTheme: e.target.value }) }, [h('option', { key: 'chime', value: 'chime' }, t('themeChime')), h('option', { key: 'pop', value: 'pop' }, t('themePop')), h('option', { key: 'soft', value: 'soft' }, t('themeSoft'))])]),
      h('label', { key: 'volume', style: fieldStyle }, [t('volume'), h('input', { key: 'input', style: inputStyle, type: 'range', min: 0, max: 1, step: .05, value: s.completionSoundVolume, onChange: (e: { target: { value: string } }) => patch({ completionSoundVolume: Number(e.target.value) }) })]),
      h('button', { key: 'preview', type: 'button', style: buttonStyle, onClick: () => checkSound(true) }, t('previewSound')),
      h('small', { key: 'scope', style: { opacity: .8, lineHeight: 1.5 } }, t('soundScope')),
      h('small', { key: 'hint', style: { opacity: .8, lineHeight: 1.5 } }, t('soundHint')),
      soundStatus ? h('div', { key: 'status', role: 'status' }, t(soundStatus)) : null,
    ]),
    card('budget', [
      h('label', { key: 'costEnable', style: { display: 'flex', gap: 7 } }, [h('input', { key: 'input', type: 'checkbox', checked: s.costEnabled, onChange: (e: { target: { checked: boolean } }) => patch({ costEnabled: e.target.checked }) }), t('costEnable')]),
      h('small', { key: 'costEnableHint', style: { opacity: .8, lineHeight: 1.5 } }, t('costEnableHint')),
      h('label', { key: 'currency', style: fieldStyle }, [t('currency'), h('select', { key: 'select', style: inputStyle, value: s.currency, onChange: (e: { target: { value: 'USD' | 'CNY' } }) => patch({ currency: e.target.value }) }, [h('option', { key: 'usd', value: 'USD' }, 'USD ($)'), h('option', { key: 'cny', value: 'CNY' }, 'CNY (¥)')])]),
      h('label', { key: 'budgetEnable', style: { display: 'flex', gap: 7 } }, [h('input', { key: 'input', type: 'checkbox', checked: s.budgetEnabled && s.costEnabled, disabled: !s.costEnabled, onChange: (e: { target: { checked: boolean } }) => patch({ budgetEnabled: e.target.checked }) }), t('budgetEnable')]),
      h('label', { key: 'budgetMonthly', style: fieldStyle }, [t('budgetMonthly'), h('input', { key: 'input', style: inputStyle, type: 'number', min: 0, max: 100000, step: 1, value: s.budgetMonthly, onChange: (e: { target: { value: string } }) => patch({ budgetMonthly: Number(e.target.value) }) })]),
      h('small', { key: 'budgetHint', style: { opacity: .8, lineHeight: 1.5 } }, t('budgetHint')),
      h('label', { key: 'priceTable', style: fieldStyle }, [t('priceTable')]),
      h(PriceTableEditor, { key: 'editor', language: s.language, value: s.priceTable, onSave: (json) => patch({ priceTable: json }), onReset: () => patch({ priceTable: DEFAULT_PRICE_TABLE_JSON }) }),
      h('small', { key: 'priceHint', style: { opacity: .8, lineHeight: 1.5 } }, t('priceTableHint')),
    ]),
    card('enhancement', [checkbox('enhancementEnabled', 'enabled'),
      h('label', { key: 'model', style: fieldStyle }, [t('model'), h('input', { key: 'input', type: 'text', style: inputStyle, value: s.enhancementModel, placeholder: t('modelPlaceholder'), onChange: (e: { target: { value: string } }) => patch({ enhancementModel: e.target.value }) })]),
      h('label', { key: 'template', style: fieldStyle }, [t('template'), h('textarea', { key: 'input', rows: 5, style: { ...inputStyle, resize: 'vertical' }, value: resolveEnhancementTemplate(s), onChange: (e: { target: { value: string } }) => patch({ enhancementTemplate: e.target.value }) })]),
    ]),
    card('advanced', [h(TrendIndexMaintenancePanel, { key: 'trend-maintenance', language: s.language }),
      h('div', { key: 'export', style: fieldStyle }, [
        h('strong', { key: 'heading' }, t('exportData')),
        h('div', { key: 'actions', style: { display: 'flex', flexWrap: 'wrap', gap: 6 } }, [
          h('button', { key: 'json', type: 'button', onClick: () => void runExport('json'), style: buttonStyle }, t('exportJson')),
          h('button', { key: 'csv', type: 'button', onClick: () => void runExport('csv'), style: buttonStyle }, t('exportCsv')),
        ]),
        h('small', { key: 'note', style: { opacity: .8, lineHeight: 1.5 } }, t('exportNote')),
        exportStatus === 'exported' ? h('div', { key: 'status', role: 'status' }, t('exported')) : exportStatus === 'error' ? h('div', { key: 'status', role: 'alert' }, t('exportFailed', { detail: '' })) : null,
      ]),
      h('div', { key: 'previews', style: fieldStyle }, [h('strong', { key: 'heading' }, t('previews')), h('div', { key: 'actions', style: { display: 'flex', flexWrap: 'wrap', gap: 6 } }, previews.map(action => h('button', { key: action, type: 'button', onClick: () => preview(action), disabled: s.lowPerformance || s.animationSpeed <= 0, title: s.lowPerformance || s.animationSpeed <= 0 ? t('previewDisabled') : t('previewAction', { action: t(action) }), style: buttonStyle }, t(action))))]),
    ]),
  ])
}
