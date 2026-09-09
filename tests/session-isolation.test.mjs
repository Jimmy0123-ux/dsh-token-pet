import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as prompt from '../src/client/prompt.ts'
import * as store from '../src/client/store.ts'
import * as settingsModule from '../src/client/settings.ts'
import * as i18n from '../src/client/i18n.ts'
import * as promptMessages from '../src/client/prompt-messages.ts'
import * as completion from '../src/client/completion.ts'
import { createComposerPromptBridge } from '../src/client/prompt.ts'

test('composer bridge checks admission again in its submit microtask', async () => {
  let active = true
  const calls = []
  const bridge = createComposerPromptBridge({ setDraft: (s) => calls.push(s), submit: () => calls.push('submit') }, () => active)
  const pending = bridge.send('A')
  active = false
  await assert.rejects(pending, /会话/)
  assert.deepEqual(calls, ['A'])
})

// Execute the real TS component bodies with a tiny deterministic hook host.
// Unlike source regex, this exercises dependency cleanup ordering and deferred work.
function componentHost(file, exportName) {
  let cursor = 0
  const slots = []
  let pending = []
  let writes = 0
  const react = {
    Component: class {},
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial } },
    useState(initial) {
      const i = cursor++
      slots[i] ??= { value: typeof initial === 'function' ? initial() : initial }
      return [slots[i].value, (value) => { writes++; slots[i].value = typeof value === 'function' ? value(slots[i].value) : value }]
    },
    useMemo(make, deps) {
      const i = cursor++
      if (!slots[i] || deps.some((d, n) => !Object.is(d, slots[i].deps[n]))) slots[i] = { value: make(), deps }
      return slots[i].value
    },
    useEffect(effect, deps) {
      const i = cursor++
      if (!slots[i] || deps.some((d, n) => !Object.is(d, slots[i].deps[n]))) {
        const old = slots[i]
        slots[i] = { deps, cleanup: old?.cleanup }
        pending.push(() => { old?.cleanup?.(); slots[i].cleanup = effect() })
      }
    },
  }
  react.useLayoutEffect = react.useEffect
  react.useCallback = (fn, deps) => react.useMemo(() => fn, deps)
  const source = readFileSync(new URL(`../src/client/${file}`, import.meta.url), 'utf8') + `\nexport { ${exportName} as TestedComponent }`
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  const settings = { ...settingsModule, loadSettings: () => ({ ...settingsModule.DEFAULT_SETTINGS, enhancementEnabled: true }), saveSettings() {} }
  const empty = new Proxy({}, { get: (_, key) => key === 'FLOATING_LAYER' ? {} : () => {} })
  const modules = {
    react, './store.ts': store, './prompt.ts': prompt, './settings.ts': settings,
    './settings-hook.ts': { useSettings: settings.loadSettings, useLanguage: () => 'zh' },
    './i18n.ts': i18n, './prompt-messages.ts': promptMessages, './completion.ts': completion,
  }
  const require = (name) => modules[name] ?? empty
  new Function('require', 'module', 'exports', 'window', js)(require, module, module.exports, { addEventListener() {}, removeEventListener() {} })
  return {
    render(props) { cursor = 0; const tree = module.exports.TestedComponent(props); const effects = pending; pending = []; effects.forEach((run) => run()); return tree },
    unmount() { slots.forEach((slot) => slot?.cleanup?.()) },
    get writes() { return writes },
  }
}

function button(tree, key) {
  if (!tree || typeof tree !== 'object') return undefined
  if (tree.props?.key === key) return tree
  for (const child of (Array.isArray(tree) ? tree : tree.children ?? [])) {
    const found = button(child, key)
    if (found) return found
  }
}

function observe() {
  let snapshot
  const dispose = store.subscribeProjections((next) => { snapshot = next })
  return { get snapshot() { return snapshot }, dispose }
}

