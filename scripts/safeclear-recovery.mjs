import { n as DesktopInstallRecoveryStore } from 'file:///H:/Program%20Files/DSH%20Desktop/resources/app.asar.unpacked/lib/install-recovery--Fr93IAh.js'
import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const STATE = 'C:/Users/Administrator.CHINAMI-LGIVRJF/AppData/Roaming/DSH Desktop/plugin-install-recovery/state.json'
const PROFILE_DIR = 'C:/Users/Administrator.CHINAMI-LGIVRJF/.dsh/profiles/desktop'
const PROFILE_NAME = 'desktop'

const statePath = STATE
const store = new DesktopInstallRecoveryStore({
  statePath,
  profileName: PROFILE_NAME,
  profileDir: PROFILE_DIR,
  generationId: `agent-safeclear:${randomUUID()}`,
})
void sha

function sha(text) {
  return createHash('sha256').update(text).digest('hex')
}

const current = await store.read()
if (current === undefined) {
  console.log('NO_PENDING_TRANSACTION (nothing to clear)')
  process.exit(0)
}
console.log('phase:', current.phase, 'transactionId:', current.transactionId)

// Since the state is a completed install awaiting its restart-confirmation,
// the faithful resolution is to verify disk == sealed AFTER, then mark healthy.
async function verifyDiskMatchesAfter() {
  const bad = []
  for (const file of current.files) {
    const p = `${PROFILE_DIR}/${file.name}`
    let text
    try { text = await readFile(p, 'utf8') } catch { bad.push(`${file.name}:MISSING`); continue }
    const h = sha(text).toUpperCase()
    const after = file.after?.sha256?.toUpperCase()
    if (after === undefined || h !== after) bad.push(`${file.name}:${h.slice(0, 12)}≠after:${after?.slice(0, 12)}`)
  }
  return bad
}

if (current.phase === 'awaiting-restart' || current.phase === 'verifying') {
  const mismatches = await verifyDiskMatchesAfter()
  console.log('mismatches:', mismatches.length === 0 ? 'none (disk==sealed AFTER)' : mismatches.join(', '))
  if (mismatches.length > 0) {
    console.log('ABORT_SAFE_CLEAR: disk does not match sealed AFTER — not clearing (would not be faithful).')
    process.exit(2)
  }
  // Drive the store's own transitions.
  const claim = await store.claim()
  console.log('claim action:', JSON.stringify(claim))
  if (claim.action === 'verify' || claim.action === 'terminal' || claim.action === 'none') {
    // claim transitioned awaiting-restart -> verifying (same generation); now mark healthy.
    try {
      await store.markHealthy(current.transactionId)
      console.log('markHealthy: OK')
    } catch (e) {
      console.log('markHealthy error:', e.message)
    }
  }
  const after = await store.read()
  console.log('phase after markHealthy:', after?.phase)
  if (after !== undefined && (after.phase === 'verified' || after.phase === 'rolled-back')) {
    await store.clear(after.transactionId)
    console.log('cleared WAL')
  }
} else {
  console.log('UNEXPECTED_PHASE; please review manually:', current.phase)
  process.exit(3)
}

const finalState = await store.read()
console.log('final read:', finalState === undefined ? 'WAL_CLEARED' : `phase=${finalState.phase}`)
