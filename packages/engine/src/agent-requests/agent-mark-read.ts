import {
  agentMarkReadCheck,
  agentMarkReadLogDetail,
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
import type { ActionLog } from '../writes/action-log.ts';

export interface AgentMarkReadDeps {
  store: Store;
  readMarker: ReadMarker;
  log: ActionLog;
  now: () => Date;
}

/**
 * mark_read from an outside agent (DESIGN.md "Agents mark read"). Each PR
 * is checked against what the app stores now (`agentMarkReadCheck`): a PR
 * with events logged after the agent's seen_through is refused, the others
 * go through the ReadMarker like the pane's Mark read, as one batch with one
 * undo token. So the same undo window, writes lock and pending writes apply;
 * nothing here writes GitHub.
 */
export class AgentMarkRead {
  /** For the app's toasts, each kept until its undo window ends. */
  readonly notices: AgentReadNotices;

  constructor(private readonly deps: AgentMarkReadDeps) {
    this.notices = new AgentReadNotices((notice) => deps.readMarker.canUndo(notice.undoToken));
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

  handle(request: AgentMarkReadRequest, client: string): AgentMarkReadResult {
    const { store } = this.deps;
    const prs = [...new Map(request.prs.map((pr): [PrKey, AgentMarkReadPr] => [pr.prKey, pr])).values()];
    const board = Board.forPrs(store, this.deps.now().toISOString(), prs.map((pr) => pr.prKey));
    const tiles = board.allTiles();
    const result: AgentMarkReadResult = { marked: [], refused: [], skipped: [], writesLocked: false, undoUntil: null };
    let tileId: string | null = null;
    for (const pr of prs) {
      const stored = store.prs.get(pr.prKey) !== null;
      const tracking = this.tracking(tiles, pr.prKey);
      const check = agentMarkReadCheck({
        stored,
        tracked: tracking.tracked,
        seenThrough: pr.seenThrough,
        newestSeq: stored ? store.eventLog.maxSeqForPr(pr.prKey) : 0,
        newer: stored ? store.eventLog.listSince([pr.prKey], pr.seenThrough).map((entry) => entry.event) : [],
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
    this.deps.log.record({ action: 'agent_mark_read', origin: 'agent', outcome: result.marked.length > 0 ? 'queued' : 'skipped', detail: agentMarkReadLogDetail(client, result) });
    return result;
  }
}
