import { isMachineComment } from './bots.ts';
import { parsePrKey } from './keys.ts';
import type { IsoTime, Pr, PrKey, PrState, ReviewState } from './types.ts';

// Agent notes on PRs (DESIGN.md "Agent notes on PRs"): an outside agent
// leaves a short, visible note that GitHub cannot show, like "covered by the
// review on the parent PR" or "a session is reviewing this right now". Notes
// are advisory: they never change whose move, unread, done, sections or
// counts. Each note is anchored to a fingerprint of the PR's state and goes
// stale on its own once the PR moves on. Everything here is pure; the
// engine and the sample-data engine store the notes.

/** covered: handled by another PR's review; no_action: nothing to do; in_progress: an agent is on it right now (a lease). */
export type PrNoteKind = 'covered' | 'no_action' | 'in_progress';

/** Two slots per PR: one durable note (covered, no_action) and one lease (in_progress). A lease never erases a durable note. */
export type PrNoteSlot = 'durable' | 'lease';

export const PR_NOTE_KINDS: PrNoteKind[] = ['covered', 'no_action', 'in_progress'];
/** The note's text, at most this long. */
export const PR_NOTE_MAX = 280;
/** The agent's own label ("ph3 session"), at most this long. */
export const PR_NOTE_BY_MAX = 60;
export const PR_NOTE_LEASE_DEFAULT_MINUTES = 120;
export const PR_NOTE_LEASE_MIN_MINUTES = 5;
export const PR_NOTE_LEASE_MAX_MINUTES = 480;
/** Live notes on open PRs, per MCP client and in total. */
export const PR_NOTES_PER_CLIENT = 100;
export const PR_NOTES_TOTAL = 300;

export function noteSlot(kind: PrNoteKind): PrNoteSlot {
  return kind === 'in_progress' ? 'lease' : 'durable';
}

// ---------------------------------------------------------------------------
// The anchor: a fingerprint of the PR state a note was written against
// ---------------------------------------------------------------------------

/** A pending review request and who made it (the latest review_requested timeline item for it). */
export interface AnchorRequest {
  /** A login or "org/team-slug". */
  subject: string;
  /** Who requested it, bots included; null when the timeline does not say. */
  by: string | null;
  /** The timeline item's id: a re-request is a new id. */
  requestId: string | null;
}

/** The latest review of one reviewer, bots included. */
export interface AnchorReview {
  reviewer: string;
  id: string;
  state: ReviewState;
}

export interface NoteAnchor {
  headOid: string;
  state: PrState;
  isDraft: boolean;
  /** Sorted by subject. */
  requests: AnchorRequest[];
  /** Sorted by reviewer. */
  reviews: AnchorReview[];
  /** Issue comments and review-thread comments by people; bot comments and every edit are left out. */
  humanComments: number;
  /** The newest of them. */
  newestComment: { id: string; author: string } | null;
}

function lower(text: string): string {
  return text.toLowerCase();
}

function anchorRequests(pr: Pick<Pr, 'reviewerUsers' | 'reviewerTeams' | 'timeline'>): AnchorRequest[] {
  const subjects = [...pr.reviewerUsers, ...pr.reviewerTeams];
  return subjects
    .map((subject) => {
      const asks = pr.timeline.filter((item) => item.kind === 'review_requested' && item.subject !== null && lower(item.subject) === lower(subject));
      const last = asks.toSorted((a, b) => a.at.localeCompare(b.at)).at(-1) ?? null;
      return { subject, by: last?.actor ?? null, requestId: last?.id ?? null };
    })
    .toSorted((a, b) => a.subject.localeCompare(b.subject));
}

function anchorReviews(pr: Pick<Pr, 'reviews'>): AnchorReview[] {
  const latest = new Map<string, AnchorReview>();
  // A PENDING review is the viewer's unsent draft: nobody else sees it.
  const sent = pr.reviews.filter((review) => review.state !== 'PENDING').toSorted((a, b) => a.submittedAt.localeCompare(b.submittedAt));
  for (const review of sent) {
    latest.set(review.author, { reviewer: review.author, id: review.id, state: review.state });
  }
  return [...latest.values()].toSorted((a, b) => a.reviewer.localeCompare(b.reviewer));
}

