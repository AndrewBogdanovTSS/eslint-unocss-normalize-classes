import { describe, expect, it } from 'vitest'
import { computedDeclarations, isEquivalent } from '../src/core/equivalence'

describe('computedDeclarations', () => {
  it('ignores selectors, so the same declarations from different rules compare equal', () => {
    expect(computedDeclarations('.c-black{color:black}'))
      .toBe(computedDeclarations('.hover\:c-black:hover{color:black}'))
  })

  it('ignores declaration order', () => {
    expect(computedDeclarations('.a{color:red;display:flex}'))
      .toBe(computedDeclarations('.b{display:flex;color:red}'))
  })

  it('resolves a custom property to the last value declared for it', () => {
    const split = '.c-black{--un-text-opacity:1;color:rgb(0 0 0 / var(--un-text-opacity))}.c-op-50{--un-text-opacity:0.5}'
    expect(computedDeclarations(split)).toBe('color:rgb(0 0 0 / 0.5)')
  })

  it('converts rem to px at the configured root size', () => {
    expect(computedDeclarations('.a{margin:0.25rem}')).toBe('margin:4px')
    expect(computedDeclarations('.a{margin:0.25rem}', { rootFontSize: 10 })).toBe('margin:2.5px')
  })

  it('leaves rem alone when the conversion is turned off', () => {
    expect(computedDeclarations('.a{margin:0.25rem}', { rootFontSize: false })).toBe('margin:0.25rem')
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

  it('never calls two empty stylesheets equivalent', () => {
    expect(isEquivalent('', '')).toBe(false)
    expect(isEquivalent('.a{color:red}', '')).toBe(false)
  })
})
