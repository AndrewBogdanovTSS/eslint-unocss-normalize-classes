import process from 'node:process'
import { themes } from './themes'

// Picked at build time, the way a multi-brand project picks its brand:
// `pnpm dev` builds `ocean`, `pnpm dev:forest` loads `.env.forest`.
const theme = process.env.THEME ?? 'ocean'
if (!(theme in themes))
  throw new Error(`THEME must be one of: ${Object.keys(themes).join(', ')} - got "${theme}"`)

export default defineNuxtConfig({
  compatibilityDate: '2026-09-18',
  devtools: { enabled: false },

  // Pinned, because `uno.config.ts` imports `./.nuxt/uno.config.mjs`. Left
  // alone, `nuxt build` writes its templates to `node_modules/.cache/nuxt/.nuxt`
  // instead - so a build would read whichever theme `.nuxt` last held, not the
  // one it was asked for, and style the forest app with ocean's shortcuts.
  buildDir: '.nuxt',

  // Highest priority first: the one theme this build ships, then the base
  // every theme shares. The other theme is not a layer of this build at all.
  extends: [`./${themes[theme as keyof typeof themes]}`, './base'],

  modules: ['@unocss/nuxt', 'eslint-plugin-unocss-normalize-classes/nuxt'],

  // `@unocss/nuxt` merges the layers' UnoCSS configs into
  // `.nuxt/uno.config.mjs` - for the active theme, which is all a build needs.
  unocss: { nuxtLayers: true },

  // This writes one per theme, `.nuxt/uno/config/<theme>.mjs`, which is what
  // ESLint needs: every theme's files, linted against their own theme.
  unoThemedConfigs: { themes, shared: ['base'] },
})
