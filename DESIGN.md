# PostPile design

Decisions from the design rounds, tidied. Open points are at the end.

## Product model

**Topics** are agent-maintained clusters of PRs, e.g. "Move CI to Depot". Each
has a stable id, a name, who drives it, the user's role, an agent-written
summary, and *tailoring*: per-topic instructions the user gave through chat,
stored only after the user confirms. Topics are never renamed or merged
silently; the agent files proposals and the user decides.

**Tiles** are the unit of attention inside a topic. A tile holds one of:

- a single PR (`pr:<prKey>`)
- a real stack, derived from git base/head refs (`stack:<bottom prKey>`)
- a set: agent-grouped related PRs that are not stacked in git (`set:<setId>`)

A PR can appear in more than one tile. Tile composition is derived on every
read, never stored.

**Provenance** per PR inside a tile:

- `pinged`: GitHub notified the user (review request, mention, team mention,
  author, subscribed, ...)
- `pulled_in`: a stack layer the sync fetched by branch to complete a pinged
  PR's stack, reason "stack layer below/above #N" (see "Stack completion")

A tile only exists if at least one member is pinged. Provenance is derived from
whether a notification thread exists, so a pulled-in PR that later gets a real
ping becomes pinged without anything having to update it. Sets are agent-grouped
among pinged PRs only; the agent never pulls PRs in.

**Events**: every GitHub activity on a PR becomes an event line. Loudness:

| loudness | effect | examples |
|---|---|---|
| loud | tile becomes unread | mention, review requested, question to the user, new commits after the user approved, merged without the user's review (when instructions care) |
| quiet | dot, no state change | bots, CI, deploys, merge queue |
| muted | hidden as noise, one click to unmute | bot rebase on a draft |
| seen | already read | any of the above after reading |

Rules classify first (`ruleLoudness` in core). The agent may override with a
reason; overrides are stored on the event. `seen` is user state (`seenAt`), not
a classification.

**Tile state is derived, never stored**:

- `unread`: a member has an unseen loud event. The tile says which PR and which event.
- `snoozed`: a snooze is active and its condition is not met yet.
- `done`: every pinged member is done (approved / handled / merged / closed) and nothing loud is unseen.
- `open`: everything else.

