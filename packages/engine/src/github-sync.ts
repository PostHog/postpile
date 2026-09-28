import {
  caresAboutUnreviewedMerges,
  deriveEvents,
  eventsReadOnGitHub,
  prKey,
  threadPrKey,
  type NotificationThread,
  type Pr,
  type PrKey,
  type PrRef,
  type IsoTime,
  type Viewer,
} from '@postpile/core';
import type { GitHubReader } from '@postpile/github';
import type { Store } from '@postpile/store';
import { errorText } from './errors.ts';
import type { PromptContextSource } from './prompt-context.ts';
import { StackLayerFinder } from './stack-layers.ts';
import { TeamMembers } from './team-members.ts';
import { loadViewer, saveViewer } from './viewer-meta.ts';
import type { ActionLog } from './writes/action-log.ts';
import { OBSERVED_PENDING_DETAIL, type PendingWrites } from './writes/pending-writes.ts';

const ETAG_KEY = 'notifications_etag';
const LAST_MODIFIED_KEY = 'notifications_last_modified';
/** PRs the fast poll fetched since the last full sync, as a JSON list. */
const POLLED_KEY = 'poll_fetched_since_sync';
/** `since` of the read-threads call: the start of the last full sync. */
const READ_SINCE_KEY = 'read_threads_since';
/** ETag of the read-threads call; only valid for the stored `since`. */
const READ_ETAG_KEY = 'read_threads_etag';
/** Without a stored `since` (first run), read threads this far back. */
export const FIRST_READ_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
/** getThread lookups per sync for threads that left the inbox without showing up in the read list. */
export const READ_TIME_LOOKUPS = 20;

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
  /** PRs with events that turned seen because GitHub says their thread was read after them. */
  readOnGitHub: PrKey[];
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
  /** PRs with events that turned seen because GitHub says their thread was read after them. */
  readOnGitHub: PrKey[];
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
  /** PRs reconciled with GitHub's read time during the current run; taken by run() and poll(). */
  private readOnGitHub = new Set<PrKey>();

  constructor(
    private readonly store: Store,
    private readonly reader: GitHubReader,
    private readonly contexts: PromptContextSource,
    private readonly now: () => Date,
    private readonly log: ActionLog,
    private readonly pendingWrites: PendingWrites,
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

  /**
   * Read and unread threads updated since the last full sync
   * (`?all=true&since=`), with its own ETag. The full sync moves `since` to
   * its start (`advanceFrom`), so the polls in between ask the same URL and
   * mostly get a 304. Null after a 304.
   */
  private async readThreads(advanceFrom: IsoTime | null): Promise<NotificationThread[] | null> {
    const fallback = new Date(this.now().getTime() - FIRST_READ_WINDOW_MS).toISOString();
    const since = this.store.meta.get(READ_SINCE_KEY) ?? fallback;
    const result = await this.reader.listThreadsSince(since, this.store.meta.get(READ_ETAG_KEY));
    if (advanceFrom !== null) {
      this.store.meta.set(READ_SINCE_KEY, advanceFrom);
      this.setMeta(READ_ETAG_KEY, null);
    } else if (!result.notModified) {
      this.setMeta(READ_ETAG_KEY, result.etag);
    }
    return result.notModified ? null : result.threads;
  }

  /**
   * When each thread that left the inbox was read on GitHub: from the read
   * list, else one thread lookup (at most READ_TIME_LOOKUPS), else now. A
   * failed lookup falls back to now; the sync goes on.
   */
  private async readTimes(threads: NotificationThread[], readList: Map<string, NotificationThread>): Promise<Map<string, IsoTime>> {
    const at = this.now().toISOString();
    const times = new Map<string, IsoTime>();
    let lookups = 0;
    for (const thread of threads) {
      let lastReadAt = readList.get(thread.id)?.lastReadAt ?? null;
      if (lastReadAt === null && lookups < READ_TIME_LOOKUPS) {
        lookups += 1;
        const current = await this.reader.getThread(thread.id).catch(() => null);
        lastReadAt = current && !current.unread ? current.lastReadAt : null;
      }
      times.set(thread.id, lastReadAt ?? at);
    }
    return times;
  }

  /**
   * The inbox (unread threads, ETag) plus the read list. `origin` is who
   * noticed: a thread that left the inbox, or that the read list says is
   * read now, was read on github.com or another client, and that lands in
   * the action log as observed. A pending write for such a thread is
   * cleared: GitHub already has it read. Nothing here writes to GitHub.
   *
   * The full sync always asks for the read list (a thread can come and go
   * between syncs and leave the inbox unchanged); the poll only when the
   * inbox moved.
   */
  private async syncNotifications(origin: 'sync' | 'poll'): Promise<NotificationsSync> {
    const startedAt = this.now().toISOString();
    const result = await this.reader.listNotifications({
      etag: this.store.meta.get(ETAG_KEY),
      lastModified: this.store.meta.get(LAST_MODIFIED_KEY),
    });
    const pollIntervalSeconds = result.pollIntervalSeconds;
    const inbox = result.notModified ? null : result.threads;
    const readList = inbox !== null || origin === 'sync' ? await this.readThreads(origin === 'sync' ? startedAt : null) : null;
    if (inbox === null && readList === null) {
      return { notModified: true, threads: this.store.notifications.list().filter((t) => t.unread).length, pollIntervalSeconds };
    }
    const inboxIds = new Set((inbox ?? []).map((t) => t.id));
    const readById = new Map((readList ?? []).filter((t) => !inboxIds.has(t.id)).map((t) => [t.id, t]));
    // The inbox lists unread threads only. One that dropped out, or that the read list now says is read, was read somewhere else.
    const readElsewhere = this.store.notifications
      .list()
      .filter((stored) => stored.unread && !inboxIds.has(stored.id))
      .filter((stored) => inbox !== null || readById.get(stored.id)?.unread === false);
    const readAt = await this.readTimes(readElsewhere, readById);
    this.store.transaction(() => {
      this.store.notifications.upsertMany([...readById.values()]);
      if (!result.notModified) {
        this.store.notifications.upsertMany(result.threads);
      }
      const hadPending = this.pendingWrites.observeRead(new Set(readElsewhere.map((thread) => thread.id)), origin);
      for (const stored of readElsewhere) {
        this.store.notifications.markRead(stored.id, readAt.get(stored.id)!);
        this.log.record({
          action: 'mark_read',
          origin,
          outcome: 'observed',
          threadId: stored.id,
          prKey: threadPrKey(stored),
          detail: hadPending.has(stored.id) ? OBSERVED_PENDING_DETAIL : 'left the inbox: read on github.com or another client',
        });
      }
      if (!result.notModified) {
        this.setMeta(ETAG_KEY, result.etag);
        this.setMeta(LAST_MODIFIED_KEY, result.lastModified);
      }
      this.reconcileReadTimes();
    });
    const threads = inbox?.length ?? this.store.notifications.list().filter((t) => t.unread).length;
    return { notModified: result.notModified, threads, pollIntervalSeconds };
  }

  /**
   * Every stored event of a PR from before its thread's last read on GitHub
   * counts as seen, stamped with that read time. Runs whenever the threads
   * change, not only on a PR's first fetch, so a thread cleared on
   * github.com while the app was closed turns calm on the next start.
   */
  private reconcileReadTimes(): void {
    const readTimes = new Map<PrKey, IsoTime>();
    // Newest thread per PR first, like the Board.
    for (const thread of this.store.notifications.list()) {
      const key = threadPrKey(thread);
      if (key !== null && !readTimes.has(key) && thread.lastReadAt !== null) {
        readTimes.set(key, thread.lastReadAt);
      }
    }
    const events = this.store.events.listForPrs([...readTimes.keys()]);
    for (const [key, lastReadAt] of readTimes) {
      this.markReadOnGitHub(key, eventsReadOnGitHub(events.get(key) ?? [], lastReadAt), lastReadAt);
    }
  }

  private markReadOnGitHub(key: PrKey, eventIds: string[], lastReadAt: IsoTime): void {
    if (eventIds.length > 0) {
      this.store.events.markSeen(eventIds, lastReadAt);
      this.readOnGitHub.add(key);
    }
  }

  /** PRs reconciled with GitHub's read time since the last call. */
  private takeReadOnGitHub(): PrKey[] {
    const keys = [...this.readOnGitHub];
    this.readOnGitHub = new Set();
    return keys;
  }

  /**
   * PR threads with activity after the stored snapshot was fetched, unread
   * ones first, newest first inside each. Read threads count too, so a PR
   * handled entirely on github.com still gets its events logged (as seen)
   * and reaches topics, dossiers and facts. Compared against fetch time,
   * not the PR's updatedAt: a thread's updated_at runs ahead of the PR's
   * (CI, bots), which would refetch every PR on every sync. Taken from the
   * store, not the last response, so PRs left over by maxPrs still get
   * fetched after the inbox answers 304.
   */
  private candidates(): Candidate[] {
    const fetchedAt = this.store.prs.fetchedAtByKey();
    const seen = new Set<PrKey>();
    const result: Candidate[] = [];
    const threads = this.store.notifications.list();
    const unreadFirst = [...threads.filter((thread) => thread.unread), ...threads.filter((thread) => !thread.unread)];
    for (const thread of unreadFirst) {
      const ref = refOf(thread);
      if (!ref) {
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
        this.markReadOnGitHub(pr.key, eventsReadOnGitHub(this.store.events.listForPr(pr.key), lastReadAt), lastReadAt);
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
    this.readOnGitHub = new Set();
    const firstLook = this.store.notifications.list().length === 0;
    const notifications = await this.syncNotifications('poll');
    const { pollIntervalSeconds } = notifications;
    if (notifications.notModified) {
      return { notModified: true, pollIntervalSeconds, firstLook, viewer: null, fetchedPrKeys: [], newEventIds: [], readOnGitHub: [] };
    }
    let viewer = loadViewer(this.store);
    if (!viewer) {
      viewer = await this.reader.viewer();
      saveViewer(this.store, viewer);
    }
    const { fetched, newEventIds } = await this.fetchAndStore(this.candidates().slice(0, maxPrs), viewer);
    this.rememberPolled([...fetched.keys()]);
    const readOnGitHub = this.takeReadOnGitHub();
    return { notModified: false, pollIntervalSeconds, firstLook, viewer, fetchedPrKeys: [...fetched.keys()], newEventIds, readOnGitHub };
  }

  async run(maxPrs: number): Promise<GitHubSyncResult> {
    this.readOnGitHub = new Set();
    const viewer = await this.teamMembers.attach(await this.reader.viewer());
    saveViewer(this.store, viewer);
    const notifications = await this.syncNotifications('sync');

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
      readOnGitHub: this.takeReadOnGitHub(),
      errors,
    };
  }
}
