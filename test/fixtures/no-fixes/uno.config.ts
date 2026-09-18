import { defineConfig, presetWind3 } from 'unocss'

/**
 * A config that declares no `fix` anywhere - which is every UnoCSS project
 * before it opts in. The plugin still has one source here, the shortcuts, and
 * the suite uses this fixture to check that the blocklist source goes quiet
 * rather than guessing a replacement out of a message written for a human.
 */
export default defineConfig({
  presets: [presetWind3()],

  shortcuts: {
    center: 'items-center justify-center',
    'f-col': 'flex flex-col',
  },

  blocklist: [
    [/^border$/, { message: 'use shorter "b"' }],
    [/^opacity-(\d+)$/, { message: 'use shorter "op-*"' }],
  ] as never,
})
