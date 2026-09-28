import type { ActionOrigin, GitHubWritesChange, GitHubWritesStatus, LoggedAction, PrKey, PrRef } from '@postpile/core';
import { errorText } from '../errors.ts';
import type { ActionLog } from './action-log.ts';
import type { WriteSwitch } from './write-switch.ts';

/** Who asked and for what, so the log row can say it. */
export interface WriteContext {
  origin: ActionOrigin;
  prKey?: PrKey | null;
  tileId?: string | null;
  threadId?: string | null;
  batch?: string | null;
}

/** 'sent' reached GitHub; 'off' means writes were off and nothing was sent. */
export type WriteResult = 'sent' | 'off';

export const WRITES_OFF_DETAIL = 'GitHub writes are off';

/**
 * The one door to GitHub writes in the engine. Every call asks the switch,
 * and every call is logged: reached GitHub, failed (then rethrown), or not
 * sent because writes are off. Nothing in the engine holds the raw writer.
 */
export class GitHubWrites {
  constructor(
    private readonly writeSwitch: WriteSwitch,
    readonly log: ActionLog,
  ) {}

  enabled(): boolean {
    return this.writeSwitch.enabled();
  }

  status(): GitHubWritesStatus {
    return this.writeSwitch.status();
  }

  /** The footer lock. Turning on is refused while CODE_MANAGER_READ_ONLY=1 forces read-only. */
  set(enabled: boolean): GitHubWritesChange {
    if (!this.writeSwitch.set(enabled)) {
      const status = this.status();
      return { ok: false, message: status.forcedOffReason ?? 'GitHub writes stay off', status };
    }
    this.log.record({ action: enabled ? 'writes_on' : 'writes_off', origin: 'footer', outcome: 'local' });
    const message = enabled ? 'GitHub writes on: mark-read and approvals reach GitHub' : 'GitHub writes off: actions stay in the app';
    return { ok: true, message, status: this.status() };
  }

  /**
   * Runs `call` against the current writer when writes are on. Off: logs
   * `offOutcome` (a mark-read still changed the app, an approval did nothing)
   * and returns 'off'.
   */
  private async send(
    action: LoggedAction,
    context: WriteContext,
    offOutcome: 'local' | 'skipped',
    call: () => Promise<void>,
  ): Promise<WriteResult> {
    const base = { action, ...context };
    if (!this.writeSwitch.enabled()) {
      this.log.record({ ...base, outcome: offOutcome, detail: WRITES_OFF_DETAIL });
      return 'off';
    }
    try {
      await call();
    } catch (error) {
      this.log.record({ ...base, outcome: 'failed', detail: errorText(error) });
      throw error;
    }
    this.log.record({ ...base, outcome: 'github' });
    return 'sent';
  }

  markThreadRead(threadId: string, context: WriteContext): Promise<WriteResult> {
    return this.send('mark_read', { ...context, threadId }, 'local', () => this.writeSwitch.writer().markThreadRead(threadId));
  }

  approvePr(ref: PrRef, body: string, commitOid: string, context: WriteContext): Promise<WriteResult> {
    return this.send('approve', context, 'skipped', () => this.writeSwitch.writer().approvePr(ref, body, commitOid));
  }

  commentOnPr(ref: PrRef, body: string, context: WriteContext): Promise<WriteResult> {
    return this.send('comment', context, 'skipped', () => this.writeSwitch.writer().commentOnPr(ref, body));
  }
}