test('real dock component selects host sessionId, updates, switches and unmounts safely', async () => {
  const seen = observe()
  const host = componentHost('index.ts', 'SessionProjectionFeed')
  const calls = []
  const actions = { setDraft: (s) => calls.push(s), submit: () => calls.push('submit') }
  let sessionId = 'A'
  let draft = 'draft A'
  const kit = { useSession: (select) => select({ sessionId, running: false }), useInput: (select) => select({ draft }), inputActions: actions }
  host.render(kit)
  assert.equal(seen.snapshot.sessionId, 'A')
  const oldSend = seen.snapshot.sendPrompt
  const epoch = seen.snapshot.sessionEpoch
  draft = 'edited A'
  host.render(kit)
  assert.equal(seen.snapshot.sessionEpoch, epoch)
  assert.equal(seen.snapshot.draft, draft)
  sessionId = 'B'; draft = 'draft B'
  host.render(kit)
  assert.equal(seen.snapshot.sessionId, 'B')
  await assert.rejects(async () => oldSend('late A'), /会话/)
  assert.deepEqual(calls, [])
  host.unmount()
  assert.equal(seen.snapshot, null)
  seen.dispose()
})

test('new dock mounting before old dock cleanup retains its snapshot and actions', async () => {
  const seen = observe()
  const old = componentHost('index.ts', 'SessionProjectionFeed')
  const next = componentHost('index.ts', 'SessionProjectionFeed')
  const calls = []
  const kit = (sessionId) => ({ useSession: (select) => select({ sessionId }), useInput: (select) => select({ draft: sessionId }), inputActions: { setDraft: (s) => calls.push([sessionId, s]), submit: () => calls.push([sessionId, 'submit']) } })
  old.render(kit('A'))
  next.render(kit('B'))
  old.unmount()
  assert.equal(seen.snapshot.sessionId, 'B')
  await seen.snapshot.sendPrompt('B enhanced')
  assert.deepEqual(calls, [['B', 'B enhanced'], ['B', 'submit']])
  next.unmount(); seen.dispose()
})

test('revoked bridge errors are handled while old panel awaits its unmount', async () => {
  const host = componentHost('prompt-panel.tsx', 'PromptEnhancerPanel')
  const a = store.createProjectionFeed('A')
  const bridge = createComposerPromptBridge({ setDraft() { assert.fail('stale write') }, submit() { assert.fail('stale submit') } }, a.isCurrent)
  const props = { initial: 'A', adapter: { enhance: async () => ({ original: 'A', enhanced: 'enhanced A' }) }, onApply: bridge.apply, onSend: bridge.send }
  await button(host.render(props), 'enhance').props.onClick()
  const ready = host.render(props)
  a.dispose()
  assert.doesNotThrow(() => button(ready, 'replace').props.onClick())
  assert.doesNotThrow(() => button(ready, 'revert').props.onClick())
  assert.doesNotThrow(() => button(ready, 'input').props.onChange({ target: { value: 'late edit' } }))
  button(ready, 'send').props.onClick()
  await Promise.resolve()
  const failed = host.render(props)
  assert.match(button(failed, 'error').children.join(''), /会话/)
  host.unmount()
})

test('edited enhanced text remains independent and is used for regeneration', async () => {
  const host = componentHost('prompt-panel.tsx', 'PromptEnhancerPanel')
  const requests = []
  const props = {
    initial: 'original',
    adapter: { enhance: async (request) => { requests.push(request.prompt); return { original: request.prompt, enhanced: `enhanced ${requests.length}` } } },
  }
  await button(host.render(props), 'enhance').props.onClick()
  let tree = host.render(props)
  button(tree, 'preview').props.onChange({ target: { value: 'edited enhanced text' } })
  tree = host.render(props)
  await button(tree, 'regenerate').props.onClick()
  assert.deepEqual(requests, ['original', 'edited enhanced text'])
  assert.equal(button(host.render(props), 'input').props.value, 'original')
})

