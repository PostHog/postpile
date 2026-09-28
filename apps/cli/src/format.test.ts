import { describe, expect, it } from 'vitest';
import { FakeEngine } from '@postpile/server';
import { formatPoll, formatPr, formatTopic, formatTopics } from './format.ts';

describe('format over the fake engine', () => {
  it('prints topics, a topic and a PR as plain text', async () => {
    const engine = new FakeEngine();
    const topics = formatTopics(await engine.listTopics());
    expect(topics).toContain('* topic-depot  Move CI to Depot  (3 unread / 4)');

    const topic = await engine.getTopic('topic-depot');
    expect(topic).not.toBeNull();
    const topicText = formatTopic(topic!);
    expect(topicText).toContain('[unread] set: Three PRs change how Turbo caches');
    expect(topicText).toContain('! acme/app#1902: lyra mentioned you');

    const pr = await engine.getPr('acme/app#1921');
    expect(formatPr(pr!)).toContain('LOOKS_SAFE: Landing it apart from #1902');
  });

  it('prints a poll cycle with its ping decisions', async () => {
    let now = new Date('2026-09-27T10:00:00Z');
    const engine = new FakeEngine({ now: () => now });
    expect(formatPoll(await engine.pollOnce())).toBe('notifications unchanged (304)\nGitHub X-Poll-Interval: 60s');
    now = new Date(now.getTime() + 45_000);
    const text = formatPoll(await engine.pollOnce());
    expect(text).toContain('PRs updated 1');
    expect(text).toMatch(/PING acme\/app#\d+ \(rules\): fake decision/);
    expect(formatPoll({ kind: 'blocked', reason: 'full sync running' })).toBe('poll blocked: full sync running');
  });
});
