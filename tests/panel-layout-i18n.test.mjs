import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement as h } from 'react'
import { renderToStaticMarkup as render } from 'react-dom/server'
import { ContextPanel, LifetimeClearConfirmation, LifetimeClearFeedback, formatPanelDate, panelPhaseSections, modelDisplayName, PANEL_TABS } from '../src/client/panel.tsx'
import { panelContentGrid, fitPanelSizeToViewport } from '../src/client/layout.ts'
import { panelMessages, panelText } from '../src/client/panel-messages.ts'
import { normalizeSettings } from '../src/client/settings.ts'

const totals = { uncachedInputTokens: 11, outputTokens: 7, cacheReadTokens: 3, cacheWriteTokens: 2 }
const ledger = { sessions: 2, total: 23, totals, byModel: [{ provider: 'UserProvider', model: 'UserModel-With-A-Very-Long-Identifier'.repeat(4), total: 23 }] }
const base = { percent: null, breakdown: null, usage: null, stats: null, trend: [], phase: 2 }
const htmlFor = (language, props = {}) => render(h(ContextPanel, { ...base, language, ...props }))
const visible = html => html.replace(/<[^>]*>/g, '').replaceAll('&amp;', '&').replaceAll('&#x27;', "'")
const contains = (html, language, key, params) => assert.ok(visible(html).includes(panelText(language, key, params)), `${language}: ${key}`)

