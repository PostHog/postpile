import { describe, expect, it } from 'vitest';
import { debugEventLines, pingDecisionsByThread, threadPrKey } from './debug-notifications.ts';
import type { PingDecision } from './pings.ts';
import type { NotificationThread, PrEvent } from './types.ts';

function thread(overrides: Partial<NotificationThread>): NotificationThread {
  return {
    id: 't1',
    reason: 'review_requested',
    unread: true,
    updatedAt: '2026-09-27T10:00:00Z',
    lastReadAt: null,
    subjectType: 'PullRequest',
    repo: 'acme/app',
    number: 12,
    title: 'Something',
    ...overrides,
  };
}

function event(id: string, at: string, overrides: Partial<PrEvent> = {}): PrEvent {
  return {
    id,
    prKey: 'acme/app#12',
    kind: 'comment',
    actor: 'lyra',
    isBot: false,
    at,
    summary: `lyra said ${id}`,
    url: null,
    sourceId: id,
    ruleLoudness: 'loud',
    ruleReason: 'human comment',
    chatter: false,
    override: null,
    seenAt: null,
    ...overrides,
  };
}

describe('threadPrKey', () => {
  it('maps PullRequest threads to a PR key and nothing else', () => {
    expect(threadPrKey(thread({}))).toBe('acme/app#12');
    expect(threadPrKey(thread({ subjectType: 'Issue' }))).toBeNull();
    expect(threadPrKey(thread({ subjectType: 'PullRequest', number: null }))).toBeNull();
  });
});

describe('debugEventLines', () => {
  it('keeps the newest five, newest first, with the effective loudness', () => {
    const events = ['01', '02', '03', '04', '05', '06'].map((day) => event(`e${day}`, `2026-09-${day}T00:00:00Z`));
    events[5] = event('e06', '2026-09-06T00:00:00Z', { override: { loudness: 'muted', reason: 'bot noise', by: 'agent' }, seenAt: '2026-09-07T00:00:00Z' });
    const lines = debugEventLines(events);
    expect(lines.map((line) => line.id)).toEqual(['e06', 'e05', 'e04', 'e03', 'e02']);
    expect(lines[0]).toMatchObject({ loudness: 'muted', seen: true });
    expect(lines[1]).toMatchObject({ loudness: 'loud', seen: false });
  });
});

describe('pingDecisionsByThread', () => {
  function decision(threadId: string, at: string): PingDecision {
    return { threadId, prKey: 'acme/app#12', ping: false, source: 'rules', title: '', body: '', reason: 'quiet', at };
  }

  it('groups by thread, newest first, at most three each', () => {
    const decisions = ['01', '02', '03', '04'].map((minute) => decision('t1', `2026-09-27T10:${minute}:00Z`));
    const grouped = pingDecisionsByThread([...decisions, decision('t2', '2026-09-27T09:00:00Z')]);
    expect(grouped.get('t1')?.map((d) => d.at)).toEqual(['2026-09-27T10:04:00Z', '2026-09-27T10:03:00Z', '2026-09-27T10:02:00Z']);
    expect(grouped.get('t2')).toHaveLength(1);
  });
});
