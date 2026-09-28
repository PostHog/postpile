import type { ActionOrigin, ActionOutcome, LoggedAction, PrKey } from '@postpile/core';
import type { Store } from '@postpile/store';

export interface ActionLogInput {
  action: LoggedAction;
  origin: ActionOrigin;
  outcome: ActionOutcome;
  threadId?: string | null;
  prKey?: PrKey | null;
  tileId?: string | null;
  batch?: string | null;
  detail?: string;
}

/** Writes action_log rows with the engine's clock. */
export class ActionLog {
  constructor(
    private readonly store: Store,
    private readonly now: () => Date,
  ) {}

  record(input: ActionLogInput): void {
    this.store.actionLog.add({
      at: this.now().toISOString(),
      action: input.action,
      origin: input.origin,
      outcome: input.outcome,
      threadId: input.threadId ?? null,
      prKey: input.prKey ?? null,
      tileId: input.tileId ?? null,
      batch: input.batch ?? null,
      detail: input.detail ?? '',
    });
  }
}
