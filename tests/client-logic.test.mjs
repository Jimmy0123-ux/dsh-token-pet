import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { strToU8, zipSync } from 'fflate'

import { PET_ACTION_PRIORITY, PET_ACTION_STATUS_LABELS, PetEventDedupe, eventPriority, petEventFromDshEvent } from '../src/client/events.ts'
import { PET_ANIMATIONS, PetAnimationPlayer, isImmediatePetEvent, oneShotDurationMs, oneShotSafetyDurationMs, selectCoalescedPetEvent } from '../src/client/animation.ts'
import { actionFrameAtStep } from '../src/client/pet-action-player.tsx'
import { PET_ACTION_SHEET_SPECS } from '../src/client/pet-action-sheets.generated.ts'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { BUILTIN_SKINS, GREEN_SPROUT_SKIN, importSkinZip, isSafeSkinEntryPath, resolveSkinAction, resolveStyleOverride, validateSkinManifest } from '../src/client/skin.ts'
import { createComposerPromptBridge, createPromptEnhancer } from '../src/client/prompt.ts'
import { clampFloatingOffset, normalizeSettings } from '../src/client/settings.ts'
import { resolvePromptRoute } from '../src/prompt-route.ts'
import { lifetimeLedgerOf, todayUsageBucketsOf } from '../src/client/derive.ts'
import { ContextPanel, modelDisplayName, PANEL_TABS, panelPhaseSections } from '../src/client/panel.tsx'
import { PromptEnhancerPanel } from '../src/client/prompt-panel.tsx'
import { TokenPetSettingsPanel } from '../src/client/settings-panel.tsx'
import { PetSprite } from '../src/client/pet.tsx'
import { canLoadTodayUsageTrend, fitPanelSizeToViewport, FLOATING_LAYER, proportionalPanelSize } from '../src/client/layout.ts'
import { createPanelRequestScope, shouldStartPanelRequest } from '../src/client/request-scope.ts'
import { clearLifetimeLedger, clearLifetimeLedgerAndReload, LIFETIME_CLEAR_CONFIRMATION, LIFETIME_LEDGER_CLEAR_WARNING } from '../src/client/lifetime-ledger.ts'
import { canReadTokenPetIndex, shouldSyncTokenPetIndex, todayTrendRequestUrl, tokenPetIndexStatusOf } from '../src/client/index-state.ts'
import { deriveTokenPetIndexState } from '../src/index-contract.ts'
import { TREND_REBUILD_CONFIRMATION, trendHealthLabel, trendIndexStatusOf, trendOperationLabel } from '../src/client/trend-maintenance.ts'

test('DSH lifecycle events map to stable pet actions', () => {
  assert.equal(petEventFromDshEvent({ type: 'request/start' })?.action, 'working')
  assert.equal(petEventFromDshEvent({ type: 'tool/result' })?.action, 'tool-success')
  assert.equal(petEventFromDshEvent({ type: 'tool/error' })?.action, 'tool-failure')
  assert.equal(petEventFromDshEvent({ type: 'compaction/start' })?.action, 'eating')
  assert.equal(petEventFromDshEvent({ type: 'compaction/end' })?.action, 'digesting')
  assert.equal(petEventFromDshEvent({ type: 'session/archive' })?.action, 'archive')
  assert.equal(petEventFromDshEvent({ type: 'unknown/event' }), null)
})

test('runtime action labels are complete and user-facing', () => {
  assert.deepEqual(Object.keys(PET_ACTION_STATUS_LABELS).sort(), Object.keys(PET_ACTION_PRIORITY).sort())
  assert.equal(PET_ACTION_STATUS_LABELS.idle, '空闲')
  assert.equal(PET_ACTION_STATUS_LABELS.working, '工作中')
  assert.equal(PET_ACTION_STATUS_LABELS['prompt-enhancing'], '提示生成中')
})

test('animation specs cover all 12 actions and archive remains one-shot', () => {
  assert.equal(Object.keys(PET_ACTION_PRIORITY).length, 12)
  for (const action of Object.keys(PET_ACTION_PRIORITY)) {
    const spec = PET_ANIMATIONS[action]
    assert.ok(spec, `missing animation spec for ${action}`)
    assert.ok(spec.frames.length >= 2)
    assert.ok(spec.durationMs > 0)
  }
  assert.equal(PET_ANIMATIONS.archive.loop, undefined)
  assert.equal(PET_ANIMATIONS.idle.loop, true)
})

