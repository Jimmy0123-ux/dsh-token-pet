import { LIFETIME_CLEAR_CONFIRMATION } from '../lifetime-contract.ts'

export const LIFETIME_LEDGER_CLEAR_WARNING = '此操作会永久清空终身用量账本历史，无法通过“恢复记录”找回。普通清空、恢复和刷新不会影响账本。'

/** The destructive request is isolated from cumulative reset/restore APIs. */
export async function clearLifetimeLedger(fetcher: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await fetcher('/token-pet/usage/lifetime/clear-history', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmation: LIFETIME_CLEAR_CONFIRMATION }),
    })
    return response.ok
  } catch {
    return false
  }
}

/** Refresh only the ledger view after a successful irreversible clear. */
export async function clearLifetimeLedgerAndReload(onReload: () => void, fetcher: typeof fetch = fetch): Promise<boolean> {
  const ok = await clearLifetimeLedger(fetcher)
  if (ok) onReload()
  return ok
}

export { LIFETIME_CLEAR_CONFIRMATION }
