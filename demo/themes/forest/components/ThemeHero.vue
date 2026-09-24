<template>
  <!--
    Only ever built into the forest app. `eslint.config.js` lints this file
    against forest's own config whichever theme was prepared last, so
    `pnpm lint:fix` collapses these utilities into forest's `surface` and
    `title` - not ocean's, which would be different utilities entirely.
  -->
  <section class="b-l-4 b-emerald-600 bg-emerald-50 p-6">
    <h2 class="text-xl c-emerald-900 fw-semibold tracking-wide uppercase">
      Forest
    </h2>
    <p>
      This component lives in <code>themes/forest/</code>. Build the other theme with
      <code>pnpm dev</code>.
    </p>
  </section>
</template>
