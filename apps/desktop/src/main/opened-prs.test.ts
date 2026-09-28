import { describe, expect, it } from 'vitest';
import { OPENED_PR_TTL_MS, OpenedPrs, prKeyFromUrl } from './opened-prs.ts';

describe('prKeyFromUrl', () => {
  it('reads PR links, with or without a tab, anchor or query', () => {
    expect(prKeyFromUrl('https://github.com/PostHog/example-infra/pull/4242')).toBe('PostHog/example-infra#4242');
    expect(prKeyFromUrl('https://github.com/PostHog/posthog/pull/12/files')).toBe('PostHog/posthog#12');
    expect(prKeyFromUrl('https://github.com/PostHog/posthog/pull/12#issuecomment-9')).toBe('PostHog/posthog#12');
    expect(prKeyFromUrl('https://github.com/PostHog/posthog/pull/12?w=1')).toBe('PostHog/posthog#12');
  });

  it('ignores other links', () => {
    expect(prKeyFromUrl('https://github.com/PostHog/posthog/issues/12')).toBeNull();
    expect(prKeyFromUrl('https://github.com/PostHog/posthog/pull/12x')).toBeNull();
    expect(prKeyFromUrl('https://example.com/PostHog/posthog/pull/12')).toBeNull();
  });
});

describe('OpenedPrs', () => {
  it('keeps a PR for 30 minutes after its last open', () => {
    const opened = new OpenedPrs();
    opened.remember('https://github.com/PostHog/example-infra/pull/1', 0);
    opened.remember('https://github.com/PostHog/example-infra/pull/2', 1000);
    opened.remember('https://example.com/nothing', 1000);

    expect(opened.active(OPENED_PR_TTL_MS)).toEqual(['PostHog/example-infra#1', 'PostHog/example-infra#2']);
    expect(opened.active(OPENED_PR_TTL_MS + 1)).toEqual(['PostHog/example-infra#2']);

    opened.remember('https://github.com/PostHog/example-infra/pull/2', OPENED_PR_TTL_MS);
    expect(opened.active(OPENED_PR_TTL_MS + 5000)).toEqual(['PostHog/example-infra#2']);
  });
});
