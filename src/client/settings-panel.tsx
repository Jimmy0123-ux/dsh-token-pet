import { createElement as h, useState } from 'react'
import { loadSettings, saveSettings, type TokenPetSettings } from './settings.ts'
import { SkinImportPanel } from './skin-panel.tsx'
import { PET_PREVIEW_EVENT, type PetAction } from './events.ts'
import { TrendIndexMaintenancePanel } from './trend-maintenance-panel.tsx'

/** Compact settings surface; each change is persisted immediately, no host dependency. */
export function TokenPetSettingsPanel() {
  const [s, set] = useState<TokenPetSettings>(loadSettings)
  const patch = (p: Partial<TokenPetSettings>) => set(saveSettings(p))
  const preview = (action: PetAction) => {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(PET_PREVIEW_EVENT, { detail: { action } }))
  }
  const previews: Array<[PetAction, string]> = [
    ['working', '工作'], ['eating', '吃 Token'], ['digesting', '消化'], ['tool-success', '成功'],
    ['tool-failure', '失败'], ['warning', '警告'], ['evolve', '成长'], ['click', '开心'],
    ['prompt-enhancing', '提示生成中'], ['prompt-ready', '提示已生成'],
  ]
  return h('section', { 'aria-label': '小宠物设置', style: { display: 'grid', gap: 6, padding: 8 } }, [
    h('label', { key: 'size' }, ['尺寸 ', h('input', { key: 'input', type: 'number', min: 64, max: 320, value: s.size, onChange: (e: { target: { value: string } }) => patch({ size: Number(e.target.value) }) })]),
    h('label', { key: 'panel-width' }, ['面板宽度 ', h('input', { key: 'input', type: 'number', min: 360, max: 820, value: s.panelWidth, onChange: (e: { target: { value: string } }) => patch({ panelWidth: Number(e.target.value) }) })]),
    h('label', { key: 'panel-height' }, ['面板高度 ', h('input', { key: 'input', type: 'number', min: 420, max: 920, value: s.panelHeight, onChange: (e: { target: { value: string } }) => patch({ panelHeight: Number(e.target.value) }) })]),
    h('label', { key: 'speed' }, ['动画速度 ', h('input', { key: 'input', type: 'range', min: 0, max: 3, step: .1, value: s.animationSpeed, onChange: (e: { target: { value: string } }) => patch({ animationSpeed: Number(e.target.value) }) })]),
    h('label', { key: 'performance' }, [h('input', { key: 'input', type: 'checkbox', checked: s.lowPerformance, onChange: (e: { target: { checked: boolean } }) => patch({ lowPerformance: e.target.checked }) }), ' 低性能模式']),
    h('label', { key: 'language' }, ['语言 ', h('select', { key: 'select', value: s.language, onChange: (e: { target: { value: 'zh' | 'en' } }) => patch({ language: e.target.value }) }, [h('option', { key: 'zh', value: 'zh' }, '中文'), h('option', { key: 'en', value: 'en' }, 'English')])]),
    h('label', { key: 'enhancement' }, [h('input', { key: 'input', type: 'checkbox', checked: s.enhancementEnabled, onChange: (e: { target: { checked: boolean } }) => patch({ enhancementEnabled: e.target.checked }) }), ' 启用提示词增强']),
    h('label', { key: 'model' }, ['增强模型 ', h('input', { key: 'input', type: 'text', value: s.enhancementModel, placeholder: '跟随宿主默认模型', onChange: (e: { target: { value: string } }) => patch({ enhancementModel: e.target.value }) })]),
    h('label', { key: 'template' }, ['增强模板 ', h('textarea', { key: 'input', rows: 2, value: s.enhancementTemplate, onChange: (e: { target: { value: string } }) => patch({ enhancementTemplate: e.target.value }) })]),
    h(TrendIndexMaintenancePanel, { key: 'trend-maintenance' }),
    h('fieldset', { key: 'previews', style: { margin: '6px 0', padding: 8, border: '1px solid rgba(128,128,160,.28)', borderRadius: 8 } }, [
      h('legend', { key: 'legend', style: { padding: '0 4px', fontWeight: 700 } }, '宠物动作预览'),
      h('div', { key: 'actions', style: { display: 'flex', flexWrap: 'wrap', gap: 6 } }, previews.map(([action, label]) => h('button', {
        key: action, type: 'button', onClick: () => preview(action), disabled: s.lowPerformance || s.animationSpeed <= 0,
        title: s.lowPerformance || s.animationSpeed <= 0 ? '请先关闭低性能模式并将动画速度调高' : `预览${label}动作`,
        style: { padding: '5px 9px', borderRadius: 7, border: '1px solid rgba(128,128,160,.36)', background: 'rgba(128,128,160,.12)', cursor: 'pointer' },
      }, label))),
    ]),
    h(SkinImportPanel, { key: 'skins' }),
  ])
}
