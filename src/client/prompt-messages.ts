import { defineMessages, translate, type Language, type MessageParams } from './i18n.ts'
export const promptMessages = defineMessages({
  title: { zh: '增强提示词', en: 'Enhance prompt' },
  sent: { zh: '已发送', en: 'Sent' }, editable: { zh: '结果可编辑', en: 'Editable result' }, manual: { zh: '手动触发 · 不自动发送', en: 'Manual only · Never sends automatically' },
  closeAria: { zh: '关闭增强提示词抽屉', en: 'Close prompt enhancement drawer' }, close: { zh: '关闭', en: 'Close' },
  placeholder: { zh: '输入提示词（不会自动发送）', en: 'Enter a prompt (not sent automatically)' }, original: { zh: '原始提示词', en: 'Original prompt' },
  privacy: { zh: '增强只在点击后调用当前 DSH 模型，会产生额外 Token；结果可编辑，发送前不会自动提交。', en: 'Enhancement calls the current DSH model only when clicked and uses extra tokens. Edit the result before sending; nothing is submitted automatically.' },
  enable: { zh: '开启增强', en: 'Enable enhancement' }, preview: { zh: '增强结果（可编辑）', en: 'Enhanced result (editable)' }, busy: { zh: '增强中…', en: 'Enhancing…' },
  applied: { zh: '已覆盖', en: 'Applied' }, replace: { zh: '覆盖原文', en: 'Replace original' }, append: { zh: '插入末尾', en: 'Append to original' }, copy: { zh: '复制增强版', en: 'Copy enhanced prompt' }, regenerate: { zh: '重新生成', en: 'Regenerate' },
  irrevocable: { zh: '已发送（不可撤回）', en: 'Sent (cannot undo)' }, revert: { zh: '撤回增强', en: 'Revert enhancement' }, sending: { zh: '发送中…', en: 'Sending…' }, send: { zh: '直接发送', en: 'Send now' },
  sentDetail: { zh: '已交给 DSH composer 发送；DSH 负责最终结算，不能撤回已发送消息。', en: 'Handed to the DSH composer for sending. DSH handles final usage accounting; sent messages cannot be recalled.' },
  http: { zh: '提示词增强不可用（HTTP {status}）{detail}', en: 'Prompt enhancement unavailable (HTTP {status}){detail}' },
  missing: { zh: '提示词增强响应缺少 enhanced 字段。', en: 'The enhancement response is missing the enhanced field.' },
  stale: { zh: '会话已切换，请在当前会话重新增强提示词。', en: 'The session changed. Enhance the prompt again in the current session.' },
  failed: { zh: '操作失败：{detail}', en: 'Operation failed: {detail}' },
  clipboard: { zh: '浏览器不支持剪贴板或未授予权限。', en: 'Clipboard access is unavailable or permission was denied.' },
  copied: { zh: '已复制增强版。', en: 'Enhanced prompt copied.' },
})
/** Store keys, not rendered strings, so pending/failed workflows can change language. */
export class PromptEnhancementError extends Error {
  constructor(public readonly key: keyof typeof promptMessages, public readonly params: MessageParams = {}) { super(translate('zh', promptMessages, key, params)); this.name = 'PromptEnhancementError' }
}
export function promptErrorMessage(error: unknown, language: Language): string {
  return error instanceof PromptEnhancementError ? translate(language, promptMessages, error.key, error.params) : translate(language, promptMessages, 'failed', { detail: error instanceof Error ? error.message : String(error) })
}
