import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeEngine } from './fake/fake-engine.ts';
import { createApp, TOKEN_HEADER } from './app.ts';
import { findWebRoot, pageWithToken, serveWebUi } from './web-ui.ts';

const dirs: string[] = [];

function webRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'postpile-web-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><html><head><title>PostPile</title></head><body></body></html>');
  writeFileSync(join(dir, 'assets', 'index-abc.js'), 'console.log(1)');
  writeFileSync(join(dir, '..', 'secret.txt'), 'outside');
  return dir;
}

function appServing(root: string) {
  const app = createApp(new FakeEngine(), 'tok"en', { fake: true, syncCallCap: 30, syncOnStart: true, profile: 'default', databasePath: null, autoSyncMinutes: 60, install: 'app-browser' });
  serveWebUi(app, root, 'tok"en');
  return app;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('the served web UI', () => {
  it('hands the page its token in a meta tag and refuses framing', async () => {
    const response = await appServing(webRoot()).request('http://127.0.0.1:4870/');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(await response.text()).toContain('<meta name="postpile-token" content="tok&quot;en" />');
  });

  it('serves built assets with a long cache, and nothing outside the root', async () => {
    const app = appServing(webRoot());
    const asset = await app.request('http://127.0.0.1:4870/assets/index-abc.js');
    expect(asset.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(asset.headers.get('cache-control')).toContain('immutable');
    expect((await app.request('http://127.0.0.1:4870/../secret.txt')).status).toBe(404);
    expect((await app.request('http://127.0.0.1:4870/%2e%2e/secret.txt')).status).toBe(404);
    expect((await app.request('http://127.0.0.1:4870/missing.js')).status).toBe(404);
  });

  it('keeps the API behind the token and answers unknown API paths with JSON', async () => {
    const app = appServing(webRoot());
    expect((await app.request('http://127.0.0.1:4870/api/config')).status).toBe(401);
    expect((await app.request('http://127.0.0.1:4870/api/config', { headers: { [TOKEN_HEADER]: 'tok"en' } })).status).toBe(200);
    const unknown = await app.request('http://127.0.0.1:4870/api/nope', { headers: { [TOKEN_HEADER]: 'tok"en' } });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: 'not found' });
  });

  it('refuses any host name but the loopback ones, so a rebound domain cannot read the token', async () => {
    const app = appServing(webRoot());
    expect((await app.request('http://evil.example:4870/')).status).toBe(403);
    expect((await app.request('http://evil.example:4870/api/config', { headers: { [TOKEN_HEADER]: 'tok"en' } })).status).toBe(403);
    expect((await app.request('http://localhost:4870/')).status).toBe(200);
    expect((await app.request('http://postpile.localhost:4870/')).status).toBe(200);
    expect((await app.request('http://postpile.localhost.evil.example:4870/')).status).toBe(403);
  });

  it('puts the meta tag first in the head', () => {
    expect(pageWithToken('<html><head><title>x</title></head></html>', 'abc')).toBe('<html><head>\n    <meta name="postpile-token" content="abc" /><title>x</title></head></html>');
  });
});

describe('findWebRoot', () => {
  it('takes POSTPILE_WEB_ROOT, empty turns the UI off, else the first built folder', () => {
    const root = webRoot();
    expect(findWebRoot({ POSTPILE_WEB_ROOT: '/somewhere' }, [root])).toBe('/somewhere');
    expect(findWebRoot({ POSTPILE_WEB_ROOT: '' }, [root])).toBeNull();
    expect(findWebRoot({}, [join(root, 'missing'), root])).toBe(root);
    expect(findWebRoot({}, [join(root, 'missing')])).toBeNull();
  });
});
