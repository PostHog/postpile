// Scouts on sample data (DESIGN.md "Scouts"): PRs from outside the GitHub
// inbox that a scout pulled in, with Follow, Dismiss and the seen state.
// Kept apart from the main sample on purpose: scouted PRs are never in a
// topic, never unread and never counted, so the main sample's invariants do
// not have to know about them. Only a followed PR joins the main sample, in
// Unsorted, like the engine's pr_found row with via "followed".
import {
  cleanDismissReason,
  isScoutedActive,
  isScoutedUnseen,
  newTopic,
  prKey,
  scoutedPrView,
  scoutTopicId,
  singleTileId,
  UNDO_WINDOW_MS,
  type ActionResult,
  type FullPr,
  type Glance,
  type PrKey,
  type ScoutedPr,
  type ScoutedPrView,
  type ScoutFollowState,
  type ScoutListItem,
  type Tile,
  type TileScout,
  type Topic,
} from '@postpile/core';
import { UNSORTED_TOPIC_ID } from '@postpile/engine';
import { SampleClock, sampleGlance, samplePr, sampleTile, type SamplePrInput } from './sample-builders.ts';
import type { SampleData } from './sample-data.ts';
import { unsortedTopic } from './fake-tile-feedback.ts';
import type { FakeWrites } from './fake-writes.ts';

/** Undo tokens of a Follow carry this, like the engine's ScoutActions. */
const FOLLOW_TOKEN_PREFIX = 'follow:';

/** One scout of the sample scouts.md, in file order. */
export interface FakeScout {
  id: string;
  name: string;
}

/** The sample's scouts, their PRs and what became of them. */
export interface FakeScoutsSample {
  scouts: FakeScout[];
  /** PRs only a scout holds: not in the main sample. */
  prs: FullPr[];
  glances: Glance[];
  /** Tiles of the scouts' pseudo-topics ("scout:<id>"). */
  tiles: Tile[];
  /** Every scouted row: the ones on the section and the history (dismissed, expired, followed). */
  rows: ScoutedPr[];
  /** The followed PR, already tracked: it sits in Unsorted in the main sample. */
  followed: { pr: FullPr; glance: Glance };
  /** A Follow GitHub did not take: waits in the lock to be sent again. */
  failedFollow: { prKey: PrKey; error: string; hoursAgo: number };
}

interface QueuedFollow {
  token: string;
  prKey: PrKey;
  origin: 'tile' | 'detail';
  batchId: string;
  queuedAt: number;
  /** Writes were locked at the click: it parks after the window even if the lock opens inside it, like a mark-read. */
  lockedAtClick: boolean;
}

const LOOKOUT: FakeScout = { id: 'lookout-structure', name: 'Lookout · structure' };
const BILLING: FakeScout = { id: 'billing-watch', name: 'Billing watch' };
const DOCS: FakeScout = { id: 'docs-drift', name: 'Docs drift' };

/** A sample PR in another repo than samplePr's: the key, ref and link follow the repo. */
function prIn(clock: SampleClock, repo: string, input: SamplePrInput): FullPr {
  const pr = samplePr(clock, input);
  if (pr.ref.repo === repo) {
    return pr;
  }
  return { ...pr, key: prKey({ repo, number: input.number }), ref: { repo, number: input.number }, url: `https://github.com/${repo}/pull/${input.number}` };
}

function scoutedRow(clock: SampleClock, scout: FakeScout, key: PrKey, reason: string, pulledHoursAgo: number): ScoutedPr {
  return {
    prKey: key,
    scoutId: scout.id,
    scoutName: scout.name,
    configVersion: 1,
    reason,
    pulledAt: clock.hoursAgo(pulledHoursAgo),
    seenUpdatedAt: null,
    followedAt: null,
    dismissedAt: null,
    dismissReason: null,
    expiredAt: null,
    expiryReason: null,
  };
}

/** Seen in PostPile through the PR's last update. */
function seen(row: ScoutedPr, pr: FullPr): ScoutedPr {
  return { ...row, seenUpdatedAt: pr.updatedAt };
}

