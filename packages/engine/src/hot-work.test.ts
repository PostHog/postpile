import type { Pr } from '@postpile/core';
import { at, makePr, makeThreadFor, viewer } from '@postpile/core/fixtures';
import { describe, expect, it } from 'vitest';
import { makeHarness, type Harness } from './testing/fakes.ts';
import { reviewRequestedPr } from './testing/prs.ts';
import { readThreadsOnGitHub, topicWithPrs } from './testing/topics.ts';

/** Nineteen days after the fixture PRs' activity (2026-09-01): within the sync's 30 days, past SETTLED_DAYS. */
const LATER = new Date('2026-09-20T12:00:00Z');

/** The inbox moved since the last sync: the next one reads it again. */
function inboxMoved(h: Harness): void {
  h.reader.etag = `${h.reader.etag}+`;
}

function stored(h: Harness, pr: Pr): boolean {
  return h.store.prs.get(pr.key) !== null;
}

describe('work follows the hot slice', () => {
  it('fetches old threads only when unread and aimed at the user, or on their own open PR', async () => {
    const h = makeHarness({ now: () => LATER });
    const settled = makePr({ number: 1, author: 'bob', state: 'MERGED', updatedAt: at(5) });
    const mention = makePr({ number: 2, author: 'bob', updatedAt: at(5) });
    const own = makePr({ number: 3, author: viewer.login, updatedAt: at(5) });
    h.reader.addPr(settled, makeThreadFor(settled, { unread: false, reason: 'subscribed', lastReadAt: at(5) }));
    h.reader.addPr(mention, makeThreadFor(mention, { reason: 'mention' }));
    h.reader.addPr(own, makeThreadFor(own, { unread: false, reason: 'author', lastReadAt: at(5) }));

    await h.engine.sync({ maxAgentCalls: 0 });

    expect(stored(h, settled)).toBe(false);
    expect(stored(h, mention)).toBe(true);
    expect(stored(h, own)).toBe(true);
    expect(h.telemetry.events.filter((event) => event.event === 'work_shed')).toEqual([{ event: 'work_shed', props: { skipped_prs: 1 } }]);
  });

  it('places no PR that went cold in a topic, and updates no dossier of a topic that went cold', async () => {
    const h = makeHarness({ now: () => LATER });
    const settled = reviewRequestedPr(1, { state: 'MERGED', mergedAt: at(5), updatedAt: at(5) });
    topicWithPrs(h, 'depot', [settled]);
    inboxMoved(h);
    await h.engine.sync({ maxAgentCalls: 0 });
    h.store.events.markSeen(h.store.events.listForPr(settled.key).map((event) => event.id), at(6));
    readThreadsOnGitHub(h, [settled]);
    const loose = reviewRequestedPr(2, { state: 'MERGED', mergedAt: at(5), updatedAt: at(5) });
    h.store.prs.upsert(loose, at(6));
    h.store.notifications.upsertMany([makeThreadFor(loose, { unread: false, lastReadAt: at(6) })]);
    // Changed instructions would rewrite every dossier: a topic that went cold is left alone.
    h.store.meta.set('dossier_context_hash:depot', 'older instructions');

    const report = await h.engine.sync({});

    expect(report.agentCallStats.byKind.topic_assignment?.calls ?? 0).toBe(0);
    expect(report.agentCallStats.byKind.dossier_update?.calls ?? 0).toBe(0);
    expect(h.store.memberships.get(loose.key)).toBeNull();
  });

  it('fetches a stored PR whose new thread says review requested, though its old snapshot has no request', async () => {
    const h = makeHarness({ now: () => LATER });
    const before = makePr({ number: 6, author: 'bob', updatedAt: at(0) });
    h.store.prs.upsert(before, at(1));
    // Requested from the viewer after that fetch, more than SETTLED_DAYS ago, still unread.
    const requested = { ...before, reviewerUsers: [viewer.login], updatedAt: '2026-09-10T00:00:00.000Z' };
    h.reader.addPr(requested, makeThreadFor(requested, { reason: 'review_requested', updatedAt: '2026-09-10T00:00:00.000Z' }));

    await h.engine.sync({ maxAgentCalls: 0 });

    expect(h.store.prs.get(before.key)?.reviewerUsers).toEqual([viewer.login]);
  });
});

