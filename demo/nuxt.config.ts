export default defineNuxtConfig({
  compatibilityDate: '2026-09-18',
  modules: ['@unocss/nuxt'],
  devtools: { enabled: false },

  // The module reads `uno.config.ts` from the project root, which is the same
  // file the ESLint rule reads. One config, two consumers - that is the whole
  // idea being demonstrated.
  unocss: { nuxtLayers: true },
})
