// Coverage labels: which shapes a generated board holds, so a test can check
// that thousands of runs are not all trivial boards. Every label names a
// branch the rules take (PR state, author, request, review, CI, thread,
// snooze, snapshot) or a board shape a past bug needed.
import { topicAgentOffers, type AgentApproveOffer } from '../agent-actions.ts';
import { standingApprovals } from '../approvals.ts';
import { reReviewAsked } from '../changes-answered.ts';
import { pingRule } from '../pings.ts';
import { isTracked } from '../provenance.ts';
import { isNewYourMove, judgedReadCheck, quietReadCheck, touchedReadCheck, type JudgedReadCheck, type QuietReadCheck } from '../quiet-reads.ts';
import { ownedByTeammate, requestedTeam, reviewRequest, teamRequestHold, viewerHeadReview } from '../review-request.ts';
import { isRoutingTeam } from '../team-roles.ts';
import { actedAfterSeeing } from '../saw-before-acting.ts';
import { snoozePhase } from '../snooze.ts';
import { isPrDone } from '../tiles.ts';
import { sameLogin } from '../mentions.ts';
import { isUnseenLoud } from '../loudness.ts';
import { prWhoseTurn } from '../whose-turn.ts';
import type { Pr, PrEvent, PrKey } from '../types.ts';
import type { TileView } from '../views.ts';
import { LOGINS, REQUEST_BOT, tileViewsOf, type PropertyBoard } from './build-board.ts';
import type { Person } from './board-spec.ts';
import { isAutomationLogin, specOwners } from './spec-facts.ts';

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

/** A bot opened the PR and assigned people, who own it (DESIGN "PR ownership"); a deleted author with assignees stays the owner. */
function ownerLabels(pr: Pr): string[] {
  const assignees = pr.assignees ?? [];
  if (pr.author === '') {
    return assignees.length > 0 ? ['shape:deleted author with assignees'] : [];
  }
  if (!isAutomationLogin(pr.author) || assignees.length === 0) {
    return [];
  }
  const owners = specOwners(pr);
  const labels = ['shape:bot PR with assignees'];
  if (owners.some((owner) => sameLogin(owner, LOGINS.viewer))) {
    labels.push('shape:bot PR owned by viewer');
  }
  if (owners.some((owner) => sameLogin(owner, LOGINS.teammate))) {
    labels.push('shape:bot PR owned by teammate');
  }
  return labels;
}

/** A routing team's request decides the PR's review request (DESIGN "Team roles"): open or taken, and on a teammate's PR. */
function routingLabels(board: PropertyBoard, pr: Pr): string[] {
  const team = requestedTeam(pr, board.viewer);
  const request = reviewRequest(pr, board.viewer);
  if (team === null || !isRoutingTeam(team, board.viewer) || request === 'you') {
    return [];
  }
  const labels = [`routing-request:${request}`];
  if (request === 'team' && ownedByTeammate(pr, board.viewer)) {
    labels.push('shape:routing request on a teammate PR');
  }
  return labels;
}

/** The PR-level labels: one per value of every dimension the rules branch on. */
function prLabels(board: PropertyBoard, key: PrKey, pr: Pr): string[] {
  const labels: string[] = [];
  const state = prStateLabel(pr);
  const author = authorLabel(pr);
  labels.push(`pr:${state}`, `author:${author}`, `pr-author:${state}/${author}`, ...ownerLabels(pr));
  labels.push(`request:${reviewRequest(pr, board.viewer) ?? 'none'}`, ...routingLabels(board, pr));
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
    labels.push(`glance:${verdict}`, `glance-risk:${board.prSpecs.get(key)?.glanceRisk}`);
  }
  if (verdict && board.staleGlances.has(key)) {
    labels.push('glance:stale');
  }
  if (verdict === 'NOT_YOURS' && reviewRequest(pr, board.viewer) === 'team') {
    labels.push('shape:NOT_YOURS routed request');
  }
  labels.push(...activityLabels(board, key, pr));
  return labels;
}

