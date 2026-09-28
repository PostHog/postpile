# Where things stand

Snapshot after engine memory v2 landed (dossiers, facts, batched glances,
consolidation). DESIGN.md has the full design; this file is the short "what
now".

## Done

- Engine works end to end: notifications (ETag), batched GraphQL PR fetch,
  events with rule loudness, topics, sets, stacks, derived tile state, event
  overrides by the agent. All state in SQLite (`node:sqlite`, no native
  module).
- Engine memory v2:
  - append-only `event_log` with digest and seen cursors; dossier updates
    only read events after the digest cursor
  - one living dossier per topic (versions kept, 50 max), refined from the
    new events, joined/left PRs, stale facts and feedback
  - facts with provenance and validity times, reconciled Mem0 style (rules
    first, agent only for ambiguous ones), never deleted
  - verify-before-use in the sync verify pass and at read time
  - glances written from the dossier, 18 PRs per call, per-entry validation
    and one retry batch
  - event second opinion as one call per topic
  - `consolidate` (on demand or `--if-due`): topic and rule proposals, fact
    merges, retiring behind a deterministic gate
  - every call lands in `agent_call`; `sync` prints calls by kind and cost,
    `--max-agent-calls` caps sync and consolidation
  - v1 summaries, per-PR glances and per-PR event calls are deleted
- Actions: approve (pinned to the synced head commit), mark read with the 6s
  undo queue, not mine / not related / wrong topic feedback, snooze, unmute,
  ask-a-person draft + send, tile chat with "keep it" tailoring, topic
  rename/merge/split and standing-rule proposals (filed by consolidation,
  applied only on accept).
- CLI, HTTP server (Hono) and an Electron + React UI over the same
  EngineService.
- Desktop renderer rebuilt in the "Crisp native, refined" style: Tailwind v4
  on design tokens (`apps/desktop/src/renderer/src/styles/`), react-query
  hooks per resource, one guarded `ActionsProvider` for every mutation,
  hidden-inset title bar, three panes (see "Three-pane balance" in
  DESIGN.md), status footer,
  toast with Undo. Rules for the renderer are in `apps/desktop/CLAUDE.md`.
