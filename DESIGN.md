# PostPile design

Decisions from the design rounds, tidied. Open points are at the end.

## Product model

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

**Areas, topics, tiles and sets** (2026-09-29): one glossary,
`WORK_GLOSSARY` in `packages/agent/src/prompts/shared.ts`, goes into every
prompt that sorts, groups or tidies PRs (topic assignment, set grouping,
dossier update, consolidation), so all agents cut work at the same grain:

- *Area*: the part of the product or codebase the work touches ("Hogland",
  "Data warehouse", "posthog-cli"), never the user's own field or team
  ("Dev tooling" held 70 of 113 topics on real data and said nothing). A
  label on topics, never a topic itself, a handful to about fifteen topics
  each. The dossier update replaces a catch-all area when it next writes the
  topic (still at most MAX_NEW_AREAS_PER_SYNC new areas per sync).
- *Topic*: one goal someone drives, with a finish line. The test: one
  sentence states the goal, and every PR moves it forward or came out of
  that work while it was going on (a fix found while doing it). Sharing a
  repo, an area or a word ("CI", "security") is not enough.
- *Tile*: what the user acts on in one go: a PR, a stack or a set.
- *Set*: two or more PRs inside one topic best read together.

Topic assignment puts a PR into a live topic whose goal it serves or came
out of (live: open PRs or activity in the last two weeks; each offered topic
shows its open count and last activity). A finished or quiet topic only takes
a direct follow-up; anything else gets a new topic. There is no catch-all
"fixes and upkeep" topic and no preference for broad topics any more: that
preference let unrelated PRs pile into one topic. The user's instructions may
set a finer or coarser grain.

