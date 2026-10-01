import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, cpSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SERVICE_DIR = import.meta.dirname;
const ROOT = join(SERVICE_DIR, '../..');
const DIST = join(SERVICE_DIR, 'dist');
const BUNDLE = join(DIST, 'postpile-server');

function run(command: string, args: string[], cwd: string): void {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: { ...process.env, COPYFILE_DISABLE: '1' } });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with ${result.status ?? result.signal}`);
  }
}

const { version } = JSON.parse(readFileSync(join(SERVICE_DIR, 'package.json'), 'utf8')) as { version: string };

run('pnpm', ['--filter', '@postpile/desktop', 'build:web'], ROOT);
run('pnpm', ['exec', 'vite', 'build'], SERVICE_DIR);

writeFileSync(join(BUNDLE, 'package.json'), `${JSON.stringify({ name: 'postpile-server', version, private: true, license: 'MIT', type: 'module' }, null, 2)}\n`);
cpSync(join(ROOT, 'apps/desktop/dist-web'), join(BUNDLE, 'web'), { recursive: true });
cpSync(join(SERVICE_DIR, 'bin'), join(BUNDLE, 'bin'), { recursive: true });
for (const name of readdirSync(join(BUNDLE, 'bin'))) {
  chmodSync(join(BUNDLE, 'bin', name), 0o755);
}
copyFileSync(join(ROOT, 'LICENSE'), join(BUNDLE, 'LICENSE'));

const tarball = `postpile-server-${version}.tar.gz`;
run('tar', ['-czf', tarball, 'postpile-server'], DIST);
const sha256 = createHash('sha256').update(readFileSync(join(DIST, tarball))).digest('hex');
writeFileSync(join(DIST, `${tarball}.sha256`), `${sha256}  ${tarball}\n`);
console.log(`${join(DIST, tarball)}\nsha256 ${sha256}`);
