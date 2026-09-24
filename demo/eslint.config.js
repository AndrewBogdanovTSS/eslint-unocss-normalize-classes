import { fileURLToPath } from 'node:url'
import unocss from '@unocss/eslint-config/flat'
import unocssNormalize, { themedConfigs } from 'eslint-plugin-unocss-normalize-classes'
import vueParser from 'vue-eslint-parser'
import { themes } from './themes.ts'

const root = fileURLToPath(new URL('.', import.meta.url))

// The project-wide config: the base merged with whichever theme was prepared
// last. Shared code is linted against it, which is safe because the themes
// mark their own shortcuts `scoped`. Absolute, so `eslint` finds it whatever
// directory it is run from.
const configPath = fileURLToPath(new URL('./uno.config.ts', import.meta.url))

export default [
  { ignores: ['.nuxt/**', '.output/**', 'node_modules/**'] },
  {
    files: ['**/*.vue'],
    languageOptions: { parser: vueParser },
    plugins: {
      'unocss-normalize': unocssNormalize,
      'unocss': unocss.plugins.unocss,
    },
    settings: { unocss: { configPath } },
    rules: {
      // The sorter decides the order of the tokens; the normaliser decides
      // which tokens they are. Both in one run - see the README.
      //
      // Listed first on purpose: when both rewrite the same attribute in one
      // pass, ESLint applies the rule configured first, so classes are sorted
      // before they are normalised. The theme blocks below only replace the
      // normaliser's options, not its place in this order.
      'unocss/order': 'error',
      // `variantGroups` is on because this demo's build runs
      // `transformerVariantGroup` - see base/uno.config.ts.
      'unocss-normalize/classes': ['error', { variantGroups: true }],
    },
  },

  // Each theme's directory, linted against that theme's own config with
  // `allowScoped` on: a file under `themes/forest/` only ever ships in the
  // forest build, so there `title` means forest's title and nothing else.
  // `variantGroups` is repeated because a later block replaces the rule's
  // options rather than merging them.
  ...themedConfigs({ themes, rootDir: root, ruleOptions: { variantGroups: true } }),
]
