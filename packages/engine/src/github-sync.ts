import {
  daysBefore,
  declaredParentOf,
  deriveEvents,
  eventsSeenByTouch,
  nextWatchSince,
  ownEventsOnReadThread,
  planRead,
  prKey,
  prReadScope,
  threadPrKey,
  threadPrRef,
  type NotificationThread,
  type FetchCount,
  type FullPr,
  type Pr,
  type PrEvent,
  type PrKey,
  type PrRef,
  type IsoTime,
  type LayerShape,
  type Viewer,
  hotSyncThreads,
  selectSyncThreads,
  threadNewsFacts,
} from '@postpile/core';
import type { GitHubReader } from '@postpile/github';
import type { Store } from '@postpile/store';
import { writeReadPlan } from './actions/local-change.ts';
import { Board } from './board.ts';
import { readHotSet, threadsByPrKey } from './hot-set.ts';
import { CAP_FILL_POLL_PRS, CAP_FILL_SYNC_PRS, CapFiller } from './cap-fill.ts';
import { DIFF_POLL_PRS, DIFF_SYNC_PRS, DiffReader } from './diff-reader.ts';
import { errorText } from './errors.ts';
import { LessonKeeper } from './lessons/lesson-keeper.ts';
import { StackLayerFinder } from './stack-layers.ts';
import { TeamMembers } from './team-members.ts';
import type { GitHubQuota } from './github-quota.ts';
import { saveViewerFollowingRoles } from './team-role-events.ts';
import { TeamRoleKeeper } from './team-roles.ts';
import { loadViewer, saveViewer } from './viewer-meta.ts';
import type { ActionLog } from './writes/action-log.ts';
import { OBSERVED_PENDING_DETAIL, type PendingWrites } from './writes/pending-writes.ts';

const ETAG_KEY = 'notifications_etag';
const LAST_MODIFIED_KEY = 'notifications_last_modified';
/** PRs the fast poll fetched since the last full sync, as a JSON list. */
const POLLED_KEY = 'poll_fetched_since_sync';
/** `since` of the read-threads call: the start of the last full sync. */
const READ_SINCE_KEY = 'read_threads_since';
/** `since` of the poll's read-threads watch (see nextWatchSince); moves on each 200. */
const WATCH_SINCE_KEY = 'poll_watch_since';
/** ETag of the watch's last 200. */
const WATCH_ETAG_KEY = 'poll_watch_etag';
/** Without a stored watch `since` or read-list `since`, the watch starts this far back. */
export const WATCH_FIRST_WINDOW_MS = 60 * 60 * 1000;
/** The poll runs the freshness check at most this often; the full sync always runs it. */
export const FRESHNESS_POLL_EVERY_MS = 60 * 1000;
/** Merged or closed PRs stay in the freshness check this long after their last update. */
export const FRESHNESS_CLOSED_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Without a stored `since` (first run, or no last-sync marker), read threads this far back. */
export const FIRST_READ_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** getThread lookups per sync for threads that left the inbox without showing up in the read list. */
export const READ_TIME_LOOKUPS = 20;
/** Found PRs: merged ones count when merged this many days back. */
export const FOUND_MERGED_DAYS = 7;

export interface GitHubSyncResult {
  viewer: Viewer;
  notModified: boolean;
  threads: number;
  prsFetched: number;
  prsSkipped: number;
  /** Stack layers fetched to complete a pinged PR's stack. Not counted in prsFetched. */
  prsPulledIn: number;
  /** Found PRs (not in the inbox) fetched because they were new or moved. Not counted in prsFetched. */
  prsFound: number;
  /** PRs whose snapshot was written this sync, stack layers included; the verify pass rechecks facts about them. */
  fetchedPrKeys: PrKey[];
  /** New events on pinged PRs. Events on stack layers are logged but are not new work. */
  newEventIds: string[];
  /** PRs with events that turned seen because GitHub says their thread was read after them, or the viewer touched the PR after them. */
  readOnGitHub: PrKey[];
  errors: string[];
}

/**
 * Extra work for one poll, from the window getting focus after the user
 * opened PRs on github.com from the app: look up these threads directly and
 * fetch these PRs (the ones without a thread) whatever the lists say.
 */
export interface PollFocus {
  threadIds: string[];
  prRefs: PrRef[];
}

export const NO_FOCUS: PollFocus = { threadIds: [], prRefs: [] };

