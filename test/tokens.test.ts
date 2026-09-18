import { describe, expect, it } from 'vitest'
import { joinToken, lastVariantSeparator, splitClassValue, splitToken } from '../src/core/tokens'

describe('lastVariantSeparator', () => {
  it.each([
    ['flex', -1],
    ['hover:flex', 5],
    ['sm:hover:flex', 8],
    ['bg-[url(a:b)]', -1],
    ['[&:hover]:flex', 9],
  ])('finds the separator in %s', (token, expected) => {
    expect(lastVariantSeparator(token)).toBe(expected)
  })
})

describe('splitToken', () => {
  it.each([
    ['border', { prefix: '', leadingImportant: '', body: 'border', trailingImportant: '' }],
    ['hover:border', { prefix: 'hover:', leadingImportant: '', body: 'border', trailingImportant: '' }],
    ['sm:hover:!border', { prefix: 'sm:hover:', leadingImportant: '!', body: 'border', trailingImportant: '' }],
    ['border!', { prefix: '', leadingImportant: '', body: 'border', trailingImportant: '!' }],
    ['m-[4px]', { prefix: '', leadingImportant: '', body: 'm-[4px]', trailingImportant: '' }],
  ])('splits %s', (token, expected) => {
    expect(splitToken(token)).toEqual(expected)
  })

  it('round trips', () => {
    for (const token of ['border', 'hover:border', 'sm:hover:!border', 'border!']) {
      const parts = splitToken(token)
      expect(joinToken(parts, parts.body)).toBe(token)
    }
  })
})

describe('splitClassValue', () => {
  it('keeps the whitespace that framed the tokens', () => {
    expect(splitClassValue('\n  flex\n  gap-2\n')).toEqual({
      leading: '\n  ',
      tokens: ['flex', 'gap-2'],
      trailing: '\n',
    })
  })

  it('handles an empty value', () => {
    expect(splitClassValue('   ')).toEqual({ leading: '   ', tokens: [], trailing: '' })
  })
})
