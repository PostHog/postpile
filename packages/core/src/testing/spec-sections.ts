// The ownership sections restated from the spec (DESIGN "Ownership
// sections", "Driver picker", 2026-10-02) over the raw board: the tracked
// PRs' tiers by the tier spec, the viewer's open PRs from the snapshots,
// the topic's driver, the user's pick, relation and owner team from the
// recipe. The only rule answer it reads is
// whose turn on each tile, which the tile invariants pin to the spec. Type
// imports only from the rule modules.
import type { PrTier } from '../pr-tier.ts';
import type { TopicSection } from '../topic-sections.ts';
import type { PrKey } from '../types.ts';
import type { TileView } from '../views.ts';
import { LOGINS, type PropertyBoard } from './build-board.ts';
import { eventsOf, isTrackedHere, fullPrOf } from './invariant.ts';
import { isHomeTeam, specRelation, viewerOwns } from './spec-facts.ts';
import { expectedTier } from './spec-rules.ts';

/** The asks, most urgent first: each pulls the topic into its own section while it lasts. */
const ASKS_IN_ORDER: readonly PrTier[] = ['needs_reply', 'changes_requested', 'to_review', 'team_mentioned'];

/** PRs some tile holds as pinged or found, each once. Pulled-in layers are context, outside every queue. */
function trackedKeys(board: PropertyBoard): PrKey[] {
  const keys = board.tiles.flatMap((tile) => tile.members.filter((member) => isTrackedHere(member.provenance)).map((member) => member.prKey));
  return [...new Set(keys)];
}

function specTier(board: PropertyBoard, key: PrKey): PrTier {
  return expectedTier({
    pr: fullPrOf(board, key),
    events: eventsOf(board, key),
    viewer: board.viewer,
    userState: board.userStates.get(key) ?? null,
    notYours: board.notYours.has(key),
    reason: board.threads.get(key)?.reason ?? null,
  });
}

/** The viewer has an open PR in the topic, or a live (unread or open) tile is their move. */
function viewerHasWorkHere(board: PropertyBoard, views: TileView[]): boolean {
  const openPr = trackedKeys(board).some((key) => {
    const pr = fullPrOf(board, key);
    return pr.state === 'OPEN' && viewerOwns(pr, board.viewer);
  });
  const move = views.some((view) => (view.state.kind === 'unread' || view.state.kind === 'open') && view.turn.kind === 'you');
  return openPr || move;
}

/**
 * Who drives, as the recipe says: the user's pick over the automatic
 * driver. The team counts like a teammate, someone outside like anyone
 * outside the team.
 */
function specDriver(board: PropertyBoard): 'you' | 'team' | 'other' | null {
  const who = board.spec.topic.pick ?? board.spec.topic.driver;
  if (who === null) {
    return null;
  }
  if (who === 'team') {
    return 'team';
  }
  return who === 'outside' ? 'other' : specRelation(LOGINS[who], board.viewer);
}

/**
 * Where the topic sits. An ask first, the most urgent one. Then who drives
 * it (`specDriver`): the viewer, a teammate (a member of any home team) or
 * the team, anyone else. An
 * FYI topic only leaves Other topics for the viewer's own work or when the
 * viewer or a teammate drives it. Without a driver the owner team places
 * it: a home team, another team, or nothing known (Other topics).
 */
export function expectedSection(board: PropertyBoard, views: TileView[]): TopicSection {
  const tiers = trackedKeys(board).map((key) => specTier(board, key));
  const ask = ASKS_IN_ORDER.find((tier) => tiers.includes(tier));
  if (ask !== undefined) {
    return ask as TopicSection;
  }
  const driver = specDriver(board);
  const drivenByUs = driver === 'you' || driver === 'team';
  if (board.placement?.relation === 'fyi' && !drivenByUs && !viewerHasWorkHere(board, views)) {
    return 'other_topics';
  }
  const byDriver: Record<'you' | 'team' | 'other', TopicSection> = { you: 'you_drive', team: 'team_owns', other: 'other_work' };
  if (driver !== null) {
    return byDriver[driver];
  }
  const owner = board.placement?.ownerTeam ?? null;
  if (owner === null) {
    return 'other_topics';
  }
  return isHomeTeam(board.viewer, owner) ? 'team_owns' : 'other_work';
}
