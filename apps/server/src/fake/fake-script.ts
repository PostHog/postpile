// Scripted changes for fake mode (POSTPILE_FAKE_DELIVER, POST /api/fake/advance):
// named steps that change the sample the way a poll or sync brings news from
// GitHub. A step changes the PR snapshot (a comment, a review, a merge, a
// push), adds the event core's `deriveEvents` gives for it (unseen) and flags
// the PR's thread unread "on GitHub". Then the same rules as the engine run:
// a retired topic with news comes back, and while GitHub writes are on the
// quiet reads clear threads only bots touched. Tiles, sections, whose turn
// and the sidebar are worked out again by the core rules on the next read.
import {
  effectiveLoudness,
  judgedReadCheck,
  judgedReadDetail,
  nextTopicStatus,
  quietReadCheck,
  quietReadDetail,
  quietReasonDetail,
  requestGoneReadCheck,
  requestGoneReadDetail,
  touchedReadCheck,
  type FullComment,
  type FullPr,
  type NotificationThread,
  type PrKey,
  type QuietReadInput,
  type ReviewState,
  type UserPrState,
  type Viewer,
} from '@postpile/core';
import { derivedEvent, withComment, withReview } from './fake-pr-changes.ts';
import { pinged, SAMPLE_VIEWER, SampleClock, sampleEvents, sampleKey, samplePr, sampleTile } from './sample-builders.ts';
import type { SampleData } from './sample-data.ts';
import { BOARD_TOPIC } from './sample-pack-board.ts';

const NEEDS_BOARD = 'needs POSTPILE_FAKE_EXTRA=board';

/**
 * The steps, in the order GET /api/fake/steps lists them. The last two need
 * POSTPILE_FAKE_EXTRA=board and refuse without it. A new step needs its name
 * here, a line in STEP_ABOUT and a case in FakeScript.runStep.
 */
export const FAKE_STEPS = [
  'ask-you',
  'approve-set-member',
  'merge-set-member',
  'push',
  'merge-open-pr',
  'revive-archived',
  'bot-on-archived',
  'bot-only-read',
  'bot-and-mention',
  'ready-for-review',
  'assign-archived',
] as const;

export type FakeStepName = (typeof FAKE_STEPS)[number];

/** What each step does, for GET /api/fake/steps. */
const STEP_ABOUT: Record<FakeStepName, string> = {
  'ask-you': 'nell asks you a question on #1982: Egress allowlist needs your reply',
  'approve-set-member': 'lyra approves #1921, a member of the Turbo cache set',
  'merge-set-member': 'lyra merges #1904, a member of the Turbo cache set (the stack layer under #1907)',
  'merge-open-pr': 'sol merges #1870, the devbox PR waiting on your team',
  push: 'sol pushes a new commit to #1870: its head moves, an approve on the old head is refused',
  'revive-archived': 'nell asks you about #1840: Drop the nightly cache warmer comes back from the Archive',
  'bot-on-archived': 'renovate[bot] comments on #1840: with writes on PostPile marks it read quietly and the archived topic stays put; locked, the unread thread brings it back',
  'bot-only-read': 'vercel[bot] comments on the read #1985: with writes on PostPile marks it read quietly ("Handled quietly"); locked, it stays unread',
  'bot-and-mention': 'vercel[bot] and gus comment on #1987, gus asks you: stays unread',
  'ready-for-review': 'sol takes the draft #2010 (Devbox prebuilds) out of draft; your review request is still pending (needs POSTPILE_FAKE_EXTRA=board)',
  'assign-archived': 'rowan opens #2018 and asks you to review it: the retired standing topic Release train comes back (needs POSTPILE_FAKE_EXTRA=board)',
};

export function isFakeStep(word: string): word is FakeStepName {
  return (FAKE_STEPS as readonly string[]).includes(word);
}

/** The steps named in POSTPILE_FAKE_DELIVER, in order; unknown words are returned apart, so the caller can say so. */
export function fakeDeliverFromEnv(value: string | undefined): { steps: FakeStepName[]; unknown: string[] } {
  const words = (value ?? '').split(',').map((word) => word.trim().toLowerCase()).filter((word) => word !== '');
  return { steps: words.filter(isFakeStep), unknown: words.filter((word) => !isFakeStep(word)) };
}