function scoutTile(scout: FakeScout, kind: 'single' | 'stack', id: string, title: string, rows: ScoutedPr[]): Tile {
  const members = rows.map((row) => ({ prKey: row.prKey, provenance: { kind: 'found' as const, via: 'scouted' as const, reason: row.reason } }));
  if (kind === 'stack') {
    return { id, topicId: scoutTopicId(scout.id), kind, title, members, stacks: [{ id, prKeys: members.map((member) => member.prKey) }] };
  }
  return { id, topicId: scoutTopicId(scout.id), kind, title, members, stacks: [] };
}

/**
 * Every state the Scouted section can show, invented names only:
 * "Lookout · structure" with an unseen open PR, a seen one in acme/web, a
 * recently merged one and a stack of two scouted layers; "Billing watch"
 * with one PR whose Follow failed; "Docs drift" with nothing yet. History
 * that never shows: a dismissed PR (with its reason), an expired one and a
 * followed one, now tracked in Unsorted.
 */
export function sampleScouts(now: Date): FakeScoutsSample {
  const clock = new SampleClock(now);
  const ledger = samplePr(clock, {
    number: 2701,
    title: 'Add services/ledger as its own top-level service',
    author: 'dmitri',
    state: 'OPEN',
    size: [640, 12, 14],
    openedHoursAgo: 6,
    reviewerUsers: ['quinn'],
    body: 'Moves the ledger out of the monolith into `services/ledger`, with its own package and README.',
    files: [
      ['services/ledger/src/index.ts', 210, 0],
      ['services/ledger/package.json', 32, 0],
      ['services/ledger/README.md', 44, 0],
    ],
  });
  const uiKit = prIn(clock, 'acme/web', {
    number: 2702,
    title: 'Move the shared UI kit into packages/ui',
    author: 'carol',
    state: 'OPEN',
    size: [1200, 1180, 86],
    openedHoursAgo: 30,
    body: 'Starts a `packages/` folder so the web app and the docs site share one UI kit.',
  });
  const codegen = samplePr(clock, {
    number: 2703,
    title: 'Add tools/codegen for the API clients',
    author: 'erin',
    state: 'MERGED',
    size: [380, 0, 9],
    openedHoursAgo: 50,
    mergedHoursAgo: 7,
    reviews: [['quinn', 'APPROVED', '', undefined, 9]],
  });
  const host = samplePr(clock, {
    number: 2704,
    title: 'Plugin runtime 1/2: add plugins/ with the worker host',
    author: 'frank',
    state: 'OPEN',
    size: [520, 4, 11],
    openedHoursAgo: 20,
    headRef: 'frank/plugins-host',
  });
  const workers = samplePr(clock, {
    number: 2705,
    title: 'Plugin runtime 2/2: move the workers into plugins/',
    author: 'frank',
    state: 'OPEN',
    size: [310, 290, 23],
    openedHoursAgo: 19,
    baseRef: 'frank/plugins-host',
    headRef: 'frank/plugins-workers',
  });
  const rounding = samplePr(clock, {
    number: 2711,
    title: 'Round usage tiers per invoice line, not per invoice',
    author: 'grace',
    state: 'OPEN',
    size: [48, 21, 3],
    openedHoursAgo: 26,
    reviewerTeams: ['acme/team-billing'],
    files: [
      ['modules/billing/pricing/tiers.ts', 30, 14],
      ['modules/billing/pricing/tiers.test.ts', 18, 7],
    ],
  });
  const scripts = samplePr(clock, {
    number: 2723,
    title: 'Add scripts/ for local release checks',
    author: 'hana',
    state: 'OPEN',
    size: [96, 0, 4],
    openedHoursAgo: 40,
  });

  const ledgerRow = scoutedRow(clock, LOOKOUT, ledger.key, 'adds services/, a new top-level folder for the ledger service', 5);
  const uiKitRow = seen(scoutedRow(clock, LOOKOUT, uiKit.key, 'creates packages/ at the top level and moves the UI kit there', 28), uiKit);
  const codegenRow = seen(scoutedRow(clock, LOOKOUT, codegen.key, 'adds tools/ at the top level', 48), codegen);
  const hostRow = scoutedRow(clock, LOOKOUT, host.key, 'adds plugins/, a new top-level folder for the plugin runtime', 18);
  const workersRow = scoutedRow(clock, LOOKOUT, workers.key, 'moves the workers into the new plugins/ folder', 18);
  const roundingRow = seen(scoutedRow(clock, BILLING, rounding.key, 'changes how modules/billing/ rounds usage on invoices', 24), rounding);
  const dismissedRow: ScoutedPr = {
    ...scoutedRow(clock, LOOKOUT, 'acme/app#2721', 'adds a top-level fixtures/ folder', 70),
    dismissedAt: clock.hoursAgo(60),
    dismissReason: 'Known, came up in the planning doc',
  };
  const expiredRow: ScoutedPr = {
    ...scoutedRow(clock, BILLING, 'acme/app#2722', 'touches the invoice PDF template in modules/billing/', 120),
    expiredAt: clock.hoursAgo(40),
    expiryReason: 'inactive',
  };
  const followedRow: ScoutedPr = { ...scoutedRow(clock, LOOKOUT, scripts.key, 'adds scripts/ at the top level', 38), followedAt: clock.hoursAgo(20) };

  const glance = (number: number, key: PrKey, forYou: string, does: string) => ({
    ...sampleGlance(clock, number, { verdict: 'LOOKS_SAFE', forYou, does, risk: 'Low: new files only.', othersSaid: 'Nobody has reviewed it yet.' }),
    prKey: key,
  });
  return {
    scouts: [LOOKOUT, BILLING, DOCS],
    prs: [ledger, uiKit, codegen, host, workers, rounding],
    glances: [
      glance(2701, ledger.key, 'Not asked of you: a new top-level service, worth knowing it exists.', 'Moves the ledger into its own service under services/ledger.'),
      glance(2702, uiKit.key, 'Not asked of you: acme/web gets a packages/ folder.', 'Moves the UI kit into packages/ui and points both apps at it.'),
      glance(2711, rounding.key, 'Not asked of you: invoices may change by a cent per line.', 'Rounds each usage tier per invoice line instead of once per invoice.'),
    ],
    tiles: [
      scoutTile(LOOKOUT, 'single', singleTileId(ledger.key), ledger.title, [ledgerRow]),
      scoutTile(LOOKOUT, 'single', singleTileId(uiKit.key), uiKit.title, [uiKitRow]),
      scoutTile(LOOKOUT, 'single', singleTileId(codegen.key), codegen.title, [codegenRow]),
      scoutTile(LOOKOUT, 'stack', `stack:${host.key}`, 'Plugin runtime', [hostRow, workersRow]),
      scoutTile(BILLING, 'single', singleTileId(rounding.key), rounding.title, [roundingRow]),
    ],
    rows: [ledgerRow, uiKitRow, codegenRow, hostRow, workersRow, roundingRow, dismissedRow, expiredRow, followedRow],
    followed: { pr: scripts, glance: glance(2723, scripts.key, 'You followed it: release checks you may run yourself.', 'Adds scripts/ with the local release checks.') },
    failedFollow: { prKey: rounding.key, error: 'GitHub POST graphql (updateSubscription) failed with 502: Server Error', hoursAgo: 2 },
  };
}

