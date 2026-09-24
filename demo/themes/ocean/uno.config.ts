import { scoped } from 'eslint-plugin-unocss-normalize-classes/config'
import { defineConfig } from 'unocss'

/**
 * Ocean's vocabulary.
 *
 * `themes/forest` defines the same two names with different utilities, so
 * `title` means one thing in this build and another in that one. `scoped()`
 * says so: the linter will not collapse shared code into these names, because
 * that code also ships in the forest build, where they mean something else.
 */
export default defineConfig({
  shortcuts: [
    ...scoped({
      title: 'text-2xl c-sky-800 fw-bold tracking-tight',
      surface: 'b b-sky-200 rounded-xl bg-sky-50 p-6',
    }),
  ],
})
