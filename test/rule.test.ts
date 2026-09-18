/**
 * The rule, through ESLint's own RuleTester.
 *
 * This is the only suite that crosses the worker boundary, so it is also the
 * one that would catch a `fix` function being sent where only strings can go,
 * or a worker path that resolves in development and not from `dist/`. It needs
 * `dist/worker.mjs` on disk - `pnpm test` builds first for exactly that reason.
 */
import { fileURLToPath } from 'node:url'
import { RuleTester } from 'eslint'
import * as vueParser from 'vue-eslint-parser'
import { describe, it } from 'vitest'
import rule from '../src/rule'

const configPath = fileURLToPath(new URL('./fixtures/basic/uno.config.ts', import.meta.url))
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
      name: 'a dynamic class expression, which the rule deliberately ignores',
      code: '<template><div :class="active ? \'border\' : \'opacity-50\'" /></template>',
      options,
    },
    {
      name: 'an empty class attribute',
      code: '<template><div class="" /></template>',
      options,
    },
    {
      name: 'a partial shortcut match',
      code: '<template><div class="items-center gap-2" /></template>',
      options,
    },
    {
      name: 'an unprovable fix, when the report is turned off',
      code: '<template><div class="blur-[4px]" /></template>',
      options: [{ configPath, reportUnproven: false }],
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
      name: 'a shortcut collapse',
      code: '<template><div class="flex justify-center gap-2 items-center" /></template>',
      output: '<template><div class="flex center gap-2" /></template>',
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
      name: 'an unprovable fix is reported and not written',
      code: '<template><div class="blur-[4px]" /></template>',
      output: null,
      options,
      errors: [{ messageId: 'unproven' }],
    },
    {
      name: 'the provable half is fixed while the unprovable half is reported',
      code: '<template><div class="border blur-[4px]" /></template>',
      output: '<template><div class="b blur-[4px]" /></template>',
      options,
      errors: [{ messageId: 'normalize' }, { messageId: 'unproven' }],
    },
  ],
})