/**
 * The Scouted section of FakeEngine: lists, tiles and the PR pane's
 * `scouted` field over `sampleScouts`, Follow through the fake's undo
 * window and writes lock (FakeWrites), Dismiss and seen in memory.
 */
export class FakeScouts {
  private readonly rows: Map<PrKey, ScoutedPr>;
  private readonly queue: QueuedFollow[] = [];
  /** The failed Follow is parked on the first read of the section, so the lock's other tests start empty. */
  private seeded = false;
  private nextId = 1;

  constructor(
    private readonly sample: FakeScoutsSample,
    private readonly data: SampleData,
    private readonly writes: FakeWrites,
    private readonly now: () => Date,
  ) {
    this.rows = new Map(sample.rows.map((row) => [row.prKey, { ...row }]));
    const followed = sample.followed;
    this.track(followed.pr, followed.glance, [this.followedMember(followed.pr.key)]);
  }

  private timestamp(): string {
    return this.now().toISOString();
  }

  private followedMember(key: PrKey): Tile['members'][number] {
    const row = this.rows.get(key);
    return { prKey: key, provenance: { kind: 'found', via: 'followed', reason: `you followed it from scout "${row?.scoutName ?? 'a scout'}"` } };
  }

  /** Puts a PR into the main sample as tracked, in Unsorted, like the engine's pr_found row "followed". */
  private track(pr: FullPr, glance: Glance | undefined, members: Tile['members'], stacks: Tile['stacks'] = []): void {
    if (!this.data.topics.some((topic) => topic.id === UNSORTED_TOPIC_ID)) {
      this.data.topics.push(unsortedTopic(this.timestamp()));
    }
    for (const member of members) {
      const memberPr = member.prKey === pr.key ? pr : this.pr(member.prKey);
      if (memberPr && !this.data.prs.some((candidate) => candidate.key === memberPr.key)) {
        this.data.prs.push(memberPr);
      }
    }
    if (glance && !this.data.glances.some((candidate) => candidate.prKey === glance.prKey)) {
      this.data.glances.push(glance);
    }
    const kind = stacks.length > 0 ? 'stack' : 'single';
    const id = kind === 'stack' ? (stacks[0]?.id ?? singleTileId(pr.key)) : singleTileId(pr.key);
    this.data.tiles.push(kind === 'stack' ? { id, topicId: UNSORTED_TOPIC_ID, kind, title: pr.title, members, stacks } : sampleTile(UNSORTED_TOPIC_ID, 'single', id, pr.title, members));
  }

