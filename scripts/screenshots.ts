// README screenshots: `pnpm screenshots`. Local only, because the macOS system
// font is part of the look. Needs Chromium once: `npx playwright install chromium`.
// It builds the renderer, starts the sample-data server and a static file server
// on free ports, and writes one PNG per entry of SHOTS to docs/images/.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { createServer as createHttpServer, type Server } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';

interface Shot {
  /** File name: docs/images/<name>.png */
  name: string;
  /** Clicks and waits before the shot. */
  setup?: (page: Page) => Promise<void>;
  /** The element to crop to. Several selectors crop to the box around all of them. */
  selector: string | string[];
  /** Where to draw a cursor, in page pixels. Gets the cropped box. */
  cursor?: (box: Box) => { x: number; y: number };
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const SELECTED_TILE = 'article.border-accent';
const DETAILS = 'aside[aria-label="Details"]';
const TILE_ROWS = 'article:has-text("rowan/depot: e2e layer")';

// Each shot is one feature, cropped tight. Run one with: pnpm screenshots <name>
const SHOTS: Shot[] = [
  { name: 'topic-row', selector: 'nav[aria-label="Topics"] button:has-text("Move CI to Depot")' },
  { name: 'queues', selector: '[role="group"][aria-label="Filter topics"]' },
  { name: 'tile', selector: 'article:has-text("DEPOT_TOKEN went in")' },
  { name: 'stack', selector: `${TILE_ROWS} >> text=#1851 >> xpath=../../..` },
  { name: 'glance', selector: `${DETAILS} div.rounded-box:has-text("Look closer") >> xpath=..`, setup: selectFirstTile },
  { name: 'new-since', selector: `${DETAILS} div.rounded-box:has-text("New since you looked")`, setup: selectFirstTile },
  { name: 'dossier', selector: 'main >> text=Status >> xpath=..' },
  {
    name: 'approve',
    selector: `${DETAILS} button:has-text("Approve") >> xpath=..`,
    setup: selectFirstTile,
    cursor: (box) => ({ x: box.x + 60, y: box.y + box.height / 2 + 8 }),
  },
  { name: 'status-bar', selector: ['footer >> text=unread >> nth=0', 'footer >> text=live poll off'] },
];

const PADDING = 12;
const WIDTH = 1440;
const HEIGHT = 900;
const TOKEN = 'screenshots';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RENDERER_DIR = join(ROOT, 'apps/desktop/out/renderer');
const OUT_DIR = join(ROOT, 'docs/images');
const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};
const CURSOR_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22"><path d="M3 2l14 7.5-6 1.6-2.6 6z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';

async function selectFirstTile(page: Page): Promise<void> {
  await page.locator('article').first().click({ position: { x: 12, y: 12 } });
  await page.locator(SELECTED_TILE).first().waitFor();
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

function serveRenderer(port: number): Promise<Server> {
  const server = createHttpServer((request, response) => {
    const path = normalize(new URL(request.url ?? '/', 'http://x').pathname).replace(/^(\.\.[/\\])+/, '');
    const file = join(RENDERER_DIR, path === '/' ? 'index.html' : path);
    if (!existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(response);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

/** Starts the sample-data API in its own process group, so the whole tree can be killed. */
function startApi(port: number): ChildProcess {
  return spawn('pnpm', ['server'], {
    cwd: ROOT,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, POSTPILE_FAKE: '1', POSTPILE_FAKE_UPDATE: '0', POSTPILE_POLL_SECONDS: '0', POSTPILE_TOKEN: TOKEN, PORT: String(port) },
  });
}

function killTree(child: ChildProcess): void {
  if (child.pid) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      // already gone
    }
  }
}

async function waitForApi(port: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/config`, { headers: { 'x-postpile-token': TOKEN } });
      if (response.ok) {
        return;
      }
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('The sample-data server did not start');
}

async function drawCursor(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(
    ({ x, y, svg }) => {
      const cursor = document.createElement('div');
      cursor.id = 'shot-cursor';
      cursor.innerHTML = svg;
      cursor.style.cssText = `position:fixed;left:${x}px;top:${y}px;pointer-events:none;z-index:2147483647;line-height:0`;
      document.body.append(cursor);
    },
    { x, y, svg: CURSOR_SVG },
  );
}

async function boxAround(page: Page, shot: Shot): Promise<Box> {
  const selectors = Array.isArray(shot.selector) ? shot.selector : [shot.selector];
  const boxes: Box[] = [];
  for (const selector of selectors) {
    const target = page.locator(selector).first();
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    if (!box) {
      throw new Error(`${shot.name}: ${selector} has no box`);
    }
    boxes.push(box);
  }
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

async function takeShot(page: Page, shot: Shot): Promise<void> {
  await page.reload();
  await page.locator('article').first().waitFor();
  await shot.setup?.(page);
  const box = await boxAround(page, shot);
  if (shot.cursor) {
    const point = shot.cursor(box);
    await drawCursor(page, point.x, point.y);
  }
  const clip = {
    x: Math.max(0, box.x - PADDING),
    y: Math.max(0, box.y - PADDING),
    width: Math.min(WIDTH, box.width + PADDING * 2),
    height: Math.min(HEIGHT, box.height + PADDING * 2),
  };
  await page.screenshot({ path: join(OUT_DIR, `${shot.name}.png`), clip });
  console.log(`docs/images/${shot.name}.png`);
}

async function main(): Promise<void> {
  const build = spawnSync('pnpm', ['build'], { cwd: ROOT, stdio: 'inherit' });
  if (build.status !== 0) {
    throw new Error('pnpm build failed');
  }
  mkdirSync(OUT_DIR, { recursive: true });
  const apiPort = await freePort();
  const webPort = await freePort();
  const api = startApi(apiPort);
  let web: Server | undefined;
  try {
    web = await serveRenderer(webPort);
    await waitForApi(apiPort);
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 2 });
      await page.goto(`http://127.0.0.1:${webPort}/index.html?api=http://127.0.0.1:${apiPort}&token=${TOKEN}`);
      const only = process.argv.slice(2);
      for (const shot of SHOTS.filter((candidate) => only.length === 0 || only.includes(candidate.name))) {
        await takeShot(page, shot);
      }
    } finally {
      await browser.close();
    }
  } finally {
    web?.close();
    killTree(api);
  }
}

process.on('SIGINT', () => process.exit(130));
await main();
