import { defineConfig } from 'vitest/config';

// The server has no Vite build (it's a plain Express app), so vitest gets its
// own minimal config. Routes are pure request handlers, so the default node
// environment is correct.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['**/*.test.js'],
  },
});
