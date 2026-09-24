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

check('the config subpath imports without starting a worker', async () => {
  const { hideFixes } = await import(pathToFileURL(join(root, 'dist', 'config.mjs')).href)
  const [[, meta]] = hideFixes([[/^border$/, { message: 'use "b"', fix: () => ['b'] }]])

  assert.equal(typeof meta.fix, 'function', 'the fix must stay readable')
  assert.deepEqual(Object.keys({ ...meta }), ['message'], 'no function may survive a spread')
})

/**
 * The bare specifiers a built file reaches, following its relative imports
 * through the chunks the bundler split out. Parsed from `import … from` rather
 * than grepped for, because a comment that mentions a package is not an import.
 */
function reachableSpecifiers(entry) {
  const seen = new Set()
  const specifiers = new Set()
  const visit = (file) => {
    if (seen.has(file)) return
    seen.add(file)
    for (const [, specifier] of readFileSync(file, 'utf8').matchAll(/^import\s[^;]*?from\s+"([^"]+)"/gm)) {
      if (specifier.startsWith('.')) visit(join(dirname(file), specifier))
      else specifiers.add(specifier)
    }
  }
  visit(join(root, 'dist', entry))
  return specifiers
}

check('only the nuxt subpath reaches @nuxt/kit, an optional peer', () => {
  for (const entry of ['index.mjs', 'config.mjs', 'worker.mjs']) {
    const reached = [...reachableSpecifiers(entry)].filter((specifier) => specifier.startsWith('@nuxt/'))
    assert.deepEqual(reached, [], entry + ' would fail to load in a project without Nuxt')
  }
  assert.ok(reachableSpecifiers('nuxt.mjs').has('@nuxt/kit'), 'the nuxt subpath no longer imports @nuxt/kit')
})

check('the nuxt subpath exports a Nuxt module', async () => {
  const module = (await import(pathToFileURL(join(root, 'dist', 'nuxt.mjs')).href)).default
  const meta = await module.getMeta()
  assert.equal(meta.name, 'uno-themed-configs')
  assert.equal(meta.configKey, 'unoThemedConfigs')
})

check('themedConfigs reads what the nuxt subpath writes', async () => {
  const { themedConfigs } = await import(pathToFileURL(join(root, 'dist', 'index.mjs')).href)
  const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')

  const project = mkdtempSync(join(tmpdir(), 'smoke-themed-'))
  try {
    mkdirSync(join(project, '.nuxt', 'uno', 'config'), { recursive: true })
    writeFileSync(join(project, '.nuxt', 'uno', 'config', 'dark.mjs'), '')

    const blocks = themedConfigs({ themes: { dark: 'themes/dark', light: 'themes/light' }, rootDir: project })
    assert.deepEqual(blocks.map((block) => block.files), [['themes/dark/**/*.vue']])
    assert.equal(blocks[0].plugins['unocss-normalize'], plugin, 'a second plugin object would clash in ESLint')
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
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

check('the example component is fixed exactly as far as it can be proved', async () => {
  const source = readFileSync(join(fixture, 'example.vue'), 'utf8')
  const result = await lint(source)
  const output = result.output

  // every blocklist entry form, through the built worker
  assert.match(output, /class="w-4 h-4 flex"/, 'one token expanding into two')
  assert.match(output, /class="ws-nowrap lh-4"/, 'a string entry and a predicate entry')
  assert.match(output, /class="w-4 h-4 squircle"/, 'a chain, resolved in one pass')

  // variants survive the expand/rewrite/collapse round trip
  assert.match(output, /class="hover:\(b op-50\) @hover:b sm:hover:!b"/, 'variants and groups')

  // a multi-line attribute stays multi-line, and the shortcut still collapses
  assert.ok(
    output.includes('class="\n        b\n        op-50\n        center\n      "'),
    'a multi-line attribute was not kept multi-line',
  )

  // what must not be touched
  assert.match(output, /const fallbackClasses = 'border opacity-50'/, 'the script block')
  assert.match(output, /\.border \{/, 'the style block')
  assert.match(output, /:class="\{ 'opacity-50': loading \}"/, 'a dynamic binding')
  assert.match(output, /<span border op-50 \/>/, 'valueless attributify attributes')
  assert.match(output, /class="float-left"/, 'a blocklist entry with no fix')
  assert.match(output, /class="my-own-class another-one"/, 'classes the config does not know')

  // the refusals, still reported after the fix pass
  assert.match(output, /class="b blur-\[4px\] text-center"/, 'the provable half fixed, the rest left')
  assert.equal(result.messages.length, 2, 'two refusals reported')
  for (const message of result.messages) assert.match(message.message, /generates different CSS/)
})

check('fixing is idempotent - a second pass over the output changes nothing', async () => {
  const once = await lint(readFileSync(join(fixture, 'example.vue'), 'utf8'))
  const twice = await lint(once.output)
  assert.equal(twice.output, undefined, 'the rule kept rewriting its own output')
})

check('a config that never declared a fix still collapses shortcuts', async () => {
  const noFixes = join(root, 'test', 'fixtures', 'no-fixes', 'uno.config.ts')
  const collapsed = await lint('<template><div class="items-center justify-center" /></template>', { configPath: noFixes })
  assert.equal(collapsed.output, '<template><div class="center" /></template>')

  const untouched = await lint('<template><div class="border" /></template>', { configPath: noFixes })
  assert.equal(untouched.output, undefined, 'a blocklist without fixes rewrote something')
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
