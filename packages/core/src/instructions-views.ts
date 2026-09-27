// The user's general instructions (instructions.md) and their versions. The
// user owns this text: the agent only proposes changes, from the user's own
// chat messages, and nothing is written until the user accepts.

import type { ActionResult } from './views.ts';
import type { ChatMessage, IsoTime } from './types.ts';

/** chat: an accepted proposal. outside: the file changed on disk (hand edit, or the first time the app saw it). */
export type InstructionsOrigin = 'chat' | 'outside';

export interface InstructionsVersion {
  /** 1, 2, 3, ... */
  version: number;
  text: string;
  summary: string;
  origin: InstructionsOrigin;
  /** The user's chat message the change came from. Null for outside edits. */
  sourceChatMessageId: number | null;
  createdAt: IsoTime;
}

/** A version plus where it came from, for the history list. */
export interface InstructionsVersionView extends InstructionsVersion {
  /** The chat message text behind a chat version, when it is still stored. */
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
  /** The user's lasting point in their own words, so "only this topic" can keep it as tailoring instead. */
  point: string;
  /** The topic of the tile chat it came from; null from the general chat. */
  topicId: string | null;
  /** The user's own chat message it came from. Proposals never come from anything else. */
  sourceChatMessageId: number;
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

/** What the user accepts: the proposal as they left it, maybe edited inline. */
export interface InstructionsDecision {
  baseVersion: number | null;
  text: string;
  summary: string;
  sourceChatMessageId: number;
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
