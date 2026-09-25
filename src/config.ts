/**
 * The half of this package a `uno.config.ts` can import.
 *
 * Deliberately separate from the plugin entry point: importing that one builds
 * a worker, and a UnoCSS config is loaded by the build as well as by ESLint.
 * Nothing here imports anything at runtime - the one import below is a type,
 * erased before any config loads this file.
 */
import type {
  BlocklistMeta,
  BlocklistRule,
  BlocklistValue,
  RuleMeta,
  StaticShortcut,
  StaticShortcutMap,
} from '@unocss/core'

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

/**
 * A shortcut's meta, plus the `scoped` marker this plugin reads.
 *
 * Additive in the same way {@link FixableBlocklistMeta} is: `RuleMeta` upstream
 * knows nothing about `scoped`, and UnoCSS ignores meta keys it does not
 * recognise, so marking a shortcut costs nothing at generation time and needs
 * no change upstream.
 *
 * @see {@link scoped} for the helper that applies it.
 */
export interface ScopedShortcutMeta extends RuleMeta {
  /**
   * The name's expansion depends on which config is merged.
   *
   * A project that composes its config from layers - a brand, a theme, a
   * white-label tenant - can define one name twice. `title-5` is
   * `text-xs fw-bold` under one layer and `text-base fw-bold lh-1` under
   * another, and both are correct where they are.
   *
   * Collapsing utilities into such a name changes what the attribute *means*:
   * a fixed set of utilities becomes a lookup whose result differs per build.
   * The proof cannot catch it, because it builds one generator from one config,
   * so both sides of the comparison come from the same layer and the rewrite is
   * genuinely equivalent *there*.
   *
   * Marked shortcuts are therefore not collapse sources, unless the rule is
   * told the file it is linting only ever ships with this layer - see the
   * `allowScoped` option.
   */
  scoped?: boolean
  /**
   * Suggest this shortcut; never write it.
   *
   * For names that carry meaning beyond their utilities. `vf-button-xs` is
   * `p-2 text-sm lh-1` today, but it also says "this is a small button" - and
   * collapsing a badge's `p-2 text-sm lh-1` into it would be provably
   * equivalent and still wrong. It would also tie the badge to whatever the
   * button becomes next.
   *
   * `unocss-normalize/classes` leaves a manual shortcut alone.
   * `unocss-normalize/manual-shortcuts` reports the collapse instead, with the
   * rewrite as an editor suggestion rather than a fix - wherever the collapse
   * would otherwise have been allowed, so a scoped manual shortcut is still
   * never proposed outside `allowScoped`.
   */
  manual?: boolean
}

/**
 * Mark every shortcut in `map` as {@link ScopedShortcutMeta.scoped | scoped}.
 *
 * Converts the map form to the tuple form, which is the only one with a meta
 * slot. Callers keep authoring maps, so whatever type check sits on the source
 * object still applies:
 *
 * ```ts
 * import { scoped } from 'eslint-plugin-unocss-normalize-classes/config'
 *
 * // brands/timberland/config/unocss/shortcuts/index.ts
 * export default [
 *   ...scoped({ ...button, ...typography }),
 * ] as UserShortcuts
 * ```
 *
 * Marking is per shortcut rather than per config on purpose. After
 * `mergeConfigs` a top-level flag is one scalar with nothing tying it to any
 * shortcut, and the merged `shortcuts` array keeps its per-layer segments but
 * not their boundaries - so the marker has to travel on the shortcut itself.
 *
 * **The CSS layer has to be restated, which is why `layer` is a parameter.**
 * `UnoGenerator.stringifyShortcuts` takes its meta as
 * `meta = { layer: this.config.shortcutsLayer }` - a *default parameter*, so it
 * applies only when a shortcut carries no meta at all. Attach any meta without
 * a `layer` and the shortcut's rules stop landing in the shortcuts layer and
 * fall through to the default one, which sorts after it: a cascade change, from
 * a marker that is supposed to be inert. `'shortcuts'` is UnoCSS's own default;
 * pass the value of `shortcutsLayer` if the config sets one.
 *
 * Pass `manual: true` for names that should only ever be suggested - see
 * {@link ScopedShortcutMeta.manual}:
 *
 * ```ts
 * export default [
 *   ...scoped(button, { manual: true }),
 *   ...scoped(typography),
 * ] as UserShortcuts
 * ```
 *
 * @param map - Static shortcuts, as a layer authors them.
 * @param options - Overrides.
 * @param options.layer - The CSS layer to keep them in, when the config sets a
 *   custom `shortcutsLayer`.
 * @param options.manual - Suggest these shortcuts; never write them.
 * @returns The same shortcuts as tuples, each carrying `{ scoped: true }`.
 */
export function scoped(
  map: StaticShortcutMap,
  options: { layer?: string, manual?: boolean } = {},
): StaticShortcut[] {
  // UnoCSS's `LAYER_SHORTCUTS`, inlined: this module is imported by a
  // `uno.config.ts`, which the build loads too, and it stays import-free.
  const layer = options.layer ?? 'shortcuts'

  return Object.entries(map).map(([name, value]): StaticShortcut => {
    const meta: ScopedShortcutMeta = options.manual
      ? { layer, scoped: true, manual: true }
      : { layer, scoped: true }

    return [name, value, meta]
  })
}
