/**
 * `unocss-normalize/classes` - normalize static class attributes against the
 * project's own UnoCSS config, and only where the rewrite is provably the same
 * CSS.
 *
 * Scope is deliberately narrow. Static `class` attributes in Vue templates are
 * a whitespace-delimited list of tokens, which is a thing a rewrite can be
 * proved about. A `:class` binding is a JavaScript expression, where the class
 * list is a value the rule cannot see; guessing at string literals inside one
 * would trade the guarantee for reach.
 */
import { fileURLToPath } from 'node:url'
import type { Rule } from 'eslint'
import { createSyncFn } from 'synckit'
import type { PlanResult } from './core/plan'
import type { PlanOptions, PlanRequest } from './session'

/**
 * Resolved from this module rather than from the package root, and written so
 * the same specifier works from `src/` during development and from `dist/`
 * once built - `../dist/worker.mjs` lands on the same file either way.
 */
const workerPath = fileURLToPath(new URL('../dist/worker.mjs', import.meta.url))
const syncPlan = createSyncFn<(...request: PlanRequest) => Promise<PlanResult>>(workerPath)

export interface RuleOptions {
  shortcuts?: boolean
  allowScoped?: boolean
  blocklist?: boolean
  variantGroups?: boolean | { minimum: number }
  reportUnproven?: boolean
  rootFontSize?: number | false
  configPath?: string
}

const DEFAULTS: Required<Omit<RuleOptions, 'configPath'>> = {
  shortcuts: true,
  // Off by default: the safe answer for a file whose layer is unknown, which
  // is every file until a config block says otherwise. Scope a `files:` block
  // to the layer's own directory and turn it on there.
  allowScoped: false,
  blocklist: true,
  // Off by default: the grouped syntax only works when the build runs
  // `transformerVariantGroup`, and this rule cannot see a transformer that a
  // framework module registers outside `uno.config.ts` - which is how a Nuxt
  // project usually registers it.
  variantGroups: false,
  reportUnproven: true,
  rootFontSize: 16,
}

interface VueTemplateNode {
  directive?: boolean
  key: { name?: string }
  value?: { value: string, type: string }
}

interface VueParserServices {
  defineTemplateBodyVisitor: (
    templateVisitor: Record<string, (node: never) => void>,
    scriptVisitor?: Rule.RuleListener,
  ) => Rule.RuleListener
}

const QUOTES = ['"', '\'']

/**
 * Hand every static `class` attribute in a Vue template to `onValue`.
 *
 * Shared by both rules, so they agree on what counts as a class list: a plain
 * `class` attribute with a literal value. A `:class` binding is a JavaScript
 * expression, and neither rule guesses at it.
 */
function classAttributes(
  context: Rule.RuleContext,
  onValue: (node: Rule.Node, value: string) => void,
): Rule.RuleListener {
  const parserServices = context.sourceCode.parserServices as unknown as Partial<VueParserServices>
  // Not a Vue file: `class` here is a plain attribute in some other language
  // and the rules have nothing to say about it.
  if (!parserServices.defineTemplateBodyVisitor) return {}

  return parserServices.defineTemplateBodyVisitor({
    VAttribute(attribute: VueTemplateNode) {
      if (attribute.directive || attribute.key.name !== 'class') return
      if (!attribute.value || attribute.value.type !== 'VLiteral') return
      if (!attribute.value.value.trim()) return

      onValue(attribute.value as unknown as Rule.Node, attribute.value.value)
    },
  })
}

/**
 * Rewrite a class attribute's value.
 *
 * Between the quotes, not over them: the same range `unocss/order` replaces.
 * ESLint applies one fix per range per pass, taking the lowest start first -
 * so a fix that began on the quote would always beat the sorter. With equal
 * ranges ESLint falls back to the order the rules are configured in, which a
 * project controls. An unquoted value has to gain quotes, so it is replaced
 * whole.
 */
function replaceValue(fixer: Rule.RuleFixer, context: Rule.RuleContext, node: Rule.Node, value: string): Rule.Fix {
  const { sourceCode } = context
  if (!QUOTES.includes(sourceCode.getText(node)[0])) return fixer.replaceText(node, `"${value}"`)

  const [start, end] = sourceCode.getRange(node)
  return fixer.replaceTextRange([start + 1, end - 1], value)
}

/** The rule's own option first, then the setting `@unocss/eslint-plugin` reads. */
function resolveConfigPath(context: Rule.RuleContext, configPath: string | undefined): string | undefined {
  const settings = context.settings as { unocss?: { configPath?: string } }
  return configPath ?? settings.unocss?.configPath
}

