// What every kind of actor and comment does across the pipeline, as a
// table: is it automation, how loud is it (pinned as the loudness rules have
// it today), what role it plays for topic memory, whether it reaches a
// dossier prompt on its own or only riding along, whether "Out of date: N
// newer events" counts it, and whether PostPile may mark the thread read by
// itself. The examples come from the corpus (testing/event-corpus.ts).
import { describe, expect, it } from 'vitest';
import { isAutomation } from './bots.ts';
import { isEmptyDelta, selectTopicDelta } from './delta.ts';
import { emptyDossier } from './dossier.ts';
import { isMemoryTrigger, memoryRole, type MemoryRole } from './event-roles.ts';
import { at, makeDossierVersion, makeEvent, makePr } from './fixtures.ts';
import { lookCloserEvent } from './glance-pings.ts';
import type { LoggedEvent } from './memory.ts';
import { quietReadCheck, type QuietSkip } from './quiet-reads.ts';
import { reviewRequestTarget } from './review-request.ts';
import {
  CORPUS,
  CORPUS_AT,
  CORPUS_NOW,
  CORPUS_SCENARIOS,
  CORPUS_VIEWER,
  corpusEvents,
  type CorpusEntryName,
  type CorpusScenarioName,
} from './testing/event-corpus.ts';
import type { EventKind, Loudness, Pr, PrEvent } from './types.ts';

interface Row {
  scenario: CorpusScenarioName;
  entry: CorpusEntryName;
  /** The event of the entry the row is about (a bot review also brings its body as a comment). */
  kind: EventKind;
  /** The events agent or the user changed its loudness. */
  override?: Loudness;
  automation: boolean;
  /** The rule's loudness, as today. */
  loudness: Loudness;
  role: MemoryRole;
  /** Starts a dossier update on its own, and is in that prompt. */
  alone: boolean;
  /** In the dossier prompt when a person's comment starts the update. */
  withTrigger: boolean;
  /** Counted in "Out of date: N newer events". */
  newer: boolean;
  /** PostPile marks the thread read by itself ("mark"), or why not. */
  quietRead: 'mark' | QuietSkip;
}

