import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const local = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const version = process.argv[2] ?? local.version
const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(local.name)}/${encodeURIComponent(version)}`)
assert.equal(response.ok, true, `npm metadata request failed: ${response.status}`)
const published = await response.json()

assert.equal(published.name, local.name)
assert.equal(published.version, version)
assert.equal(published.repository?.url, local.repository?.url)
assert.equal(published.dsh?.bundle?.patch, './cordis.patch.yml')
assert.match(published.dist?.tarball ?? '', /^https:\/\/registry\.npmjs\.org\//)
assert.match(published.dist?.shasum ?? '', /^[0-9a-f]{40}$/)

console.log(JSON.stringify({
  ok: true,
  package: `${published.name}@${published.version}`,
  tarball: published.dist.tarball,
  shasum: published.dist.shasum,
}, null, 2))
