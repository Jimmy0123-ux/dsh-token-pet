/** Small stale-while-revalidate cache with a single shared refresh flight. */
export class StaleWhileRevalidate<T> {
  private value: T | undefined
  private refreshedAt = 0
  private inFlight: Promise<T> | undefined

  constructor(
    private readonly loader: () => Promise<T>,
    private readonly ttlMs = 60_000,
    private readonly clock: () => number = Date.now,
  ) {}

  peek(): T | undefined { return this.value }

  /** Start one refresh when missing/stale while exposing the last usable value. */
  inspect(): { value: T | undefined; refreshing: boolean; refresh?: Promise<T> } {
    const stale = this.value === undefined || this.clock() - this.refreshedAt > this.ttlMs
    if (!stale) return { value: this.value, refreshing: false }
    return { value: this.value, refreshing: true, refresh: this.refresh() }
  }

  /** Force a refresh; concurrent callers still share the same loader flight. */
  refresh(): Promise<T> {
    if (this.inFlight) return this.inFlight
    const flight = this.loader().then((value) => {
      this.value = value
      this.refreshedAt = this.clock()
      return value
    }).finally(() => {
      if (this.inFlight === flight) this.inFlight = undefined
    })
    this.inFlight = flight
    return flight
  }

  /** Keep the prior snapshot usable, but require the next inspection to refresh it. */
  invalidate(): void { this.refreshedAt = 0 }
}
