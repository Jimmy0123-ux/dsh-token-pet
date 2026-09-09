import assert from 'node:assert/strict'
import test from 'node:test'
import { createCompletionTracker, latestConversationTurn } from '../src/client/completion.ts'
import { createCompletionSoundPlayer } from '../src/client/completion-sound.ts'
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/client/settings.ts'

const open = (turn, seq) => ({ turn, start: { seq } })
const end = (turn, start, seq, kind = 'completed') => ({ ...open(turn, start), end: { seq, type: 'turn/end', data: { reason: { kind } } } })
const obs = (turn, overrides = {}) => ({ sessionId: 'a', sessionEpoch: 1, ready: true, enabled: true, turn, ...overrides })

test('completion sound is opt-in and corrupt preferences do not enable it', () => {
  assert.equal(DEFAULT_SETTINGS.completionSound, false)
  for (const value of [undefined, null, 'true', 1, {}, []]) assert.equal(normalizeSettings({ completionSound: value }).completionSound, false)
  assert.equal(normalizeSettings({ completionSound: true }).completionSound, true)
})

test('real chat timeline boundary is selected without inventing a running transition', () => {
  const latest = end(2, 12, 20)
  const state = { chat: { timeline: { turnOrder: [1, 2], turns: new Map([[1, end(1, 0, 9)], [2, latest]]) } } }
  assert.equal(latestConversationTurn(state), latest)
  assert.equal(latestConversationTurn({ running: false, turnEnds: new Map([[2, 20]]) }), undefined)
  assert.equal(latestConversationTurn(null), undefined)
})

test('successful observed turn emits once; tool updates and repeated snapshots remain silent', () => {
  const tracker = createCompletionTracker()
  assert.equal(tracker.observe(obs(end(1, 0, 10))), null, 'historical mount is silent')
  assert.equal(tracker.observe(obs(open(2, 11))), null)
  assert.equal(tracker.observe(obs(open(2, 11))), null, 'tool or streaming updates are not completion')
  assert.ok(tracker.observe(obs(end(2, 11, 20))))
  assert.equal(tracker.observe(obs(end(2, 11, 20))), null)
  assert.equal(tracker.observe(obs(end(1, 0, 10))), null, 'history replay stays silent')
  tracker.observe(obs(open(3, 21)))
  assert.ok(tracker.observe(obs(end(3, 21, 30))), 'the next successful reply emits')
})

test('a queued turn starting in the same snapshot does not hide the previous completion', () => {
  const tracker = createCompletionTracker()
  tracker.observe(obs(open(1, 0)))
  const timeline = { turnOrder: [1, 2], turns: new Map([[1, end(1, 0, 10)], [2, open(2, 11)]]) }
  assert.ok(tracker.observe(obs(undefined, { timeline })))
  assert.equal(tracker.observe(obs(undefined, { timeline })), null)
  const completed = { ...timeline, turns: new Map([[1, end(1, 0, 10)], [2, end(2, 11, 20)]]) }
  assert.ok(tracker.observe(obs(undefined, { timeline: completed })))
})

test('error, cancellation, blocked, and truncation boundaries do not emit success chimes', () => {
  for (const kind of ['error', 'interrupted', 'blocked', 'max-tokens', 'unknown']) {
    const tracker = createCompletionTracker()
    tracker.observe(obs(open(1, 0)))
    assert.equal(tracker.observe(obs(end(1, 0, 10, kind))), null, kind)
  }
  const tracker = createCompletionTracker()
  tracker.observe(obs(open(1, 0)))
  assert.equal(tracker.observe(obs({ ...end(1, 0, 10), end: { seq: 10, type: 'tool/result', data: { reason: { kind: 'completed' } } } })), null)
})

test('session switching, hydration, reconnect, and archive never replay old completions', () => {
  const tracker = createCompletionTracker()
  tracker.observe(obs(open(1, 0)))
  assert.equal(tracker.observe(obs(end(1, 0, 10), { sessionId: 'b', sessionEpoch: 2 })), null)
  assert.equal(tracker.observe(obs(end(1, 0, 10), { sessionEpoch: 3 })), null, 'returning to A is another lease')
  tracker.observe(obs(open(2, 11), { sessionEpoch: 3 }))
  tracker.observe(obs(undefined, { sessionEpoch: 3, ready: false }))
  assert.equal(tracker.observe(obs(end(2, 11, 20), { sessionEpoch: 3 })), null)
  tracker.observe(obs(open(3, 21), { sessionEpoch: 3 }))
  assert.equal(tracker.observe(obs(end(3, 21, 30), { sessionEpoch: 3, removed: true })), null)
})

