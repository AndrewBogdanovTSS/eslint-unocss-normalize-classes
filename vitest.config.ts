import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // The integration suite starts a synckit worker per config, which loads and
    // evaluates a real `uno.config.ts`. That is slower than a unit test and
    // must not be cut short on a cold cache.
    testTimeout: 30_000,
  },
})
