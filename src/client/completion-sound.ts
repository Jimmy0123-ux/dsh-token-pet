/** A short local chime. No remote audio, permissions prompt, or autoplay backlog. */
export type SoundTheme = 'chime' | 'pop' | 'soft'
export interface SoundConfig { theme: SoundTheme; volume: number }

/** [frequency, start offset seconds] pairs per theme; gains stay very low. */
const SOUND_THEMES: Record<SoundTheme, ReadonlyArray<readonly [number, number]>> = {
  chime: [[660, 0], [880, 0.12]],
  pop: [[523, 0], [784, 0.09]],
  soft: [[392, 0], [523, 0.16]],
}
const DEFAULT_PEAK_GAIN = 0.055

export function createCompletionSoundPlayer(createContext: () => AudioContext | undefined) {
  let context: AudioContext | undefined
  let generation = 0
  let theme: SoundTheme = 'chime'
  let volume = 1
  const voices = new Set<{ oscillator: OscillatorNode; gain: GainNode }>()
  const stop = () => {
    generation++
    for (const voice of voices) {
      try { voice.oscillator.stop() } catch { /* already ended */ }
      voice.oscillator.disconnect(); voice.gain.disconnect()
    }
    voices.clear()
  }
  const prepare = async (): Promise<boolean> => {
    try {
      if (!context || context.state === 'closed') context = createContext()
      const current = context
      if (!current) return false
      const requested = generation
      if (current.state !== 'running') await current.resume()
      return context === current && requested === generation && current.state === 'running'
    } catch { return false }
  }
  const play = (): boolean => {
    // Notification delivery must not resume suspended audio. Unlocking belongs
    // to an explicit user gesture, and blocked notifications are simply dropped.
    if (!context || context.state !== 'running') return false
    stop()
    const start = context.currentTime + 0.01
    const peak = DEFAULT_PEAK_GAIN * Math.min(1, Math.max(0, volume))
    try {
      for (const [frequency, offset] of SOUND_THEMES[theme]) {
        const oscillator = context.createOscillator()
        const gain = context.createGain()
        const voice = { oscillator, gain }
        voices.add(voice)
        oscillator.type = theme === 'soft' ? 'triangle' : 'sine'
        oscillator.frequency.setValueAtTime(frequency, start + offset)
        gain.gain.setValueAtTime(0, start + offset)
        gain.gain.linearRampToValueAtTime(peak, start + offset + 0.015)
        gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.23)
        oscillator.connect(gain); gain.connect(context.destination)
        oscillator.onended = () => {
          oscillator.disconnect(); gain.disconnect(); voices.delete(voice)
        }
        oscillator.start(start + offset)
        oscillator.stop(start + offset + 0.25)
      }
      return true
    } catch { stop(); return false }
  }
  const preview = async (): Promise<boolean> => {
    const requested = generation
    const ready = await prepare()
    return ready && requested === generation && play()
  }
  const dispose = () => {
    stop()
    const previous = context
    context = undefined
    if (previous && previous.state !== 'closed') void previous.close().catch(() => {})
  }
  const configure = (next: Partial<SoundConfig>) => {
    if (next.theme === 'chime' || next.theme === 'pop' || next.theme === 'soft') theme = next.theme
    if (typeof next.volume === 'number' && Number.isFinite(next.volume)) volume = Math.min(1, Math.max(0, next.volume))
  }
  return { prepare, preview, play, stop, dispose, configure }
}

const player = createCompletionSoundPlayer(() => {
  if (typeof window === 'undefined') return undefined
  const Constructor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  return Constructor ? new Constructor() : undefined
})
/** Call synchronously from a checkbox/pointer/key gesture; does not emit sound. */
export const prepareCompletionSound = () => player.prepare()
/** Only a visible preview button should call this gesture-unlocking playback. */
export const previewCompletionSound = () => player.preview()
export const playCompletionSound = () => player.play()
export const stopCompletionSound = () => player.stop()
export const disposeCompletionSound = () => player.dispose()
/** Apply the persisted theme/volume before the next notification. */
export const configureCompletionSound = (config: Partial<SoundConfig>) => player.configure(config)
