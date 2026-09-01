/** Explicit, user-triggered prompt enhancement; never sends a prompt automatically. */
export type EnhancementAction = 'replace' | 'append' | 'copy' | 'regenerate' | 'cancel'
export interface EnhancementRequest { prompt: string; template?: string; provider?: string; model?: string }
export interface EnhancementResult { original: string; enhanced: string; model?: string }
export interface PromptEnhancerAdapter { enhance(req: EnhancementRequest): Promise<EnhancementResult> }

/** Host adapter. A missing route is reported as an actionable error, not hidden. */
export const httpPromptEnhancer: PromptEnhancerAdapter = {
  async enhance(req) {
    const response = await fetch('/token-pet/prompt/enhance', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req) })
    const data = await response.json().catch(() => ({})) as Partial<EnhancementResult> & { error?: unknown }
    if (!response.ok) {
      const detail = typeof data.error === 'string' && data.error.trim() ? `：${data.error}` : ''
      throw new Error(`提示词增强不可用（HTTP ${response.status}）${detail}`)
    }
    if (typeof data.enhanced !== 'string') throw new Error('提示词增强响应缺少 enhanced 字段。')
    return { original: req.prompt, enhanced: data.enhanced, model: data.model }
  },
}

export interface ComposerInputActions {
  setDraft(text: string): void
  submit(): void
}

/** Uses DSH's real composer state machine: update its draft, then invoke its queue submit. */
export function createComposerPromptBridge(actions: ComposerInputActions) {
  const apply = (text: string) => { actions.setDraft(text) }
  const send = (text: string) => {
    actions.setDraft(text)
    // Let the input machine publish the new draft before admission snapshots
    // the pending images. Some DSH builds batch the draft transition; calling
    // submit in the same stack can otherwise submit text while losing the
    // attachment rail.
    return new Promise<void>((resolve) => {
      queueMicrotask(() => {
        actions.submit()
        resolve()
      })
    })
  }
  return { apply, send }
}

export interface PromptEnhancerState { original: string; preview: string | null; busy: boolean; error: string | null }
export function createPromptEnhancer(adapter: PromptEnhancerAdapter = httpPromptEnhancer) {
  let state: PromptEnhancerState = { original: '', preview: null, busy: false, error: null }
  const enhance = async (original: string, opts?: Omit<EnhancementRequest, 'prompt'>) => {
    state = { original, preview: null, busy: true, error: null }
    try { const result = await adapter.enhance({ prompt: original, ...opts }); state = { original, preview: result.enhanced, busy: false, error: null }; return result }
    catch (e) { state = { original, preview: null, busy: false, error: e instanceof Error ? e.message : String(e) }; throw e }
  }
  const act = (action: EnhancementAction): string | null => {
    if (action === 'cancel') { state = { ...state, preview: null, error: null }; return null }
    if (action === 'replace') return state.preview
    if (action === 'append') return state.preview === null ? null : `${state.original}\n\n${state.preview}`
    if (action === 'copy') return state.preview
    if (action === 'regenerate') return state.original
    return null
  }
  return { getState: () => state, enhance, act }
}
