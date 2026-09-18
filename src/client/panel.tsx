import { createElement as h, useMemo, useState } from 'react'

import { css, formatMs, formatTokens, type CumulativeCell, type CumulativeModel, type CumulativeUsage, type SessionRanking, type SessionStats, type TokenUsage, type TrendBucket } from './derive.ts'
import type { PetAction } from './events.ts'
import { TokenPetSettingsPanel } from './settings-panel.tsx'
import { localeFor, type Language } from './i18n.ts'
import { useLanguage, useSettings } from './settings-hook.ts'
import { panelContentGrid } from './layout.ts'
import { panelText } from './panel-messages.ts'
import { costOfTotals, dayTotalsOfCells, formatCost, monthlyCostOfCells, parsePriceTable, resolvePrice, DEFAULT_PRICES, costPerModel } from './cost.ts'
import { themeVars } from './theme.ts'
import type { TokenPetIndexState } from '../index-contract.ts'

/** Contract for staged opening: keep the first paint lightweight. */
export function panelPhaseSections(phase: 0 | 1 | 2 = 2) {
  return { trend: phase !== 0, enhancements: phase === 2, settings: phase === 2 }
}

/** Keep same-named models from different providers visually distinguishable. */
export function modelDisplayName(model: Pick<CumulativeModel, 'provider' | 'model'>): string {
  if (!model.model) return model.provider
  return model.provider && model.provider !== model.model ? `${model.provider} · ${model.model}` : model.model
}

export type PanelTab = 'overview' | 'models' | 'settings'
export const PANEL_TABS: ReadonlyArray<{ id: PanelTab; label: string }> = [
  { id: 'overview', label: '总览' },
  { id: 'models', label: '模型' },
  { id: 'settings', label: '设置' },
]

export type PanelRequestStatus = 'idle' | 'loading' | 'ready' | 'error'
export interface IndexProgress { status: 'unknown' | TokenPetIndexState; completed?: number; total?: number; indexed?: number; skipped?: number; failed?: number; pending?: number }

export interface PanelProps {
  language?: Language
  initialTab?: PanelTab
  percent: number | null
  contextWindow?: number
  usedTokens?: number
  breakdown: import('./derive.ts').Breakdown | null
  usage: TokenUsage | null
  stats: SessionStats | null
  model?: string
  provider?: string
  trend: TrendBucket[]
  toolCalls?: number
  /** Kept as an internal aggregate source for model/day detail; it is never rendered as a second ledger. */
  cumulative?: CumulativeUsage | null
  lifetimeLedger?: (CumulativeUsage & { clearedAt?: string; refreshFailed?: number; refreshListed?: number }) | null
  lifetimeStatus?: PanelRequestStatus
  onClearLifetime?: () => boolean | Promise<boolean>
  width?: number
  height?: number
  maxHeight?: number
  filterModel?: string | null
  filterDay?: string | null
  onFilterModel?: (v: string | null) => void
  onFilterDay?: (v: string | null) => void
  onReset?: () => void
  onRestore?: () => void
  onRefresh?: () => void
  refreshing?: boolean
  cumulativeStatus?: PanelRequestStatus
  trendStatus?: PanelRequestStatus
  indexProgress?: IndexProgress
  onBuildIndex?: () => void
  onCancelIndex?: () => void
  busy?: boolean
  onPetAction?: (action: PetAction) => void
  prompt?: string
  onApplyPrompt?: (text: string) => void
  onSendPrompt?: (text: string) => void | Promise<void>
  phase?: 0 | 1 | 2
  /** Per-session totals from the durable usage index (never a scan). */
  sessionRanking?: SessionRanking | null
  sessionRankingStatus?: PanelRequestStatus
}

