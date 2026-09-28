import { pingTemplate, type PingDecision, type PrEvent, type Tile } from '@code-manager/core';
import type { PollCycle } from '@code-manager/engine';
import type { SampleData } from './sample-data.ts';

/** How often the fake poll finds something new, so the ping flow can be watched. */
export const FAKE_PING_EVERY_MS = 45_000;

const ASKERS = ['rowan', 'lyra', 'nell'];
const ASKS = [
  'can you check the cache key before I merge?',
  'does this runner size look right to you?',
  'could you re-review after the last push?',
];

/**
 * Stand-in for the fast poll on the sample data: every ~45s a sample PR gets
 * a new question for the user, its tile turns unread, and a fake decision
 * pings. In between it answers like a 304. No GitHub, no agent.
 */
export class FakeLivePoll {
  private lastPingAt: number;
  private count = 0;

  constructor(
    private readonly data: SampleData,
    private readonly now: () => Date,
  ) {
    this.lastPingAt = now().getTime();
  }

  /** Open tiles with a pinged PR, in sample order; the fake walks through them. */
  private tiles(): Tile[] {
    return this.data.tiles.filter((tile) =>
      tile.members.some((member) => {
        const pr = this.data.prs.find((candidate) => candidate.key === member.prKey);
        return member.provenance.kind === 'pinged' && pr?.state === 'OPEN';
      }),
    );
  }

  poll(): PollCycle {
    const nowMs = this.now().getTime();
    const quiet: PollCycle = { kind: 'done', notModified: true, githubPollIntervalSeconds: 60, prsUpdated: 0, decisions: [], pings: [], errors: [] };
    const tiles = this.tiles();
    if (nowMs - this.lastPingAt < FAKE_PING_EVERY_MS || tiles.length === 0) {
      return quiet;
    }
    this.lastPingAt = nowMs;
    const n = this.count++;
    const tile = tiles[n % tiles.length]!;
    const member = tile.members.find((candidate) => candidate.provenance.kind === 'pinged')!;
    const pr = this.data.prs.find((candidate) => candidate.key === member.prKey)!;
    const at = new Date(nowMs).toISOString();
    const actor = ASKERS[n % ASKERS.length]!;
    const event: PrEvent = {
      id: `${pr.key}:question_to_user:fake-live-${n}`,
      prKey: pr.key,
      kind: 'question_to_user',
      actor,
      isBot: false,
      at,
      summary: `${actor} asked: @${this.data.viewer} ${ASKS[n % ASKS.length]}`,
      url: pr.url,
      sourceId: `fake-live-${n}`,
      ruleLoudness: 'loud',
      ruleReason: 'asks you a question',
      override: null,
      seenAt: null,
    };
    this.data.events.push(event);
    const text = pingTemplate(event, pr);
    const decision: PingDecision = {
      threadId: `fake-thread-${pr.ref.number}`,
      prKey: pr.key,
      ping: true,
      ...text,
      reason: 'fake decision: sample questions always ping',
      source: 'rules',
      at,
    };
    return {
      kind: 'done',
      notModified: false,
      githubPollIntervalSeconds: 60,
      prsUpdated: 1,
      decisions: [decision],
      pings: [{ ...text, target: { topicId: tile.topicId, tileId: tile.id, prKey: pr.key } }],
      errors: [],
    };
  }
}
