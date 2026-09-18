import { defineConfig, presetWind3, transformerVariantGroup } from 'unocss'

/**
 * A small, ordinary project config.
 *
 * The blocklist says which spellings this project has decided against, and the
 * `fix` on each entry says what to write instead - the additive convention the
 * plugin reads. Nothing here is plugin-specific: UnoCSS ignores meta keys it
 * does not know, so this config works with or without the plugin installed.
 */
export default defineConfig({
  presets: [presetWind3()],

  // What makes `md:(text-center mx-a)` mean anything: the generator does not
  // understand a group, this transformer expands it before generation. The
  // ESLint rule's `variantGroups` option is only safe because this is here.
  transformers: [transformerVariantGroup()],

  shortcuts: {
    center: 'items-center justify-center',
    'f-col': 'flex flex-col',
    card: 'f-col gap-4 p-6 rounded b b-gray-300',
  },

  blocklist: [
    [/^border$/, { message: 'use shorter "b"', fix: () => ['b'] }],
    [/^opacity-(\d+)$/, { message: 'use shorter "op-*"', fix: (v: string) => [v.replace('opacity-', 'op-')] }],
    [/^size-(.+)$/, {
      message: 'use "w-* h-*"',
      fix: (v: string) => {
        const size = /^size-(.+)$/.exec(v)?.[1]
        return size ? [`w-${size}`, `h-${size}`] : [v]
      },
    }],

    // Wrong on purpose. `blur` is not on the 0.25rem spacing scale, so this
    // rewrite would turn 4px of blur into 1px - and the plugin refuses it.
    // Run `pnpm lint` to see the refusal reported rather than applied.
    [/^blur-\[4px\]$/, { message: 'use shorter "blur-1"', fix: () => ['blur-1'] }],
  ] as never,
})
