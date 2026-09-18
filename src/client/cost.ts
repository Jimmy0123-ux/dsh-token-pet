/**
 * Cost estimation for the token pet (pure, dependency-free client module).
 *
 * The plugin only ever sees token counts; converting them into money requires
 * a price table. We ship a small editable default table (USD per 1M tokens),
 * keyed by model name or by trailing-`*` prefix (e.g. `claude-*`), with `*`
 * as the universal fallback. All estimates are explicitly "估算" in the UI;
 * the user can replace the whole table in Settings.
 *
 * No model prices are fetched from the network: the table is local, editable
 * and versioned inside the settings document.
 * @module dsh-token-pet/cost
 */

export interface CostTotals {
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/** One (model, day) cell shape compatible with the ledger's byModelDay rows. */
export interface CostCell {
  provider: string
  model: string
  day: string
  totals: CostTotals
  total: number
}

/** Per-1M-token rates in USD. Missing keys price at 0. */
export interface PriceEntry {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export type PriceTable = Record<string, PriceEntry>

export type CostCurrency = 'USD' | 'CNY'

/** Approximate public list prices (USD per 1M tokens). User-editable. */
export const DEFAULT_PRICES: PriceTable = {
  'deepseek-chat': { input: 0.27, cacheRead: 0.07, cacheWrite: 0.27, output: 1.1 },
  'deepseek-reasoner': { input: 0.55, cacheRead: 0.14, cacheWrite: 0.55, output: 2.19 },
  'gpt-4o': { input: 2.5, cacheRead: 1.25, cacheWrite: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, cacheRead: 0.075, cacheWrite: 0.15, output: 0.6 },
  'gpt-4.1': { input: 2, cacheRead: 0.5, cacheWrite: 2, output: 8 },
  'o3*': { input: 2, cacheRead: 0.5, cacheWrite: 2, output: 8 },
  'claude-*': { input: 3, cacheRead: 0.3, cacheWrite: 3.75, output: 15 },
  'glm-*': { input: 0.5, cacheRead: 0.5, cacheWrite: 0.5, output: 2 },
  'qwen-*': { input: 0.4, cacheRead: 0.4, cacheWrite: 0.4, output: 1.2 },
  'kimi-*': { input: 0.6, cacheRead: 0.6, cacheWrite: 0.6, output: 2 },
  '*': { input: 1, cacheRead: 0.5, cacheWrite: 1, output: 3 },
}

export const FALLBACK_PRICE: PriceEntry = { input: 1, cacheRead: 0.5, cacheWrite: 1, output: 3 }

export const DEFAULT_PRICE_TABLE_JSON = JSON.stringify(DEFAULT_PRICES, null, 2)

/** CNY per USD used only for display conversion when the currency is CNY. */
export const DEFAULT_CNY_RATE = 7.2

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function parseEntry(value: unknown): PriceEntry | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const input = isNonNegativeNumber(v.input) ? v.input : 0
  const output = isNonNegativeNumber(v.output) ? v.output : 0
  const cacheRead = isNonNegativeNumber(v.cacheRead) ? v.cacheRead : 0
  const cacheWrite = isNonNegativeNumber(v.cacheWrite) ? v.cacheWrite : 0
  if (input === 0 && output === 0 && cacheRead === 0 && cacheWrite === 0) return null
  return { input, output, cacheRead, cacheWrite }
}

/**
 * Parse a user-supplied JSON price table. Invalid documents return null and
 * callers fall back to DEFAULT_PRICES; entries with zero rates are dropped.
 */
export function parsePriceTable(json: string): PriceTable | null {
  let parsed: unknown
  try { parsed = JSON.parse(json) } catch { return null }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const out: PriceTable = {}
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (key === '') continue
    const entry = parseEntry(value)
    if (entry) out[key] = entry
  }
  return Object.keys(out).length > 0 ? out : null
}

/**
 * Resolve a model to its price entry: exact key, then longest `*`-suffixed
 * prefix, then the `*` fallback.
 */
export function resolvePrice(table: PriceTable, model: string): PriceEntry {
  const direct = table[model]
  if (direct) return direct
  const prefixes = Object.keys(table)
    .filter((key) => key.endsWith('*') && key.length > 1)
    .sort((a, b) => b.length - a.length)
  for (const key of prefixes) {
    if (model.startsWith(key.slice(0, -1))) return table[key] as PriceEntry
  }
  return table['*'] ?? FALLBACK_PRICE
}

/** USD cost of one token-usage snapshot under a price entry. */
export function costOfTotals(totals: CostTotals, price: PriceEntry): number {
  return (
    (totals.uncachedInputTokens / 1_000_000) * price.input +
    (totals.outputTokens / 1_000_000) * price.output +
    (totals.cacheReadTokens / 1_000_000) * price.cacheRead +
    (totals.cacheWriteTokens / 1_000_000) * price.cacheWrite
  )
}

/** USD cost of a cell row under a table. */
export function costOfCell(cell: CostCell, table: PriceTable): number {
  return costOfTotals(cell.totals, resolvePrice(table, cell.model))
}

/** Skip structurally incomplete cells defensively (host/fixture tolerance). */
function isUsableCell(cell: CostCell): boolean {
  return typeof cell?.model === 'string' && cell.model !== '' && typeof cell?.day === 'string' && cell.day !== ''
}

export interface MonthKey { year: number; month: number; prefix: string }