/**
 * The fingerprint of a PR's state a note is anchored to: head, state,
 * draft, pending review requests with who asked, the latest review per
 * reviewer (dismissed included) and the people's comments. Bot comments
 * and edits stay out: CodeRabbit summaries and Trunk badges would stale
 * every note within minutes.
 */
export function noteAnchor(pr: Pick<Pr, 'headOid' | 'state' | 'isDraft' | 'reviewerUsers' | 'reviewerTeams' | 'timeline' | 'reviews' | 'comments'>): NoteAnchor {
  const human = pr.comments.filter((comment) => comment.kind !== 'review' && !isMachineComment(comment));
  const newest = human.toSorted((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1) ?? null;
  return {
    headOid: pr.headOid,
    state: pr.state,
    isDraft: pr.isDraft,
    requests: anchorRequests(pr),
    reviews: anchorReviews(pr),
    humanComments: human.length,
    newestComment: newest ? { id: newest.id, author: newest.author } : null,
  };
}

function stateChange(after: PrState): string {
  if (after === 'MERGED') {
    return 'merged';
  }
  return after === 'CLOSED' ? 'closed' : 'reopened';
}

function requestChanges(before: AnchorRequest[], after: AnchorRequest[]): string[] {
  const reasons: string[] = [];
  const by = (request: AnchorRequest) => (request.by ? ` by ${request.by}` : '');
  for (const request of after) {
    const old = before.find((candidate) => lower(candidate.subject) === lower(request.subject));
    if (!old) {
      reasons.push(`review requested from ${request.subject}${by(request)}`);
    } else if (old.requestId !== request.requestId) {
      reasons.push(`review re-requested from ${request.subject}${by(request)}`);
    }
  }
  for (const request of before) {
    if (!after.some((candidate) => lower(candidate.subject) === lower(request.subject))) {
      reasons.push(`review request for ${request.subject} removed`);
    }
  }
  return reasons;
}

function reviewChanges(before: AnchorReview[], after: AnchorReview[]): string[] {
  const reasons: string[] = [];
  for (const review of after) {
    const old = before.find((candidate) => candidate.reviewer === review.reviewer);
    if (!old || old.id !== review.id) {
      reasons.push(`new review from ${review.reviewer}`);
    } else if (old.state !== review.state) {
      reasons.push(review.state === 'DISMISSED' ? `review from ${review.reviewer} dismissed` : `review from ${review.reviewer} now ${review.state.toLowerCase()}`);
    }
  }
  return reasons;
}

/**
 * Why a note anchored to `before` no longer fits the PR at `after`, one
 * reason per change; empty when nothing relevant changed. A new head says
 * "head changed", never a number of pushes: a SHA change proves only that.
 */
export function anchorChanges(before: NoteAnchor, after: NoteAnchor): string[] {
  const reasons: string[] = [];
  if (before.state !== after.state) {
    reasons.push(stateChange(after.state));
  }
  if (before.isDraft !== after.isDraft) {
    reasons.push(after.isDraft ? 'back to draft' : 'ready for review');
  }
  if (before.headOid !== after.headOid) {
    reasons.push('head changed');
  }
  reasons.push(...reviewChanges(before.reviews, after.reviews));
  reasons.push(...requestChanges(before.requests, after.requests));
  if (after.newestComment && after.newestComment.id !== before.newestComment?.id) {
    reasons.push(`new comment by ${after.newestComment.author}`);
  } else if (before.humanComments !== after.humanComments) {
    reasons.push('comments changed');
  }
  return reasons;
}

/** "head 3f2a1c9, open, 2 reviews, 1 pending request, 4 comments": what the note was anchored to, for the agent's answer. */
export function anchorSummary(anchor: NoteAnchor): string {
  const state = anchor.state === 'OPEN' ? (anchor.isDraft ? 'draft' : 'open') : anchor.state.toLowerCase();
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
  return `head ${anchor.headOid.slice(0, 7)}, ${state}, ${plural(anchor.reviews.length, 'review')}, ${plural(anchor.requests.length, 'pending request')}, ${plural(anchor.humanComments, 'comment')}`;
}

/**
 * A short, stable hash of a text (cyrb53). Not for secrets: it tells two
 * states apart for the observation token and the idempotency key, and
 * keeps core free of node:crypto (the renderer type-checks this barrel).
 */
function shortHash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const value = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return value.toString(36).padStart(11, '0');
}

