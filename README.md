# eslint-plugin-unocss-normalize-classes

Rewrites UnoCSS class attributes into the shorter spellings your own config
already defines - and refuses to write any rewrite it cannot prove generates
identical CSS.

## The problem it exists for

A UnoCSS blocklist is a list of spellings a project has decided against, each
with a message telling a human what to write instead. Turning those messages
into an autofix is the obvious next step, and it is where the trouble starts:

```
m-[4px]      ->  m-1        4px and 0.25rem are the same length
blur-[4px]   ->  blur-1     4px of blur and 1px of blur are not
```

Both rewrites divide by four. One is an alias, the other is a visual
regression, and nothing in the class name says which is which - `m-*` is on the
0.25rem spacing scale and `blur-*` is not. A rule that applies both looks
correct in every test that checks class names, and changes what the page
renders.

So this plugin does not trust a rewrite because it came from a config. It
generates the CSS for both sides, compares what a browser would compute, and
applies the rewrite only when they match. A rewrite it cannot prove is
reported, never written.

## Install

```bash
npm install --save-dev eslint-plugin-unocss-normalize-classes
```

Requires Node 24 or newer, ESLint 9 or newer, and a project with a UnoCSS
config. Vue templates need `vue-eslint-parser`, which you almost certainly
already have.

## Setup

```js
// eslint.config.js
import unocssNormalize from 'eslint-plugin-unocss-normalize-classes'
import vueParser from 'vue-eslint-parser'

export default [
  {
    files: ['**/*.vue'],
    languageOptions: { parser: vueParser },
    plugins: { 'unocss-normalize': unocssNormalize },
    rules: { 'unocss-normalize/classes': 'error' },
  },
]
```

The config is found the way UnoCSS finds it - a `uno.config.ts` at the project
root. Point somewhere else with the rule's `configPath` option, or with
`settings: { unocss: { configPath } }`, which is the same setting
`@unocss/eslint-plugin` reads.

## Where the rewrites come from

Two sources, both already in your config. Neither one reads a message: prose
written for a human is not a rewrite rule, and parsing it would be guessing.

### Shortcuts

A shortcut is already a name for a set of utilities, so the collapse direction
needs no new convention:

```ts
shortcuts: {
  center: 'items-center justify-center',
}
```

```diff
- <div class="flex justify-center gap-2 items-center" />
+ <div class="flex center gap-2" />
```

Matching is order-independent, because a class attribute is a set. The
shortcut's name takes the position of the earliest token it replaces, so
nothing else in the attribute moves. When two shortcuts compete for the same
tokens the larger one wins, and a single-token shortcut is never collapsed -
that is a rename, not a simplification.

### Blocklist entries that declare a fix

A blocklist says what is wrong. To also say what is right, add a `fix`:

```ts
blocklist: [
  [/^border$/, {
    message: 'use shorter "b"',
    fix: () => ['b'],
  }],
  [/^size-(.+)$/, {
    message: 'use "w-* h-*"',
    fix: (v) => {
      const size = /^size-(.+)$/.exec(v)?.[1]
      return size ? [`w-${size}`, `h-${size}`] : [v]
    },
  }],
]
```

> **Wrap the list in `hideFixes` if you also run `unocss/blocklist`.**
>
> ```ts
> import { hideFixes } from 'eslint-plugin-unocss-normalize-classes/config'
>
> blocklist: hideFixes([
>   [/^border$/, { message: 'use shorter "b"', fix: () => ['b'] }],
> ])
> ```
>
> That rule sends a matched entry's meta to a worker thread, and it sends the
> whole object - `{ ...meta, message }`. A function cannot cross that boundary.
> On a real project, linting a two-line file went from **12 seconds to 13
> minutes** with an ordinary `fix` property. `hideFixes` defines it
> non-enumerably, which takes it out of the spread and leaves property access -
> how this plugin reads it - untouched. The helper imports nothing, so it is
> safe in a config your build also loads.

