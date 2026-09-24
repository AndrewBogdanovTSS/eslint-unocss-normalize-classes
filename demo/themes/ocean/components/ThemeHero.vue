<template>
  <!--
    Only ever built into the ocean app: Nuxt extends this layer when THEME is
    `ocean`, and never otherwise. So `surface` and `title` have exactly one
    meaning in this file - ocean's - and `pnpm lint:fix` collapses these
    utilities into them, even though both names are `scoped`.
  -->
  <section class="b b-sky-200 rounded-xl bg-sky-50 p-6">
    <h2 class="text-2xl c-sky-800 fw-bold tracking-tight">
      Ocean
    </h2>
    <p>
      This component lives in <code>themes/ocean/</code>. Build the other theme with
      <code>pnpm dev:forest</code>.
    </p>
  </section>
</template>