**Topic status**: `active`, `retired` (finished) or `archived` (merged
away, never comes back). Every full sync ends by retiring each active topic
that passes the gate (`RetireGate`, `retireFinishedTopics`): every member PR
merged or closed, no events for 3 days, and every tile done (since
2026-09-29 evening; before, only "no unread or snoozed tile", which retired
topics holding unseen merges without the user's review). No agent
verdict is needed, and Unsorted never retires. It runs after the digest, so
the sync's own events count; the sync log line and `SyncReport.topicsRetired`
say how many. Retiring is reversible: a new loud event on a member PR
(`reviveRetiredTopics`, full sync and live poll) or a new PR assigned to it
(retired topics stay on offer for 30 days) makes it active again. Every
status change goes through `nextTopicStatus` (engine: `changeTopicStatus`),
and retiring records `retiredAt` (migration 020; before, "retired at" read
`updatedAt`, which any rename moved). Loud means effective loudness: the
full sync classifies new events first (retired topics' events included) and
revives after, so an event the agent turned quiet brings nothing back. The
live poll does not classify and still revives on the rule's loudness. Retired
topics leave the sidebar list and wait in its Finished drawer (see "Queue
sections"). Until 2026-09-29 only the daily consolidation retired topics,
and only when the agent said finished and 14 quiet days had passed; most
topics with every PR merged never left the sidebar.

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
  the user's own open PRs (`own_open`, "your open PR", code AU), reviews asked
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
queues, but never make a tile unread on their own (their loud events are
skipped in `unreadReasons`, `unseenLoudEvents` is 0); an owed review still
says "Your move" and lifts the topic. Quiet repos apply to them too. The why
badge tooltip says "found: <reason>; not in your inbox, found via GitHub".
Stack completion walks from pinged and found PRs alike. Sets are
agent-grouped among pinged and found PRs; the agent never pulls PRs in.

**Events**: every GitHub activity on a PR becomes an event line. Loudness:

| loudness | effect | examples |
|---|---|---|
| loud | tile becomes unread | mention, review requested, question to the user, a push after the user approved when the agent raises it, the author's push or comment after the user requested changes ("addressed your changes") |
| quiet | dot, no state change | bots, CI (always, see "CI is not a signal"), deploys, merge queue, pushes after the user approved (by default), merged without the user's review (never loud; surfaced by the done rule instead, see "Merged without your review") |
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

- `unread`: a member has an unseen loud event. The tile says which PR and which event.
- `snoozed`: every tracked PR in the tile has an active snooze whose condition is not met
  yet. Snoozes are stored per PR (see "Snoozes belong to PRs"); every snooze also ends
  when its PR is merged or closed.
- `done`: every pinged member is done and nothing loud is unseen. A PR is done only when
  nothing is asked of the user (`isPrDone`, 2026-09-28): merged or closed (except a merge
  without their review they have not seen yet, see "Merged without your review"), or approved by
  them while whose turn is not "you" (a later question or mention after the approval keeps
  it out of Done), or handled (marked read) while whose turn is not "you" and no review is pending of
  them (`reviewPending`: a personal request, a team request on a teammate's PR, or a routed
  team request no teammate picked up and not on hold (`teamRequestHold`, see whose turn),
  head not reviewed by them). Marking read a PR that
  still waits on their review makes it read (no strip, no coral) but leaves it open in the
  normal tile list with its turn footer, and in To review; it never lands in the Done fold.
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
(until someone replies | new push | CI green, the user's own pick | a time), "ask <person>" (agent
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

**Big inboxes** (2026-09-29, core `selectSyncThreads`): every notification
is stored, but only threads updated in the last 30 days
(`SYNC_MAX_AGE_DAYS`) are ever fetched and digested, and one full sync takes
at most 60 PRs (`SYNC_MAX_PRS`, the engine's default `maxPrs`), unread
first, newest first. A thread older than that comes back in when it moves
again; the user's own PRs, review requests and recent merges still arrive as
found PRs. When a sync stops at the cap, the next background sync runs 2
minutes later instead of an hour (`BACKLOG_SYNC_MINUTES`), so a backlog
(two weeks away, ~400 notifications) drains in batches while the newest 60
already show. Before, a year of unread notifications kept the first sync
running for 20+ minutes.

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
- not mine: same as mark read (events seen, handled, thread mark-read queued,
  undo token) + feedback, one row per member for a stack or set tile.
- not related: member marked removed in the set (a set left with one member
  dissolves); regroups never put it back with the remaining members.
- wrong topic: moved as a user assignment when a target is given, otherwise
  membership removed so the next sync re-sorts it with the feedback in the
  prompt.
- unmute: user override (`quiet`, or the rule loudness if that was not muted).

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
   "none", in the normal tile list (not in the Done fold), and carries the
   merge on `TileState.unseenMerges`: the tile shows it in a grey strip where
   an unread tile has its warm one ("nell merged it without your review ·
   2d", `UnseenMergeStrip`), without the NEW pill. History: 2026-09-25 "approved and even merged might mean I
   still need to take a look"; 2026-09-28 "review required in done makes no
   sense" (done = nothing asked of the user, which stays: nothing is asked
   here, but something is unseen) and "not urgent when all stuff has merged"
   (why it never makes a topic urgent).
3. *"Not yours" counts as seen.* When the PR's glance says NOT_YOURS, the
   merge counts as seen and the tile is done (it shows in the Done fold with
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
8. *Inbox cleanup unchanged.* "Mark everything older than 14 / 30 days read"
   stays the user's explicit choice, and it includes these threads (idea from
   2026-09-28: "when people come from vacation, I had 500").

## CI is not a signal

Decided 2026-09-29. Julian: "I don't think we should focus on or even take in
any CI at any point because that's too fuzzy. It could flake, it could fail at
any time, and it's always the responsibility of the author to bring the PR to
green. Except for maybe some details in the detail pane, we shouldn't
highlight it or put it into text or into any risk."

**The rule.** CI status (the check rollup, check results, `ci` events) never
drives anything the app says or ranks:

- *No prompt gets it.* `prDetails` has no `CI:` line, the rendered dossier's
  timeline has no "CI failing" (`prStateWords`), and `ci` events are left out
  of the ping decision, memory recheck and dossier update prompts
  (`withoutCi`). The topic delta drops them (`selectTopicDelta`), so a
  CI-only change starts no dossier update and bumps no dossier version; the
  digest cursor still moves past them, so they are not read again.
  Checks were never in the glance hash (`prGlanceSnapshot`) and stay out, so
  a re-run never makes a glance stale.
- *The writing agents are told.* Every prompt that writes something the
  user reads carries `NO_CI_RULE`: glance, dossier update, ping decision,
  memory recheck, chat, topic assignment, sets, consolidation. No CI or check
  status in any field, and CI status in older stored text (glances, dossiers,
  summaries from before the rule) is stale and ignored. A recheck of a CI
  claim answers drop (or fix without the CI part), never holds. The draft
  comment prompt is the exception: it writes the user's own ask. The MCP
  server's instructions say PostPile does not track CI.
- *Not a move.* Whose turn has no `fix_ci`; failing CI on the user's own PR
  is not their move by itself.
- *Never loud.* `ci` events are machine activity: quiet by the rules, never a
  ping (bot-only activity), never an unread reason. The events agent never
  sees them (it only judges loud events and pushes after approval), so
  nothing overrides that.

**What stays, and why.** CI as a subject of the work is code, not status:
topic names ("Move CI to Depot"), the "CI" area, changed workflow files in the
prompt, and the events agent raising a push that makes a substantial change
in CI, build or devex areas the user approved. The detail pane keeps the
"Checks" fact (`PrFacts`) as a neutral detail, no more prominent than now,
and the activity list keeps CI results in the folded bot/CI line. The snooze
option "Until CI is green" (`ci_green`) stays: the user picks it.

**History.** Design 3a (2026-09-29 morning) took CI off rows, tiles, the
detail state line and the RISK box, leaving it only in the facts. CI still fed
the agents and the rules: a stale glance said "Hold approval until CI is
green" next to an approved PR, own PRs with failing CI got the "Fix failing
CI" move, and dossiers wrote "CI failing" into timelines and status lines.
Existing glances and dossiers that mention CI are not regenerated on purpose
(no `GLANCE_PROMPT_VERSION` / `DOSSIER_PROMPT_VERSION` bump): a glance goes
stale on the PR's next push, review or human comment, a dossier on the
topic's next real activity, and a bump would rewrite every one of them in
one go for a line that fades on its own.

## Memory / agentic digesting layer (v1 base)

**Engine memory (v2)** below replaced the topic summaries, the per-PR glance
calls and the per-PR event calls. Everything else here (instructions,
membership, sets, feedback, overrides, the runner) still works as described.

Everything the agents know persists in SQLite, keyed so it survives restarts
and only recomputes on change.

| what | where | invalidated when |
|---|---|---|
| general instructions | `~/.config/postpile/instructions.md`, in every prompt; absent = none | file edited (part of every input hash) |
| glance | `pr_glance`, latest per PR + `input_hash`, `model`, `dossier_version` | PR snapshot moves (not CI: checks are in no prompt and no hash), dossier version, instructions, tailoring, standing rules or feedback on that PR change. Reads recompute the hash and flag a mismatch as `glanceStale` |
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

Sets (`set_grouping`) run per topic with 2+ open PRs; hash = PRs + dissolved
sets + topic feedback, kept in `meta` (`set_grouping_hash:<topic>`). Active
sets are not in the hash, they are the agent's own last answer. A set the
agent keeps under the same title keeps its id (tile id and chat survive;
snoozes are per PR and survive regrouping anyway); sets it drops are deleted; dissolved sets are never brought back.
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
  facts recorded or closed after it, and the count of new events.
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
   loudness. Every derived event of a fetched PR goes to `event_log.append`
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
- a topic's glances start when that topic's own dossier update settled (the
  glance hash carries the dossier version), then its retry batch right
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
- drops muted events and CI results ("CI is not a signal"), keeps bots
  (the prompt compacts them to counts)
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

`isEmptyDelta` = no dossier update for that topic.

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
per PR; CI results are dropped from the delta, so a CI-only change starts no
update), left PRs, known facts (short ids `F1..Fn`), stale facts to
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
  wrote `LOOKS_SASAFE` / `LOOKS_SASE` for one real PR (PostHog/posthog#107116),
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
  **dossier version**, instructions, tailoring, standing rules, feedback on
  that PR, model, and `GLANCE_PROMPT_VERSION` (g2 since key files, so every
  glance regenerates once; sets and topic summaries keep their hashes).
  Never the other PRs in the batch. Stored glances get `dossierVersion`.
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
and "#2" are not duplicates); the newest 60 feedback entries across topics;
decided rule and topic proposals (so nothing is proposed twice).

Output and what happens:

| output | effect |
|---|---|
| `topicProposals` rename / merge / split | filed as pending `topic_proposal` rows, same "never the same idea twice" rule as v1. Split PR keys must come from the topic's dossier timeline (the prompt has no other member list), so a topic without a dossier gets no split |
| `factMerges` | applied directly: dropped facts closed with `superseded_by` = kept one, refs moved over (internal memory, nothing the user sees disappears) |
| `rules` | filed as pending `rule_proposal` rows. Accepted global rules go into every `PromptContext.standingRules`; accepted topic rules are appended to that topic's tailoring |
| `finished` | topic retired only if the deterministic gate also holds: every member PR merged or closed, no events for 3 days, no unread or snoozed tile. Every full sync retires such topics anyway, agent or not (see "Topic status"). Retiring is reversible |

Also deterministic, in the same run: retire topics that pass the gate and
whose dossier status is `finished`. Dossier versions are pruned on every
dossier save, not here.

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
  waits on a sync and shows `syncing · agent 34/82 · 2m` (`fetching GitHub`
  before any call is planned; tooltip lists the running phases). FakeEngine
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
  the agent what's wrong": the tile chat opens with the line quoted.

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
- The PR's glance as a whole: "Recheck" in the detail pane's action bar
  ("Recheck this assessment") sends the joined glance as the claim with
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

**Instructions changes via chat.** Tile chat returns a lasting point
without a scope; the user picks it: "Keep for this topic" stores tailoring,
"Just this once" only logs it, "Keep for all topics" calls
`proposeInstructionsChange`, which gets only the current text and the
user's own message (never GitHub text), is told the user chose all topics,
and returns the full new text plus a summary. The UI shows it as a line
diff: Accept, Edit inline, Reject. The general chat in "Your instructions"
always goes to the same call. When that call finds no change, the point
stays on screen so it can still go to the topic. Proposals must cite a
stored user chat message (`sourceChatMessageId`); the engine refuses
anything else.

**Versions** (`instructions_version`, migration 004): `version`, `text`,
`summary`, `origin` (`chat` / `outside`), `source_chat_message_id`,
`created_at` (origin `setup` for the setup flow's Accept). The file stays the source of truth. `InstructionsHistory`
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
4. **Accept** (`POST /api/setup/accept`) lists what happens, shows the
   fit check (below) and the final diff and then: writes `instructions.md` as a new version with
   origin `setup` ("Written with setup" / "Rewritten with setup"; an
   unchanged text writes nothing), marks the chosen repos quiet (others
   untouched), sets the repo scope to the main repo (or All repos), stores
   `done`, then the renderer runs a normal sync with its progress and
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
- **UI**: inside the sidebar's "Other topics" section (see "Queue
  sections") the groups are Needs you (any relation) / Your team (by area)
  / Routed to you / FYI, the last two folded by default. The topic header
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
Small topics are consolidation's job: it proposes merging 1-2 PR topics
into a bigger one. Migration 015 deleted the old `topic_deferred:*` meta
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
list (aria-label "Not done yet"). No dots on done or snoozed tiles. Not on
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

**Whose turn names the re-reviewer.** "rowan to address ada's
changes" stayed after rowan pushed and re-requested ada's
review. When the author pushed after a changes request and the requester is
requested again, it is the requester's move: "ada to re-review"
(whose-turn rule 4).

**Own merged PRs clear on GitHub too** (changes rule 2 of "Handled quietly"
and part 2 of "You already dealt with it"). The own-PR exception (bots after
your last touch keep the thread unread, since on your own PR they can mean
work) applies only while the PR is open. Every own PR merges through trunk
after the last comment, so 14 merged own PRs stayed unread after 0.10.0.
Julian: "my own merged or closed PRs can be cleared when only bots come in
after my last touch."

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

**Marked when you move on** (decided 2026-09-29, after the build above).
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
- The dot: `notDonePrKeys` in core `tile-view.ts`, shipped as
  `TileView.notDonePrKeys` (moved out of the renderer's `lib/tiles.ts`
  2026-09-30), `NotDoneDot` in `pills.tsx`.
  A done PR that still has unseen news keeps the tile unread, so it keeps
  its dot until it is read.
- Lead PR: core `leadPrKey`; the renderer's `leadPr` only looks up that row.
- Marked when you move on: `OpenedReadTimer` in the renderer's
  `lib/opened-read.ts` (the dwell arms, `leave()` / `hidden()` fire,
  `setWanted` keeps `opensMarkRead` current) driven by `useOpenedRead`
  (leaves when the PR changes or the pane closes, `visibilitychange`,
  window `blur` / `focus`). The held place is `holdPlace` in
  `lib/hold-place.ts` with `useHeldPlace` (the place taken when the
  selection starts): `TileGrid` holds the selected tile across its live,
  Snoozed and Done lists (the Unread filter keeps that order),
  `TopicSidebar` holds the open topic's row across the queue sections and
  Other topics (`layoutBuckets` / `layoutFromBuckets` in `lib/queues.ts`)
  while its selected tile stays selected.
- Opened in PostPile: core `openedReadCheck` (per PR), engine
  `QuietReads.markOpened`, renderer `opensMarkRead`; see "You already dealt
  with it" part 3. When GitHub has the thread read already, only the
  PostPile side runs (PR handled, a local log row).
- Re-reviewer: core `reReviewAsked` (`changes-answered.ts`), used by
  whose turn on the routed team hold, on a team request a teammate picked
  up with a change request, and on the viewer's own PR.
- Own merged PRs: `isOwnOpenPr` in core `quiet-reads.ts`, in both the
  bot-only and the "you acted after it" rule; `botOnlySinceRead` leaves the
  viewer's own events out.
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

## PR ownership: bot PRs belong to their assignees (2026-09-30)

Coding agents open PRs through a GitHub App on someone's behalf: the author
is the bot (GraphQL `__typename: Bot`, read as `name[bot]`), and the person
the PR is for is its assignee. Looking only at the author, such a PR never
became "Your PR", never landed in My PRs, and a teammate's agent PR never
counted as a teammate's.

- **The rule** (`prOwners` in `pr-owners.ts`): a PR's owners are its author,
  except when the author is a bot (`isBot`) and the PR has assignees; then
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
  `is:pr is:open assignee:@me` next to the viewer's own open PRs and keeps
  only hits a bot opened (found as `own_open`, "agent PR assigned to you").
  GitHub notifies the assignee with reason `assign` (code AS), so an agent
  PR usually arrives through the inbox anyway.
- **Shown on the tile**: see "PR rows" under "Tile faces": when someone other
  than the author is assigned, the row and the detail pane say so.

## Tile faces: why it's here, status, whose turn

Every tile answers four questions without opening it. All four are derived in
core (pure, tested) and come with the tile view model (`TileView.why`,
`.people`, `.turn`; `PrSummary.why`, `.status`, `.openThreads`). The engine
and FakeEngine call the same functions.

**Why it's here** (`whyHere`, `tileWhy` in `why-here.ts`): one code per PR,
the tile shows the most aimed one (order RV, @, AS, RT, @T, AU, CM, FW, ST).

**For whom** (`forWhom`, `tileForWhom` in `for-whom.ts`; 2026-09-28, mockup
ForWhom2 part 1 variant B). The codes still decide; the UI shows words, not
codes. RV, @, AS -> "For you" (honey chip, 4px honey band down the tile's
left edge). A team request on a PR a teammate wrote (`Viewer.teamMembers`)
is "For you" too, whatever the code, while no other teammate approved or
requested changes (a comment alone does not cover it; 2026-09-28,
`reviewRequest` = `team_for_you` in `review-request.ts`). RT, @T -> "For <team slug>" ("For team-devex", sea chip and
band), the slug from the pending team request, else the timeline request,
else a team mention. AU, and any PR the viewer wrote even with a CODEOWNERS
team request on it -> "Your PR" (neutral chip, neutral grey band). CM, FW,
ST -> no chip, no band. A PR whose author addressed your changes (see
whose turn) is "For you" whatever its code. A tile takes the most aimed of
its PRs (you, team, own). PR rows in multi-PR tiles (and the detail pane's PR list) show the
same words as a small chip without a band, only when the row's differs from the tile's
(2026-09-29). The chip's tooltip keeps the
long why-here reason. The table below is still the rule behind it.

| code | meaning | from |
|---|---|---|
| RV / RT | review asked of you / your team | `review_requested`: a pending request names the viewer or one of `Viewer.teams`, else the newest timeline request does, else RV |
| @ / @T | mentioned you / your team | `mention` / `team_mention` |
| AS | assigned | `assign` |
| AU | you wrote it | `author`, or a passive reason on the viewer's own PR |
| CM | you took part | `comment`, `state_change` |
| FW | following | `subscribed`, `manual`, `ci_activity`, `other` |
| ST | stack context | pulled in |

**PR status** (`prStatus` in `pr-status.ts`): lifecycle (open, draft, queued
while the newest merge-queue timeline entry is an add, merged, closed) and review
from `reviewDecision`. Merged and closed PRs drop review, drafts drop review.
No checks (2026-09-29, see "CI is not a signal"). Open threads = unresolved
review threads.

How it shows (2026-09-29, design 3a; `LIFECYCLE_WORDS`, `reviewWord`,
`rowStateWord` in the renderer's `lib/pr.ts`): the lifecycle is a
GitHub-style icon (open: green pull request, draft: dashed grey circle,
merged: purple merge, closed: red closed pull request, queued: amber pull
request), words in its tooltip. The review state is an icon + word: "Needs
review" (eye, honey), "Approved" (green check; "Approved by agent" when only
agents approved), "Changes requested" (red). On a PR row drafts show an
outlined "DRAFT" chip with a pencil and merged / closed PRs show the colored
word ("Merged" purple, "Closed" red) in place of the review. State colors
stay on done tiles; only titles and counts go grey. **CI shows only in the
detail pane's facts** ("Checks"): not on rows, tiles, the detail state line
or the RISK box, and not in whose turn or any agent text (see "CI is not a
signal").
The Checks fact itself is neutral (2026-09-29): a grey bar (passing a notch
darker than the rest) and "12 checks · 2 not passing" (failed and running
together; "all passing" at none) in the normal muted text, no pass or fail
colour. The Size fact next to it draws deletions (count and bar) in their
own diff red (`--diff-red`), never coral: coral stays for "new".

**PR rows** (`PrRow`): state icon, the coral dot for a PR that keeps
the tile from being done ("Not done yet", see below), mono number, the stack mark for a stack layer ("1/3", see
"Stacks as one unit"), bold title, (for-whom chip when it differs, repo
label), then the state word, open threads (bubble + count) and the author's
avatar. When someone other than the author is assigned (2026-09-30, an agent
PR a bot opened for a person, see "PR ownership"), "assigned to" follows in
quiet grey with each assignee's avatar and login, at most two and then
"+N", every name in the tooltip (`assigneeLine` in the renderer's
`lib/assignees.ts`, `AssignedTo`); the detail pane shows "opened by
<author> · assigned to <assignees>" under the branch line. A single PR sits in a white bordered box and its row leaves the
title out (2026-09-29: the tile's heading already is the title; the row's
tooltip keeps it); a stack or set's rows sit in one tinted rounded box, the
selected row highlighted, drafts and closed layers on a grey row.

**The not-done dot** (2026-09-29, core `notDonePrKeys`, shipped as
`TileView.notDonePrKeys` since 2026-09-30; replaced "the new dot" of the same morning, which only
showed on unread tiles for PRs with unseen news, see "Actions act on what
you look at"): on an unread or open tile every tracked PR that keeps the
tile from being done gets a small coral dot before its number, in the
tile's rows and the detail pane's PR list (aria-label "Not done yet"):
`PrSummary.done` false (core `isPrDone`, shipped per row), or an unseen
loud event left (that keeps the tile unread, so not done either). A
pulled-in stack layer gets one while it has unseen loud news, which makes
the tile unread too (2026-09-30; before, such a tile was unread with no dot
anywhere). Done and snoozed tiles show none, and neither does a tile where
only one PR can hold it (the dot would only repeat the tile's state). Mark a
dotted PR done in the detail pane and its dot goes; no dots left, the tile
is done. It is the one coral mark that is not "new since you looked"; there
is no second, read-only dot. History: a six-PR set once stayed unread
because of one old "ready for review" and nothing showed which PR, which
gave the first dot; an open set that never said which PR held it gave this
one.

**Tile header**: for-whom chip, the kind ("PR" in grey text; layers icon +
"Stack · 2"; dashed square + "Set · 3"; blue only while selected), the
verdict pill with an icon ("Look closer" ring-dot on a honey ring, "Looks
safe" check, "Not yours" dash, dashed "No glance yet"; a stale glance adds
"· out of date", or "· updating" while a sync or catch-up runs, see
"Out of date wording"), then avatars and age
on the right. Then the title, the agent's one-to-three-line take, the PR
rows and the footer.

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
3. On your own PR:
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
4. On someone else's PR:
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
     on hold (`teamRequestHold`, 2026-09-29). While your own changes request
     stands (you were asked again after it and only commented since) the
     same request is a re-review: "Re-review, ada asked", move `re_review`,
     matching the tier Changes you requested (2026-09-30,
     `viewerRequestedChanges`). That holds with or without a push: without
     one your review of the head still stands, but GitHub drops a reviewer
     from the requested list once they review, so a pending personal
     request after it is the author's re-request, and an explicit
     re-request means "look again" (2026-09-30).
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
  still your move gets no mark button: Snooze is the primary (ink) button,
  with its usual menu, and a quieter "Review on GitHub" opens the files tab
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
  your approval are quiet everywhere), so neither makes the tile unread or the
  topic urgent. Mark-ready (`ready_for_review`) is loud when a review of you
  or your team is pending or was asked ("ready for your review"), which
  brings the PR back as reviewable.
- pings (`isAddressedToViewer`): drafts ping only for a personal question,
  mention or reply.
- UI: a tile whose open tracked PRs are all drafts gets a grey "Draft" chip,
  a dashed frame (a dashed left band when it has a for-whom band) and a
  muted title; the row's DRAFT chip already says so.

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
  tile's `tileFooterAction`): the one ink button, placed first, is Approve
  while it is due (someone else's open PR, not approved, not a draft), else
  on a single-PR tile the tile footer's Mark read / Mark done / Snooze, or
  Open on GitHub on a done tile; on a stack or set the selected PR's Mark
  read / Mark done, else Open on GitHub (see "After a mark-read"). "Approve again" and "Approve draft" stay outlined next to it.
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
  says you already approved and whether commits came after; no ink, no nag.
  It wins over draft. Else "Approve as well" when others approved and you
  never did. Drafts get an outlined "Approve draft"; draft wins over "as
  well", since not-ready is the bigger caveat and the review glyph already
  shows the approvals.
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

- New events are the unseen loud ones, the same ones that make the tile
  unread. Quiet bot, CI and other events never change the text or the count.
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
`Meta.TeamMembers`): every other login on the viewer's teams, from REST
`GET /orgs/{org}/teams/{slug}/members` (all pages, ETag per team), kept in
meta `team_members` and put on the stored viewer. Refreshed during sync at
most once a day, or when the viewer's teams change. A team the token cannot
read counts as empty; a failed refresh keeps the last list and never fails
the sync.

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
teammate is a review, not "Team's PRs". A teammate's PR whose team request
another teammate covered stays `team`; routed team requests stay
`to_review` after the authorship checks. Inside To review the topic column
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

Grid: `clamp(248px, 22vw, 330px) | clamp(420px, 33vw, 480px) | 1fr`. At
1440px that is about 317 | 475 | 648, at the 1100px minimum 248 | 420 | 432.

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
  labels (Routed to you, FYI, Finished), "Earlier activity", empty-state
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
  Box 1 is titled with the verdict ("LOOK CLOSER · for you", honey; "LOOKS
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
  the open one boxed in accent, with the coral not-done dot where it applies.
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
  more"; the quiet bot and CI events since the touch fold into one line
  (`activity.freshNoise`, `noiseSummary`: "10 bot comments, CI") that
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
  (`ACTIVITY_LINE_CAP`) before "Show all N". Bots, CI, deploys, merge queue,
  agent-muted events and review requests between others fold into one "N
  bot/CI events" line that expands (Unmute lives there).
  Comments and reviews from people show in full (2026-09-29): the event
  `summary` is one clipped line (100 chars, first line) for tiles, MCP and
  the agent, so `activityList(events, viewer, since, pr)` also puts the
  whole text on the line as `body`, read from `pr.comments` / `pr.reviews`
  by the event's `sourceId`. The row shows the lead ("lyra commented") and
  the body under it, wrapped, line breaks kept, never clamped. Bots keep
  the one-line form; so do agent-muted people in the folded line.
- **Resizable**: the two edges (sidebar | tiles, tiles | detail) are draggable
  (`PaneDivider`, pointer capture, a 12px invisible hit area, col-resize
  cursor). Limits: sidebar 200-440px, tile column 340-720px, and a drag never
  leaves the detail pane under 360px. Double-click an edge to go back to the
  clamp above, which stays the default. Dragged widths are kept per viewer in
  localStorage (`postpile.paneWidths.<login>`, `lib/pane-widths.ts`); a
  blocked storage just forgets them on reload.

### Queue sections

The sidebar lists topics under ghatchup's PR queues (mockup "B with
avatars and filters", QueuesB2).

- **Sections**, in order: Needs reply, Changes you requested, My PRs,
  Team's PRs, To review, Team mentioned (one per `prTier`), then Other
  topics. Each lists topics, not PRs, and **each topic once in the whole
  sidebar** (2026-09-29): in the highest section where it has a PR, with
  that section's count on the row. Other topics holds topics with only
  `rest` PRs; inside it the old groups stay (Needs you, Your team by area,
  Routed, FYI; Routed and FYI folded). The queue filters (Mine, Team,
  Reply, Review) still match a topic by any of its PRs; Review covers To
  review and Changes you requested (the addressed case was To review
  before). Section tint: honey
  for reply, changes and review, ink for mine, sea for team and team
  mentioned, grey for other.
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
  had not touched fell to Team's PRs or Other topics.
- **Authorship**: the viewer's own PR (`prOwners`: also a bot's PR assigned
  to them, 2026-09-30) stays under My PRs whatever area or
  team the code belongs to; only Needs reply ranks above it (as in
  ghatchup). An area is a label for where the code lives and never moves a
  topic between sections.
- **Finished drawer** (2026-09-29): under the sections, a folded "Finished"
  group header lists topics retired in the last 30 days, newest first
  (`GET /api/topics/finished`, `FinishedTopic`: name and how long ago it
  retired, PR count in the tooltip). Quiet on purpose: muted names, no
  bubble, no faces, no count on the header. A row opens the topic like any
  other (`getTopic` and `tilesForTopic` work for a retired topic; the
  breadcrumb says "Finished"). Search and the queue filters cover live
  topics only, so the drawer hides while they narrow. Hidden when empty.
- **Counts** come from `TopicListItem.queues` (`topicQueues` in core): PRs
  per tier over the PRs in the topic's tiles (each PR once), plus open PRs
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
- **Urgency** (`topicUrgency` in core): a topic needs you when an unread
  tile still has an open PR, or whose-turn says it's your move on a live
  (not done, not snoozed) tile and that move is more than "Merge, it is approved" on your own PR
  (`isMergeApprovedMove`). That move still shows on the tile footer and in
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
  search. In the open topic, matching tiles get the warm strip fill and a
  honey line, the rest fade to 45% but stay. Plain UI state, not in the
  back / forward history. The avatars come from `GET /api/viewer`.
- **Selection stays put**: what the user picked stays on screen until the
  user navigates. An approve, mark-read, refetch, live poll or sync never
  moves it, even when the open topic then leaves the queue filter or the
  search, or the open tile turns read or done. The "first match" fallback
  only runs when the user picks something or changes a filter (the queue
  filter, or the search once its new results are in), or when the pick is
  really gone (topic deleted or merged). Meanwhile the open topic stays
  listed in the sidebar in its normal place, the open tile stays in the
  grid (search matches, the Unread list, the Done fold opens for it), and
  a tile id that disappears (set regrouped, PR left a stack, single to set)
  is followed by its picked PR to the tile that holds it now. None of this
  adds history entries. Why: after an approve the user often moves on to
  the next tile they had in sight; a jump to "the next best item" loses
  their place (2026-09-29). Pure rules in `lib/selection.ts`.
- **Nothing is selected until there is something to look at**: when a
  topic opens or a filter changes and the user has not picked a tile, the
  app selects only an unread tile (the first in tier order); under the
  grid's All filter, else the first open one; never a snoozed or done
  tile. Under Unread with nothing unread it selects nothing, and the right
  pane says "No tile selected" with one line ("Nothing unread in this
  topic. Pick a tile, or show All."; under All "Pick a tile to see it.").
  A tile the app picked is not the user's pick: it is not written into
  history.
  Changing the All / Unread filter under an app-picked tile picks again
  (All to Unread drops an auto-picked open tile, then the first unread or
  "No tile selected"). When an app-picked tile changes state while it is
  shown (read or done through a sync, the move-on mark), it stays in the
  pane and counts as the user's pick from then on, so the grid keeps it
  too: pane and grid never disagree, and it drops out once the user moves
  on. The keep-visible rule above stays for tiles the user selected. Why: "we
  should rather not select any tile and show 'none selected' on the right
  ... then when collapsing all 'done' and having selected 'unread' it would
  actually make sense" (2026-09-29). Pure rules in `lib/selection.ts`
  (`autoTile`).
- **Topic column**: the whole topic, tiles sorted by `TileView.tier` (the
  most urgent tier among its PRs), needs reply first, rest last; inside a
  tier the old order (unread before open; a read tile that is still your
  move stays with the unread ones, `tileListRank`). Single column as before.

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
  search and the Mine / Team / Reply / Review filters without renderer
  logic.
- **Opened topic**: always every tile across repos, never filtered or
  faded by repo. A tile whose PRs all sit in another repo than the chosen
  one (or, under "All repos", the topic's main repo: most PRs, first seen
  on a tie, `mainRepoOf`) gets a small neutral repo label; a set mixing
  repos gets it on each PR row from another repo instead
  (`tileRepoLabels`, `TileView.repoLabel`, `PrSummary.repoLabel`). The
  label is the short name (`infra`, `docs`) when the org is one
  of the viewer's team orgs (`viewerOrgs`, falling back to the base repo's
  org), else `owner/name`.
- **Menu rows**: each repo with its topic count (PR count in the tooltip),
  counted over every topic so the menu does not shrink while narrowed; the
  "All repos" row counts every topic with PRs. A repo the settings name
  but with no PRs left still shows with 0, so it can be picked away from
  or woken up.
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
| subscription on the PR itself | GraphQL `updateSubscription(subscribableId, state: SUBSCRIBED/UNSUBSCRIBED/IGNORED)` ([docs](https://docs.github.com/en/graphql/reference/mutations#updatesubscription)) | Per issue/PR/repo, not per thread. Future notifications only. |
| mark a thread **unread** | none | No REST endpoint. The public GraphQL schema has no notification type and no notification mutation at all (the ones github.com uses internally are not exposed). |
| "Saved" notifications | none | Neither REST nor GraphQL can list or set them. `GET /notifications?all=true` only adds read threads. |

So nothing brings a read thread back on GitHub. Re-subscribing does not
help either: marking read never unsubscribes, so a thread that was only read
is still subscribed.

**The lock.** GitHub writes are a runtime switch (`WriteSwitch` in
engine `writes/`), off (read-only) on first run, flipped by the lock in the
status footer (`POST /api/github-writes {enabled}`), kept in meta
`github_writes` so it survives restarts. While off the switch hands out the
`ReadOnlyWriter`, so a path that forgets to ask still cannot write.
`POSTPILE_READ_ONLY=1` never builds the real write client; the lock
then shows disabled with the reason and turning it on answers `ok: false`.
Opening the lock asks in a popover ("Mark-read and approvals will reach
GitHub"); closing is instant. The UI guard follows it: approve and comment
are blocked while locked (no pending queue for them), mark read and "not
mine" run and become pending writes. `CODE_MANAGER_ALLOW_WRITES` is gone.

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
or discarding pending writes, `cleanup` = the inbox cleanup, `quiet` =
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
anything read. There is no CLI write. The only "mark all read" is the inbox
cleanup, a deliberate choice in its dialog ("Inbox cleanup and start fresh").

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

## Inbox cleanup and start fresh

Old unread threads pile up on GitHub (a first run on a busy account, a
vacation). Rules in core `inbox-cleanup.ts`, engine `InboxCleanup`
(`actions/inbox-cleanup.ts`), `GET /api/inbox-cleanup`.

- **Counts**: stored threads unread on GitHub with `updated_at` older than
  14 and 30 days (`unreadOlderThan`), leaving out threads before the
  start-fresh baseline.
- **Where**: with a count > 0 the sidebar footer shows a quiet line "N
  unread older than 14 days · Clean up". On the first run, or when a full
  sync starts 5+ days after the previous one (meta `last_sync_started_at`;
  an older store falls back to its newest PR fetch), the cleanup is
  prominent (meta `inbox_cleanup_prominent`): a banner at the top of the
  middle column instead of the line, until the user picks anything in the
  dialog. The server sends `look` (`banner` / `line` / `none`).
- **Dialog** (`InboxCleanupDialog`):
  - "Mark everything older than 14 / 30 days read on GitHub": one
    `PUT /notifications` with `last_read_at` = the cutoff
    ([docs](https://docs.github.com/en/rest/activity/notifications#mark-notifications-as-read)),
    through `GitHubWrites.markAllReadBefore`, logged `mark_all_read_before`
    (origin `cleanup`). Locked, it becomes one pending write
    (`pending_write.kind = 'mark_all_read_before'`, `read_before`,
    migration 013), listed in the lock popover with the unread count it
    covers; Send / Discard work like for mark-reads (origin `footer`).
    GitHub may answer 202 and finish later, so the engine runs one poll
    cycle right after; threads leaving the inbox then go through the normal
    reconciliation (their read time from the read list or a thread lookup).
    Nothing changes in the app before GitHub reports it.
  - "Leave GitHub alone, start fresh here": meta `start_fresh_baseline` =
    now. Events before it read as seen (`applyBaseline`, applied in
    `Board.load` and FakeEngine, not stored, so clearing brings GitHub's
    state back), "since you last looked" never starts before it
    (`seenSinceBaseline`, and `countSince(..., notBefore)`), and threads
    before it leave the counts. Nothing is written to GitHub. The dialog
    shows "Started fresh on <date> · Clear it".
  - "Not now": hides line and banner for 7 days (meta
    `inbox_cleanup_hidden_until`).
- **Fake mode**: three old unread sample threads (16, 22, 45 days), the
  banner on every start, pending and send handled by `FakeWrites`.

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
Merging or closing counts only when the viewer did it.

1. *Tile*: every event before the viewer's last touch counts as seen by the
   rules. This generalizes two narrow rules that already existed (a review
   request turns quiet once the viewer reviewed after it, an ask once they
   replied after it); "ready for review" was the case they missed.

   Built like "Reconciling with GitHub's read time", not as a second derived
   rule: the engine marks every event up to and including the touch seen in
   the store, stamped with the touch time (core `eventsSeenByTouch`), each
   time a PR snapshot is stored (sync and poll, so the poll never pings for
   them) and once per full sync over every stored PR (events stored before
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
   thread read again right before, origin `quiet`, grace, at most
   `QUIET_READS_PER_RUN`). Details the build settled:
   - The touch here is a review or a comment (`READING_TOUCH_KINDS`): no
     push, and no merge or close either, for the same reason.
   - "Unread" is every event by someone else after `last_read_at`, or every
     one when the thread was never read. None known: left alone, like the
     bot-only rule.
   - Bots after the touch are fine as in the bot-only rule (CI and the merge
     queue follow most approvals), except on the viewer's own open PR, where
     they can mean work. Once the own PR is merged or closed they are fine
     there too (2026-09-29, "Own merged PRs clear on GitHub too" in "Actions
     act on what you look at"). The grace counts from the newest of the
     touch, those bots and the thread's update.
   - The tile must not be unread. Whose turn is not checked: every event
     before the touch is seen already (part 1), so the mark-read changes
     nothing PostPile shows, and a move that is still the viewer's (their
     approved PR, "Merge") stays on the tile.
   - Log details "you approved after it", "you requested changes after it",
     "you reviewed after it", "you replied after it" (the newest touch);
     `QuietReadView.reason` carries it to the view.
3. *Opening a PR in PostPile*: opening a PR in the detail pane marks its
   GitHub thread read and handles the PR in PostPile too (events seen,
   `handledAt`; since 2026-09-29, before it only marked the thread read),
   only when a mark-read of that PR would leave it done
   (`PrSummary.afterRead.done`: nothing asked of the viewer; checked per PR
   since 2026-09-29, before it was the whole tile's `afterRead.done`), no
   tile holding it is snoozed, and only while writes are unlocked. It
   mirrors what github.com does on a visit, limited to cases where it
   cannot hide a to-do. Also listed under Handled quietly ("opened in
   PostPile") when the thread was unread on GitHub. A visit on github.com
   keeps its old effect (events seen, no `handledAt`): PostPile cannot
   check the conditions at the moment of the visit.

   Built as `POST /api/prs/:owner/:repo/:number/opened` ->
   `EngineService.markOpenedRead` -> `QuietReads.markOpened`, with the rule
   in core `openedReadCheck`. Details the build settled:
   - "Opened" means the PR stayed in the detail pane for 1.5s
     (`OPENED_READ_DELAY_MS`, renderer `useOpenedRead` with
     `OpenedReadTimer`) while the window was visible, so clicking through
     tiles marks nothing. Since 2026-09-29 that only arms the open: the
     mark goes out when the user moves on (another PR or tile, the pane
     closed, the window hidden or blurred), see "Actions act on what you
     look at" › Marked when you move on. Hidden before that, the wait starts over when the
     window is visible again with the same PR open (Codex review on PR #10:
     the open used to be dropped). The first tile
     the app shows by itself counts too: it is on screen. One request per
     open; re-renders and refetches of the same PR send nothing.
   - The renderer asks only when the opened PR's `afterRead.done`, the
     tile is not snoozed and the lock is open (`openedRead` on the
     `GithubWrite` list, blocked while locked, never a pending write); the
     engine checks again (core `openedReadCheck`: a thread, a tile, none
     snoozed, the PR done after a mark-read of it), plus, for an unread
     thread, a snapshot at least as fresh as the thread (the user cannot
     have seen newer activity). A PR only in a finished topic has no tile
     and is left, and so is a PR without a thread (a found PR): nothing on
     GitHub to mirror.
   - A thread GitHub has read already (an earlier open, a github.com visit)
     gets only the PostPile side: the PR is handled, a `local` action log
     row (origin `quiet`, detail "no unread GitHub thread") is written,
     nothing reaches GitHub or shows under Handled quietly. This is the
     case from "Actions act on what you look at": a PR an earlier open had
     read on GitHub still held its set open.
   - The write is the sync's quiet mark-read: thread read again right
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
engine `QuietReads` (`writes/quiet-reads.ts`).

**The rules**, all of them must hold:

1. *Read before, bots since.* GitHub has the thread unread, it has a
   `last_read_at`, and every stored event by someone else after it is
   automation (`event.isBot`, or no actor at all: CI results carry an empty
   actor and are flagged as bots already). The viewer's own events (a
   review from the CLI does not move the read time) are not someone else's
   activity and are left out (2026-09-29; before they blocked the rule). No
   known event by someone else after the read counts as "don't know": left
   alone.
   The stored events only count when the PR snapshot was fetched at or
   after the thread's `updated_at` (`snapshotCoversThread`). A sync
   refreshes every thread but can leave a PR's snapshot stale (its PR cap, a
   failed fetch); a human comment after the snapshot would then be missing
   and the thread would look bot-only (Codex review on PR #5, 2026-09-29).
   Not "fetched in this very sync": a PR fetched while its bot activity was
   still inside the grace period is not fetched again until it moves, and
   the snapshot from then still covers the thread.
2. *Not the user's own open PR.* Bot reviews and CI on your own PR can mean
   work (a failing check, a review bot's finding), so they stay unread while
   it is open. A merged or closed own PR is fine (2026-09-29: every own PR
   merges through trunk after the last comment, so 14 merged own PRs stayed
   unread after 0.10.0).
3. *No unseen merge without the user's review* ("Merged without your
   review", rule 5: PostPile never marks those read by itself). Checked on
   its own, since a merge queue bot merging counts as bot activity.
4. *Nothing asked of the user.* The PR's tile is not unread (any PR of the
   tile) and whose turn (`prWhoseTurn`, with the glance's NOT_YOURS as the
   tile reads it) is not `you`.
5. *Grace.* 10 minutes (`QUIET_GRACE_MS`) after the newer of the newest
   bot event and the thread's `updated_at` (a bot push can carry an older
   commit date), so a person answering the bot right away still counts.
6. *Lock open.* Only while GitHub writes are unlocked. Locked, nothing
   happens and nothing piles up as a pending write.

**Where it runs**: at the end of every full sync (start, "Sync now", the
hourly auto sync), after the digest and the retire step. The full sync has
just fetched the inbox and every moved PR, so threads, events and read times
are fresh, and the hourly auto sync is also what comes back once a grace
period ran out. The live poll only fetches what moved and would need its own
timer for the grace, so it is left out. At most 50 threads per sync
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
"opened in PostPile"; the other reasons are in "You already dealt with it")
and when (`GET /api/handled-quietly`,
`EngineService.handledQuietly`, read from the action log). A click opens the
tile when one holds the PR. Quiet on purpose: no coral, the count is faint
mono. The notifications debug view shows the same entry as the row's last
action. They count toward the hourly `pings_summarized` telemetry
(`handled_quietly`).

**History**: the idea was parked on 2026-09-29 when "merged, nothing new"
(mark merged PRs read when nothing happened since) turned out to hide
merges Julian wants to see (see "Merged without your review"). Bot-only
activity since the last read is the safe case: the user already read
everything a person said, and what came after can't ask them anything. Own
open PRs are excluded because bot reviews there can mean work; merged or
closed ones are not (2026-09-29).

**Fake mode**: seven sample quiet mark-reads in the action log (two for
"you acted after it", one older than 7 days, so it stays out of the view)
and sample ping decisions
(`fake-quiet.ts`); the fake poll's decisions are kept too.

## Live poll and Mac pings

Near-real-time pings on the Mac, only when they matter. Runs while the desktop
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
`poll_fetched_since_sync`). Never marks anything read (on GitHub or locally,
beyond what the full sync already does for threads that left the inbox).

**Decision** (`PingDecider`), one per PR thread with new events, rules first:

- Only unseen events from this poll and at most 30 minutes old
  (`PING_FRESH_MS`) count; the first look at an empty store is a baseline and
  decides nothing.
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
  or a bot. It never pings from the poll and never reaches the agent; it
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
  may veto or rephrase, never add. The call takes seconds, so right before a
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
  a click opens the first).
- Native `Notification` with sound. A click shows and focuses the window and
  sends `postpile:open-ping` with `{topicId, tileId, prKey}`; the renderer
  navigates through `go()`, so it is a normal history entry.
- Closing the window hides it on macOS and the app keeps polling; Cmd+Q quits
  (flushes mark-reads as before). Dock click shows the window again.
- macOS asks for permission on the first notification. Electron cannot read
  that permission, so a denial only means nothing shows up; tiles still turn
  unread. `POSTPILE_MAC_NOTIFICATIONS=0` turns notifications off (the poll
  still runs). A settings toggle and quiet hours are not built yet.
- **Permission at a calm moment**: on the first launch (flag file
  `welcome-notification.json` in userData) the app shows one welcome
  notification ("PostPile will ping you here when something needs you") a
  few seconds after the window shows, so macOS asks for the permission then
  and not on the first real ping. Not stored while notifications are off
  (`POSTPILE_MAC_NOTIFICATIONS=0`), so it comes once they work. "test ping"
  next to the lock in the status footer sends a test notification over the
  preload (`sendTestNotification`, IPC `postpile:test-notification`) and
  says in a toast whether it was shown, off or unsupported. Dev runs are the
  Electron binary and show up as "Electron" in System Settings ›
  Notifications; the packaged app has its own "PostPile" entry, so the
  permission is asked (and set) once for each.

**Dock badge, cleared pings and the bounce** (decided 2026-09-30, desktop
main, `BoardWatcher`):

- The Dock badge (`app.setBadgeCount`, 0 clears it) is the number of tiles
  that are the user's move: live tiles, not done, not snoozed, summed across
  topics in every repo, so it equals what the sidebar's "your moves" chips add
  up to. It is read from `listTopics({ allRepos: true })` (`yourMoves`), no
  rule is repeated in main. It is read at start, after each shown ping, when
  the live status moves (`changeCount`, which also counts every ended sync,
  `catchUpChanges`, `syncRunning`; checked every 5s) and after every non-read API request, which covers local
  actions (mark read, done, snooze, approve). Fake mode shows it too.
- A ping leaves Notification Center once its PR is not held by an unread tile
  anymore (read, done or snoozed in PostPile), through
  `Notification.close()`. `PingShelf` keeps the delivered notifications by PR
  and drops references older than 24 hours; the list of unread PRs comes from
  `unreadPrKeys()`. A summary is kept under its first ping's PR.
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
and the ping decisions, never on the first look at an empty store, not while
the agent is off): a fetched PR with a new event whose effective loudness is
loud, or a PR that should have a glance (open, pinged or found, in a tile)
and has none. Quiet news (bot comments, CI) waits for the full sync. The
topic is the PR's membership; Unsorted (null) counts as one topic.

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
side by side; the runner's limiter (`POSTPILE_AGENT_CONCURRENCY`) caps the
calls.

**Never beside a full sync or consolidation**: a request while one runs is
skipped (the sync covers every topic; the poll is blocked then anyway). A
sync drops queued follow-ups and waits for running runs before it starts,
like it waits for a poll cycle; consolidation waits for them too.

**Caps**: per run `3 + 2 * ceil(glance targets in the topic / 18)` (dossier,
events, reconcile, each glance batch with its retry). On top, a daily cap
over all runs, a rolling 24h window in memory (`CatchUpCap`,
`POSTPILE_CATCHUP_CAP`, default 300; a dev session with
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
(`glanceState` `writing` on the PR, or on any PR of the topic for the
dossier), every note says "updating": the tile's verdict chip "· updating",
the stale verdict box "Updating now: a new assessment is being written.",
the dossier's "Updating now: 3 newer events.", a stale memory badge
"updating · PR moved since" and its "Why?" check "Updating now: PR moved
since" (the topic's or PR's updating state is passed into `MemoryLine`,
`WhyPanel` and `checkLabel`, not read from the sync alone), the live footer
"paused while syncing". When nothing runs: "out of date" ("· out of date",
"Out of date: 3 newer events not in the dossier yet.", "Out of date: PR
moved since" in "Why?"). "Stale"
and "Sync to refresh it" are gone from the UI.

**Refresh**: `LivePollStatus.catchUpChanges` grows on every queue, start and
end; `useLivePoll` refetches everything when it moves, so a tile flips from
"Writing" to its verdict within the 5s status poll.

**Fake mode**: `FakeCatchUp` walks the first sample PR without a glance
queued -> writing -> ready (4s + 6s) once the renderer first reads the live
status, and marks the second one failed so Retry can be tried.

## Auto sync

A full sync every `POSTPILE_AUTO_SYNC_MINUTES` (default 60, 0 off; the
default is off with `POSTPILE_SYNC_ON_START=0`, so no-traffic runs stay that
way) while the desktop app runs. `AutoSyncSchedule` lives in the engine
(like the work context schedule, on `Timers`), started by main with the
app's sync call cap (`startAutoSync`). The interval counts from the end of
the last sync, whoever started it (`reschedule` on every sync end), so a
"Sync now" pushes it out; at the due time a running sync means skip. The
renderer sees it through `LivePollStatus.syncRunning` (the title bar shows
`syncing · agent 34/82` like for "Sync now", `useActions().syncing` covers
both) and `nextAutoSyncAt` ("next full sync in N min"). The last sync shown
is the newer of this window's and the stored report. Full syncs were
start-only and manual before (2026-09-29). While the GitHub quota is low, a
due auto sync (the backlog follow-up too) waits until the reset instead
(see "GitHub quota").

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
`captureException`, `shutdown`) plus a no-op implementation used whenever
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
topic names are never event props. Uncaught exceptions and unhandled
rejections (main process and server) go through `captureException`, itself
scrubbed to the error's class name and a stack of `file:line` pairs from the
app's own bundle only (`packages/core/src/telemetry-errors.ts`); node_modules
and Node-internal frames, and anything that looks like a path or a URL in the
message, are dropped.

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
3. *Core actions*: `tile_opened`, `pr_approved`, `marked_read` (origin
   `tile`, `detail`, `debug` or `cleanup`), `team_request_removed` (no
   props: no PR, no team slug), `snoozed`
   (the condition name for an event-based snooze — someone replies, a push,
   CI green — or a time bucket for `until_time`), `opened_on_github`,
   `ask_sent` (AskComposer's send), `chat_message_sent`, `mac_ping_shown` /
   `mac_ping_clicked`, `pings_summarized` (pinged, withheld_rules,
   withheld_agent, pinged_glance (Look closer on routed reviews),
   handled_quietly: counts since the last summary, from
   `ping_decision` and the action log's `quiet` mark-reads; the engine sends
   it at most once an hour after a sync or a poll cycle, window end kept in
   meta `pings_summarized_at`; nothing when every count is 0, the first call
   only starts the clock; no per-notification events), `search_used` (throttled, query length bucket only),
   `queue_filter_changed`, `topic_opened` (section), `update_pill_clicked`
   (the title bar pill opened) / `update_later_clicked`,
   `glance_retry_clicked` (Retry on a failed glance).
4. *Agent trust*: `wrong_topic_marked`, `not_related_marked`,
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
   during the sync, absent when no answer carried it),
   `catch_up_ran` (topics, always 1; agent_calls, duration_ms, ok: one glance
   catch-up run after the poll), `sync_failed` (error_kind, currently only
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
the running app and with the app closed, and need no port or token
discovery. The data is as fresh as the app's last sync and poll; every
answer says when the last full sync finished, and `pr_context` when the PR
was fetched. The two tools that change something ask the running app
("Agent requests" below). Stdout is the protocol, so `console.log` goes to
stderr (`routeConsoleToStderr`).

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
  with any list cut off is marked truncated, and `snapshotCoversThread` treats
  it as not covering the thread (no bot-only, touched or opened mark-read on
  GitHub for it).
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
(`putBackLocalChange`, reversals rather than reads) and the inbox-cleanup
baseline.

**Handled is not reset by new activity (decided 2026-09-29).** Handled means
"you dealt with this once", not "complete now". New loud activity already
makes the tile unread before done is checked; once seen, done needs no move
left for you. Resetting it would make a GitHub visit or quiet read leave the
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
pane's buttons per PR key); `ActionBar` and `Tile` only lay them out. A done
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
  from the open questions.)
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
  touch, the bots after it, the thread's update). Kept as built.
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
reviews, pushes, readiness, merge or close, CI; thread read state, handled,
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
including dismissed, CI, thread and seen state, snooze kind and phase,
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
activity past the grace gets a quiet read, nothing unseen stays in a
read's scope. Answering is a metamorphic check: a comment by the viewer
clears Reply, the answered-changes Re-review and Needs reply (a re-review
a pending request asks for stays). The generator also makes re-requests
after a changes request, a second outsider (alice), automation without the
[bot] suffix (renovate), pending reviews, review bodies, merge queue and
deploy items, sets that hold a stack and dissolved sets. The property
invariants alone now kill 83% of the rule-file mutants (28% before, at the
same rule code; 300 boards per invariant).

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
  `build/icon.icns`, output `apps/desktop/dist/`. About 290 MB unpacked, 130 MB zipped
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
| `GET /api/inbox-cleanup` | `inboxCleanup()` (old unread counts, look, baseline, pending cutoff) |
| `POST /api/inbox-cleanup/mark-read` `{olderThanDays: 14\|30}` | `cleanUpInbox()` (GitHub write, pending while locked) |
| `POST`/`DELETE /api/inbox-cleanup/start-fresh` | `startFresh()` / `clearStartFresh()` |
| `POST /api/inbox-cleanup/not-now` | `hideInboxCleanup()` (7 days) |
| `GET /api/mcp-connection` | `mcpConnection()` (cached `claude mcp get postpile`, commands, "Not now") |
| `POST /api/mcp-connection` `{from: footer\|setup}` | `connectMcp()` (`claude mcp add`, installed app only) |
| `POST /api/mcp-connection/not-now` | `hideMcpConnect()` |
| `GET /api/repos` | `listRepos()` (repo menu: counts, scope, quiet) |
| `POST /api/repos/scope` `{repo}` | `setRepoScope()` (one repo, null = all) |
| `POST /api/repos/quiet` `{repo, quiet}` | `setRepoQuiet()` |
| `GET /api/debug/notifications?limit=` | `debugNotifications()` (default 200, max 1000) |
| `POST /api/topics/:id/tailoring` `{text, keep}` | `decideTailoring()` |
| `POST /api/proposals/:id` `{accept}` | `decideTopicProposal()` |
| `GET /api/prs/:owner/:repo/:number` | `getPr()` |
| `POST /api/prs/:owner/:repo/:number/approve` | `approve()` |
| `POST /api/prs/:owner/:repo/:number/draft-ask` `{person, intent}` | `draftAsk()` |
| `POST /api/prs/:owner/:repo/:number/comment` `{body}` | `sendComment()` |
| `POST /api/prs/:owner/:repo/:number/opened` | `markOpenedRead()` (opened in the detail pane; `{marked}`: thread marked read or PR handled) |
| `POST /api/prs/:owner/:repo/:number/remove-team-request` `{team}` | `removeTeamRequest()` (final; refused while locked) |
| `POST /api/tiles/:tileId/mark-read` | `markRead()` |
| `POST /api/tiles/:tileId/prs/:owner/:repo/:number/mark-read` | `markPrRead()` (detail pane, one PR) |
| `POST /api/tiles/:tileId/snooze` `{condition}` / `DELETE` | `snooze()` / `unsnooze()` |
| `GET`/`POST /api/tiles/:tileId/chat` `{message}` | `getChat()` / `chat()` |
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
  writes are still off until the lock is opened. `POSTPILE_POLL_SECONDS`
  (default 60, 0 off, never faster than GitHub's X-Poll-Interval), `POSTPILE_PING_CAP` (default 200 per 24h) and
  `POSTPILE_MAC_NOTIFICATIONS=0` tune the live poll. `POSTPILE_CATCHUP_CAP` (default
  300 per 24h, 0 off) caps glance catch-up, `POSTPILE_AUTO_SYNC_MINUTES` (default 60,
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
  `packaged` / `dev` / `cli` / `server`, start time, database; `DataDirLock`, O_EXCL create).
  A second process refuses with "PostPile is already running with this database (pid N,
  kind, ...)": the desktop app shows a dialog with Quit, the CLI and the server exit 1. A lock
  whose pid is dead is stale and taken over. Released on close and on process exit. The CLI's
  read commands take `--read-only` (no lock, no GitHub writes); sync, poll, sweep and
  consolidate refuse it. The desktop app also asks `app.requestSingleInstanceLock()`, so a
  second launch of the same app (same userData) only focuses the first window.

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
    (goal, status, userCares, people) [version, as decided]
  - when "seen" moves: explicit `markTopicSeen` when leaving a topic, or on opening it
    [explicit, the UI calls it when the user leaves the topic]
  - retiring finished topics: automatic behind the deterministic gate (all PRs merged/closed,
    3 quiet days since 2026-09-29, was 14; every tile done) or a proposal like merges
    [automatic on every full sync, reversible]
  - accepted global rules: kept in the database and added to every prompt, or appended to
    instructions.md [database; instructions.md stays the user's own file]
  - fold set grouping into the dossier update to save one call per topic [not yet, sets stay a
    separate job]
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
- **Loudness rules beyond the spec**, to confirm: human team mentions are loud; human reviews and
  comments on the user's own PR are loud; a mention or question drops to quiet once the user
  spoke on the PR after it (and is seen anyway since "You already dealt with it"); loud events on pulled-in PRs also make a tile unread (confirmed 2026-09-30, the layer gets a "Not done yet" dot). Commits after
  the user's approval are quiet unless the agent raises one (decided 2026-09-28).
- **Repo name**: decided 2026-09-28, the app is PostPile (formerly the working title
  `code-manager`). Renaming the repo folder is still open.
