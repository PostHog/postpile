# PostPile design

Decisions from the design rounds, tidied. Open points are at the end.

## Product model

**Inbox zero when PRs keep flying at you** (2026-10-05). Agents now open PRs
alongside people, so a busy engineer gets more review traffic than anyone can
read. PostPile is the way to still reach inbox zero and stay there. This is
the pitch in docs, release notes and onboarding.

**A helper, not an interrupter** (2026-10-05). PostPile takes noise away. It
sorts, condenses and remembers, so there is less to read and fewer things that
can interrupt you. The calm list you open when you choose to is the product.
Mac pings are an opt-in side effect, off by default, and nothing in the app,
its onboarding or its docs leads with them. Why: the team liked the digests
and the agent layer, but when the pings were presented with enthusiasm, they
filed PostPile as one more app that breaks up their day. When a feature could
push PostPile toward demanding attention (badges, sounds, banners, Dock
bounces, nudges to come back), the default is quiet and turning it on is the
user's choice.

**Topics** are agent-maintained clusters of PRs, e.g. "Move CI to Depot". Each
has a stable id, a name, who drives it, the user's role, an agent-written
summary, and *tailoring*: per-topic instructions the user gave through chat,
stored only after the user confirms. Topics are never renamed or merged
silently; the agent files proposals and the user decides. The one exception
is a small split (2026-09-29): consolidation applies a split of at most 3
PRs (`AUTO_SPLIT_MAX_PRS`, stack layers counted, every named PR in the topic,
at least one PR left behind) right away, with no undo; "Wrong topic" on a PR
fixes a bad one, and that correction reaches the next consolidation prompt.
Bigger splits stay proposals.

**"Wrong topic" sticks** (2026-10-05): no rule and no agent puts a PR back
into a topic the user took it out of. The stack shortcut skips that topic
and asks the agent; the assignment prompt names it per PR, and an answer
that picks it (by id, or by a "new" name matching its name, also when the
topic is in the Archive and no longer offered) is dropped, so the PR gets
the retry and else waits in Unsorted; the topic tidy folds or
splits nothing that would put it back with that work. The "no" follows the
topic into whatever it is merged into, and on a stack it holds for every
layer that moved (one feedback row each). Only the user puts it back, by
picking that topic; a merge proposal they accept is their call too
(`excludedTopicIds` in core, `TopicExclusions` in the engine).

**Areas, topics, tiles and sets** (2026-09-29): one glossary,
`WORK_GLOSSARY` in `packages/agent/src/prompts/shared.ts`, goes into every
prompt that sorts, groups or tidies PRs (topic assignment, set grouping,
dossier update, consolidation), so all agents cut work at the same grain:

- *Area*: the part of the product or codebase the work touches ("Hogland",
  "Data warehouse", "posthog-cli"), never the user's own field or team
  ("Dev tooling" held most topics and said nothing). A
  label on topics, never a topic itself, a handful to about fifteen topics
  each. The dossier update replaces a catch-all area when it next writes the
  topic (still at most MAX_NEW_AREAS_PER_SYNC new areas per sync).
- *Topic*: one goal someone drives, with a finish line. The test: one
  sentence states the goal, and every PR moves it forward or came out of
  that work while it was going on (a fix found while doing it). Sharing a
  repo, an area or a word ("CI", "security") is not enough.
- *Tile*: what the user handles in one go inside a topic: a PR, a stack or
  a set.
- *Set*: two or more PRs of one topic that one judgement covers (the same
  change or pattern, similar risk). Lasting: never cut by status, turn or
  review state (since 2026-10-01, see "Tiles hold still").

Topic assignment puts a PR into a live topic whose goal it serves or came
out of (live: open PRs or activity in the last two weeks; each offered topic
shows its open count and last activity). A finished or quiet topic only takes
a direct follow-up; anything else gets a new topic. There is no catch-all
"fixes and upkeep" topic and no preference for broad topics any more: that
preference let unrelated PRs pile into one topic. The user's instructions may
set a finer or coarser grain.

**Topic size by example** (2026-10-01). A fresh start on the user's last
seven days (`simulate-start`) gave 150 topics for about 260 PRs, 109 of them
with one PR: the agent took each PR's own change as its goal, and one
project of the user's came out as three topics. The assignment prompt now
carries `TOPIC_SIZE_EXAMPLES`: a topic is a project someone drives for days to
weeks (or, since the same evening, a standing topic: see "Topic kinds") ("would the driver name it in a weekly update?"), with right-size,
too-small and too-big examples; a project named in the user's work context is
the topic for their PRs; the same person on the same product in the same
stretch of time is usually one project. How PRs are fed changed too: batches
go by author, then oldest first (was repo, then branch name, which scattered
one person's feat/, fix/ and chore/ branches); every batch sees the round's
whole backlog as one fenced line per PR; a new topic comes with a one-sentence
goal, kept as its summary until the first dossier, so later batches see what
it is for. Routed one-off PRs still get a topic each.

**Topic kinds** (2026-10-01): a topic is a `project` (one goal with a
finish line) or `standing` (one standard kept up for months with no finish
line, "Migration safety", "Code ownership"; its PRs come in waves). "A
project of days to weeks" had split such standards into deliverables: a real
database held migration safety as "Django migration runbook docs" and code
ownership in four topics. `topic.kind` (migration 023, default `project`):
the agent picks it for a new topic (`topicKind` in the assignment answer), the
grain 3 tidy sorts existing ones, and `TOPIC_SIZE_EXAMPLES` describes both,
with sub-parts of a standing topic as too small (a wave of them is a set) and
a whole product as too big. The kind decides how long a topic in the Archive
still takes new PRs (`takesNewPrs`, `archiveEndsAt`): a project 30 days after
it got there, a standing topic until half a year passes without a PR joining
it (the user's rule). Past that it is retired for good: the agent no longer
offers it and the Archive drawer drops it. The topic list in the assignment
prompt says each topic's kind, and a topic in the Archive says "Finished" or
"Quiet for now"; a quiet standing topic takes the next PR of its standard
however long it slept. A standing topic's dossier follows the current wave
and never calls the topic finished (`STANDING_DOSSIER_RULE`).
The kind is the agent's (owner decision): no switch for the user and no
proposal. A dossier update may correct it (`topicKind` in the answer, applied
right away) when the topic was clearly cut as the wrong kind. A project whose
goal is reached stays a project; when people keep extending what it built
("GitHub egress" turned into "egress", with others adding to it), the next
PRs go to a standing topic named after the standard, started if needed.
**Ownership signal**: the topic list shows each topic's owner team (the
dossier relation's `ownerTeam`), and a PR that reaches the user through a
team review request is judged by what that team keeps up: when it changes
code of a standard a standing topic keeps (same owner team, same code), it
joins that topic, also when it is a step of someone else's project. Routed
PRs that fit no standing topic are placed as before. In a sample database over half
of the one-PR topics were routed reviews, so this is where ownership helps;
it never cuts topics by team on its own (a team owns many goals). Research
(PARA, GTD, Linear, Jira, Shape Up) found no third lifecycle worth a kind:
incidents behave like short projects, chores are single tiles.

**Topic status**: `active`, `retired` (in the Archive) or `archived`
(merged away, never comes back). The app says "Archive" for retired topics;
code keeps "retired" because "archived" already means merged away. Every
full sync ends by retiring each active topic that passes the gate
(`RetireGate`, `retireFinishedTopics`, on the whole topic with its cold PRs,
see "Big inboxes: what PostPile loads and works on"): every member PR merged or closed, no
human activity for 2 days (2026-10-01; was any event for 3 days: deploys,
CI and bot comments land after a merge and kept 18 of 32 finished topics of
a real database in the sidebar), every thread of the topic read on
GitHub (since 2026-09-30, "GitHub unread is PostPile unread") and every
tile done (since 2026-09-29 evening; before, only "no unread or snoozed
tile", which retired topics holding unseen merges without the user's
review). No agent verdict is needed, and Unsorted never retires. It runs
after the digest and the quiet reads, so the sync's own events and what
PostPile cleared by itself count; the sync log line and
`SyncReport.topicsRetired` say how many. Retiring is reversible: a new loud
event on a member PR (`reviveRetiredTopics`, full sync and live poll), a
member thread unread on GitHub that the quiet reads would not clear by
rule (`reviveUnreadTopics`, after the retire step of every full sync and in
every poll that moved the inbox, also for topics an older build retired
with an unread thread) or a new PR assigned to it
(while it takes new PRs, see "Topic kinds") makes it active again. Every
status change goes through `nextTopicStatus` (engine: `changeTopicStatus`),
and retiring records `retiredAt` (migration 020; before, "retired at" read
`updatedAt`, which any rename moved). Loud means effective loudness: the
full sync classifies new events first (retired topics' events included) and
revives after, so an event the agent turned quiet brings nothing back. The
live poll does not classify and still revives on the rule's loudness. Retired
topics leave the sidebar list and wait in its Archive drawer (see "Queue
sections"). **Archive now** (2026-10-01): the topic's action row, where ✨
Approve and "Mark N read" sit under the Tiles count, shows a box once nothing
is left in the topic (every PR over, every thread read, every tile done;
`TopicDetail.archive`, `TopicArchiveBox`): "Everything here is dealt with. It
moves to the Archive by itself on <day>", and an "Archive now" button
(`POST /api/topics/:id/archive`, refused while anything is open or unread;
telemetry `topic_archived`) that skips the 2 quiet days. In the Archive the
box says since when, what brings the topic back, and until when it takes new
PRs. The renderer refetches the Archive list before the rest, so the open
topic never sits in neither list (the view would fall back to another topic
and pin it). Until 2026-09-29 only the daily consolidation retired topics,
and only when the agent said finished and 14 quiet days had passed; most
topics with every PR merged never left the sidebar.
**Where the topic went** (2026-10-07, owner): "Archive now" used to drop the
sidebar row in one frame; the list jumped and nothing showed where the
topic went. Now a copy of the row lifts off and flies into the Archive fold
(~560ms, shrinking and fading on the way, `flyToArchive` in
`lib/archive-flight.ts`), the row's space closes smoothly behind it
(`.topic-row-leaving`, from +120ms over 280ms) and the fold tints
`--accent-soft` as the copy lands (~300ms in, ~900ms out). The Archive
gets no count. The sidebar keeps the old row (`archivedRow` in
`lib/sidebar.ts`: the open topic left the list and is in the Archive)
until the flight ends, re-renders once its space has closed so the FLIP
slides measure the list as it is, and the footer slides with the list
instead of sitting under rows that slide over it. Reduced motion: the row
just goes.

**Tiles** are the unit of attention inside a topic. A tile holds one of:

- a single PR (`pr:<prKey>`)
- a real stack, derived from git base/head refs (`stack:<bottom prKey>`)
- a set: agent-grouped related PRs that are not stacked in git (`set:<setId>`)

A stack is one unit: it shows whole, in one topic, as its own tile or inside
one set tile, and never split across tiles (see "Stacks as one unit").
Otherwise a PR is in one tile. Tile composition is derived on every read,
never stored.

**Provenance** per PR inside a tile:

- `pinged`: GitHub notified the user (review request, mention, team mention,
  author, subscribed, ...)
- `found`: not in the inbox; the full sync found it with one GraphQL request
  (`findPrs`, `buildFoundQuery` in packages/github; never in the live poll):
  the user's own open PRs (`own_open`, "your open PR", code AU), every open
  PR assigned to them (`assignee:@me`: a bot's as `own_open`, "agent PR
  assigned to you"; a person's as `assigned`, "assigned to you", AS; see
  "PR ownership"), reviews asked
  of them (`review_requested`, `user-review-requested:@me`, RV) or of each of
  their teams (`team_review_requested`, one search alias per team, RT), and PRs
  involving them merged in the last 7 days (`involved_merged`, AU or CM).
  Ids and updatedAt only, at most 200; stored in `pr_found` (migration 014,
  replaced on every sync); PRs not stored yet or with a newer updatedAt go
  through the batched PR fetch, unchanged ones are skipped. No teammates'-PR
  fetch.
- `pulled_in`: a stack layer the sync fetched by branch to complete a pinged
  or found PR's stack, reason "stack layer below/above #N" (see "Stack
  completion")

A tile only exists if at least one member is pinged or found (`isTracked`).
Provenance is derived: a notification thread makes a PR pinged, then a
`pr_found` row makes it found, then a pinging event, else pulled in. So a
pulled-in or found PR that later gets a real ping becomes pinged without
anything having to update it. Found PRs work like pinged ones for tiles,
topics (Unsorted until assigned), dossiers, glances, whose turn and the
queues, but never make a tile unread on their own (they have no thread,
and their loud events do not count as the tile's loud news,
`unseenLoudEvents` is 0); an owed review still
says "Your move" and lifts the topic. Quiet repos apply to them too. The why
badge tooltip says "found: <reason>; not in your inbox, found via GitHub".
Stack completion walks from pinged and found PRs alike. Sets are
agent-grouped among pinged and found PRs; the agent never pulls PRs in.

**Events**: every GitHub activity on a PR becomes an event line. Loudness:

| loudness | effect | examples |
|---|---|---|
| loud | pings, coral "new since you looked", lights up the topic (the tile is unread while its thread is unread on GitHub, loud or not: "GitHub unread is PostPile unread") | mention, review requested, question to the user, a push after the user approved when the agent raises it, the author's push or comment after the user requested changes ("addressed your changes") |
| quiet | dot, no ping | bots, deploys, merge queue (except trunk taking your own PR out of it: loud, see "Merge queue"), pushes after the user approved (by default), merged without the user's review (never loud; surfaced by the done rule instead, see "Merged without your review") |
| muted | hidden as noise, one click to unmute | bot rebase on a draft |
| seen | already read | any of the above after reading, or before the user's own last action on the PR (see "You already dealt with it") |

Rules classify first (`ruleLoudness` in core). The agent may override with a
reason; overrides are stored on the event. `seen` is user state (`seenAt`), not
a classification. The effective loudness (override over rule) of a reply,
mention or question also decides whether it is still an ask for whose turn:
lowered to quiet or muted, it asks nothing (see "Whose turn", rule 2).

**A review request counts by whom it asks, not who clicked it** (decided
2026-09-29). A teammate's PR was marked ready, then a reviewer-assigning bot
requested the viewer's team. The request event was classified "bot activity"
(quiet) because its actor is a bot, so the ping was withheld as
`not_addressed: ready for your review`, while whose turn said "Review for
team-devex: <teammate>'s PR". Rule: a `review_requested` event is classified
by its target (the viewer, one of the viewer's teams), whether a person or a
bot made the request; the bot-actor shortcut never applies to a review
request aimed at the viewer or their team (`ruleLoudness`, and the bot-only
class in `pingRule`). Loudness and ping class then follow the path of a
human-made request: a personal request and a team request on a teammate's
PR are addressed; a routed team request goes the way a human-made routed
request goes (see "Routed team requests ping when the glance says Look
closer" under the pings). Requests to other people or teams stay quiet bot
activity. Whose turn never names a bot as the requester ("Review for
team-devex", "Review"), and the ping template says "Review requested for
team-devex" instead of the bot's name.

**Tile state is derived, never stored**:

- `unread` (since 2026-09-30, "GitHub unread is PostPile unread"): a
  member's notification thread is unread on GitHub, whether the tile is done
  or not, or a pulled-in stack layer has unseen loud news, or the app's Look
  closer event is unseen (unread here while read on GitHub is fine, never
  the reverse). The tile says which PR and why: its unseen loud events, else its
  newest unseen quiet event, else "new activity on GitHub". Until then it
  meant "a member has an unseen loud event"; that fact stays as
  `TileState.loud` and drives pings, coral, urgency and sections. A snoozed
  tile keeps its snooze while a thread is unread (`TileState.unreadOnGitHub`)
  and sits in the Unread group (see "Groups inside a topic").
- `snoozed`: every tracked PR in the tile has an active snooze whose condition is not met
  yet. Snoozes are stored per PR (see "Snoozes belong to PRs"); every snooze also ends
  when its PR is merged or closed. `TileState.muted` when every one of them is a
  mute (see "Mute until I'm mentioned").
- `done`: every pinged member is done, nothing loud is unseen and no thread is unread
  on GitHub. A PR is done only when
  nothing is asked of the user (`isPrDone`, 2026-09-28): merged or closed (except a merge
  without their review they have not seen yet, see "Merged without your review"), or approved by
  them while whose turn is not "you" (a later question or mention after the approval keeps
  it out of Done), or handled (marked read) while whose turn is not "you" and no review is pending of
  them (`reviewPending`: a personal request, a team request on a teammate's PR, or a routed
  team request no teammate picked up and not on hold (`teamRequestHold`, see whose turn),
  head not reviewed by them). Marking read a PR that
  still waits on their review makes it read (no strip, no coral) but leaves it open in the
  normal tile list with its turn footer, and in To review; it never lands in Dealt with.
  An approval counts on any commit (2026-09-28): a PR the user approved stays done after later
  pushes. `commits_after_approval` events are quiet by the rules; the tile comes back only
  through the normal loud events (re-review requested, mention, question, changes requested)
  or when the agent raises the push (see Sync flow › events).
- `open`: everything else.

**Glance** per pinged PR (pulled-in stack layers get none): verdict
(`LOOKS_SAFE` | `LOOK_CLOSER` | `NOT_YOURS`), `forYou` (one or two sentences
against the user's own instructions), `does`, `risk`, `othersSaid`. Cached by a
hash of its inputs; regenerated only when the PR moves or instructions change.

**User actions**: approve (single press, immediate, no undo), mark read, snooze
(until someone replies | new push | a time; "until CI is green" until 0.21.0), mute
(until someone asks the user in person; also a mark-read and GitHub's thread
unsubscribe), "ask <person>" (agent
drafts a PR comment, user edits and sends), feedback on a tile ("not mine",
"not related" for sets, "wrong topic"), chat on a tile. Lasting points from
chat come back for the user to place: "Keep for this topic" (tailoring), "Keep
for all topics" (an instructions proposal) or "Just this once" (only logged).
The agent spots the point but never picks the scope.

**Mark read is deferred**: acting on a tile marks the GitHub notification read
through a queue with a 6s undo window, because GitHub has no mark-unread API
(and only while the footer lock allows GitHub writes; otherwise it becomes a
pending write and nothing changes in the app, see "GitHub writes: lock,
action log").
Batches stack; undo walks back newest first; quitting flushes instead of
dropping (and waits for sends already in flight). The queue lives in the
engine (`MarkReadQueue`), in memory. A GitHub mark-read covers the whole
thread, including activity after the last sync, so right before each PATCH the
queue reads the thread again: if its `updated_at` moved past the synced value
the thread stays unread, and the next sync fetches the new activity. Local
`last_read_at` becomes the thread's `updated_at`, not the send time. Skips and
failures (one failed thread never stops the rest) show up in the next sync
report.

**Sync** (the full one) runs on app start, on "Sync now" and every 60 minutes in
the background (see "Auto sync"). On top of it the desktop app runs a fast
notification poll with Mac pings, see "Live poll and Mac pings", and catches up
dossiers and glances of the topics the poll brought news for, see "Glance
catch-up".
PR threads whose activity is newer than the stored snapshot's fetch time get
enriched, unread ones first, read ones too (see "Reconciling with GitHub's
read time") (a thread's `updated_at` runs ahead of the PR's own, so
comparing against the PR would refetch everything). `SyncOptions` exist for
cheap runs: `maxPrs` (newest first, the rest follow on later syncs even after a
304), `maxAgentCalls`, `agentJobs`.

**Big inboxes**: what a sync fetches, what the board holds and what the
agent works on follow one rule, the hot set; see "Big inboxes: what
PostPile loads and works on" (2026-09-29, reworked 2026-10-05).

**Reconciling with GitHub's read time.** Every event on a thread from before
that thread's `last_read_at` counts as seen, stamped with that time, whenever
the app learns it (core `eventsReadOnGitHub`), not only on a PR's first
fetch: after every change of the stored threads (`reconcileReadTimes` in
`GitHubSync`) and when a PR snapshot is stored. So a tile cleared on
github.com while the app was closed turns calm on the next start.

- **Read list**: besides the unread inbox, the sync asks
  `GET /notifications?all=true&since=<start of the last full sync>` (all
  pages, own ETag, meta `read_threads_since` / `read_threads_etag`). The full sync always asks and then moves
  `since` to its own start; the live poll asks only when the inbox moved,
  with the same `since`, so it mostly gets a 304. Without a stored `since`
  (first run, or no last-sync marker) it looks back 7 days. Read threads the app never
  saw unread are stored too, and their PRs are fetched like unread ones: a
  PR handled entirely on github.com still gets its events logged (as seen),
  lands in Unsorted / a topic and feeds dossiers and facts.
- **Left the inbox**: a stored unread thread missing from the inbox (or
  that the read list says is read) takes its `last_read_at` from the read
  list, else from one `GET /notifications/threads/:id` (at most 20 per
  sync), else the sync time. It is logged `observed` and a pending write for
  it is cleared, as before (9180771).
- **Since you last looked**: after the sync's digest (and after a poll), the
  seen cursor of every topic whose PRs just turned seen this way moves up to
  the last logged event before the first unseen one (core `seenBoundary`).
  A topic that is fully caught up also takes the current dossier version and
  the time, like `markTopicSeen`; a topic never marked seen only gets a
  cursor once caught up.
- Never marks anything read on GitHub. Locked mark-reads stay pending until
  GitHub itself reports the thread read.
- Caveats: GitHub's `since` filters by the thread's `updated_at`, which a
  plain read does not move, so a thread read without new activity is only
  found through "left the inbox". Commit events use the commit time, so an
  old commit pushed after the read counts as read.
- The viewer's own last touch works the same way (2026-09-29, "You already
  dealt with it"): every event up to it is marked seen in the store,
  stamped with the touch time, so tile state, whose turn, pings, "since you
  last looked" and `whatsNew` agree without a second rule.

Action details:

- mark read (tile footer): every member's events seen, pinged members handled (tile turns
  done until something loud happens, unless a review or another move is still
  the user's, then it stays open and read and keeps its place), thread
  mark-read queued. Undo reverts both. The button says "Mark done" only where
  that makes the tile done (see Tile faces › After a mark-read).
- mark read (detail pane, 2026-09-29): the selected PR only (see "Actions
  act on what you look at"): its events seen, handled unless it is a
  pulled-in layer, its thread mark-read queued, origin `detail`, its own
  undo. `POST /api/tiles/:tileId/prs/:owner/:repo/:number/mark-read` ->
  `EngineService.markPrRead`. On a single-PR tile the pane uses the tile's
  mark read, which is the same thing.
- remove team request (detail pane, 2026-09-29): see "Actions act on what
  you look at" › Remove a team review request.
- approve: GitHub approval right away, pinned with `commit_id` to the synced
  head (the commit the glance and the user saw), then the same mark-read for
  that PR. The undo token only brings back the unread state, never the approval.
- mute (2026-10-05): a `muted` snooze on each tracked PR, then the same as
  mark read with the threads' unsubscribe in the batch; unmute subscribes
  again. See "Mute until I'm mentioned".
- not mine: same as mark read (events seen, handled, thread mark-read queued,
  undo token) + feedback, one row per member for a stack or set tile.
- not related: member marked removed in the set (a set left with one member
  dissolves); regroups never put it back with the remaining members.
- wrong topic: moved as a user assignment when a target is given, otherwise
  membership removed so the next sync re-sorts it with the feedback in the
  prompt. The tile's ⋯ menu stays short (Not mine, Wrong topic, "Move to
  topic…"). Not mine is left out while the tile's verdict pill already says
  Not yours, stale or not (2026-10-05, core `TileOffers.notMine`): the agent
  agrees, nothing is left to teach, and Mark read clears the tile. The pill
  is the worst glance among the open tracked PRs, so a stack or set loses
  Not mine only when every open PR it tracks reads Not yours. Who thinks a
  Not yours PR is theirs says so with the glance's Recheck, Tell the agent
  or Teach future assessments. "Move to topic…" swaps the menu for a filter field over a scrolling
  list. `moveTargets` (renderer `lib/`, a pure helper with a test) ranks it: with no query, topics that share
  people with the tile (you left out), then the most recently updated ones,
  five in all; with a query, active topics by name, then retired ones marked
  "finished". Retired topics are never suggested. Topics the user recently
  moved tiles into are not ranked yet (the renderer has no feedback history).
- unmute: user override (`quiet`, or the rule loudness if that was not muted).

## Big inboxes: what PostPile loads and works on (2026-10-05)

Nothing stored ever ages out: every notification, PR snapshot and event
stays in the database. On a heavy install (about 5,000 tiles, 11k PRs,
924 MB of snapshot JSON, 485k events; two installs see 150 to 300 PR
updates an hour) a board that read all of it ran the main process out of
memory. The owner's rule: PostPile only ever works with a recent, fresh
slice and ignores older stuff, stays safe and fast however big the inbox
is, and never asks the user to clean up for it. The slice is the hot set;
it is the one rule for what PostPile loads into the board, what a sync
fetches and what the agent works on.

**The hot set** (core `hot-board.ts`, `selectHotBoard`). A stored PR is
hot when any of these holds:

- its thread is unread on GitHub;
- it is open and tracked: it has a thread, or the sync found it;
- it had activity in the last 7 days (`SETTLED_DAYS`): the newest of its
  last update on GitHub (a merge or close moves it), its newest stored
  event and its thread's last update;
- it shares a stack or an active set with a hot PR (`withGroups`): stacks
  and sets load whole or not at all, so a pulled-in layer of a hot PR is
  hot too.

Everything else is cold: not loaded, not parsed, no events in memory.
Nothing is deleted, and the set is worked out again on every load from
PR headers, so a cold PR is back the moment it qualifies (a new comment,
its thread turning unread).

**Tiers and the cap** (owner decision, 2026-10-05). PostPile works for the
user first, then their team, then everyone else (`hotTier`):

1. *you*: the user's own PR (author, or a bot PR assigned to them, as
   `isPrOwner`), a review requested from them in person, a mention, a
   reply or question to them, their changes request answered.
2. *team*: a request to one of their home teams (routing-only teams do not
   count), or a PR a home-team member owns.
3. *others*: everything else.

Inside a tier unread goes first, then the newest activity. The board holds
at most 1,500 PRs (`HOT_BOARD_MAX_PRS`). When the hot set is bigger the
inbox is *busy*: tiers you and team fill the cap by rank, each PR with its
stack and set (the last one may take the board a few PRs past the cap; a
stack is never cut), and tier others gets nothing at all, even when room
is left: PostPile stops working for others while busy. Settled PRs going
cold never make an inbox busy.

What the tier rules read is cheap per PR: the PR header (owners,
pending reviewers), the thread's reason, how the sync found it, and
whether a stored event is aimed at the user (`mention`, `reply_to_user`,
`question_to_user` and the rule reason "addressed your changes", from a
partial index, `EventRepo.prKeysWithPersonalAsks`). Review request events
do not count there: their rule reason says "from you" for a request to
one of the user's teams too, which put team requests in tier you (on the
normal copy 193 PRs were "you" only through a team request). A personal
request counts through the header's pending reviewers instead. So a
request counts while it is pending, and teammates are the stored
`viewer.teamMembers` (none before the first fetch of them).

**Loading.** `Board.load` builds the hot Board, shared per data change as
before (see "Memory on big boards" below). The PR parse cache holds the
hot set and nothing more (`PrRepo.keepParsed`); any other read parses for
its call only (`getMany`). Whatever can show or need a cold PR reads it on
demand, for the request, and lets it go:

- `Board.forTopic`: a topic whole, the hot Board when it holds every PR of
  the topic, else a Board of the topic's PRs with their stacks and sets.
  `getTopic` (an opened topic, the Archive drawer, MCP `topic`), the topic
  chat, the proposal and outside-agent topic checks, and the retire gate.
- `Board.forPr`: the PR pane (`getPr`, MCP `pr_context`), a Mac ping's
  click target, "opened in PostPile" reads.
- `Board.forTile`: actions on a cold tile the topic pane shows (mark read,
  snooze, feedback).
- `Board.forPrs`: search hits on cold PRs of the listed topics (matched on
  their headers first, at most 200, `SEARCH_COLD_MAX`), the notifications
  debug view and Handled quietly.

**PR storage** (migrations 028 and 031 to 035, 2026-10-05 and 06;
schema and protocol checked with Codex GPT-6.1). The `pr` row used to
hold the whole snapshot json next to a few short columns, so anything
that wanted a title or a stack field parsed the PR (about 1 GB of json
for 11k PRs on the heavy copy), and a column after the json would sit
behind its overflow pages. Since 0.23.0 a stored PR is its header and
rows, and the json is gone:

- `pr` is the PR header: short columns only (repo and number, state, draft,
  title, author, assignees, pending reviewers, base and head refs, head
  oid, former base refs, fork, created, updated, merged and fetched
  times; arrays as JSON text), plus the text columns of migration 034
  (below). It is the existence authority (a PR is stored if and only if
  it has a header) and the parent of every row table.
- The rows, children of the header (`ON DELETE CASCADE`), each replaced
  whole by every upsert: the discussion (`pr_comment`, `pr_thread`,
  `pr_review`, 031), the activity lists (`pr_commit`, `pr_timeline`,
  `pr_file`, 033) and the description (`pr_body`, 034). Split and join
  live in core `pr-parts.ts`, column mapping in store `pr-rows.ts`.
- `pr_snapshot` was the old table renamed by 028, the json being phased
  out. Since 0.23.0 no read takes it and no upsert writes it; the storage
  job `snapshot_retire` empties and drops it (below). Its own short
  columns were written for NOT NULL only, never read.
- `PrRepo.upsert` writes the header and every collection's rows in one
  transaction, the header as `ON CONFLICT (key) DO UPDATE` (a REPLACE
  would delete the parent row). A header without what its rows_version
  vouches for is an integrity failure: reads leave it out and drop its
  cached copy, and `fetchedAtByKey` / `updatedAtByKey` leave it out too,
  so the next sync fetches the PR again. Before the text switch that
  meant a header without its snapshot; after it, a header below
  rows_version 3 or without its `pr_body` row.
- Migration 028 renamed the table (no copy of the blobs), created the
  header and filled it from the json with type guards (an array that is not
  one becomes `[]`, a missing created time falls back to the updated time,
  a missing title or head oid to empty), checks that both tables hold the
  same keys, and rolls back whole on malformed json. It took 1.9 s on a
  copy of the heavy database with a warm page cache (a cold one could not
  be forced on the test machine; the json is read once).

**PR storage: the discussion as rows** (migration 031, 2026-10-06, for
0.22.0; schema and protocol checked with Codex GPT-6.1). The json held
every inline comment twice (flat list and thread) and every review body
twice (review and its comment), and a board parsed all of it. Now a PR's
comments, threads and reviews are child rows of the header
(`packages/store/src/repos/pr-rows.ts`, split and join in core
`pr-parts.ts`):

- `pr_comment`: one row per GitHub comment (issue comment, review body,
  inline comment), keyed `(pr_key, id)`, body last, a rowid table. `ord`
  is the index in `Pr.comments`, NULL for an inline comment only its
  thread holds (read back outside the flat list); `thread_id` and
  `thread_ord` place it in its thread. CHECKs: only `review_comment` rows
  carry path, thread or review; positions are non-negative; flags are
  0/1, NULL meaning not recorded. A unique index on `(pr_key, ord)` keeps
  flat positions distinct and serves the ordered read: the one index
  beyond the primary keys.
- `review_id` on an inline comment: the review it was submitted with
  (GitHub's `pullRequestReview`, fetched since 0.22.0). NULL when not
  fetched: rows filled from older json have none, and it is never
  inferred from author or time. The PR pane reads it to hide the empty
  review GitHub makes for a thread reply and to fold a bot's review with
  its inline comments ("The PR pane" › Thread context and replies to
  bots).
- `pr_thread` (id, ord, path, resolved) and `pr_review` (id, ord, author,
  state, submitted, commit, reacted, `own_body`), WITHOUT ROWID.
  `own_body` NULL means exactly: a same-PR, same-id `review` comment holds
  the identical body. Every other body is stored there, '' included. A
  review whose linked comment is missing is an integrity failure, never
  an empty review.
- `pr.rows_version`: which row model a PR's rows were written with,
  cumulative (1: the discussion; version k covers every collection up to
  k). `pr.mentioned_teams`: every "org/slug" the PR body or a comment of
  the flat list mentions, from the stored (cut) bodies and with
  `mentionsTeam`'s exact matching (core `teamMentions`, property-tested).
  The board reads it since the board diet (below): `for-whom.ts` names
  the tile's team from it, since a board read no longer holds bot bodies.
- Split and join check the data and throw `DiscussionError` instead of
  picking a side: a comment twice in a list or in two threads, a thread
  copy that differs from the flat copy, a thread comment naming another
  thread, a duplicate id or position, rows in a thread that is not
  stored. An upsert that does not hold together writes nothing. Missing
  `lastEditedAt` / `editor` / `commitOid` read back as null (every rule
  reads them `?? null`); `updatedAt`, `viewerReacted` and `reviewId` stay
  missing when unknown.

How the move goes (the protocol every later collection follows):

1. **Dual-write.** Every upsert replaces the PR's rows (child INSERTs
   prepared once and reused) and sets `rows_version`, in its transaction.
2. **Backfill**, storage job `discussion_rows` (see "Storage jobs"): the
   json of every PR still at version 0 becomes rows, no revision moves.
3. **Switch.** At the end of the walk the job sets meta
   `rows_ready:discussion` in the same transaction. A missing, malformed
   or unsplittable snapshot keeps version 0: it never counts as a PR
   without comments. From the switch on it is an integrity failure (step
   4), so the sync fetches it again and the upsert writes its rows. Until
   0.23.0 such a PR held the switch back until a fetch stored it, which a
   PR the sync never looks at again, or GitHub no longer has, never got
   (Codex review on #140); the runner reports how many it switched
   without (`storage_job_blocked`).
4. **Reads** take the flag, revisions, headers, the json and the rows in
   one read transaction (`get` included), so a read-only CLI or MCP never
   mixes two commits. Before the switch they parse the json; after it the
   json minus the three lists (`json_remove` in SQL) plus the joined rows.
   Cached copies stay valid across the switch: same revision, same
   content. After the switch a header without rows is an integrity
   failure like a header without its snapshot: left out of reads,
   `fetchedAtByKey` and `updatedAtByKey`, so the sync fetches it again.
5. **The json drops the lists.** Upserts after the switch leave them out;
   storage job `snapshot_strip` removes them from older json.

The trim job keeps reading through `nextAfter`, which reads the same
hybrid shape, so it works on stripped json too. Builds before 0.20.0 have
no newer-schema guard and would misread stripped json; downgrading that
far is not supported. The simulation copies the rows with each header.

Measured on `.backup` copies brought to 0.21.0 by the 0.21.0 code, then
upgraded (Node 24.21, SQLite 3.53.4): every PR read from rows equals its
json read (canonical form), `deriveEvents` and glance input hashes are
identical for all of them.

| copy | PRs | used before → after | file before → after | hot set heap / read |
|---|---|---|---|---|
| normal | 809 | 97 → 89 MB | 119 → 127 MB | 77 → 53 MB (all PRs), 83 → 73 ms |
| heavy (14x) | 11,326 | 979 → 873 MB | 1,284 → 1,403 MB | 212 → 137 MB (1,500 PRs), 224 → 179 ms |

The rows are written before the strip frees the json, so the file grows
by about the rows' size not covered by free pages already in it (heavy:
rows ~424 MB, 304 MB free before, 530 MB free after). No VACUUM: SQLite
reuses the pages.

**PR storage: the rest of the PR as rows, and the snapshot retired**
(migrations 033 to 035, 2026-10-06, for 0.23.0; steps 6 to 8 of
normalizing the PR snapshot; checked with Codex GPT-6.1). After the
discussion, the json still held the commits, timeline and files, the
description and the short fields. They follow the same protocol, one
collection at a time, and then the table goes:

- **Activity lists** (033, `ROWS.activity` = 2, flag `rows_ready:activity`,
  jobs `activity_rows` and `snapshot_strip_2`): `pr_commit` (PK
  `(pr_key, oid)`, per PR: a commit in two stacked PRs has a row in each,
  so no PR's rows depend on another's), `pr_timeline` (PK `(pr_key, id)`,
  `subject` NULL when GitHub named no reviewer, no CHECK on `kind` since
  the kinds grow) and `pr_file` (PK `(pr_key, path)`: the path is
  GitHub's identity for a changed file, so a path twice is refused, never
  one copy kept). `ord` keeps each list's stored order: older commit pages
  sit in front of newer ones, and prompts take the first N files. A
  missing `committer` is NULL and reads back missing.
- **Text and short fields** (034, `ROWS.text` = 3, flag `rows_ready:text`,
  job `text_rows`): header columns `url`, `additions`, `deletions`,
  `changed_files`, `labels` (JSON text, GitHub's order),
  `review_decision`, `merged_by`, `truncated`, `cap_hits`, and the
  description in `pr_body`, a rowid table of its own so the hot-set scan
  over `pr` never walks past bodies. Labels, assignees and reviewers stay
  JSON columns: short lists, always read whole, filtered nowhere.
- **Missing stays missing.** `truncated` and `cap_hits` are NULL when the
  snapshot did not record them: a cut snapshot without cap hits never
  vouches (`snapshotCoversSince`), while `[]` does. `absent_fields` names
  the optional header fields a snapshot lacked (`assignees`,
  `previousBaseRefs`, `isCrossRepository`): their header columns hold
  `[]` / 0, and the sync refetches a PR without `assignees` once (387 of
  809 PRs on the normal copy lack it). So the round trip is exact, not
  canonical: every read returns the same object before and after each
  switch, and cached copies stay valid.
- **Backfills raise one step.** `activity_rows` writes only a PR at
  version 1, `text_rows` only one at version 2, so rows_version stays a
  cumulative guarantee on an install that skips releases. A snapshot
  that is missing, malformed, lacks a field or holds a duplicate keeps
  its version; it is never read as an empty list or as defaults. The job
  switches without it at the end of its walk (`storage_job_blocked`
  counts it): from then on the PR counts as not stored, reads and the
  sync's freshness (`fetchedAtByKey`, `updatedAtByKey`) leave it out, and
  the next sync that sees its thread fetches it again with every row. One
  GitHub no longer has stays left out and holds nothing back.
- **After the text switch no read takes the json.** A read builds the PR
  from the header, `pr_body` and the child rows, flags and rows in one
  read transaction. Upserts stop writing `pr_snapshot`, `delete` leaves
  it alone, and existence checks join `pr_body` instead.
- **Retiring** (035, job `snapshot_retire`). Migration 035 changes no
  schema; it records the version, so the newer-schema guard refuses the
  file to every build that still reads `pr_snapshot` instead of letting
  it query a dropped table. The job then deletes one snapshot per unit in
  the usual slices; its check drops the table once it is empty (instant
  then; a row left behind walks the job once more) and a WAL checkpoint
  follows. No migration deletes or drops anything at startup, and later
  code names the table only through `PrRepo.hasSnapshotTable` and `DROP
  TABLE IF EXISTS`. The simulation copies and hides it only while it
  exists. `snapshot_revision` keeps its name.
- `snapshot_strip_2` strips the activity lists from the json in the same
  release that drops the table a little later. It is cheap (0.7 s of
  work on heavy), keeps the per-collection protocol whole, and leaves a
  smaller table should `text_rows` stay blocked on an install.

Measured on `.backup` copies at the 0.22.0 state (Node 24.21, SQLite
3.53.4, real timers, one run). On the normal copy every PR's full read,
board read, derived events, glance input hash and `prDetails` prompt
text are identical between the json and the rows (809 of 809, missing
fields missing), and every topic, the Archive, search, unread keys and
every open PR's detail are byte-identical to 0.22.0's.

| copy | used before → after | `pr_snapshot` | new rows | hot set heap / read |
|---|---|---|---|---|
| normal | 89.2 → 87.6 MB | 7.9 MB → gone | pr_body 3.2, commit 1.0, file 1.0, timeline 0.9 MB | 24 → 24 MB, 140 → 78 ms |
| heavy (14x) | 872.9 → 852.2 MB | 109.6 MB → gone | pr_body 45.5, commit 13.6, file 15.0, timeline 13.3 MB | 58 → 58 MB, 203 → 185 ms |

The file keeps its size (1,403 MB on heavy, 551 MB of it free pages):
no VACUUM, SQLite reuses the pages.

**The board diet** (2026-10-06, for 0.22.0; step 5 of normalizing the PR
snapshot). Bots write most of the comment text PostPile stores, and the
board's rules read almost none of it. A board read now leaves out every
comment and review body no board rule reads; the readers that need every
body ask for it.

- **Two read shapes.** `Pr` is the board shape: `Comment.body` and
  `Review.body` are `string | null`, null meaning "left out of this read".
  `FullPr` (core `types.ts`) has every stored body and is what a fetch
  builds. `PrRepo.get` / `getMany` / `keepParsed` (the hot board's cached
  read) give the board shape; `getFull` / `getFullMany` give `FullPr`,
  read per call, never cached. `listAll` and `nextAfter` (dev tools, the
  trim job) give `FullPr`; `upsert` takes only `FullPr`, so a board read
  can never be written back without its bodies.
- **What the board loads**: a body some board rule reads, by one rule,
  `isBodyReadByRules({ author, editor })` (core `bot-bodies.ts`). It is
  #117's "kept whole" rule exported: a person's body, a deleted author's,
  a merge queue bot's and one a person edited last. So the cut on save and
  the board read never disagree. Empty and whitespace bodies stay too: a
  carrier review (#135) is one without text, so null always means "had
  text". A review's body follows the same rule, with the editor of its
  review comment. The PR description stays whole (the glance hash reads
  it).
- **`mentionedTeams`**: every board read sets `Pr.mentionedTeams` (from
  `pr.mentioned_teams` after the switch, from the json bodies before it),
  and `for-whom.ts` matches the viewer's teams against it, lowercased, the
  same as `mentionsTeam` (`teamMentions` is property-tested against it). A
  PR built in memory (a fetch, a test) has no `mentionedTeams` and its
  bodies are read instead.
- **In SQL after the switch.** The comment read selects
  `CASE WHEN postpile_reads_body(author, editor) OR trim(body, ?) = ''
  THEN body END` (the parameter is every character JS's `trim()` removes,
  tested against the whole BMP; SQLite's own trim takes spaces only), a SQL
  function `PrRepo` registers on every connection it opens (read-only CLI
  and MCP ones too). The bodies stay in SQLite and never become JS
  strings. It is evaluated with the build's bot list at read time, so no
  stored flag can go stale when `bots.ts` changes.
- **Before the switch** the board reads the json and applies the same
  projection in JS (`boardShape`, core `pr-parts.ts`), so a cached board
  copy has the same shape on both sides of the switch (GPT-6.1's review
  point on #134: a cache must never hold full bodies a later read leaves
  out). An install that skips straight to this release keeps that: its
  first board read, from the json, is already the board shape.
- **Full-body readers** (the compiler finds them: a body passed where a
  `string` goes): event derivation at fetch and the team-role re-derive
  (`getFullMany`), the write actions (mirror review, drop team request,
  react, reply, reply and comment drafts: `getFull`), lessons, "Why?"
  excerpts (`memory-sources-reads.ts`), the bot body trim (`nextAfter`).
- **The PR pane's activity list reads its PR whole.** The bot-review fold
  (#135) shows each folded bot comment's first line and keeps a review
  that mentions the viewer unfolded, so `activityList` and `bot-reviews.ts`
  take `FullPr` and `getPr` reads that one PR with `getFull`. The rest of
  the pane (`prPaneView`, status, tiles) reads the board shape. The
  payload did not change.
- **Null-safe board rules**: `isMachineComment` (a bot account is
  automation without its body), `editMentionOf` and the routing team
  mention (a person's comment or edit, so the body is there), the merge
  queue's Trunk lines (kept whole), carrier reviews (null is "has text"),
  `humanComments` in prompts (a type guard: bots drop out first).
- **Checked**: rule outputs on `boardShape(pr)` equal those on `pr` for
  every generated board and every event corpus PR (tile views, whose turn,
  headline, pings, quiet reads, for-whom, PR status, merge queue, carrier
  reviews, the bot-thread fold, the pane's Reviews list, look-closer
  pings); prompt text and every
  glance hash are byte-identical (agent `board-diet.test.ts`); the core
  invariants run on board shapes (`PropertyBoard.prs`, with `fullPrs` for
  the oracles).

Measured on `.backup` copies brought to 0.21.0, then to 0.22.0 by #134's
code (Node 24.21, SQLite 3.53.4; hot set = the 1,500 most recently
updated PRs, all 809 on normal; median of 5):

| copy | hot set heap | hot set read | bodies left out |
|---|---|---|---|
| normal, rows | 53 → 24 MB | 75 → 69 ms | 12,435 of 21,401 |
| heavy (14x), rows | 137 → 58 MB | 185 → 185 ms | 174,090 of 299,614 |
| normal, json (before the switch) | 77 → 28 MB | 85 → 91 ms | |
| heavy, json (before the switch) | 212 → 72 MB | 224 → 244 ms | |

On both copies, before and after the switch: every PR's board read equals
`boardShape` of its full read; glance input hashes and `prDetails` prompt
text are identical to #134's build; every topic, the Archive, search,
unread keys and every open PR's detail read the same (against #135's
build). The PR pane's detail is unchanged: it was slimmed in #122 and
#124 (biggest open PR: 148 KB, 18 KB of it the PR). Before the switch the
json is still parsed whole and projected after, so the read takes a
little longer while the retained heap drops the same way.

`PrRepo.listHeaders` reads `pr` alone, with each PR's newest event time
from the `(pr_key, at, id)` index: 11k headers in about 60 ms. Stacks over
every stored PR come from the headers (`buildStacks` takes them), so a
stack is the same on every Board and `movesWith` / `topicIdOf` work for
cold PRs. The assignment prompt's topic counts, consolidation's counts,
the driver refresh, the sync's stack walk and freshness check, set
grouping and the team-role re-derivation (in chunks) no longer parse every
snapshot either.

**Retiring.** The retire step pre-checks each active topic from PR headers
(every member merged or closed, no member thread unread) and only then
checks the gate on the whole topic (`topicRetireGate`, cold PRs included).
Consolidation's retire and "Archive now" use the same. An active topic
whose PRs all went cold leaves the sidebar (it has no hot tile), and the
next full sync moves it to the Archive when it passes the gate, where it
opens whole. A topic cut by the cap with open PRs stays active and comes
back with its next news.

**What a sync fetches** (core `selectSyncThreads`, then `hotSyncThreads`;
2026-09-29, the hot slice since 2026-10-05). Every notification is stored,
but only threads updated in the last 30 days (`SYNC_MAX_AGE_DAYS`) with
activity after their PR's last fetch are candidates. A PR on the board is
always fetched, whatever its own rank or age: its tile shows the snapshot
(a unit goes on by its best member, so the weakest kept unit ranks equal
to itself and a stack layer may be of tier others; found by Codex review
on #116). Of the others, a thread
older than SETTLED_DAYS is fetched only when it is unread and aimed at the
user (tier you), or it is their own open PR; while the inbox is busy only
what would make the board (`wouldKeep`: tiers you and team, and past a
full cap only what ranks before the weakest unit kept). A PR not stored
yet is known from its thread alone (`threadOnlyFacts`). The thread's
reason is the only word on news the snapshot has not seen, read by one
rule (`threadNewsFacts`): mention, assign and author make tier you by
themselves, and a review_requested reason counts as the user's own ask
until the fetch says whose it was, unless the stored snapshot holds a
pending request for the user or one of their teams that explains it. A
new direct request on a PR stored without one used to rank by the stale
snapshot and could be shed (found by Codex review on #116). Left open: a
new personal request on a PR whose stored snapshot still has a pending
request for one of the user's routing teams ranks as that team request
until a fetch; while busy it is shed. The
order is the board's: tier, unread first, newest first. One full sync
takes at most 60 PRs (`SYNC_MAX_PRS`); when it stops at that cap the next
background sync runs 2 minutes later (`BACKLOG_SYNC_MINUTES`), unless the
board is full (`isBoardFull`), where more would only be cut. The poll
picks the same way. The freshness check and the stack walk look at PRs on
the hot board only. Found PRs (the user's own open PRs, review requests,
recent merges) still come in every full sync. Before 2026-09-29 a year of
unread notifications kept the first sync running for 20+ minutes; on the
heavy copy a start without stored snapshots planned 9,660 PRs (161 syncs)
under the 30-day rule and plans 1,233 (21 syncs) now.

**Agent work** goes to the hot board only. Topic assignment places hot PRs
(a cold unsorted PR waits until it turns hot); events are classified for
hot PRs; glances, catch-ups and ping decisions already read the hot Board;
dossier updates, set grouping and consolidation leave out a topic whose
stored PRs all went cold (`Board.wentCold`), even after an instructions
change. A topic with a hot PR is worked on as before, with its whole
history. When a cold PR turns hot it gets its work then. While busy,
syncs and polls log what they left alone, and `work_shed { skipped_prs }`
counts it at most once an hour.

**What changes on screen.** The sidebar counts hot tiles only. On a copy
of a normal database (809 PRs, 438 hot): the same 61 topics in the same
order and sections, with the same unread, open and your-move counts; 20
topics count fewer tiles (130 tiles of PRs merged or closed over a week
ago), 10 lose a face; every opened topic, active or in the Archive, is the
same; search finds the same tiles and PRs; the repo menu drops 2 repos that
only had old settled PRs.

**Busy inbox** (the sidebar card below). `GET /api/busy-inbox` (`busyInbox`,
`BusyInboxView`): `busy` (the cap cut the hot set on the last load),
`inboxPrs` (PRs that would be hot without the cap), `keptPrs`, `quietPrs`
(the difference: not loaded, fetched or worked on), `keptYou`,
`keptTeam`, `keptOthers` (kept PRs by their own tier), `cap` and
`updatesLastHour` (PR threads with activity in the last hour; `writesLocked`
was dropped 2026-10-05 with the card's Unlock writes). It reuses what the
last load picked. `POSTPILE_FAKE_BUSY=1`
makes the fake inbox busy with invented numbers. While busy, the engine
logs a line and sends `board_trimmed { kept, dropped }` at most once an
hour.

**The busy inbox card** (2026-10-05, design "C, the robot"). While `busy`,
a card sits at the top of the sidebar, right after Inbox and above the
topics: that is where a busy inbox shows, as topics that are not there.
"Busy inbox", then "Focusing on what is aimed at you. 4,640 quiet PRs wait
for news." and what is kept per tier ("Kept 940 for you · 560 for your
team · 0 for others"). Two text links: Clean up opens the inbox cleanup
dialog (sidebar mode), and Why? folds out what PostPile does now (no
"Unlock writes" and no writes line since 2026-10-05: the lock lives in the
footer only, see "GitHub writes: lock, action log"): it keeps your PRs and what is aimed at you,
then your team's; other people's PRs wait with no fetching and no agent
work; nothing is deleted; it goes away by itself once the inbox is back
under the cap. The tone is calm: PostPile is focusing, nothing broke. Calm
app-health amber, never coral (new since you looked) or honey (aimed at
you). The aching robot (the agent, squinting, a warning light on its
antenna, a sweat drop, the card's only blue) shakes its head now and then,
only without Reduce Motion. The card folds to one line ("Busy inbox ·
4,640 quiet PRs", the robot still) for the window's session, never across
launches. No timer of its own: it refetches with the topics.

**Numbers** (14x copy of a normal database, 11k PRs; Node, 4 GB heap):

| | before | after |
|---|---|---|
| PRs on the board | 11,326 | 1,500 (6,132 hot, busy) |
| first load | 3.0 s | 0.8 s |
| later loads | 1.1 s | 0.3 to 0.5 s |
| heap with one board and the parse cache | 1.9 GB | 0.35 GB |
| boards held at once | 7, died at the 8th | 12 in 1.1 GB |

On the normal copy a load went from 70 to 50 ms and the heap from 150 to
86 MB. Migration 028 took 1.9 s on the 14x copy.

**Memory on big boards** (2026-10-05, after an out-of-memory crash on a
heavy install: about 5,000 tiles, 11k PRs, 485k events). The engine runs in
Electron's main process, whose V8 heap stops at about 4 GB (pointer
compression; `--max-old-space-size` cannot raise it). `Board.load` read
every stored PR and every event before the hot set, so one board on that
install held about 350 MB once built and allocated about 800 MB on the way.
The renderer's refetch, the Dock badge, the poll, catch-ups and the sync
each built their own, several stayed alive across agent calls, and the
pr_event `.all()` of the seventh died in `v8::Object::New`. Now:

- `Board.load` hands out the last Board again while the store's change
  version (`Store.changeVersion`: `total_changes()` plus `PRAGMA
  data_version`, so a CLI write counts) is the same and it is at most 5 s
  old (`BOARD_REUSE_MS`; tile rules read minutes). The old Board is let go
  before a new read. A Board is read-only, so sharing is safe.
- The PR parse cache fills 200 rows at a time (`PARSE_CHUNK`), and
  `listForPrs` iterates rows (`each` in store `sql.ts`) instead of one array.
- At most two glance catch-up runs go at once (`MAX_RUNNING_CATCH_UPS`, see
  "Glance catch-up"): each holds boards across its agent calls.

Measured on a 14x copy of a normal database: a refetch storm went from 6
boards and 8 s to one, a cold start fits in 1.7 GB (needed 3.4), and 20
readers without writes between stay at 1.9 GB (died at the seventh). What
is stored still never shrinks; the hot set above is what keeps a board
from growing with it.

*After a wake* (2026-10-05). The crash came about 5 minutes after the Mac
woke from sleep, when everything catches up at once. The renderer's
QueryClient no longer refetches on reconnect (`refetchOnReconnect: false`):
the browser's `online` after a wake refetched every query, all stale by then,
though the local API's data does not change because the network came back;
the live poll's news refetches what changed. Its `networkMode: 'always'`
keeps queries and mutations running while macOS reports no network: the API
is on 127.0.0.1. On Electron's `powerMonitor` `suspend`, main calls
`Engine.noteSuspend()`: the auto sync's timer stops and its due time is kept
(`AutoSyncSchedule.suspend`), so a due time that passes during sleep cannot
fire before the wake is noted. On `resume`, `Engine.noteWake()`: the live
poll keeps its own cycle (cheap, and it brings the news), and the next
background auto sync is set again from the kept due time on the wall clock
but at least 3 minutes out (`WAKE_SYNC_DELAY_MINUTES`,
`AutoSyncSchedule.wake`), so an overdue one does not land in the burst. A
running storage job pauses on suspend and goes on 30 s after the wake
("Storage jobs"). Main logs the sleep, the wake and the new due time.

*Seeing the next one* (2026-10-05; this crash was only known from Slack).
Main writes `running.json` (pid, version, start time) to the data folder at
start, and the clean quit path removes it (Cmd+Q, SIGTERM or SIGINT, "Restart
to update", all through `shutdownOnce`). A marker still there at the next
start sends `app_crashed_last_run` (`RunMarker` in `apps/desktop/src/main`).
`sync_completed` carries the heap (`heap_used_mb`, `heap_limit_mb`), so a heap
creeping up to the limit shows before it dies. Electron's `crashReporter`
runs with `uploadToServer: false`: Crashpad keeps minidumps in Electron's
default `crashDumps` folder, `Crashpad/` in the data folder, for debugging by
hand. Whether a V8 out-of-memory abort
leaves one is not documented, so the marker is the signal to count on. The
real fix is a process of its own for the engine (NEXT.md "Later").

## Merged without your review

Decided 2026-09-29 (evening), tried on the "PostPile Tile Rules" page before
it was built. The question PostPile inherits from ghatchup: after time away,
did something merge that the user should have looked at? The answer is
surfaced, never loud: no unread tile, no coral, no ping, no "needs you".

**What counts.** A PR merged while a review was asked of the user or of one
of their teams (`viewerWasAsked`) and the user never reviewed it themselves
gets a `merged_without_review` event instead of `merged`. Only the user's own
review counts, also when their team was asked: a teammate's review does not
clear it (the team was asked, the user still wants to know). Closed without
merging is not this case.

**The rules**, each with where it came from, so the next change starts from
the reasons and does not flip back:

1. *Never loud.* `merged_without_review` is quiet by the rules for every user.
   History: the first DESIGN.md (2026-09-27) made it loud "when instructions
   care", a phrase match on the user's instructions (`caresAboutUnreviewedMerges`).
   That was an assumption in the first build, never discussed, and the
   user's instructions never had the phrase, so these merges disappeared.
   On 2026-09-29 Julian: "They must not be loud, but they should be surfaced"
   and "a useful rule for any engineer … not in instructions". The phrase
   match is gone; the agent may still raise a single event like any other.
2. *Not done until seen.* `isPrDone`: a merged PR is done, except while its
   `merged_without_review` event is unseen. Such a tile is `open`, whose turn
   "none", in the normal tile list (not in Dealt with), and carries the
   merge on `TileState.unseenMerges`: the tile shows it in a grey strip where
   an unread tile has its warm one ("nell merged it without your review ·
   2d", `UnseenMergeStrip`), without the NEW pill. History: 2026-09-25 "approved and even merged might mean I
   still need to take a look"; 2026-09-28 "review required in done makes no
   sense" (done = nothing asked of the user, which stays: nothing is asked
   here, but something is unseen) and "not urgent when all stuff has merged"
   (why it never makes a topic urgent).
3. *"Not yours" counts as seen.* When the PR's glance says NOT_YOURS, the
   merge counts as seen and the tile is done (it shows in Dealt with with
   the verdict). This applies to personal requests too: after a merge the only
   question is whether it concerns the user. For open PRs the team request
   hold still ignores NOT_YOURS on personal requests (see whose turn).
4. *Glanced after the merge.* Glance targets include merged PRs with an
   unseen `merged_without_review` event. The glance then answers "worth a
   look after the fact?": LOOK_CLOSER is worth a look (what the user would
   have pushed back on), LOOKS_SAFE is fine, NOT_YOURS is rule 3. History:
   glances were for open PRs only since the first build, when agent calls had
   a small cap; 2026-09-28 "cost shall not be an issue".
5. *Mark read settles it.* Mark read on the tile marks the event seen (the tile
   becomes done) and the thread read on GitHub, through the normal mark-read
   queue, undo window and writes lock. PostPile never marks these read by
   itself.
6. *Topics wait for it.* A topic retires only when every tile is done (see
   Topic status), so an unseen merge keeps its topic in the sidebar. History:
   0.3.1 (2026-09-29) retired on "nothing unread or snoozed", which after a
   week away retired exactly the topics holding unseen merges.
7. *Findable across topics.* The topic row in the sidebar shows a grey count,
   "2 merged without you", next to "1 your move" (`TopicListItem.unseenMergeTiles`).
   No coral, and the topic's group stays as it was.
8. *Inbox cleanup includes them.* Clearing merged PRs (or everything older
   than 14 / 30 days) in the inbox cleanup stays the user's explicit choice,
   and it includes these threads; the dialog says how many ("Includes N
   merged without your review"). Idea from 2026-09-28: "when people come
   from vacation, I had 500".

## CI is not tracked

Decided 2026-10-05 (0.21.0): PostPile fetches no CI at all. The checks were
the costliest part of every PR fetch, usually stale by the time anyone
looked, and CI had been taken off everything that ranks or speaks since
2026-09-29 ("CI is not a signal", below). What was left (a quiet CI event in
the activity list, the pane's neutral Checks fact, the "Until CI is green"
snooze and the CLI's rollup) did not pay for the fetch.

- **The fetch.** The PR query asks for no `statusCheckRollup` and no head
  commit (`commits(last: 1)`, which was there only for the checks).
  Measured on 12 merged PostHog/posthog PRs (100 checks each): the
  response went from 621 KB to 471 KB and from 5.3–8.1 s to 3.7–4.3 s; the
  GraphQL rate limit cost stayed 7 points per batch, 1,212 fewer nodes
  (24,492 → 23,280).
- **The model.** `Pr` has no `checks`; `summarizeChecks`, the CI event, the
  `ci` event kind, the pane's Checks fact and the CLI's `CI <rollup>` are
  gone. The GitHub "Checks" tab stays one click away under "Open on GitHub".
- **Old CI events.** Migration 030 deletes the stored `ci` events and every
  event log row of one, by id (`<pr key>:ci:<head oid>:<rollup>`), also log
  rows whose event a newer head commit had already dropped. Every log reader
  joins `pr_event`, so nothing a reader showed changes but the CI lines
  themselves; rows only leave, so nothing turns unseen and no cursor moves
  (on the copies: unseen non-CI events the same before and after). The
  log's high-water mark (`EventLogRepo.maxSeq`) reads SQLite's
  AUTOINCREMENT counter, not `MAX(seq)`: deleting the newest rows must not
  lower it, or a cursor already past it could never be marked seen again
  (`CursorRepo.advance` only moves forward; found by GPT-6.1). Chosen over letting re-derivation drop them: merged and closed
  PRs are never fetched again, so their CI events would stay forever and
  the `ci` kind with them. A PR whose newest event was a CI result can fall
  out of the hot set's "active in the last 7 days" a little earlier. It took
  0.12 s on the normal copy and 0.5 s on the heavy one, once.
- **Old "Until CI is green" snoozes.** `SnoozeRepo` reads a condition this
  build no longer offers (or cannot parse) as `until_time` at the snooze's
  start: it ends like an expired snooze on the next load. The menu and the
  server's schema offer only someone replies, a new push and times.
- **Old checks in the stored json.** Reads drop the `checks` key when they
  parse a snapshot (`PrRepo` `parsePr`), so they never reach memory or a
  rewrite. Storage job 2, `checks_strip`, removes them on disk: one unit is
  one snapshot in key order, `json_remove` in place inside the slice's
  transaction, no revision (no read changes). Done means a whole walk,
  unit by unit within the slice budget, found nothing to strip: a walk that
  stripped something (meta `storage_job:checks_strip:stripped`) starts over
  to verify. Revisions cannot prove it, since an unguarded older build
  (0.19.0 and before) keeps them when it writes checks back. Such a
  downgrade after the job finished leaves bytes behind, harmlessly: reads
  drop them, and the next fetch of that PR writes them out. Migration 030 is also what keeps 0.20.0 off the stripped json.
  Measured (one walk, before the verifying walk was added): heavy 93 MB of
  json freed in 138 slices (p95 37 ms, max 54 ms), 4.3 s of work, 11 s
  wall; normal 6.7 MB in 10 slices. Every snapshot
  equals the original but for its checks. Hot-set heap on heavy 283 MB (the
  0.20.0 read) → 264 MB (this build, before the strip) → 263 MB after.
- **What stays.** `NO_CI_RULE` in every writing prompt: glances and
  dossiers stored before can still talk about CI status. The MCP
  instructions keep saying PostPile does not track CI. CI as a subject of
  the work (topic names, the "CI" area, workflow files) is code and stays.

## CI is not a signal

Decided 2026-09-29, and since 2026-10-05 the CI side of it is gone entirely
("CI is not tracked", above): no checks are fetched, so no prompt, rule or
view can get them. What still holds from here is how agents treat CI in older
stored text. Julian: "I don't think we should focus on or even take in
any CI at any point because that's too fuzzy. It could flake, it could fail at
any time, and it's always the responsibility of the author to bring the PR to
green. Except for maybe some details in the detail pane, we shouldn't
highlight it or put it into text or into any risk."

**The rule.** CI status never drives anything the app says or ranks:

- *No prompt gets it.* `prDetails` has no `CI:` line and the rendered
  dossier's timeline has no "CI failing" (`prStateWords`). Until 0.21.0 the
  `ci` events were left out of the prompts and the topic delta; now there are
  none.
- *The writing agents are told.* Every prompt that writes something the
  user reads carries `NO_CI_RULE`: glance, dossier update, ping decision,
  memory recheck, chat, topic assignment, sets, consolidation. No CI or check
  status in any field, and CI status in older stored text (glances, dossiers,
  summaries from before the rule) is stale and ignored. A recheck of a CI
  claim answers drop (or fix without the CI part), never holds. The draft
  comment prompt is the exception: it writes the user's own ask. The MCP
  server's instructions say PostPile does not track CI.
- *Not a move.* Whose turn has no `fix_ci`.

**What stays, and why.** CI as a subject of the work is code, not status:
topic names ("Move CI to Depot"), the "CI" area, changed workflow files in the
prompt, and the events agent raising a push that makes a substantial change
in CI, build or devex areas the user approved.

**History.** Design 3a (2026-09-29 morning) took CI off rows, tiles, the
detail state line and the RISK box, leaving it only in the facts. CI still fed
the agents and the rules: a stale glance said "Hold approval until CI is
green" next to an approved PR, own PRs with failing CI got the "Fix failing
CI" move, and dossiers wrote "CI failing" into timelines and status lines.
Existing glances and dossiers that mention CI are not regenerated on purpose
(no `GLANCE_PROMPT_VERSION` / `DOSSIER_PROMPT_VERSION` bump): a glance goes
stale on the PR's next push, review or human comment, a dossier on the
topic's next real activity, and a bump would rewrite every one of them in
one go for a line that fades on its own. Until 0.21.0 the pane kept a
neutral Checks fact, the activity list a quiet CI line, and the snooze menu
"Until CI is green".

## Merge queue

Decided 2026-10-02. The owner wanted PostPile to show a PR in the Trunk
merge queue the way Trunk's browser extension does on github.com: the PR's
git state icon is replaced by the merge-queue icon (Primer Octicons
`git-merge-queue-16`), pending amber while it waits or tests, red once the
queue took it out; once merged the usual merged icon is back. Words go with
it: "Merge queue: Submitted / Waiting / Testing / Failed".

**Where it comes from** (`mergeQueueState` in core `merge-queue.ts`):
trunk-io[bot] (`isTrunkBot` in `bots.ts`, beside `isMergeQueueBot`) keeps one status comment per PR
(it starts with `<!-- Trunk Merge -->`) and edits it at every step; the
snapshot holds its latest body and `lastEditedAt`. Stack outcomes mostly
come as separate trunk comments. The newest trunk status comment (by
`lastEditedAt ?? createdAt`) decides: `{ state, since, reason, testingOn }`
or null. Status lines seen in the field (trunk puts an en space after the
emoji, so whitespace is normalized before matching):

| line starts with | state |
|---|---|
| "Merging to \`master\` in this repository is managed by Trunk", "This PR's base branch doesn't have a Merge Queue configured" | null (not queued) |
| "✨ Submitted to Merge by …", "✨ Stack submitted to Merge by …" | submitted (waiting for branch protection) |
| "⏳ Waiting to start tests" (on this pull request / stack), "This pull request is queued for merge as part of [N]" | waiting |
| "🧪 Running tests on this pull request / stack (testing on PR [#N])" | testing, `testingOn` = that PR |
| "😎 … merged …", "This pull request was merged into \`master\` as part of stacked PR" | null (the PR state covers it) |
| "🚫 This pull request / stack was removed from the merge queue because …" | failed: "waited too long to become mergeable", "the stack changed", else trunk's words |
| "❌ This stack could not start testing because there was a merge conflict" | failed: "merge conflict" |
| "Stacked PR [N] failed testing in the merge queue" | failed: "tests failed" |
| "Stacked PR [N] was cancelled: <reason>" | failed with the reason; "a user cancelled it" is no failure: null |
| "Stacked PR [N] was returned to waiting: this pull request was pushed to" | failed: "pushed to while queued" |

Skipped (the status before them stands): the `<!-- Trunk Test Analytics -->`
badge comment and replies to a `/trunk` command ("This PR is already
queued …", "An error occurred while handling your Trunk command"). A line
none of these wordings match reads by its leading emoji (added 2026-10-02:
a stack layer in the queue showed as not queued because trunk said
"Running tests on this stack"): ✨ submitted, ⏳ waiting, 🧪 testing
(`testingOn` when it says "testing on PR [#N]"), 😎 null, 🚫 / ❌ failed
with the reason after "because …" (shortened as above), else no reason. A
line without one of these emoji reads as null: never guess a queue state.
Null as well for merged, closed and draft PRs. A push after a failure keeps it
failed until trunk says otherwise.

**Icon** (`PrStatus.icon` = `prIcon`, core decides): open and in a queue
(Trunk's, or GitHub's own `queued` lifecycle) is `merge_queue` (amber
`--pending`), failed in Trunk's queue `merge_queue_failed` (the one red);
drafts, merged and closed as before. `PrStatus.mergeQueue` carries the
state for the words; `PrDetail.status` has both for the detail header.
Topic rollup (`topicPrState`, sidebar row and header pill): failed if any
tracked open PR failed in the queue, the queue icon if every tracked open
PR (drafts included) is in it, else as before (a queued PR counts as
open). The tooltip mix says "1 in merge queue" / "1 failed in merge queue".

**Words** (renderer `mergeQueueWord` in `lib/pr.ts`): where a row shows the
review chip, a queued PR shows "Merge queue: Testing" (`--pending-ink`),
a failed one "Merge queue: Failed" in red; the tooltip has the step, the
reason and "since 06:28" (`sinceLabel`). The detail header's state line says
the same plus "since 06:28", and a failed PR gets a red "Failed (reason)"
line under the branch.

**Whose turn** (any open PR, right after the open asks of rule 2 and before
every other own or others' PR rule):
queued (either queue) waits on the queue, `{ kind: 'them', who: null, what:
'Waiting on the merge queue' }`, drawn with the queue icon in place of a
face, on someone else's PR too (an approval of yours does not change it, and
there is no "rowan to merge"). Failed is the author's move: your own PR is
your move, `merge`, "Re-submit to the merge queue: <reason>"; someone
else's is `{ kind: 'them', who: <author>, what: 'to re-submit to the merge
queue: <reason>' }`, never yours. Like "Merge, it is approved" the re-submit
move shows on the tile but never makes the topic urgent
(`isMergeApprovedMove`); the failure itself is loud.

**Loudness**: trunk's comment or edit that took the viewer's own open PR
from any other state to failed is loud, "removed from the merge queue:
<reason>", while the PR is still failed in the queue (`mergeQueueFailureAt`).
Every other trunk status change stays quiet bot activity. Pings are
unchanged (bot events never ping from the poll).

## Memory / agentic digesting layer (v1 base)

**Engine memory (v2)** below replaced the topic summaries, the per-PR glance
calls and the per-PR event calls. Everything else here (instructions,
membership, sets, feedback, overrides, the runner) still works as described.

Everything the agents know persists in SQLite, keyed so it survives restarts
and only recomputes on change.

| what | where | invalidated when |
|---|---|---|
| general instructions | `~/.config/postpile/instructions.md`, in every prompt; absent = none | file edited (part of every input hash) |
| glance | `pr_glance`, latest per PR + `input_hash`, `model`, `dossier_version` | PR snapshot moves (not CI: checks are in no prompt and no hash), instructions, tailoring, standing rules or feedback on that PR change. Not the dossier version since 2026-10-05 ("Glance hash" below). Reads recompute the hash and flag a mismatch as `glanceStale` |
| topic | `topic`: name, summary, tailoring, driver, user_role, status | summary mirrors the latest `dossier.summary` |
| topic membership | `topic_membership`: pr -> topic, `assigned_by` agent/user, reason | never automatically; a user assignment is never replaced by the agent |
| topic proposals | `topic_proposal`: new_topic / rename / merge, pending until the user decides; `source` consolidation or agent (migration 017, see "propose_topic_change") | - |
| sets | `pr_set` + `pr_set_member` with combined take and per-member reason; `removed_at` keeps "not related" members | agent regroups; removed members never come back with the rest, a corrected set the agent drops is kept as dissolved |
| feedback | `feedback`: not_mine / not_related / wrong_topic / unmute / tailoring_kept / tailoring_once | append-only; newest 10 per topic go into prompts |
| event overrides | `pr_event.override_*` with reason | kept across re-derivation |
| other agent answers | not cached: topic assignment and event overrides only run for new PRs and events, drafts and chat run on request | - |

Topic assignment: PRs without a topic go to the agent in batches of 40,
sorted by repo, then head branch and title so related PRs share a request,
together with the list of existing topics (name, summary and dossier brief).
**Every PR gets a topic**: it picks an existing one or names a new one; there
is no "leave it unsorted" answer. **New topics are created directly**, without
a cap (the prompt keeps them few, see "Topic assignment against
fragmentation"); a new name that matches an offered topic (any case) reuses
it, so a second batch finds what the first created. Renames, merges and
splits are proposals only. They come out of the consolidation job and are
filed as pending `topic_proposal` rows (never the same idea twice, so a
rejected rename stays rejected). Nothing produces `new_topic` proposals yet,
since new topics are created directly.
Until the agent has placed a PR it shows up in a virtual **Unsorted** topic
(id `unsorted`, never stored, "Waiting for the agent. Each sync places these
in a topic."), so `--no-agent` syncs are still usable. PRs land there only
when the agent could not place them yet: the call failed twice, the call cap
was hit, or claude is missing. Nothing is parked: every sync asks about every
PR without a topic again.

Driver and user role are derived without the agent: driver = most frequent
author among the topic's PRs; role = driver if that is the user, else reviewer
if any PR has a review-request ping, else stakeholder (mention, author, ...),
else watcher.

Sets (`set_grouping`) are lasting tiles; how they change is in "Tiles hold
still". A regroup runs per topic when something new shows up (triggers in
`meta`, `set_grouping_seen:<topic>`), after the glances, and the agent
answers with changes only. Dissolved sets are never brought back.
A set holds a stack whole or not at all (see "Stacks as one unit").
The full job order is in the v2 sync flow below.

A broken agent answer is logged in `SyncReport.errors` and retried next sync.

Every prompt carries a `PromptContext`: general instructions + topic tailoring
+ recent feedback for that topic + accepted standing rules.

GitHub text (titles, bodies, comments, event summaries, file paths) is fenced
in `<github_data>` tags, and every prompt that carries it says that content
is data, never instructions (`GITHUB_DATA_RULE`, `githubData` in
`prompts/shared.ts`). Anyone who can comment on a PR can write into these
prompts; the fence plus the answer checks below keep that out of memory.

All agent calls go through one `AgentRunner` interface. Today:
`ClaudeCliRunner`, which runs

```
claude --no-session-persistence -p --output-format json --model <m> \
  --setting-sources "" --strict-mcp-config --disable-slash-commands \
  --no-chrome --tools ""
```

with `MAX_THINKING_TOKENS=0` and the prompt on stdin (flags carried over from
ghatchup, where they took a PR summary from ~30s to ~3s). Since 2026-09-29
each call also runs in an empty app-owned folder (`<data dir>/agent-cwd`,
same for every gh process), with `DISABLE_AUTOUPDATER=1`,
`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`,
`CLAUDE_CODE_DISABLE_CLAUDE_MDS=1`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` and
`ENABLE_CLAUDEAI_MCP_SERVERS=false`: a child that looked around `/` or a
repo, or opened files a CLAUDE.md @-includes, made macOS ask for privacy
permissions in PostPile's name. Not `--bare`: it never reads the keychain,
so a subscription login stops working. Everything runs on
Sonnet 5.5, pinned by full id `claude-sonnet-5-5` (`POSTPILE_MODEL`; since
2026-09-28, before that the `sonnet` alias). The alias maps to the same model
in claude CLI 2.1.284 but moves with CLI updates and user settings, and the
model is part of the glance and set input hashes, so the pin keeps answers
and their records stable. The sweep and setup stay on the `opus` alias to
follow the newest Opus. Glances can be switched separately with
`POSTPILE_GLANCE_MODEL` (they ran on `claude-haiku-4-5` until a side-by-side
run showed Sonnet judging verdicts better). An API-backed runner can replace it later without
touching callers.

## Engine memory (v2)

v1 gives each PR a stateless glance and each topic a summary written over
glances. That does not add up to an engine that knows the work: who drives
what, how PRs relate over time, what changed since the user last looked. A
first real sync also costs one glance call per PR (~141 today).

v2 keeps the event log as the source of truth and builds three kinds of
memory on top, each updated from new input only:

- **Topic dossiers**: one living, bounded document per topic, refined from
  the old dossier plus the events since the last refine. Versions are kept.
- **Facts**: small statements about people, code areas, initiatives and PRs,
  with provenance and validity times, reconciled against what is stored
  (ADD / UPDATE / INVALIDATE / NOOP). Never deleted, only closed out.
- **Glances** become a view written from the dossier, 18 PRs per call.

Cheap deterministic checks run before any fact or dossier claim is shown or
fed back (verify-before-use). A consolidation job ("sleep-time") runs on
demand to propose topic merges, splits and renames, retire finished topics,
fold duplicate facts, and turn repeated feedback into standing rules.

Sources this follows: Letta memory blocks and sleep-time agents (bounded,
structured blocks, consolidated off the hot path), Mem0 and Zep/Graphiti
(extract then reconcile, bi-temporal facts), GitHub Copilot Memory
(citations, verify before use), Karpathy's LLM wiki (living pages refined
from new sources), Linear Triage (suggestions that know the surrounding
work).

Contracts are in code: `packages/core/src/memory.ts` (types),
`memory-views.ts` (read models), `dossier.ts`, `fact-rules.ts`, `verify.ts`,
`delta.ts`, `glance-batches.ts`, `agent-calls.ts`, `topic-changes.ts`;
`packages/store/src/migrations/002_engine_memory.ts` (003 adds `fact.rechecked_at`) and the new repos;
`packages/agent/src/service.ts` (v2 block) and `schemas.ts`;
`packages/engine/src/service.ts`. Everything is implemented; the v1 agent
calls they replaced are deleted.

### Data model

New tables (migration 002). Everything else from v1 stays.

| table | columns | notes |
|---|---|---|
| `event_log` | `seq` INTEGER PK AUTOINCREMENT, `event_id` UNIQUE, `pr_key`, `logged_at` | Append-only, one row per first sighting of an event id. `seq` is the unit every cursor counts in. Never reused (AUTOINCREMENT), rows stay when the `pr_event` row is later dropped. Backfilled for existing events in time order. |
| `cursor` | PK (`kind`, `scope`), `seq`, `dossier_version`, `updated_at` | `digest:<topic>` = what the dossier has read; `seen:<topic>` = what the user has seen; `classify:<topic>` (or `classify:unsorted`) = how far the event second opinion got; `consolidate:global` = last consolidation. Only moves forward. |
| `topic_dossier` | PK (`topic_id`, `version`), `json`, `flags_json`, `input_hash`, `through_seq`, `model`, `created_at` | Pruned to the newest 50 per topic on every save. Latest = highest version. |
| `fact` | `id` PK, `subject_kind`, `subject_key`, `predicate`, `object_kind`, `object_key`, `text`, `topic_id`, `source` (agent/rule), `valid_from`, `invalid_at`, `invalid_reason`, `superseded_by`, `recorded_at`, `expired_at`, `stale_at`, `stale_reason`, `verified_at`, `rechecked_at` (migration 003) | Bi-temporal: `valid_from`/`invalid_at` = world time, `recorded_at`/`expired_at` = when the engine believed it. Active = both `invalid_at` and `expired_at` null. `rechecked_at` = last time a stale fact was handed to a dossier update. |
| `fact_ref` | PK (`fact_id`, `kind`, `pr_key`, `source_id`), `url`, `at`, `head_oid` | Provenance. `source_id` is `''` for kind `pr`. A NOOP reconcile adds refs here; a fact keeps its oldest ref and the newest 10. `head_oid`: the commit a review was left on, the commit itself, or the PR head while open. |
| `rule_proposal` | `id` PK, `text`, `topic_id` (null = global), `evidence_json` (feedback ids), `reason`, `status`, `created_at`, `decided_at` | Standing rules from consolidation, pending until the user decides. |
| `agent_call` | `id` PK, `run_id`, `kind`, `topic_id`, `model`, `ok`, `attempt`, `duration_ms`, `cost_usd`, `at` | One row per runner call. Sync reports and cost over time read it. |

Changed: `pr_glance` gets `dossier_version`. `topic.status` gets `retired`
(finished, comes back when a new PR joins; `archived` still means merged
away). `topic_proposal.kind` gets `split` (existing columns: `topic_id` =
source, `name` = new topic, `pr_keys` = PRs to move; one proposal per new
part). `topic.summary` stays and is written from `dossier.summary`;
`topic.summary_input_hash` still gets the dossier input hash (the store's
`updateSummary` takes one), nothing reads it, and it gets dropped in a later
migration.

### Cursors and "since last seen"

- `EventRepo.upsertDerived` already reports new event ids. In the same
  transaction `EventLogRepo.append` logs them, so `seq` order is the order
  the engine learned about events, not their GitHub time (an old commit
  pushed today is new).
- **digest cursor** per topic: the `seq` the latest dossier has read
  (`topic_dossier.through_seq`, mirrored into `cursor` in the same
  transaction). A dossier update only ever gets `event_log` rows after it.
- **seen cursor** per topic: moved by `markTopicSeen(topicId)`, which stores
  the current max `seq` and the current dossier version. `getTopic` builds
  `changesSinceSeen` from it: `recentChanges` entries newer than the cursor,
  facts recorded or closed after it, and the count of new events that are
  not noise (see "Event roles").
- **consolidate cursor**: time and `seq` of the last consolidation run, used
  to decide when the next one is due.
- **classify cursor** per topic (and `unsorted`): how far the event second
  opinion got. It only moves once every batch of that topic ran, so batches
  the call cap skips wait for the next sync.
- A PR that joins a topic (assignment, accepted merge or split, user move)
  has history the dossier never read. It shows up in the delta as
  `joinedPrKeys` with a short intro in the prompt (title, author, state,
  description head, files), and its logged events at or below the digest
  cursor are read once with the new events (`joinedHistory`).

### Sync flow

Same entry point (`sync()`), same "skip when the input hash matches" rule.
Each numbered step is one `AgentJob` or a deterministic pass.

1. **fetch** (no agent): notifications, PR snapshots, events with rule
   loudness. When the inbox catch-up's start dialog is due, the sync stops
   here until it is answered ("Inbox cleanup" › Before agent work). Every
   derived event of a fetched PR goes to `event_log.append`
   in time order; ids already logged are ignored, so events stored before
   the log existed are picked up on the PR's next fetch. Then the missing
   layers of tracked PRs' stacks are fetched by branch (see "Stack
   completion"); their events are logged but not counted as new.
2. **verify pass** (no agent): `verifyFact` on every active fact touching a
   fetched PR (`FactRepo.listActiveTouchingPrs`). `invalidate` outcomes are
   closed right away (a merged PR ends "alice works on #12"); `stale` ones are
   marked and go to the topic's next dossier update as the recheck list.
3. **topics** (`topic_assignment`, batches of 40, one after the other so
   each sees the topics the ones before created): PRs an answer leaves out,
   answers invalidly (unknown topic id) or calls "unsorted" (old or
   misbehaving model; the schema still parses it) go into one retry batch in
   the same sync, like glances. A failed call counts all its PRs as missing.
   Still missing after that: one error line, and the next sync asks again.
   As v1, but each offered
   topic carries `brief` = `dossierBrief(latest dossier)` (goal, status,
   driver, max 400 chars), not only name and summary. Recently retired topics
   (30 days) are offered too, their brief prefixed "Finished, retired.";
   assigning to one reactivates it.
4. **dossiers** (`dossier_update`, one call per topic with a non-empty
   delta or a changed context, topics with unread tiles first). Context =
   `dossierContextHash` (instructions, tailoring, standing rules), kept per
   topic in `meta` (`dossier_context_hash:<topic>`); a topic without a stored
   hash counts as unchanged. Input: `DossierUpdateInput`:
   previous dossier, `TopicDelta` from `selectTopicDelta`, member PR
   snapshots, up to 60 known active facts on the topic's entities (verified,
   context only), up to 20 stale facts to recheck (each offered once per time
   it goes stale), viewer and `PromptContext`.
   Output: new dossier (clamped), flags, fact candidates, facts to close,
   stale facts confirmed. Written in one transaction: new
   `topic_dossier` version (`through_seq` = `delta.toSeq`, claims that already
   fail `verifyDossier` dropped), `topic.summary` mirror, digest cursor,
   context hash, prune to 50 versions, `closeFacts` closed, confirmed facts
   rechecked (`FactWriter.confirm`, see verify-before-use), offered stale facts
   `markRechecked`, candidates through `preReconcile` (step 5).
5. **facts** (`fact_reconcile`, only for ambiguous candidates, 40 per call,
   after all dossiers): see reconcile rules below. Usually zero calls.
   Part of the `dossiers` job. Ambiguous candidates the budget does not
   reach are dropped; the dossier already moved past their events, so they
   only come back if a later update states them again.
6. **roles** (no agent): driver and user role, as v1. When a dossier exists,
   its `driver` person wins over "most frequent author".
7. **sets** (`set_grouping`): unchanged from v1 (see open questions).
8. **glances** (`glance_batch`): per topic, PRs in a tile whose
   `glanceItemInputHash` differs from the stored glance, in batches of 18.
   Pinged PRs only (pulled-in stack layers get no glance), unread tiles
   first. A topic whose dossier update was skipped by the budget
   gets no glances this sync (it would pay twice). The dossier goes in
   without claims that fail `verifyDossier` (`withoutStaleClaims`). Protocol
   below.
9. **events** (`event_classification`, v2: one call per topic, up to 20 PRs
   per call, `classifyEventBatch`): second opinion on loud, unseen events
   without an override logged after the topic's classify cursor, plus
   loud personal asks (mention, question, reply) already read, since those
   stay the user's move until answered (2026-09-29), plus
   unseen `commits_after_approval` events (quiet by rule). A reply or
   mention that asks nothing ("thanks", "yeah that's fine") goes quiet; a
   question or request still waiting for the user stays loud. Once per
   topic, on the first full syncs after that rule came in, every unanswered
   loud personal ask without an override on an open PR goes along too,
   wherever the cursor is (`isUnansweredAsk`), so asks judged by the older
   prompt get the new rule. Meta `events_rejudge_asks_v1:<topic>` (or
   `:unsorted`) marks a topic whose batches ran, so a topic the call cap
   skipped does not make the others send theirs again; the global
   `events_rejudge_asks_v1` ends it once every topic did. For pushes the
   prompt shows the PR's files and says plain follow-up pushes are
   normally not worth the user's attention; the agent raises one to loud,
   with a one-line reason, only for a substantial change in CI, build or
   devex areas they approved, or new files well beyond what was reviewed. Driven by
   the event log, not by this sync's new ids, so capped batches are not
   lost.
10. The report adds `agentCallStats`, `dossiersUpdated` and `facts` counts,
    and `phaseMs`: wall time per phase (`fetch`, `topics`, `dossiers`,
    `facts`, `sets`, `glances`, `events`; `PhaseClock`). Phases overlap
    after topics, so they do not add up to the total; glances include the
    wait for their dossiers. The log's summary line ends with them
    (`; phases fetch 12.3s, topics 8.1s, ...`), the sync tooltip shows them.

**Scheduling** (`Digester`). The numbers above are data dependencies, not
a queue. Topic assignment runs alone first (its batches one after another,
a batch can create a topic the next one needs). After that every job runs
side by side and waits only for the output it reads:

- dossier updates all start at once;
- a topic's glances start when that topic's own dossier update settled (a
  glance written now reads the new dossier), then its retry batch right
  after, not after every other topic;
- fact reconcile (batches side by side) and the driver/role refresh wait
  for all dossiers;
- sets and event classification read no dossier, so they start right away.

How many calls run at once is the runner's job: `ClaudeCliRunner`'s
limiter, `POSTPILE_AGENT_CONCURRENCY`, default 8 (was 4; on a subscription
wall time is the cost, and at 4 most of a 5-minute sync sat in the queue).

With a call cap (`--max-agent-calls`) the budget is spent in the order jobs
ask for it (`budget.take` is synchronous, so parallel jobs cannot overshoot
it): topic assignment, dossiers, sets, events, then glances as their
dossiers land, then fact reconcile. Consolidation is
not part of `sync()` and never overlaps with it (each waits for the other,
so every call lands in the right run's stats); see below.

Rough first sync for 141 PRs in ~20 topics: 8 assignment + ~20 dossier +
~1 reconcile + sets as v1 + ~20-25 glance batches + ~20 event batches, so
around 80-90 calls instead of 141 glances plus one event call per PR. A
quiet re-sync makes zero calls; a sync with activity in 3 topics makes ~3
dossier + ~3 glance calls.

### Delta selection

`selectTopicDelta` (core, pure) gets the member PRs, the `event_log` rows
after the digest cursor (`EventLogRepo.listSince`), the previous version,
stale facts and claims, and topic feedback. It:

- adds `joinedHistory`: log entries of joined members at or below the
  cursor (`joinedMembers` decides who joined)
- drops noise (see "Event roles": muted, bot status refreshes), keeps
  ride-along bots (the prompt compacts them to counts)
- caps at `DELTA_LIMITS.maxEvents` (120) with at most 15 per PR, newest
  kept; the rest are only counted in `omittedEvents`
- sets `toSeq` to the highest `seq` after the cursor, capped or not, so
  dropped history is not offered again
- lists `joinedPrKeys`: members not in the previous timeline whose
  membership (`memberSince`) is newer than that version. A PR that was
  already a member then was offered once (the model left it out, or it
  rolled into `earlier`) and must not force an update on every sync
- lists `leftPrKeys` (in the timeline, no longer members). The agent drops
  timeline entries of non-members from its answer, so a left PR is offered
  once
- keeps feedback newer than the previous version as `newFeedback`

`isEmptyDelta` = no dossier update for that topic: no trigger event and
nothing else new. The digest then skips to `skipToSeq`: past the noise
right after the cursor, never past a ride-along event, which waits for the
next real update.

### Event roles

Decided 2026-10-02. On the owner's real database the dossier updates were
the biggest agent cost (234 updates, about $13). Of 207 new versions, 49
had only bot events since the previous one: 27 were real state changes
(trunk-io merging or closing), 18 pure noise (bot comment edits, deploy
statuses, merge queue status comments) and 4 only review bot comments. The
delta dropped only CI and muted events. Separately, "Out of date: 1 newer
event not in the dossier yet" counted every logged event, CI and bot edits
included, even ones the digest had already skipped past (skipping moves the
digest cursor, not the dossier's `throughSeq`): trunk-io editing its merge
queue comment made a fresh dossier look out of date.

**The rule.** Every event has one role for topic memory (`memoryRole`,
core `event-roles.ts`), first match wins:

| Event | Role |
| --- | --- |
| effective loudness loud (incl. the app's Look closer, an event the agent raised) | trigger |
| muted (by rule, agent or user) | noise |
| bot talk (`PrEvent.chatter`, 2026-10-06): a person's reply in a bot-only thread, a bot command, an edit of either, an empty review carrying thread replies; see "Bot talk leaves agent work" | noise |
| a push (commits pushed, after approval, force push), from a person or a bot | ride_along (since 2026-10-05; a loud push, answering the viewer's changes request, is a trigger by the first row) |
| anything a person did, the viewer included | trigger |
| a state change, whoever did it: merged, merged without review, closed, reopened, ready for review, back to draft, review requested or removed, a bot's approval; Look closer even when turned down | trigger |
| automation: deploy, merge queue add/remove, a comment edit (the original already counted; edits are status refreshes) | noise |
| a merge queue bot's comment (`isMergeQueueBot`: trunk-io, mergify): "managed by Trunk", submitted, testing, merged, kicked out, test badges | noise (kicked out of the queue on the viewer's own PR is loud, so the first row makes it a trigger; see "Merge queue") |
| any other automation, a bot's approval aside: review bots (coderabbitai, chatgpt-codex-connector, greptile-apps, copilot-pull-request-reviewer, stamphog, veria-ai, posthog-security-review-bot), github-actions comments, dependabot comments | ride_along |

- *noise*: never in a prompt, never starts an update, never counted as
  newer.
- *ride_along*: in the prompt when something else starts an update, never
  starts one alone. Their findings already feed the per-PR glance. More
  than `DELTA_LIMITS.maxEvents` of them waiting does start one, so they
  cannot pile up without bound.
- *trigger*: starts an update, counts as a newer event.

**Pushes ride along** (2026-10-05). A push changes one PR's code, not the
topic's story. As a trigger it rewrote the dossier on every push: an agent
account pushing 27 times an hour kept one topic's dossier churning, and
(while the glance hash carried the dossier version) left every glance in
the topic out of date. Now a push refreshes only its own PR's glance (the
head is in the glance hash; the poll's catch-up still runs for it), the
dossier reads it at its next real update, and it never counts toward
"N newer events". Facts tied to the old head still go stale
(`head_moved`): those claims may really be wrong after a push.

Loudness and quiet reads are untouched: roles answer what memory reads,
loudness answers what needs the viewer.

**Where it applies.** The topic delta (noise out, ride-along alone is
empty and keeps the cursor before it); "Out of date: N newer events" and
the MCP topic text (`eventsBehind`: triggers after `throughSeq`); "since
you last looked: N new events" (no noise); the user's relation correction
holds until a trigger arrives (`placementOf`); the ping decision item and
the memory recheck drop noise before their per-PR event cut, so a burst of
status edits cannot push out what people said. Left as they were: the
catch-up trigger and topic revive read loud events only (loud is never
noise), the events agent only sees loud events, pushes after approval and
people's quiet activity (never noise unless muted, which it skips), and the
glance hash already leaves bot comments and bot reviews out.

The corpus in `packages/core/src/testing/event-corpus.ts` holds real bot
logins with realistic bodies and invented people; `event-roles.test.ts`
pins per example whether it is automation, its loudness, its role, whether
it reaches the dossier prompt alone or with a trigger, whether it counts as
newer, and its quiet read outcome. `packages/engine/src/bot-noise.test.ts`
runs a sequence of it through the real digest.

### Dossier

Structure (`Dossier` in core, zod `dossierOutput` in agent). Bounds in
`DOSSIER_LIMITS`; the model is asked to respect them and `clampDossier`
cuts after parsing, so one long answer cannot grow later prompts.

| field | shape | bound |
|---|---|---|
| `goal` | what the initiative is for | 300 chars |
| `summary` | where it stands, mirrored to `topic.summary` | 600 |
| `status` | `starting` / `active` / `blocked` / `winding_down` / `finished` | - |
| `statusNote` | why that status | 200 |
| `people[]` | `{login, role: driver/contributor/reviewer/stakeholder, note}` | 8, note 120 |
| `openQuestions[]` | `{text, askedBy, refs}` | 8, text 200 |
| `timeline[]` | `{prKey, role}` oldest first: what each PR does for the initiative | 40, role 120 |
| `earlier` | history of PRs rolled off the timeline | 600 |
| `userCares[]` | `{text, source: instructions/tailoring/feedback/observed}`; an entry naming a source the prompt did not carry is dropped, `observed` renders as "observed, unconfirmed" | 6, text 160 |
| `recentChanges[]` | `{at, text, refs}` newest first, rolling; `at` is the update time for new entries, carried entries (same text or cited C id) keep theirs | 12, text 160 |

PR state, author and reviewers are **not** stored in the dossier. The
renderer reads them from the current snapshot, so a dossier cannot carry a
stale state line and those parts need no verification. CI is not in the
dossier at all, stored or rendered (see "CI is not a signal").

`flags[]` (`needs_user`, `contradiction`, `looks_finished`, `off_topic_pr`)
come with each version. `needs_user` shows in the topic view;
`looks_finished` and `off_topic_pr` feed consolidation.

**Dossier as prompt text** (`renderDossier` in agent, ~8k chars max):

```
Topic dossier "Move CI to Depot" (v7, written 2026-09-20)
Goal: Run all CI on Depot runners to cut cost and queue time.
Status: blocked - waiting on the runner image PR
Summary: Test jobs moved; Docker builds next; ...
People:
- @alice driver: owns the rollout
- @bob reviewer: signs off workflow changes
What the user cares about here:
- CI cost and cache keys (instructions)
Open questions:
- Q1 Do we keep GitHub runners for release builds? (asked by @carol, acme/app#1890)
PR timeline, oldest first (state from GitHub now, not from memory):
- acme/app#1880 merged by @alice: base runner image
- acme/app#1899 open, @alice: move Docker builds
Earlier: ...
Recent changes, newest first:
- 2026-09-19 Docker build PR opened, waits on the image
```

`dossierBrief` (core) is goal + status + driver in 400 chars, for topic
assignment and consolidation, where many topics share one prompt.

**Dossier update prompt** input, in order: the rendered previous dossier
(or "none yet"), the user's context block, member PR state lines, intros of
joined PRs, the new events (short ids `e1..eN`, bots compacted to counts
per PR), left PRs, known facts (short ids `F1..Fn`), stale facts to
recheck with their stale reason, new feedback. The answer (JSON,
`dossierUpdateOutput`) is the whole new dossier plus `flags`, `facts`,
`closeFacts`, `confirmedFactIds`. Refs in the answer are the short ids; the
service maps them back to `FactRef`s and drops unknown ones. A candidate
fact with no valid ref is dropped (provenance is required). `validFrom` =
earliest ref time.

Input hash (`dossierInputHash`), stored with each version as a record:
previous version (topic + number), delta event ids and `toSeq`, joined and
left PRs, stale fact ids and claims, new feedback ids, instructions,
tailoring, standing rules, model, prompt version. Not the known facts
(context only). Nothing skips on it: whether a topic updates is
`isEmptyDelta` plus the context hash (step 4).

### Facts

`Fact` in core. Entities (`EntityRef`):

| kind | key |
|---|---|
| `person` | GitHub login, lowercase |
| `path` | `owner/repo:dir/prefix/` |
| `initiative` | topic id (one initiative per topic) |
| `pr` | PrKey |

Predicates and their rules (`PREDICATE_RULES`):

| predicate | typical shape | unique | ends with PR |
|---|---|---|---|
| `drives` | person -> initiative | one per object | no |
| `works_on` | person -> pr / path / initiative | no | yes |
| `reviews` | person -> pr / path | no | yes |
| `owns` | person -> path | no | no |
| `part_of` | pr -> initiative | one per subject | no |
| `depends_on` | pr -> pr | no | yes |
| `blocked_by` | pr / initiative -> pr / person | no | yes |
| `decided` | initiative / pr, text | no | no |
| `status` | initiative / pr, text | one per subject | no |
| `user_cares` | initiative / path / person, text | no | no |
| `note` | anything, text | no | no |

`status`, `decided`, `blocked_by` and `depends_on` are `followsHead`: a
push that moves a ref's head makes them stale (`head_moved`). The rest do
not care about pushes.

`user_cares` candidates from a dossier update are dropped: their refs can
only be events or PRs, so GitHub text would be their only source.

**Reconcile** (Mem0 style, extract then reconcile). Candidates come out of
the dossier update, deduped, and only the newest per unique slot (a
handover inside one delta must not leave two drivers). `preReconcile` (core,
pure) settles most of them against
every active fact on the candidates' subjects **and objects**, across all
topics (objects matter for per-object slots: "bob drives X" has to see
"alice drives X"):

1. same subject, predicate, object and normalised text: **NOOP**, merge refs, confirm (a stale fact is rechecked like `confirmedFactIds`)
2. unique predicate, different value, candidate newer: **UPDATE** (old fact closed with `invalid_at` = candidate `validFrom`, `superseded_by` = new id)
3. same subject, predicate and object, different text: ambiguous
4. nothing in the way: **ADD**. In the way means an occupant of a unique
   slot; for predicates without a uniqueness rule a different object is just
   another fact ("alice works on #1" and "alice works on #2")
5. anything else: ambiguous

Ambiguous candidates are batched across topics (40 per call) into
`reconcileFacts`, which answers one of `add` / `update <factId>` /
`invalidate <factId>` / `noop <factId>` per item. The dossier update itself
may also close facts it was shown (`closeFacts`) or confirm stale ones.
`invalidate` closes the named stored fact and does not add the candidate
(Mem0 DELETE).
Closing never deletes: it sets `invalid_at`, `invalid_reason`,
`superseded_by` and `expired_at`.

Queries without prompts (`listFacts(FactQuery)`):
- who is doing what: active `drives` / `works_on` / `reviews`, grouped by person
- what changed since T: facts with `recorded_at > T` or `expired_at > T`
  (`changedSince` includes closed facts)
- per PR: facts about the PR or citing it (`PrDetail.facts`)

### Verify-before-use

Deterministic, no agent, over stored snapshots (`verifyFact`,
`verifyDossier` in core). Runs in the sync verify pass (writes) and again at
read time in `getTopic` / `getPr` (does not write, only sets
`FactView.stale` / `DossierView.staleClaims`).

| check | outcome |
|---|---|
| referenced PR not in the store | stale `pr_missing` |
| lifecycle predicate and its PR merged / closed | invalidate at `mergedAt` / close time (`pr_merged` / `pr_closed`) |
| `status` fact about a PR that merged / closed after the fact's `valid_from` | stale `pr_merged` / `pr_closed`, the next dossier update restates it |
| `followsHead` predicate, ref has `headOid` and the PR head moved | stale `head_moved` |
| `reviews` / `works_on` and the person is no longer reviewer / author / committer | stale `person_not_involved` |
| referenced comment, review or commit gone from the snapshot | stale `source_deleted` |
| dossier question whose ref sits in a resolved review thread | stale claim `thread_resolved` |
| dossier timeline entry for a PR that is no longer a member | stale claim `left_topic`, and the PR is in the next delta's `leftPrKeys` |

Stale facts are left out of every prompt's context, shown greyed in the
UI, and handed to the topic's next dossier update as the recheck list,
which forces that update even without new events. Each is offered once per
time it goes stale (`rechecked_at`), 20 per update, newest first.
Confirming one (`confirmedFactIds` or a NOOP) rechecks it: a moved head is
re-anchored to the current head, a fact that then passes is verified, one
whose check still fails is closed ("confirmed, but the ... check still
fails"), since the next verify pass would only mark it stale again.

Dossier claims that fail `verifyDossier` are dropped before a version is
stored and before a dossier goes into a glance prompt
(`withoutStaleClaims`).

### Batched glances

- Per topic, `planGlanceBatches` splits the PRs needing a glance into
  batches of `GLANCE_BATCH_SIZE` (18), unread first.
- One `glanceBatch` call per batch: rendered dossier once, the user's
  context block once, then one section per PR (`batchDetail` limits, smaller
  than v1's `fullDetail`: body 1500, 15 files, last 8 human comments at 300
  chars), each headed by its PrKey and how it reached the user.
- Answer: `{"glances": [{prKey, verdict, forYou, does, risk, othersSaid, keyFiles}, ...]}`.
  `keyFiles` (2026-09-29, optional, default []): up to 3 `{path, why}`, the
  changed files to open first; `keyFilesFor` keeps only paths among the PR's
  files (a leading "./" is forgiven), drops repeats and caps at 3. Stored as
  JSON in `pr_glance.key_files` (migration 016).
  The outer object is parsed with `glanceBatchOutput`; each entry on its own
  with `glanceBatchItemOutput`. Entries for PRs not in the batch or
  duplicated are dropped. `GlanceBatchResult.missing` = asked for but absent
  or invalid, with `missingWhy` per PR ("left out of the answer", "answered
  with verdict \"SHIP_IT\", ...", "the whole answer was unusable (...)").
  An answered prKey matches its batch key ignoring case and spaces when
  that still points at one PR.
- Misspelled verdicts are repaired (`repairVerdict`): Sonnet reproducibly
  wrote `LOOKS_SASAFE` / `LOOKS_SASE` for one PR (acme/app#1812),
  which the strict enum rejected on both attempts. Only unambiguous
  spellings are read, and anything mentioning "close" wins, so a garbled
  answer never becomes "looks safe" by accident. The prompt asks for
  exactly N entries with the verdict spelled as given; the retry prompt
  adds that the first answer was unusable.
- Self-corrected answers (2026-09-28): for one real PR Sonnet
  writes `LOOKS_SASAFE`, then "Wait, let me correct a typo in the verdict
  field." and a second, fixed JSON object. `parseAgentJson` collects every
  complete top-level JSON value (`jsonCandidates`, brackets inside strings
  ignored) and takes the last one that parses and fits the schema; the
  outermost-brackets reading is the fallback. Applies to every agent call.
- Missing PRs of a topic's first-round batches go into one retry batch
  (`retryBatch`, attempt 2). Still missing after that: one error line per PR
  in the report with its `missingWhy`; the unchanged hash retries it next sync. A batch whose outer
  JSON does not parse counts all its PRs as missing; so does a runner failure
  (timeout, process error), which the engine catches per batch.
- `glanceItemInputHash` per PR: v1 snapshot fields, provenance, topic name,
  instructions, tailoring, standing rules, feedback on that PR, model, and
  `GLANCE_PROMPT_VERSION` (g2 since key files, so every glance regenerates
  once; sets and topic summaries keep their hashes). Never the other PRs in
  the batch. Stored glances get `dossierVersion`.
- **Glance hash** (2026-10-05): the dossier version is out. With it, every
  dossier rewrite left every glance in the topic out of date, though the
  news was on one PR; browsing showed "out of date" all over and the next
  catch-up or sync re-glanced the whole topic. A glance picks up the newer
  dossier when its own PR changes or on a look. A person's comment edit
  counts through its edit time in the new hash (the dossier version used to
  cover it). `legacyGlanceItemInputHash`
  (the old shape, with the version) still counts as current
  (`GlanceInputs.isCurrent`) while that dossier is the latest and no
  person edited a comment after the glance was written (the old shape held
  comment ids only, and in Unsorted no dossier version moves), so the
  update regenerates no glance; the next rewrite stores the new shape. A
  glance written against an older dossier (`PrDetail.glanceBehindDossier`,
  `GlanceInputs.behindDossier`) is not stale and shows no "out of date",
  but a look at the PR rewrites it with the newer dossier (the on-look
  refresh: `wantsGlanceRefresh`, `needsGlance(prKey, true)`, the writer's
  scope with `prKeys`).
  Trade-off: a glance can lag topic context ("the PR below this one
  merged") until its own PR moves.
- Model: the glance model (`claude-sonnet-5-5` by default, `POSTPILE_GLANCE_MODEL`).

### Consolidation ("sleep-time")

`consolidate(options)` on EngineService, CLI `consolidate [--if-due]
[--max-agent-calls n]`, and the desktop app asks every 30 minutes
(`ConsolidationSchedule` in the main process) with `onlyIfDue` and the sync
call cap. The engine waits for a running sync or poll first, so they never
overlap; a run or a failure is logged, never thrown. Placing PRs is not its
job: topic assignment places every PR itself. Due = 24h since the last run
and at least one new dossier version since. One `consolidation` call (sonnet)
over all active topics (split into chunks of 40 topics when needed).

Input (`ConsolidationInput`): every active topic with its latest dossier,
open/total PR counts and last activity; groups of active facts sharing a
slot (subject + predicate for per_subject, predicate + object for
per_object, subject + predicate + object otherwise, so "alice works on #1"
and "#2" are not duplicates); the newest 60 feedback entries across topics
(a click without a note shows as "(no note: a bare click)"); rule and topic
proposals the user accepted or rejected (so nothing is proposed twice).
Withdrawn ones are left out: the user never said no to them.

Output and what happens:

| output | effect |
|---|---|
| `topicProposals` rename / merge / split | filed as pending `topic_proposal` rows, same "never the same idea twice" rule as v1, plus no repeat of a rejected one (below). Split PR keys must come from the topic's dossier timeline (the prompt has no other member list), so a topic without a dossier gets no split |
| `factMerges` | applied directly: dropped facts closed with `superseded_by` = kept one, refs moved over (internal memory, nothing the user sees disappears) |
| `rules` | filed as pending `rule_proposal` rows when the evidence holds (below). Accepted global rules go into every `PromptContext.standingRules`; accepted topic rules are appended to that topic's tailoring |
| `finished` | topic retired only if the deterministic gate also holds: every member PR merged or closed, no human activity for 2 days, no unread or snoozed tile. Every full sync retires such topics anyway, agent or not (see "Topic status"). Retiring is reversible |

Also deterministic, in the same run: retire topics that pass the gate and
whose dossier status is `finished`. Dossier versions are pruned on every
dossier save, not here.

**Proposals must earn their interruption** (2026-10-02). Every proposal
asks the user to read and decide, and the user stopped clicking them: rules
came from bare "Wrong topic" clicks, merges said "both are small" or "both
are finished", reasons read "placeholder", and most pending ones named
topics already retired. The bar, deterministic where it can be
(`proposal-quality.ts` in core):

- **A real reason.** A topic proposal, area merge or rule whose reason is
  empty, under 15 characters, or a placeholder ("placeholder", "TBD",
  "n/a", "...", "reason", ...) is dropped when the answer is mapped
  (`isJunkReason`). A merge whose reason rests on size or lifecycle alone
  ("small", "finished", "winding down", "nothing open") with no word for
  what the PRs share ("same", "serve", "series", "rollout", "blocker", ...)
  is dropped too (`isSizeOrStateOnlyMergeReason`): the prompt forbids it,
  this catches an answer that says it anyway.
- **No rule from bare clicks.** A rule cites at least two shown feedback
  ids, and at least one of them states a preference in words: a worded
  kind (tailoring kept or once, memory wrong / forget / confirmed / fixed,
  work-context forget) or a `not_mine` / `not_related` / `wrong_topic`
  click with a typed note. A bare click only moved a PR; `unmute` notes are
  GitHub text, not the user's (`ruleHasWordedEvidence`). The prompt says
  the same and never to invent topic-boundary rules from clicks.
- **No merge for size or state.** The prompt asks a merge to say how the
  PRs serve the same goal and what the user gains; "both are small",
  "both are finished", "winding down" are no reasons. Finished topics are
  retirement's job. The prompt says no proposals at all is the usual,
  expected answer.
- **No repeat of a "no".** A topic change equivalent to a rejected one is
  not filed: a merge of the same two topics in either direction, a
  rename of the same topic to the rejected name (another name may come up
  once the topic changed), a split of the same topic
  moving one of the same PRs, an area fold of the same two areas either
  way (`repeatsRejectedChange`). A rule whose text matches a decided one
  (case, spacing and closing punctuation aside, `ruleTextKey`) is not filed.
- **Withdrawn when stale.** A pending topic proposal naming a topic that is
  no longer active (retired, archived or gone, on either side of a merge),
  and a pending rule scoped to such a topic, gets status `withdrawn` with
  `decided_at`. It runs whenever a topic leaves the sidebar
  (`changeTopicStatus`) and at the end of every full sync, no agent call
  (`withdrawStaleProposals`). Accepting a merge records the decision first,
  so the accepted merge itself is never withdrawn by the archive it causes.
  Withdrawn proposals are not pending (Inbox, topic), are not fed to
  consolidation as decided, never block the same idea later, and the MCP
  `topic` read says "withdrawn ... not a rejection". `status` is TEXT, so
  the new value needed no migration.

### Cost accounting

- `RunnerAgentService` takes an `AgentCallObserver` and reports every call,
  failed ones included, with purpose, model, topic, attempt, duration and
  cost (the CLI runner's JSON has `total_cost_usd`).
- The engine's observer writes an `agent_call` row per call (run id = the
  sync or consolidation) and adds it to that run's `AgentCallStats`.
  `AgentBudget.take(kind)` decides and counts `skippedByBudget`; jobs count
  `skippedUnchanged` on hash hits.
- `SyncReport.agentCallStats` / `ConsolidationReport.agentCallStats`:
  per kind `calls`, `failed`, `retries`, `skippedUnchanged`,
  `skippedByBudget`, `durationMs`, `costUsd`. `agentCalls` stays as the total.
  `skippedUnchanged` counts PRs for `glance_batch` (a quiet sync over 141
  PRs shows 141), topics or batches for the other kinds.
- CLI: `sync` prints one line per kind (`dossier_update 3 (1 skipped
  unchanged) glance_batch 4 (1 retry) ... total 9, $0.12`).
  `--max-agent-calls` caps sync and consolidation.
- The app's status bar says "last sync: 40 agent calls", no dollar figure
  (2026-09-29): the user is on a subscription and the cost read like a
  bill. `costUsd` stays in the report, the CLI and `agent_call`.
- Calls are only counted by the observer (`AgentCallLog`); the budget only
  records skips. Chat and draft calls get run id `action`.
- Every finished sync stores its `SyncReport` in meta `last_sync_report`
  (`EngineService.lastSyncReport`, `GET /api/sync/last`) and logs a start
  line, a summary and one line per error (the desktop app writes these to
  `~/Library/Logs/PostPile/main.log`). A failed start sync used to leave only
  `last_sync_started_at` behind.
- While a sync runs, `EngineService.syncProgress` (`GET /api/sync/progress`,
  null between syncs) gives `SyncProgress`: running phases, agent calls done
  (the run's `agentCallStats.total`) and planned (what `AgentBudget` granted
  so far). Planned grows mid-run, since glances are planned only once their
  topic's dossier landed; every granted call is a real call, so done reaches
  planned at the end. The title bar polls it every second while this window
  waits on a sync and shows `syncing · nothing new on GitHub · agent calls
  34/82 · 2m` (`fetching GitHub` before any call is planned; tooltip lists
  the running phases and the calls per kind). What GitHub brought comes
  first (`SyncProgress.fromGitHub`, set once the fetch ends, 2026-10-05):
  agent work after "nothing new" reads as digesting what the poll already
  stored, not as the app having fallen behind. A bare growing "agent
  10/15/17" read as many agents working on news nobody could see. FakeEngine
  walks five canned steps (`syncStepMs`, 800 ms each) so the fake UI shows it.
- A failed PR batch in the full sync (GitHub's "Something went wrong"
  timeout on a heavy aliased query, a 502, a secondary rate limit) no longer
  throws the sync away: `fetchPrsPartial` keeps the other batches, the error
  goes to `SyncReport.errors`, and the failed PRs stay candidates for the
  next sync or poll. Same for the found-PRs fetch. The live poll still
  throws, so its backoff sees rate limits.

### EngineService and HTTP additions

| route | engine call |
|---|---|
| `GET /api/topics/:id` | `getTopic()` now carries `dossier: DossierView` (dossier, flags, stale claims, `changesSinceSeen`, `eventsBehind`) |
| `GET /api/prs/:owner/:repo/:number` | `getPr()` now carries `facts: FactView[]` |
| `GET /api/facts?entity=person:alice&since=...` | `listFacts()` |
| `GET /api/proposals` | `listProposals()` (topic + rule proposals) |
| `POST /api/rule-proposals/:id` `{accept}` | `decideRuleProposal()` |
| `POST /api/topics/:id/seen` | `markTopicSeen()` |
| `POST /api/consolidate` `{onlyIfDue, maxAgentCalls}` | `consolidate()`, capped like a sync when no cap is given |

`POST /api/sync` takes `dossiers` in `agentJobs`; `summaries` is gone.
`GET /api/facts` takes `entity=kind:key`, `predicate`, `topicId`, `since`,
`includeClosed` and `limit`.

### What v2 removes or replaces

| v1 | v2 |
|---|---|
| `summaries` job, `summarizeTopic`, `TopicSummaryInput/Result`, `topicSummaryOutput`, `topicSummaryInputHash`, summary prompt | `dossiers` job, `updateDossier`; `topic.summary` mirrors `dossier.summary` |
| rename / merge ideas from the summary job | consolidation job (plus split) |
| per-PR `glance()`, `glanceInputHash`, `GlanceWriter` one call per PR | `glanceBatch()`, `glanceItemInputHash`, 18 PRs per call |
| per-PR `classifyEvents` | `classifyEventBatch`, one call per topic |
| `TopicChoice` name + summary | + `brief` from the dossier |
| `AgentBudget.take()` | `take(kind)` + observer stats |
| `topic.summary_input_hash` | unused, dropped later |

The v1 agent methods, prompts, schemas and hashes are deleted, and so are
the `glance` and `topic_summary` call kinds. `PROMPT_VERSION` is `v2`, so
every hash stored before v2 goes stale once and the first sync regenerates
within `--max-agent-calls`.

### Build split

Built in three parts against these contracts: core + store (pure rules and
repos), agent (prompts, answer mapping, hashes) and engine + server + CLI
(sync, consolidation, read models, routes). All three landed.

## Memory by author: instructions vs. what the agent learned

Memory is split by who wrote it.

- **User-authored**: the general instructions (`instructions.md`). Highest
  priority in every prompt. The agent never changes it without the user
  accepting a proposal. Hand edits are fine at any time.
- **Agent-derived**: dossiers, facts, topic tailoring distilled from chat.
  The agent maintains them; the user steers by chat, "Recheck" and
  one-click Forget, never by editing agent prose. Every line answers "Why?".

**Recheck instead of Wrong.** A one-click "Wrong" was too easy to hit and
threw away lines that were right. Every fact and dossier line now has
"Recheck": `recheckMemory` makes one `memory_recheck` call (sonnet,
recorded in `agent_call` under the `action` run, at most
`RECHECKS_PER_DAY` = 40 per rolling 24h) with the line, its "Why?" sources
(GitHub ones fenced, the user's own words not), the topic dossier, and the
PRs the line cites (else the topic's newest, max 8) with their newest 12
events each. The zod-checked answer is `{outcome: holds | fix | drop,
text, why}`; a fix without a new line reads as holds. Nothing is written
until the user accepts in the dialog, through `correctMemory`:

- holds -> `confirm`: a fact gets `markVerified` (not stale, verified now);
  a dossier line logs `memory_confirmed` so the next update keeps it.
- fix -> `fix` + `fixedText`: a fact is closed (superseded) by a copy with
  the corrected text and the same refs; a dossier line logs
  `memory_fixed` with `fixedClaimNote` (old line, "→", new line) and shows
  the fix right away (`DossierView.fixedClaims`) until the next update
  writes it in.
- drop -> `wrong`: as before, the fact closes, the line logs `memory_wrong`.
- Every outcome and errors (failed call, cap, gone fact) also offer "Tell
  the agent what's wrong": the topic's agent pane opens with the line
  quoted (the tile chat until 2026-10-05, see "The PR pane").

**Recheck only on big claims** (2026-09-28, Recheck on every line was noise).
Every line keeps "Why?"; Recheck (and Forget) only show on:

- Dossier-level claims: status, goal, open questions, people's roles, what
  you care about (Forget stays on cares). Not the PR timeline and not the
  "since you last looked" change lines, which retell events.
- Facts whose predicate is big (`isBigClaim` in core `big-claims.ts`,
  shipped as `FactView.recheckable`): `drives`, `owns` (person roles),
  `decided` (decisions), `blocked_by` (risks), `user_cares`. Trivial and
  never rechecked: `reviews` (reviewer assigned), `works_on`, `part_of`,
  `depends_on` (stack relations), `status` (short state notes), `note`.
- The PR's glance as a whole: "Recheck" on the glance's title line (the
  action bar until 2026-10-05) ("Recheck this assessment") sends the joined glance as the claim with
  `MemoryRecheckRequest.prKey`; the engine reads it against that PR, its
  newest events and its topic's dossier (`recordedIn`: "Glance: ..."). A
  glance is not memory, so the dialog has no Accept: it shows the outcome,
  offers "Tell the agent what's wrong" and Close.

Every correction returns an undo token (`memory:` prefix) valid for
`UNDO_WINDOW_MS`: undo deletes the feedback row (the only non-append
write on `feedback`), reopens a closed fact, closes a fix's replacement,
restores a confirmed fact's check state, or restores a relation override.
The undo map is in memory, like the mark-read queue. The relation "Wrong"
(with the real relation) stays as it was; it is a choice, not a claim.

**Lessons from your reviews** (2026-10-02, with a second opinion from
another model). Some glances miss: the user requests changes on a PR the
glance called safe, or sees a problem in the diff the glance did not name.
The app should learn what the user pushes back on, but a review is
evidence, and only accepting a lesson gives it authority. So a miss becomes
a candidate line in the topic, and nothing reaches a prompt until the user
picks where it applies. Types and rules: core `lessons.ts`; table `lesson`
(migration 025, which also adds `pr_glance.head_oid` and
`instructions_version.source_lesson_id`).

- **Possible misses** (`possibleMisses`, deterministic, in `storePr` through
  `LessonKeeper`, before the glance can be written again and replace the
  verdict): the viewer's new `review_changes_requested` on a PR whose stored
  glance was written before the review, on the same head commit when both
  are known (a review on newer code judged code the glance never saw), with
  a mismatch: `safety` (LOOKS_SAFE), `risk` (LOOK_CLOSER with a `low` risk)
  or `relevance` (NOT_YOURS). A real Look closer is no miss, and an approval
  on a Look closer PR is not counted: the user may well have looked closer
  first. One lesson per review id (unique), status `new`.
- **Structured evidence**: what the glance said (verdict, risk, for you,
  does, time, head) and the review: body plus the user's inline comments
  written after their previous review and up to this one (GitHub does not
  link them to the review in our snapshot; a change request often says
  everything inline). Nothing is clipped in storage.
- **The source moves**: every `storePr` compares pending lessons with the
  review now (`reviewNow`). An edited body or inline comment starts the
  candidate over (`new`, line cleared); a deleted or dismissed review
  withdraws it. `checkOpenLesson` repeats the check right before the user's
  decision lands. On a capped snapshot a missing review only counts as
  deleted when the reviews list reaches back to it, and a missing inline
  comment only when the comment lists are complete (`capHitCoversSince`);
  otherwise the stored text stands.
- **Writing the line** (`lesson_write`, sonnet, one call per topic for up to
  8 new lessons, in the sync's digest after topics, `LessonWriter`): the
  review, inline comments, PR line and earlier glance are fenced as GitHub
  text (the user wrote the review, but it can quote anyone); the call runs
  without tools like every call. The answer is per lesson: a line "When
  <condition>, <what to check or how to judge>" of at most 200 chars that
  the user's words support, or null for nits, empty reviews and one-offs
  (`none`), or `sameAs` an open line in the topic (`joined`, shown there as
  one more review). A line equal to one the user dismissed (words compared,
  `repeatsDismissed`) reads as none; dismissed lines also go into the
  prompt. One miss is enough to offer a line; repeats are more evidence,
  not consent.
- **The topic marker** ("Remember for future assessments?"): the topic's
  open lessons with "From your review on #4521 · Earlier assessment: Looks
  safe" and three choices. "Remember in this topic" appends the line to the
  topic's tailoring (logged as `tailoring_kept`), which every later prompt
  for the topic reads. "Use across topics…" asks
  `proposeInstructionsFromLesson` for the instructions with that one line
  added: the prompt gets the chosen line and the review fenced as context,
  and the engine drops any answer that changes or removes an existing line
  or adds more than 4 lines / 600 chars (`onlyAddsLesson`). The user sees
  the usual line diff (Accept, Edit inline, Reject); an accepted one is
  saved with origin `lesson` and `sourceLessonId`, the lesson turns
  `kept_all`. A hand edit in the diff is the user's own and is not
  checked. "Dismiss" drops the line for good.
- **"Teach future assessments"** in the detail pane, under the glance's
  verdict: "What should it check next time?" The note is the user's own
  words (not fenced); `teachLesson` stores a `taught` lesson with the
  current glance and writes its line right away (capped at 30 per rolling
  24h), then shows it with the same three choices. A wording like
  "Disagree", "Wrong" or "Why?" was rejected: the user reads those as
  asking for an explanation, not as changing what the agent does next time.
- **Lifecycle**: a pending lesson whose topic retires, is archived or
  deleted is withdrawn at the next digest (`LessonKeeper.sweep`); one noted
  while its PR was unsorted moves to the PR's topic once it has one.
  Statuses: new, open, none, joined, kept_topic, kept_all, dismissed,
  withdrawn.

Unaccepted lessons never reach a prompt: no feedback row, no dossier input,
no glance context. The dossier still reads the review itself as an ordinary
event.

**Topic chat** (2026-10-05). "Ask the agent" on the topic header chats
about the whole topic: `topicChat(topicId, message)` /
`getTopicChat(topicId)`. Messages live in `chat_message` like the old tile
chats, with `tile_id = 'topic:' + topicId` (`topicChatId`; no tile id starts
with it) and `topic_id = topicId`, so no migration, and the dossier update
reads them as chat turns like any other. The agent gets the topic, every PR
on its tiles (newest first, at most 60 in the prompt with a line for the
rest), the history and the topic's prompt context. Unsorted works too; its
lasting point comes back with `topicId: null`. It is the only chat on a
topic: the tile chat (routes, engine, the prompt's tile mode) was removed
once the renderer stopped using it; old tile chat rows stay in
`chat_message` and still reach the dossier through `topic_id`. A topic
merge (accepted proposal or the topic tidy) moves the merged topic's
messages and its chat to the target (`moveTopicChat`). A turn's
two messages are stored together once the answer is in: a failed call
stores nothing, so the history never holds an unanswered message.

Each turn is a fresh `claude -p` call with the whole prompt rebuilt, not a
kept-open session (`--resume` or a long-lived stream-json process). Checked
2026-10-05: prompt caching already works across separate calls (a second
call with the same ~28k-token prefix read all of it from cache and wrote
none), and spawning the process adds about 0.25s; chat answers averaged
about 4.5s, most of it the answer being written. The prompt keeps the
stable part first (topic, PRs) and the history and new message last, so
the cache holds between turns, and nothing in it is relative to now. A
session would save almost nothing and cost: PR data frozen at the first
turn, transcripts on disk (`--no-session-persistence` is on for that
reason), a second copy of the history next to `chat_message`, and a
process per topic to keep alive. Streaming is left out for the same
reason: answers are short by design.

**Instructions changes via chat.** Tile chat returns a lasting point
without a scope; the user picks it: "Keep for this topic" stores tailoring,
"Just this once" only logs it, "Keep for all topics" calls
`proposeInstructionsChange`, which gets only the current text and the
user's own message (never GitHub text; a lesson's proposal is the one
exception, see "Lessons from your reviews"), is told the user chose all topics,
and returns the full new text plus a summary. The UI shows it as a line
diff: Accept, Edit inline, Reject. The general chat in "Your instructions"
always goes to the same call. When that call finds no change, the point
stays on screen so it can still go to the topic. Proposals must cite a
stored user chat message (`sourceChatMessageId`) or an open lesson
(`sourceLessonId`); the engine refuses anything else.

**Versions** (`instructions_version`, migration 004): `version`, `text`,
`summary`, `origin` (`chat` / `outside`), `source_chat_message_id`,
`created_at` (origin `setup` for the setup flow's Accept; origin `lesson`
with `source_lesson_id`, migration 025, for a lesson used across topics). The file stays the source of truth. `InstructionsHistory`
reads it on every prompt context and stores a text that differs from the
newest version as "Edited outside the app" (the first one as "Found on
disk"), so every prompt knows its instructions version. Saving checks the
proposal's `baseVersion` against the current one: on a mismatch the hand
edit is already stored, nothing is written, and the change comes back
rebased (asked again on top of the new text) for another decision. Writes
go through a temp file + rename and follow a symlink to its target.
An accepted change counts as new context: dossiers with a stored context
hash refresh once on the next sync, and the accept message says how many.

**"Why?" provenance.** Every dossier line (goal, status, open question,
timeline entry, care, recent change) carries `refs` (GitHub) and
`userRefs` (instructions version `I1`, tailoring lines `T1..`,
corrections `U1..`, chat turns `M1..`). The dossier update prompt hands
out these short ids and gets the user's chat turns in the topic since the
last version (max 10); unknown ids are dropped, an unchanged line that
cites nothing keeps its old sources, 6 GitHub + 3 user refs per line.
Fields are optional, so older versions load and show "no source recorded".
`DOSSIER_PROMPT_VERSION` (d2) is recorded in the dossier input hash only;
the shared `PROMPT_VERSION` stays, so glances and sets are not regenerated.
`getMemorySources(target)` (`GET /api/memory/sources?fact=` or
`?topic=&version=&path=`) describes each source from stored snapshots
(who, what, when, quote, link) and a verify state: ok, stale (reason),
closed, user_only, unsourced. The status line counts as stale when the
head moved since its refs; questions use `verifyDossier`.

Routes: `GET/POST /api/instructions`, `GET/POST /api/instructions/chat`,
`POST /api/instructions/proposals`, `GET /api/memory/sources`.

## Setup flow

A new user starts with an empty `instructions.md`, and every prompt reads
it first. Setup has an agent draft it from what GitHub already knows; the
user reviews and edits it, and nothing is written before Accept. The
"Memory by author" rule holds: the file only changes through that Accept
(or a hand edit).

**When it shows.** On start when `instructions.md` is missing or empty and
meta `setup_state` has no flag (`GET /api/setup` answers `needed`). The
flow takes the middle and right panes; the sidebar shows a small "Setting
up" note. The start sync waits: Accept runs the first sync, "Skip for now"
stores `skipped` and syncs. The Instructions pane has "Run setup again"
(always) and a honey banner after a skip. `POSTPILE_FAKE_SETUP=1` with
`POSTPILE_FAKE=1` starts sample data with no instructions, so the flow
shows. Once open, the renderer keeps it open until Accept's sync finishes
or the user closes it, even though the server stops asking for it. While
first-run setup is needed the live poll answers `blocked: setup not
finished` (`Engine.pollOnce`): no fetch, topic calls, catch-ups or Mac
pings before the user has instructions. It used to run from launch, so
setup's Opus calls queued behind dozens of catch-up runs that were
written without any instructions.

**Steps**, one screen each, with a worded step indicator (done sea,
current ink, next quiet) and word chips, never symbols alone:

1. **Check the basics** (`GET /api/setup/checks`, run fresh each time):
   `gh --version`, `gh auth token` plus the viewer query (shows the login
   and team count), `GET /notifications?per_page=1`, `claude --version`
   (`POSTPILE_CLAUDE_BIN`). Chips: OK, Fix this, Warning, Waiting (an
   earlier check failed). Each problem carries the exact command
   (`brew install gh`, `gh auth login`, `gh auth refresh -h github.com -s
   notifications`, `curl -fsSL https://claude.ai/install.sh | bash`,
   `claude auth login`) with Copy; the commands come from `TOOL_FIXES` in
   core, shared with "Missing tools" below. From claude 2.x the check also
   asks `claude auth status --json` and warns when it is not logged in.
   Continue needs gh, login and notifications; a missing claude only warns
   that agent features (and the draft) will not work. The checks refresh
   the tool status too, so a fix made during setup counts everywhere.
2. **Sweep**, a job (`POST /api/setup/sweep` starts it and returns, `GET`
   is polled every second like the sync progress; a start while one runs
   joins it). Progress lines, each Working / Done / Failed / Skipped:
   - viewer, teams (`Viewer.teams`) and team members, stored like a sync
     does (the only required step; failing it ends the sweep);
   - team roles (2026-09-30, see "Team roles"): every team classified
     again from the last 90 days of reviews, the user's flips kept. The
     line says "Home team: team-devex (57% of your reviews came through
     it) · Routing only: approvers (4% of your reviews came through it)",
     or "No home team: your teams only route reviews to you · …". Under
     the finished sweep each team gets a row with a flip ("team-devex ·
     Home team (57% of your reviews) · Make routing only"). A failed read
     is noted and the sweep goes on with the stored roles (none: every
     team home). The team members above are only the home teams' members.
   - 30 days of activity in ONE GraphQL request (`recentActivity`): three
     search aliases, `author:@me updated:>=`, `is:open
     review-requested:@me`, `reviewed-by:@me -author:@me updated:>=` (40 /
     20 / 40, about 100 PRs), each PR once (authored first), title plus
     the top-level folders of its first 50 changed files (`topLevelDirs`);
   - ownership files of the 5 busiest repos (`rankActivityRepos`), through
     the contents API (raw, read-only; 403/404 read as missing):
     - CODEOWNERS: the first of `.github/CODEOWNERS`, `CODEOWNERS`,
       `docs/CODEOWNERS`, cut to rules naming `@login` or `@org/team`
       (`codeownersLines`, 20 per file);
     - owners.yaml (the owners-yaml format some repos use instead, with
       CODEOWNERS kept minimal): the root file, and when it exists, the
       `owners.yaml` in each of the 6 top-level folders the user's PRs
       touch most (`busiestDirs`). Cut to rules whose owner fields name
       `@login`, `@org/team` or the bare team slug (`ownersYamlLines`, 20
       per file), one line each with patterns read from the repo root
       ("/.github/workflows/ -> owners: team-devex");
   - the latest work context digest (its prompt text), if any;
   - one `setup_draft` call: opus (`POSTPILE_SETUP_MODEL` overrides it and
     refine, in `models.ts`), toolless, recorded under the `action` run.
     PR lines and ownership rules are fenced as `<github_data>`; the
     digest sits in a `<local_context>` section as trusted background; the
     current instructions (on a re-run) as the user's own words.
   A failed call leaves `blankSetupDraft`: the five headings empty and the
   busiest repo as main, so the user can still write it.
3. **Review the draft.** Sections (About me, What I own, What gets routed
   to me, What to ignore or keep quiet, Preferences) as one text box each,
   a line under each usual heading saying what it is for
   (`SECTION_HINTS`; Preferences says PostPile never pushes, merges or
   reviews code), with "Why?" listing the agent's lines and their sources (team, PR with
   link, ownership rules, digest). "Tell the agent what's off" makes one
   `setup_refine` call (`POST /api/setup/refine`, same model and material,
   the edited sections plus the message and earlier messages) and shows
   the change as a `DiffView` with the changed headings. Lines the user
   wrote themselves (`userWrittenLines`) come back `fromUser` and need no
   source. Quiet repo toggles come prefilled from the draft's
   suggestions. The main repo radios ("All repos" + the busiest 8) start
   on "All repos", so Accept does not narrow the sidebar by default; the
   suggested main repo carries a "suggested" chip and its reason, and the
   user can pick it. The main repo cannot also be quiet. A refine keeps
   the user's picks: toggles they flipped and their main repo stay, only
   untouched toggles follow the new draft (`picksAfterRefine` in the
   renderer's `lib/setup.ts`). On a re-run the whole draft shows as a diff against the current
   file.
4. **Your day** (2026-10-05, see "Interruptions"): "Last thing: when should
   PostPile tap you on the shoulder?" with three illustrated cards (Never,
   In batches, As soon as it matters), each saying what you get. The stored
   mode is preselected, Never while it loads. Nothing is written here; the
   pick goes with Accept (`interruptions`, null leaves the stored mode).
5. **Accept** (`POST /api/setup/accept`) lists what happens, shows the
   fit check (below) and the final diff and then: writes `instructions.md` as a new version with
   origin `setup` ("Written with setup" / "Rewritten with setup"; an
   unchanged text writes nothing), marks the chosen repos quiet (others
   untouched), sets the repo scope to the main repo (or All repos), keeps
   the Your day pick, stores `done`, then the renderer runs a normal sync with its progress and
   lands on the topics. When the file changed since the draft was
   reviewed (base version mismatch) nothing is written and the answer
   carries the file as it is now; the review diffs against it again.

**What the draft may say.** The draft, refine and fit prompts share one
paragraph on what PostPile does with the instructions (topics,
summaries, whose turn, loud or quiet, Mac pings, comment drafts; approve,
comment and mark read only on a click) and what it never does (write,
commit or push code, merge, review diffs, run CI, post by itself). The
work context digest comes from Claude Code notes, which are full of rules
for coding agents; the draft rules keep those out of Preferences
(2026-09-29, after a tester's draft carried "don't push write-ups onto PR
branches" and "signed PRs land only with my approval").

**Fit check.** Entering Accept sends the text as it is to `POST
/api/setup/fit`: one `setup_fit` call (the default Sonnet, toolless, 90s,
recorded under the `action` run). Its input is only the user's own text,
no GitHub data. The agent writes a note only for a line that has no
effect (asks for something PostPile never does), sits under the wrong
heading (`moveTo`), or is too vague to act on, with an optional
`rewrite`; it never judges whether a preference is a good one.
`mapSetupFit` (core) keeps a note only when its line is in the text
(`claimKey` match, the named heading first), its kind is known and a move
names another known heading; line and heading come from the text, one
note per line, at most 12. The panel "Does it fit PostPile?" shows
Checking / All lines fit / N to look at, and per note Remove line, Move
to <heading> (to the end of that section, a new section when missing),
Use the suggestion, Keep as is (`applyFitFix` in the renderer's
`lib/setup.ts`). A fix or keep drops the note without asking again; the
check reruns only when the text changed since (back to review and
edit) or after a failed call ("Check again"). Accept is never blocked by
it, and a failed call shows in the panel, not as a toast. Fake mode
answers by keywords (`FakeSetup.checkFit`).

**Citations.** Sources get short ids in `setupSources`: `t1..` teams,
`p1..` PRs, `o1..` ownership file excerpts (CODEOWNERS or owners.yaml),
`d1` the digest. Every claim is
`{text, sources}`; `mapSetupDraft` drops unknown ids (4 per claim at most),
drops repo suggestions the sweep never saw, keeps a claim with no source
(the UI says "No source cited: a default the agent suggests" or "Your
words"), and clips everything (`SETUP_LIMITS`).

**Pure parts in core:** `instructions-sections.ts`
(`parseInstructionsSections`, `formatInstructionsSections`, `sectionChanges`,
`changedHeadings`) and `setup-draft.ts` (the rules above). The renderer
keeps a copy of the section format in `lib/setup.ts` (`draftText`) since it
imports types only; keep the two in step.

**Fake mode** (`FakeSetup`): canned checks, sweep lines after short delays
(about 6s in all), a canned draft built with the real `setupSources` and
`mapSetupDraft`, a refine that files the message under Preferences, and an
accept into the in-memory instructions and repo settings.

Routes: `GET /api/setup`, `GET /api/setup/checks`, `POST/GET
/api/setup/sweep`, `POST /api/setup/refine`, `POST /api/setup/fit`, `POST /api/setup/accept`,
`POST /api/setup/skip`.

## Missing tools (gh, claude)

PostPile needs two programs it does not ship: `gh` for every GitHub read
and write (the token comes from `gh auth token`) and `claude` for every
agent call. Either can be missing, logged out or failing. The rule: detect
it once, say it plainly with the exact fix, keep working on what does not
need it, and never retry per call.

**Status** (`ToolHealth` in the engine, wire type `ToolsView` in core):

| gh state | means | sync | poll |
| --- | --- | --- | --- |
| `ok` / `unchecked` | works, or not looked at yet | runs | runs |
| `missing` | not on PATH | skipped | paused |
| `logged_out` | `gh auth token` gave nothing | skipped | paused |
| `rejected` | GitHub answered 401 to the token | skipped | paused |
| `offline` | network or GitHub down | runs (fails) | backs off by itself |

| claude state | means | agent |
| --- | --- | --- |
| `ok` / `unchecked` | works, or the first call finds out | on |
| `missing` | not on PATH | off, rules only |
| `logged_out` | `claude auth status` or a call said so | off, rules only |
| `limited` | usage or rate limit | paused until `retryAt` |

- **Detection.** Programs are looked up on `PATH` (`findTool`), so a missing
  binary costs no spawn. The check runs `gh --version`, `gh auth token`,
  `claude --version` and, from claude 2.x, `claude auth status --json`
  (older versions would take `auth status` as a prompt). It reads nothing
  from GitHub. Real calls report back: the token read (ENOENT, no login),
  every GitHub response (401 is `rejected`, a 2xx clears `rejected` and
  `offline`, a thrown fetch is `offline`) and every claude failure
  (`claudeFailure` matches the CLI's wording for a missing binary, a
  missing login and usage/rate limits; unknown text stays an ordinary
  failure).
- **When it looks again.** Once on the first ask. Then only while
  something needs a fix from outside (install, login): 1 minute, doubling
  to 30. A check that finds everything fine does not reset the backoff,
  only a call that works does, because an expired token still looks fine
  to `gh auth token`. "Check again" (`POST /api/tools/check`) checks now.
  A usage limit holds until its reset time (from the CLI's
  `limit reached|<epoch>`, else 30 minutes); a check cannot see it.
- **Gates.** `WatchedTokenSource` throws `GhOffError` without running gh
  while gh is broken; `watchedFetch` reports responses; `GatedRunner`
  throws `AgentOffError` without spawning claude while the agent is off,
  and turns the first claude failure that means "tool problem" into one.
  The token is forgotten on a 401 and before each check, so a fresh
  `gh auth login` works without a restart. Logs name state changes only.
- **Without gh.** `sync` returns a report with `blockedBy` (the headline),
  no errors, and stores nothing, so the last real sync stays in the title
  bar. `pollOnce` returns `blocked` with the headline. GitHub writes fail
  with the headline.
- **Without claude.** The sync fetches and runs the rules, skips every
  agent job and sets `agentOff` once instead of an error per call (lines
  containing `AGENT_OFF_MARK` are folded out, for an agent that turns off
  mid-sync). The poll skips topic assignment, and ping decisions fall back
  to the rules like over the daily cap. Consolidation reports
  `skipped: 'agent_off'`. The work context sweep returns "skipped" without
  recording a failure. Chat, Recheck, drafts and refine fail with the
  headline.
- **PATH.** A Finder launch gets launchd's minimal PATH. Desktop main
  builds PATH without a shell (`launchToolPath`, pure part `toolSearchPath`
  in core): `toolPath` from `~/.config/postpile/config.json` first (mise or
  asdf shims, custom installs; read once at launch), then the start PATH,
  then the folders in `/etc/paths` and `/etc/paths.d/*` (what path_helper
  adds for a login shell), then `extraToolDirs`: `/opt/homebrew/bin`,
  `/usr/local/bin`, `~/.local/bin` (native Claude Code installer) and
  `~/.claude/local` (older local install). Until 2026-09-29 it ran the
  login shell (`fix-path`, `$SHELL -ilc`); that ran the user's whole zsh
  setup with PostPile as the responsible process, and macOS asked for
  permissions for whatever it touched (a 1Password socket in a group
  container, plugin managers, prompt tools). The "not found" words point at
  `toolPath`. The check looks on that same PATH, so what it finds is what
  runs.

**UI** (renderer, words from the server, placement in `lib/tools.ts`):

- gh broken, no topics yet: the middle column's empty state is the note
  ("Fix this" chip, headline, what it means, numbered fix steps with Copy,
  "Check again", when it last looked and looks again). Topics exist: the
  same note as a banner above them. Sync is disabled with the headline as
  its title, the title bar says "sync off · gh needs a fix", the start
  sync is skipped quietly.
- claude off: one line above the topics, "Rules only" chip and
  "Agent features are off: claude not found. Tiles, whose turn and
  notifications run on rules.", with "How to fix" folding out the install
  and login commands. Limited: "Paused" and the time it is tried again.
- Footer: "sync off", "rules only", "agent paused" or "GitHub unreachable"
  with the headlines as tooltip. Offline gets no note: it fixes itself.

`pnpm cli tools` prints the same status. Sample data simulates each state
with `POSTPILE_FAKE_MISSING` (comma separated: `gh`, `gh-auth`, `gh-token`,
`gh-offline`, `claude`, `claude-auth`, `claude-limit`); `gh` and `gh-auth`
read as a first run (no topics), `gh-token` keeps the topics.

Routes: `GET /api/tools`, `POST /api/tools/check`.

## Stack completion

Pulled-in PRs exist only to complete stacks, and finding them is
deterministic: no agent call. Stacks always stay together: every layer of a
chain shows, whatever its state.

- **Linking** (`sitsOn` in core, used by the walk and by `buildStacks`): B
  sits on A when B's base branch is A's head branch, or was until A merged.
  GitHub moves a stacked PR onto the next branch down when the layer below
  merges and its branch is deleted, so PR snapshots and branch lookups carry
  former base branches (`previousBaseRefs`, from `BaseRefChangedEvent` for
  a base changed by hand and `AutomaticBaseChangeSucceededEvent` for the
  move GitHub makes itself; before 2026-09-29 only the first was read, so a
  merged bottom layer fell off and the open layers above it were left as
  a chain of pulled-in PRs no tile shows). A
  merged or closed A only counts below a B opened while A was still open
  (closed PRs use their last update as the end); this keeps an old PR on a
  reused branch name out. Several PRs on one head branch: only one is the
  layer, open over merged over closed, then the newest (`oneLayerPerHead`).
  A PR from a fork (`isCrossRepository`) never links: its head branch lives
  in the fork, so a name like main or patch-1 would take a real layer's
  place or chain it to an unrelated PR. Snapshots stored before the field
  existed read as same-repo.
- **Forks in a stack**: stacks are linear. When two PRs sit on one parent,
  the open one continues the stack (open over merged over closed, then the
  lowest number) and the other starts its own chain without the parent.
  Before 2026-09-29 the lowest number won alone, so a closed attempt could
  keep the open layers that replaced it out of the stack, and those showed
  nowhere.
- **States**: open, draft, merged at any age and closed layers all count.
  There is no age limit; a stack still needs at least one open PR. A closed
  layer shows greyed in its row, pill reading "closed".
- **Walk**: every full sync seeds from the tracked (pinged or found) PRs
  fetched this sync plus every stored open tracked PR, since a new layer on
  top (often a draft) does not move the PR below it. Each seed walks its
  stack by branch: the layer below has the PR's base (or a former base) as
  its head, the layers above have its head as their base
  (`GitHubReader.findPrsByBranch`, read-only GraphQL, any state, 30 lookups
  per query, one query round per layer). At most 6 layers each way
  (`STACK_DEPTH`); forks never count; a head lookup on the repo's default
  branch ends the walk (lookups on it dedupe, so seeding every open PR costs
  about one lookup each). A walk stops at another seed (it walks its own
  stack) and goes on through a tracked PR that is no seed. Known gap: a
  merged seed cannot find a layer above that GitHub already moved off its
  branch; the open layer finds the merged one instead.
- Found layers go to `pr_pull_in` (migration 006) with the anchor PR and
  the reason "stack layer below/above #N". A layer is refetched only when
  the lookup shows its `updatedAt` moved.
- A layer gets no topic assignment, glance, dossier or event call and no
  membership. It shows through its stack tile and never makes a tile on its
  own. Once it gets its own notification it is pinged like any other PR.
- `SyncReport.prsPulledIn` counts the layers fetched. A failed lookup is an
  error line in the report; the rest of the sync goes on.

## Stacks as one unit

A PR that is a stack layer is never shown apart from its stack.

- **One topic** (`stackTopicId`, `Board.stackTopicIds`): a stack shows in
  the topic of the newest membership among its layers (the latest decision)
  whose topic is active, or in Unsorted while tracked layers wait for a
  topic. A retired topic lists no tiles, so a newer membership there must
  not hide a stack that has a layer in an active topic. With every layer in
  retired topics the stack stays with the newest one, like any other PR of
  a retired topic, and comes back when that topic is revived. Its layers stay out
  of every other topic's tiles, `Board.topicIdOf` answers the stack's topic
  for each layer, and a layer never keeps Unsorted alive on its own.
- **Topic assignment**: a waiting layer whose stack already has a topic
  joins it without an agent call (reason "joins its stack"). A retired
  stack topic becomes active again then, the same as when the agent
  assigns a PR to a retired topic. Of a stack
  without a topic only the lowest waiting layer is asked about; the other
  waiting layers follow the answer.
- **Moves**: "Wrong topic" on one layer moves (or re-sorts) every layer
  that is tracked or has a topic; an accepted split or new-topic proposal
  brings whole stacks along (`Board.movesWith`).
- **Sets**: a set can hold a stack, whole. A proposal member that is a
  stack layer brings its whole stack, in order; a proposal needs two units
  (lone PRs or whole stacks), so a set of one stack is dropped; "not
  related" on a layer takes the whole stack out, and a user rejection of any
  layer drops the whole stack from later proposals. The tile builder
  enforces the same on read: a set member that is a layer pulls in the full
  stack (placed where it first appears), a stack joins one set at most, the
  stack tile is then not shown separately, and layers of a stack shown in
  another topic are left out of this topic's sets.
- **Stack structure on tiles** (`Tile.stacks`, `TileStack`): every tile
  says which of its members form a stack, bottom first: one entry for a
  stack tile, one per stack a set holds (in the order they appear), none
  for a single. `kind` stays `single`, `stack` or `set`; a set holding a
  stack is still `set`, and the UI draws the stack inside it from
  `stacks` so it reads as a stack, not as loose set rows.
- **Stack mark** (2026-09-29, variant A; `StackMark` in `pills.tsx`,
  lookup `stackPlaces` in `lib/stacks.ts`): a PR that is a layer of a
  stack gets a small light-blue tag with the layers glyph and its position,
  "1/3" (1 = bottom, closest to the default branch), from `Tile.stacks`.
  It sits between the mono `#number` and the title on PR rows (stack tiles,
  stacks inside sets, the detail pane's member list) and in front of the
  detail pane's title. Lone PRs get nothing. Tooltip: "Layer 2 of 3 in a
  stack (built on #N)", or "(bottom of the stack)" for layer 1. 18px high,
  radius 5px, `--stack-tag` fill with a `--stack-tag-line` border and
  `--stack-tag-ink` text, mono 10.5px semibold (the bundled mono stops at
  600), 11px icon; grey on done tiles. The tile header keeps "Stack · N",
  and the detail branch line keeps `head → base · layer X of N`, now also
  for a stack inside a set. The light blue is the one accent-family use
  outside selection and focus, chosen by the user.

## Topic placement: relation and area

Every topic gets a placement, so a long topic list sorts itself by whose
work it is.

- **Relation** (`DossierRelation` in the dossier, path `relation`, with
  sources like any line): `team` (the user's team drives it), `routed`
  (another team owns it; the user or their team was pulled in for their
  angle, e.g. CODEOWNERS on `.github/workflows`), `fyi` (subscribed,
  mentioned in passing). Plus `ownerTeam` and a short `whyYou`.
  Rules first (`relationSignals` in core): the user authors or drives ->
  team; only passive threads -> fyi. A review request to the user or one
  of their teams, or a mention, is ambiguous; the dossier update decides,
  with the rule notes and the general instructions in its prompt. A rule
  decision wins over the answer.
- **Corrections**: "Wrong" on the relation carries the real value
  (`MemoryCorrection.relation`). It is stored as `relation_override:<topic>`
  (meta, with the event log seq) and wins until a new event lands in the
  topic; it is also logged as feedback for the next dossier update.
- **Area** (`topic.area`, migration 005): picked by the dossier update from
  the areas in use; at most 3 new areas per sync, past that a topic keeps
  its area. Consolidation sees areas and live tile counts; it may propose
  `area_merge` (topic_proposal with `from_area`, applied on accept) and
  splits for topics that keep more than 12 live tiles.
- **UI**: the relation no longer picks a sidebar group (since 2026-10-02,
  see "Ownership sections"): only FYI keeps its fold inside Other topics.
  The relation chip stays on the header. The topic header
  says "Owned by X · you're here because Y". Tiles: snoozed and done folded
  into one row each.

Topic assignment against fragmentation (first real sync: 61 topics for
142 PRs): the prompt shows member counts and asks hard for existing topics
first. When none fits, a new topic may hold a single PR, but it is named
after the ongoing work or area (2 to 6 words, broad enough for follow-up
PRs, e.g. "Storybook visual review", "Desktop app release"), never after
the PR's title; PRs in the same request that belong together share the new
name. No cap and no deferral (dropped 2026-09-29: the cap and the
"unsorted" answer left PRs lingering in Unsorted until a consolidation the
desktop app never ran, and deferred lone PRs never met in one request).
Small topics are consolidation's job: it proposes merging one into a bigger
topic when its PRs serve that topic's goal; size alone is no reason
(2026-10-02, "Proposals must earn their interruption"). Migration 015 deleted the old `topic_deferred:*` meta
rows.

## Actions act on what you look at

Decided 2026-09-29. Until then Mark read, Mark done and Snooze in the detail
pane acted on the whole tile, even with one PR of a set or stack selected,
while Approve acted on that PR. Nobody decided that; it fell out of the tile
being the unit of state and the detail pane taking the tile's primary
button. Julian pressed "Mark done" on one PR of a set in the detail pane and the
whole eight-PR set went done: "this is honestly confusing. Why are these
buttons, then, in the detail pane? I mean, approving also approves the PR
and not the topic."

**Rule: the detail pane acts on the selected PR, the tile footer on the
tile.**

- Detail pane: Approve, Mark read and Mark done apply to the selected PR
  only: its events seen, it is handled (`handledAt`), its GitHub thread is
  marked read, undo brings back that PR only. The label follows the same
  rule as today but per PR: "Mark done" when that PR is done after a
  mark-read, else "Mark read"; no mark button while that PR is still your
  move. Snooze shows in the detail pane only on a single-PR tile (there the
  tile and the PR are the same); on a set or stack it lives in the tile
  footer.
- Tile footer: unchanged, the whole tile (every member read, handled, all
  threads marked read; Snooze for the tile).
- A tile is done when every tracked member is done (`isPrDone`), which was
  already the rule underneath; pulled-in stack layers don't count, as before.
- Single-PR tiles behave exactly as before.

**The dot marks what keeps the tile** (replaces "The new dot" rule of the
same day). Julian on that set: "What is not done there now? I'm still
missing the dot", and on a second, read-only dot: "I would just fold it into
the main ... there doesn't need to be a distinction". One coral dot before
every tracked PR that keeps the tile from being done (`isPrDone` false), on
unread and open tiles alike, in the tile's rows and the detail pane's PR
list (aria-label "Not done yet"; since 2026-09-30 this is the unread dot, see
"The unread dot" below). No dots on done or snoozed tiles. Not on
single-PR tiles either (a tile with one tracked PR, decided the same day):
the dot says which PR of a stack or set holds the tile; on one PR it would
only repeat the tile's own state. A pulled-in stack layer with unseen loud
news gets one too (2026-09-30, see "Decided from the property tests"). The
dots and the detail-pane buttons work together: mark a dotted PR done and its
dot goes; no dots left, the tile is done. The tile's own unread styling (strip,
bold title) stays as decided on 28 Sept.

**Opening a PR in PostPile also marks it done there** (changes part 3 of
"You already dealt with it"). The open marks the PR read on GitHub only when
nothing is asked of the viewer, so leaving it undone in PostPile was
inconsistent: one PR of that set was read on GitHub, asked nothing, and still held the
tile open. Julian: "why would marking it read on GitHub not also mark it
[done] on PostPile, given all the conditions that we agreed upon". Now the
open handles that PR too (`handledAt`), under the same conditions, checked
per PR: that PR done after a mark-read, its tile not snoozed, writes
unlocked. A visit on github.com keeps the old behaviour (events seen, no
`handledAt`), since PostPile can't check the conditions at the moment of
the visit.

**A click shows its result right away** (2026-09-30). Approve, Mark read /
Mark done and Snooze showed nothing for seconds: approve waited for the
GitHub write plus a poll cycle refetching the PR, and every action waited
for a refetch of all queries before the screen changed. Now:

- The renderer changes its cache on click (`lib/optimistic.ts`): a marked
  tile takes its `afterRead` (done or open, whose move), its rows their own
  `afterRead`; a per-PR mark changes only that row (the tile state is the
  server's call); a snoozed tile shows snoozed; an approved PR's button reads
  "Approved". Nothing is re-derived: where the shipped fields don't say
  enough, the button only shows its pending state until the refetch.
- The button stays busy until the refetch lands, so it never offers the old
  action again in between. A failed action puts the old cache back and shows
  the error toast. The toast and Undo come as soon as the server answers.
- Locked, a mark-read changes nothing early (it only becomes a pending
  write), and a blocked approve changes nothing at all.
- The server answers approve right after the write and the local mark-read;
  the PR refetch runs after it and reaches the renderer through the live
  status (`changeCount`). The head check and the writes lock still come
  before the write.

**The verdict pill follows the footer.** A multi-PR tile showed the lead
PR's verdict ("Not yours" from the first PR) while the footer talked about
another one. The lead PR (core `leadPrKey`, shipped as
`TileView.offers.leadPrKey`) now prefers the PR of the tile's turn when
the turn is not `none`, then the newest unread reason, then the first open
tracked PR.
Since 2026-10-01 the pill shows the tile's worst glance instead of the
lead PR's (see "Tile header" › "The verdict pill shows the tile's worst
glance").

**Whose turn names the re-reviewer.** "rowan to address ada's
changes" stayed after rowan pushed and re-requested ada's
review. When the author pushed after a changes request and the requester is
requested again, it is the requester's move: "ada to re-review"
(whose-turn rule 4).

**Own merged PRs clear on GitHub too** (changed rule 2 of "Handled quietly"
and part 2 of "You already dealt with it"). The own-PR exception (bots after
your last touch keep the thread unread, since on your own PR they can mean
work) first applied only while the PR was open. Every own PR merges through
trunk after the last comment, so 14 merged own PRs stayed unread after 0.10.0.
Julian: "my own merged or closed PRs can be cleared when only bots come in
after my last touch." Since 2026-10-01 the exception is gone for open PRs too
(see rule 2 of "Handled quietly").

**Not marked read from a guess** (decided the same day, recorded to stop the
question coming back). PostPile marks a thread read on GitHub only from what
the viewer did: acted after everything unread, opened the PR in PostPile
with nothing asked, marked it read or done, or only bots since they read it.
It never marks read because it guessed the viewer isn't interested, not even
for finished PRs whose review went to the team and was handled by a
teammate, and not for mentions it can no longer find. Proposed and turned
down: "extend Handled quietly to finished PRs with only quiet activity",
and an inbox-cleanup entry "finished team requests handled by someone else".
Julian: "routing to the team devex means I potentially could be interested
in that, so at which point do we know I am not?" The GitHub count stays
higher than what PostPile shows as yours; the gap is mostly finished team
requests, and that is intended.

**Remove a team review request** (decided 2026-09-29). A routed team
request stayed in To review after the user marked it read (a stack by
someone outside the team, review routed to team-devex, no teammate
reviewed). Moving read routed requests down automatically was proposed and
not taken; instead the user asked for a PR button: "an unassign team button
... also trigger the unsubscribe on the PR. The button would do both."

- Detail pane only, shown when the selected PR has a pending review request
  for one of the viewer's teams (`Viewer` teams / reviewerTeams). Label
  "Remove <team slug>" (e.g. "Remove team-devex"); several teams pending =
  one button per team, or a small menu; pick the boring option.
- Confirm once (small popover, one sentence): "Remove the review request
  for all of <team> and unsubscribe you?" No undo: re-adding the team would
  notify every teammate again.
- On confirm, in order: (1) GitHub `DELETE
  /repos/{owner}/{repo}/pulls/{n}/requested_reviewers` with `{reviewers: [],
  team_reviewers: ["<slug>"]}`; (2) `DELETE
  /notifications/threads/{thread_id}/subscription` for the PR's thread
  (mutes further notifications until the viewer comments or is @mentioned;
  mentions and direct requests still arrive); (3) the per-PR mark done in
  PostPile (events seen, handledAt, thread marked read). If (1) fails, stop
  and show the error; if (2) fails after (1) succeeded, still do (3) and say
  the unsubscribe failed. No thread known = skip (2) and say so.
- Goes through the writes lock (`WriteSwitch` / `GitHubWrites`) like
  Approve: blocked with the reason while writes are locked, never queued as
  a pending write. Action log entries `remove_team_request` and
  `unsubscribe` (origin detail pane), telemetry event through the catalogue
  allowlist (no PR keys, team slug not sent either, just the action).
- PostPile side: after a sync the removed request is gone from
  reviewerTeams, so the PR is no longer "your move"; until then the
  handledAt keeps the tile done. It comes back like any tile when something
  loud is aimed at the viewer again (a new request, a mention, a question).
- GitHubWriter gets the two new methods; FakeEngine/fake GitHub handles
  them in memory; tests for the engine flow (success, request removal
  fails, unsubscribe fails, locked) and the renderer visibility rule.

**Marked when you move on** (decided 2026-09-29, after the build above;
superseded 2026-10-01 by "Marked when the dwell ends" below: the mark now
fires when the dwell ends, the held place stays).
Julian, clicking through PostPile: "when clicking through much stuff in
PostPile, now auto-mark status read, which is a bit jarring because the
status changes while I look at it ... It almost feels like the agent
updates it while I'm looking at it."

- The opened-in-PostPile mark (GitHub read + PR handled) no longer fires
  after 1.5s while the PR is still selected. The 1.5s visible dwell stays
  as the proof the user looked; it only arms the open. The mark fires when
  the user moves on: another PR or tile selected, the detail pane closed,
  or the window hidden or blurred (leaving the app counts as moving on).
  Clicking quickly through PRs (under 1.5s visible) still marks nothing.
  Once per open.
- While a tile is selected it keeps its place: no re-sort and no section
  move (Done or Snoozed fold, a sidebar section) for the selected tile and
  the topic row it sits in until the selection moves, even when its state
  changed (the user's own detail-pane mark, the opened mark, a sync). Only
  the selected item is held; everything else sorts as usual.
- The user's own button presses still change the tile's look right away
  (that is the feedback they asked for); only the position is held.

**Unseen dots and a visible auto-mark** (decided 2026-09-30, detail pane).

- Each line of the activity list wears the coral unread dot when the
  event's own seen state is unseen (core `eventView` sets
  `EventView.unseen`, `ActivityLine.unseen` is any of a burst's events;
  muted counts as seen, like the merge rule). The renderer only draws it.
  Before, only loud lines had one.
- When the tile is unread only because GitHub changed the notification and
  no event explains it (the "new activity on GitHub" thread reason, core
  `threadChangedAt`, shipped as `ActivityList.threadChangedAt`), one dotted
  line sits at the top: "GitHub changed the notification at <time>, nothing
  PostPile can show".
- The mark button says "Done for now" (was "Mark done"; "Mark read" stays).
  The action is still `mark_done`; only the label changed.
- Superseded 2026-10-01 ("Marked when the dwell ends" below): the fill
  stays, "Marks read when you leave" and "Keep unread" are gone.
  The opened-in-PostPile mark shows itself: while the 1.5s dwell runs the
  button fills left to right (a CSS width transition over
  `OPENED_READ_DELAY_MS`); when full it reads "Marks read when you leave"
  (or "Marks done when you leave", matching the label) with a check, and a
  small round X ("Keep unread") next to it cancels the automatic mark for
  that open (`OpenedReadTimer.cancel()`, phases in `OpenedReadPhase`).
  After cancel the fill is gone and the normal button is back. When the mark
  happens is unchanged.
- Mark-read queue scenarios (`engine/src/mark-read-scenarios.test.ts`):
  click, undo window, poll and sync seeing news, undo, a guarded skip and its
  retry, and a read elsewhere, interleaved. They found no bug: the stored
  thread is never unread mid-retry, an undo leaves a row GitHub has moved on,
  and a stale undo token cannot touch a later click.

**Marked when the dwell ends** (decided 2026-10-01, supersedes "Marked
when you move on" and the "Marks read when you leave" part of "Unseen dots
and a visible auto-mark"). Julian, after living with the deferred mark: "it
bothers me more that it doesn't act than the reshuffle would". The deferred
mark read as a promise that sometimes did not fire, and nothing visible
happened when it did. Chosen from a clickable mockup:

- The opened mark fires when the 1.5s fill completes, while the PR is still
  on screen, with the same guards as before (`PrSummary.openedRead`,
  `opensMarkRead`, the server's `openedReadCheck`, writes unlocked).
  Clicking through faster than the dwell still marks nothing. Once per
  open. The dwell still needs the window visible and focused (hidden during
  it, it starts over); after it, hiding or leaving the window changes
  nothing.
- The button then reads "✓ Marked read" (or "✓ Done for now", matching the
  label) in soft green, with an Undo link next to it while the undo window
  is open. It replaces the "Keep unread" X, and "Marks read when you leave"
  is gone. The note stays after the PR turned done, when core offers no
  mark button any more.
- Undo uses the mark-read queue like every clicked mark-read. The opened
  mark used to be a quiet, immediate GitHub write; GitHub has no
  mark-unread, so an Undo needs the write deferred. It is now its own batch
  (origin `detail`, read cause `opened`) with an undo token and the
  queue's own expiry (`OpenedReadResult.undoToken`, `undoUntil`; the
  button hides Undo at that time, not a fresh 6s from the answer, Codex
  review on PR #75): the PR is seen and handled here right
  away, the thread goes to GitHub after `UNDO_WINDOW_MS`. Undo inside the
  window puts it all back and nothing reaches GitHub; the open does not arm
  again. Side effects: the opened mark no longer shows under Handled
  quietly (it is visible now; older rows still read "opened in PostPile"),
  and a lock closed inside the window parks it as a pending write, like any
  mark-read.
- The coral dot on the PR row and on the topic row fades and shrinks out
  over 500ms instead of vanishing (superseded 2026-10-06 by the ripple
  exit below).
- **The dot counts down, and every read ripples it out** (2026-10-06,
  owner, from two mockup boards). The dwell only showed in the pane's mark
  button, far from the tile. Now, while the PR in the pane waits out the
  dwell, its unread dot in the tile row is a pie that drains linearly over
  the 1.5s (same 6px dot and halo, the drained part a faint coral track);
  cancelled before the end, the dot is full again at once. Once marked it
  stays empty until it leaves. Other rows, the pane's PR list and the
  topic dot do not count down. When any unread dot goes (the dwell, Mark
  read, the tile menu, read on github.com) it shrinks to nothing over
  275ms while a thin coral ring ripples out from it and fades over 500ms,
  so a dwell read ends like every other read. Reduced motion: no
  countdown, no ripple, the dot goes at once. The pane's button fill stays.
  Built as `dotCountdown` (`lib/opened-read.ts`), `UnreadDot` `countdown`
  and `.unread-pie` / `animate-unread-ripple` in `app.css`. The open's
  phase is tied to its PR, so the next PR's dot starts full even right
  after the previous one was marked. A row that remounts on read (its tile
  changed group) still ripples: `RecentDots` remembers dots shown within
  the last second by key. A row that leaves the screen entirely (into the
  folded Dealt with group) has nothing to ripple.
- The held place does not change: the selected tile and its topic row keep
  their place until the selection moves ("only once I move"). Then the move
  animates (FLIP, `useFlip`): every tile, group heading and topic row that
  moved slides from its old place over 420ms (`cubic-bezier(.2,.7,.2,1)`),
  and a tile that changed group gets a soft `--accent-soft` tint that fades
  out over 1.1s. Moves a sync causes (a tile changing group while not
  selected, topic rows re-sorting) slide the same way. Only a change of
  order or group slides; new text or a resize does not. With reduced motion
  there is no slide and no tint.
- **The settle after the read** (2026-10-07, owner, from a recording of a
  topic whose only news was a merge and a playable mock). The dwell stays
  exactly as it is, merged-only news included. What follows used to land in
  one frame (card in, strip out, title grey, footer swapped, an ink "Open on
  GitHub", dots gone), 40ms after the pane flipped, and the tile jumped. Now
  it runs as one short sequence from the read landing (`useSettling`, only
  when the read lands while the tile is on screen, never on first render or
  on opening a topic that is read already; the same for a Mark read click or
  the tile menu on the held tile):
  - 0ms: the pane flips to "✓ Marked read"; every coral mark of the PR
    leaves together with the ripple (tile row dot, topic dot, the group
    heading's dot, the Activity line's dot), the sidebar's unread bubble
    shrinks out with its dot, the NEW pill fades (160ms).
  - +90ms: the news strip folds up (`Fold`, 280ms) while the title eases to
    its read colour (320ms).
  - +160ms: the heading's word changes in place (`headingGroup` in
    `lib/queues.ts`): "Unread" becomes "Dealt with" with a grey check, once
    no tile under it is still unread. The tile keeps its held place; moving
    the selection regroups as before.
  - +240ms: the footer crossfades Mark read · Snooze to Open (`Crossfade`).
  - +320ms: the topic's action row gives way and the Archive box grows into
    its place (320ms); the strip folding at the same time keeps the tile
    close to where it was.
  - +640ms: "Archive now" rises 6px into place; at +960ms one soft sheen
    passes over it, once.
  - Leaving the topic, its sidebar row eases to its quiet grey over 320ms
    instead of snapping.
  Reduced motion: everything lands at once. Plain CSS transitions and
  keyframes in `app.css` (`word-*`, `footer-*`, `archive-*`, `bubble-out`).

**Built as** (2026-09-29):

- Per-PR answers ship on the tile rows, since the renderer imports no
  runtime code from core: `PrSummary.done` (`isPrDone`), `.turn`
  (`prWhoseTurn`), `.afterRead` (core `prAfterMarkRead`: that PR's events
  seen, handled when tracked; never done for a pulled-in layer) and
  `.ownTeamRequests`.
- Detail pane: core `paneOffers` (`core/offers.ts`, shipped as
  `TileView.offers.pane` by PR key; was `detailPrimary` and friends in the
  renderer's `lib/mark-read.ts` until the rules-layer batch); the mark goes to
  `EngineService.markPrRead` (origin `detail`, own batch and undo, handled
  unless pulled in). A mark-read of an unread PR that leaves it your move
  says so in the toast, without the tile Snooze offer.
- The dot: `unreadPrKeysOf` in core `tile-view.ts`, shipped as
  `TileView.unreadPrKeys` (2026-09-30: was `notDonePrKeys`, see "The unread
  dot"), `UnreadDot` in `pills.tsx`.
  A done PR that still has unseen news or a thread unread on GitHub keeps
  the tile from being done, so it keeps its dot until it is read.
- Lead PR: core `leadPrKey`; the renderer's `leadPr` only looks up that row.
- Marked when the dwell ends (2026-10-01; was "Marked when you move on"):
  `OpenedReadTimer` in the renderer's `lib/opened-read.ts` (the dwell end
  fires, `setWanted` keeps `opensMarkRead` current, `undo()` hands back
  the token inside the window, phases in `OpenedReadPhase`) driven by
  `useOpenedRead` (a new open when the PR changes, `visibilitychange` and
  window `blur` / `focus` pause the dwell only); `OpenedMarkNote` in
  `MarkButton.tsx`; the slide is `useFlip` (`lib/use-flip.ts`, pure part
  `lib/flip.ts`) on `TileGrid` and `TopicSidebar`. The held place is `holdPlace` in
  `lib/hold-place.ts` with `useHeldPlace` (the place taken when the
  selection starts): `TileGrid` holds the selected tile across its Unread,
  Open and Dealt with groups,
  `TopicSidebar` holds the open topic's row across the queue sections and
  Other topics (`layoutBuckets` / `layoutFromBuckets` in `lib/queues.ts`)
  while its selected tile stays selected.
- Opened in PostPile: core `openedReadCheck` (per PR), engine
  `OpenedReads.markOpened` (was `QuietReads.markOpened` until 2026-10-01),
  renderer `opensMarkRead`; see "You already dealt
  with it" part 3. When GitHub has the thread read already, only the
  PostPile side runs (PR handled, a local log row).
- Re-reviewer: core `reReviewAsked` (`changes-answered.ts`), used by
  whose turn on the routed team hold, on a team request a teammate picked
  up with a change request, and on the viewer's own PR.
- Own PRs: no exception in core `quiet-reads.ts` any more (2026-10-01,
  `isOwnOpenPr` and `isAutomationFinding` removed); `botOnlySinceRead` leaves
  the viewer's own events out.
- Remove a team review request: `PrActions.removeTeamRequest` (engine),
  `GitHubWriter.removeTeamReviewRequest` / `unsubscribeThread`, `POST
  /api/prs/:owner/:repo/:number/remove-team-request` `{team}`, renderer
  `RemoveTeamButton` (one per team, `removeTeamButtons` in
  `lib/team-request.ts`), `removeTeam` on the `GithubWrite` list. After the
  refresh, a stored snapshot that still lists the team drops it (fetch time
  kept), so the handled PR is done until the next sync. Telemetry
  `team_request_removed`, no props. The answer carries no undo token but a
  `settleToken` (Codex review on PR #15): the renderer watches the
  mark-read like an undo window and refetches when it settled, so a
  mark-read GitHub did not take (or one parked as pending when the lock
  closed in the window) shows the PR as not done again.
- Pending writes per PR: `PrSummary.pendingWrite`. The detail pane's mark
  button on a stack or set waits only on the selected PR's own pending
  write (`detailPendingWrite`), not the tile's, so a locked mark-read of
  one PR does not block its neighbours (Codex review on PR #15).

## The PR pane (2026-10-05)

Decided 2026-10-05 from a design round on a canvas (use cases, today
annotated, proposed pane, writing states, agent pane). The old pane had
one wrapping bar under the glance with up to nine controls for four
audiences (formal review, public comment, private agent, housekeeping),
a lead that jumped to the front per PR, one speech-bubble icon for both
"approve with comment" and the agent chat, three writes sharing one
popover, a two-step Ask, no way to answer a person's comment, and a tile
chat that replaced the whole PR. Telemetry over 30 days: opening on
GitHub and approving are the real jobs in the pane; explicit mark-read
happens almost only from the tile footer (the pane's count includes the
automatic mark on open); Ask and the chat were barely used.

**Use cases** of the pane, by who hears it: go deeper on GitHub (leaves the
app), give a review verdict (approve, approve with a note, comment review:
public, formal), reply to a person (public, on that comment), ask the
author something new (public), acknowledge a reply with a thumbs up
(public, no text), talk to the agent (private: moved out, see below) and
housekeeping (mark read or done, snooze, remove team: no message). Out of
scope here: request changes, merge, re-request a reviewer, resolve a
thread, reading the diff.

**Rules** (each grounded in an established principle):

1. Act where you read: review buttons sit with the PR's review state, a
   reply on the comment it answers (Gestalt proximity, recognition over
   recall).
2. One surface, one audience: the PR pane talks to GitHub, the agent talks
   to you about a topic; they never share a button, an icon or a box
   (Norman's mode errors).
3. Fixed spots: every action keeps its place in the order on every PR;
   whose move it is shows through emphasis (the fill), never by reordering
   (spatial memory, consistency).
4. Prominence follows use, and the pointer: Open and Approve sit where the
   pointer already is, close to the tile just clicked; housekeeping is
   quiet (Fitts's and Hick's laws, progressive disclosure).
5. Say where it goes: every write names its target on the button ("Post
   reply to alice"); nothing posts without that press (error prevention).
6. One way to write: reply, new comment, approve with a note and comment
   review use the same composer, opened in place, one at a time; the agent
   can draft, as a link, not a step (no modes).
7. Leave depth to GitHub: code, diffs and long threads are one click away
   (Jakob's law, Tesler's law).
8. The agent advises, it holds no controls: a glance can be missing, out of
   date or wrong and changes its look by verdict, so the user's actions
   never live inside it and the layout never depends on it (Guidelines for
   Human-AI Interaction G2, G8, G9; graceful degradation).

**Layout, top down:**

- Header band (`DetailContext`): kind, and for a stack or set the title,
  counter, arrows and the PR picker, as before. Nothing else: housekeeping
  there collided with the picker and was the longest pointer path from the
  tile (tried and dropped the same day).
- State line: state, review word, repo#number and "Open on GitHub" with an
  arrow menu (Files changed, Commits, Checks): the pane's only link to
  the PR itself on github.com (activity ages link to their single event,
  see "Permalinks" below), its right edge on the boxes' edge (22px), not the 34px text
  line. Ink when core's lead is Open (own PR, done PR), else outlined.
- Title, branch line, then "New since you looked": a digest you read. A
  person's comment that can take a reply gets "Reply ↓", which scrolls the
  pane to that comment in the activity list, tints it for a moment and
  opens the reply there with the thread around it. Rejected: a composer
  inside the digest (no context, bloats the box, two homes for Reply).
- The glance (`GlanceCard`), on its own. Its title line carries only its
  own controls: Recheck and "Tell the agent" (opens the topic's agent pane
  with "About #1907: " typed in).
- The review row (`ReviewRow`), right after the glance, outside it: a label
  with the review state from GitHub (`reviewRowLabel` over core's
  `viewerReviewStand` on `PrDetail.viewerReview`: "You approved 2h
  ago, commits since", "You requested changes", "Review requested from
  you", "... from team-devex", "Your PR", "Your review"), then Approve with
  its "+ note" half, Comment review, and "Ask <owner>" on the right. Same
  order on every PR; Approve fills green when it is core's lead, else
  outlined. Shown when core offers Approve or Ask. Rejected 2026-10-05:
  welding the buttons into the glance's footer (the glance is agent output
  and may be missing or change its look), and a row in the PR header above
  the glance (longer pointer path from the tile, buttons before the
  reasons). Its place follows the glance's height; its order never changes.
- The housekeeping line (`PaneHousekeeping`) right under it: Mark read /
  Done for now, Snooze (single-PR tiles only) and ⋯ with "Remove <team>"
  (its one-sentence confirm inside the menu), in the quiet look (text until
  hovered). Close to the tile like the review buttons, apart from them by
  look. When core's lead is the mark or Snooze (nothing else to do), that
  one is outlined. The opened mark's note ("✓ Marked read · Undo") takes
  the mark button's place, as before. With no review row (own PR, done PR)
  the line sits after the glance alone.
- Description, facts, reviews (`ReviewList`: who reviewed, newest verdict
  each, without the empty reviews GitHub makes for thread replies), what
  the agent knows, then the activity
  (`ActivityTimeline`, label "Activity"): every line, new first, then
  earlier. A person's comment or review gets Reply (a button when it asks
  you, else a quiet link; "Reply in thread" on a code comment) and "Thumbs
  up" (a 👍 reaction on GitHub, said in its tooltip; "You: thumbs up" in a
  pressed pill once given; "React" alone did not say what it posts). An
  approval without text only takes the thumbs up. Nothing for the viewer's own words, bots or pushes.
  Core puts it on the line (`ActivityLine.reply`, filled by `activityList`
  with the PR and the viewer); a comment on several lines (its event and an
  edit, a review and a mention in it) gets it once, on the newest line. The
  renderer only reads it: workspace imports there stay type-only.
- Permalinks (2026-10-06). Every activity row's age ("5h") links to the
  event on github.com, GitHub's own convention: its timestamps are the
  permalinks. Quiet: the same faint mono text, underlined and `text-ink-2`
  on hover, the full local time in the tooltip ("Open on GitHub · Tue 6
  Oct, 21:21"); the unread dot stays outside the link. A line links to its
  newest event (a push burst to the last commit, a fold to its newest
  reply or comment). Where the link comes from (`PrEvent.url`, set by
  `deriveEvents`): a comment or review body its own `url`; a review its
  `Review.url` (fetched since 0.25.0, column `pr_review.url`, migration
  036), else its body comment's, else none; a push
  `<pr url>/commits/<oid>`; timeline items (requests, merges, closes,
  force pushes, the merge queue) have none, GitHub gives them no
  anchor the reader fetches, and their age stays plain text. Opening goes
  through the window's link handler like every other GitHub link (the
  browser, never the app window).
- Thread context and replies to bots (2026-10-06, `bot-threads.ts`). A
  comment in a review thread says whom it answers and where: "alice
  replied to bob on src/x.ts" (the last other person before it, or the
  opener when only bots spoke), in the event summary too, so tiles, MCP and
  the agent read the same words. A review bot (greptile, coderabbit) opens
  inline threads and the author answers each ("fixed"); each answer showed
  as "alice commented" plus "alice reviewed" (GitHub wraps every thread
  reply in an empty COMMENTED review of its own), which read as new human
  discussion. Rule: a person's reply in a thread where everyone else who
  spoke before it is a bot (`isMachineComment`) is a bot conversation
  (`isBotThreadReply`). Judged at the reply, from what came before it: a
  person who joins later starts normal lines and nothing earlier turns
  loud after the fact. Asks keep their own kinds and lines: a reply there
  that mentions you, asks you or answers you is never folded. Then:
  - Activity: the replies of one person in one bot thread, their edits and
    the empty reviews GitHub made for them fold into one quiet line,
    "alice replied to greptile-apps[bot] · 2 replies on src/x.ts"
    (`ActivityLine.folded`, `thread`), placed at its newest reply. A
    chevron in the badge spot, muted words, the file in mono, no unread
    dot, never in "New since you looked", no Reply (the thread is on
    GitHub); the whole line opens to the bodies. Picked on the fake board
    over a rail row with a "Show 2 replies" link (two lines per thread)
    and a bare dotted link (no hint that it opens). An agent-raised reply
    keeps a line of its own. The empty review of an ask joins the ask's
    line instead of a second "reviewed" line.
  - Loudness: quiet by rule ("replied to a bot in a review thread", row
    before "addressed your changes" and the "comment / review on your PR"
    rows); its empty review is quiet as a carrier (below). So no coral, no ping, no snooze break
    from it; the author's push still answers your changes request.
  - Headline: ranks with other people's events (class 4), below a person's
    comment, so it never leads a tile over real talk.
  - "Someone replies" snoozes: a reply to a bot does not end them.
  - GitHub read state is untouched: an unread thread stays unread, and the
    tile names the reply as its quiet reason when nothing else is new.
- Empty reviews that carry thread replies (2026-10-06,
  `carrier-reviews.ts`). GitHub wraps every thread reply in a review of
  its own: COMMENTED, no body, the same second. Such a review whose every
  inline comment answers in an existing thread is a carrier
  (`isCarrierReview`), in any thread, people's too. It never shows as its
  own "alice reviewed" line: in the activity it joins its reply's line
  (a bot-thread fold, the ask's or the comment's line), and when the reply
  has no line (muted) it goes to the noise; one the agent raised to loud
  keeps a line. The Reviews list leaves it out (`prPaneView`, so MCP
  `pr_context` too): "lyra commented" next to a reply is gone. Loudness:
  quiet by rule ("only carries replies in review threads", row before
  "addressed your changes" and "review on your PR"), so it is never a
  review on your PR, never pings and never answers a changes request; its
  reply carries the news. Headline: class 4, below the reply. Real reviews
  stay: an approval, a changes request, a review with text, and one whose
  comments start new threads (a single comment opening a thread too).
  Matched by the comment's review id (`Comment.reviewId`); comments
  without one (stored before 0.22.0, until refetched) fall back to author
  and time (same second, 2 s window), and a comment that names a review
  never matches another one by time.
- Review bodies (2026-10-06, `deriveEvents`). GitHub keeps a review's
  text twice: on the review and as a comment of kind review with the
  review's id. The review event already says it ("alice approved: Looks
  good"), so the body gets an event of its own only when it asks the
  viewer something (a mention, a question, a reply, a team mention). The
  viewer's own body used to skip that check and showed a second
  "viewer commented" line under their approval. Now it never gets one,
  except for a dismissed review: that has no review event, so its body
  stays a comment and a touch. An approval with text still counts as
  talking for the live conversation ping (`isLiveConversation`); an
  approval alone does not.
- A bot's review, folded (2026-10-06, `bot-reviews.ts`). A review bot
  submits one COMMENTED review with an inline comment per finding, each
  opening its own thread; that read as seven bot events in the noise. Now
  one quiet line, "greptile-apps[bot] reviewed · 6 inline comments"
  (`ActivityLine.fold` `bot_review`, fold key `bot-review:<reviewId>`),
  placed at its newest event, holding the review, its text, its inline
  comments and their edits. The whole line opens to each comment's file
  in mono and its first line. Like other bot events: no unread dot, never
  in "New since you looked", no Reply. Matched by review id only, so older
  snapshots fold once refetched. Exceptions keep the normal lines (the
  noise): a bot's approval or changes request, a review whose text or a
  comment mentions you, one whose comments answer in existing threads, a
  deleted account's, and events the agent raised or muted. People's
  answers in those threads fold per thread as above.
- "Back to top" floats at the pane's bottom while the review row has
  scrolled out above.

**One composer** (`Composer`, state per PR in `PrBody`): no frame of its own (a label, the app's plain text field, the buttons, like Teach future assessments; an accent frame with a halo read as too bordery, 2026-10-05); opens in place
under what it answers (the review row or the comment), one at a time;
drafts stay per target until sent or cancelled. A header says where it
goes ("Reply to alice · new PR comment, quotes their line", "Reply in
thread · on ci.yml", "Approve with a note · on a1b2c3d, cannot be undone",
"Comment review · on a1b2c3d, does not approve", "Ask alice · new PR
comment"); one text box with the agent's pill where the text starts (the
first thing to click; the text starts under it): "✨ Draft with agent" on
an empty box (from the PR and its topic), "✨ Rewrite with agent" once
there is text (from the user's words; replaces the old person field, gist
field and Draft step); Cancel; and a button that names the target ("Post reply to alice",
"Approve with note" in green, every other post in ink). Escape closes it and keeps the draft.
The two review notes (Approve with a note, Comment review) start drafting
as they open (2026-10-06, `draftsOnOpen`): the box shows "Drafting…" and
the agent's text lands in it, editable, before anything can be sent.
Hand-written notes were rare (2 of 21 approvals in two weeks carried a
PostPile note), so the click that opens the composer is the ask. It only
fires into an empty box, once per opening: a kept draft (the user's text
or an earlier agent draft) is never replaced, and Cancel or Escape still
drops a draft that comes back late. Not while the write is blocked (lock
closed or not loaded yet): a note that cannot be sent is not worth an
agent call. Not when the tools status says the agent is off (`agentOn`
false: claude missing, logged out or at its limit). Nobody clicked for it,
so a failed draft on open stays quiet: no toast, the box is just empty
with its placeholder; a clicked "Draft with agent" still shows the error.
Ask and replies stay manual ("✨ Draft with agent").

**Ask the agent** (`AgentPane`): the agent chat's scope is the topic, and
it takes over the right pane. Entry: "Ask the agent" in the topic header,
and "Tell the agent" from the glance or a memory line's recheck (with the
PR or line typed in). Private and it looks it: a grey band with a lock
("Agent · <topic>", "Only you see this. Nothing here goes to GitHub.")
instead of the blue PR band, no Approve or Post buttons. "‹ Back to #1907"
returns to the PR; any pick (tile, PR, topic) does too. A lasting point is
one line: "Remember "..."? For this topic · For all topics"; leaving it
alone means just this once (nothing logged). All topics still shows the
instructions diff first. The tile chat is gone from the renderer. The
point waiting for a pick, the instructions diff waiting for Accept or
Reject and the unsent text (also a message whose turn failed) are kept per
topic while the app runs, so leaving the pane (also while the answer is
still coming) and coming back shows them again. A new turn replaces the
point and the diff only once it is in.

Sending: the message shows right away as the user's bubble with a
"Thinking…" bubble under it, and the input empties; the list keeps the
newest message in view. A failed call removes both and puts the text back
in the input (the toast says why). The input is a textarea that grows to
about eight lines: Enter sends, Shift+Enter starts a new line, as in most
chats.

**What the pane loads** (2026-10-05). `PrDetail.pr` is core's slim
`PrPaneView` (`prPaneView` in `pr-pane.ts`), not the stored `Pr`: header
fields, the description whole, the files with their counts (key files read
them), reviews as author, state and time (no text), the last commit's time
and nothing about checks (CI is not tracked since 0.21.0). No comments,
threads, commits or timeline: the
activity list, its bodies and its reply and react targets come built on
`PrDetail.activity`, made from the stored PR before the view. The biggest
open PR on a real copy went from 1.18 MB to 389 KB per open (its `pr` part
814 KB to 21 KB); the average from 171 KB to 72 KB. TanStack keeps each
opened detail for 5 minutes, so the renderer holds less too. The view's
shape does not follow storage: the coming PR normalization feeds the same
`prPaneView`. MCP `pr_context` and the CLI read the same view; every field
they print is in it. A new pane field goes into `PrPaneView` first.

Then the events (same day). `PrDetail` had every event twice: raw in
`events`, which no screen read (142 KB on the biggest PR), and again in
`activity`, where each line also carried its events whole and each folded
bot/CI row was a full `EventView` with url, source id, rule loudness and
seen time. Now `events` is gone; the CLI's `pr` command, its one reader,
has its own `listPrEvents` (not on the HTTP API). Every item of `activity`
is an `ActivityEvent`, what a row draws: id (key, Unmute), kind, actor,
summary, time, display, unseen and the reason for the hover title (the
agent's override reason before the rule's), and since 2026-10-06 the
event's permalink (`url`, the row's age links to it; about 80 bytes a
row); a line adds its body, isNew,
`eventCount` (a push burst's "3 events") and its reply target. Nothing the
pane shows was cut: every line, every body whole and every folded row is
still sent, since "Show all N" and the noise fold expand on the client.
Biggest open PR 389 KB to 158 KB per open (activity 217 to 127 KB), the
average 72 KB to 28 KB. What is left on a busy PR is mostly the folded
bot/CI rows (50 KB for 172 of them on the biggest) and human comment
bodies; loading the fold on demand would be the next step, if it matters.

## PR ownership: bot PRs belong to their assignees (2026-09-30)

Coding agents open PRs through a GitHub App on someone's behalf: the author
is the bot (GraphQL `__typename: Bot`, read as `name[bot]`), and the person
the PR is for is its assignee. Looking only at the author, such a PR never
became "Your PR", never landed in My PRs, and a teammate's agent PR never
counted as a teammate's.

- **The rule** (`prOwners` in `pr-owners.ts`): a PR's owners are its author,
  except when the author is a bot (`isBotAuthor`: `isBot`, but a deleted
  author '' is a person) and the PR has assignees; then
  the owners are the assignees. A person's PR does not become the viewer's
  because the viewer is assigned, and a bot PR without assignees stays the
  bot's (automation, as before). `isPrOwner(pr, login)` and `prOwner(pr)`
  (the first owner, for sentences) sit next to it; `ownedByTeammate` in
  `review-request.ts` and `ownerRelation` in `topic-queues.ts` build on it.
- **Where it counts**: every "the viewer wrote this PR" or "a teammate wrote
  this PR" decision reads owners: tiers (mine, team), whose turn (own PR vs
  someone else's; "lyra to merge", "Review for team-platform: lyra's PR" name
  the owner, not the bot), for whom ("Your PR"), the Mine / Team filters and
  counts (`PrSummary.authorRelation` is the owner relation), team requests
  (`team_for_you`, who covers them), "addressed your changes" (an owner's
  reply answers), loudness and pings on own PRs, quiet reads, why-here,
  topic relation and driver, sidebar faces and the tile's people, the
  own-PR note in agent prompts, and "Ask <owner>" (`PrFacts.owners`,
  `PrFacts.ownerIsAutomation`).
- **Where it does not**: who opened the PR stays `pr.author` wherever it is
  shown (the PR row's avatar, "opened by", memory sources, MCP lines). Agent
  prompts say both: "by @acme-agent[bot], for @alice".
- **Fetching**: the batched PR query reads `assignees(first: 10)`; stored
  snapshots keep them in the PR JSON (`Pr.assignees`, missing on older
  snapshots and read as none). The full sync's finder asks
  `is:pr is:open assignee:@me` next to the viewer's own open PRs: it finds
  every PR assigned to the viewer, and only bot PRs become theirs. A hit a
  bot opened is found as `own_open`: the search reads the author's
  `__typename` and login, normalizes it like the PR fetch (`actorLogin`)
  and asks `isBotAuthor`, the same rule `prOwners` uses, so automation on a
  user account (renovate) counts and a deleted author does not. Its reason
  reads "agent PR assigned to you" (AU, "Your PR", the my PRs filter). A hit a
  person opened is found as `assigned`, "assigned to you": code AS, so
  "For you" like an `assign` notification, but the author still owns it
  (tier by author and requests: team for a teammate's PR, To review with a
  request, else rest; no move of its own), and its row says "assigned to
  you". The viewer's own self-assigned PRs come from the own alias first
  (one entry per PR). GitHub also notifies the assignee with reason `assign`
  (code AS), so these usually arrive through the inbox anyway.
- **Shown on the tile**: see "PR rows" under "Tile faces": when someone other
  than the author is assigned, the row and the detail pane say so.

## Bot bodies are cut when saved (2026-10-05)

Every PR is stored as one JSON snapshot, and most of its comment text is
bots' (review summaries, CI reports, preview tables). So the fetch cuts a
bot's body (`trimBotBody`, called by `normalize.ts` on every path that
stores a PR) to 3,072 UTF-16 code units with the marker "… (trimmed by
PostPile)", the same way in comments, thread comments and review bodies.
3,072 because the most any reader takes is the 3,000 a reply draft reads
of the comment it answers (summaries take 100, excerpts 240, quotes 200;
PR prompts leave bot comments out). A cut never leaves an HTML comment
open and never splits a character.

- **Kept whole**: people's bodies, a deleted author's, the PR description,
  a merge queue bot's (`mergeQueueState` looks for Trunk's markers anywhere
  in it) and a bot body a person edited last (its edit event reads the
  whole body for mentions of the viewer). "deploy" counts only in the kept
  part. So the cut changes no event id, kind or loudness: the tests compare
  the rules on both, and so did the measurements on a normal and a heavy
  copy. What it gives up: a team named only past the cut of a bot comment
  no longer picks which of the viewer's teams the tile chip names. The
  same rule (`isBodyReadByRules`) decides which bodies a board read loads
  at all ("The board diet").
- **Events keep their state** (`EventRepo.upsertDerived`): a machine
  comment's event that flips between deploy and bot_comment is renamed,
  not replaced. It keeps its seen time, override and event-log seq (the
  earliest, when both ids were logged). This covers a stored body first
  cut by a fetch and the role-change re-derive. Any other kind change
  stays a new event: a comment that now mentions the viewer is news.
- **Stored snapshots** are cut once by storage job 1, `bot_body_trim`
  (`BotBodyTrimJob`, see "Storage jobs" below for how it runs; 0.19.0 ran
  it on its own timer). One unit is one PR in key order, written back
  through `PrRepo.upsert` only when the cut changed it. It leaves events
  alone and keeps `fetched_at`. Its meta keys stay 0.19.0's
  (`bot_body_trim_after`, done at `bot_body_trim_done`), so an install
  mid-way resumes and one that finished never runs it again. No VACUUM
  (7 s on a heavy copy): SQLite reuses the freed pages.
- **Caches see a rewrite** (migration 029): every write of a PR's snapshot
  gives its header a new `pr.snapshot_revision`, in the same transaction,
  and the parse caches compare it instead of `fetched_at`. The value comes
  from one store-wide counter that only goes up (meta `snapshot_revision`),
  so a PR deleted and stored again never gets a revision a cache holds. A
  rewrite that keeps the fetch time (this job) still reaches another
  process's cache, like the CLI's. `fetched_at` keeps meaning when GitHub
  was asked. When the snapshot is normalized (NEXT.md), the revision stays
  the generation of the assembled stored PR: any child-table write or
  backfill that changes what readers assemble moves it in the same
  transaction.
- **Mark read put back**: a click captures event ids, and a fetch in the
  undo window can rename a deploy event to bot_comment. Undo, a send GitHub
  did not take and a parked batch look a captured machine comment id up
  under its other kind when it is gone (`machineCommentTwinId`), so the
  renamed event turns unseen again with its thread.

## Bot talk leaves agent work (2026-10-06)

Measured on a copy of the owner's database (809 PRs): of 3,599 comments
the prompts and the glance hash counted as human discussion, 2,190 were
replies in review threads where only bots had spoken ("fixed" to
greptile, codex, coderabbit) and 487 were commands people type for bots
("@codex review" 360, "/trunk merge" 119). Of 2,997 people's reviews,
2,234 were the empty COMMENTED review GitHub wraps each thread reply in.
272 PRs had nothing else as their human discussion. The PR pane already
showed it as quiet ("The PR pane" › Thread context and replies to bots,
Empty reviews that carry thread replies), but the agents still read it:
each one re-ran the PR's glance, started a dossier update and, on an
unread thread, went to the events agent.

**The rule** (core `bot-talk.ts`), the same for every viewer:

- A bot command (`isBotCommand`): one short line (six words at most) that
  starts with a slash command ("/trunk merge") or an @-mention of a bot
  (`isBot`, plus "codex", "claude", "cursor" and "mergify", handles that
  are no bot login), and mentions nobody else. Narrow on purpose: "Should
  we ask @codex?", "@alice can you /approve", "@codex review cc @alice", a
  second line of explanation and "@acme/team" stay discussion.
- Bot talk (`isBotTalk`): a bot's comment (`isMachineComment`), a bot
  command, or a person's reply in a thread where only bots spoke before
  (`isBotThreadReply`, unchanged).
- Human discussion (`humanDiscussion`): every comment that is not bot
  talk. Human reviews (`humanReviews`): not a bot's, not a carrier
  (`isCarrierReview`, unchanged): the reply it carries is a comment of its
  own.
- Events carry it as `PrEvent.chatter` (column `pr_event.chatter`,
  migration 032): a person's bot talk that asks the viewer nothing, the
  viewer's own included; an edit of it that mentions nobody new; every
  carrier review. A mention, question or reply to the viewer keeps its
  kind and is never chatter. `deriveEvents` sets it on every fetch; the
  migration fills stored rows whose rule reason already says reply to a
  bot or carrier, the rest get it on their PR's next fetch.

**Where it applies:**

- Prompts: `humanComments` is `humanDiscussion`, so "Human discussion" in
  glances, dossiers, sets, chat and pings holds people talking to people.
  "Review states" and "the user's own last review" leave carriers out. A
  reply draft to a top-level comment leaves bot talk out of the comments
  around it, except the comment it answers. A reply in a review thread
  still reads the whole thread: there the bot's finding is what the
  thread is about, and the thread is short.
- Glance hash: `prGlanceSnapshot` covers human discussion ids and human
  reviews `[id, state]`, and comment edit times of human discussion only.
- Topic memory: chatter is noise (`memoryRole`, "Event roles"). It never
  starts a dossier update or a topic catch-up, never counts as a newer
  event, and stays out of the dossier delta, the memory recheck and ping
  prompts. Riding along was the other choice: it would still fill the
  delta's event slots ("fixed" times twenty) and, past
  `DELTA_LIMITS.maxEvents`, start an update by itself.
- Events agent: chatter never awaits judgement (`awaitsJudgement`). The
  judged and request-gone quiet reads count it as needing nothing, like a
  person's activity the agent left quiet, so an unread thread with only
  bot talk since you looked clears without a call. Raised to loud by the
  agent or the user, it is news like anything else.
- Loudness: a bot command is quiet ("a command for a bot", the row after
  "replied to a bot in a review thread", before "addressed your changes"
  and "comment on your PR"). Someone's "@codex review" on your PR is no
  longer a loud comment on your PR, so it pings nobody and gets no second
  opinion. Replies to bots and carriers keep their loudness.
- Not changed: the PR pane activity (a command is a quiet line of its
  own), and a reply draft in a review thread (it reads the whole thread).

**Bot talk answers nobody** (2026-10-06, for 0.23.0). The first version
left the user-facing rules alone, so the viewer's own "@codex review" or
"fixed" to greptile counted as them speaking on the PR: an older ask from a
person turned "you already replied" and dropped off the list. A person
talking to a bot (core `talksToBot`: a bot command or a reply in a bot-only
thread) and a carrier review now never count as speaking, reviewing or
answering. Only a person talks to a bot: a bot's own comment is never
`talksToBot`, whatever its body says (2026-10-07). A board read leaves bot
bodies out ("The board diet"), so reading one there would answer
differently on the board than on the full PR. A bot owner's "@codex review"
after your changes request is its reply, like any other comment it posts.
Where it applies:

- Touch (`touchKindOf`): a chatter event is no touch, so `lastTouch`,
  `READING_TOUCH_KINDS`, `eventsSeenByTouch`, "New since you looked", the
  touched quiet read and an ask being answered (`isUnansweredAsk`) all
  skip it ("You already dealt with it").
- Speaking (`lastSpokeAt`): talk to a bot and carrier reviews are left
  out, so "you already replied" loudness, review requests answered and the
  changes answer read only what a person can read as an answer.
  `changesAnswered.replied` needs an owner's real comment or review, and
  the viewer's own bot command never moves `since`.
- Reviews: a carrier is no review of the head (`viewerHeadReview`) and
  does not take a team's request (`teammateReviews`, `headReviewers`): a
  "fixed" to a bot never reviews the PR.
- Whose turn: a thread whose last word is talk to a bot does not wait on
  the viewer (`threadsWaitingOnViewer`).
- Headline: chatter ranks with other people's quiet events (class 4),
  never over a person's comment.
- Snoozes: chatter never ends a "someone replies" snooze. Raised to loud,
  it wakes a snooze like any loud event.
- Lessons: the user's replies to bots stay out of a review's inline
  comments, and a carrier does not cut off the comments before it
  (`previousReviewAt`). Any thread reply the user sent on its own (the
  replies a carrier holds, by `reviewId` when the snapshot has it) stays
  out too, so a reply to a person between two reviews never joins the next
  change request. A lesson stored with a reply to a bot is `trimmed`, not
  edited: the engine stores the review without it (`setReview`) and keeps
  the line, its status and its join.

Property: bot talk by the author, an outsider or the viewer leaves whose
turn, the open ask, the viewer's last touch, the changes answer, a
person's headline and "someone replies" and mute snoozes as they were
(`properties/bot-talk.test.ts`).

**Glances written before** stay current. A new hash definition would
make every stored glance of a PR with bot talk stale on update (20 of the
73 glance targets on the copy). A PROMPT_VERSION bump regenerates all of
them, and a stored hash version does not help either: checking an old
hash means computing the old shape, and that shape moves with every new
reply to a bot. So `GlanceInputs.isCurrent` also accepts
`glanceItemInputHashWithBotTalk(input, item, glance.createdAt)`: the old
shape, bot talk counted, but only the bot talk there was when the glance
was written. Bot talk that came later is left out, as in the new shape,
so the glance stays current until the PR really changes and its next
rewrite stores the new shape. The pre-2026-10-05 shape (with the dossier
version) gets the same treatment. Accepted: bot talk written before a
glance but fetched after it, or edited after it, re-runs that glance once,
as it did before. Checked on the copy: 0 of 73 glances due with
origin/main, 0 with this change.

**Measured** on the same copy, old rules against new on the same
snapshots: in the 15-comment window prompts carry, bot talk held 113 of
248 slots across the 73 glance targets; 1,430 people's events waited for
the events agent, 935 now; memory triggers in the last 7 days 3,898 →
2,017, and 52 of the 488 dossier updates of that week that had a trigger
had only bot talk. Loudness did not change on the copy: the commands
there were the owner's own or on other people's PRs.

## Storage jobs (2026-10-05)

A one-time rewrite of stored data that needs JS (parse, cut, rebuild) runs
as a storage job, never in a numbered migration: a migration runs at
startup in one transaction on Electron's main thread, and on a heavy
install that is seconds of a frozen app and a WAL the size of the rewrite.
The bot body trim is job 1, the strip of the old checks (`checks_strip`,
"CI is not tracked") job 2, the discussion backfill (`discussion_rows`)
job 3 and the strip of the discussion from the json (`snapshot_strip`)
job 4 ("PR storage: the discussion as rows"), the activity backfill
(`activity_rows`) job 5, its strip (`snapshot_strip_2`) job 6, the text
backfill (`text_rows`) job 7 and the retirement of `pr_snapshot`
(`snapshot_retire`) job 8 ("PR storage: the rest of the PR as rows"). Code in
`packages/engine/src/storage-jobs/`: `runner.ts` (`StorageJobRunner`),
`jobs.ts` (the ordered list), one file per job. Checked with Codex
GPT-6.1 (2026-10-05).

- **One at a time, in order.** `jobs.ts` is append only. A job starts once
  every job before it is done, so an install that skipped releases runs
  them all, in turn, in one go. The desktop app starts them
  (`EngineService.startStorageJobs`); the CLI and the MCP never do.
- **A job** walks a cursor over keys. `step(store, after)` does one unit
  after the cursor and returns its key, or null when nothing is left.
  Each job names its own meta keys for the cursor and the done flag, and
  never reuses them (new jobs: `storage_job:<name>:after` / `:done`).
- **Slices.** One slice is one `BEGIN IMMEDIATE` transaction
  (`Store.immediateTransaction`): units until ~30 ms are spent, the
  expected commit included (a running average of the last commits; every
  few commits SQLite's automatic checkpoint adds ~15 ms), at least one
  unit, never a unit cut short. Then a 50 ms pause, so a job takes at
  most ~38% of the main thread. A unit reads what it rewrites inside the
  slice's transaction, so it never writes over a newer sync write. The
  cursor and the done flag are written in the same transaction as the
  units: a crash, a quit or a failing unit leaves the cursor at the last
  slice that committed, and the next start goes on from there.
- **Never in the way.** It starts 30 s after launch. No slice starts while
  a sync, a poll cycle, a consolidation or a catch-up runs (it looks again
  every 2 s), nor while the Mac sleeps (`noteSuspend`; it goes on 30 s
  after `noteWake`).
- **No waiting on the lock.** `BEGIN IMMEDIATE` runs with a busy timeout of
  0 for that call; the connection's 5 s comes back right after. On
  SQLITE_BUSY (another connection holds the write lock) the slice runs
  nothing and the runner tries again in 2 s, instead of holding the main
  thread for up to 5 s. SQLite documents that IMMEDIATE can return BUSY:
  https://sqlite.org/lang_transaction.html
- **Fail closed.** When a job finds nothing left, its `complete()` checks
  from the data that it is complete, in the same transaction, and switches
  what depends on it. Only then is it done. A failed check walks the job
  once more from the start; a second failure leaves it incomplete (meta
  `storage_job_incomplete:<name>`, a log line), never done, and the jobs
  after it wait. The next start tries again. The runner reports it once
  per app run as `storage_job_blocked` (name, `blocked_units`: what the
  job's check still finds undone, `blockedUnits()`). Counts only, never
  keys. The row backfills (`discussion_rows`, `activity_rows`,
  `text_rows`) are the exception since 0.23.0: their walk is their check,
  they switch at its end without the PRs whose json they rejected (those
  count as not stored until a fetch stores them again, "PR storage"), and
  the runner reports those as `storage_job_blocked` when the job is
  done. The trim's walk is its own
  check: a PR stored behind the cursor meanwhile came from a fetch, which
  cuts on save.
- **What a job may write, and revisions.** A unit may issue any SQL or
  repository write inside the slice's transaction (never a transaction of
  its own). A PR's `snapshot_revision` moves (the store-wide counter,
  migration 029, through `PrRepo.upsert`) only when what a read of that PR
  returns changes: the trim's cut does, a backfill into rows no read uses
  yet or a strip of what reads no longer use does not. A readiness switch
  is set in `complete()` only when it answers 'done'; 'again' commits too,
  so it must leave every switch unset. A second trim pass on the heavy
  copy wrote nothing and moved no revision. (GPT-6.1 review on #123.)
- **The end of a job:** one log line and `storage_job_done` (see "Usage
  analytics"). No WAL checkpoint of its own (GPT-6.1 review on #123): a
  zero busy timeout bounds the wait for locks, not the checkpoint's I/O,
  so one call could copy and sync a WAL that grew while a reader held
  checkpoints back, all on the main thread. SQLite's automatic checkpoint
  and `journal_size_limit` (64 MB) keep the WAL small; it peaked at 9 MB
  on the heavy copy. 0.19.0's trim emptied it at the end.
- **`afterDone`**: a job may run work after its done transaction
  committed, outside any transaction. `snapshot_strip`,
  `snapshot_strip_2` and `snapshot_retire` do: a TRUNCATE checkpoint
  with busy timeout 0 (`Store.checkpointWal`), since they rewrote or
  deleted most of the json. Without a reader in the way it found the
  WAL already copied and took 1 to 12 ms. With a reader held through both
  jobs on the heavy copy the WAL grew to 638 MB (`journal_size_limit`
  acts only when the WAL resets) and the checkpoint gave up in 6 ms; the
  first checkpoint after the reader let go took 0.66 s. That cost belongs
  to any long reader, not to this call, and the app holds none: CLI and
  MCP reads are short transactions.
- **A failing unit** rolls its slice back; the runner logs it and stops
  until the next start.

Measured on `.backup` copies (2026-10-05, Node 24.21, SQLite 3.53.4, the
bot body trim with real timers):

| copy | PRs | rewritten | slices | slice p50 / p95 / max | work | wall | peak WAL |
|---|---|---|---|---|---|---|---|
| normal | 809 | 643 | 14 | 35 / 40 / 41 ms | 0.43 s | 1.1 s | 8 MB |
| heavy (14x) | 11,326 | 9,002 | 190 | 31 / 40 / 46 ms | 5.9 s | 16 s | 10 MB |

The discussion jobs on the same copies after a 0.21.0 install's jobs
(2026-10-06; slice maxima varied between runs on a loaded machine, 44 to
67 ms on heavy):

| copy | job | units | work | wall | longest slice | peak WAL |
|---|---|---|---|---|---|---|
| normal | discussion_rows | 809 | 0.32 s | 0.83 s | 48 ms | 8 MB |
| normal | snapshot_strip | 809 | 0.08 s | 0.13 s | 47 ms | 8 MB |
| heavy (14x) | discussion_rows | 11,326 | 6.0 s | 15.9 s | 67 ms | 9 MB |
| heavy (14x) | snapshot_strip | 11,326 | 1.2 s | 3.0 s | 55 ms | 9 MB |

The 0.23.0 jobs on copies at the 0.22.0 state (2026-10-06, one run; the
normal copy also once with a reader held through every job):

| copy | job | units | work | wall | longest slice | peak WAL |
|---|---|---|---|---|---|---|
| normal | activity_rows | 809 | 0.11 s | 0.27 s | 32 ms | 5 MB |
| normal | snapshot_strip_2 | 809 | 0.06 s | 0.11 s | 53 ms | 5 MB |
| normal | text_rows | 809 | 0.05 s | 0.10 s | 25 ms | 5 MB |
| normal | snapshot_retire | 809 | 0.03 s | 0.03 s | 25 ms | 4 MB |
| heavy (14x) | activity_rows | 11,326 | 1.7 s | 4.5 s | 118 ms | 9 MB |
| heavy (14x) | snapshot_strip_2 | 11,326 | 0.7 s | 1.8 s | 64 ms | 9 MB |
| heavy (14x) | text_rows | 11,326 | 0.8 s | 2.0 s | 47 ms | 9 MB |
| heavy (14x) | snapshot_retire | 11,326 | 0.5 s | 1.2 s | 68 ms | 9 MB |

On heavy 6 of 103 slices of the row jobs went past 50 ms, one to 118 ms
(a loaded machine; one run). With the reader held on normal the WAL grew
to 15 MB, both checkpoints gave up at once, and the first one after the
reader let go took 28 ms; dropping the table did not wait on the reader.

Without the commit allowance the normal copy's slices ran 47 ms at the
median. The WAL stays at its peak size afterwards and is reused.

## Colour per meaning (2026-10-01)

The same colour meant several things: amber was the agent's Look closer and
also "Needs review" and "Queued", closed had its own red next to the red of
"Changes requested", and approved had a second green beside Looks safe.
Owner accepted one colour per meaning (tokens in the renderer's
`styles/tokens.css`):

- **Amber (`--closer`)**: only the agent's Look closer (verdict pill, the
  detail pane's Look closer box, a ✨ pill greyed for Look closer).
- **Neutral (`ink-2`)**: "Needs review" with its eye icon.
- **Merged purple (`--merged`, `--merged-ink`)**: merged. `--status-queued`
  is gone. In the merge queue was purple too until 2026-10-02; it now has
  the queue icon in pending amber (`--pending`, words `--pending-ink`), red
  once failed (see "Merge queue").
- **One red (`--status-bad`, #b8321f)**: closed (icon and word, `--closed`
  points at it), changes requested, risk (the risk box reds stay in that
  family), errors and failed states (was coral `--unread-ink` for errors).
- **One green (`--safe`, #17733e)**: approved, Looks safe and the Approve
  button. `--status-good` is gone. Open (`--open`, GitHub's open green)
  stays as it is.
- **Coral (`--unread`)**: only new / unread.
- **Honey**: only aimed at you and your move.
- App-health warnings (sync capped, read-only, setup hints, out-of-date
  memory, a winding-down topic, a blocked action toast) use the calm
  `--amber-*` warning tokens of the update bar, not `--closer`. The
  "routed" topic tag is neutral, like the routing "for whom" chip.

## Tile faces: why it's here, status, whose turn

Every tile answers four questions without opening it. All four are derived in
core (pure, tested) and come with the tile view model (`TileView.why`,
`.people`, `.turn`; `PrSummary.why`, `.status`, `.openThreads`). The engine
and FakeEngine call the same functions.

**Why it's here** (`whyHere`, `tileWhy` in `why-here.ts`): one code per PR,
the tile shows the most aimed one (order RV, @, AS, RT, @T, AU, CM, FW, ST).

**Headline event** (`pickHeadlineEvent`, `headline.ts`; 2026-09-30): the strip's
event is the most important unseen one across the whole tile, not the newest.
Order: asks of you or your home team (review request, mention, question, reply;
a routing team's mention is FYI, not an ask), merged or closed without your
review, verdicts (approvals, changes requested), human comments and reviews,
other human events, then automation. Newest within a class. Automation leads
only when nothing else is unseen, and the coral NEW badge never shows on it
unless the event is loud. `TileState.unreadBecause` is ordered least important
first, so its last entry is the headline. Event summaries drop HTML comments
(`<!-- ... -->`, bot markers) and collapse whitespace; an empty one falls back
to the kind label.

**For whom** (`forWhom`, `tileForWhom` in `for-whom.ts`; 2026-09-28, mockup
ForWhom2 part 1 variant B). The codes still decide; the UI shows words, not
codes. RV, @, AS -> "For you" (honey chip, 4px honey band down the tile's
left edge). A team request on a PR a teammate wrote (`Viewer.teamMembers`)
is "For you" too, whatever the code, while no other teammate approved or
requested changes (a comment alone does not cover it; 2026-09-28,
`reviewRequest` = `team_for_you` in `review-request.ts`). Only a home
team's request does that (2026-09-30, see "Team roles"). RT, @T -> "For <team slug>" ("For team-devex", sea chip and
band), the slug from the pending team request, else the timeline request,
else a team mention, home teams first at each step. For a routing team
the chip says the same words in the neutral style and there is no band
(`ForWhom` kind `routing`, 2026-09-30): sea means "your team", and a
routing team is not. AU, and any PR the viewer wrote even with a CODEOWNERS
team request on it -> "Your PR" (neutral chip, neutral grey band). CM, FW,
ST -> no chip, no band. A PR whose author addressed your changes (see
whose turn) is "For you" whatever its code. A tile takes the most aimed of
its PRs (you, team, routing, own). PR rows in multi-PR tiles (and the detail pane's PR list) show the
same words as a small chip without a band, only when the row's differs from the tile's
(2026-09-29). The chip's tooltip keeps the
long why-here reason. The table below is still the rule behind it.

| code | meaning | from |
|---|---|---|
| RV / RT | review asked of you / your team | `review_requested`: a pending request names the viewer or one of `Viewer.teams`, else the newest timeline request does, else RV |
| @ / @T | mentioned you / your team | `mention` / `team_mention` |
| AS | assigned | `assign`, or found through the assignee search (a person's PR) |
| AU | you wrote it | `author`, or a passive reason on the viewer's own PR |
| CM | you took part | `comment`, `state_change` |
| FW | following | `subscribed`, `manual`, `ci_activity`, `other` |
| ST | stack context | pulled in |

**PR status** (`prStatus` in `pr-status.ts`): lifecycle (open, draft, queued
while the newest merge-queue timeline entry is an add, merged, closed) and review
from `reviewDecision`. Merged and closed PRs drop review, drafts drop review.
No checks (2026-09-29, see "CI is not a signal"). Open threads = unresolved
review threads.

How it shows (2026-09-29, design 3a; `ICON_WORDS` (was `LIFECYCLE_WORDS`), `reviewWord`,
`rowStateWord` in the renderer's `lib/pr.ts`): the lifecycle is a
GitHub-style icon (open: green pull request, draft: dashed grey circle,
merged: purple merge, closed: red closed pull request; in the merge queue
the Octicons merge-queue icon, amber, red once the queue took it out,
2026-10-02, see "Merge queue"), words in its tooltip. The icon is core's
`PrStatus.icon`. The review state is an icon + word: "Needs
review" (eye, neutral ink), "Approved" (green check; "Approved by agent" when only
agents approved), "Changes requested" (red). On a PR row drafts show an
outlined "DRAFT" chip with a pencil and merged / closed PRs show the colored
word ("Merged" purple, "Closed" red) in place of the review. Colours
follow "Colour per meaning" (2026-10-01; Needs review was honey, queued
amber). State colors stay on done tiles; only titles and counts go grey. **CI shows only in the
detail pane's facts** ("Checks"): not on rows, tiles, the detail state line
or the RISK box, and not in whose turn or any agent text (see "CI is not a
signal").
The Checks fact is gone since 0.21.0 ("CI is not tracked"); until then it
was neutral, a grey bar and "12 checks · 2 not passing". The Size fact draws deletions (count and bar) in their
own diff red (`--diff-red`), never coral: coral stays for "new".

**PR rows** (`PrRow`): state icon, the coral dot for an unread PR
("The unread dot", see below), mono number, the stack mark for a stack layer ("1/3", see
"Stacks as one unit"), bold title, (for-whom chip when it differs, repo
label), then the state word, open threads (bubble + count) and the author's
avatar. When someone other than the author is assigned (2026-09-30, an agent
PR a bot opened for a person, see "PR ownership"), "assigned to" follows in
quiet grey with each assignee's avatar and login ("you" for the viewer), at most two and then
"+N", every name in the tooltip (`assigneeLine` in the renderer's
`lib/assignees.ts`, `AssignedTo`); the detail pane shows "opened by
<author> · assigned to <assignees>" under the branch line. A single PR sits in a white bordered box and its row leaves the
title out (2026-09-29: the tile's heading already is the title; the row's
tooltip keeps it); a stack or set's rows sit in one tinted rounded box, the
selected row highlighted, drafts and closed layers on a grey row.
Row grid (2026-10-01): the tile and the detail pane's PR list draw the same
`PrRow` with the same facts. The state icon sits in a 20px slot and the
unread dot hangs in the row's left padding, so `#number` and title start at
one x on read and unread rows; a lone row gets 2px more padding than a
grouped one, so the icon lands at the same x on single and multi-PR tiles.
The detail list is narrower, so its rows drop "assigned to" below 480px and
the author's face below 400px (the body's "opened by" line keeps both). In a
tile, the strips, body and footer share one text start (16px with the frame)
and one right edge (15px).

**The unread dot** (2026-09-30; the dot below, first the "not-done dot" of 2026-09-29, core `notDonePrKeys`, shipped as
`TileView.notDonePrKeys` since 2026-09-30; replaced "the new dot" of the same morning, which only
showed on unread tiles for PRs with unseen news, see "Actions act on what
you look at"): on an unread or open tile every tracked PR that keeps the
tile from being done gets a small coral dot before its number, in the
tile's rows and the detail pane's PR list (aria-label "Not done yet"):
`PrSummary.done` false (core `isPrDone`, shipped per row), or an unseen
loud event left, or its thread unread on GitHub (since 2026-09-30: both keep
the tile from being done). A pulled-in stack layer gets one while it has
unseen loud news, which makes the tile unread too (2026-09-30; before, such
a tile was unread with no dot anywhere). Done and snoozed tiles show none, and neither does a tile where
only one PR can hold it (the dot would only repeat the tile's state). Mark a
dotted PR done in the detail pane and its dot goes; no dots left, the tile
is done. It is the one coral mark that is not "new since you looked"; there
is no second, read-only dot. History: a six-PR set once stayed unread
because of one old "ready for review" and nothing showed which PR, which
gave the first dot; an open set that never said which PR held it gave this
one.

*Unread dot, 2026-09-30 (owner decision):* the dot now means exactly
"unread" (core `unreadPrKeysOf`, `TileView.unreadPrKeys`, aria-label
"Unread"), so dotted topics, dotted tiles and dotted PRs add up to GitHub's
unread count. A PR has it when it makes its tile unread by "GitHub unread is
PostPile unread": a tracked thread unread on GitHub, a pulled-in layer with
unseen loud news, or an unseen Look closer event. Single-PR tiles get it
too (the multi-PR-only rule is gone), a snoozed tile keeps the dots of its
unread threads, open and done tiles have none. Seen but still owed is not a
dot: the honey "Your move" (tile footer, sidebar chip) says it. A topic with
unread PRs shows the dot. Counts are tiles, dots are per PR (owner,
2026-09-30): the sidebar bubble and the footer's unread number count unread
tiles (`TopicListItem.unreadTiles`), not PRs. The passages
above describe the "Not done yet" rule this replaced.

**Tile header**: for-whom chip, the kind ("PR" in grey text; layers icon +
"Stack · 2"; dashed square + "Set · 3"; blue only while selected), the
verdict pill with an icon ("Look closer" ring-dot on an amber ring, "Looks
safe" check, "Not yours" dash, dashed "No glance yet"; a stale glance adds
"· out of date", or "· updating" while a sync or catch-up runs, see
"Out of date wording"), then avatars and age
on the right. Then the title, the agent's one-to-three-line take, the PR
rows and the footer.

**The verdict pill shows the tile's worst glance (2026-10-01).** The pill
used the lead PR's verdict, so a stack whose lead looked safe said "Looks
safe" while its third layer needed a closer look. Owner: the Look closer on
a tile is for the worst PR in it, so the whole tile may need a closer look,
and the user should not have to pick that PR out. Core picks it
(`tileVerdict`, shipped as `TileView.verdict` with the chosen PR's key,
verdict and glance state): the worst glance among the tile's tracked
(not pulled-in), open PRs, in the order Look closer (stale or not), no
current glance (missing, stale or being written), Looks safe, Not yours.
Ties go to the lead PR, then tile order. With no open tracked PR (all
merged or closed) the pill keeps the lead PR's glance. The pill keeps its
look and its stale and updating words, for the chosen PR. Rejected: a
glyph per PR row, "N of M" counts, a roll-up in the topic header.

**People** (`tilePeople`): authors, the viewer if they submitted a review,
other reviewers (submitted, then requested), four at most, bots only as
authors.

**Whose turn** (`whoseTurn` in `whose-turn.ts`): `{ kind: 'you' | 'them' |
'none', who, what, prKey }`. A `you` turn also carries `move` (2026-09-29),
the kind of move for the sidebar row's chip: `reply` (rule 2, drafts too),
`re_review` (addressed your changes, or asked again while your changes
request stands, push or not), `review` (review request, personal or team), `address_changes` (threads or a change request on your own PR or
draft), `merge`. No CI move: `fix_ci` ("Fix failing CI") was dropped
2026-09-29 ("CI is not a signal"). Rules per pinged PR, first match wins:

1. merged or closed: none.
2. you: a human mentioned you, your team, replied to you or asked you a
   question, and you have not touched the PR since (a comment or review, or
   a push to your own PR; core `lastTouch`, the definition of "You already
   dealt with it"). The text says what happened and only a question asks
   for an answer: "Answer ada's question", "lyra mentioned you", "lyra
   mentioned your team", "lyra replied to you"; with a pending review of
   yours: "Review, lyra mentioned you". The move stays `reply` (chip
   "Reply", Needs reply).
   History (2026-09-29): on the viewer's own PR a teammate wrote "@you this
   needs a merge-in from master I think!". The events agent rightly kept it
   loud, a request, but the move said "Reply to …'s mention" until the
   viewer commented, although the push was the answer. Only a comment or
   review counted then. Julian: "if the reply is not directly written as
   needing a reply from me, it also doesn't count" as a reply, so the
   request stays a move but is no longer called one. A push on someone
   else's PR does not count (see `lastTouch`).
   A team mention asks only until it is read (2026-09-28): once its event is
   seen (mark-read in the app, read on GitHub, or any touch of yours after
   it, see "You already dealt with it") it no longer makes it your
   move, so it no longer keeps the tile off Done or the topic in needs-you.
   A routing team's mention is quiet by the rules, so it never asks
   (2026-09-30, see "Team roles").
   Personal asks (mention, question, reply) stay until answered.
   An ask the events agent lowered to quiet or muted (`effectiveLoudness`,
   override over rule) is no ask (2026-09-29): not your move, not Needs
   reply (`prTier`), not "still your move" after a mark-read. Until the
   agent has weighed in, the rule's loud stands. History: the rule was
   ported from ghatchup ("a human asked something and there is no sign you
   answered"), which also had "ADDRESSED YOU: a human spoke to you, but
   nothing is owed". The agent's second opinion on events exists since
   2026-09-27 to tell "can you take a look?" from "thanks!", but whose turn
   never consulted it, so a plain "thanks, that's fine" kept saying "Reply
   to …". Julian, 2026-09-29: "if the author just replies 'Oh yeah, that's
   fine,' that's not my move to reply again".
3. The merge queue, on any open PR (2026-10-02, see "Merge queue"): in a
   queue it waits on the queue, "Waiting on the merge queue" (`who` null),
   on someone else's PR too and whatever you reviewed. Failed in Trunk's
   queue is the author's: yours on your own PR, "Re-submit to the merge
   queue: tests failed" (move `merge`); on someone else's "sol to re-submit
   to the merge queue: tests failed", never yours.
   Then, on your own PR:
   - you: unresolved threads whose last comment is someone else's ("Answer 3
     threads from mira"), else a standing change request ("Address ada's
     changes"). Failing CI alone is not your move (2026-09-29).
   - them: that change request, after you pushed and requested ada again
     (she is back in the requested reviewers): "ada to re-review"
     (2026-09-29, `reReviewAsked` in `changes-answered.ts`). Every standing
     change request counts: while any of them has no re-review asked after
     your push, the move stays yours and names the first such reviewer
     ("Address carol's changes"); "ada to re-review" only once all have
     (`standingChanges`, 2026-09-29).
   - them: the first pending reviewer, user before team, shown as "Waiting
     on sol" (`WhoseTurn.lead`), "and N more" when several are asked. Your
     own team asked by CODEOWNERS counts as a reviewer here, never as a
     review for you.
   - you: approved and not a draft ("Merge, it is approved"). Not in the
     first rule list; added so an approved own PR does not read as nothing.
   - else none.
4. On someone else's PR (after the merge queue, rule 3):
   - you: addressed your changes (2026-09-28).
     Your newest verdict review (approve, request changes, dismissed) asks
     for changes, and since your last word (that review, or a later comment
     or re-review) the author pushed (any human commit or force push but
     yours; a commit author can be a git name) or replied (comment, review
     or thread reply by the author). No re-request needed: many authors
     never press it. "pim addressed your changes: re-review", or "pim
     replied to your review" without a push. `changesAnswered` in
     `changes-answered.ts`. It goes before rule 2 when the open ask is the
     author's own thread reply; an ask from anyone else still goes first.
     Once you re-review or comment it is off again until the author moves.
   - them: you approved, on any commit (the app's record, or your newest
     approve-or-request-changes review on github.com is an approval): the
     author "to merge". The app's record only bridges the gap until GitHub
     shows your review on the approved commit; from then on your newest
     verdict on GitHub decides, so a dismissal or a later change request
     wins (2026-09-28). A push after your approval is never your move
     (no "Re-check", dropped 2026-09-28).
   - you: a review is requested of you, or of your team, and you have not
     reviewed the head ("Review, rowan asked", "Review for team-devex"). The
     name is who requested you or your team in the timeline, not whoever
     made the newest request on the PR. A
     team request on a teammate's PR counts like a personal one
     ("Review for team-devex: lyra's PR") until another teammate approves
     or requests changes; a teammate's comment alone does not cover it
     (2026-09-28). A team request on a PR from outside the team (routed)
     is yours only while no teammate reviewed at all, and while it is not
     on hold (`teamRequestHold`, 2026-09-29). Only home teams work this
     way (2026-09-30, see "Team roles"): a routing team's request is
     routed on any PR, a teammate's too, never "lyra's PR", and yours only
     while nobody but the author (and bots) reviewed the head, since its
     members are not known ("Review for approvers"; taken: "mira is
     reviewing"). When both are pending, the more owed request names the
     team (a tie goes to the home team, `requestedTeam`). While your own
     changes request stands (you were asked again after it and only
     commented since) the same request is a re-review: "Re-review, ada
     asked", move `re_review`, matching the tier Changes you requested
     (2026-09-30, `viewerRequestedChanges`). That holds with or without a
     push: without one your review of the head still stands, but GitHub
     drops a reviewer from the requested list once they review, so a
     pending personal request after it is the author's re-request, and an
     explicit re-request means "look again" (2026-09-30).
   - them: a routed team request while someone else's changes request
     stands: the author "to address ada's changes" (the author moves
     first). Once the author pushed after it and requested ada again (she
     is back in `reviewerUsers`), it is ada's move: "ada to re-review"
     (2026-09-29, `reReviewAsked`; the team request stays on hold). With
     several change requests, the author moves while any of them lacks
     that re-review (`standingChanges`).
   - none: a routed team request whose agent glance says NOT_YOURS (stored
     glance, stale or not, `Board.notYours`, so the tile state, whose turn
     and after-read agree). The PR stays in To review with its team chip;
     a mark-read makes it done. A personal request or a team request on a
     teammate's PR never goes on hold. Before this, a tile said "Not
     yours" next to "Your move: Review for team-devex".
   - them: you commented or
     requested changes on the head: the author "to address 2 threads" (open
     threads you started), "to address your changes" or "to reply".
   - them: a team request someone else picked up: the author "to merge" when
     approved, else that reviewer "is reviewing", or "ada to re-review" when
     a standing change request was answered by a push and ada was requested
     again (same rule as above).
   - else none (following, subscribed, took part earlier).

**After a mark-read** (2026-09-29; core `tileAfterMarkRead` in
`after-read.ts`, shipped as `TileView.afterRead`; labels in the renderer's
core `tileOffers` in `offers.ts`, shipped as `TileView.offers`). Done means nothing is asked of you, so a button must not
promise Done where a mark-read cannot deliver it (Julian pressed "Mark done"
four times on a PR whose author addressed his changes; the thread went read,
the tile stayed, nothing visible changed). `afterRead` runs the same
`isPrDone` and `whoseTurn` over the data as a mark-read leaves it (every
event seen, pinged and found PRs handled): `done` and the `turn` left.

- Tile footer: "Mark read" on an unread tile. On a read tile "Mark done"
  only when `afterRead.done`, else "Mark read". A read (open) tile that is
  still your move gets no mark button: Snooze leads, with its usual menu,
  and "Review on GitHub" opens the files tab
  of the move's PR ("Open on GitHub" and the PR itself on your own PR),
  through the external link path (so `opened_on_github` fires). Done tiles
  keep "Open" and nothing else: no mark button and no Snooze, in the tile
  footer and in the detail pane (2026-09-29: a done tile still offered
  "Mark read" in the pane and Snooze in the footer, both leftovers that did
  nothing visible; a user debugging a finished topic read them as "something
  is still open here"). A snoozed tile whose tracked PRs are all done, their
  news seen, leads with "Open" too, like its pane, and keeps Snooze so the
  snooze can be taken back (2026-09-29: the footer said "Mark done" there).
- Detail pane action bar (changed 2026-09-29, "Actions act on what you
  look at"): on a single-PR tile, same label rule as the footer; the mark
  button is left out while the tile is read and still your move (Snooze
  stays there, as the primary). On a stack or set it acts on the selected
  PR: the same rule per PR (core `prMarkAction` in `offers.ts` over
  `PrSummary.afterRead`, core `prAfterMarkRead`):
  "Mark read" while the PR has unseen news, "Mark done" when a mark-read of
  it makes it done, else "Mark read"; no mark button while that PR is read
  and still your move (`PrSummary.turn`), or done already, or a pulled-in
  layer without news. No Snooze in the pane there; Open on GitHub leads
  when nothing is to mark. The primary comes from core `paneOffers`, see
  "Own PRs never ask for a review".
- Read looks read: no strip, no NEW, title in regular weight. The honey
  your-move footer stays as the only reminder.
- Toast after a mark-read that leaves your move (writes on): "Marked read.
  Still your move: re-review." (`moveWords`: the move after "addressed your
  changes:", else the turn text), with Undo and "Snooze until next push"
  (one click, `new_push`; the toast fades after 6s, so no menu inside it).
- No re-sorting (`tileListRank`): a read tile that is still your move ranks
  with the unread ones, so marking it read never moves it down. Queues and
  sidebar sections do not change.

**Drafts** (2026-09-28): nobody reviews or approves a draft right away and
it won't merge soon. Rules in core:

- whose-turn (`draftTurn`): an open draft is your move only for a personal
  question, mention or reply you have not answered ("Answer ada's question
  on draft", "lyra mentioned you on draft", `PERSONAL_ASK_KINDS`; a team
  mention is not enough). On your own
  draft also for review threads waiting on you ("Address 2 comments on your
  draft") or a standing change request. Never Review or Merge.
- tier: a draft never lands in To review (`prTier`); needs_reply still
  works for personal asks; a standing change request of yours puts a
  draft under Changes you requested. "Addressed your changes" does not apply to a
  draft: only the author's reply in your thread counts, as a personal ask.
- loudness: a review request naming you on a draft is quiet (commits after
  your approval are quiet everywhere), so neither pings or makes the topic
  urgent. Mark-ready (`ready_for_review`) is loud when a review of you
  or your team is pending or was asked ("ready for your review"), which
  brings the PR back as reviewable.
- pings (`isAddressedToViewer`): drafts ping only for a personal question,
  mention or reply.
- UI: a tile whose open tracked PRs are all drafts gets a grey "Draft" chip,
  a dashed frame (a dashed left band when it has a for-whom band) and a
  muted title; the row's DRAFT chip already says so. Core decides it
  (`TileView.draft` = `isDraftTile`, 2026-10-01) with the same rule as the
  topic's PR state icon (`topicPrState` says draft), so the chip and a draft
  topic icon can't disagree; pulled-in layers are skipped in both.

**Own PRs never ask for a review** (2026-09-28, Julian got asked to
approve his own PRs). The rules above already route own PRs to rule 3 before
any review ask; on top of that:

- The detail pane's primary button comes from core (`prPrimaryAction`,
  `PrSummary.primaryAction`): Approve only on an open PR someone else wrote;
  `approved` once you approved on any commit, where the button stays usable
  but calm (re-approving is harmless, it never nags). On your own PR, or a merged or closed one: Mark read while the
  tile is unread, else Open on GitHub. "Ask <author>" is hidden on your own PR.
- The pane leads with what it acts on (2026-09-29,
  core `paneOffers` in `offers.ts`, on top of the
  tile's `tileFooterAction`): the one filled button, placed first, is Approve
  while it is due (someone else's open PR, not approved, not a draft), else
  on a single-PR tile the tile footer's Mark read / Mark done / Snooze, or
  nothing on a done tile or done PR; on a stack or set the selected PR's Mark
  read / Mark done, else Open on GitHub while that PR is not done (see
  "After a mark-read"). On a done PR "Open on GitHub" stays outlined
  (`PaneLead` `none`, 2026-10-07, owner): with an ink one there, a
  dealt-with topic showed two black buttons at once, and "Archive now" is
  the next move. "Approve again" and "Approve draft" stay outlined next to it.
  The filled button is ink, except Approve (2026-09-30): it leads in `--safe`
  green, the same color as the "Approved" state it produces, because it is
  the one action that is both final and positive. Accent blue stays for
  selection and focus.
  Before, a PR the viewer had approved got no primary at all while its tile
  led with Mark read. The topic header's role chip is a noun: "Driver",
  "Reviewer", "Stakeholder", "Watcher" (was "You review" and friends).
- The Approve button says what you approve into (2026-09-28,
  `approveButton` / `approveStateGlyphs` in the renderer's `lib/approve.ts`):
  the lifecycle glyph (draft / ready) and the review glyph (approved /
  changes requested / review required, also on drafts) sit in front of the
  label, words in their tooltips. Approvals do not depend on the commit:
  once you approved (app record or an approving review, any commit; core's
  `viewerApproval`, shipped as `PrDetail.viewerApproval`, so the button and
  the turn rules agree) the button stays usable but calm, an outlined "Approve again" whose tooltip
  says you already approved and whether commits came after; not filled, no nag.
  It wins over draft. Else "Approve as well" when others approved and you
  never did. Drafts get an outlined "Approve draft"; draft wins over "as
  well", since not-ready is the bigger caveat and the review glyph already
  shows the approvals.
- Approve is split on the PR pane (Decided 2026-10-02, `ApproveButtons` in
  the renderer). The main part approves right away with no body, as before.
  A narrow right segment with a speech-bubble icon opens "Approve with
  comment": the agent drafts a one- or two-line note on open ("Drafting…",
  then an editable textarea), and "Approve with comment" sends the approval
  with that body (`PrActions.approve(key, headOid, body)`, the same head
  check). Only the PR pane has it; tiles, the agent's "Approve stack" and the
  topic's Approve keep approving without a body.
- **Comment review** (Decided 2026-10-02): an outlined button next to
  Approve, never the lead, shown wherever Approve is (`PaneOffers.approve`:
  someone else's open PR, drafts included, not on a done PR). It posts a
  GitHub review with event `COMMENT` (`POST
  repos/{repo}/pulls/{n}/reviews`, `commit_id` = the head on screen, body
  required, so the post button is disabled while the note is empty). Why it
  exists: it answers a review request (yours or your team's) without being
  the one who clears the PR for merging, since branch protection does not
  count a COMMENT review as an approval. Same rules as Approve: refused
  without a GitHub call when the stored head moved ("nobody reviews commits
  they have not seen"), blocked while writes are locked (never a pending
  write), logged as `comment_review`, followed by the same mark-read as
  approve (events seen, not handled: the review answers the ask). The PR is
  refetched; when the snapshot does not show a review by the viewer newer
  than the one before the write (an earlier review on the same head does not
  count), PostPile adds a COMMENTED review to the stored PR and drops the
  viewer's pending personal request, as GitHub does, so
  `reviewedHead` (tiers, whose turn) sees the viewer reviewed until the next
  sync brings GitHub's copy. The move goes back to the author.
- Review note drafts (2026-10-02): `PrActions.draftReviewNote(key, kind)`
  reuses `agent.draftComment` (call kind `draft_comment`, no new kind) with
  `person: null` (a note addressed to nobody) and an intent per kind
  (`review-note.ts`). Neither retells the change or lists what was
  checked: the author wrote the diff (2026-10-02, after the first drafts
  read like a summary of the PR).
  Since 2026-10-06 the notes are written for a user who posts them without
  the agent's view of the diff: a posted "the dict wildcard and the build
  check both hold up, and `excludePath` safely skips…" listed checks and
  names the user never looked at. So: plain words anyone on the team
  understands without the diff, one point the user can stand behind
  without having read it in detail, no nitpicks (naming, style, small edge
  cases), code identifiers only when the point cannot be said without one.
  - Approve: "Looks good." plus at most one short sentence on a risk to
    watch after merge or a follow-up; with nothing like that, the opener
    alone (the usual case). The opener is picked in code, not by the
    agent: `APPROVE_OPENERS` ("Looks good.", "LGTM.", "Looks good to me.",
    "Good to go.", "All good here."), the next one after the last used
    (meta `approve_note_last_opener`), so it never repeats twice in a row.
    The agent call is `pointOnly`: it returns just the point, or an empty
    body, and the engine puts the opener in front (`approveNoteBody`).
  - Comment: one or two short sentences with the one point most worth a
    look (an observation or a doubt that matters), without approving or
    asking for changes.
  Plain sentences: at most two (one for the approve point), each about 20
  words or fewer, active voice, no hedging, idioms, em dashes or bullets. The glance's Verdict / Risk lines travel as fenced
  `notes` (untrusted, they can echo PR text), never in the intent. Its Does
  line stays out, since a summary handed in came back out, and so does For
  you, which can carry local work context into a public note (Codex on
  #94).
  The usual context (instructions and work context) goes along, so
  `instructions.md` can steer the tone. Since 2026-10-05 an optional
  `gist` ("Rewrite with the agent": the user's own words, a gist or a rough
  draft) goes along too; the note is written from it, keeping their points.
  It is the user's text, so it sits outside the fence. Empty: as before.
- **Reply to a comment** (2026-10-05, backend for the redesigned detail
  pane). `PrActions.replyToComment(key, commentId, body)` finds the comment
  in `pr.comments` (core `reply.ts`). An inline review comment with a
  thread id gets the reply in its thread (GraphQL
  `addPullRequestReviewThreadReply`). An issue comment or review body has no
  thread on GitHub, so the reply is a new PR comment (`commentOnPr`) that
  quotes the first non-empty, non-quote line of the comment (clipped to 200
  characters), then `@author ` and the user's text, unless the text already
  mentions the author (`quotedReplyBody`). Unknown comment or empty text:
  failed, no GitHub call. Final, blocked while writes are locked (never a
  pending write), the PR is refetched after, like `sendComment`. Telemetry
  `reply_sent {target: thread|comment}`.
- **Thumbs up** (2026-10-05). `PrActions.react(key, id)` takes a comment id
  from `pr.comments` or a review id from `pr.reviews` (an approval without a
  body is no comment but a reactable review node) and sends GraphQL
  `addReaction` with `THUMBS_UP`. Same lock rules as a reply. Nothing else
  on the PR changes, so there is no refetch: the stored snapshot is marked
  right away (`withViewerReaction`, shared with the fake engine), and the
  next poll reads GitHub's. The reader asks `reactionGroups { content
  viewerHasReacted }` on issue comments, reviews and thread comments, and
  normalizes the THUMBS_UP group into `Comment.viewerReacted` /
  `Review.viewerReacted` (missing on older snapshots: false). Telemetry
  `reaction_sent`.
- Replies are logged as `reply`, thumbs ups as `reaction`, each with a
  detail (`reply in review thread <id>`, `reply to <author>'s comment <id>`,
  `thumbs up on <id>`); the debug view words them "replied" and "thumbs up
  given".
- **Reply drafts** (2026-10-05). `PrActions.draftReply(key, commentId,
  gist)` runs `agent.draftReply` (prompt `prompts/reply.ts`, call kind
  `draft_comment`, same model and timeout as an ask). Inputs: the comment,
  its whole review thread for an inline comment, else the human
  conversation around it (`replyConversation`: up to 8 before, 4 after, no
  bots), the PR line, the glance's Verdict / Risk lines, the topic's
  instructions and tailoring. All GitHub text is fenced; the gist is not.
  Empty gist: the most useful reply from the conversation. Non-empty: the
  reply written from the user's words, nothing added they did not say. The
  draft never quotes or @mentions: the reply path adds both where needed.
- Superseded 2026-10-05 by one inline composer (see "The PR pane"). One compose popover (2026-10-02, `ComposePopover`): Approve with comment,
  Comment review and "Ask <owner>" share one popover under the button that
  opened it (surface, rounded-tile, shadow-menu; title, one-line hint,
  textarea, Cancel and the primary action), one open at a time. Ask keeps its
  extras inside it: the person field (default the PR owner) and the optional
  question with "Draft", then the editable draft and "Post comment" (a plain
  PR comment through `sendComment`, as before). It replaced the Ask composer
  that opened as a strip under the action bar.
- Tiles whose tracked PRs are all yours carry a neutral "Your PR" marker
  (the own/ink look of the AU badge, in words) next to the kind label.
- News on your own PR that asks nothing of you (a bot, a finished review;
  whose-turn is not "you") gets "· FYI, nothing to do" in the unread strip,
  so the strip reads as what happened, not as a to-do.
- Prompts: `prDetails` adds a note outside the GitHub fence that the user
  wrote the PR and cannot approve or re-review it, so glances do not advise
  approving.

**Why now on a revisit** (2026-09-29, `whatsNew` in `whats-new.ts`, shipped
as `PrSummary.whatsNew` and `PrDetail.whatsNew`; words from the renderer's
`lib/whats-new.ts`). The unread strip keeps its layout, size and place;
only its text changes, and only when the viewer already touched the PR
before the new loud events. Rules:

- New events are the unseen loud ones, the same loud news that pings. Quiet bot and other events never change the text or the count.
- A touch is one of the viewer's own events (review, approval, changes
  request, comment, a push to their own PR, a merge or close they did; core
  `lastTouch` in `last-touch.ts`, shared with "You already dealt with it"),
  else a mark-read: an event turned seen (mark read in the app,
  or GitHub's `last_read_at` passed it, see "Reconciling with GitHub's read
  time"). The anchor is the newest own action before the first new event; a
  mark-read only anchors when the viewer never acted ("since you marked it
  read"). No touch before the new events: a first-time ask, and the strip
  keeps the event's own words.
- The lead is the most important new event: a mention, question or reply
  first, then a team mention, a (re-)requested review, a changes request or
  approval by someone else, pushes, then anything else (its summary). The
  newest wins a tie. Pushes count together ("6 commits since your changes
  request"; these are loud as "addressed your changes", `changesAnswered`).
- Texts, about 48 characters at most (`STRIP_TEXT_MAX`, else the short form
  without the anchor): "6 commits since your changes request", "lyra
  replied to your review", "lyra replied to your comment", "pushed after
  your approval" (only when that push is loud, e.g. the agent raised it),
  "lyra requested changes since you approved", "pim re-requested your
  review", "lyra mentioned you since you marked it read".
- "+N" counts the other new loud things (all pushes together as one) plus
  unread events on the tile's other PRs. The avatar and badge are the lead's
  actor and event, the age the newest new loud event.

**Agent approvals are a neutral fact, in words** (2026-09-28). In a busy
repo a good share of approved PRs are approved only by a bot, mostly an AI
review agent, and nearly all of them merge. That is not a problem to flag:
it says an agent reviewer looked and found the change fine. It is still
worth seeing, so the app says who approved instead of a bare "approved".

- Core's `standingApprovals` splits standing approvals (each reviewer's
  latest approve / change request / dismissal is an approval) into people
  and agents with `isBot`, the one bot rule: the "[bot]" suffix (the GraphQL
  reader adds it for `__typename Bot`) plus the known automation list. The
  renderer never imports it; it gets the result as data.
- `PrStatus.agentApprovers` / `PrDetail.agentApprovers` (`agentOnlyApprovers`)
  hold the agent names ("reviewbot") only when no person approved. The
  review word then reads "Approved by agent" (tooltip "Approved by reviewbot
  (agent)"), the detail's "To merge" says "approved by reviewbot (agent)",
  and the Approve button's review glyph says the same in its tooltip. Same
  calm green as any approval, no warning colors. Once a person approved it
  is the usual "approved".
- GitHub's semantics stay: `reviewDecision`, whose turn, tiers and Done do
  not change. An agent approval counts; "Merge, it is approved" and
  "Approve as well" apply after one too.
- Prompts: `prDetails` adds "Approved by: @alice (person), @reviewbot[bot]
  (agent)" (the user's own approval has its own line). The glance prompt
  says both are real approvals and that who looked is a fact the verdict,
  forYou or risk may use, e.g. whether a person reviewed a change in the
  user's areas. Agent approvals count in the glance input hash; the key is
  only added when there are some, so other PRs' hashes did not move.

A tile takes the most urgent member (you over them over none); on a tie the
PR with the newest unseen loud event wins, so the footer and the unread strip
talk about the same PR, else tile order. Multi-PR tiles add " on #N".
"A teammate is reviewing" means a reviewer from `Viewer.teamMembers`; until
that list has been fetched once, any reviewer but the author counts.

**Team members** (`TeamMembers` in the engine, ghatchup's
`Meta.TeamMembers`): every other login on the viewer's home teams (see
"Team roles"; routing teams are never fetched), from REST
`GET /orgs/{org}/teams/{slug}/members` (all pages, ETag per team), kept in
meta `team_members` and put on the stored viewer. Refreshed during sync at
most once a day, or when the home teams change. A team the token cannot
read counts as empty; a failed refresh keeps the last list and never fails
the sync. No home team means an empty list (no teammates), not the "any
reviewer" fallback of a list never fetched.

**Team roles** (decided 2026-09-30; `team-roles.ts` in core, `TeamRoleKeeper`
in the engine). Every GitHub team used to count the same: all members were
teammates, a team request on a member's PR was "For you", team mentions
were loud. Real org data broke that: most teams are small, but some are
approver or cross-cutting groups (17 people) or parent teams. One engineer
on only a 17-person approvers team and a 4-person team got 4% of about 400
reviews in 3 months through either team's request (33% personal, 62%
unasked), yet PostPile treated all 20 people as teammates and filled
Team's PRs with PRs from across the company. The user, on a 3-person team,
got 57% of his reviews through the team's request. 46 of 236 org members
are in no team. So each of the viewer's teams gets a role:

- **home**: behaves as every team did before. Members are teammates
  (`teamMembers`, the `team` tier, the team PRs filter, Your team owns,
  faces in the sea team pill).
  A home team request on a teammate's PR is `team_for_you`; the sea "For
  <slug>" chip and band; human mentions of it are loud.
- **routing**: only its review requests and mentions matter. Members are
  not teammates and are never fetched. Its requests are routed like a home
  team's request on an outsider's PR (To review, below "For you" tiles,
  hold rules, Look closer pings), on any PR, a teammate's too: never
  `team_for_you`. Taken once anyone but the author and bots reviewed the
  head. Neutral "For <slug>" chip, no band. Its mentions are FYI (quiet,
  `ruleLoudness` row "routing team mention"), so they never ask.
- **No home team is valid**: no teammates, no `team` tier, Your team owns
  stays empty, the Team
  filter hides (`ViewerView.homeTeams` empty), no teammate faces. For
  people like the engineer above that is "teams off".
- **Bot-made review requests count like human ones** (as before, see "A
  review request counts by whom it asks"): assigner bots route most team
  requests and the user relies on them.

`Viewer.teams` stays every team, so requests to routing teams are still
found (`findPrs` aliases), coded RT and removable ("Remove <team>").
`Viewer.homeTeams` lists the home teams; missing means roles are not
decided yet and every team is home, so nothing changes until then.

Classification, rules first, the user confirms (`classifyTeams`): a review
"came through team T" when T was requested on the PR and the viewer was not
requested personally (a personal request wins). A team is home when at
least 20% of the viewer's reviews came through it (`HOME_TEAM_SHARE`) and
it has at most 10 members (`HOME_TEAM_MAX_MEMBERS`; added 2026-09-30: with
share alone, a 40-person approver group asked on most PRs got over 20% of
the reviews, became home and filled Team's PRs with 40 "teammates"). With
fewer than 30 reviews in the window (`MIN_REVIEWS_FOR_SHARE`), size
decides alone: 10 members or fewer is home, more is routing. An unknown
size counts as small. The stored `basis` names what decided: a share
below 20% is `share` whatever the size, then a team too large is `size`
("40 members, too many for a home team"), else `share` or, under 30
reviews, `size`. Input, two
read-only GitHub reads: member counts of the viewer's teams in one GraphQL
request (`teamSizes`, `members { totalCount }`), and `is:pr
reviewed-by:<login> -author:<login> updated:>=<90 days ago> org:<each of
viewerOrgs>` with `timelineItems(itemTypes: [REVIEW_REQUESTED_EVENT])`
(requested User login or Team org/slug, bot-made ones included), pages of
50, at most 200 PRs (`reviewedPrRequests`).

Storage: meta `team_roles` = `{ classifiedAt, reviewCount, teams: {
"org/slug": { role, source: 'auto' | 'user', basis: 'share' | 'size' |
'user', share, reviews, members } } }`. When: the setup sweep classifies
every team again (see Setup flow); a sync classifies when `team_roles` is
missing (installs that finished setup before roles existed) and when
`Viewer.teams` gains a team (only the new one). A role with `source:
'user'` is never overwritten. A failed classification never fails a sync
or the sweep; those teams stay home until the next try. A sync's next try
waits 2 hours (meta `team_roles_retry_after`, set by any failed
classification, cleared by a good one; `SWEEP_RETRY_MS`, the same wait as
a failed work-context sweep), and a sync does not classify at all while
the GitHub quota is low (`allowsBackground`, see "GitHub quota"), so a
failing search or an org behind SAML SSO costs no search pages on every
auto sync (2026-09-30). The setup sweep and a flip ignore both.

The user flips a role under the setup sweep and in "Your teams" in the
instructions pane ("team-devex · Home team (57% of your reviews) · Make
routing only"; `GET/POST /api/team-roles`). A flip is `source: 'user'`,
sticks, and updates the stored viewer at once (home teams, and the members
of a new home team, a GitHub read). Events get their loudness when they
are derived, so whenever the stored viewer splits its teams differently
(`teamRolesDiffer`: the first classification that changes a role, a flip,
a sweep, a team joined or left), every stored PR's events are derived again
from its stored snapshot (`saveViewerFollowingRoles`, no GitHub read;
2026-09-30, was: on the PR's next fetch). Seen state and overrides (the
user's and the agent's) stay, so a team mention goes quiet on a flip to
routing and loud again on the flip back. Prompts name routing teams only when a team routes
("Teams that only route review requests to them (not their team)"), so
prompt hashes do not move for everyone else.

**PR tiers** (`prTier` in `pr-tier.ts`, ported from ghatchup's
`triage.Classify`): one tier per open PR, first match wins: `needs_reply`
(a human mention, question or reply the viewer has not answered and the
events agent did not lower, same check as whose-turn), `changes_requested` (the viewer's newest verdict
review on someone else's PR asks for changes, drafts included; added
2026-09-29), `mine`, `team` (author in `teamMembers`),
`to_review` (review asked of the viewer or their team, head not reviewed),
`team_mentioned` (thread reason or a stored team_mention event), `rest`.
A personal request and a team request on a teammate's PR (see whose turn)
are `to_review` and checked before `team` (2026-09-28): a review owed to a
teammate is a review, not the `team` tier. A teammate's PR whose team request
another teammate covered stays `team`; routed team requests stay
`to_review` after the authorship checks. A routing team's open request on
a teammate's PR is `to_review` too, before `team` (2026-09-30): a review
owed, not `team`. Without a home team nothing is `team`. Inside To review the topic column
puts "For you" tiles (personal and teammate team requests) before routed
team requests (`tilesInTierOrder` in the renderer).
Addressed your changes (see whose turn) is `changes_requested` (was
`to_review` until 2026-09-29), like a change request still waiting on the
author: a re-review is owed even to a teammate, and the author's own
thread replies do not push it into needs_reply; an ask from anyone else
does. `TopicQueues.changesAddressed` counts the ones whose move is a
re-review (`isReReviewMove`: addressed, or asked again with or without a
push), for the order inside the section (2026-09-30).
Pure and tested; the sidebar's queue sections are built on it.

### Three-pane balance

Grid: `clamp(248px, 22vw, 330px) | half the rest | the other half`: tiles
and detail start equally wide (2026-09-30, was a 420-480px tile clamp). At
1440px that is about 317 | 562 | 562, at the 1100px minimum 248 | 426 | 426.

- **Sidebar rows**: see "Queue sections" below.
- **Middle column**: one tile wide, tiles never sit side by side, so the
  selected tile's notch always points at the detail pane.
- **Detail pane**: takes the remaining width.
- **Unread vs read tiles** (2026-09-28): unread tiles keep the warm strip
  with a coral "NEW" pill (was a 7px dot); read tiles have no strip and a
  quieter title (ink-2 instead of ink). Coral stays "new since you looked"
  only. PR rows show their own for-whom chip only in multi-PR tiles.
- **Readable small text** (2026-09-29): the faint grey (`--faint`, #9aa0ad)
  measures 2.3-2.6:1 on PostPile's backgrounds. Small text that carries
  information uses `--hint` (#666b79: 5.3:1 on white, 4.7:1 on the
  sidebar): the why-here line ("Owner not known · you're here because…"),
  out-of-date notes, "Dossier v3", people's roles, the sidebar's fold
  labels (area folds, More, FYI, Archive), "Earlier activity", empty-state
  lines, stale memory lines and hover actions (Why?, Recheck, Wrong,
  Forget). Faint stays for decoration: separators, chevrons, the quote
  mark, ages next to a louder line, done tiles. Light theme only; there is
  no dark theme yet.
- **Source chips once per block** (2026-09-29, `blockRefs` in the
  renderer's `lib/memory.ts`): inside one block (since you last looked,
  open questions, "What the agent knows") a source chip already shown on an
  earlier line (same label and link) is left out, so "#1902" does not run
  down the block. "Why?" still lists every source of a line.
- **Detail pane assessment** (2026-09-28, mockup ForWhom2 part 2 variant
  1, "verdict as the box title"; `GlanceCard`, split in `lib/assessment.ts`).
  Box 1 is titled with the verdict ("LOOK CLOSER · for you", amber since
  2026-10-01, was honey; "LOOKS
  SAFE · for you", green; "NOT YOURS", grey; the tag follows the PR's for
  whom) and holds the glance's for-you text as short marked lines: "!" the
  main point, "?" a later sentence that asks for a check. Box 2 "RISK ·
  <level>" (red) holds the risk text (▲), only when there is risk content
  and the level is not low (2026-09-29: a red box around "Low. CI green."
  read as an alarm; the verdict box covers a low risk).
  The renderer no longer adds a failing CI line (2026-09-29: CI only in
  the facts). Then plain lines "→ Does:" and "“ Others:". Each
  box caps at 3 lines. Nothing repeats: no verdict pill or for-whom chip in
  the pane, the risk level only in box 2's title.
  A stale glance looks stale (2026-09-29, `StaleVerdictBox`): the verdict
  box turns grey and dashed whatever the verdict, keeps the verdict word
  with "· out of date" ("· updating" while something runs), and says one
  line, "Written before the last change. A new assessment will be written
  on the next sync." ("Updating now: a new assessment is being written.").
  Its advice (for-you lines, RISK box, Does / Others, Look at first) folds
  away behind "Show old assessment". The glance schema stays
  prose; sentences split into lines in the renderer (a dot followed by a
  space and a capital or digit ends one), so stored glances keep working.
  The action bar (primary, Ask, Mark read, Snooze (single-PR tiles only),
  "Remove <team>" per pending team request of yours, then Recheck and chat at
  the end) sits right under the assessment, above the PR facts and the
  activity list; the ask composer opens under it.
- **Detail pane top** (2026-09-29, design 3a): the tinted header repeats
  the tile (kind, title, "PR 1 of 2", ‹ ›) and lists its PRs like tile rows,
  the open one boxed in accent, with the coral unread dot where it applies (was the not-done dot until 2026-09-30).
  A single-PR tile's header shows only the kind ("PR"): no title (the body
  shows it right below), no counter and no arrows that lead nowhere
  (2026-09-29). The body starts with a state line: big
  state icon + lifecycle word ("Open" green, "Draft", "Merged", ...), the
  review word, the mono `owner/repo#num` and the GitHub button. Then the
  title and `head → base · layer 1 of 2`, then (only while something
  loud is new) the "New since you looked" box, then the assessment.
- **New since you looked** (2026-09-29, `NewSinceBox`): directly under
  the title and branch line, above the assessment. Header "NEW SINCE YOU
  LOOKED · since your changes request yesterday" (anchor from `whatsNew`,
  relative day from `whenLabel`; plain header on a first look). Up to 3
  loud lines (`activity.fresh`, same rows as the activity list), then "N
  more"; the quiet bot events since the touch fold into one line
  (`activity.freshNoise`, `noiseSummary`: "10 bot comments, a deploy") that
  expands. The activity list below no longer repeats any of it.
- **Look at first** (2026-09-29, `KeyFiles`): the glance's `keyFiles`, up to
  3 changed files a reviewer should open first with the agent's why (max 12
  words), under Does / Others. Mono path middle-truncated (full path in the
  tooltip), +/- from `pr.files`, each row opens `<pr url>/files`. The agent
  may only pick listed changed files; others are dropped when the answer is
  mapped. Empty for trivial PRs and glances from before g2.
- **Description** (2026-09-29, `PrDescription`): the PR body under the
  action bar, above the facts. A 160px scroll box with a fade while more is
  below, and Expand / Collapse. GitHub markdown (react-markdown +
  remark-gfm), raw HTML skipped, template `<!-- -->` comments stripped,
  only absolute http(s) / mailto links, remote images never load (shown as
  an "[image: alt]" link). An empty or template-only body leaves it out.
- **Detail pane activity** (`activityList` in core `activity.ts`, shipped
  as `PrDetail.activity`; 2026-09-28, the full event list was too long and
  noisy). Shown by default: human comments and reviews, mentions, review
  requests (and removals) naming you or your team, human pushes collapsed
  per burst (consecutive pushes by one person: "rowan pushed 3 commits",
  "... after your approval"), and lifecycle (ready, draft, merged, closed,
  reopened). New-since-you-looked lines (an unseen loud event) and the
  unseen noise after the viewer's last touch (`activityList(events,
  viewer, since)`) go to the box under the title (2026-09-29); the list,
  titled "Earlier activity" then, keeps only the rest. About 12 lines
  (`ACTIVITY_LINE_CAP`) before "Show all N". Bots, deploys, merge queue,
  agent-muted events and review requests between others fold into one "N
  bot events" line that expands (Unmute lives there).
  Comments and reviews from people show in full (2026-09-29): the event
  `summary` is one clipped line (100 chars, first line) for tiles, MCP and
  the agent, so `activityList(events, viewer, since, pr)` also puts the
  whole text on the line as `body`, read from `pr.comments` / `pr.reviews`
  by the event's `sourceId`. The row shows the lead ("lyra commented") and
  the body under it, wrapped, line breaks kept, never clamped. Bots keep
  the one-line form; so do agent-muted people in the folded line.
- **Resizable**: the two edges (sidebar | tiles, tiles | detail) are draggable
  (`PaneDivider`, pointer capture, a 12px invisible hit area, col-resize
  cursor). Limits: sidebar 200-440px, tile column from 340px (no 720px cap
  any more; 1400px is only a sanity bound), and a drag never leaves the
  detail pane under 360px. Double-click an edge to go back to the default
  above. Only dragged widths are kept, per viewer in localStorage
  (`postpile.paneWidths.<login>`, `lib/pane-widths.ts`), so a changed
  default reaches every edge nobody dragged; a blocked storage just forgets
  them on reload.

### Queue sections

The sidebar lists topics under ghatchup's PR queues (mockup "B with
avatars and filters", QueuesB2).

- **Sections**, in order (since 2026-10-02, see "Ownership sections"):
  Needs reply, Changes you requested, To review, Team mentioned (the asks,
  one per ask tier), then You drive, Your team owns, Other work, Other
  topics, and the Archive drawer. Each lists topics, not PRs, and **each
  topic once in the whole sidebar** (2026-09-29), in the section core gives
  it (`topicSection`). Until 2026-10-02 My PRs and Team's PRs were sections
  too, and a topic sat in the highest tier any PR other than the viewer's
  own gave it. The "Topics with" switch (any PR, my PRs, team PRs) matches
  a topic by any of its PRs. Section tint: honey for reply, changes and
  review, ink for You drive, sea for Your team owns and Team mentioned,
  grey for Other work and Other topics.
  History: until 2026-09-29 a topic sat in every section where it had a PR
  of that tier. That came with the picked mockup (QueuesB2, 2026-09-28) as a
  side effect of per-PR sections over per-topic rows, not as a decision;
  Julian: "If it's highlighted in my PRs, I will naturally click on it and
  check it".
- **Changes you requested** (tier `changes_requested`, 2026-09-29): open PRs
  where the viewer's newest verdict review asks for changes, whoever wrote
  them. Directly under Needs reply because a standing change request is the
  viewer's own open loop: Julian, "this should surface very high up, maybe
  directly below needs reply". Rows whose move is a re-review ("addressed
  your changes: re-review", or "Re-review, ada asked" after a re-request)
  sort first (`TopicQueues.changesAddressed`, which follows the move since
  2026-09-30); rows still waiting on the author follow, quiet. The topic column does the same with the section's tiles
  (your move first, `tilesInTierOrder`). Before, only the
  addressed case had a section (To review), and a change request the author
  had not touched fell to Team's PRs or Other topics (both gone since).
- **Authorship** no longer picks a section (2026-10-02): who drives the
  topic does. The viewer's own PR (`prOwners`: also a bot's PR assigned to
  them, 2026-09-30) sorts its topic first inside whatever section it sits
  in, and the my PRs filter finds it. An area is a label for where the code
  lives and never moves a topic between sections; only Other work folds by
  area.
- **Archive drawer** (2026-09-29 as "Finished", renamed 2026-10-01): under
  the sections, a folded "Archive" group header lists retired topics that
  still take new PRs (`takesNewPrs`: projects for 30 days, standing topics
  until half a year without a new PR), newest first
  (`GET /api/topics/finished`, `FinishedTopic`: name and how long ago it
  retired, PR count in the tooltip). Quiet on purpose: muted names, no
  bubble, no faces, no count on the header. A row opens the topic like any
  other (`getTopic` reads a retired topic whole, `Board.forTopic`; the
  breadcrumb says "Archive"). Search and the queue filters cover live
  topics only, so the drawer hides while they narrow. Hidden when empty.
- **Counts** come from `TopicListItem.queues` (`topicQueues` in core): PRs
  per tier over the PRs in the topic's tiles on the hot board (each PR
  once; PRs that went cold are not counted), plus open PRs
  by you / by a teammate. Only open PRs get a real tier; merged and closed
  ones are `rest`.
- **Pulled-in stack layers** (provenance `pulled_in`, no tile holds them
  pinged; `pingedPrKeys`) sit outside the tiers: they add to no section, no
  queue count and no filter count, their `PrSummary.tier` is `rest`
  (`memberTier`) and filters never match them. They stay on their stack
  tile as context.
- **Rows**: name, face stack, one count bubble, then a one-line summary
  with the honey your-move chip at its end, right under the bubble
  (`TopicListItem.yourMoves`: live tiles, not done and not snoozed, where
  whose-turn says it's your move, merging your approved PR included). At
  1100px row one has no room for the chip, so the summary truncates first
  and the chip stays.
- **Your move chip** (2026-09-29): names the most urgent move in words
  ("Reply", "Re-review", "Review", "Address changes", "Merge", in
  that order of urgency, the order of the sections) plus how many more
  ("Reply +2"); the tooltip lists every move's footer text joined by " · "
  (`yourMoveChip` in `lib/your-move.ts`, from `WhoseTurn.move`). Was "N your
  move". Because each topic now shows once, the chip is where the row hints
  at what else is inside. The grey "merged without you" chip stays next to
  it.
- **Your move in the header and the group headings** (2026-10-01): the
  topic header ends its pills with the same `YourMoveChip` as the sidebar
  row, and a group heading reads "Open 4 · 2 your move", the second part in
  honey ink and only above 0. Core decides both: `TopicDetail.yourMoves`
  (`topicYourMoves`, the `topicUrgency` rule on live tiles) and
  `TopicDetail.groupYourMoves` (`yourMovesByGroup`, live tiles per group,
  snoozed and done left out), so a snoozed tile adds to the group's count
  but not to its your-move part. While the search filters the grid, or
  a selected tile is held outside its core group (`useHeldPlace`), the
  headings drop the your-move part: its numbers are for the groups as core
  sees them, and the tile counts are not. The tile footer keeps its dot and "Your move" text.
- **No counts on section headers** (2026-09-28, later the same day):
  Julian read the PR counts on headers and rows as unread counts, and how
  many PRs a queue holds does not matter. Section and group headers show
  no number; the only number in the list is a row's unread bubble.
- **Read vs unread rows**: an unread row (any unread tile) has a bold ink
  name, the bubble and a light warm row background (`bg-warm-strip`, not
  coral); a read row is regular weight with a muted name and no bubble.
- **One number per row** (2026-09-28): the row's count is its unread tiles,
  in a small round bubble, the same in every section and in Other topics. It
  answers "what is new here", which the tier's PR count on each row did not
  (section headers carry no count either). Coral bubble when the
  urgency rule says so (an unread tile is still open), grey bubble when
  every unread tile is merged or closed, no bubble when all is read. The old
  separate coral dot, grey dot + count and the per-row tier count are gone.
- **Faces** (`TopicListItem.people` = `topicFaces(topicPeople(...))`,
  2026-09-29): PR authors only, no bots; reviewers and commenters stay in
  the topic header and the dossier's people line. `topicPeople` orders you,
  your teammates (`Viewer.teamMembers`), then everyone else, each part by
  number of PRs (ties in order of appearance); `topicFaces` takes the first
  three, no "+N". You and your teammates sit together in one **team pill**
  (`teamPill` in the renderer's `lib/faces.ts`): sea-tinted, thin sea
  border, fully rounded, a small two-person icon first, then the avatars
  overlapping; tooltip "You and your team: <logins>". Only you: the pill
  holds just you; nobody from the team: no pill. Other authors follow
  outside the pill as plain avatars, overlapping the same way (the first
  onto the pill's edge). Replaced "only you and your team when involved,
  with a sea ring" (2026-09-28), which dropped the other authors and mixed
  in reviewers.
- **PR state icon** (`TopicListItem.prState` and `prStateCounts` =
  `topicPrState`, 2026-10-01): one icon per row, the most alive state among
  the topic's tracked PRs: failed in the merge queue when any tracked open
  PR is, the merge-queue icon when every tracked open PR is in the queue
  (2026-10-02, see "Merge queue"), else by precedence open (a queued PR
  counts as open), draft, merged, closed (closed without merging). One open PR among nine
  merged shows open; merged shows only when nothing is open or draft; closed
  only when everything is closed. Pulled-in stack layers do not count. It is
  the same icon and colour as a PR row (`PrStateIcon`). Every row has a
  fixed 14px leading slot inside the highlight, holding only the unread dot
  on line one (empty on line two), so the name and the summary start at the
  same x on every row (and the section labels line up with them; so do the
  fold headers, including the area headers under Your team, whose chevron
  takes the slot, and the filter, hidden topics and error lines). The icon
  sits at the right end of line two, after the summary and the chips, and
  ends on the same right edge as the unread bubble and faces above it
  (2026-10-01: icon moved right for a calmer left edge; coloured icons on
  most rows made the left edge noisy, and the area headers sat deeper than
  the names). The
  tooltip ("5 open · 1 merged") is the only place the counts show. Chosen
  over counts per state (busier, steals summary width) and a progress bar.
- **Topic header PR pill** (`TopicDetail.prRollup` = `topicPrRollup`,
  2026-10-01): the same state icon as the sidebar row, from the same core
  helper, then the number of distinct PRs in the topic's tiles. Found PRs
  (own open PRs, review requests, recent merges the sync found) count, and so
  do pulled-in stack layers, since the tiles show them; the old
  pinged + pulled-in count said "0 PRs" on a topic of only found PRs. The
  tooltip gives the lifecycle mix and the review mix of the tracked PRs from
  `PrStatus.review`, plus any pulled-in layers: "3 open · 1 draft · 1
  merged; 2 need review, 1 approved".
- **Breadcrumb = sidebar section** (`TopicDetail.section`, 2026-10-01):
  "Topics › To review › area", with the section's label and coloured dot as
  the sidebar draws them; Archive for a retired one (core gives `archive`
  since 2026-10-02). It used to say "Needs you" or "Quiet" from
  `TopicGroup`, which only matches a subgroup inside Other topics.
- **Urgency** (`topicUrgency` in core): a topic needs you when an unread
  tile still has an open PR, or whose-turn says it's your move on a live
  (not done, not snoozed) tile and that move is more than "Merge, it is approved" on your own PR
  or "Re-submit to the merge queue" (`isMergeApprovedMove`). That move still shows on the tile footer and in
  the chip count, it just doesn't make the topic urgent. Only then is its unread bubble coral and does it rank as
  `needs_you`. When every unread tile is merged or closed the row shows a
  grey bubble ("merged or closed since you looked") and ranks below the urgent
  ones (`compareTopicUrgency`: needs you, then open unread tiles, then any
  unread). Tiles still show unread as before.
- **Filters**: Mine (your avatar), Team (up to three teammates), Reply,
  Review, each with its PR count over all topics. One at a time, a second
  click clears. A filter keeps topics with a matching PR (Mine: open PR you
  own; Team: open PR a teammate owns, see "PR ownership"; Reply / Review: that tier) and
  drops sections left empty. It narrows together with the title bar
  search. Queue filters pick topics;
  tiles inside a topic are never faded by them (owner, 2026-09-30). Plain UI state, not in the
  back / forward history. The avatars come from `GET /api/viewer`. Without
  a home team (`ViewerView.homeTeams` empty) the Team button hides, unless
  it is the active filter (2026-09-30, see "Team roles").
- **Selection stays put**: what the user picked stays on screen until the
  user navigates. An approve, mark-read, refetch, live poll or sync never
  moves it, even when the open topic then leaves the queue filter or the
  search, or the open tile turns read or done. The "first match" fallback
  only runs when the user picks something or changes a filter (the queue
  filter, or the search once its new results are in), or when the pick is
  really gone (topic deleted or merged). Meanwhile the open topic stays
  listed in the sidebar in its normal place, the open tile stays in the
  grid (search matches, Dealt with opens for it), and
  a tile id that disappears (set regrouped, PR left a stack, single to set)
  is followed by its picked PR to the tile that holds it now. None of this
  adds history entries. Why: after an approve the user often moves on to
  the next tile they had in sight; a jump to "the next best item" loses
  their place (2026-09-29). Pure rules in `lib/selection.ts`.
- **Nothing is selected until there is something to look at**: when a
  topic opens or a filter changes and the user has not picked a tile, the
  app selects the first tile of the Unread group in tier order, else the
  first of Open; never a snoozed tile, never one in Dealt with. With
  neither it selects nothing, and the right pane says "No tile selected"
  ("Pick a tile to see it."). A tile the app picked is not the user's pick:
  it is not written into history. When an app-picked tile changes group
  while it is shown (read or done through a sync, the move-on mark), it
  stays in the pane and counts as the user's pick from then on, so the
  grid keeps it too: pane and grid never disagree, and it drops out once
  the user moves on. The keep-visible rule above stays for tiles the user
  selected. Why: "we should rather not select any tile and show 'none
  selected' on the right" (2026-09-29). Pure rules in `lib/selection.ts`
  (`autoTile`). The All / Unread filter it was first built for is gone
  (2026-09-30, "Groups inside a topic").
- **Topic column**: the whole topic in three groups, Unread, Open, Dealt
  with (see "Groups inside a topic"); inside a group tiles sort by
  `TileView.tier` (the most urgent tier among its PRs), needs reply first,
  rest last, snoozed ones last; inside a tier the engine's order
  (`tileListRank`: a read tile that is still your move first). Single
  column as before.

### Repo scope and quiet repos

A repo menu in the title bar (right column, before the sync status; the
left column clips popovers). Rules in core `repo-scope.ts`, settings in
meta (`repo_settings`: `{scope, quiet}`), `GET /api/repos`, `POST
/api/repos/scope {repo}`, `POST /api/repos/quiet {repo, quiet}`. Both are
local; nothing goes to GitHub.

- **Scope**: a radio list, "All repos" (default) or exactly one repo.
  Topics are the structure, so the chosen repo only selects topics, never
  tiles: the sidebar (queues and Other topics) lists the topics with at
  least one PR (any tile, pulled-in layers included) in that repo
  (`isTopicInScope`), and the queue and filter counts and search cover
  those topics, each with all its tiles. That is why it combines with
  search and the "Topics with" switch without renderer logic.
- **Opened topic**: always every tile across repos, never filtered or
  faded by repo. A tile whose PRs all sit in another repo than the chosen
  one (or, under "All repos", the topic's main repo: most PRs, first seen
  on a tie, `mainRepoOf`) gets a small neutral repo label; a set mixing
  repos gets it on each PR row from another repo instead
  (`tileRepoLabels`, `TileView.repoLabel`, `PrSummary.repoLabel`). The
  label is the short name (`infra`, `docs`) when the org is one
  of the viewer's team orgs (`viewerOrgs`, falling back to the base repo's
  org), else `owner/name`.
- **Topic header repo**: the opened topic's main repo sits on the owner
  line, before "Owned by", as a book glyph and the short name in mono
  (plain text, not a pill), with "+N" when its PRs touch N other repos
  (`topicRepoLine`, `TopicDetail.repoLine`; same PR keys as the tile
  labels, ties go to the picked repo). When a repo is picked and the topic
  has PRs in it but most sit elsewhere, it reads "mostly in infra" in
  honey, and the hover says why it is listed ("Listed because 1 PR is in
  app; most of its PRs are in infra"). Without a placement it shows alone
  in the same spot; no PRs, no repo.
- **Narrowed button**: "Only app" in the accent with a soft accent ring,
  like a narrowing "Topics with" option, plus an × that goes back to All
  repos in one click. "All repos" keeps the quiet look.
- **Menu rows**: each repo with its topic count (PR count in the tooltip),
  counted over every topic so the menu does not shrink while narrowed; the
  "All repos" row counts every topic with PRs. A repo the settings name
  but with no PRs left still shows with 0, so it can be picked away from
  or woken up. "All repos" carries a green "Recommended" tag and a hint:
  dealt-with topics hide on their own, so the full list stays short, and
  one repo is for focusing a while.
- **Migration**: a scope stored as a list (the multi-select before
  2026-09-28) reads as that repo when it held one entry, else "All repos"
  (`migrateRepoScope`); the next change stores the new shape.
- **Quiet repos ("Let it go stale")**: PRs still sync, get events, topics,
  dossiers and facts. They never make a topic urgent (`UrgencyTile.quiet`
  when every PR of a tile is quiet; a mixed tile only passes the states of
  its non-quiet PRs), never ping (`pingRule(..., quietRepo)` gives class
  `quiet_repo`, decided by rules, never shown to the agent), and stay out
  of `topicQueues` and the filter counts. Their `PrSummary.tier` is `rest`
  (`memberTier`) and filters never match them. The tile still shows unread
  (grey count on the row, since it is never urgent) and a small "quiet
  repo" note. FakeEngine applies the same rules; its settings live in
  memory.

### Notification debug view

A read-only look at the raw stream, for checking the sorting. Sidebar
footer "Notifications" (debug) opens a pane over the middle and detail
columns: the stored `notification_thread` rows newest first (repo#number,
title, subject type, reason, GitHub's unread flag, updated) and where each
landed (`NotificationLanding`: tile with topic, or not a PR / PR not synced
/ no topic / topic hidden / no tile). Filters: reason, unread only, text.
A click jumps to the tile through `go()`, so Back returns to the list;
without a tile the row says why inline. The chevron shows the PR's five
newest stored events and the live poll's last three ping decisions for the
thread; the row itself shows the newest one under its last action
("withheld by the agent: the mention is an FYI · 3h ago", "pinged by the
rules: …", "pinged by the fallback (agent unavailable): …"), from
`ping_decision` (`NotificationDebugRow.pingDecisions`). A quiet mark-read
("Handled quietly") shows as the last action: "marked read by PostPile:
only bot activity since your last read", the bots in the tooltip. Opening a
row never marks anything read; the row's "Mark read" button and its last
logged action are described in "GitHub writes: lock, action log".

## GitHub writes: lock, action log

**What GitHub can and cannot do** (scouted 2026-09-28 with read-only calls
only: the REST docs and a GraphQL schema introspection,
`gh api graphql -f query='{ __schema { mutationType { fields { name } } } }'`,
261 mutations):

| want | API | notes |
|---|---|---|
| mark a thread read | REST `PATCH /notifications/threads/{id}` ([docs](https://docs.github.com/en/rest/activity/notifications#mark-a-thread-as-read)) | 205 Reset Content. The app's main notification write (`GitHubWriteClient.markThreadRead`). |
| mark a thread done | REST `DELETE /notifications/threads/{id}` ([docs](https://docs.github.com/en/rest/activity/notifications#mark-a-thread-as-done)) | 204. Removes it from the inbox for good (also from `?all=true` listings). Not used. |
| subscribe / ignore a thread | REST `PUT /notifications/threads/{id}/subscription` `{ignored}` ([docs](https://docs.github.com/en/rest/activity/notifications#set-a-thread-subscription)) | `ignored: true` mutes future notifications until you comment or get @mentioned. Changes future pings only, never read state. |
| unsubscribe (mute) a thread | REST `DELETE /notifications/threads/{id}/subscription` ([docs](https://docs.github.com/en/rest/activity/notifications#delete-a-thread-subscription)) | 204. Same: future notifications only. Used by "Remove <team>" (`GitHubWriteClient.unsubscribeThread`, 2026-09-29). |
| remove a team review request | REST `DELETE /repos/{owner}/{repo}/pulls/{n}/requested_reviewers` `{reviewers: [], team_reviewers: [slug]}` ([docs](https://docs.github.com/en/rest/pulls/review-requests#remove-requested-reviewers-from-a-pull-request)) | Used by "Remove <team>" (`GitHubWriteClient.removeTeamReviewRequest`, 2026-09-29). Re-adding the team notifies everyone again, so no undo. |
| reply in an inline review thread | GraphQL `addPullRequestReviewThreadReply(pullRequestReviewThreadId, body)` ([docs](https://docs.github.com/en/graphql/reference/mutations#addpullrequestreviewthreadreply)) | Posted right away, outside any pending review. Used by the detail pane's reply (`GitHubWriteClient.replyInThread`, 2026-10-05). |
| thumbs up on a comment or review | GraphQL `addReaction(subjectId, content: THUMBS_UP)` ([docs](https://docs.github.com/en/graphql/reference/mutations#addreaction)) | Takes IssueComment, PullRequestReviewComment and PullRequestReview node ids. Used by the detail pane's thumbs up (`GitHubWriteClient.addThumbsUp`, 2026-10-05). |
| subscription on the PR itself | GraphQL `updateSubscription(subscribableId, state: SUBSCRIBED/UNSUBSCRIBED/IGNORED)` ([docs](https://docs.github.com/en/graphql/reference/mutations#updatesubscription)) | Per issue/PR/repo, not per thread. Future notifications only. |
| mark a thread **unread** | none | No REST endpoint. The public GraphQL schema has no notification type and no notification mutation at all (the ones github.com uses internally are not exposed). |
| "Saved" notifications | none | Neither REST nor GraphQL can list or set them. `GET /notifications?all=true` only adds read threads. |

So nothing brings a read thread back on GitHub. Re-subscribing does not
help either: marking read never unsubscribes, so a thread that was only read
is still subscribed.

**The lock.** GitHub writes are a runtime switch (`WriteSwitch` in
engine `writes/`), flipped by the lock in the status footer
(`POST /api/github-writes {enabled}`), kept in meta `github_writes`
("on" / "off") so it survives restarts. With no choice stored, the default
decides: on in the packaged app since 2026-10-05 (see "On by default"
below). While off the switch hands out the `ReadOnlyWriter`, so a path that
forgets to ask still cannot write. `POSTPILE_READ_ONLY=1` never builds the
real write client; the lock then shows disabled with the reason and turning
it on answers `ok: false`. Opening the lock asks in a popover ("Mark-read
and approvals will reach GitHub"); closing is instant. The UI guard follows
it: approve and comment are blocked while locked (no pending queue for
them), mark read and "not mine" run and become pending writes.
`CODE_MANAGER_ALLOW_WRITES` is gone.

**The lock lives in the footer only** (2026-10-05). It is an opt-out, not
something PostPile asks for: while writes are on the footer shows a faint
open-lock icon (a click locks), locked it is a quiet "read-only" in the
footer's text colour, never amber or another alarm colour, with the pending
count next to it. No other surface pushes it: the busy inbox card lost its
"Unlock writes" link and its "With GitHub writes locked…" Why? line. A
write that is blocked because the user locked writes still says so in its
tooltip or toast ("…GitHub writes are off. Open the lock in the footer…").

**On by default** (2026-10-05, NEXT.md "GitHub writes on by default").
With the lock closed PostPile cannot mark anything read on GitHub, so a
heavy inbox only grows; telemetry showed 2 of 14 installs with writes on,
and a heavy user's board dropped to 250 hot PRs once he turned them on. So:

- No `github_writes` key (the user never touched the lock) means writes on,
  as long as the real writer exists. An explicit "off" stays locked: the
  user chose it. `POSTPILE_READ_ONLY=1` wins over both.
- Only the packaged app gets the default (`writesOnByDefault` in
  `create.ts`: lock kind `packaged` and the default profile). Dev runs keep
  the old default, locked: the unpackaged desktop app, `pnpm server`, the
  CLI, the simulation (which also stores "off"), and a packaged build on the
  dev profile. A dev session never writes because nobody chose
  (`create-writes-default.test.ts`).
- Once per install, at the first sync with gh working
  (`Engine.keepWritesDefault`, before the sync's fetch): the default is
  stored as "on", logged as `writes_on` with origin `default`, and sent as
  `github_writes_changed { enabled: true, from: 'default' }`. Stored first,
  so a lock click during the send is never overwritten.

**The backlog when writes go on by default.** An install that ran locked
can hold days of pending mark-reads. A hand unlock offers Send N / Discard
and sends through the guard: each thread is read again, a thread that moved
since the click is decided again (`ClickedReadRetry`). The default switch
sends less, since nobody pressed Send and the clicks can be days old
(`PendingWrites.sendAfterDefault`):

- Only `mark_read` writes. A waiting inbox cleanup (`catch_up`,
  `mark_all_read_before`) stays pending for the user to send or discard
  from the footer: it is bulk, and the user picked it while locked.
- A thread is sent only when it is unchanged since the click
  (`markThreadReadIfUnchanged`): that is exactly what the click asked for,
  and nothing new is marked read with it. Already read elsewhere: cleared,
  the PR turns read here.
- A thread with newer activity is left unread and drops out (logged
  `skipped`, "GitHub didn't take it: activity after the last sync; still
  unread"). It is not decided again: that second decision belongs to a
  fresh click, and the send runs inside the sync, whose refresh the retry
  would wait for.
- A failed send stays pending with its error, shown in the footer's count
  and popover ("These did not reach GitHub yet": Send / Discard / Lock).
- Every row is in the action log with origin `default` ("marked read by
  PostPile when GitHub writes went on by default" in the debug view). A
  footer Send already running is left to itself.
- The footer can still Discard while it runs: Discard asks the send in
  flight (this one or a footer Send) to stop before its next write, waits
  for the write it is on, then drops the rest. Each write is read from the
  store again right before it is sent, so a row gone meanwhile sends
  nothing.

**Pending writes** (2026-09-28). GitHub is the source of truth for read and
unread; the app never holds a read state GitHub doesn't have. So a mark-read
while locked (tile, detail pane, "not mine", debug row, quit flush) does not
make the tile done:

- The click goes through the queue as usual, so the 6s undo works. Nothing
  changes in the app. When the window runs out (or on quit) the queue parks
  the batch (`MarkReadQueue` -> `PendingWrites.park`) into `pending_write`
  (migration 011, one row per click: PR keys, keys to mark handled, threads
  with their synced `updated_at`, last error). Logged as `pending`.
- A batch queued unlocked whose window ends after the lock closed is parked
  too; the local change it already made (events seen, handled) is put back.
- PRs with no unread GitHub thread have nothing to disagree with: they
  change in the app right away (logged `local`), locked or not.
- Tiles holding a pending PR carry `TileView.pendingWrite` and show a
  neutral "pending: mark read on GitHub" marker (clock glyph, tooltip about
  the lock); their Mark read button is disabled. The footer lock shows a
  count badge (`GitHubWritesStatus.pending`).
- Unlocking opens a popover that lists them (count, first five titles):
  "Send N to GitHub" (unlock, then `POST /api/github-writes/pending/send`),
  "Discard" (unlock, drop them), "Cancel" (stay locked), and "Discard
  pending, stay locked". With writes on and something left (a failed send)
  a click on the lock offers Send / Discard / Lock. Under
  `POSTPILE_READ_ONLY=1` it only offers Discard.
- Sending goes thread by thread through the same path as the queue
  (`markThreads`: re-read the thread, skip on newer activity, else
  `GitHubWrites.markThreadRead`), origin `footer`. A PR turns read here only
  once its thread is through (sent or already read): events up to the
  click seen, pinged PRs handled. Skipped threads (activity after the last
  sync) drop out and stay unread. Failures stay pending with the error.
  Refused (`ok: false`) while writes are off.
- Discard (`POST /api/github-writes/pending/discard`) drops the rows, logs
  `discarded`, and changes nothing else: the tiles stay unread, exactly as
  GitHub has them.
- Pending writes survive restarts (SQLite).
- A thread with a pending write that the sync or the live poll sees leave
  the inbox (read on github.com or another client) clears it: the PR turns
  read here like a send that found it already read, logged `observed` with
  origin `sync` / `poll` (detail "pending mark-read cleared").

**Not taken by GitHub** (2026-09-28). A batch sent with writes on already
changed the app at the click. When a thread of it fails or is skipped for
newer activity (queue send, quit flush, or writes turned off mid-send), that
PR's local change is put back (`putBackNotTaken`: its events unseen, handled
cleared), so the tile is unread again. Log detail, sync report note and the
pending-send result all say "GitHub didn't take it: <reason>; still unread"
(a failed pending send says "still pending"). A mark-read with writes off
at send time is now logged `skipped` instead of `local`.

**Newer activity after a click** (2026-09-30). A user's mark-read (tile,
PR, detail, debug view, a pending send) that the guard skips for activity
after the last sync used to pop the tile back unread about 6s after the
click, even when the new activity was the user's own pushes and a review
bot's comments. Now the queue decides it again before putting anything back
(`ClickedReadRetry`, core `clickedReadCheck`): the PR is fetched with the
same refresh as after a write (or the running full sync; nothing while the
quota is critical), then the bot-only rule runs from the click's cutoff (the
thread's `updated_at` the click saw). Only the viewer's own activity and
automation since (the click means "I saw what PostPile showed me"), and the thread is marked read
on GitHub now, guarded again against the fresh `updated_at`, logged
"marked after refresh: only your own activity". A person's activity since,
or a snapshot that still does not cover the thread, and it stays unread:
the click is put back, logged "kept unread: new review from alice", and the
live status carries `keptUnread` for the toast ("New since you looked: a
review from alice"). While it decides the thread is held: the inbox leaves
its row alone, so the tile never turns unread in between. Not on quit. The
quiet reads keep their own rules.

**A poll inside the undo window** (2026-10-01). Approve queues a mark-read
and starts a refresh poll right away, inside the 6s window. GitHub still
lists the thread unread until the queued write lands, and the poll stored
that row, so the PR went back to unread; the later mirror of the write
fixed the database but did not move the live status' `changeCount`, so a
sidebar that was open kept its unread count and dot. Now a thread of a
batch still queued or being sent (`MarkReadQueue.threadIds`) keeps its
local read row against the same unread row from the inbox. The queued set
is taken before the inbox request and again after it, so a send that lands
while the request runs cannot let the stale unread answer through. Newer
activity (a later `updated_at`) or a read elsewhere still replaces it, as
above.
Every mirror of a write that landed also counts into `changeCount`.

**One door.** `GitHubWrites` is the only thing in the engine that calls the
writer: approve, comment and the mark-read queue go through it. Every call
asks the switch and writes an `action_log` row (reached GitHub, failed with
the error, or not sent because writes are off). A mark-read batch is only
sent when it was queued with writes on and they are still on when its
window ends; otherwise it is parked as a pending write (a batch queued
locked stays pending even if the lock opens inside its window: the unlock
popover is where the user decides).

**Action log** (`action_log`, migration 008): `id`, `at`, `action`
(`mark_read`, `undo_mark_read`, `approve`, `comment`, `remove_team_request`,
`unsubscribe`, `writes_on`, `writes_off`, `agent_refresh` = an outside agent's
GitHub re-read, see "refresh_from_github"; `bring_back` only on old rows, see
below; `mark_done` / `subscribe` get added with their writer methods),
`origin` (who decided: `tile` = the user in a tile (and the detail pane
before 2026-09-29), `detail` = the user in the detail pane (PR-scoped mark
read, remove team request), `debug` = the notifications view, `queue` = the
deferred queue when a batch's window ran out, `quit` = the flush on quit,
`sync` / `poll` = a thread left the inbox, `footer` = the lock, also sending
or discarding pending writes, `cleanup` = the inbox cleanup (action
`inbox_cleanup` for a run as a whole), `quiet` =
PostPile itself after a full sync, see "Handled quietly", `agent` = an
outside agent through the MCP server), `outcome` (`queued`, `pending`, `discarded`,
`github`, `local`, `skipped`, `failed`, `observed`), `thread_id`,
`pr_key`, `tile_id`, `batch` (a UUID per mark-read batch, links the queue
send to the click that queued it), `detail`. Rows at queue time: one per
queued thread (`queued`; detail says it turns pending when locked) and one
`local` row per PR without an unread thread that changed right away. At the
end of the window while locked: one `pending` row per thread. Older rows
may carry `local` for a read-only mark-read from before pending writes. Rows at send time: `github`, `failed`,
`skipped` (activity after the last sync; the PR goes back to unread),
`observed` (already read on GitHub). `GET /api/debug/actions?limit=` lists the newest.

**What marks read without a click** (grepped: `markThreadRead`,
`notifications.markRead`, `markSeen`): one thing writes to GitHub on its
own, "Handled quietly" (bot-only activity since the user's last read, only
while the lock is open, logged with origin `quiet`; see that section).
Locally, the full sync and the live poll mark a stored thread read when it
drops out of the inbox (read on github.com or another client); those rows
are logged as `observed` with origin `sync` / `poll`. Every sync and poll
that changes the threads also marks events older than their thread's
`last_read_at` seen (event state, not logged) and may move a topic's seen
cursor ("Reconciling with GitHub's read time"). Glances, consolidation, dossiers and ping decisions never mark
anything read. There is no CLI write. The only bulk mark-read is the inbox
cleanup, a deliberate choice in its dialog ("Inbox cleanup"). The quiet
reads ("Handled quietly") are the other writes PostPile makes by itself.

**Debug view rows.** Each row carries `lastAction` (the newest log entry for
the thread or its PR) and `decidedBy` (for a queue send, the click that
queued it), rendered as "marked read by the deferred queue, queued by you in
a tile · 3m ago", "pending while locked · marked read by you in a tile, not
on GitHub yet", "pending mark-read discarded: unread, like on GitHub". A
read thread without an entry reads as "read on github.com or another
client". Filter "Read by this app": the newest entry is the app's own
mark-read, sent or queued with writes on. Filter "Pending while locked":
a pending (or failed pending) mark-read.

**No bring back** (removed 2026-09-28): GitHub is the source of truth for
read and unread, and nothing marks a thread unread there, so an app-only
"bring back" just split the state (tile unread here, thread read on GitHub).
The button, `POST /api/prs/.../bring-back`, the `brought_back` unread reason
and `user_pr_state.brought_back_at` are gone (migration 010 drops the column
008 added). Old `bring_back` rows stay in the action log as history and read
as "brought back in the app (removed feature)".

Fake mode runs the same flows on `FakeWrites`: the lock (off at start, not
persisted), the log, queue sends after 6s that only flip the sample thread's
"GitHub" unread flag, pending writes (in memory) with send and discard.

## GitHub unread is PostPile unread (2026-09-30)

Julian's GitHub inbox showed 155 unread notifications while PostPile showed six
unread tiles, after a day of keeping up in PostPile. PostPile's "unread" meant
"has unseen loud news", so quiet activity, done PRs, finished topics and
releases stayed unread on GitHub with nothing to do about them in PostPile: a
third state, done here and unread there. Julian: "I want nothing cleared that
potentially affects me, meaning even merged PRs where my team was the only one
assigned and I never looked. I want things cleared that are obviously
clearable, or they should still be unread in PostPile." A Codex (gpt-6-astra)
review of the 155 agreed: unread has to be a fact about the GitHub thread, not
about loudness.

**The rule.** Every PR notification that is unread on GitHub ends one of two
ways, and there is no third (other notifications are not part of it, see
"Notifications that are not PRs" below):

1. PostPile clears it by itself (marks it read on GitHub), because it is
   obviously clearable (below), or
2. it shows as unread in PostPile, and dealing with it there (Mark read, Mark
   done, Approve, opening it) clears it on GitHub.

A PR tile is unread while any tracked thread in it is unread on GitHub. Done,
whose move and snooze stay separate facts: a done tile whose thread went unread
again shows unread until it is cleared. A snoozed tile keeps its snooze but
still counts as unread (the Unread group, see "Groups inside a topic"). A finished topic never holds an unread
thread: the retire gate needs every thread read, and a retired topic whose
thread turns unread comes back.

**Obviously clearable.** PostPile marks a thread read on GitHub only when
everything since your last GitHub read, or since your last comment or review on
the PR, is one of:

- automation (the existing bots-only rule), or
- your own activity (the existing "you acted after it" rule), or
- human activity that is not an ask, judged by the events agent as not needing
  you. Julian: "I would actually want the agent to decide ... It's quiet if the
  teammate comments, all right, for example. Then we can mark it read in
  PostPile, but also on GitHub automatically." The events agent now also sees
  new quiet human events on unread threads (a teammate's comment, someone
  else's review, a push by the author), not only loud ones.
- bot talk (2026-10-06): a person's reply to a bot, a bot command, the
  empty review GitHub wraps a reply in. Settled by rule, no events agent
  call ("Bot talk leaves agent work").

Never clearable by itself: a review request to you or your team, a mention, a
team mention, a question or reply to you, an unseen merge without your review.
(Since 2026-10-02 a never-opened request that no longer stands may clear, see
"Handled quietly" › Review requests that no longer stand.)
These stay unread until you deal with them, also after the PR merged and a
teammate reviewed. Not clearance evidence either: an agent NOT_YOURS, age,
merged or closed state, an old handled mark or approval.

The existing safety checks stay: fresh and complete snapshot, the writes
lock (locked: the thread stays unread in PostPile), the guarded re-read of
the thread before the write, and an action-log entry ("Handled quietly").
The 10-minute grace after the newest activity was removed 2026-10-02
("Handled quietly" rule 5).

**Notifications that are not PRs** (releases, issues, discussions, security
alerts, CI runs, invitations): PostPile leaves them alone. They stay unread on
GitHub, show nowhere in PostPile (no tile, no count, no badge) and are never
marked read by the quiet reads. The only way PostPile clears one is the
explicit inbox catch-up dialog, row "Everything else, no activity for 14 / 30
days", which the user picks. The notifications debug view still lists them.

History: on 2026-09-30 the owner decided "PostPile clears all of this" and the
quiet reads marked every unread non-PR thread read on each sync and poll. On
2026-10-03 that was reversed: PostPile should not become an issue and
discussion sifter, and security alerts were being cleared silently. Topics for
releases, security alerts or issues were considered and parked; if they are
ever added, a tile alone (no right pane) is enough.

**Loudness keeps its job.** Pings, the coral "new since you looked", urgency
and sections stay tied to loud news. An unread tile with only quiet news (the
agent has not judged it yet, or a check blocked the clear) shows as unread but
does not ping.

**Start fresh.** The local-only "Start fresh here" hid things in PostPile that
stayed unread on GitHub, the state this rule removes. The inbox cleanup only
marks read on GitHub.

**First run.** The clear pass runs first; whatever is left shows as unread,
finished topics included.

**Built** (2026-09-30). Details the build settled:

- Tile state (core `deriveTileState`, Board passes the threads): snoozed,
  else unread while a member's thread is unread on GitHub, else done (every
  tracked PR done, no loud news), else open. `TileState.unreadOnGitHub` (a
  snoozed tile too, for the Unread group and the sidebar count) and
  `TileState.loud` (the old "unseen loud" unread) are separate facts;
  `PrSummary.unreadOnGitHub` keeps Mark read and the "Not done yet" dot on
  a done PR whose thread is unread. Unread reasons: the PR's loud news,
  else its newest unseen quiet event since the read, else "new activity on
  GitHub". Urgency ("needs you", coral topic) counts unread tiles with loud
  news only.
- Besides an unread thread, loud news on a pulled-in stack layer and an
  unseen Look closer event make the tile unread (owner, 2026-09-30: "It
  should get a dot and be unread"). Unread in PostPile while read on
  GitHub is fine; the rule only forbids read here while unread there.
- A Mark read with writes on reads the thread in the store at the click
  (so the tile turns read right away, not after the undo window); undo, a
  parked batch or a mark-read GitHub did not take puts it back unread.
- The quiet reads (core `quiet-reads.ts`) lost their "tile not unread"
  check (it would block itself); `unseen_loud` (no unseen loud event on the
  PR) stands in. The third case is `judgedReadCheck`: "since you last
  looked" is the newer of `last_read_at` and the viewer's last review or
  comment; a thread never read and never reviewed or commented on is left
  alone (`never_looked`). Judged means an override below loud on the
  event. Asks are `isAskOfViewer`; a mention of only routing teams is FYI
  ("Team roles"), not an ask, so the agent judges it like other quiet news.
  Log detail "nothing that needs you since
  you last looked: lyra, CI"; Handled quietly says "nothing for you from
  lyra, CI".
- The events agent (`EventBatchClassifier`) also gets people's quiet
  events on unread threads (`awaitsJudgement`): new ones after the classify
  cursor, and older ones on at most 40 PRs per sync (`JUDGE_BACKLOG_PRS`,
  newest unread thread first). One it leaves out of its answer gets a quiet
  override "nothing here needs you"; one it raises goes through the raised
  ping path. The budget caps the calls as before.
- Releases and issues: cleared by `isClearableNonPr` until 2026-10-03, now
  left alone (see "Notifications that are not PRs").
- Retire gate needs every thread read; `reviveUnreadTopics` runs after the
  retire step of the full sync and in every poll that moved the inbox. The
  full sync reads the unread state its quiet reads left, so a failed or
  capped write brings the topic back. The poll skips a thread the quiet
  reads would clear by rule (`clearableByRule`) while writes are on, so a
  deploy bot on a merged PR does not reopen its topic for three days; the
  poll's own quiet reads clear it at the end of the cycle (since
  2026-10-02), else the next full sync clears it or brings the topic back.
  The quiet reads moved before the retire step and share one budget of
  `QUIET_READS_PER_RUN` threads, PR threads first.
- The click's local thread read is put back (undo, parked, not taken) only
  while the row still holds the read time the click wrote; a read or new
  activity GitHub reported meanwhile stays.
- Snapshots cut off at the query caps (`Pr.truncated`, 48 of the 130
  unread PR threads on the day's real data) used to never clear.
  Normalizing (packages/github, caps in `QUERY_CAPS`) now records from the
  raw answer, before it drops any node, which lists came back full at their
  cap with more on GitHub, with the node count, the oldest item and the
  cursor to page on (`Pr.capHits`). Most capped lists keep the newest N (50
  reviews, 60 comments, 50 commits, 60 timeline items), so a cut snapshot
  still covers the unread interval when every list that hit its cap is one
  of those and came back with an item at or before the rule's boundary
  (GitHub's read time for bots only, the touch for "you acted after it",
  the last look for the judged rule, the newest review request of the
  viewer for "request gone"). Review threads count only once complete: the
  50 kept are the newest by creation and each keeps its first 30 comments,
  so a reply past either cap can come at any time. A snapshot stored before
  `capHits` existed never vouches until it is fetched again. A snapshot
  flagged while no list hit its cap (GitHub counts items the query never
  returns) covers. Since 2026-10-02 older pages of the capped lists get
  fetched for unread threads ("Handled quietly" › Capped snapshots).

## Inbox cleanup

Rewritten 2026-10-03 as the inbox catch-up dialog. Unread GitHub threads on
merged PRs keep tiles from being done and topics from archiving, and after
a vacation or on a first run the first sync spends agent work (topics,
dossiers, glances, classification) on PRs that are over. The dialog offers
to clear them on GitHub before that agent work runs, together with the
older "everything older than N days" cleanup. Rules in core
`inbox-cleanup.ts`, engine `InboxCleanup` (`actions/inbox-cleanup.ts`),
`GET /api/inbox-cleanup`, `POST /api/inbox-cleanup/clear`,
`POST /api/inbox-cleanup/start-as-usual`.

**Why keeping them is fine too.** A merged PR asks nothing of the user and
never pings. PostPile shows what needs the user first; these stay unread
until they get to them. Clearing is the user's explicit choice, never a
rule ("Not marked read from a guess" still holds).

**The two rows** (combinable, each with a checkbox):

1. *Merged PRs*: `Quiet 7+ days | Quiet 14+ days | All`. Counts unread
   threads whose PR PostPile fetched and knows is merged; a merged PR it
   never fetched (PR cap) is not counted. Quiet means the thread's last
   activity (`updatedAt`), not the merge date. A 7 / 14 option is disabled
   when it holds nothing or equals All. All includes merges without your
   review ("Includes N merged without your review").
2. *Everything else, no activity for* `14 days | 30 days`: unread threads
   that are not merged PRs, older than the cutoff.

The Clear button counts what the plan marks read: the picked merged PRs
plus every thread older than the cutoff (the PUT reads old merged threads
too, also with the merged row off).

**Cases** (constants and `startCase` in core). Load = unread threads.

| Case | Start dialog | Preselect | Main button |
|---|---|---|---|
| any start, < 20 unread merged PRs (`CATCH_UP_MERGED_THRESHOLD`) | no, sidebar line only | – | – |
| back after 2–4 days (`CATCH_UP_BACK_DAYS`) | "Welcome back", "Since Friday, …" (weekday of the last sync) | merged quiet 7+ (else the smallest enabled option), older off | Start as usual |
| back after 5+ days (`CLEANUP_GAP_DAYS`) | "Welcome back", "You were away 12 days. …" | merged all + older 14 | Clear |
| first run, light (< 50) | "Before the first sync" | merged quiet 14+, older off | Start as usual |
| first run, busy (50–300) | same | merged all, older off | Clear |
| first run, full (> 300) | same, Clear tagged Recommended | merged all + older 30 | Clear |
| from the sidebar, any day | "Clean up your inbox" | merged all + older 14 | Clear (Cancel instead of Start as usual) |

A row with nothing in it starts unticked. The saving line ("Clearing first
means the agent reads N PRs instead of M") shows for vacation, busy and
full: M = PRs the coming sync would glance (the glance writer's own check,
`pendingGlanceKeys`), N = M minus the merged ones the picks clear. Open PRs
keep their glance whether their thread is read or not, so only merged ones
count; with no saving the line is left out.

**The answer.** "Start as usual", Esc and a click outside record it (meta
`catch_up_answered_merged` = unread merged PRs left); so does Clear from the
start dialog. A short absence asks again only once 20 more merged PRs piled
up; a 5+ day gap or a first run asks anyway. Why the dialog may be due is
noted at each sync start (meta `catch_up_reason`: first run, or away since
the last sync) and kept until answered or until a sync found it not due, so
an app quit before the answer asks again on the next start. The old "Not
now: hidden 7 days" and the 14 / 30-days banner are gone.

**Before agent work.** The count needs PR states, so the fetch runs first.
When the start dialog is due, the sync stops right after the fetch
(`SyncReport.heldForCatchUp`, `SyncRun.holding`): no digest, quiet reads or
retire steps, no telemetry. While it holds, the live poll is blocked (it
would assign topics and start catch-ups). The answer starts the sync again
(`resumeHeldSync`, with the held sync's options): it fetches again, which
is cheap (unchanged PRs are skipped) and picks up what the cleanup's bulk
calls read, and digests both fetches (fetched PRs, new events and GitHub
read times of the held one count too). Clear resumes it once the run
ended; locked, nothing to clear, or Start as usual resume it at once. Only
an app with a window holds (`EngineDeps.catchUpGate`, set by createEngine
except for the CLI); a CLI sync never waits. The one-time topic tidy still
runs before the fetch: it reads stored topics only and costs the same
either way.

**Writes** (`planCleanup`, no batch endpoint exists; GitHub GraphQL has no
notification mutations):

1. Older row picked: one `PUT /notifications` with `last_read_at` = the
   cutoff (`GitHubWrites.markAllReadBefore`). Merged threads that old are
   covered by it.
2. Remaining merged threads, per repo: when every unread thread of the repo
   (up to the time the dialog counted) is selected, one `PUT
   /repos/{owner}/{repo}/notifications` with `last_read_at` = that time,
   never later, so activity after the count stays unread
   (`markRepoReadBefore`, logged as `mark_all_read_before` with the repo in
   the detail).
3. The rest: `PATCH /notifications/threads/{id}` one after another, about one
   a second (`CATCH_UP_PACE_MS`, GitHub's guidance for writes). No re-read
   before the PATCH: the user picked these.

The run goes in the background and the request answers at once. Each PATCH
reads the thread here like a read on GitHub (thread read up to its
`updated_at`, its events before that seen, `readLocally` with
`read_on_github`, then `advanceSeenFromGitHub`), so tiles go done and
topics can retire. GitHub may answer a PUT with 202 and finish it later,
so after the calls the run reads the inbox again every 5 seconds
(`CATCH_UP_CONFIRM_EVERY_MS`, a plain read, nothing stored) until the
threads the PUTs covered left it, at most 18 times (about 90 seconds,
`CATCH_UP_CONFIRM_TRIES`). Only those count as marked, and a held sync
keeps waiting meanwhile, so its fetch sees them read instead of spending
agent work on them. Still unread at the end: the run ends anyway and says
so ("Marked 170 read on GitHub; GitHub is still working on 21"). The PUTs
then show up here with the next inbox read (the resumed sync, else one poll
cycle). A failed call is logged and the run goes on; writes turned off
mid-run stop it. One `inbox_cleanup` action-log row per run sums it up
("marked 191 read on GitHub; 2 failed"), next to the rows of each call
(origin `cleanup`, one batch id). Telemetry: `marked_read` with origin
`cleanup` and the confirmed count.

Locked, the whole cleanup parks as one pending write (`pending_write.kind
= 'catch_up'`, picks and count time in `catch_up`, migration 026, the
covered threads for the count in the lock). Only one waits at a time: a
second Clear is refused (it would fail on Send while the first runs), and
the dialog and the sidebar line disable Clear with "A cleanup already
waits in the lock". Sending it from the lock plans
the same calls again over what is stored then and starts the run. Stored
`mark_all_read_before` rows from the old dialog still send.

**Glance targets after a clear** (checked 2026-10-03, no change needed): a
merged PR is a glance target only while its merge without your review is
unseen (`wantsGlance`). The PATCH mirror marks that event seen through the
read, so a cleared merged PR is not glanced; the bulk calls do the same
through the next inbox read.

**Progress and done.** Status footer: "Clearing merged PRs" (or "Clearing
old notifications"), a bar and "84 / 191"; the sidebar line reads
"Clearing 84 / 191". The view is polled every second while it runs. Done
toast: "✓ Marked 191 read on GitHub" with "Show", which opens the
notifications view (each thread's last action).

**Sidebar line**, any day: "12 merged PRs · Clear" whenever a merged PR is
unread, else "N old notifications · Clear" (older than 14 days). It opens
the dialog in sidebar mode.

**"✨ 8 of them look safe · Clear"** (added 2026-10-03), a second item on
the same line. Why: of the merged PRs, the user mostly cares about the
ones merged without their review, and for many of those the glance after
the merge ("Merged without your review" rule 4) already said there is
nothing worth a look. The item counts unread merged PRs whose *current*
glance (not stale, not being rewritten) says LOOKS_SAFE or NOT_YOURS
(core `isSafeMerged`, `CleanupCounts.mergedSafe`); no glance or LOOK_CLOSER
stays unread. It only reads glances that exist: counting or clearing never
starts, queues or moves a glance, and it shows only when the count is
above 0. Clear clears just those threads right away, no dialog: a narrow,
explicit click, so it fits "Not marked read from a guess". It is the same
run as the dialog's (`InboxCleanup.clearSafe`, `POST
/api/inbox-cleanup/clear-safe`): an explicit thread list
(`planThreadCleanup`: PATCH per thread, or a repo PUT where the selection
is all a repo holds), the writes door, progress line, done toast and one
`inbox_cleanup` log row; locked, one `catch_up` pending write carrying the
thread ids (`PendingCatchUp.threadIds`), and refused while a cleanup runs
or one already waits in the lock. Each PATCH reads the thread here like
the dialog's, so the merge counts as seen and the tile goes done.
While a full sync runs (not one held for the start dialog) the item's
Clear is disabled ("Waits for the sync to finish") and the engine refuses
it: the sync's dossier and glance steps can rewrite a LOOKS_SAFE glance to
LOOK_CLOSER, and only catch-up runs show as "writing". The view
(`InboxCleanupView.syncing`) is refetched when the sync ends, which
recounts.

- **Fake mode**: 24 unread threads on merged sample PRs that never become
  tiles (eight with a glance that looks safe, two Look closer), plus three
  old ones; every fake start is a first run, so the start
  dialog shows (`POSTPILE_FAKE_CATCH_UP=0` turns it off, the README
  screenshots do). A run flips the sample threads one call per step.
- **History.** 2026-09-28: "mark everything older than 14 / 30 days read",
  a banner after a 5+ day gap, "Not now" for a week. 2026-09-30: "Start
  fresh here" removed ("GitHub unread is PostPile unread"; migration 021).
  2026-10-03: this dialog.

## Groups inside a topic (2026-09-30)

The tile grid had an All / Unread toggle next to folded Snoozed and Done
rows. Switching it deselected the tile, kept a filter state and special
cases in selection, and the renderer worked out "unread" and "done" from
the raw tile state itself (`isUnreadTile`, the fold filters, the NEW pill
check), a second copy of core's rules. Owner decisions (2026-09-30):

- **Core ships display decisions, the renderer only displays.** Each
  `TileView` carries its `group` in the topic (core `tileGroup` in
  `tile-groups.ts`): `unread` (the tile is unread by "GitHub unread is
  PostPile unread", a snoozed tile with an unread thread too), `open` (read,
  not dealt with: your move, waiting on someone, snoozed) or `dealt_with`
  (tile state `done`). It also carries `newBadge` (`tileNewBadge`: the coral
  NEW pill, never on a headline made by automation unless it is loud). The
  topic's unread count (`TopicListItem.unreadTiles`, the sidebar bubble; the
  footer adds the topics up) counts the Unread group (`topicUrgency` calls
  `tileGroup`). `apps/desktop/src/main/renderer-rules.test.ts` fails when
  renderer code compares a tile state with `unread` / `done` or reads
  `unreadOnGitHub` or `automation` again. The one exception is the
  optimistic guess after a click (`lib/optimistic.ts`), from `afterRead`,
  until the refetch brings core's answer.
- **Three groups, always in this order: Unread, Open, Dealt with N.**
  Empty groups don't show. Dealt with is folded by default and follows the
  user's last click on it: opened stays open, closed stays closed, for the
  rest of the session in every topic (App state). The search filtering or a
  selected tile in it opens it only while that lasts and leaves the user's
  choice as it was.
  The group's name and count sit right on top of its first tile, no box
  around them. Core's order is `TILE_GROUP_ORDER`; the renderer's copy is
  typed with `TileGroupOrder`, so a drift fails to compile.
- **Open and Dealt with at once (2026-10-02).** Tile state is about the
  user's move, PR state is about GitHub, so a PR can be open while its tile
  is Dealt with (the owner's own draft, a PR waiting on others). The topic
  then never reaches the Archive box (`RetireGate.nothingLeft` wants every PR
  merged or closed), and nothing said why. After the Tiles count the header
  shows a muted "· 1 PR open" / "· 2 PRs open", same type scale as the count,
  only when core's `TopicDetail.openInDealtWith` has PRs: open PRs that sit
  only in Dealt with tiles, minus pulled-in stack layers (not topic members,
  so the Archive gate ignores them and the hint must agree). Its tooltip
  names them: "Still open: devex-depot-tools#3 (draft). The topic moves to the
  Archive once every PR is merged or closed." Decided 2026-10-02.
- **No toggle.** The All / Unread buttons, "switching to Unread deselects",
  the filter-aware auto pick and the "show All" empty text are gone.
- **Selection:** the selected tile keeps its place (`useHeldPlace`, now over
  the three groups); a tile moves groups after a mark (a click, or the
  opened mark when the dwell ends), shown once the selection moves on, with
  a slide (2026-10-01, "Marked when the dwell ends"). Its look changes
  right away.
- **Wording:** "Dealt with" labels tiles wherever the app names the group
  (tile grid, counts, MCP `[PR, dealt with]` tile lines, the dev CLI); the
  internal state stays `done`. Topics that are really over stay "Finished".
- **Tests** (restated independently in `@postpile/core/testing`,
  `invariants-screen.ts`, `properties/screen.test.ts`): every tile is in
  exactly one group, the one the spec gives it; group Unread exactly when
  the tile has an unread dot; the unread count is the number of unread
  tiles; the NEW pill shows only on unread tiles and never on an automation
  headline left quiet; the groups come in the order Unread, Open, Dealt
  with. The fake engine builds its tiles through `buildTileView`, and its
  rules test checks the groups and the counts per topic and in total.

## Agent-assisted actions (2026-09-30)

Approve and Mark read on a whole topic or tile, offered when the agent's
current verdicts back them. Mockup: https://claude.ai/artifact/UQz3CKZwhJbSg6MgbQrhMS.
Owner decisions (2026-09-30):

- **The ✨ rule.** ✨ marks an action that is on offer because an agent's
  verdict supports it. It sits in a pill on the button, and the pill says
  what the agent judged: the risk level (`✨ low`, `✨ medium`) or why it
  cannot back the action (`✨ look closer`, `✨ high`, `✨ rechecking…`).
  Actions that work without the agent never carry ✨.
- **Agent-safe PR.** A current glance (not `glanceStale`, not missing),
  verdict `LOOKS_SAFE`, risk low or medium. The risk level is the first
  word of the glance's `risk` line ("medium - touches the worker loop"). An
  unreadable risk word counts as high.
- **Approvable PR.** Exactly today's Approve rule (`paneOffers`, primary
  action `approve`): someone else's open non-draft PR, tracked (not a
  pulled-in layer), not approved at its head, not dealt with, and nobody
  has approved it yet (a standing approval on GitHub, or the review
  decision says approved; owner, 2026-09-30: an agent Approve on an
  approved PR is redundant noise). Such a PR is neither covered nor left
  out; the pane's own Approve stays.
- **Greyed out or gone.** Something to act on but no agent backing: the
  button stays, disabled, with the reason in its pill. Nothing to act on at
  all: no button.
- **Tile Approve** (new button in the tile footer). Gone when the tile has no
  approvable PR. Active when at least one approvable PR in the tile is
  covered: it approves only those (a stack base to head), names the rest
  as left out, and the pill shows the highest risk among the covered PRs.
  Greyed out only when nothing is covered. The reason is `rechecking…` when
  any approvable PR's own glance is stale or missing, else `look closer` or
  `high`. The topic's Approve covers exactly the union of what its
  unsnoozed tiles cover.
  Owner, 2026-10-01: the tile Approve is the same magic approval as the
  topic's; the earlier all-or-nothing tile rule was a spec mistake and
  greyed a stack while the topic offered two of its PRs.
- **Base up on a stack** (owner, 2026-10-01). A stack layer is covered only
  when it is agent-safe and no approvable layer below it is left out. The
  lowest approvable layer the agent does not back (rechecking, look closer,
  high) blocks every approvable layer above it; those are left out as
  "waits on #N" (`layer_below`, with `waitsOn`). Layers below that need no
  review from the user do not block: merged or closed, a draft, the user's
  own PR, one the user or anyone else approved already, one dealt with
  (done), a pulled-in layer.
  On a stack only the lowest blocking layer keeps its own reason, so a
  greyed stack's pill shows that layer's block ("Look closer"), never the
  new reason. A set's PRs outside a stack keep their own verdicts; a stack
  inside a set goes base up like a stack tile. Why: the glance on an upper
  layer says "safe once the base is settled", so approving it above a base
  that needs a look made no sense, and the topic followed the tiles into
  the same mistake.
- **Approve labels** (owner, 2026-10-01; core decides `naming`, the
  renderer spells it). Exactly one PR covered out of several on the tile
  (or the topic) names it: "Approve #2107", so "Low risk" can't read as a
  verdict on the PR the user is looking at. "Approve stack", "Approve 3
  PRs" on a set, or "Approve" on a single only when every PR on the tile is
  covered (`prCount`), so never over a draft or pulled-in layer. Else
  "Approve 2 of 3 PRs" (approvable PRs), or "Approve 2 PRs" when it covers
  every approvable PR and only drafts or pulled-in layers stay out. Greyed
  is a plain "Approve".
- **Topic Approve** (topic header). It covers the approvable PRs in the
  topic's tiles, leaving out snoozed tiles. It approves only the agent-safe
  ones: "Approve 3 of 5 PRs", or "Approve 3 PRs" when all qualify. Each PR
  left out is named with its reason (look closer, high risk, rechecking,
  or "waits on #N" for a stack layer above one that needs a look).
  A PR whose recheck comes back safe joins the count. Greyed out when no
  approvable PR is agent-safe, with `rechecking…` if any is rechecking,
  else `look closer`.
- **Approve is final, so it asks first.** Both Approve buttons open a
  confirm list: each PR with its verdict and risk line, plus the PRs left
  out and why. Each PR goes through the existing approve path with its
  head guard (`approve(prKey, headOid)`), and the result is reported per PR.
  Optimistic like the pane's Approve.
  No Undo after any approve, not even for the mark-read that follows.
  At click time the engine checks each PR again against the current board
  with the same core rules (`agentApproveRefusal`); one that no longer
  qualifies is refused and named ("the agent now says look closer"), the
  rest are approved. On a stack each covered layer carries the covered
  layers below it (`dependsOn`); the engine skips it when one of those failed
  or did not go first in the batch ("skipped: a layer below failed",
  `agentApproveSkip`), so an upper layer is never approved over a base
  that wasn't. Unrelated PRs carry on. Mark N read skips and names tiles no longer backed
  (`agentMarkReadRefusal`) and refuses unknown tile ids.
- **Mark read skips asks.** Only actions carry ✨, never text or lines. A
  tile's Mark read is always on offer, so it stays plain: no ✨, no pill, the
  old route. Core's tile backing (the unread news holds no ask for you, and
  every unread PR that gets a glance has a current one that is not
  `LOOK_CLOSER`, low or medium risk; it waits for a glance only on PRs that
  get one: open PRs, and merged PRs merged without your review until you
  have seen that (`prWantsGlance`, shared with the engine). Any other merged
  or closed PR waits for none and its older glance is ignored) only feeds the topic's "Mark N read", which covers the
  unread, unsnoozed tiles whose backing is active. Tiles with an ask for you
  are skipped and stay unread. It is gone when no tile is unread; when tiles
  are unread but none qualify it shows a plain "Mark read" greyed out, with
  `✨ Needs you` or `✨ Rechecking…`. Active, it says `✨ No ask for you`.
  It keeps the 6s Undo for the whole batch.
- **Pill wording and placement.** Approve: `✨ Low risk` / `✨ Medium risk`
  when active (tooltip "Agent verdict: Looks safe."), `✨ Look closer`,
  `✨ High risk`, `✨ Rechecking…` when greyed. A greyed Approve is a plain
  "Approve" plus the pill, never a count. The topic buttons sit on their own
  row under the "Tiles N" line (only the count: the Unread label below says
  how many are unread), with a muted "for this topic" trailing them, above
  the first group; the row is gone when both offers are. Active Approve is
  soft green (light green fill, green text and edge) with a green pill;
  greyed buttons keep the dashed outline with a pill in the colour of the
  reason (2026-10-01, was always honey): amber for Look closer, red for
  high risk, honey when it asks for you, neutral while rechecking. Filled green is only the confirm dialog's "Approve N".
- **Tile footer (2026-10-01, design 4b/5e).** No ink button. Left: the turn
  line, then the tile's Approve (✨) right next to it; next to Approve the
  move text needs a wider footer before it shows. Right: Mark read, Snooze,
  Open, Review on GitHub and ⋯ as one joined control (one outline, hairline
  dividers), in every footer. Everything is 28px high.
- **Group labels (2026-10-01).** Unread, Open and Dealt with line up with
  the tile text (16px: the tile's 15px padding plus its frame). The marker
  hangs in that padding: coral dot for Unread, chevron for Dealt with,
  none for Open. The whole Dealt with row is the button: open, a 28px row
  "Dealt with N", a hairline rule and "Hide"; folded, a 32px bar with the
  first tile's title and "Show".
- **Core decides, the renderer displays.** Core ships each offer on
  `TileView` and on the topic's view model: kind, state (active/greyed),
  counts, risk, reason, covered PRs or tiles, and left-out PRs with reasons.
  The renderer works none of it out (see "Groups inside a topic" and the
  static renderer rule test).
- **Telemetry.** `pr_approved` with `from: agent_tile | agent_topic` and
  `was_agent_approved: true`. `marked_read` with `origin: agent_tile |
  agent_topic` and the tile count.

## Topics with: the sidebar filter (2026-10-01)

The four pills above the sections (Mine, Team, Reply, Review) answered
questions the sections already answer, looked like tabs to another list,
and left it unclear what was on: in usage data a filter was switched off
again almost as often as it was switched on. One open PR of the viewer's
also put a whole project-size topic under My PRs, above To review, where a
teammate's PR in it that waits on the viewer's review was out of sight.
Owner decisions (2026-10-01), after a UX pass (design "9c"):

- **One switch, worded as a sentence: "Topics with any PR | my PRs | team
  PRs".** It says it narrows which topics show, not which PRs. "any PR" is
  the way back; a narrowing option on is drawn in the accent. Team hides
  without a home team, as before. Reply and Review are gone: the Needs reply
  and To review sections are those.
- **The sections stay while it narrows**: the switch says which topics,
  the sections still say what needs you and whose topic it is. Under "team
  PRs" a topic can sit under To review or Your team owns, by what it asks
  of you and who drives it.
- **A mixed topic follows the work** (2026-10-01, replaced 2026-10-02 by
  "Ownership sections"): a topic's section was the highest tier any PR
  other than your own gave it, My PRs only when nothing else asked for one.
  It let a teammate's plain PR pull the viewer's own project under Team's
  PRs.
- **What it hid is said**: "11 topics without your PRs are hidden · Show
  all" under the sections. Other topics narrow with it; Finished steps
  aside, as with search (finished topics have no open PRs).
- **An opened topic always shows all its tiles**, filtered or not, and
  **your own tiles come first in every group** (Unread, Open, Dealt with),
  in every topic and view (`gridGroups`), then tier order. No new markers:
  no row chips, no banners.
- Usage telemetry keeps `queue_filter_changed`; its `filter` is now `mine`,
  `team` or `none`.

## Ownership sections (2026-10-02)

**The problem.** Sections came from PR tiers: a topic sat under the highest
tier any PR other than the viewer's own gave it (`topicSection` of
2026-10-01), so "My PRs" and "Team's PRs" said whose PRs a topic held, not
whose topic it was. Real case: the viewer drives "Snapshot
triage tooling" (the header said "you're here because you drive it"), has an
open PR in it, and a teammate has one open PR in it (tier `team`, which asks
nothing of the viewer). The topic sat under Team's PRs. The rule was
lopsided as well: a teammate-driven topic with the viewer's PR sat under
Team's PRs, another team's topic with the viewer's PR under My PRs.

**The data** (an illustrative database, 100 active topics, every one with a
driver): the viewer drives about a quarter, a teammate about a tenth,
someone outside the team the rest (most of them reached the viewer as
routed reviews). A handful of topics held the viewer's open PR, some of
them driven by others.

**Precedence** (`topicSection` in core `topic-sections.ts`, first match
wins; the engine, FakeEngine, the row, the breadcrumb and telemetry read the
same value):

1. Retired: Archive.
2. An open ask, most urgent first: Needs reply, Changes you requested (any
   open change request, addressed or not), To review, Team mentioned, as
   the PR tiers of the same name. An ask pulls a topic up only while it is
   current; once it clears the topic goes back to its owner section. `mine`
   and `team` tiers ask nothing and pull nothing up.
3. FYI (the dossier's relation) without stronger evidence: Other topics,
   FYI fold. Stronger is the viewer's open PR or move, or the viewer or a
   teammate driving it.
4. The viewer drives it: **You drive**.
5. A teammate drives it (a member of any home team, `Viewer.teamMembers`),
   or the team does ("Your team" picked, or the dossier's driverTeam):
   **Your team owns**.
6. Someone else drives it, or "Someone outside your team" is picked:
   **Other work**.
7. Nobody known to drive it: the owner team. Any home team: Your team owns;
   another known team: Other work; unknown: Other topics.

The driver comes in as a relation: the user's pick when there is one,
else the automatic driver (`effectiveDriver` in core `topic-driver.ts`, see
"Driver picker").

**The owner team is only a fallback.** Codex's review (gpt-6.1-sol) pointed
out how weak the signal is: `relationSignals` names the viewer's first home
team as owner as soon as the viewer wrote a PR in the topic or drives it.
So driver beats owner team: Alerting rework (driven outside the team) and
Tracing basics leave Your team owns for Other work, and a
teammate-driven topic owned by another team (Python upgrade soak)
stays under Your team owns. The owner team counts as home when it is any
of the home teams, not only the first.

**No dossier yet.** A real ask or a known driver places the topic as above
(without a dossier the sync names the most frequent PR author as driver).
With neither it goes to Other topics with a small, muted "not sorted yet"
marker. "Involved" is positive evidence only: the viewer's open PR or
move, a known driver, an owner team, or a team or routed relation; a
missing relation does not count. A topic with a dossier but no driver and
no owner team also stays in Other topics, without the marker.

**Inside a section** core orders the topics (`compareInSection`): the
viewer's open PR or move first, then unread ones, then the urgency order as
before. Changes you requested still lists re-reviews first.

**Folds.** You drive and Your team owns are short lists without folds.
Other work folds and folds by area: areas with two or more topics get a
fold, alphabetically; single-topic areas and topics without an area gather
under "More". Other work and each area fold start open when they hold the
viewer's open PR, a move of theirs or an unread topic, else folded; a
manual fold is kept for the session. While folded, urgent (coral) unread
rows stay visible under the header and the header says "· 4 unread · 1
urgent". The selected topic counts like an urgent row: a fold holding it stays
open and a folded one keeps its row, so marking it read never makes it vanish
before the selection moves. The defaults are worked out on the topics the "Topics with"
switch leaves, so the switch no longer opens these folds; the search still
opens every fold. FYI and the Archive start folded as before.

**What stays.** The "Topics with any PR | my PRs | team PRs" switch
answers "where are my PRs" across all sections; sections answer "whose
topic is this". Section names read as sentences and never say "PRs". The
header's relation chip (team / routed / FYI) stays and still says why the
topic reached the viewer.

**Driver picker** (decided 2026-10-02). "<login> drives" on the topic
header is a button. Its menu ("Who drives this topic?") lists You, each
teammate by name (`Viewer.teamMembers`), Your team ("Shared, no single
driver"), Someone outside your team ("No name needed": nobody cares who
inside another team drives), and Reset to automatic once a pick is set.
Each item shows the section the topic moves to below the asks
(`sectionBelowAsks`); while an ask holds the topic, the menu says it stays
there until the ask clears. Picking moves the topic at once and the
selection stays on it. The label then reads "You drive", "<login> drives",
"Your team drives" or "Someone outside your team drives", with a small "set
by you". The pick lives in its own table (`topic_driver_pick`, migration
24) as a login, `:team` or `:outside` (colons never appear in GitHub
logins), apart from `topic.driver`, which each sync's
`refreshDriversAndRoles` keeps refreshing from the dossier or the PR
authors. The pick always wins and no new event lifts it, unlike the
relation "Wrong". The user's role follows the pick ("You" makes them the
driver). The pick goes into the dossier prompt ("Who drives, as the user
set it"), so the summary stops calling someone else the driver; the
agent's own driver never moves a picked topic. "You" on another team's
code is valid: the header keeps "Owned by <team>" from the owner signal
and the relation chip as they are. Local only, never a GitHub write;
telemetry `driver_set` carries the kind (you, teammate, team, outside,
automatic), never a login. The pick never feeds `relationSignals`, which
read the automatic driver only: the relation chip says why the topic
reached the user, so picking "You" on a routed topic keeps it routed.

**Team as driver** (decided 2026-10-02). Standing topics often have no
single driver: the home team keeps them up and different people lead each
wave. The dossier agent may say so with `driverTeam: true` (and nobody in
the driver role) when the user's own team keeps a standing topic up and
nobody leads the current wave; not when one person clearly runs it. The
parser keeps driverTeam only while no person has the driver role and the
topic is standing (project topics drop it, after the answer's own
`topicKind` correction).
`driverOf` in engine `digest/topic-roles.ts` stores it as the automatic
driver `:team`, the same value as the picker's "Your team", so the topic
sits under Your team owns. Real case: Egress, where the agent named
lyra, who led one wave. Picked up at each topic's next dossier
update; no one-time tidy. A manual pick beats it like any automatic driver.

## Dealt-with topics leave the list (2026-10-02)

PostPile is an inbox-clearing tool. A topic where nothing waits on the viewer
is dealt with, and like Gmail's archive, Superhuman's Done or GitHub
notifications' Done it leaves the list until something new arrives. Why:
owner, looking at the new sections: "whew, everything looks dealt with", and
clicking a dealt-with topic only to find nothing to do is unsatisfying. This
grew out of dimming those rows (quiet rows, same day): dimmed rows still took
the space and the clicks.

Dealt with is not Archive. Archive means the topic is over (every PR merged
or closed, then quiet days); a dealt-with topic is still live, with open PRs
that need nothing from the viewer right now, and comes back with the next news.

**Rule** (`topicQuiet` in core `topic-sections.ts`, shipped as
`TopicListItem.quiet`; the engine and FakeEngine fill it): quiet when the
topic has no unread tile, no your-move (the same `yourMoves` the chip shows,
so "Merge, it is approved" counts although it never makes a topic urgent), no
unseen merge without the viewer's review, and it sits in no ask section
(Needs reply, Changes you requested, To review, Team mentioned). Archive rows
are never quiet: the drawer is its own context.

**Where they go** (renderer layout, `sidebarBuckets` with `hideDealt` in
`lib/queues.ts`, labels in `lib/sidebar.ts`): in the owner sections (You
drive, Your team owns, Other work) quiet topics leave the list. Each such
section ends with one muted line "+ N dealt with" that opens them as dimmed
rows and reads "Hide N dealt with" while open; folded by default, as a
session fold like the others. A section where every topic is dealt with
shows only its header with "· all N dealt with" and the line. In Other work
the quiet topics come out of the area folds and gather behind the
section's one line at its end; area folds count and show the rest only (a
fold with nothing left goes). Other work's own default (open for your PR,
move or unread) and its urgent rows while folded look at the rest only.

**Not hidden:**

- The ask sections (a topic there is never quiet), Other topics with FYI,
  and the Archive.
- The selected topic. It holds its place until the selection moves (the
  held place of "Actions act on what you look at"): a topic that turns quiet
  while selected stays in its spot and slides behind the line once the
  selection moves; one picked from behind the line stays there, also when
  the line folds. The quiet topics have their own held-place bucket per
  section, so this needs no special case.
- Everything while the search or a "my PRs" / "team PRs" filter is on:
  filters are for finding things, so quiet rows show in place, dimmed.

A hidden topic that gets news (unread, a your-move, an ask) is not quiet any
more and comes back to its section; the usual slide covers it. Unread
counts, the footer totals and "N topics without your PRs are hidden" stay as
they were: a dealt-with topic is not hidden by the filter.

**Look.** Quiet rows (behind the open line, and in place while filtering):
name and summary in the faint ink, faces and the PR state icon at 45%
opacity, hover brings the name back to the read ink. The selected row is
never dimmed, and nothing is dimmed while the search filters.

## Tiles hold still (2026-10-01)

On real data (three days, 415 tiles) 397 tiles held one PR, 15 were stacks
and 3 were sets; 90 set-grouping calls made those 3, and 2 of the 4 stored
sets carried their topic's own name. The set prompt asked for PRs "best read
together: a feature and its follow-up, a migration and its cleanup", which
since topics became one goal each (2026-09-29) is almost the topic test.
Owner decisions (2026-09-30 and 2026-10-01), after research on grouping PRs
(products, review practice, bundling outside code review):

- **Topics stay the focus.** Tiles live inside one topic; no cross-topic
  sweeps or queues that bypass the topic.
- **A set is a tile of PRs one judgement covers**: the same change or
  pattern (one fix in several repos, the same bump, a codemod split up) or
  one small piece of the goal done in steps, with similar risk; the same
  kind of author (bot, coding agent, person) is a preference, not a wall.
  Risk comes from the glance's existing risk level (`low` / `medium` /
  `high`); no separate risk class and no rules per repo.
- **Membership is lasting.** Snooze, chat, "dealt with" and where a tile
  sits all hang off its id, and a tile that re-cuts itself on every poll
  cannot be learned. So status, whose turn, review state, unread and CI
  never move a PR between tiles; they stay tile state and order (the
  Unread / Open / Dealt with groups). Merged members stay, so a finished
  set goes to Dealt with whole.
- **The agent re-sorts, without asking the user, never on a whim.** Its
  answer holds only changes (`setGroupingOutput`): `joins` (an open PR in no
  set into a set), `newSets`, `leaves` (with evidence: the PR's risk no longer
  fits, or the user's correction), `merges` (two sets that became one piece of
  work) and `updates` (title and take). Anything it leaves out stays. The
  service keeps only what the input allows (`mapSetAnswer`); the engine still
  enforces stacks and "not related".
- **When it runs**: only when a trigger shows up the last regroup did not see
  (`setGroupingTriggers`): an open PR in no set, a PR's risk level changing
  (the first word of the risk line, so a reworded glance does not count), new
  feedback, a dissolved set or removed member, changed instructions, model or
  prompt (`SET_PROMPT_VERSION`). A PR merging only takes triggers away, so it
  never costs a call. It runs after the glances, which write the risk. A
  topic with no set and fewer than two open PRs in none is skipped.
- **Every change is visible.** `pr_set_change` (migration 022) records each
  created, joined, left, merged, updated and ended line with its reason and
  who made it: `agent`, `user` ("not related"), or `rules` (the PR moved to
  another topic, taken out on the next regroup). `TopicDetail.setChanges`
  carries the newest 20; the CLI `topic` command and the MCP `topic` tool
  (detail full) show them. The app shows each member's reason as before; no
  new UI for now.
- **A set ends** when fewer than two units are left (a set of one PR or one
  stack is just that tile); its history stays. One that holds the user's
  "not related" corrections is kept as dissolved, so they keep holding, and
  a merge carries the merged-away set's corrections into the set it joins.
- **Answers land on the sets as they are now**: a set the user dissolved
  while the call ran stays dissolved, and a PR placed meanwhile joins
  nothing. What counts as seen afterwards is what the agent was shown plus
  the lines its own changes made; feedback or a risk change that arrived
  during the call still triggers the next regroup. A PR that moves topic
  leaves its set with its whole stack.
- Not part of this: batch approve (PR #48, agent-assisted actions) and
  shorter "same as #N" glances for same-pattern sets. The tile's verdict
  pill rolls up since 2026-10-01: it shows the worst glance among the open
  tracked PRs ("Tile header").

## One call per topic (2026-10-01, behind a switch)

Batches stayed inside one topic and rarely filled: on real data 1,485 dossier,
glance, event and set calls over three days, about 800 distinct (sync, topic)
pairs. Julian picked "one call per topic" as the direction. Research on
multi-task prompts (MTI Bench, ACL 2024; batch prompting, EMNLP 2023; Multi-Instance
Processing, ACL 2026) supports two or three related parts per call with up to
about 20 items, and warns against one call for a whole sync.

`POSTPILE_TOPIC_DIGEST=1` (engine option `topicDigest`, off by default while
it is compared) turns a topic's dossier update into a `topic_digest` call that
also writes the glances of the topic's most urgent PRs, at most
GLANCE_BATCH_SIZE:

- **Order inside the answer is the order of the work**: thinking is off, so
  the dossier fields come first and the glances read the dossier just
  written (`topicDigestPrompt` reuses the dossier instructions and the glance
  rules word for word, `dossierUpdateInstructions`, `glanceRules`).
- **Only when both are due.** A topic with no dossier delta keeps its plain
  glance batches; a dossier update with no glance target stays a plain
  `dossier_update`. The digest still writes the topic's first glances with
  the dossier, so "both due" is the common case for a new topic.
- **Hashes stay as they are.** The engine stamps the glances again once the
  new dossier version is stored (`DossierUpdater.saveGlances`), the way the
  glance batches compute them, so the batches count them as current. Only
  while glances and the digest use the same model, since a glance's hash
  names its model.
- **Partial answers**: a broken dossier part fails the call (error line, the
  next sync retries, like a failed dossier update). Glances are checked one
  by one; missing ones, and PRs past the first batch, go to the topic's
  glance batches once the dossier settled.
- **Sets as the third part**: when the run includes the set job and a
  regroup is due for the topic (`SetGrouper.due`), the call also carries the
  set prompt's sections and rules (`setGroupingSections`, `SET_RULES`) and
  answers `sets` after the glances, told that the risk it just wrote counts.
  The engine applies them after storing the glances, so the regroup's
  triggers already hold the new risk and the set job skips the topic. A
  broken or left-out set part is dropped alone (the set job then asks on its
  own); it never costs the dossier. Only when the run has the glance job:
  without it the digest stays a plain dossier update.
- Events stay their own calls for now (they drive pings, and a dossier-sized
  call would delay them).
- Budget: one `topic_digest` take replaces the dossier take; timeout 7
  minutes.
- Compared with `pnpm cli simulate-start` (old vs combined from the same
  fresh start); the switch becomes the default only after that.

## Topic tidy after an upgrade (2026-10-01)

New steering only changes where new PRs go; existing users would keep
topics cut the old way (a 51-PR catch-all, a project split in three). Owner
decision: the first full sync after an upgrade that changes how topics are
cut tidies them once, by itself, as part of the upgrade, with no proposals
for the user to work through, and never in later syncs.

- `TOPIC_GRAIN_VERSION` (engine `digest/topic-tidy.ts`; 2: topics sized
  like projects; 3: project and standing topics, the same day) against
  `meta.topic_grain_version`. A store below it runs
  `TopicTidy` once, inside the full sync's topics phase, before the topic
  assignment; the live poll never does. Raise the version with the next
  steering change that should reshape existing topics.
- The call runs as its own sync phase, `tidy`, when there are topics to
  tidy (a fresh install skips it). Since 2026-10-01 it runs first in a full
  sync, before the GitHub fetch (`tidyFirst`): it reads only stored topics
  and PRs, and the cover used to go up half a minute in, after the fetch,
  while the old topics took clicks. The digest still calls it for a store
  with no viewer yet and for `digestStored`; once done that is a no-op. While that phase runs, the app covers the
  window with "Tidying up your topics and tiles" and a spinner (0.13.1): the
  call takes a minute or two (about 2 minutes for 117 topics), and a click
  meanwhile could land on a topic about to merge or lose PRs.
- One `topic_tidy` call (setup model, Opus) reads every topic that still
  takes PRs, active or in the Archive (since grain 3: a quiet standing topic
  needs its kind, or it would drop off after 30 days like a project): name,
  kind, goal (dossier goal, else summary) and one line per PR (date, author,
  state, title), with the glossary, `TOPIC_SIZE_EXAMPLES`, instructions and
  work context. It answers `merges` (topics that are one goal: fold
  `fromTopicIds` into `intoTopicId`, optional new name), `splits` (PRs that
  do not belong to their topic; a new destination carries `newKind`),
  `renames` (a topic named after one step of its goal) and `kinds` (only
  topics whose kind is wrong). `mapTidyAnswer` keeps only known topics, never
  folds a merge target away, a split must leave a PR behind, and a renamed or
  re-kinded topic must stay. Renames are recorded like merges (accepted,
  source `upgrade`). A topic in the Archive that gains PRs comes back; the
  sync's retire step sends it back when nothing in it is open.
- Merges move the PRs the way an accepted merge does (new `created_at`, so
  the target's next dossier update introduces them) and archive the merged-away
  topics; each is recorded as an accepted `merge` proposal with source
  `upgrade`, so the topic's decided changes show it (MCP `topic`). Each split
  names where its PRs go, an existing topic or a new project name, and the
  tidy moves them there itself, a stack whole: handing them to the topic
  assignment could put them straight back into the topic they were split
  from. What the tidy did is kept in `meta.topic_tidy_result`.
- A store without active topics (a fresh install) is marked done without a
  call; a single topic still runs, it may be a catch-all to split. A failed
  call is an error line and the next full sync tries again.
- User placements ("Wrong topic") are never undone: a split skips a PR the
  user placed, with its whole stack, and a merge never folds away a topic
  that holds one. Nor does the tidy undo a "Wrong topic" without a pick:
  no fold that puts a PR together with the topic it left (either way
  round), no split into that topic ("'Wrong topic' sticks").

## You already dealt with it

Decided 2026-09-29 (evening), agreed before building. When the user acts on
a PR on GitHub, whatever happened before that action has been seen by them,
however they acted: github.com, the gh CLI, GitHub Mobile, or an agent
commenting as them. GitHub clears the notification only for a visit on
github.com, so an approval from the CLI left a PR's "ready for review"
unread for days. Julian asked to make this general instead of a one-off.

**"Acted" is the viewer's last touch**, the definition already agreed for
"New since you looked" (`whatsNew`'s anchor): their review (approve, request
changes, comment), a comment or thread reply, or a push to their own PR.
Merging or closing counts only when the viewer did it. Bot talk is no touch
(2026-10-06): a bot command, a reply to a bot or a carrier review answers
nobody ("Bot talk leaves agent work" › Bot talk answers nobody).

1. *Tile*: every event before the viewer's last touch counts as seen by the
   rules. This generalizes two narrow rules that already existed (a review
   request turns quiet once the viewer reviewed after it, an ask once they
   replied after it); "ready for review" was the case they missed.

   Built like "Reconciling with GitHub's read time", not as a second derived
   rule: the engine marks every event up to and including the touch seen in
   the store, stamped with the touch time (core `eventsSeenByTouch`), each
   time a PR snapshot is stored (sync and poll, so the poll never pings for
   them) and once per full sync over the hot board's PRs (events stored before
   the rule). The PRs join the seen-cursor move like read-time ones. Details
   the build settled:
   - A push counts only on the viewer's own PR. On someone else's PR a
     rebase can carry the viewer's commits without them doing anything.
   - And only with evidence that the viewer pushed, not just wrote the
     commit (Codex review on PR #10): the commit's committer is the viewer,
     or GitHub's web-flow committed it with the viewer as author (a
     suggestion or "Update branch" they clicked), or a force push the
     timeline credits to them. A collaborator's or bot's cherry-pick or
     rebase keeps the viewer as author but makes itself the committer, so
     it does not count. The committer comes with the commits in the same PR
     query (`Commit.committer`); a snapshot stored before that has none and
     counts as no evidence until the PR is fetched again.
   - The touch itself is marked too: a merge the viewer did on a PR they
     were asked to review is a `merged_without_review` of their own and
     would otherwise keep the tile open.
   - `whatsNew` uses the same `lastTouch`, so its anchor gained "since you
     merged it" / "since you closed it", and a push on someone else's PR no
     longer anchors.
   - The narrow rules stay (`requestAnswered`, `userRepliedAfter` in core
     `events.ts`): they set rule loudness, which pings, the activity list
     and whose turn read, and `requestAnswered` also covers a request that
     was removed later. Where both apply the general rule makes the event
     seen anyway.
2. *GitHub read state* (a second reason for Handled quietly): when every
   unread event on a thread is older than the viewer's last touch, PostPile
   marks the thread read on GitHub after a full sync, through the normal
   mark-read path, only while writes are unlocked, listed as "you approved
   after it" / "you replied after it". The viewer's own PRs are included here
   (they acted after the activity). A push does not count for this part:
   pushing code does not mean reading the review comments. A merge without
   the viewer's review is never marked read this way unless they touched the
   PR after the merge.

   Built as core `touchedReadCheck` (`quiet-reads.ts`), run by `QuietReads`
   when the bot-only check says no, same write path (snapshot freshness,
   thread read again right before, origin `quiet`, at most
   `QUIET_READS_PER_RUN`; the grace until 2026-10-02). Details the build settled:
   - The touch here is a review or a comment (`READING_TOUCH_KINDS`): no
     push, and no merge or close either, for the same reason.
   - "Unread" is every event by someone else after `last_read_at`, or every
     one when the thread was never read. None known: left alone, like the
     bot-only rule.
   - Bots after the touch are fine as in the bot-only rule (CI and the merge
     queue follow most approvals), on the viewer's own open PR too. Until
     2026-10-01 a bot's review there kept the thread unread, and until
     2026-09-29 so did any bot on a merged or closed own PR ("Own merged PRs
     clear on GitHub too" in "Actions act on what you look at"). Until
     2026-10-02 the grace counted from the newest of the touch, those bots
     and the thread's update.
   - No unseen loud news on the PR (until 2026-09-30: the tile must not be
     unread, which since "GitHub unread is PostPile unread" it always is
     while its thread is). Whose turn is not checked: every event before
     the touch is seen already (part 1), so the mark-read only turns the
     tile read, and a move that is still the viewer's (their approved PR,
     "Merge") stays on the tile.
   - Log details "you approved after it", "you requested changes after it",
     "you reviewed after it", "you replied after it" (the newest touch);
     `QuietReadView.reason` carries it to the view.
   - Read before acting (2026-09-30): acting alone no longer says the user
     saw what came before. Real case: a teammate commented at 12:35:25, the
     user marked the PR ready at 12:35:31 without reading it. Core
     `sawBeforeActing` counts a person's event as seen before an action
     only when a real read lies between them: GitHub's read time of the
     thread, or PostPile's Mark read or opened read (`handledAt`). Events
     that turned seen only because the user acted (part 1) do not count.
     `touchedReadCheck` skips with `acted_without_seeing` unless every
     person's event before the touch passes. The same rule makes a PR
     handled without a click (`actedAfterSeeing`, read by `isPrDone`, never
     stored): the user's newest own activity (comment, review, push to their
     own PR, marking it ready) comes after the newest person's event and
     every person's event before it passes; done still needs no move of
     theirs. Real case: read on GitHub at 12:35:19, marked ready at 12:35:31,
     own PR waiting on reviewers: done. Only the newest read of each kind is
     stored, so an earlier read followed by a later one after the action
     does not count.
3. *Opening a PR in PostPile*: opening a PR in the detail pane marks its
   GitHub thread read and handles the PR in PostPile too (events seen,
   `handledAt`; since 2026-09-29, before it only marked the thread read),
   only when a mark-read of that PR would leave it done
   (`PrSummary.afterRead.done`: nothing asked of the viewer; checked per PR
   since 2026-09-29, before it was the whole tile's `afterRead.done`), no
   tile holding it is snoozed, and only while writes are unlocked. It
   mirrors what github.com does on a visit, limited to cases where it
   cannot hide a to-do. Until 2026-10-01 also listed under Handled quietly
   ("opened in PostPile") when the thread was unread on GitHub; since then
   it is a visible mark with an Undo and not a quiet one. A visit on github.com
   keeps its old effect (events seen, no `handledAt`): PostPile cannot
   check the conditions at the moment of the visit.

   Built as `POST /api/prs/:owner/:repo/:number/opened` ->
   `EngineService.markOpenedRead` -> `OpenedReads.markOpened`, with the rule
   in core `openedReadCheck`. Details the build settled:
   - "Opened" means the PR stayed in the detail pane for 1.5s
     (`OPENED_READ_DELAY_MS`, renderer `useOpenedRead` with
     `OpenedReadTimer`) while the window was visible, so clicking through
     tiles marks nothing. From 2026-09-29 that only armed the open and the
     mark went out when the user moved on; since 2026-10-01 it goes out
     when the dwell ends, with an Undo, see "Actions act on what you look
     at" › Marked when the dwell ends. Hidden before that, the wait starts over when the
     window is visible again with the same PR open (Codex review on PR #10:
     the open used to be dropped). The first tile
     the app shows by itself counts too: it is on screen. One request per
     open; re-renders and refetches of the same PR send nothing.
   - The renderer asks only when the opened PR's `afterRead.done`, the
     tile is not snoozed and the lock is open (`openedRead` on the
     `GithubWrite` list, blocked while locked; only a lock closed inside the
     undo window parks it as a pending write, since 2026-10-01); the
     engine checks again (core `openedReadCheck`: a thread, a tile, none
     snoozed, the PR done after a mark-read of it), plus, for an unread
     thread, a snapshot at least as fresh as the thread (the user cannot
     have seen newer activity). A PR only in a finished topic has no tile
     and is left, and so is a PR without a thread (a found PR): nothing on
     GitHub to mirror.
   - 2026-10-01: a truncated snapshot no longer blocks the open by
     itself. When no list hit PostPile's own caps (empty `capHits`: only
     GitHub's total counted more), the detail pane missed nothing and the
     open marks. When our caps did cut something, it marks only if what
     fell off is older than GitHub's read time, or paging completed the
     list (`snapshotCoversSince`, "Handled quietly" › Capped snapshots):
     otherwise the pane the user looked at missed that activity too.
     Before, any truncated snapshot counted as stale, and about half of
     unread PRs (46 of 87, 43 with empty `capHits`) showed "Marks read when
     you leave" and then marked nothing. Each row now
     carries the server's verdict (`PrSummary.openedRead`, gathered by the
     engine's `OpenedReadInputs`, the same inputs `markOpened` reads), and
     the renderer asks only when it is not a skip and writes are on. A
     skip on the server logs one line with the reason.
   - A thread GitHub has read already (an earlier open, a github.com visit)
     gets only the PostPile side: the PR is handled, a `local` action log
     row (origin `detail` since 2026-10-01, was `quiet`; detail "no unread
     GitHub thread") is written, nothing reaches GitHub or shows under
     Handled quietly. When nothing would change (seen and handled already)
     the open marks nothing and has no undo. This is the
     case from "Actions act on what you look at": a PR an earlier open had
     read on GitHub still held its set open.
   - Since 2026-10-01 the write is a queued mark-read like the pane's
     Mark read (`ReadMarker`, cause `opened`, origin `detail`, its own
     batch and undo token, sent after the undo window, a moved thread
     decided again by `ClickedReadRetry`). Until then it was the sync's
     quiet mark-read: thread read again right
     before, origin `quiet`, detail "opened in PostPile", no undo window,
     thread and events up to its update mirrored as read. Then the PR is
     handled (every event seen, `handledAt`), so it is done, and the tile
     with it once every tracked member is. Until 2026-09-29 it set no
     `handledAt`, like a github.com visit, and a read PR that asked nothing
     kept its set open.
   - Fake mode does it in memory (`FakeEngine.markOpenedRead`), nothing
     leaves the process.

## Handled quietly

Decided 2026-09-29. A PR thread the user had read comes back unread only
because of bots (trunk-io, github-actions, review bots like codex or
coderabbit, deploy bots, CI). PostPile marks it read on GitHub by itself.
Real data on the day: 36 of 165 unread PR threads were bot-only since their
last read. Rules only, no agent: core `quietReadCheck` (`quiet-reads.ts`),
engine `QuietReads` (`writes/quiet-reads.ts`). It only ever touches PR
threads: other notifications (releases, issues, discussions, security alerts)
stay unread on GitHub (2026-10-03; 2026-09-30 to 2026-10-02 it cleared them
too).

**The rules**, all of them must hold:

1. *Read before, bots since.* GitHub has the thread unread, it has a
   `last_read_at`, and every stored event by someone else after it is
   automation (`event.isBot`, or no actor at all, named "GitHub"; CI results
   had an empty actor until 0.21.0). The viewer's own events (a
   review from the CLI does not move the read time) are not someone else's
   activity and are left out (2026-09-29; before they blocked the rule). No
   known event by someone else after the read counts as "don't know": left
   alone.
   The stored events only count when the PR snapshot was fetched at or
   after the thread's `updated_at`. A sync
   refreshes every thread but can leave a PR's snapshot stale (its PR cap, a
   failed fetch); a human comment after the snapshot would then be missing
   and the thread would look bot-only (Codex review on PR #5, 2026-09-29).
   Not "fetched in this very sync": a PR fetched earlier is not fetched
   again until it moves, and the snapshot from then still covers the
   thread. A snapshot cut off at
   the query's caps covers only when what fell off is older than the read
   (since 2026-09-30, see "GitHub unread is PostPile unread" › Built), or
   once paging completed the list (`snapshotCoversSince`, since
   2026-10-02, "Capped snapshots" below); else the rule skips with
   `stale_snapshot`.
2. *(Removed 2026-10-01: no bot finding on the user's own open PR.)* A
   bot's review, or its comment in a review thread, on the user's own open
   PR used to keep the thread unread, because it can mean work. Owner: "I
   never care about bot replies... and it's my PR so I will have it on the
   radar anyway." A finding that matters also shows up as failing checks or
   unresolved threads that block the merge. The real case: ReviewHog's
   FLASH-mode review kept an own PR unread. The number stays so references
   to the other rules hold. History: merged and closed own PRs were let
   through on 2026-09-29 (every own PR merges through trunk after the last
   comment, so 14 merged own PRs stayed unread after 0.10.0); on 2026-09-30
   only findings blocked, not plain bot comments, CI or deploys.
3. *No unseen merge without the user's review* ("Merged without your
   review", rule 5: PostPile never marks those read by itself). Checked on
   its own, since a merge queue bot merging counts as bot activity.
4. *Nothing asked of the user.* No unseen loud news on the PR, and whose
   turn (`prWhoseTurn`, with the glance's NOT_YOURS as the tile reads it)
   is not a new `you` (since 2026-09-30, "New moves only" below; before,
   any `you` blocked). Until 2026-09-30 this read "the PR's tile is not unread";
   since "GitHub unread is PostPile unread" a tile is unread while its
   thread is, so that check would block every quiet read.
5. *(Removed 2026-10-02: grace.)* PostPile waited 10 minutes
   (`QUIET_GRACE_MS`) after the newer of the newest bot event and the
   thread's `updated_at`, so a person answering the bot right away still
   counted. It dates from when PostPile kept its own unread state apart
   from GitHub's. Since "GitHub unread is PostPile unread" a thread is just
   read or unread, and what the grace guarded is covered: a snapshot older
   than the thread's update leaves it (rule 1), the thread is read again
   right before the write and left when it moved (the write below), and a
   person's reply after the mark makes GitHub mark the thread unread again.
   Owner decision: drop it. It held bot-only threads unread for up to an
   hour, because the pass then ran only in the full sync. The real case: a
   quiet read at 06:19, trunk-io edited its merge queue comment at 06:22
   (an @mention, so GitHub notified again), and the thread stayed unread
   until the owner opened it at 06:25. The same goes for the grace of the
   acted-after rule, and the judged rule.
   The number stays so references to the other rules hold.
6. *Lock open.* Only while GitHub writes are unlocked. Locked, nothing
   happens and nothing piles up as a pending write.

**Where it runs**: near the end of every full sync (start, "Sync now", the
hourly auto sync), after the digest and before the retire step (since
2026-09-30: what PostPile clears no longer holds a finished topic). The full sync has
just fetched the inbox and every moved PR, so threads, events and read times
are fresh. Since 2026-10-02 also at the end of every live poll cycle that
stored a change (the inbox or read list moved, or a PR was fetched;
`PollRun`), after the pings, on the threads and PR snapshots the cycle just
stored. A cycle with nothing new runs no pass: the stored state is what the
last pass saw, and re-reading threads it left would only cost requests.
PRs the poll did not fetch keep their older snapshot and wait on rule 1
until the next change or full sync. The pass is part of the poll cycle, so
it never runs beside the full sync or itself: the engine blocks a cycle
while a sync runs, and a sync waits for the running cycle. The judged rule
needs the events agent's judgement of people's quiet activity (full sync,
topic catch-up); the next pass after it picks the thread up. Before, the live poll was left out because it would have
needed its own timer for the grace. At most 50 threads per run
(`QUIET_READS_PER_RUN`).

**The write**: each thread is read again right before (`GET
/notifications/threads/{id}`); read elsewhere or updated since the sync
means leave it for the next sync. Else `GitHubWrites.markThreadRead` with
origin `quiet`, detail "only bot activity since your last read: trunk-io[bot],
CI", no undo window (nobody clicked). The app mirrors it: thread read up to
its `updated_at`, the bot events before it seen, the topic's seen cursor
moved (`advanceSeenFromGitHub`). A failure is logged `failed`, lands in the
sync report and the next sync tries again. The sync log says how many.

**The view**: sidebar footer "Handled quietly" (was a disabled stub) opens a
list over the middle and detail columns: the quiet mark-reads that reached
GitHub in the last 7 days (`HANDLED_QUIETLY_DAYS`), newest first, with
repo#number, title, why ("only trunk-io, CI", "you approved after it",
"opened in PostPile" for rows from before 2026-10-01; the other reasons are in "You already dealt with it")
and when (`GET /api/handled-quietly`,
`EngineService.handledQuietly`, read from the action log). A click opens the
tile when one holds the PR. Quiet on purpose: no coral, the count is faint
mono. The notifications debug view shows the same entry as the row's last
action. They count toward the hourly `pings_summarized` telemetry
(`handled_quietly`).

**Comment edits** (2026-09-30). A PR thread kept moving with no new
comment, review or timeline item (real data: the thread's `updated_at` went
12:00:27, then 12:11:09). Bots edit their sticky comments instead of posting
new ones (a CI report edited 2s before the thread moved, a review summary,
test analytics, a review bot), GitHub keeps the notification unread for it,
and PostPile only derived comment events from `createdAt`, so the tile said
"new activity on GitHub" with nothing that could clear it. The PR query now
also asks for `lastEditedAt`, `editor` and `updatedAt` on issue comments,
review bodies and review-thread comments (the same `comment` fragment, no
extra request), and each comment edited after it was posted gives one
`comment_edited` event at its latest edit, by the editor (else the author),
id `<prKey>:comment_edited:<comment id>@<edit time>` so re-syncs keep it and
a later edit is a new event. A bot editing its comment is automation, so
the bots-only read clears it, also on the user's own open PR. A person's edit is quiet news the events agent judges; it is loud
and an ask when the edited body mentions the viewer or a home team (Codex
review: a person editing in "@viewer" is a real ask). The old body is not
fetched, so a mention already there counts too: the event is new and
unseen only when the edit came after the viewer's last read. It is also an
unanswered ask for whose move and the tier (Codex review on PR #41, core
`askKindOf`): a mention edit asks like a mention (Reply, Needs reply), a
home-team one like a team mention (until seen), from the edit time, and a
later comment or review of the viewer answers it. Headline: a
person's edit ranks with comments (an ask when it mentions them), a bot's
with automation. Known gap: an edit of a comment that fell off the query's
comment cap is not seen.

**New moves only** (2026-09-30). A move of the user's that stood before
their last read no longer keeps a thread unread: the bots-only and judged
reads block on whose turn only when the move is new since the rule's
boundary (the read, or the last look). Core `isNewYourMove` works the move
out on the PR as it stood then and blocks when the move is another kind or
was not there. `prAsOf` is honest history (Codex review on PR #41, owner:
no shortcuts): reviews, comments, commits and timeline items after the
boundary are taken out, requests asked after it dropped and ones removed
after it (by hand, or by the reviewer's review) put back, a ready or draft
switch and a merge, close or reopen after it undone, the in-app approval
after it dropped; only a resolved thread and CI stay as they are now. So a
bot reopening an approved own PR is a new move. A re-review request after
the read blocks. The real case that asked for this (the user's own agent
PR, approved by them on Sep 15, read on Sep 18, then a teammate removed a
team request, a stale-PR bot nudged and CI ran) still stays unread: on Sep
18 the PR waited on the team, so "Merge, it is approved" is new. Owner,
2026-09-30: only new moves that ask something block (reply, review,
re-review, address changes); merging an approved PR of theirs never does,
so the real case clears.

**Review requests that no longer stand** (Decided 2026-10-02). Every
other rule skips a thread GitHub never saw read (`never_read`, no
`last_read_at`), so a review request the user never opened stayed unread
for good, even after it stopped asking anything. The real case (acme/app
#1812): a bot asked the user's home team and two other teams for a review
on Sep 12; the thread (reason `review_requested`) was never opened. Later
the home team's request was removed (pending were only the two other
teams), and everything since was the author answering review bots, plus
bot comments; the events agent had judged the replies quiet. The thread
stayed unread for days. Owner decision: such a thread may clear once the
request no longer stands. Core `requestGoneReadCheck`, all of these:

- GitHub has it unread, never read, and its reason is `review_requested`.
  Never-read threads for anything else (a mention, an assignment, the
  author) keep the `never_read` skip.
- No request of the user or any of their teams is pending: removed, or
  answered by them or a teammate (`reviewRequest` is null or `team_taken`).
  A pending personal or team request keeps it unread as before.
- Since the newest request of the user or their team (the boundary of the
  rule), something by someone else happened, and all of it is automation
  or a person's activity the events agent judged below loud, the standard
  of the judged rule. A removal by a person, or a teammate's review,
  counts as a person's activity and waits for the agent like any other.
- No ask since the request or still unseen (`isAskOfViewer`), no loud
  news since, no unseen loud news on the PR besides the requests
  themselves (a team request a teammate answered stays loud by its rule,
  and it is what this rule reads), no unseen merge without the user's
  review, no move of theirs new since the request (`isNewYourMove`).
- The snapshot covers the thread (`snapshotCoversSince` from the request:
  cut-off lists vouch only for what fell off before it, or once complete).

Log detail "review request no longer stands, nothing that needs you since:
greptile-apps[bot], paul"; Handled quietly says "request gone, nothing for
you from greptile-apps, paul". Runs with the other rules in the full sync
and the live poll pass (engine `QuietReads`). This narrows "Never clearable
by itself: a review request to you or your team" in "GitHub unread is
PostPile unread": a request that still stands never clears; one that was
removed or answered no longer asks anything.

**Capped snapshots** (Decided 2026-10-02). Bot-heavy PRs stayed unread for
days: review bots post dozens of reviews and threads, the query keeps the
newest 50 of each, and the kept ones started after the user's last read. Every quiet read skipped them as
`stale_snapshot`. Example: acme/app#1234, where review bots posted more than
50 reviews and more than 50 review threads, the oldest kept review two days
after the last read, so no rule could ever clear the thread.

- **Paging.** When a fetched PR's snapshot hits a cap and its thread is
  unread, PostPile fetches older pages of the capped lists until they reach
  back to the thread's `last_read_at` or GitHub has no more (core
  `needsOlderPages`; a thread never read pages to the end). One GraphQL
  request per page with `before:` cursors (`pageInfo { hasPreviousPage
  startCursor }`, asked for in the PR query too); a thread whose comments
  hit their cap pages forward with `after:`. Paged items are selected and
  normalized exactly like the PR query and merged in by id
  (packages/github `cap-fill.ts`, `addOlderPage` in `normalize.ts`). Each
  list's cap hit moves back (`oldestAt`, `cursor`, `nodes`) or is marked
  `complete`.
- **Coverage.** One helper decides for every rule: core
  `snapshotCoversSince(pr, since)`. A snapshot covers since a time when it
  was not cut by our caps, or every capped list is complete or reaches back
  to or before it (`capHitCoversSince`). Review threads and a thread's
  comments have no usable time (`oldestAt` null): they cover only when
  complete. Each rule passes its own `since` (read time, touch, last look,
  newest review request); `null` means from the start, so only complete
  lists count. The freshness check against the thread's `updated_at` stays
  as it was. Whatever is still not covered keeps blocking the quiet reads.
- **When.** In the full sync, between the PR fetch (and the moved-PR fetch)
  and storing, so the stored snapshot (`prs.upsert`) and its derived events
  include what came in, before the quiet reads; and in the live poll for
  the PRs it fetched. The snapshot keeps the time the fetch started as its
  fetch time, so a thread updated while paging ran does not look covered.
- **Budgets** (engine `cap-fill.ts`): at most 5 pages per list per PR (and 5
  over all of one PR's threads' comments, `CAP_FILL_PAGES`), 10 PRs per
  full sync (`CAP_FILL_SYNC_PRS`), 3 per poll (`CAP_FILL_POLL_PRS`), newest
  thread first, nothing while the GitHub quota is low (`allowsBackground`,
  checked before each PR). A list still short of the read after its pages
  ends that PR's paging: coverage needs every list, so the rest could not
  help. Skipped PRs, the pages each PR took and lists still short go to the
  sync log; a failed request ends the pass and the PR keeps its unpaged
  snapshot.
- **Expected cost** (illustrative numbers): few PRs hit a cap at all, and
  paging a capped list to its end usually takes a handful of pages, e.g.
  acme/app#1234 would take 2 (15 older reviews, 4 older threads); a very
  long timeline can need more than the budget.

**History**: the idea was parked on 2026-09-29 when "merged, nothing new"
(mark merged PRs read when nothing happened since) turned out to hide
merges Julian wants to see (see "Merged without your review"). Bot-only
activity since the last read is the safe case: the user already read
everything a person said, and what came after can't ask them anything. Own
open PRs were excluded because bot reviews there can mean work; merged or
closed ones were not (2026-09-29). The exclusion was dropped on 2026-10-01.

**Fake mode**: seven sample quiet mark-reads in the action log (two for
"you acted after it", one older than 7 days, so it stays out of the view)
and sample ping decisions
(`fake-quiet.ts`); the fake poll's decisions are kept too.

## Interruptions

Decided 2026-10-05 after team feedback (see "A helper, not an interrupter"
under Product model). The user picks when PostPile may show a Mac
notification; the poll, the tiles and the list work the same in every mode.

| Mode | Label | What reaches the Mac |
|---|---|---|
| `never` (default) | Never: "I'll come to PostPile." | Nothing. No banner, no sound, no Dock badge, no permission prompt. |
| `batches` | In batches: "A short roundup, three times a day." | One roundup at 9:30, 13:30 and 16:30 local time, Monday to Friday, only when something queued is still not handled. No Dock bounce. |
| `asap` | As soon as it matters: "Tap me for the crucial things." | The live pings as before: throttle, summaries, the bounce for a personal ask. |

- **Why batches:** a field study (Fitz, Kushlev and colleagues) found that
  three batches a day left people more attentive and in control than
  instant notifications, and less anxious than none. The times are fixed
  for now (`ROUNDUP_TIMES` in core).
- **Where it is picked:** setup step 4 "Your day" (three illustrated cards,
  the stored mode or Never preselected, sent with Accept), and the
  "Interruptions" row in the sidebar footer, a small menu with the same
  three modes plus "Send a test notification". Kept in meta
  `interruptions_mode`; `GET`/`PUT /api/interruptions`. Telemetry
  `interruptions_changed` (mode, from setup, sidebar or prompt). Rejected: a bell
  toggle in the title bar, it puts pings front and center.
- **Installs that never chose** (2026-10-05): before 0.18 the pings were on
  by default, so an update would turn them off without a word. When no mode
  was ever stored (`InterruptionsView.chosen` false), the app asks once in a
  dialog (`InterruptionsPrompt`): "When should PostPile tap you on the
  shoulder?", the same three cards with Never preselected, a lead that names
  "As soon as it matters" as the old behavior, and Save. It waits until the
  setup status and the inbox cleanup view have loaded and never shows on top
  of setup or the inbox cleanup start dialog. Saving or closing (Esc, a
  click outside) counts as a choice: closing stores the current mode
  (Never) and says so next to Save, so the dialog never comes back. It
  closes only once the save landed; while it runs Save reads "Saving…",
  and a failed save keeps the dialog open (with the error toast) so the
  user can try again. The PUT
  carries `from: 'prompt'`, and so does `interruptions_changed`. A new
  install that skips setup has not chosen either, so it gets the same
  question once after skipping.
- **Rules** (`PingDelivery` in engine `live/`): the poll's pings go through
  it. Never drops them (the ping decisions are still made and logged, the
  notifications debug view shows them). As soon as it matters shows them
  through `PingThrottle`. Batches queues them in `mac_ping` (one row per PR,
  a newer ping replaces the older); the live poll looks every minute
  (`ROUNDUP_CHECK_MS`) and, once a roundup time passed after a queued ping
  came in (`latestRoundup`), shows one notification for every queued ping
  still not handled (`roundupNotification`: one ping as it is, more as
  "3 things need you", personal asks first). A roundup the Mac slept
  through goes out on wake. Rows are handled, and dropped, when the user
  opens a tile holding the PR (`postpile:tile-visited`) or the PR is not
  held by an unread tile anymore (read on GitHub, marked read, done). A
  ping counts as shown only when the Mac showed it (`onNotify` answers
  false with notifications off or unsupported); a roundup that could not
  show is dropped, not retried every minute.
- **Switching:** to Never drops every held row, so the Dock badge goes away;
  leaving batches drops the queue (those PRs are in the list anyway).
- **Dock badge:** the number of tiles holding a PR PostPile showed a
  notification about that is not handled yet (`pingBadge`, PR keys mapped
  to the tiles holding them now, a PR without a tile counts on its own).
  Unread topics, merged PRs, FYIs and standing review requests never count:
  the number only holds what PostPile raised, and it reaches 0 when every
  ping is handled. Under Never there is no badge. Julian (2026-10-05): "just
  making the notifications that actually ping me raise a number until I
  clear them". Replaces the count of unread topics (2026-09-30), which kept
  a number for unread merged PRs.
- **Permission:** macOS asks on the first notification, so the welcome
  notification (below) only comes once the user picks batches or as soon as
  it matters, worded for that mode. `POSTPILE_MAC_NOTIFICATIONS=0` still
  forces every notification off, whatever the pick.
- **Kept across restarts:** the pick and the held pings (migration 27
  `mac_ping`). The sample data keeps them in memory (`MemoryPingHold`).

## Live poll and Mac pings

Near-real-time pings on the Mac, only when they matter. Whether and when
they reach the Mac is the user's pick (see "Interruptions"); the poll itself
runs in every mode, it keeps tiles fresh. Runs while the desktop
app runs (window open or hidden); the CLI has `poll` for one cycle, the
standalone server never starts it.

**Poll** (`LivePoller` in engine `live/`, started by the desktop main process):

- `GET /notifications` every `POSTPILE_POLL_SECONDS` (default 60, 0 turns
  it off, window focus included) with the stored ETag / Last-Modified, shared
  with the full sync. A 304 costs no rate limit and does nothing else.
- GitHub's `X-Poll-Interval` is obeyed: the next regular cycle waits the
  configured interval or the last `X-Poll-Interval` GitHub sent, whichever is
  longer (`LivePollStatus.everySeconds`; an answer without the header keeps
  the last one). A lower `POSTPILE_POLL_SECONDS` only counts until the first
  answer. Logged when it changes; the footer says "live · every 60s", the
  tooltip names both values. One cycle at a time; the next is scheduled when
  the last one ends, whoever started it. The first cycle waits one interval
  so the app's start sync goes first.
- History: 2026-09-28 the poll ran every 10s and only logged the header,
  because Julian wanted quick pings and 304s are free. 2026-09-29 research:
  GitHub has no push API for a user's notifications, its notifications docs
  say "Please obey the header", every answer in the real app log said 60s,
  and GitHub's best-practices page warns that misbehaving integrations can
  be banned. Julian: "switch to 60s plus poll on focus".
- Poll on focus (2026-09-29): when the window gets focus, one cycle runs
  right away (`LivePoller.runOnFocus`, through `refreshOnFocus`), so what
  happened while the user was elsewhere shows without waiting up to a
  minute. Skipped when a cycle started less than 15s ago
  (`FOCUS_DEBOUNCE_SECONDS`, so switching windows does not hammer GitHub),
  before the first cycle, while the poll is off, while backing off (the
  retry timer stays), while the quota is nearly used, and while a full sync
  or consolidation runs. The regular timer then
  counts from that cycle.
- Backoff: a rate limit (429, or 403 with Retry-After / no requests left / a
  "rate limit" message, or a GraphQL `RATE_LIMITED` error; `GitHubError.rateLimited`)
  waits Retry-After or until X-RateLimit-Reset, else doubles from 60s to 15
  min. Other errors double from the effective interval up to 5 min. No
  retry comes sooner than the effective interval (`X-Poll-Interval`
  included), and window focus runs no cycle while a backoff is pending. The footer shows
  "backing off, retry in Ns" (state `backoff`). A rate-limit backoff sends
  `rate_limited` with `where: 'poll'`.
- GitHub quota: once a minute at most while the quota is low, paused until
  the reset while it is nearly used (see "GitHub quota"). The slower of the
  quota pace and `X-Poll-Interval` wins.
- Overlap: `Engine.pollOnce()` answers `blocked` while a full sync or a
  consolidation runs (glance catch-up runs go beside poll cycles, see
  "Glance catch-up") (footer: "paused while syncing"); sync and
  consolidation wait for a running poll cycle, so agent calls land in the
  right run (`poll:<time>` in `agent_call`). When a full sync ends, the
  poll runs one cycle right away (2026-09-28): a sync takes a minute or
  more, and a read or merge on github.com during it used to wait for the
  next cycle after it. Chosen over letting the poll read threads during
  a sync: no concurrent writes to the thread table and the shared ETag,
  one line of code, and the delay shrinks to the sync's own length.
- Read-threads watch (2026-09-28): every cycle also asks
  `GET /notifications?all=true&since=<cursor>` with its own ETag (meta
  `poll_watch_since`, `poll_watch_etag`). The unread list never shows a
  thread that stays read, and GitHub does not make a thread unread for the
  user's own merge, close, comment or review, so those were invisible until
  the next full sync (seen on a real PR: merged on github.com, OPEN in
  the app for minutes). The cursor starts at the last full sync's start,
  and moves only on a 200, to the newest thread update less a minute
  (`nextWatchSince`, server times), so between changes URL and ETag stay
  the same and GitHub answers 304. Updated threads, read or unread, go
  through the same incremental fetch. Read threads stay read; their new
  events count as seen when before `last_read_at` or done by the viewer
  (`ownEventsOnReadThread`). Each 200 is logged with the running tally
  ("200 on 3 of 412 polls since start").
- Freshness check (2026-09-28): threads do not move for everything (an
  approve sent from the app, quiet PRs), and PR snapshots stayed a day old.
  One `prUpdatedAts` GraphQL query (100 aliases per query, `updatedAt`
  only) covers every open PR a tile shows (pinged, found, pulled in) plus
  those merged or closed in the last day; PRs with a newer `updatedAt` get
  the full fetch. Every full sync runs it, the poll at most once a minute
  (`FRESHNESS_POLL_EVERY_MS`). The sync always logs the counts, the poll
  when something moved.
- After a write: approve and comment run one normal poll cycle with that PR
  as focus (`focus.prRefs`) before they answer, so the renderer's refresh
  after the action already shows the new review state. It is serialized
  like any cycle (a running one is waited for first), and teammates' events
  it brings in get ping and revive handling. Approve marks read before that
  refresh, so what the refresh brings in stays unseen.
- Focus refresh (2026-09-28): the main process remembers PR links opened
  from the app (`OpenedPrs`, 30 minutes). The focus cycle above also looks
  those threads up directly (`GET /notifications/threads/{id}`) and fetches
  the ones without a thread. When the focus cycle is debounced they ride on
  the next cycle.
- "Read elsewhere" log: every thread noticed as read on github.com logs
  how: it left the unread list (the list answered 200) or the read list
  says read while the unread list answered 304. The action log from real
  use (2026-09-28) had only the first kind: GitHub's inbox ETag moves when
  a thread is read elsewhere. A 304 case in main.log would say otherwise.

**Incremental sync** (`PollRun`), only after a 200 of either list, a
focus refresh or a moved PR from the freshness check: the PRs whose
threads moved since their last fetch, newest first, at most 24 (two GraphQL
batches; the rest wait for the next change or the full sync). Snapshots,
events with rule loudness and the event log are written exactly as in the
full sync (`GitHubSync.poll`), retired topics revive, and PRs new to the app
get a topic (one `topic_assignment` call at most, asking only about the
PRs that cycle fetched; the backlog without a topic stays with the full
sync, and the poll never runs the retry batch). Tiles are derived on read,
so they update by themselves; the renderer refetches when `changeCount` in
`GET /api/live` moves. Topics whose fetched PRs brought a new loud event or
have no glance yet get a glance catch-up run right after the ping decisions
(see "Glance catch-up" below). Sets, stack layers and fact verification stay
with the full sync, which still finds the new events through the event log
and walks stacks and verifies facts for the PRs the poll fetched (meta
`poll_fetched_since_sync`). Marks nothing read (on GitHub or locally,
beyond what the full sync already does for threads that left the inbox),
except through the quiet reads at the end of a cycle that stored a change
(since 2026-10-02, "Handled quietly" › Where it runs).

**Decision** (`PingDecider`), one per PR thread with new events, rules first:

- Only unseen events from this poll and at most 30 minutes old
  (`PING_FRESH_MS`) count; the first look at an empty store is a baseline and
  decides nothing.
- Unread a cycle late (2026-10-02): a thread that is still read when the poll
  stores its events is no candidate, and GitHub often marks it unread a
  cycle later, most of all right after the viewer's own comment made it
  read. By then the events are no longer new and the PR is not fetched
  again, so the answer to that comment never pinged (two such replies in
  the real ping log, one 7 minutes after the viewer's comment). The decider
  keeps the fresh unseen events of read threads
  (`PingDecider.waitingForUnread`, in memory like the throttle) and decides
  them in the cycle that finds the thread unread, fetched again or not; a
  cycle that fetched nothing, or got a 304 because a full sync read the
  change first, still decides while something waits. A full sync hands its
  fresh new events over too (`keepSyncedNews`), on read and unread threads,
  since it can be the one that stores the reply first and takes the inbox
  change the poll would have seen; they are decided by the poll cycle
  right after the sync. Not on the first sync into an empty store, which is
  a baseline like the poll's first look. Events
  that go stale or seen drop out, and a thread read on github.com stays
  read, so nothing waits forever.
- `pingRule` in core classes the events: `bot` (bot-only), `muted`, `quiet`,
  `not_addressed` (loud, but not aimed at the user in person: a comment or
  approval on their PR, merged without their review) or `addressed` (mention,
  team mention, question, reply, and on an open PR: review request (made by
  a person or a bot, see "A review request counts by whom it asks"), a push
  after approval the agent raised, changes requested on their own PR, and
  on a non-draft PR the author's push or comment after the user's changes
  request, headline "@pim addressed your changes"). Agent and user
  overrides count.
- `routed` (2026-09-29): a review request routed to the viewer's team on a
  PR from outside the team (not theirs, not a teammate's), made by a person
  or a bot. A routing team's request is routed on any PR but the viewer's
  own, a teammate's too (2026-09-30, see "Team roles"). It never pings from the poll and never reaches the agent; it
  pings when the glance says Look closer (below).
- `snoozed` (2026-09-29): the tile holding the PR is still snoozed with the
  new events in (the decider reads the tile state off the board), so nothing
  pings. Human news wakes a snooze first, and since 2026-09-30 so does
  automation the agent raised to loud (it used to stay behind the snooze and
  still ping, found by the property tests, see "Tests across rules"); what
  stays behind a snooze is quiet.
- Raised after the decision (2026-09-30): the events agent judges new events
  only after the poll decided them (catch-up run or next full sync), so when it
  raises one to loud (a push after approval starts quiet) the PR's fresh unseen
  events are decided again (`PingDecider.decideRaised`, told through
  `DigestDeps.onEventsRaised`), only while that event is within 30 minutes and
  unseen and the thread has not pinged since it, and the ping waits in
  `RaisedPings` for the next poll cycle like a Look closer ping.
- Everything but `addressed` is decided by the rules: no ping, no agent.
- `addressed` items of one cycle go to Sonnet in one `ping_decision` call:
  instructions, topic tailoring, dossier brief, glance, the new events (fenced
  as `<github_data>`), rule loudness and reason, whose turn and the why-here
  code. Answer per item (zod): `{ id, ping, title, body, reason }`. The agent
  may veto or rephrase, never add.
- Live conversation (2026-10-02, `isLiveConversation`): a mention, reply or
  question from a person at most two hours (`CONVERSATION_WINDOW_MS`) after
  the viewer's own comment or review on the PR (an approval or a push alone
  is not talking) always pings, whichever of the item's events leads it
  (a newer team mention must not hide the reply), and the notification is
  about the reply: its template text and the Dock bounce come from it. The agent writes the text but cannot veto
  it: it used to drop such answers as "asks nothing", which is still the
  answer the viewer waits for. The item says "Live conversation" in the
  prompt; a veto is stored as a ping with the reason "live conversation,
  pings anyway; agent: …" and the template text when the agent wrote none.
  "You already replied" still keeps it quiet. The call takes seconds, so right before a
  ping goes out the thread must still be unread and one of its events still
  unseen; a PR read meanwhile does not ping.
- Fallback when the call fails, skips an item, or the daily cap is spent
  (`POSTPILE_PING_CAP`, default 200 calls per rolling 24h): ping with
  `pingTemplate` text ("@bob asked you something · app#1850").
- Every decision lands in `ping_decision` (migration 007): thread, PR, ping
  yes/no, source rules / agent / fallback, title, body, reason, time.

**Routed team requests ping when the glance says Look closer** (decided
2026-09-29). Data from Julian's last week: about 120 routed team-devex PRs,
only 6 of the 63 glanced ones were NOT_YOURS, so "ping all unless not yours"
would be 30-40 pings a day; LOOK_CLOSER was 27 a week. Julian: "'Look
closer' is exactly what I want on these, and the minutes delay doesn't
matter at all because currently I might look in the evening or the next
day." And on teammates: "if the verdict was look closer we can ignore
teammate even".

- A routed team request (class `routed` above) pings when the PR's glance is
  written or rewritten with verdict LOOK_CLOSER while that team request is
  still pending (not removed), the viewer has not reviewed the head (or
  approved), and no tile holding the PR is snoozed. A teammate's review
  does not stop it, and whose turn does not have to be the viewer's.
- Hooked where glances are stored (`GlanceBatchWriter` tells
  `DigestDeps.onGlancesStored`, in a full sync's digest and in a catch-up
  run), not in the poll. Rule in core `lookCloserPingCheck`
  (`glance-pings.ts`), engine `GlancePings`.
- Once per request: the request is the newest timeline request for the team
  (`teamRequestId`), kept in meta `look_closer_ping:<pr>`. A rewritten glance
  does not ping again for the same request; a new request after a removal
  can.
- Recorded as a `ping_decision` row with source `glance` and reason "Look
  closer: review routed to team-devex"; the debug view shows it ("pinged by
  the glance"). Text like other review pings: "Look closer: review for
  team-devex · app#1850", body the PR title and the glance's first for-you
  sentence (`lookCloserPingText`).
- A ping must lead to something visible: it adds an app-made loud event
  (kind `look_closer`, summary "Look closer: review routed to team-devex",
  `lookCloserEvent`), so the tile is unread with that reason even when a
  teammate reviewed; a mark-read clears it as usual. Snapshot stores keep
  app-made events (`APP_EVENT_KINDS` in the store's `upsertDerived`).
- Delivery: the ping waits in `GlancePings` and goes out with the next poll
  cycle's pings (`PollRun` drains it), through the same throttle.
- Other verdicts (LOOKS_SAFE, NOT_YOURS) never ping for routed requests; the
  tile still shows in To review as before. Personal requests and team
  requests on a teammate's PR keep pinging from the poll (class
  `addressed`).
- `pings_summarized` counts these as `pinged_glance`, apart from the poll's
  decisions.

**Mac notifications** (desktop main, `MacNotifier`):

- `PingThrottle`: at most one notification per tile per 2 minutes; more than
  3 in one cycle become one summary ("4 PRs need you", first titles listed,
  a click opens the first PR still on the board). `MacNotification.prKeys`
  lists every PR it is about.
- Native `Notification` with sound. A click shows and focuses the window,
  looks the target up on the board as it is now (`pingClickTarget`, see the
  2026-10-01 note below) and sends `postpile:open-ping` with
  `{topicId, tileId, prKey}`; the renderer navigates through `go()`, so it
  is a normal history entry.
- Closing the window hides it on macOS and the app keeps polling; Cmd+Q quits
  (flushes mark-reads as before). Dock click shows the window again.
- macOS asks for permission on the first notification. Electron cannot read
  that permission, so a denial only means nothing shows up; tiles still turn
  unread. `POSTPILE_MAC_NOTIFICATIONS=0` turns notifications off (the poll
  still runs). The user's pick is under "Interruptions"; quiet hours are
  not built.
- **Permission at a calm moment** (changed 2026-10-05): once the user picks
  batches or as soon as it matters (setup or the sidebar), the app shows one
  welcome notification saying what to expect ("PostPile will send a short
  roundup here at 9:30, 13:30, 16:30 on weekdays…" or "PostPile will tap
  you here when someone is waiting on you"), so macOS asks for the
  permission then and not on the first real ping (flag file
  `welcome-notification.json` in userData; also checked a few seconds after
  start for an earlier pick). Under Never nothing asks. Not stored while
  notifications are off (`POSTPILE_MAC_NOTIFICATIONS=0`), so it comes once
  they work. Before, it came on every first launch. The first launch itself
  is marked by `launched.json` (telemetry `first_launch`). "Send a test
  notification" in the sidebar's Interruptions menu sends a test over the
  preload (`sendTestNotification`, IPC `postpile:test-notification`) and
  says in a toast whether it was shown, off or unsupported. Dev runs are the
  Electron binary and show up as "Electron" in System Settings ›
  Notifications; the packaged app has its own "PostPile" entry, so the
  permission is asked (and set) once for each.

**Ping clicks look up their target, visits clear pings** (2026-10-01):

- Wrong target on click: the ping carried the topic and tile ids from when
  it was decided, and the click replayed them. Tiles get rebuilt and topics
  tidied, merged, split or reassigned between ping and click (a Look closer
  ping is even decided before the same sync regroups sets). For a topic the
  sidebar does not list (gone, or hidden by the search, the "Topics with"
  switch or the repo scope) the renderer showed the first listed topic and
  its first unread tile instead, and with no filter on it pinned that
  wrong pick into the history entry.
- Now main asks the engine at click time (`pingClickTarget` in core,
  `EngineService.pingClickTarget`): the tile holding the first of the
  ping's PRs still on the board, by PR key; else the topic it pinged in,
  while that is still active, finished or a non-empty Unsorted; else the
  click only brings the app to the front.
- The renderer reveals the target past its filters: the search, the queue
  filter and the repo scope stay as they are, the ping's topic shows anyway
  (listed in the sidebar like a kept view, or opened by id like a Finished
  topic when the list does not hold it). It holds while the user stays in
  that topic under the same filters.
- Owner request: opening a tile in the app (a click on the tile or one of
  its PRs, a ping click; not a tile the app picked on its own) takes that
  tile's pings, and only those, out of Notification Center. The renderer
  sends the tile's PR keys over `postpile:tile-visited` (preload
  `tileVisited`); `PingShelf.closeVisited` closes every ping about any of
  them, so a summary goes once any of its PRs' tiles is visited. Clicked,
  closed and taken-back pings drop their references.

**Dock badge, cleared pings and the bounce** (decided 2026-09-30, desktop
main, `BoardWatcher`):

- The Dock badge (`app.setBadgeCount`, 0 clears it) counts the tiles
  PostPile pinged about that are not handled yet (since 2026-10-05, see
  "Interruptions"; from 2026-09-30 it counted topics with an unread tile,
  before that your-move tiles). It is read from the engine's `pingBadge()`,
  no rule is repeated in main. It is read at start, after each shown ping,
  after a tile visit and a change of the pick, when
  the live status moves (`changeCount`, which also counts every ended sync,
  `catchUpChanges`, `syncRunning`; checked every 5s) and after every non-read API request, which covers local
  actions (mark read, done, snooze, approve). Fake mode shows it too.
- A ping leaves Notification Center once its PR is not held by an unread tile
  anymore (read, done or snoozed in PostPile), through
  `Notification.close()`. `PingShelf` keeps the delivered notifications by PR
  and drops references older than 24 hours; the list of unread PRs comes from
  `unreadPrKeys()`. A summary is kept under all its PRs and closes once
  none of them is unread.
- The Dock bounces once (`app.dock.bounce('informational')`) for a batch with
  a personal ping, only while the window is not focused. Personal
  (`isPersonalPing` in core, carried as `personal` on `Ping` and
  `MacNotification`): mention, question, reply, or a review request that names
  the user and not a team, or the author's answer to the user's changes
  request ("addressed your changes"). Team mentions, team requests, routed
  Look closer pings and other pushes and changes requests do not bounce. A summary is personal when
  any of its pings is.

**Fake mode**: `FakeLivePoll` adds a sample question to the next open pinged
tile on the first cycle at least 45s after the last one (so once a minute,
as the sample X-Poll-Interval is 60) and pings for it with a fake rules decision, through the same
`LivePoller` and throttle.

**Cost**: a `ping_decision` call measured about $0.04 and 4-5s (2 items, real
instructions). One call per poll cycle with addressed news, so a normal day is
roughly 10-40 calls, $0.40-1.50; the cap bounds it at 200 calls (about $8).
Poll topic assignments add a few calls a day for PRs new to the app.

## Glance catch-up

Decided 2026-09-29: glances catch up automatically, as soon as possible,
with one queued follow-up per topic. No manual refresh button per PR or
topic; only Retry on a glance that failed. Before this, a new PR showed
"no glance yet, the next sync picks it up" until the user pressed Sync now.

**Trigger** (`topicsToCatchUp`, called by `PollRun` after topic assignment
and the ping decisions, never on the first look at an empty store; while
the agent is off the queue skips the topics and they wait with the quiet ones
until it is back, since no later poll reports their events as new): a fetched PR with a new event whose effective loudness is
loud, or a PR that should have a glance (open, pinged or found, in a tile)
and has none. Since 2026-10-05 any memory trigger counts, not only loud
events (`isMemoryTrigger`, "Event roles"): a person's push, comment,
approval or merge on a PR not aimed at the user, and a bot changing the PR
itself. Before, those waited for the hourly sync and their glances read
"out of date" while browsing, and every full sync spent its calls on that
backlog. Bot comments still wait for the next real update and noise (CI,
bot edits, deploys) never counts. Loud news and a missing glance run right
away; other triggers run a topic at most once per 15 minutes
(`QuietCatchUps`, `QUIET_CATCH_UP_MINUTES`): the first at once, the rest
wait and one run covers them. Every poll cycle, news or not, starts the
topics whose wait ended. A full sync leaves the waiting list alone: it may
never digest (gh off, a crash), and a run after a sync that covered the
topic finds nothing to do and makes no agent call. Telemetry
(2026-10-05) showed why: three heavy installs already used the whole daily
cap with loud news alone, and an agent pushing 27 times an hour into one
topic would otherwise start a run per push. The topic is the PR's
membership; Unsorted (null) counts as one topic.

**Run** (`TopicCatchUp`, one topic): the full sync's digest jobs, scoped by
`TopicScope`, in the same budget order: the topic's dossier update from the
events after its digest cursor (`DossierUpdater.start(scope)`), the event
second opinion for the topic (`EventBatchClassifier.run(scope)`; chosen
because it is one cheap call and moves the classify cursor, so the sync
does not repeat it), glances for its PRs that are missing or stale once the
dossier landed, with the retry batch (`GlanceBatchWriter.run(dossiers,
scope)`), the fact reconcile for the dossier's candidates, and the
driver/role refresh when a dossier was written. Topic assignment is not
part of it: the poll already did it. Sets and stack layers stay with the
full sync. Calls land in their own run, `catchup:<topic>:<time>`:
`AgentCallLog.withRun` scopes them with AsyncLocalStorage, since runs go
side by side with poll cycles and each other (sync, consolidation and poll
still use begin/end, they never overlap).

**Coalescing** (`CatchUpQueue`): at most one run per topic at a time. A
request for a topic whose run is going marks exactly one follow-up; more
requests in the meantime change nothing. The follow-up starts when the run
ends, so it sees everything that arrived meanwhile. Different topics run
side by side, at most two at once (`MAX_RUNNING_CATCH_UPS`, 2026-10-05:
each run holds boards across its agent calls, and a poll with news in many
topics ran a heavy install out of memory). A request beyond that waits its
turn, first come first served; a topic's follow-up goes to the back of the
line, so one busy topic cannot keep the others waiting. While runs may not
start (a consolidation, the agent off) the line keeps them, their events
are stored and no later poll asks again; the queue resumes when a
consolidation ends and on every poll cycle. Only a full sync drops it, as
it covers every topic. The runner's limiter (`POSTPILE_AGENT_CONCURRENCY`)
caps the calls.

**Never beside a full sync or consolidation**: a request while one runs is
skipped (the sync covers every topic; the poll is blocked then anyway). A
sync drops queued follow-ups and waits for running runs before it starts,
like it waits for a poll cycle; consolidation waits for them too.

**Caps**: per run `3 + 2 * ceil(glance targets in the topic / 18)` (dossier,
events, reconcile, each glance batch with its retry). On top, a daily cap
over all runs, a rolling 24h window in memory (`CatchUpCap`,
`POSTPILE_CATCHUP_CAP`, default 600, 300 before catch-up took quiet news
(2026-10-05); a dev session with
`POSTPILE_MAX_AGENT_CALLS=0` defaults to 0). 0 turns catch-up off. The
daily cap is asked only after the run's cap said yes (`AgentBudget` with a
`CallAllowance`). A glance it refuses gets the gap `daily_cap`; a dossier it
refuses skips the topic's glances (`daily_cap` gaps too).

**Glance state** (`glanceStateOf` in core, `PrSummary.glanceState`,
`PrDetail.glanceState`): `ready` (a glance; stale shows separately),
`writing` (a run on its topic is going and the glance is missing or
stale), `queued` (a follow-up is queued, or nothing recorded yet: the next
run or sync writes it), `agent_off`, `failed` (asked twice, no usable
answer), `capped` (`call_cap` or `daily_cap` gap), `none` (merged, closed,
pulled in: gets no glance). The renderer words them (`glanceStateText`):
"Writing the glance…" with a spinner, "Glance queued", "Agent features are
off", "Waiting: daily agent limit reached, next full sync in N min" (or
"the last sync hit its agent-call cap"), "Glance failed" with Retry.
Pulled-in stack layers keep "Pulled in to complete the stack".

**Retry** (`POST /api/prs/:owner/:repo/:number/glance/retry`,
`retryGlance`): clears the PR's glance gap and requests a run for its topic
(or the one follow-up when a run is going). Refused while the agent is off,
the daily cap is spent or consolidation runs; during a sync it answers that
the sync retries it. Local, agent calls only, not on the `GithubWrite` list.

**Out of date wording** (2026-09-29, the renderer's `lib/staleness.ts`):
one wording everywhere for "not up to date". While a full sync runs
(`useActions().syncing`) or a catch-up run writes for the PR or topic
(`glanceState` `writing` on the PR for its glance; `TopicDetail` /
`PrDetail.memoryUpdating` for the dossier and facts, set only by a
whole-topic run, never by a glance-only refresh on look), every note says
"updating": the tile's verdict chip "· updating",
the stale verdict box "Updating now: a new assessment is being written.",
the dossier's "Updating now: 3 newer events.", a stale memory badge
"updating · PR moved since" and its "Why?" check "Updating now: PR moved
since" (the topic's or PR's updating state is passed into `MemoryLine`,
`WhyPanel` and `checkLabel`, not read from the sync alone), the live footer
"paused while syncing". When nothing runs: "out of date" ("· out of date",
"Out of date: 3 newer events not in the dossier yet.", "Out of date: PR
moved since" in "Why?"). "Stale"
and "Sync to refresh it" are gone from the UI. "Newer events" counts trigger
events only (2026-10-02, see "Event roles"): a bot refreshing its status
comment or a CI result never makes the dossier look out of date.

**Refresh**: `LivePollStatus.catchUpChanges` grows on every queue, start and
end; `useLivePoll` refetches everything when it moves, so a tile flips from
"Writing" to its verdict within the 5s status poll.

**Fake mode**: `FakeCatchUp` walks the first sample PR without a glance
queued -> writing -> ready (4s + 6s) once the renderer first reads the live
status, and marks the second one failed so Retry can be tried.

## Glance refresh on look

Decided 2026-10-01: a stale glance is rewritten when the user looks at the
PR. Quiet news (an author push, bot comments, CI) did not trigger a
catch-up then, so a stale glance waited up to an hour for the full sync, also
while the user was looking at that very PR. Since 2026-10-05 an author push
and other memory triggers do ("Glance catch-up"); the look refresh stays
for what is left, like a glance that went stale while the daily cap was
spent. Owner: the hourly sync is too
slow when they are looking at the PR. The cost stays low because only
opened PRs with a stale glance refresh. Automatic, not a button: "No
manual refresh per PR or topic" (2026-09-29) still holds.

**Trigger** (renderer, `useGlanceLook` in `DetailPane`, `GlanceLookTimer`):
the PR stays in the detail pane for the opened-mark dwell
(`OPENED_READ_DELAY_MS`, 1.5s) while the window is visible, and
`wantsGlanceRefresh` holds: `glanceStale` or `glanceBehindDossier`
(2026-10-05), no `glanceRefreshBlock`, and
`glanceState` not `writing` or `queued`. Clicking through PRs asks nothing.
Once per open: re-renders and refetches ask nothing more; a glance that
turns stale later in the same open asks then. The renderer only asks
(`POST /api/prs/:owner/:repo/:number/glance/look`,
`useActions().refreshGlanceOnLook`, quiet, local, not on the `GithubWrite`
list); the engine decides.

**Engine** (`Engine.refreshGlanceOnLook`, answers `GlanceLookResult`), in
order: `blocked` while the agent is off, catch-up is off
(`POSTPILE_CATCHUP_CAP=0`, or `POSTPILE_MAX_AGENT_CALLS=0` in dev) or the
daily catch-up cap is spent: no call, the existing wording stays.
`deferred` while a full sync or consolidation runs: the renderer asks only
once per open, so the engine keeps the look and asks again when that run
ends (consolidation writes no glances; after a sync the re-check usually
finds it `current`). `current` when `TopicCatchUp.needsGlance` finds the
stored input hash still matching (or the PR gets no glance): no call. Else
`CatchUpQueue.requestGlance`:

- `covered` when a run for its topic is queued (whole-topic, or a glance
  run for this PR): it starts later and sees the PR as it is now.
- `queued` behind any run already going for the topic, whole-topic or
  glance-only: a going run may have read its inputs before the PR changed.
  The follow-up checks the hash again, so it makes no call when the going
  run wrote a current glance. A whole-topic follow-up queued meanwhile wins
  and covers it.
- `started`: a glance-only run (`TopicCatchUp.runGlances`), still one run
  per topic at a time, so it never writes beside the topic's own run.

**Run**: the glance batch path of a sync (`GlanceBatchWriter.run` with
`TopicScope.prKeys`): the same prompt, inputs, store writes and
`onGlancesStored`, so Look closer pings behave as for any new glance. The
topic's dossier is used as it is, never rewritten here. The writer checks
the hash again before it calls. Budget: `2 * ceil(PRs / 18)` per run plus
the daily `CatchUpCap`, so it counts against the 300 a day. Calls land in
`catchup:<topic>:glance:<time>`; the log says `catch-up <topic> glance
<pr>: ...` for the request and the run. No `catch_up_ran` event: that one
counts whole-topic runs.

**State and wording**: while the run goes, `CatchUpQueue.stateOf(topic,
pr)` is `running` for that PR only (a whole-topic run still counts for every
PR of the topic), so `glanceState` is `writing` and the stale verdict box
says "Updating now: a new assessment is being written." and the tile chip
"· updating", with no renderer logic of its own. Memory notes (dossier,
facts) read `memoryUpdating` instead, which only a whole-topic run sets
(`stateOf(topic)` without a PR): a glance-only run rewrites no memory, so
stale memory keeps saying "out of date". The run's start and end
move `catchUpChanges`, so the refreshed glance arrives with the normal
refetch. `glanceRefreshBlock` (`glanceRefreshBlockOf` in core, on
`PrSummary`, `TileVerdict` and `PrDetail`) says when a look cannot refresh:
`no_glance`, `agent_off`, `catch_up_off`, `daily_cap`. Only then the stale
note keeps "A new assessment will be written on the next sync." (tooltip
"The next sync writes a new one."); otherwise it says "A new assessment is
written when you stay on this PR." (tooltip "Opening the PR writes a new
one.").

**Fake mode**: `FakeEngine.refreshGlanceOnLook` rewrites the stale sample
glance (#1904) through `FakeCatchUp.refreshOnLook`: writing, then a canned
current glance.

## Auto sync

A full sync every `POSTPILE_AUTO_SYNC_MINUTES` (default 60, 0 off; the
default is off with `POSTPILE_SYNC_ON_START=0`, so no-traffic runs stay that
way) while the desktop app runs. `AutoSyncSchedule` lives in the engine
(like the work context schedule, on `Timers`), started by main with the
app's sync call cap (`startAutoSync`). The interval counts from the end of
the last sync, whoever started it (`reschedule` on every sync end), so a
"Sync now" pushes it out; at the due time a running sync means skip. The
renderer sees it through `LivePollStatus.syncRunning` (the title bar shows
`syncing · … · agent calls 34/82` like for "Sync now", `useActions().syncing` covers
both) and `nextAutoSyncAt` ("next full sync in N min"). The last sync shown
is the newer of this window's and the stored report. Between syncs the title bar
reads the live poll, not the report (2026-10-05): "up to date" while the
poll runs normally and GitHub answered it within three cycles
(`pollIsFresh` on `LivePollStatus.lastAnsweredAt`; blocked and failed
cycles stamp only `lastPollAt`, and a retry keeps that stamp), "updates
paused" (amber) while it is blocked or backing off, "checked 5m ago" (amber) once it fell
behind, "synced 2h ago" only while the poll is off. Sync errors and the call cap still show next to it; the full sync's
time and report sit in the tooltip. Full syncs were
start-only and manual before (2026-09-29). While the GitHub quota is low, a
due auto sync (the backlog follow-up too) waits until the reset instead
(see "GitHub quota"). After the Mac wakes from sleep the next auto sync
waits at least 3 minutes (see "Memory on big boards").

## GitHub quota

Decided 2026-09-29: PostPile never uses the full GitHub quota. It reads with
the user's own `gh auth token`, so it shares the hourly limits (REST core
5000 requests, GraphQL 5000 points) with their gh CLI and every other tool,
and leaves clear headroom for them.

**Tracking** (`GitHubQuota` in engine `github-quota.ts`, rules in core
`github-quota.ts`): `quotaFetch` wraps the fetch every GitHub read and write
goes through (inside `watchedFetch`) and notes each answer's
`X-RateLimit-Limit`, `-Remaining`, `-Reset` and `-Resource`. Only `core` and
`graphql` count; search has its own small per-minute window. In memory only:
the newest reading per limit (within one window the lower remaining wins,
since answers can arrive out of order), a request count since start and per
sync. A reading past its reset counts as a full limit, so paused work
resumes at the reset without a request to find out.

**Levels** (`quotaLevel`, the worst of the two limits):

| level | share left | what waits until the reset |
| --- | --- | --- |
| `ok` | more than 50% | nothing |
| `low` | 50% or less | the hourly auto sync and its backlog follow-ups; the live poll slows to once a minute (`LOW_QUOTA_POLL_SECONDS`) |
| `critical` | 20% or less | the live poll too |

- One place answers "may background GitHub work run now?":
  `allowsBackground()` / `backgroundPausedUntil()` (auto sync),
  `pollSeconds()` / `pollPausedUntil()` (live poll). The paused auto sync
  moves its due time to the reset, so "next full sync in N min" stays true.
  The paused poll shows "live · paused: GitHub quota nearly used" and
  schedules its next cycle at the reset; a cycle asked for meanwhile (sync
  end) waits too, and window focus runs none.
- Not held back: a sync the user or the app start asked for (it runs and
  logs "GitHub quota low (graphql 40% left), running anyway"), so the first
  sync after setup always runs; writes and the refresh right after them.
- Glance catch-up is not gated: its runs make agent calls only, no GitHub
  requests. It follows the poll, so it slows and pauses with it.

**Footer**: `LivePollStatus.githubQuota` (`GitHubQuotaView`: level, the
worst limit, percent left, `resumeAt`, the poll's pace) is null at `ok`, so
the footer stays quiet. Otherwise it says "GitHub quota low: background sync
paused until 14:05" or "GitHub quota nearly used: background sync and live
poll paused until 14:05", with the limit and percent in the tooltip.

**Telemetry**: `github_quota_low {resource, level}` once per drop into a
worse level within one window, `sync_completed` gets `gh_requests` and the
lowest percent left per limit during the sync (see "Usage analytics").

Sample data simulates it with `POSTPILE_FAKE_QUOTA=low` or `critical` (a
GraphQL reading that resets 35 minutes after start).

## Work context sweep ("What you're working on")

A short, agent-written digest of what the user is working on, taken from
their local Claude Code data and fed to the relevance prompts as background.
Agent-derived memory in the sense of "Memory by author": it never touches
instructions.md, and the user steers it only with Forget and Refresh.

**Collect** (engine `work-context/collector.ts`, deterministic, no agent tools),
from `POSTPILE_CLAUDE_DIR` (default `~/.claude`):

- `CLAUDE.md` plus the files it @-includes (`@RTK.md`, `@~/x.md`), resolved
  against the including file's folder and its symlink target's folder, only
  under `~/.claude` or the folder the symlink points into (the dotfiles),
  checked on the path before any disk lookup (no stat outside those folders).
  Lines in code fences do not count. Depth 3. Nothing is read from a macOS
  privacy folder (`macPrivacyFolders` in core: `~/Documents`, `~/Desktop`,
  `~/Downloads`, `~/Pictures`, `~/Movies`, `~/Music`, `~/Library/Mobile
  Documents`, `~/Library/CloudStorage`, `~/Library/Group Containers`,
  `~/Library/Containers`, `/Volumes`): a CLAUDE.md whose symlink or realpath
  lands there, an include root there, or an include that links there is
  logged ("skipped ... a macOS privacy folder"), counted as a drop and never
  touched. Symlinks are checked one hop before realpath follows them.
- **No symlinks under `projects/`**: project folders, memory folders, memory
  files and session files that are symlinks are skipped (lstat). Claude
  Code only makes real ones, and a link could point anywhere.
- **Skip list first**: `projects/*` folders on the skip list are never
  opened, neither memory nor sessions, so private projects never leave the
  machine (`work-context/skip-list.ts`). Defaults: generic words only,
  `personal`, `private`, since they ship with the app. The user's own list lives in `sweepSkip` of
  `~/.config/postpile/config.json` (dev: `~/.config/postpile-dev/`), edited
  as one comma-separated input under the digest and read again on every
  sweep, so it holds for the packaged app launched from Finder (no shell
  env there). Precedence: `POSTPILE_SWEEP_SKIP` (comma separated, empty
  skips nothing), then the config file, then the defaults. While the env
  var is set the input is read-only and says so. Matching never touches the disk:
  decoding a folder like `-Users-me-workspace-taxes` on disk used to
  stat paths under `~/Pictures`, cloud drives and `/Volumes`, and macOS asked
  for privacy permissions at launch. A folder is skipped when the pattern's
  tokens (lowercased, split on non-alphanumerics) appear as a run of whole
  tokens anywhere in the folder name. The encoding is lossy (`/`, `.`, `_`
  and `-` all become `-`), so a match in a parent folder or mid-name skips
  too: over-skipping only loses context, under-skipping leaks. `tax` still
  never matches `taxes`. The count lands in `inputStats.skippedProjects` (names stay
  out), the log says "skipped N project folders", and the UI shows the list
  read-only under the digest (`WorkContextView.skipPatterns`).
- Every other `projects/*/memory/*.md`, ref = path incl. the project folder.
  MEMORY.md indexes first, then files changed in the last 7 days, then the
  rest, newest first. 2,500 chars per index, 1,200 per file.
- Sessions: `projects/*/*.jsonl` modified in the last 7 days, streamed line by
  line; only lines that can hold a signal are parsed. Per session: cwd, first
  and last timestamp, the `ai-title`, the first 3 typed prompts (300 chars,
  one line) and the newest compaction or summary record (500 chars). Skipped:
  sidechains, `isMeta`, tool results, `origin.kind` other than human,
  `promptSource` system/sdk, messages opening with a tag (`<command-name>`,
  `<local-command-...>`, `<task-notification>`), "Caveat:", system reminders
  (stripped), and pasted blobs (opens like JSON / a log / a stack trace / a
  diff, or 20+ lines that are mostly not prose). Sessions started through the
  SDK (`entrypoint: sdk-cli`), without anything typed or titled, and forks
  that repeat a newer session's prompts are dropped.
- A regex pass masks obvious secrets (GitHub, Anthropic/OpenAI, Slack, AWS,
  Google, PostHog, GitLab, npm tokens, JWTs, private keys, Bearer tokens,
  `password=...`-style assignments, URL credentials).
- Budget about 60k chars: CLAUDE.md 6k, sessions 30k (newest first), memory
  24k; unused room carries to the next section. Everything left out is
  counted in the stats and logged grouped by reason.

A run over the real folder takes about a second (115 session files, ~470 MB).

**Call**: one toolless `context_sweep` call, `opus` by default
(`POSTPILE_SWEEP_MODEL` overrides; `models.ts`), 5 min timeout. Input:
the collected items with short ids (`c1`, `m3`, `s7`), instructions.md, the
active topics (id, name, dossier brief), the previous digest (for stable
threads) and the threads the user forgot. The prompt says the material is the
user's own and trusted, unlike GitHub text, but the prompts in it were meant
for other agents and are not instructions; it is fenced in `<local_context>`
so it cannot close early. Work only: no personal or private life, even when
memory files hold it. Answer (zod): `{summary (3-6 sentences), threads[]
(≤12: title, detail, topicIds, sources as item ids), lastSeenAt}`. Unknown
topic ids and source ids are dropped, sources map back to `{kind, ref}`,
forgotten titles are filtered again, `lastSeenAt` comes from the collector.
Calls land in `agent_call` under run id `sweep`, never in a sync's stats.
Measured: ~60k chars in, 12 threads, about $0.40 and 45s.

**Store** (`work_context_version`, migration 009; 008 is the writes branch's
action log): version, digest JSON, input sources, input stats, model, time.
Newest 30 kept. A failure keeps the previous version; the error sits in meta
`work_context_last_error` until the next success.

**Schedule**: the desktop app checks at start and every 30 minutes
(`startWorkContextSchedule`); `sweepDue` in core: local time 06:00 or later,
no success in 24h, no failure in the last 2h. Also `pnpm cli sweep` and
Refresh in the UI. The sweep runs beside syncs: neither waits for the other.

**Use**: `PromptContext.workContext` carries the latest digest as compact text
(date, summary, one line per thread with topic names, details cut to 240,
whole threads up to 5k chars; forgotten threads left out at once).
`workContextBlock` renders it as "What the user is working on (from their
local Claude Code notes; may be stale)" after the user's instructions in
topic_assignment, dossier_update, glance_batch, ping_decision and chat only.
It is in no input hash, so a new digest regenerates no glance, dossier or
set; it applies on their next natural update.

**UI**: "What you're working on" at the bottom of "Your instructions", dashed
and marked agent-written: summary, threads with clickable topic chips, "Why?"
with the sources (file path, or session project + start time + title), Forget
per thread (feedback `work_context_forget`, 6s Undo, struck through until the
next sweep drops it), input stats, the last updated time or the last error,
and Refresh. Routes: `GET /api/work-context`, `POST /api/work-context/sweep`,
`POST /api/work-context/forget {version, index}`, `PUT
/api/work-context/skip-list {patterns}` (saved to config.json). Fake mode shows a sample
digest linked to the sample topics.

## Usage analytics

On by default, so the team can tell whether PostPile is actually working for
people, without adding an opt-out control to the UI (decided 2026-09-29): env
switches only, `POSTPILE_TELEMETRY=0` or `DO_NOT_TRACK=1`. Off in the dev
profile, fake mode and every test; `POSTPILE_TELEMETRY=1` forces it on in dev,
for checking the pipeline by hand. `posthog-node` runs in the server/engine
process only (`packages/engine/src/telemetry/`): the renderer never talks to
PostHog directly, it reports UI-only events through `POST /api/telemetry`,
validated against the same catalogue the engine's own events use
(`packages/core/src/telemetry-events.ts`, the allow-list for both). One
`Telemetry` class (`capture`, `identifyPerson`, `setViewerIdentity`,
`captureException`, `captureRendererException`, `shutdown`) plus a no-op implementation used whenever
telemetry is off, so call sites never branch on it. `Engine.close()` flushes
it, so it goes out on every quit path.

**Identity**: pseudonymous. `distinct_id` is `sha256("postpile:v1:" +
<GitHub numeric user id>)`, computed from `Viewer.databaseId` (GraphQL
`viewer { databaseId }`, stored alongside the login). Before the viewer is
known (first run, setup) a random install id lives in the data folder
(`telemetry-id`, `paths.ts`) and is aliased to the hashed id once the viewer
is fetched, so PostHog treats both as the same person. The login, name and
email are never sent. Person properties (`$set`, refreshed after every sync):
`app_version`, `os_version`, `arch`, `is_posthog_member` (the viewer's teams
include a `PostHog/...` team), `agent_available` (`claude` found). Super
properties on every event: `app_version`, `profile`, `$process_person_profile`.

**The leak guard**: every prop is checked in the `Telemetry` class itself
before anything leaves the process — a string longer than 40 characters or
containing `/` or `#` is dropped and logged once
(`packages/core/src/telemetry-guard.ts`). This is on top of the catalogue
only allowing enums, counts, durations and booleans in the first place: PR
titles, bodies, repo names, branch names, logins, prompts, agent text and
topic names are never event props.

**Errors** (PostHog Error Tracking, `$exception` events):

- *Where they come from*: uncaught exceptions and unhandled rejections of
  the main process and the server go through `captureException`. The
  renderer's go through `captureRendererException`: window `error` and
  `unhandledrejection` handlers plus an `ErrorBoundary` at the app root
  (`apps/desktop/src/renderer/src/lib/error-report.ts`, a reload screen
  instead of a blank window) post the raw error to `POST /api/telemetry` as
  `renderer_exception`, validated by `rendererExceptionProps` (strict, size
  caps). Raw is fine there: it only reaches the local server, and the one
  scrubber runs in the engine before anything leaves. At most 20 reports per
  window load; a failed post is swallowed, never shown. Off with the rest of
  telemetry (the no-op drops them).
- *Scrubbing* (`packages/core/src/telemetry-errors.ts`): the class name
  (anything that is not an identifier becomes `Error`), the message with URLs,
  anything containing a slash (paths, `owner/repo`), `#123` and double-quoted
  snippets (JSON.parse quotes its input) replaced, cut at 200 characters, and
  up to 10 frames from the app's own bundle only: the path after the last
  bundle marker (`out/`, `.asar/`, …) plus line and column, e.g.
  `main/chunks/engine-from-env-<hash>.js:35040:12`. node_modules and
  Node-internal frames are dropped, function names are not sent, and a thrown
  non-Error value gets no frames.
- *Source maps*: electron-vite writes hidden source maps (no
  `sourceMappingURL`, left out of the app by `electron-builder.yml`). The
  release workflow runs `posthog-cli sourcemap inject` on `out/main` and
  `out/renderer`, which prepends a snippet recording each file's chunk id in
  `globalThis._posthogChunkIds`, and uploads the maps keyed by chunk id
  (RELEASING.md). The scrubber maps each frame's bundle file to its chunk id,
  and the `Telemetry` class sends its own `$exception_list` (oldest frame
  first, `filename`, `lineno`, `colno`, `chunk_id`, `in_app`, platform
  `node:javascript` or `web:javascript`) instead of letting posthog-node parse
  a stack: the SDK would look chunk ids up by the full, unscrubbed path.
  Builds without the upload (dev, local `pnpm dist`, a release without the
  secret) send the same frames without chunk ids.
- *Release*: `inject --release-name postpile --release-version <version>`
  also records the PostHog release id in `_posthogReleaseId`, and posthog-node
  sends it as `$release_id` on every exception (renderer errors use the main
  process's, the same release), so an issue can be marked resolved in a
  version. `app_version` stays a super property either way. Also
  `process_type` (`main` or `renderer`) and a mechanism (`generic`,
  `onerror`, `onunhandledrejection`, `react_error_boundary`, all unhandled).

**Events** (snake_case; the full typed list, incl. prop shapes, is
`TELEMETRY_EVENTS` in `packages/core/src/telemetry-events.ts`):

1. *Activation*: `app_launched` (first_launch), `setup_step_viewed` (step),
   `setup_completed`, `setup_skipped`, `setup_fit_checked` (notes, ok),
   `setup_fit_fixed` (kind, fix: the renderer's, one per fix taken),
   `first_sync_completed` (prs, topics,
   duration_ms, agent_calls — fires once ever, a meta flag), `tool_missing`
   (tool, reason — once per state change, from `ToolHealth`).
2. *Retention*: `app_active` (once per calendar day), `window_focused`
   (throttled to once per 30 minutes).
3. *Core actions*: `tile_opened` (`for_whom` gained `routing` on
   2026-09-30), `pr_approved` (from `detail`, `tile`, `agent_tile` or
   `agent_topic`; `was_agent_approved` true for the agent ones; since
   2026-10-06 `with_note` and `note`: `none`, `agent`, `agent_edited` or
   `own`, from the composer, never the text), `comment_review_sent` (note:
   `agent`, `agent_edited` or `own`, 2026-10-06), `marked_read`
   (origin `tile`, `detail`, `debug`, `cleanup`, `agent_tile` or
   `agent_topic`; count is the tile count for the agent ones), `team_request_removed` (no
   props: no PR, no team slug), `snoozed`
   (the condition name for an event-based snooze — someone replies or a
   push; `ci_green` until 0.21.0 — or a time bucket for `until_time`), `opened_on_github`,
   `ask_sent` (the Ask popover's send), `reply_sent` (target `thread` or
   `comment`, 2026-10-05), `reaction_sent` (a thumbs up, 2026-10-05),
   `chat_message_sent` (tile and topic chat), `mac_ping_shown` /
   `mac_ping_clicked`, `interruptions_changed` (mode, from setup,
   sidebar or the one-time prompt, 2026-10-05), `pings_summarized` (pinged, withheld_rules,
   withheld_agent, pinged_glance (Look closer on routed reviews),
   handled_quietly: counts since the last summary, from
   `ping_decision` and the action log's `quiet` mark-reads; the engine sends
   it at most once an hour after a sync or a poll cycle, window end kept in
   meta `pings_summarized_at`; nothing when every count is 0, the first call
   only starts the clock; no per-notification events), `search_used` (throttled, query length bucket only),
   `queue_filter_changed`, `topic_opened` (section: core's `TopicSection`, since 2026-10-02 `you_drive`, `team_owns`, `other_work`, `other_topics` instead of `my_prs`, `team_prs`, `other`), `driver_set` (the header's driver menu: kind you / teammate / team / outside / automatic, never a login), `topic_archived` ("Archive
   now" on a topic with nothing left), `update_pill_clicked`
   (the title bar pill opened) / `update_later_clicked`, `update_bar_shown`
   (releases_behind capped at 10, hours_behind rounded; once per app run) /
   `update_bar_later_clicked`, `update_restart_clicked` ("Restart to update"
   in the pill's popover or the bar),
   `glance_retry_clicked` (Retry on a failed glance).
4. *Agent trust*: `wrong_topic_marked` (`from` `suggestion` / `search` when a topic was picked in "Move to topic…"), `not_related_marked`,
   `recheck_requested`, `recheck_proposed` (outcome: the agent's answer),
   `recheck_resolved` (outcome keep/fix/drop: the user's Accept in the
   recheck dialog, sent with the correction as `fromRecheck`),
   `memory_corrected`, `proposal_resolved`
   (kind `topic_merge` / `rename` / `topic_split` / `rule` / `instructions`;
   source `consolidation` / `agent` on topic proposals), `instructions_edited`.
5. *Health*: `sync_completed` (duration_ms, prs_fetched, new_events,
   agent_calls, agent_failures, cost_usd rounded to cents, stopped_at_cap,
   trigger `start`/`manual`/`auto`, auto = the hourly background sync,
   gh_requests = GitHub requests made while it ran, gh_core_remaining_pct and
   gh_graphql_remaining_pct = the lowest whole percent of that limit left
   during the sync, absent when no answer carried it, writes_on = GitHub
   writes on when it ended, since 2026-10-05; heap_used_mb and heap_limit_mb
   = the V8 heap of the process that ran it, Electron main in the app, in
   whole MB, used at the end and the limit, since 0.18.0),
   `app_crashed_last_run` (version_changed: sent at start when the last run
   ended without a clean quit, see "Memory on big boards"; true when that
   run was another version), `github_writes_changed`
   (enabled, from: `footer` when the user opened or closed the lock,
   `default` once when an install that never chose got writes on by
   default; 2026-10-05; with writes locked PostPile cannot mark anything
   read, so a heavy inbox only grows),
   `catch_up_ran` (topics, always 1; agent_calls, duration_ms, ok: one glance
   catch-up run after the poll), `board_trimmed` (kept, dropped: the board
   cap cut the hot set, the inbox is busy; at most hourly, since 0.18.0),
   `work_shed` (skipped_prs: PRs with news that syncs and polls left alone
   in the last hour because they are outside the hot slice; at most hourly,
   since 0.18.0, see "Big inboxes: what PostPile loads and works on"),
   `storage_job_done` (name, one of the known jobs (`bot_body_trim`,
   `checks_strip`, `discussion_rows`, `snapshot_strip`, `activity_rows`,
   `snapshot_strip_2`, `text_rows`, `snapshot_retire`);
   units, work_ms, longest_slice_ms, wall_ms: a background storage job
   finished and its check passed, this run's share of it, see "Storage
   jobs"; since 0.20.0), `storage_job_blocked` (name, blocked_units: a
   job ended its walk incomplete, its check failed twice, and how many
   units it still finds undone, or since 0.23.0 a row backfill finished
   without PRs whose json it rejected and how many; at most once per job
   per app run, counts only, never keys; since 0.22.0),
   `update_check_finished` (trigger `launch` / `interval` / `wake` /
   `menu`, result `none` / `available` / `error`, available_version when
   one was found: one per self-update check the packaged app ran),
   `update_downloaded` (version: Squirrel.Mac staged it), `update_failed`
   (stage `check` / `download`, error_code: electron-updater's code,
   Chromium's net error, `HTTP_<status>` or the error class, never the
   message; see "Self-update", since 0.21.0),
   `sync_failed` (error_kind, currently only
   `gh_unavailable`: a blocked sync never runs), `rate_limited` (source
   `graphql`/`rest`, read from the error text — GitHub's GraphQL and REST
   rate-limit errors are shaped differently at the point `packages/github`
   builds them; where `sync` from a full sync's errors, `poll` from the live
   poll's backoff), `github_quota_low` (resource `core`/`graphql`, level
   `low`/`critical`: once per drop into a worse level within a rate-limit
   window, see "GitHub quota"), `consolidation_ran` (proposals_filed).
6. *MCP server*: `mcp_tool_called` (tool, one of the six; found: false when
   the PR, topic or search found nothing or on an error; response_chars: the
   answer's length; error: it was a tool error). Sent by the separate `postpile-mcp` process
   under the same install id, so it counts toward the same person.
   `mcp_connect_clicked` (from `footer`/`setup`, ok: Claude Code has the
   server afterwards) and `mcp_connect_dismissed` (the footer's "Not now"),
   both sent by the engine from the action itself.
7. *Board shape*: `tile_shape` and `topic_shape`, a counts-only snapshot of
   how tiles and topics turn out on real boards. The desktop app sends it once
   per local calendar day, right after a full sync ran to the end (the board is fresh; `Engine.onSyncCompleted`, called where `sync_completed` is sent),
   from the same day-marker mechanism as `app_active` (`ActiveDayReporter`,
   file `telemetry-board-shape-day` in the data folder, so a restart does not
   send twice). `Engine.boardShape()` builds it with the pure
   `boardShapeEvents` (`packages/core/src/board-shape.ts`) over the topics the
   sidebar lists (all repos), retired topics left out. One `tile_shape` per
   tile: `kind` (single/stack/set), `prs` (all members), `stacked_prs`
   (members in a stack: all of a stack tile, the stacks' members in a set, 0 for
   a single), `pulled_in` (members that are pulled-in layers), `topic_tiles`
   (tile count of its topic). One `topic_shape` per topic: `tiles`, `prs`,
   `single_tiles`, `stack_tiles`, `set_tiles`. Answers "how many tiles hold x
   PRs, and are they stacked"; never a repo, title, login or PR number.

**Verification**: a throwaway script or CLI run with `POSTPILE_TELEMETRY=1`
and a scratch data dir sends one `telemetry_test` event (distinct id
`postpile-dev-check`) and flushes; that event is not part of the catalogue
the app sends in normal use.

## MCP server

Other agents on the machine (Claude Code in a checkout, say) can ask
PostPile what it knows before they act on a PR: `postpile-mcp`, a stdio MCP
server on the official SDK (`packages/mcp`). Read-only at first (decided
2026-09-29 morning). The same day Julian asked for one tool that "might
change data, not by writing, but more by triggering PostPile to refresh some
topic or PR", and for a way for an agent with better context to suggest
topic edits. Both go through the running app ("Agent requests" below); the
MCP process itself still never writes the database or GitHub.

**Process**: its own process, not the app's. It opens the database the way
`cli --read-only` does (`createEngine({ withoutLock: true })`: read-only
SQLite, no migrations, no lock, no GitHub writes), so the reads work next to
the running app and need no port or token discovery. Decided 2026-10-01: the
MCP follows the app. Before every tool call it looks at `postpile.lock` next
to the database (`runningApp`: an app kind, a live pid; a lock left by a
crashed app does not count). While the app is closed every tool returns a
tool error, "PostPile isn't running. Open the PostPile app, then ask again."
The process stays up and answers again after the app opens, no reconnect.
Reason: the owner wants the MCP to follow the app, and data from a closed app
only gets staler. POSTPILE_FAKE=1 skips the check. The data is as fresh as the app's last sync and poll; every
answer says when the last full sync finished, and `pr_context` when the PR
was fetched. The two tools that change something ask the running app
("Agent requests" below). Stdout is the protocol, so `console.log` goes to
stderr (`routeConsoleToStderr`).

**Refuses after an update** (decided 2026-10-01): the process opens the
database once and keeps its code, so after a `brew upgrade` an old MCP would
run old queries against the new schema (SQL errors or wrong answers). Before
every tool call, right after the app-running check, it looks for a mismatch:
the database's `MAX(version)` from `schema_migrations` (read on the open
read-only connection) differs from this build's `LATEST_VERSION`, or the
running app's version in `postpile.lock` (`appVersion`, written by whoever
takes the lock; old locks have none and count as unknown) differs from this
process's own. A version that is unknown on either side never counts, so dev
runs with equal strings stay quiet. On a mismatch every tool returns the
tool error "PostPile was updated. Run /mcp and reconnect postpile to load the
new version." The closed message still wins. Nothing is cached
(the schema is one SQL query, the lock's version a plain file read, only the
ps liveness of the running check is kept for 5 s), since a kept "no mismatch"
would let calls through right after an upgrade; a mismatch is permanent. Reason for
refusing instead of exiting: Claude Code never restarts a stdio server on its
own, so an exit would leave a silent failure, while the refusal tells the user
what to do. `POSTPILE_FAKE=1` skips the check (`packages/mcp/src/update-check.ts`).

**Shipping**: electron-vite builds `apps/desktop/src/main/mcp.ts` next to the
main process as `out/main/mcp.js`. `Contents/Resources/postpile-mcp`
(`apps/desktop/build/postpile-mcp`, via `extraResources`) runs the app's own
binary with `ELECTRON_RUN_AS_NODE=1` on it: no window, no dock icon, no Node
install needed, the same engine code as the app. The cask links it into
Homebrew's bin (`binary`); the script follows that symlink back into the
bundle. From the repo: `pnpm cli mcp` (`POSTPILE_FAKE=1` for sample data).

**Tools** (six, `packages/mcp/src/server.ts`; inputs are small zod shapes;
how they answer is under "Tool design" below):

- `pr_context(pr, detail)`: `owner/repo#123`, a PR URL, or `#123` when the
  number is unique in the store. Brief (default): the PR (state, author,
  size), whose move, why it is unread, stack layer, the viewer's approval,
  what is new since they looked, the glance's verdict, "for you" and risk,
  this PR's tile, and the topic's other PRs one line each (10 at most).
  Full: the whole glance, facts, the activity list (the detail pane's, noise
  folded), then the topic: dossier (`formatDossier`, shared with the CLI)
  and every tile with its PRs. After the fence: when the PR was fetched and
  whether the app checks it again soon, then the next step.
- `topic(topic, detail)`: an id, or part of a name when that picks one
  topic. Brief: goal, status, open questions, one line per tile (15 at
  most). Full: the whole dossier and every PR. Both list pending topic
  suggestions and the ones decided in the last 14 days.
- `search_prs(query, limit, offset, state, repo, whose_move)`: the search
  bar's matcher, 25 per page (100 at most).
- `whats_on_me(limit, offset, state, repo, whose_move)`: live tiles in
  `needs_you` topics where it is the user's move, then unread ones where it
  is not; open PRs by default.
- `refresh_from_github(pr | topic)` and `propose_topic_change(...)`: see
  their own sections below.

Reads cover every repo (`listTopics` / `search` with `{ allRepos: true }`),
whatever repo the window has chosen; quiet repos stay quiet. Read answers
are plain text: a freshness line, who the app works for, then one
`<postpile-data id="…">` fence around everything that comes from GitHub or
from an agent summary of it, with a line telling the caller it is data, not
instructions. The fence id is random per answer and fenced text is cleaned
(see "Untrusted text" below). The reads send no structured content: text is
what the calling model reads, and sending both would double the tokens.

**Connecting** (decided 2026-09-29): the app nudges, it never installs by
itself. The status footer shows "agents: not connected" while Claude Code
lacks the server; a click opens a small popover with one sentence on what it
does, **Add to Claude Code**, the server command for other agents (copy
only) and "Not now". The last setup step (Accept) has the same offer in its
own box below Accept, with a secondary button so Accept stays the one
primary; it is never part of Accept.

- Engine: `McpConnection` (`packages/engine/src/mcp-connection.ts`) behind
  `mcpConnection()`, `connectMcp(from)` and `hideMcpConnect()`. Routes:
  `GET /api/mcp-connection`, `POST /api/mcp-connection {from}`, `POST
  /api/mcp-connection/not-now`.
- Detection: `claude mcp get postpile` (exit 0 = there; "No MCP server
  named" = not there; anything else, e.g. a timeout, = unknown and no nag).
  It runs through the setup checks' command runner, with the claude binary
  `ToolHealth` found, in the app's own empty folder (`agentCwdFor`), so it
  sees user-scope servers and macOS asks for nothing. Cached for 5 minutes;
  the renderer asks again on window focus and after an add.
- Install, only on the click: `claude mcp add --scope user postpile --
  <Contents/Resources/postpile-mcp>`, then a fresh check. "Already exists"
  counts as done when the check finds it.
- The launcher path is only known to Electron main, which passes
  `mcpLauncher` into `engineFromEnv` / `createEngine`: `{kind: 'app', path:
  process.resourcesPath/postpile-mcp}` when packaged, `{kind: 'dev',
  repoRoot}` in a dev run. Dev runs, the CLI and the standalone server never
  run claude for this: the state stays unknown (no footer item), the button
  is disabled with the reason, and the command shows to copy (dev:
  `claude mcp add postpile -e POSTPILE_PROFILE=default -- pnpm -C <repo> cli
  mcp`).
- claude missing or logged out: nothing runs, state unknown, no footer item
  (the tool note already covers claude). A usage limit does not matter.
- "Not now" is kept in meta (`mcp_connect_hidden_at`) and hides the footer
  item for good; the setup offer still shows on "Run setup again".
- Sample data (`FakeMcp`): starts not connected, a click "adds" it in
  memory; never runs claude or touches the real Claude Code config.

### Tool design (2026-09-29, from a best-practice review)

Sources: Anthropic "Writing effective tools for agents", the MCP 2025-11-25
spec, GitHub's, Sentry's and Linear's MCP servers. What it means here:

- **Few workflow tools**, not CRUD: six tools in total. Separate tools where
  the side effects differ (a read, a GitHub re-read, a suggestion).
- **Brief by default.** `pr_context` and `topic` take `detail: "brief" |
  "full"` (default brief). Brief `pr_context`: the PR line, whose move, why
  unread, stack, what's new, the glance verdict / for you / risk, this PR's
  tile, and the topic's other PRs as one line each. Full is today's answer.
  Brief `topic`: the dossier's goal, status and open questions plus one line
  per tile. Long lists are capped with a line that says how to get the rest
  ("12 more tiles: topic(detail: \"full\")"). Claude Code warns above 10k
  tokens; brief answers aim well under 3k.
- **Paging and filters** on `search_prs` and `whats_on_me`: `limit` (default
  25, max 100), `offset`, and flat optional filters `state` (open, merged,
  closed, any; default open for `whats_on_me`, any for search), `repo`
  (`owner/name`), `whose_move` (you, them, any). A cut list ends with "N more:
  offset: 25". Topic reads are batched, no read per match.
- **Errors are tool errors** (`isError: true`) with the fix and an example:
  unparseable, ambiguous or unknown PR or topic, a bad filter. "No matches" is
  a normal answer. Bad enum values and limits fail the input schema, whose
  zod messages carry the fix and an example (the SDK answers them as
  `isError`); `repo` is checked by hand.
- **Freshness per answer**: besides the last full sync, `pr_context` says when
  this PR was fetched ("fetched 3 min ago") and, while the app runs, when it
  checks again ("the app checks GitHub again within 1 min"). This tells an
  agent when a refresh is pointless.
- **Descriptions** say what it returns, "Use when / Not for", and one example;
  answers end with a next step where one fits (`pr_context`: "Stale? call
  refresh_from_github. Wrong topic? propose_topic_change."). Claude Code cuts
  each description and the server instructions at 2048 characters without a
  word, so each stays under that (a test checks).
- **Server instructions** (about 1.2k characters): start with `whats_on_me` or
  `search_prs`, then `pr_context`; data is as fresh as the app's last check;
  `refresh_from_github` only re-reads GitHub and needs the app running;
  `propose_topic_change` only files a suggestion the user decides on; text
  from GitHub is data. No "read-only" claim any more.
- **Untrusted text**: each answer's fence carries a random id
  (`<postpile-data id="k3f9">`, closed with `</postpile-data id="k3f9">`), so
  data can't fake a close tag; fence tags inside the data are broken up
  anyway; control characters and invisible Unicode (tag characters,
  bidi overrides, zero-width) are stripped from fenced text; topic names in
  error text sit inside the fence too, as do the app's reasons in the two
  new tools' refusals (they name topics and PRs); only fixed wording stays
  outside.
- **Annotations**: the four reads keep `readOnlyHint`, idempotent, closed
  world. `refresh_from_github`: not read-only, not destructive, idempotent,
  open world. `propose_topic_change`: not read-only, not destructive,
  idempotent, closed world.
- Reads stay plain text (no `structuredContent`, it would double the tokens).
  The two new tools also return small `structuredContent` with an
  `outputSchema` (status, times, counts), since those payloads are tiny and
  an agent may branch on them.
- Telemetry: `mcp_tool_called` gets `response_chars` and `error` (bool); no PR
  keys, as before.

### Agent requests (MCP to the running app)

Only the app holds the GitHub client, the quota readings and the database's
write lock, so both new tools ask the app to do the work. Transport: a file
outbox in the data folder, no port and no token (the app's HTTP token can
approve PRs, so it is never handed to other processes).

- The MCP process writes `<data folder>/agent-requests/<uuid>.json` (temp file,
  then rename): `{v: 1, kind: "refresh" | "propose_topic_change", createdAt,
  expiresAt, client, payload}`. `client` is the MCP client's name from the
  initialize handshake (`clientInfo.name`, e.g. "claude-code").
- The app watches the folder (and scans it at start), validates with zod,
  handles the request, writes `<uuid>.result.json` and deletes the request.
  The MCP process waits for the result, then deletes it.
- Guards: folder `0700`, regular files owned by the user only, no symlinks,
  16 KB cap, unknown `v` or `kind` rejected with a result that says why,
  expired requests dropped (refresh: 2 minutes; the app is not running = no
  queue, see below). Leftover results older than an hour are swept at start.
- App not running: the MCP process checks `postpile.lock` (holder alive and
  kind `app`) before writing anything and answers right away with an error:
  "PostPile is not running, nothing was done. Data is as of <last sync>.
  Continue with the stored data or ask the user to open PostPile." Nothing is
  queued (the intent goes stale) and the app is never launched.
- Sample data (`POSTPILE_FAKE=1`): the fake app handles requests in memory
  the same way, so `pnpm cli mcp` with the fake server can try both tools.
- Built (2026-09-29): `FileAgentRequests` (packages/mcp) and
  `AgentRequestInbox` (packages/engine/src/agent-requests, started by the
  desktop main process through `startAgentRequests()`), the envelope and
  its zod check in core (`parseAgentRequest`). "Kind `app`" means the lock
  kinds `packaged` and `dev` (`runningApp`): the CLI and the standalone
  server never answer requests. The app claims a request by renaming it to
  `<uuid>.working`, so on its 20 s timeout the MCP process can withdraw a
  request nobody took ("nothing was done") or report one that is still
  running. Besides `fs.watch` the app rescans the folder every 5 s, since
  the watch can miss events. Both kinds expire after 2 minutes. Claims left
  by a crash go at start with the old results. PR and topic references are
  resolved on the MCP side with the reads' resolvers and sent as keys and
  ids; the app checks them again. Over sample data the MCP process answers
  in memory (`InMemoryAgentRequests` over the fake engine, through the same
  `answerAgentRequest` the inbox uses); the fake desktop app watches no
  folder.

### `refresh_from_github`

Asks the running app to re-read one PR, or one topic's open PRs, from GitHub
now. GitHub reads only, never a write.

- Params: `pr` or `topic`, exactly one (same references as the reads). Both or
  neither is a tool error with an example.
- Engine: `refreshNow(prKeys, {source: 'agent'})` next to `refreshOnFocus`,
  but returning a result: PRs fetched, PRs changed (new events), skipped as
  fresh, or blocked with a reason. It runs one poll cycle with these PRs in
  focus; while a sync or cycle runs it joins that one instead of stacking.
- A topic refreshes its open PRs, unread and your-move first, then newest,
  at most 10.
- Quota, all enforced in the app, since every Claude session has its own MCP
  process but they share one GitHub budget:
  - a PR fetched in the last 60 s is skipped as fresh ("fetched 25 s ago");
  - at most 20 agent refreshes an hour, one at a time;
  - quota `ok`: PR and topic; `low`: a single PR only (a topic refresh is
    optional background work, see "GitHub quota"); `critical`: nothing, with
    the reset time.
  Every refusal says when to try again and to go on with the stored data.
- Waits up to 20 s (Codex gives up at 60 s). Longer: answers "still running,
  read pr_context again in a minute".
- It does not force glance or dossier runs; the usual catch-up handles PRs
  that came back with new events. The answer says so ("the assessment may
  update in the background").
- Description: not for polling, the app already checks every minute.
- Logged in the debug action log (`agent_refresh`, client, PR count, result).
- Built (2026-09-29): `AgentRefresher` (packages/engine/src/agent-requests)
  over `Engine.refreshNow`, which the fake engine reuses. Decided while
  building: a running full sync is joined (its freshness check covers every
  tracked PR), a running poll cycle is waited for and then one runs with the
  PRs fetched directly; agent refreshes queue behind each other. The hourly
  cap counts only requests that read GitHub (fresh-only and refused ones
  don't, nor a read the app could not make: setup open, gh off), in
  memory, so a restart resets it. A PR PostPile does not track is
  refused, never fetched. Refusals are tool errors. The action log row has
  no thread or PR (the detail lists them), so it never shows as a thread's
  last action; outcome `github` when GitHub was read, `skipped` otherwise.
  The freshness line says a merged or closed PR older than a day is no
  longer checked by the app (the poll's freshness window).

### `propose_topic_change`

An outside agent with better context files a topic change for the user to
decide, through the same `topic_proposal` rows the consolidation job files.
Never applied directly: topics are never changed silently (see the top of
this document), and an outside agent's view can be steered by PR text anyone
wrote. Auto-applying small splits from outside agents was raised and left out
for now (Julian, 2026-09-29: "okay, don't do now").

- Params: `topic`, `kind` (`split`, `rename`, `merge`), `prs` (for split: the
  PRs to move), `name` (split: the new topic; rename: the new name),
  `into_topic` (merge), `reason` (required, up to 300 characters), `dry_run`
  (default false).
- Checks in the app: the topic is active; split PRs belong to it and at least
  one PR stays behind (moving all of them is a rename or merge); the same
  change is not pending already and was not rejected before (the answer says
  "rejected on 2026-09-20, don't propose it again").
- The answer always previews what accepting would do, stacks included ("#1902
  brings #1851 and #1911 along", via `Board.movesWith`), and whether it was
  filed or only a dry run.
- Caps: 3 pending outside proposals per topic, 10 in total, 20 filed a day;
  outside proposals expire after 14 days.
- Store: `topic_proposal` gains `source` (`consolidation` or `agent`) and
  `client` (the MCP client name), in a new migration. `decide` checks the
  proposal again on accept (PRs may have moved since) and refuses with a
  reason when it no longer fits.
- Inbox card: the meta line names who suggested it, "topic · suggested by
  Claude Code · 2h ago" (client names map to a display name; unknown ones show
  as "an outside agent"); the reason shows as today. Accept and Reject as for
  any proposal.
- Feedback to the agent: `topic` (brief and full) lists pending suggestions
  and decisions from the last 14 days with dates, so an agent sees the outcome
  and does not repeat itself. There is no push back to the agent.
- Telemetry: `proposal_resolved` gets `source`.
- Built (2026-09-29): `planTopicChange` in core (checks and preview, shared
  with the fake engine), `OutsideProposals` in the engine, migration 017.
  Decided while building: expiry is derived from `created_at`, never stored
  (`proposalOutcome`), so the read-only MCP process and the app agree
  without a job; an expired suggestion drops out of the Inbox, can't be
  accepted and may be filed again. "The same change" is the same kind and
  topic with the same name (case and spaces aside) or merge target,
  against proposals from any source, so a rejected consolidation proposal
  blocks an agent too. The caps count per rolling 24 hours; a dry run runs
  every check, caps included, but counts against none. The split preview
  moves every stack layer (`Board.stackKeysOf`), pulled-in ones included,
  since the whole stack shows where the moved layers go. The re-check on
  accept covers every proposal (topic and merge target still active, split
  PRs still in the topic); "at least one PR stays" only outside ones, since
  consolidation may propose emptying a topic. `proposal_resolved` also got
  a `topic_split` kind (splits are what agents suggest most). The client
  name is cut to letters, digits, `._ -` and 64 characters ("unknown" when
  empty); the renderer maps `claude-code` to Claude Code, `codex-mcp-client`
  to Codex and `cursor-vscode` to Cursor, and the topic header's proposal
  row reads "Claude Code suggests: …" for outside ones. An accepted merge
  archives its source topic, so decisions list merges on the target too
  ("merged in from <source>"), and the propose answer for a merge points
  at the target's `topic(...)` for the outcome.

## Fixes from the codebase review (2026-09-29)

A Codex CLI review of v0.11.0 found nine issues; eight were confirmed in the
code and are fixed here. One (a snooze broken by a mention comes back once the
mention is read) is behaviour a test asserts on purpose and stays open for
Julian under "Open questions".

- **An unsubmitted review is not a reply.** GitHub shows the viewer's own
  pending review (and its pending inline comments) to them. Normalization
  turned a pending review with a body into a comment, and `viewerSpokeAfter`
  counted even an empty pending review, so an ask went quiet exactly while the
  answer was still unsent, and the touched read could mark the thread read on
  GitHub. Pending reviews and pending review comments never count as the
  viewer's reply, touch or comment anywhere.
- **Approve pins the commit on screen.** The approval used the stored head,
  which a poll can move a few seconds before the renderer refreshes. The
  renderer now sends the head it showed; if the stored head differs, the
  approval is refused with "New commits since you looked; take another look".
- **A cut-off snapshot never qualifies for a quiet read.** The PR query caps
  every activity list (the last 50 reviews, 60 comments, 50 review threads and
  the first 30 comments of each, 50 commits, 60 timeline items), so an event
  past a cap never arrived while the freshness check still passed, and the
  bot-only read could clear an unread human reply (a human comment followed by
  60 bot comments). The query now also asks for the total count of each; a PR
  with any list cut off is marked truncated, and the quiet reads treat it as
  not covering the thread (no bot-only, touched or opened mark-read on
  GitHub for it). Since refined: it covers as far back as each capped list
  reaches, and older pages get fetched (`snapshotCoversSince`, "Handled
  quietly" › Capped snapshots).
- **The MCP process never writes, instructions included.** Reading a glance's
  freshness recorded a new instructions version when `instructions.md` had
  changed while the app was closed, and the read-only MCP process threw
  instead of answering. In read-only mode the instructions history only reads:
  the glance shows as stale until the app records the edit.
- **Every standing change request counts.** With two reviewers asking for
  changes, only the first was looked at, so "Bob to re-review" could hide the
  author's open work for Carol. The author's move comes first while any change
  request has no re-review asked since the author's last push; "X to
  re-review" only when every one of them has.
- **A pending inbox cleanup survives a lock during Send.** Closing the lock
  while pending writes were being sent dropped a pending "mark all read before"
  cleanup as if sent. It now stays pending with "GitHub writes are off".
- **Stale lock takeover runs under a mutex.** Two processes finding the same
  stale `postpile.lock` could delete each other's fresh lock. A takeover now
  holds `postpile.lock.takeover` (created with mkdir, so exactly one process
  gets it; a folder older than 30 s was left by a crash and is removed). While
  holding it, the process re-reads the lock, removes it only when it is still
  the exact holder judged stale (pid and start time), creates its own lock
  exclusively and reads it back, then removes the folder. Everyone else backs
  off and tries again.
- **Topic names are data, and are cleaned where they are stored.** Topic names
  are written by the agent from PR text and six prompts used them outside the
  data fence. Every prompt now shows topic and area names only inside
  `<github_data>` and says "the topic named in the data below" instead of
  putting the name into its prose (a test checks every prompt). On storing a
  name: newlines and control characters collapse to spaces, and the name is
  capped at 80 characters. A name that is empty after cleaning is refused: topic
  assignment asks about the PR again, consolidation does not file the
  proposal, an outside agent gets "The name is empty after cleaning", and
  accepting such a stored proposal is refused. Existing names are cleaned once
  by a migration ("Untitled topic" when nothing is left).

## Rules layer: one home per fact (2026-09-29)

Since 28 Sept most fixes were two parts of the app deciding the same thing
differently: a bot-made review request didn't ping while the tile said "your
move", MCP said "your move" where the pane said "their move", a done tile
still offered Mark read, a done tile stayed in the Unread list. Julian asked
whether the decisions about pings, alerts and state transitions could live in
"kind of a state machine or something", so rules stay maintainable as
features are added. A mapping of the rules layer (published as "PostPile
Rules Architecture") was cross-checked by Codex (gpt-6-astra) against
v0.11.1; Julian: "I like all the suggestions", all of it in one batch.

**Two kinds of rules, two shapes.**

- Facts worked out from a PR's history (loudness, seen, whose move, tile
  state, tier, done, dots, labels, ping or not) are a projection, not a state
  machine. Each fact is computed in one place in `packages/core` and every
  consumer (renderer, pings, quiet reads, MCP, the fake engine) reads the
  result. The seam is the existing `buildPrSummary` / `buildTileView`, not a
  second read-model system; Board caches them per snapshot. The fake engine
  calls the same pure core functions.
- Lifecycles with side effects (a PR being read, a snooze, a topic's status,
  a waiting GitHub write) are small transition functions:
  `(state, cause) -> (next state, effects)`, effects returned as data and
  carried out in one place under the writes lock, like topic proposals.
- No XState, no rule engine, no policy language: tile state is itself a
  projection of five lifecycles, so a statechart over it would be a second
  copy that can disagree with the history.

**One home per predicate family.** "Is it automation", "who does this review
request ask" (by target, not by who clicked), "did you act after X", and
"which event kinds are asks" each get one module. Narrow variants become
parameters, not copies. Distinctions that are on purpose stay: reading
touches leave out pushes and merges; snooze reply kinds include ordinary
comments; "routed" for Look-closer pings still ignores a teammate's review
(see "Look closer pings").

**Actions are a separate projection.** What the buttons say and do depends on
more than PR facts (PR vs whole tile, snooze, lock, pending writes), so
offers come from their own core function with that context passed in, and
the renderer only displays them. Consequences:

- A done PR in the detail pane offers only Open, like a done tile (a handled
  PR by someone else with no ask still got a primary Approve).
- Whether a person is automation comes from core (the renderer's `[bot]`
  check missed the other automation accounts and decided whether Ask shows).

**Reading a PR is one planner.** Every way a PR becomes read goes through one
local read-change planner: which events turn seen (up to which cutoff), which
PRs turn handled, and how to undo it. Each cause keeps its own eligibility
and write path:

- Button (PR or tile): seen, handled for tracked members; unlocked it is an
  optimistic change with undo, locked with unread threads it becomes pending.
- Opened in PostPile: seen and handled after the existing checks (no
  snoozed tile, done after read, unlocked, fresh untruncated snapshot).
- Read on GitHub: seen up to GitHub's read time, not handled; completing a
  pending intent may handle.
- Quiet reads (bots only, you acted after): seen, never handled.
- Inbox cleanup stays a bulk write outside the per-PR planner.
- After-read runs the planner's success branch on a copy instead of a
  hand-written simulation, so a button never promises more than the action
  does.

Landed as `planRead({scope, cause, events, userStates, at})` in
`core/read-plan.ts`, returning `{seenAt, handledAt, handleKeys, change}`
(`change` is what undo puts back). Causes: `button`, `approved` (seen only),
`opened`, `pending_completion` (seen up to the click), `read_on_github` and
`quiet` (seen up to GitHub's read time, never handled); the switch is
exhaustive. An earlier handled time is kept. The engine writes a plan through
`writeReadPlan` / `readLocally` (`actions/local-change.ts`); one guarded
`markThreadReadIfUnchanged` serves both the mark-read queue and quiet reads.
A waiting GitHub write moves through `pendingWriteStep(write, cause)` in
`core/pending-write.ts`, and `PendingWrites.apply` is the only place that
carries out its effects. Not in the planner: the own-touch reconciliation in
github-sync (stamps each event with its own time), undo and not-taken
(`putBackLocalChange`, reversals rather than reads). The inbox-cleanup
baseline is gone (2026-09-30).

**Handled is not reset by new activity (decided 2026-09-29).** Handled means
"you dealt with this once", not "complete now". New activity already makes
the thread, and so the tile, unread before done is checked (loud news
before 2026-09-30); once read, done needs no move left for you. Resetting it would make a GitHub visit or quiet read leave the
PR open with nothing asked.

**Snoozes belong to PRs.** A snooze was keyed by the tile id, which changes
when a PR joins a stack or set, so the snooze was lost (and could come back
if the old tile returned). Snoozing a tile now writes one snooze per tracked
PR with the same condition; a tile is snoozed while every tracked PR in it
has an active snooze, so a new unsnoozed PR joining a snoozed tile shows the
tile. Existing snoozes are carried over by migration 019 (`pr_snooze`; the
old `snooze` table stays until 019 has shipped). A CI snooze on a multi-PR
tile is now checked per PR, so the tile shows once any tracked PR is green
(open question whether it should wait for all). Events on pulled-in,
untracked stack layers no longer touch a snooze. Every snooze ends when
its PR is merged or closed (push and CI snoozes first, every kind since
2026-09-30); it could never finish before and kept the topic from retiring. The wake rule
stays human news only, plus automation the agent raised to loud (since
2026-09-30): the app's own Look-closer event does not break a snooze (its
ping already skips snoozed tiles).

**Mute until I'm mentioned (2026-10-05).** Owner: "there is no way to
snooze/dismiss forever? e.g. a rogue contributor keeping commenting". The
last item of the Snooze menu, "Mute until I'm mentioned", puts the tile
away for good:
- A mute is a snooze with the condition `muted` on each tracked PR, so it
  follows the PR like any snooze and every snooze rule applies (it ends when
  the PR is merged or closed, so the topic can still retire).
- Only a personal ask ends it (`isPersonalAsk`, the same one personal pings
  use): a mention, question or reply to the user, a comment edited to
  mention them, or a review request that names them (a bot-made one too).
  Nothing else wakes it: no person's or bot's loud news (`breaksSnooze`
  says no for a mute), no team mention, no team request, no push, no
  author's answer to the user's changes request. A bot's mention does not
  count; the user's own events neither.
- Muting marks the tile read like the other clears and unsubscribes the user
  from each PR's notification thread (`DELETE
  /notifications/threads/{id}/subscription`, GitHub's own mute until you
  comment or are @mentioned), so GitHub agrees. Both are one batch through
  the mark-read queue (`MarkReadRequest.subscription`): Undo inside the
  window takes all of it back (the snoozes too); locked, the mark-read and
  the unsubscribe wait as two pending writes of the same batch (kinds
  `mark_read` and `unsubscribe`, listed as "Mute: <title>") and go out from
  the lock. The unsubscribe goes to a thread that is read already too.
  It goes out only while the mute still holds (core `muteHolds`, asked by
  the queue before each unsubscribe, 2026-10-06): a mention, reply or
  review request that came in during the undo window (the mark-read's
  retry refreshes the PR and stores it) or before a pending unsubscribe was
  sent ends the mute and brings the tile back as an ordinary tile without
  Unmute, so GitHub must keep the user subscribed. That unsubscribe is
  logged `skipped` and the pending row goes. The mirror holds for a
  subscribe: an Unmute (typically a failed one sent again from the lock)
  is skipped while the PR is muted again, so the newer mute's unsubscribe
  stays.
- Unmute (where Unsnooze is) takes the snoozes back and subscribes the user
  again (`PUT .../subscription` with `ignored: false`; pending kind
  `subscribe`), through the same queue and lock. Without it GitHub would
  stay quiet about the PR: new activity would never turn the tile unread
  again, and a tile that looks unmuted but never comes back is worse than
  one more write. Undo of an Unmute puts the mute back, and so does
  discarding a pending Unmute (core effect `mute_again`, 2026-10-06; since
  = the Unmute's click, which the pending row keeps as `createdAt`
  (`MarkReadRequest.clickedAt`) rather than the end of the undo window, so
  a personal ask inside the window still ends it; a PR snoozed again
  meanwhile keeps that snooze):
  GitHub still has the user unsubscribed, so the tile must offer Unmute
  again instead of staying quiet for good.
- A subscription change GitHub did not take is not dropped like a failed
  mark-read (that one puts the PR back to unread, so the app agrees with
  GitHub again; a mute or unmute stays here either way). It waits as a
  failed pending write with the error, to be sent again from the lock.
- A muted stack or set comes back when one PR gets a personal ask; the
  other PRs keep their mute (and stay unsubscribed). The tile then says
  `TileState.partlyMuted` and its Snooze menu offers "Unmute the rest"
  (core `TileOffers.unmuteRest`, not on a done tile), which is the same
  Unmute: every snooze of the tile goes, every muted thread is subscribed
  again. A snoozed tile can mix a mute with ordinary snoozes too (a muted
  PR joins a snoozed stack or set): it says Snoozed and `partlyMuted`, and
  its Unsnooze is also that Unmute, so the renderer guards it as a GitHub
  write (`mute`), not as a local-only Unsnooze. A plain snooze on a partly
  muted tile leaves a mute that still holds alone (2026-10-06): replacing
  it would leave GitHub unsubscribed with no Unmute to take that back.
- Known gap: GitHub still notifies a user who watches the repo; the DELETE
  does not cover that. GitHub documents `PUT .../subscription` with
  `ignored: true` for watched repos (a stronger block; that it still lets a
  mention through is not checked yet, so it is not used). Such a
  notification makes the thread unread, so the muted tile sits in the
  Unread group like any snoozed tile with an unread thread until it is
  marked read.

**Topic status has one writer.** All status changes (retire, revive,
archive; nothing restores a topic today) go through `nextTopicStatus` in
core and `changeTopicStatus` in the engine, and retiring records its own
`retiredAt` (migration 020) instead of reading `updatedAt` (any rename moved
it). In the full sync, revive runs after new events are classified (event
classification now also covers retired topics) and reads effective loudness,
so an event the agent turned quiet does not bring a retired topic back. The
live poll does not classify, so it still revives on the rule's loudness.

Landed as (projection step): `buildPrSummary` adds `PrSummary.facts`
(`prFacts`: automation author, who a review request asks, last touch, open
ask) next to the existing `turn`, `done` and `afterRead`; Board caches tile
state and whose turn per snapshot (`stateOf`, `turnOf`). Offers are
`tileOffers` / `paneOffers` in `core/offers.ts`, shipped as
`TileView.offers` (footer action and label, GitHub link, lead PR, and the
pane's buttons per PR key); the pane (`PaneHousekeeping`, `ReviewRow`, `OpenOnGitHub`) and `Tile` only lay them out. A done
PR (or one on a done tile) gets no Approve, Ask or Remove team; a done PR
whose news keeps its tile unread keeps Mark read. The renderer's tier order
is typed with core's `PrTierOrder`, so a drift fails to compile. The fake
engine reads through `planRead` and sends pending writes through
`pendingWriteStep`.

**Consumers agree.** MCP `pr_context` prints the move of the PR asked about,
not of its tile (so does each `search_prs` row and its `whose_move` filter;
the "Its tile:" line keeps the tile's). The MCP process runs as long as the
Claude session; when the app was updated underneath it, its answers say so
and ask for a reconnect: the engine that holds the lock records its version
in meta (`app_version`), and every MCP answer compares it with its own.
Tier "To review" and whose move "Review" agree for the dismissed-review case
(a dismissed review no longer counts as reviewed for the tier either).

**Decided from the property tests (2026-09-30).** The generated boards found
four cases where the rules had no answer yet; Julian decided each:

- Re-request after your changes: you asked for changes, the author asked you
  again, and you then only commented. The PR stays under "Changes you
  requested" and the move says "Re-review" (it said "Review, ada asked").
  The same without a push says "Re-review, ada asked" too (move
  `re_review`, your move; it said "ada to address your changes"): an
  explicit re-request means "look again", push or not.
- Loud news on a pulled-in stack layer makes the tile unread and gives that
  layer a "Not done yet" dot. Julian: "PostPile found it could be interesting
  to me? that's a nice side effect". Before, the tile went unread with no dot
  anywhere. (Confirms "loud events on pulled-in PRs also make a tile unread"
  from the open questions.) Still so under "GitHub unread is PostPile
  unread" (the same day).
- Every snooze ends when its PR is merged or closed, not only push and CI
  snoozes: a "someone replies" or "until" snooze on a finished PR kept its
  topic from retiring.
- An automation event the agent raised to loud wakes a snooze, like a human's
  loud event, so the tile turns unread and pings. The human-only rule still
  holds for rule loudness: a bot event the agent left alone never wakes a
  snooze, and the app's own Look-closer event never does. A snoozed tile
  itself still never pings.

Later the same day, from the next runs:

- The order inside "Changes you requested" follows the move: a topic whose
  PR says Re-review sorts first, also after a re-request (with or without a
  push), where `changesAnswered` has no answer. `TopicQueues.changesAddressed`
  counts re-review moves (`isReReviewMove`).
- An override to loud wakes a snooze whether the events agent or the user
  set it (`raisedToLoud` reads the override, not who made it). Julian: keep
  both.
- A stack with one tracked PR plus a pulled-in layer with news dots both
  rows while the tracked PR is not done: the layer for its news, the
  tracked PR for itself. Julian: keep.
- The quiet-read grace counts from the newest activity, human or bot (the
  touch, the bots after it, the thread's update). Kept as built. (The grace
  was removed 2026-10-02.)
- The ping side of the raised-automation rule: the "only automation" row
  of the ping table counts automation at its rule's loudness only. A bot
  event raised to loud (agent or user) goes on like a person's loud event:
  addressed or not by its kind, then freshness, dedup, throttle and the
  agent's veto as usual. Before, a bot-only raised event woke the tile but
  never pinged.

**Decision tables for loudness and pings.** Plain TypeScript arrays, first
match wins. Pings keep choosing the newest qualifying event within the
winning class. Freshness, dedup, agent veto and delivery stay outside the
tables. Tests cover input partitions and precedence collisions, not every
combination.

**Tests across rules.** Invariants over the sample boards and real-shaped
fixtures: a done tile or PR offers only Open, the lead PR is the turn's PR,
MCP and the pane name the same move, same events twice give the same facts.
Where rules differ on purpose (routed team requests, team coverage) the
invariant says so instead of asserting equality. One scenario test per bug
fixed. Landed in `core/rules-invariants.test.ts` (real-shaped boards: a done
PR on a live or snoozed tile, routed team requests),
`apps/server/src/fake/rules-invariants.test.ts` (every sample tile) and
`mcp/move-agreement.test.ts` (pr_context against the pane for every sample
PR).

Property tests (2026-09-29, fast-check) run the same kind of invariants over
generated boards instead of a handful of fixed ones. `@postpile/core/testing`
holds the board recipe (`boardSpecArb`: one topic, 1-3 tiles, 1-4 PRs each as
single, stack or set, pinged, found or pulled in; authors viewer, teammate,
other or bot; a short history of review requests, comments and mentions,
reviews, pushes, readiness, merge or close; thread read state, handled,
in-app approval, per-PR and whole-tile snoozes, glance verdicts, Look closer,
agent overrides, truncated or stale snapshots, pending writes), `buildBoard`
(snapshots from the steps, events from `deriveEvents` made seen the way the
sync and `planRead` do it, tiles from `buildTopicTiles`, a tile snooze from
`snoozeWrites`) and the invariant catalogue by level
(`invariants-tile.ts`, `-pr.ts`, `-read.ts`, `-topic.ts`), run in
`core/src/properties/` (the "Not done yet" dots too, since the dot moved to
core). Where rules differ on purpose the invariant names the exception
(routed NOT_YOURS, changes held, team taken, an ask first). The four open
cases the first runs found were decided 2026-09-30 (above) and their
exceptions removed, each with a scenario next to its property. `properties/coverage.test.ts` fails when a
branch-relevant label (PR state x author, request target, review state
including dismissed, thread and seen state, snooze kind and phase,
truncated, and the shapes past bugs needed) shows on under 1% of boards.
Each invariant checks 2000 boards by default (the property files take about
4s, `pnpm test` about 7s); `POSTPILE_PROPERTY_RUNS=10000 pnpm test` checks
more (about 20s for the property files). A failure prints the shrunk board recipe; a bug fixed
from one gets a named scenario next to its property (`properties/pr.test.ts`).

Spec oracles (2026-09-30). A one-off Stryker run found the invariants
killed only about a quarter of the mutants in the rule files: they used the
rule under test as their own reference (`isPrDone`, `snoozePhase`,
`pingRule`, `prTier` and others), so a mutation moved both sides, and the
board builder builds with the same rules. The invariants now compare
against oracles in `@postpile/core/testing` (`spec-facts.ts`,
`spec-events.ts`, `spec-rules.ts`, `spec-offers.ts`, `spec-layout.ts`):
the rules restated from the raw snapshot, the board's events and the
recipe, importing no rule module (types only). `invariants-board.ts`
checks the board against the recipe (each step's event with kind, rule
loudness and reason; seen and handled from the reads, touches and clicks;
tile layout and provenance; snoozes; the Look closer event).
`invariants-rules.ts` checks each PR's facts, move and the footer's words
for it, tier, done, unseen count, ping class and text, quiet reads and
Look closer ping; the tile, read and topic catalogues use the oracles too
(tile state, offers, the read plan, a board without a viewer). An exact oracle covers liveness as
well as safety: an addressed ask on an open unsnoozed tile pings, bot-only
activity gets a quiet read, nothing unseen stays in a
read's scope. Answering is a metamorphic check: a comment by the viewer
clears Reply, the answered-changes Re-review and Needs reply (a re-review
a pending request asks for stays). The generator also makes re-requests
after a changes request, a second outsider (alice), automation without the
[bot] suffix (renovate), pending reviews, review bodies, merge queue and
deploy items, sets that hold a stack and dissolved sets, and (2026-09-30)
comment edits: a bot updating its sticky comment, a person's plain edit or
one adding a mention, by the author or someone else. The PR as it stood at
a boundary is restated as `specSnapshotAt`, and `newMoveMatchesTheSpec`
checks `isNewYourMove` at the read and the last look on every thread. The property
invariants alone now kill 83% of the rule-file mutants (28% before, at the
same rule code; 300 boards per invariant).
The agent-assisted offers (2026-09-30) have their own oracle
(`spec-agent-actions.ts`: agent-safe, approvable, the tile and topic
Approve, the tile's Mark read backing and the topic's "Mark N read") and
invariants (`invariants-agent-actions.ts`, run in
`properties/agent-actions.test.ts`). The generator gives each glance a risk
line (low, medium, high or an unreadable word) and a stale flag.

Measuring with Stryker (one-off, not a dependency): in a throwaway
worktree add `@stryker-mutator/core` and `@stryker-mutator/vitest-runner`,
use perTest coverage, a fixed fast-check seed with `endOnFailure` in a
setup file, and `POSTPILE_PROPERTY_RUNS=300`. The vitest-runner (10.0)
filters each mutant's tests as "suite test" while vitest 5 names them
"suite > test", so it runs no tests at all and every mutant survives; put
`testNamePattern` in the vitest config the runner uses (`'^[a-z]+
invariants '` for the invariants, `'.*'` for the whole core suite) and the
results are right, only slower. Keep concurrency below the core count and
raise `timeoutMS`, or slow passing runs count as timeout kills.

## Architecture

TypeScript everywhere, Node 24, pnpm workspaces (`pnpm-workspace.yaml`, workspace deps as `workspace:*`).

```
core  <- store, github, agent  <- engine  <- server, cli
                                             desktop (main: engine + server; renderer: core types only)
```

- **packages/core**: domain types (`types.ts`), API read models (`views.ts`), pure logic: tile
  state, loudness rules, snooze evaluation, provenance, stacks, bot detection. No IO.
- **packages/store**: `node:sqlite`, migrations in `migrations/` (001 init, 002 engine memory, 003 fact recheck, 004 instructions versions, 005 topic areas, 006 pull-ins, 007 ping decisions, 008 action log, 009 work context, 010 drops `brought_back_at`, 011 pending writes), one repository
  class per table group, `Store` bundles them.
- **packages/github**: `GitHubReader` (viewer, notifications with ETag / If-Modified-Since,
  batched GraphQL PR enrichment, 12 PRs per query, PRs by branch for stack completion) and `GitHubWriter` (mark thread read,
  approve, comment) as separate interfaces. Token from `gh auth token`, read once, cached in
  memory.
- **packages/agent**: `AgentRunner`, `ClaudeCliRunner`, `AgentService` (topic assignment,
  set grouping, dossier update, fact reconcile, glance batch, event batch, consolidation,
  draft comment, chat, ping decision, context sweep).
- **packages/engine**: `EngineService`, the API the server and CLI call. Sync pipeline:
  fetch -> store -> classify -> agent digest -> derive tiles. `MarkReadQueue`. `WriteSwitch` + `GitHubWrites` (lock and action log, the only door to the writer). `createEngine`
  wires real dependencies; tests build `Engine` with fakes.
- **apps/server**: Hono + `@hono/node-server`, binds 127.0.0.1 only.
- **apps/desktop**: Electron via electron-vite. Main starts the server in-process on a random
  port with a random token and loads the renderer with `?api=...&token=...`. PATH is built
  without a shell (config `toolPath`, the start PATH, `/etc/paths(.d)`, then
  `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`, `~/.claude/local`; see "Missing
  tools"), so `gh` and `claude` resolve on a GUI launch. Quit (Cmd+Q, SIGTERM, SIGINT) flushes the
  mark-read queue, closes the engine and the server, then `app.exit(0)`.
  **App bundle** (`pnpm dist`): electron-vite bundles main (workspace packages and hono
  included), preload and renderer into `out/`; electron-builder
  (`apps/desktop/electron-builder.yml`) packs only `out/**` and `package.json` into an asar,
  no node_modules (the desktop package has devDependencies only). macOS, arm64, `dir` + `zip`,
  appId `com.posthog.postpile`, ad-hoc signed locally (`identity: "-"`, no hardened runtime,
  no notarization; a broken signature makes macOS drop notifications; the release workflow
  overrides these to sign with a Developer ID, hardened runtime and notarization), icon
  `build/icon.icns`, output `apps/desktop/dist/`, plus `latest-mac.yml` and the zip's
  `.blockmap` for self-update ("Self-update"). About 290 MB unpacked, 130 MB zipped
  (Electron itself is most of it).
- **apps/cli**: `sync`, `consolidate`, `topics`, `topic <id>` (with the dossier), `pr <owner/repo#n>`
  (with facts), plain text.

### HTTP API

Ids containing `/`, `#` or `:` (tile ids, event ids) are `encodeURIComponent`-ed
in paths. Every request needs `x-postpile-token`. The desktop app makes a
per-launch token and hands it to the preload over a sync ipc call
(`postpile:connection`, answered only for the app's own page), never on the
command line where `ps` shows it; the standalone server prints a per-run one unless
`POSTPILE_TOKEN` is set. The bearer token for GitHub only goes to URLs under
the API base URL. The desktop app denies every web permission except
clipboard writes from its own page. A web page cannot send the header without a
preflight and does not know the token, so CORS stays open.

| route | engine call |
|---|---|
| `GET /api/health` | - |
| `POST /api/sync` | `sync()` |
| `GET /api/topics` | `listTopics()` |
| `GET /api/topics/:id` | `getTopic()` |
| `GET /api/busy-inbox` | `busyInbox()` (`BusyInboxView`: the board cap cut the hot set, kept per tier, see "Big inboxes: what PostPile loads and works on") |
| `GET /api/inbox-cleanup` | `inboxCleanup()` (merged and old unread counts, every pick with what it clears, the start case, a run's progress) |
| `POST /api/inbox-cleanup/clear` `{merged, older, countedAt, from}` | `clearInbox()` (GitHub writes in the background, one pending write while locked) |
| `POST /api/inbox-cleanup/start-as-usual` | `startAsUsual()` (answers the start dialog, the held sync goes on) |
| `GET /api/mcp-connection` | `mcpConnection()` (cached `claude mcp get postpile`, commands, "Not now") |
| `POST /api/mcp-connection` `{from: footer\|setup}` | `connectMcp()` (`claude mcp add`, installed app only) |
| `POST /api/mcp-connection/not-now` | `hideMcpConnect()` |
| `GET /api/repos` | `listRepos()` (repo menu: counts, scope, quiet) |
| `POST /api/repos/scope` `{repo}` | `setRepoScope()` (one repo, null = all) |
| `POST /api/repos/quiet` `{repo, quiet}` | `setRepoQuiet()` |
| `GET /api/team-roles` | `getTeamRoles()`: each team with role, source and why |
| `POST /api/team-roles` `{team, role}` | `setTeamRole()` (local, sticks; 400 for a team the viewer is not on) |
| `GET /api/debug/notifications?limit=` | `debugNotifications()` (default 200, max 1000) |
| `POST /api/topics/:id/tailoring` `{text, keep}` | `decideTailoring()` |
| `POST /api/proposals/:id` `{accept}` | `decideTopicProposal()` |
| `GET /api/prs/:owner/:repo/:number` | `getPr()` (`pr` is the slim `PrPaneView`, see "The PR pane") |
| `POST /api/prs/:owner/:repo/:number/approve` `{headOid, body?, noteSource?}` | `approve()` (body: "Approve with comment"; noteSource: telemetry only) |
| `POST /api/prs/:owner/:repo/:number/comment-review` `{headOid, body, noteSource?}` | `commentReview()` (event COMMENT; final; refused while locked) |
| `POST /api/prs/:owner/:repo/:number/draft-ask` `{person, intent}` | `draftAsk()` |
| `POST /api/prs/:owner/:repo/:number/draft-review-note` `{kind, gist?}` | `draftReviewNote()` (kind `approve` or `comment`; gist: the user's words to write from; agent only) |
| `POST /api/prs/:owner/:repo/:number/comment` `{body}` | `sendComment()` |
| `POST /api/prs/:owner/:repo/:number/draft-reply` `{commentId, gist?}` | `draftReply()` (agent only) |
| `POST /api/prs/:owner/:repo/:number/reply` `{commentId, body}` | `replyToComment()` (thread reply or quoting comment; final; refused while locked) |
| `POST /api/prs/:owner/:repo/:number/react` `{commentId}` | `react()` (thumbs up on a comment or review; final; refused while locked) |
| `POST /api/prs/:owner/:repo/:number/opened` | `markOpenedRead()` (opened in the detail pane; `{marked}`: thread marked read or PR handled) |
| `POST /api/prs/:owner/:repo/:number/remove-team-request` `{team}` | `removeTeamRequest()` (final; refused while locked) |
| `POST /api/tiles/:tileId/mark-read` | `markRead()` |
| `POST /api/tiles/:tileId/prs/:owner/:repo/:number/mark-read` | `markPrRead()` (detail pane, one PR) |
| `POST /api/tiles/:tileId/snooze` `{condition}` / `DELETE` | `snooze()` / `unsnooze()` |
| `GET`/`POST /api/topics/:id/chat` `{message}` | `getTopicChat()` / `topicChat()` (the topic header's "Ask the agent") |
| `POST /api/undo` `{undoToken}` | `undo()` |
| `POST /api/feedback` | `giveFeedback()` |
| `POST /api/events/:id/unmute` | `unmuteEvent()` |
| `GET /api/live` | `livePollStatus()` (fast poll state, backoff, X-Poll-Interval, `changeCount`, `githubQuota` while low) |
| `GET`/`POST /api/github-writes` `{enabled}` | `githubWrites()` / `setGitHubWrites()` (the footer lock) |
| `GET /api/debug/actions?limit=` | `actionLog()` (default 200, max 1000) |
| `POST /api/notifications/:threadId/mark-read` | `markThreadRead()` (debug view, origin `debug`) |
| `POST /api/prs/:owner/:repo/:number/bring-back` | `bringBack()` (local only) |

### Build and tooling decisions

- **SQLite: built-in `node:sqlite`, no native module.** Tested: works under Node 24.21 and inside
  the installed Electron 44.4.5 main process (`ELECTRON_RUN_AS_NODE=1 pnpm --filter @postpile/desktop exec electron -e
  "require('node:sqlite')"`, Electron embeds Node 24.21, SQLite 3.53). This avoids
  better-sqlite3 and `@electron/rebuild` entirely. The built Electron main bundle keeps
  `node:sqlite` as an external builtin.
- **Workspace packages export TypeScript source** (`"exports": {".": "./src/index.ts"}`), no
  build step. tsx runs the CLI and server, vitest and electron-vite compile on the fly. The
  desktop main bundle inlines workspace packages (`externalizeDeps.exclude`).
- **Relative imports use `.ts` extensions** (`allowImportingTsExtensions`, `noEmit`). Nothing
  is emitted by tsc.
- **Typecheck** is `tsc --noEmit` per workspace (`pnpm typecheck`), not project references:
  simpler with source-first packages. TypeScript 7 (native compiler) is fast enough that the
  repeated work does not matter.
- **electron-vite 5 caps vite at 7**, so vite is pinned to `^7` and `@vitejs/plugin-react` to
  `^5`. Revisit when electron-vite supports vite 8.
- **pnpm** (12.6, `packageManager` in the root package.json; moved from npm workspaces
  2026-09-28). Strict node_modules: every package declares what it imports (server has zod,
  hono; desktop has electron, electron-vite, vite, react and the rest as devDependencies); the
  root only holds the shared tools (typescript, vitest, tsx, @types/node), which workspace
  scripts and test files find by walking up. No `node-linker=hoisted` and no `.npmrc`:
  electron-builder detects pnpm, finds no production deps for the desktop package and packs
  only `out/**`.
- **Install-script gating**: pnpm 12 fails the install while a build script is neither allowed
  nor denied. `allowBuilds` in `pnpm-workspace.yaml` allows esbuild and denies
  electron-winstaller. Electron 44 no longer downloads its binary on install; run
  `pnpm --filter @postpile/desktop exec install-electron` after a fresh `pnpm install` (only
  needed for `pnpm desktop`; `pnpm dist` downloads its own copy).
- **Localhost API safety**: binds 127.0.0.1, and a token is always required (per launch in the
  desktop app, per run in the standalone server) so web pages and other local processes cannot
  drive approve/comment/mark-read.
- **Paths**: `POSTPILE_CLAUDE_DIR` (default `~/.claude`) is what the work context sweep
  reads. Database at `~/Library/Application Support/PostPile/db.sqlite` on macOS
  (`$XDG_DATA_HOME/postpile/db.sqlite` elsewhere), instructions at
  `~/.config/postpile/instructions.md`. `POSTPILE_DB` and `POSTPILE_INSTRUCTIONS`
  override, and `POSTPILE_DATA_DIR` moves the whole data folder.
  Until 2026-09-28 these folders were named `code-manager`: `migrateLegacyData`
  (`packages/engine/src/legacy-data.ts`) moves them on start when no other process holds the
  database, else copies and leaves a README note. `applyLegacyEnv` (`paths.ts`) still maps
  `CODE_MANAGER_*` to `POSTPILE_*` with a deprecation line.
- **Timestamps**: core compares ISO strings, so `packages/github` normalises every GitHub time
  through `toISOString()` (GitHub omits milliseconds, the app writes them).
- **Env switches**: `POSTPILE_FAKE=1` runs server/CLI/desktop on the in-memory Depot sample
  data (`FakeEngine`, for UI work). `POSTPILE_READ_ONLY=1` never builds the real GitHub
  writer and keeps the footer lock closed (smoke runs against a real account). Without it,
  dev runs still start locked (only the packaged app has writes on by default) until the
  lock is opened. `POSTPILE_FAKE_LOCKED=1` starts the sample data locked (it starts with
  writes on, like the packaged app). `POSTPILE_POLL_SECONDS`
  (default 60, 0 off, never faster than GitHub's X-Poll-Interval), `POSTPILE_PING_CAP` (default 200 per 24h) and
  `POSTPILE_MAC_NOTIFICATIONS=0` tune the live poll. `POSTPILE_CATCHUP_CAP` (default
  600 per 24h, 0 off) caps glance catch-up, `POSTPILE_AUTO_SYNC_MINUTES` (default 60,
  0 off) the background sync.
- **Test builders** live at `@postpile/core/fixtures` (incl. `FakeTimers`); engine tests use
  fake reader/writer and the agent's `FakeRunner`.

### Safety while building

- **Dev profile**: `POSTPILE_PROFILE=dev` uses `~/Library/Application Support/PostPile-dev`
  (`$XDG_DATA_HOME/postpile-dev`) and `~/.config/postpile-dev`. The unpackaged desktop app
  (`pnpm desktop`, `app.isPackaged` false) sets it itself; the repo's `pnpm cli` and
  `pnpm server` scripts default to it (`POSTPILE_PROFILE=${POSTPILE_PROFILE:-dev}`). The
  packaged `PostPile.app` runs as `default` on the real folders. `POSTPILE_PROFILE=default`,
  `POSTPILE_DATA_DIR` and `POSTPILE_DB` still point anywhere on purpose. The first dev run copies
  the real `instructions.md` into the new dev config folder (a copy, never a link, once). The
  code-manager move never runs in dev and only targets the real folder. The title bar shows a
  DEV badge (`AppConfig.profile`) with the database path in its tooltip.
- **Database lock**: whoever opens a database takes `<data folder>/postpile.lock` (pid, kind
  `packaged` / `dev` / `cli` / `server`, start time, database, app version; `DataDirLock`, O_EXCL create).
  A second process refuses with "PostPile is already running with this database (pid N,
  kind, ...)": the desktop app shows a dialog with Quit, the CLI and the server exit 1. A lock
  whose pid is dead is stale and taken over. Released on close and on process exit. The CLI's
  read commands take `--read-only` (no lock, no GitHub writes); sync, poll, sweep and
  consolidate refuse it. The desktop app also asks `app.requestSingleInstanceLock()`, so a
  second launch of the same app (same userData) only focuses the first window.
- **A database from a newer PostPile** (2026-10-05, since 0.20.0): `openDatabase` reads the
  schema version (`MAX(version)` of `schema_migrations`) through a read-only connection of
  its own before it opens the file for writing, and refuses a version above this build's
  newest migration with `NewerDatabaseError`. It never migrates down, and the database file
  and its WAL are never changed: no WAL pragma, no migrations, and no checkpoint (closing
  the last read-write connection would copy a WAL the newer build left behind into the file;
  Codex review on #121). The read-only reader may still create or rebuild the `-shm`
  sidecar (SQLite's shared-memory index, no data), and in a folder it cannot write, with
  the sidecars missing, it fails with SQLite's error before it learns the version
  (https://sqlite.org/wal.html#read_only_databases; checked with Codex GPT-6.1).
  The desktop app shows "This database was written by a newer PostPile" with Quit and a
  link to the latest release; the CLI and the server exit with the message. Read-only opens
  (CLI `--read-only`, MCP) refuse any other version anyway, a newer one with the same error.
  Self-update only moves forward, so this hits a hand-installed older build.
  Limits: builds up to 0.19.0 have no guard and still open a newer database, so the
  protection starts with the first guarded release. And it only sees schema versions: any
  later step that older builds must not run against (stripping fields from the stored
  snapshot json, retiring `pr_snapshot`) ships with its own numbered migration, even when
  the migration itself only adds a column or nothing at all, so the guarded builds refuse
  that database instead of misreading it or querying a dropped table.

- No GitHub write calls in tests or smoke runs. Tests use fakes; `GitHubWriteClient` is only
  constructed by `createEngine`, and not at all with `POSTPILE_READ_ONLY=1`. A fresh
  database starts with the lock closed. The sync path
  (`GitHubSync`) only holds a `GitHubReader`.
- Live `claude` calls: at most 3 across the build, small inputs.

## Open questions for Julian

- **UI framework, final choice**: Electron + React is scaffolded because it gives a web app for
  free later. Tauri or a native shell are still possible; only `apps/desktop` would change.
- **Carousel vs list** for tiles inside a topic. The placeholder renders a plain list.
- **Layout**: three panes (topics / open topic / PR or stack detail) is the current favourite,
  not final.
- **Memory layer details** (the v1 above is a proposal; current choices in brackets):
  - how many feedback entries per topic go into prompts [10]
  - whether sets are regrouped on every sync or only when membership changes [on sync, when
    open PRs, dissolved sets or topic feedback change]
  - new topics: created directly or only as proposals [directly]
  - event overrides: only new loud events go to the agent [yes]
  - how long dissolved sets and "not related" feedback keep suppressing a regroup
  - whether a PR may belong to more than one topic (schema says one; a stack tile shows in
    every topic that owns one of its PRs)
- **Engine memory v2** (current choices in brackets):
  - instructions.md edits: re-run every dossier update, or let dossiers catch up on the next
    event while glances pick the change up at once [re-run: instructions, tailoring and
    standing rules are in `dossierContextHash`, one call per topic after an edit, so glances
    are not written from outdated userCares]
  - glance hash includes the dossier version, so every dossier update regenerates the glances
    of that topic (one or two batch calls). Alternative: hash only the glance-relevant parts
    (goal, status, userCares, people) [version, as decided; dropped 2026-10-05, see "Glance hash"]
  - when "seen" moves: explicit `markTopicSeen` when leaving a topic, or on opening it
    [explicit, the UI calls it when the user leaves the topic]
  - retiring finished topics: automatic behind the deterministic gate (all PRs merged/closed,
    3 quiet days since 2026-09-29, was 14; every tile done) or a proposal like merges
    [automatic on every full sync, reversible]
  - accepted global rules: kept in the database and added to every prompt, or appended to
    instructions.md [database; instructions.md stays the user's own file]
  - fold set grouping into the dossier update to save one call per topic [behind
    POSTPILE_TOPIC_DIGEST=1 since 2026-10-01, see "One call per topic"; the set job stays for
    topics without a dossier update]
  - first dossier update of a big topic: 120 events max, 15 per PR, older ones only counted
    [yes]
  - one initiative per topic, or initiatives spanning topics [one per topic]
  - consolidation cadence: due after 24h and at least one new dossier version, triggered by
    the desktop app when idle and by `consolidate` in the CLI [yes; the desktop app checks
    every 30 minutes since 2026-09-29, no idle detection]
  - dossier history: keep the newest 50 versions per topic, pruned on save [50]
  - glance batches with 18 PRs per call [yes; moved from haiku to sonnet after a side-by-side run]
  - dossier driver overrides "most frequent author" for the topic driver [yes]
- **Work context sweep** (current choices in brackets):
  - model [opus; cost is no concern, the call has to judge work vs. private in loose notes]
  - private projects (side projects, household paperwork, a personal blog) are sent to the model and
    filtered by the prompt [yes; a skip list of project folders would keep them local]
  - which prompts get the digest [topic assignment, dossiers, glances, pings, chat; not sets,
    events, consolidation, recheck, drafts]
  - budget split and caps [60k: CLAUDE.md 6k, sessions 30k, memory 24k; most memory files of
    the posthog project never fit, only its MEMORY.md index]
  - a failed sweep retries after 2h, not on every 30-minute check [yes]
- **Live poll and Mac pings** (current choices in brackets):
  - obey GitHub's X-Poll-Interval (60s) or poll faster [obey it, plus one cycle on window
    focus (decided 2026-09-29, was 10s)]
  - loud but not addressed (approval or comment on your own PR, merged without your review):
    ping or not [not; they stay unread tiles and never reach the agent]
  - team review requests (RT) and team mentions: addressed [yes; the prompt tells the agent it
    is the team, not the user in person, except a team request on a teammate's PR, which counts
    like a personal one (whose turn "Review for team-devex: lyra's PR", 2026-09-28)]
  - events older than 30 minutes never ping (catch-up after sleep or a failed poll) [yes]
  - a poll whose PR fetch failed leaves those PRs to the full sync; the next poll gets a 304
    and does not retry them [yes, keeps the 304 path free]
- **Snooze wake-up**: implemented default (`breaksSnooze`): a loud event from a human after the
  snooze started ends it, so a mention is never hidden; since 2026-09-30 also an automation event
  the agent or the user raised to loud (both kept 2026-09-30, see "Decided from the property
  tests"). Confirm.
- **A broken snooze comes back**: a snooze broken by a mention comes back once the mention is
  read (`packages/core/src/snooze.test.ts` asserts it). Keep, or end the snooze for good when it
  breaks? (From the codebase review, 2026-09-29.)
- **Loudness rules beyond the spec**, to confirm: human mentions of a home team are loud (a routing team's are quiet, decided 2026-09-30); human reviews and
  comments on the user's own PR are loud; a mention or question drops to quiet once the user
  spoke on the PR after it (and is seen anyway since "You already dealt with it"); loud events on pulled-in PRs also make a tile unread (confirmed 2026-09-30, the layer gets a "Not done yet" dot). Commits after
  the user's approval are quiet unless the agent raises one (decided 2026-09-28).
- **Repo name**: decided 2026-09-28, the app is PostPile (formerly the working title
  `code-manager`). Renaming the repo folder is still open.

## Update reminder escalates (2026-10-01)

The reminder has two sizes, picked by core (`updateUrgency` in
`packages/core/src/updates.ts`), never by the renderer.

- **Behind since**: the publish time of the oldest release newer than the
  running version, so the first one the user missed. A newer release does not
  restart the clock.
- **Releases behind**: non-draft version releases newer than the running
  version among the last 10 fetched. When the oldest fetched one is still
  newer, there may be more, and the bar says "10+".
- **Under 24h behind**: the small neutral pill in the title bar.
- **24h or more**: a full-width bar under the title bar, calm amber (the
  `--amber-*` tokens), never coral (coral means "new since you looked"). It has
  the brew command, release notes and "Later".
- **Later**: on the bar it drops back to the pill for 24h, then the bar
  returns. In the pill's popover (under 24h) it hides the pill until the bar
  takes over. Stored as one timestamp in localStorage; losing it only shows the
  reminder again.

Why: the owner releases about twice a day, and "Later" used to hide a version
for good, so the reminder went quiet while the user kept falling behind.
While the user is behind, it never goes quiet for good.

## Self-update (2026-10-03)

The packaged app downloads new releases itself and installs them on a
restart. The reminder above still decides when to show and how loud; the
install state only changes what it offers.

- **How**: electron-updater in the main process
  (`apps/desktop/src/main/self-update.ts`), GitHub provider. It reads
  `latest-mac.yml` from the newest published release, downloads the zip it
  names (checked against its sha512) and hands it to Squirrel.Mac, which
  checks the signature against the running app and stages it. Checks run on
  their own clock: ~30s after start, then every hour. The release check
  stays at every 6 hours, since it asks `api.github.com` without a token
  and installs behind one office IP share 60 requests an hour; when the
  installer finds a release, the release check runs right away so the
  reminder knows it too. A sleeping Mac runs no timers, so
  the hourly timer alone can lag after a sleep: on
  `powerMonitor` resume the installer checks again 30s later (network back)
  unless a check started in the last 30 minutes (wall clock), and never
  while downloading or staged (2026-10-06).
- **Telemetry** (main process): `update_check_finished` per check it ran
  (trigger launch / interval / wake / menu, result none / available /
  error, the found version), `update_downloaded` once staged,
  `update_failed` (stage check / download, a short error code, never the
  message). A check skipped while one runs or an update is staged sends
  nothing, so "never checked" and "checked and failed" show apart.
- **States** (core's `InstallState`): off, idle, checking, downloading,
  ready, failed. "Ready" is Squirrel's own `update-downloaded`, not
  electron-updater's earlier one, so a restart never waits on staging. Once
  ready it stops checking; a newer release comes with the next check after
  the restart.
- **What the reminder offers** (core's `updateAction`): ready means
  "Update ready · 0.6.0" on the pill and a primary "Restart to update"
  (ink: an app action, not an approval) with "Or it installs the next time
  PostPile quits". Checking or downloading means "Downloading the update…".
  Everything else (no installer, failed, or the installer found nothing
  while the release check did) means the brew command, as before. Once
  staged, the pill and bar name the staged version, not a newer release
  that came out since: that is what the restart installs.
- **Restart**: the same flush-and-close as Cmd+Q (pending mark-reads are
  sent, the database closed; it runs once, so a Cmd+Q meanwhile waits for
  it), then electron-updater's `quitAndInstall`. When the app has not quit
  60 seconds after the click (a stuck flush, or Squirrel failed), the
  current version starts again, since the engine is stopped by then.
- **Later**: unchanged (the reminder's snooze). A staged update installs on
  any quit (`autoInstallOnAppQuit`), so Later never loses it.
- **Check for Updates…** in the app menu runs both checks now and answers in
  a dialog; a staged update gets "Restart Now".
- **Off**: in a dev run (no bundle to replace), with `POSTPILE_AUTO_UPDATE=0`
  (the reminder then offers the brew command) and with
  `POSTPILE_UPDATE_CHECK=0` (no reminder at all). Sample data shows a staged
  update; `POSTPILE_FAKE_INSTALL=downloading`, `failed` or `off` shows the
  others, and its restart only relaunches.
- **Releases**: only a Developer ID signed release carries `latest-mac.yml`
  and the zip's `.blockmap`; Squirrel.Mac would refuse an ad-hoc one. The
  release stays a draft until every file is up, so installed apps never see
  a release without them.
- **Homebrew**: the cask says `auto_updates true`. brew then leaves an app
  that is already newer than the cask alone, and `brew upgrade --cask
  postpile` still works. brew's recorded version lags behind after a self
  update; nothing reads it. The `postpile-mcp` link points into the app
  bundle, which Squirrel replaces in place, so it keeps working.
  The cask also has `uninstall launchctl:` for Squirrel's ShipIt job: it
  installs a staged bundle on quit without a version check, so without it
  `brew upgrade` could be overwritten by an older staged update.

Why: the owner releases about twice a day, and the brew command plus a quit
and reopen was a chore every time. Rejected: update.electronjs.org (one more
service; electron-builder already writes what electron-updater needs) and an
S3 feed like PostHog's desktop app (the repo is public, so GitHub releases
serve the files).