const ROWS: Row[] = [
  // trunk-io, the merge queue: its comments and their edits are status, the merge or close is real.
  { scenario: 'ownOpen', entry: 'trunkSticky', kind: 'bot_comment', automation: true, loudness: 'quiet', role: 'noise', alone: false, withTrigger: false, newer: false, quietRead: 'mark' },
  { scenario: 'ownOpen', entry: 'trunkSubmitted', kind: 'comment_edited', automation: true, loudness: 'quiet', role: 'noise', alone: false, withTrigger: false, newer: false, quietRead: 'mark' },
  { scenario: 'ownOpen', entry: 'trunkWaiting', kind: 'comment_edited', automation: true, loudness: 'quiet', role: 'noise', alone: false, withTrigger: false, newer: false, quietRead: 'mark' },
  { scenario: 'ownOpen', entry: 'trunkTesting', kind: 'comment_edited', automation: true, loudness: 'quiet', role: 'noise', alone: false, withTrigger: false, newer: false, quietRead: 'mark' },
  { scenario: 'ownOpen', entry: 'trunkStackTesting', kind: 'comment_edited', automation: true, loudness: 'quiet', role: 'noise', alone: false, withTrigger: false, newer: false, quietRead: 'mark' },
  { scenario: 'reviewing', entry: 'trunkMergedComment', kind: 'comment_edited', automation: true, loudness: 'quiet', role: 'noise', alone: false, withTrigger: false, newer: false, quietRead: 'mark' },
  { scenario: 'merged', entry: 'trunkMergedComment', kind: 'comment_edited', automation: true, loudness: 'quiet', role: 'noise', alone: false, withTrigger: false, newer: false, quietRead: 'mark' },
  // Out of the queue on the viewer's own PR is loud (DESIGN "Merge queue"), so it is a trigger; on a PR they review it stays noise.
  { scenario: 'ownOpen', entry: 'trunkRemoved', kind: 'comment_edited', automation: true, loudness: 'loud', role: 'trigger', alone: true, withTrigger: true, newer: true, quietRead: 'unseen_loud' },
  { scenario: 'ownOpen', entry: 'trunkStackFailed', kind: 'bot_comment', automation: true, loudness: 'loud', role: 'trigger', alone: true, withTrigger: true, newer: true, quietRead: 'unseen_loud' },
  { scenario: 'reviewing', entry: 'trunkRemoved', kind: 'comment_edited', automation: true, loudness: 'quiet', role: 'noise', alone: false, withTrigger: false, newer: false, quietRead: 'mark' },
  { scenario: 'reviewing', entry: 'trunkStackFailed', kind: 'bot_comment', automation: true, loudness: 'quiet', role: 'noise', alone: false, withTrigger: false, newer: false, quietRead: 'mark' },
  { scenario: 'ownOpen', entry: 'trunkStackCancelled', kind: 'bot_comment', automation: true, loudness: 'quiet', role: 'noise', alone: false, withTrigger: false, newer: false, quietRead: 'mark' },
  { scenario: 'reviewing', entry: 'trunkTestBadge', kind: 'bot_comment', automation: true, loudness: 'quiet', role: 'noise', alone: false, withTrigger: false, newer: false, quietRead: 'mark' },
  { scenario: 'ownOpen', entry: 'trunkMerges', kind: 'merged', automation: true, loudness: 'quiet', role: 'trigger', alone: true, withTrigger: true, newer: true, quietRead: 'mark' },
  { scenario: 'reviewing', entry: 'trunkCloses', kind: 'closed', automation: true, loudness: 'quiet', role: 'trigger', alone: true, withTrigger: true, newer: true, quietRead: 'mark' },
  { scenario: 'teamRouted', entry: 'trunkMerges', kind: 'merged_without_review', automation: true, loudness: 'quiet', role: 'trigger', alone: true, withTrigger: true, newer: true, quietRead: 'unseen_merge' },
  { scenario: 'ownOpen', entry: 'trunkRequestsReview', kind: 'review_requested', automation: true, loudness: 'quiet', role: 'trigger', alone: true, withTrigger: true, newer: true, quietRead: 'mark' },
  { scenario: 'ownOpen', entry: 'viewerTicksTrunkBox', kind: 'comment_edited', automation: false, loudness: 'quiet', role: 'trigger', alone: true, withTrigger: true, newer: true, quietRead: 'human_activity' },
  { scenario: 'reviewing', entry: 'githubQueueRemoves', kind: 'merge_queue', automation: true, loudness: 'quiet', role: 'noise', alone: false, withTrigger: false, newer: false, quietRead: 'mark' },
  { scenario: 'ownOpen', entry: 'viewerQueues', kind: 'merge_queue', automation: false, loudness: 'quiet', role: 'trigger', alone: true, withTrigger: true, newer: true, quietRead: 'human_activity' },

  // Deploys: status, from a comment, its edit or the timeline.
  { scenario: 'ownOpen', entry: 'deployComment', kind: 'deploy', automation: true, loudness: 'quiet', role: 'noise', alone: false, withTrigger: false, newer: false, quietRead: 'mark' },
  { scenario: 'reviewing', entry: 'deployEdit', kind: 'comment_edited', automation: true, loudness: 'quiet', role: 'noise', alone: false, withTrigger: false, newer: false, quietRead: 'mark' },
  { scenario: 'merged', entry: 'deployTimeline', kind: 'deploy', automation: true, loudness: 'quiet', role: 'noise', alone: false, withTrigger: false, newer: false, quietRead: 'mark' },

  // github-actions: a report rides along, its refresh is noise.
  { scenario: 'ownOpen', entry: 'githubActionsReport', kind: 'bot_comment', automation: true, loudness: 'quiet', role: 'ride_along', alone: false, withTrigger: true, newer: false, quietRead: 'mark' },
  { scenario: 'ownOpen', entry: 'githubActionsReportEdit', kind: 'comment_edited', automation: true, loudness: 'quiet', role: 'noise', alone: false, withTrigger: false, newer: false, quietRead: 'mark' },
  { scenario: 'reviewing', entry: 'githubActionsMigrationWarning', kind: 'bot_comment', automation: true, loudness: 'quiet', role: 'ride_along', alone: false, withTrigger: true, newer: false, quietRead: 'mark' },

  // Review bots: their findings ride along with the next real update; a refreshed summary is noise.
  { scenario: 'ownOpen', entry: 'coderabbitReview', kind: 'review_commented', automation: true, loudness: 'quiet', role: 'ride_along', alone: false, withTrigger: true, newer: false, quietRead: 'mark' },
  { scenario: 'ownOpen', entry: 'coderabbitReview', kind: 'bot_comment', automation: true, loudness: 'quiet', role: 'ride_along', alone: false, withTrigger: true, newer: false, quietRead: 'mark' },
  { scenario: 'reviewing', entry: 'coderabbitSummaryEdit', kind: 'comment_edited', automation: true, loudness: 'quiet', role: 'noise', alone: false, withTrigger: false, newer: false, quietRead: 'mark' },
  { scenario: 'ownOpen', entry: 'codexFindings', kind: 'review_commented', automation: true, loudness: 'quiet', role: 'ride_along', alone: false, withTrigger: true, newer: false, quietRead: 'mark' },
  { scenario: 'reviewing', entry: 'codexNoIssues', kind: 'bot_comment', automation: true, loudness: 'quiet', role: 'ride_along', alone: false, withTrigger: true, newer: false, quietRead: 'mark' },
  { scenario: 'merged', entry: 'codexNoIssues', kind: 'bot_comment', automation: true, loudness: 'quiet', role: 'ride_along', alone: false, withTrigger: true, newer: false, quietRead: 'mark' },
  { scenario: 'teamRouted', entry: 'greptileReview', kind: 'review_commented', automation: true, loudness: 'quiet', role: 'ride_along', alone: false, withTrigger: true, newer: false, quietRead: 'mark' },
  { scenario: 'ownOpen', entry: 'copilotReview', kind: 'review_commented', automation: true, loudness: 'quiet', role: 'ride_along', alone: false, withTrigger: true, newer: false, quietRead: 'mark' },
  { scenario: 'teamRouted', entry: 'securityBotComment', kind: 'bot_comment', automation: true, loudness: 'quiet', role: 'ride_along', alone: false, withTrigger: true, newer: false, quietRead: 'mark' },
  { scenario: 'ownOpen', entry: 'stamphogNotYet', kind: 'bot_comment', automation: true, loudness: 'quiet', role: 'ride_along', alone: false, withTrigger: true, newer: false, quietRead: 'mark' },
  { scenario: 'ownOpen', entry: 'stamphogApproves', kind: 'review_approved', automation: true, loudness: 'quiet', role: 'trigger', alone: true, withTrigger: true, newer: true, quietRead: 'mark' },
  { scenario: 'reviewing', entry: 'veriaComment', kind: 'bot_comment', automation: true, loudness: 'quiet', role: 'ride_along', alone: false, withTrigger: true, newer: false, quietRead: 'mark' },
  // The events agent raised a codex finding to loud: loud is never noise and never waits.
  { scenario: 'ownOpen', entry: 'codexFindings', kind: 'review_commented', override: 'loud', automation: true, loudness: 'quiet', role: 'trigger', alone: true, withTrigger: true, newer: true, quietRead: 'unseen_loud' },

  // Requests, bot-authored PRs and CI.
  { scenario: 'dependabot', entry: 'assignerRequestsTeam', kind: 'review_requested', automation: false, loudness: 'loud', role: 'trigger', alone: true, withTrigger: true, newer: true, quietRead: 'human_activity' },
  { scenario: 'dependabot', entry: 'dependabotRebases', kind: 'force_pushed', automation: true, loudness: 'quiet', role: 'ride_along', alone: false, withTrigger: true, newer: false, quietRead: 'mark' },
  { scenario: 'dependabot', entry: 'dependabotComment', kind: 'bot_comment', automation: true, loudness: 'quiet', role: 'ride_along', alone: false, withTrigger: true, newer: false, quietRead: 'mark' },
  { scenario: 'agentForViewer', entry: 'agentPushes', kind: 'commits_pushed', automation: true, loudness: 'muted', role: 'noise', alone: false, withTrigger: false, newer: false, quietRead: 'mark' },
  { scenario: 'teamRouted', entry: 'agentPushes', kind: 'commits_pushed', automation: true, loudness: 'quiet', role: 'ride_along', alone: false, withTrigger: true, newer: false, quietRead: 'mark' },
  { scenario: 'agentForViewer', entry: 'agentMarksReady', kind: 'ready_for_review', automation: true, loudness: 'quiet', role: 'trigger', alone: true, withTrigger: true, newer: true, quietRead: 'mark' },
  { scenario: 'ownOpen', entry: 'ciFails', kind: 'ci', automation: true, loudness: 'quiet', role: 'noise', alone: false, withTrigger: false, newer: false, quietRead: 'mark' },
  { scenario: 'dependabot', entry: 'ciFails', kind: 'ci', automation: true, loudness: 'quiet', role: 'noise', alone: false, withTrigger: false, newer: false, quietRead: 'mark' },

  // The viewer: always a trigger (as today), never someone else's activity for a quiet read.
  { scenario: 'ownOpen', entry: 'viewerComments', kind: 'comment', automation: false, loudness: 'quiet', role: 'trigger', alone: true, withTrigger: true, newer: true, quietRead: 'human_activity' },
  { scenario: 'ownOpen', entry: 'viewerPushes', kind: 'commits_pushed', automation: false, loudness: 'quiet', role: 'ride_along', alone: false, withTrigger: true, newer: false, quietRead: 'human_activity' },
  { scenario: 'reviewing', entry: 'viewerApproves', kind: 'review_approved', automation: false, loudness: 'quiet', role: 'trigger', alone: true, withTrigger: true, newer: true, quietRead: 'human_activity' },
  { scenario: 'ownOpen', entry: 'viewerMerges', kind: 'merged', automation: false, loudness: 'quiet', role: 'trigger', alone: true, withTrigger: true, newer: true, quietRead: 'human_activity' },

  // People.
  { scenario: 'ownOpen', entry: 'teammateComments', kind: 'comment', automation: false, loudness: 'loud', role: 'trigger', alone: true, withTrigger: true, newer: true, quietRead: 'human_activity' },
  { scenario: 'reviewing', entry: 'teammateComments', kind: 'comment', automation: false, loudness: 'quiet', role: 'trigger', alone: true, withTrigger: true, newer: true, quietRead: 'human_activity' },
  { scenario: 'merged', entry: 'teammateComments', kind: 'comment', automation: false, loudness: 'quiet', role: 'trigger', alone: true, withTrigger: true, newer: true, quietRead: 'human_activity' },
  // The user muted a person's comment: noise like any muted event.
  { scenario: 'reviewing', entry: 'teammateComments', kind: 'comment', override: 'muted', automation: false, loudness: 'quiet', role: 'noise', alone: false, withTrigger: false, newer: false, quietRead: 'human_activity' },
  { scenario: 'ownOpen', entry: 'teammateAsksViewer', kind: 'question_to_user', automation: false, loudness: 'loud', role: 'trigger', alone: true, withTrigger: true, newer: true, quietRead: 'human_activity' },
  { scenario: 'reviewing', entry: 'teammateMentionsViewer', kind: 'mention', automation: false, loudness: 'loud', role: 'trigger', alone: true, withTrigger: true, newer: true, quietRead: 'human_activity' },
  { scenario: 'teamRouted', entry: 'teamMentioned', kind: 'team_mention', automation: false, loudness: 'loud', role: 'trigger', alone: true, withTrigger: true, newer: true, quietRead: 'human_activity' },
  { scenario: 'teamRouted', entry: 'routingTeamMentioned', kind: 'team_mention', automation: false, loudness: 'quiet', role: 'trigger', alone: true, withTrigger: true, newer: true, quietRead: 'human_activity' },
  { scenario: 'reviewing', entry: 'authorRepliesInThread', kind: 'reply_to_user', automation: false, loudness: 'loud', role: 'trigger', alone: true, withTrigger: true, newer: true, quietRead: 'human_activity' },
  { scenario: 'reviewing', entry: 'personEditsComment', kind: 'comment_edited', automation: false, loudness: 'quiet', role: 'trigger', alone: true, withTrigger: true, newer: true, quietRead: 'human_activity' },
  { scenario: 'ownOpen', entry: 'reviewerApproves', kind: 'review_approved', automation: false, loudness: 'loud', role: 'trigger', alone: true, withTrigger: true, newer: true, quietRead: 'human_activity' },
  { scenario: 'ownOpen', entry: 'reviewerRequestsChanges', kind: 'review_changes_requested', automation: false, loudness: 'loud', role: 'trigger', alone: true, withTrigger: true, newer: true, quietRead: 'human_activity' },
  { scenario: 'reviewing', entry: 'reviewerComments', kind: 'review_commented', automation: false, loudness: 'quiet', role: 'trigger', alone: true, withTrigger: true, newer: true, quietRead: 'human_activity' },
  { scenario: 'reviewing', entry: 'authorPushes', kind: 'commits_after_approval', automation: false, loudness: 'quiet', role: 'ride_along', alone: false, withTrigger: true, newer: false, quietRead: 'human_activity' },
  { scenario: 'teamRouted', entry: 'authorPushes', kind: 'commits_pushed', automation: false, loudness: 'quiet', role: 'ride_along', alone: false, withTrigger: true, newer: false, quietRead: 'human_activity' },
  { scenario: 'reviewing', entry: 'authorConvertsToDraft', kind: 'converted_to_draft', automation: false, loudness: 'quiet', role: 'trigger', alone: true, withTrigger: true, newer: true, quietRead: 'human_activity' },
  { scenario: 'reviewing', entry: 'authorRemovesRequest', kind: 'review_request_removed', automation: false, loudness: 'quiet', role: 'trigger', alone: true, withTrigger: true, newer: true, quietRead: 'human_activity' },
  { scenario: 'ownOpen', entry: 'personReopens', kind: 'reopened', automation: false, loudness: 'quiet', role: 'trigger', alone: true, withTrigger: true, newer: true, quietRead: 'human_activity' },
  { scenario: 'reviewing', entry: 'personMerges', kind: 'merged', automation: false, loudness: 'quiet', role: 'trigger', alone: true, withTrigger: true, newer: true, quietRead: 'human_activity' },
];

