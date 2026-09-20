import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as i18n from '../src/client/i18n.ts'
import * as settings from '../src/client/settings.ts'
import * as prompt from '../src/client/prompt.ts'
import * as promptMessages from '../src/client/prompt-messages.ts'
import * as settingsMessages from '../src/client/settings-messages.ts'
import * as maintenanceMessages from '../src/client/maintenance-messages.ts'
import * as maintenance from '../src/client/trend-maintenance.ts'
import * as skins from '../src/client/skin.ts'
import * as skinMessages from '../src/client/skin-messages.ts'
import { lifetimeLedgerClearWarning, LIFETIME_LEDGER_CLEAR_WARNING } from '../src/client/lifetime-ledger.ts'

// Execute actual components and shared subscription hook with deterministic React hooks.
function host(file, name, overrides = {}) {
  let cursor = 0, pending = [], writes = 0
  const slots = []
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial } },
    useState(initial) { const i = cursor++; slots[i] ??= { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, v => { writes++; slots[i].value = typeof v === 'function' ? v(slots[i].value) : v }] },
    useEffect(effect, deps) { const i = cursor++; if (!slots[i] || deps.some((d,n) => !Object.is(d, slots[i].deps[n]))) { const old = slots[i]; slots[i] = { deps, cleanup: old?.cleanup }; pending.push(() => { old?.cleanup?.(); slots[i].cleanup = effect() }) } },
    useMemo(make, deps) { const i = cursor++; if (!slots[i] || deps.some((d,n) => !Object.is(d, slots[i].deps[n]))) slots[i] = { deps, value: make() }; return slots[i].value },
  }
  react.useLayoutEffect = react.useEffect
  react.useCallback = (fn,deps) => react.useMemo(() => fn,deps)
  const modules = { react, './settings.ts': settings, './i18n.ts': i18n, './prompt.ts': prompt, './prompt-messages.ts': promptMessages, './settings-messages.ts': settingsMessages, './maintenance-messages.ts': maintenanceMessages, './trend-maintenance.ts': maintenance, './skin.ts': skins, './skin-messages.ts': skinMessages, './skin-store.ts': { listInstalledSkins: async () => [] }, './completion-sound.ts': { prepareCompletionSound: async () => true, previewCompletionSound: async () => true, stopCompletionSound() {} }, './events.ts': { PET_PREVIEW_EVENT: 'preview' }, './skin-panel.tsx': { SkinImportPanel() {} }, './trend-maintenance-panel.tsx': { TrendIndexMaintenancePanel() {} } }
  Object.assign(modules, overrides)
  function compile(path) { const source = readFileSync(new URL(`../src/client/${path}`, import.meta.url), 'utf8'); const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText; const module = { exports: {} }; new Function('require','module','exports',js)(key => { assert.ok(key in modules, `Missing test dependency ${key}`); return modules[key] }, module, module.exports); return module.exports }
  modules['./settings-hook.ts'] = compile('settings-hook.ts')
  modules['./cost.ts'] = compile('cost.ts')
  modules['./export-data.ts'] = compile('export-data.ts')
  modules['./theme.ts'] = compile('theme.ts')
  const Component = compile(file)[name]
  return { render(props = {}) { cursor = 0; const tree = Component(props); const effects = pending; pending = []; effects.forEach(fn => fn()); return tree }, unmount() { slots.forEach(s => s?.cleanup?.()) }, get writes() { return writes } }
}
function find(tree, key) { if (!tree || typeof tree !== 'object') return; if (tree.props?.key === key) return tree; for (const item of Array.isArray(tree) ? tree : tree.children ?? []) { const found = find(item,key); if (found) return found } }
function text(tree) { if (typeof tree === 'string') return tree; if (!tree || typeof tree !== 'object') return ''; return (Array.isArray(tree) ? tree : tree.children ?? []).map(text).join(' ') }
function environment() { const oldWindow = globalThis.window, oldStorage = globalThis.localStorage; const data = new Map(); globalThis.window = new EventTarget(); globalThis.localStorage = { getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,v) }; return () => { if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow; if (oldStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = oldStorage } }

