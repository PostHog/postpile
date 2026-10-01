import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    ssr: true,
    target: 'node24',
    outDir: 'dist/postpile-server/lib',
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      input: { server: '../server/src/main.ts', mcp: 'src/mcp.ts' },
      output: { format: 'es', entryFileNames: '[name].js', chunkFileNames: 'chunks/[name]-[hash].js' },
    },
  },
  ssr: { noExternal: true, target: 'node' },
});
