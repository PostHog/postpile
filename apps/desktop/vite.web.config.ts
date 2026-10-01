import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

function relaxCspForDevServer(): Plugin {
  return {
    name: 'postpile-relax-csp-for-dev-server',
    apply: 'serve',
    transformIndexHtml(html) {
      return html
        .replace("default-src 'self';", "default-src 'self'; script-src 'self' 'unsafe-inline';")
        .replace("connect-src 'self' http://127.0.0.1:*", "connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*");
    },
  };
}

export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react(), tailwindcss(), relaxCspForDevServer()],
  server: { host: '127.0.0.1' },
  build: {
    outDir: '../../dist-web',
    emptyOutDir: true,
    minify: true,
    chunkSizeWarningLimit: 1000,
  },
});
