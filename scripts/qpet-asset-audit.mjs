import { createHash } from 'node:crypto'
import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(process.cwd())
const identityPath = resolve(root, 'assets/qpet/identity/qpet-stage-01-newborn-v02-resident.png')
const expectedIdentitySha = '3df1cea1a9bfdc3ae1c1159e4af6701654caab3cb473d45dba1c6a74e3b3327c'
const actions = ['idle', 'working', 'eating', 'digesting', 'warning', 'evolve', 'click', 'archive', 'tool-success', 'tool-failure', 'prompt-enhancing', 'prompt-ready']
// Runtime strips are WebP data URIs inside pet-action-sheets.generated.ts,
// built from the chroma-keyed H3 frames; every action plays all 32 cut frames.
const FRAME_COUNT = 32
const SHEET_W = 360
const SHEET_H = 540

const sha256 = data => createHash('sha256').update(data).digest('hex')
const json = async path => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''))
const exists = async path => access(path).then(() => true, () => false)
const problems = []
const check = (condition, message) => { if (!condition) problems.push(message) }

const [identity, manifest, contract, petSource, actionPlayerSource, actionSheetsSource] = await Promise.all([
  readFile(identityPath),
  json(resolve(root, 'assets/qpet/manifest.draft.json')),
  json(resolve(root, 'assets/qpet/contracts/action-video-contract.v1.json')),
  readFile(resolve(root, 'src/client/pet.tsx'), 'utf8'),
  readFile(resolve(root, 'src/client/pet-action-player.tsx'), 'utf8'),
  readFile(resolve(root, 'src/client/pet-action-sheets.generated.ts'), 'utf8'),
])

check(sha256(identity) === expectedIdentitySha, 'fixed identity SHA-256 changed')
check(manifest['x-production']?.visualDerivation === 'disabled', 'manifest visual derivation is not disabled')
check(manifest['x-production']?.logicalSlotCount === 12, 'manifest logical slot count is not 12')
check(manifest['x-production']?.plannedStages === undefined, 'manifest still declares plannedStages')
check(JSON.stringify(manifest['x-production']?.plannedActions) === JSON.stringify(actions), 'manifest action set mismatch')
check(JSON.stringify(manifest['x-production']?.completedActions) === JSON.stringify(actions), 'manifest must mark all 12 actions complete')
check((manifest['x-production']?.remainingActions ?? []).length === 0, 'manifest remainingActions must be empty')
check(contract.visualDerivation === 'disabled', 'action contract visual derivation is not disabled')
check(contract.matrixPolicy?.logicalSlots === 12, 'action contract logical slots is not 12')
check(contract.matrixPolicy?.forbidStageQualifiedAssets === true, 'stage-qualified action assets are not forbidden')
check(JSON.stringify(contract.matrixPolicy?.allowedActionsOnly) === JSON.stringify(actions), 'action contract action set mismatch')
check(contract.identityPolicy?.identity?.sha256 === expectedIdentitySha, 'action contract identity SHA mismatch')

// Generated registry: every action present, WebP data URI (embedded strips keep
// the animation working with zero host dependencies), plus the strip file name
// for the optional host-served lean mode.
check(/PET_ACTION_SHEET_SPECS/.test(actionSheetsSource), 'generated action sheet registry missing')
const productionSourcesPresent = await exists(resolve(root, 'Review/h3-actions'))
for (const action of actions) {
  check(manifest.animations?.[action] != null, `manifest missing animation entry for ${action}`)
  check(contract.actions?.[action]?.status === 'integrated', `contract action not integrated: ${action}`)
  const entry = actionSheetsSource.indexOf(`'${action}': {`)
  check(entry >= 0, `generated registry missing action: ${action}`)
  if (entry >= 0) {
    const next = actionSheetsSource.indexOf('},', entry)
    const block = actionSheetsSource.slice(entry, next)
    check(/sheet: 'data:image\/webp;base64,/.test(block), `action ${action} sheet is not an embedded WebP data URI`)
    check(new RegExp(`file: '${action}\\.webp',`).test(block), `action ${action} strip file metadata missing`)
    const frames = FRAME_COUNT
    check(block.includes(`frames: ${frames},`), `action ${action} does not have ${frames} frames`)
    check(/frameW: \d+,/.test(block), `action ${action} frameW missing`)
    check(/frameH: 540,/.test(block), `action ${action} frameH mismatch`)
    check(/cols: \d+,/.test(block), `action ${action} cols missing`)
    check(/rows: \d+,/.test(block), `action ${action} rows missing`)
    check(block.includes(`pingPong: ${action === 'prompt-enhancing'},`), `action ${action} pingPong mismatch`)
    check(block.includes('bodyHeight: 480,'), `action ${action} bodyHeight mismatch`)
    check(block.includes('feetY: 520,'), `action ${action} feet baseline missing`)
  }
  check(await exists(resolve(root, `assets/pet/action-sheets/${action}.webp`)), `missing composite strip file: ${action}`)
  if (productionSourcesPresent) {
    const webpDir = resolve(root, `Review/h3-actions/${action}/transparent_frames_webp`)
    check(await exists(webpDir), `missing optional production frames: ${action}`)
  }
}
check(/PetActionPlayer/.test(petSource), 'runtime renderer does not mount PetActionPlayer')
check(/h\('img'/.test(actionPlayerSource), 'action player does not render a real img strip')
check(/translate3d/.test(actionPlayerSource), 'action player does not use compositor transforms')
check(!/getContext\(['"]2d['"]\)|drawImage|h\('canvas'/.test(actionPlayerSource), 'action player still uses canvas resampling')
check(/incomingBuffer\.style\.visibility = 'hidden'/.test(actionPlayerSource), 'incoming buffer is not hidden before decode')
check(/data-buffer-slot/.test(actionPlayerSource) && /overflow: 'hidden'/.test(actionPlayerSource), 'per-layer cell clipping viewport is missing')
const staticStyleStart = actionPlayerSource.indexOf('const staticBufferStyle')
const staticStyleEnd = actionPlayerSource.indexOf('const viewport =', staticStyleStart)
const staticStyle = actionPlayerSource.slice(staticStyleStart, staticStyleEnd)
check(!/visibility:|opacity:|width:|height:/.test(staticStyle), 'React still owns dynamic layer styles')
check(!/PetIdlePlayer/.test(petSource), 'PetIdlePlayer still referenced in renderer (idle should use unified PetActionPlayer)')
check(!/dsh-pet-/.test(petSource), 'legacy dsh-pet animation names remain in runtime renderer')
check(!/animated\(/.test(petSource), 'legacy animated() helper remains in runtime renderer')
check(!(await exists(resolve(root, 'assets/qpet/archive'))), 'deprecated visual archive still present in public tree')
check(!(await exists(resolve(root, 'assets/qpet/stages'))), 'deprecated stage production directory still exists')

const report = {
  ok: problems.length === 0,
  identity: { path: identityPath, sha256: sha256(identity) },
  runtime: { idleCell: `${SHEET_W}x${SHEET_H}`, maxCellWidth: 660, format: 'webp-q90', completedActions: actions },
  visualDerivation: 'disabled',
  logicalSlots: 12,
  problems,
}
console.log(JSON.stringify(report, null, 2))
if (!report.ok) process.exitCode = 1