/** A person's comment right after the corpus event, the trigger it can ride along with. */
function personComment(pr: Pr): PrEvent {
  return makeEvent({ id: `${pr.key}:comment:later`, prKey: pr.key, actor: 'lyra', sourceId: 'later', at: at(40), ruleLoudness: 'quiet' });
}

/** The corpus event as the dossier sees it: everything older already read, the event right after the cursor. */
function dossierReads(pr: Pr, older: PrEvent[], event: PrEvent, trigger: PrEvent | null): string[] | null {
  const logged: LoggedEvent[] = older.map((entry, index) => ({ seq: index + 1, event: entry }));
  const cursorSeq = logged.length;
  logged.push({ seq: cursorSeq + 1, event });
  if (trigger) {
    logged.push({ seq: cursorSeq + 2, event: trigger });
  }
  const dossier = { ...emptyDossier(), timeline: [{ prKey: pr.key, role: 'the change' }] };
  const delta = selectTopicDelta({
    topicId: 'topic-1',
    cursorSeq,
    memberKeys: [pr.key],
    memberSince: new Map([[pr.key, at(0)]]),
    logged,
    joinedHistory: [],
    previous: makeDossierVersion({ dossier, createdAt: at(1), throughSeq: cursorSeq }),
    staleFacts: [],
    staleClaims: [],
    feedback: [],
  });
  return isEmptyDelta(delta) ? null : delta.events.map((entry) => entry.id);
}

