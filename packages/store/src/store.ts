import type { DatabaseSync } from 'node:sqlite';
import { inTransaction, openDatabase } from './database.ts';
import { ActionLogRepo } from './repos/action-log.ts';
import { AgentCallRepo } from './repos/agent-calls.ts';
import { ChatRepo } from './repos/chat.ts';
import { CursorRepo } from './repos/cursors.ts';
import { DossierRepo } from './repos/dossiers.ts';
import { EventLogRepo } from './repos/event-log.ts';
import { EventRepo } from './repos/events.ts';
import { FactRepo } from './repos/facts.ts';
import { FeedbackRepo } from './repos/feedback.ts';
import { GlanceRepo } from './repos/glances.ts';
import { InstructionsRepo } from './repos/instructions.ts';
import { TopicMembershipRepo } from './repos/memberships.ts';
import { MetaRepo } from './repos/meta.ts';
import { NotificationRepo } from './repos/notifications.ts';
import { TopicProposalRepo } from './repos/proposals.ts';
import { PrRepo } from './repos/prs.ts';
import { PendingWriteRepo } from './repos/pending-writes.ts';
import { PingDecisionRepo } from './repos/ping-decisions.ts';
import { PullInRepo } from './repos/pull-ins.ts';
import { FoundPrRepo } from './repos/found-prs.ts';
import { RuleProposalRepo } from './repos/rule-proposals.ts';
import { PrSetRepo } from './repos/sets.ts';
import { SnoozeRepo } from './repos/snoozes.ts';
import { TopicRepo } from './repos/topics.ts';
import { UserPrStateRepo } from './repos/user-pr-state.ts';
import { WorkContextRepo } from './repos/work-context.ts';

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
  readonly eventLog: EventLogRepo;
  readonly cursors: CursorRepo;
  readonly dossiers: DossierRepo;
  readonly facts: FactRepo;
  readonly ruleProposals: RuleProposalRepo;
  readonly agentCalls: AgentCallRepo;
  readonly instructions: InstructionsRepo;
  readonly pullIns: PullInRepo;
  readonly foundPrs: FoundPrRepo;
  readonly pingDecisions: PingDecisionRepo;
  readonly workContext: WorkContextRepo;

  readonly actionLog: ActionLogRepo;
  readonly pendingWrites: PendingWriteRepo;

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
    this.eventLog = new EventLogRepo(db);
    this.cursors = new CursorRepo(db);
    this.dossiers = new DossierRepo(db);
    this.facts = new FactRepo(db);
    this.ruleProposals = new RuleProposalRepo(db);
    this.agentCalls = new AgentCallRepo(db);
    this.instructions = new InstructionsRepo(db);
    this.pullIns = new PullInRepo(db);
    this.foundPrs = new FoundPrRepo(db);
    this.pingDecisions = new PingDecisionRepo(db);
    this.actionLog = new ActionLogRepo(db);
    this.pendingWrites = new PendingWriteRepo(db);
    this.workContext = new WorkContextRepo(db);
  }

  static open(path: string): Store {
    return new Store(openDatabase(path));
  }

  /** Runs fn in one transaction across repositories. fn must be synchronous. */
  transaction<T>(fn: () => T): T {
    return inTransaction(this.db, fn);
  }

  close(): void {
    this.db.close();
  }
}
