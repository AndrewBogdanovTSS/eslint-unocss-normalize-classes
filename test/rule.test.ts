/**
 * The rule, through ESLint's own RuleTester.
 *
 * This is the only suite that crosses the worker boundary, so it is the one
 * that would catch a `fix` function being sent where only strings can go, or a
 * worker path that resolves from `src/` and not from `dist/`. It needs
 * `dist/worker.mjs` on disk - `pnpm test` builds first for exactly that reason.
 *
 * What it checks that `session.test.ts` cannot: which attributes the rule looks
 * at, what it writes back into the source text, and what it reports.
 */
import { readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { RuleTester } from 'eslint'
import * as vueParser from 'vue-eslint-parser'
import { describe, it } from 'vitest'
import rule from '../src/rule'

/**
 * The rule loads its worker from `dist/`, while every other suite imports
 * `src/`. Running this one against a stale build tests code that is no longer
 * in the repository and reports it as a pass - which happened once already,
 * and is exactly the kind of unbacked pass this package exists to prevent.
 */
function assertWorkerIsCurrent(): void {
  const worker = fileURLToPath(new URL('../dist/worker.mjs', import.meta.url))
  const source = fileURLToPath(new URL('../src', import.meta.url))

  const builtAt = statSync(worker).mtimeMs
  const newestSource = readdirSync(source, { recursive: true, encoding: 'utf8' })
    .filter((entry) => entry.endsWith('.ts'))
    .map((entry) => statSync(`${source}/${entry}`).mtimeMs)
    .reduce((newest, at) => Math.max(newest, at), 0)

  if (newestSource > builtAt) {
    throw new Error(
      'dist/worker.mjs is older than src/. This suite would have tested the '
      + 'previous build - run `pnpm build`, or `pnpm test`, which builds first.',
    )
  }
}

assertWorkerIsCurrent()

const configPath = fileURLToPath(new URL('./fixtures/basic/uno.config.ts', import.meta.url))
const noFixesConfigPath = fileURLToPath(new URL('./fixtures/no-fixes/uno.config.ts', import.meta.url))
const options = [{ configPath }]

// RuleTester drives its own test framework. Handing it vitest's makes each
// case a named test, so a failure names the case instead of the whole suite.
RuleTester.describe = describe
RuleTester.it = it
RuleTester.itOnly = it.only

const ruleTester = new RuleTester({
  languageOptions: {
    parser: vueParser,
    ecmaVersion: 2022,
    sourceType: 'module',
  },
})

ruleTester.run('unocss-normalize/classes', rule, {
  valid: [
    {
      name: 'a class list already written in the project vocabulary',
      code: '<template><div class="b op-50 center" /></template>',
      options,
    },
    {
      name: 'classes the config says nothing about',
      code: '<template><div class="my-own-class another" /></template>',
      options,
    },
    {
      name: 'a project rule the plugin has no opinion on',
      code: '<template><div class="squircle" /></template>',
      options,
    },
    {
      name: 'an empty class attribute',
      code: '<template><div class="" /></template>',
      options,
    },
    {
      name: 'a whitespace-only class attribute',
      code: '<template><div class="   " /></template>',
      options,
    },
    {
      name: 'a partial shortcut match',
      code: '<template><div class="items-center gap-2" /></template>',
      options,
    },
    {
      name: 'a blocklist entry with no fix, which unocss/blocklist reports instead',
      code: '<template><div class="float-left" /></template>',
      options,
    },

    // --- attributes the rule deliberately does not read ---
    {
      name: 'a shorthand dynamic binding',
      code: '<template><div :class="active ? \'border\' : \'opacity-50\'" /></template>',
      options,
    },
    {
      name: 'a long-form dynamic binding',
      code: '<template><div v-bind:class="\'border\'" /></template>',
      options,
    },
    {
      name: 'an object binding',
      code: '<template><div :class="{ border: isActive }" /></template>',
      options,
    },
    {
      name: 'a class-like string in the script block',
      code: '<template><div /></template><script setup>const cls = "border opacity-50"</script>',
      options,
    },
    {
      name: 'a selector in the style block',
      code: '<template><div /></template><style>.border { color: red }</style>',
      options,
    },
    {
      name: 'valueless attributes, which are attributify territory rather than a class list',
      code: '<template><div border op-50 /></template>',
      options,
    },

    // --- options ---
    {
      name: 'an unprovable fix, when the report is turned off',
      code: '<template><div class="blur-[4px]" /></template>',
      options: [{ configPath, reportUnproven: false }],
    },
    {
      name: 'a shortcut, when the shortcut source is off',
      code: '<template><div class="items-center justify-center" /></template>',
      options: [{ configPath, shortcuts: false }],
    },
    {
      name: 'a blocklist fix, when the blocklist source is off',
      code: '<template><div class="border" /></template>',
      options: [{ configPath, blocklist: false }],
    },
    {
      name: 'a config that never declared a fix',
      code: '<template><div class="border" /></template>',
      options: [{ configPath: noFixesConfigPath }],
    },
  ],

  invalid: [
    {
      name: 'a blocklist fix that proves',
      code: '<template><div class="border opacity-50" /></template>',
      output: '<template><div class="b op-50" /></template>',
      options,
      errors: [{ messageId: 'normalize' }],
    },
    {
      name: 'one token expanding into two',
      code: '<template><div class="size-4 flex" /></template>',
      output: '<template><div class="w-4 h-4 flex" /></template>',
      options,
      errors: [{ messageId: 'normalize' }],
    },
    {
      name: 'a chain of fixes, resolved in one pass',
      code: '<template><div class="size-1rem" /></template>',
      output: '<template><div class="w-4 h-4" /></template>',
      options,
      errors: [{ messageId: 'normalize' }],
    },
    {
      name: 'a shortcut collapse',
      code: '<template><div class="flex justify-center gap-2 items-center" /></template>',
      output: '<template><div class="flex center gap-2" /></template>',
      options,
      errors: [{ messageId: 'normalize' }],
    },
    {
      name: 'both sources in one attribute',
      code: '<template><div class="border items-center justify-center" /></template>',
      output: '<template><div class="b center" /></template>',
      options,
      errors: [{ messageId: 'normalize' }],
    },
    {
      name: 'a variant group',
      code: '<template><div class="hover:(border opacity-50)" /></template>',
      output: '<template><div class="hover:(b op-50)" /></template>',
      options,
      errors: [{ messageId: 'normalize' }],
    },
    {
      name: 'a project-defined variant',
      code: '<template><div class="@hover:border" /></template>',
      output: '<template><div class="@hover:b" /></template>',
      options,
      errors: [{ messageId: 'normalize' }],
    },
    {
      name: 'a variant and an important marker together',
      code: '<template><div class="sm:hover:!border" /></template>',
      output: '<template><div class="sm:hover:!b" /></template>',
      options,
      errors: [{ messageId: 'normalize' }],
    },

    // --- what it writes back into the source ---
    {
      name: 'a single-quoted attribute keeps its quotes',
      code: '<template><div class=\'border\' /></template>',
      output: '<template><div class=\'b\' /></template>',
      options,
      errors: [{ messageId: 'normalize' }],
    },
    {
      name: 'an unquoted attribute gets them',
      code: '<template><div class=border /></template>',
      output: '<template><div class="b" /></template>',
      options,
      errors: [{ messageId: 'normalize' }],
    },
    {
      name: 'a multi-line attribute stays multi-line',
      code: '<template>\n  <div\n    class="\n      border\n      opacity-50\n    "\n  />\n</template>',
      output: '<template>\n  <div\n    class="\n      b\n      op-50\n    "\n  />\n</template>',
      options,
      errors: [{ messageId: 'normalize' }],
    },
    {
      name: 'a multi-line attribute whose token count changes',
      code: '<template>\n  <div\n    class="\n      size-4\n      border\n    "\n  />\n</template>',
      output: '<template>\n  <div\n    class="\n      w-4\n      h-4\n      b\n    "\n  />\n</template>',
      options,
      errors: [{ messageId: 'normalize' }],
    },
    {
      name: 'a class attribute on a component tag',
      code: '<template><my-button class="border" /></template>',
      output: '<template><my-button class="b" /></template>',
      options,
      errors: [{ messageId: 'normalize' }],
    },
    {
      name: 'every class attribute in the file, reported separately',
      code: '<template><div class="border"><span class="opacity-50" /></div></template>',
      output: '<template><div class="b"><span class="op-50" /></div></template>',
      options,
      errors: [{ messageId: 'normalize' }, { messageId: 'normalize' }],
    },
    {
      name: 'a static class beside a dynamic one, where only the static one is touched',
      code: '<template><div class="border" :class="{ \'opacity-50\': on }" /></template>',
      output: '<template><div class="b" :class="{ \'opacity-50\': on }" /></template>',
      options,
      errors: [{ messageId: 'normalize' }],
    },

    // --- refusals ---
    {
      name: 'an unprovable fix is reported and not written',
      code: '<template><div class="blur-[4px]" /></template>',
      output: null,
      options,
      errors: [{
        messageId: 'unproven',
        data: { before: 'blur-[4px]', after: 'blur-1', source: 'blocklist' },
      }],
    },
    {
      name: 'the provable half is fixed while the unprovable half is reported',
      code: '<template><div class="border blur-[4px]" /></template>',
      output: '<template><div class="b blur-[4px]" /></template>',
      options,
      errors: [{ messageId: 'normalize' }, { messageId: 'unproven' }],
    },
    {
      name: 'two refusals in one attribute are reported one by one',
      code: '<template><div class="blur-[4px] text-center" /></template>',
      output: null,
      options,
      errors: [{ messageId: 'unproven' }, { messageId: 'unproven' }],
    },

    // --- configuration ---
    {
      name: 'the config is found through settings rather than the rule options',
      code: '<template><div class="border" /></template>',
      output: '<template><div class="b" /></template>',
      options: [{}],
      settings: { unocss: { configPath } },
      errors: [{ messageId: 'normalize' }],
    },
    {
      name: 'the no-fixes config still collapses a shortcut',
      code: '<template><div class="items-center justify-center" /></template>',
      output: '<template><div class="center" /></template>',
      options: [{ configPath: noFixesConfigPath }],
      errors: [{ messageId: 'normalize' }],
    },
  ],
})