/** What a step needs from FakeEngine. */
export interface FakeStepHost {
  data: SampleData;
  now(): Date;
  viewer(): Viewer;
  userState(prKey: PrKey): UserPrState | null;
  notYours(prKey: PrKey): boolean;
  writesOn(): boolean;
  fetchedAt(prKey: PrKey): string;
  /** The PR was fetched just now, so the quiet reads trust its snapshot. */
  markFetched(prKey: PrKey, at: string): void;
  /** The PR's notification thread as GitHub has it now; null when the sample has none. */
  thread(prKey: PrKey): NotificationThread | null;
  /** New activity on the thread: GitHub flags it unread (FakeWrites.activity). */
  touchThread(thread: NotificationThread, at: string): void;
  /** A quiet mark-read GitHub took: logged with `detail`, mirrored here like the engine's QuietReads. */
  quietRead(thread: NotificationThread, prKey: PrKey, detail: string, at: string): void;
}

export interface FakeStepView {
  name: FakeStepName;
  about: string;
  done: boolean;
}

/** What a step did, in the words of a sync report. */
export interface FakeStepResult {
  ok: boolean;
  message: string;
  prsFetched: number;
  newEvents: number;
}

/** The PRs a step changed and the events it added. */
interface StepChange {
  prKeys: PrKey[];
  eventIds: string[];
}

/**
 * Like the engine's quietDetail: the log detail when the rules may mark the
 * thread read (only bots since the last read, the user acted after it,
 * judged quiet, a review request gone), else null.
 */
function quietDetail(input: QuietReadInput): string | null {
  const bots = quietReadCheck(input);
  if (bots.kind === 'mark') {
    return quietReadDetail(bots.bots);
  }
  const touched = touchedReadCheck(input);
  if (touched.kind === 'mark') {
    return quietReasonDetail(touched.reason);
  }
  const judged = judgedReadCheck(input);
  if (judged.kind === 'mark') {
    return judgedReadDetail(judged.actors);
  }
  const requestGone = requestGoneReadCheck(input);
  return requestGone.kind === 'mark' ? requestGoneReadDetail(requestGone.actors) : null;
}

/**
 * The named steps over one FakeEngine's sample. Each step runs once: a
 * second call is a no-op with a message. `deliver` is POSTPILE_FAKE_DELIVER:
 * each sync takes the next step that has not run yet. `skipFirstSync`: the
 * renderer's start sync brings nothing, so the first "Sync now" delivers
 * the first step.
 */
export class FakeScript {
  private readonly done = new Set<FakeStepName>();
  private readonly queue: FakeStepName[];
  private syncs = 0;
  private applied = 0;
  private nextId = 1;

  constructor(
    private readonly host: FakeStepHost,
    deliver: FakeStepName[] = [],
    private readonly skipFirstSync = false,
  ) {
    this.queue = [...deliver];
  }

  steps(): FakeStepView[] {
    return FAKE_STEPS.map((name) => ({ name, about: STEP_ABOUT[name], done: this.done.has(name) }));
  }

  /** The step the next sync delivers; null when POSTPILE_FAKE_DELIVER has none left. */
  nextDelivery(): FakeStepName | null {
    return this.queue.find((name) => !this.done.has(name)) ?? null;
  }

  /** Grows with every step that changed the sample; counted into the live status' changeCount so the renderer refetches. */
  changes(): number {
    return this.applied;
  }

  // ---------------------------------------------------------------------------
  // Changes to one sample PR, like GitHub shows them on the next fetch
  // ---------------------------------------------------------------------------

  private timestamp(): string {
    return this.host.now().toISOString();
  }

  private newSourceId(kind: string): string {
    const id = `fake-step-${kind}-${this.nextId}`;
    this.nextId += 1;
    return id;
  }

  private findPr(number: number): { index: number; pr: FullPr } | null {
    const key = sampleKey(number);
    const index = this.host.data.prs.findIndex((candidate) => candidate.key === key);
    const pr = this.host.data.prs[index];
    return pr ? { index, pr } : null;
  }

  /**
   * Stores the changed PR as fetched now, flags its thread unread on GitHub
   * (before the event lands, so the thread's first look predates it) and
   * adds the event the sync derives for `sourceId`, unseen.
   */
  private land(index: number, changed: FullPr, sourceId: string, change: StepChange): void {
    const at = this.timestamp();
    const thread = this.host.thread(changed.key);
    if (thread) {
      this.host.touchThread(thread, at);
    }
    const stored = { ...changed, updatedAt: at };
    this.host.data.prs[index] = stored;
    this.host.markFetched(stored.key, at);
    const event = derivedEvent(stored, this.host.viewer(), this.host.userState(stored.key), sourceId, null);
    if (event) {
      this.host.data.events.push(event);
      change.eventIds.push(event.id);
    }
    if (!change.prKeys.includes(stored.key)) {
      change.prKeys.push(stored.key);
    }
  }