/** Backward-compatible name for consumers of the panel component. */
export type TrendPoint = TrendBucket
export function formatPanelDate(time: number | string, language: Language, hourOnly = false): string {
  const date = new Date(typeof time === 'number' && time < 1e12 ? time * 1000 : time)
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(localeFor(language), hourOnly
    ? { hour: '2-digit', minute: '2-digit' }
    : { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date) : panelText(language, 'unknownTime')
}

function Sparkline({ data, language }: { data: TrendBucket[]; language: Language }) {
  const t = panelText.bind(null, language)
  const [hovered, setHovered] = useState<number | null>(null)
  const width = 420
  const height = 76
  if (data.length === 0) return h('div', { style: css(emptyState) }, t('noTrend'))
  const max = Math.max(1, ...data.map((point) => point.total))
  const step = data.length > 1 ? width / (data.length - 1) : width / 2
  const points = data.map((point, index) => ({ ...point, x: data.length > 1 ? index * step : width / 2, y: height - 8 - (point.total / max) * (height - 18) }))
  const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ')
  const selected = hovered === null ? null : points[hovered]
  return h('div', { style: css(chartWrap) }, [
    selected ? h('div', { key: 'tip', role: 'status', style: css(tooltip) }, [
      h('strong', { key: 'time' }, formatPanelDate(selected.start, language)),
      h('span', { key: 'tokens' }, t('requests', { tokens: formatTokens(selected.total), count: selected.count })),
    ]) : null,
    h('svg', { key: 'chart', viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'none', style: css(chartSvg), onMouseLeave: () => setHovered(null) }, [
      h('path', { key: 'area', d: `${line} L ${points.at(-1)?.x ?? width} ${height} L ${points[0]?.x ?? 0} ${height} Z`, fill: 'var(--tp-accent-soft-2)' }),
      h('path', { key: 'line', d: line, fill: 'none', stroke: 'var(--tp-accent)', strokeWidth: 2, vectorEffect: 'non-scaling-stroke' }),
      ...points.map((point, index) => h('circle', {
        key: `${point.start}-${index}`, cx: point.x, cy: point.y, r: hovered === index ? 4 : 2.5,
        fill: 'var(--tp-solid-2)', stroke: 'var(--tp-accent)', strokeWidth: 1.5, vectorEffect: 'non-scaling-stroke', tabIndex: 0,
        'aria-label': `${formatPanelDate(point.start, language)}, ${t('requests', { tokens: formatTokens(point.total), count: point.count })}`,
        onPointerEnter: () => setHovered(index), onFocus: () => setHovered(index), onBlur: () => setHovered(null),
      })),
    ]),
    h('div', { key: 'axis', style: css(chartAxis) }, [
      h('span', { key: 'first' }, formatPanelDate(points[0]?.start ?? 0, language, true)),
      h('span', { key: 'last' }, formatPanelDate(points.at(-1)?.start ?? 0, language, true)),
    ]),
  ])
}

/** Daily totals from ledger cells for the last N days, ascending, as TrendBuckets. */
function dayTrendBuckets(cells: CumulativeCell[] | undefined, days: number, now = Date.now()): TrendBucket[] {
  const cutoff = now - days * 24 * 60 * 60 * 1000
  return dayTotalsOfCells(cells ?? [])
    .filter((row) => {
      const start = Date.parse(`${row.day}T00:00:00`)
      return Number.isFinite(start) && start >= cutoff - 24 * 60 * 60 * 1000
    })
    .sort((a, b) => (a.day < b.day ? -1 : 1))
    .map((row) => {
      const start = Date.parse(`${row.day}T00:00:00`)
      return { start, end: start + 24 * 60 * 60 * 1000, total: row.total, count: row.cells }
    })
}

function shortSessionId(id: string): string {
  return id.length <= 14 ? id : `${id.slice(0, 12)}…`
}

function aggregateModelCells(cells: CumulativeCell[] | undefined): Map<string, TokenUsage> {  const result = new Map<string, TokenUsage>()
  for (const cell of cells ?? []) {
    const key = `${cell.provider}\u0000${cell.model}`
    const current = result.get(key) ?? { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
    current.uncachedInputTokens += cell.totals.uncachedInputTokens
    current.outputTokens += cell.totals.outputTokens
    current.cacheReadTokens += cell.totals.cacheReadTokens
    current.cacheWriteTokens += cell.totals.cacheWriteTokens
    result.set(key, current)
  }
  return result
}

function tokenCells(tokens: TokenUsage, language: Language) {
  const t = panelText.bind(null, language)
  return h('div', { key: 'tokens', style: css(tokenGrid) }, [
    statCell(t('input'), formatTokens(tokens.uncachedInputTokens)),
    statCell(t('output'), formatTokens(tokens.outputTokens)),
    statCell(t('cacheRead'), formatTokens(tokens.cacheReadTokens)),
    statCell(t('cacheWrite'), formatTokens(tokens.cacheWriteTokens)),
  ])
}

function indexSummary(p: PanelProps, language: Language) {
  const t = panelText.bind(null, language)
  const progress = p.indexProgress
  const text = !progress || progress.status === 'unknown' ? t('indexUnknown')
    : progress.status === 'ready' ? t('indexReady') + (progress.indexed === undefined ? '' : t('indexed', { count: progress.indexed }))
      : progress.status === 'building' ? t('indexBuilding', { completed: progress.completed ?? 0, total: progress.total ?? '—' })
        : progress.status === 'partial' ? t('indexPartial', { count: progress.pending ?? progress.total ?? 0 })
          : progress.status === 'syncing' ? t('indexSyncing', { completed: progress.completed ?? 0, total: progress.total ?? progress.pending ?? '—' })
            : progress.status === 'missing' ? t('indexMissing')
              : progress.status === 'cancelled' ? t('indexCancelled') : t('indexError')
  return h('span', { key: 'summary' }, text)
}

/** Shared live/SSR destructive confirmation; this never performs a request itself. */
export function LifetimeClearConfirmation({ language, busy, onCancel, onConfirm }: {
  language: Language; busy?: boolean; onCancel?: () => void; onConfirm?: () => void
}) {
  const t = panelText.bind(null, language)
  return h('div', { style: css(confirmBox), role: 'alert' }, [
    h('strong', { key: 'title' }, t('confirmTitle')), h('span', { key: 'warning' }, t('clearWarning')),
    h('div', { key: 'actions', style: css(buttonRow) }, [
      h('button', { key: 'cancel', onClick: onCancel, disabled: busy, style: css(secondaryButton) }, t('cancel')),
      h('button', { key: 'confirm', onClick: onConfirm, disabled: busy, style: css(dangerButton) }, t(busy ? 'clearing' : 'confirmClear')),
    ]),
  ])
}

export function LifetimeClearFeedback({ language, status }: { language: Language; status: 'idle' | 'clearing' | 'success' | 'error' }) {
  if (status !== 'success' && status !== 'error') return null
  return h('div', { role: 'status', style: css(status === 'error' ? errorText : note) }, panelText(language, status === 'success' ? 'clearSuccess' : 'clearFailed'))
}

export function ContextPanel(p: PanelProps) {
  const savedLanguage = useLanguage()
  const language = p.language ?? savedLanguage
  const t = panelText.bind(null, language)
  const sections = panelPhaseSections(p.phase ?? 2)
  const [tab, setTab] = useState<PanelTab>(p.initialTab ?? 'overview')
  const [confirmLifetimeClear, setConfirmLifetimeClear] = useState(false)
  const [clearStatus, setClearStatus] = useState<'idle' | 'clearing' | 'success' | 'error'>('idle')
  const [showSessionDetails, setShowSessionDetails] = useState(false)
  const [showLedgerDetails, setShowLedgerDetails] = useState(false)
  const ledger = p.lifetimeLedger
  // Lifetime Ledger is the sole user-visible source of historical totals.
  // The reversible cumulative snapshot remains an internal cache only and must
  // never silently replace the ledger when the ledger is loading or empty.
  const modelRows = useMemo(() => [...(ledger?.byModel ?? [])].sort((a, b) => b.total - a.total), [ledger])
  const modelBuckets = useMemo(() => aggregateModelCells(ledger?.byModelDay), [ledger])
  // Cost estimation is local and never network-backed; the price table lives
  // in Settings. Estimates are clearly labelled in the UI.
  const preferences = useSettings()
  const priceTable = useMemo(() => parsePriceTable(preferences.priceTable) ?? DEFAULT_PRICES, [preferences.priceTable])
  const monthlyCost = monthlyCostOfCells(ledger?.byModelDay ?? [], priceTable)
  const modelCosts = useMemo(() => costPerModel(ledger?.byModelDay ?? [], priceTable), [ledger, priceTable])
  const costByKey = useMemo(() => new Map(modelCosts.map((row) => [`${row.provider}\u0000${row.model}`, row.cost])), [modelCosts])
  // Users who don't care about money can hide every cost surface; the budget
  // alert is also suppressed when cost display is off.
  const showCost = preferences.costEnabled === true
  const overBudget = showCost && preferences.budgetEnabled && monthlyCost >= Math.max(0, preferences.budgetMonthly)
  const budgetPercent = preferences.budgetMonthly > 0 ? Math.min(100, (monthlyCost / preferences.budgetMonthly) * 100) : 0
  const [trendRange, setTrendRange] = useState<'today' | '7d' | '30d'>('today')
  const trendData = trendRange === 'today' ? p.trend : dayTrendBuckets(ledger?.byModelDay, trendRange === '7d' ? 7 : 30)
  const currentProviderModel = modelDisplayName({ provider: p.provider ?? '', model: p.model ?? '' }) || t('unknownModel')
  const contextTotal = p.breakdown ? p.breakdown.systemTokens + p.breakdown.toolsTokens + p.breakdown.messageTokens : 0
  const indexReadable = p.indexProgress?.status === 'ready' || p.indexProgress?.status === 'partial' || p.indexProgress?.status === 'syncing'
  const modelEmptyText = (detail: boolean) => t(p.lifetimeStatus === 'error' ? 'readError' : p.lifetimeStatus === 'loading' || p.lifetimeStatus === 'idle' ? 'loading' : detail ? 'noModelUsage' : 'noModelDetails')

  const confirmClearLifetime = async () => {
    if (clearStatus === 'clearing') return
    setClearStatus('clearing')
    try {
      const ok = await p.onClearLifetime?.()
      setClearStatus(ok ? 'success' : 'error')
      if (ok) setConfirmLifetimeClear(false)
    } catch { setClearStatus('error') }
  }

  const overview = h('div', { style: css(pageStack) }, [
    h('div', { key: 'current', style: css(panelContentGrid()) }, [
    h('section', { key: 'context', style: css(card) }, [
      h('div', { key: 'heading', style: css(sectionHeading) }, [
        h('strong', { key: 'title' }, t('context')),
        h('span', { key: 'model', style: css(providerTag), title: currentProviderModel }, currentProviderModel),
      ]),
      h('div', { key: 'occupancy', style: css(contextHeadline) }, [
        h('strong', { key: 'percent', style: css(contextPercent) }, p.percent === null ? '—' : `${p.percent.toFixed(0)}%`),
        h('span', { key: 'tokens', style: css(subtle) }, p.usedTokens !== undefined && p.contextWindow !== undefined ? `${formatTokens(p.usedTokens)} / ${formatTokens(p.contextWindow)}` : t('contextLoading')),
      ]),
      contextTotal > 0 && p.breakdown ? h('div', { key: 'composition', style: css(compositionBar), 'aria-label': t('composition') }, [
        h('span', { key: 'system', title: `${t('system')} ${formatTokens(p.breakdown.systemTokens)}`, style: css({ flex: p.breakdown.systemTokens, background: '#6da8ff' }) }),
        h('span', { key: 'tools', title: `${t('tools')} ${formatTokens(p.breakdown.toolsTokens)}`, style: css({ flex: p.breakdown.toolsTokens, background: '#a47cff' }) }),
        h('span', { key: 'messages', title: `${t('messages')} ${formatTokens(p.breakdown.messageTokens)}`, style: css({ flex: p.breakdown.messageTokens, background: '#54c7ec' }) }),
      ]) : null,
    ]),
    h('section', { key: 'session', style: css(card) }, [
      h('div', { key: 'heading', style: css(sectionHeading) }, [h('strong', { key: 'title' }, t('session'))]),
      showSessionDetails && p.usage ? tokenCells(p.usage, language) : null,
      h('button', { key: 'sessionDetails', type: 'button', onClick: () => setShowSessionDetails((value) => !value), style: css(textButton), 'aria-expanded': showSessionDetails }, `› ${t(showSessionDetails ? 'hideSessionDetails' : 'sessionDetails')}`),
      showSessionDetails ? h('div', { key: 'summary', style: css(summaryGrid) }, [
        summaryCell(t('toolCalls'), String(p.toolCalls ?? 0)),
        summaryCell(t('turns'), String(p.stats?.turns ?? 0)),
        summaryCell(t('steps'), String(p.stats?.steps ?? 0)),
        summaryCell(t('modelTime'), p.stats ? formatMs(p.stats.llmMs) : '—'),
      ]) : h('div', { key: 'summary-compact', style: css(compactSummary) }, [
        h('strong', { key: 'turns' }, `${p.stats?.turns ?? 0} ${t('turns')}`),
        h('span', { key: 'time' }, p.stats ? formatMs(p.stats.llmMs) : '—'),
      ]),
      h('div', { key: 'index', style: css(indexLine), role: 'status' }, [indexSummary(p, language), p.indexProgress?.status === 'building' || p.indexProgress?.status === 'syncing'
        ? h('button', { key: 'cancel', onClick: p.onCancelIndex, style: css(textButton) }, t('cancel'))
        : p.indexProgress?.status === 'missing' ? h('button', { key: 'build', onClick: p.onBuildIndex, style: css(textButton) }, t('buildIndex'))
          : p.indexProgress?.status === 'partial' ? h('button', { key: 'sync', onClick: p.onBuildIndex, style: css(textButton) }, t('sync'))
            : p.indexProgress?.status === 'error' ? h('button', { key: 'retry', onClick: p.onBuildIndex, style: css(textButton) }, t('retry')) : null]),
    ]),
    ]),
    h('section', { key: 'lifetime', style: css(heroCard), 'data-testid': 'lifetime-ledger' }, [
      h('div', { key: 'eyebrow', style: css(eyebrow) }, t('ledgerScope')),
      h('div', { key: 'heading', style: css(sectionHeading) }, [
        h('div', { key: 'name' }, [h('strong', { key: 'label' }, t('ledger')), h('span', { key: 'sessions', style: css(subtle) }, t('sessions', { count: ledger?.sessions ?? 0 }))]),
        h('span', { key: 'total', style: css(heroTotal) }, p.lifetimeStatus === 'ready' && ledger ? formatTokens(ledger.total) : p.lifetimeStatus === 'error' ? t('readError') : t('loading')),
      ]),
      showLedgerDetails && ledger ? tokenCells(ledger.totals, language) : null,
      h('button', { key: 'ledgerDetails', type: 'button', onClick: () => setShowLedgerDetails((value) => !value), style: css(textButton), 'aria-expanded': showLedgerDetails }, `› ${t(showLedgerDetails ? 'hideLedgerDetails' : 'ledgerDetails')}`),
      h('div', { key: 'note', style: css(ledger?.refreshFailed ? errorText : note) }, ledger?.refreshFailed
        ? t('refreshFailed', { count: ledger.refreshFailed })
        : ledger?.clearedAt
          ? t('clearedAt', { date: formatPanelDate(ledger.clearedAt, language) })
          : t('ledgerNote')),
      h(LifetimeClearFeedback, { key: 'feedback', language, status: clearStatus }),
      confirmLifetimeClear ? h(LifetimeClearConfirmation, { key: 'confirm', language, busy: p.busy || clearStatus === 'clearing', onCancel: () => setConfirmLifetimeClear(false), onConfirm: confirmClearLifetime })
        : h('button', { key: 'clear', onClick: () => { setClearStatus('idle'); setConfirmLifetimeClear(true) }, disabled: p.busy || !ledger || !p.onClearLifetime, style: css(dangerLink) }, t('clear')),
    ]),
    ...(showCost ? [h('section', { key: 'cost', style: css(heroCard), 'data-testid': 'cost-estimate' }, [
      h('div', { key: 'eyebrow', style: css(eyebrow) }, t('cost')),
      h('div', { key: 'heading', style: css(sectionHeading) }, [
        h('strong', { key: 'title' }, t('cost')),
        h('span', { key: 'scope', style: css(subtle) }, t('costScope')),
      ]),
      h('div', { key: 'numbers', style: css(contextHeadline) }, [
        h('strong', { key: 'month', style: css(heroTotal) }, `${t('monthCost')} ${formatCost(monthlyCost, preferences.currency)}`),
      ]),
      overBudget ? h('div', { key: 'over', role: 'alert', style: css(overBudgetText) }, t('overBudget')) : null,
      preferences.budgetEnabled ? h('div', { key: 'budget', style: css(budgetRow) }, [
        h('span', { key: 'label' }, `${t('budget')} ${formatCost(preferences.budgetMonthly, preferences.currency)}`),
        h('span', { key: 'used' }, t('budgetUsed', { percent: budgetPercent.toFixed(0) })),
      ]) : null,
      preferences.budgetEnabled ? h('div', { key: 'bar', style: css(budgetBar), role: 'meter', 'aria-valuenow': Math.round(budgetPercent), 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('span', { key: 'fill', style: css({ display: 'block', width: `${budgetPercent}%`, height: '100%', borderRadius: 999, background: overBudget ? 'var(--tp-danger)' : 'var(--tp-accent)' }) })) : null,
      h('div', { key: 'note', style: css(note) }, t('budgetNote')),
    ])] : []),
    h('div', { key: 'insights', style: css(panelContentGrid()) }, [
    h('section', { key: 'top', style: css(card) }, [
      h('div', { key: 'heading', style: css(sectionHeading) }, [h('strong', { key: 'title' }, t('topModels')), h('span', { key: 'scope', style: css(subtle) }, t('lifetime'))]),
      modelRows.length ? h('div', { key: 'list', style: css(list) }, modelRows.slice(0, 5).map((item, index) => h('div', { key: `${item.provider}|${item.model}`, style: css({ ...modelRow, ...(showCost ? {} : { gridTemplateColumns: '24px minmax(0,1fr) auto' }) }) }, [
        h('span', { key: 'rank', style: css(rank) }, String(index + 1).padStart(2, '0')),
        h('span', { key: 'name', style: css(modelName), title: modelDisplayName(item) }, modelDisplayName(item)),
        h('strong', { key: 'total', style: css(modelValue) }, formatTokens(item.total)),
        ...(showCost ? [h('span', { key: 'cost', style: css(modelCost) }, formatCost(costByKey.get(`${item.provider}\u0000${item.model}`) ?? 0, preferences.currency))] : []),
      ]))) : h('div', { key: 'empty', style: css(emptyState) }, modelEmptyText(false)),
    ]),
    h('section', { key: 'trend', style: css(card) }, [
      h('div', { key: 'heading', style: css(sectionHeading) }, [
        h('strong', { key: 'title' }, t('todayTrend')),
        h('div', { key: 'range', role: 'group', style: css(rangeGroup) }, [
          h('button', { key: 'today', type: 'button', onClick: () => setTrendRange('today'), style: css(rangeButton(trendRange === 'today')) }, t('trendToday')),
          h('button', { key: '7d', type: 'button', onClick: () => setTrendRange('7d'), style: css(rangeButton(trendRange === '7d')) }, t('trend7d')),
          h('button', { key: '30d', type: 'button', onClick: () => setTrendRange('30d'), style: css(rangeButton(trendRange === '30d')) }, t('trend30d')),
        ]),
        p.refreshing ? h('span', { key: 'refreshing', style: css(subtle) }, t('refreshingHourly')) : null,
      ]),
      !sections.trend ? h('div', { key: 'state', style: css(emptyState) }, t('opening'))
        : trendRange === 'today'
          ? (!indexReadable ? h('div', { key: 'state', style: css(emptyState) }, t('trendNeedsIndex'))
              : p.trendStatus === 'error' ? h('div', { key: 'state', style: css(errorText) }, t('trendError'))
                : p.trendStatus === 'ready' ? h(Sparkline, { key: 'chart', data: trendData, language }) : h('div', { key: 'state', style: css(emptyState) }, t('trendLoading')))
          : (trendData.length === 0 ? h('div', { key: 'state', style: css(emptyState) }, t('noTrend'))
              : h(Sparkline, { key: 'chart', data: trendData, language })),
      trendRange !== 'today' ? h('div', { key: 'note', style: css(note) }, t('dayTrendNote')) : null,
    ]),
    h('section', { key: 'sessions', style: css(card) }, [
      h('div', { key: 'heading', style: css(sectionHeading) }, [h('strong', { key: 'title' }, t('topSessions')), h('span', { key: 'hint', style: css(subtle) }, t('sessionsHint'))]),
      p.sessionRankingStatus === 'error' ? h('div', { key: 'state', style: css(errorText) }, t('sessionsError'))
        : p.sessionRankingStatus === 'ready' && p.sessionRanking
          ? (p.sessionRanking.sessions.length === 0
              ? h('div', { key: 'empty', style: css(emptyState) }, p.sessionRanking.persisted ? t('sessionsEmpty') : t('sessionsNeedsIndex'))
              : h('div', { key: 'list', style: css(list) }, p.sessionRanking.sessions.slice(0, 5).map((item, index) => h('div', { key: item.sessionId, style: css({ ...modelRow, ...(showCost ? {} : { gridTemplateColumns: '24px minmax(0,1fr) auto' }) }) }, [
                h('span', { key: 'rank', style: css(rank) }, String(index + 1).padStart(2, '0')),
                h('span', { key: 'id', style: css(modelName), title: item.sessionId }, t('sessionShortId', { id: shortSessionId(item.sessionId) })),
                h('strong', { key: 'total', style: css(modelValue) }, formatTokens(item.total)),
                ...(showCost ? [h('span', { key: 'cost', style: css(modelCost) }, formatCost(costOfTotals(item.totals, resolvePrice(priceTable, '(unknown)')), preferences.currency))] : []),
              ]))))
          : h('div', { key: 'state', style: css(emptyState) }, t('loading')),
    ]),
    ]),
  ])

  const models = h('div', { style: css(pageStack) }, [
    h('div', { key: 'intro', style: css(pageIntro) }, [h('strong', { key: 'title' }, t('allModels')), h('span', { key: 'hint' }, t('modelIntro'))]),
    ...(modelRows.length ? modelRows.map((item) => {
      const buckets = modelBuckets.get(`${item.provider}\u0000${item.model}`)
      return h('section', { key: `${item.provider}|${item.model}`, style: css(card) }, [
        h('div', { key: 'heading', style: css(sectionHeading) }, [h('strong', { key: 'name', style: css(fullModelName), title: modelDisplayName(item) }, modelDisplayName(item)), h('span', { key: 'total', style: css(modelValue) }, formatTokens(item.total))]),
        ...(showCost ? [h('div', { key: 'cost', style: css(modelCostLine) }, `${t('modelCost')} ${formatCost(costByKey.get(`${item.provider}\u0000${item.model}`) ?? 0, preferences.currency)}`)] : []),
        buckets ? tokenCells(buckets, language) : h('div', { key: 'note', style: css(note) }, t('noBreakdown')),
      ])
    }) : [h('div', { key: 'empty', style: css(emptyState) }, modelEmptyText(true))]),
  ])

  const settings = sections.settings ? h('div', { style: css(pageStack) }, [h<{ language?: Language }>(TokenPetSettingsPanel, { key: 'settings', language })]) : h('div', { style: css(emptyState) }, t('settingsLoading'))
  const content = tab === 'overview' ? overview : tab === 'models' ? models : settings

  return h('div', { role: 'region', lang: localeFor(language), 'aria-label': t('panel'), style: css({ ...root, ...themeVars(preferences.theme), ...(p.width ? { width: p.width } : {}), ...(p.height ? { height: p.height } : {}), ...(p.maxHeight ? { maxHeight: p.maxHeight } : {}) }) }, [
    h('nav', { key: 'tabs', role: 'tablist', 'aria-label': t('tabs'), style: css(tabBar) }, PANEL_TABS.map((item) => h('button', {
      key: item.id, type: 'button', role: 'tab', 'aria-selected': tab === item.id,
      onClick: () => setTab(item.id), style: css({ ...tabButton, ...(tab === item.id ? activeTabButton : {}) }),
    }, t(item.id)))),
    h('main', { key: 'content', 'aria-label': t(tab), style: css(scroller), tabIndex: 0 }, content),
  ])
}

function statCell(label: string, value: string) {
  return h('div', { key: label, style: css(statCellStyle) }, [h('strong', { key: 'value', style: css(statValue) }, value), h('span', { key: 'label', style: css(statLabel) }, label)])
}
function summaryCell(label: string, value: string) {
  return h('div', { key: label, style: css(summaryCellStyle) }, [h('span', { key: 'label', style: css(statLabel) }, label), h('strong', { key: 'value', style: css(statValue) }, value)])
}

const root: import('react').CSSProperties = { position: 'relative', display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, boxSizing: 'border-box', overflow: 'hidden', borderRadius: 16, border: '1px solid var(--tp-border-strong)', background: 'var(--tp-panel-bg)', color: 'var(--tp-text)', fontSize: 12, lineHeight: 1.5, boxShadow: 'var(--tp-shadow)', userSelect: 'text', maxWidth: '100%', overflowWrap: 'anywhere' }
const tabBar: import('react').CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 4, flex: 'none', padding: '8px 10px', borderBottom: '1px solid var(--tp-border-2)', background: 'var(--tp-tab-bg)' }
const tabButton: import('react').CSSProperties = { minWidth: 0, padding: '7px 5px', border: '1px solid transparent', borderRadius: 8, color: 'var(--tp-text-2)', background: 'transparent', cursor: 'pointer', fontSize: 12, fontWeight: 600 }
const activeTabButton: import('react').CSSProperties = { color: 'var(--tp-accent)', borderColor: 'var(--tp-border-strong)', background: 'var(--tp-accent-soft-2)', boxShadow: 'inset 0 0 0 1px var(--tp-border-strong)' }
const scroller: import('react').CSSProperties = { flex: '1 1 auto', minWidth: 0, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain', scrollbarGutter: 'stable', padding: '12px 12px 56px', scrollPaddingBlock: '12px 56px', touchAction: 'pan-y' }
const pageStack: import('react').CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }
const card: import('react').CSSProperties = { boxSizing: 'border-box', minWidth: 0, padding: 11, borderRadius: 11, border: '1px solid var(--tp-border)', background: 'var(--tp-card-bg)' }
const heroCard: import('react').CSSProperties = { ...card, borderColor: 'var(--tp-border-strong)', background: 'var(--tp-hero-bg)' }
const eyebrow: import('react').CSSProperties = { color: 'var(--tp-accent-2)', fontSize: 10, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 3 }
const sectionHeading: import('react').CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 7, minWidth: 0 }
const heroTotal: import('react').CSSProperties = { color: 'var(--tp-accent-2)', fontSize: 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }
const contextHeadline: import('react').CSSProperties = { display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, marginTop: 7 }
const contextPercent: import('react').CSSProperties = { color: 'var(--tp-text)', fontSize: 22, lineHeight: 1, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }
const compositionBar: import('react').CSSProperties = { display: 'flex', gap: 1, width: '100%', height: 5, marginTop: 9, overflow: 'hidden', borderRadius: 999, background: 'var(--tp-track)' }
const subtle: import('react').CSSProperties = { color: 'var(--tp-text-3)', fontSize: 10, fontWeight: 400 }
const note: import('react').CSSProperties = { color: 'var(--tp-text-2)', fontSize: 10, marginTop: 7 }
const tokenGrid: import('react').CSSProperties = { display: 'grid', gridTemplateColumns: panelContentGrid(92).gridTemplateColumns, gap: 6, marginTop: 9 }
const statCellStyle: import('react').CSSProperties = { minWidth: 0, display: 'flex', flexDirection: 'column', padding: '6px 7px', borderRadius: 7, background: 'var(--tp-hover-row)' }
const statValue: import('react').CSSProperties = { minWidth: 0, color: 'var(--tp-text)', fontSize: 12, fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere', whiteSpace: 'normal' }
const statLabel: import('react').CSSProperties = { color: 'var(--tp-text-3)', fontSize: 10, whiteSpace: 'normal' }
const list: import('react').CSSProperties = { display: 'flex', flexDirection: 'column', gap: 3, marginTop: 8 }
const modelRow: import('react').CSSProperties = { display: 'grid', gridTemplateColumns: '24px minmax(0,1fr) auto auto', alignItems: 'center', gap: 7, minWidth: 0, padding: '4px 0' }
const rank: import('react').CSSProperties = { color: 'var(--tp-text-4)', fontSize: 10, fontVariantNumeric: 'tabular-nums' }
const modelName: import('react').CSSProperties = { color: 'var(--tp-text)', minWidth: 0, overflowWrap: 'anywhere', whiteSpace: 'normal' }
const fullModelName: import('react').CSSProperties = { minWidth: 0, overflowWrap: 'anywhere', color: 'var(--tp-text)' }
const modelValue: import('react').CSSProperties = { color: 'var(--tp-gold)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }
const modelCost: import('react').CSSProperties = { color: 'var(--tp-success)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', fontSize: 10 }
const modelCostLine: import('react').CSSProperties = { color: 'var(--tp-success)', fontSize: 10, marginTop: 4 }
const rangeGroup: import('react').CSSProperties = { display: 'flex', gap: 4, flexWrap: 'wrap' }
const rangeButton = (active: boolean): import('react').CSSProperties => ({
  color: active ? 'var(--tp-accent)' : 'var(--tp-text-2)', background: active ? 'var(--tp-accent-soft-2)' : 'transparent',
  border: active ? '1px solid var(--tp-border-strong)' : '1px solid var(--tp-border-2)',
  borderRadius: 6, padding: '2px 7px', cursor: 'pointer', fontSize: 10,
})
const budgetRow: import('react').CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 8, color: 'var(--tp-text-2)', fontSize: 11, flexWrap: 'wrap' }
const budgetBar: import('react').CSSProperties = { display: 'block', width: '100%', height: 6, marginTop: 7, overflow: 'hidden', borderRadius: 999, background: 'var(--tp-track)' }
const overBudgetText: import('react').CSSProperties = { color: 'var(--tp-danger)', fontSize: 11, marginTop: 7 }
const providerTag: import('react').CSSProperties = { boxSizing: 'border-box', minWidth: 0, maxWidth: '100%', color: 'var(--tp-accent-text)', fontSize: 10, padding: '2px 6px', borderRadius: 6, background: 'var(--tp-accent-soft)', overflowWrap: 'anywhere', whiteSpace: 'normal' }
const compactSummary: import('react').CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 9, color: 'var(--tp-text-2)', fontSize: 11 }
const summaryGrid: import('react').CSSProperties = { display: 'grid', gridTemplateColumns: panelContentGrid(92).gridTemplateColumns, gap: 6, marginTop: 9 }
const summaryCellStyle: import('react').CSSProperties = { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1, padding: '6px 7px', borderRadius: 7, background: 'var(--tp-hover-row)' }
const indexLine: import('react').CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 8, color: 'var(--tp-text-2)', fontSize: 10 }
const textButton: import('react').CSSProperties = { color: 'var(--tp-accent-text)', background: 'transparent', border: 0, padding: 2, cursor: 'pointer', fontSize: 10 }
const pageIntro: import('react').CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2, color: 'var(--tp-text-2)', fontSize: 10 }
const emptyState: import('react').CSSProperties = { color: 'var(--tp-text-3)', padding: '14px 2px', textAlign: 'center' }
const errorText: import('react').CSSProperties = { ...emptyState, color: 'var(--tp-danger)' }
const chartWrap: import('react').CSSProperties = { position: 'relative', width: '100%', minWidth: 0, marginTop: 10 }
const chartSvg: import('react').CSSProperties = { display: 'block', width: '100%', height: 92, overflow: 'visible' }
const chartAxis: import('react').CSSProperties = { display: 'flex', justifyContent: 'space-between', color: 'var(--tp-text-4)', fontSize: 10 }
const tooltip: import('react').CSSProperties = { position: 'absolute', top: 0, left: 0, right: 0, boxSizing: 'border-box', zIndex: 2, display: 'flex', flexDirection: 'column', minWidth: 0, maxWidth: '100%', padding: '6px 8px', borderRadius: 7, background: 'var(--tp-solid-2)', border: '1px solid var(--tp-border-strong)', color: 'var(--tp-text)', fontSize: 10, pointerEvents: 'none', whiteSpace: 'normal' }
const buttonRow: import('react').CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 7 }
const secondaryButton: import('react').CSSProperties = { minWidth: 0, overflowWrap: 'anywhere', flex: '1 1 100px', color: 'var(--tp-text)', background: 'var(--tp-accent-soft)', border: '1px solid var(--tp-border-strong)', borderRadius: 7, padding: '5px 8px', cursor: 'pointer', fontSize: 11 }
const dangerButton: import('react').CSSProperties = { ...secondaryButton, color: 'var(--tp-danger-2)', background: 'var(--tp-danger-bg)', borderColor: 'var(--tp-danger-border)' }
const dangerLink: import('react').CSSProperties = { marginTop: 7, color: 'var(--tp-danger-2)', background: 'transparent', border: 0, padding: 0, cursor: 'pointer', fontSize: 10, textDecoration: 'underline', textUnderlineOffset: 2 }
const confirmBox: import('react').CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8, padding: 8, borderRadius: 8, color: 'var(--tp-danger-2)', background: 'var(--tp-danger-bg)', border: '1px solid var(--tp-danger-border)' }
