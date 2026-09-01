/**
 * Persistent baseline store for the pet's cumulative usage "清空/恢复".
 *
 * "清空" does not delete the underlying session data — it records a per
 * (model, day) offset so the displayed cumulative drops to zero, and pushes the
 * previous offsets onto an undo stack. "恢复" pops the stack and restores the
 * prior offsets, bringing the numbers back. This makes the operation fully
 * reversible and safe, and it survives restarts because it's a JSON file under
 * the harness data dir.
 * @module dsh-token-pet/baseline
 */

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export interface BaselineOffsets {
  /** Per "provider\0model\0day" key → token offset subtracted from raw totals. */
  offsets: Record<string, number>
}

export interface BaselineState {
  /** The active offsets applied to displayed cumulative. */
  active: Record<string, number>
  /** Undo stack: each entry restores the PREVIOUS `active` (for 恢复). */
  history: Record<string, number>[]
}

const EMPTY: BaselineState = { active: {}, history: [] }

/** The service surface for reading/writing the persistent baseline file. */
export interface BaselineService {
  read(): Promise<BaselineState>
  /** 清空: set active offsets to the current raw totals (zero the display). */
  reset(rawOffsets: Record<string, number>): Promise<BaselineState>
  /** 恢复: pop the last undo entry, reverting the previous offsets. */
  restore(): Promise<BaselineState>
  /** Current applied offsets. */
  current(): Promise<Record<string, number>>
  /** Irreversibly discard ordinary reset/restore state. */
  clearHistory(): Promise<BaselineState>
}

export class FileBaselineStore implements BaselineService {
  private file: string

  constructor(baseDir: string) {
    this.file = join(baseDir, 'baseline.json')
  }

  async read(): Promise<BaselineState> {
    try {
      const raw = await readFile(this.file, 'utf8')
      const parsed = JSON.parse(raw) as Partial<BaselineState>
      return {
        active: parsed.active ?? {},
        history: Array.isArray(parsed.history) ? parsed.history : [],
      }
    } catch {
      return { ...EMPTY, active: {}, history: [] }
    }
  }

  async current(): Promise<Record<string, number>> {
    return (await this.read()).active
  }

  async reset(rawOffsets: Record<string, number>): Promise<BaselineState> {
    const state = await this.read()
    const next: BaselineState = {
      active: { ...rawOffsets },
      history: [...state.history, state.active],
    }
    await this.write(next)
    return next
  }

  async restore(): Promise<BaselineState> {
    const state = await this.read()
    if (state.history.length === 0) return state
    const prev = state.history[state.history.length - 1]
    const next: BaselineState = {
      active: { ...prev },
      history: state.history.slice(0, -1),
    }
    await this.write(next)
    return next
  }

  async clearHistory(): Promise<BaselineState> {
    const next: BaselineState = { active: {}, history: [] }
    await this.write(next)
    return next
  }

  private async write(state: BaselineState): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
    try { await writeFile(tmp, JSON.stringify(state), 'utf8'); await rename(tmp, this.file) } finally { await unlink(tmp).catch(() => {}) }
  }
}

/** Resolve the same Harness home used by DSH itself. A missing/blank
 * DSH_HOME means the conventional `~/.dsh`, not the OS home directory.
 * Keeping this in the host half avoids silently splitting plugin state across
 * `<home>/data` and the real Harness data root. */
export function resolveDshHome(environment: NodeJS.ProcessEnv = process.env): string {
  const configured = environment.DSH_HOME?.trim()
  return configured || join(homedir(), '.dsh')
}

export function baselineDir(home: string): string {
  return join(home, 'data', 'dsh-token-pet')
}
