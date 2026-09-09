/** A short local chime. No remote audio, permissions prompt, or autoplay backlog. */
export function createCompletionSoundPlayer(createContext: () => AudioContext | undefined) {
  let context: AudioContext | undefined
  let generation = 0
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
    try {
      for (const [frequency, offset] of [[660, 0], [880, 0.12]] as const) {
        const oscillator = context.createOscillator()
        const gain = context.createGain()
        const voice = { oscillator, gain }
        voices.add(voice)
        oscillator.type = 'sine'
        oscillator.frequency.setValueAtTime(frequency, start + offset)
        gain.gain.setValueAtTime(0, start + offset)
        gain.gain.linearRampToValueAtTime(0.055, start + offset + 0.015)
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
  return { prepare, preview, play, stop, dispose }
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
