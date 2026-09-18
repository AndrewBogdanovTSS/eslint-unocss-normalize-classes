<template>
  <main class="f-col gap-8 p-8 font-sans">
    <header class="f-col gap-2">
      <h1 class="text-2xl font-bold">eslint-plugin-unocss-normalize-classes</h1>
      <p class="op-70">
        Two cards with the same design. The left one is written in spellings
        <code>uno.config.ts</code> blocks, so UnoCSS never generates its CSS.
        Run <code>pnpm lint:fix</code> and watch it become the right one.
      </p>
    </header>

    <div class="grid cols-1 gap-6">
      <MessyCard />
      <TidyCard />
    </div>
  </main>
</template>