test('one-shot queue timing equals the real 32-frame sheet duration', () => {
  for (const action of Object.keys(PET_ACTION_PRIORITY)) {
    const sheet = PET_ACTION_SHEET_SPECS[action]
    assert.ok(sheet, `missing runtime sheet for ${action}`)
    // The queue must time a one-shot from the full sheet (all 32 frames), not
    // from the legacy placeholder durations tuned for the old 8-frame build.
    assert.equal(oneShotDurationMs(action), sheet.totalMs, `queue one-shot timing off for ${action}`)
    assert.equal(sheet.totalMs, sheet.frames * sheet.delaysMs[0], `totalMs not frames x delay for ${action}`)
  }
  // Regression: tool-success used to be cut at 1283ms (legacy 8-frame value);
  // the full 32-frame sheet needs its real 3200ms.
  assert.equal(PET_ACTION_SHEET_SPECS['tool-success'].totalMs, 3200)
  assert.equal(oneShotDurationMs('tool-success'), 3200)
  assert.equal(oneShotSafetyDurationMs('tool-success', 1), 8200)
  assert.equal(oneShotSafetyDurationMs('tool-success', 0), 300)
})

test('animation player disables CSS animation for reduced motion and low performance', () => {
  const normal = renderToStaticMarkup(PetAnimationPlayer({ action: 'archive', children: 'pet' }))
  const reduced = renderToStaticMarkup(PetAnimationPlayer({ action: 'archive', children: 'pet', reducedMotion: true }))
  const lowPower = renderToStaticMarkup(PetAnimationPlayer({ action: 'archive', children: 'pet', lowPerformance: true }))
  assert.match(normal, /dsh-pet-archive/)
  assert.doesNotMatch(reduced, /dsh-pet-archive/)
  assert.doesNotMatch(lowPower, /dsh-pet-archive/)
})