test('muted events are consumed and enabling sound does not replay them', () => {
  const tracker = createCompletionTracker()
  tracker.observe(obs(open(1, 0), { enabled: false }))
  assert.equal(tracker.observe(obs(end(1, 0, 10), { enabled: false })), null)
  assert.equal(tracker.observe(obs(end(1, 0, 10), { enabled: true })), null)
  tracker.observe(obs(open(2, 11), { enabled: false }))
  assert.ok(tracker.observe(obs(end(2, 11, 20), { enabled: true })), 'enabling during a real live reply affects its finish')
})

function fakeContext() {
  const oscillators = [], gains = []
  const context = {
    state: 'suspended', currentTime: 7, destination: {}, resumes: 0, closes: 0,
    async resume() { this.resumes++; this.state = 'running' },
    async close() { this.closes++; this.state = 'closed' },
    createOscillator() {
      const oscillator = { frequency: { setValueAtTime() {} }, connect() {}, disconnects: 0, disconnect() { this.disconnects++ }, stops: [], starts: [], stop(at) { this.stops.push(at) }, start(at) { this.starts.push(at) } }
      oscillators.push(oscillator); return oscillator
    },
    createGain() {
      const gain = { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnects: 0, disconnect() { this.disconnects++ } }
      gains.push(gain); return gain
    },
  }
  return { context, oscillators, gains }
}

test('audio is allocated only on gesture preparation; notification cannot unlock or backlog', async () => {
  const f = fakeContext()
  let allocations = 0
  const player = createCompletionSoundPlayer(() => { allocations++; return f.context })
  assert.equal(player.play(), false)
  assert.equal(allocations, 0)
  assert.equal(await player.prepare(), true)
  assert.equal(f.oscillators.length, 0, 'enabling is silent')
  assert.equal(allocations, 1)
  assert.equal(player.play(), true)
  assert.equal(f.oscillators.length, 2)
  f.context.state = 'suspended'
  assert.equal(player.play(), false)
  assert.equal(f.context.resumes, 1, 'notification never resumes audio itself')
  assert.equal(await player.prepare(), true)
  assert.equal(f.oscillators.length, 2, 'unlock does not play a previously blocked notification')
  player.dispose()
})

test('mute and disposal stop scheduled notes and disconnect resources', async () => {
  const f = fakeContext(), player = createCompletionSoundPlayer(() => f.context)
  await player.prepare(); player.play()
  player.stop()
  assert.ok(f.oscillators.every(o => o.stops.includes(undefined) && o.disconnects > 0))
  assert.ok(f.gains.every(g => g.disconnects > 0))
  player.dispose()
  assert.equal(f.context.closes, 1)
  assert.equal(player.play(), false)
})

test('stop cancels preview even when its already-running prepare promise has resolved', async () => {
  const f = fakeContext(), player = createCompletionSoundPlayer(() => f.context)
  await player.prepare()
  const preview = player.preview()
  player.stop()
  assert.equal(await preview, false)
  assert.equal(f.oscillators.length, 0, 'no deferred notes start after mute')
  assert.equal(await player.preview(), true, 'a new explicit preview still works')
  player.dispose()
})

test('missing or denied audio fails softly; a disposed pending unlock cannot play', async () => {
  const missing = createCompletionSoundPlayer(() => undefined)
  assert.equal(await missing.prepare(), false)
  assert.equal(missing.play(), false)
  const denied = createCompletionSoundPlayer(() => { throw new Error('unavailable') })
  assert.equal(await denied.prepare(), false)
  const f = fakeContext()
  let release
  f.context.resume = () => new Promise(resolve => { release = resolve })
  const player = createCompletionSoundPlayer(() => f.context)
  const pending = player.prepare()
  player.dispose()
  release()
  assert.equal(await pending, false)
  assert.equal(player.play(), false)
})
