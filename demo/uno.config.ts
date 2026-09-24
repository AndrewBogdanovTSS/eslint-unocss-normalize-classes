/**
 * What the build and the project-wide ESLint entry both read: the base layer
 * merged with the active theme's, as `@unocss/nuxt` writes it on every
 * `prepare`, `dev` and `build`.
 *
 * The configs themselves live in the layers - `base/uno.config.ts` and
 * each `themes/<theme>/uno.config.ts`. This file only points at their merge,
 * which is the setup `nuxtLayers: true` asks for.
 */
export { default } from './.nuxt/uno.config.mjs'
