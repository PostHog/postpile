import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from './database.ts';
import { AgentCacheRepo } from './repos/agent-cache.ts';
import { ChatRepo } from './repos/chat.ts';
import { EventRepo } from './repos/events.ts';
import { FeedbackRepo } from './repos/feedback.ts';
import { GlanceRepo } from './repos/glances.ts';
import { TopicMembershipRepo } from './repos/memberships.ts';
import { MetaRepo } from './repos/meta.ts';
import { NotificationRepo } from './repos/notifications.ts';
import { TopicProposalRepo } from './repos/proposals.ts';
import { PrRepo } from './repos/prs.ts';
import { PrSetRepo } from './repos/sets.ts';
import { SnoozeRepo } from './repos/snoozes.ts';
import { TopicRepo } from './repos/topics.ts';
import { UserPrStateRepo } from './repos/user-pr-state.ts';

/** One open database plus every repository on it. */
export class Store {
  readonly meta: MetaRepo;
  readonly notifications: NotificationRepo;
  readonly prs: PrRepo;
  readonly events: EventRepo;
  readonly userPrStates: UserPrStateRepo;
  readonly topics: TopicRepo;
  readonly memberships: TopicMembershipRepo;
  readonly proposals: TopicProposalRepo;
  readonly sets: PrSetRepo;
  readonly glances: GlanceRepo;
  readonly snoozes: SnoozeRepo;
  readonly feedback: FeedbackRepo;
  readonly chat: ChatRepo;
  readonly agentCache: AgentCacheRepo;

  constructor(readonly db: DatabaseSync) {
    this.meta = new MetaRepo(db);
    this.notifications = new NotificationRepo(db);
    this.prs = new PrRepo(db);
    this.events = new EventRepo(db);
    this.userPrStates = new UserPrStateRepo(db);
    this.topics = new TopicRepo(db);
    this.memberships = new TopicMembershipRepo(db);
    this.proposals = new TopicProposalRepo(db);
    this.sets = new PrSetRepo(db);
    this.glances = new GlanceRepo(db);
    this.snoozes = new SnoozeRepo(db);
    this.feedback = new FeedbackRepo(db);
    this.chat = new ChatRepo(db);
    this.agentCache = new AgentCacheRepo(db);
  }

  static open(path: string): Store {
    return new Store(openDatabase(path));
  }

  close(): void {
    this.db.close();
  }
}
