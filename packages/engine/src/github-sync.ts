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
import { TeamMembers } from './team-members.ts';
import { loadViewer, saveViewer } from './viewer-meta.ts';

const ETAG_KEY = 'notifications_etag';
const LAST_MODIFIED_KEY = 'notifications_last_modified';
/** PRs the fast poll fetched since the last full sync, as a JSON list. */
const POLLED_KEY = 'poll_fetched_since_sync';

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

/** One fast-poll look at the inbox. Stack layers are left to the full sync. */
export interface InboxPollResult {
  notModified: boolean;
  /** GitHub's X-Poll-Interval. */
  pollIntervalSeconds: number | null;
  /** The store had no threads before this poll: everything is new, nothing is news. */
  firstLook: boolean;
  /** Null after a 304. */
  viewer: Viewer | null;
  fetchedPrKeys: PrKey[];
  newEventIds: string[];
}

interface NotificationsSync {
  notModified: boolean;
  threads: number;
  pollIntervalSeconds: number | null;
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
  private readonly teamMembers: TeamMembers;

  constructor(
    private readonly store: Store,
    private readonly reader: GitHubReader,
    private readonly contexts: PromptContextSource,
    private readonly now: () => Date,
  ) {
    this.layers = new StackLayerFinder(reader, now);
    this.teamMembers = new TeamMembers(store, reader, now);
  }

  private setMeta(key: string, value: string | null): void {
    if (value === null) {
      this.store.meta.delete(key);
    } else {
      this.store.meta.set(key, value);
    }
  }

  private async syncNotifications(): Promise<NotificationsSync> {
    const result = await this.reader.listNotifications({
      etag: this.store.meta.get(ETAG_KEY),
      lastModified: this.store.meta.get(LAST_MODIFIED_KEY),
    });
    const pollIntervalSeconds = result.pollIntervalSeconds;
    if (result.notModified) {
      return { notModified: true, threads: this.store.notifications.list().filter((t) => t.unread).length, pollIntervalSeconds };
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
    return { notModified: false, threads: result.threads.length, pollIntervalSeconds };
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

  /** Remembers what the poll fetched, so the next full sync verifies facts and walks stacks for them too. */
  private rememberPolled(keys: PrKey[]): void {
    const known = JSON.parse(this.store.meta.get(POLLED_KEY) ?? '[]') as PrKey[];
    this.store.meta.set(POLLED_KEY, JSON.stringify([...new Set([...known, ...keys])]));
  }

  /** PRs the poll fetched since the last full sync, still stored. Clears the list. */
  private takePolled(skip: Map<PrKey, Pr>): Pr[] {
    const keys = JSON.parse(this.store.meta.get(POLLED_KEY) ?? '[]') as PrKey[];
    this.store.meta.delete(POLLED_KEY);
    return [...this.store.prs.getMany(keys.filter((key) => !skip.has(key))).values()];
  }

  /** Fetches the PRs and writes snapshots and events. Returns the ids of new events on pinged PRs. */
  private async fetchAndStore(candidates: Candidate[], viewer: Viewer): Promise<{ fetched: Map<PrKey, Pr>; newEventIds: string[] }> {
    const fetched = candidates.length > 0 ? await this.reader.fetchPrs(candidates.map((c) => c.ref)) : new Map<PrKey, Pr>();
    const newEventIds: string[] = [];
    for (const pr of fetched.values()) {
      newEventIds.push(...this.storePr(pr, viewer));
    }
    return { fetched, newEventIds };
  }

  /**
   * The fast poll: a conditional inbox read, and on a change the PRs whose
   * threads moved since their last fetch, newest first, at most maxPrs. The
   * rest wait for the next change or the full sync. No stack layers, no
   * agent. Shares the ETag with the full sync, so whichever reads a change
   * first stores it and the other gets a 304; the full sync still finds the
   * events through the event log.
   */
  async poll(maxPrs: number): Promise<InboxPollResult> {
    const firstLook = this.store.notifications.list().length === 0;
    const notifications = await this.syncNotifications();
    const { pollIntervalSeconds } = notifications;
    if (notifications.notModified) {
      return { notModified: true, pollIntervalSeconds, firstLook, viewer: null, fetchedPrKeys: [], newEventIds: [] };
    }
    let viewer = loadViewer(this.store);
    if (!viewer) {
      viewer = await this.reader.viewer();
      saveViewer(this.store, viewer);
    }
    const { fetched, newEventIds } = await this.fetchAndStore(this.candidates().slice(0, maxPrs), viewer);
    this.rememberPolled([...fetched.keys()]);
    return { notModified: false, pollIntervalSeconds, firstLook, viewer, fetchedPrKeys: [...fetched.keys()], newEventIds };
  }

  async run(maxPrs: number): Promise<GitHubSyncResult> {
    const viewer = await this.teamMembers.attach(await this.reader.viewer());
    saveViewer(this.store, viewer);
    const notifications = await this.syncNotifications();

    const candidates = this.candidates();
    const picked = candidates.slice(0, maxPrs);
    const { fetched, newEventIds } = await this.fetchAndStore(picked, viewer);
    // The poll fetched these already; they still get their stacks walked and facts verified here.
    const polled = this.takePolled(fetched);
    // A failed stack lookup should not cost the rest of the sync; the next sync tries again.
    const errors: string[] = [];
    let pulledIn: Pr[] = [];
    try {
      pulledIn = await this.pullInStackLayers([...fetched.values(), ...polled], viewer);
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
      fetchedPrKeys: [...fetched.keys(), ...polled.map((pr) => pr.key), ...pulledIn.map((pr) => pr.key)],
      newEventIds,
      errors,
    };
  }
}
