import { fileURLToPath } from 'node:url'
import unocss from '@unocss/eslint-config/flat'
import unocssNormalize from 'eslint-plugin-unocss-normalize-classes'
import vueParser from 'vue-eslint-parser'

// Absolute, so `eslint` finds the config whatever directory it is run from.
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
      'unocss/order': 'error',
      'unocss-normalize/classes': 'error',
    },
  },
]