test('authored strip player uses img transforms and seamless ping-pong indexing', () => {
  assert.deepEqual(Array.from({ length: 8 }, (_, i) => actionFrameAtStep(i, 4, true)), [0, 1, 2, 3, 2, 1, 0, 1])
  assert.deepEqual(Array.from({ length: 6 }, (_, i) => actionFrameAtStep(i, 4, false)), [0, 1, 2, 3, 0, 1])
  const source = readFileSync(new URL('../src/client/pet-action-player.tsx', import.meta.url), 'utf8')
  assert.match(source, /data-buffer-slot/)
  assert.match(source, /image\(0, buffer0Ref, layer0Ref\).*image\(1, buffer1Ref, layer1Ref\)/s)
  assert.match(source, /overflow: 'hidden'/)
  assert.match(source, /translate3d/)
  assert.match(source, /layerSizesRef/)
  assert.match(source, /MAX_CELL_ASPECT/)
  assert.match(source, /incoming\.decode\(\)/)
  assert.match(source, /requestAnimationFrame\(commit\)/)
  assert.match(source, /data-transition.*decoded-two-raf-atomic-cell-clipped/)
  const transitionStart = source.indexOf('useEffect(() => {', source.indexOf('const startPlayback'))
  const commitStart = source.indexOf('const commit =', transitionStart)
  assert.doesNotMatch(source.slice(transitionStart, commitStart), /stopPlayback\(\)/, 'outgoing must continue until commit')
  assert.match(source, /React owns only static structure/)
  assert.doesNotMatch(source, /stopPlayback\(\)\s*\/\/\s*outgoing|CROSSFADE_MS|opacity \$\{.*ms/)
  assert.match(source, /data-buffer-count/)
  assert.match(source, /removeAttribute\('src'\)/)
  assert.match(source, /incomingBuffer\.style\.visibility = 'hidden'/)
  const staticStyle = source.slice(source.indexOf('const staticBufferStyle'), source.indexOf('const viewport =', source.indexOf('const staticBufferStyle')))
  assert.doesNotMatch(staticStyle, /visibility:|opacity:|width:|height:/)
  assert.doesNotMatch(source, /getContext\(['"]2d['"]\)|drawImage|h\('canvas'/)
})

test('formal pet renders approved embedded artwork and respects motion stop', () => {
  const html = renderToStaticMarkup(createElement(PetSprite, {
    stage: 'active', satiation: 0.6, toolShare: 0.4, progress: 0.5, size: 120,
    action: 'working', animationSpeed: 0, motionDisabled: true,
  }))
  assert.match(html, /data:image\/png;base64,/)
  assert.match(html, /Token Pet，工作中/)
  assert.match(html, /animation:none/)
  assert.match(html, />工作中</)
  assert.doesNotMatch(html, /活跃|形态/)
  // 'working' is an authored loop sheet: it mounts the frame player (data-loop=1),
  // driven by path data rather than a legacy decoration bubble.
  assert.match(html, /data-loop="1"/)
})

test('semantic status stays working when visual motion is forced to idle', () => {
  const html = renderToStaticMarkup(createElement(PetSprite, {
    stage: 'active', satiation: 0, toolShare: 0, progress: 0.25,
    action: 'idle', statusAction: 'working', motionDisabled: true,
  }))
  assert.match(html, /Token Pet，工作中/)
  assert.match(html, />工作中</)
  assert.doesNotMatch(html, />空闲</)
})

test('formal pet mounts authored frame sheets for the real actions', () => {
  const loopActions = new Set(['working', 'warning', 'prompt-enhancing'])
  const expected = new Map([
    ['eating', false], ['digesting', false], ['warning', true],
    ['tool-success', false], ['tool-failure', false], ['click', false],
    ['evolve', false], ['prompt-enhancing', true], ['prompt-ready', false], ['archive', false],
  ])
  for (const [action, loops] of expected) {
    const html = renderToStaticMarkup(createElement(PetSprite, {
      stage: 'growth', satiation: 0.4, toolShare: 0.2, progress: 0.3, action,
    }))
    // The authored sheet replaces the legacy decoration bubble: the frame player
    // mounts (data-frame + data-source-frame-size) and no decoration bubble shows.
    assert.match(html, /data-frame="0"/, `${action} does not render frame data`)
    assert.match(html, /data-source-frame-size="\d+x540"/, `${action} does not mount the action frame player`)
    assert.doesNotMatch(html, /aria-label="工作中"/)
    const wantLoop = loopActions.has(action) ? '1' : '0'
    assert.match(html, new RegExp(`data-loop="${wantLoop}"`), `${action} loop flag mismatch`)
  }
})

test('event priorities preserve archive ordering and explicit overrides', () => {
  assert.ok(eventPriority({ action: 'archive' }) > eventPriority({ action: 'evolve' }))
  assert.ok(eventPriority({ action: 'tool-failure' }) > eventPriority({ action: 'warning' }))
  assert.equal(eventPriority({ action: 'idle', priority: 99 }), 99)
})

test('background animation bursts coalesce while explicit actions interrupt', () => {
  assert.equal(selectCoalescedPetEvent([{ action: 'idle' }, { action: 'working' }, { action: 'tool-success' }])?.action, 'tool-success')
  assert.equal(selectCoalescedPetEvent([{ action: 'working' }, { action: 'working', id: 'latest' }])?.id, 'latest')
  assert.equal(selectCoalescedPetEvent([]), null)
  assert.equal(isImmediatePetEvent({ action: 'working', interrupt: true }), true)
  assert.equal(isImmediatePetEvent({ action: 'click' }), true)
  assert.equal(isImmediatePetEvent({ action: 'warning' }), true)
  assert.equal(isImmediatePetEvent({ action: 'tool-success' }), false)
  const source = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')
  assert.match(source, /preview:.*interrupt: true/)
  assert.match(source, /action: 'click'.*interrupt: true/)
})

test('PetEvent dedupe rejects a repeated id inside its window', () => {
  const dedupe = new PetEventDedupe(100)
  assert.equal(dedupe.accept({ id: 'same', action: 'click', timestamp: 1000 }), true)
  assert.equal(dedupe.accept({ id: 'same', action: 'click', timestamp: 1050 }), false)
  assert.equal(dedupe.accept({ id: 'same', action: 'click', timestamp: 1100 }), true)
})

test('skin paths reject traversal and executable content', () => {
  assert.equal(isSafeSkinEntryPath('manifest.json'), true)
  assert.equal(isSafeSkinEntryPath('common/idle.webp'), true)
  assert.equal(isSafeSkinEntryPath('../escape.png'), false)
  assert.equal(isSafeSkinEntryPath('common/script.js'), false)
  assert.equal(isSafeSkinEntryPath('C:/evil.exe'), false)
})

test('skin ZIP import is explicitly host-owned and fails safely in client', () => {
  const zip = zipSync({
    'manifest.json': strToU8(JSON.stringify({ id: 'test-skin', name: 'Test Skin' })),
  })
  assert.throws(() => importSkinZip(zip), /宿主适配器/)
})

test('skin manifest and path validation remain available in client', () => {
  assert.equal(validateSkinManifest({ id: '../bad', name: 'Bad' }), null)
  assert.equal(isSafeSkinEntryPath('../evil.png'), false)
  assert.equal(isSafeSkinEntryPath('common/idle.webp'), true)
})

test('Green Sprout uses common actions and pressure bands only tint warning rings', () => {
  assert.ok(BUILTIN_SKINS.some((skin) => skin.id === GREEN_SPROUT_SKIN.id))
  assert.equal(resolveSkinAction(GREEN_SPROUT_SKIN, 'working', 'active'), 'common/working.webp')
  assert.equal(resolveSkinAction(GREEN_SPROUT_SKIN, 'missing', 'active'), 'common/idle.webp')
  assert.equal(resolveStyleOverride(GREEN_SPROUT_SKIN, 'growth.body'), undefined)
  assert.equal(resolveStyleOverride(GREEN_SPROUT_SKIN, 'growth.ring'), '#8fbf9b')
})

test('prompt enhancement requires explicit call and supports manual actions', async () => {
  let calls = 0
  const controller = createPromptEnhancer({
    async enhance(request) { calls += 1; return { original: request.prompt, enhanced: `优化：${request.prompt}` } },
  })
  assert.equal(calls, 0)
  assert.equal(controller.getState().preview, null)
  await controller.enhance('测试')
  assert.equal(calls, 1)
  assert.equal(controller.act('replace'), '优化：测试')
  assert.equal(controller.act('append'), '测试\n\n优化：测试')
  assert.equal(controller.act('copy'), '优化：测试')
  assert.equal(controller.act('regenerate'), '测试')
  assert.equal(controller.act('cancel'), null)
  assert.equal(controller.getState().preview, null)
})

test('composer bridge applies and directly submits through real input actions', async () => {
  const calls = []
  const bridge = createComposerPromptBridge({
    setDraft(text) { calls.push(['draft', text]) },
    submit() { calls.push(['submit']) },
  })
  bridge.apply('覆盖后的提示词')
  assert.deepEqual(calls, [['draft', '覆盖后的提示词']])
  calls.length = 0
  await bridge.send('增强后直接发送')
  assert.deepEqual(calls, [['draft', '增强后直接发送'], ['submit']])
})

test('prompt enhancement follows the DSH default route when no override is set', () => {
  assert.deepEqual(resolvePromptRoute({}, { provider: 'deepseek', model: 'deepseek-chat' }, [{ id: 'deepseek' }]), {
    provider: 'deepseek', model: 'deepseek-chat',
  })
  assert.deepEqual(resolvePromptRoute({ provider: 'custom', model: 'custom-model' }, { provider: 'deepseek', model: 'deepseek-chat' }, [{ id: 'deepseek' }, { id: 'custom' }]), {
    provider: 'custom', model: 'custom-model',
  })
})

test('prompt failure preserves original and exposes error', async () => {
  const controller = createPromptEnhancer({ async enhance() { throw new Error('adapter failed') } })
  await assert.rejects(controller.enhance('原文'), /adapter failed/)
  assert.equal(controller.getState().original, '原文')
  assert.equal(controller.getState().preview, null)
  assert.equal(controller.getState().error, 'adapter failed')
})

test('today usage bucket contract validates, sorts, and caps at 24 buckets', () => {
  const buckets = Array.from({ length: 25 }, (_, i) => ({ start: i * 3600000, end: (i + 1) * 3600000, total: i, count: 1 }))
  const result = todayUsageBucketsOf({ buckets: buckets.reverse() })
  assert.equal(result.length, 24)
  assert.equal(result[0].start, 3600000)
  assert.equal(result[23].total, 24)
  assert.deepEqual(todayUsageBucketsOf({ buckets: [{ start: 0, end: 0, total: 1, count: 1 }, { start: 0, end: 1, total: -1, count: 1 }] }), [])
})

test('today usage buckets exclude future hours and trim empty edges', () => {
  const now = Date.parse('2025-01-02T12:30:00Z')
  const result = todayUsageBucketsOf({ buckets: [
    { start: Date.parse('2025-01-02T10:00:00Z'), end: Date.parse('2025-01-02T11:00:00Z'), total: 0, count: 0 },
    { start: Date.parse('2025-01-02T11:00:00Z'), end: Date.parse('2025-01-02T12:00:00Z'), total: 4, count: 1 },
    { start: Date.parse('2025-01-02T12:00:00Z'), end: Date.parse('2025-01-02T13:00:00Z'), total: 0, count: 0 },
    { start: Date.parse('2025-01-02T12:30:00Z'), end: Date.parse('2025-01-02T13:00:00Z'), total: 5, count: 1 },
    { start: Date.parse('2025-01-02T13:00:00Z'), end: Date.parse('2025-01-02T14:00:00Z'), total: 99, count: 1 },
  ] }, now)
  assert.deepEqual(result.map((bucket) => bucket.total), [4, 0, 5])
})

test('panel opening stages defer expensive trend and controls', () => {
  assert.deepEqual(panelPhaseSections(0), { trend: false, enhancements: false, settings: false })
  assert.deepEqual(panelPhaseSections(1), { trend: true, enhancements: false, settings: false })
  assert.deepEqual(panelPhaseSections(2), { trend: true, enhancements: true, settings: true })
})

test('floating panel always fits short and narrow viewports without a clipped child', () => {
  assert.deepEqual(fitPanelSizeToViewport(820, 920, 500, 360), { width: 484, height: 272, contentHeight: 230 })
  assert.deepEqual(fitPanelSizeToViewport(820, 920, 200, 120), { width: 184, height: 32, contentHeight: 1 })
})

test('floating statistics panel stays above the formal pet', () => {
  assert.ok(FLOATING_LAYER.panel > FLOATING_LAYER.pet)
})

test('context occupancy chip is centered under the pet', () => {
  const source = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')
  const start = source.indexOf('const stageChip: CSSProperties')
  const block = source.slice(start, source.indexOf('const actionBar', start))
  assert.match(block, /alignSelf: 'center'/)
  assert.match(block, /textAlign: 'center'/)
})

test('today trend waits only for its usable index, not cumulative readiness', () => {
  assert.equal(canLoadTodayUsageTrend(false, 1, true), false)
  assert.equal(canLoadTodayUsageTrend(true, 0, true), false)
  assert.equal(canLoadTodayUsageTrend(true, 1, false), false)
  assert.equal(canLoadTodayUsageTrend(true, 1, true), true)
})

test('panel requests run once per visible generation, including failed generations', () => {
  assert.equal(shouldStartPanelRequest(false, null, 4), false)
  assert.equal(shouldStartPanelRequest(true, null, 4), true)
  assert.equal(shouldStartPanelRequest(true, 4, 4), false)
  assert.equal(shouldStartPanelRequest(true, 4, 5), true)
})

test('disposing a panel request aborts fetches and clears delayed work', () => {
  const scope = createPanelRequestScope()
  let ran = false
  scope.schedule(() => { ran = true }, 60_000)
  assert.equal(scope.signal.aborted, false)
  assert.equal(scope.pendingTimers(), 1)
  scope.dispose()
  assert.equal(scope.signal.aborted, true)
  assert.equal(scope.pendingTimers(), 0)
  assert.equal(ran, false)
})

test('panel request deadline aborts instead of loading forever', async () => {
  const scope = createPanelRequestScope(10)
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(scope.signal.aborted, true)
  assert.equal(scope.timedOut(), true)
  scope.dispose()
})

test('panel has no unused cumulative GET and one fetch site per visible data source', () => {
  const source = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /fetch\(\s*['"]\/token-pet\/usage['"]/)
  assert.equal(source.match(/fetch\('\/token-pet\/usage\/lifetime'/g)?.length, 1)
  assert.equal(source.match(/fetch\(todayTrendRequestUrl/g)?.length, 1)
  assert.equal(source.match(/fetch\('\/token-pet\/index\/status'/g)?.length, 1)
  assert.equal(source.match(/['"]\/token-pet\/index\/sync['"]/g)?.length, 1, 'only the explicit sync callback may reference the sync route')
  assert.doesNotMatch(source, /shouldSyncTokenPetIndex/)
  assert.match(source, /useTodayUsageTrend\(trendReloadKey,/)
  assert.match(source, /`上下文 \$\{view\.percent/)
  assert.doesNotMatch(source, /形态：|stageLabel|useCumulativeUsage|setReloadKey/)
})

test('default resize preserves the starting aspect ratio within bounds', () => {
  const grown = proportionalPanelSize(800, 640, 120, 20, 360, 900, 288, 720)
  assert.deepEqual(grown, { width: 900, height: 720 })
  assert.equal(grown.width / grown.height, 800 / 640)
})

test('same-named models remain distinguishable by provider', () => {
  assert.equal(modelDisplayName({ provider: 'provider-a', model: 'gpt-5.6-sol' }), 'provider-a · gpt-5.6-sol')
  assert.equal(modelDisplayName({ provider: '', model: 'gpt-5.6-sol' }), 'gpt-5.6-sol')
})

test('Lifetime Ledger client uses a dedicated destructive API with explicit confirmation', async () => {
  const calls = []
  const ok = await clearLifetimeLedger(async (url, init) => {
    calls.push([url, init])
    return { ok: true }
  })
  assert.equal(ok, true)
  assert.equal(calls[0][0], '/token-pet/usage/lifetime/clear-history')
  assert.equal(calls[0][1].method, 'POST')
  assert.deepEqual(JSON.parse(calls[0][1].body), { confirmation: LIFETIME_CLEAR_CONFIRMATION })
  assert.match(LIFETIME_LEDGER_CLEAR_WARNING, /永久清空/)
  assert.match(LIFETIME_LEDGER_CLEAR_WARNING, /无法.*恢复/)
  assert.match(LIFETIME_LEDGER_CLEAR_WARNING, /普通清空、恢复和刷新不会影响账本/)
})

test('successful clear-history refreshes only the ledger view', async () => {
  let reloads = 0
  const success = await clearLifetimeLedgerAndReload(() => { reloads++ }, async () => ({ ok: true }))
  assert.equal(success, true)
  assert.equal(reloads, 1)
  const failure = await clearLifetimeLedgerAndReload(() => { reloads++ }, async () => ({ ok: false }))
  assert.equal(failure, false)
  assert.equal(reloads, 1)
})

test('Lifetime Ledger response and irreversible clear copy render independently', () => {
  const ledger = lifetimeLedgerOf({
    sessions: 3,
    total: 17,
    totals: { uncachedInputTokens: 2, outputTokens: 3, cacheReadTokens: 5, cacheWriteTokens: 7 },
    clearedAt: '2025-01-02T03:04:05.000Z',
  })
  assert.equal(ledger?.clearedAt, '2025-01-02T03:04:05.000Z')
  const html = renderToStaticMarkup(createElement(ContextPanel, {
    percent: null,
    breakdown: null,
    usage: null,
    stats: null,
    trend: [],
    cumulativeStatus: 'ready',
    cumulative: { sessions: 3, total: 5, totals: { uncachedInputTokens: 2, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0 } },
    indexProgress: { status: 'ready' },
    lifetimeStatus: 'ready',
    lifetimeLedger: ledger,
    phase: 1,
  }))
  assert.match(html, /终身用量账本/)
  assert.match(html, /唯一主账本/)
  assert.match(html, /用量最高的 5 个服务商与模型/)
  assert.doesNotMatch(html, /Lifetime Ledger|Top 5 Provider/)
  assert.doesNotMatch(html, /DSH 累计用量/)
  assert.doesNotMatch(html, />清空记录</)
  assert.doesNotMatch(html, />恢复记录</)
  assert.match(html, /清空历史（不可恢复）/)
  assert.doesNotMatch(html, /确认永久清空？/)
})

test('Lifetime parser accepts the host models field and exposes partial refresh failures', () => {
  const ledger = lifetimeLedgerOf({
    sessions: 1,
    total: 9,
    totals: { uncachedInputTokens: 4, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
    models: [{ provider: 'openai-codex', model: 'gpt-5.6-sol', total: 9 }],
    refreshFailed: 2,
    refreshListed: 7,
  })
  assert.deepEqual(ledger?.byModel, [{ provider: 'openai-codex', model: 'gpt-5.6-sol', total: 9 }])
  assert.equal(ledger?.refreshFailed, 2)
  assert.equal(ledger?.refreshListed, 7)
})

test('main panel exposes three tabs and embeds trend in overview', () => {
  assert.deepEqual(PANEL_TABS.map((tab) => tab.label), ['总览', '模型', '设置'])
  const html = renderToStaticMarkup(createElement(ContextPanel, {
    percent: 25,
    breakdown: null,
    usage: null,
    stats: null,
    trend: [],
    indexProgress: { status: 'ready' },
    lifetimeStatus: 'ready',
    lifetimeLedger: { sessions: 0, total: 0, totals: { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } },
    phase: 2,
  }))
  for (const label of ['总览', '模型', '设置']) assert.match(html, new RegExp(`>${label}<`))
  assert.doesNotMatch(html, />趋势</)
  assert.match(html, /本日用量趋势/)
  assert.doesNotMatch(html, /aria-label="增强提示词"/)
})

test('panel keeps usable trend visible while background refreshes and exposes manual sync', () => {
  const html = renderToStaticMarkup(createElement(ContextPanel, {
    percent: 45, breakdown: null, usage: null, stats: null,
    trend: [{ start: 1, end: 2, total: 3, count: 1 }], trendStatus: 'ready', refreshing: true,
    indexProgress: { status: 'partial', pending: 2 }, lifetimeStatus: 'ready',
    lifetimeLedger: { sessions: 0, total: 0, totals: { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } },
    phase: 2,
  }))
  assert.match(html, /后台刷新中/)
  assert.match(html, />立即同步</)
  assert.doesNotMatch(html, /正在读取本日趋势/)
})

test('prompt drawer panel retains the full explicit action surface without invented attachment counts', () => {
  const html = renderToStaticMarkup(createElement(PromptEnhancerPanel, { initial: '原文', drawer: true, onSend() {} }))
  assert.match(html, /原始提示词/)
  assert.match(html, /增强提示词/)
  assert.match(html, /不会自动发送/)
  assert.doesNotMatch(html, /附件\s*\d+/)
})

test('floating offsets remain recoverable after a viewport change', () => {
  const base = { left: 1200, top: 600, right: 1320, bottom: 720 }
  assert.deepEqual(clampFloatingOffset({ x: 900, y: 900 }, base, 800, 500), { x: -528, y: -228 })
  assert.deepEqual(clampFloatingOffset({ x: 0, y: 0 }, { left: 0, top: 0, right: 1200, bottom: 900 }, 800, 500), { x: -200, y: -200 })
})

test('settings expose explicit preview controls for every formal action family', () => {
  const html = renderToStaticMarkup(createElement(TokenPetSettingsPanel))
  assert.match(html, /宠物动作预览/)
  for (const label of ['工作', '吃 Token', '消化', '成功', '失败', '警告', '成长', '开心', '提示生成中', '提示已生成']) assert.match(html, new RegExp(`>${label}<`))
})

test('settings normalization clamps values and repairs corrupt fields', () => {
  const settings = normalizeSettings({ size: 9999, panelWidth: -1, panelHeight: 'bad', position: { x: Infinity }, language: 'xx', skinId: '../bad', lowPerformance: 'yes', enhancementEnabled: 1 })
  assert.equal(settings.size, 320)
  assert.equal(settings.panelWidth, 360)
  assert.equal(settings.panelHeight, 620)
  assert.deepEqual(settings.position, { x: 0, y: 0 })
  assert.equal(settings.language, 'zh')
  assert.equal(settings.skinId, 'default')
  assert.equal(settings.lowPerformance, false)
  assert.equal(settings.enhancementEnabled, true)
})

test('index state machine distinguishes missing, partial, operations, and terminal outcomes', () => {
  assert.equal(deriveTokenPetIndexState({ persisted: false, pending: 3 }), 'missing')
  assert.equal(deriveTokenPetIndexState({ persisted: false, pending: 3, operation: 'building' }), 'building')
  assert.equal(deriveTokenPetIndexState({ persisted: true, pending: 2 }), 'partial')
  assert.equal(deriveTokenPetIndexState({ persisted: true, pending: 2, operation: 'syncing' }), 'syncing')
  assert.equal(deriveTokenPetIndexState({ persisted: true, pending: 0 }), 'ready')
  assert.equal(deriveTokenPetIndexState({ persisted: true, pending: 1, terminal: 'cancelled' }), 'cancelled')
  assert.equal(deriveTokenPetIndexState({ persisted: true, pending: 1, terminal: 'error' }), 'error')
})

test('client preserves usable partial index and requests only incremental sync', () => {
  const status = tokenPetIndexStatusOf({
    status: 'partial', persisted: true, usable: true, listed: 5, closed: 3, live: 2,
    indexed: 2, pending: 1, entries: 2, path: 'index.json',
    progress: { completed: 0, total: 1, indexed: 0, skipped: 0, failed: 0, pending: 1, status: 'partial' },
  })
  assert.ok(status)
  assert.equal(canReadTokenPetIndex(status), true)
  assert.equal(shouldSyncTokenPetIndex(status), true)
  const refreshing = tokenPetIndexStatusOf({
    ...status, refreshing: true, retryAfterMs: 1000,
  })
  assert.ok(refreshing)
  assert.equal(refreshing.refreshing, true)
  assert.equal(shouldSyncTokenPetIndex(refreshing), false)
  assert.equal(status.progress.total, 1)
  assert.equal(status.live, 2)
  assert.equal(tokenPetIndexStatusOf({ status: 'unknown' }), null)
})

test('today trend request addresses only the durable hourly projection', () => {
  assert.equal(todayTrendRequestUrl('Asia/Shanghai'), '/token-pet/usage/trend?timeZone=Asia%2FShanghai')
})

test('trend maintenance status validates host state and exposes explicit operation feedback', () => {
  const status = trendIndexStatusOf({
    health: 'ready', updatedAt: 1234, operation: 'repairing', repairCount: 2,
    path: 'hourly.json', snapshotOnly: true, cancelSupported: false,
  })
  assert.ok(status)
  assert.equal(status.running, true)
  assert.equal(status.repairing, true)
  assert.equal(trendHealthLabel(status), '健康')
  assert.equal(trendOperationLabel(status), '正在修复（2 项）')
  assert.equal(trendIndexStatusOf({ health: 'unknown', operation: 'idle' }), null)
  assert.match(TREND_REBUILD_CONFIRMATION, /读取全部历史会话/)
})

test('settings explain snapshot-only reads and require an explicit trend rebuild action', () => {
  const html = renderToStaticMarkup(createElement(TokenPetSettingsPanel))
  const source = readFileSync(new URL('../src/client/trend-maintenance-panel.tsx', import.meta.url), 'utf8')
  assert.match(html, /小时趋势索引维护/)
  assert.match(html, /普通状态读取与趋势刷新只读取校验过的小时快照/)
  assert.match(html, />显式重建趋势索引</)
  assert.match(source, /attempts >= 120/)
  assert.match(source, /自动刷新已暂停，请手动刷新状态/)
  assert.doesNotMatch(source, /setInterval/)
})

test('idle sheet owns motion timing and warning effects stay subdued', () => {
  const pet = readFileSync(new URL('../src/client/pet.tsx', import.meta.url), 'utf8')
  const actionSheets = readFileSync(new URL('../src/client/pet-action-sheets.generated.ts', import.meta.url), 'utf8')
  assert.match(pet, /animation: 'none'/)
  assert.doesNotMatch(pet, /dsh-pet-/)
  assert.doesNotMatch(pet, /PetIdlePlayer/)
  assert.match(actionSheets, /'idle':/)
  assert.match(actionSheets, /delaysMs/)
  assert.match(pet, /saturate\(\.88\) brightness\(\.96\)/)
  assert.match(pet, /warning \? \.1 \+ progress \* \.18/)
})
