import { hideFixes, scoped } from 'eslint-plugin-unocss-normalize-classes/config'
import { defineConfig, presetWind3 } from 'unocss'

/**
 * A project-shaped fixture.
 *
 * It is not a minimal config on purpose. The plugin's behaviour is decided
 * almost entirely by the config it reads, so a fixture that only contains the
 * easy shapes tests the easy shapes: this one carries every blocklist form
 * UnoCSS accepts (string, RegExp, predicate), every `fix` return shape, custom
 * rules, a custom variant, and shortcuts that overlap each other.
 *
 * Several entries are wrong on purpose, and the suite asserts they are refused.
 * A fixture where every fix is correct cannot tell a working prover from one
 * that always says yes.
 */
export default defineConfig({
  presets: [presetWind3()],

  theme: {
    colors: {
      brand: { DEFAULT: '#cc0000', muted: '#ee8888' },
    },
  },

  rules: [
    ['squircle', { 'border-radius': '30% 70% 70% 30% / 30% 30% 70% 70%' }],
  ],

  variants: [
    // A custom variant, because a project's own variants have to survive the
    // expand/rewrite/collapse round trip like any other.
    (matcher) => {
      if (!matcher.startsWith('@hover:')) return undefined
      return { matcher: matcher.slice('@hover:'.length), parent: '@media (hover: hover)' }
    },
  ],

  shortcuts: [
    {
      // The ordinary case.
      'underlined': 'underline underline-offset-3',
      'center': 'items-center justify-center',
      'f-col': 'flex flex-col',

      // A superset of `f-col`, so the two compete for the same tokens and the
      // longest match has to win.
      'card': 'flex flex-col gap-2 p-4',

      // Contains every token of `center`, so collapsing this one first has to
      // leave nothing for `center` to claim.
      'btn': 'inline-flex items-center justify-center px-4 py-2',

      // One token: a rename, not a simplification, and never collapsed.
      'single': 'flex',

      // A variant group inside the expansion, which only matches real tokens
      // once it has been expanded.
      'raised': 'p-2 @hover:(bg-brand c-white)',
    },

    // Dynamic shortcuts cannot be read backwards, so they must be ignored as a
    // collapse source rather than crashing the scan.
    [/^pill-(\d+)$/, ([, n]: string[]) => `rounded-full px-${n}`],

    // A shortcut whose expansion belongs to one layer. Another layer of this
    // project defines `brand-title` differently, so collapsing into the name
    // in shared code would render differently per build - and the prover
    // cannot see it, because it only ever builds this one config.
    //
    // Its tokens are chosen to overlap nothing else here, so what the suite
    // observes about it is the marker and not a competing match.
    ...scoped({
      'brand-title': 'fw-bold tracking-wide',
    }),

    // Manual: suggested, never written. A name that says more than its
    // utilities do, so a matching class list is a question for a human.
    // One unscoped - suggested anywhere - and one scoped, which is only ever
    // suggested where the file's layer is known.
    //
    // A hand-written meta restates `layer`: any meta at all replaces the
    // default that puts a shortcut in the shortcuts layer. And the name is
    // `halo`, not `focus-ring` - presetWind3 has its own `focus-ring` (a 3px
    // ring on :focus), which wins the name, and the prover rightly refused to
    // collapse into it.
    ['halo', 'ring-2 ring-offset-2', { layer: 'shortcuts', manual: true }],
    ...scoped({
      'brand-button': 'shadow-md tracking-tight',
    }, { manual: true }),
  ],

  blocklist: hideFixes([
    // ---- fixes that are correct ------------------------------------------

    // RegExp, fix returning an array
    [/^border$/, { message: 'use shorter "b"', fix: () => ['b'] }],

    // RegExp, fix returning a bare string rather than an array
    [/^opacity-(\d+)$/, { message: 'use shorter "op-*"', fix: (v: string) => v.replace('opacity-', 'op-') }],

    // One token becoming two
    [/^size-(.+)$/, {
      message: 'use "w-* h-*"',
      fix: (v: string) => {
        const size = /^size-(.+)$/.exec(v)?.[1]
        return size ? [`w-${size}`, `h-${size}`] : [v]
      },
    }],

    // A plain string entry: UnoCSS matches it exactly, and so must the lookup
    ['whitespace-nowrap', { message: 'use shorter "ws-nowrap"', fix: () => ['ws-nowrap'] }],

    // A predicate entry, the third form `BlocklistValue` allows
    [
      (selector: string) => selector.startsWith('leading-'),
      { message: 'use shorter "lh-*"', fix: (v: string) => [v.replace('leading-', 'lh-')] },
    ],

    // On the spacing scale, so the px literal has an exact token equivalent
    [/^m-\[4px\]$/, { message: 'use shorter "m-1"', fix: () => ['m-1'] }],

    // A two-step chain: `size-1rem` becomes `w-1rem h-1rem`, and each of those
    // is itself blocked in favour of the scale token.
    [/^([wh])-1rem$/, { message: 'use the scale token', fix: (v: string) => [v.replace('-1rem', '-4')] }],

    // ---- entries the plugin must leave alone ------------------------------

    // No `fix`: `unocss/blocklist` reports it, this plugin has nothing to say
    [/^float-(left|right)$/, { message: 'use flex, not floats' }],

    // ---- fixes that are wrong, and must be refused ------------------------

    // `blur` is not on the 0.25rem spacing scale: 4px of blur is not 1px of it
    [/^blur-\[4px\]$/, { message: 'use shorter "blur-1"', fix: () => ['blur-1'] }],

    // The replacement generates no CSS at all
    [/^p-nonsense$/, { message: 'use "p-4"', fix: () => ['p-utterly-unknown'] }],

    // Same colour name, different shade: plausible, and not the same pixels
    [/^c-brand$/, { message: 'use the muted brand colour', fix: () => ['c-brand-muted'] }],

    // Alignment, not direction. `text-center` and `text-left` are different
    // declarations, and the resemblance is exactly what makes it dangerous.
    [/^text-center$/, { message: 'use "text-left"', fix: () => ['text-left'] }],

    // ---- fixes that misbehave, and must not take the lint run down --------

    [/^throwing-fix$/, {
      message: 'this entry is broken',
      fix: () => { throw new Error('the config author made a mistake') },
    }],

    [/^empty-fix$/, { message: 'this entry returns nothing', fix: () => [] }],

    [/^identity-fix$/, { message: 'this entry returns its input', fix: (v: string) => [v] }],

    // ---- a deliberately loose pattern, separated by the prover -----------

    // `text-*` is three unrelated utilities behind one prefix: a colour
    // (`text-red-500`), a size (`text-sm`) and an alignment (`text-center`).
    // Only the colour has a `c-*` spelling.
    //
    // This entry does not try to tell them apart. It proposes `c-*` for every
    // `text-*`, and the prover throws out the ones that are not colours:
    // `c-sm` and `c-center` generate no CSS at all, so they are reported
    // rather than written. Correct without a precise pattern - at the cost of
    // a report per non-colour token, which is why the demo's config names its
    // colours instead. Last in the list, so the specific entries above still
    // win for the tokens they name.
    [/^text-(.+)$/, {
      message: 'use "c-*" for colours',
      fix: (v: string) => [v.replace(/^text-/, 'c-')],
    }],
    // The fixture exports its fixes the way the README tells projects to -
    // hidden from object spreads, because `unocss/blocklist` sends a matched
    // entry's meta to a worker thread and a function cannot cross that
    // boundary. So the suite also proves a non-enumerable `fix` is still read.
  ]) as never,
})
