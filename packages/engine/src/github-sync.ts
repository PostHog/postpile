import {
  deriveEvents,
  prKey,
  type NotificationThread,
  type Pr,
  type PrKey,
  type PrRef,
  type Viewer,
} from '@code-manager/core';
import type { GitHubReader } from '@code-manager/github';
import type { Store } from '@code-manager/store';
import { caresAboutUnreviewedMerges } from './instructions.ts';
import type { PromptContextSource } from './prompt-context.ts';
import { saveViewer } from './viewer-meta.ts';

const ETAG_KEY = 'notifications_etag';
const LAST_MODIFIED_KEY = 'notifications_last_modified';

export interface GitHubSyncResult {
  viewer: Viewer;
  notModified: boolean;
  threads: number;
  prsFetched: number;
  prsSkipped: number;
  newEventIds: string[];
}

interface Candidate {
  ref: PrRef;
  thread: NotificationThread;
}

function refOf(thread: NotificationThread): PrRef | null {
  if (thread.subjectType !== 'PullRequest' || thread.number === null) {
    return null;
  }
  return { repo: thread.repo, number: thread.number };
}

/**
 * The read-only half of a sync: viewer, notifications, PR snapshots, events.
 * Holds a GitHubReader only, so it has no way to write to GitHub.
 */
export class GitHubSync {
  constructor(
    private readonly store: Store,
    private readonly reader: GitHubReader,
    private readonly contexts: PromptContextSource,
    private readonly now: () => Date,
  ) {}

  private setMeta(key: string, value: string | null): void {
    if (value === null) {
      this.store.meta.delete(key);
    } else {
      this.store.meta.set(key, value);
    }
  }

  private async syncNotifications(): Promise<{ notModified: boolean; threads: number }> {
    const result = await this.reader.listNotifications({
      etag: this.store.meta.get(ETAG_KEY),
      lastModified: this.store.meta.get(LAST_MODIFIED_KEY),
    });
    if (result.notModified) {
      return { notModified: true, threads: this.store.notifications.list().filter((t) => t.unread).length };
    }
    const at = this.now().toISOString();
    const fetchedIds = new Set(result.threads.map((t) => t.id));
    this.store.transaction(() => {
      this.store.notifications.upsertMany(result.threads);
      // The inbox lists unread threads only. One that dropped out was read somewhere else.
      for (const stored of this.store.notifications.list()) {
        if (stored.unread && !fetchedIds.has(stored.id)) {
          this.store.notifications.markRead(stored.id, at);
        }
      }
      this.setMeta(ETAG_KEY, result.etag);
      this.setMeta(LAST_MODIFIED_KEY, result.lastModified);
    });
    return { notModified: false, threads: result.threads.length };
  }

  /**
   * Unread PR threads with activity after the stored snapshot was fetched,
   * newest first. Compared against fetch time, not the PR's updatedAt: a
   * thread's updated_at runs ahead of the PR's (CI, bots), which would refetch
   * every PR on every sync. Taken from the store, not the last response, so
   * PRs left over by maxPrs still get fetched after the inbox answers 304.
   */
  private candidates(): Candidate[] {
    const fetchedAt = this.store.prs.fetchedAtByKey();
    const seen = new Set<PrKey>();
    const result: Candidate[] = [];
    for (const thread of this.store.notifications.list()) {
      const ref = refOf(thread);
      if (!thread.unread || !ref) {
        continue;
      }
      const key = prKey(ref);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const lastFetch = fetchedAt.get(key);
      if (lastFetch !== undefined && lastFetch >= thread.updatedAt) {
        continue;
      }
      result.push({ ref, thread });
    }
    return result;
  }

  private caresAboutMerges(key: PrKey): boolean {
    const topicId = this.store.memberships.get(key)?.topicId ?? null;
    const context = this.contexts.forTopic(topicId);
    return caresAboutUnreviewedMerges(context.instructions, context.tailoring);
  }

  /** Writes the snapshot and its events. Returns the ids of events that are new. */
  private storePr(pr: Pr, viewer: Viewer): string[] {
    const at = this.now().toISOString();
    return this.store.transaction(() => {
      this.store.prs.upsert(pr, at);
      const userState = this.store.userPrStates.get(pr.key);
      const events = deriveEvents(pr, viewer, userState, { caresAboutUnreviewedMerges: this.caresAboutMerges(pr.key) });
      const created = this.store.events.upsertDerived(pr.key, events);
      // Anything older than the user's last read on github.com was already seen there.
      const lastReadAt = this.store.notifications.getByPrKey(pr.key)?.lastReadAt ?? null;
      if (lastReadAt !== null) {
        const createdIds = new Set(created);
        const alreadyRead = events.filter((e) => createdIds.has(e.id) && e.at <= lastReadAt).map((e) => e.id);
        this.store.events.markSeen(alreadyRead, lastReadAt);
      }
      return created;
    });
  }

  async run(maxPrs: number): Promise<GitHubSyncResult> {
    const viewer = await this.reader.viewer();
    saveViewer(this.store, viewer);
    const notifications = await this.syncNotifications();

    const candidates = this.candidates();
    const picked = candidates.slice(0, maxPrs);
    const fetched = picked.length > 0 ? await this.reader.fetchPrs(picked.map((c) => c.ref)) : new Map<PrKey, Pr>();

    const newEventIds: string[] = [];
    for (const pr of fetched.values()) {
      newEventIds.push(...this.storePr(pr, viewer));
    }
    return {
      viewer,
      notModified: notifications.notModified,
      threads: notifications.threads,
      prsFetched: fetched.size,
      prsSkipped: candidates.length - picked.length,
      newEventIds,
    };
  }
}
