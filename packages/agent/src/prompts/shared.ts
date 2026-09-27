import { isBot, isMachineComment } from '@code-manager/core';
import type { Comment, Feedback, FeedbackKind, Pr, Viewer } from '@code-manager/core';
import type { PromptContext } from '../service.ts';

/** Trims a body to keep prompts bounded without losing the point. */
export function clip(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, max)} [...]`;
}

export function prLine(pr: Pr): string {
  const state = pr.isDraft && pr.state === 'OPEN' ? 'draft' : pr.state.toLowerCase();
  return `${pr.key} "${pr.title}" (${state}, by @${pr.author}, +${pr.additions}/-${pr.deletions} across ${pr.changedFiles} files)`;
}

const feedbackLabels: Record<FeedbackKind, string> = {
  not_mine: 'said this is not theirs',
  not_related: 'said these PRs are not related',
  wrong_topic: 'said this PR is in the wrong topic',
  unmute: 'unmuted an event that had been muted as noise',
  tailoring_kept: 'asked to keep this for the topic',
  tailoring_once: 'said this, for one time only',
};

function feedbackLine(feedback: Feedback): string {
  const about = [feedback.prKey, feedback.setId && `set ${feedback.setId}`, feedback.eventId && `event ${feedback.eventId}`]
    .filter(Boolean)
    .join(', ');
  const note = feedback.note.trim() ? `: ${clip(feedback.note, 300)}` : '';
  return `- ${feedback.createdAt.slice(0, 10)} ${feedbackLabels[feedback.kind]}${about ? ` (${about})` : ''}${note}`;
}

/**
 * The memory block every prompt carries: the user's general instructions, the
 * topic's confirmed tailoring and their newest corrections. Empty parts are
 * left out so a fresh install sends no empty headings.
 */
export function contextBlock(context: PromptContext): string {
  const parts: string[] = [];
  if (context.instructions.trim()) {
    parts.push(`About the user, in their own words. Let this shape every judgment below:\n\n${context.instructions.trim()}`);
  }
  if (context.tailoring.trim()) {
    parts.push(`Instructions the user gave for this topic. They override the general ones:\n\n${context.tailoring.trim()}`);
  }
  if (context.recentFeedback.length > 0) {
    const lines = context.recentFeedback.map(feedbackLine).join('\n');
    parts.push(`Recent corrections from the user, newest first. Do not repeat these mistakes:\n\n${lines}`);
  }
  return parts.length === 0 ? '' : `\n${parts.join('\n\n')}\n`;
}

export function viewerLine(viewer: Viewer): string {
  const teams = viewer.teams.length > 0 ? ` Their teams: ${viewer.teams.join(', ')}.` : '';
  return `The user is @${viewer.login} on GitHub.${teams}`;
}

/** Closing instruction shared by every prompt: bare JSON in a known shape. */
export function jsonOnly(shape: string): string {
  return `\nReply with JSON only: no preamble, no markdown, no code fences. Use exactly this shape:\n\n${shape}\n`;
}

/** Human comments across the PR, oldest first. Bot chatter is most of the volume and none of the signal. */
export function humanComments(pr: Pr): Comment[] {
  const seen = new Set<string>();
  const all: Comment[] = [];
  for (const comment of [...pr.comments, ...pr.threads.flatMap((thread) => thread.comments)]) {
    if (seen.has(comment.id) || isMachineComment(comment)) {
      continue;
    }
    seen.add(comment.id);
    all.push(comment);
  }
  return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export interface PrDetailLimits {
  body: number;
  files: number;
  comments: number;
  commentLength: number;
}

export const fullDetail: PrDetailLimits = { body: 4000, files: 25, comments: 15, commentLength: 400 };
export const shortDetail: PrDetailLimits = { body: 400, files: 6, comments: 0, commentLength: 0 };

/**
 * Description, files, review states and human discussion of one PR. viewer is
 * null where the prompt is not about the user's own review (chat).
 */
export function prDetails(pr: Pr, viewer: Viewer | null, limits: PrDetailLimits): string {
  const lines: string[] = [prLine(pr), `Base ${pr.baseRef} <- head ${pr.headRef}`];
  if (pr.labels.length > 0) {
    lines.push(`Labels: ${pr.labels.join(', ')}`);
  }
  lines.push(`Description:\n${clip(pr.body, limits.body) || '(empty)'}`);

  if (pr.files.length > 0 && limits.files > 0) {
    const files = pr.files.slice(0, limits.files).map((f) => `  ${f.path} (+${f.additions}/-${f.deletions})`);
    if (pr.files.length > limits.files) {
      files.push(`  ... and ${pr.files.length - limits.files} more`);
    }
    lines.push(`Changed files:\n${files.join('\n')}`);
  }

  const reviewers = [...pr.reviewerUsers.map((u) => `@${u}`), ...pr.reviewerTeams];
  if (reviewers.length > 0) {
    lines.push(`Pending review requests: ${reviewers.join(', ')}`);
  }
  const reviews = pr.reviews
    .filter((r) => !isBot(r.author) && r.author !== viewer?.login)
    .map((r) => `@${r.author} ${r.state.toLowerCase()}`);
  if (reviews.length > 0) {
    lines.push(`Review states: ${reviews.join(', ')}`);
  }
  const ownReview = viewer ? pr.reviews.filter((r) => r.author === viewer.login).at(-1) : undefined;
  if (ownReview) {
    const stale = ownReview.commitOid && ownReview.commitOid !== pr.headOid ? ', commits were pushed since' : '';
    lines.push(`The user's own last review: ${ownReview.state.toLowerCase()}${stale}`);
  }
  lines.push(`CI: ${pr.checks.rollup.toLowerCase()}`);

  if (limits.comments > 0) {
    const comments = humanComments(pr).slice(-limits.comments);
    if (comments.length > 0) {
      const rendered = comments.map((c) => {
        const where = c.path ? ` on ${c.path}` : '';
        return `  @${c.author}${where}: ${clip(c.body, limits.commentLength)}`;
      });
      lines.push(`Human discussion, oldest first:\n${rendered.join('\n')}`);
    }
  }
  return lines.join('\n');
}