function outcomes(row: Row): Omit<Row, 'scenario' | 'entry' | 'kind' | 'override'> {
  const scenario = CORPUS_SCENARIOS[row.scenario];
  const corpus = corpusEvents(scenario.pr, CORPUS[row.entry]);
  const found = corpus.added.find((event) => event.kind === row.kind);
  if (!found) {
    throw new Error(`${row.entry} adds no ${row.kind} on ${row.scenario}: ${corpus.added.map((event) => event.kind).join(', ')}`);
  }
  const event: PrEvent = row.override ? { ...found, override: { loudness: row.override, reason: 'test', by: 'user' } } : found;
  const events = corpus.events.map((candidate) => (candidate.id === event.id ? event : candidate));
  const addedIds = new Set(corpus.added.map((added) => added.id));
  const older = events.filter((candidate) => !addedIds.has(candidate.id));
  const alone = dossierReads(corpus.pr, older, event, null);
  const withTrigger = dossierReads(corpus.pr, older, event, personComment(corpus.pr));
  const quiet = quietReadCheck({
    thread: scenario.thread,
    pr: corpus.pr,
    events,
    userState: null,
    viewer: CORPUS_VIEWER,
    notYours: false,
    prFetchedAt: CORPUS_NOW,
  });
  return {
    automation: isAutomation(event, reviewRequestTarget(event, corpus.pr), CORPUS_VIEWER),
    loudness: event.ruleLoudness,
    role: memoryRole(event),
    alone: alone?.includes(event.id) ?? false,
    withTrigger: withTrigger?.includes(event.id) ?? false,
    newer: isMemoryTrigger(event),
    quietRead: quiet.kind === 'mark' ? 'mark' : quiet.why,
  };
}

