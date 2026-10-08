import {
  anchorSummary,
  noteAnchor,
  observationToken,
  planNoteClear,
  planNoteRenew,
  planNoteSet,
  prNotesView,
  prNoteView,
  refusedNote,
  noteRequestKey,
  type NoteAnchor,
  type NoteReadContext,
  type Pr,
  type PrKey,
  type PrNote,
  type PrNoteRequest,
  type PrNoteResult,
  type PrNotesView,
} from '@postpile/core';
import type { Store } from '@postpile/store';
import { newNoteId } from './ids.ts';

/**
 * Agent notes on PRs (DESIGN.md "Agent notes on PRs"): note_pr's set,
 * renew and clear, the user's Clear in the PR pane, and the notes as the
 * PR pane and the MCP answers read them. The checks are core's
 * (`planNoteSet`); this reads the store, applies the plan and counts
 * writes, so the renderer refetches. Nothing here touches whose move,
 * unread or counts.
 */
export class PrNotes {
  private written = 0;

  constructor(
    private readonly store: Store,
    private readonly now: () => Date,
  ) {}

  /** Moves on every note write; added to the live poll's change count. */
  changes(): number {
    return this.written;
  }

  /** The anchors of stored PRs, read in one go; `known` PRs are used as they are. */
  private readContext(keys: PrKey[], known: Pr[] = []): NoteReadContext {
    const prs = new Map<PrKey, Pr>(known.map((pr) => [pr.key, pr]));
    const missing = [...new Set(keys)].filter((key) => !prs.has(key));
    for (const [key, pr] of this.store.prs.getMany(missing)) {
      prs.set(key, pr);
    }
    const anchors = new Map<PrKey, NoteAnchor>([...prs].map(([key, pr]) => [key, noteAnchor(pr)]));
    return {
      now: this.now().toISOString(),
      anchorOf: (key) => anchors.get(key) ?? null,
      fetchedAtOf: (key) => this.store.prs.fetchedAt(key),
    };
  }

  private tokenOf(read: NoteReadContext, key: PrKey): string {
    const anchor = read.anchorOf(key);
    return anchor ? observationToken(anchor) : '';
  }

  /** One PR's notes and its observation token, for the PR pane and pr_context. */
  viewFor(pr: Pr): PrNotesView {
    const notes = this.store.prNotes.listForPrs([pr.key]);
    const covers = notes.flatMap((note) => (note.coveredByPrKey ? [note.coveredByPrKey] : []));
    const read = this.readContext(covers, [pr]);
    return prNotesView(pr.key, this.tokenOf(read, pr.key), notes, read);
  }

  /** The notes of the PRs among `prKeys` that have any, in one query: whats_on_me's per-PR note lines. */
  viewsFor(prKeys: PrKey[]): PrNotesView[] {
    const notes = this.store.prNotes.listForPrs(prKeys);
    if (notes.length === 0) {
      return [];
    }
    const noted = [...new Set(notes.map((note) => note.prKey))];
    const covers = notes.flatMap((note) => (note.coveredByPrKey ? [note.coveredByPrKey] : []));
    const read = this.readContext([...noted, ...covers]);
    return noted.map((key) => prNotesView(key, this.tokenOf(read, key), notes, read));
  }

  private view(note: PrNote | null): PrNotesView['durable'] {
    if (!note) {
      return null;
    }
    const read = this.readContext(note.coveredByPrKey ? [note.prKey, note.coveredByPrKey] : [note.prKey]);
    return prNoteView(note, read);
  }

  private set(request: Extract<PrNoteRequest, { action: 'set' }>, client: string): PrNoteResult {
    const now = this.now().toISOString();
    // One transaction: the anchor the token is checked against is the one stored with the note.
    return this.store.transaction(() => {
      const keys = request.coveredByPrKey ? [request.prKey, request.coveredByPrKey] : [request.prKey];
      const read = this.readContext(keys);
      const plan = planNoteSet(request, {
        now,
        client,
        anchorOf: read.anchorOf,
        currentIn: (prKey, slot) => this.store.prNotes.currentIn(prKey, slot),
        sameRequest: this.store.prNotes.getByIdempotencyKey(noteRequestKey(request, client)),
        liveCount: { client: this.store.prNotes.countLiveOnOpenPrs(now, client), total: this.store.prNotes.countLiveOnOpenPrs(now) },
        newId: newNoteId,
      });
      if (plan.kind === 'refused') {
        return refusedNote(plan.reason);
      }
      if (plan.kind === 'unchanged') {
        return { status: 'unchanged', note: prNoteView(plan.note, read), replaced: null, anchored: anchorSummary(plan.note.anchor), reason: null };
      }
      if (plan.releaseKeyOf) {
        this.store.prNotes.releaseKey(plan.releaseKeyOf.id);
      }
      if (plan.replaces) {
        this.store.prNotes.supersede(plan.replaces.id, plan.note.id);
      }
      const seq = this.store.prNotes.insert(plan.note);
      this.written += 1;
      const replaced = plan.replaces ? prNoteView({ ...plan.replaces, supersededBy: plan.note.id }, read) : null;
      return { status: 'set', note: prNoteView({ ...plan.note, seq }, read), replaced, anchored: anchorSummary(plan.note.anchor), reason: null };
    });
  }

  private renew(noteId: string, minutes: number | null): PrNoteResult {
    const now = this.now().toISOString();
    return this.store.transaction(() => {
      const note = this.store.prNotes.get(noteId);
      const plan = planNoteRenew(note, minutes, now);
      if (plan.kind === 'refused' || !note) {
        return refusedNote(plan.kind === 'refused' ? plan.reason : 'no note with that id');
      }
      this.store.prNotes.renew(note.id, plan.expiresAt);
      this.written += 1;
      return { status: 'renewed', note: this.view({ ...note, expiresAt: plan.expiresAt }), replaced: null, anchored: anchorSummary(note.anchor), reason: null };
    });
  }

  /** `by`: the agent's client name, or "user" for the PR pane's Clear. */
  clear(noteId: string, by: string): PrNoteResult {
    const now = this.now().toISOString();
    return this.store.transaction(() => {
      const note = this.store.prNotes.get(noteId);
      const plan = planNoteClear(note);
      if (plan.kind === 'refused' || !note) {
        return refusedNote(plan.kind === 'refused' ? plan.reason : 'no note with that id');
      }
      if (plan.kind === 'clear') {
        this.store.prNotes.clear(note.id, now, by);
        this.written += 1;
      }
      return { status: 'cleared', note: this.view(note), replaced: null, anchored: null, reason: null };
    });
  }

  /** note_pr from an outside agent, through the agent-request outbox. */
  handle(request: PrNoteRequest, client: string): PrNoteResult {
    if (request.action === 'set') {
      return this.set(request, client);
    }
    if (request.action === 'renew') {
      return this.renew(request.noteId, request.leaseMinutes);
    }
    return this.clear(request.noteId, client);
  }
}
