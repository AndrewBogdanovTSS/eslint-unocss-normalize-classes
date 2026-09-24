/**
 * eslint-plugin-unocss-normalize-classes
 *
 * One rule, `unocss-normalize/classes`, that rewrites static UnoCSS class
 * attributes into the shorter spellings the project's own config already
 * defines - and refuses to write any rewrite it cannot prove generates the
 * same CSS.
 *
 * The parts are exported as well as the plugin, because the interesting half
 * is portable: `planRewrite` knows nothing about ESLint, and `isEquivalent`
 * knows nothing about either. A project can use them in a codemod, and
 * `@unocss/eslint-plugin` - whose own `blocklist` rule already declares
 * `fixable: 'code'` and never emits a fix - could adopt them without taking
 * this package as a dependency.
 */
import type { ESLint, Linter } from 'eslint'
import classes from './rule'
import type { ThemedConfigsOptions } from './themes'
import { buildThemedConfigs } from './themes'

declare const __PLUGIN_VERSION__: string

export { computedDeclarations, isEquivalent } from './core/equivalence'
export type { EquivalenceOptions } from './core/equivalence'
export { planRewrite } from './core/plan'
export type { PlanDeps, PlanResult, UnprovenRewrite } from './core/plan'
export { applyShortcut, collapsibleShortcuts, matchShortcut } from './core/shortcuts'
export type { ShortcutMatch, ShortcutSet } from './core/shortcuts'
export { joinToken, lastVariantSeparator, splitClassValue, splitToken } from './core/tokens'
export type { SplitToken } from './core/tokens'
export type { RuleOptions } from './rule'
export type { PlanOptions, PlanRequest } from './session'
export { planForConfig } from './session'
export type { ThemedConfigsOptions } from './themes'
export { classes }

const plugin = {
  meta: {
    name: 'eslint-plugin-unocss-normalize-classes',
    // Substituted at build time from package.json - see tsdown.config.ts.
    version: typeof __PLUGIN_VERSION__ === 'string' ? __PLUGIN_VERSION__ : '0.0.0-dev',
  },
  rules: { classes },
  configs: {} as Record<string, unknown>,
}

/**
 * A ready-made flat config entry. It does not set a parser: Vue templates need
 * `vue-eslint-parser`, and a plugin that silently installed a parser would
 * fight whatever the project already configured. See the README.
 */
plugin.configs.recommended = [{
  files: ['**/*.vue'],
  plugins: { 'unocss-normalize': plugin },
  rules: { 'unocss-normalize/classes': 'error' },
}]

/**
 * Flat-config blocks that lint each theme's directory against that theme's
 * own UnoCSS config, with `allowScoped` on.
 *
 * The consuming half of `eslint-plugin-unocss-normalize-classes/nuxt`: that
 * module writes `<buildDir>/uno/config/<theme>.mjs`, and this reads them. Pass
 * the same `themes` map to both, and spread the result after the project-wide
 * entry so its blocks win for the files they match.
 *
 * ```js
 * import unocssNormalize, { themedConfigs } from 'eslint-plugin-unocss-normalize-classes'
 *
 * export default [
 *   ...unocssNormalize.configs.recommended,
 *   ...themedConfigs({ themes: { dark: 'themes/dark', light: 'themes/light' } }),
 * ]
 * ```
 *
 * @param options - See {@link ThemedConfigsOptions}.
 * @returns One block per theme whose config is on disk.
 */
export function themedConfigs(options: ThemedConfigsOptions): Linter.Config[] {
  return buildThemedConfigs(plugin as unknown as ESLint.Plugin, options)
}

export default plugin
