// Unsent composer text of the PR pane, per PR and target, for as long as the
// app runs (like the agent pane's unsent text per topic). The pane remounts
// per PR, so the text lives here and not in the pane.

/** What the pane writes to GitHub; one composer is open at a time. */
export type ComposeTarget = { kind: 'approve' } | { kind: 'comment' } | { kind: 'ask' } | { kind: 'reply'; commentId: string };

/** The draft key of a target within one PR: drafts stay per target while another one is open. */
export function composeKey(target: ComposeTarget): string {
  return target.kind === 'reply' ? `reply:${target.commentId}` : target.kind;
}

/**
 * Drafts keyed by PR and target, plus the composer each PR had open. Every
 * read and write names the PR, so a text typed for one PR can never be read
 * back for another. It is the one source of the composer's text and open
 * target: components read it with `useSyncExternalStore`, so a send that
 * ends after the pane left and came back clears the composer on screen,
 * not only the one that sent (Codex on #176).
 */
export class PaneDrafts {
  private readonly texts = new Map<string, string>();
  private readonly agentTexts = new Map<string, string>();
  private readonly openTargets = new Map<string, ComposeTarget>();
  private readonly listeners = new Set<() => void>();

  private static key(prKey: string, key: string): string {
    return `${prKey}|${key}`;
  }

  /** Calls `listener` after every write; returns the unsubscribe. An arrow, so it can be handed to `useSyncExternalStore` as is. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private changed(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  text(prKey: string, key: string): string {
    return this.texts.get(PaneDrafts.key(prKey, key)) ?? '';
  }

  /** An empty text drops the draft. */
  setText(prKey: string, key: string, text: string): void {
    if (text === '') {
      this.texts.delete(PaneDrafts.key(prKey, key));
    } else {
      this.texts.set(PaneDrafts.key(prKey, key), text);
    }
    this.changed();
  }

  /** The agent's last draft for a target, null when the agent has not drafted it. */
  agentText(prKey: string, key: string): string | null {
    return this.agentTexts.get(PaneDrafts.key(prKey, key)) ?? null;
  }

  setAgentText(prKey: string, key: string, text: string | null): void {
    if (text === null) {
      this.agentTexts.delete(PaneDrafts.key(prKey, key));
    } else {
      this.agentTexts.set(PaneDrafts.key(prKey, key), text);
    }
    this.changed();
  }

  /** The composer that was open when the user left this PR. */
  openTarget(prKey: string): ComposeTarget | null {
    return this.openTargets.get(prKey) ?? null;
  }

  setOpenTarget(prKey: string, target: ComposeTarget | null): void {
    if (target === null) {
      this.openTargets.delete(prKey);
    } else {
      this.openTargets.set(prKey, target);
    }
    this.changed();
  }
}

/** The app's one store: the pane reads it again when the user comes back to a PR. */
export const paneDrafts = new PaneDrafts();