// ESLint validates rule schemas against JSON Schema draft-04, where
// `exclusiveMinimum` is a boolean modifier on `minimum` rather than a number
// of its own.
const rootFontSizeSchema = {
  anyOf: [
    { type: 'number', minimum: 0, exclusiveMinimum: true },
    { type: 'boolean', enum: [false] },
  ],
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    fixable: 'code',
    docs: {
      description:
        'Normalize static UnoCSS class attributes using the project config, applying only rewrites proved to generate identical CSS',
      url: 'https://github.com/AndrewBogdanovTSS/eslint-unocss-normalize-classes#readme',
    },
    schema: [{
      type: 'object',
      properties: {
        shortcuts: { type: 'boolean' },
        allowScoped: { type: 'boolean' },
        blocklist: { type: 'boolean' },
        variantGroups: {
          anyOf: [
            { type: 'boolean' },
            {
              type: 'object',
              properties: { minimum: { type: 'integer', minimum: 2 } },
              additionalProperties: false,
            },
          ],
        },
        reportUnproven: { type: 'boolean' },
        rootFontSize: rootFontSizeSchema,
        configPath: { type: 'string' },
      },
      additionalProperties: false,
    }],
    // Declared rather than only applied, so `pnpm check:docs` can read the
    // defaults out of the rule and compare them with the table in the README
    // instead of trusting that the two were written on the same day.
    defaultOptions: [DEFAULTS],
    messages: {
      normalize: 'This class list has a shorter equivalent: "{{before}}" → "{{after}}".',
      unproven:
        '"{{before}}" would be rewritten to "{{after}}", but that generates different CSS, so it was not applied. Fix the {{source}} entry, or write the replacement by hand.',
    },
  },

  create(context) {
    const options = { ...DEFAULTS, ...(context.options[0] ?? {}) } as Required<RuleOptions>
    const configPath = resolveConfigPath(context, options.configPath)

    // `true` is the shorthand for the ordinary case: group a prefix as soon as
    // two tokens share it.
    const variantGroups = options.variantGroups === true ? { minimum: 2 } : options.variantGroups

    const planOptions: PlanOptions = {
      shortcuts: options.shortcuts,
      allowScoped: options.allowScoped,
      blocklist: options.blocklist,
      rootFontSize: options.rootFontSize,
      variantGroups,
    }

    return classAttributes(context, (node, before) => {
      const plan = syncPlan(configPath, before, context.filename, planOptions)

      if (plan.changed) {
        context.report({
          node,
          messageId: 'normalize',
          data: { before, after: plan.value },
          fix: (fixer) => replaceValue(fixer, context, node, plan.value),
        })
      }

      if (!options.reportUnproven) return
      for (const refused of plan.unproven) {
        context.report({
          node,
          messageId: 'unproven',
          data: { before: refused.before, after: refused.after, source: refused.source },
        })
      }
    })
  },
}

export default rule

export interface ManualShortcutsOptions {
  allowScoped?: boolean
  rootFontSize?: number | false
  configPath?: string
}

const MANUAL_DEFAULTS: Required<Omit<ManualShortcutsOptions, 'configPath'>> = {
  // Off by default for the same reason as in `classes`: a scoped manual
  // shortcut is only ever suggested where the file's layer is known.
  allowScoped: false,
  rootFontSize: 16,
}

/**
 * `unocss-normalize/manual-shortcuts` - the collapses `classes` declines
 * because the config marked the shortcut `manual`, reported for a human.
 *
 * A rule of its own so it can carry its own severity. ESLint gives a rule one
 * severity for everything it reports, and a question for a reviewer is not the
 * same kind of finding as a rewrite that was proved and can be applied. The
 * rewrite is offered as a suggestion - one click in an editor - and never as a
 * fix, so `--fix` leaves it alone.
 */
export const manualShortcuts: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    hasSuggestions: true,
    docs: {
      description:
        'Report class lists that spell a shortcut marked manual, offering the proved rewrite as a suggestion rather than a fix',
      url: 'https://github.com/AndrewBogdanovTSS/eslint-unocss-normalize-classes#readme',
    },
    schema: [{
      type: 'object',
      properties: {
        allowScoped: { type: 'boolean' },
        rootFontSize: rootFontSizeSchema,
        configPath: { type: 'string' },
      },
      additionalProperties: false,
    }],
    defaultOptions: [MANUAL_DEFAULTS],
    messages: {
      manual:
        '"{{before}}" could be written as "{{after}}", which generates the same CSS - but {{names}} {{verb}} marked manual. Rewrite it by hand if the name fits this element.',
      apply: 'Rewrite as "{{after}}"',
    },
  },

  create(context) {
    const options = { ...MANUAL_DEFAULTS, ...(context.options[0] ?? {}) } as Required<ManualShortcutsOptions>
    const configPath = resolveConfigPath(context, options.configPath)

    const planOptions: PlanOptions = {
      shortcuts: true,
      allowScoped: options.allowScoped,
      blocklist: false,
      rootFontSize: options.rootFontSize,
      variantGroups: false,
      suggestManual: true,
    }

    return classAttributes(context, (node, before) => {
      const plan = syncPlan(configPath, before, context.filename, planOptions)
      if (!plan.changed) return

      // The shortcut names the rewrite would introduce - what the reviewer is
      // being asked about.
      const written = new Set(before.split(/\s+/))
      const names = plan.value.split(/\s+/).filter((token) => token && !written.has(token))

      context.report({
        node,
        messageId: 'manual',
        data: {
          before,
          after: plan.value,
          names: names.map((name) => `"${name}"`).join(', '),
          verb: names.length === 1 ? 'is' : 'are',
        },
        suggest: [{
          messageId: 'apply',
          data: { after: plan.value },
          fix: (fixer) => replaceValue(fixer, context, node, plan.value),
        }],
      })
    })
  },
}
