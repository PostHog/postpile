import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface TokenSource {
  token(): Promise<string>;
}

/** Reads the token from `gh auth token` once and keeps it in memory. */
export class GhCliTokenSource implements TokenSource {
  private cached: Promise<string> | null = null;

  token(): Promise<string> {
    if (!this.cached) {
      this.cached = readGhToken();
      // A failed read should not poison the cache; the next call retries.
      this.cached.catch(() => {
        this.cached = null;
      });
    }
    return this.cached;
  }
}

async function readGhToken(): Promise<string> {
  const { stdout } = await execFileAsync('gh', ['auth', 'token']);
  const token = stdout.trim();
  if (!token) {
    throw new Error('gh auth token returned nothing; run `gh auth login`');
  }
  return token;
}
