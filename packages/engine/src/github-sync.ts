import {
  caresAboutUnreviewedMerges,
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
import { errorText } from './errors.ts';
import type { PromptContextSource } from './prompt-context.ts';
import { StackLayerFinder } from './stack-layers.ts';
import { saveViewer } from './viewer-meta.ts';

const ETAG_KEY = 'notifications_etag';
const LAST_MODIFIED_KEY = 'notifications_last_modified';

export interface GitHubSyncResult {
  viewer: Viewer;
  notModified: boolean;
  threads: number;
  prsFetched: number;
  prsSkipped: number;
  /** Stack layers fetched to complete a pinged PR's stack. Not counted in prsFetched. */
  prsPulledIn: number;
  /** PRs whose snapshot was written this sync, stack layers included; the verify pass rechecks facts about them. */
  fetchedPrKeys: PrKey[];
  /** New events on pinged PRs. Events on stack layers are logged but are not new work. */
  newEventIds: string[];
  errors: string[];
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
  private readonly layers: StackLayerFinder;

  constructor(
    private readonly store: Store,
    private readonly reader: GitHubReader,
    private readonly contexts: PromptContextSource,
    private readonly now: () => Date,
  ) {
    this.layers = new StackLayerFinder(reader, now);
  }

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

  /** A stack layer has no topic of its own; it reads the context of its anchor's topic. */
  private caresAboutMerges(key: PrKey): boolean {
    const anchor = this.store.pullIns.get(key)?.anchorPrKey;
    const membership = this.store.memberships.get(key) ?? (anchor ? this.store.memberships.get(anchor) : null);
    const topicId = membership?.topicId ?? null;
    const context = this.contexts.forTopic(topicId);
    return caresAboutUnreviewedMerges(context.instructions, context.tailoring);
  }

  /**
   * Writes the snapshot and its events. Returns the ids of events that are new.
   * Every event goes to the event log, not only the new ones: the log ignores
   * ids it has, and this also picks up events stored before the log existed.
   */
  private storePr(pr: Pr, viewer: Viewer): string[] {
    const at = this.now().toISOString();
    return this.store.transaction(() => {
      this.store.prs.upsert(pr, at);
      const userState = this.store.userPrStates.get(pr.key);
      const events = deriveEvents(pr, viewer, userState, { caresAboutUnreviewedMerges: this.caresAboutMerges(pr.key) });
      const created = this.store.events.upsertDerived(pr.key, events);
      const inTimeOrder = [...events].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
      this.store.eventLog.append(
        inTimeOrder.map((event) => ({ id: event.id, prKey: pr.key })),
        at,
      );
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

  /**
   * Fetches the missing layers of stacks that pinged PRs fetched this sync
   * sit in, and records them as pulled in. A layer whose snapshot has not
   * moved since the last fetch is not fetched again.
   */
  private async pullInStackLayers(fetched: Pr[], viewer: Viewer): Promise<Pr[]> {
    const pinged = new Set(this.store.notifications.list().flatMap((thread) => {
      const ref = refOf(thread);
      return ref ? [prKey(ref)] : [];
    }));
    const seeds = fetched.filter((pr) => pinged.has(pr.key));
    if (seeds.length === 0) {
      return [];
    }
    const layers = await this.layers.find(seeds, pinged);
    const storedAt = this.store.prs.updatedAtByKey();
    this.store.transaction(() => {
      for (const layer of layers) {
        this.store.pullIns.put(layer.pullIn);
      }
    });
    const moved = layers.filter((layer) => storedAt.get(layer.pullIn.prKey) !== layer.updatedAt).map((layer) => layer.ref);
    const prs = moved.length > 0 ? [...(await this.reader.fetchPrs(moved)).values()] : [];
    for (const pr of prs) {
      this.storePr(pr, viewer);
    }
    return prs;
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
    // A failed stack lookup should not cost the rest of the sync; the next sync tries again.
    const errors: string[] = [];
    let pulledIn: Pr[] = [];
    try {
      pulledIn = await this.pullInStackLayers([...fetched.values()], viewer);
    } catch (error) {
      errors.push(`stack layers: ${errorText(error)}`);
    }
    return {
      viewer,
      notModified: notifications.notModified,
      threads: notifications.threads,
      prsFetched: fetched.size,
      prsSkipped: candidates.length - picked.length,
      prsPulledIn: pulledIn.length,
      fetchedPrKeys: [...fetched.keys(), ...pulledIn.map((pr) => pr.key)],
      newEventIds,
      errors,
    };
  }
}
