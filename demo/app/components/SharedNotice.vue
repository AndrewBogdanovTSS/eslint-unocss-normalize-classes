<template>
  <!--
    Shared by both themes, and meant to look like this in both - its author
    chose these utilities for every build.

    Under ocean they spell ocean's `surface` and `title` exactly. A linter that
    trusted the ocean config would rewrite them into those names, and the forest
    build would then render forest's surface and title here instead: a green
    stripe and an uppercase heading, in a box that was meant to be blue.

    Both themes mark those shortcuts `scoped`, so this file is left alone.
  -->
  <aside class="b b-sky-200 rounded-xl bg-sky-50 p-6">
    <h2 class="text-2xl c-sky-800 fw-bold tracking-tight">
      The same in every theme
    </h2>
    <p>
      This component lives in <code>app/</code>, so it ships in both builds.
    </p>
  </aside>
</template>
