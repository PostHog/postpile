import {
  agentMarkReadCheck,
  agentMarkReadLogDetail,
  isScoutedUnseen,
  parseSeenThrough,
  unreadIdsHash,
  AgentReadNotices,
  planRead,
  type AgentMarkReadPr,
  type AgentMarkReadRequest,
  type AgentMarkReadResult,
  type PrKey,
  type Tile,
} from '@postpile/core';
import type { Store } from '@postpile/store';
import type { ReadMarker } from '../actions/read-marker.ts';
import { Board } from '../board.ts';
import { unseenIdsThrough } from './seen-through.ts';
import type { Telemetry } from '../telemetry/telemetry.ts';
import type { ActionLog } from '../writes/action-log.ts';

export interface AgentMarkReadDeps {
  store: Store;
  readMarker: ReadMarker;
  log: ActionLog;
  now: () => Date;
  /** scout_seen (via mcp) for a scouted PR marked seen. */
  telemetry: Telemetry;
}

/**
 * mark_read from an outside agent (DESIGN.md "Agents mark read"). Each PR
 * is checked against what the app stores now (`agentMarkReadCheck`): a PR
 * with events logged after the agent's seen_through, or whose unseen events
 * changed under it, is refused (nothing new since the read); the others
 * go through the ReadMarker like the pane's Mark read, as one batch with one
 * undo token. So the same undo window, writes lock and pending writes apply;
 * nothing here writes GitHub.
 */
export class AgentMarkRead {
  /** For the app's toasts, each kept until its undo window ends. */
  readonly notices: AgentReadNotices;
  /** Scouted PRs marked seen locally: the live status counts them, so the renderer's Scouted counts follow. */
  private seenLocally = 0;

  constructor(private readonly deps: AgentMarkReadDeps) {
    this.notices = new AgentReadNotices((undoToken) => deps.readMarker.canUndo(undoToken), deps.now);
  }

  /** Whether marking the PR read changes anything: an unread thread, an unseen event, not handled yet. */
  private changesAnything(key: PrKey): boolean {
    const { store } = this.deps;
    const thread = store.notifications.getByPrKeys([key]).get(key);
    if (thread?.unread) {
      return true;
    }
    const plan = planRead({
      scope: { prKeys: [key], handleKeys: [key] },
      cause: { kind: 'button' },
      events: store.events.listForPrs([key]),
      userStates: store.userPrStates.getMany([key]),
      at: this.deps.now().toISOString(),
    });
    return plan.change.eventIds.length > 0 || plan.change.handledKeys.length > 0;
  }

  /** GitHub updated the PR's notification thread after PostPile last fetched the PR. */
  private snapshotBehind(key: PrKey): boolean {
    const { store } = this.deps;
    const thread = store.notifications.getByPrKeys([key]).get(key);
    const fetchedAt = store.prs.fetchedAt(key);
    return thread !== undefined && fetchedAt !== null && Date.parse(thread.updatedAt) > Date.parse(fetchedAt);
  }

  /** The tiles holding the PR, and whether any of them tracks it (not only a pulled-in stack layer). */
  private tracking(tiles: Tile[], key: PrKey): { tracked: boolean; tileId: string | null } {
    for (const tile of tiles) {
      const member = tile.members.find((candidate) => candidate.prKey === key);
      if (member && member.provenance.kind !== 'pulled_in') {
        return { tracked: true, tileId: tile.id };
      }
    }
    return { tracked: false, tileId: null };
  }

  /**
   * A PR only a scout holds (DESIGN.md "Scouts"): it has no notification
   * thread, so marking it read means seen in PostPile, through its current
   * update, and nothing on GitHub. The same seen_through guards apply.
   * Null when the PR is no scouted-only PR.
   */
  private scoutedSeen(pr: AgentMarkReadPr, seenThrough: ReturnType<typeof parseSeenThrough>, tracked: boolean): ReturnType<typeof agentMarkReadCheck> | null {
    const { store } = this.deps;
    const row = store.scoutedPrs.get(pr.prKey);
    const snapshot = store.prs.get(pr.prKey);
    if (tracked || row === null || snapshot === null) {
      return null;
    }
    const seq = seenThrough?.seq ?? 0;
    const check = agentMarkReadCheck({
      stored: true,
      tracked: true,
      seenThrough,
      unreadHashNow: unreadIdsHash(unseenIdsThrough(store, pr.prKey, seq)),
      newestSeq: store.eventLog.maxSeqForPr(pr.prKey),
      newer: store.eventLog.listSince([pr.prKey], seq).map((entry) => entry.event),
      snapshotBehind: false,
      alreadyQueued: false,
      changesAnything: isScoutedUnseen(row, snapshot.updatedAt),
    });
    if (check.kind === 'mark' && store.scoutedPrs.markSeen(pr.prKey, snapshot.updatedAt)) {
      this.seenLocally += 1;
      this.deps.telemetry.capture('scout_seen', { via: 'mcp' });
    }
    return check;
  }

