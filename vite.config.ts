import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: { host: true },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Scenario tests run minutes of game time.
    testTimeout: 60000,
  },
});
