import { createElement as h, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ContextPanel, type PanelTab } from '../src/client/panel.tsx'
import { SETTINGS_EVENT, saveSettings, loadSettings } from '../src/client/settings.ts'
import { apply } from '../src/client/index.ts'
import { createProjectionFeed } from '../src/client/store.ts'
import type { Language } from '../src/client/i18n.ts'

// Isolated synthetic fixture: no host/session data or audio is accessed.
window.fetch = async () => new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } })
localStorage.clear()
const totals = { uncachedInputTokens: 123400, outputTokens: 23500, cacheReadTokens: 54000, cacheWriteTokens: 2100 }
const byModel = Array.from({ length: 7 }, (_, i) => ({ provider: i === 0 ? 'Long-User-Provider-Name-1234567890' : `Provider ${i}`, model: i === 0 ? 'a-very-long-custom-model-identifier-with-important-version-and-context-window-information-2026' : `Model ${i}`, total: 180000 - i * 19000 }))
const ledger = { sessions: 32, total: 203000, totals, byModel, byModelDay: byModel.map(m => ({ ...m, day: '2026-03-03', totals })) }
const stats = { turns: 12, steps: 28, llmMs: 86000, toolMs: 2300, ttftMs: 1200, ttftSteps: 12, decodeMs: 60000, decodeTokens: 23500 }

function Fixture() {
  const [state, setState] = useState<{ width: number; tab: PanelTab; id: number }>({ width: 500, tab: 'overview', id: 0 })
  ;(window as any).showPanel = (width: number, language: Language, tab: PanelTab) => {
    window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: { language } }))
    setState(s => ({ width, tab, id: s.id + 1 }))
    // A second post-mount event verifies useLanguage rather than a language prop.
    setTimeout(() => window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: { language } })), 30)
  }
  ;(window as any).switchLanguage = (language: Language) => window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: { language } }))
  return h('div', { style: { width: state.width, margin: 20 }, 'data-fixture': true }, h(ContextPanel, {
    key: state.id, width: state.width, height: 620, initialTab: state.tab, percent: 68, usedTokens: 87040, contextWindow: 128000,
    breakdown: { systemTokens: 16000, toolsTokens: 21000, messageTokens: 50040 }, usage: totals, stats,
    provider: byModel[0].provider, model: byModel[0].model, toolCalls: 17,
    lifetimeLedger: ledger, lifetimeStatus: 'ready', trendStatus: 'ready', indexProgress: { status: 'partial', pending: 3 }, phase: 2,
    trend: Array.from({ length: 12 }, (_, i) => ({ start: 1772496000000 + i * 3600000, end: 1772499600000 + i * 3600000, total: 1000 + ((i * 73) % 9) * 2700, count: 2 + i })),
  }))
}
const root = createRoot(document.getElementById('root')!)
root.render(h(Fixture))

// A fake Web Audio implementation is installed before any prepare/preview call.
// It records scheduling only and has no connection to physical audio hardware.
const audioLog = { contexts: 0, resumes: 0, starts: [] as number[], stops: [] as (number | undefined)[] }
class FakeAudioContext {
  state = 'suspended'
  destination = {}
  get currentTime() { return performance.now() / 1000 }
  constructor() { audioLog.contexts++ }
  async resume() { this.state = 'running'; audioLog.resumes++ }
  async close() { this.state = 'closed' }
  createOscillator() {
    return { type: 'sine', frequency: { setValueAtTime() {} }, connect() {}, disconnect() {}, onended: null,
      start(time: number) { audioLog.starts.push(time) }, stop(time?: number) { audioLog.stops.push(time) } }
  }
  createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} } }
}
Object.defineProperty(window, 'AudioContext', { configurable: true, value: FakeAudioContext })
Object.defineProperty(window, 'webkitAudioContext', { configurable: true, value: FakeAudioContext })
const slots: Record<string, any> = {}
let feed: ReturnType<typeof createProjectionFeed> | undefined
let timeline = { turnOrder: [] as number[], turns: new Map<number, any>() }
const publish = (extra = {}) => feed?.publish({ sessionReady: true, turnTimeline: timeline, pressure: { usedTokens: 87040, contextWindow: 128000 }, usage: totals, stats, draft: 'Synthetic prompt to enhance', applyPrompt() {}, sendPrompt() {}, ...extra })
;(window as any).shellFixture = {
  audioLog,
  settings: loadSettings,
  patch: saveSettings,
  mount() {
    saveSettings({ language: 'en', completionSound: false, animationSpeed: 0, lowPerformance: true, panelWidth: 360, panelHeight: 620 })
    window.fetch = async (input) => {
      const url = String(input)
      const value = url.includes('lifetime') ? ledger : url.includes('/index/status') ? { status: 'ready', persisted: true, usable: true, indexed: 32 } : url.includes('/usage/trend') ? { buckets: [] } : {}
      return new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    apply({ slots: { inject(_slot, register) { register() }, register(meta, component) { slots[String(meta.name)] = component } } })
    root.render(h(slots['shell.overlay']))
    this.switchSession('synthetic-A')
    return Object.keys(slots)
  },
  switchSession(id: string, completed = false) {
    feed?.dispose(); feed = createProjectionFeed(id)
    timeline = { turnOrder: [], turns: new Map() }
    if (completed) { timeline.turnOrder = [99]; timeline.turns.set(99, { turn: 99, start: { seq: 190 }, end: { type: 'turn/end', seq: 191, data: { reason: { kind: 'completed' } } } }) }
    publish()
  },
  start(turn: number, seq: number) { timeline = { turnOrder: [...timeline.turnOrder, turn], turns: new Map(timeline.turns).set(turn, { turn, start: { seq } }) }; publish({ running: true }) },
  end(turn: number, seq: number, kind = 'completed') { timeline = { ...timeline, turns: new Map(timeline.turns).set(turn, { ...timeline.turns.get(turn), end: { type: 'turn/end', seq, data: { reason: { kind } } } }) }; publish({ running: false }) },
  repeat() { publish() },
  tool() { publish({ lastToolResult: { id: 'synthetic-tool', status: 'success' }, running: false }) },
  dispose() { feed?.dispose(); root.unmount() },
}