/** One fast-poll look at the inbox. Stack layers are left to the full sync. */
export interface InboxPollResult {
  /** Neither list moved and nothing was fetched. */
  notModified: boolean;
  /** GitHub's X-Poll-Interval. */
  pollIntervalSeconds: number | null;
  /** The store had no threads before this poll: everything is new, nothing is news. */
  firstLook: boolean;
  /** Null after a 304. */
  viewer: Viewer | null;
  fetchedPrKeys: PrKey[];
  newEventIds: string[];
  /** PRs with events that turned seen because GitHub says their thread was read after them, or the viewer touched the PR after them. */
  readOnGitHub: PrKey[];
}

interface NotificationsSync {
  /** The unread list answered 304. */
  notModified: boolean;
  /** Something to store: the unread list moved, or the read list or a thread lookup brought threads. */
  changed: boolean;
  threads: number;
  pollIntervalSeconds: number | null;
}

interface Candidate {
  ref: PrRef;
  thread: NotificationThread;
}

/**
 * The read-only half of a sync: viewer, notifications, PR snapshots, events.
 * Holds a GitHubReader only, so it has no way to write to GitHub.
 */
export class GitHubSync {
  private readonly layers: StackLayerFinder;
  private readonly lessons: LessonKeeper;
  private readonly teamMembers: TeamMembers;
  private readonly teamRoles: TeamRoleKeeper;
  /** PRs reconciled with GitHub's read time or the viewer's last touch during the current run; taken by run() and poll(). */
  private readOnGitHub = new Set<PrKey>();
  /** The stored threads, loaded once per run and again after the run writes threads (`threads()`). */
  private storedThreads: NotificationThread[] | null = null;
  /** How often the read-threads watch answered, and how often with a 200, since the app started. */
  private readonly watchAnswers = { total: 0, changed: 0 };
  /** When the freshness check last ran, in ms; 0 before the first. */
  private lastFreshnessAt = 0;
  /** PRs with news left out of the fetch since the last `takeShed` (telemetry's work_shed). */
  private shed = new Set<PrKey>();
  /** How many the last pick left out, for the sync's log line. */
  private lastShed = 0;
  /** The running full sync's fetch count; null outside `run`. */
  private count: FetchCount | null = null;

  constructor(
    private readonly store: Store,
    private readonly reader: GitHubReader,
    private readonly now: () => Date,
    private readonly log: ActionLog,
    private readonly pendingWrites: PendingWrites,
    private readonly quota: GitHubQuota,
    private readonly textLog: (line: string) => void = () => {},
    /** Threads a clicked mark-read is deciding again (ClickedReadRetry): the inbox leaves their rows alone meanwhile. */
    private readonly heldThreads: ReadonlySet<string> = new Set(),
    /** Threads of clicked mark-reads still in their undo window or being sent (MarkReadQueue): read here already, not yet on GitHub. */
    private readonly queuedThreads: () => ReadonlySet<string> = () => new Set(),
  ) {
    this.layers = new StackLayerFinder(reader, now);
    this.lessons = new LessonKeeper(store, now);
    this.teamMembers = new TeamMembers(store, reader, now);
    this.teamRoles = new TeamRoleKeeper(store, reader, now, quota, textLog);
  }

  /** The stored notification threads, from the per-run snapshot. */
  private threads(): NotificationThread[] {
    this.storedThreads ??= this.store.notifications.list();
    return this.storedThreads;
  }

  /** Unread PR threads in the store. Other notifications are not counted. */
  private unreadPrThreadCount(): number {
    return this.threads().filter((t) => t.unread && threadPrKey(t) !== null).length;
  }

  /** Starts a run (sync or poll): fresh thread snapshot, nothing reconciled yet. */
  private beginRun(): void {
    this.readOnGitHub = new Set();
    this.storedThreads = null;
  }

  /** PRs with a notification thread, plus the found ones: what the stack walk and the freshness check follow. */
  private trackedPrKeys(): Set<PrKey> {
    const tracked = new Set<PrKey>(this.store.foundPrs.listAll().keys());
    for (const thread of this.threads()) {
      const key = threadPrKey(thread);
      if (key !== null) {
        tracked.add(key);
      }
    }
    return tracked;
  }

  private setMeta(key: string, value: string | null): void {
    if (value === null) {
      this.store.meta.delete(key);
    } else {
      this.store.meta.set(key, value);
    }
  }

  /**
   * The full sync's read list: read and unread threads updated since the
   * last full sync (`?all=true&since=`). `since` then moves to this sync's
   * start (`advanceFrom`), so no ETag is kept: the next sync asks another URL.
   */
  private async readThreads(advanceFrom: IsoTime): Promise<NotificationThread[] | null> {
    const fallback = new Date(this.now().getTime() - FIRST_READ_WINDOW_MS).toISOString();
    const since = this.store.meta.get(READ_SINCE_KEY) ?? fallback;
    const result = await this.reader.listThreadsSince(since, null);
    this.store.meta.set(READ_SINCE_KEY, advanceFrom);
    return result.notModified ? null : result.threads;
  }

