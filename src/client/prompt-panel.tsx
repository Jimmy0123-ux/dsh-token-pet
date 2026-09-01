import { createElement as h, useEffect, useRef, useState } from 'react'
import { createPromptEnhancer, type EnhancementAction, type EnhancementResult, type PromptEnhancerAdapter } from './prompt.ts'
import { loadSettings, saveSettings, SETTINGS_EVENT } from './settings.ts'

/** Visible opt-in enhancement UI. The composer owns actual apply/send semantics. */
type PromptPanelAction = EnhancementAction | 'prompt-enhancing' | 'prompt-ready' | 'send'
const promptCard = { marginTop: 12, padding: 12, border: '1px solid rgba(145,167,255,.28)', borderRadius: 12, background: 'linear-gradient(145deg, rgba(31,35,55,.97), rgba(22,24,36,.98))', boxShadow: '0 10px 26px rgba(0,0,0,.28)', color: '#e8eaf2' }
const promptHeader = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }
const promptTitle = { color: '#e8eaf2', fontSize: 12, fontWeight: 600, letterSpacing: '.01em' }
const promptHint = { color: '#9aa0b5', fontSize: 10 }
const editorStyle = { width: '100%', boxSizing: 'border-box' as const, resize: 'vertical' as const, display: 'block', padding: '8px 9px', borderRadius: 8, border: '1px solid rgba(145,167,255,.28)', background: 'rgba(12,15,27,.62)', color: '#eef1ff', caretColor: '#91a7ff', fontFamily: 'inherit', fontSize: 12, lineHeight: 1.5, outline: 'none' }
const secondaryButton = { color: '#d8ddf7', background: 'rgba(124,150,255,.1)', border: '1px solid rgba(145,167,255,.38)', borderRadius: 7, padding: '5px 9px', fontSize: 11, cursor: 'pointer', transition: 'background .15s ease, border-color .15s ease' }
const primaryButton = { ...secondaryButton, color: '#fff', background: 'linear-gradient(135deg, #627cff, #8069d9)', borderColor: 'rgba(180,190,255,.72)', fontWeight: 600 }
export function PromptEnhancerPanel(p: {
  initial?: string
  provider?: string
  model?: string
  adapter?: PromptEnhancerAdapter
  onApply?: (text: string) => void
  onCopy?: (text: string) => void
  onSend?: (text: string) => void | Promise<void>
  onAction?: (action: PromptPanelAction) => void
  /** Drawer chrome is owned by this component so its complete workflow stays mounted while hidden. */
  drawer?: boolean
  onClose?: () => void
}) {
  const initialText = p.initial ?? ''
  const [original, setOriginal] = useState(initialText)
  const [preview, setPreview] = useState<string | null>(null)
  const [enhancedApplied, setEnhancedApplied] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sending, setSending] = useState(false)
  const [enhancementEnabled, setEnhancementEnabled] = useState(() => loadSettings().enhancementEnabled)
  const originalBeforeEnhancement = useRef(initialText)

  useEffect(() => {
    const onSettings = (event: Event) => {
      const detail = (event as CustomEvent<{ enhancementEnabled?: boolean }>).detail
      if (typeof detail?.enhancementEnabled === 'boolean') setEnhancementEnabled(detail.enhancementEnabled)
    }
    window.addEventListener(SETTINGS_EVENT, onSettings)
    return () => window.removeEventListener(SETTINGS_EVENT, onSettings)
  }, [])

  // The composer is the source of truth until an enhancement preview exists.
  useEffect(() => {
    if (preview === null && !busy && !sending) {
      originalBeforeEnhancement.current = initialText
      setOriginal(initialText)
    }
  }, [initialText, preview, busy, sending])

  // Keep controller construction out of every render. This panel is mounted
  // alongside the live projections and otherwise gets re-rendered frequently.
  const controller = useRef<ReturnType<typeof createPromptEnhancer> | null>(null)
  if (controller.current === null) controller.current = createPromptEnhancer(p.adapter)
  const enhancer = controller.current
  const run = async () => {
    if (!original.trim() || busy || sending || sent) return
    if (preview === null) originalBeforeEnhancement.current = original
    p.onAction?.('prompt-enhancing')
    setBusy(true)
    setError(null)
    setSent(false)
    try {
      const settings = loadSettings()
      const result: EnhancementResult = await enhancer.enhance(original, {
        template: settings.enhancementTemplate,
        provider: p.provider,
        model: settings.enhancementModel || p.model,
      })
      setPreview(result.enhanced)
      setEnhancedApplied(false)
      p.onAction?.('prompt-ready')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const apply = (text: string | null, action: EnhancementAction) => {
    if (text === null || sent) return
    p.onAction?.(action)
    setOriginal(text)
    setEnhancedApplied(action === 'replace')
    setError(null)
    p.onApply?.(text)
  }

  const revert = () => {
    if (sent || sending) return
    const text = originalBeforeEnhancement.current
    p.onAction?.('cancel')
    setOriginal(text)
    setEnhancedApplied(false)
    setError(null)
    p.onApply?.(text)
  }

  const send = async () => {
    if (!preview?.trim() || sending || busy || sent || !p.onSend) return
    setSending(true)
    setError(null)
    try {
      p.onAction?.('send')
      // onSend is wired to DSH inputActions, not an HTTP endpoint.
      await p.onSend(preview)
      setOriginal(preview)
      setEnhancedApplied(true)
      setSent(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
    }
  }

  const editOriginal = (text: string) => {
    setOriginal(text)
    setEnhancedApplied(false)
    if (!sent) p.onApply?.(text)
  }

  const button = (primary = false) => ({ style: primary ? primaryButton : secondaryButton })
  return h('section', { 'aria-label': '增强提示词', style: { ...promptCard, ...(p.drawer ? { marginTop: 0, minHeight: 0, border: 0, borderRadius: 0, boxShadow: 'none', background: 'transparent' } : {}) } }, [
    h('div', { key: 'header', style: promptHeader }, [
      h('div', { key: 'heading', style: { display: 'flex', flexDirection: 'column', minWidth: 0 } }, [
        h('span', { key: 'title', style: promptTitle }, '增强提示词'),
        h('span', { key: 'hint', style: promptHint }, sent ? '已发送' : preview !== null ? '结果可编辑' : '手动触发 · 不自动发送'),
      ]),
      p.onClose ? h('button', { key: 'close', type: 'button', onClick: p.onClose, 'aria-label': '关闭增强提示词抽屉', style: { ...secondaryButton, padding: '4px 8px', flex: 'none' } }, '关闭') : null,
    ]),
    h('textarea', {
      key: 'input', value: original, onChange: (e: { target: { value: string } }) => editOriginal(e.target.value),
      placeholder: '输入提示词（不会自动发送）', rows: 3,
      'aria-label': '原始提示词', style: editorStyle,
      disabled: sent || busy || sending,
    }),
    h('div', { key: 'privacy', style: { marginTop: 6, color: '#9aa0b5', fontSize: 10, lineHeight: 1.45 } }, [
      '增强只在点击后调用当前 DSH 模型，会产生额外 Token；结果可编辑，发送前不会自动提交。',
      !enhancementEnabled ? h('button', { key: 'enable', ...button(), onClick: () => { saveSettings({ enhancementEnabled: true }); setEnhancementEnabled(true) }, style: { ...secondaryButton, marginLeft: 6 } }, '开启增强') : null,
    ]),
    preview !== null ? h('textarea', {
      key: 'preview', value: preview, onChange: (e: { target: { value: string } }) => { setPreview(e.target.value); setEnhancedApplied(false) },
      'aria-label': '增强结果（可编辑）', rows: 5, disabled: sent || sending,
      style: { ...editorStyle, marginTop: 8, borderColor: 'rgba(124,150,255,.48)', background: 'rgba(31,35,55,.72)' },
    }) : null,
    h('div', { key: 'buttons', style: { display: 'flex', gap: 5, marginTop: 5, flexWrap: 'wrap' } }, [
      h('button', { key: 'enhance', ...button(true), onClick: run, disabled: !enhancementEnabled || busy || sending || sent || !original.trim() }, busy ? '增强中…' : '增强提示词'),
      preview !== null ? h('button', { key: 'replace', ...button(), onClick: () => apply(preview, 'replace'), disabled: sending || sent }, enhancedApplied ? '已覆盖' : '覆盖原文') : null,
      preview !== null ? h('button', { key: 'append', ...button(), onClick: () => apply(`${original}\n\n${preview}`, 'append'), disabled: sending || sent }, '插入末尾') : null,
      preview !== null ? h('button', { key: 'copy', ...button(), onClick: () => { p.onAction?.('copy'); p.onCopy?.(preview); void navigator.clipboard?.writeText(preview) }, disabled: sending }, '复制增强版') : null,
      preview !== null ? h('button', { key: 'regenerate', ...button(), onClick: run, disabled: busy || sending || sent }, '重新生成') : null,
      preview !== null ? h('button', { key: 'revert', ...button(), onClick: revert, disabled: sending || sent }, sent ? '已发送（不可撤回）' : '撤回增强') : null,
      preview !== null ? h('button', { key: 'send', ...button(true), onClick: () => void send(), disabled: busy || sending || sent || !p.onSend || !preview.trim() }, sending ? '发送中…' : '直接发送') : null,
    ]),
    sent ? h('div', { key: 'sent', role: 'status', style: { marginTop: 5, color: '#9fe3b1' } }, '已交给 DSH composer 发送；DSH 负责最终结算，不能撤回已发送消息。') : null,
    error !== null ? h('div', { key: 'error', role: 'alert', style: { color: '#ffb4a8', marginTop: 5 } }, error) : null,
  ])
}
