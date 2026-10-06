import { pickUpdate, RELEASES_PAGE_SIZE, type ReleaseInfo, type UpdateView } from '@postpile/core';

// The update reminder's check: now and then, ask GitHub for the latest
// PostPile releases and keep the newest one that is newer than the running
// app. Unauthenticated (public repo, 60 requests an hour per IP is plenty for
// one ask every 6 hours) and with an ETag, so an unchanged list costs nothing.

export const RELEASES_URL = `https://api.github.com/repos/PostHog/postpile/releases?per_page=${RELEASES_PAGE_SIZE}`;

const FIRST_CHECK_MS = 30_000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const TIMEOUT_MS = 10_000;

/** What GET /api/update serves. The server starts it with itself and stops it on close. */
export interface UpdateSource {
  status(): UpdateView;
  /** Checks now (the app menu's "Check for Updates…"); never throws. */
  check(): Promise<UpdateView>;
  start(): void;
  stop(): void;
}

/** The fields of GitHub's release JSON the check reads. */
interface GitHubRelease {
  tag_name?: unknown;
  html_url?: unknown;
  published_at?: unknown;
  body?: unknown;
  draft?: unknown;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function releaseFromJson(json: GitHubRelease): ReleaseInfo {
  return {
    tag: text(json.tag_name),
    url: text(json.html_url),
    publishedAt: typeof json.published_at === 'string' ? json.published_at : null,
    notes: text(json.body),
    draft: json.draft === true,
  };
}

/** POSTPILE_UPDATE_CHECK=0: never asks, never shows anything. */
export class UpdatesOff implements UpdateSource {
  constructor(private readonly current: string) {}

  status(): UpdateView {
    return { current: this.current, latest: null, checkedAt: null, error: null };
  }

  check(): Promise<UpdateView> {
    return Promise.resolve(this.status());
  }

  start(): void {}

  stop(): void {}
}

export interface UpdateCheckerOptions {
  /** The running app's version. */
  current: string;
  /** Stubbed in tests. */
  fetch?: typeof fetch;
  now?: () => Date;
  log?: (message: string) => void;
}

/**
 * Checks ~30s after start and then every 6 hours. Never throws: a failed
 * check is logged, kept in `error`, and the last known update stays.
 */
export class UpdateChecker implements UpdateSource {
  private view: UpdateView;
  private etag: string | null = null;
  private firstTimer: ReturnType<typeof setTimeout> | null = null;
  private repeatTimer: ReturnType<typeof setInterval> | null = null;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => Date;
  private readonly log: (message: string) => void;

  constructor(private readonly options: UpdateCheckerOptions) {
    this.view = { current: options.current, latest: null, checkedAt: null, error: null };
    this.fetchFn = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.log = options.log ?? ((message) => console.log(message));
  }

  status(): UpdateView {
    return this.view;
  }

  private async fetchReleases(): Promise<ReleaseInfo[] | 'unchanged'> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': `PostPile/${this.options.current} (+https://github.com/PostHog/postpile)`,
    };
    if (this.etag) {
      headers['If-None-Match'] = this.etag;
    }
    const response = await this.fetchFn(RELEASES_URL, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (response.status === 304) {
      return 'unchanged';
    }
    if (!response.ok) {
      throw new Error(`GitHub answered ${response.status}`);
    }
    const json: unknown = await response.json();
    if (!Array.isArray(json)) {
      throw new Error('GitHub answered something that is not a release list');
    }
    this.etag = response.headers.get('etag');
    return json.map((entry) => releaseFromJson(entry as GitHubRelease));
  }

  async check(): Promise<UpdateView> {
    const checkedAt = this.now().toISOString();
    try {
      const releases = await this.fetchReleases();
      const latest = releases === 'unchanged' ? this.view.latest : pickUpdate(this.options.current, releases);
      this.view = { current: this.options.current, latest, checkedAt, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`update check failed: ${message}`);
      this.view = { ...this.view, checkedAt, error: message };
    }
    return this.view;
  }

  start(): void {
    this.stop();
    this.firstTimer = setTimeout(() => void this.check(), FIRST_CHECK_MS);
    this.repeatTimer = setInterval(() => void this.check(), CHECK_EVERY_MS);
    // Never keeps a process alive on its own.
    this.firstTimer.unref?.();
    this.repeatTimer.unref?.();
  }

  stop(): void {
    if (this.firstTimer) {
      clearTimeout(this.firstTimer);
    }
    if (this.repeatTimer) {
      clearInterval(this.repeatTimer);
    }
    this.firstTimer = null;
    this.repeatTimer = null;
  }
}
