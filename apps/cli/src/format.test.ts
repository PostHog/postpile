import { describe, expect, it } from 'vitest';
import { FakeEngine } from '@code-manager/server';
import { formatPr, formatTopic, formatTopics } from './format.ts';

describe('format over the fake engine', () => {
  it('prints topics, a topic and a PR as plain text', async () => {
    const engine = new FakeEngine();
    const topics = formatTopics(await engine.listTopics());
    expect(topics).toContain('* topic-depot  Move CI to Depot  (3 unread / 4)');

    const topic = await engine.getTopic('topic-depot');
    expect(topic).not.toBeNull();
    const topicText = formatTopic(topic!);
    expect(topicText).toContain('[unread] set: Three PRs change how Turbo caches');
    expect(topicText).toContain('! PostHog/posthog#41902: lyra mentioned you');

    const pr = await engine.getPr('PostHog/posthog#41921');
    expect(formatPr(pr!)).toContain('LOOKS_SAFE: Landing it apart from #41902');
  });
});
