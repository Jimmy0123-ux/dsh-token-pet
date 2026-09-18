// Simulate DSH's browser module loader (`window.__ModuleLoader__.load`) to
// prove the client bundle initializes without any missed-module error.
const fs = require('fs')

const code = fs.readFileSync('H:/ds/dsh-token-pet/client/client.js', 'utf8')

const loaded = {}
globalThis.window = globalThis
globalThis.__ModuleLoader__ = {
  load({ id, factory }) {
    const module = { exports: {} }
    const requireFn = (spec) => {
      if (spec === 'react' || spec === 'react-dom') return require(spec)
      throw new Error(`missed the module table: "${spec}"`)
    }
    factory(requireFn)
    loaded[id] = module.exports
  },
}

try {
  new Function(code)()
  const keys = Object.keys(loaded)
  console.log('loader ok, loaded ids:', keys.join(', '))
  const exp = loaded['dsh-token-pet']
  console.log('exports type:', typeof exp)
  console.log('has apply:', typeof exp?.apply)
  if (keys.length !== 1 || typeof exp?.apply !== 'function') {
    console.error('UNEXPECTED_BUNDLE')
    process.exit(1)
  }
  console.log('SIMULATION_PASS')
} catch (error) {
  console.error('SIMULATION_FAIL:', error && error.stack ? error.stack : error)
  process.exit(1)
}