function rowName(row: Row): string {
  const override = row.override ? ` (${row.override} by override)` : '';
  return `${CORPUS[row.entry].says}${override}, on ${CORPUS_SCENARIOS[row.scenario].says}: ${row.kind}`;
}

describe('the event corpus through the pipeline', () => {
  for (const row of ROWS) {
    it(rowName(row), () => {
      const { scenario: _scenario, entry: _entry, kind: _kind, override: _override, ...expected } = row;
      expect(outcomes(row)).toEqual(expected);
    });
  }

  it('places every event kind somewhere in the table (look_closer is app-made, below)', () => {
    const covered = new Set<EventKind>([...ROWS.map((row) => row.kind), 'look_closer']);
    const every: Record<EventKind, true> = {
      mention: true,
      team_mention: true,
      review_requested: true,
      review_request_removed: true,
      reply_to_user: true,
      question_to_user: true,
      comment: true,
      review_approved: true,
      review_changes_requested: true,
      review_commented: true,
      commits_pushed: true,
      commits_after_approval: true,
      force_pushed: true,
      merged: true,
      merged_without_review: true,
      closed: true,
      reopened: true,
      ready_for_review: true,
      converted_to_draft: true,
      ci: true,
      deploy: true,
      merge_queue: true,
      bot_comment: true,
      comment_edited: true,
      look_closer: true,
    };
    expect(Object.keys(every).filter((kind) => !covered.has(kind as EventKind))).toEqual([]);
  });

  it('uses every corpus entry at least once', () => {
    const used = new Set(ROWS.map((row) => row.entry));
    expect(Object.keys(CORPUS).filter((name) => !used.has(name as CorpusEntryName))).toEqual([]);
  });
});

