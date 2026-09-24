# demo/

A minimal Nuxt 4 app for trying the plugin without installing it into a project
of your own. It depends on the package above it by path, so what you run here is
the working copy, not a published version.

## Run it

```bash
cd demo
pnpm install
pnpm lint
```

`pnpm lint` runs `nuxt prepare` first, because some of the UnoCSS configs it
reads are written by Nuxt - see [How it is wired](#how-it-is-wired).

The demo is its own workspace root, so installing it never pulls Nuxt into the
package above, and the package's own `pnpm install` and CI never see it.

If `pnpm install` cannot find the plugin, build it once: `cd .. && pnpm build`.
The link points at the package directory, and the package's entry point is
`dist/`.

## Two themes, picked at build time

The app is built as one of two themes - `ocean` or `forest` - the way a
multi-brand project is built as one brand. `THEME` picks it, and the other theme
is not part of that build at all:

```bash
pnpm dev            # ocean
pnpm dev:forest     # forest - loads .env.forest, which sets THEME=forest
pnpm build          # and the same pair for build and lint
pnpm build:forest
```

```
base/                  shared by both: preset, blocklist, `card`, `center`, `f-col`
themes/ocean/          ocean's layer - its own `title` and `surface`
themes/forest/         forest's layer - the same two names, different utilities
app/                   the app itself, shipped in both builds
```

`title` in ocean is `text-2xl c-sky-800 fw-bold tracking-tight`. In forest it is
`text-xl c-emerald-900 fw-semibold tracking-wide uppercase`. Each name means one
thing per build and a different thing across builds, so both themes wrap their
shortcuts in `scoped()`.

### What `scoped` buys

Three files, one `pnpm lint`:

| File | Ships in | What the linter does |
| --- | --- | --- |
| `themes/ocean/components/ThemeHero.vue` | ocean only | collapses its utilities into ocean's `surface` and `title` |
| `themes/forest/components/ThemeHero.vue` | forest only | collapses into forest's `surface` and `title` - even when ocean was prepared |
| `app/components/SharedNotice.vue` | both | nothing |

`SharedNotice.vue` is the interesting one. Its author wanted it to look the same
in every theme, and its utilities happen to spell ocean's `surface` and `title`
exactly. Take `scoped()` out of both themes and lint it:

```
# prepared as ocean
13:16  error  This class list has a shorter equivalent: "b b-sky-200 rounded-xl bg-sky-50 p-6" → "surface"
14:15  error  This class list has a shorter equivalent: "text-2xl c-sky-800 fw-bold tracking-tight" → "title"

# prepared as forest
(nothing)
```

The same file, two verdicts, depending on which theme was prepared last. Both
rewrites are genuinely equivalent under ocean - the plugin proves them before
proposing them - and `pnpm lint:fix` would apply them. The forest build would
then render forest's surface and title in that box: a green stripe and an
uppercase heading, where the author asked for blue.

With `scoped()` in place, `pnpm lint` and `pnpm lint:forest` report the same
findings, line for line. Shared code is never rewritten into a theme's name,
and each theme's own files still get the collapse, against their own theme.

### How it is wired

- **`themes.ts`** maps each theme to its directory. `nuxt.config.ts` extends
  the one `THEME` names; `eslint.config.js` reads the whole map.
- **`nuxt.config.ts`** registers `eslint-plugin-unocss-normalize-classes/nuxt`
  with `unoThemedConfigs: { themes, shared: ['base'] }`. On every `prepare`,
  `dev` and `build` it writes `.nuxt/uno/config/ocean.mjs` and
  `.nuxt/uno/config/forest.mjs` - the base merged with each theme.
- **`eslint.config.js`** lints everything against `uno.config.ts` - the base
  merged with whichever theme was prepared - and then spreads
  `themedConfigs(...)`, which adds one block per theme: `themes/<theme>/**/*.vue`,
  against that theme's own config, with `allowScoped` on.

### Two traps this setup avoids

Both surfaced while building this demo, and both would bite a real project.

- **The shared layer is `base/`, not `layers/base/`.** Nuxt auto-registers
  anything under `~~/layers/` - above every entry in `extends`. A shared layer
  there outranks the themes, so the build lets it override them, which is the
  wrong way round for a theme.
- **`buildDir` is pinned to `.nuxt`.** `uno.config.ts` imports
  `./.nuxt/uno.config.mjs`, but `nuxt build` writes its templates to
  `node_modules/.cache/nuxt/.nuxt` unless told otherwise. Before the pin,
  `pnpm build:forest` produced the forest markup styled with ocean's `title` -
  read from whatever `.nuxt` held from the last `prepare`.

## The blocklist: two cards

Two cards with the same design, in `app/components/`:

- **`TidyCard.vue`** is written in the vocabulary `base/uno.config.ts` asks
  for. Nothing is reported about it.
- **`MessyCard.vue`** is the same markup in the spellings the blocklist
  rejects. It renders unstyled, because a blocked class never reaches the
  stylesheet - UnoCSS does not generate CSS for it.

`pnpm dev` shows the difference: one card styled, one not.

Then:

```bash
pnpm lint:fix
```

`MessyCard.vue` becomes the tidy vocabulary and the page renders identically -
which is the point. Every rewrite was generated and compared against the
original before it was written.

Worth watching in the diff:

```diff
- class="
-   flex
-   flex-col
-   gap-4
-   p-6
-   rounded
-   border
-   b-gray-300
- "
+ class="card"
```

And the breakpoint pair, collapsed into a group after its own fix landed:

```diff
- class="md:text-center md:opacity-50"
+ class="md:(text-center op-50)"
```

That one needs `transformerVariantGroup` in the build - it is in
`base/uno.config.ts` here, which is why `variantGroups: true` is safe to turn
on in `eslint.config.js`.

Three steps, each proved on its own: `border` becomes `b` from the blocklist,
`flex flex-col` collapses into the `f-col` shortcut, and the result then matches
`card`, which is defined in terms of `f-col`.

`card` lives in `base/` and is not `scoped`: it is the same utilities in every
theme, so collapsing into it is safe anywhere - shared code included.

## The one thing it refuses

One error survives `pnpm lint:fix`, on purpose:

```
"blur-[4px]" would be rewritten to "blur-1", but that generates different CSS,
so it was not applied.
```

`base/uno.config.ts` declares that fix, and it is wrong: `blur` is not on the
0.25rem spacing scale, so dividing by four turns 4px of blur into 1px. The
plugin generates both, compares them, and refuses. Delete that blocklist entry,
or correct it, and the error goes.

This is the whole argument for the package in one line of output: a fix that
looks exactly like the correct ones, and is not.

## Files

| File | What it is for |
| --- | --- |
| `themes.ts` | Every theme and its directory - read by `nuxt.config.ts` and `eslint.config.js` |
| `nuxt.config.ts` | Picks the theme layer from `THEME`; registers the plugin's `/nuxt` module |
| `.env.forest` | `THEME=forest`, loaded by the `:forest` scripts |
| `uno.config.ts` | Points at `.nuxt/uno.config.mjs` - the base merged with the active theme |
| `base/uno.config.ts` | The shared config: preset, shortcuts, and a blocklist whose entries declare `fix` |
| `themes/<theme>/uno.config.ts` | Each theme's `title` and `surface`, wrapped in `scoped()` |
| `themes/<theme>/components/ThemeHero.vue` | Theme-only markup - collapsed into that theme's shortcuts |
| `app/components/SharedNotice.vue` | Shared markup that spells ocean's shortcuts - and is left alone |
| `app/components/MessyCard.vue` | Written in the blocked spellings - the thing to fix |
| `app/components/TidyCard.vue` | The same card, already normalised |
| `eslint.config.js` | `unocss/order` and `unocss-normalize/classes` in one run, plus `themedConfigs()` |

Both ESLint rules are enabled together deliberately. The sorter cannot order a
token the blocklist blocks, so normalising is what makes sorting possible - see
the "Alongside `unocss/order`" section of the package README.

`unocss/order` is listed first, so wherever both rules have something to say
about an attribute, ESLint sorts it first and normalises the sorted list:

```
class="justify-center items-center flex gap-2"

  pass 1   flex items-center justify-center gap-2   unocss/order
  pass 2   flex center gap-2                        unocss-normalize/classes
```
