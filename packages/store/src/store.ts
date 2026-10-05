import type { DatabaseSync } from 'node:sqlite';
import { inTransaction, openDatabase, openDatabaseReadOnly } from './database.ts';
import { one } from './sql.ts';
import { ActionLogRepo } from './repos/action-log.ts';
import { AgentCallRepo } from './repos/agent-calls.ts';
import { ChatRepo } from './repos/chat.ts';
import { CursorRepo } from './repos/cursors.ts';
import { DriverPickRepo } from './repos/driver-picks.ts';
import { DossierRepo } from './repos/dossiers.ts';
import { EventLogRepo } from './repos/event-log.ts';
import { EventRepo } from './repos/events.ts';
import { FactRepo } from './repos/facts.ts';
import { FeedbackRepo } from './repos/feedback.ts';
import { LessonRepo } from './repos/lessons.ts';
import { MacPingRepo } from './repos/mac-pings.ts';
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
  readonly driverPicks: DriverPickRepo;
  readonly memberships: TopicMembershipRepo;
  readonly proposals: TopicProposalRepo;
  readonly sets: PrSetRepo;
  readonly glances: GlanceRepo;
  readonly snoozes: SnoozeRepo;
  readonly feedback: FeedbackRepo;
  readonly lessons: LessonRepo;
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
  readonly macPings: MacPingRepo;
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
    this.driverPicks = new DriverPickRepo(db);
    this.memberships = new TopicMembershipRepo(db);
    this.proposals = new TopicProposalRepo(db);
    this.sets = new PrSetRepo(db);
    this.glances = new GlanceRepo(db);
    this.snoozes = new SnoozeRepo(db);
    this.feedback = new FeedbackRepo(db);
    this.lessons = new LessonRepo(db);
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
    this.macPings = new MacPingRepo(db);
    this.actionLog = new ActionLogRepo(db);
    this.pendingWrites = new PendingWriteRepo(db);
    this.workContext = new WorkContextRepo(db);
  }

  static open(path: string): Store {
    return new Store(openDatabase(path));
  }

  /** An existing database, read-only and without migrations (see openDatabaseReadOnly). */
  static openReadOnly(path: string): Store {
    return new Store(openDatabaseReadOnly(path));
  }

  /**
   * Moves whenever a row may have changed: on this connection
   * (total_changes counts every inserted, updated or deleted row) or on
   * another one, like the CLI's (data_version). Equal values mean the same
   * data, so a result read from it can be reused.
   */
  changeVersion(): string {
    const changes = one<{ changes: number }>(this.db, 'SELECT total_changes() AS changes');
    const data = one<{ data_version: number }>(this.db, 'PRAGMA data_version');
    return `${changes?.changes ?? 0}:${data?.data_version ?? 0}`;
  }

  /** Runs fn in one transaction across repositories. fn must be synchronous. */
  transaction<T>(fn: () => T): T {
    return inTransaction(this.db, fn);
  }

  close(): void {
    this.db.close();
  }
}