  private comment(number: number, author: string, body: string, change: StepChange): void {
    const found = this.findPr(number);
    if (!found) {
      return;
    }
    const id = this.newSourceId('comment');
    const comment: FullComment = { id, author, body, createdAt: this.timestamp(), kind: 'comment', url: `${found.pr.url}#issuecomment-${id}`, path: null, threadId: null };
    this.land(found.index, withComment(found.pr, comment), id, change);
  }

  private review(number: number, author: string, state: ReviewState, change: StepChange): void {
    const found = this.findPr(number);
    if (!found) {
      return;
    }
    const id = this.newSourceId('review');
    const review = { id, author, state, body: '', submittedAt: this.timestamp(), commitOid: found.pr.headOid, url: `${found.pr.url}#pullrequestreview-${id}` };
    this.land(found.index, withReview(found.pr, review), id, change);
  }

  /** Refuses (with the reason) unless the PR is open, so a merge or push never lands on a closed PR. */
  private merge(number: number, actor: string, change: StepChange): string | null {
    const found = this.findPr(number);
    if (!found || found.pr.state !== 'OPEN') {
      return `#${number} is not open in the sample`;
    }
    const at = this.timestamp();
    const id = this.newSourceId('merged');
    const merged: FullPr = {
      ...found.pr,
      state: 'MERGED',
      mergedAt: at,
      mergedBy: actor,
      timeline: [...found.pr.timeline, { id, kind: 'merged', actor, at, subject: null }],
    };
    this.land(found.index, merged, id, change);
    return null;
  }

  private push(number: number, headline: string, change: StepChange): string | null {
    const found = this.findPr(number);
    if (!found || found.pr.state !== 'OPEN') {
      return `#${number} is not open in the sample`;
    }
    const oid = `sha${number}-${this.newSourceId('push')}`;
    const commit = { oid, headline, author: found.pr.author, committer: found.pr.author, committedAt: this.timestamp() };
    this.land(found.index, { ...found.pr, headOid: oid, commits: [...found.pr.commits, commit] }, oid, change);
    return null;
  }

  /** Takes the PR out of draft, like the "ready for review" button; its review requests stay. */
  private markReady(number: number, actor: string, change: StepChange): string | null {
    const found = this.findPr(number);
    if (!found) {
      return NEEDS_BOARD;
    }
    if (!found.pr.isDraft) {
      return `#${number} is not a draft`;
    }
    const at = this.timestamp();
    const id = this.newSourceId('ready');
    const ready: FullPr = {
      ...found.pr,
      isDraft: false,
      timeline: [...found.pr.timeline, { id, kind: 'ready_for_review', actor, at, subject: null }],
    };
    this.land(found.index, ready, id, change);
    return null;
  }

  /**
   * Adds a new PR that asks you for a review to the retired standing topic
   * "Release train". The topic is flipped back to active here: retired is a
   * stored state, nothing derives it from the new PR.
   */
  private assignToArchived(number: number, change: StepChange): string | null {
    const topic = this.host.data.topics.find((candidate) => candidate.id === BOARD_TOPIC.releaseTrain);
    if (!topic) {
      return NEEDS_BOARD;
    }
    if (this.findPr(number)) {
      return `#${number} is in the sample already`;
    }
    const clock = new SampleClock(this.host.now());
    const pr = samplePr(clock, {
      number, title: 'Cut release 2026.41', author: 'rowan', state: 'OPEN',
      size: [4, 4, 2], openedHoursAgo: 0, reviewerUsers: [SAMPLE_VIEWER],
    });
    const [event] = sampleEvents(clock, number, [{ kind: 'review_requested', actor: 'rowan', text: 'requested a review from you', hoursAgo: 0, rule: 'loud' }]);
    const member = pinged(number, 'review_requested');
    this.host.data.prs.push(pr);
    this.host.data.events.push(event!);
    this.host.data.tiles.push(sampleTile(topic.id, 'single', `pr:${pr.key}`, 'Release 2026.41 cut', [member]));
    this.host.data.membership.set(pr.key, topic.id);
    topic.status = 'active';
    topic.retiredAt = null;
    topic.updatedAt = this.timestamp();
    this.host.markFetched(pr.key, this.timestamp());
    change.prKeys.push(pr.key);
    change.eventIds.push(event!.id);
    return null;
  }

  // ---------------------------------------------------------------------------
  // What the engine runs after a poll stored news
  // ---------------------------------------------------------------------------

  private quietInput(prKey: PrKey, thread: NotificationThread): QuietReadInput | null {
    const pr = this.host.data.prs.find((candidate) => candidate.key === prKey);
    if (!pr) {
      return null;
    }
    return {
      thread,
      pr,
      events: this.host.data.events.filter((event) => event.prKey === prKey),
      userState: this.host.userState(prKey),
      viewer: this.host.viewer(),
      notYours: this.host.notYours(prKey),
      prFetchedAt: this.host.fetchedAt(prKey),
    };
  }

