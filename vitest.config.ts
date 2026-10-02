import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The renderer's component tests (*.test.tsx) use React's automatic JSX runtime, as the app build does.
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts', 'apps/*/src/**/*.test.tsx'],
    environment: 'node',
  },
});
