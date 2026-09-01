import test from 'node:test'
import assert from 'node:assert/strict'
import {
  growthStageAt, createGrowthSnapshot, updateGrowthSnapshot,
  createContextSnapshot, reduceContextSnapshot,
} from '../lib/growth.js'

test('six growth stages clamp thresholds and progress', () => {
  assert.equal(growthStageAt(-2).stage, 'newborn')
  assert.equal(growthStageAt(20).stage, 'growth')
  assert.equal(growthStageAt(95).stage, 'critical')
  assert.equal(growthStageAt(200).progress, 1)
})

test('growth transition is deduplicated for same stage', () => {
  const first = createGrowthSnapshot(10, 5)
  const same = updateGrowthSnapshot(first, 15, 9)
  assert.equal(same.changed, false)
  assert.equal(same.transitionId, 0)
  const next = updateGrowthSnapshot(same, 40)
  assert.equal(next.changed, true)
  assert.equal(next.transitionId, 1)
})

test('real compact follows ARMED, EATING, DIGESTING; simulation cannot fake it', () => {
  let state = createContextSnapshot(96)
  state = reduceContextSnapshot(state, { type: 'compact-start', source: 'simulated' })
  assert.equal(state.state, 'ARMED')
  state = reduceContextSnapshot(state, { type: 'compact-start', source: 'real' })
  assert.equal(state.state, 'EATING')
  state = reduceContextSnapshot(state, { type: 'compact-end', source: 'real' })
  assert.equal(state.state, 'DIGESTING')
  const duplicate = reduceContextSnapshot(state, { type: 'compact-end', source: 'real' })
  assert.equal(duplicate.changed, false)
})