  private revive(topicId: string | undefined): void {
    const topic = this.host.data.topics.find((candidate) => candidate.id === topicId);
    const next = topic ? nextTopicStatus(topic, 'revive', this.timestamp()) : null;
    if (topic && next) {
      topic.status = next.status;
      topic.retiredAt = next.retiredAt;
    }
  }

  /**
   * Like the poll: a retired topic comes back when a changed PR's thread is
   * unread on GitHub, unless the quiet reads clear it by rule while writes
   * are on (reviveUnreadTopics), or when the PR got a loud event nobody saw
   * (reviveRetiredTopics). Then the quiet reads run over the changed threads.
   */
  private afterNews(change: StepChange): void {
    const newIds = new Set(change.eventIds);
    for (const prKey of change.prKeys) {
      const thread = this.host.thread(prKey);
      const input = thread ? this.quietInput(prKey, thread) : null;
      const unread = thread?.unread === true && !(this.host.writesOn() && input !== null && quietDetail(input) !== null);
      const loud = this.host.data.events.some((event) => newIds.has(event.id) && event.prKey === prKey && effectiveLoudness(event) === 'loud' && event.seenAt === null);
      if (unread || loud) {
        this.revive(this.host.data.membership.get(prKey));
      }
    }
    if (!this.host.writesOn()) {
      return;
    }
    for (const prKey of change.prKeys) {
      const thread = this.host.thread(prKey);
      const input = thread ? this.quietInput(prKey, thread) : null;
      const detail = input ? quietDetail(input) : null;
      if (thread && detail !== null) {
        this.host.quietRead(thread, prKey, detail, thread.updatedAt);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // The steps
  // ---------------------------------------------------------------------------

  /** Changes the sample for one step; a string is why it could not. */
  private runStep(name: FakeStepName, change: StepChange): string | null {
    switch (name) {
      case 'ask-you':
        this.comment(1982, 'nell', '@you is the Depot cache host the only one the allowlist needs, or does the warm-up job reach a second one?', change);
        return null;
      case 'approve-set-member':
        this.review(1921, 'lyra', 'APPROVED', change);
        return null;
      case 'merge-set-member':
        return this.merge(1904, 'lyra', change);
      case 'merge-open-pr':
        return this.merge(1870, 'sol', change);
      case 'push':
        return this.push(1870, 'Keep the full stack behind --full', change);
      case 'revive-archived':
        this.comment(1840, 'nell', '@you the on-call runbook still points at the warmer job. Can you update it, or should I?', change);
        return null;
      case 'bot-on-archived':
        this.comment(1840, 'renovate[bot]', 'Edited/Blocked: renovate will not update the removed warmer workflow anymore.', change);
        return null;
      case 'bot-only-read':
        this.comment(1985, 'vercel[bot]', 'The latest updates on your project: preview deployment is ready.', change);
        return null;
      case 'bot-and-mention':
        this.comment(1987, 'vercel[bot]', 'The latest updates on your project: preview deployment is ready.', change);
        this.comment(1987, 'gus', '@you do the presets need a docs page before this merges?', change);
        return null;
      case 'ready-for-review':
        return this.markReady(2010, 'sol', change);
      case 'assign-archived':
        return this.assignToArchived(2018, change);
    }
  }

  /** Runs one step now (POST /api/fake/advance, or a delivering sync). A step that ran already changes nothing. */
  run(name: FakeStepName): FakeStepResult {
    if (this.done.has(name)) {
      return { ok: true, message: `${name} ran already; nothing changed`, prsFetched: 0, newEvents: 0 };
    }
    const change: StepChange = { prKeys: [], eventIds: [] };
    const refused = this.runStep(name, change);
    if (refused !== null) {
      return { ok: false, message: `${name} did not run: ${refused}`, prsFetched: 0, newEvents: 0 };
    }
    this.done.add(name);
    this.afterNews(change);
    this.applied += 1;
    return { ok: true, message: `${name}: ${STEP_ABOUT[name]}`, prsFetched: change.prKeys.length, newEvents: change.eventIds.length };
  }

  /** A sync's fetch: delivers the next POSTPILE_FAKE_DELIVER step; null when it brings nothing (none left, or the start sync). */
  deliverOnSync(): FakeStepResult | null {
    this.syncs += 1;
    if (this.skipFirstSync && this.syncs === 1) {
      return null;
    }
    const next = this.nextDelivery();
    return next === null ? null : this.run(next);
  }
}
