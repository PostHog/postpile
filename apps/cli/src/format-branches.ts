import type { BranchEntry, BranchesView } from '@postpile/core';

/** "you: merge", "them: alice", "none". */
function moveText(entry: BranchEntry): string {
  const { whoseMove } = entry;
  if (whoseMove.kind === 'you') {
    return `you: ${whoseMove.move}`;
  }
  if (whoseMove.kind === 'them') {
    return `them: ${whoseMove.who ?? 'queue'}`;
  }
  return 'none';
}

/** The signals worth a word, in a fixed order; empty when none is set. */
function signalWords(entry: BranchEntry): string[] {
  const { signals } = entry;
  const words: string[] = [];
  if (signals.readyToLand) {
    words.push('ready to land');
  }
  const feedback = signals.feedback;
  if (feedback) {
    if (feedback.changesRequested.length > 0) {
      words.push(`changes by ${feedback.changesRequested.map((request) => request.by).join(',')}`);
    }
    if (feedback.unansweredThreads > 0) {
      words.push(`${feedback.unansweredThreads} thread${feedback.unansweredThreads === 1 ? '' : 's'} waiting`);
    }
    if (feedback.botDecline) {
      words.push(`${feedback.botDecline.agent} declined${feedback.botDecline.olderHead ? ' (older head)' : ''}`);
    }
  }
  const pushes = signals.pushesSinceYourReview;
  if (pushes) {
    words.push(`+${pushes.commitsSince} commit${pushes.commitsSince === 1 ? '' : 's'} since your review`);
  }
  const replies = signals.repliesSinceYourReview;
  if (replies) {
    words.push(`${replies.count} repl${replies.count === 1 ? 'y' : 'ies'} since you spoke`);
  }
  if (signals.ended) {
    words.push(`${signals.ended.state} ${signals.ended.at.slice(0, 10)}`);
  }
  return words;
}

/** One compact line per PR: key, role, state, head branch, whose move, signals, title. */
export function formatBranches(view: BranchesView): string {
  if (view.prs.length === 0) {
    return `no own or reviewed PRs for @${view.viewer} in this window`;
  }
  return view.prs
    .map((entry) => {
      const state = entry.draft ? 'draft' : entry.state;
      const signals = signalWords(entry);
      const tail = signals.length > 0 ? `  [${signals.join('; ')}]` : '';
      return `${entry.key}  ${entry.role}  ${state}  ${entry.headRef}  ${moveText(entry)}${tail}  ${entry.untrusted.title}`;
    })
    .join('\n');
}
