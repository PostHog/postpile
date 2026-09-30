import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

// Source maps for PostHog Error Tracking: "hidden" writes the .map files
// without a sourceMappingURL comment. The release workflow uploads them with
// posthog-cli (RELEASING.md) and electron-builder.yml keeps them out of the
// app, so they never ship to users.
const sourcemap = 'hidden' as const;

// Workspace packages export TypeScript source, so the main process bundle has
// to include them instead of leaving them as runtime imports.
const workspacePackages = [
  '@postpile/core',
  '@postpile/store',
  '@postpile/github',
  '@postpile/agent',
  '@postpile/engine',
  '@postpile/server',
  '@postpile/mcp',
];

export default defineConfig({
  main: {
    build: {
      sourcemap,
      externalizeDeps: { exclude: workspacePackages },
      // mcp.js is the read-only MCP server that Resources/postpile-mcp runs
      // under ELECTRON_RUN_AS_NODE; it shares the engine code, not the process.
      rollupOptions: {
        input: { index: 'src/main/index.ts', mcp: 'src/main/mcp.ts' },
      },
    },
  },
  preload: {
    // Sandboxed preloads cannot be ES modules.
    build: {
      sourcemap,
      rollupOptions: { output: { format: 'cjs' } },
    },
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    // electron-vite leaves the renderer unminified by default; minified, the
    // bundle is about a third of the size, which the window parses on every start.
    // One local chunk, never downloaded: the 500 kB web warning does not apply
    // (the markdown renderer for PR descriptions took it to about 600 kB).
    build: { minify: true, chunkSizeWarningLimit: 1000, sourcemap },
  },
});
