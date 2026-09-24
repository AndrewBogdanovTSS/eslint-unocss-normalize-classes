/**
 * The one fact the `/nuxt` module and the ESLint helper have to agree on:
 * where a theme's merged UnoCSS config lives.
 *
 * Kept in its own module so the Nuxt side can import it without the rule, and
 * the rule side without `@nuxt/kit`. Imports nothing heavier than `node:`.
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import type { ESLint, Linter } from 'eslint'
import type { RuleOptions } from './rule'

/**
 * A theme's config file, relative to Nuxt's `buildDir`.
 *
 * @param theme - The theme's name, as a key of the `themes` option.
 * @returns The path the `/nuxt` module writes and the helper reads.
 */
export const themedConfigFile = (theme: string): string => `uno/config/${theme}.mjs`

export interface ThemedConfigsOptions {
  /**
   * The same map the `/nuxt` module takes: each theme's name, mapped to the
   * directory - relative to `rootDir` - that holds its layers. Every `.vue`
   * file under that directory is linted against that theme's own config.
   */
  themes: Record<string, string>
  /** The project root the theme directories are relative to. Defaults to `process.cwd()`. */
  rootDir?: string
  /** Nuxt's `buildDir`, relative to `rootDir`. Defaults to `.nuxt`. */
  buildDir?: string
  /** Severity for the theme blocks. Defaults to `'error'`. */
  severity?: 'error' | 'warn'
  /**
   * Rule options for the theme blocks, beside the `configPath` and
   * `allowScoped` the helper sets itself. A later flat-config block replaces a
   * rule's options wholesale, so anything the project-wide entry sets has to be
   * repeated here to survive into the theme directories.
   */
  ruleOptions?: Omit<RuleOptions, 'configPath' | 'allowScoped'>
}

/**
 * One flat-config block per theme whose config is on disk.
 *
 * A theme whose file is missing gets no block, rather than a block that fails
 * to load its config: a checkout that has not run `nuxi prepare` yet lints with
 * the project-wide entry instead of not linting at all.
 *
 * @param plugin - The plugin object, registered in every block so the helper
 *   works without the project having registered it for `.vue` files itself.
 * @param options - See {@link ThemedConfigsOptions}.
 * @returns Blocks to spread into the flat config, after the project-wide entry.
 */
export function buildThemedConfigs(plugin: ESLint.Plugin, options: ThemedConfigsOptions): Linter.Config[] {
  const { themes, rootDir = process.cwd(), buildDir = '.nuxt', severity = 'error', ruleOptions = {} } = options

  return Object.entries(themes).flatMap(([theme, directory]) => {
    const configPath = resolve(rootDir, buildDir, themedConfigFile(theme))
    if (!existsSync(configPath)) return []

    // Flat-config globs are relative and forward-slashed, whatever the
    // platform or however the directory was written.
    const glob = directory.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '')

    return [{
      name: `unocss-normalize/themed/${theme}`,
      files: [`${glob}/**/*.vue`],
      plugins: { 'unocss-normalize': plugin },
      rules: {
        'unocss-normalize/classes': [severity, { ...ruleOptions, configPath, allowScoped: true }],
      },
    }]
  })
}
