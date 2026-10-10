// Failures and latency for the fake's GitHub writes, so busy states, error
// toasts and "nothing was sent" can be tried on sample data. Off unless an
// env switch asks for it (engineFromEnv):
//   POSTPILE_FAKE_FAIL_WRITES=approve,comment,once:reply   (or all)
//   POSTPILE_FAKE_FAIL_SEND=1   "Send N to GitHub" fails, the rows stay pending
//   POSTPILE_FAKE_DELAY_MS=1500 every write, draft, topic chat and recheck waits that long

/** The writes a fault can hit, by their action log name ("react" logs as `reaction`). */
export type FakeWriteKind = 'approve' | 'comment_review' | 'comment' | 'reply' | 'react' | 'mark_read';

const WRITE_KINDS: FakeWriteKind[] = ['approve', 'comment_review', 'comment', 'reply', 'react', 'mark_read'];

/** How GitHub answers a failed write of each kind: a server error, or the 403 an app token without the scope gets. */
const ANSWERS: Record<FakeWriteKind, { status: number; message: string }> = {
  approve: { status: 502, message: 'Server Error' },
  comment_review: { status: 502, message: 'Server Error' },
  comment: { status: 502, message: 'Server Error' },
  reply: { status: 502, message: 'Server Error' },
  react: { status: 403, message: 'Resource not accessible by integration' },
  mark_read: { status: 502, message: 'Server Error' },
};

function isWriteKind(word: string): word is FakeWriteKind {
  return (WRITE_KINDS as string[]).includes(word);
}

/** POSTPILE_FAKE_DELAY_MS as whole milliseconds >= 0; 0 (no delay) otherwise. */
export function fakeDelayFromEnv(value: string | undefined): number {
  const parsed = Number(value);
  return value !== undefined && value.trim() !== '' && Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export class FakeFaults {
  /**
   * `always`: kinds that fail every time; `once`: kinds that fail on their
   * first call only. `failSend`: the footer's "Send N to GitHub" fails.
   * `delayMs`: how long each write, draft, chat and recheck takes.
   */
  constructor(
    private readonly always = new Set<FakeWriteKind>(),
    private readonly once = new Set<FakeWriteKind>(),
    readonly failSend = false,
    readonly delayMs = 0,
  ) {}

  /** From POSTPILE_FAKE_FAIL_WRITES (comma separated kinds, `all`, `once:<kind>`), POSTPILE_FAKE_FAIL_SEND and POSTPILE_FAKE_DELAY_MS. Unknown words are ignored. */
  static fromEnv(failWrites: string | undefined, failSend: string | undefined, delayMs: string | undefined): FakeFaults {
    const always = new Set<FakeWriteKind>();
    const once = new Set<FakeWriteKind>();
    for (const word of (failWrites ?? '').split(',').map((part) => part.trim().toLowerCase())) {
      if (word === 'all') {
        WRITE_KINDS.forEach((kind) => always.add(kind));
      } else if (word.startsWith('once:') && isWriteKind(word.slice('once:'.length))) {
        once.add(word.slice('once:'.length) as FakeWriteKind);
      } else if (isWriteKind(word)) {
        always.add(word);
      }
    }
    return new FakeFaults(always, once, failSend === '1', fakeDelayFromEnv(delayMs));
  }

  /**
   * The error GitHub answers this write with, shaped like the GitHub
   * client's (`GitHub POST repos/... failed with 502: Server Error`), or
   * null when it goes through. A `once:` kind fails this one time.
   */
  failure(kind: FakeWriteKind, request: string): string | null {
    if (!this.always.has(kind) && !this.once.has(kind)) {
      return null;
    }
    this.once.delete(kind);
    const answer = ANSWERS[kind];
    return `GitHub ${request} failed with ${answer.status}: ${answer.message}`;
  }

  /** Waits POSTPILE_FAKE_DELAY_MS; returns right away without it. */
  async delay(): Promise<void> {
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
  }
}
