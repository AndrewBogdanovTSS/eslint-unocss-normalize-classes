/**
 * The half of this package a `uno.config.ts` can import.
 *
 * Deliberately separate from the plugin entry point: importing that one builds
 * a worker, and a UnoCSS config is loaded by the build as well as by ESLint.
 * Nothing here imports anything at runtime - the one import below is a type,
 * erased before any config loads this file.
 */
import type { BlocklistMeta, BlocklistRule, BlocklistValue } from '@unocss/core'

/**
 * A blocklist entry's meta, plus the `fix` this plugin reads.
 *
 * Additive by design. `BlocklistMeta` upstream carries only `message`, and
 * UnoCSS ignores meta keys it does not recognise, so a config can declare
 * `fix` today without waiting for anything upstream to change. Extending the
 * upstream interface rather than restating it means any field UnoCSS adds
 * arrives here too.
 *
 * @see {@link FixableBlocklistRule} for the entry this sits inside.
 */
export interface FixableBlocklistMeta extends BlocklistMeta {
  /**
   * What replaces the blocked token - one replacement, or several.
   *
   * Receives the token as written, so an entry matching `^border$` is still
   * asked about `sm:hover:!border`. A `fix` that throws is treated as no fix:
   * a mistake in a config should cost a missing rewrite, not a crashed lint.
   */
  fix?: (selector: string) => string | string[]
}

/**
 * A blocklist entry whose meta may declare a `fix`.
 *
 * The same shape as UnoCSS's `BlocklistRule`, with {@link FixableBlocklistMeta}
 * in place of `BlocklistMeta`. Type a project's blocklist as an array of these
 * and `fix` is checked where it is written, rather than at the call that
 * finally reads it.
 */
export type FixableBlocklistRule = BlocklistValue | [BlocklistValue, FixableBlocklistMeta]

/**
 * Hide every `fix` from object spreads, keeping it readable.
 *
 * `unocss/blocklist` sends a matched entry's meta to a worker thread, and it
 * sends the whole object: `{ ...meta, message }`. A function cannot cross that
 * boundary, so an ordinary `fix` property turns a lint of one file from twelve
 * seconds into thirteen minutes - measured, on a real project.
 *
 * Defining it non-enumerably takes it out of the spread while leaving property
 * access - which is how this plugin reads it - working exactly as before.
 *
 * ```ts
 * import { hideFixes } from 'eslint-plugin-unocss-normalize-classes/config'
 *
 * export default defineConfig({
 *   blocklist: hideFixes([
 *     [/^border$/, { message: 'use shorter "b"', fix: () => ['b'] }],
 *   ]),
 * })
 * ```
 *
 * @param blocklist - Blocklist entries, `fix` written as an ordinary property.
 * @returns The same entries, with each `fix` hidden from enumeration.
 */
export function hideFixes(blocklist: readonly FixableBlocklistRule[]): BlocklistRule[]
export function hideFixes<T>(blocklist: readonly T[]): T[]
export function hideFixes(blocklist: readonly unknown[]): unknown[] {
  return blocklist.map((rule) => {
    if (!Array.isArray(rule)) return rule

    const [pattern, meta] = rule as [unknown, Record<string, unknown> | undefined]
    if (!meta || typeof meta.fix !== 'function') return rule

    const { fix, ...rest } = meta
    Object.defineProperty(rest, 'fix', { value: fix, enumerable: false })
    return [pattern, rest]
  })
}
