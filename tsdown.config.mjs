// Client bundle for dsh-token-pet: emits the __ModuleLoader__.load factory the
// dsh web plugin table serves at /plugins/dsh-token-pet/client.js. Externals are
// exactly the loader module-table platform entries; everything else inlines.
// We use `react` via createElement (jsx: react) so the ONLY runtime external
// needed for rendering is `react`; the slot/service faces are injected.
import { defineConfig } from 'tsdown'

const ID = 'dsh-token-pet'

const PLATFORM_EXTERNALS = [
  'react',
  'react-dom',
  '@deepseek-ai/cordis',
]

export default defineConfig({
  name: `${ID}/client`,
  entry: { client: 'src/client/index.ts' },
  outDir: 'client',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  // Production ships one self-contained client.js. Source maps and the
  // standalone action-sheet files duplicate the same embedded WebP bytes and
  // are deliberately excluded from the published package.
  sourcemap: false,
  clean: true,
  deps: {
    neverBundle: PLATFORM_EXTERNALS,
    // Do not bundle or externalize arbitrary npm packages. The loader only
    // resolves the explicitly registered platform entries above; ZIP handling
    // remains host-owned and the client has no fflate dependency.
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
