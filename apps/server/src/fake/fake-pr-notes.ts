import {
  anchorSummary,
  isCurrentNote,
  isNoteExpired,
  noteAnchor,
  noteRequestKey,
  observationToken,
  planNoteClear,
  planNoteRenew,
  planNoteSet,
  prNotesView,
  prNoteView,
  refusedNote,
  type NoteReadContext,
  type PrKey,
  type PrNote,
  type PrNoteRequest,
  type PrNoteResult,
  type PrNotesView,
} from '@postpile/core';
import type { SampleData } from './sample-data.ts';

/**
 * Agent notes on sample data, in memory, through core's planners like the
 * real engine (`PrNotes`): note_pr from `pnpm cli mcp` over sample data,
 * and the PR pane's Clear.
 */
export class FakePrNotes {
  private readonly notes: PrNote[] = [];
  private written = 0;
  private nextSeq = 1;

  constructor(
    private readonly data: SampleData,
    private readonly now: () => Date,
    private readonly fetchedAtOf: (key: PrKey) => string,
  ) {}

  changes(): number {
    return this.written;
  }

  private readContext(): NoteReadContext {
    return {
      now: this.now().toISOString(),
      anchorOf: (key) => {
        const pr = this.data.prs.find((candidate) => candidate.key === key);
        return pr ? noteAnchor(pr) : null;
      },
      fetchedAtOf: (key) => (this.data.prs.some((pr) => pr.key === key) ? this.fetchedAtOf(key) : null),
    };
  }

  private tokenOf(read: NoteReadContext, key: PrKey): string {
    const anchor = read.anchorOf(key);
    return anchor ? observationToken(anchor) : '';
  }

  viewFor(prKey: PrKey): PrNotesView {
    const read = this.readContext();
    return prNotesView(prKey, this.tokenOf(read, prKey), this.notes, read);
  }

  viewsFor(prKeys: PrKey[]): PrNotesView[] {
    const read = this.readContext();
    const noted = [...new Set(this.notes.map((note) => note.prKey))].filter((key) => prKeys.includes(key));
    return noted.map((key) => prNotesView(key, this.tokenOf(read, key), this.notes, read));
  }

  private liveOnOpenPrs(now: string, client?: string): number {
    const open = new Set(this.data.prs.filter((pr) => pr.state === 'OPEN').map((pr) => pr.key));
    return this.notes.filter((note) => isCurrentNote(note) && !isNoteExpired(note, now) && open.has(note.prKey) && (client === undefined || note.client === client)).length;
  }

  private set(request: Extract<PrNoteRequest, { action: 'set' }>, client: string): PrNoteResult {
    const read = this.readContext();
    const key = noteRequestKey(request, client);
    const plan = planNoteSet(request, {
      now: read.now,
      client,
      anchorOf: read.anchorOf,
      currentIn: (prKey, slot) => this.notes.findLast((note) => note.prKey === prKey && note.slot === slot && isCurrentNote(note)) ?? null,
      sameRequest: this.notes.find((note) => note.idempotencyKey === key) ?? null,
      liveCount: { client: this.liveOnOpenPrs(read.now, client), total: this.liveOnOpenPrs(read.now) },
      newId: () => `n-sample-${this.nextSeq}`,
    });
    if (plan.kind === 'refused') {
      return refusedNote(plan.reason);
    }
    if (plan.kind === 'unchanged') {
      return { status: 'unchanged', note: prNoteView(plan.note, read), replaced: null, anchored: anchorSummary(plan.note.anchor), reason: null };
    }
    if (plan.releaseKeyOf) {
      plan.releaseKeyOf.idempotencyKey = null;
    }
    if (plan.replaces) {
      plan.replaces.supersededBy = plan.note.id;
      plan.replaces.idempotencyKey = null;
    }
    const note: PrNote = { ...plan.note, seq: this.nextSeq };
    this.nextSeq += 1;
    this.notes.push(note);
    this.written += 1;
    return { status: 'set', note: prNoteView(note, read), replaced: plan.replaces ? prNoteView(plan.replaces, read) : null, anchored: anchorSummary(note.anchor), reason: null };
  }

  private renew(noteId: string, minutes: number | null): PrNoteResult {
    const read = this.readContext();
    const note = this.notes.find((candidate) => candidate.id === noteId) ?? null;
    const plan = planNoteRenew(note, minutes, read.now);
    if (plan.kind === 'refused' || !note) {
      return refusedNote(plan.kind === 'refused' ? plan.reason : 'no note with that id');
    }
    note.expiresAt = plan.expiresAt;
    this.written += 1;
    return { status: 'renewed', note: prNoteView(note, read), replaced: null, anchored: anchorSummary(note.anchor), reason: null };
  }

  clear(noteId: string, by: string): PrNoteResult {
    const read = this.readContext();
    const note = this.notes.find((candidate) => candidate.id === noteId) ?? null;
    const plan = planNoteClear(note);
    if (plan.kind === 'refused' || !note) {
      return refusedNote(plan.kind === 'refused' ? plan.reason : 'no note with that id');
    }
    if (plan.kind === 'clear') {
      note.clearedAt = read.now;
      note.clearedBy = by;
      note.idempotencyKey = null;
      this.written += 1;
    }
    return { status: 'cleared', note: prNoteView(note, read), replaced: null, anchored: null, reason: null };
  }

  handle(request: PrNoteRequest, client: string): PrNoteResult {
    if (request.action === 'set') {
      return this.set(request, client);
    }
    if (request.action === 'renew') {
      return this.renew(request.noteId, request.leaseMinutes);
    }
    return this.clear(request.noteId, client);
  }

  /**
   * One sample note, so the PR pane and whats_on_me show what a note looks
   * like: an outside agent looked at #1955 and found nothing to do.
   */
  seed(): void {
    const prKey = 'acme/app#1955';
    this.set({ action: 'set', prKey, kind: 'no_action', note: 'Only bumps the pinned browser version; the lockfile matches.', by: 'review session', token: this.viewFor(prKey).token, coveredByPrKey: null, coverToken: null, leaseMinutes: null }, 'claude-code');
    this.written = 0;
  }
}
