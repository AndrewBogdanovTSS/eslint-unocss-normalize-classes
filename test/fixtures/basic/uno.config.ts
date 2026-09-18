import { defineConfig, presetWind3 } from 'unocss'

/**
 * The fixture project. Deliberately small, and deliberately containing one
 * wrong fix: `blur-[4px]` is not `blur-1`, and the suite asserts the plugin
 * refuses it. A fixture where everything is correct cannot tell a working
 * prover from a prover that always says yes.
 */
export default defineConfig({
  presets: [presetWind3()],

  shortcuts: {
    underlined: 'underline underline-offset-3',
    center: 'items-center justify-center',
    'f-col': 'flex flex-col',
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
    // Wrong on purpose: `blur` is not on the 0.25rem spacing scale, so
    // dividing by four changes the rendered blur from 4px to 1px.
    [/^blur-\[4px\]$/, { message: 'use shorter "blur-1"', fix: () => ['blur-1'] }],
    // Correct, and on the spacing scale: 4px is 0.25rem is `m-1`.
    [/^m-\[4px\]$/, { message: 'use shorter "m-1"', fix: () => ['m-1'] }],
    // Declares a fix to a token that does not generate anything at all.
    [/^p-nonsense$/, { message: 'use "p-4"', fix: () => ['p-utterly-unknown'] }],
  ] as never,
})
