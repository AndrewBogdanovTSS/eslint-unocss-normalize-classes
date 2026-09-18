import { describe, expect, it } from 'vitest'
import { computedDeclarations, isEquivalent } from '../src/core/equivalence'

describe('computedDeclarations', () => {
  it('ignores the class name, so a rename compares equal', () => {
    expect(computedDeclarations('.border{border-width:1px}'))
      .toBe(computedDeclarations('.b{border-width:1px}'))
  })

  it('ignores declaration order', () => {
    expect(computedDeclarations('.a{color:red;display:flex}'))
      .toBe(computedDeclarations('.b{display:flex;color:red}'))
  })

  it('ignores the order rules appear in', () => {
    expect(computedDeclarations('.a{color:red}.b{display:flex}'))
      .toBe(computedDeclarations('.b{display:flex}.a{color:red}'))
  })

  it('resolves a custom property to the last value declared for it', () => {
    const split = '.c-black{--un-text-opacity:1;color:rgb(0 0 0 / var(--un-text-opacity))}.c-op-50{--un-text-opacity:0.5}'
    expect(computedDeclarations(split)).toBe('& { color:rgb(0 0 0 / 0.5) }')
  })

  it('leaves a var it cannot resolve alone rather than inventing a value', () => {
    expect(computedDeclarations('.a{color:var(--un-unset)}')).toBe('& { color:var(--un-unset) }')
  })

  // --- the condition a declaration applies under is part of the declaration ---

  it('keeps the pseudo-class, so a variant is not mistaken for a rename', () => {
    expect(computedDeclarations('.c-white{color:white}'))
      .not.toBe(computedDeclarations('.hover\\:c-white:hover{color:white}'))
  })

  it('keeps the at-rule, so a breakpoint is not mistaken for a rename', () => {
    expect(computedDeclarations('.p-4{padding:1rem}'))
      .not.toBe(computedDeclarations('@media (min-width: 640px){.sm\\:p-4{padding:1rem}}'))
  })

  it('compares two rules under the same at-rule as equal', () => {
    expect(computedDeclarations('@media (min-width: 640px){.sm\\:p-4{padding:1rem}}'))
      .toBe(computedDeclarations('@media (min-width: 640px){.sm\\:p-1rem{padding:1rem}}'))
  })

  it('reads through an escaped class name to the pseudo-class behind it', () => {
    // `.\@hover\:bg-brand:hover` - the escapes are part of the name, the final
    // `:hover` is not
    expect(computedDeclarations('.\\@hover\\:bg-brand:hover{color:red}'))
      .toBe(computedDeclarations('.anything-else:hover{color:red}'))
  })

  it('handles nested at-rules', () => {
    const nested = '@supports (display:grid){@media (min-width: 640px){.a{display:grid}}}'
    expect(computedDeclarations(nested)).toContain('@supports (display:grid) @media (min-width: 640px)')
  })

  // --- lengths ---

  it('converts rem to px at the configured root size', () => {
    expect(computedDeclarations('.a{margin:0.25rem}')).toBe('& { margin:4px }')
    expect(computedDeclarations('.a{margin:0.25rem}', { rootFontSize: 10 })).toBe('& { margin:2.5px }')
  })

  it('leaves rem alone when the conversion is turned off', () => {
    expect(computedDeclarations('.a{margin:0.25rem}', { rootFontSize: false })).toBe('& { margin:0.25rem }')
  })

  it('is empty for a stylesheet with no rules', () => {
    expect(computedDeclarations('')).toBe('')
  })
})

describe('isEquivalent', () => {
  it('accepts px and rem that compute to the same length', () => {
    expect(isEquivalent('.a{margin:4px}', '.b{margin:0.25rem}')).toBe(true)
  })

  it('rejects them under a strict comparison', () => {
    expect(isEquivalent('.a{margin:4px}', '.b{margin:0.25rem}', { rootFontSize: false })).toBe(false)
  })

  it('rejects a length that changed', () => {
    expect(isEquivalent('.a{filter:blur(4px)}', '.b{filter:blur(1px)}')).toBe(false)
  })

  it('rejects a declaration that moved into a media query', () => {
    expect(isEquivalent('.a{padding:1rem}', '@media (min-width: 640px){.b{padding:1rem}}')).toBe(false)
  })

  it('rejects a declaration that gained a pseudo-class', () => {
    expect(isEquivalent('.a{color:red}', '.b:hover{color:red}')).toBe(false)
  })

  it('rejects a rewrite that drops a declaration', () => {
    expect(isEquivalent('.a{color:red;display:flex}', '.b{color:red}')).toBe(false)
  })

  it('accepts the inline-opacity form against the two-class form', () => {
    const inline = '.c-black\\/50{color:rgb(0 0 0 / 0.5)}'
    const split = '.c-black{--un-text-opacity:1;color:rgb(0 0 0 / var(--un-text-opacity))}.c-op-50{--un-text-opacity:0.5}'
    expect(isEquivalent(inline, split)).toBe(true)
  })

  it('never calls two empty stylesheets equivalent', () => {
    expect(isEquivalent('', '')).toBe(false)
    expect(isEquivalent('.a{color:red}', '')).toBe(false)
    expect(isEquivalent('', '.a{color:red}')).toBe(false)
  })
})
