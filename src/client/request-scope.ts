/** One endpoint request is allowed per visible refresh generation. */
export function shouldStartPanelRequest(enabled: boolean, settledKey: number | null, requestedKey: number): boolean {
  return enabled && settledKey !== requestedKey
}

/** Owns abortable fetches, deadlines and delayed work for one request effect. */
export function createPanelRequestScope(timeoutMs = 0) {
  const controller = new AbortController()
  const timers = new Set<ReturnType<typeof setTimeout>>()
  let timedOut = false
  const addTimer = (task: () => void, delayMs: number) => {
    const timer = setTimeout(() => {
      timers.delete(timer)
      if (!controller.signal.aborted) task()
    }, delayMs)
    timers.add(timer)
  }
  if (timeoutMs > 0) addTimer(() => { timedOut = true; controller.abort('timeout') }, timeoutMs)
  return {
    signal: controller.signal,
    schedule(task: () => void, delayMs: number): void { addTimer(task, delayMs) },
    dispose(): void {
      controller.abort('disposed')
      for (const timer of timers) clearTimeout(timer)
      timers.clear()
    },
    pendingTimers(): number { return timers.size },
    timedOut(): boolean { return timedOut },
  }
}

export const PANEL_REQUEST_TIMEOUT_MS = 10_000