/** Actors, timeline items and comment kinds the generator gaps of 2026-09-30 added, and what the poll and quiet reads make of the PR. */
function activityLabels(board: PropertyBoard, key: PrKey, pr: Pr): string[] {
  const labels: string[] = [];
  const events = board.events.get(key) ?? [];
  if (events.some((event) => sameLogin(event.actor, LOGINS.app))) {
    labels.push('shape:automation without [bot]');
  }
  if (events.some((event) => sameLogin(event.actor, LOGINS.outsider))) {
    labels.push('shape:second outsider');
  }
  for (const item of pr.timeline) {
    labels.push(`timeline:${item.kind}`);
  }
  if (pr.comments.some((comment) => comment.kind === 'review')) {
    labels.push('shape:review body');
  }
  if (events.some((event) => event.kind === 'deploy')) {
    labels.push('events:deploy');
  }
  if (events.some((event) => event.ruleLoudness === 'muted')) {
    labels.push('events:muted');
  }
  if (events.some((event) => event.kind === 'team_mention' && event.ruleLoudness === 'loud')) {
    labels.push('events:loud team mention');
  }
  if (events.some((event) => event.kind === 'team_mention' && event.ruleReason === 'mentions a team that only routes reviews to you')) {
    labels.push('events:routing team mention');
  }
  if (pr.reviewerUsers.some((login) => reReviewAsked(pr, login))) {
    labels.push('shape:re-review asked');
  }
  if (teamRequestHold(pr, board.viewer, board.notYours.has(key))?.kind === 'changes') {
    labels.push('shape:routed request held by changes');
  }
  labels.push(...editLabels(pr, events));
  const lastReadAt = board.threads.get(key)?.lastReadAt ?? null;
  const userState = board.userStates.get(key) ?? null;
  const actedAfterReading = pr.state === 'OPEN' && !userState?.handledAt && actedAfterSeeing(pr, events, board.viewer, { lastReadAt, handledAt: null });
  if (actedAfterReading && isPrDone(pr, userState, board.viewer, events, board.notYours.has(key), lastReadAt)) {
    labels.push('shape:done by acting after reading');
  }
  const fresh = events.filter((event) => event.seenAt === null);
  labels.push(`ping:${pingRule(fresh, pr, board.viewer, false).class}`);
  const thread = board.threads.get(key);
  if (thread) {
    const input = {
      thread,
      pr,
      events,
      userState: board.userStates.get(key) ?? null,
      viewer: board.viewer,
      notYours: board.notYours.has(key),
      prFetchedAt: board.prFetchedAt.get(key) ?? null,
    };
    const quiet = quietReadCheck(input);
    const touched = touchedReadCheck(input);
    labels.push(`quiet-read:${quiet.kind}`, `touched-read:${touched.kind}`);
    if (touched.kind === 'skip' && touched.why === 'acted_without_seeing') {
      labels.push('touched-read:acted_without_seeing');
    }
    const judged = judgedReadCheck(input);
    labels.push(judged.kind === 'mark' ? 'judged-read:mark' : `judged-read:${judged.why}`);
    labels.push(...ownPrQuietLabels(board, key, pr, quiet, judged));
  }
  if (prWhoseTurn({ pr, events, userState: board.userStates.get(key) ?? null, viewer: board.viewer }).kind === 'them') {
    labels.push('pr-turn:them');
  }
  return labels;
}

/** Comment edits (DESIGN "Handled quietly" › Comment edits): a bot updating its sticky comment, a person's plain edit, an edit that mentions the viewer. */
function editLabels(pr: Pr, events: PrEvent[]): string[] {
  const labels: string[] = [];
  for (const event of events.filter((candidate) => candidate.kind === 'comment_edited')) {
    const comment = pr.comments.find((candidate) => candidate.id === event.sourceId);
    if (event.isBot) {
      labels.push(comment && sameLogin(comment.author, event.actor) ? 'edit:bot updates its comment' : 'edit:bot edits another comment');
    } else if (event.ruleLoudness === 'loud') {
      labels.push('edit:person mentions you');
    } else {
      labels.push('edit:person, quiet');
    }
  }
  return labels;
}

