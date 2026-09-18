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
nothing else in the attribute moves.

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

A fix written against the bare utility still answers for a token carrying
variants or an important marker: `^border$` fixes `sm:hover:!border`. Chains
are followed, so `ma-auto` -> `m-auto` -> `m-a` resolves in one pass. Variant
groups are expanded before the rewrite and collapsed after it, using the same
UnoCSS helpers the `unocss/order` rule uses, so `hover:(border opacity-50)`
comes back as `hover:(b op-50)`.

## How a rewrite is proved

A second generator is built from the same config with the blocklist, safelist
and preflights cleared - otherwise the blocked side generates nothing and every
comparison is "something versus nothing".

Both sides are generated and reduced to the declarations a browser would
compute:

- selectors are dropped, so `.c-black` and `.hover\:c-black:hover` compare equal
- declaration order is ignored
- `--un-*` custom properties are resolved the way the cascade resolves them,
  so `c-black/50` and `c-black c-op-50` are recognised as the same colour
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
| `reportUnproven` | `true`  | Report a rewrite that was proposed and refused, instead of staying silent          |
| `rootFontSize`   | `16`    | Root size for comparing `rem` against `px`; `false` compares them strictly         |
| `configPath`     | -       | Path to the UnoCSS config, when it is not where UnoCSS would look                  |

`reportUnproven` is on by default because a refused rewrite is a finding about
your config, not noise: it means an entry claims a replacement that renders
differently. That is the `blur-[4px]` case, and you want to hear about it.

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
