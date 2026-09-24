import { readFileSync } from 'node:fs'
import { defineConfig } from 'tsdown'

/**
 * The version the plugin reports to ESLint is substituted from `package.json`
 * at build time. ESLint reads `plugin.meta.version` when it prints which plugin
 * a rule came from, and a version written down twice is a version that can
 * disagree with itself.
 */
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string
}

export default defineConfig({
  // Named entries, so the published paths are the ones `package.json` promises
  // in `exports`. `worker` is a real entry rather than a chunk: the rule
  // resolves it by path at runtime to hand it to synckit, and a hashed or
  // renamed chunk would break that lookup silently.
  entry: {
    index: 'src/index.ts',
    // Importable from a `uno.config.ts`, which the build loads too - so it
    // must not drag in the rule, whose module scope starts a worker.
    config: 'src/config.ts',
    // A Nuxt module. Its own entry so `@nuxt/kit` - an optional peer - is only
    // ever imported by a project that registers the module.
    nuxt: 'src/nuxt.ts',
    worker: 'src/worker.ts',
  },
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  dts: true,
  clean: true,
  hash: false,
  outExtensions: () => ({ js: '.mjs', dts: '.d.mts' }),
  define: { __PLUGIN_VERSION__: JSON.stringify(pkg.version) },
  // The package's own shape is a claim too: publint checks the manifest against
  // what is in the tarball, attw checks the types resolve for the consumers
  // `exports` says are supported.
  publint: true,
  attw: true,
})
