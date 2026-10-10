// The toast words for a pane write GitHub refused. The engine passes on the
// GitHub client's line ("Approve failed: GitHub POST repos/acme/app/pulls/1870/reviews
// failed with 502: Server Error"); the toast says it in plain words and keeps
// the raw line for its hover title.

/** Pane writes that reach GitHub at once and can come back refused. */
export type PaneWrite = 'approve' | 'commentReview' | 'comment' | 'reply' | 'react';

export interface WriteFailureText {
  message: string;
  /** The raw line, for the toast's hover title. Null when the message already is the raw line. */
  detail: string | null;
}

const WHAT: Record<PaneWrite, string> = {
  approve: 'the approval',
  commentReview: 'the comment review',
  comment: 'the comment',
  reply: 'the reply',
  react: 'the thumbs up',
};

const AFTER: Record<PaneWrite, string> = {
  approve: 'Nothing was approved.',
  commentReview: 'Nothing was posted, your text is kept.',
  comment: 'Nothing was posted, your text is kept.',
  reply: 'Nothing was posted, your text is kept.',
  react: 'Nothing was added.',
};

// An optional "<Action> failed: " from the engine, then the GitHub client's own line.
const GITHUB_ERROR = /^(?:[A-Z][\w ]* failed: )?GitHub \S+ \S+ failed with (\d{3})/;

function statusWords(status: number): string {
  if (status >= 500) {
    return `server error ${status}`;
  }
  if (status === 401) {
    return `not signed in, ${status}`;
  }
  if (status === 403) {
    return `no permission or rate limited, ${status}`;
  }
  if (status === 404) {
    return `not found, ${status}`;
  }
  return `refused with ${status}`;
}

/**
 * "GitHub didn't take the approval (server error 502). Nothing was approved."
 * A message that is not GitHub's error line (the head moved, the PR closed)
 * already says what happened and stays as it is.
 */
export function writeFailureText(write: PaneWrite, raw: string): WriteFailureText {
  const match = GITHUB_ERROR.exec(raw);
  if (!match) {
    return { message: raw, detail: null };
  }
  const status = Number(match[1]);
  return { message: `GitHub didn't take ${WHAT[write]} (${statusWords(status)}). ${AFTER[write]}`, detail: raw };
}
