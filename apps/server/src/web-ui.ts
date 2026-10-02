import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import type { Hono } from 'hono';

export const TOKEN_META_NAME = 'postpile-token';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

const NO_FRAMING = { 'x-frame-options': 'DENY', 'content-security-policy': "frame-ancestors 'none'" };

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function pageWithToken(indexHtml: string, token: string): string {
  return indexHtml.replace('<head>', `<head>\n    <meta name="${TOKEN_META_NAME}" content="${escapeAttribute(token)}" />`);
}

function fileInRoot(root: string, pathname: string): string | null {
  const file = resolve(root, `.${pathname}`);
  if (!file.startsWith(resolve(root) + sep) || !existsSync(file) || !statSync(file).isFile()) {
    return null;
  }
  return file;
}

export function serveWebUi(app: Hono, root: string, token: string): void {
  app.get('*', (c) => {
    const pathname = decodeURIComponent(new URL(c.req.url).pathname);
    if (pathname.startsWith('/api/')) {
      return c.json({ error: 'not found' }, 404);
    }
    if (pathname === '/' || pathname === '/index.html') {
      const page = pageWithToken(readFileSync(join(root, 'index.html'), 'utf8'), token);
      return c.html(page, 200, { 'cache-control': 'no-store', ...NO_FRAMING });
    }
    const file = fileInRoot(root, pathname);
    if (!file) {
      return c.text('not found', 404);
    }
    const immutable = pathname.startsWith('/assets/');
    return c.body(readFileSync(file), 200, {
      'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      ...NO_FRAMING,
    });
  });
}

export function findWebRoot(env: NodeJS.ProcessEnv, candidates: string[]): string | null {
  if (env.POSTPILE_WEB_ROOT !== undefined) {
    return env.POSTPILE_WEB_ROOT === '' ? null : env.POSTPILE_WEB_ROOT;
  }
  return candidates.find((dir) => existsSync(join(dir, 'index.html'))) ?? null;
}
