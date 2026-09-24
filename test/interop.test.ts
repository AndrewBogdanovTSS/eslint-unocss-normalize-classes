/**
 * This rule beside `unocss/order`, the class sorter from `@unocss/eslint-plugin`.
 *
 * Both are fixable, both rewrite the same attribute, and ESLint applies fixes in
 * passes - so the pair can disagree forever, each undoing the other, and a lint
 * run that never settles is worse than either rule being wrong. Everything here
 * runs through a real `ESLint` instance with both rules on and `fix: true`, and
 * every case asserts the result is stable: fixing the output again changes
 * nothing.
 *
 * The division of labour that makes them compose: the sorter decides the order
 * of the tokens, this rule decides which tokens they are. Neither needs to know
 * about the other.
 */
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import unocss from '@unocss/eslint-config/flat'
import { ESLint } from 'eslint'
import type { Linter } from 'eslint'
import * as vueParser from 'vue-eslint-parser'
import { describe, expect, it } from 'vitest'
import { isEquivalent } from '../src/core/equivalence'
import rule from '../src/rule'
import { assertWorkerIsCurrent } from './helpers/worker-is-current'

assertWorkerIsCurrent()

const root = fileURLToPath(new URL('..', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/basic/uno.config.ts', import.meta.url))

const BOTH: Linter.RulesRecord = {
  'unocss-normalize/classes': ['error', { configPath }],
  'unocss/order': 'error',
}

const SORT_ONLY: Linter.RulesRecord = { 'unocss/order': 'error' }
const NORMALIZE_ONLY: Linter.RulesRecord = { 'unocss-normalize/classes': ['error', { configPath }] }

async function lint(code: string, rules: Linter.RulesRecord = BOTH) {
  const eslint = new ESLint({
    cwd: root,
    overrideConfigFile: true,
    overrideConfig: [{
      files: ['**/*.vue'],
      languageOptions: { parser: vueParser, ecmaVersion: 2022, sourceType: 'module' },
      plugins: { 'unocss-normalize': { rules: { classes: rule } }, unocss: unocss.plugins.unocss },
      settings: { unocss: { configPath } },
      rules,
    }],
    fix: true,
  })

  const [result] = await eslint.lintText(code, { filePath: join(root, 'test', 'fixtures', 'basic', 'interop.vue') })
  return result
}

/** Lint without fixing, so the problems ESLint would have repaired are visible. */
async function report(code: string, rules: Linter.RulesRecord = BOTH) {
  const eslint = new ESLint({
    cwd: root,
    overrideConfigFile: true,
    overrideConfig: [{
      files: ['**/*.vue'],
      languageOptions: { parser: vueParser, ecmaVersion: 2022, sourceType: 'module' },
      plugins: { 'unocss-normalize': { rules: { classes: rule } }, unocss: unocss.plugins.unocss },
      settings: { unocss: { configPath } },
      rules,
    }],
  })

  const [result] = await eslint.lintText(code, { filePath: join(root, 'test', 'fixtures', 'basic', 'interop.vue') })
  return result.messages
}

/** Fix, then fix the result again, and report whether the second pass moved. */
async function fixUntilStable(code: string, rules: Linter.RulesRecord = BOTH) {
  const first = await lint(code, rules)
  const output = first.output ?? code
  const second = await lint(output, rules)

  return {
    output,
    stable: second.output === undefined || second.output === output,
    messages: first.messages,
  }
}

describe('sorting and normalising the same attribute', () => {
  it.each([
    [
      'sorts and normalises in one run',
      '<template><div class="opacity-50 border flex" /></template>',
      '<template><div class="flex b op-50" /></template>',
    ],
    [
      'collapses a shortcut and sorts what is left',
      '<template><div class="justify-center gap-2 items-center flex" /></template>',
      '<template><div class="flex center gap-2" /></template>',
    ],
    [
      'keeps a variant group intact while sorting around it',
      '<template><div class="hover:(opacity-50 border) flex" /></template>',
      '<template><div class="flex hover:(b op-50)" /></template>',
    ],
    [
      'expands one token into two and sorts both',
      '<template><div class="size-4 border" /></template>',
      '<template><div class="h-4 w-4 b" /></template>',
    ],
  ])('%s', async (_name, code, expected) => {
    const { output, stable } = await fixUntilStable(code)
    expect(output).toBe(expected)
    expect(stable, 'the two rules kept rewriting each other').toBe(true)
  })

  it('leaves a refused token in place and still reports it', async () => {
    const { output, stable, messages } = await fixUntilStable(
      '<template><div class="blur-[4px] border flex" /></template>',
    )

    expect(output).toContain('blur-[4px]')
    expect(stable).toBe(true)
    expect(messages.map((message) => message.ruleId)).toContain('unocss-normalize/classes')
    expect(messages.find((message) => message.ruleId === 'unocss-normalize/classes')?.message)
      .toMatch(/generates different CSS/)
  })

  it('settles on an attribute that is already sorted and normalised', async () => {
    const code = '<template><div class="flex b op-50" /></template>'
    const { output, stable, messages } = await fixUntilStable(code)

    expect(output).toBe(code)
    expect(stable).toBe(true)
    expect(messages).toEqual([])
  })

  it('unblocks the sorter, which cannot order a token the config blocks', async () => {
    // `unocss/order` sorts by asking the generator to parse each token, and a
    // blocked token does not parse - so the sorter keeps it where it is and
    // sorts around it. On a file written in the spellings the blocklist
    // rejects, the sorter has almost nothing to work with.
    const code = '<template><div class="opacity-50 border flex" /></template>'

    const sortedAlone = (await fixUntilStable(code, SORT_ONLY)).output
    expect(sortedAlone, 'the sorter sorted tokens the blocklist blocks').toBe(code)

    // Normalising first replaces them with spellings the generator does parse,
    // and only then can the order be decided.
    const both = (await fixUntilStable(code)).output
    expect(both).toBe('<template><div class="flex b op-50" /></template>')
  })

  it('needs both rules in the same run, not one pass after the other', async () => {
    // ESLint re-runs every rule after each fix pass, so the two converge when
    // they are configured together. Piping one whole run into the next does
    // not: the sorter has already had its turn before the tokens became
    // sortable, and nothing sorts them afterwards.
    const code = '<template><div class="opacity-50 border flex" /></template>'

    const together = (await fixUntilStable(code)).output
    const sortedThenNormalised = (await fixUntilStable(
      (await fixUntilStable(code, SORT_ONLY)).output,
      NORMALIZE_ONLY,
    )).output

    expect(together).toBe('<template><div class="flex b op-50" /></template>')
    expect(sortedThenNormalised).toBe('<template><div class="op-50 b flex" /></template>')
    expect(sortedThenNormalised).not.toBe(together)
  })
})

/*
* Which rule's fix lands first, when both want the same attribute in one pass.
*
* ESLint applies one fix per range per pass and takes the lowest start first,
* so if this rule's fix began on the opening quote - one character before the
* sorter's - it would win every such pass whatever the config said. Both fixes
* cover the text between the quotes instead, and with equal ranges ESLint keeps
* the order it collected them in: the order the rules are configured. A project
* that wants to sort before normalising lists `unocss/order` first.
*/
describe('which fix lands first', () => {
  const code = '<template><div class="justify-center items-center flex gap-2" /></template>'
  const SORT_FIRST: Linter.RulesRecord = {
    'unocss/order': 'error',
    'unocss-normalize/classes': ['error', { configPath }],
  }

  it('both rules replace the same range - the text between the quotes', async () => {
    const messages = await report(code, SORT_FIRST)
    const ranges = messages.map((message) => message.fix?.range)

    expect(messages.map((message) => message.ruleId)).toEqual(['unocss/order', 'unocss-normalize/classes'])
    expect(ranges[0]).toEqual(ranges[1])
    expect(code.slice(...ranges[0]!)).toBe('justify-center items-center flex gap-2')
  })

  it('follows the configured order, so either rule can be made to go first', async () => {
    const sortFirst = await report(code, SORT_FIRST)
    const normaliseFirst = await report(code, BOTH)

    expect(sortFirst.map((message) => message.ruleId)).toEqual(['unocss/order', 'unocss-normalize/classes'])
    expect(normaliseFirst.map((message) => message.ruleId)).toEqual(['unocss-normalize/classes', 'unocss/order'])
  })

  it('settles on the same result whichever goes first', async () => {
    const sortFirst = await fixUntilStable(code, SORT_FIRST)
    const normaliseFirst = await fixUntilStable(code, BOTH)

    expect(sortFirst.output).toBe(normaliseFirst.output)
    expect(sortFirst.stable && normaliseFirst.stable).toBe(true)
  })

  it('still adds quotes to an unquoted value, which a class list with spaces needs', async () => {
    const result = await lint('<template><div class=opacity-50 /></template>', { 'unocss-normalize/classes': ['error', { configPath }] })
    expect(result.output).toBe('<template><div class="op-50" /></template>')
  })
})

describe('what the sorter does to layout', () => {
  const multiLine = '<template>\n  <div\n    class="\n      opacity-50\n      border\n      flex\n    "\n  />\n</template>'

  it('keeps a multi-line attribute multi-line when only this rule runs', async () => {
    // Token order is the sorter's business, so with only this rule on the
    // tokens stay where the author put them - one per line, as written.
    const { output } = await fixUntilStable(multiLine, NORMALIZE_ONLY)
    expect(output).toContain('class="\n      op-50\n      b\n      flex\n    "')
  })

  it('flattens it once the sorter is on, which is the sorter\'s doing', async () => {
    // Pinned rather than worked around. `unocss/order` rewrites the whole
    // attribute onto one line, and it does so even when the tokens are already
    // in order - see the test below. If upstream ever stops doing that, this
    // assertion fails and the note in the README can go.
    const { output, stable } = await fixUntilStable(multiLine)
    expect(output).toContain('class="flex b op-50"')
    expect(stable).toBe(true)
  })

  it('confirms the sorter alone flattens an attribute that is already in order', async () => {
    const sorted = '<template>\n  <div\n    class="\n      flex\n      b\n      op-50\n    "\n  />\n</template>'
    const { output } = await fixUntilStable(sorted, SORT_ONLY)
    expect(output).toContain('class="flex b op-50"')

    // And it says the utilities are not ordered, about an attribute in which
    // they are - what it has actually found is the whitespace.
    const messages = await report(sorted, SORT_ONLY)
    expect(messages.map((message) => message.message)).toEqual(['UnoCSS utilities are not ordered'])
  })
})

describe('variant grouping beside the sorter', () => {
  const GROUPING: Linter.RulesRecord = {
    'unocss-normalize/classes': ['error', { configPath, variantGroups: true }],
    'unocss/order': 'error',
  }

  it('groups a run the sorter keeps together, and settles', async () => {
    const { output, stable, messages } = await fixUntilStable(
      '<template><div class="md:border md:opacity-50" /></template>',
      GROUPING,
    )

    expect(output).toBe('<template><div class="md:(b op-50)" /></template>')
    expect(stable).toBe(true)
    expect(messages).toEqual([])
  })

  it('declines to group a run the sorter would tear apart', async () => {
    // `unocss/order` expands a group, sorts the members apart, then collapses
    // only what stayed adjacent - leaving one member loose and the other in a
    // group of one. Grouping these would be undone every pass and remade the
    // next, so the run is left alone and the lint comes out clean.
    const { output, stable, messages } = await fixUntilStable(
      '<template><div class="lg:hover:c-brand lg:hover:flex grid gap-2" /></template>',
      GROUPING,
    )

    expect(output).not.toContain('lg:hover:(')
    expect(stable).toBe(true)
    // The sorter is satisfied, which is the whole point: it is no longer
    // reporting an order it can never reach. (`c-brand` still draws a refusal
    // from the fixture's deliberately wrong fix - a different claim.)
    expect(messages.filter((message) => message.ruleId === 'unocss/order')).toEqual([])
  })
})

describe('the attribute still renders the same after both rules', () => {
  // The end-to-end version of the package's promise. Each rewrite is proved on
  // its own inside the rule; this checks the whole attribute after the sorter
  // has also had its turn - which is where a dropped token would show up, and
  // where it would otherwise look like a tidy-up in the diff.
  const prover = (async () => {
    const { loadConfig } = await import('@unocss/config')
    const { createGenerator, parseVariantGroup } = await import('@unocss/core')
    const { config } = await loadConfig(fileURLToPath(new URL('./fixtures/basic', import.meta.url)))
    const uno = await createGenerator({ ...config, warn: false, blocklist: [], safelist: [], preflights: [] })

    return async (classes: string) => {
      // The generator does not understand a variant group; the transformer is
      // what expands one at build time, so expand before asking.
      const expanded = parseVariantGroup(classes).expanded
      const { css } = await uno.generate(expanded, { preflights: false, minify: true })
      return css
    }
  })()

  const classesOf = (source: string) => /class="([^"]*)"/.exec(source)?.[1] ?? ''

  it.each([
    'lg:hover:(text-red-30 cols-2) grid cols-1 gap-6',
    'md:border md:opacity-50 flex',
    'border blur-[4px] text-center',
    'hover:(border opacity-50) size-4',
    'flex justify-center gap-2 items-center',
  ])('generates the same CSS before and after: %s', async (classes) => {
    const generate = await prover
    const code = `<template><div class="${classes}" /></template>`
    const { output } = await fixUntilStable(code, {
      'unocss-normalize/classes': ['error', { configPath, variantGroups: true }],
      'unocss/order': 'error',
    })

    expect(isEquivalent(await generate(classes), await generate(classesOf(output)))).toBe(true)
  })
})
