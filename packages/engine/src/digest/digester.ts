import type { AgentJob } from '@code-manager/core';
import type { DigestDeps } from './deps.ts';
import { EventOverrider } from './event-overrides.ts';
import { GlanceWriter } from './glances.ts';
import { SetGrouper } from './set-grouping.ts';
import { TopicAssigner } from './topic-assignment.ts';
import { refreshDriversAndRoles } from './topic-roles.ts';
import { TopicSummarizer } from './topic-summaries.ts';

/**
 * The agentic half of a sync, in dependency order: topics first (glances and
 * summaries depend on them), then sets, summaries, glances and a second
 * opinion on new loud events. Every job skips work whose input hash did not
 * change, so a quiet sync makes no agent calls.
 */
export class Digester {
  constructor(private readonly deps: DigestDeps) {}

  async run(jobs: AgentJob[], newEventIds: string[]): Promise<void> {
    if (jobs.includes('topics')) {
      await new TopicAssigner(this.deps).run();
    }
    refreshDriversAndRoles(this.deps);
    if (jobs.includes('sets')) {
      await new SetGrouper(this.deps).run();
    }
    if (jobs.includes('summaries')) {
      await new TopicSummarizer(this.deps).run();
    }
    if (jobs.includes('glances')) {
      await new GlanceWriter(this.deps).run();
    }
    if (jobs.includes('events')) {
      await new EventOverrider(this.deps).run(newEventIds);
    }
  }
}
