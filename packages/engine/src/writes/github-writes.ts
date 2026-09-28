import type { ActionOrigin, LoggedAction, PrKey, PrRef, WriteSwitchState } from '@postpile/core';
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

/** Log and toast text for a mark-read GitHub did not take; the app keeps (or goes back to) unread. */
export function notTakenDetail(reason: string): string {
  return `GitHub didn't take it: ${reason}; still unread`;
}

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

  status(): WriteSwitchState {
    return this.writeSwitch.status();
  }

  /** The footer lock. Turning on is refused while POSTPILE_READ_ONLY=1 forces read-only. */
  set(enabled: boolean): { ok: boolean; message: string } {
    if (!this.writeSwitch.set(enabled)) {
      return { ok: false, message: this.status().forcedOffReason ?? 'GitHub writes stay off' };
    }
    this.log.record({ action: enabled ? 'writes_on' : 'writes_off', origin: 'footer', outcome: 'local' });
    const message = enabled
      ? 'GitHub writes on: mark-read and approvals reach GitHub'
      : 'GitHub writes locked: mark-reads wait as pending writes, approve and comment are blocked';
    return { ok: true, message };
  }

  /**
   * Runs `call` against the current writer when writes are on. Off: logs
   * `skipped` and returns 'off'. `describe` turns the reason (writes off, the
   * error) into the log detail.
   */
  private async send(
    action: LoggedAction,
    context: WriteContext,
    call: () => Promise<void>,
    describe: (reason: string) => string = (reason) => reason,
  ): Promise<WriteResult> {
    const base = { action, ...context };
    if (!this.writeSwitch.enabled()) {
      this.log.record({ ...base, outcome: 'skipped', detail: describe(WRITES_OFF_DETAIL) });
      return 'off';
    }
    try {
      await call();
    } catch (error) {
      this.log.record({ ...base, outcome: 'failed', detail: describe(errorText(error)) });
      throw error;
    }
    this.log.record({ ...base, outcome: 'github' });
    return 'sent';
  }

  markThreadRead(threadId: string, context: WriteContext): Promise<WriteResult> {
    return this.send('mark_read', { ...context, threadId }, () => this.writeSwitch.writer().markThreadRead(threadId), notTakenDetail);
  }

  approvePr(ref: PrRef, body: string, commitOid: string, context: WriteContext): Promise<WriteResult> {
    return this.send('approve', context, () => this.writeSwitch.writer().approvePr(ref, body, commitOid));
  }

  commentOnPr(ref: PrRef, body: string, context: WriteContext): Promise<WriteResult> {
    return this.send('comment', context, () => this.writeSwitch.writer().commentOnPr(ref, body));
  }
}
