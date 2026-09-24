/**
 * Every theme this app can be built as, and the directory holding its layer.
 *
 * Read by `nuxt.config.ts`, which extends the one named by `THEME`, and by
 * `eslint.config.js`, which lints each theme's directory against that theme's
 * own UnoCSS config. Plain data with no imports: `eslint.config.js` loads this
 * file through Node itself, not through Nuxt.
 */
export const themes = {
  ocean: 'themes/ocean',
  forest: 'themes/forest',
}