test('enhancement completion after panel unmount cannot publish state or ready events', async () => {
  const host = componentHost('prompt-panel.tsx', 'PromptEnhancerPanel')
  let resolve
  const events = []
  const adapter = { enhance: () => new Promise((done) => { resolve = done }) }
  const props = { initial: 'A', adapter, onAction: (action) => events.push(action) }
  const tree = host.render(props)
  const pending = button(tree, 'enhance').props.onClick()
  host.unmount()
  const writes = host.writes
  resolve({ original: 'A', enhanced: 'enhanced A' })
  await pending
  assert.equal(host.writes, writes)
  assert.deepEqual(events, ['prompt-enhancing'])
})

test('old rendered send and apply handlers do nothing after panel unmount', async () => {
  const host = componentHost('prompt-panel.tsx', 'PromptEnhancerPanel')
  const calls = []
  const props = { initial: 'A', adapter: { enhance: async () => ({ original: 'A', enhanced: 'enhanced A' }) }, onSend: (s) => calls.push(s), onApply: (s) => calls.push(s) }
  await button(host.render(props), 'enhance').props.onClick()
  const ready = host.render(props)
  host.unmount()
  button(ready, 'send').props.onClick()
  button(ready, 'replace').props.onClick()
  await Promise.resolve()
  assert.deepEqual(calls, [])
})

// Host contract: useSession selects a snapshot whose identity is sessionId;
// inputActions belongs to that binding's composer, not a global send endpoint.
test('unmount clears draft/actions; a late old cleanup cannot clear the new feed', () => {
  const seen = observe()
  const a = store.createProjectionFeed('A')
  a.publish({ draft: 'private A' })
  const oldEpoch = seen.snapshot.sessionEpoch
  const b = store.createProjectionFeed('B')
  b.publish({ draft: 'private B' })
  a.dispose()
  a.publish({ draft: 'late A' })
  assert.equal(seen.snapshot.sessionId, 'B')
  assert.equal(seen.snapshot.draft, 'private B')
  assert.notEqual(seen.snapshot.sessionEpoch, oldEpoch)
  b.dispose()
  assert.equal(seen.snapshot, null)
  seen.dispose()
})

test('saved buttons stay revoked even after returning to the same session', async () => {
  const seen = observe()
  const calls = []
  const a = store.createProjectionFeed('A')
  const bridge = createComposerPromptBridge({ setDraft: (s) => calls.push(s), submit: () => calls.push('submit') }, a.isCurrent)
  a.publish({ draft: 'A', applyPrompt: bridge.apply, sendPrompt: bridge.send })
  const oldButton = seen.snapshot.sendPrompt
  const b = store.createProjectionFeed('B')
  b.publish({ draft: 'B' })
  const nextA = store.createProjectionFeed('A')
  nextA.publish({ draft: 'new A' })
  assert.throws(() => bridge.apply('stale edit'), /会话/)
  await assert.rejects(async () => oldButton('stale enhancement'), /会话/)
  assert.deepEqual(calls, [])
  a.dispose(); b.dispose(); nextA.dispose(); seen.dispose()
})

test('switch between setDraft and queued submit rejects without submitting', async () => {
  const calls = []
  const a = store.createProjectionFeed('A')
  const bridge = createComposerPromptBridge({ setDraft: (s) => calls.push(s), submit: () => calls.push('submit') }, a.isCurrent)
  a.publish({})
  const pending = bridge.send('enhanced A')
  const b = store.createProjectionFeed('B')
  b.publish({ draft: 'B' })
  await assert.rejects(pending, /会话/)
  assert.deepEqual(calls, ['enhanced A'])
  b.dispose(); a.dispose()
})

test('same-feed draft updates preserve bridge admission and submit errors reject', async () => {
  const a = store.createProjectionFeed('A')
  const calls = []
  const bridge = createComposerPromptBridge({ setDraft: (s) => { calls.push(s); a.publish({ draft: s }) }, submit: () => calls.push('submit') }, a.isCurrent)
  a.publish({ draft: '' })
  await bridge.send('ok')
  assert.deepEqual(calls, ['ok', 'submit'])
  const failing = createComposerPromptBridge({ setDraft() {}, submit() { throw new Error('host rejected') } }, a.isCurrent)
  await assert.rejects(failing.send('fail'), /host rejected/)
  a.dispose()
})
