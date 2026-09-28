import type { FetchFn, TokenSource } from '@postpile/github';
import { failureOf, type ToolHealth } from './tool-health.ts';

/** gh is missing, logged out or its token was refused. The message is the status headline. */
export class GhOffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GhOffError';
  }
}

/**
 * The gh token behind the tool status: while gh is known to be broken no
 * `gh auth token` runs and no request goes out, and a failed read reports
 * what it meant (missing, logged out).
 */
export class WatchedTokenSource implements TokenSource {
  constructor(
    private readonly inner: TokenSource,
    private readonly health: ToolHealth,
  ) {}

  async token(): Promise<string> {
    const off = this.health.ghOffReason();
    if (off !== null) {
      this.health.recheckIfDue();
      throw new GhOffError(off);
    }
    try {
      return await this.inner.token();
    } catch (error) {
      this.health.noteGhFailure(failureOf(error));
      throw error;
    }
  }

  forget(): void {
    this.inner.forget?.();
  }
}

/** Calls the global fetch without binding it to our object. */
const globalFetch: FetchFn = (url, init) => fetch(url, init);

/** fetch that tells the tool status about 401s, network failures and answers that worked. */
export function watchedFetch(health: ToolHealth, inner: FetchFn = globalFetch): FetchFn {
  return async (url, init) => {
    let response: Response;
    try {
      response = await inner(url, init);
    } catch (error) {
      health.noteGhFailure(failureOf(error));
      throw error;
    }
    if (response.status === 401) {
      health.noteGhFailure({ status: 401, message: 'GitHub answered 401 to the gh token' });
    } else if (response.status < 400) {
      health.noteGhWorked();
    }
    return response;
  };
}
