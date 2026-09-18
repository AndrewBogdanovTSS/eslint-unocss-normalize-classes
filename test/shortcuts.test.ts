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