/** The own-PR and new-move branches of the quiet reads: cleared with only bot noise on an own open PR (a bot review too, since 2026-10-01), cleared with a move that stood before. */
function ownPrQuietLabels(board: PropertyBoard, key: PrKey, pr: Pr, quiet: QuietReadCheck, judged: JudgedReadCheck): string[] {
  const labels: string[] = [];
  const ownOpen = pr.state === 'OPEN' && specOwners(pr).some((owner) => sameLogin(owner, board.viewer.login));
  if (ownOpen && quiet.kind === 'mark') {
    labels.push('shape:own open PR cleared with bot noise');
  }
  const events = board.events.get(key) ?? [];
  const lastReadAt = board.threads.get(key)?.lastReadAt ?? null;
  const input = { pr, events, userState: board.userStates.get(key) ?? null, viewer: board.viewer, notYours: board.notYours.has(key) };
  if (prWhoseTurn(input).kind === 'you' && (quiet.kind === 'mark' || judged.kind === 'mark')) {
    labels.push('shape:cleared with a move that stood before');
  }
  if (lastReadAt !== null && isNewYourMove(input, lastReadAt)) {
    labels.push('shape:new move since the read');
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
    if (pr.turn.kind === 'you') {
      labels.push(`move:${pr.turn.move}`);
    }
    if (pr.done && isTracked(pr.provenance) && (view.state.kind === 'unread' || view.state.kind === 'open')) {
      labels.push('shape:done PR on a live tile');
    }
    if (pr.done && pr.unreadOnGitHub) {
      labels.push('shape:done PR with an unread thread');
    }
  }
  if (view.state.kind === 'unread' && !view.state.loud) {
    labels.push('shape:unread with only quiet news');
  }
  if (view.state.kind !== 'unread' && view.state.kind !== 'snoozed' && view.state.loud) {
    labels.push('shape:loud news on a read tile');
  }
  if (view.state.kind === 'snoozed' && view.state.unreadOnGitHub) {
    labels.push('shape:snoozed with an unread thread');
  }
  if (view.state.unreadBecause.some((reason) => reason.eventId.startsWith('thread:'))) {
    labels.push('shape:unread by the thread alone');
  }
  if (view.state.kind === 'snoozed' && view.tile.members.length > 1) {
    labels.push('shape:snoozed multi-PR tile');
  }
  if (view.tile.kind === 'set' && view.tile.stacks.length > 0) {
    labels.push('shape:set with a stack');
  }
  return labels;
}

function approveLabel(prefix: string, offer: AgentApproveOffer | null): string[] {
  if (offer === null) {
    return [`${prefix}:absent`];
  }
  if (offer.state === 'greyed') {
    return [`${prefix}:greyed:${offer.reason}`];
  }
  const labels = [`${prefix}:active`, `${prefix}:active ${offer.risk}`];
  if (offer.coveredCount < offer.totalCount) {
    labels.push(`${prefix}:partial`);
  }
  if (offer.naming === 'one') {
    labels.push(`${prefix}:names one of several`);
  }
  if (offer.naming === 'every' && offer.prCount > 1) {
    labels.push(`${prefix}:every of several`);
  }
  return labels;
}

/** Base up on a stack (owner, 2026-10-01): a layer waits on a blocking layer below, also on a greyed offer. */
function waitingLabels(prefix: string, offer: AgentApproveOffer | null): string[] {
  if (!offer?.leftOut.some((pr) => pr.reason === 'layer_below')) {
    return [];
  }
  return [`${prefix}:waits on a layer below`, `${prefix}:${offer.state} with a layer waiting`];
}

/** A covered stack layer with a draft above it: the base goes through, so the label must not say "Approve stack". */
function draftAboveCovered(view: TileView): boolean {
  const covered = view.agent.approve?.covered.map((pr) => pr.prKey) ?? [];
  return view.tile.stacks.some((stack) =>
    stack.prKeys.some((key, index) => covered.includes(key) && stack.prKeys.slice(index + 1).some((above) => view.prs.find((row) => row.key === above)?.isDraft === true)),
  );
}

/**
 * The agent-assisted offers (DESIGN "Agent-assisted actions"): each tile's
 * and the topic's Approve state and greyed reason, a partial tile or topic
 * Approve ("3 of 5"), the topic's Mark N read and one that skips an ask, and an
 * approvable PR someone else approved already.
 */
