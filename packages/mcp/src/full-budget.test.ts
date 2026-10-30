// pr_context with detail "full" on several PRs stays under a size budget.
// Seen 2026-10-30: 7 PRs came to about 87k characters, past the caller's
// tool output limit, so the answer spilled to a file.
import { FakeEngine } from '@postpile/server';
import { describe, expect, it } from 'vitest';
import { FULL_MANY_BUDGET, prContext, type ReadContext } from './reads.ts';

const KEYS = ['acme/app#1902', 'acme/app#1911', 'acme/app#1932', 'acme/app#1991'];

/** Sample data with `count` unread comments of `size` characters on every PR. */
class LongUnread extends FakeEngine {
  constructor(
    private readonly count: number,
    private readonly size: number,
  ) {
    // The mcp extra adds overlaps: acme/app#1902 overlaps acme/app#2301, whose author is read too.
    super({ setupStepMs: 0, syncStepMs: 0, extras: new Set(['mcp']) });
  }

  /** How many PR reads the answer took. */
  reads = 0;

  override async getPr(key: string) {
    this.reads += 1;
    const detail = await super.getPr(key);
    if (!detail) {
      return null;
    }
    const unread = Array.from({ length: this.count }, (_, index) => ({
      id: `e${index}`,
      kind: 'comment' as const,
      actor: 'alice',
      isBot: false,
      personTalk: true,
      at: '2026-10-29T10:00:00Z',
      summary: 'alice commented',
      body: 'y'.repeat(this.size),
    }));
    return { ...detail, unread };
  }
}

function contextOf(reader: FakeEngine): ReadContext {
  return { reader, now: () => new Date('2026-10-30T10:00:00Z'), appRunning: () => true };
}

/** The data between the fence tags. */
function fencedPart(text: string): string {
  return text.slice(text.indexOf('<postpile-data'), text.lastIndexOf('</postpile-data'));
}

describe('pr_context: several PRs with detail "full" keep under a size budget', () => {
  it('cuts nothing while the answer fits', async () => {
    const text = (await prContext(contextOf(new FakeEngine()), KEYS.slice(0, 2), 'full')).text;
    expect(text).not.toContain('Cut to keep');
  });

  it('caps activity and comment bodies first, and says how to get the rest', async () => {
    const ctx = contextOf(new LongUnread(8, 3000));
    const text = (await prContext(ctx, KEYS, 'full')).text;
    expect(fencedPart(text).length).toBeLessThanOrEqual(FULL_MANY_BUDGET + 200);
    expect(text).toContain('Cut to keep 4 PRs under 40000 characters: activity cut to the newest 10 lines per PR and unread comments to 400 characters each.');
    expect(text).toContain('call pr_context with detail: "full" on one PR at a time');
    expect(text).toContain("people's text up to 400 characters each");
    expect(text).toContain('… (cut)');
    // One PR alone is never cut.
    const alone = (await prContext(ctx, KEYS[0]!, 'full')).text;
    expect(alone).not.toContain('Cut to keep');
    expect(alone).toContain('y'.repeat(3000));
  });

  it('drops the activity and unread lists last, after the topics', async () => {
    const text = (await prContext(contextOf(new LongUnread(40, 3000)), KEYS, 'full')).text;
    expect(text).toContain('activity and unread lists left out; topics without dossier and tile list');
    expect(text).toContain('Activity and the unread list: cut to fit several PRs in one answer; pr_context on this PR alone has them.');
    expect(text).not.toContain('y'.repeat(400));
    expect(fencedPart(text).length).toBeLessThanOrEqual(FULL_MANY_BUDGET);
  });

  it('reads each PR and its overlaps once, however many cut passes it takes', async () => {
    const keys = KEYS;
    const brief = new LongUnread(40, 3000);
    await prContext(contextOf(brief), keys, 'brief');
    const full = new LongUnread(40, 3000);
    const text = (await prContext(contextOf(full), keys, 'full')).text;
    expect(text).toContain('activity and unread lists left out');
    expect(full.reads).toBe(brief.reads);
    expect(full.reads).toBeGreaterThan(keys.length);
  });

  it('stops at the budget when even the last cut is over, and says so', async () => {
    class LongTitles extends FakeEngine {
      override async getPr(key: string) {
        const detail = await super.getPr(key);
        return detail ? { ...detail, pr: { ...detail.pr, title: 'z'.repeat(15_000) } } : null;
      }
    }
    const text = (await prContext(contextOf(new LongTitles()), KEYS, 'full')).text;
    expect(fencedPart(text).length).toBeLessThanOrEqual(FULL_MANY_BUDGET);
    expect(text).toContain(`[Stopped here at ${FULL_MANY_BUDGET} characters: ask for fewer PRs.]`);
    expect(text).toContain('the rest past the limit');
  });
});
