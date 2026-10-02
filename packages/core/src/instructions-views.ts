// The user's general instructions (instructions.md) and their versions. The
// user owns this text: the agent only proposes changes, from the user's own
// chat messages or a lesson they chose to use across topics, and nothing is
// written until the user accepts.

import type { ActionResult } from './views.ts';
import type { ChatMessage, IsoTime } from './types.ts';

/**
 * chat: an accepted proposal. outside: the file changed on disk (hand edit,
 * or the first time the app saw it). setup: accepted in the setup flow.
 * lesson: an accepted proposal from a lesson ("Use across topics").
 */
export type InstructionsOrigin = 'chat' | 'outside' | 'setup' | 'lesson';

export interface InstructionsVersion {
  /** 1, 2, 3, ... */
  version: number;
  text: string;
  summary: string;
  origin: InstructionsOrigin;
  /** The user's chat message the change came from. Null for outside edits, setup and lessons. */
  sourceChatMessageId: number | null;
  /** The lesson the user chose to use across topics (origin lesson). Null otherwise. */
  sourceLessonId: number | null;
  createdAt: IsoTime;
}

/** A version plus where it came from, for the history list. */
export interface InstructionsVersionView extends InstructionsVersion {
  /** The chat message text behind a chat version, or the lesson line behind a lesson version, when still stored. */
  sourceText: string | null;
}

/** A proposed new text, shown as a line diff against baseText. Nothing is written until the user accepts. */
export interface InstructionsProposal {
  /** The version the proposal was written against. Null when no version is stored yet. */
  baseVersion: number | null;
  baseText: string;
  /** The full new text. */
  text: string;
  /** One short line on what changes. */
  summary: string;
  /**
   * Where it came from: one of the user's own chat messages, or a lesson
   * they chose to use across topics. Exactly one is set; proposals never
   * come from anything else.
   */
  sourceChatMessageId: number | null;
  sourceLessonId: number | null;
  /** Topic dossiers that refresh once on the next sync if this is accepted. */
  dossiersToRefresh: number;
}

export interface InstructionsView {
  text: string;
  /** Null until the app has seen a file with any text in it. */
  version: number | null;
  /** Where the file lives, for hand edits. Null on sample data, where nothing is written to disk. */
  path: string | null;
  /** Newest first. */
  versions: InstructionsVersionView[];
  /** Topic dossiers that refresh once on the next sync after an accepted change. */
  dossiersToRefresh: number;
}

/** What the user accepts: the proposal, and its text as they left it (maybe edited inline). */
export interface InstructionsDecision {
  proposal: InstructionsProposal;
  text: string;
}

/** A proposal, or the agent's one-line reason why the message changes nothing across topics. */
export interface InstructionsProposalReply {
  reply: string;
  proposal: InstructionsProposal | null;
}

export interface InstructionsSaveResult extends ActionResult {
  /** The version written; null when nothing was written. */
  savedVersion: number | null;
  /**
   * Set when the file changed on disk after the proposal was made: the hand
   * edit is stored as its own version and this is the same request redone
   * on top of it, for the user to decide again.
   */
  rebased: InstructionsProposal | null;
}

/** The general chat in the "Your instructions" view. */
export interface InstructionsChatReply {
  message: ChatMessage;
  proposal: InstructionsProposal | null;
}
