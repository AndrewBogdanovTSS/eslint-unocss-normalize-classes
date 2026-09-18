/**
 * The asynchronous half: a UnoCSS config, the generators built from it, and the
 * two questions the planner asks of them.
 *
 * Kept apart from `worker.ts` so it can be tested by calling it, rather than
 * only through a worker thread. `worker.ts` is then nothing but the synckit
 * wiring, which is the part there is no point unit-testing.
 *
 * This is also the only place a `fix` function can run. A blocklist's `fix` is
 * a function living in the config, and a function cannot cross a worker
 * boundary: it is called here and only the resulting strings are sent back.
 */
import { dirname } from 'node:path'
import process from 'node:process'
import { loadConfig } from '@unocss/config'
import { createGenerator } from '@unocss/core'
import type { UnoGenerator } from '@unocss/core'
import { isEquivalent } from './core/equivalence'
import { planRewrite } from './core/plan'
import type { PlanResult } from './core/plan'
import { collapsibleShortcuts } from './core/shortcuts'
import type { ShortcutSet } from './core/shortcuts'
import { joinToken, splitToken } from './core/tokens'

export interface PlanOptions {
  /** Collapse token sets that a shortcut already names. */
  shortcuts: boolean
  /** Apply the `fix` a blocklist entry declares. */
  blocklist: boolean
  /** Root font size for comparing `rem` against `px`, or `false` to compare strictly. */
  rootFontSize: number | false
  /**
   * Collapse tokens sharing a variant into a group, once this many share it.
   * `false` leaves them alone.
   *
   * Not detected automatically, and deliberately so: a Nuxt project passes its
   * transformers through the module options rather than `uno.config.ts`, so the
   * config this worker loads can be missing `transformerVariantGroup` in a
   * project whose build runs it. Guessing from what is visible here would
   * refuse to group in exactly the projects that can.
   */
  variantGroups: false | { minimum: number }
}

/** A blocklist entry that declares how to rewrite what it blocks. */
interface FixableBlocklistMeta {
  message?: string | ((selector: string) => string)
  /**
   * The additive convention this plugin reads. `BlocklistMeta` upstream carries
   * only `message`, and UnoCSS ignores meta keys it does not know, so a project
   * can declare this today without waiting for anything.
   */
  fix?: (selector: string) => string | string[]
}

interface Session {
  uno: UnoGenerator
  /**
   * A second generator for the proof. The project's own blocklist would stop
   * the blocked side from generating at all - every comparison would be
   * "something versus nothing" - and its safelist would flood both sides with
   * identical unrelated rules that can hide a real difference.
   */
  prover: UnoGenerator
  shortcuts: ShortcutSet[]
}

const sessions = new Map<string, Promise<Session>>()
const proofs = new Map<string, boolean>()
const fixes = new Map<string, string[] | null>()

const cacheKey = (...parts: unknown[]): string => JSON.stringify(parts)

function searchDirectory(id: string | undefined): string {
  if (!id) return process.cwd()
  // Virtual ids such as `file.vue?vue&type=template` name a file inside a
  // directory that does not exist; the config search has to start above it.
  if (/\.\w+\/[^/]+$/.test(id)) return dirname(id.slice(0, id.lastIndexOf('/')))
  return dirname(id)
}

async function createSession(configPath: string | undefined, id: string | undefined): Promise<Session> {
  const cwd = configPath ? process.cwd() : searchDirectory(id)
  const { config, sources } = await loadConfig(cwd, configPath)

  if (!sources.length) {
    throw new Error(
      '[eslint-plugin-unocss-normalize-classes] No UnoCSS config found. '
      + 'Create a `uno.config.ts` in the project root, or point at one with '
      + '`settings: { unocss: { configPath } }`.',
    )
  }

  const uno = await createGenerator({ ...config, warn: false })
  const prover = await createGenerator({
    ...config,
    warn: false,
    blocklist: [],
    safelist: [],
    preflights: [],
  })

  return { uno, prover, shortcuts: collapsibleShortcuts(uno.config.shortcuts) }
}

function getSession(configPath: string | undefined, id: string | undefined): Promise<Session> {
  const key = configPath ? cacheKey('config', configPath) : cacheKey('dir', searchDirectory(id))
  let session = sessions.get(key)
  if (!session) {
    session = createSession(configPath, id)
    sessions.set(key, session)
  }
  return session
}

/**
 * Ask a blocklist entry what it would put in a token's place.
 *
 * Tried against the token as written first, then against the bare utility, so
 * an entry written as `^border$` still answers for `sm:hover:!border`. A `fix`
 * that throws is treated as no fix: a mistake in a config should cost a missing
 * rewrite, not a crashed lint run.
 *
 * @param session - The generators for this config.
 * @param token - The token as written in the template.
 * @returns The declared replacement tokens, or `null` when there is none.
 */
function declaredFix(session: Session, token: string): string[] | null {
  const lookup = (candidate: string): string[] | null => {
    const blocked = session.uno.getBlocked(candidate)
    const meta = blocked?.[1] as FixableBlocklistMeta | undefined
    if (!meta?.fix) return null

    try {
      const fixed = meta.fix(candidate)
      const tokens = (Array.isArray(fixed) ? fixed : [fixed]).filter(Boolean)
      return tokens.length ? tokens : null
    } catch {
      return null
    }
  }

  const direct = lookup(token)
  if (direct) return direct

  const parts = splitToken(token)
  if (!parts.prefix && !parts.leadingImportant && !parts.trailingImportant) return null

  const onBody = lookup(parts.body)
  return onBody ? onBody.map((replacement) => joinToken(parts, replacement)) : null
}

async function prove(
  session: Session,
  before: string,
  after: string,
  rootFontSize: number | false,
): Promise<boolean> {
  const generate = async (classes: string): Promise<string> =>
    (await session.prover.generate(classes, { preflights: false, minify: true })).css

  return isEquivalent(await generate(before), await generate(after), { rootFontSize })
}

async function plan(
  configPath: string | undefined,
  value: string,
  id: string | undefined,
  options: PlanOptions,
): Promise<PlanResult> {
  const session = await getSession(configPath, id)
  const scope = configPath ?? searchDirectory(id)

  return planRewrite(value, {
    shortcuts: options.shortcuts ? session.shortcuts : [],
    variantGroups: options.variantGroups,
    declaredFix: async (token) => {
      if (!options.blocklist) return null
      const key = cacheKey(scope, token)
      if (!fixes.has(key)) fixes.set(key, declaredFix(session, token))
      return fixes.get(key) ?? null
    },
    prove: async (before, after) => {
      const key = cacheKey(scope, options.rootFontSize, before, after)
      if (!proofs.has(key)) proofs.set(key, await prove(session, before, after, options.rootFontSize))
      return proofs.get(key) ?? false
    },
  })
}

export type PlanRequest = [
  configPath: string | undefined,
  value: string,
  id: string | undefined,
  options: PlanOptions,
]

/**
 * Plan the rewrite of one class attribute against a project's UnoCSS config.
 *
 * @param request - Config path, the attribute's contents, the file being linted, and the options.
 * @returns The plan the rule turns into a report and a fix.
 */
export async function planForConfig(...request: PlanRequest): Promise<PlanResult> {
  return plan(...request)
}
