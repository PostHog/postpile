import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const apiPort = process.env.PORT || '4870';
const token = process.env.POSTPILE_TOKEN || randomBytes(24).toString('hex');
const pagePath = `/?api=${encodeURIComponent(`http://127.0.0.1:${apiPort}`)}&token=${token}`;

function start(args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  return spawn('pnpm', args, { cwd: ROOT, detached: true, stdio: 'inherit', env });
}

function stop(child: ChildProcess): void {
  if (child.pid) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {}
  }
}

const api = start(['server'], { ...process.env, POSTPILE_TOKEN: token, PORT: apiPort });
const vite = start(['--filter', '@postpile/desktop', 'exec', 'vite', '--config', 'vite.web.config.ts', '--open', pagePath], {
  ...process.env,
  PORT: undefined,
});

console.log(`PostPile web: the page opens at ${pagePath} on the Vite server`);

function shutdown(code: number): void {
  stop(vite);
  stop(api);
  process.exit(code);
}

api.on('exit', (code) => shutdown(code ?? 1));
vite.on('exit', (code) => shutdown(code ?? 1));
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
