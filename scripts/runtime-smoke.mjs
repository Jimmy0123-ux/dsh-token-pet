const base = process.env.DSH_WEB_URL || 'http://127.0.0.1:43120'
const states = new Set(['missing', 'building', 'partial', 'syncing', 'ready', 'cancelled', 'error'])

async function request(path, init) {
  const response = await fetch(`${base}${path}`, init)
  const text = await response.text()
  let body
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  return { response, body }
}

const index = await request('/token-pet/index/status')
if (!index.response.ok) throw new Error(`index status HTTP ${index.response.status}: ${JSON.stringify(index.body)}`)
if (!states.has(index.body?.status)) throw new Error(`old or invalid index contract: ${JSON.stringify(index.body)}`)
if (typeof index.body.persisted !== 'boolean' || typeof index.body.usable !== 'boolean') throw new Error('index status lacks persisted/usable flags')

const lifetime = await request('/token-pet/usage/lifetime')
if (!lifetime.response.ok) throw new Error(`lifetime HTTP ${lifetime.response.status}: ${JSON.stringify(lifetime.body)}`)
if (!lifetime.body?.totals || typeof lifetime.body.total !== 'number') throw new Error('invalid Lifetime Ledger response')

for (const path of ['/token-pet/prompt/enhance', '/token-pet/usage/reset', '/token-pet/usage/restore']) {
  const guarded = await request(path)
  if (guarded.response.status !== 405) throw new Error(`${path} GET must be rejected with 405; got ${guarded.response.status}`)
}

let sync
if (index.body.status === 'partial') {
  sync = await request('/token-pet/index/sync', { method: 'POST' })
  if (![200, 202, 409].includes(sync.response.status)) throw new Error(`incremental sync HTTP ${sync.response.status}: ${JSON.stringify(sync.body)}`)
}

console.log(JSON.stringify({
  ok: true,
  base,
  index: {
    status: index.body.status,
    persisted: index.body.persisted,
    usable: index.body.usable,
    listed: index.body.listed,
    closed: index.body.closed,
    live: index.body.live,
    indexed: index.body.indexed,
    pending: index.body.pending,
  },
  lifetime: {
    sessions: lifetime.body.sessions,
    total: lifetime.body.total,
    refreshFailed: lifetime.body.refreshFailed,
    models: Array.isArray(lifetime.body.models) ? lifetime.body.models.length : 0,
  },
  sync: sync ? { status: sync.response.status, body: sync.body } : null,
}, null, 2))
