import { defineConfig } from 'vitest/config'

// The suite reads the real committed objaverse index, which is 20,000 rows, and samples a real
// surface to place points. Both are slower than the default five seconds on a loaded machine, and
// a test that times out says nothing about the code, so the limit is set where the work fits.
export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
