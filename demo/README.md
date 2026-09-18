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

The demo is its own workspace root, so installing it never pulls Nuxt into the
package above, and the package's own `pnpm install` and CI never see it.

If `pnpm install` cannot find the plugin, build it once: `cd .. && pnpm build`.
The link points at the package directory, and the package's entry point is
`dist/`.

## What you are looking at

Two cards with the same design, in `app/components/`:

- **`TidyCard.vue`** is written in the vocabulary `uno.config.ts` asks for.
  Nothing is reported about it.
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
`uno.config.ts` here, which is why `variantGroups: true` is safe to turn on in
`eslint.config.js`.

Three steps, each proved on its own: `border` becomes `b` from the blocklist,
`flex flex-col` collapses into the `f-col` shortcut, and the result then matches
`card`, which is defined in terms of `f-col`.

## The one thing it refuses

One error survives `pnpm lint:fix`, on purpose:

```
"blur-[4px]" would be rewritten to "blur-1", but that generates different CSS,
so it was not applied.
```

`uno.config.ts` declares that fix, and it is wrong: `blur` is not on the 0.25rem
spacing scale, so dividing by four turns 4px of blur into 1px. The plugin
generates both, compares them, and refuses. Delete that blocklist entry, or
correct it, and the error goes.

This is the whole argument for the package in one line of output: a fix that
looks exactly like the correct ones, and is not.

## Files

| File | What it is for |
| --- | --- |
| `uno.config.ts` | The project config: shortcuts, and a blocklist whose entries declare `fix` |
| `eslint.config.js` | `unocss/order` and `unocss-normalize/classes`, both in one run |
| `app/components/MessyCard.vue` | Written in the blocked spellings - the thing to fix |
| `app/components/TidyCard.vue` | The same card, already normalised |

Both ESLint rules are enabled together deliberately. The sorter cannot order a
token the blocklist blocks, so normalising is what makes sorting possible - see
the "Alongside `unocss/order`" section of the package README.