function deferred() { let resolve, reject; const promise = new Promise((yes,no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
async function settleSound() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }
function soundInput(c) { return find(find(c.render(),'sound'),'input') }
function soundStatus(c) { return find(find(c.render(),'notifications'),'status') }
function soundHost(api) { return host('settings-panel.tsx','TokenPetSettingsPanel', { './completion-sound.ts': { prepareCompletionSound: async () => true, previewCompletionSound: async () => true, stopCompletionSound() {}, ...api } }) }

test('sound enable followed immediately by disable ignores a late unlock result', async () => {
  for (const outcome of ['ready','blocked','rejected']) {
    const restore = environment(), pending = deferred(); let stops = 0
    const c = soundHost({ prepareCompletionSound: () => pending.promise, stopCompletionSound() { stops++ } })
    try {
      c.render()
      soundInput(c).props.onChange({ target:{ checked:true } })
      soundInput(c).props.onChange({ target:{ checked:false } })
      assert.equal(stops,1); assert.equal(soundStatus(c),undefined)
      const writes = c.writes
      if (outcome === 'rejected') pending.reject(new Error('denied')); else pending.resolve(outcome === 'ready')
      await settleSound()
      assert.equal(c.writes,writes,`${outcome}: stale completion must not write state`)
      assert.equal(soundStatus(c),undefined)
      assert.equal(soundInput(c).props.checked,false)
    } finally { c.unmount(); restore() }
  }
})

test('pending unlock and preview do not write state after settings unmount', async () => {
  for (const preview of [false,true]) for (const rejected of [false,true]) {
    const restore = environment(), pending = deferred()
    const c = soundHost({ prepareCompletionSound: () => pending.promise, previewCompletionSound: () => pending.promise })
    try {
      c.render()
      if (preview) find(find(c.render(),'notifications'),'preview').props.onClick()
      else soundInput(c).props.onChange({ target:{ checked:true } })
      c.unmount(); const writes = c.writes
      if (rejected) pending.reject(new Error('denied')); else pending.resolve(true)
      await settleSound()
      assert.equal(c.writes,writes,`preview=${preview}, rejected=${rejected}`)
    } finally { restore() }
  }
})

test('shared settings disable clears another entry point sound status and pending result', async () => {
  const restore = environment(), pending = deferred()
  const a = soundHost({}), b = soundHost({ previewCompletionSound: () => pending.promise })
  try {
    a.render(); b.render()
    soundInput(b).props.onChange({ target:{ checked:true } })
    b.render(); a.render(); await settleSound()
    assert.match(text(soundStatus(b)),/音频已解锁/)
    find(find(b.render(),'notifications'),'preview').props.onClick()
    soundInput(a).props.onChange({ target:{ checked:false } })
    b.render() // Commit the shared-settings effect; the following render sees its clear.
    assert.equal(soundStatus(b),undefined); assert.equal(soundInput(b).props.checked,false)
    const writes = b.writes
    pending.resolve(true); await settleSound()
    assert.equal(b.writes,writes); assert.equal(soundStatus(b),undefined)
  } finally { a.unmount(); b.unmount(); restore() }
})

test('latest explicit preview wins over an older unlock and can run while notifications are off', async () => {
  const restore = environment(), oldUnlock = deferred(), preview = deferred()
  const c = soundHost({ prepareCompletionSound: () => oldUnlock.promise, previewCompletionSound: () => preview.promise })
  try {
    c.render(); soundInput(c).props.onChange({ target:{ checked:true } })
    soundInput(c).props.onChange({ target:{ checked:false } })
    find(find(c.render(),'notifications'),'preview').props.onClick()
    preview.resolve(true); await settleSound(); assert.match(text(soundStatus(c)),/已播放试听/)
    oldUnlock.resolve(false); await settleSound(); assert.match(text(soundStatus(c)),/已播放试听/)
    assert.equal(soundInput(c).props.checked,false)
  } finally { c.unmount(); restore() }
})

test('all controls dictionaries contain both languages and identical interpolation contracts', () => {
  for (const messages of [promptMessages.promptMessages, settingsMessages.settingsMessages, maintenanceMessages.maintenanceMessages, skinMessages.skinMessages]) for (const [key,m] of Object.entries(messages)) {
    assert.ok(m.zh.trim(),key); assert.ok(m.en.trim(),key); assert.doesNotMatch(m.en,/[\u3400-\u9fff]/,key)
    assert.deepEqual([...m.zh.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort(), [...m.en.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort(),key)
  }
})
test('two real settings entry points subscribe together and preserve custom templates', () => {
  const restore = environment(), a = host('settings-panel.tsx','TokenPetSettingsPanel'), b = host('settings-panel.tsx','TokenPetSettingsPanel')
  try {
    a.render(); b.render()
    const language = find(find(a.render(),'language'),'select')
    language.props.onChange({ target: { value: 'en' } })
    assert.match(text(a.render()), /Language & notifications/)
    assert.match(text(b.render()), /Maintenance & advanced/)
    assert.equal(find(find(b.render(),'template'),'input').props.value,settings.DEFAULT_ENHANCEMENT_TEMPLATES.en)
    find(find(a.render(),'template'),'input').props.onChange({ target: { value: '我的 custom {{prompt}}' } })
    settings.saveSettings({ language: 'zh' })
    assert.equal(find(find(b.render(),'template'),'input').props.value,'我的 custom {{prompt}}')
    const input = find(find(b.render(),'model'),'input')
    assert.equal(input.props.style.width,'100%'); assert.equal(input.props.style.minWidth,0)
    assert.equal(find(b.render(),'advanced').props.style.minWidth,0)
  } finally { a.unmount(); b.unmount(); restore() }
})
test('a partial settings event does not reset unrelated preferences', () => {
  const restore = environment(), c = host('settings-panel.tsx','TokenPetSettingsPanel')
  try {
    settings.saveSettings({ theme: 'light', costEnabled: true, completionSound: true })
    c.render()
    assert.equal(find(find(c.render(),'theme'),'select').props.value, 'light')
    // Another surface broadcasts only the field it changed.
    window.dispatchEvent(new CustomEvent(settings.SETTINGS_EVENT, { detail: { language: 'en' } }))
    const tree = c.render()
    assert.equal(find(find(tree,'theme'),'select').props.value, 'light', 'theme must survive a partial event')
    assert.equal(find(find(tree,'costEnable'),'input').props.checked, true, 'cost switch must survive a partial event')
    assert.equal(find(find(tree,'sound'),'input').props.checked, true, 'sound must survive a partial event')
    assert.match(text(tree), /Language & notifications/, 'the changed field still applies')
  } finally { c.unmount(); restore() }
})
test('prompt pending request, editable preview and errors survive language switches without resend', async () => {
  const restore = environment(); const c = host('prompt-panel.tsx','PromptEnhancerPanel'); let calls = 0, resolve, request
  const props = { initial: '原始 input', adapter: { enhance: req => { calls++; request = req; return new Promise(r => { resolve = r }) } } }
  try {
    c.render(props)
    find(c.render(props),'input').props.onChange({ target: { value: 'my edited draft' } })
    const pending = find(c.render(props),'enhance').props.onClick()
    settings.saveSettings({ language: 'en' })
    let tree = c.render(props)
    assert.equal(find(tree,'input').props.value,'my edited draft'); assert.match(text(tree),/Enhancing…/); assert.equal(calls,1)
    resolve({ original: request.prompt, enhanced: '增强 result' }); await pending
    tree = c.render(props); find(tree,'preview').props.onChange({ target: { value: 'edited preview' } })
    settings.saveSettings({ language: 'zh' }); tree = c.render(props)
    assert.equal(find(tree,'preview').props.value,'edited preview'); assert.equal(calls,1)
    settings.saveSettings({ language: 'en' }); tree = c.render(props)
    assert.equal(find(tree,'preview').props.value,'edited preview'); assert.equal(calls,1)
  } finally { c.unmount(); restore() }
  const err = new promptMessages.PromptEnhancementError('http',{ status:503,detail:': offline' })
  assert.match(promptMessages.promptErrorMessage(err,'zh'),/不可用/); assert.match(promptMessages.promptErrorMessage(err,'en'),/unavailable \(HTTP 503\): offline/)
  const stale = prompt.createComposerPromptBridge({ setDraft() {}, submit() {} }, () => false)
  assert.throws(() => stale.apply('no'), e => /session changed/.test(promptMessages.promptErrorMessage(e,'en')))
})
test('enhancement uses the language-aware template and rendered errors retranslate without a new request', async () => {
  const restore = environment(), c = host('prompt-panel.tsx','PromptEnhancerPanel')
  let calls = 0, request
  const props = { initial:'Keep my 中文 original', adapter:{ enhance: async req => { calls++; request = req; throw new promptMessages.PromptEnhancementError('missing') } } }
  try {
    settings.saveSettings({ language:'en' }); c.render(props)
    await find(c.render(props),'enhance').props.onClick()
    let tree = c.render(props)
    assert.equal(request.template,settings.DEFAULT_ENHANCEMENT_TEMPLATES.en)
    assert.equal(request.prompt,props.initial)
    assert.match(text(find(tree,'error')),/missing the enhanced field/)
    settings.saveSettings({ language:'zh' }); tree = c.render(props)
    assert.match(text(find(tree,'error')),/缺少 enhanced/); assert.equal(calls,1)
    settings.saveSettings({ enhancementTemplate:'CUSTOM {{prompt}}', language:'en' })
    await find(c.render(props),'enhance').props.onClick()
    assert.equal(request.template,'CUSTOM {{prompt}}'); assert.equal(calls,2)
  } finally { c.unmount(); restore() }
})

test('maintenance failures retranslate in place and retain alert semantics', async () => {
  const restore = environment(), originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok:false, status:503 })
  const c = host('trend-maintenance-panel.tsx','TrendIndexMaintenancePanel')
  try { c.render(); await Promise.resolve(); let tree = c.render(); assert.equal(find(tree,'feedback').props.role,'alert'); assert.match(text(find(tree,'feedback')),/503/); settings.saveSettings({ language:'en' }); tree = c.render(); assert.equal(find(tree,'feedback').props.role,'alert'); assert.doesNotMatch(text(tree),/[\u3400-\u9fff]/) } finally { c.unmount(); globalThis.fetch = originalFetch; restore() }
})
test('skin names, import errors, status labels and lifetime warnings are localized', async () => {
  assert.equal(skins.skinDisplayName(skins.GREEN_SPROUT_SKIN,'en'),'Green Sprout')
  await assert.rejects(skins.importSkinZip(new Uint8Array()), error => error.key === 'invalidZip')
  assert.match(skinMessages.skinText('en','noManifest'),/manifest/)
  assert.match(skinMessages.skinText('zh','unsafeEntries',{ paths: 'x' }),/不安全/)
  const status = maintenance.trendIndexStatusOf({ health:'ready', operation:'repairing', snapshotOnly:true, repairCount:3 })
  assert.match(maintenance.trendOperationLabel(status,'en'),/3/); assert.match(maintenance.trendOperationLabel(status,'zh'),/修复/)
  assert.equal(lifetimeLedgerClearWarning('zh'),LIFETIME_LEDGER_CLEAR_WARNING); assert.match(lifetimeLedgerClearWarning('en'),/permanently/i)
})
