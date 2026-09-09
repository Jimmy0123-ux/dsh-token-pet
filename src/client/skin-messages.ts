import { defineMessages, translate, type Language, type MessageParams } from './i18n.ts'

export const skinMessages = defineMessages({
  section: { zh: '皮肤导入', en: 'Skin import' },
  importZip: { zh: '导入皮肤 ZIP', en: 'Import skin ZIP' },
  chooseFile: { zh: '选择 ZIP 文件…', en: 'Choose ZIP file…' },
  currentSkin: { zh: '当前皮肤', en: 'Current skin' },
  defaultSkin: { zh: '默认 SVG', en: 'Default SVG' },
  builtin: { zh: '{name}（内置）', en: '{name} (built-in)' },
  remove: { zh: '删除当前自定义皮肤', en: 'Delete current custom skin' },
  installing: { zh: '正在校验并安装…', en: 'Validating and installing…' },
  installed: { zh: '已安装：{name}（{files} 个文件，{bytes} 字节）', en: 'Installed: {name} ({files} files, {bytes} bytes)' },
  selectedDefault: { zh: '已切换到默认正式宠物。', en: 'Switched to the default pet.' },
  selectedBuiltin: { zh: '已切换到内置配色；缺失资源将回退到默认正式宠物或 SVG。', en: 'Switched to a built-in palette; missing assets fall back to the default pet or SVG.' },
  selectedCustom: { zh: '已切换皮肤；缺失资源将回退到默认正式宠物或 SVG。', en: 'Skin switched; missing assets fall back to the default pet or SVG.' },
  removed: { zh: '自定义皮肤已删除，已恢复默认正式宠物。', en: 'Custom skin deleted. The default pet has been restored.' },
  zipUnsupported: { zh: '皮肤 ZIP 导入需要宿主适配器；客户端不会加载外部 ZIP 解包模块。', en: 'Skin ZIP import requires a host adapter; the client does not load external ZIP extraction modules.' },
  installFailed: { zh: '皮肤安装失败：{detail}', en: 'Skin installation failed: {detail}' },
  listFailed: { zh: '无法读取已安装皮肤：{detail}', en: 'Unable to list installed skins: {detail}' },
  removeFailed: { zh: '皮肤删除失败：{detail}', en: 'Skin removal failed: {detail}' },
})

export type SkinMessageKey = keyof typeof skinMessages
export interface SkinFeedback {
  level: 'info' | 'error'
  key: SkinMessageKey
  params?: MessageParams
}
export function skinText(language: Language, key: SkinMessageKey, params?: MessageParams): string {
  return translate(language, skinMessages, key, params)
}

/** A stable key lets UI retranslate the error without matching Chinese text. */
export class SkinImportError extends Error {
  readonly key = 'zipUnsupported' as const
  readonly level = 'error' as const
  constructor(language: Language = 'zh') {
    super(skinText(language, 'zipUnsupported'))
    this.name = 'SkinImportError'
  }
}