function agentLabels(board: PropertyBoard, views: TileView[]): string[] {
  const labels = views.flatMap((view) => [...approveLabel('agent-approve-tile', view.agent.approve), ...waitingLabels('agent-approve-tile', view.agent.approve)]);
  if (views.some(draftAboveCovered)) {
    labels.push('agent-approve-tile:draft above a covered layer');
  }
  const topic = topicAgentOffers(views.map((view) => ({ tile: view.tile, state: view.state, agent: view.agent, prs: view.prs })));
  labels.push(...approveLabel('agent-approve-topic', topic.approve), ...waitingLabels('agent-approve-topic', topic.approve));
  const markRead = topic.markRead;
  labels.push(markRead === null ? 'agent-mark-read-topic:absent' : `agent-mark-read-topic:${markRead.state}`);
  if (markRead?.skipped.some((tile) => tile.reason === 'asks_for_you')) {
    labels.push(markRead.state === 'active' ? 'agent-mark-read-topic:active, skips an ask' : 'agent-mark-read-topic:greyed by an ask');
  }
  for (const view of views) {
    for (const row of view.prs) {
      const pr = board.prs.get(row.key);
      const approvals = pr ? standingApprovals(pr) : { people: [], agents: [] };
      const approvedByOthers = [...approvals.people, ...approvals.agents].some((login) => !sameLogin(login, board.viewer.login)) || pr?.reviewDecision === 'APPROVED';
      if (view.offers.pane[row.key]?.lead === 'approve' && isTracked(row.provenance) && approvedByOthers) {
        labels.push('agent:approvable PR someone else approved');
      }
    }
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
  agentLabels(board, views).forEach((label) => labels.add(label));
  if (board.spec.groups.some((group) => group.kind === 'dissolved_set')) {
    labels.add('shape:dissolved set');
  }
  labels.add(`team-setup:${board.spec.teams}`);
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
  'shape:set with a stack',
  'shape:dissolved set',
  'shape:review body',
  'shape:automation without [bot]',
  'shape:second outsider',
  'shape:re-review asked',
  'shape:routed request held by changes',
  'shape:bot PR owned by viewer',
  'shape:bot PR owned by teammate',
  'shape:deleted author with assignees',
  'shape:routing request on a teammate PR',
  'routing-request:team',
  'routing-request:team_taken',
  'team-setup:one_home',
  'team-setup:home_and_routing',
  'team-setup:no_home',
  'team-setup:undecided',
  'events:loud team mention',
  'events:routing team mention',
  'request-to:acme/approvers',
  'timeline:added_to_merge_queue',
  'timeline:deployed',
  'events:deploy',
  'events:muted',
  'ping:addressed',
  'ping:routed',
  'ping:bot',
  'ping:not_addressed',
  'ping:quiet',
  'quiet-read:mark',
  'touched-read:mark',
  'judged-read:mark',
  'judged-read:asks_you',
  'judged-read:not_judged',
  'judged-read:never_looked',
  'shape:done PR with an unread thread',
  'shape:unread with only quiet news',
  'shape:loud news on a read tile',
  'shape:snoozed with an unread thread',
  'shape:unread by the thread alone',
  'edit:bot updates its comment',
  'edit:person, quiet',
  'edit:person mentions you',
  'touched-read:acted_without_seeing',
  'shape:own open PR cleared with bot noise',
  'shape:cleared with a move that stood before',
  'shape:new move since the read',
  'shape:done by acting after reading',
  'request-to:ada',
  'review:PENDING',
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
  'glance:stale',
  'glance-risk:low',
  'glance-risk:medium',
  'glance-risk:high',
  'glance-risk:garbage',
  'agent-approve-tile:active',
  'agent-approve-tile:active low',
  'agent-approve-tile:active medium',
  'agent-approve-tile:partial',
  'agent-approve-tile:greyed:rechecking',
  'agent-approve-tile:greyed:look_closer',
  'agent-approve-tile:greyed:high',
  'agent-approve-tile:absent',
  'agent-approve-tile:waits on a layer below',
  'agent-approve-tile:active with a layer waiting',
  'agent-approve-tile:greyed with a layer waiting',
  'agent-approve-tile:names one of several',
  'agent-approve-tile:every of several',
  'agent-approve-tile:draft above a covered layer',
  'agent-approve-topic:active',
  'agent-approve-topic:partial',
  'agent-approve-topic:greyed:rechecking',
  'agent-approve-topic:greyed:look_closer',
  'agent-approve-topic:absent',
  'agent-approve-topic:waits on a layer below',
  'agent-approve-topic:names one of several',
  'agent-mark-read-topic:active',
  'agent-mark-read-topic:greyed',
  'agent-mark-read-topic:absent',
  'agent-mark-read-topic:active, skips an ask',
  'agent-mark-read-topic:greyed by an ask',
  'agent:approvable PR someone else approved',
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
