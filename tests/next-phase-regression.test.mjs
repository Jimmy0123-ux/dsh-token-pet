import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { PET_ACTION_PRIORITY } from '../src/client/events.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const readJson = async path => JSON.parse((await readFile(resolve(root, path), 'utf8')).replace(/^\uFEFF/, ''))
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const exists = path => access(resolve(root, path)).then(() => true, () => false)
const actions = ['idle', 'working', 'eating', 'digesting', 'warning', 'evolve', 'click', 'archive', 'tool-success', 'tool-failure', 'prompt-enhancing', 'prompt-ready']

const identitySha = '3df1cea1a9bfdc3ae1c1159e4af6701654caab3cb473d45dba1c6a74e3b3327c'

test('QPet production owns one fixed identity and no deprecated visual trees', async () => {
  const identity = await readFile(resolve(root, 'assets/qpet/identity/qpet-stage-01-newborn-v02-resident.png'))
  assert.equal(digest(identity), identitySha)
  assert.equal(await exists('assets/qpet/stages'), false)
  assert.equal(await exists('assets/qpet/adult'), false)
  assert.equal(await exists('assets/qpet/archive'), false)
  assert.equal(await exists('assets/qpet/identity/qpet-stage-01-newborn-v01-approved.png'), false)
})

test('single-form action contract preserves exactly the production PetAction registry', async () => {
  const contract = await readJson('assets/qpet/contracts/action-video-contract.v1.json')
  assert.equal(contract.visualDerivation, 'disabled')
  assert.equal(contract.matrixPolicy.logicalSlots, 12)
  assert.equal(contract.matrixPolicy.forbidStageQualifiedAssets, true)
  assert.deepEqual([...contract.matrixPolicy.allowedActionsOnly].sort(), Object.keys(PET_ACTION_PRIORITY).sort())
  assert.deepEqual(contract.matrixPolicy.allowedActionsOnly, actions)
  assert.equal(contract.identityPolicy.identity.sha256, identitySha)
  assert.equal(contract.actions.idle.status, 'integrated')
  assert.equal(contract.actions.evolve.semantic, 'celebration-only-no-visual-derivation')
})

test('manifest reports all twelve common actions complete', async () => {
  const manifest = await readJson('assets/qpet/manifest.draft.json')
  const x = manifest['x-production']
  assert.equal(x.visualDerivation, 'disabled')
  assert.equal(x.logicalSlotCount, 12)
  assert.equal('plannedStages' in x, false)
  assert.deepEqual(x.plannedActions, actions)
  assert.deepEqual(x.completedActions, actions)
  assert.deepEqual(x.remainingActions, [])
  assert.equal(manifest.animations.idle.frames, 32)
  assert.equal(manifest.animations.idle.loop, true)
  assert.equal(manifest.animations.idle.file, '../pet/action-sheets/idle.webp')
  assert.equal('idleProgress' in x, false)
  assert.equal('archivedVisualDerivations' in x, false)
})

test('single-form contract marks every production action integrated', async () => {
  const contract = await readJson('assets/qpet/contracts/action-video-contract.v1.json')
  for (const action of actions) {
    assert.equal(contract.actions[action].status, 'integrated', `contract action not integrated: ${action}`)
  }
  assert.equal(contract.actions.idle.loop, true)
  assert.equal(contract.actions.evolve.semantic, 'celebration-only-no-visual-derivation')
  assert.equal(contract.actions.working.loop, true)
  assert.equal(contract.actions.warning.loop, true)
  assert.equal(contract.actions['prompt-enhancing'].loop, true)
})

test('action request and review schemas reject stage-qualified production', async () => {
  const [requestSchema, reviewSchema, requestTemplate, reviewTemplate] = await Promise.all([
    readJson('assets/qpet/contracts/action-request-record.schema.v2.json'),
    readJson('assets/qpet/contracts/action-review-record.schema.v2.json'),
    readJson('assets/qpet/contracts/action-video-request.template.json'),
    readJson('assets/qpet/contracts/action-video-review.template.json'),
  ])
  assert.equal(requestSchema.properties.stage, undefined)
  assert.equal(reviewSchema.properties.stage, undefined)
  assert.equal(requestSchema.properties.pressureBandIndependent.const, true)
  assert.equal(reviewSchema.properties.pressureBandIndependent.const, true)
  assert.equal(requestTemplate.pressureBandIndependent, true)
  assert.equal(reviewTemplate.pressureBandIndependent, true)
  assert.match(requestTemplate.references[0].path, /identity\/qpet-stage-01/)
})

test('asset audit remains the single-form maintenance gate', async () => {
  const pkg = await readJson('package.json')
  assert.equal(pkg.scripts['audit:qpet-art'], 'node scripts/qpet-asset-audit.mjs')
})

test('published package ships one embedded client without duplicate art or sourcemaps', async () => {
  const pkg = await readJson('package.json')
  assert.deepEqual(pkg.files, ['lib', 'client/client.js', 'cordis.patch.yml', 'README.md', 'CHANGELOG.md', 'LICENSE'])
  assert.equal(pkg.files.includes('assets/pet'), false)
  assert.equal(pkg.files.includes('client'), false)
  const config = await readFile(resolve(root, 'tsdown.config.mjs'), 'utf8')
  assert.match(config, /sourcemap:\s*false/)
  assert.match(config, /clean:\s*true/)
})

test('all twelve action sprite sheets exist as feet-anchored WebP strips', async () => {
  const SHEET_H = 540
  const generated = await readFile(resolve(root, 'src/client/pet-action-sheets.generated.ts'), 'utf8')
  const productionSourcesPresent = await exists('Review/h3-actions')
  for (const action of actions) {
    const entry = generated.indexOf(`'${action}': {`)
    assert.notEqual(entry, -1, `generated registry missing action: ${action}`)
    const block = generated.slice(entry, generated.indexOf('},', entry))
    assert.match(block, /sheet: 'data:image\/webp;base64,/, `not an embedded WebP strip: ${action}`)
    assert.match(block, new RegExp(`file: '${action}\\.webp',`), `strip file metadata missing: ${action}`)
    const count = 32
    assert.match(block, new RegExp(`frames: ${count},`), `bad frame count: ${action}`)
    assert.match(block, /frameW: \d+,/, `bad frameW: ${action}`)
    assert.match(block, new RegExp(`frameH: ${SHEET_H},`), `bad frameH: ${action}`)
    assert.match(block, /cols: \d+,\r?\n/, `bad cols: ${action}`)
    assert.match(block, /rows: \d+,\r?\n/, `bad rows: ${action}`)
    assert.match(block, new RegExp(`pingPong: ${action === 'prompt-enhancing'},`), `bad pingPong mode: ${action}`)
    assert.match(block, /bodyHeight: 480,/, `bad bodyHeight: ${action}`)
    assert.match(block, /feetY: 520,/, `bad feet baseline: ${action}`)
    assert.equal(await exists(`assets/pet/action-sheets/${action}.webp`), true, `missing composite strip file: ${action}`)
    if (productionSourcesPresent) {
      assert.equal(await exists(`Review/h3-actions/${action}/transparent_frames_webp`), true, `missing optional production frames: ${action}`)
    }
  }
})
