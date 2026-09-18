/**
 * The plugin against a real UnoCSS config.
 *
 * Everything here goes through `planForConfig`, which is the same function the
 * worker exposes - so these are the plugin's actual answers, not a model of
 * them. The fixture config deliberately contains a wrong fix; the test that
 * matters most is the one where the plugin refuses to apply it.
 */
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { planForConfig } from '../src/session'
import type { PlanOptions } from '../src/session'

const configPath = fileURLToPath(new URL('./fixtures/basic/uno.config.ts', import.meta.url))

const DEFAULTS: PlanOptions = { shortcuts: true, blocklist: true, rootFontSize: 16 }

const plan = async (value: string, options: Partial<PlanOptions> = {}) =>
  planForConfig(configPath, value, undefined, { ...DEFAULTS, ...options })

describe('blocklist fixes that prove', () => {
  it.each([
    ['border', 'b'],
    ['opacity-50', 'op-50'],
    ['size-4', 'w-4 h-4'],
    ['m-[4px]', 'm-1'],
    ['border gap-2 flex', 'b gap-2 flex'],
  ])('rewrites %s to %s', async (before, after) => {
    const result = await plan(before)
    expect(result.value).toBe(after)
    expect(result.unproven).toEqual([])
  })

  it('carries variants through a fix written against the bare utility', async () => {
    expect((await plan('sm:hover:border')).value).toBe('sm:hover:b')
  })

  it('carries an important marker through', async () => {
    expect((await plan('!border')).value).toBe('!b')
  })

  it('rewrites inside a variant group and writes the group back', async () => {
    expect((await plan('hover:(border opacity-50) flex')).value).toBe('hover:(b op-50) flex')
  })
})

describe('the prover', () => {
  it('refuses a declared fix that changes the rendered value', async () => {
    const result = await plan('blur-[4px]')

    expect(result.changed).toBe(false)
    expect(result.value).toBe('blur-[4px]')
    expect(result.unproven).toEqual([
      { before: 'blur-[4px]', after: 'blur-1', source: 'blocklist' },
    ])
  })

  it('refuses a fix whose replacement generates no CSS at all', async () => {
    const result = await plan('p-nonsense')

    expect(result.changed).toBe(false)
    expect(result.unproven[0]).toMatchObject({ after: 'p-utterly-unknown', source: 'blocklist' })
  })

  it('applies the proved fix and refuses the unproved one in the same attribute', async () => {
    const result = await plan('border blur-[4px]')

    expect(result.value).toBe('b blur-[4px]')
    expect(result.unproven).toHaveLength(1)
  })

  it('stops proving px against rem when the root size assumption is turned off', async () => {
    const lenient = await plan('m-[4px]')
    const strict = await plan('m-[4px]', { rootFontSize: false })

    expect(lenient.value).toBe('m-1')
    expect(strict.changed).toBe(false)
    expect(strict.unproven).toEqual([{ before: 'm-[4px]', after: 'm-1', source: 'blocklist' }])
  })
})

describe('shortcuts', () => {
  it.each([
    ['underline underline-offset-3', 'underlined'],
    ['items-center justify-center', 'center'],
    ['flex flex-col', 'f-col'],
  ])('collapses %s to %s', async (before, after) => {
    expect((await plan(before)).value).toBe(after)
  })

  it('collapses regardless of order and keeps the rest in place', async () => {
    expect((await plan('flex justify-center gap-2 items-center')).value).toBe('flex center gap-2')
  })

  it('leaves a partial match alone', async () => {
    expect((await plan('items-center gap-2')).changed).toBe(false)
  })
})

describe('sources can be turned off', () => {
  it('skips shortcut collapsing', async () => {
    expect((await plan('items-center justify-center', { shortcuts: false })).changed).toBe(false)
  })

  it('skips blocklist fixes', async () => {
    expect((await plan('border', { blocklist: false })).changed).toBe(false)
  })
})

describe('attributes it should not touch', () => {
  it('leaves an already normalized attribute byte for byte', async () => {
    const value = '\n  b\n  op-50\n'
    const result = await plan(value)
    expect(result.changed).toBe(false)
    expect(result.value).toBe(value)
  })

  it('leaves classes it knows nothing about', async () => {
    expect((await plan('my-own-class another-one')).changed).toBe(false)
  })

  it('leaves an empty attribute', async () => {
    expect((await plan('   ')).changed).toBe(false)
  })
})
