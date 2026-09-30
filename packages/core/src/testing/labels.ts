// Coverage labels: which shapes a generated board holds, so a test can check
// that thousands of runs are not all trivial boards. Every label names a
// branch the rules take (PR state, author, request, review, CI, thread,
// snooze, snapshot) or a board shape a past bug needed.
import { isTracked } from '../provenance.ts';
import { reviewRequest, viewerHeadReview } from '../review-request.ts';
import { snoozePhase } from '../snooze.ts';
import { sameLogin } from '../mentions.ts';
import { isUnseenLoud } from '../loudness.ts';
import type { Pr, PrKey } from '../types.ts';
import type { TileView } from '../views.ts';
import { LOGINS, REQUEST_BOT, tileViewsOf, type PropertyBoard } from './build-board.ts';
import type { Person } from './board-spec.ts';

function prStateLabel(pr: Pr): string {
  if (pr.state !== 'OPEN') {
    return pr.state.toLowerCase();
  }
  return pr.isDraft ? 'draft' : 'open';
}

function authorLabel(pr: Pr): Person {
  const entry = (Object.entries(LOGINS) as [Person, string][]).find(([, login]) => sameLogin(login, pr.author));
  return entry ? entry[0] : 'other';
}

function snoozeLabels(board: PropertyBoard, key: PrKey, pr: Pr): string[] {
  const snooze = board.snoozes.get(key);
  if (!snooze) {
    return [];
  }
  const phase = snoozePhase(snooze, { pr, events: board.events.get(key) ?? [], now: board.now, viewer: board.viewer });
  return [`snooze:${snooze.condition.kind}`, `snooze-phase:${phase}`];
}

/** The PR-level labels: one per value of every dimension the rules branch on. */
function prLabels(board: PropertyBoard, key: PrKey, pr: Pr): string[] {
  const labels: string[] = [];
  const state = prStateLabel(pr);
  const author = authorLabel(pr);
  labels.push(`pr:${state}`, `author:${author}`, `pr-author:${state}/${author}`);
  labels.push(`request:${reviewRequest(pr, board.viewer) ?? 'none'}`);
  for (const item of pr.timeline) {
    if (item.kind === 'review_requested') {
      labels.push(`request-to:${item.subject}`);
      if (item.actor === REQUEST_BOT && item.subject === board.viewer.login) {
        labels.push('shape:bot request for viewer');
      }
    }
  }
  for (const review of pr.reviews) {
    labels.push(`review:${review.state}`);
    if (sameLogin(review.author, board.viewer.login)) {
      labels.push(`viewer-review:${review.state}:${review.commitOid === pr.headOid ? 'head' : 'older'}`);
      if (review.state === 'DISMISSED' && review.commitOid === pr.headOid) {
        labels.push('shape:dismissed review on head');
      }
    }
  }
  if (viewerHeadReview(pr, board.viewer)) {
    labels.push('viewer reviewed head');
  }
  labels.push(`ci:${pr.checks.rollup}`);
  const thread = board.threads.get(key);
  if (thread) {
    labels.push(thread.unread ? 'thread:unread' : 'thread:read', thread.lastReadAt === null ? 'thread:never read' : 'thread:read once');
  }
  const events = board.events.get(key) ?? [];
  labels.push(events.some(isUnseenLoud) ? 'events:unseen loud' : 'events:nothing unseen loud');
  if (events.some((event) => event.seenAt !== null)) {
    labels.push('events:some seen');
  }
  if (events.some((event) => event.override !== null)) {
    labels.push('events:override');
  }
  if (events.some((event) => event.kind === 'look_closer')) {
    labels.push('events:look closer');
  }
  if (board.userStates.get(key)?.handledAt) {
    labels.push('handled');
  }
  if (board.userStates.get(key)?.approvedAt) {
    labels.push('approved in app');
  }
  labels.push(...snoozeLabels(board, key, pr));
  const snooze = board.snoozes.get(key);
  if (snooze && pr.state !== 'OPEN') {
    labels.push('shape:finished PR with snooze');
  }
  if (pr.truncated) {
    labels.push('shape:truncated snapshot');
  }
  if (board.pendingWrites.has(key)) {
    labels.push('shape:lock on with pending write');
  }
  const verdict = board.glances.get(key);
  if (verdict) {
    labels.push(`glance:${verdict}`);
  }
  if (verdict === 'NOT_YOURS' && reviewRequest(pr, board.viewer) === 'team') {
    labels.push('shape:NOT_YOURS routed request');
  }
  return labels;
}

