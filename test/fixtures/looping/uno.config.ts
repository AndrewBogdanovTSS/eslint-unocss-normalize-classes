import { defineConfig, presetWind3 } from 'unocss'

/**
 * Two entries that undo each other, both of them correct in isolation:
 * `opacity-50` and `op-50` generate the same CSS, so every rewrite in the loop
 * passes the prover and the loop never fails its way out.
 *
 * A real config can reach this by accident when two people add an entry each.
 * The suite uses it to check the pass limit terminates, because the alternative
 * is an ESLint run that never finishes.
 */
export default defineConfig({
  presets: [presetWind3()],

  blocklist: [
    [/^opacity-50$/, { message: 'use "op-50"', fix: () => ['op-50'] }],
    [/^op-50$/, { message: 'use "opacity-50"', fix: () => ['opacity-50'] }],
  ] as never,
})
