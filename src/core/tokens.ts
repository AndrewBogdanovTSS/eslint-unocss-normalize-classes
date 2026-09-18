/**
 * Splitting a class token into the parts a blocklist lookup cares about.
 *
 * A blocklist pattern is often written against the bare utility - `^border$` -
 * while the token in the template carries variants and an important marker:
 * `sm:hover:!border`. Looking the raw token up finds nothing, so the lookup is
 * retried against the body and the prefix is put back afterwards.
 *
 * This split is deliberately allowed to be imperfect. It never decides that a
 * rewrite is safe; it only decides where to *look* for one. A bad split can
 * cost a fix that was available, and cannot produce a wrong one - whatever it
 * returns is reassembled and then has to survive the prover like everything
 * else.
 */

export interface SplitToken {
  /** Variant prefix including its trailing colon, e.g. `sm:hover:`. Empty when there is none. */
  prefix: string
  /** Leading important marker, `!` or empty. */
  leadingImportant: string
  /** The bare utility. */
  body: string
  /** Trailing important marker, `!` or empty. */
  trailingImportant: string
}

/**
 * Index of the last `:` that separates a variant from the utility, ignoring any
 * colon inside square brackets so arbitrary values and arbitrary variants
 * (`[&:hover]:flex`, `bg-[url(a:b)]`) are not cut in half.
 *
 * @param token - A single whitespace-delimited class token.
 * @returns The index, or `-1` when the token has no variant prefix.
 */
export function lastVariantSeparator(token: string): number {
  let depth = 0
  let separator = -1

  for (let index = 0; index < token.length; index++) {
    const char = token[index]
    if (char === '[') depth++
    else if (char === ']') depth = Math.max(0, depth - 1)
    else if (char === ':' && depth === 0) separator = index
  }

  return separator
}

/**
 * Split a class token into its variant prefix, important markers and utility.
 *
 * @param token - A single whitespace-delimited class token.
 * @returns The token's parts; joining them back gives the original token.
 */
export function splitToken(token: string): SplitToken {
  const separator = lastVariantSeparator(token)
  const prefix = separator === -1 ? '' : token.slice(0, separator + 1)
  let body = separator === -1 ? token : token.slice(separator + 1)

  const leadingImportant = body.startsWith('!') ? '!' : ''
  body = body.slice(leadingImportant.length)

  const trailingImportant = body.endsWith('!') ? '!' : ''
  body = trailingImportant ? body.slice(0, -1) : body

  return { prefix, leadingImportant, body, trailingImportant }
}

/**
 * Put a replacement utility back into the shape of the token it replaces.
 *
 * @param parts - The split of the original token.
 * @param body - The replacement utility.
 * @returns The replacement carrying the original variants and important markers.
 */
export function joinToken(parts: SplitToken, body: string): string {
  return `${parts.prefix}${parts.leadingImportant}${body}${parts.trailingImportant}`
}

/**
 * The whitespace a rewritten attribute should put between its tokens.
 *
 * Long class lists are routinely written one token per line, and joining the
 * rewrite with single spaces would collapse the whole attribute onto one line -
 * a diff about layout, on every line, hiding the one token that actually
 * changed. So the separator is taken from the attribute rather than assumed:
 * whichever run of whitespace the author used most between tokens, which is a
 * single space for an ordinary attribute and the indented newline for a
 * multi-line one.
 *
 * @param value - Raw contents of a class attribute, without the quotes.
 * @returns The separator to join rewritten tokens with.
 */
export function dominantSeparator(value: string): string {
  const separators = value.trim().match(/\s+/g)
  if (!separators?.length) return ' '

  const counts = new Map<string, number>()
  for (const separator of separators) counts.set(separator, (counts.get(separator) ?? 0) + 1)

  // Ties go to the longer separator: an attribute split across lines that
  // happens to put two tokens on one line is still a multi-line attribute.
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0][0]
}

export interface SplitClassValue {
  /** Whitespace before the first token. */
  leading: string
  /** The tokens themselves. */
  tokens: string[]
  /** Whitespace after the last token. */
  trailing: string
  /** The whitespace to put between tokens when rewriting. */
  separator: string
}

/**
 * Split a class attribute's contents into tokens, keeping the whitespace that
 * framed and separated them so a rewrite reads like the code around it.
 *
 * @param value - Raw contents of a class attribute, without the quotes.
 * @returns The tokens and the whitespace that shaped them.
 */
export function splitClassValue(value: string): SplitClassValue {
  const leading = /^\s*/.exec(value)?.[0] ?? ''
  const trailing = value.trim() ? (/\s*$/.exec(value)?.[0] ?? '') : ''
  const tokens = value.trim() ? value.trim().split(/\s+/) : []
  return { leading, tokens, trailing, separator: dominantSeparator(value) }
}