  /** Parks the sample's failed Follow once: only the Scouted section's reads ask for it. */
  private seedOnce(): void {
    if (this.seeded) {
      return;
    }
    this.seeded = true;
    const { prKey: key, error, hoursAgo } = this.sample.failedFollow;
    const pr = this.pr(key);
    const createdAt = new Date(this.now().getTime() - hoursAgo * 3_600_000).toISOString();
    this.writes.parkFollow({ prKey: key, title: pr?.title ?? key, origin: 'tile', batchId: 'fake-follow-seed' }, createdAt, error);
  }

  /** The PRs only a scout holds. */
  prKeys(): PrKey[] {
    return this.sample.prs.map((pr) => pr.key);
  }

  /** A PR only a scout holds; undefined for every other PR (a followed one is in the main sample). */
  pr(key: PrKey): FullPr | undefined {
    return this.sample.prs.find((pr) => pr.key === key);
  }

  glance(key: PrKey): Glance | undefined {
    return this.sample.glances.find((glance) => glance.prKey === key);
  }

  /** A scout's tiles on the section: those with a scouted PR still active. */
  tilesOf(scoutId: string): Tile[] {
    const topicId = scoutTopicId(scoutId);
    return this.sample.tiles.filter((tile) => tile.topicId === topicId && tile.members.some((member) => this.isActive(member.prKey)));
  }

  private isActive(key: PrKey): boolean {
    const row = this.rows.get(key);
    return row !== undefined && isScoutedActive(row);
  }

  private isUnseen(row: ScoutedPr): boolean {
    return isScoutedUnseen(row, this.pr(row.prKey)?.updatedAt ?? row.pulledAt);
  }

  /** A PR only a scout holds, on the section and unseen: what an agent's mark_read would mark seen. */
  isUnseenKey(key: PrKey): boolean {
    const row = this.rows.get(key);
    return row !== undefined && this.isUnseen(row);
  }

