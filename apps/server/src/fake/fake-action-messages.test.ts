// The fake's action toasts use the real engine's words (TileActions,
// FeedbackActions, results.ts), never raw ids or enum keys.
import { describe, expect, it } from 'vitest';
import { FakeEngine } from './fake-engine.ts';

const NOW = new Date('2026-09-27T10:00:00Z');

function engine(options: { writesLocked?: boolean } = {}): FakeEngine {
  return new FakeEngine({ now: () => NOW, syncStepMs: 0, recheckDelayMs: 0, sweepDelayMs: 0, ...options });
}

describe('fake action messages', () => {
  it('says "Marked read" for a tile and a PR', async () => {
    const fake = engine();
    expect((await fake.markRead('pr:acme/infra#1915')).message).toBe('Marked read');
    expect((await fake.markPrRead('set:turbo-cache', (await fake.getTopic('topic-depot'))!.tiles.find((view) => view.tile.id === 'set:turbo-cache')!.prs[0]!.key)).message).toBe('Marked read');
  });

  it('says the read is pending while writes are locked, like readMessage', async () => {
    const fake = engine({ writesLocked: true });
    expect((await fake.markRead('set:turbo-cache')).message).toBe('Marked read: pending until you unlock GitHub writes, stays unread here until then');
  });

  it('says "Snoozed", without the condition kind', async () => {
    const result = await engine().snooze('pr:acme/app#1822', { kind: 'until_time', until: '2026-09-27T11:00:00.000Z' });
    expect(result).toMatchObject({ ok: true, message: 'Snoozed' });
  });

  it('says "Noted: not yours, marked read" for Not mine', async () => {
    const result = await engine().giveFeedback({ kind: 'not_mine', tileId: 'pr:acme/infra#1915', prKey: null, targetTopicId: null, note: '' });
    expect(result).toMatchObject({ ok: true, message: 'Noted: not yours, marked read' });
    expect(result.undoToken).not.toBeNull();
  });

  it('says "Moved" for a move to another topic, never the topic id', async () => {
    const result = await engine().giveFeedback({ kind: 'wrong_topic', tileId: 'pr:acme/infra#1915', prKey: 'acme/infra#1915', targetTopicId: 'topic-ci-tests', note: '' });
    expect(result).toMatchObject({ ok: true, message: 'Moved' });
  });

  it('says "Undone" and refuses a late undo like TileActions', async () => {
    let now = NOW;
    const fake = new FakeEngine({ now: () => now, syncStepMs: 0 });
    const first = await fake.markRead('pr:acme/infra#1915');
    expect((await fake.undo(first.undoToken)).message).toBe('Undone');
    const second = await fake.markRead('pr:acme/infra#1915');
    now = new Date(now.getTime() + 7000);
    expect((await fake.undo(second.undoToken)).message).toBe('Nothing to undo: already sent to GitHub');
  });
});