  /** Grows with every scouted PR an agent marked seen. */
  changes(): number {
    return this.notices.changes() + this.seenLocally;
  }

  handle(request: AgentMarkReadRequest, client: string): AgentMarkReadResult {
    const { store } = this.deps;
    const prs = [...new Map(request.prs.map((pr): [PrKey, AgentMarkReadPr] => [pr.prKey, pr])).values()];
    const board = Board.forPrs(store, this.deps.now().toISOString(), prs.map((pr) => pr.prKey));
    // Only the topics these PRs show in: building every topic's tiles would repeat that work on each agent call.
    const topicIds = new Set(prs.map((pr) => board.topicIdOf(pr.prKey)).filter((topicId): topicId is string => topicId !== null));
    const tiles = [...topicIds].flatMap((topicId) => board.tilesForTopic(topicId));
    const result: AgentMarkReadResult = { marked: [], refused: [], skipped: [], writesLocked: false, undoUntil: null };
    let tileId: string | null = null;
    const waiting = this.deps.readMarker.waitingPrKeys();
    for (const pr of prs) {
      const stored = store.prs.get(pr.prKey) !== null;
      const tracking = this.tracking(tiles, pr.prKey);
      const seenThrough = parseSeenThrough(pr.seenThrough);
      const scouted = this.scoutedSeen(pr, seenThrough, tracking.tracked);
      if (scouted !== null) {
        if (scouted.kind === 'mark') {
          result.seenLocally = [...(result.seenLocally ?? []), pr.prKey];
        } else {
          result[scouted.kind].push({ prKey: pr.prKey, reason: scouted.reason });
        }
        continue;
      }
      const seq = seenThrough?.seq ?? 0;
      // Only the events after the token's seq: a busy PR's whole history is not loaded for the check.
      const logged = stored ? store.eventLog.listSince([pr.prKey], seq) : [];
      const check = agentMarkReadCheck({
        stored,
        tracked: tracking.tracked,
        seenThrough,
        // The unseen events the token's list stood for, as the store has them now.
        unreadHashNow: unreadIdsHash(stored ? unseenIdsThrough(store, pr.prKey, seq) : []),
        newestSeq: stored ? store.eventLog.maxSeqForPr(pr.prKey) : 0,
        newer: logged.map((entry) => entry.event),
        snapshotBehind: stored && this.snapshotBehind(pr.prKey),
        alreadyQueued: waiting.has(pr.prKey),
        changesAnything: stored && this.changesAnything(pr.prKey),
      });
      if (check.kind === 'refused') {
        result.refused.push({ prKey: pr.prKey, reason: check.reason });
      } else if (check.kind === 'skipped') {
        result.skipped.push({ prKey: pr.prKey, reason: check.reason });
      } else {
        result.marked.push(pr.prKey);
        tileId = tracking.tileId;
      }
    }
    if (result.marked.length > 0) {
      const scope = { prKeys: result.marked, handleKeys: result.marked };
      const batch = this.deps.readMarker.markRead(scope, { kind: 'button' }, { origin: 'agent', tileId: result.marked.length === 1 ? tileId : null });
      result.writesLocked = !batch.writesOn && batch.threadIds.length > 0;
      result.undoUntil = new Date(batch.dueAt).toISOString();
      this.notices.add(client, result, batch.token, result.undoUntil);
    }
    const outcome = result.marked.length > 0 ? 'queued' : (result.seenLocally?.length ?? 0) > 0 ? 'local' : 'skipped';
    this.deps.log.record({ action: 'agent_mark_read', origin: 'agent', outcome, detail: agentMarkReadLogDetail(client, result) });
    return result;
  }
}
