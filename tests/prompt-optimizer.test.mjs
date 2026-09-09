import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPromptOptimizerInput, classifyPromptComplexity, detectPromptLanguage } from '../src/prompt-optimizer.ts'
import { apply } from '../src/index.ts'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('detects language and bounded complexity without changing user text', () => {
  assert.equal(detectPromptLanguage('请保留原文并输出三点摘要'), 'zh')
  assert.equal(detectPromptLanguage('Write a concise release note'), 'en')
  assert.equal(classifyPromptComplexity('Summarize this in three bullets.'), 'simple')
  assert.equal(classifyPromptComplexity('必须保留数字；不要添加事实。请按背景、变化和限制输出。'), 'simple')
  assert.equal(classifyPromptComplexity(Array.from({ length: 160 }, (_, i) => `requirement${i}`).join(' ')), 'complex')
})

test('rules preserve intent, language, constraints, and forbid execution/invention', () => {
  const original = '请把这段中文整理成三条发布说明；必须保留版本号 1.2.3；不要添加未确认的功能。'
  const framed = buildPromptOptimizerInput(original)
  assert.match(framed, /你是提示词优化器/)
  assert.match(framed, /只改写提示词，不执行/)
  assert.match(framed, /保留原始意图、原文语言/)
  assert.match(framed, /<original_prompt>[\s\S]*1\.2\.3[\s\S]*不要添加未确认的功能/) 
  assert.doesNotMatch(framed, /system prompt|You are a prompt optimizer/)
})

test('English input receives English rules while prompt content remains intact', () => {
  const original = 'Rewrite this as a short checklist. Keep the exact API name /v1/items and do not invent behavior.'
  const framed = buildPromptOptimizerInput(original)
  assert.match(framed, /You are a prompt optimizer/)
  assert.match(framed, /original intent, language, facts/)
  assert.match(framed, /\/v1\/items/)
  assert.match(framed, /do not invent behavior/)
})

test('custom template is retained as additional context, including its placeholder', () => {
  const template = 'Use a calm technical tone. Preserve {{prompt}} exactly as the source material.'
  const framed = buildPromptOptimizerInput('帮我整理这段话', template)
  assert.match(framed, /Additional user-provided guidance/)
  assert.match(framed, /Use a calm technical tone/) 
  assert.match(framed, /\{\{prompt\}\}/)
  assert.match(framed, /帮我整理这段话/)
})

test('host endpoint sends optimizer framing to adapters and returns raw original text', async () => {
  const home = await mkdtemp(join(tmpdir(), 'token-pet-prompt-host-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  let captured
  const routes = new Map()
  const adapter = { async enhance(request) { captured = request; return { enhanced: '优化后的提示词', model: request.model } } }
  const webServer = { register(route) { routes.set(route.path, route); return () => routes.delete(route.path) } }
  const query = { async listSessions() { return [] }, async readSession() { return { events: [] } } }
  const webCtx = {
    get(name) { return name === 'webServer' ? webServer : name === 'sessionQuery' ? query : name === 'promptEnhancer' ? adapter : undefined },
    effect(start) { return start() },
  }
  const persistenceCtx = { get() { return undefined }, effect(start) { return start() }, on() { return () => {} } }
  try {
    apply({ inject(deps, start) { start(deps.includes('webServer') ? webCtx : persistenceCtx) }, get(name) { return name === 'promptEnhancer' ? adapter : undefined } })
    const route = routes.get('/token-pet/prompt/enhance')
    assert.ok(route)
    const original = '请保留版本号 1.2.3，不要添加未确认的功能。'
    let statusCode = 0; let body
    const response = { writeHead(code) { statusCode = code }, end(value) { body = JSON.parse(value) } }
    const request = { method: 'POST', on(event, callback) { if (event === 'data') callback(JSON.stringify({ prompt: original, template: '保持正式语气：{{prompt}}', provider: 'p', model: 'm' })); if (event === 'end') callback() } }
    await route.handler(request, response)
    assert.equal(statusCode, 200)
    assert.equal(body.original, original)
    assert.equal(body.enhanced, '优化后的提示词')
    assert.match(captured.prompt, /<prompt_optimizer_rules>/)
    assert.match(captured.prompt, /1\.2\.3/)
    assert.match(captured.prompt, /不要添加未确认的功能/)
    assert.match(captured.prompt, /保持正式语气/) 
    assert.equal(captured.template, undefined)
    assert.equal(captured.provider, 'p')
    assert.equal(captured.model, 'm')
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  }
})

test('host fallback llm path receives the same framing and returns raw original text', async () => {
  const home = await mkdtemp(join(tmpdir(), 'token-pet-prompt-llm-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  let streamed
  const routes = new Map()
  const llm = {
    listProviders() { return [{ id: 'p' }] },
    async *stream(options) { streamed = options; yield { type: 'text-delta', text: '优化结果' }; yield { type: 'finish', reason: { kind: 'completed' } } },
  }
  const webServer = { register(route) { routes.set(route.path, route); return () => routes.delete(route.path) } }
  const query = { async listSessions() { return [] }, async readSession() { return { events: [] } } }
  const webCtx = { get(name) { return name === 'webServer' ? webServer : name === 'sessionQuery' ? query : undefined }, effect(start) { return start() } }
  const persistenceCtx = { get() { return undefined }, effect(start) { return start() }, on() { return () => {} } }
  try {
    apply({ inject(deps, start) { start(deps.includes('webServer') ? webCtx : persistenceCtx) }, get(name) {
      if (name === 'llm') return llm
      if (name === 'agentDefaultModel') return { currentSelection() { return { provider: 'p', model: 'm' } } }
      return undefined
    } })
    const route = routes.get('/token-pet/prompt/enhance'); assert.ok(route)
    const original = 'Write a short release note. Keep version 1.2.3 and do not invent features.'
    let statusCode = 0; let body
    await route.handler({ method: 'POST', on(event, callback) { if (event === 'data') callback(JSON.stringify({ prompt: original, provider: 'p', model: 'm' })); if (event === 'end') callback() } }, { writeHead(code) { statusCode = code }, end(value) { body = JSON.parse(value) } })
    assert.equal(statusCode, 200); assert.equal(body.original, original); assert.equal(body.enhanced, '优化结果')
    assert.match(streamed.messages[0].content[0].text, /<prompt_optimizer_rules>/)
    assert.match(streamed.messages[0].content[0].text, /version 1\.2\.3/)
    assert.equal(streamed.provider, 'p'); assert.equal(streamed.model, 'm')
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  }
})

test('empty custom templates do not create misleading guidance sections', () => {
  const framed = buildPromptOptimizerInput('Make this clearer', '  ')
  assert.doesNotMatch(framed, /Additional user-provided guidance/)
  assert.match(framed, /Keep the improved prompt concise/) 
})
