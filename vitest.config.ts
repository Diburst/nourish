import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    include: ['__tests__/**/*.test.ts'],
    exclude: ['e2e/**', 'node_modules/**'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } }, // contract tests share one DB
    testTimeout: 30_000,
    hookTimeout: 60_000,
    setupFiles: ['__tests__/integration/setup.ts'],
  },
  resolve: {
    alias: [
      {
        find: 'next-auth/providers/credentials',
        replacement: path.resolve(__dirname, 'node_modules/next-auth/providers/credentials.js'),
      },
      { find: /^next-auth$/, replacement: path.resolve(__dirname, '__tests__/mocks/next-auth.ts') },
      { find: '@', replacement: path.resolve(__dirname, 'src') },
    ],
  },
});
