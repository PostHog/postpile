import { pickUpdate, RELEASES_PAGE_SIZE, type ReleaseInfo, type UpdateView } from '@postpile/core';
import type { UpdateSource } from '../update-check.ts';

/**
 * What sample data shows: the bar (3 releases, 52h behind), the small pill
 * (1 release, 6h behind), many releases (12, so the reminder says "10+"),
 * or nothing.
 */
export type FakeUpdateMode = 'bar' | 'pill' | 'many' | 'none';

const HOUR_MS = 60 * 60 * 1000;

/** How long ago each sample release came out, newest first. */
const RELEASE_HOURS_AGO: Record<Exclude<FakeUpdateMode, 'none'>, number[]> = {
  bar: [6, 30, 52],
  pill: [6],
  many: [6, 30, 52, 80, 110, 150, 200, 260, 330, 400, 480, 560],
};

/** Sample releases newer than `current`, newest first, so the sample never goes stale as the app moves on. */
function sampleReleases(current: string, mode: Exclude<FakeUpdateMode, 'none'>, now: Date): ReleaseInfo[] {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(current);
  const [major, minor, patch] = match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [0, 0, 0];
  const hoursAgo = RELEASE_HOURS_AGO[mode];
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
 * shows the small pill, POSTPILE_FAKE_UPDATE=many 12 releases ("10+"),
 * POSTPILE_FAKE_UPDATE=0 an app that is up to date.
 */
export class FakeUpdates implements UpdateSource {
  private readonly view: UpdateView;

  constructor(current: string, mode: FakeUpdateMode) {
    const now = new Date();
    this.view = {
      current,
      // One page, like the real check (RELEASES_URL): with more releases than fit, the reminder says "10+".
      latest: mode === 'none' ? null : pickUpdate(current, sampleReleases(current, mode, now).slice(0, RELEASES_PAGE_SIZE)),
      checkedAt: now.toISOString(),
      error: null,
    };
  }

  status(): UpdateView {
    return this.view;
  }

  check(): Promise<UpdateView> {
    return Promise.resolve(this.view);
  }

  start(): void {}

  stop(): void {}
}
