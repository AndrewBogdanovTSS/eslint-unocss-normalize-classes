/**
 * The half of this package a `uno.config.ts` can import.
 *
 * Deliberately separate from the plugin entry point: importing that one builds
 * a worker, and a UnoCSS config is loaded by the build as well as by ESLint.
 * Nothing here imports anything.
 */

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
export function hideFixes<T>(blocklist: readonly T[]): T[] {
  return blocklist.map((rule) => {
    if (!Array.isArray(rule)) return rule

    const [pattern, meta] = rule as [unknown, Record<string, unknown> | undefined]
    if (!meta || typeof meta.fix !== 'function') return rule

    const { fix, ...rest } = meta
    Object.defineProperty(rest, 'fix', { value: fix, enumerable: false })
    return [pattern, rest] as T
  })
}