  /**
   * The poll's watch on read and unread threads (`?all=true&since=`), so a
   * merge, a close or the user's own comment on a thread that stays read
   * shows within a cycle. `since` only moves on a 200 (nextWatchSince), so
   * between changes the URL and ETag stay the same and GitHub answers 304.
   * Null after a 304 or an empty answer. Every 200 is logged with the tally.
   */
  private async watchThreads(): Promise<NotificationThread[] | null> {
    const fallback = new Date(this.now().getTime() - WATCH_FIRST_WINDOW_MS).toISOString();
    const since = this.store.meta.get(WATCH_SINCE_KEY) ?? this.store.meta.get(READ_SINCE_KEY) ?? fallback;
    const result = await this.reader.listThreadsSince(since, this.store.meta.get(WATCH_ETAG_KEY));
    this.watchAnswers.total += 1;
    if (result.notModified) {
      return null;
    }
    this.watchAnswers.changed += 1;
    this.store.meta.set(WATCH_SINCE_KEY, nextWatchSince(since, result.threads));
    this.setMeta(WATCH_ETAG_KEY, result.etag);
    const { changed, total } = this.watchAnswers;
    this.textLog(`live poll: read-threads watch answered 200 with ${result.threads.length} threads since ${since} (200 on ${changed} of ${total} polls since start)`);
    return result.threads.length > 0 ? result.threads : null;
  }

