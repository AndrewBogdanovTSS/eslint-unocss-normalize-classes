/**
 * Shortcuts, read as rewrite rules.
 *
 * A shortcut is already a name for a set of utilities - `underlined` *is*
 * `underline underline-offset-3`, declared by the project in its own config.
 * That makes the collapse direction derivable with no new convention and no
 * prose to parse: if a class attribute contains every token of a shortcut's
 * expansion, those tokens can be replaced by the shortcut's name.
 *
 * Matching is order-independent, because a class attribute is a set and
 * `"w-full flex h-full"` names the same thing as `"flex w-full h-full"`.
 */
import { parseVariantGroup } from '@unocss/core'

export interface ShortcutSet {
  /** The shortcut's name, e.g. `underlined`. */
  name: string
  /** The utilities it stands for, variant groups expanded. */
  tokens: string[]
  /**
   * The config marked this shortcut `scoped`: its expansion depends on which
   * layer is merged, so collapsing into the name is only correct in code that
   * ships with that one layer.
   *
   * Optional so a set built by hand - a codemod calling `planRewrite`
   * directly - needs no answer to a question it does not have.
   *
   * @see `ScopedShortcutMeta` in `../config`, and the `scoped` helper beside it.
   */
  scoped?: boolean
}

/**
 * The shortcuts that are collapsible: statically named, statically valued, and
 * standing for more than one utility.
 *
 * A single-token shortcut is skipped on purpose. Collapsing `a` to `b` when
 * both are one token is a rename, not a simplification, and the blocklist is
 * where a project says it wants one.
 *
 * A `scoped` set is returned rather than dropped, because whether it may be
 * used depends on the file being linted, which this function does not see. The
 * caller decides; `session.ts` filters.
 *
 * @param shortcuts - `uno.config.shortcuts`, after UnoCSS has resolved it.
 * @returns Collapsible sets, longest first, so the biggest match wins.
 */
export function collapsibleShortcuts(shortcuts: readonly unknown[]): ShortcutSet[] {
  const sets: ShortcutSet[] = []

  for (const shortcut of shortcuts) {
    if (!Array.isArray(shortcut)) continue
    const [name, value, meta] = shortcut as [unknown, unknown, { scoped?: unknown } | undefined]
    if (typeof name !== 'string' || typeof value !== 'string') continue

    // A shortcut may itself be written with variant groups
    // (`active:(bg-grey-90 c-grey-10)`); expanded, its tokens line up with the
    // tokens a template actually carries.
    const tokens = parseVariantGroup(value).expanded.trim().split(/\s+/).filter(Boolean)
    if (tokens.length > 1) sets.push({ name, tokens, scoped: meta?.scoped === true })
  }

  return sets.sort((a, b) => b.tokens.length - a.tokens.length)
}

export interface ShortcutMatch {
  /** The shortcut that matched. */
  shortcut: ShortcutSet
  /** Indexes in the token list the shortcut's tokens were found at. */
  indexes: number[]
}

/**
 * Find a shortcut's tokens inside a class list, each one claimed at most once.
 *
 * @param tokens - The class list.
 * @param shortcut - The shortcut to look for.
 * @returns The match, or `null` when at least one token is missing.
 */
export function matchShortcut(tokens: readonly string[], shortcut: ShortcutSet): ShortcutMatch | null {
  const claimed = new Set<number>()

  for (const required of shortcut.tokens) {
    const index = tokens.findIndex((token, at) => token === required && !claimed.has(at))
    if (index === -1) return null
    claimed.add(index)
  }

  return { shortcut, indexes: [...claimed] }
}

/**
 * Replace a matched shortcut's tokens with its name.
 *
 * The name takes the position of the earliest token it replaces, so a rewrite
 * does not quietly reorder the rest of the attribute.
 *
 * @param tokens - The class list.
 * @param match - A match from `matchShortcut`.
 * @returns The class list with the match collapsed.
 */
export function applyShortcut(tokens: readonly string[], match: ShortcutMatch): string[] {
  const claimed = new Set(match.indexes)
  const insertAt = Math.min(...match.indexes)
  const kept = tokens.filter((_token, index) => !claimed.has(index))
  kept.splice(insertAt, 0, match.shortcut.name)
  return kept
}
