import type { EventKind, UnreadKind } from '@postpile/core';

/**
 * The small glyph set for events, grouped: talking to you (at, question,
 * reply, eye), review outcome (check, changes, bubble), code moved (commit,
 * also for commits after approval and force pushes), lifecycle (merge,
 * closed, ready, draft), pipeline (ci, deploy, queue), comment (bubble), bot.
 */
export type EventGlyph =
  | 'at'
  | 'question'
  | 'reply'
  | 'eye'
  | 'check'
  | 'changes'
  | 'bubble'
  | 'commit'
  | 'merge'
  | 'closed'
  | 'ready'
  | 'draft'
  | 'ci'
  | 'deploy'
  | 'queue'
  | 'bot';

const GLYPHS: Record<EventKind, EventGlyph> = {
  mention: 'at',
  team_mention: 'at',
  question_to_user: 'question',
  reply_to_user: 'reply',
  review_requested: 'eye',
  review_request_removed: 'eye',
  review_approved: 'check',
  review_changes_requested: 'changes',
  review_commented: 'bubble',
  comment: 'bubble',
  commits_pushed: 'commit',
  commits_after_approval: 'commit',
  force_pushed: 'commit',
  merged: 'merge',
  merged_without_review: 'merge',
  closed: 'closed',
  reopened: 'ready',
  ready_for_review: 'ready',
  converted_to_draft: 'draft',
  ci: 'ci',
  deploy: 'deploy',
  merge_queue: 'queue',
  bot_comment: 'bot',
};

/** A bring-back has no event behind it; it gets the "look at this" eye. */
export function eventGlyph(kind: UnreadKind): EventGlyph {
  return kind === 'brought_back' ? 'eye' : GLYPHS[kind];
}

/** Summaries start with the actor ("rowan pushed ..."); split it off so it can be drawn bold. */
export function splitActor(summary: string, actor: string): { actor: string; rest: string } | null {
  if (actor && summary.startsWith(`${actor} `)) {
    return { actor, rest: summary.slice(actor.length) };
  }
  return null;
}