  /** Threads looked up one by one (focus refresh). A failed or unknown lookup is skipped. */
  private async lookUpThreads(threadIds: string[]): Promise<NotificationThread[]> {
    const threads: NotificationThread[] = [];
    for (const id of threadIds) {
      const thread = await this.reader.getThread(id).catch(() => null);
      if (thread) {
        threads.push(thread);
      }
    }
    return threads;
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
   * The full sync asks for the read list since its last start (a thread
   * can come and go between syncs and leave the inbox unchanged); the poll
   * asks its own watch (watchThreads) every cycle. `looked` are threads the
   * focus refresh looked up one by one; they count like read-list entries.
   *
   * Each "read elsewhere" is logged with how it was noticed: the unread list
   * answering 200 without it, or the read list saying read while the unread
   * list answered 304. The second would mean GitHub's inbox ETag does not
   * move when a thread is read on github.com.
   */
  private async syncNotifications(origin: 'sync' | 'poll', looked: NotificationThread[] = []): Promise<NotificationsSync> {
    const startedAt = this.now().toISOString();
    // Taken before the request too: a send that lands while it runs leaves the queue, but the answer can still list its thread unread.
    const queuedAtStart = this.queuedThreads();
    const result = await this.reader.listNotifications({
      etag: this.store.meta.get(ETAG_KEY),
      lastModified: this.store.meta.get(LAST_MODIFIED_KEY),
    });
    const pollIntervalSeconds = result.pollIntervalSeconds;
    const inbox = result.notModified ? null : result.threads;
    const listed = origin === 'sync' ? await this.readThreads(startedAt) : await this.watchThreads();
    const readList = listed === null && looked.length === 0 ? null : [...(listed ?? []), ...looked];
    if (inbox === null && readList === null) {
      const threads = this.unreadPrThreadCount();
      return { notModified: true, changed: false, threads, pollIntervalSeconds };
    }
    const inboxIds = new Set((inbox ?? []).map((t) => t.id));
    const readById = new Map((readList ?? []).filter((t) => !inboxIds.has(t.id)).map((t) => [t.id, t]));
    // The inbox lists unread threads only. One that dropped out, or that the read list now says is read, was read somewhere else.
    const readElsewhere = this
      .threads()
      .filter((stored) => stored.unread && !inboxIds.has(stored.id))
      .filter((stored) => inbox !== null || readById.get(stored.id)?.unread === false);
    const readAt = await this.readTimes(readElsewhere, readById);
    // A held thread keeps its row until the clicked mark-read's retry writes what GitHub says.
    // A queued one is read here while GitHub still lists it unread until the write lands: only
    // newer activity or a read elsewhere replaces its row, never the same unread row again.
    const queued = new Set([...queuedAtStart, ...this.queuedThreads()]);
    const storedById = new Map(this.threads().map((stored) => [stored.id, stored]));
    const staleUnread = (thread: NotificationThread) =>
      queued.has(thread.id) && thread.unread && thread.updatedAt <= (storedById.get(thread.id)?.updatedAt ?? '');
    const notHeld = (threads: NotificationThread[]) => threads.filter((thread) => !this.heldThreads.has(thread.id) && !staleUnread(thread));
    this.store.transaction(() => {
      this.store.notifications.upsertMany(notHeld([...readById.values()]));
      if (!result.notModified) {
        this.store.notifications.upsertMany(notHeld(result.threads));
      }
      const hadPending = this.pendingWrites.observeRead(new Set(readElsewhere.map((thread) => thread.id)), origin);
      const noticed = inbox !== null ? 'it left the unread list (unread list 200)' : 'the read list says read (unread list 304)';
      for (const stored of readElsewhere) {
        this.textLog(`${origin}: ${threadPrKey(stored) ?? `thread ${stored.id}`} was read elsewhere, noticed because ${noticed}`);
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
      this.storedThreads = null;
      const changed = new Set([...readById.keys(), ...inboxIds, ...readElsewhere.map((thread) => thread.id)]);
      this.reconcileReadTimes(changed);
    });
    const threads = inbox?.filter((t) => threadPrKey(t) !== null).length ?? this.unreadPrThreadCount();
    return { notModified: result.notModified, changed: true, threads, pollIntervalSeconds };
  }

  /**
   * GitHub's read time for the PR's thread, through the read planner
   * (`read_on_github`): its events up to that time seen, stamped with it,
   * never handled.
   */
  private markReadOnGitHub(key: PrKey, events: PrEvent[], lastReadAt: IsoTime): void {
    const plan = planRead({
      scope: prReadScope(key, false),
      cause: { kind: 'read_on_github', readAt: lastReadAt },
      events: new Map([[key, events]]),
      userStates: new Map(),
      at: lastReadAt,
    });
    if (writeReadPlan(this.store, plan).eventIds.length > 0) {
      this.readOnGitHub.add(key);
    }
  }

  /**
   * Every stored event of a PR from before its thread's last read on GitHub
   * counts as seen, stamped with that read time. Runs for the PRs whose
   * threads this run brought in or changed (`changedIds`), not only on a
   * PR's first fetch, so a thread cleared on github.com while the app was
   * closed turns calm on the next start (the read list has it).
   */
  private reconcileReadTimes(changedIds: Set<string>): void {
    const changedKeys = new Set(this.threads().filter((thread) => changedIds.has(thread.id)).flatMap((thread) => threadPrKey(thread) ?? []));
    const readTimes = new Map<PrKey, IsoTime>();
    // Newest thread per PR first, like the Board.
    for (const thread of this.threads()) {
      const key = threadPrKey(thread);
      if (key !== null && changedKeys.has(key) && !readTimes.has(key) && thread.lastReadAt !== null) {
        readTimes.set(key, thread.lastReadAt);
      }
    }
    const events = this.store.events.listForPrs([...readTimes.keys()]);
    for (const [key, lastReadAt] of readTimes) {
      this.markReadOnGitHub(key, events.get(key) ?? [], lastReadAt);
    }
  }

  private markSeenAt(key: PrKey, eventIds: string[], seenAt: IsoTime): void {
    if (eventIds.length > 0) {
      this.store.events.markSeen(eventIds, seenAt);
      this.readOnGitHub.add(key);
    }
  }

  private markOwnEventsSeen(key: PrKey, viewer: Viewer): void {
    const own = ownEventsOnReadThread(this.store.events.listForPr(key), viewer.login);
    for (const event of own) {
      this.store.events.markSeen([event.id], event.at);
    }
    if (own.length > 0) {
      this.readOnGitHub.add(key);
    }
  }

  /**
   * Every stored event of the PR up to the viewer's last touch (their
   * review, comment, push to their own PR, merge or close) counts as seen,
   * stamped with the touch time. GitHub clears the notification only for a
   * visit on github.com, so an approval from the gh CLI left what came
   * before unread. DESIGN.md "You already dealt with it".
   */
  private markSeenBeforeTouch(pr: Pr, events: PrEvent[], viewer: Viewer): void {
    const seen = eventsSeenByTouch(pr, events, viewer);
    if (seen.touch !== null) {
      this.markSeenAt(pr.key, seen.ids, seen.touch.at);
    }
  }

  /**
   * The touch rule over the hot board's PRs, once per full sync. storePr
   * applies it to each PR it writes; this also covers events stored before
   * the rule existed, on PRs that have not moved since. A cold PR gets it
   * here once it turns hot again: reading every stored PR and event for it
   * took gigabytes on a heavy install.
   */
  private reconcileTouches(viewer: Viewer): void {
    const board = Board.load(this.store, this.now().toISOString());
    this.store.transaction(() => {
      for (const pr of board.prs.values()) {
        this.markSeenBeforeTouch(pr, board.events.get(pr.key) ?? [], viewer);
      }
    });
  }

  /** PRs reconciled with GitHub's read time or the viewer's last touch since the last call. */
  private takeReadOnGitHub(): PrKey[] {
    const keys = [...this.readOnGitHub];
    this.readOnGitHub = new Set();
    return keys;
  }

  /**
   * PR threads worth fetching (`selectSyncThreads`): updated in the last
   * SYNC_MAX_AGE_DAYS, with activity after the stored snapshot was fetched.
   * Read threads count too, so a PR handled entirely on github.com still
   * gets its events logged (as seen) and reaches topics, dossiers and
   * facts. Compared against fetch time, not the PR's updatedAt: a thread's
   * updated_at runs ahead of the PR's (CI, bots), which would refetch every
   * PR on every sync. Taken from the store, not the last response, so PRs
   * left over by maxPrs still get fetched after the inbox answers 304.
   * Then the hot slice only (`hotSyncThreads`, DESIGN.md "Big inboxes: what
   * PostPile loads and works on"): a thread older than SETTLED_DAYS only
   * when unread and aimed at the user or on their own open PR, and while
   * the inbox is busy only what would make the board; in board order.
   */
  private candidates(): Candidate[] {
    const now = this.now().toISOString();
    const hot = readHotSet(this.store, now, threadsByPrKey(this.threads()));
    const found = this.store.foundPrs.listAll();
    const viewer = loadViewer(this.store);
    const withRefs = this.threads().flatMap((thread) => {
      const ref = threadPrRef(thread);
      if (!ref) {
        return [];
      }
      const key = prKey(ref);
      // The thread is the news: its reason and read state count over what the stored snapshot says.
      const facts = threadNewsFacts(key, hot.facts.get(key) ?? null, thread, found.get(key)?.via ?? null, viewer);
      return [{ ref, thread, key, unread: thread.unread, updatedAt: thread.updatedAt, facts }];
    });
    const window = selectSyncThreads(withRefs, this.store.prs.fetchedAtByKey(), now);
    const { picked, shed } = hotSyncThreads(window, { now, viewer, selection: hot.selection });
    shed.forEach((key) => this.shed.add(key));
    this.lastShed = shed.length;
    return picked.map(({ ref, thread }) => ({ ref, thread }));
  }

  /** PRs with news the sync and the poll left alone since the last call, because they are outside the hot slice. */
  takeShed(): PrKey[] {
    const keys = [...this.shed];
    this.shed = new Set();
    return keys;
  }

  /**
   * Writes the snapshot and its events. Returns the ids of events that are new.
   * Every event goes to the event log, not only the new ones: the log ignores
   * ids it has, and this also picks up events stored before the log existed.
   * `fetchedAt` is when the fetch started, where paging older items
   * (CapFiller) sits between fetch and store: the snapshot must not look
   * newer than what it holds, or a thread updated meanwhile would look
   * covered by it.
   */
  private storePr(pr: FullPr, viewer: Viewer, fetchedAt: IsoTime = this.now().toISOString()): string[] {
    const at = this.now().toISOString();
    return this.store.transaction(() => {
      this.store.prs.upsert(pr, fetchedAt);
      const userState = this.store.userPrStates.get(pr.key);
      const events = deriveEvents(pr, viewer, userState);
      const created = this.store.events.upsertDerived(pr.key, events);
      const inTimeOrder = [...events].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
      this.store.eventLog.append(
        inTimeOrder.map((event) => ({ id: event.id, prKey: pr.key })),
        at,
      );
      // Anything older than the user's last read on github.com was already seen there.
      const thread = this.store.notifications.getByPrKey(pr.key);
      const lastReadAt = thread?.lastReadAt ?? null;
      if (lastReadAt !== null) {
        this.markReadOnGitHub(pr.key, this.store.events.listForPr(pr.key), lastReadAt);
      }
      // A thread that stays read: the user's own merge, close, comment or review never made it unread.
      if (thread && !thread.unread) {
        this.markOwnEventsSeen(pr.key, viewer);
      }
      // Whatever came before the user's own last action was seen by them, however they acted.
      this.markSeenBeforeTouch(pr, this.store.events.listForPr(pr.key), viewer);
      this.lessons.afterStorePr(pr, created, viewer);
      return created;
    });
  }

  /**
   * Fetches the missing layers of the stacks tracked PRs (pinged or found)
   * sit in, and records them as pulled in. Seeds are the tracked PRs fetched
   * this sync plus every stored open tracked PR on the hot board, since a
   * new layer on top (often a draft) does not move the PR below it. A layer whose snapshot
   * has not moved since the last fetch is not fetched again.
   */
  private async pullInStackLayers(fetched: Pr[], viewer: Viewer): Promise<FullPr[]> {
    const tracked = this.trackedPrKeys();
    const seeds = new Map<PrKey, LayerShape & { key: PrKey }>();
    const hot = Board.load(this.store, this.now().toISOString()).prs;
    // Headers carry the layer below a body declares; a fresh fetch reads it from the body.
    const fetchedSeeds = fetched.map((pr) => ({ ...pr, declaredParent: declaredParentOf(pr) }));
    const storedSeeds = this.store.prs.listHeaders().filter((stored) => stored.state === 'OPEN' && hot.has(stored.key));
    for (const pr of [...fetchedSeeds, ...storedSeeds]) {
      if (tracked.has(pr.key) && !seeds.has(pr.key)) {
        seeds.set(pr.key, pr);
      }
    }
    if (seeds.size === 0) {
      return [];
    }
    const layers = await this.layers.find([...seeds.values()], tracked);
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

  /**
   * One finder request per full sync (never in the poll): the viewer's own
   * open PRs, review requests for them and their teams, and PRs involving
   * them merged in the last FOUND_MERGED_DAYS. The list replaces the stored
   * one; PRs not stored yet or with a newer updatedAt go through the
   * batched fetch. A failure is reported and the rest of the sync goes on.
   */
  private async syncFound(viewer: Viewer, alreadyFetched: Map<PrKey, Pr>, errors: string[]): Promise<FullPr[]> {
    const at = this.now().toISOString();
    let refs;
    try {
      refs = await this.reader.findPrs(viewer.teams, daysBefore(at, FOUND_MERGED_DAYS).slice(0, 10));
    } catch (error) {
      errors.push(`found PRs: ${errorText(error)}`);
      return [];
    }
    this.store.foundPrs.replaceAll(refs.map((found) => ({ prKey: prKey(found.ref), via: found.via, reason: found.reason, foundAt: at })));
    const storedAt = this.store.prs.updatedAtByKey();
    const moved = refs.filter((found) => !alreadyFetched.has(prKey(found.ref)) && storedAt.get(prKey(found.ref)) !== found.updatedAt);
    const prs = [...(await this.fetchPartial(moved.map((found) => found.ref), errors, 'found PRs')).values()];
    for (const pr of prs) {
      this.storePr(pr, viewer);
    }
    return prs;
  }

  /**
   * PRs a tile shows (pinged, found or pulled in) that are open or draft,
   * plus ones merged or closed within FRESHNESS_CLOSED_WINDOW_MS. Hot ones
   * only: a PR the board leaves out would only be fetched to be cut again.
   */
  private freshnessRefs(skip: Set<PrKey>): PrRef[] {
    const hot = Board.load(this.store, this.now().toISOString()).prs;
    const tracked = new Set<PrKey>([...this.trackedPrKeys(), ...this.store.pullIns.listAll().keys()].filter((key) => hot.has(key)));
    const cutoff = new Date(this.now().getTime() - FRESHNESS_CLOSED_WINDOW_MS).toISOString();
    return this.store.prs
      .listHeaders()
      .filter((pr) => tracked.has(pr.key) && !skip.has(pr.key))
      .filter((pr) => pr.state === 'OPEN' || pr.updatedAt >= cutoff)
      .map((pr) => pr.ref);
  }

  /**
   * The freshness check: one updatedAt query for every PR a tile shows.
   * Notification threads do not move for everything (the user's own
   * approve or merge, quiet PRs, threads that stay read), so without it a
   * PR could stay stale for days. Returns the PRs GitHub has newer than the
   * store; the caller fetches them in full. The poll logs only when
   * something moved.
   */
  private async movedPrs(skip: Set<PrKey>, origin: 'sync' | 'poll'): Promise<PrRef[]> {
    this.lastFreshnessAt = this.now().getTime();
    const refs = this.freshnessRefs(skip);
    if (refs.length === 0) {
      return [];
    }
    const remote = await this.reader.prUpdatedAts(refs);
    const stored = this.store.prs.updatedAtByKey();
    // Snapshots stored before assignees were read (2026-09-30) refetch once, or a bot PR's owners stay unknown until it moves.
    const checked = this.store.prs.getMany(refs.map(prKey));
    const withoutAssignees = new Set([...checked.values()].filter((pr) => pr.assignees === undefined).map((pr) => pr.key));
    const moved = refs.filter((ref) => {
      const updatedAt = remote.get(prKey(ref));
      const was = stored.get(prKey(ref));
      return updatedAt !== undefined && (was === undefined || updatedAt > was || withoutAssignees.has(prKey(ref)));
    });
    if (origin === 'sync' || moved.length > 0) {
      const which = moved.length > 0 ? `: ${moved.map(prKey).join(', ')}` : '';
      this.textLog(`${origin}: freshness check, ${refs.length} PRs checked, ${moved.length} moved${which}`);
    }
    return moved;
  }

  private freshnessDue(): boolean {
    return this.now().getTime() - this.lastFreshnessAt >= FRESHNESS_POLL_EVERY_MS;
  }

  /** The poll's freshness check when due; a failure is logged and skipped, the poll goes on. */
  private async movedPrsFromPoll(skip: Set<PrKey>): Promise<PrRef[]> {
    if (!this.freshnessDue()) {
      return [];
    }
    try {
      return await this.movedPrs(skip, 'poll');
    } catch (error) {
      this.textLog(`poll: freshness check failed: ${errorText(error)}`);
      return [];
    }
  }

  /** Remembers what the poll fetched, so the next full sync verifies facts and walks stacks for them too. */
  private rememberPolled(keys: PrKey[]): void {
    const known = JSON.parse(this.store.meta.get(POLLED_KEY) ?? '[]') as PrKey[];
    this.store.meta.set(POLLED_KEY, JSON.stringify([...new Set([...known, ...keys])]));
  }

  /** PRs the poll fetched since the last full sync, still stored. The list is cleared once the run got through (`run`). */
  private polledPrs(skip: Map<PrKey, Pr>): Pr[] {
    const keys = JSON.parse(this.store.meta.get(POLLED_KEY) ?? '[]') as PrKey[];
    return [...this.store.prs.getMany(keys.filter((key) => !skip.has(key))).values()];
  }

  /** Writes snapshots and events. Returns the ids of new events on pinged PRs. */
  private storeAll(fetched: Map<PrKey, FullPr>, viewer: Viewer, fetchedAt: IsoTime): string[] {
    const newEventIds: string[] = [];
    for (const pr of fetched.values()) {
      newEventIds.push(...this.storePr(pr, viewer, fetchedAt));
    }
    return newEventIds;
  }

  /**
   * Pages older items into this run's fetched PRs that need them (CapFiller),
   * at most `budget` PRs per run. Found PRs and stack layers are left out:
   * they are fetched for tiles and stacks, and a PR whose thread moves comes
   * through the main fetch.
   */
  private capFiller(origin: 'sync' | 'poll', budget: number): CapFiller {
    return new CapFiller(this.reader, this.store, this.quota, origin, budget, this.textLog);
  }

  /** Reads which lines open PRs edit, after they are stored (DiffReader): a few per run. */
  private diffReader(): DiffReader {
    return new DiffReader(this.reader, this.store, this.quota, this.now, this.textLog);
  }

  /**
   * The full sync's fetch: a failed batch (GitHub's "Something went wrong"
   * timeout on a heavy query, a 502) lands in `errors` and its PRs stay
   * candidates for the next sync; the other batches still store. One bad
   * batch used to throw away the whole sync.
   */
  private async fetchPartial(refs: PrRef[], errors: string[], what: string): Promise<Map<PrKey, FullPr>> {
    if (refs.length === 0) {
      return new Map();
    }
    const count = this.count;
    if (count) {
      count.planned = (count.planned ?? 0) + refs.length;
    }
    const result = await this.reader.fetchPrsPartial(refs, (prs) => {
      if (count) {
        count.read += prs;
      }
    });
    errors.push(...result.errors.map((error) => `${what}: ${error}`));
    return result.prs;
  }

  /**
   * The fast poll: a conditional inbox read plus the read-threads watch,
   * and on a change the PRs whose threads moved since their last fetch,
   * newest first, at most maxPrs. Once a minute also the freshness check.
   * The rest wait for the next change or the full sync. No stack layers, no
   * agent. Shares the inbox ETag with the full sync, so whichever reads a
   * change first stores it and the other gets a 304; the full sync still
   * finds the events through the event log.
   */
  async poll(maxPrs: number, focus: PollFocus = NO_FOCUS): Promise<InboxPollResult> {
    this.beginRun();
    const firstLook = this.threads().length === 0;
    const looked = await this.lookUpThreads(focus.threadIds);
    const notifications = await this.syncNotifications('poll', looked);
    const { pollIntervalSeconds } = notifications;
    const refs = notifications.changed ? this.candidates().slice(0, maxPrs).map((candidate) => candidate.ref) : [];
    const picked = new Set(refs.map(prKey));
    for (const ref of focus.prRefs) {
      if (!picked.has(prKey(ref))) {
        refs.push(ref);
        picked.add(prKey(ref));
      }
    }
    refs.push(...(await this.movedPrsFromPoll(picked)));
    if (!notifications.changed && refs.length === 0) {
      return { notModified: true, pollIntervalSeconds, firstLook, viewer: null, fetchedPrKeys: [], newEventIds: [], readOnGitHub: [] };
    }
    let viewer = loadViewer(this.store);
    if (!viewer) {
      viewer = await this.reader.viewer();
      saveViewer(this.store, viewer);
    }
    const fetchedAt = this.now().toISOString();
    const fetched = await this.capFiller('poll', CAP_FILL_POLL_PRS).fill(refs.length > 0 ? await this.reader.fetchPrs(refs) : new Map<PrKey, FullPr>());
    const newEventIds = this.storeAll(fetched, viewer, fetchedAt);
    await this.diffReader().run('poll', DIFF_POLL_PRS);
    this.rememberPolled([...fetched.keys()]);
    const readOnGitHub = this.takeReadOnGitHub();
    return { notModified: false, pollIntervalSeconds, firstLook, viewer, fetchedPrKeys: [...fetched.keys()], newEventIds, readOnGitHub };
  }

  /** The full sync's fetch; `run` counts it. */
  private async fetchAll(maxPrs: number): Promise<GitHubSyncResult> {
    this.beginRun();
    // Roles first: only home teams' members are teammates.
    const viewer = await this.teamMembers.attach(await this.teamRoles.attach(await this.reader.viewer()));
    saveViewerFollowingRoles(this.store, viewer, this.now().toISOString());
    const notifications = await this.syncNotifications('sync');

    const candidates = this.candidates();
    const picked = candidates.slice(0, maxPrs);
    if (this.lastShed > 0) {
      this.textLog(`sync: ${this.lastShed} PRs with news left alone, outside the hot slice (settled, or not for you or your team while the inbox is busy)`);
    }
    // A failed batch, found-PRs query or stack lookup should not cost the rest of the sync; the next sync tries again.
    const errors: string[] = [];
    // Before the quiet reads, older pages for PRs whose snapshot stops short of their unread thread's last read.
    const capFiller = this.capFiller('sync', CAP_FILL_SYNC_PRS);
    const fetchedAt = this.now().toISOString();
    const fetched = await capFiller.fill(await this.fetchPartial(picked.map((candidate) => candidate.ref), errors, 'PRs'));
    const newEventIds = this.storeAll(fetched, viewer, fetchedAt);
    // PRs whose thread did not move but GitHub has a newer updatedAt: approvals, merges, pushes.
    let movedRefs: PrRef[] = [];
    try {
      movedRefs = await this.movedPrs(new Set(fetched.keys()), 'sync');
    } catch (error) {
      errors.push(`freshness check: ${errorText(error)}`);
    }
    const movedAt = this.now().toISOString();
    for (const [key, pr] of await capFiller.fill(await this.fetchPartial(movedRefs, errors, 'moved PRs'))) {
      fetched.set(key, pr);
      newEventIds.push(...this.storePr(pr, viewer, movedAt));
    }
    // The poll fetched these already; they still get their stacks walked and facts verified here.
    const polled = this.polledPrs(fetched);
    const found = await this.syncFound(viewer, fetched, errors);
    let pulledIn: Pr[] = [];
    try {
      pulledIn = await this.pullInStackLayers([...fetched.values(), ...polled, ...found], viewer);
    } catch (error) {
      errors.push(`stack layers: ${errorText(error)}`);
    }
    await this.diffReader().run('sync', DIFF_SYNC_PRS);
    // Only now: a run that threw above keeps the list for the next sync.
    this.store.meta.delete(POLLED_KEY);
    this.reconcileTouches(viewer);
    return {
      viewer,
      notModified: notifications.notModified,
      threads: notifications.threads,
      prsFetched: fetched.size,
      prsSkipped: candidates.length - picked.length,
      prsPulledIn: pulledIn.length,
      prsFound: found.length,
      fetchedPrKeys: [...fetched.keys(), ...polled.map((pr) => pr.key), ...pulledIn.map((pr) => pr.key), ...found.map((pr) => pr.key)],
      newEventIds,
      readOnGitHub: this.takeReadOnGitHub(),
      errors,
    };
  }

  /** How far the running full sync's fetch is, a copy; null when none runs. */
  fetchCount(): FetchCount | null {
    return this.count ? { ...this.count } : null;
  }

  async run(maxPrs: number): Promise<GitHubSyncResult> {
    this.count = { read: 0, planned: null };
    try {
      return await this.fetchAll(maxPrs);
    } finally {
      this.count = null;
    }
  }
}