function tileLabels(view: TileView): string[] {
  const labels = [`tile:${view.tile.kind}`, `tile-state:${view.state.kind}`, `footer:${view.offers.footer}`, `turn:${view.turn.kind}`];
  if (view.turn.kind === 'you') {
    labels.push(`move:${view.turn.move}`);
  }
  for (const pr of view.prs) {
    labels.push(`provenance:${pr.provenance.kind}`, `tier:${pr.tier}`);
    if (pr.done && isTracked(pr.provenance) && (view.state.kind === 'unread' || view.state.kind === 'open')) {
      labels.push('shape:done PR on a live tile');
    }
  }
  if (view.state.kind === 'snoozed' && view.tile.members.length > 1) {
    labels.push('shape:snoozed multi-PR tile');
  }
  return labels;
}

/** Every label of the board: PR labels for each PR in a tile, tile labels for each tile. */
export function boardLabels(board: PropertyBoard, views: TileView[] = tileViewsOf(board)): Set<string> {
  const labels = new Set<string>();
  const shown = new Set(board.tiles.flatMap((tile) => tile.members.map((member) => member.prKey)));
  for (const key of shown) {
    const pr = board.prs.get(key);
    if (pr) {
      prLabels(board, key, pr).forEach((label) => labels.add(label));
    }
  }
  views.flatMap(tileLabels).forEach((label) => labels.add(label));
  return labels;
}

/**
 * Labels a healthy generator must reach on at least 1% of boards. The
 * shape labels are the board shapes past bugs needed; the rest are the
 * values of every dimension the rules branch on.
 */
export const REQUIRED_LABELS: readonly string[] = [
  'shape:done PR on a live tile',
  'shape:snoozed multi-PR tile',
  'shape:bot request for viewer',
  'shape:dismissed review on head',
  'shape:truncated snapshot',
  'shape:lock on with pending write',
  'shape:NOT_YOURS routed request',
  'shape:finished PR with snooze',
  ...['open', 'draft', 'merged', 'closed'].flatMap((state) => ['viewer', 'teammate', 'other', 'bot'].map((author) => `pr-author:${state}/${author}`)),
  'request:you',
  'request:team_for_you',
  'request:team',
  'request:team_taken',
  'request:none',
  'request-to:viewer',
  'request-to:acme/team-platform',
  'request-to:acme/team-infra',
  'request-to:rowan',
  'review:APPROVED',
  'review:CHANGES_REQUESTED',
  'review:COMMENTED',
  'review:DISMISSED',
  'viewer-review:APPROVED:head',
  'viewer-review:APPROVED:older',
  'viewer-review:CHANGES_REQUESTED:head',
  'viewer-review:CHANGES_REQUESTED:older',
  'viewer-review:COMMENTED:head',
  'ci:NONE',
  'ci:PENDING',
  'ci:SUCCESS',
  'ci:FAILURE',
  'thread:unread',
  'thread:read',
  'thread:never read',
  'thread:read once',
  'events:unseen loud',
  'events:some seen',
  'events:override',
  'events:look closer',
  'handled',
  'approved in app',
  'snooze:someone_replies',
  'snooze:new_push',
  'snooze:ci_green',
  'snooze:until_time',
  'snooze-phase:active',
  'snooze-phase:broken',
  'snooze-phase:over',
  'glance:LOOKS_SAFE',
  'glance:LOOK_CLOSER',
  'glance:NOT_YOURS',
  'tile:single',
  'tile:stack',
  'tile:set',
  'tile-state:unread',
  'tile-state:open',
  'tile-state:done',
  'tile-state:snoozed',
  'footer:open',
  'footer:mark_read',
  'footer:mark_done',
  'footer:snooze',
  'turn:you',
  'turn:them',
  'turn:none',
  'move:reply',
  'move:re_review',
  'move:review',
  'move:address_changes',
  'move:merge',
  'provenance:pinged',
  'provenance:found',
  'provenance:pulled_in',
  'tier:needs_reply',
  'tier:changes_requested',
  'tier:mine',
  'tier:team',
  'tier:to_review',
  'tier:team_mentioned',
  'tier:rest',
];
