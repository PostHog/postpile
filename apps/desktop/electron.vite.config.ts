import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

// Workspace packages export TypeScript source, so the main process bundle has
// to include them instead of leaving them as runtime imports.
const workspacePackages = [
  '@code-manager/core',
  '@code-manager/store',
  '@code-manager/github',
  '@code-manager/agent',
  '@code-manager/engine',
  '@code-manager/server',
];

export default defineConfig({
  main: {
    build: {
      externalizeDeps: { exclude: workspacePackages },
    },
  },
  renderer: {
    plugins: [react()],
  },
});
