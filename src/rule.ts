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

interface RuleOptions {
  shortcuts?: boolean
  blocklist?: boolean
  reportUnproven?: boolean
  rootFontSize?: number | false
  configPath?: string
}

const DEFAULTS: Required<Omit<RuleOptions, 'configPath'>> = {
  shortcuts: true,
  blocklist: true,
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
        blocklist: { type: 'boolean' },
        reportUnproven: { type: 'boolean' },
        // ESLint validates rule schemas against JSON Schema draft-04, where
        // `exclusiveMinimum` is a boolean modifier on `minimum` rather than a
        // number of its own.
        rootFontSize: {
          anyOf: [
            { type: 'number', minimum: 0, exclusiveMinimum: true },
            { type: 'boolean', enum: [false] },
          ],
        },
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
    const settings = context.settings as { unocss?: { configPath?: string } }
    const configPath = options.configPath ?? settings.unocss?.configPath

    const planOptions: PlanOptions = {
      shortcuts: options.shortcuts,
      blocklist: options.blocklist,
      rootFontSize: options.rootFontSize,
    }

    const sourceCode = context.sourceCode
    const parserServices = sourceCode.parserServices as unknown as Partial<VueParserServices>
    // Not a Vue file: `class` here is a plain attribute in some other language
    // and the rule has nothing to say about it.
    if (!parserServices.defineTemplateBodyVisitor) return {}

    return parserServices.defineTemplateBodyVisitor({
      VAttribute(attribute: VueTemplateNode) {
        if (attribute.directive || attribute.key.name !== 'class') return
        if (!attribute.value || attribute.value.type !== 'VLiteral') return

        const before = attribute.value.value
        if (!before.trim()) return

        const plan = syncPlan(configPath, before, context.filename, planOptions)
        const node = attribute.value as unknown as Rule.Node

        if (plan.changed) {
          const raw = sourceCode.getText(node)
          const quote = QUOTES.includes(raw[0]) ? raw[0] : '"'
          context.report({
            node,
            messageId: 'normalize',
            data: { before, after: plan.value },
            fix: (fixer) => fixer.replaceText(node, `${quote}${plan.value}${quote}`),
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
      },
    })
  },
}

export default rule
