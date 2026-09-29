import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

// Workspace packages export TypeScript source, so the main process bundle has
// to include them instead of leaving them as runtime imports.
const workspacePackages = [
  '@postpile/core',
  '@postpile/store',
  '@postpile/github',
  '@postpile/agent',
  '@postpile/engine',
  '@postpile/server',
];

export default defineConfig({
  main: {
    build: {
      externalizeDeps: { exclude: workspacePackages },
    },
  },
  preload: {
    // Sandboxed preloads cannot be ES modules.
    build: {
      rollupOptions: { output: { format: 'cjs' } },
    },
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    // electron-vite leaves the renderer unminified by default; minified, the
    // bundle is about a third of the size, which the window parses on every start.
    // One local chunk, never downloaded: the 500 kB web warning does not apply
    // (the markdown renderer for PR descriptions took it to about 600 kB).
    build: { minify: true, chunkSizeWarningLimit: 1000 },
  },
});
