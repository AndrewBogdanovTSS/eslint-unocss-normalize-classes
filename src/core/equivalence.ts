/**
 * Does one class list generate the same CSS as another?
 *
 * This is the whole safety argument of the package. A rewrite that looks like
 * an alias can land on a different value: `blur-[4px]` and `blur-1` differ by
 * a factor of four, because `blur` does not use the 0.25rem spacing scale that
 * makes `m-[4px]` and `m-1` interchangeable. Reading a blocklist message tells
 * you a token is discouraged; it does not tell you the suggested replacement
 * renders the same pixels. Generating both and comparing does.
 *
 * Comparison is on declarations, not on stylesheet text, because two identical
 * results can be spelled differently:
 *
 *   - selector names differ (`.c-black` vs `.hover\:c-black:hover`)
 *   - a value may be inlined on one side and reached through a custom property
 *     on the other, which is how `c-black/50` relates to `c-black c-op-50`
 *   - lengths may be written in `rem` on one side and `px` on the other
 *
 * The last one is the only place this module assumes anything, and it says so
 * out loud: see `rootFontSize`.
 */

export interface EquivalenceOptions {
  /**
   * The root font size, in pixels, used to compare a `rem` length against a
   * `px` one. `16` is the browser default and the only assumption the prover
   * makes; a project that sets `html { font-size }` to something else should
   * say so here.
   *
   * `false` turns the conversion off entirely: `4px` and `0.25rem` are then
   * treated as different, so `m-[4px]` -> `m-1` stops being provable and gets
   * reported instead of fixed. That is the strict reading, and it is the right
   * one for a project whose users change their browser's font size - the two
   * lengths genuinely stop being equal the moment the root does.
   */
  rootFontSize?: number | false
}

const DECLARATION_BLOCK = /\{([^{}]*)\}/g
const REM_LENGTH = /(-?[\d.]+)rem\b/g
const CSS_VAR_REFERENCE = /var\((--[\w-]+)\)/g

const isCustomProperty = (declaration: string): boolean => declaration.split(':')[0].trim().startsWith('--')

/**
 * Reduce generated CSS to the set of declarations a browser would end up
 * computing, with custom properties resolved the way the cascade resolves them
 * - the last declaration of a property in the emitted sheet wins.
 *
 * @param css - Generated stylesheet text.
 * @param options - Comparison options.
 * @returns A stable, order-independent string of declarations.
 */
export function computedDeclarations(css: string, options: EquivalenceOptions = {}): string {
  const { rootFontSize = 16 } = options
  const normalized = rootFontSize === false
    ? css
    : css.replace(REM_LENGTH, (_, value: string) => `${Number.parseFloat(value) * rootFontSize}px`)

  const declarations = [...normalized.matchAll(DECLARATION_BLOCK)]
    .flatMap(([, body]) => body.split(';').map((declaration) => declaration.trim()))
    .filter(Boolean)

  const customProperties = new Map<string, string>()
  for (const declaration of declarations) {
    const [property, ...value] = declaration.split(':')
    if (isCustomProperty(declaration)) customProperties.set(property.trim(), value.join(':').trim())
  }

  return declarations
    .filter((declaration) => !isCustomProperty(declaration))
    .map((declaration) =>
      declaration.replace(CSS_VAR_REFERENCE, (raw, name: string) => customProperties.get(name) ?? raw))
    .sort()
    .join(' | ')
}

/**
 * Whether two generated stylesheets compute to the same declarations.
 *
 * Empty is never equivalent to empty. Two class lists that both generate
 * nothing are not proved equal - they are proved absent, which is what happens
 * when a token is misspelled on both sides, and rewriting one unknown token
 * into another is the opposite of safe.
 *
 * @param before - Generated CSS for the original class list.
 * @param after - Generated CSS for the proposed replacement.
 * @param options - Comparison options.
 * @returns `true` only when both sides generated something and it computes the same.
 */
export function isEquivalent(before: string, after: string, options: EquivalenceOptions = {}): boolean {
  const left = computedDeclarations(before, options)
  const right = computedDeclarations(after, options)
  if (!left || !right) return false
  return left === right
}
