/**
 * Turning a class attribute into the normalized one, with every step proved.
 *
 * The planner is where the two rewrite sources meet, and it is deliberately
 * free of UnoCSS: it asks for a declared fix, it asks whether a rewrite is
 * equivalent, and it does not know or care that the answers come from a
 * generator in a worker thread. That is what makes it testable without a
 * config, and what would let it be lifted into `@unocss/eslint-plugin` -
 * whose `blocklist` rule already declares `fixable: 'code'` and never emits a
 * fix - without carrying an implementation with it.
 *
 * The contract every path obeys: a rewrite that cannot be proved equivalent is
 * *reported*, never applied.
 */
import { collapseVariantGroup, parseVariantGroup } from '@unocss/core'
import { applyShortcut, matchShortcut } from './shortcuts'
import type { ShortcutSet } from './shortcuts'
import { splitClassValue, splitToken } from './tokens'

export interface UnprovenRewrite {
  /** What the source said. */
  before: string
  /** What the rewrite would have written. */
  after: string
  /** Which source proposed it. */
  source: 'blocklist' | 'shortcut'
}

export interface PlanResult {
  /** The attribute contents after every proved rewrite. */
  value: string
  /** Whether anything changed. */
  changed: boolean
  /** Rewrites that were proposed, failed the proof, and were not applied. */
  unproven: UnprovenRewrite[]
}

export interface PlanDeps {
  /**
   * The replacement a blocklist entry declares for a token, or `null` when the
   * entry declares none and the token is therefore a human's problem.
   */
  declaredFix: (token: string) => Promise<string[] | null>
  /**
   * Whether two class lists generate the same CSS under the project's config.
   */
  prove: (before: string, after: string) => Promise<boolean>
  /**
   * Where `unocss/order` would place a token, or `null` when the generator
   * cannot parse it. Used only to decide whether a group is one that sorter
   * will accept - see `groupablePrefixes`.
   */
  sortKey?: (token: string) => Promise<number | null>
  /** Collapsible shortcuts, longest first. */
  shortcuts: readonly ShortcutSet[]
  /**
   * Collapse tokens that share a variant into a group -
   * `md:text-center md:mx-a` into `md:(text-center mx-a)`.
   *
   * Off unless asked for, because the syntax only works when the build runs
   * `transformerVariantGroup`. The generator does not understand a group on its
   * own: `uno.generate('md:(a b)')` matches nothing. A project without that
   * transformer would end up with class names that produce no CSS at all.
   */
  variantGroups?: false | { minimum: number }
  /**
   * How many times a token may be rewritten in a row. A blocklist can chain -
   * `ma-auto` to `m-auto` to `m-a` - and two entries can also disagree in a
   * loop. This bounds both without having to tell them apart.
   */
  maxPasses?: number
}

const DEFAULT_MAX_PASSES = 10

/**
 * Apply the blocklist's declared fixes to one token, following any chain.
 *
 * @param token - The token as written in the template.
 * @param deps - Planner dependencies.
 * @param unproven - Collector for rewrites that failed the proof.
 * @returns The tokens that replace it - the original, when nothing was proved.
 */
async function normalizeToken(
  token: string,
  deps: PlanDeps,
  unproven: UnprovenRewrite[],
): Promise<string[]> {
  const maxPasses = deps.maxPasses ?? DEFAULT_MAX_PASSES
  let current = [token]

  for (let pass = 0; pass < maxPasses; pass++) {
    const next: string[] = []
    let changed = false

    for (const candidate of current) {
      const fix = await deps.declaredFix(candidate)
      if (!fix?.length || (fix.length === 1 && fix[0] === candidate)) {
        next.push(candidate)
        continue
      }

      const replacement = fix.join(' ')
      if (await deps.prove(candidate, replacement)) {
        next.push(...fix)
        changed = true
      } else {
        unproven.push({ before: candidate, after: replacement, source: 'blocklist' })
        next.push(candidate)
      }
    }

    current = next
    if (!changed) break
  }

  return current
}

