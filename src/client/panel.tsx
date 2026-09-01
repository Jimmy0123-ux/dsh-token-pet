import { createElement as h, useMemo, useState } from 'react'

import { css, formatMs, formatTokens, type CumulativeCell, type CumulativeModel, type CumulativeUsage, type SessionStats, type TokenUsage, type TrendBucket } from './derive.ts'
import type { PetAction } from './events.ts'
import { TokenPetSettingsPanel } from './settings-panel.tsx'
import { LIFETIME_LEDGER_CLEAR_WARNING } from './lifetime-ledger.ts'
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
}

/** Backward-compatible name for consumers of the panel component. */
export type TrendPoint = TrendBucket
const trendDateFormatter = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
const trendHourFormatter = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' })
function formatTrendDate(time: number): string {
  const date = new Date(time > 1e12 ? time : time * 1000)
  return Number.isFinite(date.getTime()) ? trendDateFormatter.format(date) : '时间未知'
}

function Sparkline({ data }: { data: TrendBucket[] }) {
  const [hovered, setHovered] = useState<number | null>(null)
  const width = 420
  const height = 76
  if (data.length === 0) return h('div', { style: css(emptyState) }, '暂无趋势数据')
  const max = Math.max(1, ...data.map((point) => point.total))
  const step = data.length > 1 ? width / (data.length - 1) : width / 2
  const points = data.map((point, index) => ({ ...point, x: data.length > 1 ? index * step : width / 2, y: height - 8 - (point.total / max) * (height - 18) }))
  const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ')
  const selected = hovered === null ? null : points[hovered]
  return h('div', { style: css(chartWrap) }, [
    selected ? h('div', { key: 'tip', role: 'status', style: css({ ...tooltip, left: `${(selected.x / width) * 100}%` }) }, [
      h('strong', { key: 'time' }, formatTrendDate(selected.start)),
      h('span', { key: 'tokens' }, `${formatTokens(selected.total)} tokens · ${selected.count} 次请求`),
    ]) : null,
    h('svg', { key: 'chart', viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'none', style: css(chartSvg), onMouseLeave: () => setHovered(null) }, [
      h('path', { key: 'area', d: `${line} L ${points.at(-1)?.x ?? width} ${height} L ${points[0]?.x ?? 0} ${height} Z`, fill: 'rgba(124,150,255,.16)' }),
      h('path', { key: 'line', d: line, fill: 'none', stroke: '#91a7ff', strokeWidth: 2, vectorEffect: 'non-scaling-stroke' }),
      ...points.map((point, index) => h('circle', {
        key: `${point.start}-${index}`, cx: point.x, cy: point.y, r: hovered === index ? 4 : 2.5,
        fill: '#eef1ff', stroke: '#7c96ff', strokeWidth: 1.5, vectorEffect: 'non-scaling-stroke', tabIndex: 0,
        'aria-label': `${formatTrendDate(point.start)}，${formatTokens(point.total)} tokens，${point.count} 次请求`,
        onPointerEnter: () => setHovered(index), onFocus: () => setHovered(index), onBlur: () => setHovered(null),
      })),
    ]),
    h('div', { key: 'axis', style: css(chartAxis) }, [
      h('span', { key: 'first' }, trendHourFormatter.format(new Date(points[0]?.start ?? 0))),
      h('span', { key: 'last' }, trendHourFormatter.format(new Date(points.at(-1)?.start ?? 0))),
    ]),
  ])
}