`fix` returns the tokens that replace the blocked one - one, or several. This
is an additive convention: `BlocklistMeta` upstream carries only `message`, and
UnoCSS ignores meta keys it does not recognise, so a config can declare `fix`
today without waiting for anything to change.

Because the convention is additive, `BlocklistRule` upstream does not know
about `fix` - a project typing its blocklist against it gets no checking on the
one part this plugin reads. The same entry point exports the types that do:

```ts
import { hideFixes } from 'eslint-plugin-unocss-normalize-classes/config'
import type {
  FixableBlocklistMeta,
  FixableBlocklistRule,
} from 'eslint-plugin-unocss-normalize-classes/config'

const blocklist: FixableBlocklistRule[] = [
  [/^border$/, { message: 'use shorter "b"', fix: () => ['b'] }],
]

export default defineConfig({
  blocklist: hideFixes(blocklist), // BlocklistRule[] - no cast
})
```

`FixableBlocklistMeta` extends UnoCSS's `BlocklistMeta`, so anything upstream
adds to it arrives here too. `hideFixes` returns `BlocklistRule[]` when given
`FixableBlocklistRule[]`, which is what `defineConfig` wants - the cast a
project would otherwise write at that boundary is the one place a `fix` typo
could hide.

#### Telling a colour apart from the rest of `text-*`

`text-*` is three unrelated utilities behind one prefix - a colour
(`text-red-300`), a size (`text-sm`), an alignment (`text-center`) - and only
the colour has a `c-*` spelling. There are two ways to write that entry, and
the prover changes which one you need.

**Name the colours**, read off your theme so the pattern cannot drift:

```ts
const wind = presetWind3()
const colours = Object.keys(wind.theme?.colors ?? {}).join('|')

blocklist: [
  [new RegExp(`^text-(?:${colours})(?:-\d+)?(?:\/\d+)?$`), {
    message: 'use shorter "c-*" for colours',
    fix: (v) => [v.replace(/^text-/, 'c-')],
  }],
]
```

Shade and opacity are optional there on purpose: `text-red`, `text-red-300`
and `text-red-500/50` are all colours, and `c-*` takes all three.

**Or do not tell them apart at all**, and let the proof do it:

```ts
[/^text-(.+)$/, { message: 'use "c-*" for colours', fix: (v) => [v.replace(/^text-/, 'c-')] }],
```

This proposes `c-*` for every `text-*`. `c-red-300` generates the same CSS as
`text-red-300`, so it is applied; `c-sm` and `c-center` generate nothing at
all, so they are reported and never written. The loose pattern is *safe* -
it just costs a report per non-colour token, which is why naming the colours
is still the better entry.

A fix written against the bare utility still answers for a token carrying
variants or an important marker: `^border$` fixes `sm:hover:!border`. Chains
are followed, so `ma-auto` -> `m-auto` -> `m-a` resolves in one pass. Variant
groups are expanded before the rewrite and collapsed after it, using the same
UnoCSS helpers the `unocss/order` rule uses, so `hover:(border opacity-50)`
comes back as `hover:(b op-50)`.

### Variant groups

Tokens that share a variant can be collapsed into a group:

```diff
- <div class="md:text-center md:mx-a" />
+ <div class="md:(text-center mx-a)" />
```

**Off by default, and it needs one thing from your build:**
`transformerVariantGroup`. The generator does not understand a group on its own -
`uno.generate('md:(a b)')` matches nothing - so in a project without that
transformer the grouped class names would produce no CSS at all.

```js
'unocss-normalize/classes': ['error', { variantGroups: true }],
```

Two things it will not do, both so it stays out of `unocss/order`'s way:

- **It never moves a token to group it.** Only tokens already next to each
  other are collapsed. Ordering is the sorter's job.