/**
 * Collapse every shortcut whose tokens are all present, largest first.
 *
 * Proof is asked about the matched tokens rather than the whole attribute: the
 * shortcut stands for exactly those utilities, so that is the claim being
 * made, and asking it that way lets the answer be cached per token set.
 *
 * @param tokens - The class list, after blocklist normalization.
 * @param deps - Planner dependencies.
 * @param unproven - Collector for rewrites that failed the proof.
 * @returns The class list with every proved shortcut collapsed.
 */
async function collapseShortcuts(
  tokens: string[],
  deps: PlanDeps,
  unproven: UnprovenRewrite[],
): Promise<string[]> {
  const maxPasses = deps.maxPasses ?? DEFAULT_MAX_PASSES
  let current = tokens

  // Repeated until nothing moves, because shortcuts are routinely defined in
  // terms of each other: `card` is `f-col gap-4 p-6`, and `f-col` only appears
  // once `flex flex-col` has been collapsed. A single pass over the list would
  // check `card` while its first token was still two tokens, find no match,
  // and never look again.
  for (let pass = 0; pass < maxPasses; pass++) {
    let changed = false

    for (const shortcut of deps.shortcuts) {
      if (current.includes(shortcut.name)) continue

      const match = matchShortcut(current, shortcut)
      if (!match) continue

      const matched = match.indexes.map((index) => current[index]).join(' ')
      if (await deps.prove(matched, shortcut.name)) {
        current = applyShortcut(current, match)
        changed = true
      } else {
        // Recorded once. A refusal that cannot be applied cannot change the
        // list either, so a later pass would only repeat it.
        const seen = unproven.some((entry) => entry.before === matched && entry.after === shortcut.name)
        if (!seen) unproven.push({ before: matched, after: shortcut.name, source: 'shortcut' })
      }
    }

    if (!changed) break
  }

  return current
}

interface PrefixRun {
  prefix: string
  /** Indexes of the tokens in the run, in source order. */
  indexes: number[]
}

/** Maximal runs of neighbouring tokens that share a variant prefix exactly. */
function prefixRuns(tokens: readonly string[]): PrefixRun[] {
  const runs: PrefixRun[] = []

  tokens.forEach((token, index) => {
    // A token already carrying a bracket is a group or an arbitrary value, and
    // neither is ours to rearrange.
    const prefix = token.includes('(') || token.includes(')') ? '' : splitToken(token).prefix
    if (!prefix) return

    const last = runs.at(-1)
    if (last?.prefix === prefix && last.indexes.at(-1) === index - 1) last.indexes.push(index)
    else runs.push({ prefix, indexes: [index] })
  })

  return runs
}

/**
 * Whether `unocss/order` would leave a run of tokens next to each other.
 *
 * It sorts by asking the generator where each token belongs, and then collapses
 * only the group members that stayed adjacent. A group whose members sort apart
 * is therefore torn in half on its next pass - one member escaping, the other
 * left in a group of one - and regrouped by this rule on the pass after that.
 * Neither rule is wrong on its own; together they never settle.
 *
 * So a run is only groupable when the sorter agrees it belongs together.
 */
async function sortsTogether(
  tokens: readonly string[],
  run: PrefixRun,
  sortKey: (token: string) => Promise<number | null>,
): Promise<boolean> {
  const keyed: { index: number, key: number, token: string }[] = []

  for (const [index, token] of tokens.entries()) {
    const key = await sortKey(token)
    // An unparseable token is sorted to the front by `unocss/order`, ahead of
    // everything keyed - which makes its effect on adjacency hard to predict,
    // so nothing is grouped when one is present.
    if (key === null) return false
    keyed.push({ index, key, token })
  }

  keyed.sort((a, b) => a.key - b.key || a.token.localeCompare(b.token))

  const positions = run.indexes
    .map((index) => keyed.findIndex((entry) => entry.index === index))
    .sort((a, b) => a - b)

  return positions.every((position, offset) => position === positions[0] + offset)
}