/**
 * The observation token pr_context prints for a PR: a hash of its anchor.
 * note_pr must pass it back; when the PR moved in between, the note is
 * refused instead of being anchored to a state the agent never saw.
 */
export function observationToken(anchor: NoteAnchor): string {
  return shortHash(JSON.stringify(anchor));
}

// ---------------------------------------------------------------------------
// Stored notes and how they read now
// ---------------------------------------------------------------------------

export interface PrNote {
  /** Insert order: decides which note is newest, never created_at. */
  seq: number;
  id: string;
  prKey: PrKey;
  slot: PrNoteSlot;
  kind: PrNoteKind;
  /** The agent's own label, e.g. "ph3 session". Untrusted text. */
  by: string;
  /** The MCP client's handshake name, e.g. "claude-code". Self-reported, not a credential. */
  client: string;
  note: string;
  coveredByPrKey: PrKey | null;
  anchor: NoteAnchor;
  /** covered: the covering PR's anchor when the note was written. */
  coverAnchor: NoteAnchor | null;
  createdAt: IsoTime;
  /** Leases only. */
  expiresAt: IsoTime | null;
  clearedAt: IsoTime | null;
  /** The client that cleared it, or "user". */
  clearedBy: string | null;
  /** The note that replaced it in its slot. */
  supersededBy: string | null;
  /** A hash of the request that wrote it; released once the note is no longer current. */
  idempotencyKey: string | null;
}

/** A note not cleared and not replaced: the one in its slot, stale or expired or not. */
export function isCurrentNote(note: Pick<PrNote, 'clearedAt' | 'supersededBy'>): boolean {
  return note.clearedAt === null && note.supersededBy === null;
}

/** A lease ends at expires_at exactly. */
export function isNoteExpired(note: Pick<PrNote, 'expiresAt'>, now: IsoTime): boolean {
  return note.expiresAt !== null && Date.parse(now) >= Date.parse(note.expiresAt);
}

/** live: holds; stale: the PR (or the covering PR) moved on, see staleReasons; expired: a lease that ran out. */
export type PrNoteStatus = 'live' | 'stale' | 'expired';

export interface PrNoteView {
  id: string;
  kind: PrNoteKind;
  by: string;
  client: string;
  note: string;
  coveredBy: PrKey | null;
  /** When PostPile last fetched the covering PR; null when it is not stored. */
  coverFetchedAt: IsoTime | null;
  createdAt: IsoTime;
  expiresAt: IsoTime | null;
  status: PrNoteStatus;
  /** Why it is stale, one reason per change: "head changed", "new comment by alice". */
  staleReasons: string[];
}

/** One PR's notes as the PR pane and the MCP answers show them. */
export interface PrNotesView {
  prKey: PrKey;
  /** The observation token of the PR as stored now (`observationToken`); note_pr needs it. */
  token: string;
  durable: PrNoteView | null;
  lease: PrNoteView | null;
  /** The newest note another one replaced (history of one): "replaced covered by ph3 session". */
  replaced: PrNoteView | null;
}

/** What a note's staleness is checked against: the PRs as stored now. */
export interface NoteReadContext {
  now: IsoTime;
  /** A stored PR's anchor now; null when the PR is not stored. */
  anchorOf: (key: PrKey) => NoteAnchor | null;
  fetchedAtOf: (key: PrKey) => IsoTime | null;
}

/**
 * Why a note no longer holds; empty while it does. Derived at read time,
 * so a PR that returns to exactly the anchored state makes the note live
 * again (accepted: a head that comes back is the same code). A covered
 * note also goes stale when the covering PR changed, is gone, or was
 * closed without merging.
 */
