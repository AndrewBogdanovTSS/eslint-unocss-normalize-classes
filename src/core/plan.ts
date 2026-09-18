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

/**
 * The variant prefixes worth collapsing into a group.
 *
 * A prefix qualifies when enough tokens share it exactly - `md:text-center` and
 * `md:mx-a` share `md:`, while `md:text-center` and `md:hover:mx-a` do not,
 * because collapsing those would need a nested group and the flat one would be
 * wrong. Tokens that already carry a bracket are left out: they are either a
 * group already or an arbitrary value, and neither is ours to rearrange.
 *
 * @param tokens - The class list, after the other sources have run.
 * @param minimum - How many tokens must share a prefix before it is grouped.
 * @returns The prefixes to hand to `collapseVariantGroup`.
 */
export function groupablePrefixes(tokens: readonly string[], minimum: number): string[] {
  const counts = new Map<string, number>()

  for (const token of tokens) {
    if (token.includes('(') || token.includes(')')) continue
    const { prefix } = splitToken(token)
    if (prefix) counts.set(prefix, (counts.get(prefix) ?? 0) + 1)
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= minimum)
    .map(([prefix]) => prefix)
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
    for (const prefix of groupablePrefixes(collapsed, deps.variantGroups.minimum)) prefixes.add(prefix)
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
