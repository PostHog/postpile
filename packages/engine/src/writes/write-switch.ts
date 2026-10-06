import type { WriteSwitchState } from '@postpile/core';
import type { GitHubWriter } from '@postpile/github';
import type { Store } from '@postpile/store';
import { ReadOnlyWriter } from './read-only-writer.ts';

/** Meta key holding the user's choice: "on" or "off". Absent: the user never chose, and the default decides. */
export const GITHUB_WRITES_META_KEY = 'github_writes';

export const FORCED_READ_ONLY_REASON = 'POSTPILE_READ_ONLY=1 forces read-only. Restart without it to allow GitHub writes.';

/**
 * The runtime on/off switch for GitHub writes, behind the footer lock.
 * Hands out the real writer while on and the ReadOnlyWriter while off, so
 * a path that forgets to ask still cannot write. The user's choice is kept
 * in meta and survives restarts. With no choice stored, `onByDefault`
 * decides: on in the packaged app (2026-10-05), off in dev runs
 * (`writesOnByDefault` in create.ts). An explicit "off" always stays off.
 *
 * `real` is null when POSTPILE_READ_ONLY=1: then the real client is never
 * constructed and the switch cannot be turned on, whatever the default.
 */
export class WriteSwitch {
  private readonly readOnly = new ReadOnlyWriter();

  constructor(
    private readonly store: Store,
    private readonly real: GitHubWriter | null,
    private readonly onByDefault = false,
  ) {}

  private forcedOffReason(): string | null {
    return this.real === null ? FORCED_READ_ONLY_REASON : null;
  }

  /** The stored choice: true for "on", false for anything else, null when the user never chose. */
  private choice(): boolean | null {
    const value = this.store.meta.get(GITHUB_WRITES_META_KEY);
    return value === null ? null : value === 'on';
  }

  enabled(): boolean {
    if (this.real === null) {
      return false;
    }
    return this.choice() ?? this.onByDefault;
  }

  status(): WriteSwitchState {
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

  /**
   * Writes are on only because of the default: the user never chose. Stores
   * "on" as the choice, so this happens once per install, and returns true.
   * Returns false (and stores nothing) in every other case.
   */
  keepDefault(): boolean {
    if (this.real === null || !this.onByDefault || this.choice() !== null) {
      return false;
    }
    this.store.meta.set(GITHUB_WRITES_META_KEY, 'on');
    return true;
  }

  writer(): GitHubWriter {
    return this.enabled() && this.real !== null ? this.real : this.readOnly;
  }
}
