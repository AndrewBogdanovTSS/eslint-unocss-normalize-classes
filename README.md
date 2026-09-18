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

`fix` returns the tokens that replace the blocked one - one, or several. This
is an additive convention: `BlocklistMeta` upstream carries only `message`, and
UnoCSS ignores meta keys it does not recognise, so a config can declare `fix`
today without waiting for anything to change.

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

## Options

| Option           | Default | What it does                                                                     |
| ---------------- | ------- | -------------------------------------------------------------------------------- |
| `shortcuts`      | `true`  | Collapse token sets that a shortcut already names                                  |
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
