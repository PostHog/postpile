import { describe, expect, it } from 'vitest';
import { botFindings, FINDING_MAX, findingLine } from './bot-findings.ts';
import { at, makePr, makeReview } from './fixtures.ts';

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
