/**
 * The built plugin, driven by a real ESLint.
 *
 * The vitest suite imports `src/`. This one imports `dist/`, loads it into an
 * actual `ESLint` instance with an actual Vue parser, and lints an actual file
 * - so it is the only check that can fail when the published shape is wrong
 * while every unit test still passes: a worker path that resolved from `src/`
 * and not from `dist/`, an export that the build renamed, a version the bundler
 * substituted incorrectly.
 *
 * `node scripts/smoke.mjs`, after `dist/` exists.
 *
 * Exit codes: 0 every check passed - 1 at least one did not.
 */
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const fixture = join(root, 'test', 'fixtures', 'basic')
const configPath = join(fixture, 'uno.config.ts')

const plugin = (await import(pathToFileURL(join(root, 'dist', 'index.mjs')).href)).default
const { ESLint } = await import('eslint')
const vueParser = await import('vue-eslint-parser')

const lint = async (code, options = {}) => {
  const eslint = new ESLint({
    cwd: root,
    overrideConfigFile: true,
    overrideConfig: [{
      files: ['**/*.vue'],
      languageOptions: { parser: vueParser, ecmaVersion: 2022, sourceType: 'module' },
      plugins: { 'unocss-normalize': plugin },
      rules: { 'unocss-normalize/classes': ['error', { configPath, ...options }] },
    }],
    fix: true,
  })
  const [result] = await eslint.lintText(code, { filePath: join(fixture, 'smoke.vue') })
  return result
}

const checks = []
const check = (name, fn) => checks.push({ name, fn })

check('the entry point exports the plugin and its parts', async () => {
  const api = await import(pathToFileURL(join(root, 'dist', 'index.mjs')).href)
  for (const name of ['planRewrite', 'isEquivalent', 'computedDeclarations', 'collapsibleShortcuts', 'planForConfig', 'classes']) {
    assert.ok(name in api, 'missing export: ' + name)
  }
  assert.ok(api.default.rules.classes, 'the plugin exposes no `classes` rule')
})

check('the plugin reports the version package.json declares', () => {
  assert.equal(plugin.meta.version, pkg.version)
})

check('the recommended config names the rule it ships', () => {
  const [entry] = plugin.configs.recommended
  assert.deepEqual(Object.keys(entry.rules), ['unocss-normalize/classes'])
  assert.deepEqual(entry.files, ['**/*.vue'])
})

check('a blocklist fix that proves is applied', async () => {
  const result = await lint('<template><div class="border opacity-50" /></template>')
  assert.equal(result.output, '<template><div class="b op-50" /></template>')
})

check('a shortcut collapses', async () => {
  const result = await lint('<template><div class="flex justify-center gap-2 items-center" /></template>')
  assert.equal(result.output, '<template><div class="flex center gap-2" /></template>')
})

check('a fix that changes the rendered CSS is reported and never written', async () => {
  const result = await lint('<template><div class="blur-[4px]" /></template>')
  assert.equal(result.output, undefined, 'the rule rewrote a class list it could not prove')
  assert.equal(result.messages.length, 1)
  assert.match(result.messages[0].message, /generates different CSS/)
})

check('the example file is fixed exactly as far as it can be proved', async () => {
  const result = await lint(readFileSync(join(fixture, 'example.vue'), 'utf8'))
  assert.match(result.output, /class="b op-50"/)
  assert.match(result.output, /class="flex center gap-2"/)
  // `size-4` is provable and expands; `blur-[4px]` sits right next to it and is not.
  assert.match(result.output, /class="w-4 h-4 blur-\[4px\]"/)
})

let failed = 0
console.log('\nSmoke test on Node ' + process.version)
console.log('-'.repeat(28 + process.version.length))
for (const { name, fn } of checks) {
  try {
    await fn()
    console.log('PASS  ' + name)
  } catch (err) {
    failed++
    console.log('FAIL  ' + name)
    console.log('        ' + (err instanceof Error ? err.message : String(err)))
  }
}
console.log('')
console.log(checks.length + ' checked - ' + failed + ' failed')
console.log('')
process.exit(failed === 0 ? 0 : 1)