  /** Sends Follows whose undo window ran out: to "GitHub" while writes are on, else into the lock. Called before reads, like FakeWrites.settle. */
  settle(): void {
    const due = this.now().getTime() - UNDO_WINDOW_MS;
    for (const follow of this.queue.filter((candidate) => candidate.queuedAt <= due)) {
      this.queue.splice(this.queue.indexOf(follow), 1);
      if (follow.lockedAtClick || !this.writes.isEnabled()) {
        const title = this.pr(follow.prKey)?.title ?? follow.prKey;
        this.writes.parkFollow({ prKey: follow.prKey, title, origin: follow.origin, batchId: follow.batchId }, new Date(follow.queuedAt).toISOString(), null);
        continue;
      }
      this.writes.record({ action: 'follow', origin: 'queue', outcome: 'github', prKey: follow.prKey, batch: follow.batchId, detail: 'sample data: nothing left the process' });
      this.followed(follow.prKey);
    }
  }

  /** Where a Follow of this PR stands while it has not reached GitHub; null when none waits. */
  followState(key: PrKey): ScoutFollowState | null {
    this.seedOnce();
    if (this.queue.some((follow) => follow.prKey === key)) {
      return 'queued';
    }
    return this.writes.followState(key);
  }

  /** The first scouted PR's scout and reason, unseen when any of them is: like the engine's ReadModels.tileScout. */
  tileScout(tile: Tile): TileScout | undefined {
    const rows = tile.members.flatMap((member) => this.rows.get(member.prKey) ?? []);
    const first = rows[0];
    if (!first) {
      return undefined;
    }
    const follows = rows.map((row) => this.followState(row.prKey)).filter((state) => state !== null);
    return {
      scoutId: first.scoutId,
      scoutName: first.scoutName,
      reason: first.reason,
      unseen: rows.some((row) => this.isUnseen(row)),
      prKeys: rows.map((row) => row.prKey),
      follow: follows[0] ?? null,
    };
  }

  /** One row per scout in file order; the count is unseen tiles, never unread. */
  list(): ScoutListItem[] {
    this.seedOnce();
    return this.sample.scouts.map((scout) => {
      const tiles = this.tilesOf(scout.id);
      const unseen = tiles.filter((tile) => this.tileScout(tile)?.unseen === true).length;
      return { id: scout.id, topicId: scoutTopicId(scout.id), name: scout.name, tiles: tiles.length, unseen };
    });
  }

  /** The pseudo-topic of a scout, or null for an unknown one. */
  topic(scoutId: string): Topic | null {
    const scout = this.sample.scouts.find((candidate) => candidate.id === scoutId);
    if (!scout) {
      return null;
    }
    const pulled = this.sample.rows.filter((row) => row.scoutId === scoutId).map((row) => row.pulledAt);
    const at = pulled.sort()[0] ?? this.timestamp();
    return newTopic(scoutTopicId(scoutId), scout.name, at);
  }

  /** The scout topic that shows this PR now, null when it is not on the section. */
  topicIdOf(key: PrKey): string | null {
    return this.sample.tiles.find((tile) => tile.members.some((member) => member.prKey === key) && this.isActive(key))?.topicId ?? null;
  }

  tileIdsOf(key: PrKey): string[] {
    return this.sample.tiles.filter((tile) => tile.members.some((member) => member.prKey === key)).map((tile) => tile.id);
  }

  /** What the PR pane says about a PR a scout pulled in; undefined for every other PR. */
  view(key: PrKey, prUpdatedAt: string, tracked: boolean): ScoutedPrView | undefined {
    const row = this.rows.get(key);
    return row ? scoutedPrView(row, prUpdatedAt, { tracked, inInbox: tracked && row.followedAt === null, onSection: this.topicIdOf(key) !== null }, this.followState(key)) : undefined;
  }

