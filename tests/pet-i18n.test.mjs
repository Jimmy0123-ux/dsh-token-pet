import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement as h } from 'react'
import { renderToStaticMarkup as render } from 'react-dom/server'
import { PetSprite, SvgPetFallback } from '../src/client/pet.tsx'
import { petActionStatusLabel, PET_ACTION_MESSAGES } from '../src/client/events.ts'

const base = { stage: 'newborn', satiation: 0.3, toolShare: 0, progress: 0.2, size: 120 }
const actions = ['idle', 'working', 'eating', 'digesting', 'warning', 'evolve', 'click', 'archive', 'tool-success', 'tool-failure', 'prompt-enhancing', 'prompt-ready']
const name = (language, label) => language === 'en' ? `Token Pet, ${label}` : `用量小宠物，${label}`
const title = (language, label) => language === 'en' ? `Current status: ${label}` : `当前状态：${label}`

for (const language of ['zh', 'en']) {
  test(`${language}: all 12 semantic pet states have localized visible and accessible names`, () => {
    assert.equal(Object.keys(PET_ACTION_MESSAGES).length, actions.length)
    for (const action of actions) {
      const label = petActionStatusLabel(action, language)
      const html = render(h(PetSprite, { ...base, language, action }))
      assert.ok(html.includes(`aria-label="${name(language, label)}"`), action)
      assert.ok(html.includes(`title="${title(language, label)}"`), action)
      assert.ok(html.includes(`>${label}</span>`), action)
      assert.match(html, /width:120px;height:175px/, 'status translation must not change body/feet dimensions')
      assert.match(html, /transform-origin:50% 88%/)
      assert.match(html, /bottom:-2px;height:5px/, 'belly meter anchor remains unchanged')
      if (language === 'en') assert.doesNotMatch(html, /[\u3400-\u9fff]/)
    }
  })

  test(`${language}: frozen visual idle preserves all 12 real runtime labels`, () => {
    for (const statusAction of actions) {
      for (const motion of [{ motionDisabled: true }, { animationSpeed: 0 }]) {
        const label = petActionStatusLabel(statusAction, language)
        const html = render(h(PetSprite, { ...base, ...motion, language, action: 'idle', statusAction }))
        assert.ok(html.includes(`aria-label="${name(language, label)}"`), statusAction)
        assert.ok(html.includes(`title="${title(language, label)}"`), statusAction)
        assert.ok(html.includes(`>${label}</span>`), statusAction)
      }
    }
  })

  test(`${language}: real SVG fail-safe retains semantic accessible name`, () => {
    for (const statusAction of actions) {
      const label = petActionStatusLabel(statusAction, language)
      const html = render(h(SvgPetFallback, { ...base, language, action: 'idle', statusAction, motionDisabled: true }))
      assert.match(html, /^<svg/)
      assert.match(html, /role="img"/)
      assert.ok(html.includes(`aria-label="${name(language, label)}"`), statusAction)
      assert.match(html, /viewBox="0 0 72 80" width="120"/, 'fallback geometry remains unchanged')
      if (language === 'en') assert.doesNotMatch(html, /[\u3400-\u9fff]/)
    }
  })
}

test('default pet language remains Chinese and English chips wrap instead of truncating', () => {
  const html = render(h(PetSprite, { ...base, statusAction: 'warning' }))
  assert.ok(html.includes('title="当前状态：上下文预警"'))
  const english = render(h(PetSprite, { ...base, language: 'en', statusAction: 'prompt-ready' }))
  assert.match(english, /max-width:112px/)
  assert.match(english, /white-space:normal;overflow-wrap:anywhere/)
  assert.doesNotMatch(english, /text-overflow:ellipsis/)
})
