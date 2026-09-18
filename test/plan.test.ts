import { describe, expect, it, vi } from 'vitest'
import { hideFixes } from '../src/config'
import { planRewrite } from '../src/core/plan'
import type { PlanDeps } from '../src/core/plan'

/** A planner whose answers are written down rather than generated. */
const deps = (overrides: Partial<PlanDeps> = {}): PlanDeps => ({
  declaredFix: async () => null,
  prove: async () => true,
  shortcuts: [],
  ...overrides,
})

describe('planRewrite', () => {
  it('leaves an attribute it can prove nothing about byte for byte', async () => {
    const value = '\n  flex\n  gap-2\n'
    const plan = await planRewrite(value, deps())
    expect(plan.changed).toBe(false)
    expect(plan.value).toBe(value)
  })

  it('applies a declared fix that proves', async () => {
    const plan = await planRewrite('border gap-2', deps({
      declaredFix: async (token) => (token === 'border' ? ['b'] : null),
    }))
    expect(plan.value).toBe('b gap-2')
    expect(plan.unproven).toEqual([])
  })

  it('refuses a declared fix that does not prove, and says so', async () => {
    const plan = await planRewrite('blur-[4px]', deps({
      declaredFix: async (token) => (token === 'blur-[4px]' ? ['blur-1'] : null),
      prove: async () => false,
    }))
    expect(plan.changed).toBe(false)
    expect(plan.value).toBe('blur-[4px]')
    expect(plan.unproven).toEqual([{ before: 'blur-[4px]', after: 'blur-1', source: 'blocklist' }])
  })

  it('expands one token into several', async () => {
    const plan = await planRewrite('size-4 flex', deps({
      declaredFix: async (token) => (token === 'size-4' ? ['w-4', 'h-4'] : null),
    }))
    expect(plan.value).toBe('w-4 h-4 flex')
  })

  it('follows a chain of fixes', async () => {
    const chain: Record<string, string[]> = { 'ma-auto': ['m-auto'], 'm-auto': ['m-a'] }
    const plan = await planRewrite('ma-auto', deps({ declaredFix: async (token) => chain[token] ?? null }))
    expect(plan.value).toBe('m-a')
  })

  it('stops a chain that loops instead of running forever', async () => {
    const loop: Record<string, string[]> = { a: ['b'], b: ['a'] }
    const plan = await planRewrite('a', deps({
      declaredFix: async (token) => loop[token] ?? null,
      maxPasses: 4,
    }))
    expect(['a', 'b']).toContain(plan.value)
  })

  it('collapses a shortcut whose tokens are all present, in any order', async () => {
    const plan = await planRewrite('flex justify-center gap-2 items-center', deps({
      shortcuts: [{ name: 'center', tokens: ['items-center', 'justify-center'] }],
    }))
    expect(plan.value).toBe('flex center gap-2')
  })

  it('refuses a shortcut collapse that does not prove', async () => {
    const plan = await planRewrite('items-center justify-center', deps({
      shortcuts: [{ name: 'center', tokens: ['items-center', 'justify-center'] }],
      prove: async () => false,
    }))
    expect(plan.changed).toBe(false)
    expect(plan.unproven).toEqual([
      { before: 'items-center justify-center', after: 'center', source: 'shortcut' },
    ])
  })

  it('rewrites inside a variant group and puts the group back', async () => {
    const plan = await planRewrite('hover:(border opacity-50) flex', deps({
      declaredFix: async (token) => ({
        'hover:border': ['hover:b'],
        'hover:opacity-50': ['hover:op-50'],
      } as Record<string, string[]>)[token] ?? null,
    }))
    expect(plan.value).toBe('hover:(b op-50) flex')
  })

  it('asks nothing of an empty attribute', async () => {
    const declaredFix = vi.fn(async () => null)
    const plan = await planRewrite('   ', deps({ declaredFix }))
    expect(plan.changed).toBe(false)
    expect(declaredFix).not.toHaveBeenCalled()
  })

  it('skips the blocklist when the source is turned off', async () => {
    const plan = await planRewrite('border', deps({ declaredFix: async () => null }))
    expect(plan.changed).toBe(false)
  })

  it('keeps a multi-line attribute multi-line when a shortcut collapses', async () => {
    const plan = await planRewrite('\n  flex\n  items-center\n  justify-center\n', deps({
      shortcuts: [{ name: 'center', tokens: ['items-center', 'justify-center'] }],
    }))
    expect(plan.value).toBe('\n  flex\n  center\n')
  })

  it('leaves a multi-line attribute byte for byte when nothing is proved', async () => {
    // The shortcut source used to reformat every attribute it looked at, which
    // reported a change on files where nothing had been normalised.
    const value = '\n  flex\n  gap-2\n'
    const plan = await planRewrite(value, deps({
      shortcuts: [{ name: 'center', tokens: ['items-center', 'justify-center'] }],
    }))
    expect(plan.changed).toBe(false)
    expect(plan.value).toBe(value)
  })

  it('uses the author separator when a fix changes the token count', async () => {
    const plan = await planRewrite('\n  size-4\n  flex\n', deps({
      declaredFix: async (token) => (token === 'size-4' ? ['w-4', 'h-4'] : null),
    }))
    expect(plan.value).toBe('\n  w-4\n  h-4\n  flex\n')
  })

  it('reports a refusal from each source separately', async () => {
    const plan = await planRewrite('border items-center justify-center', deps({
      declaredFix: async (token) => (token === 'border' ? ['b'] : null),
      shortcuts: [{ name: 'center', tokens: ['items-center', 'justify-center'] }],
      prove: async () => false,
    }))
    expect(plan.changed).toBe(false)
    expect(plan.unproven.map((entry) => entry.source)).toEqual(['blocklist', 'shortcut'])
  })
})

