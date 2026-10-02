// Bot noise against the real digest: a PR of the viewer's gets the merge
// queue, deploy, CI and review bot traffic of the event corpus, sync after
// sync. Only a person or a real state change makes a dossier call; review
// bot findings ride along with it; status refreshes never reach the prompt
// and never make the dossier look out of date (DESIGN.md "Event roles").
import type { Pr } from '@postpile/core';
import { makeThreadFor } from '@postpile/core/fixtures';
import { CORPUS, CORPUS_SCENARIOS, corpusPrAfter, type CorpusEntry } from '@postpile/core/testing';
import { describe, expect, it } from 'vitest';
import { makeHarness, NOW, type Harness } from './testing/fakes.ts';
import { topicWithPrs } from './testing/topics.ts';

/** A harness whose clock moves one hour per sync, so each snapshot reads as newer. */
function hourlyHarness(): { h: Harness; nextHour: () => string } {
  let now = NOW;
  const h = makeHarness({ now: () => now });
  return {
    h,
    nextHour: () => {
      now = new Date(now.getTime() + 60 * 60_000);
      return now.toISOString();
    },
  };
}

/** The entry with its comment edit made at `time`: a later edit of the same comment is a new event. */
function editedAt(entry: CorpusEntry, time: string): CorpusEntry {
  return { ...entry, adds: entry.adds.map((artifact) => ('comment' in artifact ? { comment: { ...artifact.comment, lastEditedAt: time } } : artifact)) };
}

describe('bot noise and topic memory', () => {
  it('updates the dossier only for people and real changes, with review bots riding along', async () => {
    const { h, nextHour } = hourlyHarness();
    let pr: Pr = CORPUS_SCENARIOS.ownOpen.pr;
    topicWithPrs(h, 'runners', [pr]);
    let etag = 0;
    const land = async (...entries: CorpusEntry[]) => {
      const time = nextHour();
      pr = entries.reduce(corpusPrAfter, pr);
      etag += 1;
      h.reader.addPr(pr, makeThreadFor(pr, { updatedAt: time }));
      h.reader.etag = `etag-${etag}`;
      const report = await h.engine.sync({ agentJobs: ['dossiers'] });
      expect(report.errors).toEqual([]);
    };
    const eventsBehind = async () => (await h.engine.getTopic('runners'))?.dossier?.eventsBehind;
    const lastInput = () => h.agent.dossierInputs.at(-1)?.delta.events.map((event) => `${event.kind} by ${event.actor}`);

    await land();
    expect(h.agent.dossierInputs).toHaveLength(1);

    // Trunk posts its sticky comment and refreshes it: no call, and memory is not out of date.
    await land(CORPUS.trunkSubmitted, CORPUS.trunkTestBadge);
    expect(h.agent.dossierInputs).toHaveLength(1);
    expect(await eventsBehind()).toBe(0);

    // Review bots post findings: still no call, but they wait for the next update.
    await land(CORPUS.coderabbitReview, CORPUS.codexFindings);
    expect(h.agent.dossierInputs).toHaveLength(1);
    expect(await eventsBehind()).toBe(0);

    // CI fails and the preview deploy refreshes its comment: nothing.
    await land(CORPUS.ciFails, CORPUS.deployComment, editedAt(CORPUS.deployEdit, '2026-09-02T16:30:00.000Z'));
    expect(h.agent.dossierInputs).toHaveLength(1);
    expect(await eventsBehind()).toBe(0);

    // A teammate comments: one call, the review bots ride along, no status noise in it.
    await land(CORPUS.teammateComments);
    expect(h.agent.dossierInputs).toHaveLength(2);
    // The bots' events share a timestamp, so their order among themselves is not the point.
    expect(lastInput()?.sort()).toEqual([
      'bot_comment by chatgpt-codex-connector[bot]',
      'bot_comment by coderabbitai[bot]',
      'comment by lyra',
      'review_commented by chatgpt-codex-connector[bot]',
      'review_commented by coderabbitai[bot]',
    ]);
    expect(await eventsBehind()).toBe(0);

    // Trunk merges it: a real change, even by a bot; its "Merged successfully" edit stays out.
    await land(CORPUS.trunkMerges, editedAt(CORPUS.trunkMergedComment, '2026-09-02T18:30:00.000Z'));
    expect(h.agent.dossierInputs).toHaveLength(3);
    expect(lastInput()).toEqual(['merged by trunk-io[bot]']);
    expect(await eventsBehind()).toBe(0);
  });

  it('counts only trigger events as newer while the dossier waits', async () => {
    const { h, nextHour } = hourlyHarness();
    let pr: Pr = CORPUS_SCENARIOS.ownOpen.pr;
    topicWithPrs(h, 'runners', [pr]);
    await h.engine.sync({ agentJobs: ['dossiers'] });

    // Logged by a sync that runs no agent jobs: the dossier stays where it was.
    pr = [CORPUS.trunkSubmitted, CORPUS.coderabbitReview, CORPUS.ciFails, CORPUS.teammateAsksViewer].reduce(corpusPrAfter, pr);
    h.reader.addPr(pr, makeThreadFor(pr, { updatedAt: nextHour() }));
    h.reader.etag = 'etag-2';
    await h.engine.sync({ agentJobs: [] });

    expect(h.agent.dossierInputs).toHaveLength(1);
    expect(await h.engine.getTopic('runners').then((topic) => topic?.dossier?.eventsBehind)).toBe(1);
  });
});