- **It will not form a group the sorter would tear apart.** `unocss/order`
  expands a group, sorts the members, and re-collapses only what stayed
  adjacent - so a group whose members sort apart comes back as one loose token
  and one group of one, gets regrouped here, and never settles. The rule asks
  the generator where each token would sort and declines those runs.

`true` groups a prefix as soon as two tokens share it; `{ minimum: 3 }` waits
for three. Only exact prefixes are grouped - `md:a` and `md:hover:b` do not
share one, and flattening them together would be wrong. A group the author
already wrote is kept whatever the minimum.

This is not detected automatically, on purpose. A Nuxt project registers its
transformers through the module options rather than `uno.config.ts`, so the
config this rule loads can report no transformers in a project whose build runs
them - auto-detection would refuse to group in exactly the projects that can.

## How a rewrite is proved

A second generator is built from the same config with the blocklist, safelist
and preflights cleared - otherwise the blocked side generates nothing and every
comparison is "something versus nothing".

Both sides are generated and reduced to the declarations a browser would
compute:

- class names are dropped, so a rename compares equal
- declaration order, and the order rules appear in, are ignored
- `--un-*` custom properties are resolved the way the cascade resolves them,
  so `c-black/50` and `c-black c-op-50` are recognised as the same colour
- **the condition travels with the declaration.** `padding: 1rem` inside
  `@media (min-width: 640px)` is not the same promise as `padding: 1rem`
  outside one, and `color: red` on `:hover` is not `color: red`. A fix that
  adds or drops a variant is refused, however plausible the rename looks
- two empty stylesheets are never equal, so rewriting one unknown token into
  another is refused rather than waved through

**One assumption, stated out loud:** `rem` is compared against `px` at a
16-pixel root, which is what makes `m-[4px]` -> `m-1` provable. Set
`rootFontSize` to your root size if it differs, or to `false` for a strict
comparison in which `4px` and `0.25rem` are simply different - the honest
reading for a project whose users change their browser font size.

### Shortcuts that mean different things in different builds

A project that composes its config from layers - a brand, a theme, a
white-label tenant - can define one shortcut name twice:

```ts
// brands/timberland/…/typography.ts
'title-5': 'text-xs fw-bold font-secondary'

// brands/vans/…/typography.ts
'title-5': 'text-base fw-bold lh-1 font-secondary'
```

Both are correct where they are. But a component shared by both brands is
linted against whichever config is on disk, so `--fix` under Timberland
rewrites `text-xs fw-bold font-secondary` to `title-5`, and the Vans build then
renders that element at `text-base` with a line height nobody asked for.

**The proof cannot catch this.** It builds one generator from one config, so
both sides of the comparison come from the same layer and the collapse is
genuinely equivalent *there*. What the rewrite changes is not the CSS but the
*meaning*: a fixed set of utilities becomes a lookup whose result differs per
build. Nothing inside a single config makes that visible.

So the config says it, on the shortcut itself:

```ts
import { scoped } from 'eslint-plugin-unocss-normalize-classes/config'

// brands/timberland/config/unocss/shortcuts/index.ts
export default [
  ...scoped({ ...button, ...typography }),
] as UserShortcuts
```

`scoped` moves a shortcut map to the tuple form - the only one with a meta slot
- and marks each entry. Same additive convention as `fix` on a blocklist entry:
`RuleMeta` upstream knows nothing about `scoped`, UnoCSS ignores meta keys it
does not recognise, and the generated CSS is byte for byte what it was.

A marked shortcut is no longer a collapse source. It still generates, still
works everywhere it is written by hand, and every unmarked shortcut in the
config keeps collapsing as before.

**Per shortcut, not per config, because a merged config cannot say which is
which.** After `mergeConfigs` a top-level flag is one scalar with nothing
tying it to any shortcut, and while the merged `shortcuts` array does keep its
per-layer segments in order, it does not keep their boundaries. The marker has
to travel on the shortcut.

