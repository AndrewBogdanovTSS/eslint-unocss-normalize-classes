/**
 * `eslint-plugin-unocss-normalize-classes/nuxt` - one merged UnoCSS config per
 * theme, for a project that picks its theme layer at build time.
 *
 * `@unocss/nuxt` writes `<buildDir>/uno.config.mjs` for the layers that are
 * enabled, which in a themed project means the active theme's and no other.
 * The rule reads one config per run, so a component that only ships with one
 * theme gets linted against whichever theme was prepared last - and a shortcut
 * the config marks `scoped` is refused there, even though its meaning in that
 * directory is fixed.
 *
 * This writes `<buildDir>/uno/config/<theme>.mjs` for every theme, and
 * `themedConfigs()` from the package root points a `files:`-scoped block at
 * each one with `allowScoped` on.
 *
 * Written as Nuxt templates rather than by a script: `nuxi prepare` deletes
 * files in the build directory that Nuxt did not write itself, so every
 * `prepare`, `dev` and `build` has to be the thing that writes them.
 */
import { existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { addTemplate, defineNuxtModule, findPath } from '@nuxt/kit'
import { themedConfigFile } from './themes'

export interface ModuleOptions {
  /**
   * The themes to write a config for, each mapped to the directory - relative
   * to `rootDir` - that holds that theme's own layers.
   *
   * @example { dark: 'themes/dark', light: 'themes/light' }
   */
  themes: Record<string, string>
  /**
   * Directories, relative to `rootDir`, whose layers every theme merges
   * beneath its own. Any other layer Nuxt has enabled - the active theme's, or
   * one a command switches on, such as a Storybook layer - is left out, so the
   * output does not depend on which command ran last.
   */
  shared: string[]
}

/** Nuxt hands paths over forward-slashed on every platform; keep them that way. */
const slash = (path: string): string => path.replaceAll('\\', '/')

/**
 * `@unocss/core`, resolved from this package - which depends on it - rather
 * than left as a bare specifier for the project to resolve.
 *
 * The generated files live in `<buildDir>/uno/config/`, and a strict pnpm
 * install puts nothing at the project root that a file there can reach unless
 * the project lists `@unocss/core` itself. `@unocss/nuxt` gets away with the
 * bare name because Nuxt resolves it; ESLint loads these files, and does not.
 */
const unocssCore = slash(createRequire(import.meta.url).resolve('@unocss/core'))

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: 'uno-themed-configs',
    configKey: 'unoThemedConfigs',
    // The oldest release this has run under, and the major it targets.
    compatibility: { nuxt: '^3.17.0 || ^4.0.0' },
  },
  defaults: {
    themes: {},
    shared: [],
  },
  setup({ themes, shared }, nuxt) {
    const { rootDir } = nuxt.options
    const sharedRoots = shared.map((directory) => `${slash(resolve(rootDir, directory))}/`)

    /**
     * The shared layers, found the way `@unocss/nuxt` finds layers for its own
     * `uno.config.mjs`: `_layers` minus the project root, a `findPath` per
     * layer root, reversed into merge order.
     *
     * Deliberately not Nuxt 4's `getLayerDirectories()`. The output has to
     * agree with `@unocss/nuxt`'s layer for layer, so it asks the same question
     * the same way - which is also what keeps it running on Nuxt 3, whose kit
     * has no such function.
     */
    const sharedLayers = async (): Promise<string[]> => {
      const found = await Promise.all(nuxt.options._layers.slice(1).map(({ config }) =>
        findPath(['uno.config', 'unocss.config'], { cwd: config.rootDir })))

      return found
        .filter((path): path is string => !!path && sharedRoots.some((root) => slash(path).startsWith(root)))
        .map(slash)
        .reverse()
    }

    for (const [theme, directory] of Object.entries(themes)) {
      addTemplate({
        filename: themedConfigFile(theme),
        getContents: async () => render([...await sharedLayers(), ...themeLayers(resolve(rootDir, directory))]),
        write: true,
      })
    }
  },
})

/**
 * Every UnoCSS config at the root of one of a theme's own layers, least
 * specific first.
 *
 * A layer root is a directory with its own `nuxt.config`, which is the only
 * place `@unocss/nuxt` looks. Depth stands in for specificity: a nested layer
 * overrides the one it sits in, and `mergeConfigs` gives the last word to the
 * last entry.
 */
function themeLayers(themeDir: string): string[] {
  // A theme with no directory yet contributes nothing, rather than failing
  // every `prepare`, `dev` and `build` on an ENOENT.
  if (!existsSync(themeDir)) return []

  const found: string[] = []

  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (/^(?:uno|unocss)\.config\.[cm]?[jt]s$/.test(entry.name) && isLayerRoot(directory)) found.push(slash(path))
    }
  }

  walk(themeDir)

  return found.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))
}

function isLayerRoot(directory: string): boolean {
  return ['ts', 'js', 'mjs'].some((extension) => existsSync(join(directory, `nuxt.config.${extension}`)))
}

/** The same shape `@unocss/nuxt` emits for `uno.config.mjs`. */
function render(layers: string[]): string {
  return [
    '// Generated by eslint-plugin-unocss-normalize-classes/nuxt. Do not edit.',
    `import { mergeConfigs } from '${unocssCore}'`,
    ...layers.map((path, index) => `import cfg${index} from '${path}'`),
    '',
    `export default mergeConfigs([${layers.map((_path, index) => `cfg${index}`).join(', ')}])`,
    '',
  ].join('\n')
}