**Glance** per pinged PR (pulled-in stack layers get none): verdict
(`LOOKS_SAFE` | `LOOK_CLOSER` | `NOT_YOURS`), `forYou` (one or two sentences
against the user's own instructions), `does`, `risk`, `othersSaid`. Cached by a
hash of its inputs; regenerated only when the PR moves or instructions change.

**User actions**: approve (single press, immediate, no undo), mark read, snooze
(until someone replies | new push | CI green | a time), "ask <person>" (agent
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

**Sync** (the full one) is on demand: "Sync now" and on app start. On top of it
the desktop app runs a fast notification poll with Mac pings, see "Live poll and
Mac pings".
Only unread PR threads whose activity is newer than the stored snapshot's fetch
time get enriched (a thread's `updated_at` runs ahead of the PR's own, so
comparing against the PR would refetch everything). `SyncOptions` exist for
cheap runs: `maxPrs` (newest first, the rest follow on later syncs even after a
304), `maxAgentCalls`, `agentJobs`.

On first sight of a PR, events older than the thread's `last_read_at` are
marked seen: the user already read them on github.com.

Action details:

- mark read: every member's events seen, pinged members handled (tile turns
  done until something loud happens), thread mark-read queued. Undo reverts both.
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

## Memory / agentic digesting layer (v1 base)

**Engine memory (v2)** below replaced the topic summaries, the per-PR glance
calls and the per-PR event calls. Everything else here (instructions,
membership, sets, feedback, overrides, the runner) still works as described.

Everything the agents know persists in SQLite, keyed so it survives restarts
and only recomputes on change.

| what | where | invalidated when |
|---|---|---|
| general instructions | `~/.config/postpile/instructions.md`, in every prompt; absent = none | file edited (part of every input hash) |
| glance | `pr_glance`, latest per PR + `input_hash`, `model`, `dossier_version` | PR snapshot moves (not CI), dossier version, instructions, tailoring, standing rules or feedback on that PR change. Reads recompute the hash and flag a mismatch as `glanceStale` |
| topic | `topic`: name, summary, tailoring, driver, user_role, status | summary mirrors the latest `dossier.summary` |
| topic membership | `topic_membership`: pr -> topic, `assigned_by` agent/user, reason | never automatically; a user assignment is never replaced by the agent |
| topic proposals | `topic_proposal`: new_topic / rename / merge, pending until the user decides | - |
| sets | `pr_set` + `pr_set_member` with combined take and per-member reason; `removed_at` keeps "not related" members | agent regroups; removed members never come back with the rest, a corrected set the agent drops is kept as dissolved |
| feedback | `feedback`: not_mine / not_related / wrong_topic / unmute / tailoring_kept / tailoring_once | append-only; newest 10 per topic go into prompts |
| event overrides | `pr_event.override_*` with reason | kept across re-derivation |
| other agent answers | not cached: topic assignment and event overrides only run for new PRs and events, drafts and chat run on request | - |

Topic assignment: PRs without a topic go to the agent in batches of 20,
together with the list of existing topics (name, summary and dossier brief).
It picks one or names a new topic. **New topics are created directly**
(otherwise a first sync would leave everything unsorted); renames, merges and
splits are proposals only. They come out of the consolidation job and are
filed as pending `topic_proposal` rows (never the same idea twice, so a
rejected rename stays rejected). Nothing produces `new_topic` proposals yet,
since new topics are created directly.
Until the agent has placed a PR it shows up in a virtual **Unsorted** topic
(id `unsorted`, never stored), so `--no-agent` syncs are still usable.

Driver and user role are derived without the agent: driver = most frequent
author among the topic's PRs; role = driver if that is the user, else reviewer
if any PR has a review-request ping, else stakeholder (mention, author, ...),
else watcher.

Sets (`set_grouping`) run per topic with 2+ open PRs; hash = PRs + dissolved
sets + topic feedback, kept in `meta` (`set_grouping_hash:<topic>`). Active
sets are not in the hash, they are the agent's own last answer. A set the
agent keeps under the same title keeps its id (tile id, snooze and chat
survive); sets it drops are deleted; dissolved sets are never brought back.
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
  --setting-sources "" --strict-mcp-config --tools ""
```

with `MAX_THINKING_TOKENS=0` and the prompt on stdin (flags carried over from
ghatchup, where they took a PR summary from ~30s to ~3s). Everything runs on
`sonnet` (`POSTPILE_MODEL`); glances can be switched separately with
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
   layers of the fetched PRs' stacks are fetched by branch (see "Stack
   completion"); their events are logged but not counted as new.
2. **verify pass** (no agent): `verifyFact` on every active fact touching a
   fetched PR (`FactRepo.listActiveTouchingPrs`). `invalidate` outcomes are
   closed right away (a merged PR ends "alice works on #12"); `stale` ones are
   marked and go to the topic's next dossier update as the recheck list.
3. **topics** (`topic_assignment`, batches of 20): as v1, but each offered
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
   without an override logged after the topic's classify cursor. Driven by
   the event log, not by this sync's new ids, so capped batches are not
   lost.
10. The report adds `agentCallStats`, `dossiersUpdated` and `facts` counts.

With a call cap (`--max-agent-calls`) the budget is spent in that order:
topic assignment (everything needs it), dossiers, fact reconcile, sets,
glances, events. Consolidation is
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
- drops muted events, keeps bots (the prompt compacts them to counts)
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

PR state, author, reviewers and CI are **not** stored in the dossier. The
renderer reads them from the current snapshot, so a dossier cannot carry a
stale state line and those parts need no verification.

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
- Q1 Do we keep GitHub runners for release builds? (asked by @carol, PostHog/posthog#41890)
PR timeline, oldest first (state from GitHub now, not from memory):
- PostHog/posthog#41880 merged by @alice: base runner image
- PostHog/posthog#41899 open, CI failing, @alice: move Docker builds
Earlier: ...
Recent changes, newest first:
- 2026-09-19 Docker build PR opened, waits on the image
```

`dossierBrief` (core) is goal + status + driver in 400 chars, for topic
assignment and consolidation, where many topics share one prompt.

**Dossier update prompt** input, in order: the rendered previous dossier
(or "none yet"), the user's context block, member PR state lines, intros of
joined PRs, the new events (short ids `e1..eN`, bots and CI compacted to
counts per PR), left PRs, known facts (short ids `F1..Fn`), stale facts to
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
- Answer: `{"glances": [{prKey, verdict, forYou, does, risk, othersSaid}, ...]}`.
  The outer object is parsed with `glanceBatchOutput`; each entry on its own
  with `glanceBatchItemOutput`. Entries for PRs not in the batch or
  duplicated are dropped. `GlanceBatchResult.missing` = asked for but absent
  or invalid.
- Missing PRs of all first-round batches of a topic go into one retry batch
  (`retryBatch`, attempt 2). Still missing after that: one error line per PR
  in the report; the unchanged hash retries it next sync. A batch whose outer
  JSON does not parse counts all its PRs as missing; so does a runner failure
  (timeout, process error), which the engine catches per batch.
- `glanceItemInputHash` per PR: v1 snapshot fields, provenance, topic name,
  **dossier version**, instructions, tailoring, standing rules, feedback on
  that PR, model. Never the other PRs in the batch. Stored glances get
  `dossierVersion`.
- Model: the glance model (`sonnet` by default, `POSTPILE_GLANCE_MODEL`).

### Consolidation ("sleep-time")

`consolidate(options)` on EngineService, CLI `consolidate [--if-due]
[--max-agent-calls n]`, and the desktop app calls it with `onlyIfDue` after
a sync once the user has been idle for a while. Due = 24h since the last run
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
| `finished` | topic retired only if the deterministic gate also holds: every member PR merged or closed, no events for 14 days, no unread or snoozed tile. Retiring is reversible |

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
- Calls are only counted by the observer (`AgentCallLog`); the budget only
  records skips. Chat and draft calls get run id `action`.

### EngineService and HTTP additions

| route | engine call |
|---|---|
| `GET /api/topics/:id` | `getTopic()` now carries `dossier: DossierView` (dossier, flags, stale claims, `changesSinceSeen`, `eventsBehind`) |
| `GET /api/prs/:owner/:repo/:number` | `getPr()` now carries `facts: FactView[]` |
| `GET /api/facts?entity=person:alice&since=...` | `listFacts()` |
| `GET /api/proposals` | `listProposals()` (topic + rule proposals) |
| `POST /api/rule-proposals/:id` `{accept}` | `decideRuleProposal()` |
| `POST /api/topics/:id/seen` | `markTopicSeen()` |
| `POST /api/consolidate` `{onlyIfDue, maxAgentCalls}` | `consolidate()` |

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
`created_at`. The file stays the source of truth. `InstructionsHistory`
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

## Stack completion

Pulled-in PRs exist only to complete stacks, and finding them is
deterministic: no agent call.

- After the fetch, every pinged PR fetched this sync walks its stack by
  branch: the layer below has the PR's base as its head, the layer above has
  its head as its base (`GitHubReader.findPrsByBranch`, read-only GraphQL,
  30 lookups per query, one query round per layer). At most 6 layers each
  way (`STACK_DEPTH`). Only open layers and ones merged in the last 14 days
  (`MERGED_LAYER_DAYS`) count; forks and closed PRs never do; a head lookup
  on the repo's default branch ends the walk. A walk stops at a PR with a
  thread: that one is pinged and walks its own stack when it is fetched.
- Found layers go to `pr_pull_in` (migration 006) with the anchor PR and
  the reason "stack layer below/above #N". A layer is refetched only when
  the lookup shows its `updatedAt` moved.
- A layer gets no topic assignment, glance, dossier or event call and no
  membership. It shows in the topic of its anchor (`Board.topicIdOf`)
  through the stack tile, and never makes a tile on its own. Once it gets
  its own notification it is pinged like any other PR.
- `buildStacks` keeps layers merged in the last 14 days (given the time),
  so a merged lower layer still shows at the bottom; a stack needs at least
  one open PR.
- `SyncReport.prsPulledIn` counts the layers fetched. A failed lookup is an
  error line in the report; the rest of the sync goes on.

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
142 PRs): the prompt shows member counts and asks for existing topics
first, a new one only for 2+ PRs or a clear new initiative, `unsorted`
otherwise; at most 5 new topics per sync. Unsorted PRs are offered again
after the next consolidation.

