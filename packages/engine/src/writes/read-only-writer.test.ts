import { describe, expect, it } from 'vitest';
import { ReadOnlyWriter } from './read-only-writer.ts';

describe('ReadOnlyWriter', () => {
  it('refuses every write', async () => {
    const writer = new ReadOnlyWriter();
    const ref = { repo: 'o/r', number: 1 };
    await expect(writer.markThreadRead('t1')).rejects.toThrow(/read-only/);
    await expect(writer.approvePr(ref)).rejects.toThrow(/read-only/);
    await expect(writer.commentReviewPr(ref)).rejects.toThrow(/read-only/);
    await expect(writer.commentOnPr(ref)).rejects.toThrow(/read-only/);
  });
});
