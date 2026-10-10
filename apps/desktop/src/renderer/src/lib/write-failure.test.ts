import { describe, expect, it } from 'vitest';
import { writeFailureText } from './write-failure.ts';

describe('writeFailureText', () => {
  it('says a refused approval in plain words and keeps the raw line', () => {
    const raw = 'Approve failed: GitHub POST repos/acme/app/pulls/1870/reviews failed with 502: Server Error';

    expect(writeFailureText('approve', raw)).toEqual({
      message: "GitHub didn't take the approval (server error 502). Nothing was approved.",
      detail: raw,
    });
  });

  it('says a refused reply keeps the text', () => {
    const raw = 'Reply failed: GitHub POST repos/acme/app/issues/12/comments failed with 403: Resource not accessible';

    expect(writeFailureText('reply', raw).message).toBe("GitHub didn't take the reply (no permission or rate limited, 403). Nothing was posted, your text is kept.");
  });

  it('takes the GitHub line without the engine prefix too', () => {
    expect(writeFailureText('react', 'GitHub POST repos/acme/app/issues/comments/1/reactions failed with 422').message).toBe(
      "GitHub didn't take the thumbs up (refused with 422). Nothing was added.",
    );
  });

  it('leaves a message that is not a GitHub error line alone', () => {
    const raw = 'New commits since you looked: nothing was approved';

    expect(writeFailureText('approve', raw)).toEqual({ message: raw, detail: null });
  });
});
