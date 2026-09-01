/** Shared host/client contract for the irreversible Lifetime Ledger action. */
export const LIFETIME_CLEAR_CONFIRMATION = 'CLEAR LIFETIME LEDGER'

export interface LifetimeLedgerMetadata {
  /** ISO timestamp of the most recent irreversible clear, when one exists. */
  clearedAt?: string
}