describe('shortcuts defined in terms of other shortcuts', () => {
  const nested = [
    // Longest first, the order `collapsibleShortcuts` produces.
    { name: 'card', tokens: ['f-col', 'gap-4', 'p-6'] },
    { name: 'f-col', tokens: ['flex', 'flex-col'] },
  ]

  it('collapses the inner shortcut and then the outer one', async () => {
    const plan = await planRewrite('flex flex-col gap-4 p-6', deps({ shortcuts: nested }))
    expect(plan.value).toBe('card')
  })

  it('stops at the inner one when the outer cannot be proved', async () => {
    const plan = await planRewrite('flex flex-col gap-4 p-6', deps({
      shortcuts: nested,
      prove: async (_before, after) => after !== 'card',
    }))
    expect(plan.value).toBe('f-col gap-4 p-6')
    expect(plan.unproven).toEqual([{ before: 'f-col gap-4 p-6', after: 'card', source: 'shortcut' }])
  })

  it('reports a refusal once however many passes look at it', async () => {
    const plan = await planRewrite('flex flex-col gap-4 p-6 extra', deps({
      shortcuts: nested,
      prove: async (_before, after) => after !== 'card',
    }))
    expect(plan.unproven.filter((entry) => entry.after === 'card')).toHaveLength(1)
  })
})

describe('collapsing tokens that share a variant', () => {
  const grouping = { minimum: 2 }

  it('is off unless the project asks for it', async () => {
    const plan = await planRewrite('md:text-center md:mx-a', deps())
    expect(plan.changed).toBe(false)
  })

  it('groups tokens that share a prefix', async () => {
    const plan = await planRewrite('md:text-center md:mx-a', deps({ variantGroups: grouping }))
    expect(plan.value).toBe('md:(text-center mx-a)')
  })

  it('groups an adjacent run and leaves the rest in place', async () => {
    const plan = await planRewrite('md:text-center md:mx-a flex p-4', deps({ variantGroups: grouping }))
    expect(plan.value).toBe('md:(text-center mx-a) flex p-4')
  })

  it('never moves a token in order to group it', async () => {
    // Ordering is `unocss/order`'s job. Gathering scattered tokens also fights
    // it: the sorter expands a group, sorts the members apart, then re-collapses
    // only what stayed adjacent - so a gathered group is split on the next pass
    // and regrouped on the one after, forever.
    const plan = await planRewrite('md:text-center flex md:mx-a p-4', deps({ variantGroups: grouping }))
    expect(plan.changed).toBe(false)
  })

  it('leaves a prefix that appears in two separate runs', async () => {
    // Collapsing consecutive tokens would turn the second run into its own
    // group, which is noise rather than a simplification.
    const plan = await planRewrite('md:a md:b flex md:c md:d', deps({ variantGroups: grouping }))
    expect(plan.changed).toBe(false)
  })

  it('does not group a prefix carried by only one token', async () => {
    const plan = await planRewrite('md:text-center hover:flex', deps({ variantGroups: grouping }))
    expect(plan.changed).toBe(false)
  })

  it('treats stacked variants as one prefix, and different stacks as different', async () => {
    const plan = await planRewrite('md:hover:a md:hover:b md:c', deps({ variantGroups: grouping }))
    expect(plan.value).toBe('md:hover:(a b) md:c')
  })

  it('honours a higher minimum', async () => {
    const two = await planRewrite('md:a md:b', deps({ variantGroups: { minimum: 3 } }))
    expect(two.changed).toBe(false)

    const three = await planRewrite('md:a md:b md:c', deps({ variantGroups: { minimum: 3 } }))
    expect(three.value).toBe('md:(a b c)')
  })

  it('groups what a blocklist fix just produced', async () => {
    const plan = await planRewrite('md:text-center md:mx-auto', deps({
      variantGroups: grouping,
      declaredFix: async (token) => (token === 'md:mx-auto' ? ['md:mx-a'] : null),
    }))
    expect(plan.value).toBe('md:(text-center mx-a)')
  })

  it('keeps a group the author already wrote, even below the minimum', async () => {
    const plan = await planRewrite('md:(text-center)', deps({ variantGroups: { minimum: 5 } }))
    expect(plan.value).toBe('md:(text-center)')
  })
})

describe('hideFixes', () => {
  it('keeps the fix readable while taking it out of a spread', () => {
    const [[, meta]] = hideFixes([[/^border$/, { message: 'use "b"', fix: () => ['b'] }]]) as [[unknown, any]]

    // How this plugin reads it: still there.
    expect(typeof meta.fix).toBe('function')
    expect(meta.fix()).toEqual(['b'])

    // How `unocss/blocklist` sends it to a worker: no function crosses.
    expect(Object.keys({ ...meta })).toEqual(['message'])
    expect(JSON.parse(JSON.stringify({ ...meta }))).toEqual({ message: 'use "b"' })
  })

  it('leaves entries without a fix, and non-array entries, alone', () => {
    const blocklist = ['tab', [/^float-/, { message: 'use flex' }]]
    expect(hideFixes(blocklist)).toEqual(blocklist)
  })
})