#### Turning it back on where the layer is known

Code that only ever ships with one layer - a `themes/dark/**` component, a
tenant-specific page - should get the collapse, because there the name means
one thing. `allowScoped` says so, on a block scoped to that layer's files and
pointed at that layer's config:

```js
{
  files: ['themes/dark/**/*.vue'],
  rules: {
    'unocss-normalize/classes': ['error', { configPath: 'dark.uno.config.ts', allowScoped: true }],
  },
}
```

That is one block per layer, each needing a config that merges the shared
layers with that layer's own. A Nuxt project gets both from this package.

##### In a Nuxt project

The `/nuxt` subpath is a Nuxt module that writes one merged config per theme,
and `themedConfigs()` turns the same map into the blocks above:

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@unocss/nuxt', 'eslint-plugin-unocss-normalize-classes/nuxt'],
  unocss: { nuxtLayers: true },
  unoThemedConfigs: {
    // each theme, and the directory holding its layers
    themes: { dark: 'themes/dark', light: 'themes/light' },
    // directories whose layers every theme merges beneath its own
    shared: ['layers'],
  },
})
```

```js
// eslint.config.js
import unocssNormalize, { themedConfigs } from 'eslint-plugin-unocss-normalize-classes'

export default [
  ...unocssNormalize.configs.recommended,
  // after the project-wide entry, so these win for the files they match
  ...themedConfigs({ themes: { dark: 'themes/dark', light: 'themes/light' } }),
]
```

- **What gets written:** `.nuxt/uno/config/<theme>.mjs`, as Nuxt templates -
  rewritten by every `prepare`, `dev` and `build`. They are templates rather
  than files a script drops in, because `nuxi prepare` deletes build-directory
  files it did not write itself.
- **Which layers:** the shared ones are found exactly the way `@unocss/nuxt`
  finds layers for its own `uno.config.mjs`, so the active theme's file matches
  that one layer for layer. Anything outside `shared` - the active theme, or a
  layer only one command switches on - stays out, so the files never depend on
  which command ran last.
- **`themedConfigs` options:** `rootDir` (default `process.cwd()`), `buildDir`
  (default `.nuxt`), `severity` (default `'error'`), and `ruleOptions`. The
  last one matters: a later flat-config block replaces a rule's options
  wholesale, so anything the project-wide entry sets has to be repeated there.
- **Before the first `prepare`:** a theme whose file is not on disk gets no
  block, so a fresh checkout lints with the project-wide entry rather than
  failing to load a config.
- **Versions:** Nuxt 3.17 and newer, including 4. `@nuxt/kit` and
  `@nuxt/schema` are optional peers - the ESLint plugin on its own installs
  nothing from Nuxt.

A project-wide block and a theme block may name the same config: the session
cache is keyed by config alone, and `allowScoped` is applied per plan.

A scoped shortcut that is skipped is skipped silently - like `shortcuts: false`,
and unlike a refused rewrite. There is nothing to fix in the config, so there
is nothing to report.

## Options

| Option           | Default | What it does                                                                     |
| ---------------- | ------- | -------------------------------------------------------------------------------- |
| `shortcuts`      | `true`  | Collapse token sets that a shortcut already names                                  |
| `allowScoped`    | `false` | Also collapse into shortcuts the config marked `scoped`                            |
| `blocklist`      | `true`  | Apply the `fix` a blocklist entry declares                                         |
| `variantGroups`  | `false` | Collapse tokens sharing a variant into a group; `true`, or `{ minimum: n }`        |
| `reportUnproven` | `true`  | Report a rewrite that was proposed and refused, instead of staying silent          |
| `rootFontSize`   | `16`    | Root size for comparing `rem` against `px`; `false` compares them strictly         |
| `configPath`     | -       | Path to the UnoCSS config, when it is not where UnoCSS would look                  |

`reportUnproven` is on by default because a refused rewrite is a finding about
your config, not noise: it means an entry claims a replacement that renders
differently. That is the `blur-[4px]` case, and you want to hear about it.

## Alongside `unocss/order`

They compose, and they are better together than either is alone. The sorter
decides the order of the tokens; this rule decides which tokens they are.

```js
rules: {
  'unocss/order': 'error',
  'unocss-normalize/classes': 'error',
}
```

**This rule unblocks the sorter.** `unocss/order` sorts by asking the generator
to parse each token, and a token your blocklist blocks does not parse - so the
sorter leaves it exactly where it is. On a file written in the spellings your
config rejects, sorting does almost nothing:

```
class="opacity-50 border flex"

  unocss/order alone            opacity-50 border flex   nothing it can sort
  this rule alone               op-50 b flex             normalised, order untouched
  both, in one ESLint run       flex b op-50
