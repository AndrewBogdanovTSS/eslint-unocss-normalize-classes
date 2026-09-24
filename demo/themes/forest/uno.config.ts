import { scoped } from 'eslint-plugin-unocss-normalize-classes/config'
import { defineConfig } from 'unocss'

/**
 * Forest's vocabulary - the same two names as `themes/ocean`, meaning
 * something else. See that file for why they are `scoped`.
 */
export default defineConfig({
  shortcuts: [
    ...scoped({
      title: 'text-xl c-emerald-900 fw-semibold tracking-wide uppercase',
      surface: 'b-l-4 b-emerald-600 bg-emerald-50 p-6',
    }),
  ],
})
