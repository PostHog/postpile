import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface TokenSource {
  token(): Promise<string>;
  /** Drops a cached token, e.g. after GitHub refused it, so the next call reads a fresh one. */
  forget?(): void;
}

/** gh is not on PATH (ENOENT) or has no login (GH_LOGGED_OUT). The engine turns these into a tool status. */
export class GhTokenError extends Error {
  constructor(
    message: string,
    readonly code: 'ENOENT' | 'GH_LOGGED_OUT',
  ) {
    super(message);
    this.name = 'GhTokenError';
  }
}

/** Reads the token from `gh auth token` once and keeps it in memory until forgotten. */
export class GhCliTokenSource implements TokenSource {
  private cached: Promise<string> | null = null;

  token(): Promise<string> {
    if (!this.cached) {
      const reading = readGhToken();
      this.cached = reading;
      // A failed read should not poison the cache; the next call retries.
      reading.catch(() => {
        if (this.cached === reading) {
          this.cached = null;
        }
      });
    }
    return this.cached;
  }

  forget(): void {
    this.cached = null;
  }
}

async function readGhToken(): Promise<string> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync('gh', ['auth', 'token']));
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stderr?: string };
    if (failure.code === 'ENOENT') {
      throw new GhTokenError('gh is not on PATH; install it with `brew install gh`', 'ENOENT');
    }
    const detail = String(failure.stderr ?? '').trim().split('\n')[0] || failure.message;
    throw new GhTokenError(`gh has no login (${detail}); run \`gh auth login\``, 'GH_LOGGED_OUT');
  }
  const token = stdout.trim();
  if (!token) {
    throw new GhTokenError('gh auth token returned nothing; run `gh auth login`', 'GH_LOGGED_OUT');
  }
  return token;
}