function aggregateModelCells(cells: CumulativeCell[] | undefined): Map<string, TokenUsage> {
  const result = new Map<string, TokenUsage>()
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

function tokenCells(tokens: TokenUsage) {
  return h('div', { key: 'tokens', style: css(tokenGrid) }, [
    statCell('输入', formatTokens(tokens.uncachedInputTokens)),
    statCell('输出', formatTokens(tokens.outputTokens)),
    statCell('缓存读', formatTokens(tokens.cacheReadTokens)),
    statCell('缓存写', formatTokens(tokens.cacheWriteTokens)),
  ])
}

function indexSummary(p: PanelProps) {
  const progress = p.indexProgress
  const text = !progress || progress.status === 'unknown' ? '正在检查索引状态…'
    : progress.status === 'ready' ? `索引已就绪${progress.indexed === undefined ? '' : ` · ${progress.indexed} 个已索引`}`
      : progress.status === 'building' ? `首次建立历史索引 · ${progress.completed ?? 0}/${progress.total ?? '—'}`
        : progress.status === 'partial' ? `已有索引 · 待同步 ${progress.pending ?? progress.total ?? 0} 个会话`
          : progress.status === 'syncing' ? `正在增量同步 · ${progress.completed ?? 0}/${progress.total ?? progress.pending ?? '—'}`
            : progress.status === 'missing' ? '尚未建立历史索引'
              : progress.status === 'cancelled' ? '历史索引操作已暂停'
                : '索引读取失败；现有终身用量账本不受影响'
  return h('span', { key: 'summary' }, text)
}

export function ContextPanel(p: PanelProps) {
  const sections = panelPhaseSections(p.phase ?? 2)
  const [tab, setTab] = useState<PanelTab>('overview')
  const [confirmLifetimeClear, setConfirmLifetimeClear] = useState(false)
  const ledger = p.lifetimeLedger
  // Lifetime Ledger is the sole user-visible source of historical totals.
  // The reversible cumulative snapshot remains an internal cache only and must
  // never silently replace the ledger when the ledger is loading or empty.
  const modelRows = useMemo(() => [...(ledger?.byModel ?? [])].sort((a, b) => b.total - a.total), [ledger])
  const modelBuckets = useMemo(() => aggregateModelCells(ledger?.byModelDay), [ledger])
  const currentProviderModel = modelDisplayName({ provider: p.provider ?? '', model: p.model ?? '' }) || '模型未知'
  const contextTotal = p.breakdown ? p.breakdown.systemTokens + p.breakdown.toolsTokens + p.breakdown.messageTokens : 0
  const indexReadable = p.indexProgress?.status === 'ready' || p.indexProgress?.status === 'partial' || p.indexProgress?.status === 'syncing'

  const confirmClearLifetime = async () => {
    const ok = await p.onClearLifetime?.()
    if (ok) setConfirmLifetimeClear(false)
  }

  const overview = h('div', { style: css(pageStack) }, [
    h('section', { key: 'context', style: css(card) }, [
      h('div', { key: 'heading', style: css(sectionHeading) }, [
        h('strong', { key: 'title' }, '当前上下文'),
        h('span', { key: 'model', style: css(providerTag), title: currentProviderModel }, currentProviderModel),
      ]),
      h('div', { key: 'occupancy', style: css(contextHeadline) }, [
        h('strong', { key: 'percent', style: css(contextPercent) }, p.percent === null ? '—' : `${p.percent.toFixed(0)}%`),
        h('span', { key: 'tokens', style: css(subtle) }, p.usedTokens !== undefined && p.contextWindow !== undefined ? `${formatTokens(p.usedTokens)} / ${formatTokens(p.contextWindow)}` : '上下文窗口读取中'),
      ]),
      contextTotal > 0 && p.breakdown ? h('div', { key: 'composition', style: css(compositionBar), 'aria-label': '上下文构成' }, [
        h('span', { key: 'system', title: `系统 ${formatTokens(p.breakdown.systemTokens)}`, style: css({ flex: p.breakdown.systemTokens, background: '#6da8ff' }) }),
        h('span', { key: 'tools', title: `工具 ${formatTokens(p.breakdown.toolsTokens)}`, style: css({ flex: p.breakdown.toolsTokens, background: '#a47cff' }) }),
        h('span', { key: 'messages', title: `对话 ${formatTokens(p.breakdown.messageTokens)}`, style: css({ flex: p.breakdown.messageTokens, background: '#54c7ec' }) }),
      ]) : null,
      p.usage ? tokenCells(p.usage) : null,
    ]),
    h('section', { key: 'lifetime', style: css(heroCard), 'data-testid': 'lifetime-ledger' }, [
      h('div', { key: 'eyebrow', style: css(eyebrow) }, '唯一主账本'),
      h('div', { key: 'heading', style: css(sectionHeading) }, [
        h('div', { key: 'name' }, [h('strong', { key: 'label' }, '终身用量账本'), h('span', { key: 'sessions', style: css(subtle) }, ` · ${ledger?.sessions ?? 0} 个会话`)]),
        h('span', { key: 'total', style: css(heroTotal) }, p.lifetimeStatus === 'ready' && ledger ? formatTokens(ledger.total) : p.lifetimeStatus === 'error' ? '读取失败' : '读取中…'),
      ]),
      ledger ? tokenCells(ledger.totals) : null,
      h('div', { key: 'note', style: css(ledger?.refreshFailed ? errorText : note) }, ledger?.refreshFailed
        ? `本次有 ${ledger.refreshFailed} 个会话读取失败，账本保留既有值但本次结果可能暂不完整。`
        : ledger?.clearedAt
          ? `账本历史已于 ${new Date(ledger.clearedAt).toLocaleString('zh-CN')} 永久清空；此后继续累计。`
          : '普通累计基线仍在底层保留，但不再作为第二份主账本展示。'),
      confirmLifetimeClear ? h('div', { key: 'confirm', style: css(confirmBox), role: 'alert' }, [
        h('strong', { key: 'title' }, '确认永久清空？'), h('span', { key: 'warning' }, LIFETIME_LEDGER_CLEAR_WARNING),
        h('div', { key: 'actions', style: css(buttonRow) }, [
          h('button', { key: 'cancel', onClick: () => setConfirmLifetimeClear(false), disabled: p.busy, style: css(secondaryButton) }, '取消'),
          h('button', { key: 'confirm', onClick: confirmClearLifetime, disabled: p.busy, style: css(dangerButton) }, p.busy ? '清空中…' : '确认永久清空'),
        ]),
      ]) : h('button', { key: 'clear', onClick: () => setConfirmLifetimeClear(true), disabled: p.busy || !ledger, style: css(dangerLink) }, '清空历史（不可恢复）'),
    ]),
    h('section', { key: 'top', style: css(card) }, [
      h('div', { key: 'heading', style: css(sectionHeading) }, [h('strong', { key: 'title' }, '用量最高的 5 个服务商与模型'), h('span', { key: 'scope', style: css(subtle) }, '终身累计')]),
      modelRows.length ? h('div', { key: 'list', style: css(list) }, modelRows.slice(0, 5).map((item, index) => h('div', { key: `${item.provider}|${item.model}`, style: css(modelRow) }, [
        h('span', { key: 'rank', style: css(rank) }, String(index + 1).padStart(2, '0')),
        h('span', { key: 'name', style: css(modelName), title: modelDisplayName(item) }, modelDisplayName(item)),
        h('strong', { key: 'total', style: css(modelValue) }, formatTokens(item.total)),
      ]))) : h('div', { key: 'empty', style: css(emptyState) }, '暂无模型明细'),
    ]),
    h('section', { key: 'trend', style: css(card) }, [
      h('div', { key: 'heading', style: css(sectionHeading) }, [
        h('strong', { key: 'title' }, '本日用量趋势'),
        h('span', { key: 'interval', style: css(subtle) }, p.refreshing ? '后台刷新中 · 每小时' : '每小时'),
      ]),
      !sections.trend ? h('div', { key: 'state', style: css(emptyState) }, '正在打开统计…')
        : !indexReadable ? h('div', { key: 'state', style: css(emptyState) }, '首次建立历史索引后显示趋势')
          : p.trendStatus === 'error' ? h('div', { key: 'state', style: css(errorText) }, '本日趋势读取失败')
            : p.trendStatus === 'ready' ? h(Sparkline, { key: 'chart', data: p.trend }) : h('div', { key: 'state', style: css(emptyState) }, '正在读取本日趋势…'),
    ]),
    h('section', { key: 'session', style: css(card) }, [
      h('div', { key: 'heading', style: css(sectionHeading) }, [h('strong', { key: 'title' }, '当前会话 / 索引'), h('span', { key: 'model', style: css(providerTag), title: currentProviderModel }, currentProviderModel)]),
      h('div', { key: 'summary', style: css(summaryGrid) }, [
        summaryCell('上下文', p.percent === null ? '—' : `${p.percent.toFixed(0)}%`),
        summaryCell('轮次', String(p.stats?.turns ?? 0)),
        summaryCell('步数', String(p.stats?.steps ?? 0)),
        summaryCell('模型耗时', p.stats ? formatMs(p.stats.llmMs) : '—'),
      ]),
      h('div', { key: 'index', style: css(indexLine), role: 'status' }, [indexSummary(p), p.indexProgress?.status === 'building' || p.indexProgress?.status === 'syncing'
        ? h('button', { key: 'cancel', onClick: p.onCancelIndex, style: css(textButton) }, '取消')
        : p.indexProgress?.status === 'missing' ? h('button', { key: 'build', onClick: p.onBuildIndex, style: css(textButton) }, '首次建立索引')
          : p.indexProgress?.status === 'partial' ? h('button', { key: 'sync', onClick: p.onBuildIndex, style: css(textButton) }, '立即同步')
            : p.indexProgress?.status === 'error' ? h('button', { key: 'retry', onClick: p.onBuildIndex, style: css(textButton) }, '重试') : null]),
    ]),
  ])

  const models = h('div', { style: css(pageStack) }, [
    h('div', { key: 'intro', style: css(pageIntro) }, [h('strong', { key: 'title' }, '全部服务商与模型'), h('span', { key: 'hint' }, '分类来自账本的模型/日期记录；源接口未提供分类时仅显示真实总量。')]),
    ...(modelRows.length ? modelRows.map((item) => {
      const buckets = modelBuckets.get(`${item.provider}\u0000${item.model}`)
      return h('section', { key: `${item.provider}|${item.model}`, style: css(card) }, [
        h('div', { key: 'heading', style: css(sectionHeading) }, [h('strong', { key: 'name', style: css(fullModelName), title: modelDisplayName(item) }, modelDisplayName(item)), h('span', { key: 'total', style: css(modelValue) }, formatTokens(item.total))]),
        buckets ? tokenCells(buckets) : h('div', { key: 'note', style: css(note) }, '当前接口未提供该模型的 Token 分类，因此不进行推算。'),
      ])
    }) : [h('div', { key: 'empty', style: css(emptyState) }, '暂无模型用量')]),
  ])

  const settings = sections.settings ? h('div', { style: css(pageStack) }, [h(TokenPetSettingsPanel, { key: 'settings' })]) : h('div', { style: css(emptyState) }, '正在加载设置…')
  const content = tab === 'overview' ? overview : tab === 'models' ? models : settings

  return h('div', { role: 'region', 'aria-label': '用量小宠物统计面板', style: css({ ...root, ...(p.width ? { width: p.width } : {}), ...(p.height ? { height: p.height } : {}) }) }, [
    h('nav', { key: 'tabs', 'aria-label': '统计面板', style: css(tabBar) }, PANEL_TABS.map((item) => h('button', {
      key: item.id, type: 'button', role: 'tab', 'aria-selected': tab === item.id,
      onClick: () => setTab(item.id), style: css({ ...tabButton, ...(tab === item.id ? activeTabButton : {}) }),
    }, item.label))),
    h('main', { key: 'content', style: css(scroller), tabIndex: 0 }, content),
  ])
}

function statCell(label: string, value: string) {
  return h('div', { key: label, style: css(statCellStyle) }, [h('strong', { key: 'value', style: css(statValue) }, value), h('span', { key: 'label', style: css(statLabel) }, label)])
}
function summaryCell(label: string, value: string) {
  return h('div', { key: label, style: css(summaryCellStyle) }, [h('span', { key: 'label', style: css(statLabel) }, label), h('strong', { key: 'value', style: css(statValue) }, value)])
}

const root: import('react').CSSProperties = { position: 'relative', display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, boxSizing: 'border-box', overflow: 'hidden', borderRadius: 16, border: '1px solid rgba(145,167,255,.28)', background: 'linear-gradient(145deg,rgba(31,35,55,.98),rgba(20,22,34,.99))', color: '#e8eaf2', fontSize: 12, lineHeight: 1.5, boxShadow: '0 10px 30px rgba(0,0,0,.35)', userSelect: 'text' }
const tabBar: import('react').CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 4, flex: 'none', padding: '8px 10px', borderBottom: '1px solid rgba(145,167,255,.18)', background: 'rgba(16,18,29,.7)' }
const tabButton: import('react').CSSProperties = { minWidth: 0, padding: '7px 5px', border: '1px solid transparent', borderRadius: 8, color: '#9aa0b5', background: 'transparent', cursor: 'pointer', fontSize: 12, fontWeight: 600 }
const activeTabButton: import('react').CSSProperties = { color: '#fff', borderColor: 'rgba(145,167,255,.44)', background: 'rgba(124,150,255,.16)', boxShadow: 'inset 0 0 0 1px rgba(145,167,255,.08)' }
const scroller: import('react').CSSProperties = { flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain', scrollbarGutter: 'stable', padding: '12px 12px 56px', scrollPaddingBlock: '12px 56px', touchAction: 'pan-y' }
const pageStack: import('react').CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }
const card: import('react').CSSProperties = { minWidth: 0, padding: 11, borderRadius: 11, border: '1px solid rgba(128,128,160,.2)', background: 'rgba(12,15,27,.34)' }
const heroCard: import('react').CSSProperties = { ...card, borderColor: 'rgba(196,167,255,.42)', background: 'linear-gradient(145deg,rgba(119,87,190,.15),rgba(12,15,27,.42))' }
const eyebrow: import('react').CSSProperties = { color: '#c4a7ff', fontSize: 10, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 3 }
const sectionHeading: import('react').CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 7, minWidth: 0 }
const heroTotal: import('react').CSSProperties = { color: '#c4a7ff', fontSize: 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }
const contextHeadline: import('react').CSSProperties = { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginTop: 7 }
const contextPercent: import('react').CSSProperties = { color: '#fff', fontSize: 22, lineHeight: 1, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }
const compositionBar: import('react').CSSProperties = { display: 'flex', gap: 1, width: '100%', height: 5, marginTop: 9, overflow: 'hidden', borderRadius: 999, background: 'rgba(128,128,160,.16)' }
const subtle: import('react').CSSProperties = { color: '#8f96ad', fontSize: 10, fontWeight: 400 }
const note: import('react').CSSProperties = { color: '#9aa0b5', fontSize: 10, marginTop: 7 }
const tokenGrid: import('react').CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(78px,1fr))', gap: 6, marginTop: 9 }
const statCellStyle: import('react').CSSProperties = { minWidth: 0, display: 'flex', flexDirection: 'column', padding: '6px 7px', borderRadius: 7, background: 'rgba(128,128,160,.1)' }
const statValue: import('react').CSSProperties = { minWidth: 0, color: '#fff', fontSize: 12, fontVariantNumeric: 'tabular-nums', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const statLabel: import('react').CSSProperties = { color: '#8f96ad', fontSize: 10, whiteSpace: 'nowrap' }
const list: import('react').CSSProperties = { display: 'flex', flexDirection: 'column', gap: 3, marginTop: 8 }
const modelRow: import('react').CSSProperties = { display: 'grid', gridTemplateColumns: '24px minmax(0,1fr) auto', alignItems: 'center', gap: 7, minWidth: 0, padding: '4px 0' }
const rank: import('react').CSSProperties = { color: '#6f7895', fontSize: 10, fontVariantNumeric: 'tabular-nums' }
const modelName: import('react').CSSProperties = { color: '#cfd4e8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
const fullModelName: import('react').CSSProperties = { minWidth: 0, overflowWrap: 'anywhere', color: '#dce1f5' }
const modelValue: import('react').CSSProperties = { color: '#ffd166', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }
const providerTag: import('react').CSSProperties = { maxWidth: '100%', color: '#91a7ff', fontSize: 10, padding: '2px 6px', borderRadius: 6, background: 'rgba(124,150,255,.12)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const summaryGrid: import('react').CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(86px,1fr))', gap: 6, marginTop: 9 }
const summaryCellStyle: import('react').CSSProperties = { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1, padding: '6px 7px', borderRadius: 7, background: 'rgba(128,128,160,.08)' }
const indexLine: import('react').CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 8, color: '#aab0c5', fontSize: 10 }
const textButton: import('react').CSSProperties = { color: '#91a7ff', background: 'transparent', border: 0, padding: 2, cursor: 'pointer', fontSize: 10 }
const pageIntro: import('react').CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2, color: '#9aa0b5', fontSize: 10 }
const emptyState: import('react').CSSProperties = { color: '#8f96ad', padding: '14px 2px', textAlign: 'center' }
const errorText: import('react').CSSProperties = { ...emptyState, color: '#ffb4a8' }
const chartWrap: import('react').CSSProperties = { position: 'relative', width: '100%', minWidth: 0, marginTop: 10 }
const chartSvg: import('react').CSSProperties = { display: 'block', width: '100%', height: 92, overflow: 'visible' }
const chartAxis: import('react').CSSProperties = { display: 'flex', justifyContent: 'space-between', color: '#7f879f', fontSize: 10 }
const tooltip: import('react').CSSProperties = { position: 'absolute', top: 0, transform: 'translateX(-50%)', zIndex: 2, display: 'flex', flexDirection: 'column', minWidth: 145, padding: '6px 8px', borderRadius: 7, background: 'rgba(18,21,34,.98)', border: '1px solid rgba(145,167,255,.55)', color: '#eef1ff', fontSize: 10, pointerEvents: 'none', whiteSpace: 'nowrap' }
const buttonRow: import('react').CSSProperties = { display: 'flex', gap: 6, marginTop: 7 }
const secondaryButton: import('react').CSSProperties = { flex: 1, color: '#d8ddf7', background: 'rgba(124,150,255,.1)', border: '1px solid rgba(145,167,255,.35)', borderRadius: 7, padding: '5px 8px', cursor: 'pointer', fontSize: 11 }
const dangerButton: import('react').CSSProperties = { ...secondaryButton, color: '#ffd0c8', background: 'rgba(180,42,42,.22)', borderColor: 'rgba(255,100,80,.58)' }
const dangerLink: import('react').CSSProperties = { marginTop: 7, color: '#e9a095', background: 'transparent', border: 0, padding: 0, cursor: 'pointer', fontSize: 10, textDecoration: 'underline', textUnderlineOffset: 2 }
const confirmBox: import('react').CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8, padding: 8, borderRadius: 8, color: '#ffd0c8', background: 'rgba(128,24,24,.24)', border: '1px solid rgba(255,120,90,.48)' }
