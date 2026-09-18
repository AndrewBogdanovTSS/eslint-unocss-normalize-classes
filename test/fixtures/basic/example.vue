<script setup>
// A class-like string in the script block. The rule reads template attributes,
// not source text that happens to look like one, and the smoke test checks
// this line survives untouched.
const fallbackClasses = 'border opacity-50'

defineProps({ loading: Boolean })
</script>

<template>
  <article class="card">
    <header
      class="
        border
        opacity-50
        items-center
        justify-center
      "
    >
      <!-- a component tag, and a fix that expands one token into two -->
      <my-avatar class="size-4 flex" />

      <!-- a static list beside a dynamic one: only the static half is rewritten -->
      <h1
        class="whitespace-nowrap leading-4"
        :class="{ 'opacity-50': loading }"
      >
        Title
      </h1>
    </header>

    <!-- a variant group, a project-defined variant, and an important marker -->
    <p class="hover:(border opacity-50) @hover:border sm:hover:!border">
      Body
    </p>

    <!-- a chain: size-1rem becomes w-1rem h-1rem becomes w-4 h-4 -->
    <img class="size-1rem squircle" alt="">

    <!-- two fixes that cannot be proved, sitting next to one that can -->
    <footer class="border blur-[4px] text-center">
      <!-- a blocklist entry with no fix at all: unocss/blocklist's job -->
      <span class="float-left" />

      <!-- classes the config knows nothing about -->
      <span class="my-own-class another-one" />

      <!-- a valueless attribute is attributify territory, not a class list -->
      <span border op-50 />

      <!-- already written in the project vocabulary -->
      <span class="b op-50 center" />
    </footer>
  </article>
</template>

<style scoped>
/* A selector that matches a blocked utility name. Style blocks are not class
   attributes, and the smoke test checks this rule is left alone. */
.border {
  color: red;
}
</style>
