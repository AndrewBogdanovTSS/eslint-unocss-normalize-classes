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
import type { FixableBlocklistMeta } from './config'
import { isEquivalent } from './core/equivalence'
import { planRewrite } from './core/plan'
import type { PlanResult } from './core/plan'
import { collapsibleShortcuts } from './core/shortcuts'
import type { ShortcutSet } from './core/shortcuts'
import { joinToken, splitToken } from './core/tokens'

export interface PlanOptions {
  /** Collapse token sets that a shortcut already names. */
  shortcuts: boolean
  /**
   * Also collapse into shortcuts the config marked `scoped`.
   *
   * Only correct for a file that ships with the layer defining them - a
   * brand-scoped component, a tenant-specific page. Shared code linted with
   * this on gets a rewrite that renders differently in every other build.
   */
  allowScoped: boolean
  /**
   * Plan with the shortcuts the config marked `manual`, and nothing else.
   *
   * Off, which is how `unocss-normalize/classes` plans, a manual shortcut is
   * never a collapse source. On, which is how
   * `unocss-normalize/manual-shortcuts` plans, only manual shortcuts are - and
   * the blocklist and variant grouping stand aside, so the one change left to
   * report is the collapse a human is being asked to decide on.
   */
  suggestManual?: boolean
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
const sortKeys = new Map<string, number | null>()

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

/**
 * Where `unocss/order` would place a token.
 *
 * The same arithmetic that rule's worker uses - the rule's own index plus a
 * rank for how many variants it carries - so this answers what it would do,
 * rather than what seems reasonable. `null` when the generator cannot parse
 * the token, which is how the sorter decides something is unknown.
 *
 * @param session - The generators for this config.
 * @param token - A single class token.
 * @returns The sort key, or `null` for a token the generator does not know.
 */
async function sortKey(session: Session, token: string): Promise<number | null> {
  if (!session.uno.config.details) session.uno.config.details = true

  const parsed = await session.uno.parseToken(token) as [number, ...unknown[]][] | undefined
  if (!parsed?.length) return null

  const context = parsed[0][5] as { variantHandlers?: unknown[] } | undefined
  const variantRank = (context?.variantHandlers?.length ?? 0) * 1e5
  return parsed[0][0] + variantRank
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

  // Filtered here rather than in `createSession`, so the session cache stays
  // keyed by config alone: one project can lint its shared code and its
  // layer-scoped code in the same run, against the same config, with different
  // answers to this question.
  const inScope = options.allowScoped
    ? session.shortcuts
    : session.shortcuts.filter((shortcut) => !shortcut.scoped)
  // A manual shortcut is suggested where it would otherwise have been usable,
  // and applied nowhere - so this splits the usable set, it does not widen it.
  const suggesting = options.suggestManual === true
  const usable = inScope.filter((shortcut) => (shortcut.manual === true) === suggesting)

  return planRewrite(value, {
    shortcuts: options.shortcuts ? usable : [],
    variantGroups: suggesting ? false : options.variantGroups,
    sortKey: async (token) => {
      const key = cacheKey(scope, 'sort', token)
      if (!sortKeys.has(key)) sortKeys.set(key, await sortKey(session, token))
      return sortKeys.get(key) ?? null
    },
    declaredFix: async (token) => {
      if (!options.blocklist || suggesting) return null
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