export function noteStaleReasons(note: Pick<PrNote, 'prKey' | 'anchor' | 'coveredByPrKey' | 'coverAnchor'>, anchorOf: (key: PrKey) => NoteAnchor | null): string[] {
  const current = anchorOf(note.prKey);
  if (!current) {
    return ['the PR is no longer stored'];
  }
  const reasons = anchorChanges(note.anchor, current);
  if (note.coveredByPrKey === null) {
    return reasons;
  }
  const cover = anchorOf(note.coveredByPrKey);
  if (!cover) {
    return [...reasons, `${note.coveredByPrKey} is no longer stored`];
  }
  if (cover.state === 'CLOSED') {
    return [...reasons, `${note.coveredByPrKey} was closed without merging`];
  }
  const coverReasons = note.coverAnchor ? anchorChanges(note.coverAnchor, cover) : [];
  return [...reasons, ...coverReasons.map((reason) => `${note.coveredByPrKey}: ${reason}`)];
}

export function prNoteView(note: PrNote, read: NoteReadContext): PrNoteView {
  const reasons = noteStaleReasons(note, read.anchorOf);
  let status: PrNoteStatus = reasons.length > 0 ? 'stale' : 'live';
  if (isNoteExpired(note, read.now)) {
    status = 'expired';
  }
  return {
    id: note.id,
    kind: note.kind,
    by: note.by,
    client: note.client,
    note: note.note,
    coveredBy: note.coveredByPrKey,
    coverFetchedAt: note.coveredByPrKey ? read.fetchedAtOf(note.coveredByPrKey) : null,
    createdAt: note.createdAt,
    expiresAt: note.expiresAt,
    status,
    staleReasons: reasons,
  };
}

/**
 * One PR's notes from its stored rows (current ones and replaced ones, any
 * order): the current note of each slot, and the newest replaced note.
 */
export function prNotesView(prKey: PrKey, token: string, notes: PrNote[], read: NoteReadContext): PrNotesView {
  const own = notes.filter((note) => note.prKey === prKey).toSorted((a, b) => a.seq - b.seq);
  const current = (slot: PrNoteSlot) => own.filter((note) => note.slot === slot && isCurrentNote(note)).at(-1) ?? null;
  const durable = current('durable');
  const lease = current('lease');
  const replaced = own.filter((note) => note.supersededBy !== null).at(-1) ?? null;
  return {
    prKey,
    token,
    durable: durable ? prNoteView(durable, read) : null,
    lease: lease ? prNoteView(lease, read) : null,
    replaced: replaced ? prNoteView(replaced, read) : null,
  };
}

/** The PR carries a note that holds right now: a live durable note or a live lease. */
export function hasLiveNote(view: PrNotesView): boolean {
  return view.durable?.status === 'live' || view.lease?.status === 'live';
}

// ---------------------------------------------------------------------------
// Writes: set, renew, clear (note_pr through the agent-request outbox)
// ---------------------------------------------------------------------------

export type PrNoteRequest =
  | {
      action: 'set';
      prKey: PrKey;
      kind: PrNoteKind;
      note: string;
      by: string;
      /** The PR's observation token from pr_context. */
      token: string;
      /** covered: the PR whose review covers this one. */
      coveredByPrKey: PrKey | null;
      /** covered, optional: the covering PR's token; without it its anchor is taken at write time. */
      coverToken: string | null;
      /** in_progress: how long the lease holds; default PR_NOTE_LEASE_DEFAULT_MINUTES. */
      leaseMinutes: number | null;
    }
  | { action: 'renew'; noteId: string; leaseMinutes: number | null }
  | { action: 'clear'; noteId: string };

export interface PrNoteResult {
  /** refused: nothing changed, see reason; unchanged: the same note was set already (a retried request). */
  status: 'set' | 'unchanged' | 'renewed' | 'cleared' | 'refused';
  note: PrNoteView | null;
  /** set: the note this one replaced in its slot. */
  replaced: PrNoteView | null;
  /** set: what the note is anchored to (`anchorSummary`). */
  anchored: string | null;
  reason: string | null;
}

export function refusedNote(reason: string): PrNoteResult {
  return { status: 'refused', note: null, replaced: null, anchored: null, reason };
}

/** Whitespace folded to single spaces: notes are one line wherever they show. */
export function cleanNoteText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * The idempotency key of a set: a hash of the request and the client. A
 * retry after a timeout (the outbox gives up waiting while the app still
 * writes) finds the note it wrote instead of writing a second one.
 */
export function noteRequestKey(request: Extract<PrNoteRequest, { action: 'set' }>, client: string): string {
  return shortHash(JSON.stringify([client, request.prKey, request.kind, cleanNoteText(request.note), cleanNoteText(request.by), request.token, request.coveredByPrKey, request.coverToken, request.leaseMinutes]));
}

