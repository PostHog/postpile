import { pickUpdate, type ReleaseInfo, type UpdateView } from '@postpile/core';
import type { UpdateSource } from '../update-check.ts';

/** What sample data shows: the bar (3 releases, 52h behind), the small pill (1 release, 6h behind), or nothing. */
export type FakeUpdateMode = 'bar' | 'pill' | 'none';

const HOUR_MS = 60 * 60 * 1000;

/** Sample releases newer than `current`, newest first, so the sample never goes stale as the app moves on. */
function sampleReleases(current: string, mode: FakeUpdateMode, now: Date): ReleaseInfo[] {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(current);
  const [major, minor, patch] = match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [0, 0, 0];
  const hoursAgo = mode === 'bar' ? [6, 30, 52] : [6];
  return hoursAgo.map((hours, index) => {
    const tag = `v${major}.${minor}.${patch + hoursAgo.length - index}`;
    return {
      tag,
      url: `https://github.com/PostHog/postpile/releases/tag/${tag}`,
      publishedAt: new Date(now.getTime() - hours * HOUR_MS).toISOString(),
      notes: '- Sample release notes',
      draft: false,
    };
  });
}

/**
 * The update check of sample data (POSTPILE_FAKE=1): no network, sample
 * releases so the title bar reminder can be looked at. The default is a
 * reminder that is days behind, so the bar shows. POSTPILE_FAKE_UPDATE=pill
 * shows the small pill, POSTPILE_FAKE_UPDATE=0 an app that is up to date.
 */
export class FakeUpdates implements UpdateSource {
  private readonly view: UpdateView;

  constructor(current: string, mode: FakeUpdateMode) {
    const now = new Date();
    this.view = {
      current,
      latest: mode === 'none' ? null : pickUpdate(current, sampleReleases(current, mode, now)),
      checkedAt: now.toISOString(),
      error: null,
    };
  }

  status(): UpdateView {
    return this.view;
  }

  start(): void {}

  stop(): void {}
}
