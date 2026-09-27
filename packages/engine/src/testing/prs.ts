import type { Pr } from '@code-manager/core';
import { at, makePr, makeTimelineItem, viewer } from '@code-manager/core/fixtures';

/** An open PR where alice asked the viewer for a review: one loud event. */
export function reviewRequestedPr(number: number, overrides: Partial<Pr> = {}): Pr {
  return makePr({
    number,
    timeline: [makeTimelineItem({ id: `rr-${number}`, subject: viewer.login, at: at(1) })],
    updatedAt: at(2),
    ...overrides,
  });
}
