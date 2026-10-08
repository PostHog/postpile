import { describe, expect, it } from 'vitest';
import { botFindings, FINDING_MAX, findingLine } from './bot-findings.ts';
import { at, makeComment, makePr, makeReview } from './fixtures.ts';
import type { FullComment } from './types.ts';

describe('findingLine', () => {
  it('takes the first sentence of the first text line, past the heading and badges', () => {
    const body = [
      '<!-- reviewbot:v2 -->',
      '## 🔒 Security review',
      '[![status](https://img.example/badge.svg)](https://ci.example/run/1)',
      '',
      '**team-platform** has no write access to [acme/app](https://github.com/acme/app), so GitHub ignores its CODEOWNERS line. Ask an org admin to grant it.',
    ].join('\n');
    expect(findingLine(body)).toBe('team-platform has no write access to acme/app, so GitHub ignores its CODEOWNERS line.');
  });

  it('falls back to the heading when there is no text line', () => {
    expect(findingLine('### Missing changelog entry\n\n| file | note |\n|---|---|')).toBe('Missing changelog entry');
  });

  it('skips code blocks and list bullets', () => {
    expect(findingLine('```diff\n- old\n+ new\n```\n- Pin the `node` version in CI.')).toBe('Pin the node version in CI.');
  });

  it('caps a long line at a word boundary', () => {
    const line = findingLine(`${'word '.repeat(60)}end`)!;
    expect(line.length).toBeLessThanOrEqual(FINDING_MAX);
    expect(line.endsWith('word…')).toBe(true);
  });

  it('stays fast on text full of openers', () => {
    const started = Date.now();
    findingLine(`${'<'.repeat(30_000)}${'['.repeat(30_000)}${'!['.repeat(30_000)}`);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('is null without words', () => {
    expect(findingLine('<!-- marker -->\n![badge](https://img.example/b.svg)\n---')).toBeNull();
    expect(findingLine('')).toBeNull();
  });
});

describe('botFindings', () => {
  it("lists each bot's standing change request, from its newest one, and never a person's", () => {
    const pr = makePr({
      reviews: [
        makeReview({ id: 'r1', author: 'reviewbot[bot]', state: 'CHANGES_REQUESTED', body: 'Old finding.', submittedAt: at(1) }),
        makeReview({ id: 'r2', author: 'reviewbot[bot]', state: 'CHANGES_REQUESTED', body: 'Grant team-platform write access.', submittedAt: at(2) }),
        makeReview({ id: 'r3', author: 'ada', state: 'CHANGES_REQUESTED', body: 'Please rename this.', submittedAt: at(3) }),
      ],
    });
    expect(botFindings(pr)).toEqual([{ by: 'reviewbot[bot]', summary: 'Grant team-platform write access.' }]);
  });

  describe('when the review text only points at its inline comments', () => {
    const bot = 'guardbot[bot]';
    const review = makeReview({ id: 'rev-9', author: bot, state: 'CHANGES_REQUESTED', body: 'Automated policy review - findings inline.', submittedAt: at(20) });
    const inline = (id: string, body: string, overrides: Partial<FullComment> = {}): FullComment =>
      makeComment({ id, author: bot, kind: 'review_comment', path: 'src/policy.ts', threadId: `t-${id}`, reviewId: 'rev-9', createdAt: at(20), body, ...overrides });
    const finding = '### The plugin allowlist is never checked: team-plugins has no write grant, so its CODEOWNERS line is ignored.\n\nDetails follow.';

    it('takes the first inline comment of that review, with how many more there are', () => {
      const pr = makePr({ reviews: [review], comments: [inline('c1', finding), inline('c2', 'Second finding.', { createdAt: at(21) })] });
      const summary = botFindings(pr)[0]!.summary;
      expect(summary.startsWith('The plugin allowlist is never checked: team-plugins has no write grant')).toBe(true);
      expect(summary.endsWith(' (+1 more)')).toBe(true);
      expect(summary.length).toBeLessThanOrEqual(FINDING_MAX);
    });

    it("never takes another author's comment, and falls back to the review text without inline findings", () => {
      const pr = makePr({ reviews: [review], comments: [inline('c1', 'A person wrote this.', { author: 'ada' })] });
      expect(botFindings(pr)).toEqual([{ by: bot, summary: 'Automated policy review - findings inline.' }]);
    });

    it("uses the bot's inline comments at or after the review when they carry no review id", () => {
      const older = inline('c0', 'An older finding.', { reviewId: undefined, createdAt: at(5) });
      const after = inline('c1', 'Pin the plugin registry version.', { reviewId: undefined, createdAt: at(20) });
      const pr = makePr({ reviews: [review], comments: [older, after] });
      expect(botFindings(pr)).toEqual([{ by: bot, summary: 'Pin the plugin registry version.' }]);
    });

    it('keeps a finding that only uses the word "inline"', () => {
      const own = { ...review, body: 'Inline cache invalidation is broken when the plugin version changes.' };
      const pr = makePr({ reviews: [own], comments: [inline('c1', finding)] });
      expect(botFindings(pr)[0]!.summary).toBe('Inline cache invalidation is broken when the plugin version changes.');
    });

    it('keeps a review text that says the finding itself', () => {
      const clear = { ...review, body: 'team-plugins has no write grant on acme/app, so GitHub ignores its CODEOWNERS line.' };
      const pr = makePr({ reviews: [clear], comments: [inline('c1', finding)] });
      expect(botFindings(pr)[0]!.summary).toBe('team-plugins has no write grant on acme/app, so GitHub ignores its CODEOWNERS line.');
    });
  });

  it('drops a bot whose newest verdict is no longer a change request', () => {
    const pr = makePr({
      reviews: [
        makeReview({ id: 'r1', author: 'reviewbot[bot]', state: 'CHANGES_REQUESTED', body: 'Fix it.', submittedAt: at(1) }),
        makeReview({ id: 'r2', author: 'reviewbot[bot]', state: 'APPROVED', body: '', submittedAt: at(2) }),
      ],
    });
    expect(botFindings(pr)).toEqual([]);
  });
});