describe('memoryRole', () => {
  const pr = makePr({ number: 7 });

  it('lets a push ride along, from a person or a bot, unless it is loud', () => {
    const push = makeEvent({ id: 'acme/app#7:push:p1', kind: 'commits_pushed', actor: 'alice', summary: 'alice pushed 2 commits' });
    expect(memoryRole(push)).toBe('ride_along');
    expect(memoryRole({ ...push, kind: 'force_pushed', actor: 'renovate[bot]', isBot: true })).toBe('ride_along');
    // The author answering the viewer's changes request is loud: aimed at them, so it still starts an update.
    expect(memoryRole({ ...push, ruleLoudness: 'loud', ruleReason: 'answered your changes request' })).toBe('trigger');
    expect(isMemoryTrigger(push)).toBe(false);
  });

  it("makes the app's Look closer a trigger, even after the events agent turned it down", () => {
    const event = lookCloserEvent(pr, 'acme/team-platform', 'rr-1', CORPUS_AT);
    expect(memoryRole(event)).toBe('trigger');
    expect(memoryRole({ ...event, override: { loudness: 'quiet', reason: 'nothing new', by: 'agent' } })).toBe('trigger');
  });

  it('makes a muted Look closer noise: the user called it noise', () => {
    const event = lookCloserEvent(pr, 'acme/team-platform', 'rr-1', CORPUS_AT);
    expect(memoryRole({ ...event, override: { loudness: 'muted', reason: 'not now', by: 'user' } })).toBe('noise');
  });

  it('never makes a loud event noise, not even a merge queue bot edit', () => {
    const edit = makeEvent({ kind: 'comment_edited', actor: 'trunk-io[bot]', isBot: true, ruleLoudness: 'quiet' });
    expect(memoryRole(edit)).toBe('noise');
    expect(memoryRole({ ...edit, override: { loudness: 'loud', reason: 'kicked from the queue', by: 'agent' } })).toBe('trigger');
  });
});
