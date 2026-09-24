<template>
  <main class="f-col gap-8 p-8 font-sans">
    <header class="f-col gap-2">
      <h1 class="text-2xl font-bold">eslint-plugin-unocss-normalize-classes</h1>
      <p class="op-70">
        The first box comes from the theme this app was built as - <code>pnpm dev</code>
        for ocean, <code>pnpm dev:forest</code> for forest. The second is shared, and
        looks the same in both. The cards below are the same design twice: the left
        one is written in spellings the base config blocks, so UnoCSS never generates
        its CSS. Run <code>pnpm lint:fix</code> and watch it become the right one.
      </p>
    </header>

    <ThemeHero />
    <SharedNotice />

    <div class="grid cols-1 gap-6 md:cols-2">
      <MessyCard />
      <TidyCard />
    </div>
  </main>
</template>
