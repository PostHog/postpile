import { excludedTopicIds, type Feedback, type PrKey, type TopicMergeLink } from '@postpile/core';
import type { Store } from '@postpile/store';

/**
 * Where the user said PRs do not go ("Wrong topic"), read once for a topic
 * assignment or a tidy step. The rules and the agent answers check it
 * before they place a PR (DESIGN.md › Product model, "Wrong topic"
 * sticks). "Wrong topic" on a stack is logged for every layer that moved,
 * so each layer carries its own "no".
 */
export class TopicExclusions {
  /** Empty until `load`: no PR is kept out of any topic. */
  constructor(
    private readonly wrongTopicsByPr = new Map<PrKey, Feedback[]>(),
    private readonly merges: TopicMergeLink[] = [],
  ) {}

  static load(store: Store): TopicExclusions {
    const byPr = new Map<PrKey, Feedback[]>();
    for (const row of store.feedback.listAllOfKind('wrong_topic')) {
      if (row.prKey !== null) {
        byPr.set(row.prKey, [...(byPr.get(row.prKey) ?? []), row]);
      }
    }
    return new TopicExclusions(byPr, store.proposals.listAcceptedMerges());
  }

  /** The topics none of these PRs may be put in by a rule or the agent. */
  forKeys(keys: PrKey[]): Set<string> {
    const feedback = keys.flatMap((key) => this.wrongTopicsByPr.get(key) ?? []);
    return excludedTopicIds(feedback, this.merges);
  }
}