/** Local-time month prefix ("YYYY-MM") matching the ledger's day strings. */
export function monthKeyOf(now = Date.now()): MonthKey {
  const d = new Date(now)
  const year = d.getFullYear()
  const month = d.getMonth() + 1
  return { year, month, prefix: `${year}-${String(month).padStart(2, '0')}` }
}

/** USD cost of every cell whose day falls in the current local month. */
export function monthlyCostOfCells(cells: readonly CostCell[], table: PriceTable, now = Date.now()): number {
  const prefix = monthKeyOf(now).prefix
  let total = 0
  for (const cell of cells) if (isUsableCell(cell) && cell.day.startsWith(prefix)) total += costOfCell(cell, table)
  return total
}

/** Per-(provider, model) accumulated token totals and estimated cost. */
export interface ModelCostRow {
  provider: string
  model: string
  total: number
  cost: number
}

/** Roll cells into per-model rows with estimated cost, descending total. */
export function costPerModel(cells: readonly CostCell[], table: PriceTable): ModelCostRow[] {
  const map = new Map<string, ModelCostRow>()
  for (const cell of cells) {
    if (!isUsableCell(cell)) continue
    const key = `${cell.provider}\u0000${cell.model}`
    const row = map.get(key) ?? { provider: cell.provider, model: cell.model, total: 0, cost: 0 }
    row.total += cell.total
    row.cost += costOfCell(cell, table)
    map.set(key, row)
  }
  return [...map.values()].sort((a, b) => b.total - a.total)
}

/** Per-day totals from ledger cells (only days with usage), newest first. */
export function dayTotalsOfCells(cells: readonly CostCell[]): Array<{ day: string; total: number; cells: number }> {
  const map = new Map<string, { day: string; total: number; cells: number }>()
  for (const cell of cells) {
    if (!isUsableCell(cell)) continue
    const row = map.get(cell.day) ?? { day: cell.day, total: 0, cells: 0 }
    row.total += cell.total
    row.cells += 1
    map.set(cell.day, row)
  }
  return [...map.values()].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))
}

/** Format an estimated cost for display (USD or CNY). */
export function formatCost(usd: number, currency: CostCurrency = 'USD', cnyRate = DEFAULT_CNY_RATE): string {
  if (!Number.isFinite(usd) || usd < 0) return '—'
  if (currency === 'CNY') return `¥${(usd * cnyRate).toFixed(2)}`
  return `$${usd.toFixed(2)}`
}

export function isCostCurrency(value: unknown): value is CostCurrency {
  return value === 'USD' || value === 'CNY'
}

// ---- Visual price editor draft helpers (pure, UI-agnostic) ----

/** One editable price row in the Settings price editor. Values are strings so
 * the input fields never fight the user mid-typing; validation happens on save. */
export interface PriceDraftRow {
  id: string
  /** Model name or `*`-suffixed prefix (e.g. "deepseek-chat", "claude-*"). */
  key: string
  input: string
  cacheRead: string
  cacheWrite: string
  output: string
}

function numberString(n: number): string {
  return Number.isFinite(n) ? String(n) : '0'
}

/** Turn a persisted price-table JSON into editable rows (newest order kept). */
export function priceRowsFromJson(json: string): PriceDraftRow[] {
  const table = parsePriceTable(json) ?? DEFAULT_PRICES
  return Object.entries(table).map(([key, entry], index) => ({
    id: `${index}-${key}`,
    key,
    input: numberString(entry.input),
    cacheRead: numberString(entry.cacheRead),
    cacheWrite: numberString(entry.cacheWrite),
    output: numberString(entry.output),
  }))
}

function isNonNegativeString(value: string): boolean {
  return value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0
}
/** Export for UI input validation (used by the price editor to flag bad rows). */
export { isNonNegativeString }

/** Validate rows: a row is valid when its key is non-empty and all four rates
 * are non-negative numbers. Returns the buildable table and the invalid rows. */
export function tableFromDraftRows(rows: readonly PriceDraftRow[]): { table: PriceTable; invalid: PriceDraftRow[] } {
  const table: PriceTable = {}
  const invalid: PriceDraftRow[] = []
  for (const row of rows) {
    const key = row.key.trim()
    // A bare `*` is the universal fallback; otherwise an alphanumeric start
    // with letters/digits/._- and an optional trailing `*` prefix wildcard.
    const validKey = key === '*' || /^[a-z0-9][a-z0-9._-]*\*?$/i.test(key)
    if (!validKey || !isNonNegativeString(row.input) || !isNonNegativeString(row.output) ||
      !isNonNegativeString(row.cacheRead) || !isNonNegativeString(row.cacheWrite)) {
      invalid.push(row)
      continue
    }
    table[key] = {
      input: Number(row.input),
      output: Number(row.output),
      cacheRead: Number(row.cacheRead),
      cacheWrite: Number(row.cacheWrite),
    }
  }
  return { table, invalid }
}

/** Serialize valid draft rows back to the persisted JSON form (stable key order). */
export function draftRowsToJson(rows: readonly PriceDraftRow[]): { json: string | null; invalid: PriceDraftRow[] } {
  const { table, invalid } = tableFromDraftRows(rows)
  if (Object.keys(table).length === 0) return { json: null, invalid: rows as PriceDraftRow[] }
  return { json: JSON.stringify(table, null, 2), invalid }
}