for (const language of ['zh', 'en']) {
  test(`${language}: SSR index and manual-action state matrix`, () => {
    const states = { unknown: 'indexUnknown', ready: 'indexReady', building: 'indexBuilding', partial: 'indexPartial', syncing: 'indexSyncing', missing: 'indexMissing', cancelled: 'indexCancelled', error: 'indexError' }
    for (const [status, key] of Object.entries(states)) {
      let calls = 0
      const html = htmlFor(language, { indexProgress: { status, completed: 2, total: 8, pending: 6, indexed: 3 }, onBuildIndex: () => calls++, onCancelIndex: () => calls++, onRefresh: () => calls++, onClearLifetime: () => { calls++; return true } })
      contains(html, language, key, { completed: 2, total: 8, count: 6 })
      for (const action of status === 'missing' ? ['buildIndex'] : status === 'partial' ? ['sync'] : status === 'error' ? ['retry'] : ['building', 'syncing'].includes(status) ? ['cancel'] : []) contains(html, language, action)
      assert.equal(calls, 0, 'render is a pure snapshot, never synchronizes or clears')
      if (language === 'en') assert.doesNotMatch(html, /[\u3400-\u9fff]/)
    }
    contains(htmlFor(language), language, 'unknownModel')
  })

  test(`${language}: SSR trend and staged opening matrix`, () => {
    for (const [props, key] of [
      [{ phase: 0 }, 'opening'], [{ indexProgress: { status: 'missing' } }, 'trendNeedsIndex'],
      [{ trendStatus: 'idle' }, 'trendLoading'], [{ trendStatus: 'loading' }, 'trendLoading'],
      [{ trendStatus: 'error' }, 'trendError'], [{ trendStatus: 'ready' }, 'noTrend'],
    ]) contains(htmlFor(language, { indexProgress: { status: 'ready' }, ...props }), language, key)
    const html = htmlFor(language, { trendStatus: 'ready', indexProgress: { status: 'partial' }, refreshing: true, trend: [{ start: 1741000000000, total: 20, count: 3 }] })
    assert.match(html, /<svg/)
    contains(html, language, 'refreshingHourly')
    assert.ok(html.includes(panelText(language, 'requests', { tokens: '20', count: 3 })), 'localized accessible chart point')
    assert.ok(html.includes(formatPanelDate(1741000000000, language)))
  })

  test(`${language}: SSR ledger loading/error/ready/partial/cleared matrix`, () => {
    for (const status of ['idle', 'loading', 'error', 'ready']) {
      const html = htmlFor(language, { lifetimeStatus: status, lifetimeLedger: status === 'ready' ? ledger : null, cumulative: { ...ledger, total: 999999 } })
      contains(html, language, status === 'error' ? 'readError' : status === 'ready' ? 'ledger' : 'loading')
      assert.doesNotMatch(html, /999999/, 'internal cumulative cache is not a fallback ledger')
    }
    contains(htmlFor(language, { lifetimeLedger: { ...ledger, refreshFailed: 2 } }), language, 'refreshFailed', { count: 2 })
    const clearedAt = '2025-03-03T10:00:00Z'
    contains(htmlFor(language, { lifetimeLedger: { ...ledger, clearedAt } }), language, 'clearedAt', { date: formatPanelDate(clearedAt, language) })
    const html = htmlFor(language, { lifetimeStatus: 'ready', lifetimeLedger: ledger, breakdown: { systemTokens: 1, toolsTokens: 2, messageTokens: 3 }, usage: totals })
    assert.ok(html.includes(`aria-label="${panelText(language, 'composition')}"`))
    assert.ok(html.includes(`title="${panelText(language, 'system')} 1"`))
    assert.ok(visible(html).indexOf(panelText(language, 'session')) < visible(html).indexOf(panelText(language, 'ledger')), 'current session precedes lifetime history')
  })

  test(`${language}: actual model and settings tabs SSR`, () => {
    const html = htmlFor(language, { initialTab: 'models', lifetimeLedger: ledger })
    contains(html, language, 'allModels')
    contains(html, language, 'noBreakdown')
    assert.ok(visible(html).includes(modelDisplayName(ledger.byModel[0])), 'provider/model names remain complete and untranslated')
    contains(htmlFor(language, { initialTab: 'models' }), language, 'noModelUsage')
    for (const lifetimeStatus of ['idle', 'loading', 'error']) contains(htmlFor(language, { initialTab: 'models', lifetimeStatus }), language, lifetimeStatus === 'error' ? 'readError' : 'loading')
    const classified = htmlFor(language, { initialTab: 'models', lifetimeLedger: { ...ledger, byModelDay: [{ ...ledger.byModel[0], totals }] } })
    contains(classified, language, 'cacheWrite')
    for (const phase of [0, 1]) contains(htmlFor(language, { initialTab: 'settings', phase }), language, 'settingsLoading')
    const settings = htmlFor(language, { initialTab: 'settings', phase: 2 })
    assert.doesNotMatch(visible(settings), new RegExp(panelText(language, 'settingsLoading')))
    if (language === 'en') assert.doesNotMatch(settings.replace('>中文</option>', '>Chinese</option>'), /[\u3400-\u9fff]/)
  })

  test(`${language}: destructive confirmation and clear feedback SSR`, () => {
    for (const busy of [false, true]) {
      const html = render(h(LifetimeClearConfirmation, { language, busy, onConfirm: () => assert.fail('SSR must never clear') }))
      contains(html, language, 'clearWarning')
      contains(html, language, busy ? 'clearing' : 'confirmClear')
      assert.match(html, /role="alert"/)
      assert.equal((html.match(/disabled=""/g) ?? []).length, busy ? 2 : 0)
    }
    for (const [status, key] of [['success', 'clearSuccess'], ['error', 'clearFailed']]) {
      const html = render(h(LifetimeClearFeedback, { language, status }))
      contains(html, language, key)
      assert.match(html, /role="status"/)
    }
    for (const status of ['idle', 'clearing']) assert.equal(render(h(LifetimeClearFeedback, { language, status })), '')
  })
}

test('dates use the selected Intl locale, accept second/millisecond timestamps and invalid dates', () => {
  const ms = 1741000000000
  for (const language of ['zh', 'en']) {
    assert.equal(formatPanelDate(ms, language), new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(ms)))
    assert.equal(formatPanelDate(ms / 1000, language), formatPanelDate(ms, language))
    assert.equal(formatPanelDate('invalid', language), panelText(language, 'unknownTime'))
  }
})