/** What a set sees of the store, read in the same transaction it writes in. */
export interface NoteSetWorld {
  now: IsoTime;
  client: string;
  anchorOf: (key: PrKey) => NoteAnchor | null;
  /** The current note in a PR's slot, if any. */
  currentIn: (prKey: PrKey, slot: PrNoteSlot) => PrNote | null;
  /** The stored note with this request's idempotency key, if any. */
  sameRequest: PrNote | null;
  /** Live notes on open PRs: this client's and everyone's. */
  liveCount: { client: number; total: number };
  newId: () => string;
}

export type NoteSetPlan =
  | { kind: 'refused'; reason: string }
  | { kind: 'unchanged'; note: PrNote }
  /** Insert `note`; mark `replaces` superseded by it; release the idempotency key of `releaseKeyOf` (an old note of the same request that is no longer current). */
  | { kind: 'insert'; note: Omit<PrNote, 'seq'>; replaces: PrNote | null; releaseKeyOf: PrNote | null };

function leaseMinutes(requested: number | null): number | string {
  const minutes = requested ?? PR_NOTE_LEASE_DEFAULT_MINUTES;
  if (!Number.isInteger(minutes) || minutes < PR_NOTE_LEASE_MIN_MINUTES || minutes > PR_NOTE_LEASE_MAX_MINUTES) {
    return `lease_minutes must be a whole number from ${PR_NOTE_LEASE_MIN_MINUTES} to ${PR_NOTE_LEASE_MAX_MINUTES}`;
  }
  return minutes;
}

function addMinutes(iso: IsoTime, minutes: number): IsoTime {
  return new Date(Date.parse(iso) + minutes * 60_000).toISOString();
}

const READ_AGAIN = 'read it again with pr_context and pass the new token';

function checkCover(request: Extract<PrNoteRequest, { action: 'set' }>, world: NoteSetWorld): { ok: true; anchor: NoteAnchor | null } | { ok: false; reason: string } {
  const cover = request.coveredByPrKey;
  if (request.kind !== 'covered') {
    return cover === null ? { ok: true, anchor: null } : { ok: false, reason: 'covered_by only goes with kind covered' };
  }
  if (cover === null) {
    return { ok: false, reason: 'kind covered needs covered_by: the PR whose review covers this one' };
  }
  if (cover === request.prKey) {
    return { ok: false, reason: 'a PR cannot cover itself' };
  }
  if (parsePrKey(cover).repo.toLowerCase() !== parsePrKey(request.prKey).repo.toLowerCase()) {
    return { ok: false, reason: `covered_by must be a PR in the same repo as ${request.prKey}` };
  }
  const anchor = world.anchorOf(cover);
  if (!anchor) {
    return { ok: false, reason: `PostPile does not store ${cover}; it can only point at a PR it tracks` };
  }
  if (anchor.state === 'CLOSED') {
    return { ok: false, reason: `${cover} was closed without merging, so it covers nothing` };
  }
  if (request.coverToken !== null && request.coverToken !== observationToken(anchor)) {
    return { ok: false, reason: `${cover} changed since you read it; ${READ_AGAIN}` };
  }
  return { ok: true, anchor };
}

/**
 * The checks and the write of a set, as one pure step over what the store
 * holds now: the token must match the PR as stored (else the agent judged
 * a state that is gone), covered needs another stored PR in the same repo,
 * quotas hold, and the new note replaces the one in its slot.
 */
