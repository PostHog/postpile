import type { Pr } from '@postpile/core';
import { at, makePr, makeTimelineItem, viewer } from '@postpile/core/fixtures';

/** An open PR where alice asked the viewer for a review: one loud event. */
export function reviewRequestedPr(number: number, overrides: Partial<Pr> & { repo?: string } = {}): Pr {
  return makePr({
    number,
    timeline: [makeTimelineItem({ id: `rr-${number}`, subject: viewer.login, at: at(1) })],
    updatedAt: at(2),
    ...overrides,
  });
}
