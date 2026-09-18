/**
 * Client-side export helpers for usage data. Everything is statistics-only:
 * the exported payload is the same snapshot data the panel renders, never
 * session transcripts or prompts. Works in any browser context without host
 * changes; failures degrade to the fields that succeeded.
 * @module dsh-token-pet/export-data
 */

export interface ExportPayload {
  exportedAt: string
  app: string
  ledger: unknown
  trend: unknown
  sessions: unknown
  failures: string[]
}

const PANEL_EXPORT_TIMEOUT_MS = 10_000

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PANEL_EXPORT_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`${url}: ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

/** Collect the current snapshot payload; per-field failures are tolerated. */
export async function collectExportPayload(): Promise<ExportPayload> {
  const failures: string[] = []
  const [ledger, trend, sessions] = await Promise.all([
    fetchJson('/token-pet/usage/lifetime').catch(() => { failures.push('lifetime'); return null }),
    fetchJson('/token-pet/usage/trend').catch(() => { failures.push('trend'); return null }),
    fetchJson('/token-pet/usage/sessions?limit=200').catch(() => { failures.push('sessions'); return null }),
  ])
  return {
    exportedAt: new Date().toISOString(),
    app: 'dsh-token-pet',
    ledger,
    trend,
    sessions,
    failures,
  }
}

export interface LedgerCsvRow {
  provider: string
  model: string
  day: string
  uncachedInputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
  total: number
}

function asRow(value: unknown): LedgerCsvRow | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const totals = (v.totals && typeof v.totals === 'object' ? v.totals : {}) as Record<string, unknown>
  if (typeof v.model !== 'string' || typeof v.day !== 'string') return null
  const num = (x: unknown) => typeof x === 'number' && Number.isFinite(x) ? x : 0
  return {
    provider: typeof v.provider === 'string' ? v.provider : '',
    model: v.model,
    day: v.day,
    uncachedInputTokens: num(totals.uncachedInputTokens),
    cacheReadTokens: num(totals.cacheReadTokens),
    cacheWriteTokens: num(totals.cacheWriteTokens),
    outputTokens: num(totals.outputTokens),
    total: num(v.total),
  }
}

function csvEscape(value: string | number): string {
  const text = String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** Build a CSV of the ledger's model/day cells (statistics only). */
export function ledgerCsv(payload: ExportPayload): string {
  const ledger = (payload.ledger && typeof payload.ledger === 'object' ? payload.ledger : {}) as Record<string, unknown>
  const cells = Array.isArray(ledger.byModelDay) ? ledger.byModelDay.map(asRow).filter((row): row is LedgerCsvRow => row !== null) : []
  const header = ['provider', 'model', 'day', 'uncachedInputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens', 'total']
  const lines = [header.join(',')]
  for (const row of cells) lines.push(header.map((key) => csvEscape(row[key as keyof LedgerCsvRow])).join(','))
  return lines.join('\n')
}

function downloadBlob(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }
}

export function exportDateStamp(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Download the full JSON snapshot. */
export async function exportLedgerJson(): Promise<void> {
  const payload = await collectExportPayload()
  downloadBlob(`dsh-token-pet-export-${exportDateStamp()}.json`, JSON.stringify(payload, null, 2), 'application/json')
}

/** Download the model/day CSV. */
export async function exportLedgerCsv(): Promise<void> {
  const payload = await collectExportPayload()
  downloadBlob(`dsh-token-pet-cells-${exportDateStamp()}.csv`, ledgerCsv(payload), 'text/csv;charset=utf-8')
}