test('pure intrinsic grid styles and actual narrow SSR preserve layout contracts', () => {
  assert.deepEqual(panelContentGrid(), { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,260px),1fr))', gap: 10, minWidth: 0 })
  assert.equal(panelContentGrid(92).gridTemplateColumns, 'repeat(auto-fit,minmax(min(100%,92px),1fr))')
  assert.deepEqual(panelContentGrid(NaN), panelContentGrid())
  assert.equal(panelContentGrid(-4).gridTemplateColumns, 'repeat(auto-fit,minmax(min(100%,1px),1fr))')
  for (const viewportWidth of [360, 180]) {
    const fitted = fitPanelSizeToViewport(360, 620, viewportWidth, 700)
    assert.ok(fitted.width <= viewportWidth)
    assert.equal(fitted.contentHeight, fitted.height - 42, 'existing shell contract stays unchanged')
    const html = htmlFor('en', { width: fitted.width, height: fitted.contentHeight, lifetimeLedger: ledger })
    assert.equal((html.match(/overflow-y:auto/g) ?? []).length, 1, 'only content scrolls')
    assert.match(html, /minmax\(min\(100%,260px\),1fr\)/)
    assert.match(html, /overflow-wrap:anywhere/)
    assert.doesNotMatch(html, /text-overflow:ellipsis/, 'model identifiers are not clipped')
    assert.ok(html.includes(modelDisplayName(ledger.byModel[0])))
  }
  assert.deepEqual(PANEL_TABS.map(t => t.label), ['总览', '模型', '设置'])
  assert.deepEqual(panelPhaseSections(0), { trend: false, enhancements: false, settings: false })
  assert.deepEqual(panelPhaseSections(1), { trend: true, enhancements: false, settings: false })
  assert.deepEqual(panelPhaseSections(2), { trend: true, enhancements: true, settings: true })
})

test('typed dictionary contains both locales without unresolved interpolation in state fixtures', () => {
  for (const [key, value] of Object.entries(panelMessages)) {
    assert.equal(typeof value.zh, 'string', key)
    assert.equal(typeof value.en, 'string', key)
    assert.ok(value.zh.length && value.en.length)
  }
})

test('cost surfaces are hidden when the cost display switch is off', () => {
  const key = 'dsh-token-pet.settings.v1'
  const oldStorage = globalThis.localStorage
  const store = new Map([[key, JSON.stringify({ costEnabled: false })]])
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: () => {}, removeItem: () => {} }
  try {
    const ready = { lifetimeStatus: 'ready', lifetimeLedger: ledger, indexProgress: { status: 'ready' }, trendStatus: 'ready' }
    const overview = htmlFor('zh', ready)
    assert.ok(!overview.includes('data-testid="cost-estimate"'), 'overview cost card must be hidden')
    assert.ok(!visible(overview).includes(panelText('zh', 'cost')), 'cost heading hidden')
    const models = htmlFor('zh', { ...ready, initialTab: 'models' })
    assert.ok(!visible(models).includes(panelText('zh', 'modelCost')), 'per-model cost line hidden')
    // Default (costEnabled true) still renders the cost card.
    globalThis.localStorage.getItem = (k) => k === key ? null : null
    const on = htmlFor('zh', ready)
    assert.ok(on.includes('data-testid="cost-estimate"'), 'cost card visible by default')
  } finally {
    if (oldStorage === undefined) delete globalThis.localStorage
    else globalThis.localStorage = oldStorage
  }
})

test('theme switch renders light CSS variables on the panel root and normalizes settings', () => {
  const key = 'dsh-token-pet.settings.v1'
  const oldStorage = globalThis.localStorage
  const store = new Map([[key, JSON.stringify({ theme: 'light' })]])
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: () => {}, removeItem: () => {} }
  try {
    const html = htmlFor('zh', { lifetimeStatus: 'ready', lifetimeLedger: ledger })
    assert.ok(html.includes('--tp-panel-bg'), 'theme variables injected on the panel root')
    assert.ok(html.includes('#fbfcff'), 'light panel gradient present')
    assert.ok(html.includes('--tp-text'), 'text variable present')
    // Dark remains the default and corrupt values fall back to it.
    assert.equal(normalizeSettings({ theme: 'bogus' }).theme, 'dark')
    assert.equal(normalizeSettings({ theme: 'light' }).theme, 'light')
    assert.equal(normalizeSettings({ theme: 'dark' }).theme, 'dark')
  } finally {
    if (oldStorage === undefined) delete globalThis.localStorage
    else globalThis.localStorage = oldStorage
  }
})
