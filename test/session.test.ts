/**
 * The plugin against real UnoCSS configs.
 *
 * Everything here goes through `planForConfig`, the same function the worker
 * exposes, so these are the plugin's actual answers rather than a model of
 * them. Three fixtures, each earning its place:
 *
 *   - `basic`     a project-shaped config carrying every blocklist form, every
 *                 `fix` return shape, overlapping shortcuts, a custom rule and
 *                 a custom variant - and several fixes that are wrong
 *   - `no-fixes`  a config that never opted in, which is every project today
 *   - `looping`   two entries that undo each other, both individually provable
 */
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { planForConfig } from '../src/session'
import type { PlanOptions } from '../src/session'

const basic = fileURLToPath(new URL('./fixtures/basic/uno.config.ts', import.meta.url))
const noFixes = fileURLToPath(new URL('./fixtures/no-fixes/uno.config.ts', import.meta.url))
const looping = fileURLToPath(new URL('./fixtures/looping/uno.config.ts', import.meta.url))

const DEFAULTS: PlanOptions = {
  shortcuts: true,
  allowScoped: false,
  blocklist: true,
  rootFontSize: 16,
  variantGroups: false,
}

const plan = async (value: string, options: Partial<PlanOptions> = {}, config = basic) =>
  planForConfig(config, value, undefined, { ...DEFAULTS, ...options })

describe('blocklist entry forms', () => {
  it.each([
    ['RegExp', 'border', 'b'],
    ['plain string', 'whitespace-nowrap', 'ws-nowrap'],
    ['predicate function', 'leading-4', 'lh-4'],
  ])('reads a fix declared on a %s entry', async (_form, before, after) => {
    const result = await plan(before)
    expect(result.value).toBe(after)
    expect(result.unproven).toEqual([])
  })

  it('says nothing about an entry that declares no fix', async () => {
    // `unocss/blocklist` still reports it - that is that rule's job, not this
    // one's, and duplicating the report would only be noise.
    const result = await plan('float-left')
    expect(result.changed).toBe(false)
    expect(result.unproven).toEqual([])
  })
})

describe('fix return shapes', () => {
  it('accepts an array of one', async () => {
    expect((await plan('border')).value).toBe('b')
  })

  it('accepts a bare string', async () => {
    expect((await plan('opacity-50')).value).toBe('op-50')
  })

  it('accepts several tokens, expanding one into many', async () => {
    expect((await plan('size-4')).value).toBe('w-4 h-4')
  })

  it('follows a chain until it settles', async () => {
    // size-1rem -> w-1rem h-1rem -> w-4 h-4, every step proved on its own
    expect((await plan('size-1rem')).value).toBe('w-4 h-4')
  })
})

describe('a fix that misbehaves costs a rewrite, not the lint run', () => {
  it.each([
    ['throws', 'throwing-fix'],
    ['returns nothing', 'empty-fix'],
    ['returns its own input', 'identity-fix'],
  ])('survives an entry whose fix %s', async (_how, token) => {
    const result = await plan(token)
    expect(result.changed).toBe(false)
    expect(result.unproven).toEqual([])
  })
})

describe('the prover', () => {
  it.each([
    // The case this package exists for: `blur` is not on the spacing scale
    ['a length off the spacing scale', 'blur-[4px]', 'blur-1'],
    // A replacement that generates nothing is proved absent, not proved equal
    ['a replacement that generates no CSS', 'p-nonsense', 'p-utterly-unknown'],
    // Same colour name, different shade
    ['a different value behind a similar name', 'c-brand', 'c-brand-muted'],
    // Alignment, not direction
    ['a different declaration behind a similar name', 'text-center', 'text-left'],
  ])('refuses %s', async (_why, before, after) => {
    const result = await plan(before)

    expect(result.changed).toBe(false)
    expect(result.value).toBe(before)
    expect(result.unproven).toEqual([{ before, after, source: 'blocklist' }])
  })

  it('applies the proved fix and refuses the unproved one in the same attribute', async () => {
    const result = await plan('border blur-[4px]')

    expect(result.value).toBe('b blur-[4px]')
    expect(result.unproven).toHaveLength(1)
  })

  it('stops proving px against rem when the root size assumption is turned off', async () => {
    expect((await plan('m-[4px]')).value).toBe('m-1')

    const strict = await plan('m-[4px]', { rootFontSize: false })
    expect(strict.changed).toBe(false)
    expect(strict.unproven).toEqual([{ before: 'm-[4px]', after: 'm-1', source: 'blocklist' }])
  })

  it('compares against a different root size when the project has one', async () => {
    // At a 4px root, `m-[4px]` is `m-4`, not `m-1` - so the declared fix stops
    // being equivalent and is refused.
    const result = await plan('m-[4px]', { rootFontSize: 4 })
    expect(result.changed).toBe(false)
  })
})

