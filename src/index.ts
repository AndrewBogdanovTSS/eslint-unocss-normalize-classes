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
import classes from './rule'

declare const __PLUGIN_VERSION__: string

export { computedDeclarations, isEquivalent } from './core/equivalence'
export type { EquivalenceOptions } from './core/equivalence'
export { planRewrite } from './core/plan'
export type { PlanDeps, PlanResult, UnprovenRewrite } from './core/plan'
export { applyShortcut, collapsibleShortcuts, matchShortcut } from './core/shortcuts'
export type { ShortcutMatch, ShortcutSet } from './core/shortcuts'
export { joinToken, lastVariantSeparator, splitClassValue, splitToken } from './core/tokens'
export type { SplitToken } from './core/tokens'
export type { PlanOptions, PlanRequest } from './session'
export { planForConfig } from './session'
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

export default plugin