/**
 * The variant prefixes worth collapsing into a group.
 *
 * Two conditions, and both exist to keep this rule out of the sorter's way:
 *
 *   - the tokens are **already neighbours**. Gathering scattered tokens would
 *     be reordering, which is `unocss/order`'s job, not this rule's.
 *   - the sorter would **keep them** neighbours. See `sortsTogether`.
 *
 * A prefix must also match exactly: `md:text-center` and `md:hover:mx-a` do not
 * share one, and a flat group of the two would be wrong.
 *
 * @param tokens - The class list, after the other sources have run.
 * @param minimum - How many neighbouring tokens must share a prefix.
 * @param sortKey - Where the sorter would place a token, when it can be asked.
 * @returns The prefixes to hand to `collapseVariantGroup`.
 */
export async function groupablePrefixes(
  tokens: readonly string[],
  minimum: number,
  sortKey?: (token: string) => Promise<number | null>,
): Promise<string[]> {
  const candidates = prefixRuns(tokens).filter((run) => run.indexes.length >= minimum)
  const counts = new Map<string, number>()
  for (const run of prefixRuns(tokens)) counts.set(run.prefix, (counts.get(run.prefix) ?? 0) + 1)

  const prefixes: string[] = []
  for (const run of candidates) {
    // `collapseVariantGroup` works on consecutive tokens, so a prefix appearing
    // in two runs would also collapse the second one - into a group of one.
    if (counts.get(run.prefix) !== 1) continue
    if (sortKey && !await sortsTogether(tokens, run, sortKey)) continue
    prefixes.push(run.prefix)
  }

  return prefixes
}

/**
 * Plan the normalization of one static class attribute.
 *
 * Variant groups are expanded before the rewrite and collapsed after it, using
 * UnoCSS's own helpers - the same pair the `unocss/order` rule uses - so
 * `hover:(border opacity-50)` is rewritten as the two tokens it means and comes
 * back as `hover:(b op-50)` rather than being skipped or torn apart.
 *
 * An attribute nothing could be proved about is returned byte for byte as it
 * was written, so a rule built on this never reports pure formatting churn.
 *
 * @param value - Raw contents of a class attribute, without the quotes.
 * @param deps - Planner dependencies.
 * @returns The plan: the new value, whether it changed, and what was refused.
 */
export async function planRewrite(value: string, deps: PlanDeps): Promise<PlanResult> {
  const unproven: UnprovenRewrite[] = []
  if (!value.trim()) return { value, changed: false, unproven }

  const { leading, tokens: original, trailing, separator } = splitClassValue(value)
  const group = parseVariantGroup(original.join(' '))
  const expanded = group.expanded.trim().split(/\s+/).filter(Boolean)

  const normalized: string[] = []
  for (const token of expanded) normalized.push(...await normalizeToken(token, deps, unproven))

  const collapsed = await collapseShortcuts(normalized, deps, unproven)

  // The prefixes the author already grouped are always put back. New ones are
  // added only when the project asked for grouping.
  const prefixes = new Set(group.prefixes)
  if (deps.variantGroups) {
    const groupable = await groupablePrefixes(collapsed, deps.variantGroups.minimum, deps.sortKey)
    for (const prefix of groupable) prefixes.add(prefix)
  }
  // Variant-group collapsing works on a space-joined list, so the author's
  // separator is applied afterwards rather than fought with.
  const rewritten = prefixes.size
    ? collapseVariantGroup(collapsed.join(' '), [...prefixes]).split(/\s+/).filter(Boolean)
    : collapsed
  const joined = rewritten.join(separator)

  // Compared against the tokens as written, not against the expanded form, so
  // an attribute that only ever round-tripped through the variant-group
  // helpers is reported as unchanged.
  const changed = joined !== original.join(separator)
  return {
    value: changed ? `${leading}${joined}${trailing}` : value,
    changed,
    unproven,
  }
}