describe('variants, important markers and groups', () => {
  it.each([
    ['a variant', 'hover:border', 'hover:b'],
    ['stacked variants', 'sm:hover:border', 'sm:hover:b'],
    ['a leading important marker', '!border', '!b'],
    ['a trailing important marker', 'border!', 'b!'],
    ['a variant and an important marker', 'sm:hover:!border', 'sm:hover:!b'],
    ['an arbitrary variant', '[&:hover]:border', '[&:hover]:b'],
    ['a project-defined variant', '@hover:border', '@hover:b'],
    ['a variant in front of a chain', 'sm:size-1rem', 'sm:w-4 sm:h-4'],
  ])('carries %s through a fix written against the bare utility', async (_what, before, after) => {
    expect((await plan(before)).value).toBe(after)
  })

  it('rewrites inside a variant group and writes the group back', async () => {
    expect((await plan('hover:(border opacity-50) flex')).value).toBe('hover:(b op-50) flex')
  })

  it('handles a nested variant group', async () => {
    expect((await plan('hover:(focus:(border) opacity-50)')).value).toBe('hover:(focus:b op-50)')
  })

  it('does not mistake a colon inside brackets for a variant separator', async () => {
    const value = 'bg-[url(https://a.test/x:y.png)]'
    expect((await plan(value)).changed).toBe(false)
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

  it('collapses regardless of order and leaves the rest in place', async () => {
    expect((await plan('flex justify-center gap-2 items-center')).value).toBe('flex center gap-2')
  })

  it('prefers the largest match when two shortcuts compete', async () => {
    // `card` is `flex flex-col gap-2 p-4`; `f-col` is a subset of it
    expect((await plan('flex flex-col gap-2 p-4')).value).toBe('card')
  })

  it('leaves nothing behind for a smaller shortcut inside a larger one', async () => {
    // `btn` contains every token of `center`
    expect((await plan('inline-flex items-center justify-center px-4 py-2')).value).toBe('btn')
  })

  it('collapses a shortcut whose expansion contains a variant group', async () => {
    expect((await plan('p-2 @hover:bg-brand @hover:c-white')).value).toBe('raised')
    expect((await plan('p-2 @hover:(bg-brand c-white)')).value).toBe('raised')
  })

  it('never collapses a single-token shortcut, which is a rename', async () => {
    expect((await plan('flex')).changed).toBe(false)
  })

  it('ignores a dynamic shortcut, which cannot be read backwards', async () => {
    expect((await plan('rounded-full px-3')).changed).toBe(false)
  })

  it('leaves a partial match alone', async () => {
    expect((await plan('items-center gap-2')).changed).toBe(false)
  })
})

describe('the two sources together', () => {
  it('collapses a shortcut out of tokens the blocklist just rewrote', async () => {
    expect((await plan('border items-center justify-center')).value).toBe('b center')
  })

  it('leaves a project rule it has nothing to say about', async () => {
    expect((await plan('squircle border')).value).toBe('squircle b')
  })

  it('is idempotent - a second pass over its own output changes nothing', async () => {
    for (const value of [
      'border opacity-50',
      'size-1rem',
      'flex justify-center gap-2 items-center',
      'hover:(border opacity-50)',
    ]) {
      const once = await plan(value)
      const twice = await plan(once.value)
      expect(twice.changed, `${value} -> ${once.value}`).toBe(false)
    }
  })
})

describe('formatting', () => {
  it('leaves an attribute it can prove nothing about byte for byte', async () => {
    const value = '\n  b\n  op-50\n'
    const result = await plan(value)
    expect(result.changed).toBe(false)
    expect(result.value).toBe(value)
  })

  it('keeps a multi-line attribute multi-line', async () => {
    const result = await plan('\n    border\n    opacity-50\n    flex\n  ')
    expect(result.value).toBe('\n    b\n    op-50\n    flex\n  ')
  })

  it('keeps a single-line attribute on one line', async () => {
    expect((await plan('border opacity-50')).value).toBe('b op-50')
  })

  it('keeps the indentation when a fix changes the token count', async () => {
    const result = await plan('\n  size-4\n  border\n')
    expect(result.value).toBe('\n  w-4\n  h-4\n  b\n')
  })

  it('leaves an empty attribute', async () => {
    expect((await plan('   ')).changed).toBe(false)
  })

  it('leaves classes the config knows nothing about', async () => {
    expect((await plan('my-own-class another-one')).changed).toBe(false)
  })

  it('keeps a duplicate token rather than quietly deduplicating', async () => {
    // Deduplicating is a different change from normalising, and doing it here
    // would mean the rule edits attributes it was not asked to touch.
    expect((await plan('border border')).value).toBe('b b')
  })
})

describe('sources can be turned off', () => {
  it('skips shortcut collapsing', async () => {
    expect((await plan('items-center justify-center', { shortcuts: false })).changed).toBe(false)
  })

  it('skips blocklist fixes', async () => {
    expect((await plan('border', { blocklist: false })).changed).toBe(false)
  })

  it('still collapses shortcuts with the blocklist off', async () => {
    expect((await plan('items-center justify-center', { blocklist: false })).value).toBe('center')
  })
})

describe('a config that never declared a fix', () => {
  it('rewrites nothing from the blocklist', async () => {
    for (const token of ['border', 'opacity-50']) {
      const result = await plan(token, {}, noFixes)
      expect(result.changed).toBe(false)
      expect(result.unproven).toEqual([])
    }
  })

  it('still collapses shortcuts, so the plugin is useful before anyone opts in', async () => {
    expect((await plan('items-center justify-center', {}, noFixes)).value).toBe('center')
  })
})

describe('a config whose fixes undo each other', () => {
  it.each(['opacity-50', 'op-50'])('terminates on %s instead of rewriting forever', async (token) => {
    const result = await plan(token, {}, looping)
    // Both spellings generate the same CSS, so every step of the loop passes
    // the prover. The pass limit is what ends it, and an even number of flips
    // lands back where it started - which is the safest place to stop.
    expect(result.value).toBe(token)
    expect(result.changed).toBe(false)
  })
})

describe('separating colours from the rest of text-*', () => {
  it('rewrites a colour, shade and opacity included', async () => {
    expect((await plan('text-red-500')).value).toBe('c-red-500')
    expect((await plan('text-red-500/50')).value).toBe('c-red-500/50')
  })

  it('refuses the same rewrite for a font size', async () => {
    // The fixture's entry is deliberately loose - it proposes `c-*` for every
    // `text-*`. `c-sm` generates nothing, so the prover is what tells a colour
    // apart from a size, with no pattern doing the work.
    const result = await plan('text-sm')

    expect(result.changed).toBe(false)
    expect(result.unproven).toEqual([{ before: 'text-sm', after: 'c-sm', source: 'blocklist' }])
  })

  it('leaves a whole class list correct when the two are mixed', async () => {
    const result = await plan('text-red-500 text-sm flex')

    expect(result.value).toBe('c-red-500 text-sm flex')
    expect(result.unproven).toHaveLength(1)
  })
})

/*
* A name whose expansion depends on which layer is merged.
*
* The proof cannot rule these out: it builds one generator from one config, so
* both sides of the comparison come from the same layer and the collapse is
* genuinely equivalent *there*. The marker is what carries the other layers'
* existence into a run that can only see this one.
*/
describe('scoped shortcuts', () => {
  it('is not a collapse source by default', async () => {
    const result = await plan('fw-bold tracking-wide')
    expect(result.value).toBe('fw-bold tracking-wide')
    expect(result.changed).toBe(false)
  })

  it('collapses once the caller says the file ships with this layer', async () => {
    const result = await plan('fw-bold tracking-wide', { allowScoped: true })
    expect(result.value).toBe('brand-title')
  })

  it('leaves unmarked shortcuts collapsing either way', async () => {
    for (const allowScoped of [false, true]) {
      const result = await plan('items-center justify-center', { allowScoped })
      expect(result.value, `allowScoped: ${allowScoped}`).toBe('center')
    }
  })

  it('does not stop the blocklist reaching tokens beside a scoped name', async () => {
    const result = await plan('border fw-bold tracking-wide')
    expect(result.value).toBe('b fw-bold tracking-wide')
  })
})

/*
* Manual shortcuts: suggested, never written.
*
* `classes` plans without them; `manual-shortcuts` plans with them and nothing
* else. Where a manual shortcut may be suggested follows the same rule as where
* any shortcut may be written - a scoped one only with `allowScoped`.
*/
describe('manual shortcuts', () => {
  const suggest = (value: string, options: Partial<PlanOptions> = {}) =>
    plan(value, { ...options, suggestManual: true })

  it('are never written by the ordinary plan, scoped or not', async () => {
    for (const allowScoped of [false, true]) {
      expect((await plan('ring-2 ring-offset-2', { allowScoped })).changed, `allowScoped: ${allowScoped}`).toBe(false)
      expect((await plan('shadow-md tracking-tight', { allowScoped })).changed, `allowScoped: ${allowScoped}`).toBe(false)
    }
  })

  it('are suggested where they would otherwise have been usable', async () => {
    expect((await suggest('ring-2 ring-offset-2')).value).toBe('halo')
    expect((await suggest('ring-2 ring-offset-2', { allowScoped: true })).value).toBe('halo')
    expect((await suggest('shadow-md tracking-tight', { allowScoped: true })).value).toBe('brand-button')
  })

  it('keep a scoped one out of shared code, where no collapse would be right', async () => {
    expect((await suggest('shadow-md tracking-tight')).changed).toBe(false)
  })

  it('suggest only the manual collapse - the blocklist and other shortcuts stand aside', async () => {
    // `border` has a declared fix and `items-center justify-center` is `center`;
    // both are the ordinary plan's business, and appear in its own report.
    const result = await suggest('border ring-2 ring-offset-2 items-center justify-center')
    expect(result.value).toBe('border halo items-center justify-center')
  })

  it('are proved like any other collapse, so a suggestion never changes the CSS', async () => {
    const result = await suggest('ring-2 ring-offset-2')
    expect(result.unproven).toEqual([])
  })
})

/*
* A manual match holds its tokens.
*
* Left out of matching instead, a manual shortcut would let a smaller ordinary
* one take part of its tokens - and once `--fix` wrote that, the question the
* marker exists to ask could never be asked. `chip` (manual) is
* `ml-3 mr-3 italic`; `slant` (ordinary) is `mr-3 italic`.
*/
describe('a held manual match', () => {
  it('keeps a smaller ordinary shortcut off its tokens', async () => {
    const result = await plan('ml-3 mr-3 italic')
    expect(result.changed).toBe(false)
  })

  it('is still suggested, the tokens being exactly where they were', async () => {
    expect((await plan('ml-3 mr-3 italic', { suggestManual: true })).value).toBe('chip')
  })

  it('reserves only its own tokens', async () => {
    // `center` is ordinary and shares nothing with `chip`, so it is written.
    expect((await plan('ml-3 items-center mr-3 justify-center italic')).value).toBe('ml-3 center mr-3 italic')
  })

  it('does not stop the smaller shortcut where the larger one does not match', async () => {
    expect((await plan('mr-3 italic')).value).toBe('slant')
  })
})