  /** Follow: GitHub after the undo window, or the lock's pending writes while locked. Same checks and words as the engine. */
  follow(key: PrKey, origin: 'tile' | 'detail'): ActionResult {
    const row = this.rows.get(key);
    if (!row) {
      return { ok: false, message: 'Not a PR a scout pulled in', undoToken: null };
    }
    if (row.followedAt !== null) {
      return { ok: true, message: 'Already followed', undoToken: null };
    }
    if (this.followState(key) !== null) {
      return { ok: true, message: 'Follow already on its way', undoToken: null };
    }
    const id = this.nextId;
    this.nextId += 1;
    const follow: QueuedFollow = {
      token: `${FOLLOW_TOKEN_PREFIX}fake-${id}`,
      prKey: key,
      origin,
      batchId: `fake-follow-${id}`,
      queuedAt: this.now().getTime(),
      lockedAtClick: !this.writes.isEnabled(),
    };
    this.queue.push(follow);
    const detail = follow.lockedAtClick ? 'turns pending when the window ends: GitHub writes are locked' : '';
    this.writes.record({ action: 'follow', origin, outcome: 'queued', prKey: key, batch: follow.batchId, detail });
    const message = follow.lockedAtClick ? 'Following is pending until you unlock GitHub writes' : 'Following on GitHub in a few seconds';
    return { ok: true, message, undoToken: follow.token };
  }

  isUndo(token: string | null): boolean {
    return token !== null && token.startsWith(FOLLOW_TOKEN_PREFIX);
  }

  /** Takes a Follow back inside its window; nothing reached GitHub. */
  undo(token: string): ActionResult {
    this.settle();
    const index = this.queue.findIndex((follow) => follow.token === token);
    const follow = this.queue[index];
    if (!follow) {
      return { ok: false, message: 'undo window closed', undoToken: null };
    }
    this.queue.splice(index, 1);
    this.writes.record({ action: 'undo_follow', origin: follow.origin, outcome: 'local', prKey: follow.prKey, batch: follow.batchId, detail: 'undone in the window, nothing sent' });
    return { ok: true, message: 'Follow undone', undoToken: null };
  }

  /** Off the Scouted section for good; the reason is kept for tuning the scout. Local only. */
  dismiss(key: PrKey, reason: string | null): ActionResult {
    const row = this.rows.get(key);
    if (!row || !isScoutedActive(row)) {
      return { ok: false, message: 'Not on the Scouted section', undoToken: null };
    }
    row.dismissedAt = this.timestamp();
    row.dismissReason = cleanDismissReason(reason);
    return { ok: true, message: 'Dismissed', undoToken: null };
  }

  /** Seen in PostPile through the PR's current update; never a GitHub read. */
  markSeen(key: PrKey): ActionResult {
    const row = this.rows.get(key);
    const pr = this.pr(key) ?? this.data.prs.find((candidate) => candidate.key === key);
    if (!row || !pr) {
      return { ok: false, message: 'Not a PR a scout pulled in', undoToken: null };
    }
    row.seenUpdatedAt = pr.updatedAt;
    return { ok: true, message: 'Seen', undoToken: null };
  }

  /**
   * A Follow reached GitHub: the PR counts as followed and leaves the
   * section. Its tile moves to Unsorted, the followed PR tracked, the other
   * layers of a stack pulled in with it (DESIGN.md "Scouts" › Stacks).
   */
  followed(key: PrKey): void {
    const row = this.rows.get(key);
    if (!row || row.followedAt !== null) {
      return;
    }
    row.followedAt = this.timestamp();
    const tile = this.sample.tiles.find((candidate) => candidate.members.some((member) => member.prKey === key));
    const pr = this.pr(key);
    if (!tile || !pr) {
      return;
    }
    this.sample.tiles.splice(this.sample.tiles.indexOf(tile), 1);
    const members = tile.members.map((member): Tile['members'][number] =>
      member.prKey === key ? this.followedMember(key) : { prKey: member.prKey, provenance: { kind: 'pulled_in', reason: 'a layer of the stack you followed' } },
    );
    this.track(pr, this.glance(key), members, tile.stacks);
    for (const member of tile.members) {
      const index = this.sample.prs.findIndex((candidate) => candidate.key === member.prKey);
      if (index >= 0) {
        this.sample.prs.splice(index, 1);
      }
    }
  }
}