- GitHub writes lock (DESIGN.md "GitHub writes: lock, action log"): the lock in the status footer switches GitHub writes on and off at
  runtime (`WriteSwitch`, `GET/POST /api/github-writes`), kept in meta,
  read-only on first run, confirm popover to open, instant to close,
  disabled with the reason under `POSTPILE_READ_ONLY=1`. Locked: approve
  and comment blocked; mark read and "not mine" become pending writes
  (`pending_write`, migration 011) after the undo window, the tile keeps its
  state with a "pending: mark read on GitHub" marker, the lock shows a count
  badge, and unlocking offers Send N / Discard / Cancel (plus "Discard
  pending, stay locked"). `CODE_MANAGER_ALLOW_WRITES` is gone.
- Action log (`action_log`, migration 008): every GitHub write, local
  mark-read, undo and lock flip, with origin (tile, debug, queue,
  quit, sync, poll, footer) and outcome (queued, github, local, skipped,
  failed, observed). Written by `GitHubWrites`, the only door to the writer,
  plus ReadMarker and the sync's "left the inbox" mirror.
- Notifications debug view: "Mark read" per thread (same queue, undo, lock
  and log), last logged action per row, filter "Read by this
  app". GitHub's capabilities (no mark-unread, no Saved API) are in
  DESIGN.md with doc links.
- Review fixes, highlights:
  - API token is always required, so web pages cannot fire approve or mark-read
    at the local server.
  - Mark-read reads the thread again before the PATCH and leaves it unread if
    it moved since the sync, so mentions are no longer lost.
  - Stale glances (PR moved, instructions or feedback changed) are flagged
    `glanceStale` and shown as stale next to Approve.
  - "Not related" is remembered in `pr_set_member.removed_at`; regroups cannot
    put the PR back.
  - Mark-read failures do not drop the rest of a batch; quit waits for sends in
    flight; failures and skips show up in the next sync report.
- Memory v2 review fixes:
  - GitHub text is fenced as `<github_data>` in every prompt; userCares with
    a source the prompt did not carry and `user_cares` fact candidates are
    dropped, observed cares render as unconfirmed.
  - A stale fact is offered for recheck once per time it goes stale
    (`fact.rechecked_at`, migration 003), 20 per update; confirming one that
    still fails its check closes it, a moved head is re-anchored. Claims that
    fail `verifyDossier` are dropped on save and before glance prompts.
  - Dossiers refresh when instructions, tailoring or standing rules change
    (`dossierContextHash`); the dead input-hash skip is gone.
  - Event batches the call cap skips wait for the next sync (per-topic
    `classify` cursor over the event log).
  - A PR joining a topic brings its older logged events into the delta once.
  - New recentChanges entries are stamped with the update time, so same-day
    changes show under "since you last looked".
  - Fact refs carry the head they were made against; `head_moved` applies to
    status / decided / blocked_by / depends_on only.
  - One candidate per unique slot per answer; consolidation groups duplicates
    by slot, not by subject + predicate.
  - Bounded: closed members only counted in the dossier prompt, versions
    pruned to 50 on every save, 1 + 10 refs per fact.
- Desktop shows memory v2: dossier in the topic header ("Since you last
  looked" first, full dossier behind a disclosure with version history),
  "What the agent knows" per PR, an Inbox for topic and rule proposals,
  agent call stats of the last sync in the footer. Topics are marked seen
  when the user leaves them. Every fact and dossier line has "Wrong" (cares
  also "Forget") via the new `correctMemory`: facts close right away,
  dossier lines are logged as feedback and fixed by the next dossier update.
- Fake mode carries sample memory (`apps/server/src/fake/sample-memory.ts`,
  `FakeMemory`): Depot and Frontend build dossiers, facts with one stale,
  a seen cursor, a merge proposal and standing-rule proposals.
- Memory split by author (DESIGN.md "Memory by author"):
  - "Your instructions" view: current text, version history with diffs and
    origin, a chat that proposes changes; in tile chat the user places a
    lasting point: Keep for this topic / Keep for all topics (instructions
    proposal with a diff) / Just this once. Nothing is written without Accept; hand
    edits are stored as their own version and never overwritten (a stale
    proposal comes back rebased). Versions in `instructions_version`
    (migration 004; 003 was taken).
  - "Why?" on every fact and dossier line: sources (GitHub and the user's
    own words) plus verify state. Dossier updates now cite sources on every
    line and see the user's chat turns in the topic.
- Fix pass after the first real full sync (142 PRs, 120 calls, $3.23,
  61 topics):
  - syncs the app starts are capped (`POSTPILE_MAX_AGENT_CALLS`,
    default 30, raised to 150 on 2026-09-28 since cost is no concern and a
    full first sync of ~120 calls then fits in one); the title bar says when
    a sync stopped at the cap
  - topic assignment prefers existing topics (member counts in the
    prompt), may leave a lone PR in Unsorted, creates at most 5 topics per
    sync; Unsorted PRs are asked about again after the next consolidation,
    which is told to propose merges for 1-2 PR topics
  - dossier answers with missing optional fields (askedBy, ...) no longer
    fail the whole update
  - PRs without a glance say why: skipped by the call cap or failed
  - topic subtitles come from the dossier status line; meta phrases like
    "First write-up." are dropped and the prompt forbids them
- Topic placement (DESIGN.md "Topic placement"): relation team / routed /
  fyi with owner and "why you" (rules first, the dossier decides the rest,
  "Wrong" corrects until new activity), areas with a per-sync cap and
  area-merge proposals, sidebar grouped Needs you / Your team by area /
  Routed / FYI, done and snoozed tiles folded. Fake data has a routed and
  an FYI topic.
- Lasting chat points: the agent only spots them; the user picks the scope
  (Keep for this topic / Keep for all topics / Just this once). The chat
  schema has no scope anymore and the "Apply to all topics instead" /
  "Only this topic" switch is gone.
- Stack completion (DESIGN.md "Stack completion"): pinged PRs fetched in a
  sync walk their stack by branch, 6 layers each way, open or merged in the
  last 14 days, no agent. Layers are stored as pulled in ("stack layer
  below #N"), get no glance / topic / dossier / event calls, show in the
  anchor's topic, and turn pinged once notified. Fake data has a Depot
  stack with two pulled-in lower layers.
- Back / forward navigation in the desktop app: title bar chevrons, Cmd+[ /
  Cmd+], mouse side buttons, trackpad swipe (only fires with the classic
  "Swipe between pages" setting; not tried on hardware yet).
- Title bar search that filters topics and tiles (Cmd+F, Esc clears):
  `GET /api/search?q=`, in-memory over stored PRs, same matcher in fake mode.
- GitHub avatars in the renderer (avatars.githubusercontent.com, no API
  call), initials underneath as placeholder and fallback; bots and teams
  keep initials.
- "Recheck" replaces "Wrong" on memory lines: one `memory_recheck` agent
  call, then Accept (keep / fix / drop) or tell the agent in the tile chat;
  every memory correction has a 6s Undo. DESIGN.md "Recheck instead of
  Wrong".
- Three-pane balance: wider topic sidebar (clamp 248-330px) whose rows
  show the dossier summary (one line when narrow, two when there is room),
  a coral unread count, a honey "N your move" chip (`yourMoveTiles` on
  `TopicListItem`) and the relation in Needs you; a one-tile-wide middle
  column (clamp 420-480px); the detail pane takes the rest.
- Team members (DESIGN.md "Tile faces"): every other login on the
  viewer's teams, REST with ETags, refreshed at most daily in sync, on
  `Viewer.teamMembers`. Whose turn's "teammate is reviewing" uses it.
  `prTier` (ghatchup's needs_reply / mine / team / to_review /
  team_mentioned / rest) is in core with tests and drives the sidebar.
  The first real sync after this makes one members call per viewer team
  (a 403 on a SAML-protected org counts as an empty team).
- Notification debug view (DESIGN.md "Notification debug view"):
  `GET /api/debug/notifications`, engine + FakeEngine (sample threads incl.
  an issue, a release and an unsynced PR), sidebar footer entry, filters,
  jump to tile through the history, per-PR recent events.
- "Warm reach" tile look (DESIGN.md "Tile faces"): why-it's-here code
  badges (RV, RT, @, @T, AS, AU, CM, FW, ST) on tiles and rows, a warm
  "why now" strip with the actor's avatar and an ink event glyph, a segment
  status pill per PR with open threads, a whose-turn footer (you / them /
  none, rules in core `whoseTurn`), people stack in the header. Same
  badges, pills and glyphs in the detail pane. Primary buttons are ink.
- Live poll and Mac pings (DESIGN.md "Live poll and Mac pings"): the desktop
  app polls `GET /notifications` every 10s (ETag, 304 = free), backs off on
  rate limits (Retry-After / reset / doubling) and errors, shows state in the
  footer; on a change it syncs just the moved PRs (events, loudness, topic for
  new PRs, tiles refresh). Rules first, then one Sonnet `ping_decision` call
  per cycle for addressed activity (veto or rephrase), template fallback, daily
  cap 200, every decision in `ping_decision` (migration 007). Native
  notifications grouped per tile (2 min) and as a summary above 3; a click
  opens the tile. Closing the window hides it, Cmd+Q quits. Fake mode pings a
  sample question every ~45s. CLI `poll` runs one cycle.
- Queue sidebar (DESIGN.md "Queue sections"): topics listed under Needs
  reply / My PRs / Team's PRs / To review / Team mentioned / Other topics,
  a topic in every section it has PRs for; rows with a face stack (team
  first, sea ring), the section's count and a one-line summary; Mine /
  Team / Reply / Review filter buttons that narrow with the search and
  highlight / fade tiles in the open topic; topic column in tier order.
  Urgency fix: a topic only ranks as needs-you (coral) when an unread tile
  is still open or it's your move; merged-only unread shows a grey count.
  New read-model fields (`queues`, `people`, `urgentUnreadTiles`, PR and
  tile `tier`) and `GET /api/viewer`. Fake data gained own PRs, a team
  mention, a bot bump and a merged PR with news.
- Work context sweep (DESIGN.md "Work context sweep"): a daily agent-written
  digest of what Julian is working on, from `~/.claude` (CLAUDE.md and its
  @-includes, every project's memory files, light signals from sessions of
  the last 7 days; secrets masked, ~60k chars budget, drops logged). One opus
  `context_sweep` call (`POSTPILE_SWEEP_MODEL`), versions in
  `work_context_version` (migration 009, last 30). Runs from the desktop app
  once a day from 06:00 (checked at start and every 30 min), on
  `npm run cli -- sweep` and on Refresh; never blocks a sync. Injected as
  background into topic assignment, dossier updates, glances, ping decisions
  and chat, outside every input hash. "What you're working on" at the bottom
  of "Your instructions": summary, threads with topic links, Why?, Forget
  (with Undo), Refresh, last error. One real run against a DB copy: 60k chars
  in, 12 threads, $0.40, 43s; personal sessions (taxes, shopping) left out.
- Default agent-call cap for app syncs raised from 30 to 150
  (`POSTPILE_MAX_AGENT_CALLS`).
- Tests (vitest) and typecheck green across all workspaces.

## Stubbed or thin

- Desktop UI follows the chosen style, but the layout is still open. Not in
  the UI yet: a "handled quietly" list (shown disabled), keyboard
  navigation between tiles, dark mode, one-press approve from a tile (Approve lives in the
  detail pane, next to the glance).
- The footer lock is enforced in the engine (`GitHubWrites`), not only in the
  UI; `POSTPILE_READ_ONLY=1` stays the hard stop (no write client at all).
  Any caller with the token can still open the lock through the API.
- The lock in fake mode is not persisted (starts locked on every start).
- mark done, subscribe / unsubscribe have no writer methods yet.
- Mark-reads log one `local` row per PR without an unread thread
  (pulled-in stack layers), which makes the log a bit chatty.
- A mark-read sent with writes on that fails (or is skipped for newer
  activity) after the window still leaves the tile read in the app while
  GitHub keeps it unread. Pending writes only cover the locked case; making
  queue failures revert and park too would close that gap.
- A pending write for a thread that later gets read on github.com keeps its
  marker until it is sent (then logged `observed`) or discarded; the sync
  does not clear it.
- Pending writes in fake mode live in memory (gone on restart).
- Fake mode (`POSTPILE_FAKE=1`) runs `FakeEngine`, a second
  EngineService with its own copies of the tile/loudness/undo rules. It can
  drift from the real engine. See decisions below.
- The full sync is on demand only (Sync now, app start); the live poll only
  syncs PRs whose threads moved and leaves dossiers, glances and sets to it.
- Live poll, not tried by hand yet: clicking a real macOS notification (click
  -> focus -> tile), the first-run permission prompt and a denied permission,
  the hide-on-close / Cmd+Q flow, and a real rate-limit backoff. Electron
  cannot read the notification permission, so a denial is silent (tiles still
  turn unread). One real `ping_decision` call ran against a DB copy (2 items,
  $0.04, 4.4s) and `cli poll` against the real inbox (read-only copy).
- No settings UI: "Mac notifications" on/off is `POSTPILE_MAC_NOTIFICATIONS=0`
  and the interval is `POSTPILE_POLL_SECONDS`; quiet hours are not built.
- The ping throttle and the poll's backoff live in memory; a restart forgets
  the 2-minute window.
- A poll whose PR fetch fails after the inbox answered 200 leaves those PRs to
  the full sync (the next poll gets a 304); their pings are lost.
- A running poll cycle (up to one topic assignment and one ping decision
  call) makes "Sync now" wait for it.
- The mark-read undo queue is in memory. Quit flushes it; a crash drops
  pending mark-reads (local state already says read, GitHub stays unread).
  The action log then shows them as `queued` with no send row.
- Nothing files `new_topic` proposals: new topics are created directly.
- Desktop does not run `consolidate({onlyIfDue})` when idle yet. Quitting
  the app while on a topic does not mark it seen.
- Dossier corrections are matched by text: a line the next update rewords
  slightly loses its "marked wrong" mark, which is the intended outcome.
  Fact corrections also land in `correctedClaims` (harmless, no dossier
  line has that text).
- Stale dossier claims in fake mode are hardcoded (one question), the fake
  does not run `verifyDossier`.
- Ambiguous fact candidates the call cap does not reach are dropped (the
  dossier already moved past their events).
- `PROMPT_VERSION` moved to v2: the first real sync on an old database
  regenerates every glance and set hash once.
- A database from before the classify cursor gives a second opinion on its
  older loud unseen events once, on the first sync after the upgrade (one
  call per topic with such events, within `--max-agent-calls`).
- Topics without a stored dossier context hash count as unchanged; the hash
  is written on their next dossier update.
- Topics over the 40-entry timeline cap rely on `earlier` for older PRs;
  consolidation can only propose splits over timeline PRs.
- No packaged/signed macOS build yet; `npm run build` only bundles for
  electron-vite.
- Search matches title, number, author, repo, head branch, topic name and
  area only (no PR body, comments or labels) and does not highlight the
  matched text. Filter state and history are not kept across restarts.
- Sample logins (rowan, lyra, nell, ...) are real GitHub accounts, so fake
  mode shows strangers' avatars instead of the initials fallback.
- Recheck: not run against the real agent yet; the fake answers cycle
  holds / fix / drop after 1.5s. The daily cap (40) is a guess. A fix of a
  fact keeps the old refs; no new ref points at the evidence in `why`.
- Whose turn is rules only and still rough: "you
  commented on the head" only looks at reviews, and the own-PR "Merge, it is
  approved" rule is an addition. Not tried against real data yet.
- Tiles are one column now, ~380px wide at the 1100px minimum window and
  ~435px at 1440px. PR row titles in multi-PR tiles still truncate at the
  minimum width; the full text is in the tooltips.
- Work context sweep: the schedule and Refresh are not tried in the running
  desktop app yet (tests and one CLI run only). Only the newest compaction
  per session is kept and only the first 3 prompts, so a long session that
  changed direction reads as what it started with. Forks are matched on
  identical first prompts. Forget matches threads by title; a reworded
  thread can come back. Session refs use local time of the machine.
- Web app: not started. The renderer already talks HTTP and takes
  `?api=...&token=...`, so it can be served on its own later.

- Stack completion follows base/head branches only. PRs linked from bodies
  or comments are not pulled in, and `subscribed` threads still count as
  pinged. A merged lower layer usually drops out of the chain once GitHub
  retargets the upper PR to the default branch (branch auto-delete).
- A pinged PR that was not fetched this sync does not walk its stack, so a
  new layer on top of it shows up only after the PR itself moves.
- The first real sync after this change asks two branch lookups per fetched
  pinged PR (about 10 GraphQL queries for ~140 PRs); later syncs only for
  PRs that moved. Not yet watched against the real account.
- `pr_glance.pull_in_reason` and the glance prompt's pulled-in wording are
  left in place but unused, since layers get no glance.
- Relation rules know the user's own teams only (viewer teams); team
  members are fetched now but relation rules do not use them yet, so
  ownerTeam of routed topics comes from the agent. CODEOWNERS is inferred from team review requests
  plus the touched directory, the CODEOWNERS file is not read.
- Existing topics get a relation and area on their next dossier update; until
  then they sit under Your team / "Other".
- Inside Other topics, topics that need you show under Needs you, so the
  Routed and FYI groups only hold quiet topics and stay folded. A calm
  topic (unread, all merged) can sit in a folded group with its grey count.
- Queue sections: tier counts include pulled-in stack layers; the queue
  filter is not kept across restarts or in history; the "N your move" chip
  and the relation badge are gone from sidebar rows (the sections carry
  most of it, whose turn is still on the tiles). Topic names truncate early
  at the 1100px minimum because of the face stack.
- Unsorted PRs are not shown to consolidation; they are only re-offered to
  topic assignment after a consolidation run.
- Dossiers written before line sources show "no source recorded" on goal,
  status, timeline and cares until their next update. No forced refresh:
  `DOSSIER_PROMPT_VERSION` only goes into the stored input hash.
- A rebased instructions proposal is asked again through the agent, so an
  inline edit made on the stale proposal is lost (the card says the change
  came back; the user can edit again). No 3-way merge.
- Rejecting an instructions proposal is not recorded; the agent may
  propose the same thing again from a similar message.
- "Open in editor" only reveals and copies the path; the app has no IPC to
  open an editor.
- Fake mode keeps instructions in memory (path shown as sample data) and
  cannot simulate a hand edit on disk.

## Needs Julian's decisions

- **Fake mode**: rebuild it on the real Engine (in-memory store, fake GitHub
  reader with the Depot sample, canned agent answers) and delete FakeEngine, or
  drop it and use `POSTPILE_READ_ONLY=1` + `sync --no-agent` against the
  real account for UI work.
- **Mark-read vs. CI noise**: a thread bumped by CI or bots between sync and
  mark-read is left unread on GitHub (and reported). Safe, but may be annoying
  on busy PRs. Alternative: fetch the PR and only skip when there is a new loud
  event.
- **Approve on a moved PR**: approval is pinned to the synced head, so GitHub
  records exactly what was seen and newer pushes show as "new commits after
  approval". Alternative: refuse and ask for a sync when the head moved.
- **Stale glance UX**: currently shown with a "stale" label. Alternatives: hide
  the verdict, or disable one-press Approve until a fresh glance exists.
- **Memory v2 choices** listed under "Engine memory v2" in DESIGN.md's open
  questions, most notably: glance hash tied to the dossier version (each
  dossier update re-glances its topic), automatic retiring behind the gate.
  Changed by the review fixes: an instructions.md edit now refreshes every
  dossier once (one call per topic) instead of waiting for the next event.
  To go back, drop instructions from `dossierContextHash`.
- **Confirmed but failing facts**: a stale fact the agent confirms while its
  check still fails (reviewer left, source comment deleted) is closed.
  Alternative: keep it stale and hidden for good.
- **First real sync cost**: a capped smoke run (15 PRs, 6 calls) made 1
  topic assignment + 5 dossier updates for about $0.18, with 7 more dossier
  updates, 5 glance batches and 4 event batches cut by the cap. Dossiers and
  glances pick those up on the next sync; event batches did not back then
  (they were lost) and now do. A full first sync over ~140 PRs should land
  around 80-90 calls; worth a watched run before relying on it.
- Still open from DESIGN.md: UI framework final call, three-pane layout,
  memory numbers (10 feedback entries per prompt, when sets regroup), snooze
  wake-up on any loud human event, the extra loudness rules. The name is
  PostPile (2026-09-28); renaming the repo folder `~/workspace/code-manager`
  is Julian's call.

- **Queue sidebar**: (1) "Your move" alone now makes a topic needs-you,
  as asked; that includes "Merge, it is approved" on own PRs, which may
  lift more topics than wanted. (2) Mine / Team count open PRs only, so a
  topic with just merged PRs of yours drops out of Mine. (3) The row lost
  the "N your move" chip; bring it back next to the faces? (4) Tier counts
  include pulled-in stack layers the user was not pinged for.

- **Work context sweep**: private projects (taxes, home automation,
  personal sites) go to the model and only the prompt keeps them out of the
  digest (the real run did). Keep that, or skip project folders by a list
  before anything leaves the machine? Budget split (sessions 30k, memory
  24k) means most posthog memory files never make it, only their MEMORY.md
  index; fine? Which prompts get the digest (now: topics, dossiers, glances,
  pings, chat)?

- **Live poll**: poll at 10s and only show GitHub's X-Poll-Interval (60s), or
  obey it? Should loud-but-not-addressed activity (approval or comment on your
  own PR) ping? Team review requests and team mentions ping today (the agent
  is told it is the team); keep that? Cap of 200 ping decisions a day
  (~$0.04 each, a normal day ~10-40) and the 30-minute freshness window are
  guesses.

- **GitHub writes lock**: `CODE_MANAGER_ALLOW_WRITES` was dropped instead of
  kept as "start unlocked"; the lock is the one switch. A batch queued while
  locked stays pending even when the lock opens inside its undo window (the
  unlock popover is where the user decides). Keep that? Should the lock also
  be persisted in fake mode?

## Later

- Dig deeper: a chat send mode that runs Opus with read-only tools (local
  checkout, gh pr view/diff) for a user's hunch, writing findings back into
  topic memory. Not a separate button. Deferred by Julian 2026-09-28.
- Drop the `CODE_MANAGER_*` env fallback (`applyLegacyEnv`) and the
  code-manager folder migration (`legacy-data.ts`) once the move has run.

## Decided

- **Pending writes, not local reads** (2026-09-28): a mark-read while
  locked changes nothing in the app; it waits as a pending write until the
  user sends or discards it. Approve and comment have no pending queue.

- **No bring back** (2026-09-28): GitHub is the source of truth for read
  and unread, and it has no mark-unread (no REST or GraphQL mutation). An
  app-only bring back split the state, so it is removed (migration 010 drops
  `brought_back_at`); old `bring_back` log rows stay.

- **Name** (2026-09-28): PostPile. Package scope `@postpile/*`, env vars
  `POSTPILE_*` (old `CODE_MANAGER_*` still read, with a deprecation line),
  data in `~/Library/Application Support/PostPile` and
  `~/.config/postpile`, moved from the code-manager folders on first start.

- **Instructions scope** (2026-09-27): Julian picks the scope of a lasting
  chat point, not the agent: Keep for this topic (tailoring) / Keep for all
  topics (instructions proposal, diff with Accept / Edit / Reject) / Just
  this once. Proposals still only come from Julian's own messages.
- **Pulled-in PRs** (2026-09-27): only for completing stacks, deterministic,
  no agent involved. Stack neighbours are fetched by branch during sync
  (6 layers each way, open or merged within 14 days), stored as pulled in
  with "stack layer below/above #N", inherit the topic of the stack's
  pinged PR and never get glance, topic or dossier calls. Sets stay
  agent-grouped among pinged PRs.

## How to run

```
npm install
npx install-electron          # Electron 44 no longer downloads on install
npm run typecheck
npm test
```

CLI (the main way to test without UI):

```
npm run cli -- sync --limit 10 --no-agent     # cheap first look, no claude calls
npm run cli -- sync                           # full sync with the agent
npm run cli -- sync --max-agent-calls 5 --agent-jobs topics,dossiers,glances
npm run cli -- topics
npm run cli -- topic <id>                     # with the dossier and changes since seen
npm run cli -- pr owner/repo#123              # with facts
npm run cli -- consolidate [--if-due] [--max-agent-calls n]
npm run cli -- poll                           # one live-poll cycle, prints ping decisions
npm run cli -- sweep                          # "what you're working on" from ~/.claude, one opus call
```

Smoke run on a throwaway database, read-only:

```
POSTPILE_READ_ONLY=1 POSTPILE_DB=/tmp/cm-smoke/db.sqlite \
  npm run cli -- sync --limit 15 --max-agent-calls 6
```

Desktop and server:

```
npm run desktop       # Electron dev mode, server in-process on a random port + token
npm run server        # standalone API on 127.0.0.1:4870, prints its token
```

The desktop app syncs once on start, then only on "Sync now". Between syncs it
polls notifications every 10s and pings the Mac for addressed activity. Without
GitHub writes stay off until the lock in the status footer is opened (the
choice is kept in the database); locked, approve and comment are blocked and
mark-reads stay in the app:

```
npm run build                                 # electron-vite bundle into apps/desktop/out
```

UI check in fake mode as a plain web page (no Electron):

```
POSTPILE_FAKE=1 POSTPILE_TOKEN=devtok PORT=4877 npm run server
(cd apps/desktop/out/renderer && python3 -m http.server 5177)
open 'http://127.0.0.1:5177/index.html?api=http://127.0.0.1:4877&token=devtok'
```

The renderer syncs on load. Against a real database that means real GitHub
reads and agent calls; use a DB copy with `POSTPILE_READ_ONLY=1
POSTPILE_MAX_AGENT_CALLS=0`.

Fake mode (sample "Move CI to Depot" data, no GitHub, no agent, no database):

```
POSTPILE_FAKE=1 npm run cli -- topics
POSTPILE_FAKE=1 npm run desktop
POSTPILE_FAKE=1 npm run server
```

Env switches:

- `POSTPILE_READ_ONLY=1`: real reads, every GitHub write refused, the
  footer lock cannot be opened. Use this for smoke runs against the real
  account.
- `POSTPILE_MAX_AGENT_CALLS`: agent-call cap for syncs the app starts
  (launch and "Sync now"), default 150 (was 30). The CLI uses `--max-agent-calls`.
- `POSTPILE_CLAUDE_DIR`: the Claude Code folder the work context sweep
  reads, default `~/.claude`. `POSTPILE_SWEEP_MODEL`: its model, default
  `opus`.
- `POSTPILE_DB`, `POSTPILE_INSTRUCTIONS`: override the database
  (default `~/Library/Application Support/PostPile/db.sqlite`) and the
  instructions file (default `~/.config/postpile/instructions.md`).
- `POSTPILE_TOKEN`: fixed token for the standalone server.
- `POSTPILE_POLL_SECONDS`: live poll interval in the desktop app, default
  10, 0 turns it off. `POSTPILE_PING_CAP`: ping decision calls per 24h,
  default 200 (then rules only). `POSTPILE_MAC_NOTIFICATIONS=0`: no Mac
  notifications, the poll still refreshes tiles.
- `POSTPILE_MODEL`, `POSTPILE_GLANCE_MODEL`,
  `POSTPILE_AGENT_CONCURRENCY`: agent knobs.
