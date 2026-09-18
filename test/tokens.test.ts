import { describe, expect, it } from 'vitest'
import { dominantSeparator, joinToken, lastVariantSeparator, splitClassValue, splitToken } from '../src/core/tokens'

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

describe('dominantSeparator', () => {
  it.each([
    ['flex gap-2', ' '],
    ['flex', ' '],
    ['', ' '],
    ['   ', ' '],
    ['\n  flex\n  gap-2\n', '\n  '],
    // Two tokens share a line, the rest are on their own: still a multi-line
    // attribute, and rewriting it onto one line would be a diff about layout.
    ['\n  flex gap-2\n  p-4\n  m-2\n  b\n', '\n  '],
    // A tie goes to the longer run. Collapsing lines is the change a reader
    // notices; joining two tokens that shared a line is not.
    ['a\n  b c', '\n  '],
  ])('reads %j as %j', (value, expected) => {
    expect(dominantSeparator(value)).toBe(expected)
  })
})

describe('splitClassValue', () => {
  it('keeps the whitespace that framed and separated the tokens', () => {
    expect(splitClassValue('\n  flex\n  gap-2\n')).toEqual({
      leading: '\n  ',
      tokens: ['flex', 'gap-2'],
      trailing: '\n',
      separator: '\n  ',
    })
  })

  it('handles an empty value', () => {
    expect(splitClassValue('   ')).toEqual({
      leading: '   ',
      tokens: [],
      trailing: '',
      separator: ' ',
    })
  })
})
