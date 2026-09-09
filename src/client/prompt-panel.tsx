import { createElement as h, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPromptEnhancer, type EnhancementAction, type EnhancementResult, type PromptEnhancerAdapter } from './prompt.ts'
import { loadSettings, saveSettings, resolveEnhancementTemplate } from './settings.ts'
import { useSettings } from './settings-hook.ts'
import { translate, type Language } from './i18n.ts'
import { promptMessages, promptErrorMessage, PromptEnhancementError } from './prompt-messages.ts'

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
  language?: Language
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
  const [error, setError] = useState<unknown>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sending, setSending] = useState(false)
  const settings = useSettings()
  const language = p.language ?? settings.language
  const enhancementEnabled = settings.enhancementEnabled
  const t = (key: keyof typeof promptMessages) => translate(language, promptMessages, key)
  const originalBeforeEnhancement = useRef(initialText)
  // DSH publishes composer drafts asynchronously. While the user is typing,
  // never let a stale projection overwrite the controlled textarea or cursor.
  const editingOriginal = useRef(false)
  const previewRef = useRef<HTMLTextAreaElement | null>(null)
  const previousPreview = useRef<string | null>(null)
  const previewFocusPending = useRef(false)
  // The owner keys this panel by the committed feed generation. Ignore async
  // completions (including animation events) after that session UI unmounts.
  const lifetime = useRef<object | null>(null)
  useLayoutEffect(() => {
    lifetime.current = {}
    return () => { lifetime.current = null }
  }, [])

  // The initial composer draft is captured once on mount. Subsequent drafts are
  // published by this panel and must never replace text the user is editing.

  // After generation, place the caret in the enhanced result so the user can
  // continue editing without being sent back to the source textarea.
  useEffect(() => {
    if (preview === null) {
      previousPreview.current = null
      previewFocusPending.current = false
      return
    }
    if (previousPreview.current === null) previewFocusPending.current = true
    previousPreview.current = preview
    if (previewFocusPending.current && !busy && !sending) {
      previewRef.current?.focus()
      previewFocusPending.current = false
    }
  }, [preview, busy, sending])

  // Keep controller construction out of every render. This panel is mounted
  // alongside the live projections and otherwise gets re-rendered frequently.
  const controller = useRef<ReturnType<typeof createPromptEnhancer> | null>(null)
  if (controller.current === null) controller.current = createPromptEnhancer(p.adapter)
  const enhancer = controller.current
  const run = async () => {
    const token = lifetime.current
    const source = preview !== null ? preview : original
    if (!token || !source.trim() || busy || sending || sent) return
    if (preview === null) originalBeforeEnhancement.current = original
    p.onAction?.('prompt-enhancing')
    setBusy(true)
    setError(null)
    setSent(false)
    try {
      const settings = loadSettings()
      const result: EnhancementResult = await enhancer.enhance(source, {
        template: resolveEnhancementTemplate(settings),
        provider: p.provider,
        model: settings.enhancementModel || p.model,
      })
      if (lifetime.current !== token) return
      setPreview(result.enhanced)
      setEnhancedApplied(false)
      p.onAction?.('prompt-ready')
    } catch (e) {
      if (lifetime.current === token) setError(e)
    } finally {
      if (lifetime.current === token) setBusy(false)
    }
  }

  const applyToComposer = (text: string) => {
    try { p.onApply?.(text) }
    catch (e) { setError(e) }
  }

  const apply = (text: string | null, action: EnhancementAction) => {
    if (!lifetime.current || text === null || sent) return
    p.onAction?.(action)
    setOriginal(text)
    setEnhancedApplied(action === 'replace')
    setError(null)
    applyToComposer(text)
  }

  const revert = () => {
    if (!lifetime.current || sent || sending) return
    const text = originalBeforeEnhancement.current
    p.onAction?.('cancel')
    setOriginal(text)
    setEnhancedApplied(false)
    setError(null)
    applyToComposer(text)
  }

  const send = async () => {
    const token = lifetime.current
    if (!token || !preview?.trim() || sending || busy || sent || !p.onSend) return
    setSending(true)
    setError(null)
    try {
      p.onAction?.('send')
      // onSend is wired to DSH inputActions, not an HTTP endpoint.
      await p.onSend(preview)
      if (lifetime.current !== token) return
      setOriginal(preview)
      setEnhancedApplied(true)
      setSent(true)
    } catch (e) {
      if (lifetime.current === token) setError(e)
    } finally {
      if (lifetime.current === token) setSending(false)
    }
  }

  const editOriginal = (text: string) => {
    if (!lifetime.current) return
    // Keep keystrokes local. Calling the host composer on every character can
    // publish a parent snapshot and disturb the controlled textarea/caret.
    editingOriginal.current = true
    setOriginal(text)
    setEnhancedApplied(false)
  }
  const commitOriginal = () => {
    if (!lifetime.current || sent) return
    applyToComposer(original)
    editingOriginal.current = false
  }

  const copy = async () => {
    const token = lifetime.current
    if (!token || preview === null) return
    setError(null); setCopied(false)
    try {
      p.onAction?.('copy')
      if (p.onCopy) await p.onCopy(preview)
      else if (typeof navigator !== 'undefined' && navigator.clipboard) await navigator.clipboard.writeText(preview)
      else throw new PromptEnhancementError('clipboard')
      if (lifetime.current === token) setCopied(true)
    } catch (e) { if (lifetime.current === token) setError(e) }
  }
  const button = (primary = false) => ({ type: 'button' as const, style: primary ? primaryButton : secondaryButton })
  return h('section', { 'aria-label': t('title'), style: { ...promptCard, minWidth: 0, overflowWrap: 'anywhere', ...(p.drawer ? { marginTop: 0, minHeight: 0, border: 0, borderRadius: 0, boxShadow: 'none', background: 'transparent' } : {}) } }, [
    h('div', { key: 'header', style: promptHeader }, [
      h('div', { key: 'heading', style: { display: 'flex', flexDirection: 'column', minWidth: 0 } }, [
        h('span', { key: 'title', style: promptTitle }, t('title')),
        h('span', { key: 'hint', style: promptHint }, t(sent ? 'sent' : preview !== null ? 'editable' : 'manual')),
      ]),
      p.onClose ? h('button', { key: 'close', type: 'button', onClick: p.onClose, 'aria-label': t('closeAria'), style: { ...secondaryButton, padding: '4px 8px', flex: 'none' } }, t('close')) : null,
    ]),
    h('textarea', {
      key: 'input', value: original,
      onFocus: () => { editingOriginal.current = true }, onBlur: commitOriginal,
      onChange: (e: { target: { value: string } }) => editOriginal(e.target.value),
      placeholder: t('placeholder'), rows: 3,
      'aria-label': t('original'), style: editorStyle,
      disabled: sent || busy || sending,
    }),
    h('div', { key: 'privacy', style: { marginTop: 6, color: '#9aa0b5', fontSize: 10, lineHeight: 1.45 } }, [
      t('privacy'),
      !enhancementEnabled ? h('button', { key: 'enable', ...button(), onClick: () => { saveSettings({ enhancementEnabled: true }) }, style: { ...secondaryButton, marginLeft: 6 } }, t('enable')) : null,
    ]),
    preview !== null ? h('textarea', {
      key: 'preview', ref: previewRef, value: preview, onChange: (e: { target: { value: string } }) => { setPreview(e.target.value); setEnhancedApplied(false); setCopied(false) },
      'aria-label': t('preview'), rows: 5, disabled: sent || sending || busy,
      style: { ...editorStyle, marginTop: 8, borderColor: 'rgba(124,150,255,.48)', background: 'rgba(31,35,55,.72)' },
    }) : null,
    h('div', { key: 'buttons', style: { display: 'flex', gap: 5, marginTop: 5, flexWrap: 'wrap' } }, [
      h('button', { key: 'enhance', ...button(true), onClick: run, disabled: !enhancementEnabled || busy || sending || sent || !original.trim() }, t(busy ? 'busy' : 'title')),
      preview !== null ? h('button', { key: 'replace', ...button(), onClick: () => apply(preview, 'replace'), disabled: busy || sending || sent }, t(enhancedApplied ? 'applied' : 'replace')) : null,
      preview !== null ? h('button', { key: 'append', ...button(), onClick: () => apply(`${original}\n\n${preview}`, 'append'), disabled: busy || sending || sent }, t('append')) : null,
      preview !== null ? h('button', { key: 'copy', ...button(), onClick: () => void copy(), disabled: sending || busy }, t('copy')) : null,
      preview !== null ? h('button', { key: 'regenerate', ...button(), onClick: run, disabled: !enhancementEnabled || busy || sending || sent }, t('regenerate')) : null,
      preview !== null ? h('button', { key: 'revert', ...button(), onClick: revert, disabled: busy || sending || sent }, t(sent ? 'irrevocable' : 'revert')) : null,
      preview !== null ? h('button', { key: 'send', ...button(true), onClick: () => void send(), disabled: busy || sending || sent || !p.onSend || !preview.trim() }, t(sending ? 'sending' : 'send')) : null,
    ]),
    copied ? h('div', { key: 'copied', role: 'status' }, t('copied')) : null,
    sent ? h('div', { key: 'sent', role: 'status', style: { marginTop: 5, color: '#9fe3b1' } }, t('sentDetail')) : null,
    error !== null ? h('div', { key: 'error', role: 'alert', style: { color: '#ffb4a8', marginTop: 5 } }, promptErrorMessage(error, language)) : null,
  ])
}
