// The board diet (DESIGN.md "The board diet"): board reads (`get`,
// `getMany`, `keepParsed`) leave out the bodies no board rule reads, from
// the json before the switch to rows and in SQL after it, so they equal
// `boardShape` of the full read either way and a cached copy never changes
// shape. `getFull` / `getFullMany` keep every stored body.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boardShape, canonicalPr, type FullComment, type FullPr } from '@postpile/core';
import { at, makeComment, makePr, makeReview } from '@postpile/core/fixtures';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DISCUSSION_READY_KEY, Store } from './index.ts';
import { JS_WHITESPACE } from './repos/pr-rows.ts';

let dir: string;
let path: string;
let store: Store;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'postpile-board-diet-'));
  path = join(dir, 'db.sqlite');
  store = Store.open(path);
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A PR with people's and bots' comments and reviews: what a board read must tell apart. */
function noisyPr(number: number): FullPr {
  const inline: FullComment = makeComment({
    id: `rc${number}`,
    kind: 'review_comment',
    author: 'greptile-apps[bot]',
    threadId: `t${number}`,
    path: 'src/a.ts',
    body: 'Consider a guard here',
    createdAt: at(13),
  });
  return makePr({
    number,
    body: 'Fixes the runner. cc @acme/team-infra',
    comments: [
      makeComment({ id: `c${number}`, body: 'Can @acme/team-platform take a look?', createdAt: at(10) }),
      makeComment({ id: `b${number}`, author: 'coderabbitai[bot]', body: 'Walkthrough, ping @acme/team-docs', createdAt: at(11) }),
      makeComment({ id: `q${number}`, author: 'trunk-io[bot]', body: '⏳ Testing', createdAt: at(11) }),
      makeComment({ id: `e${number}`, author: 'github-actions[bot]', body: 'Preview @viewer', createdAt: at(11), lastEditedAt: at(14), editor: 'bob' }),
      makeComment({ id: `rv${number}`, kind: 'review', author: 'greptile-apps[bot]', body: 'Summary: two risks', createdAt: at(12) }),
      inline,
    ],
    threads: [{ id: `t${number}`, path: 'src/a.ts', isResolved: false, comments: [inline] }],
    reviews: [
      makeReview({ id: `rv${number}`, author: 'greptile-apps[bot]', state: 'COMMENTED', body: 'Summary: two risks', submittedAt: at(12) }),
      makeReview({ id: `ra${number}`, author: 'copilot-pull-request-reviewer[bot]', state: 'COMMENTED', body: '', submittedAt: at(13) }),
      makeReview({ id: `rb${number}`, author: 'bob', state: 'APPROVED', body: '', submittedAt: at(15) }),
    ],
  });
}

function switchToRows(): void {
  store.meta.set(DISCUSSION_READY_KEY, at(40));
}

describe('the board read', () => {
  it('is boardShape of the full read before the switch, from the json', () => {
    const pr = noisyPr(1);
    store.prs.upsert(pr, at(1));
    expect(store.prs.getFull(pr.key)).toEqual(pr);
    expect(store.prs.get(pr.key)).toEqual(boardShape(pr));
    expect(store.prs.keepParsed([pr.key]).get(pr.key)).toEqual(boardShape(pr));
    expect(store.prs.get(pr.key)?.comments.map((comment) => comment.body)).toEqual([
      'Can @acme/team-platform take a look?',
      null,
      '⏳ Testing',
      'Preview @viewer',
      null,
      null,
    ]);
  });

  it('is boardShape of the full read after the switch, from the rows and the header', () => {
    const pr = noisyPr(1);
    store.prs.upsert(pr, at(1));
    switchToRows();
    store.prs.stripJson('discussion', pr.key);
    const full = store.prs.getFull(pr.key)!;
    expect(full).toEqual(canonicalPr(pr));
    expect(store.prs.get(pr.key)).toEqual(boardShape(full));
    expect(store.prs.getMany([pr.key]).get(pr.key)).toEqual(boardShape(full));
    expect(store.prs.get(pr.key)?.mentionedTeams).toEqual(['acme/team-docs', 'acme/team-infra', 'acme/team-platform']);
    expect(store.prs.getFullMany([pr.key]).get(pr.key)).toEqual(full);
    expect(store.prs.nextAfter('')?.pr).toEqual(full);
    expect(store.prs.listAll()).toEqual([full]);
  });

  it('leaves the bodies out in SQL on a read-only connection too', () => {
    const pr = noisyPr(1);
    store.prs.upsert(pr, at(1));
    switchToRows();
    const reader = Store.openReadOnly(path);
    try {
      expect(reader.prs.get(pr.key)).toEqual(boardShape(canonicalPr(pr)));
      expect(reader.prs.getFull(pr.key)).toEqual(canonicalPr(pr));
    } finally {
      reader.close();
    }
  });

  it('keeps a cached copy across the switch, the same shape a fresh read from rows gives', () => {
    const pr = noisyPr(1);
    store.prs.upsert(pr, at(1));
    const cached = store.prs.keepParsed([pr.key]).get(pr.key);
    expect(cached).toEqual(boardShape(pr));

    switchToRows();
    store.prs.stripJson('discussion', pr.key);

    expect(store.prs.keepParsed([pr.key]).get(pr.key)).toBe(cached);
    const reader = Store.openReadOnly(path);
    try {
      expect(reader.prs.get(pr.key)).toEqual(boardShape(canonicalPr(pr)));
      expect(canonicalPr(cached!)).toEqual(reader.prs.get(pr.key));
    } finally {
      reader.close();
    }
  });

  it('writes back what getFull read without losing a body', () => {
    const pr = noisyPr(1);
    store.prs.upsert(pr, at(1));
    switchToRows();
    store.prs.upsert({ ...store.prs.getFull(pr.key)!, title: 'Retitled' }, at(2));
    expect(store.prs.getFull(pr.key)).toEqual({ ...canonicalPr(pr), title: 'Retitled' });
    const json = store.db.prepare('SELECT json FROM pr_snapshot WHERE key = ?').get(pr.key) as { json: string };
    expect(JSON.parse(json.json)).not.toHaveProperty('mentionedTeams');
  });

  it('keeps an empty or whitespace bot body after the switch, as boardShape does', () => {
    const pr = makePr({
      comments: [
        makeComment({ id: 'w1', author: 'coderabbitai[bot]', body: '\u00a0\n\u2003' }),
        makeComment({ id: 'w2', author: 'coderabbitai[bot]', body: '\u00a0x' }),
      ],
    });
    store.prs.upsert(pr, at(1));
    switchToRows();
    expect(store.prs.get(pr.key)?.comments.map((comment) => comment.body)).toEqual(['\u00a0\n\u2003', null]);
    expect(store.prs.get(pr.key)).toEqual(boardShape(canonicalPr(pr)));
  });
});

describe('JS_WHITESPACE', () => {
  it('holds exactly the characters String.prototype.trim takes off', () => {
    const trimmed: string[] = [];
    for (let code = 0; code <= 0xffff; code += 1) {
      const char = String.fromCharCode(code);
      if (char.trim() === '') {
        trimmed.push(char);
      }
    }
    expect([...JS_WHITESPACE].sort()).toEqual(trimmed.sort());
  });
});

