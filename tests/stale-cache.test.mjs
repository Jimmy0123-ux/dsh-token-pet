import assert from 'node:assert/strict'
import test from 'node:test'
import { StaleWhileRevalidate } from '../src/stale-cache.ts'

test('repeated status inspections serve the cached snapshot and share one stale refresh', async () => {
  let now = 0
  let loads = 0
  let release
  const cache = new StaleWhileRevalidate(async () => {
    loads++
    if (loads === 2) await new Promise(resolve => { release = resolve })
    return { generation: loads }
  }, 100, () => now)

  const cold = cache.inspect()
  assert.equal(cold.value, undefined)
  assert.equal(cold.refreshing, true)
  assert.deepEqual(await cold.refresh, { generation: 1 })

  assert.deepEqual(cache.inspect(), { value: { generation: 1 }, refreshing: false })
  now = 101
  const stale = cache.inspect()
  const repeated = cache.inspect()
  assert.deepEqual(stale.value, { generation: 1 })
  assert.deepEqual(repeated.value, { generation: 1 })
  assert.equal(stale.refresh, repeated.refresh)
  assert.equal(loads, 2)
  release()
  assert.deepEqual(await stale.refresh, { generation: 2 })
  assert.equal(cache.inspect().refreshing, false)
})
