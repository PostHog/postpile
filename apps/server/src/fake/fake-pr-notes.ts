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
  pendingNote,
  refusedNote,
  type NoteReadContext,
  type PrKey,
  type PrNote,
  type PrNoteRequest,
  type PrNoteResult,
  type PrNotesView,
} from '@postpile/core';
import type { CoverRead } from '@postpile/engine';
import { fakeGitHubKnows } from './fake-note-cover.ts';
import type { SampleData } from './sample-data.ts';

/** Reads a covering PR the sample does not have (NoteCoverReader over FakeNoteCover); null: nothing can be read. */
export type FakeCoverReader = { read: (cover: PrKey, notedKey: PrKey) => Promise<CoverRead> } | null;

/** What one set came to: the answer, or the covering PR it needs first. */
type SetStep = { kind: 'done'; result: PrNoteResult } | { kind: 'needs_cover'; coverKey: PrKey };

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
    private readonly covers: FakeCoverReader = null,
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

  private setStep(request: Extract<PrNoteRequest, { action: 'set' }>, client: string): SetStep {
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
      return { kind: 'done', result: refusedNote(plan.reason) };
    }
    if (plan.kind === 'needs_cover') {
      return plan;
    }
    if (plan.kind === 'unchanged') {
      return { kind: 'done', result: { status: 'unchanged', note: prNoteView(plan.note, read), replaced: null, anchored: anchorSummary(plan.note.anchor), reason: null } };
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
    return { kind: 'done', result: { status: 'set', note: prNoteView(note, read), replaced: plan.replaces ? prNoteView(plan.replaces, read) : null, anchored: anchorSummary(note.anchor), reason: null } };
  }

  /** What a covering PR read that stored nothing means for the note: the engine's words. */
  private coverOutcome(read: Exclude<CoverRead, { kind: 'stored' }>, cover: PrKey): PrNoteResult {
    if (read.kind === 'pending') {
      return pendingNote(`PostPile is still reading ${cover} from GitHub; call note_pr again with the same arguments in a minute`);
    }
    if (read.kind === 'not_found') {
      return refusedNote(`GitHub has no PR ${cover} that PostPile can read; check covered_by`);
    }
    return refusedNote(read.reason);
  }

  /**
   * A set. A covering PR outside the sample is "read" first when the
   * sample's stand-in for GitHub knows its number (fake-note-cover.ts),
   * then the set is planned again, like the engine. Any other PR outside
   * the sample is refused.
   */
  private async set(request: Extract<PrNoteRequest, { action: 'set' }>, client: string): Promise<PrNoteResult> {
    const first = this.setStep(request, client);
    if (first.kind === 'done') {
      return first.result;
    }
    if (this.covers === null || !fakeGitHubKnows(first.coverKey)) {
      return refusedNote(`the sample data has no PR ${first.coverKey}, and the sample-data engine reads nothing from GitHub`);
    }
    const read = await this.covers.read(first.coverKey, request.prKey);
    if (read.kind !== 'stored') {
      return this.coverOutcome(read, first.coverKey);
    }
    const second = this.setStep(request, client);
    return second.kind === 'done' ? second.result : refusedNote(`PostPile could not store ${second.coverKey}`);
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

  async handle(request: PrNoteRequest, client: string): Promise<PrNoteResult> {
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
    this.setStep({ action: 'set', prKey, kind: 'no_action', note: 'Only bumps the pinned browser version; the lockfile matches.', by: 'review session', token: this.viewFor(prKey).token, coveredByPrKey: null, coverToken: null, leaseMinutes: null }, 'claude-code');
    this.written = 0;
  }
}
