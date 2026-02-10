import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/*/src/**/*.test.ts', 'providers/*/src/**/*.test.ts', 'channels/*/src/**/*.test.ts', 'tools/*/src/**/*.test.ts'],
  },
});