```

Configure them in the same run rather than one after the other. ESLint re-runs
every rule after each fix pass, so the pair converges; a whole run of one piped
into a whole run of the other does not, because the sorter has already had its
turn before the tokens became sortable.

One caveat worth knowing: `unocss/order` rewrites a class attribute onto a
single line, including when the tokens are already in order. With it enabled, a
multi-line class list will be flattened - by the sorter, not by this rule. The
suite pins that behaviour, so if upstream changes it this note goes.

## What it does not do

- **Dynamic `:class` expressions.** A binding is JavaScript, and the class list
  is a value the rule cannot see. Guessing at string literals inside one would
  trade the guarantee for reach.
- **JSX, Svelte, or plain HTML.** Vue static attributes only, for now.
- **Invent conventions.** Every rewrite comes from your shortcuts or your
  blocklist. The plugin ships no opinions about what your class names should be.
- **Replace `unocss/blocklist`.** That rule reports everything your blocklist
  blocks. This one only speaks up where it can either fix something or tell you
  a declared fix is wrong. Run both.
- **Reformat your templates.** A rewrite is joined with the whitespace the
  attribute already used, so a class list written one token per line stays that
  way, and an attribute nothing could be proved about is left byte for byte.
- **Deduplicate.** `border border` becomes `b b`. Removing a repeat is a
  different change from normalising one, and doing it here would mean editing
  attributes nobody asked about.

## Using the parts directly

The interesting half has no ESLint in it:

```ts
import { isEquivalent, planRewrite } from 'eslint-plugin-unocss-normalize-classes'
```

`planRewrite` takes `declaredFix`, `prove` and `shortcuts` as arguments and
knows nothing about UnoCSS, ESLint, or where the answers came from - useful for
a one-off codemod, and the reason it could be lifted into
`@unocss/eslint-plugin` whose own `blocklist` rule already declares
`fixable: 'code'` and never emits a fix.

## Try it without installing it

`demo/` is a minimal Nuxt 4 app wired to the working copy of this package:

```bash
pnpm demo:install
pnpm demo:lint
```

Two cards with the same design, one written in the spellings the demo's
blocklist rejects. `pnpm --dir demo lint:fix` rewrites it and the page renders
identically - except for one deliberately wrong fix, which the plugin reports
instead of applying. See [demo/README.md](demo/README.md).

The demo is its own workspace root, so it never enters this package's install
or its CI.

## Development

```bash
pnpm install
pnpm test        # builds, then runs the suite
pnpm smoke       # the built artifact, through a real ESLint
pnpm check:docs  # every claim this README makes about the package
```

`pnpm test:unit` skips the build when `dist/` is current. The rule suite needs
`dist/worker.mjs`, because the rule loads its worker from there in development
too.

## Releasing

`pnpm release` bumps the version, tags it and pushes; the tag is what starts
the publish workflow. Nothing is published from a laptop - npm only attaches a
provenance attestation inside a supported CI provider, so a local publish would
ship a weaker version of the same package and nothing downstream would say so.

## Licence

MIT
