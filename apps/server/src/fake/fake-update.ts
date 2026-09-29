import { pickUpdate, type ReleaseInfo, type UpdateView } from '@postpile/core';
import type { UpdateSource } from '../update-check.ts';

/** The sample release. Bump it when the app catches up, or the pill stays hidden in sample data. */
const SAMPLE_RELEASE: ReleaseInfo = {
  tag: 'v0.1.0-alpha.1',
  url: 'https://github.com/PostHog/postpile/releases/tag/v0.1.0-alpha.1',
  publishedAt: '2026-09-29T09:00:00Z',
  notes: '- Title bar reminder when a new version is out',
  draft: false,
};

/**
 * The update check of sample data (POSTPILE_FAKE=1): no network, a sample
 * update so the title bar pill can be looked at. POSTPILE_FAKE_UPDATE=0
 * shows the app as up to date.
 */
export class FakeUpdates implements UpdateSource {
  private readonly view: UpdateView;

  constructor(current: string, showUpdate: boolean) {
    this.view = {
      current,
      latest: showUpdate ? pickUpdate(current, [SAMPLE_RELEASE]) : null,
      checkedAt: new Date().toISOString(),
      error: null,
    };
  }

  status(): UpdateView {
    return this.view;
  }

  start(): void {}

  stop(): void {}
}
