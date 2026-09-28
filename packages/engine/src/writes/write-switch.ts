import type { GitHubWritesStatus } from '@code-manager/core';
import type { GitHubWriter } from '@code-manager/github';
import type { Store } from '@code-manager/store';
import { ReadOnlyWriter } from './read-only-writer.ts';

/** Meta key holding the user's choice: "on", anything else (or nothing) is off. */
export const GITHUB_WRITES_META_KEY = 'github_writes';

export const FORCED_READ_ONLY_REASON = 'CODE_MANAGER_READ_ONLY=1 forces read-only. Restart without it to allow GitHub writes.';

/**
 * The runtime on/off switch for GitHub writes, behind the footer lock.
 * Hands out the real writer while on and the ReadOnlyWriter while off, so
 * a path that forgets to ask still cannot write. Off until the user turns it
 * on; the choice is kept in meta and survives restarts.
 *
 * `real` is null when CODE_MANAGER_READ_ONLY=1: then the real client is never
 * constructed and the switch cannot be turned on.
 */
export class WriteSwitch {
  private readonly readOnly = new ReadOnlyWriter();

  constructor(
    private readonly store: Store,
    private readonly real: GitHubWriter | null,
  ) {}

  private forcedOffReason(): string | null {
    return this.real === null ? FORCED_READ_ONLY_REASON : null;
  }

  enabled(): boolean {
    return this.real !== null && this.store.meta.get(GITHUB_WRITES_META_KEY) === 'on';
  }

  status(): GitHubWritesStatus {
    return { enabled: this.enabled(), forcedOffReason: this.forcedOffReason() };
  }

  /** Returns false (and changes nothing) when read-only is forced and `enabled` asks for on. */
  set(enabled: boolean): boolean {
    if (enabled && this.real === null) {
      return false;
    }
    this.store.meta.set(GITHUB_WRITES_META_KEY, enabled ? 'on' : 'off');
    return true;
  }

  writer(): GitHubWriter {
    return this.enabled() && this.real !== null ? this.real : this.readOnly;
  }
}