export function planNoteSet(request: Extract<PrNoteRequest, { action: 'set' }>, world: NoteSetWorld): NoteSetPlan {
  const note = cleanNoteText(request.note);
  const by = cleanNoteText(request.by);
  if (note === '' || note.length > PR_NOTE_MAX) {
    return { kind: 'refused', reason: `note must be 1 to ${PR_NOTE_MAX} characters` };
  }
  if (by === '' || by.length > PR_NOTE_BY_MAX) {
    return { kind: 'refused', reason: `by must be 1 to ${PR_NOTE_BY_MAX} characters: who you are, e.g. "ph3 session"` };
  }
  const key = noteRequestKey(request, world.client);
  const same = world.sameRequest;
  if (same && isCurrentNote(same) && !isNoteExpired(same, world.now)) {
    return { kind: 'unchanged', note: same };
  }
  const anchor = world.anchorOf(request.prKey);
  if (!anchor) {
    return { kind: 'refused', reason: `PostPile does not store ${request.prKey}` };
  }
  if (request.token !== observationToken(anchor)) {
    return { kind: 'refused', reason: `the PR changed since you read it; ${READ_AGAIN}` };
  }
  const cover = checkCover(request, world);
  if (!cover.ok) {
    return { kind: 'refused', reason: cover.reason };
  }
  const slot = noteSlot(request.kind);
  let expiresAt: IsoTime | null = null;
  if (slot === 'lease') {
    const minutes = leaseMinutes(request.leaseMinutes);
    if (typeof minutes === 'string') {
      return { kind: 'refused', reason: minutes };
    }
    expiresAt = addMinutes(world.now, minutes);
  } else if (request.leaseMinutes !== null) {
    return { kind: 'refused', reason: 'lease_minutes only goes with kind in_progress' };
  }
  const replaces = world.currentIn(request.prKey, slot);
  // Replacing a note in the same slot frees its place, so it does not count against the caps.
  const freed = replaces && !isNoteExpired(replaces, world.now) && anchor.state === 'OPEN' ? 1 : 0;
  const freedOwn = freed === 1 && replaces?.client === world.client ? 1 : 0;
  if (world.liveCount.client - freedOwn >= PR_NOTES_PER_CLIENT) {
    return { kind: 'refused', reason: `${world.client} has ${PR_NOTES_PER_CLIENT} live notes on open PRs already; clear some first` };
  }
  if (world.liveCount.total - freed >= PR_NOTES_TOTAL) {
    return { kind: 'refused', reason: `there are ${PR_NOTES_TOTAL} live notes on open PRs already; clear some first` };
  }
  return {
    kind: 'insert',
    note: {
      id: world.newId(),
      prKey: request.prKey,
      slot,
      kind: request.kind,
      by,
      client: world.client,
      note,
      coveredByPrKey: request.coveredByPrKey,
      anchor,
      coverAnchor: cover.anchor,
      createdAt: world.now,
      expiresAt,
      clearedAt: null,
      clearedBy: null,
      supersededBy: null,
      idempotencyKey: key,
    },
    replaces,
    releaseKeyOf: same,
  };
}

export type NoteRenewPlan = { kind: 'refused'; reason: string } | { kind: 'renew'; expiresAt: IsoTime };

/** Renew extends a live lease from now; it never re-anchors, so a stale lease stays stale. */
export function planNoteRenew(note: PrNote | null, requestedMinutes: number | null, now: IsoTime): NoteRenewPlan {
  if (!note) {
    return { kind: 'refused', reason: 'no note with that id' };
  }
  if (note.slot !== 'lease') {
    return { kind: 'refused', reason: 'only an in_progress note (a lease) can be renewed' };
  }
  if (!isCurrentNote(note)) {
    return { kind: 'refused', reason: note.clearedAt ? 'the lease was cleared' : 'another lease replaced it' };
  }
  if (isNoteExpired(note, now)) {
    return { kind: 'refused', reason: 'the lease ended; set a new one (with a fresh token)' };
  }
  const minutes = leaseMinutes(requestedMinutes);
  if (typeof minutes === 'string') {
    return { kind: 'refused', reason: minutes };
  }
  const extended = addMinutes(now, minutes);
  return { kind: 'renew', expiresAt: note.expiresAt !== null && note.expiresAt > extended ? note.expiresAt : extended };
}

export type NoteClearPlan = { kind: 'refused'; reason: string } | { kind: 'clear' } | { kind: 'already' };

/** Clearing a note never brings back the one it replaced. Clearing twice answers like the first time. */
export function planNoteClear(note: PrNote | null): NoteClearPlan {
  if (!note) {
    return { kind: 'refused', reason: 'no note with that id' };
  }
  if (note.clearedAt !== null) {
    return { kind: 'already' };
  }
  if (note.supersededBy !== null) {
    return { kind: 'refused', reason: 'another note replaced it already' };
  }
  return { kind: 'clear' };
}
