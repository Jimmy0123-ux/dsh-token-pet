import { LIFETIME_CLEAR_CONFIRMATION } from '../lifetime-contract.ts'

import type { Language } from './i18n.ts'
import { maintenanceText } from './maintenance-messages.ts'

export function lifetimeLedgerClearWarning(language: Language = 'zh'): string {
  return maintenanceText(language, 'lifetimeClearWarning')
}
/** Legacy Chinese text retained; the request confirmation remains a machine token. */
export const LIFETIME_LEDGER_CLEAR_WARNING = lifetimeLedgerClearWarning('zh')

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
