import type { PromptContext } from '@code-manager/agent';
import type { Store } from '@code-manager/store';
import type { InstructionsHistory } from './instructions/history.ts';

/** How many corrections per topic go back into prompts. */
export const FEEDBACK_IN_PROMPTS = 10;

/**
 * Builds the memory block for prompts. The instructions file is read on
 * every call so an edit takes effect on the next sync without a restart.
 */
export class PromptContextSource {
  /** workContext gives the digest text for prompts ('' when none); tests may leave it out. */
  constructor(
    private readonly store: Store,
    private readonly history: InstructionsHistory,
    private readonly workContext: () => string = () => '',
  ) {}

  /** Accepted global rules from consolidation. Accepted topic rules live in the topic's tailoring instead. */
  private standingRules(): string[] {
    return this.store.ruleProposals.listAcceptedGlobal().map((rule) => rule.text);
  }

  forTopic(topicId: string | null): PromptContext {
    const { text: instructions, version: instructionsVersion } = this.history.current();
    if (topicId === null) {
      return {
        instructions,
        instructionsVersion,
        tailoring: '',
        recentFeedback: this.store.feedback.recent(FEEDBACK_IN_PROMPTS),
        standingRules: this.standingRules(),
        workContext: this.workContext(),
      };
    }
    const topic = this.store.topics.get(topicId);
    return {
      instructions,
      instructionsVersion,
      tailoring: topic?.tailoring ?? '',
      recentFeedback: this.store.feedback.recentForTopic(topicId, FEEDBACK_IN_PROMPTS),
      standingRules: this.standingRules(),
      workContext: this.workContext(),
    };
  }
}
