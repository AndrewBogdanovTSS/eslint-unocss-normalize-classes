import { describe, expect, it } from 'vitest'
import { applyShortcut, collapsibleShortcuts, matchShortcut } from '../src/core/shortcuts'

describe('collapsibleShortcuts', () => {
  it('keeps static multi-token shortcuts and drops the rest', () => {
    const sets = collapsibleShortcuts([
      ['underlined', 'underline underline-offset-3'],
      ['center', 'items-center justify-center'],
      // one token: a rename, not a simplification
      ['brand', 'c-red'],
      // dynamic shortcut
      [/^btn-(.+)$/, (match: string[]) => `bg-${match[1]}`],
      // object value
      ['odd', { color: 'red' }],
    ])

    expect(sets.map((set) => set.name)).toEqual(['underlined', 'center'])
  })

  it('expands variant groups inside the expansion, so its tokens match real ones', () => {
    const [set] = collapsibleShortcuts([['button', 'bg-white active:(bg-grey c-white)']])
    expect(set.tokens).toEqual(['bg-white', 'active:bg-grey', 'active:c-white'])
  })

  it('returns the largest sets first, so the biggest match wins', () => {
    const sets = collapsibleShortcuts([['small', 'a b'], ['large', 'a b c d']])
    expect(sets.map((set) => set.name)).toEqual(['large', 'small'])
  })

  /*
  * The marker rides in the third slot UnoCSS already gives a static shortcut,
  * so it survives `mergeConfigs` and `resolveShortcuts` untouched and the
  * generator ignores it. Read here rather than filtered here: whether a scoped
  * set may be used depends on the file being linted, which this function does
  * not see.
  */
  it('reads the scoped marker off the meta slot', () => {
    const sets = collapsibleShortcuts([
      ['center', 'items-center justify-center'],
      ['brand-title', 'fw-bold tracking-wide', { scoped: true }],
    ])

    expect(sets.map((set) => [set.name, set.scoped])).toEqual([
      ['center', false],
      ['brand-title', true],
    ])
  })

  it('treats a missing, false, or non-boolean marker as not scoped', () => {
    const sets = collapsibleShortcuts([
      ['a', 'x y'],
      ['b', 'x y', {}],
      ['c', 'x y', { scoped: false }],
      ['d', 'x y', { layer: 'components' }],
      ['e', 'x y', { scoped: 'yes' }],
    ])

    expect(sets.every((set) => !set.scoped)).toBe(true)
  })
})

describe('matchShortcut', () => {
  const center = { name: 'center', tokens: ['items-center', 'justify-center'] }

  it('matches regardless of order or distance', () => {
    expect(matchShortcut(['flex', 'justify-center', 'gap-2', 'items-center'], center)).not.toBeNull()
  })

  it('does not match when a token is missing', () => {
    expect(matchShortcut(['flex', 'items-center'], center)).toBeNull()
  })

  it('claims each token once, so a repeated requirement needs two of them', () => {
    const doubled = { name: 'twice', tokens: ['a', 'a'] }
    expect(matchShortcut(['a', 'b'], doubled)).toBeNull()
    expect(matchShortcut(['a', 'a'], doubled)).not.toBeNull()
  })
})

describe('applyShortcut', () => {
  it('puts the name where the earliest replaced token was', () => {
    const tokens = ['flex', 'justify-center', 'gap-2', 'items-center']
    const match = matchShortcut(tokens, { name: 'center', tokens: ['items-center', 'justify-center'] })!
    expect(applyShortcut(tokens, match)).toEqual(['flex', 'center', 'gap-2'])
  })

  it('leaves the tokens before the match untouched', () => {
    const tokens = ['a', 'b', 'c', 'x', 'y']
    const match = matchShortcut(tokens, { name: 'xy', tokens: ['x', 'y'] })!
    expect(applyShortcut(tokens, match)).toEqual(['a', 'b', 'c', 'xy'])
  })
})
