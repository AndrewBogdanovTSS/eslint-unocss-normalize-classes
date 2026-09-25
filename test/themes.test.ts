/**
 * `themedConfigs()`, the ESLint half of the `/nuxt` module.
 *
 * The contract between the two is a file path, so these run against a real
 * directory with some of those files present and some not.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import plugin, { themedConfigs } from '../src/index'
import { themedConfigFile } from '../src/themes'

describe('themedConfigs', () => {
  let rootDir: string

  beforeAll(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'themed-configs-'))
    // `dark` and `light` have been prepared; `neon` has not.
    for (const theme of ['dark', 'light']) {
      const file = join(rootDir, '.nuxt', themedConfigFile(theme))
      mkdirSync(join(file, '..'), { recursive: true })
      writeFileSync(file, '')
    }
  })

  afterAll(() => rmSync(rootDir, { recursive: true, force: true }))

  const themes = { dark: 'themes/dark', light: './themes/light/', neon: 'themes/neon' }

  it('builds one block per prepared theme, matching that theme\'s files', () => {
    const blocks = themedConfigs({ themes, rootDir })

    expect(blocks.map(({ name, files }) => [name, files])).toEqual([
      ['unocss-normalize/themed/dark', ['themes/dark/**/*.vue']],
      // `./` and a trailing slash are how people write directories; a glob
      // with either one matches nothing.
      ['unocss-normalize/themed/light', ['themes/light/**/*.vue']],
    ])
  })

  it('points each block at its theme\'s config and turns allowScoped on', () => {
    const [dark] = themedConfigs({ themes, rootDir })
    const configPath = resolve(rootDir, '.nuxt', 'uno/config/dark.mjs')

    expect(dark.rules).toEqual({
      'unocss-normalize/classes': ['error', { configPath, allowScoped: true }],
      // Manual shortcuts are asked about exactly where they would otherwise
      // have been written - and nowhere else.
      'unocss-normalize/manual-shortcuts': ['warn', { configPath, allowScoped: true }],
    })
  })

  it('hands rootFontSize to the manual rule too, so its proofs agree', () => {
    const [dark] = themedConfigs({ themes, rootDir, ruleOptions: { rootFontSize: 10, variantGroups: true } })

    expect(dark.rules?.['unocss-normalize/manual-shortcuts']).toEqual(['warn', {
      configPath: resolve(rootDir, '.nuxt', 'uno/config/dark.mjs'),
      allowScoped: true,
      rootFontSize: 10,
    }])
  })

  it('registers the plugin itself, as the same object the package exports', () => {
    const [dark] = themedConfigs({ themes, rootDir })

    // ESLint refuses two different objects under one namespace, and accepts
    // the same one twice - so a project that also registers the plugin is fine.
    expect(dark.plugins?.['unocss-normalize']).toBe(plugin)
  })

  it('carries the project\'s own rule options and severity, which a later block would otherwise drop', () => {
    const [dark] = themedConfigs({
      themes,
      rootDir,
      severity: 'warn',
      ruleOptions: { variantGroups: true, rootFontSize: 10 },
    })

    expect(dark.rules?.['unocss-normalize/classes']).toEqual(['warn', {
      variantGroups: true,
      rootFontSize: 10,
      configPath: resolve(rootDir, '.nuxt', 'uno/config/dark.mjs'),
      allowScoped: true,
    }])
  })

  it('reads from a custom buildDir', () => {
    expect(themedConfigs({ themes, rootDir, buildDir: 'elsewhere' })).toEqual([])
  })

  it('returns nothing before the project has been prepared', () => {
    expect(themedConfigs({ themes, rootDir: join(rootDir, 'not-prepared') })).toEqual([])
  })
})
