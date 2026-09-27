import type { PromptContext } from '@code-manager/agent';
import type { Store } from '@code-manager/store';
import { readInstructions } from './instructions.ts';

/** How many corrections per topic go back into prompts. */
export const FEEDBACK_IN_PROMPTS = 10;

/**
 * Builds the memory block for prompts. The instructions file is read on
 * every call so an edit takes effect on the next sync without a restart.
 */
export class PromptContextSource {
  constructor(
    private readonly store: Store,
    private readonly instructionsFile: string,
  ) {}

  instructions(): string {
    return readInstructions(this.instructionsFile);
  }

  forTopic(topicId: string | null): PromptContext {
    const instructions = this.instructions();
    if (topicId === null) {
      return {
        instructions,
        tailoring: '',
        recentFeedback: this.store.feedback.recent(FEEDBACK_IN_PROMPTS),
        // v2: accepted global rules from store.ruleProposals.listAcceptedGlobal().
        standingRules: [],
      };
    }
    const topic = this.store.topics.get(topicId);
    return {
      instructions,
      tailoring: topic?.tailoring ?? '',
      recentFeedback: this.store.feedback.recentForTopic(topicId, FEEDBACK_IN_PROMPTS),
      standingRules: [],
    };
  }
}