## Tile faces: why it's here, status, whose turn

Every tile answers four questions without opening it. All four are derived in
core (pure, tested) and come with the tile view model (`TileView.why`,
`.people`, `.turn`; `PrSummary.why`, `.status`, `.openThreads`). The engine
and FakeEngine call the same functions.

**Why it's here** (`whyHere`, `tileWhy` in `why-here.ts`): one code per PR,
the tile shows the most aimed one (order RV, @, AS, RT, @T, AU, CM, FW, ST).

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
while the newest merge-queue timeline entry is an add, merged, closed), review
from `reviewDecision`, checks from the rollup. Merged and closed PRs drop
review and checks, drafts drop review. Open threads = unresolved review threads.

**People** (`tilePeople`): authors, the viewer if they submitted a review,
other reviewers (submitted, then requested), four at most, bots only as
authors.

**Whose turn** (`whoseTurn` in `whose-turn.ts`): `{ kind: 'you' | 'them' |
'none', who, what, prKey }`. Rules per pinged PR, first match wins:

1. merged or closed: none.
2. you: a human mentioned you, your team, replied to you or asked you a
   question, and you have not commented or reviewed since ("Answer ada's
   question"; with a pending review of yours: "Review, lyra mentioned you").
3. On your own PR:
   - you: unresolved threads whose last comment is someone else's ("Answer 3
     threads from mira"), else a standing change request ("Address ada's
     changes"), else failing CI ("Fix failing CI").
   - them: the first pending reviewer, user before team ("sol to review").
   - you: approved and not a draft ("Merge, it is approved"). Not in the
     first rule list; added so an approved own PR does not read as nothing.
   - else none.
4. On someone else's PR:
   - you: commits landed after your approval and you have not reviewed the
     new head ("Re-check 2 commits"). The app's approval record wins, a
     github.com approval of an older head counts too.
   - you: a review is requested of you, or of your team while nobody but
     the author reviewed yet, and you have not reviewed the head ("Review,
     rowan asked", "Review for team-devex").
   - them: you approved the head: the author "to merge". You commented or
     requested changes on the head: the author "to address 2 threads" (open
     threads you started), "to address your changes" or "to reply".
   - them: a team request someone else picked up: the author "to merge" when
     approved, else that reviewer "is reviewing".
   - else none (following, subscribed, took part earlier).

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
(a human mention, question or reply the viewer has not answered, same
check as whose-turn), `mine`, `team` (author in `teamMembers`),
`to_review` (review asked of the viewer or their team, head not reviewed),
`team_mentioned` (thread reason or a stored team_mention event), `rest`.
Pure and tested; the sidebar's queue sections are built on it.

### Three-pane balance

Grid: `clamp(248px, 22vw, 330px) | clamp(420px, 33vw, 480px) | 1fr`. At
1440px that is about 317 | 475 | 648, at the 1100px minimum 248 | 420 | 432.

- **Sidebar rows**: see "Queue sections" below.
- **Middle column**: one tile wide, tiles never sit side by side, so the
  selected tile's notch always points at the detail pane.
- **Detail pane**: takes the remaining width.

### Queue sections

The sidebar lists topics under ghatchup's PR queues (mockup "B with
avatars and filters", QueuesB2).

- **Sections**, in order: Needs reply, My PRs, Team's PRs, To review, Team
  mentioned (one per `prTier`), then Other topics. Each lists topics, not
  PRs: a topic sits in every section where it has at least one PR of that
  tier, with that count on the row. Other topics holds topics with only
  `rest` PRs; inside it the old groups stay (Needs you, Your team by area,
  Routed, FYI; Routed and FYI folded). Section tint: honey for reply and
  review, ink for mine, sea for team and team mentioned, grey for other.
- **Counts** come from `TopicListItem.queues` (`topicQueues` in core): PRs
  per tier over the PRs in the topic's tiles (each PR once), plus open PRs
  by you / by a teammate. Only open PRs get a real tier; merged and closed
  ones are `rest`.
- **Pulled-in stack layers** (provenance `pulled_in`, no tile holds them
  pinged; `pingedPrKeys`) sit outside the tiers: they add to no section, no
  queue count and no filter count, their `PrSummary.tier` is `rest`
  (`memberTier`) and filters never match them. They stay on their stack
  tile as context.
- **Rows**: name, unread mark, face stack, the section's count, then a
  one-line summary with a honey "N your move" chip at its end, right under
  the count (`yourMoveTiles`: live tiles where whose-turn says it's your
  move, merging your approved PR included). At 1100px row one has no room
  for the chip, so the summary truncates first and the chip stays. Faces are `TopicListItem.people` (`topicPeople`):
  authors, reviewers (submitted, then requested) and commenters, no bots,
  you and your team first with a sea ring, four at most then "+N".
- **Urgency** (`topicUrgency` in core): a topic needs you when an unread
  tile still has an open PR, or whose-turn says it's your move on a live
  tile and that move is more than "Merge, it is approved" on your own PR
  (`isMergeApprovedMove`). That move still shows on the tile footer and in
  the chip count, it just doesn't make the topic urgent. Only then is its unread mark a coral dot and does it rank as
  `needs_you`. When every unread tile is merged or closed the row shows a
  grey dot and count ("merged since you looked") and ranks below the urgent
  ones (`compareTopicUrgency`: needs you, then open unread tiles, then any
  unread). Tiles still show unread as before.
- **Filters**: Mine (your avatar), Team (up to three teammates), Reply,
  Review, each with its PR count over all topics. One at a time, a second
  click clears. A filter keeps topics with a matching PR (Mine: open PR you
  wrote; Team: open PR a teammate wrote; Reply / Review: that tier) and
  drops sections left empty. It narrows together with the title bar
  search. In the open topic, matching tiles get the warm strip fill and a
  honey line, the rest fade to 45% but stay. Plain UI state, not in the
  back / forward history. The avatars come from `GET /api/viewer`.
- **Topic column**: the whole topic, tiles sorted by `TileView.tier` (the
  most urgent tier among its PRs), needs reply first, rest last; inside a
  tier the old order (unread before open). Single column as before.

### Notification debug view

A read-only look at the raw stream, for checking the sorting. Sidebar
footer "Notifications" (debug) opens a pane over the middle and detail
columns: the stored `notification_thread` rows newest first (repo#number,
title, subject type, reason, GitHub's unread flag, updated) and where each
landed (`NotificationLanding`: tile with topic, or not a PR / PR not synced
/ no topic / topic hidden / no tile). Filters: reason, unread only, text.
A click jumps to the tile through `go()`, so Back returns to the list;
without a tile the row says why inline. The chevron shows the PR's five
newest stored events. Opening a row never marks anything read; the row's
"Mark read" button and its last logged action are described in "GitHub
writes: lock, action log".

## GitHub writes: lock, action log

**What GitHub can and cannot do** (scouted 2026-09-28 with read-only calls
only: the REST docs and a GraphQL schema introspection,
`gh api graphql -f query='{ __schema { mutationType { fields { name } } } }'`,
261 mutations):

| want | API | notes |
|---|---|---|
| mark a thread read | REST `PATCH /notifications/threads/{id}` ([docs](https://docs.github.com/en/rest/activity/notifications#mark-a-thread-as-read)) | 205 Reset Content. The app's only notification write today (`GitHubWriteClient.markThreadRead`). |
| mark a thread done | REST `DELETE /notifications/threads/{id}` ([docs](https://docs.github.com/en/rest/activity/notifications#mark-a-thread-as-done)) | 204. Removes it from the inbox for good (also from `?all=true` listings). Not used. |
| subscribe / ignore a thread | REST `PUT /notifications/threads/{id}/subscription` `{ignored}` ([docs](https://docs.github.com/en/rest/activity/notifications#set-a-thread-subscription)) | `ignored: true` mutes future notifications until you comment or get @mentioned. Changes future pings only, never read state. |
| unsubscribe (mute) a thread | REST `DELETE /notifications/threads/{id}/subscription` ([docs](https://docs.github.com/en/rest/activity/notifications#delete-a-thread-subscription)) | 204. Same: future notifications only. |
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
(`mark_read`, `undo_mark_read`, `approve`, `comment`, `writes_on`,
`writes_off`; `bring_back` only on old rows, see below; `mark_done` / `subscribe` / `unsubscribe` get
added with their writer methods), `origin` (who decided: `tile` = the user in
a tile or the detail pane, `debug` = the notifications view, `queue` = the
deferred queue when a batch's window ran out, `quit` = the flush on quit,
`sync` / `poll` = a thread left the inbox, `footer` = the lock, also sending
or discarding pending writes), `outcome` (`queued`, `pending`, `discarded`,
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
`notifications.markRead`, `markSeen`): nothing writes to GitHub on its own.
Locally, the full sync and the live poll mark a stored thread read when it
drops out of the inbox (read on github.com or another client); those rows
are logged as `observed` with origin `sync` / `poll`. The first sync of a PR
also marks events older than the thread's `last_read_at` seen (event state,
not logged). Glances, consolidation, dossiers and ping decisions never mark
anything read. There is no CLI write and no "mark all read".

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

## Live poll and Mac pings

Near-real-time pings on the Mac, only when they matter. Runs while the desktop
app runs (window open or hidden); the CLI has `poll` for one cycle, the
standalone server never starts it.

**Poll** (`LivePoller` in engine `live/`, started by the desktop main process):

- `GET /notifications` every `POSTPILE_POLL_SECONDS` (default 10, 0 turns
  it off) with the stored ETag / Last-Modified, shared with the full sync. A
  304 costs no rate limit and does nothing else.
- GitHub's `X-Poll-Interval` (usually 60) is read, logged when it changes and
  shown in the footer tooltip, but not obeyed: Julian asked for 10s, and 304s
  are free. One cycle at a time; the next is scheduled when the last one ends.
  The first cycle waits one interval so the app's start sync goes first.
- Backoff: a rate limit (429, or 403 with Retry-After / no requests left / a
  "rate limit" message, or a GraphQL `RATE_LIMITED` error; `GitHubError.rateLimited`)
  waits Retry-After or until X-RateLimit-Reset, else doubles from 60s to 15
  min. Other errors double from the interval up to 5 min. The footer shows
  "backing off, retry in Ns" (state `backoff`).
- Overlap: `Engine.pollOnce()` answers `blocked` while a full sync or a
  consolidation runs (footer: "paused: full sync running"); sync and
  consolidation wait for a running poll cycle, so agent calls land in the
  right run (`poll:<time>` in `agent_call`).

**Incremental sync** (`PollRun`), only after a 200: the PRs whose unread
threads moved since their last fetch, newest first, at most 24 (two GraphQL
batches; the rest wait for the next change or the full sync). Snapshots,
events with rule loudness and the event log are written exactly as in the
full sync (`GitHubSync.poll`), retired topics revive, and PRs new to the app
get a topic (one `topic_assignment` call at most). Tiles are derived on read,
so they update by themselves; the renderer refetches when `changeCount` in
`GET /api/live` moves. Dossiers, glances, sets, stack layers and the event
second opinion stay with the full sync, which still finds the new events
through the event log and walks stacks and verifies facts for the PRs the
poll fetched (meta `poll_fetched_since_sync`). Never marks anything read (on GitHub or locally,
beyond what the full sync already does for threads that left the inbox).

**Decision** (`PingDecider`), one per PR thread with new events, rules first:

- Only unseen events from this poll and at most 30 minutes old
  (`PING_FRESH_MS`) count; the first look at an empty store is a baseline and
  decides nothing.
- `pingRule` in core classes the events: `bot` (bot-only), `muted`, `quiet`,
  `not_addressed` (loud, but not aimed at the user in person: a comment or
  approval on their PR, merged without their review) or `addressed` (mention,
  team mention, question, reply, and on an open PR: review request, commits
  after approval, changes requested on their own PR). Agent and user
  overrides count.
- Everything but `addressed` is decided by the rules: no ping, no agent.
- `addressed` items of one cycle go to Sonnet in one `ping_decision` call:
  instructions, topic tailoring, dossier brief, glance, the new events (fenced
  as `<github_data>`), rule loudness and reason, whose turn and the why-here
  code. Answer per item (zod): `{ id, ping, title, body, reason }`. The agent
  may veto or rephrase, never add.
- Fallback when the call fails, skips an item, or the daily cap is spent
  (`POSTPILE_PING_CAP`, default 200 calls per rolling 24h): ping with
  `pingTemplate` text ("@bob asked you something · posthog#41850").
- Every decision lands in `ping_decision` (migration 007): thread, PR, ping
  yes/no, source rules / agent / fallback, title, body, reason, time.

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

**Fake mode**: `FakeLivePoll` adds a sample question to the next open pinged
tile every ~45s and pings for it with a fake rules decision, through the same
`LivePoller` and throttle.

**Cost**: a `ping_decision` call measured about $0.04 and 4-5s (2 items, real
instructions). One call per poll cycle with addressed news, so a normal day is
roughly 10-40 calls, $0.40-1.50; the cap bounds it at 200 calls (about $8).
Poll topic assignments add a few calls a day for PRs new to the app.

## Work context sweep ("What you're working on")

A short, agent-written digest of what the user is working on, taken from
their local Claude Code data and fed to the relevance prompts as background.
Agent-derived memory in the sense of "Memory by author": it never touches
instructions.md, and the user steers it only with Forget and Refresh.

**Collect** (engine `work-context/collector.ts`, deterministic, no agent tools),
from `POSTPILE_CLAUDE_DIR` (default `~/.claude`):

- `CLAUDE.md` plus the files it @-includes (`@RTK.md`, `@~/x.md`), resolved
  against the including file's folder and its symlink target's folder, only
  under `~/.claude` or the folder the symlink points into (the dotfiles). Lines
  in code fences do not count. Depth 3.
- **Skip list first**: `projects/*` folders on the skip list are never
  opened, neither memory nor sessions, so private projects never leave the
  machine (`work-context/skip-list.ts`). Defaults: `taxes`, `garden`,
  `hobby`, `my-blog-com`; `POSTPILE_SWEEP_SKIP` (comma separated) replaces
  them, set to empty it skips nothing. A folder like
  `-Users-me-workspace-taxes` is decoded on disk (the encoding turns
  `/`, `.` and `_` into `-`, so the longest run of tokens that exists as a
  folder wins at each level; the rest is the last segment once nothing
  exists). It matches when the project's last path segment equals or starts
  with a pattern (case and punctuation ignored), or the folder name ends in
  `-<pattern>`. The count lands in `inputStats.skippedProjects` (names stay
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
`POST /api/work-context/forget {version, index}`. Fake mode shows a sample
digest linked to the sample topics.

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
  port with a random token and loads the renderer with `?api=...&token=...`. PATH is taken from
  the login shell (`fix-path`), plus `/opt/homebrew/bin`, `/usr/local/bin` and `~/.local/bin`,
  so `gh` and `claude` resolve on a GUI launch. Quit (Cmd+Q, SIGTERM, SIGINT) flushes the
  mark-read queue, closes the engine and the server, then `app.exit(0)`.
  **App bundle** (`pnpm dist`): electron-vite bundles main (workspace packages, hono,
  fix-path included), preload and renderer into `out/`; electron-builder
  (`apps/desktop/electron-builder.yml`) packs only `out/**` and `package.json` into an asar,
  no node_modules (the desktop package has devDependencies only). macOS, arm64, `dir` + `zip`,
  appId `com.postpile.app`, unsigned (`identity: null`, no notarization), icon
  `build/icon.icns`, output `apps/desktop/dist/`. About 290 MB unpacked, 130 MB zipped
  (Electron itself is most of it).
- **apps/cli**: `sync`, `consolidate`, `topics`, `topic <id>` (with the dossier), `pr <owner/repo#n>`
  (with facts), plain text.

### HTTP API

Ids containing `/`, `#` or `:` (tile ids, event ids) are `encodeURIComponent`-ed
in paths. Every request needs `x-postpile-token`. The desktop app makes a
per-launch token; the standalone server prints a per-run one unless
`POSTPILE_TOKEN` is set. A web page cannot send the header without a
preflight and does not know the token, so CORS stays open.

| route | engine call |
|---|---|
| `GET /api/health` | - |
| `POST /api/sync` | `sync()` |
| `GET /api/topics` | `listTopics()` |
| `GET /api/topics/:id` | `getTopic()` |
| `GET /api/debug/notifications?limit=` | `debugNotifications()` (default 200, max 1000) |
| `POST /api/topics/:id/tailoring` `{text, keep}` | `decideTailoring()` |
| `POST /api/proposals/:id` `{accept}` | `decideTopicProposal()` |
| `GET /api/prs/:owner/:repo/:number` | `getPr()` |
| `POST /api/prs/:owner/:repo/:number/approve` | `approve()` |
| `POST /api/prs/:owner/:repo/:number/draft-ask` `{person, intent}` | `draftAsk()` |
| `POST /api/prs/:owner/:repo/:number/comment` `{body}` | `sendComment()` |
| `POST /api/tiles/:tileId/mark-read` | `markRead()` |
| `POST /api/tiles/:tileId/snooze` `{condition}` / `DELETE` | `snooze()` / `unsnooze()` |
| `GET`/`POST /api/tiles/:tileId/chat` `{message}` | `getChat()` / `chat()` |
| `POST /api/undo` `{undoToken}` | `undo()` |
| `POST /api/feedback` | `giveFeedback()` |
| `POST /api/events/:id/unmute` | `unmuteEvent()` |
| `GET /api/live` | `livePollStatus()` (fast poll state, backoff, X-Poll-Interval, `changeCount`) |
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
  override. The CLI and the desktop app share one database; WAL lets them run side by side.
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
  (default 10, 0 off), `POSTPILE_PING_CAP` (default 200 per 24h) and
  `POSTPILE_MAC_NOTIFICATIONS=0` tune the live poll.
- **Test builders** live at `@postpile/core/fixtures` (incl. `FakeTimers`); engine tests use
  fake reader/writer and the agent's `FakeRunner`.

### Safety while building

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
    14 quiet days, nothing unread or snoozed) or a proposal like merges [automatic, reversible]
  - accepted global rules: kept in the database and added to every prompt, or appended to
    instructions.md [database; instructions.md stays the user's own file]
  - fold set grouping into the dossier update to save one call per topic [not yet, sets stay a
    separate job]
  - first dossier update of a big topic: 120 events max, 15 per PR, older ones only counted
    [yes]
  - one initiative per topic, or initiatives spanning topics [one per topic]
  - consolidation cadence: due after 24h and at least one new dossier version, triggered by
    the desktop app when idle and by `consolidate` in the CLI [yes]
  - dossier history: keep the newest 50 versions per topic, pruned on save [50]
  - glance batches with 18 PRs per call [yes; moved from haiku to sonnet after a side-by-side run]
  - dossier driver overrides "most frequent author" for the topic driver [yes]
- **Work context sweep** (current choices in brackets):
  - model [opus; cost is no concern, the call has to judge work vs. private in loose notes]
  - private projects (taxes, home automation, personal sites) are sent to the model and
    filtered by the prompt [yes; a skip list of project folders would keep them local]
  - which prompts get the digest [topic assignment, dossiers, glances, pings, chat; not sets,
    events, consolidation, recheck, drafts]
  - budget split and caps [60k: CLAUDE.md 6k, sessions 30k, memory 24k; most memory files of
    the posthog project never fit, only its MEMORY.md index]
  - a failed sweep retries after 2h, not on every 30-minute check [yes]
- **Live poll and Mac pings** (current choices in brackets):
  - obey GitHub's X-Poll-Interval (60s) or poll faster [10s as asked; 304s are free, the value
    is shown in the footer tooltip]
  - loud but not addressed (approval or comment on your own PR, merged without your review):
    ping or not [not; they stay unread tiles and never reach the agent]
  - team review requests (RT) and team mentions: addressed [yes; the prompt tells the agent it
    is the team, not the user in person]
  - events older than 30 minutes never ping (catch-up after sleep or a failed poll) [yes]
  - a poll whose PR fetch failed leaves those PRs to the full sync; the next poll gets a 304
    and does not retry them [yes, keeps the 304 path free]
- **Snooze wake-up**: implemented default (`breaksSnooze`): a loud event from a human after the
  snooze started ends it, so a mention is never hidden. Confirm.
- **Loudness rules beyond the spec**, to confirm: human team mentions are loud; human reviews and
  comments on the user's own PR are loud; a mention or question drops to quiet once the user
  spoke on the PR after it; loud events on pulled-in PRs also make a tile unread; every commit
  after the user's approval is its own loud event (a busy PR lists many reasons).
- **Repo name**: decided 2026-09-28, the app is PostPile (formerly the working title
  `code-manager`). Renaming the repo folder is still open.
