<template>
  <!--
    The same card as TidyCard, written in the spellings this project's blocklist
    rejects. Two things to notice when you run the demo:

      1. It renders unstyled. A blocked class never reaches the stylesheet, so
         the CSS for `border` and `opacity-50` is simply not generated.
      2. `pnpm lint:fix` rewrites it into TidyCard's vocabulary, and the page
         then looks identical - which is the point: every rewrite was proved to
         generate the same CSS before it was written.

    The `blur-[4px]` below is the exception. Its fix would change 4px of blur
    into 1px, so the plugin reports it and leaves it alone. Fix that one by
    hand, or correct the entry in uno.config.ts.
  -->
  <section
    class="
      flex
      flex-col
      gap-4
      p-6
      rounded
      border
      b-gray-300
    "
  >
    <header class="justify-center items-center flex gap-2">
      <span class="block size-4 rounded-full bg-emerald-500" />
      <h2 class="text-lg font-semibold">Messy</h2>
    </header>

    <p class="md:text-center md:opacity-50">
      Two tokens sharing a breakpoint, waiting to be grouped.
    </p>

    <p class="opacity-50">
      Written in spellings the blocklist rejects, so none of it reaches the stylesheet.
    </p>

    <p class="blur-[4px]">
      This one has a fix the plugin refuses to apply.
    </p>
  </section>
</template>
