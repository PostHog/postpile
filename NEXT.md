# Where things stand

Snapshot after engine memory v2 landed (dossiers, facts, batched glances,
consolidation). DESIGN.md has the full design; this file is the short "what
now".

## Done

- Agents propose moves (2026-10-09, for 0.27.2; DESIGN.md
  "propose_topic_change"): `propose_topic_change` gets kind `move` (PRs
  into an existing topic, `into_topic`), with the split's checks (PRs in
  the source, stacks whole, one PR stays) and the merge's target check.
  Accept assigns the PRs like "Move to topic…". No migration: kind is
  free text and `into_topic_id` / `pr_keys_json` exist. Telemetry
  `proposal_resolved` gets `topic_move`. Also `prs_moved` now counts a
  merge's PRs instead of 0.
- Declared stacks with a fork parent (2026-10-08, for 0.27.1; DESIGN.md
  "Stacks declared in the body"): the live case ("Stacked on [#N](pull
  url)") parsed fine, but #N came from a fork: `findPrsByNumber` answered
  null and `buildStacks` dropped forks. Forks now link by declaration
  (never by branch), the lookup flags them, the walk stops at them.
- Bot findings from inline comments (2026-10-08, 0.27.1; DESIGN.md
  "Stacks land together" › Bot change requests): a review text that says
  little or only points inline ("findings inline") is replaced by the
  bot's first inline comment on that review, "(+N more)" for the rest.
- MCP tool schemas after an update (2026-10-08, DESIGN.md "Refuses after
  an update"): the 0.27.0 server lists every parameter (checked on the shipped
  bundle and in a new Claude Code session); a reconnected old session kept
  the read tools' old schemas. The update message now says a new session
  shows them; a `tools/list` test pins every parameter.
- Stale PR re-reads (2026-10-08; DESIGN.md "Stale re-reads"): each
  freshness check also fetches up to 5 open PRs waiting on the user whose
  snapshot is over 6 h old; the MCP marks snapshots over 1 h "may be
  stale" and asks for a refresh instead of "rarely needed".
- Covered by an untracked PR (2026-10-08; DESIGN.md "Agent notes on
  PRs"): note_pr kind covered no longer refuses a covering PR PostPile
  does not store (often a stack's parent that never notified the user).
  The app looks it up by number, fetches it and stores it as a pull-in
  anchored to the noted PR (no tile of its own); engine `NoteCoverReader`
  (critical quota and paused reads refuse, 20 reads an hour, one per PR at
  a time, "pending, retry" after 12 s). The freshness check now also
  follows the covering PRs of current covered notes, so those notes go
  stale on a new head. A bare `covered_by: "#N"` means #N in the noted
  PR's repo.
- Stacks land together (2026-10-08; DESIGN.md "Stacks land together"):
  "Merge, it is approved" gives way to the stack layer that holds it
  ("Blocked: team-security to review #12"): on a PR's row for layers
  below, on the tile for the whole stack (core `stack-readiness.ts`, spec
  `expectedStackHold`). `PrDetail.botFindings` (core `bot-findings.ts`):
  `pr_context` shows one line of what a bot's change request found.
- MCP review ownership and effort (2026-10-08; DESIGN.md "MCP server" ›
  Review ownership and effort): CODEOWNERS per repo of open PRs, read once
  a day in one aliased GraphQL query (default branch, three places), kept
  in meta `code_owners:<repo>`; `parseCodeowners` / `reviewOwnership` in
  core. `pr_context` says which files each requested team (and the user's
  home teams) own, `whats_on_me` adds "team-x owns N of M files" and an
  effort line on your-move PRs (lines and files in your teams' area, PR
  size, open threads). Capped file lists (100) are said; unknown
  CODEOWNERS says nothing.
- Agent notes on PRs (2026-10-08; DESIGN.md "Agent notes on PRs"): new MCP
  tool `note_pr` (set, renew, clear) through the agent-request outbox,
  table `pr_note` (migration 039). Durable slot (covered, no_action) and a
  lease slot (in_progress, 2 h default, 8 h max); each note is anchored to
  a fingerprint of the PR (head, state, draft, review requests with who
  asked, latest review per reviewer, people's comments with the newest
  one) and goes stale at read time with a named reason. Sets need the
  observation token pr_context prints; retries are idempotent. Shown in
  `pr_context`, per PR in `whats_on_me` (an all-noted your-move tile gets
  its own group after the plain ones) and as a muted line with Clear in
  the PR pane. Never changes whose move, unread or counts (engine test).
  The server instructions got a short block on coordinating review work.
- Glance claim basis (2026-10-08; DESIGN.md "Batched glances" › Glance
  claim basis): glances answer `riskBasis` and `verdictBasis` ("checked:
  …" / "not checked: …"), the prompt forbids stating an unchecked
  description/changes mismatch as fact, stored in `pr_glance.basis`
  (migration 038), shown as a suffix in the MCP glance lines and as a
  muted "not checked" tag in the app. `GLANCE_PROMPT_VERSION` g3: every
  glance regenerates once.
- Nearby edits (2026-10-08; DESIGN.md "Overlapping edits" › Nearby level): insertions are zero-width positions, and a weaker "nearby" level (within 10 base lines, no shared line) shows next to "same lines"; noisy paths are left out of it.
- Overlapping edits (2026-10-08; DESIGN.md "Overlapping edits"): a
  background pass reads which base-side lines open PRs edit (REST file list,
  ranges only, migration 037), and `pr_context` / `whats_on_me` say when
  another open PR in the repo edits the same lines of a file, skipping stack
  mates; a capped diff says "may overlap more". MCP only, no app UI.
- "Depends on" is a merge order, not a stack (2026-10-08; DESIGN.md
  "Stacks declared in the body"): the parser tags each declaration
  `stack` or `depends`; "depends on #N" links only once the two PRs share
  a stored commit, else the header carries `dependsOn`. The walk still
  pulls #N in (no further walking), `pr_context` shows "Depends on … (merge
  after)" and the glance prompt says #N should merge first.
- MCP ergonomics (2026-10-08; DESIGN.md "Thread previews", "JSON
  answers", `pr_context`): the newest unanswered thread on the user's own
  PR as an 80-character preview in `whats_on_me` and `pr_context`
  (`waitingThreads`, core; `PrDetail.waitingThreads`); `pr_context` takes up
  to 10 PRs, prints each topic once and lists unreadable PRs with their
  error; `format: "json"` on the four reads, structuredContent plus the
  same JSON fenced, GitHub text under `untrusted` keys.
- MCP freshness (2026-10-08; DESIGN.md "Sync progress for other
  processes"): the app stores the running sync in meta `sync_progress` and
  the MCP header shows it ("Full sync running since …"); `whats_on_me`
  says "fetched N ago" per tile (`PrSummary.fetchedAt`); bot unread
  reasons are named, not quoted; brief `pr_context` lists no siblings in
  Unsorted; glances go to the user's-move PRs first.
- Stacks declared in the body (2026-10-08; DESIGN.md "Stacks declared in
  the body"): "Stacked on #N", "depends on #N" or "based on #N" in an open
  PR's body links it to #N when no PR's branch is its base. Worked out
  from `pr_body` on every header read, nothing stored; the walk pulls the
  layer in by number (`findPrsByNumber`); the glance prompt says the diff
  includes the parent and that merging lands it; MCP `pr_context` marks
  the stack as declared. Open: the UI shows such a stack like any other
  (no "declared" hint on the stack mark yet).
- The rest of the PR as rows, `pr_snapshot` retired (2026-10-06, for
  0.23.0; DESIGN.md "Big inboxes" › PR storage: the rest of the PR as
  rows, and "Storage jobs"; steps 6 to 8 of normalizing the PR snapshot,
  Later): migration 033 adds `pr_commit`, `pr_timeline` and `pr_file`
  (PK `(pr_key, path)`, duplicates refused), 034 the text columns on
  `pr` (url, sizes, labels, review decision, merger, `truncated`,
  `cap_hits`, `absent_fields`) and `pr_body`, 035 is the version barrier.
  Storage jobs `activity_rows`, `snapshot_strip_2`, `text_rows` and
  `snapshot_retire` backfill, switch (`rows_ready:activity`,
  `rows_ready:text`), then empty and drop `pr_snapshot`; after the text
  switch nothing reads or writes it. Missing stays missing (NULL cap hits
  never vouch, a PR without assignees still refetches). Measured on
  copies at the 0.22.0 state: every PR, its events, glance hash and
  prompt text identical, board and PR details byte-identical; heavy jobs
  3.7 s of work over 9.6 s, longest slice 118 ms, peak WAL 9 MB; used
  space 873 → 852 MB with the 110 MB table gone. Hot-set heap unchanged
  (58 MB on heavy): the lists and text were small. Not tried by hand: the
  app on a real heavy database.
- Bot talk leaves agent work (2026-10-06, for 0.22.0; DESIGN.md "Bot
  talk leaves agent work"): core `bot-talk.ts` (`isBotCommand`,
  `isBotTalk`, `humanDiscussion`, `humanReviews`) and `PrEvent.chatter`
  (migration 032, `pr_event.chatter`). Replies in bot-only threads, bot
  commands ("@codex review", "/trunk merge") and carrier reviews leave the
  prompts' human discussion, the glance hash, topic memory (noise: no
  dossier trigger, not in the delta) and the events agent (never
  awaiting judgement; the judged and request-gone quiet reads count them
  as needing nothing). A bot command
  is quiet by rule ("a command for a bot"). Stored glances stay current
  through `glanceItemInputHashWithBotTalk` (old shape with the bot talk as
  of the glance's createdAt). Spec: `isBotCommandBody`, chatter in
  `expectedEvents`, a `bot_command` comment text in the generator, new
  coverage labels; properties: bot talk added to any generated PR leaves
  earlier events, the glance hash and prompt text unchanged and adds only
  quiet chatter (`properties/bot-talk.test.ts`, `agent/src/bot-talk.test.ts`).
  Sample: lyra's "@codex review" on #1857. Measured on a copy: human
  comments 3,599 → 922, reviews 2,997 → 763, events waiting for the events
  agent 1,430 → 935, memory triggers of the last week 3,898 → 2,017 (52
  dossier updates that week had only bot talk), 0 glances due on update.
- Bot talk answers nobody (2026-10-06, for 0.23.0; DESIGN.md "Bot talk
  leaves agent work" › Bot talk answers nobody): core `talksToBot`;
  chatter is no touch (`touchKindOf`), talk to a bot and carriers are not
  speaking (`lastSpokeAt`: "you already replied", review requests,
  `changesAnswered`), a carrier is no review (`viewerHeadReview`, team
  takers), a thread ending in talk to a bot waits on nobody, chatter ranks
  class 4 in the headline and never ends a "someone replies" snooze,
  lessons leave the user's replies to bots out. Spec oracles follow
  (`talksToBotSpec`); the bot-talk property now covers the viewer's own
  bot talk and whose turn, asks, touch, headline and snoozes.
- Board diet (2026-10-06, for 0.22.0; DESIGN.md "Big inboxes" › The board
  diet; step 5 of normalizing the PR snapshot, Later): board reads
  (`get`, `getMany`, `keepParsed`) leave out comment and review bodies no
  board rule reads (`isBodyReadByRules`, #117's kept-whole rule): in SQL
  after the switch (`postpile_reads_body`), by the same projection on the
  json before it, so a cached copy never changes shape. `FullPr` with
  `getFull` / `getFullMany` for event derivation, the team-role
  re-derive, write actions, drafts, lessons and "Why?" excerpts; `upsert`
  takes only `FullPr`. `for-whom.ts` reads `Pr.mentionedTeams`. Telemetry
  `storage_job_blocked` (once per job per app run) for a job left
  incomplete. Empty bodies stay on the board (carrier reviews read them);
  the PR pane's activity list reads its PR whole (`getFull`: #135's bot
  review fold shows bot comments' first lines). Measured on copies: hot
  set heap 137 → 58 MB on heavy and 53 → 24 MB on normal, read time about
  the same; board, PR details, prompts and glance hashes identical. The
  PR pane was already slim (#122, #124), so its payload did not change.
  Not tried by hand: the app on a real heavy database.
- Discussion as rows (2026-10-06, for 0.22.0; DESIGN.md "Big inboxes" ›
  PR storage: the discussion as rows, and "Storage jobs"; step 4 of
  normalizing the PR snapshot, Later): migration 031 adds `pr_comment`,
  `pr_thread`, `pr_review`, `pr.rows_version` and `pr.mentioned_teams`.
  Every upsert dual-writes the rows; storage job `discussion_rows`
  backfills older PRs from the json and switches reads (meta
  `rows_ready:discussion`) once every PR has rows; `snapshot_strip` then
  removes comments, threads and reviews from the json and ends with a
  non-waiting WAL checkpoint. The PR query now fetches each inline
  comment's review (`Comment.reviewId`, column `review_id`); older rows
  have none. Measured on copies upgraded from 0.21.0: every PR, its
  events and its glance hash identical; hot set heap 212 → 137 MB on
  heavy; backfill 6 s of work over 16 s; used space 979 → 873 MB while
  the file grows 1,284 → 1,403 MB (freed pages stay inside). Not tried by
  hand: the app on a real heavy database.

- Carrier reviews and bot review folds (2026-10-06, for 0.22.0;
  DESIGN.md "The PR pane" › Empty reviews that carry thread replies, A
  bot's review, folded): core `carrier-reviews.ts` (`carriedReplies`,
  `isCarrierReview`; by `Comment.reviewId`, author and time only for
  comments without it) and `bot-reviews.ts` (`foldedBotReviewComments`,
  `botReviewOf`). The empty review GitHub makes for a thread reply no
  longer shows as "X reviewed" in any thread, in the activity or the
  Reviews list (`prPaneView`), is quiet by rule ("only carries replies in
  review threads") and ranks class 4 in the headline. A bot's COMMENTED
  review whose inline comments each open a thread folds into one quiet
  line, "greptile-apps[bot] reviewed · 4 inline comments"
  (`ActivityLine.fold` `bot_review`, key `bot-review:<reviewId>`,
  renderer `FoldedLine`), unless it mentions you. Spec: `sentWithReview`,
  `isCarrier`, `botReviewFold` in `testing/spec-facts.ts`; the generator
  sends thread comments with a carrier review (linked or by time) and has
  an `inline_review` step; property `activityFoldsBotAnswers` now also
  checks carriers and bot-review lines; new coverage labels. Sample: #1857
  (4 greptile comments, lyra's replies in two threads, a human thread).
  FYI: the coverage label "cleared with a move that stood before" sits
  around 1% on any seed (0.65-1.3% measured with and without the new
  steps), so a generator change can tip it.
- Quiet bot threads (2026-10-06, for 0.22.0; DESIGN.md "The PR pane" ›
  Thread context and replies to bots): core `bot-threads.ts`
  (`threadReplyOf`, `isBotThreadReply`, `carriedBotThreadReplies`,
  `botThreadOf`). Thread replies say whom they answer and the file; a
  person's replies to a bot fold into one quiet line per thread
  (`ActivityLine.folded`, renderer `FoldedLine`), quiet by rule, ranked
  below comments in the headline, and they no longer end a "someone
  replies" snooze. Spec restated in `testing/spec-facts.ts`
  (`isBotThreadAnswer`), new property `activityFoldsBotAnswers`. Sample:
  #1857 in fake mode. Gap: whose turn still counts the author's reply to
  a bot as an answer to your changes request (`changesAnswered.replied`).
- Mute until I'm mentioned (2026-10-05, for 0.21.0; DESIGN.md "Mute until
  I'm mentioned"): the Snooze menu's last item. A `muted` snooze per
  tracked PR that only a personal ask ends (`isPersonalAsk`, split out of
  `isPersonalPing`), plus the tile's mark-read and the threads' GitHub
  unsubscribe in one mark-read batch (`MarkReadRequest.subscription`): one
  Undo, and locked it waits as pending writes `mark_read` + `unsubscribe`.
  Unmute subscribes again (`subscribeThread`, pending kind `subscribe`).
  `TileState.muted` drives the "Muted" label and Unmute; a stack or set
  that came back through one PR is `partlyMuted` and offers "Unmute the
  rest" (`TileOffers.unmuteRest`); a snoozed tile mixing a mute with plain
  snoozes is `partlyMuted` too and its Unsnooze is guarded as `mute`. A
  subscription change GitHub did not take waits as a failed pending write.
  An unsubscribe whose mute ended before it went out (a personal ask in the
  undo window) is skipped (`muteHolds`), and so is a subscribe while the PR
  is muted again; a discarded pending Unmute mutes again (`mute_again`,
  from the click time); a plain snooze keeps a mute that still holds.
  Telemetry bucket
  `muted`; the fake engine logs the unsubscribe and subscribe. Gap: a
  watched repo still notifies (see DESIGN), the "N pending mark-reads"
  headline counts a locked mute as two.
- Update checks after wake and hourly (2026-10-06, for 0.21.0; DESIGN.md
  "Self-update"): a 0.19.0 launch checked 3 minutes before 0.20.0 came out,
  the next check was 6 hours of awake time away and the Mac slept, so the
  user sat 10+ hours on the old version. The installer now checks hourly
  (the unauthenticated release check stays at 6 hours, shared per-IP
  quota); `powerMonitor` resume asks the installer to check
  30s later unless one started in the last 30 minutes (wall clock), and a
  found release triggers the release check so the pill shows. Main sends
  `update_check_finished` (trigger, result, version), `update_downloaded`
  and `update_failed` (stage, error code). Unit tests only; the wake path
  is not tried on a real sleep yet.
- GitHub writes on by default, lock in the footer only (2026-10-05,
  DESIGN.md "GitHub writes: lock, action log" › On by default): an install
  that never touched the lock has writes on in the packaged app; an
  explicit "off" stays locked, `POSTPILE_READ_ONLY=1` still wins, and dev
  runs (unpackaged desktop, `pnpm server`, CLI, simulation) keep starting
  locked (`writesOnByDefault`). The first sync with gh working stores the
  default once, logs it (origin `default`) and sends
  `github_writes_changed { enabled: true, from: 'default' }` (the footer
  sends `from: 'footer'`). Pending mark-reads from the locked days go out
  only where the thread is unchanged since the click; moved threads stay
  unread, failures stay pending, cleanups stay pending for the user. The
  footer lock is a faint icon while on, a quiet "read-only" while locked;
  the busy inbox card lost Unlock writes and its writes line, and
  `BusyInboxView.writesLocked` is gone. Fake mode starts with writes on
  (`POSTPILE_FAKE_LOCKED=1` for locked). Checked in the static renderer
  build with `POSTPILE_FAKE_BUSY=1`: footer on, locked, locked with one
  pending; busy card and Why? without the lock. Not tried: the default
  switch on a real database copy with a real backlog.
- No CI (2026-10-05, for 0.21.0; DESIGN.md "CI is not tracked"; step 3 of
  normalizing the PR snapshot, Later): the PR query asks for no checks,
  `Pr` has none, the CI event, the pane's Checks fact, the CLI rollup and
  the "Until CI is green" snooze are gone (a stored one ends like an
  expired snooze). Migration 030 deletes the CI events and their log rows;
  the storage job `checks_strip` removes the old checks from the stored
  JSON; reads drop them meanwhile; every PR read runs in one read
  transaction. Measured: on 12 PostHog PRs the batch response 621 → 471
  KB and 5.3–8.1 → 3.7–4.3 s; heavy copy 93 MB of JSON freed in 138 slices
  (max 54 ms), migration 0.5 s; hot-set heap 283 → 264 MB. Not tried by
  hand: the app on a real database.
- "Wrong topic" sticks (2026-10-05, DESIGN.md › Product model): a PR the
  user took out of a topic stays out of it. Pure rule `excludedTopicIds`
  (core; follows accepted merges), read per run by `TopicExclusions`
  (engine) from the feedback log and accepted merge proposals, no new
  table. The stack shortcut skips an excluded topic and asks the agent;
  the assignment prompt gets a per-PR "took this PR out of these topics"
  note with ids and fenced names (`TopicAssignmentInput.notIn`), also for
  topics no longer offered, and an answer that picks one, by id or by a
  "new" name matching its name, counts as left out before anything is
  created (retry, else Unsorted). The topic tidy folds nothing that puts
  a PR together with a topic it left (either way round, re-read per
  fold) and splits nothing into it. "Wrong topic" on a stack now logs one
  row per layer that moved. Also fixed: an assignment answer no longer
  overwrites a topic the user picked while the call ran. Topic assignment
  has no input hash, so no cached answer goes stale.
- No "Not mine" on a Not yours tile (2026-10-05, for 0.21.0; DESIGN.md
  Product model › "Action details"): core's `TileOffers.notMine` leaves it out of
  the tile's ⋯ menu while the verdict pill says Not yours, read from
  `tileVerdict` (now its own module, `tile-verdict.ts`). The menu was the
  only place offering it. Sample #1940 (Desktop app release) carries a
  Not yours glance for checking it in fake mode.
- Newer-schema guard (2026-10-05, DESIGN.md "Safety while building"): a
  build refuses a database whose schema version is above its newest
  migration, before any pragma or migration writes; the desktop app shows a
  dialog and quits. Step 1 of normalizing the PR snapshot (Later). Builds
  up to 0.19.0 have no guard.
- Slim PR pane (2026-10-05, DESIGN.md "The PR pane" › "What the pane
  loads"): `PrDetail.pr` is core's `PrPaneView` (`prPaneView`), with a
  checks summary from `summarizeChecks` (`checks.ts`, for the coming
  checks-summary storage step too). No comments, threads, commits,
  timeline or check contexts go to the renderer any more; activity, replies
  and reactions keep working from `PrDetail.activity`. Measured on a
  migrated copy of a real database (87 open PRs, bot bodies not yet
  trimmed): average response 171 KB to 72 KB, biggest 1.18 MB to 389 KB;
  the `pr` part 106 KB to 7 KB on average, 814 KB to 24 KB at most. MCP
  `pr_context` and the CLI read the same view, unchanged output. Sample
  PRs now carry five check runs so the Checks fact shows counts in fake
  mode, and a fake reply shows in the activity like after the real
  engine's refetch. Checked in the static renderer build: the pane renders
  pixel-identical before and after (#1902: glance, key files, review row,
  description, facts, reviews, activity), the pane text matches on 26
  sample PRs, and reply, thumbs up and approve go through.
- PR detail without the raw events (2026-10-05, DESIGN.md "The PR pane" ›
  "What the pane loads"): `PrDetail.events` is gone (only the CLI read it;
  it now has `listPrEvents`), and every `activity` item is an
  `ActivityEvent` cut to what a row draws. Nothing shown was cut. On the
  same copy: average response 72 KB to 28 KB, biggest 389 KB to 158 KB;
  every open PR keeps its lines, bodies and folded rows, and the CLI still
  prints all 272 events of the biggest. Checked in the static renderer
  build: #1902 pixel-identical to main, pane text the same on 26 sample
  PRs, folded bot rows with their reasons, Unmute, Reply and thumbs up go
  through. Possible next step: load the bot/CI fold on demand (50 KB on
  the biggest PR).
- Busy inbox card (2026-10-05, DESIGN.md "Big inboxes" › "The busy inbox
  card"): while the board cap cuts the inbox, the sidebar shows a calm amber
  card right above the topics, with the aching robot, the quiet PR count,
  what is kept per tier, Clean up (the cleanup dialog) and an inline Why?
  (Unlock writes removed the same day: the lock lives in the footer only).
  It folds to one line for the session. `useBusyInbox` reads
  `GET /api/busy-inbox`, refetched with everything else. Checked in fake
  mode (`POSTPILE_FAKE_BUSY=1`) in the static renderer build: the card,
  Why? open, Clean up opening its dialog, the folded
  line, the default and the 200px sidebar. Not tried: a real busy
  database, and dark mode (the app has no dark theme yet, so it looks the
  same).
- The hot board (2026-10-05, DESIGN.md "Big inboxes: what PostPile loads
  and works on"): the board holds only PRs that are unread on GitHub, open
  and tracked, or active in the last 7 days, each with its whole stack and
  set; the rest stays in the database, cold, until there is news on it.
  Past 1,500 PRs the inbox is busy: the user's own and personal asks go
  first, then the home team, and everyone else gets nothing. Cold topics
  and PRs are read on demand (`Board.forTopic`, `forPr`, `forTile`,
  `forPrs`) for the topic pane, the PR pane, MCP reads, search, ping
  clicks, retiring and the debug views. Migration 028 splits `pr` into the
  PR header and `pr_snapshot` (the json) and adds a partial index for events aimed at
  the user. `GET /api/busy-inbox` carries the numbers for the busy inbox
  card (above; `POSTPILE_FAKE_BUSY=1` in fake mode), and
  `board_trimmed` goes out at most hourly while busy. Work follows the
  same slice: a sync fetches threads older than a week only when unread
  and aimed at the user or on their own open PR, nothing for others while
  busy, and the 2-minute backlog drain stops once the board is full; topic
  assignment, event classification, dossiers, sets and consolidation skip
  cold PRs and topics that went cold (`work_shed` counts what was left
  alone, hourly). On a 14x copy a load went from 1.1 s to 0.3 s and the
  heap from 1.9 GB to 0.35 GB, and a start without snapshots plans 1,233
  PRs instead of 9,660; on a normal copy only the sidebar's counts of old
  settled tiles changed. Not tried by hand: the app on a real heavy
  database.
- Bot bodies cut when saved (for 0.18.1; DESIGN.md "Bot bodies are cut
  when saved"): a bot's comment, thread comment or review body is stored
  cut to 3,072 code units with "… (trimmed by PostPile)", at normalize
  time, so every fetch path stores it cut. People's, merge queue bots' and
  person-edited bot bodies stay whole, so the rules read the same: no event
  id, kind, loudness or summary changed between the stored and the cut
  snapshots on a normal and a heavy copy. A machine comment's event that
  flips between deploy and bot_comment is renamed in `upsertDerived`, with
  its seen time, override and earliest event-log seq. `BotBodyTrim` cuts
  what is stored once (desktop app, `startBotBodyTrim`): 30 s after start,
  never during a sync, poll, consolidation or catch-up, ~30 ms steps 20 ms
  apart, resumable, events left alone. Migration 029 adds
  `pr.snapshot_revision`, a new value from a store-wide counter on every
  snapshot write, which the parse caches compare instead of fetched_at.
  Mark read's Undo, failed send and parking find a renamed event by its
  other kind. The DB opens with
  `journal_size_limit` 64 MB and the job empties the WAL at the end without
  waiting. Measured on copies: JSON 66 → 51 MB (normal) and 925 → 712 MB
  (heavy, 14x); the job took 0.6 s and 9 s (140 steps, longest 48 ms,
  peak WAL 7 MB); the 1,500 newest PRs parsed 283 → 231 MB of heap. Deriving
  every PR again afterwards moved 281 and 3,934 deploy events to
  bot_comment, made no event new and left no seen event unseen. The file
  keeps its size (no VACUUM, 7 s on heavy) and reuses the freed pages. Not
  tried by hand: the app on a real heavy database.
- Storage job runner (2026-10-05, for 0.20.0; DESIGN.md "Storage jobs";
  step 2 of normalizing the PR snapshot, Later): one `StorageJobRunner`
  runs one-time rewrites of stored data in order, with the bot body trim
  ported as job 1 under its 0.19.0 meta keys (an install mid-trim resumes,
  a finished one never runs it again). Slices are `BEGIN IMMEDIATE` with a
  busy timeout of 0 for that call, rescheduled on SQLITE_BUSY, ~30 ms with
  the expected commit set aside, 50 ms apart (was 20 ms); paused while a
  sync, poll, consolidation or catch-up runs and while the Mac sleeps. A
  job is done only when its check passes; a second failed check leaves it
  incomplete and the jobs after it wait. `storage_job_done` reports each
  finished job. `startBotBodyTrim` is now `startStorageJobs`. The final
  WAL checkpoint the trim ran is gone, and with it `Store.checkpointWal`:
  it could copy a large WAL on the main thread in one call; SQLite's
  automatic checkpoint and the 64 MB journal size limit keep the WAL
  small. Jobs may write any rows inside their slice; revisions move only
  when a PR read changes (GPT-6.1 review). Measured on copies: normal 14
  slices, longest 41 ms, 1.1 s wall; heavy 190 slices, p95 40 ms, longest
  46 ms, 5.9 s of work, 16 s wall, peak WAL 10 MB (it stays that size and
  is reused); a second pass on heavy wrote nothing and moved no revision.
  Not tried by hand: the app on a real heavy database.
- Calm wake and crash signals (2026-10-05, DESIGN.md "Memory on big
  boards"): after a wake the renderer no longer refetches every query
  (`refetchOnReconnect: false`; `networkMode: 'always'`, so no network
  does not pause the local API either). On `powerMonitor` `suspend` the
  auto sync's timer stops (`Engine.noteSuspend`), and on `resume` the next
  auto sync waits at least 3 minutes (`Engine.noteWake`,
  `AutoSyncSchedule.wake`, from the kept due time on the wall clock). A run that ends
  without a clean quit leaves `running.json` in userData, and the next
  start sends `app_crashed_last_run` (`version_changed`). `sync_completed`
  gained `heap_used_mb` and `heap_limit_mb`. `crashReporter` keeps
  minidumps locally (`uploadToServer: false`, Electron's default
  `crashDumps`, `<userData>/Crashpad`). Checked in a fake-mode Electron
  run: `resume` emitted through the main inspector held a due sync 3
  minutes and kept a later one, a `suspend` held a due time that passed
  until the `resume`, a brand-new data folder starts, `process.crash()`
  left a dump and the marker and the next start logged it, SIGTERM and the
  fake "Restart to update" stayed clean. Not tried: a real sleep and wake,
  and whether a V8 out-of-memory abort leaves a dump.
- Memory on big boards (2026-10-05, DESIGN.md "Memory on big boards"): a
  heavy install (about 5,000 tiles, 11k PRs, 485k events, on 0.16) crashed
  out of memory in the main process. Boards are now shared per data change
  (5 s at most), the PR parse cache fills in chunks, events are iterated,
  and at most two catch-up runs go at once. Telemetry gained
  `github_writes_changed` and `writes_on` on `sync_completed`. Reproduced
  and measured on a 14x copy of a normal database. Nothing stored ages
  out still; the hot board (above) keeps the board from growing with it.
- Interruptions (2026-10-05, DESIGN.md "Interruptions"): Mac notifications
  are opt-in. Three modes, kept in meta `interruptions_mode`: never (the
  default, nothing reaches the Mac), in batches (a roundup at 9:30, 13:30
  and 16:30 on weekdays for what is still not handled) and as soon as it
  matters (the old live pings). Picked in a new setup step "Your day" and
  in the sidebar footer's "Interruptions" menu, which also holds "Send a
  test notification" (moved from the status footer). `PingDelivery` in the
  engine routes the poll's pings; queued and shown pings sit in `mac_ping`
  (migration 27). The Dock badge counts tiles with a ping not handled yet,
  no badge under Never; it used to count unread topics. The welcome
  notification, and with it the macOS permission prompt, comes only after
  an opt-in. Installs that never chose (`InterruptionsView.chosen` false,
  e.g. from before 0.18, when pings were on by default) get a one-time
  dialog, `InterruptionsPrompt`, with the same three cards and Never
  preselected; Save, Esc or a click outside all store a mode, so it never
  comes back, and it closes only once that save landed (a failed one keeps
  it open). It never stacks on setup or the inbox cleanup start dialog.
  Checked in fake mode: the setup step, Accept storing the pick, the
  sidebar menu switching it, the prompt (Save, Esc and a click outside
  each store a mode, gone after a reload; not on top of setup; only after
  the inbox start dialog is answered). Not tried by hand: a real roundup on the Mac, the badge on the
  real Dock, the permission prompt after an opt-in, the prompt on a real
  pre-0.18 database.
- Agent chat sending (2026-10-05, DESIGN.md "Topic chat", "Ask the
  agent"): the message shows at once with a "Thinking…" bubble, the list
  stays on the newest message, the input is a growing textarea (Enter
  sends), and a failed turn stores nothing and puts the text back.
  Kept-open CLI sessions and streaming were checked and left out: prompt
  caching already works across one-off calls and the process start is
  about 0.25s of a ~4.5s answer.
- PR pane actions (2026-10-05, DESIGN.md "The PR pane"): review row
  (`ReviewRow`) right after the glance with a GitHub review-state label,
  housekeeping as a quiet line under it (`PaneHousekeeping`), one "Open on
  GitHub" with a place menu (`OpenOnGitHub`), one inline `Composer` for
  approve-with-note, comment review, Ask and replies, Reply and React on
  every person's comment in the activity, "Reply ↓" jumps from "New
  since", Recheck and "Tell the agent" on the glance title, and the
  topic-scoped `AgentPane` that takes over the right pane ("Ask the agent"
  in the topic header). Replaced `ActionBar`, `ApproveButtons`,
  `ComposePopover`, `RemoveTeamButton` and `TileChat`.
- PR pane backend: reply, thumbs up, reply drafts, topic chat (2026-10-05,
  DESIGN.md "Reply to a comment", "Thumbs up", "Reply drafts", "Topic
  chat"): `replyToComment` (inline comment: reply in its review thread;
  issue comment or review body: a PR comment quoting its first line and
  mentioning the author), `react` (thumbs up on a comment or review),
  `draftReply` (from the thread or conversation, or from the user's gist),
  an optional `gist` on `draftReviewNote`, and `topicChat` /
  `getTopicChat` stored under `topic:<id>`. The reader fetches
  `viewerReacted` on comments and reviews. Routes under the PR path
  (`/reply`, `/react`, `/draft-reply`) and `/api/topics/:id/chat`; the fake
  engine does all of it in memory and sample #1902 has an author reply in
  its thread. The tile chat is removed (routes, engine, prompt tile mode).
- Inbox catch-up dialog (2026-10-03, DESIGN.md "Inbox cleanup"): replaces
  the old cleanup banner and dialog. Unread merged PRs (quiet 7+ / 14+ days
  or all) and everything else older than 14 / 30 days, cleared on GitHub in
  the background (older-than PUT, repo PUTs where a repo holds nothing
  else, then one PATCH a second; one pending write while locked). On a
  first run or after 2+ days away with 20+ merged PRs the start sync holds
  after its fetch until the dialog is answered, so no agent work goes to
  PRs that are over. Sidebar line "12 merged PRs · Clear" any day, with
  "✨ 8 of them look safe · Clear" next to it: merged PRs whose current
  glance says LOOKS_SAFE or NOT_YOURS, cleared right away through the same
  run and lock, never starting a glance.
- Lessons from your reviews (2026-10-02, DESIGN.md "Lessons from your
  reviews"): a change request on a PR the glance called safe (or low risk,
  or not yours) on the same commit is noted with structured evidence
  (glance, review body, inline comments); `lesson_write` turns it into a
  "when X, do Y" line or none; the topic shows "Remember for future
  assessments?" with Remember in this topic (tailoring) / Use across
  topics… (instructions diff that may only add the line) / Dismiss. "Teach
  future assessments" in the detail pane does the same from the user's own
  words. Edited reviews restart a candidate, deleted ones and retired
  topics withdraw it. Unaccepted lessons reach no prompt.
- Proposal quality (2026-10-02, DESIGN.md "Consolidation" › "Proposals must
  earn their interruption"): pending proposals naming a retired, archived
  or gone topic (and topic rules scoped to one) turn `withdrawn` on every
  full sync and whenever a topic leaves the sidebar; withdrawn is not a
  rejection in the consolidation prompt or the repeat checks. Answers drop
  proposals and rules with an empty, short or placeholder reason, rules
  without one worded correction behind them, and topic changes or rules
  the user already rejected (merges in either direction). The prompt asks
  merges for the shared goal and the gain, rules no ground in bare clicks,
  and says no proposals is the usual answer. No consolidation prompt
  version constant exists (its answers are not cached), so none was bumped.
- Merge queue state (2026-10-02, DESIGN.md "Merge queue"): `mergeQueueState`
  reads trunk-io[bot]'s status comment; the PR icon turns into the Octicons
  merge-queue icon (amber, red once failed) on rows, the detail header, the
  sidebar row and the header pill; "Merge queue: Testing" replaces the
  review chip; own queued PRs wait on the queue, failed ones are the user's
  move ("Re-submit to the merge queue") and loud. Fake mode: #1977 submitted,
  #1978 waiting, #1975 testing, #1974 merged through the queue (topic
  "Runner image pinning", amber rollup),
  #1950 failed (CI & tests, red rollup).
- Lasting sets (2026-10-01, DESIGN.md "Tiles hold still"): the set prompt
  asks for PRs one judgement covers and answers with changes only; a regroup
  runs on new triggers only (open PR in no set, risk level change, feedback,
  instructions), after the glances; merged members stay; every change is in
  `pr_set_change` (migration 022) and shown in the CLI and MCP topic views.
- Topic tidy after an upgrade (2026-10-01, DESIGN.md "Topic tidy after an
  upgrade"): the first full sync below `TOPIC_GRAIN_VERSION` 2 merges topics of
  one project and splits catch-alls once, by itself; merges are recorded as
  accepted proposals from the upgrade.
- One call per topic, behind `POSTPILE_TOPIC_DIGEST=1` (2026-10-01, DESIGN.md
  "One call per topic"): dossier and the topic's first 18 glances in one
  `topic_digest` call, plus the topic's set changes when a regroup is due;
  the rest stays in glance batches and the set job. Off by default until the
  side-by-side comparison.
- PR assignees and ownership (2026-09-30, DESIGN.md "PR ownership: bot PRs
  belong to their assignees"): the PR query reads `assignees(first: 10)`,
  kept in the PR JSON (`Pr.assignees`, no migration). Core `prOwners`
  (author, or a bot author's assignees) drives tiers, whose turn, for whom,
  queues and filters, team requests, changes answered, loudness, pings,
  quiet reads, why-here, topic relation and driver, faces, "Ask <owner>"
  and the own-PR prompt note; shown authorship stays `pr.author`. The
  finder adds `is:pr is:open assignee:@me`: it finds every PR assigned to
  you, and only bot PRs become yours (bot hits `own_open`, a person's PR
  the new `FoundVia` `assigned`, code AS, "For you", still the author's). PR rows
  and the detail pane show "assigned to" (faces, two then "+N") when
  someone other than the author is assigned. Sample data: #1970 (the
  viewer's agent PR) and #1972 (three teammates' agent PR). Not changed:
  the setup sweep's activity search (still `author:@me`) and the title bar
  search (matches the author, not assignees).
- Team roles (2026-09-30, DESIGN.md "Team roles"): each of the viewer's
  teams is home or routing. Home teams behave as before; a routing team
  only brings its review requests (routed on any PR, taken by anyone's
  review of the head, neutral "For <slug>" chip without band) and quiet
  mentions, and its members are not teammates. Rules decide from the last
  90 days of reviews (`classifyTeams`: 20% of reviews through the team and
  at most 10 members; size alone under 30 reviews), in the setup sweep and on
  the next sync of installs without roles or for a newly joined team (not
  while the GitHub quota is low, and 2h after a failed try); meta
  `team_roles`. The user flips a role under the sweep and in "Your teams"
  below the instructions (`GET/POST /api/team-roles`); a flip sticks.
  A role change derives stored events again from their snapshots, so team
  mention loudness follows at once.
  `TeamMembers` fetches home teams only; no home team means no teammates
  and no Team filter. Fake mode has client-approvers as a routing team.

- Rules layer: one home per fact (2026-09-29, DESIGN.md "Rules layer: one
  home per fact"): one module per predicate family (automation, who a
  review request asks, did you act after X, which events ask). Every read
  goes through one planner (`planRead` in `core/read-plan.ts`), waiting
  GitHub writes through `pendingWriteStep`. Snoozes are per PR (migration
  019 `pr_snooze`); every snooze ends on merge or close. Topic status
  has one writer (`nextTopicStatus` / `changeTopicStatus`, `retiredAt` in
  migration 020). Loudness and pings are decision tables. PR facts
  (`PrSummary.facts`) and button offers (`TileView.offers`) come from
  core; the renderer and the fake engine only read them. Invariant tests
  over real-shaped boards, every sample tile and MCP `pr_context` against
  the pane. A snoozed tile with nothing left to mark leads with Open in
  footer and pane. Property tests over generated boards check the rules
  against spec oracles restated from the raw snapshot (2026-09-30,
  DESIGN.md "Tests across rules").

- Fixes from the codebase review (2026-09-29, DESIGN.md "Fixes from the
  codebase review"): a Codex CLI review of v0.11.0 found nine issues,
  eight confirmed and fixed. Pending reviews and pending review comments
  never count (dropped in normalization, `viewerSpokeAfter` skips
  PENDING). Approve sends the head on screen and is refused when the
  stored head moved (`NEW_COMMITS_SINCE_LOOKED`). The PR query asks for
  totalCount on every capped activity list; a cut-off snapshot
  (`Pr.truncated`) never passes `snapshotCoversThread`. The MCP process
  reads instructions without storing a version (`storeReadOnly`). Whose
  turn counts every standing change request (`standingChanges`). A
  pending cleanup the lock stops mid-send stays pending. Stale lock
  takeover runs under a mkdir mutex (`postpile.lock.takeover`, with
  `removeStaleLock` inside it). Topic and area names only appear inside
  the data fence in prompts (`prompts-fence.test.ts`) and are cleaned
  where stored (`cleanTopicName`, `hasEmptyTopicName`, migration 018,
  which also lets migrations carry a code step). The Codex review on
  PR #18 tightened truncation, the lock, the fence and empty names. The ninth (a broken
  snooze comes back once the mention is read) waits under DESIGN.md
  "Open questions for Julian".

- Actions act on what you look at (2026-09-29, DESIGN.md "Actions act on
  what you look at"): PR-scoped mark read in the detail pane
  (`markPrRead`, per-PR label and undo), the not-done dot
  (now the unread dot, core `TileView.unreadPrKeys`), opened-in-PostPile
  handles the PR (checked per PR), the lead PR follows the turn (core
  `leadPrKey`, shipped in `TileView.offers`), "X to re-review"
  (`reReviewAsked`), own merged PRs clear quietly, and "Remove <team>"
  (removes a team review request, unsubscribes, marks done).
  Checked in fake mode: set dots, detail pane on a set (no Snooze, no mark
  button on a PR that is still your move), Remove team-platform with its
  confirm, and an opened stack layer turning done by itself.

- Setup fit check (2026-09-29, DESIGN.md "Setup flow" › Fit check): a
  tester's Preferences came out as rules for coding agents ("don't push
  write-ups onto PR branches", "signed PRs land only with my approval"),
  taken from the work context digest. The draft and refine prompts now
  say what PostPile does and keep such rules out of Preferences. The
  Accept step runs one `setup_fit` call (Sonnet, toolless, only the
  user's text) and lists notes per line: no effect, other section, too
  vague, each with Remove / Move / Use the suggestion / Keep as is
  (`mapSetupFit` in core, `applyFitFix` in the renderer). Review cards
  say what each section is for (`SECTION_HINTS`). The live poll now
  answers `blocked: setup not finished` while first-run setup is open:
  the same tester's install ran about 40 catch-up runs during setup,
  before any instructions existed. Telemetry: `setup_fit_checked`,
  `setup_fit_fixed`. Checked in fake mode with a headless walk through
  all four steps.

- Selection stays put (2026-09-29, DESIGN.md "Queue sections" › Selection stays
  put): after an approve the view no longer jumps to the next topic or
  tile. `lib/selection.ts` keeps what was on screen per nav entry and
  filter key (`KeptView`, queue filter plus the query the search results
  answer); `visibleTopic` shows the kept topic before the first match,
  `listedTopics` keeps it in the sidebar, `resolveSelection` follows a
  vanished tile id by its PR, and the grid keeps the selected tile in
  search matches and in the Unread list. Checked in fake mode: approve
  under Review (used to jump to Move CI to Depot, now stays and the done
  tile stays selected in the open Done fold), approve inside the Turbo set
  (never jumped in fake mode; sample tile ids do not change), approve with
  Unread on (tile used to vanish from the list). Open: clearing a filter
  goes back to the picked topic's first tile, not the tile last open under
  the filter (entries are not pinned while narrowed).
- Honest mark button, Snooze after read (2026-09-29, DESIGN.md "Tile
  faces" › After a mark-read): core `tileAfterMarkRead` runs `isPrDone` and
  `whoseTurn` over the data as a mark-read leaves it, shipped as
  `TileView.afterRead`. Core `tileOffers` / `paneOffers` (`offers.ts`,
  shipped as `TileView.offers`) pick the label for the tile footer and the
  detail action bar: "Mark read" on unread tiles, "Mark done" only where a
  mark-read makes the tile done; read and still your move, Snooze is the
  ink button plus "Review on GitHub" (files tab; "Open on GitHub" on own
  PRs) and the action bar drops the mark button. `lib/mark-read.ts` keeps
  only the toast. Read titles go regular weight. The toast says "Marked read. Still your move: re-review." with
  Undo and "Snooze until next push". `tileListRank` keeps read your-move
  tiles with the unread ones, so a mark-read never moves a tile down.
  Checked on sample #1960 and #1870.
- What is new on revisits (2026-09-29, DESIGN.md "Tile faces" › Why now on
  a revisit, "Three-pane balance" › New since you looked): core
  `whatsNew(events, viewer)` finds the viewer's last touch (own review,
  approval, comment, push, else a mark-read) before the unseen loud events
  and picks the lead (ask or reply > re-request > verdicts by others >
  pushes > other), shipped as `PrSummary.whatsNew` / `PrDetail.whatsNew`.
  The unread strip says "6 commits since your changes request" etc.
  (`lib/whats-new.ts`, `stripNews` / `stripMoreCount` in `lib/tiles.ts`);
  first-time asks keep the event's words. The "New since you looked" box
  moved under the title (`NewSinceBox`) with 3 lines, "N more" and the
  quiet events folded ("2 bot comments, CI", `activity.freshNoise`); the
  activity list below only keeps earlier events. Sample #1960 is a revisit
  (3 commits after your changes request, two bot comments, CI), #1801 a
  first-time ask.
- Glance catch-up and hourly auto sync (2026-09-29, DESIGN.md "Glance
  catch-up", "Auto sync"): a poll cycle that brings a loud event or a PR
  without a glance runs a scoped digest for that topic right away
  (`TopicCatchUp`: dossier, event second opinion, glances with retry, fact
  reconcile), coalesced per topic by `CatchUpQueue` (one running, one
  queued follow-up), never beside a full sync or consolidation. Per-run cap
  from the topic size plus a daily cap (`POSTPILE_CATCHUP_CAP`, default
  600, in memory). Catch-up calls land in their own run
  (`catchup:<topic>:<time>`, AsyncLocalStorage in `AgentCallLog`). A full
  sync runs every 60 minutes in the background (`AutoSyncSchedule` in the
  engine, `POSTPILE_AUTO_SYNC_MINUTES`, counted from the end of the last
  sync). PRs carry `glanceState` (ready, queued, writing, failed, agent_off,
  capped, none); the renderer says "Writing the glance…", "Glance queued",
  "Glance failed" + Retry (`POST /api/prs/:owner/:repo/:number/glance/retry`),
  "Agent features are off", "Waiting: daily agent limit reached, next full
  sync in N min". The live status carries `syncRunning`, `nextAutoSyncAt`
  and `catchUpChanges`, so background syncs show in the title bar and tiles
  refresh when a run ends. FakeEngine walks one PR queued -> writing ->
  ready and has one failed PR to retry.
- Stack mark (2026-09-29, DESIGN.md "Stacks as one unit"): stack layers get
  a light-blue layers tag with "1/3" between `#number` and title on PR rows
  (stack tiles, stacks in sets, detail member list) and before the detail
  title; lookup `stackPlaces` in `lib/stacks.ts`, tokens `--stack-tag*`.
  The detail branch line's "layer X of N" now also shows for a stack inside
  a set. Fake data: #1902 left the `set:turbo-cache` set (it was in the
  Depot stack too, breaking the one-unit rule); lyra's two-layer stack
  #1904/#1907 joined the set instead, so the mark shows inside a set.
  Low-risk glances no longer get a RISK box.
- No more permission prompts from PostPile's own children (2026-09-29,
  DESIGN.md "Missing tools" PATH, agent runner, sweep): fix-path removed,
  PATH built from `/etc/paths(.d)`, config `toolPath` and the usual install
  folders, no login shell run at launch (also drops ~150 ms from launch).
  gh and claude run in `<data dir>/agent-cwd`; claude calls add
  `--disable-slash-commands --no-chrome` and env that turns off the
  autoupdater, side traffic, CLAUDE.md and auto memory loading and claude.ai
  MCP connectors (flags checked against `claude --help` 2.1.284, env names
  in its binary). The sweep skips symlinks under `~/.claude/projects` and
  refuses CLAUDE.md or include paths in macOS privacy folders. Not tried in
  a packaged build on a fresh machine yet; ad-hoc signing still resets
  grants per update (separate work).
- Always place PRs (2026-09-29, DESIGN.md "Topic assignment against
  fragmentation"): a copy of the real database had 61 PRs stuck in Unsorted.
  The agent could answer "unsorted", a 5-new-topics cap sent the rest there
  too, and both waited for a consolidation the desktop app never ran. Now
  every PR gets an existing or a new topic (no cap; the prompt asks for
  broad names after the work, never the PR title). Missing, invalid or
  "unsorted" answers get one retry batch in the same sync; what is left is
  asked again next sync. Batches of 40 sorted by repo and branch, so related
  PRs meet. Migration 015 deletes the old `topic_deferred:*` rows. The
  desktop app now checks every 30 minutes whether consolidation is due.
- Stack visibility (2026-09-29, DESIGN.md "Stack completion", "Stacks as
  one unit"): stacks could go missing or read as plain sets. Fixed in
  core and the GitHub reader:
  - GitHub's own retarget after a merge is an
    `AutomaticBaseChangeSucceededEvent`, not a `BaseRefChangedEvent`, so
    the merged bottom layer fell off and the open layers above formed a
    pulled-in-only chain with no tile. Both are read now. Stored
    snapshots heal when the PR is next refetched (freshness check or a
    new thread).
  - A fork in a stack continues with the open child, not just the lowest
    number, so a closed attempt no longer strands its open replacement.
  - `stackTopicId` prefers active topics, so a newer membership in a
    retired topic no longer hides the whole stack; joining a stack's
    retired topic revives it.
  - Fork PRs (`isCrossRepository`, now in the PR fragment) never link.
  - `Tile.stacks` carries the stack structure (bottom first) for stack
    tiles and for stacks inside sets. The renderer draws it as the stack
    mark (see the next entry).
  - Real-data check on a DB copy: 13 of 15 built stacks showed before
    (4 of them inside sets, without structure); after the fixes and a
    refetch of the pulled-in layers every built stack (14, one pair
    merged into one) shows in a topic, and every set that holds a stack
    carries it in `stacks`.
- Update reminder (2026-09-29): the server asks GitHub for the last 10
  PostPile releases (unauthenticated, ETag kept in memory, 10s timeout)
  ~30s after start and every 6 hours, `GET /api/update` serves the last
  answer (`compareVersions` / `pickUpdate` in core; pre-releases count).
  The title bar shows a neutral `UpdatePill` ("Update available ·
  0.1.0-alpha.1") with a popover: date, release notes link, `brew upgrade
  --cask postpile` with Copy, and "Later" (per version, localStorage).
  `POSTPILE_UPDATE_CHECK=0` turns it off; sample data shows a sample
  update unless `POSTPILE_FAKE_UPDATE=0`. Not tried against a real
  release yet (fake mode and unit tests only).
- Self-update (2026-10-03, DESIGN.md "Self-update"): the packaged app
  downloads a new release itself (electron-updater in main, GitHub
  provider, `src/main/self-update.ts`) and the pill and bar offer "Restart
  to update" once Squirrel.Mac staged it, "Downloading the update…" before
  that, and the brew command when the app can't update itself. App menu ›
  Check for Updates… runs both checks with a dialog. Signed releases carry
  `latest-mac.yml` and the `.blockmap`; the cask says `auto_updates true`.
  `POSTPILE_AUTO_UPDATE=0` turns only the download off;
  `POSTPILE_FAKE_INSTALL` picks the sample state.
- PR state icons, 3a design (2026-09-29, DESIGN.md "Tile faces"): PR rows,
  tile headers and the detail pane show the state as GitHub-style icons
  and words (open / draft / merged / closed / queued, needs review /
  approved / changes requested, DRAFT chip), stack and set rows in one
  tinted box. The segment pill is gone and CI only shows in the facts;
  the renderer no longer adds "CI is failing" to the RISK box.
- PR description (2026-09-29): the body renders as markdown in a 160px
  scroll box with Expand under the action bar (react-markdown +
  remark-gfm, no raw HTML, template comments stripped, remote images not
  loaded).
- Key files (2026-09-29): glances name up to 3 changed files to open first
  (`keyFiles`, migration 016, glance prompt g2 so every glance regenerates
  once), shown as "Look at first" with +/- and a link to the files tab.
  Not tried against real agent answers yet (unit tests and fake mode).
- Stale focus rings on tiles fixed (2026-09-29): back / forward blur the
  old view's focused row, and a global focus-visible style replaces
  Chromium's default ring.
- Usage analytics (2026-09-29, DESIGN.md "Usage analytics"): on by default,
  env-only opt-out (`POSTPILE_TELEMETRY=0` / `DO_NOT_TRACK=1`), sent to
  PostHog's "PostPile" project. One `Telemetry` class in
  `packages/engine/src/telemetry/` (posthog-node, server/engine process
  only) plus a no-op used when off; the renderer reports its own UI events
  through `POST /api/telemetry`, validated against the shared catalogue in
  `packages/core/src/telemetry-events.ts`. Pseudonymous identity: the
  viewer's numeric GitHub id, sha256-hashed, aliased from a random install
  id once the viewer is known. No session replay, no autocapture, no PR
  titles/bodies/repo names/branch names/logins/prompts/agent text/topic
  names in any event — guarded in code, not just by convention. Verified
  once for real with `POSTPILE_TELEMETRY=1` against a scratch data dir (a
  single `telemetry_test` event, confirmed delivered).
- Error tracking (2026-09-30, DESIGN.md "Usage analytics" › Errors):
  renderer errors (window handlers plus a root `ErrorBoundary`) go through
  `POST /api/telemetry` to the engine's scrubber like main process errors.
  Frames carry posthog-cli chunk ids, the release workflow uploads hidden
  source maps and creates the release, so stacks resolve and issues can be
  resolved in a version. Waiting on the owner: the `POSTHOG_CLI_API_KEY`
  secret (RELEASING.md "Error tracking source maps"); until then releases
  warn and send bundled, release-less stacks. Not yet seen resolving in
  PostHog: check the first issue after the first release with the secret.
- Missing tools (2026-09-28, DESIGN.md "Missing tools"): gh and claude get
  a typed status (`GET /api/tools`) checked once and then on a backoff.
  Without gh the sync is skipped and the poll paused with a fix note as
  the empty state or a banner; without claude everything runs on rules
  with one "Agent features are off" line. `pnpm cli tools`,
  `POSTPILE_FAKE_MISSING` for sample data. Not tried against a real
  machine without gh or claude yet (fake mode and unit tests only).
- Setup flow (2026-09-28, DESIGN.md "Setup flow"): a first run (no
  instructions, no flag in meta `setup_state`) opens on four screens
  instead of topics: checks (gh, login, notifications, claude, with fix
  commands), a sweep job (viewer and teams, 30 days of PRs in one GraphQL
  search, CODEOWNERS of the top 5 repos, the digest, one opus
  `setup_draft` call), review (editable sections with "Why?" per claim,
  `setup_refine` shown as a diff, quiet repo toggles, main repo radios)
  and accept (new instructions version with origin `setup`, quiet repos,
  scope, done flag, then the first sync). The sweep reads CODEOWNERS and
  owners.yaml rules; `pnpm cli setup-draft` prints a draft with its sources. "Skip for now" and "Run setup
  again" live in the Instructions pane. Fake mode walks it with canned
  results; `POSTPILE_FAKE_SETUP=1` forces it.

- Code review fixes (2026-09-28):
  - Rules: GitHub verdicts win over the stored approval once GitHub shows
    it; an approved PR with a later ask stays out of Done; snoozed tiles are
    no "your move"; tiers see in-app approvals; "Review, X asked" names who
    asked the viewer; team mentions ask only until read.
  - Engine: the refresh after approve/comment is a normal poll cycle;
    approve marks read before it; mark-reads the lock stopped mid-send
    become pending writes; a double "Send" joins the running one; the
    polled-PR list survives a failed sync; pings recheck unread/unseen after
    the agent call; the CLI's `--read-only` opens the database read-only
    without migrations; the stale lock takeover re-reads and checks the
    holder's start time.
  - Renderer: the fallback tile is the grid's first and gets pinned into the
    history entry, the fallback topic is the sidebar's first; the cleanup
    actions have their own busy keys. The CLI and `/api/consolidate` honour
    `POSTPILE_MAX_AGENT_CALLS`.
  - Security: GitHub-derived memory is fenced in every prompt, fence tag
    names are neutralised in any spelling, the GitHub token only goes to the
    API base URL, unreadable sweep files are skipped, the API token left the
    command line, web permissions are denied.
  - Privacy: the sweep skip list lives in `~/.config/postpile/config.json`
    (`sweepSkip`), editable under the digest.
  - Simplify: core builds PR rows and tile views for engine and FakeEngine;
    one verdict helper (`viewerApproval` also feeds the Approve button);
    github-sync reads threads once per run.

- Done and team-request rules (2026-09-28): read-but-review-pending PRs
  stay out of the Done fold (`isPrDone` + `reviewPending`), team requests
  on a teammate's PR count like personal ones (`reviewRequest` in core
  `review-request.ts`); engine and FakeEngine share the rule.
- Addressed your changes (2026-09-28, from a real PR): after
  the viewer's changes request, an author push or reply hands the move back
  without a re-request. Whose turn "pim addressed your changes:
  re-review", tier To review, "For you", loud and ping-worthy
  (`changesAnswered` in core). Fake sample #1960 in Dev env.
- Live poll keeps up with GitHub between full syncs (2026-09-28, from two
  real PRs that stayed OPEN in the app after a merge on github.com):
  - read-threads watch every cycle (`?all=true&since=<cursor>`, own ETag,
    304 while nothing moved, every 200 logged with the tally), so merges,
    closes and the user's own actions on read threads show within a cycle
  - freshness check: one `updatedAt` GraphQL query over every PR a tile
    shows, each full sync and once a minute from the poll; moved PRs get
    the full fetch
  - approve and comment refetch the PR before answering
  - one poll cycle right after every full sync (the poll was blocked for
    the whole sync)
  - focus refresh for PRs opened on github.com from the app (30 minutes):
    direct thread lookups plus one cycle when the window gets focus
  - "read elsewhere" lines in main.log say whether the unread list
    answered 200 or 304; real data so far: always 200
  - open: a mark-read that reaches GitHub does not refetch the PR (nothing
    on the PR changes; the thread is already read locally)
- Approvals stand on any commit (2026-09-28): approved PRs stay done,
  `commits_after_approval` is quiet by rule and goes to event
  classification, which raises only pushes that change what was approved
  (with the PR's files in the prompt). No more "Re-check N commits".

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
  read-only on first run until 2026-10-05 (now on by default in the packaged
  app), confirm popover to open, instant to close,
  disabled with the reason under `POSTPILE_READ_ONLY=1`. Locked: approve
  and comment blocked; mark read and "not mine" become pending writes
  (`pending_write`, migration 011) after the undo window, the tile keeps its
  state with a "pending: mark read on GitHub" marker, the lock shows a count
  badge, and unlocking offers Send N / Discard / Cancel (plus "Discard
  pending, stay locked"). `CODE_MANAGER_ALLOW_WRITES` is gone.
- Action log (`action_log`, migration 008): every GitHub write, local
  mark-read, undo and lock flip, with origin (tile, debug, queue,
  quit, sync, poll, footer, default) and outcome (queued, github, local, skipped,
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
    prompt); consolidation is told to propose merges for 1-2 PR topics.
    The Unsorted answer and the 5-new-topics cap from this pass were
    dropped on 2026-09-29 (see "Always place PRs")
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
- Back / forward navigation in the desktop app: title bar chevrons (since
  2026-09-29 at the right end of the left column, next to the search; the
  logo and name come first after the traffic lights), Cmd+[ /
  Cmd+], mouse side buttons, trackpad swipe (only fires with the classic
  "Swipe between pages" setting; not tried on hardware yet).
- Title bar search that filters topics and tiles (Cmd+F, Esc clears):
  `GET /api/search?q=`, in-memory over stored PRs, same matcher in fake mode.
- GitHub avatars in the renderer (avatars.githubusercontent.com, no API
  call), initials underneath as placeholder and fallback; bots and teams
  keep initials. Fake mode never loads remote avatars (initials only), since
  an invented sample login can still be someone's real account.
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
  badges, pills and glyphs in the detail pane. Primary buttons are ink
  (Approve green since 2026-09-30, see Decided).
- Live poll and Mac pings (DESIGN.md "Live poll and Mac pings"): the desktop
  app polls `GET /notifications` every 60s or GitHub's X-Poll-Interval, and
  once when the window gets focus (ETag, 304 = free), backs off on
  rate limits (Retry-After / reset / doubling) and errors, shows state in the
  footer; on a change it syncs just the moved PRs (events, loudness, topic for
  new PRs, tiles refresh). Rules first, then one Sonnet `ping_decision` call
  per cycle for addressed activity (veto or rephrase), template fallback, daily
  cap 200, every decision in `ping_decision` (migration 007). Native
  notifications grouped per tile (2 min) and as a summary above 3; a click
  opens the tile. Closing the window hides it, Cmd+Q quits. Fake mode pings a
  sample question about once a minute. CLI `poll` runs one cycle.
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
  digest of what the user is working on, from `~/.claude` (CLAUDE.md and its
  @-includes, every project's memory files, light signals from sessions of
  the last 7 days; secrets masked, ~60k chars budget, drops logged). One opus
  `context_sweep` call (`POSTPILE_SWEEP_MODEL`), versions in
  `work_context_version` (migration 009, last 30). Runs from the desktop app
  once a day from 06:00 (checked at start and every 30 min), on
  `pnpm cli sweep` and on Refresh; never blocks a sync. Injected as
  background into topic assignment, dossier updates, glances, ping decisions
  and chat, outside every input hash. "What you're working on" at the bottom
  of "Your instructions": summary, threads with topic links, Why?, Forget
  (with Undo), Refresh, last error. One real run against a DB copy: 60k chars
  in, 12 threads, $0.40, 43s; personal sessions left out.
  Project folders on the skip list are never read; the count is in the
  input stats. The list is edited under the digest and saved to
  `~/.config/postpile/config.json` (`sweepSkip`), read on every sweep;
  `POSTPILE_SWEEP_SKIP` wins over it, the defaults (personal, private)
  come last.
- Default agent-call cap for app syncs raised from 30 to 150
  (`POSTPILE_MAX_AGENT_CALLS`).
- App bundle: `pnpm dist` makes an ad-hoc signed `PostPile.app` (arm64,
  dir + zip) in `apps/desktop/dist/`, everything bundled, no tsx or
  node_modules at runtime. Started in fake mode: window loads, the server
  answers, quit is clean.
- Tests (vitest) and typecheck green across all workspaces.
- Found PRs and the read backfill (DESIGN.md "Product model",
  provenance): the first sync reads read threads of the last 7 days, later
  ones since the last sync. One GraphQL request per full sync finds the
  user's own open PRs, review requests for them and their teams, and PRs
  involving them merged in the last 7 days; new or moved ones are fetched.
  Provenance `found` (AU / RV / RT / CM, tooltip "found via GitHub"): tiles,
  topics, dossiers, glances and queues like pinged, never unread on their
  own, whose turn still lifts the topic; pinged once a thread appears.
  Migration 014. Fake data has two found PRs in CI & tests.
- Packaged app diagnosable: main.log under `~/Library/Logs/PostPile`
  (rotated, Help › Reveal Logs), the last sync report stored in meta and
  shown in the footer / title bar tooltips and the notifications debug pane.
  The first packaged start sync on real data died at the PR batch fetch (after
  the inbox, before found PRs, nothing stored) with no trace; the exact GitHub
  error is unknown. A failed batch now only costs its own PRs. Reproduced on
  DB copies with the dist binary (408 PRs, launchd-like PATH): no error.
- Notification permission at a calm moment: a welcome Mac notification
  (flag in userData) triggers the macOS prompt; since 2026-10-05 only after
  the user opts in to batches or as soon as it matters, and the test one is
  "Send a test notification" in the sidebar's Interruptions menu. Dev runs register as
  "Electron" in System Settings › Notifications, the packaged app as
  "PostPile". The welcome with notifications on was not tried by hand (it
  would ping the real Mac); the off path and the IPC were.
- Dev runs away from the real database (DESIGN.md "Safety while
  building"): `POSTPILE_PROFILE=dev` (set by the unpackaged desktop app,
  defaulted by `pnpm cli` / `pnpm server`) uses PostPile-dev and
  postpile-dev, seeded once with a copy of instructions.md; DEV badge in
  the title bar; `POSTPILE_DATA_DIR`. A `postpile.lock` per data folder
  refuses a second process (desktop dialog with Quit, CLI/server exit 1),
  stale locks are taken over, `cli topics|topic|pr --read-only` reads next
  to the app. Single-instance lock in the desktop app.
- Inbox cleanup and start fresh (DESIGN.md "Inbox cleanup and start
  fresh"): counts of threads unread on GitHub older than 14 / 30 days, a
  quiet sidebar line or, on the first run and after 5+ days without a sync,
  a banner. The dialog marks everything older than 14 / 30 days read on
  GitHub with one PUT through the writes lock (pending while locked, action
  `mark_all_read_before`, origin `cleanup`, one poll right after), starts
  fresh with a local baseline (clearable), or hides for 7 days. Migration
  013. Fake data has three old unread threads.
- GitHub read time reconciliation (DESIGN.md "Reconciling with GitHub's
  read time"): events before a thread's `last_read_at` count as seen on
  every sync and poll, not only a PR's first fetch; threads cleared on
  github.com while the app was closed turn calm on the next start and move
  "since you last looked" forward. The sync also reads
  `/notifications?all=true&since=<last sync>` (ETag, poll only when the
  inbox moved), so PRs handled entirely on GitHub get their events logged
  as seen and reach topics and dossiers. Nothing is marked read on GitHub.
- Repo scope and quiet repos (DESIGN.md "Repo scope and quiet repos"): a
  repo menu in the title bar, a radio list ("All repos" or one repo, with
  topic counts). The chosen repo only selects topics: the sidebar, queue
  and filter counts and search keep the topics with a PR in it. An opened
  topic always shows all its tiles; the ones from another repo (than the
  chosen one, or the topic's main repo) carry a small repo label, on the
  tile or on the PR rows of a mixed set. A stored multi-selection migrates
  (one repo stays, several become All repos). Per repo "Let it go stale":
  still synced and remembered, never urgent, never pings, out of the queue
  and filter counts, tiles say "quiet repo". Rules in core
  (`repo-scope.ts`), settings in meta. Fake data has PRs in acme/infra (a
  Depot tile, for the label), acme/desktop and acme/python-sdk; no
  mixed-repo set, so PR row labels only show in tests.
- pnpm instead of npm workspaces (2026-09-28): `pnpm-workspace.yaml`,
  `packageManager: pnpm@12.6.0`, `workspace:*` deps, `pnpm-lock.yaml`
  (imported from the npm lock). Each package declares what it imports; the
  root keeps only typescript, vitest, tsx and @types/node. No hoisting
  needed, electron-builder works with the strict layout. `allowBuilds` in
  the workspace file (esbuild yes, electron-winstaller no), since pnpm 12
  fails the install on unapproved build scripts.
- First real use feedback (2026-09-28):
  - Resizable panes: drag the sidebar | tiles and tiles | detail edges,
    double-click resets to the default clamps, widths kept per viewer in
    localStorage (DESIGN.md "Three-pane balance").
  - Sidebar faces: only you and teammates when involved (you first), else
    the others; three at most, no "+N" (`topicFaces` in core). Replaced
    2026-09-29 by PR authors with a team pill.
  - Sidebar numbers: one per row, the unread tile count in a bubble (coral
    when urgent, grey when calm); the per-row tier PR count and the loose
    unread dot are gone. Section headers keep their PR count.
  - Own PRs: never Approve / re-review. Primary button from core
    (`prPrimaryAction`: Mark read when unread, else Open on GitHub), "Waiting
    on <reviewer or team>" as the turn, a "Your PR" marker, "FYI, nothing to
    do" on news that asks nothing, and a prompt note so glances don't advise
    approving. Approve also re-enables after a push past your approval.
  - Activity list: meaningful events only (`activityList` in core), pushes
    collapsed per burst, new-since-you-looked first and set apart, capped at
    12 with "Show all N", bot/CI noise folded into one expandable line.
  - Recheck only on big claims: dossier-level lines and facts with a big
    predicate (`isBigClaim`: drives, owns, decided, blocked_by, user_cares);
    none on change lines, activity or trivial facts. "Recheck this
    assessment" on the whole glance (`MemoryRecheckRequest.prKey`).
  - "For whom" chips and left bands replace the tile code badges
    (`forWhom` in core; "For you", "For team-devex", "Your PR").
  - Detail pane assessment: verdict as the box title with marked lines,
    a separate "RISK · level" box, plain Does / Others lines, and the
    action bar right under it (glance text split into lines in the
    renderer, schema unchanged).
  - Sidebar: no counts on section headers; unread rows bold with a warm
    background, read rows muted.
  - Tiles: unread tiles carry a coral NEW pill in the strip, read tiles a
    quieter title.
  - Drafts: no review / re-check / merge moves, never To review, quiet
    review requests and post-approval pushes, loud mark-ready, pings only
    for personal asks; Draft chip and dashed frame. Fake #1945 is a draft.
  - Stacks stay whole: every layer shows, open, draft, merged at any age and
    closed (greyed, pill "closed"). The walk seeds from found PRs and every
    stored open tracked PR too, the branch lookup asks for any state, and
    former base branches (`BaseRefChangedEvent`) keep a merged layer after
    GitHub moved the PR above onto master. The 14-day merged cutoff is gone.
  - A stack is one unit: one topic (newest layer membership wins), one tile
    or inside one set, never split. Topic assignment asks once per stack and
    new layers join their stack's topic; "wrong topic", splits and "not
    related" move whole stacks (DESIGN.md "Stacks as one unit").
- Approve button (2026-09-28): "Approve as well" when others approved and you
  never did, outlined "Approve draft" on drafts (draft wins), lifecycle and
  review glyphs in front of the label with worded tooltips (`lib/approve.ts`).
  An approval on any commit counts: outlined "Approve again" after that.

## Stubbed or thin

- Desktop UI follows the chosen style, but the layout is still open. Not in
  the UI yet: keyboard
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
- Rules layer leftovers (2026-09-29, DESIGN.md "Rules layer: one home per
  fact"):
  - The live poll does not classify events, so its revive of a retired
    topic still reads the rule's loudness; only the full sync revives on
    effective loudness.
  - `PrSummary.primaryAction` is only read by core's offers now and could
    be dropped from the DTO.
  - The old `snooze` table stays until migration 019 has shipped
    everywhere; a later migration can drop it.
  - Glance pings (Look closer) and opened-in-PostPile reads check snooze
    per tile on purpose: they skip a PR while any tile holding it is
    snoozed.
- Fake mode (`POSTPILE_FAKE=1`) runs `FakeEngine`, a second
  EngineService. Tile state, views, offers, reads (`planRead`) and pending
  writes (`pendingWriteStep`) come from core; its store, sync and undo are
  its own and can drift from the real engine. See decisions below.
- The full sync is on demand only (Sync now, app start); the live poll only
  syncs PRs whose threads moved and leaves dossiers, glances and sets to it.
- Live poll, not tried by hand yet: clicking a real macOS notification (click
  -> focus -> tile), the first-run permission prompt and a denied permission,
  the hide-on-close / Cmd+Q flow, and a real rate-limit backoff. Electron
  cannot read the notification permission, so a denial is silent (tiles still
  turn unread). One real `ping_decision` call ran against a DB copy (2 items,
  $0.04, 4.4s) and `cli poll` against the real inbox (read-only copy).
- Interruptions are picked in the app (setup, sidebar menu); the poll
  interval is still `POSTPILE_POLL_SECONDS`, the roundup times are fixed
  (9:30, 13:30, 16:30, weekdays), and quiet hours are not built.
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
- Quitting the app while on a topic does not mark it seen.
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
- Asks the events agent judged before 2026-09-29 sit behind the classify
  cursor. The first full syncs after the upgrade send every unanswered loud
  personal ask on an open PR once more, once per topic (meta
  `events_rejudge_asks_v1:<topic>`, then the global
  `events_rejudge_asks_v1`; within the call cap, merged into the topic's
  normal batch), so an old "thanks, that's fine" can go quiet. No cursor
  reset. The per-topic keys stay in `meta` after the global flag is set.
- Topics without a stored dossier context hash count as unchanged; the hash
  is written on their next dossier update.
- Topics over the 40-entry timeline cap rely on `earlier` for older PRs;
  consolidation can only propose splits over timeline PRs.
- The app bundle (`pnpm dist`) is ad-hoc signed (no Developer ID, not
  notarized) and arm64 only. Self-update (2026-10-03) was tried on sample
  data only (the restart relaunches); a real download and install needs two
  signed releases that carry `latest-mac.yml`, so the first real one is the
  update from the first such release to the next. Release builds are signed
  with PostHog's Developer ID and notarized once the `desktop-signing`
  environment has the Apple secrets (access pending, see RELEASING.md). x64 would be one more arch in
  `electron-builder.yml` (another Electron download, not tried). The
  packaged app was started once in fake mode; a real-data run from Finder
  (PATH from `/etc/paths(.d)` and `toolPath`, gh / claude found) is not
  tried yet.
- Search matches title, number, author, repo, head branch, topic name and
  area only (no PR body, comments or labels) and does not highlight the
  matched text. Filter state and history are not kept across restarts.
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

## Performance findings (pass of 2026-09-28)

Measured on a copy of the real DB (~145 PRs, ~7k events, 62 topics).
Fixed in that pass: parsed PR cache in `PrRepo` (every Board-backed request
~57 ms -> ~13 ms), pr_event index (migration 012), minified renderer
(981 -> 391 KB), react-query staleTime 30s, ready-to-show,
`POSTPILE_SYNC_ON_START=0`. Left, most impact first:

- **Board rebuilt per request** (~10 ms of the ~13 ms): every read model
  request loads all PRs and all ~7k events (`events.listForPrs`, ~7 ms) and
  rebuilds stacks and tiles. A Board cached per data version (`PRAGMA
  data_version` plus a local write counter, rebuilt when `now` crosses a
  snooze deadline) would make topics / topic / PR reads ~2-3 ms. Not needed
  at today's sizes; worth it if the event count grows 5-10x.
- ~~**fixPath blocks the main process ~130-190 ms** at launch~~ Resolved
  2026-09-29: fix-path is gone, PATH is built from file reads (see Done,
  "No more permission prompts").
- **ready-to-show fires on the empty body paint**, ~80 ms before React's
  first contentful paint, so the window still shows an empty (correctly
  coloured) frame briefly. Showing it on an IPC "first render" signal from
  the renderer would close that; cosmetic.
- **Request waterfall on load**: topics -> topic -> PR, ~20 ms each in
  series; first tile ~85 ms after navigation in Chrome, ~580 ms after launch
  in the packaged app (warm). Fine today; the server could inline the first
  topic's detail in `/api/topics` if it ever matters.
- **Parsed PR cache memory**: holds all parsed PR snapshots (~15 MB json,
  more as objects) for the process lifetime. Slimming the stored `Pr`
  (comment and thread bodies are ~90% of the json) would help both memory
  and the first cold read (~45 ms parse).
- **`/api/debug/notifications`** is ~29 ms and 270 KB; debug pane only.
- Not issues, checked: re-render on a search keystroke ~2 ms, clearing the
  filter ~14 ms (whole App re-renders, no memo needed at this size); the 5s
  live status refetch only re-renders when the status changes; one topic
  switch fires 2-3 requests (topic, PR, the left topic's `seen`); event
  derivation over all PRs ~18 ms per sync, stacks <1 ms, no quadratic loop
  over events or PRs at this size. `run()` in `store/sql.ts` prepares a
  statement per call (~7k per full sync event write); a statement cache
  would shave a little off sync.

## Sync speed (pass of 2026-09-28)

Trigger: a real sync took 307s for 82 agent calls, with no sign of life in
the app meanwhile.

- Agent concurrency default 4 -> 8 (`POSTPILE_AGENT_CONCURRENCY`). Most of
  the 307s was calls queued behind the limiter.
- The digest no longer runs job after job (DESIGN.md › Sync flow ›
  Scheduling): after topic assignment, dossiers, sets and event
  classification start together, each topic's glances (and their retry)
  start as soon as its own dossier lands, fact reconcile batches run side by
  side. Before, sets waited for every dossier, glances for every set,
  retries for every glance, events for every retry.
- Per-phase timings (`phaseMs`) in the last sync report, the `sync: done`
  log line and the sync tooltip, so the next slow sync says where the time
  went.
- Live progress in the title bar while syncing: `syncing · nothing new on
  GitHub · agent calls 34/82 · 2m` from `GET /api/sync/progress`. The total is what the sync planned so
  far and grows (glances are planned as dossiers land).
- Glance "missing or invalid in the answer" (two real PRs, one of them
  acme/app#1812): replaying acme/app#1812 alone against Sonnet gave a
  misspelled verdict (`LOOKS_SASAFE`, `LOOKS_SASE`) in 4 of 6 runs, once
  with the other fields cut to "placeholder", once as broken JSON. The
  strict enum dropped the entry on both attempts. Verdicts are now repaired
  when unambiguous, and error lines say why a PR is missing.
  The other PR (2026-09-28, replayed with its stored input): Sonnet wrote `LOOKS_SASAFE`, then "Wait, let me correct a typo in
  the verdict field." and a second JSON object. The parser cut from the
  first `{` to the last `}` across both. It now takes the last complete
  JSON value that fits the schema (`jsonCandidates`).
- Open: measure the next real sync. The per-kind durations in
  `agent_call` include the time queued in the limiter, so they read longer
  than the model took.

## Needs Julian's decisions

- **Setup flow**:
  - An existing install with instructions never sees the flow; one with an
    empty file and no flag (e.g. the dev profile) will on its next start.
  - Skip on a first run syncs right away with empty instructions, as a
    normal start would.
  - owners.yaml is read at the root and in the 6 top-level folders the
    user's PRs touch most, only when the root file exists. Nested files
    deeper down (`products/x/owners.yaml`) are not read. Enough?

- **Found PRs**: one request per sync, first page of each alias only (own
  100, searches 50 each, 200 total); a real run returned 18 own, 1 review,
  22 for team-devex and 50 merged (capped), so the first sync after this
  fetches ~90 PRs and asks topic assignment about them. "From you" uses
  `user-review-requested:@me` (direct only) so team requests keep their own
  reason. Merged PRs that involve you (7 days) can be many and mostly calm;
  keep them, or only own merged ones? Found PRs do not seed stack
  completion.

- **Dev profile**: `pnpm cli` now reads the dev database by default, so
  real smoke runs need `POSTPILE_PROFILE=default` (or `POSTPILE_DB`). The
  dev profile is chosen by a script env default, not by detecting the
  checkout; a plain `tsx apps/cli/src/main.ts` still uses the real folders.
  The lock lives next to the database file, so `POSTPILE_DB` elsewhere gets
  its own lock. Keep?

- **Inbox cleanup**: the cleanup goes out right away (no 6s undo window),
  since the dialog is the confirmation. "Not now" hides the line too, not
  only the banner. An existing database shows the banner once on its first
  sync after this change only if its newest PR fetch is 5+ days old. Start
  fresh counts events before the baseline as seen when reading, so after
  clearing it old unread tiles come back; OK?

- **Read list**: PRs handled entirely on github.com now become tiles
  (calm, all events seen) and go through topic assignment and dossiers,
  which costs agent calls; the first run looks back 7 days. GitHub's
  `since` filters by `updated_at`, so a plain read without new activity is
  only found when the thread leaves the inbox; its read time then comes
  from one thread lookup (20 per sync, the sync time beyond that). Should
  read-only PRs stay out of the tiles (memory only)?

- **Repo scope / quiet repos**: the scope picks the sidebar's topics
  (and so the counts and search) but not the live poll, Mac pings or the
  notifications debug view: a ping from a topic outside the chosen repo
  still arrives (quiet repos never ping). Should the scope also mute pings?
  The menu counts topics (PRs in the tooltip), not unread threads. A mixed
  set tile (quiet + loud repo) counts only its loud PRs for urgency.

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

- **Work context sweep**: budget split (sessions 30k, memory
  24k) means most posthog memory files never make it, only their MEMORY.md
  index; fine? Which prompts get the digest (now: topics, dossiers, glances,
  pings, chat)?

- **Live poll**: should loud-but-not-addressed activity (approval or comment on your
  own PR) ping? Team review requests and team mentions ping today (the agent
  is told it is the team); keep that? Cap of 200 ping decisions a day
  (~$0.04 each, a normal day ~10-40) and the 30-minute freshness window are
  guesses.

- **GitHub writes lock**: `CODE_MANAGER_ALLOW_WRITES` was dropped instead of
  kept as "start unlocked"; the lock is the one switch. A batch queued while
  locked stays pending even when the lock opens inside its undo window (the
  unlock popover is where the user decides). Keep that? Should the lock also
  be persisted in fake mode?

## Next after 0.2.0

- First sync with a big inbox (fixed 2026-09-29): threads older than 30 days
  are never fetched, a full sync takes at most 60 PRs, and a capped sync
  brings the next background sync forward to 2 minutes. Still open: the live
  poll starts glance catch-ups during setup, before Accept, and the first
  sync waits for them.

- MCP server (built 2026-09-29, see DESIGN.md "MCP server"):
  `postpile-mcp` in the app bundle (Homebrew links it), `pnpm cli mcp` from
  the repo. Reads `pr_context`, `topic`, `search_prs`, `whats_on_me` (brief
  by default, paging, filters, tool errors, per-PR freshness), plus
  `refresh_from_github` and `propose_topic_change` through the running app
  (file outbox in the data folder, DESIGN.md "Agent requests"; built
  2026-09-29 evening).
  - Verify once for real with the app running on a real database: a
    refresh from Claude Code reaches the app (action log `agent_refresh`),
    a suggestion shows in the Inbox as "suggested by Claude Code" and its
    Accept moves the PRs; with the app closed both say "PostPile is not
    running". Check what Claude Code, Codex and Cursor send as
    `clientInfo.name` (the renderer maps `claude-code`, `codex-mcp-client`,
    `cursor-vscode`).
  - Verify once for real on the first signed release: `postpile-mcp` under
    the hardened runtime (ELECTRON_RUN_AS_NODE with the release
    entitlements), and `claude mcp add postpile -- postpile-mcp` from a
    fresh brew install.
  - Deviations from the plan: an app-bundle launcher instead of only a CLI
    subcommand (the CLI is dev-only, users have no `postpile` binary); plain
    text answers without structured content (the calling model reads the
    text; both would double the tokens); list reads ignore the window's
    repo choice (`ListScope.allRepos`).
  - Connecting (built 2026-09-29, DESIGN.md "MCP server" › Connecting):
    footer "agents: not connected" and the setup Accept step offer "Add to
    Claude Code" (`claude mcp add --scope user`), only on a click. Verify
    once for real in a signed build: the click adds it and `claude mcp get`
    finds it from the app's own folder. Open: a moved app leaves a stale
    path that still counts as connected.
  - Later: more asks (notes on topic/PR memory, snooze, instruction
    proposals) through the same agent-request outbox, so they keep the
    writes lock, undo and the user's say; the app's HTTP token stays in the
    app. The PR description is not in `pr_context` yet. Auto-applying small
    outside splits was raised and left out ("okay, don't do now").
  - Open: the hourly refresh cap lives in memory, so an app restart resets
    it.

## Later

- Normalize the PR snapshot (started after 0.19.0; first this, then the
  `utilityProcess` move below). The short fields live in the PR header
  (`pr`, migration 028), the rest of each PR is one JSON blob in
  `pr_snapshot.json`: comments are half of it (95% of their text from
  bots, cut since 0.19.0), thread comments and review bodies are second
  copies of comments, and check contexts were 10% (dropped in step 3). So a
  hot board parses whole PRs to read a few fields. Design checked with
  Codex GPT-6.1 (2026-10-05); its review points win where they differ from
  the first draft. Estimate from prototyped tables, hot set of 1,500 PRs on
  the heavy copy: 284 MB of heap today, about 140 MB with comment rows,
  about 60 MB with the board diet. The plan, one PR each, in this order:
  1. Newer-schema guard: `openDatabase` refuses a database from a newer
     PostPile (DESIGN.md "Safety while building"). Done, 0.20.0.
  2. One storage job runner (`packages/engine/src/storage-jobs/`), with the
     bot body trim ported as its first job under the trim's existing meta
     keys. Fails closed (never `done` unless the job's check passes),
     bounded `BEGIN IMMEDIATE` units with a short busy timeout that
     reschedule on SQLITE_BUSY, ~30 ms slices 50 ms apart, pauses while
     sync, poll, consolidation or catch-up run and while the Mac sleeps,
     cursor and done flag in the unit's transaction, telemetry
     `storage_job_done`. Done, 0.20.0.
  3. Drop CI checks (decided 2026-10-05, replacing the checks summary
     pilot): no checks fetched or stored, CI events deleted (migration
     030), the old checks stripped from the stored JSON by the storage job
     `checks_strip`, every PR read in one read transaction (DESIGN.md "CI is
     not tracked"). Built for 0.21.0. `rows_version` waits for step 4.
  4. Comments, reviews and threads as rows (`pr_comment`, `pr_thread`,
     `pr_review`, header `mentioned_teams`, `rows_version`), shipped in one
     release together with the strip of the switched fields from the stored
     JSON. The first phase that runs the dual-write, backfill and read
     switch protocol. Built for 0.22.0 (Done), with `review_id`.
  5. Board diet: board reads leave out bot bodies no rule reads
     (`isBodyReadByRules`), `FullPr` for the readers that need every body
     (event derivation, write actions, lessons, "Why?" excerpts).
     `for-whom.ts` then reads `pr.mentioned_teams` instead of scanning
     bodies. Built for 0.22.0 (Done).
  6. Commits, timeline and files as rows (`pr_commit`, `pr_timeline`,
     `pr_file`, migration 033), the json stripped of them. Built for
     0.23.0 (Done).
  7. PR text and short fields as header columns and `pr_body` (034):
     after the switch no read takes the json. Built for 0.23.0 (Done).
  8. Retire `pr_snapshot`: version barrier migration 035, then the
     storage job `snapshot_retire` empties and drops it. Built for 0.23.0
     (Done).
  9. Activity view: fold a review's inline comments under that review in
     the PR pane, by `Comment.reviewId` (fetched since 0.22.0; rows filled
     from older json have none, so those keep today's lines until a
     refetch). Bot reviews first. `bot-threads.ts` matches empty carrier
     reviews to thread replies by author and time today; it switches to
     the id here.

  Rules for every phase:
  - A global read switch per collection (meta `rows_ready:<collection>`).
    `rows_version` is cumulative readiness: version k means every
    collection up to k is in rows. Upserts write every collection the build
    knows, backfills go in order and never lower it. A PR below the
    build's version is not an integrity failure while the JSON still holds
    the field.
  - Reads take readiness flags, headers, the JSON projection and child rows
    in one read transaction, so a read-only CLI or MCP never mixes two
    commits. Parse caches drop when the projection changes.
  - Completion is checked from the data, never from an empty collection.
    Jobs fail closed, except the row backfills: they switch at the end of
    their walk without the PRs they rejected, which then count as not
    stored until a fetch brings them back (0.23.0, Codex review on #140).
  - Revisions move through the store-wide counter (`prs.ts`, meta
    `snapshot_revision`), only when what a read returns changes.
    `snapshot_revision` keeps its name; a rename would need its own
    migration.
  - Presence stays visible: a snapshot without `assignees` is refetched, a
    missing `capHits` never vouches. Rows must not turn missing into empty.
  - `mentioned_teams` is computed from the stored (cut) text, the loss the
    trim already accepted.
  - Child ids are GitHub's node ids, treated as opaque (GitHub has migrated
    their format before). A refetch replaces the fetched window; absence
    past a paging cap is not a deletion.
  - Compaction (`VACUUM INTO`) is offered later as an explicit action,
    never at startup or quit. Freed pages are reused meanwhile.

  Deferred: text-free skeletons for old merged and closed PRs (no age
  threshold now: a refetch cannot bring back older paged history). Later
  cleanup: after a few releases, drop the per-phase json backfills and
  either keep one importer for laggard databases or refuse them (open). The
  slim `PrPaneView` for the renderer shipped on its own, apart from this
  plan (Done, "Slim PR pane": the `pr` part about 106 → 7 KB per open PR).
  Researched, not planned yet: a statement cache for `all`, `get` and `run`
  in store `sql.ts`, never for `each()` (running a cached statement again
  resets an iterator still in use).
- Move the engine and the server out of Electron main into a
  `utilityProcess` (after 0.18.0, in this order: after normalizing the PR
  snapshot above; a bigger refactor). Electron runs V8
  with pointer compression and one shared cage per process, so the ~4 GB
  heap limit covers all isolates of a process together: worker threads
  share it and would not help. A utility process has its own pid and heap,
  talks over a MessagePort, and its crash or out-of-memory shows as
  `child-process-gone` instead of taking the app down, so main can restart
  it and stays responsive during big reads. Electron's guide suggests
  workers first for a blocked main thread and a process as the last step;
  here the memory cap is the reason for the process.
- Replace FakeEngine with the real Engine over a seeded store. Not now
  (decided 2026-09-28): the shared core builders (`buildTileView`,
  `deriveTileState`, …) already keep the two in step.
- Split `github-sync.ts` (notifications, fetch, stack walk, freshness). Not
  now (decided 2026-09-28).
- Keep the legacy/rename transition code (`applyLegacyEnv`,
  `legacy-data.ts`) for one more release, then drop it (see below).
- Memoise the ActionsProvider value. Not now (decided 2026-09-28).

- Dig deeper: a chat send mode that runs Opus with read-only tools (local
  checkout, gh pr view/diff) for a user's hunch, writing findings back into
  topic memory. Not a separate button. Deferred by Julian 2026-09-28.
- Drop the `CODE_MANAGER_*` env fallback (`applyLegacyEnv`) and the
  code-manager folder migration (`legacy-data.ts`) once the move has run.

## Decided

- **Agent notes on PRs are advisory and anchored to the PR's state**
  (2026-10-08, design agreed with the reporting agent, checked by Codex;
  DESIGN.md "Agent notes on PRs"): notes never change turn, unread, done,
  sections or counts; one durable note and one lease per PR; staleness is
  a state fingerprint, not timestamps, and the user's own later comment
  stales a note too (agents write notes last). `cover_token` stays optional.

- **A topic settles in steps once its last read lands; the dwell stays**
  (2026-10-07, owner, from a recording and a playable mock; DESIGN.md
  "Marked when the dwell ends" › The settle after the read, "The Archive"):
  the dwell stays exactly as it is everywhere, also when the only news is a
  merge (skipping it for merged-only news was offered and declined). After
  it, coral leaves together, the strip folds, "Unread" over the held tile
  turns into "Dealt with" in place, the footer swaps, and the Archive box
  grows in with "Archive now" rising last. On a done PR "Open on GitHub"
  stays outlined, so "Archive now" is the one ink button. "Archive now"
  flies the sidebar row into the Archive fold; the Archive gets no count.
- **Review-note composers draft on open; an approve note is "Looks good"
  plus at most one point** (2026-10-06, owner; DESIGN.md "The PR pane" ›
  One composer and "Review note drafts"): Approve with a note and Comment
  review ask the agent as they open (only into an empty box, not while
  blocked); Ask stays manual. Approve notes start with an opener the code
  rotates (never the same twice in a row) and add one plain-words point
  at most: no checklists, no nitpicks, no identifiers the user cannot
  place. `pr_approved` says whether a note went along and where it came
  from; comment reviews send `comment_review_sent`.
- **The unread dot drains over the dwell and ripples out on read**
  (2026-10-06, owner, mockup variants F countdown and C removal; DESIGN.md
  "Marked when the dwell ends"): the tile row's dot of the PR in the pane
  is a pie that drains over the 1.5s dwell; every dot removal shrinks the
  dot and sends one coral ripple out, replacing the shrink-and-fade. The
  pane's mark button fill stays.
- **PR storage finished without the json** (2026-10-06, checked with
  Codex GPT-6.1): commits stay per PR (no global commit table), files are
  keyed by path with `ord` kept, labels, assignees and reviewers stay
  JSON columns, the description gets its own `pr_body` table. Missing
  stays missing instead of canonical defaults (`truncated`, `cap_hits`
  NULL, `absent_fields` for the optional header fields). Retiring the
  table needs its own version barrier migration (035); the drop itself
  runs in a storage job, never at startup.
- **Inline comments carry their review** (2026-10-06, owner): the PR
  query fetches `pullRequestReview { id }` for every inline comment, kept
  as `Comment.reviewId` and `pr_comment.review_id`. It cannot be
  backfilled from stored json, so it is fetched now, ahead of the
  activity view that folds a review's inline comments under it. Never
  inferred from author or time.

- **Replies to bots in review threads are quiet, one line per thread**
  (2026-10-06, owner report "an author answering a bot shows as the author
  commenting, noisy"): rules in core, not an agent call. A reply counts as
  bot talk when everyone else who spoke before it in the thread is a bot;
  asks (mention, question, reply to you) stay normal loud lines. The
  activity line is a chevron disclosure ("alice replied to
  greptile-apps[bot] · 2 replies on src/x.ts"), picked over a rail row
  with a "Show N replies" link and a bare dotted link. GitHub read state
  is not touched.
- **Mute a PR until someone asks you in person** (2026-10-05, owner report
  "no way to snooze/dismiss forever"): a snooze kind, not a new screen.
  Personal asks only (mention, question, reply, a review request naming
  you); muting marks read and unsubscribes on GitHub (DELETE thread
  subscription) through the mark-read queue and lock. Unmute subscribes
  again, so the tile can turn unread on new activity.
- **Drop CI checks: costly to fetch, usually stale, deprioritized**
  (2026-10-05, DESIGN.md "CI is not tracked"). PostPile fetches no
  checks, keeps no CI event, shows no Checks fact and offers no "Until CI
  is green" snooze. Replaces the checks summary pilot (a summary on the PR
  header with a backfill; built, not shipped). Fetching the checks was the
  costliest part of a PR fetch (on PostHog PRs with 100 checks: a quarter of
  the response, and the query ran in about 60% of the time without them),
  and CI had been off everything that ranks or speaks since 2026-09-29. The
  stored CI events go in migration 030 rather than with the next
  re-derivation, which never comes for merged and closed PRs.
- **No "Not mine" where the tile already says Not yours** (2026-10-05, owner
  report): the menu offered to teach the agent what its verdict already
  said. Mark read is the way to clear such a tile. A stack or set counts as
  Not yours only when its pill says so (every open tracked PR Not yours);
  a stale Not yours counts, like the rules read it.

- **Split pr into header + pr_snapshot; pr is the future model's parent**
  (2026-10-05, checked with Codex GPT-6.1; DESIGN.md "Big inboxes: what
  PostPile loads and works on" › PR storage). A side table of
  short columns (`pr_light`) was built first and replaced before shipping:
  the user wants a table the normalized model keeps using. `pr` holds the
  header and is the existence authority; `pr_snapshot` is the renamed old
  table, the json being phased out; both are written in one transaction.

- **Busy inbox shows as a sidebar card with the aching robot** (2026-10-05,
  DESIGN.md "The busy inbox card"): variant C of the mockups, picked over
  a bar under the title bar and a title bar pill with a popover. It sits
  above the topics, "cause that's where it hits you with topics
  missing". App-health amber, calm wording (focusing, not broken), the
  robot moves only without Reduce Motion.
- **The hot set decides what PostPile loads and works on** (2026-10-05,
  DESIGN.md "Big inboxes: what PostPile loads and works on"): PostPile
  only ever works with a recent, fresh slice and ignores older stuff, and
  stays safe and fast however big the inbox is without the user cleaning
  up. Hot: unread on GitHub, open and tracked, or active in the last 7
  days, with whole stacks and sets. The cap is 1,500 PRs. Over it the
  inbox is busy and PostPile works for the user first (own PRs, personal
  asks), then the home team (requests to it, teammates' PRs), and stops
  working for everyone else, even with room left. A visible "busy inbox"
  card in the sidebar shows it (see the entry above).

- **GitHub writes on by default; locked writes choke PostPile** (2026-10-05;
  the default and the footer-only lock built the same day, see Done "GitHub
  writes on by default", the thresholds not yet): PostPile can only shed load by marking things read on
  GitHub (quiet reads, the inbox cleanup, mark read), so with the lock
  closed a heavy inbox only grows. Telemetry the same day: only 2 of 14
  installs show writes on (approvals, quiet reads); the two heavy installs
  (150 to 300 PR updates an hour, one with about 6,000 PRs on the board,
  which crashed out of memory on 0.16) show none, and the one heavy board
  that shrank (1,254 to 362 tiles) had writes on. Decided: writes are on by
  default; the lock stays as an opt-out, and `POSTPILE_READ_ONLY=1` still
  forces read-only (dev sessions keep using it). With writes locked,
  PostPile stops taking on more work once it runs into thresholds (defined
  later: board size, tracked PRs, activity rate), says why, and offers the
  inbox cleanup or a fresh start instead of growing until it runs out of
  memory. Open: the thresholds and what stopping means exactly. Settled
  when built: existing installs that never chose are switched on (not
  asked), the lock is hidden away in the footer (no other surface pushes
  it), dev runs keep starting locked, and pending mark-reads go out only
  where the thread is unchanged since the click (DESIGN.md "On by
  default"). Telemetry: `github_writes_changed { enabled, from }` and
  `writes_on` on `sync_completed`. One heavy user turned writes on in
  0.19.0 the same day and his board dropped to 250 hot PRs.

- **A helper, not an interrupter** (2026-10-05, DESIGN.md Product model,
  AGENTS.md focus): team feedback valued the digests and the agent layer,
  but the excitement about pings made PostPile look like one more app that
  interrupts. PostPile is framed around cutting noise. Mac pings become an
  opt-in extra, off by default, never the pitch in docs, onboarding or UI
  (built the same day, see Done "Interruptions"). Three modes: never (the default), in
  batches (one roundup at set times, three a day, after a study where
  three batches a day beat both instant and none), and as soon as it
  matters (today's pings). Where the choice lives: its own setup step, three
  illustrated cards that each say what you get, plus an "Interruptions"
  row in the sidebar footer that opens a small menu with the same choices
  (picked over a switch and a text line). Mockups decided the same day:
  setup "A v3" (three cards with small animations, Never preselected) and
  sidebar option 3. The Dock badge counts only pings not handled yet
  (tiles), no badge under Never; rejected: a dot for "something new is your
  move" and a count of your-move topics. Open: the roundup times (fixed for
  now), and whether batches should be the default. A bell in the
  title bar (proposed the same day) is out: it puts pings front and center.
  Existing installs that never chose are asked once after the update,
  Never preselected, instead of silently losing the pings they had by
  default (decided the same day).
  Also from the same day: lead docs with "inbox zero when PRs keep flying
  at you" (AGENTS.md, DESIGN.md Product model).

- **Catch-up on every memory trigger** (2026-10-05, DESIGN.md "Glance
  catch-up"): the poll's per-topic catch-up fires on any event that starts
  a dossier update (`isMemoryTrigger`), not only loud ones, so a person's
  push, comment or merge on a PR not aimed at the user and a bot pushing or
  approving no longer wait for the hourly sync (loud news at once, other
  triggers at most once per topic per 15 minutes). Bot comments still ride
  along; CI and bot edits stay noise. `POSTPILE_CATCHUP_CAP` default
  300 -> 600 for the extra runs. Ships in 0.17.0. The sync progress leads with what GitHub
  brought ("nothing new on GitHub · agent calls 12/19"). Rejected: a
  timed trickle of all quiet news (same work, less batching), and skipping
  bot-only dossier updates (bot comments already never start one).
  Same day: pushes ride along instead of rewriting the dossier (they
  refresh their own PR's glance), and the glance hash drops the dossier
  version, so one PR's news no longer leaves every glance in the topic out
  of date. Old glance hashes stay accepted, so the update regenerates
  nothing. DESIGN.md "Event roles" and "Glance hash".
- **Title bar says "up to date"** (2026-10-05, DESIGN.md "Auto sync"): the
  live poll checks GitHub every minute, so "synced 40m ago" (the last full
  sync) suggested stale data that wasn't. The title bar reads the poll:
  "up to date" while it keeps up, "updates paused" while it is blocked or
  backing off, "checked 5m ago" with an amber dot once it missed three
  cycles, "synced 2h ago" only with the poll off. The full
  sync's time, counts and report sit in the tooltip; the footer says "last
  full sync".
- **The PR pane by audience** (2026-10-05, DESIGN.md "The PR pane"): eight
  rules (act where you read, one surface per audience, fixed order, use
  and pointer set prominence, say where it goes, one way to write, depth
  on GitHub, the agent holds no controls). The review row is its own row
  right after the glance: shortest pointer path from the tile. Replies
  live in the activity; "New since" only jumps there. The agent chat is
  topic-scoped and takes over the right pane. Rejected: buttons welded
  into the glance, a review row in the PR header, a composer dock, a "your
  move" card that reorders actions, reply composers inside "New since",
  chips and a three-button card for lasting points, an agent sheet over
  the app.
- **Agent chat per topic** (2026-10-05, DESIGN.md "Topic chat"): "Ask the
  agent" moves from the tile to the topic header; stored in `chat_message`
  under `topic:<id>`, no migration.
- **Self-update** (2026-10-03, DESIGN.md "Self-update"): the app downloads
  releases itself (electron-updater, GitHub provider) and the reminder
  offers "Restart to update"; the brew command stays as the fallback. The
  cask says `auto_updates true`. Rejected: update.electronjs.org and an S3
  feed.
- **Repo on the owner line, loud narrowed menu** (2026-10-02, DESIGN.md
  "Repo scope and quiet repos"): the topic's main repo is plain mono text
  with a book glyph on the "Owned by" line, honey "mostly in X" when the
  picked repo holds only some of its PRs. Rejected: a repo pill in the
  header's pill row and a square outlined tag (more grey pill soup). The
  narrowed repo button is accent filled with an ×; the menu tints only the
  "Recommended" tag green, not the whole "All repos" row.
- **Lessons, not silent learning** (2026-10-02, DESIGN.md "Lessons from your
  reviews"): a review is evidence, accepting a lesson is authority. Misses
  become candidate lines in the topic; nothing changes later glances until
  the user picks "Remember in this topic" or "Use across topics…". The
  agent writes the instructions text, the user's click makes it theirs.
  The user's own GitHub review may feed an instructions proposal (fenced,
  additions only). Rejected: "Disagree" / "Wrong" / "Why?" affordances (read
  as asking for an explanation, not as teaching), writing misses straight
  into topic corrections, and global proposals after N misses.
- **Proposals must earn their interruption** (2026-10-02, DESIGN.md
  "Consolidation"): a proposal interrupts the user, so it needs a real
  reason (no placeholders, at least 15 characters); a rule needs at least
  one correction in the user's words, never only bare Not mine / Not
  related / Wrong topic clicks; a merge says how the PRs serve one goal and
  what the user gains, never "both small" or "both finished" (finished is
  retirement's job); a rejected change is not asked again, a merge in
  either direction; proposals about topics that left the sidebar are
  withdrawn, which is not a rejection. No proposals is the expected answer
  on most runs.
- **Capped snapshots get older pages** (2026-10-02, DESIGN.md "Handled
  quietly" › Capped snapshots): when a fetched PR's snapshot hits a query
  cap and its thread is unread, the capped lists are paged back to the
  thread's `last_read_at` (to the end for a never-read thread), then the
  normal quiet-read rules apply. Coverage is one core helper
  (`snapshotCoversSince(pr, since)`, each rule passes its own `since`);
  review threads count only when complete. Budgets: 5 pages per list, 10
  PRs per sync, 3 per poll, none while the quota is low.
- **Dealt-with topics leave the list** (2026-10-02, DESIGN.md "Dealt-with
  topics leave the list"): quiet topics in You drive, Your team owns and
  Other work go behind one "+ N dealt with" line per section, like Gmail
  archive or GitHub's Done; not while the search or a PR filter is on, never
  the selected topic. Dimming alone (quiet rows) still took space and
  clicks. Dealt with is not Archive.
- **Answers in a live conversation always ping** (2026-10-02, DESIGN.md
  "Live poll and Mac pings" › Decision): a person's mention, reply or
  question within two hours of your own comment or review pings, and the
  agent only words it. Replies that landed while GitHub still showed the
  thread as read are decided once it turns unread.
- **Approve with comment and Comment review** (2026-10-02, DESIGN.md "Own
  PRs never ask for a review"): Approve on the PR pane is split (approve
  now, or with an agent-drafted note); "Comment review" posts a COMMENT
  review on the seen head, to answer a review request without being the
  approval that clears the PR. Ask, both notes share one compose popover.
  Tiles and the agent's Approve stay without a body.
- **Review note drafts say only what the author lacks** (2026-10-02,
  DESIGN.md "Review note drafts"): one or two sentences, never a retelling
  of the change or a list of what was checked. The first drafts restated
  the PR back to its author.
- **Ownership sections** (2026-10-02, DESIGN.md "Ownership sections"):
  below the asks, topics sit under You drive, Your team owns or Other work
  by who drives them; the owner team only places a topic without a known
  driver (a weak signal, Codex's point). My PRs and Team's PRs are gone, and
  so are the Needs you / Your team / Routed to you groups in Other topics;
  FYI and the Archive stay. Other work folds by area ("More" for
  single-topic areas) and starts open only for your PR, move or unread.
  Topics without a dossier or driver are "not sorted yet".
- **Driver picker and team as driver** (2026-10-02, DESIGN.md "Driver
  picker", "Team as driver"): "<login> drives" on the header is a menu (You,
  each teammate, Your team, Someone outside your team, Reset to automatic);
  the pick moves the topic, stands until changed, beats the agent and goes
  into the dossier prompt. The dossier agent may name the home team as a
  standing topic's driver (`driverTeam`), stored like the picker's "Your
  team".
- **Merge queue like Trunk's extension** (2026-10-02, DESIGN.md "Merge
  queue"): the queue icon replaces the git icon while a PR is in the merge
  queue, pending amber, red once the queue took it out, the merged icon
  back once merged. Also for GitHub's own queue (was a purple open icon).
- **Marked when the dwell ends** (2026-10-01, DESIGN.md "Actions act on
  what you look at" › "Marked when the dwell ends", supersedes "Marked when
  you move on"): the opened mark fires when the 1.5s fill completes, and
  the button says "✓ Marked read" with an Undo (the mark-read undo window).
  Owner: "it bothers me more that it doesn't act than the reshuffle would".
  The tile and its topic row still hold their place until the selection
  moves, then slide there (FLIP, 420ms) and the tile lights up briefly; the
  unread dot fades out. "Marks read when you leave" and "Keep unread" are
  gone. The opened mark now goes through the mark-read queue, so it no
  longer shows under Handled quietly.
- **Project and standing topics** (2026-10-01, DESIGN.md "Topic kinds"):
  `topic.kind` is `project` or `standing`; the agent picks it, the grain 3
  tidy sorts existing topics. Projects in the Archive take follow-ups for 30
  days; standing topics retire only after 6 months with no new PR (user's
  rule). No third kind (research: incidents are short projects, chores are
  single tiles). The kind is the agent's: no user switch, no proposals; a
  dossier update may correct it. A finished project's afterlife (others
  extending it) starts a standing topic instead of converting the project.
  Ownership: routed PRs join the standing topic that keeps their standard.
- **The Archive** (2026-10-01, DESIGN.md "Topic status"): a topic with
  nothing left goes after 2 days without human activity (bots don't count);
  "Archive now" in a box in the topic's action row, at the Approve height,
  skips the wait (user picked the box over a header button or a sidebar row
  action). "Finished" drawer renamed "Archive"; code keeps `retired`.
- **Refresh a stale glance on look** (2026-10-01, DESIGN.md "Glance
  refresh on look"): a PR shown in the detail pane for 1.5s with a stale
  glance asks for a glance-only catch-up of that PR, from the topic's
  dossier as it is. Coalesced with the topic's catch-up queue, counted
  against the daily catch-up cap, nothing over it or with catch-up off.
  Owner: the hourly sync is too slow when they are looking at the PR; only
  opened PRs refresh, so the cost stays low. The stale note says "next
  sync" only when the refresh can't run (`glanceRefreshBlock`). Automatic,
  so "No manual refresh per PR or topic" (2026-09-29) stays.
- **Bots on your own open PR clear quietly too** (2026-10-01, DESIGN.md
  "Handled quietly" rule 2, removed): a bot's review or inline comment no
  longer keeps your own open PR unread. Owner: "I never care about bot
  replies... and it's my PR so I will have it on the radar anyway." A
  finding that matters shows as failing checks or unresolved threads.
  Triggered by ReviewHog's FLASH-mode review keeping an own PR unread. The
  other own-PR logic (loudness, pings, whose turn) stays.
- **Agent Approve goes base up on a stack** (2026-10-01, DESIGN.md
  "Agent-assisted actions" › "Base up on a stack", "Approve labels"): a
  layer is covered only when no approvable layer below it needs a look;
  the layers above wait on it ("waits on #N"). Layers below that need no
  review (merged, draft, own, approved already, pulled in) don't block. One
  covered PR out of several is named ("Approve #2107"); "Approve stack"
  only when every PR on the tile is covered.
- **One colour per meaning** (2026-10-01, DESIGN.md "Colour per meaning"):
  amber only for Look closer, Needs review neutral ink, queued merged
  purple, one red for bad (closed, changes requested, risk), one green for
  good (approved, Looks safe, Approve), coral only for unread, honey only
  for your move.
- **The tile pill shows the worst verdict** (2026-10-01, DESIGN.md "Tile
  faces" › "The verdict pill shows the tile's worst glance"): the worst
  glance among the tile's open tracked PRs, not the lead PR's. No row
  glyphs, no "N of M", no topic header roll-up.
- **Your move in the topic header and group headings** (2026-10-01,
  DESIGN.md "Your move in the header and the group headings"): the header
  shows the sidebar's chip, group headings add "· N your move", both counted
  by core. The headings drop the your-move part while search filters or a
  tile is held outside its group.
- **Topics with: the sidebar filter** (2026-10-01, DESIGN.md "Topics with:
  the sidebar filter"): one "Topics with any PR | my PRs | team PRs" switch
  replaces Mine / Team / Reply / Review; sections stay while it narrows; a
  mixed topic follows the work (your own PR never lifts it); "N topics
  without your PRs are hidden · Show all"; opened topics always show all
  tiles, your own first in each group; no new markers.
- **✨ marks agent-backed actions** (2026-09-30, DESIGN.md "Agent-assisted
  actions"): a ✨ goes on a button or action only when it is on offer
  because an agent's verdict supports it, in a pill that says what the
  agent judged (risk level, or why it cannot back it). Topic and tile
  Approve take only agent-safe PRs (Looks safe, low or medium risk, current
  glance) and ask first; a tile, like the topic, approves the agent-safe
  subset (2026-10-01, was all-or-nothing). Not backed means greyed out with the reason;
  nothing to act on means no button. Mark read skips tiles with asks for you. Only actions carry ✨, never
  text. Tile Mark read is always offered, so it stays plain.
- **Tiles hold still** (2026-10-01, DESIGN.md "Tiles hold still"): topics
  stay the focus; a set is a lasting tile of PRs one judgement covers (same
  change or pattern, similar risk by the glance's level, the same kind of
  author preferred); status, turn, review, unread and CI never move a PR
  between tiles; the agent changes sets without asking, with a recorded
  reason; no separate risk class ("gears") and no rules per repo; no big UI
  changes; batch approve is PR #48's.
- **Groups inside a topic** (2026-09-30, DESIGN.md "Groups inside a topic"):
  the tile grid's All / Unread toggle is gone; a topic shows three groups,
  always Unread, Open, Dealt with (n), empty ones hidden, Dealt with folded
  by default, then as the user last left it (kept for the session). Core ships each tile's `group` and
  `newBadge` and the unread counts; the renderer only displays them, and a
  static test fails when renderer code works unread or done out from raw
  state. "Done" as a tile label reads "Dealt with" (internal state stays
  `done`); finished topics stay "Finished".
- **Comment edits, findings, new moves, read before acting** (2026-09-30,
  DESIGN.md "Handled quietly" › Comment edits and New moves only, "You
  already dealt with it" › Read before acting): a comment's latest edit is a
  `comment_edited` event (bots clear quietly, a person's edit that mentions
  you is an ask); on your own open PR only a bot review or inline comment
  kept the thread unread (dropped 2026-10-01); a move that stood before your last read does not;
  acting counts as having seen earlier news only with a read in between,
  and then also makes the PR done without a click.
- **Tiles lead with the important news** (2026-09-30, DESIGN.md "Tile faces"
  › Headline event): the strip's event is chosen by importance across the
  tile (asks, merged or closed without review, verdicts, human comments,
  other human events, automation), newest within a class, never by recency
  alone. Bot events get no NEW badge unless loud. HTML comments are stripped
  from summaries.
- **GitHub unread is PostPile unread** (2026-09-30): every PR notification
  unread on GitHub is either cleared by PostPile because it is obviously
  clearable (bots only, you acted after it, or everything since you last
  looked is bots or people the events agent judged as not needing you) or
  shows unread in PostPile. Other notifications (releases, issues, security
  alerts) stay on GitHub untouched, unless the user clears them in the
  catch-up dialog (2026-10-03). A tile is unread
  while a thread of it is unread, done or not; snooze stays; loudness keeps
  pings, coral and urgency. Asks never clear by themselves. A finished topic
  never holds an unread thread. "Start fresh here" is gone. Also unread:
  loud news on a pulled-in layer and an unseen Look closer event (unread
  here while read on GitHub is fine). A thread never read and never reviewed
  or commented on is not judged-clearable; routing-team mentions are FYI;
  your move blocks the judged clear. See DESIGN.md "GitHub unread is
  PostPile unread".
- **Equal tiles and detail, whole-tile click** (2026-09-30, owner review of
  the polish pass): the tile column and the detail pane split what the
  sidebar leaves evenly by default (dragged widths stay); the 720px tile cap
  is gone. Selecting a tile shifts nothing (every frame is a 1px border), and
  a click anywhere on a tile selects it; controls inside keep their own action.
- **Green Approve** (2026-09-30, interface polish pass): Approve, the one
  irreversible-and-positive action, leads in `--safe` green with
  `--elev-safe`, the same color as the "Approved" state it produces. Every
  other lead (Snooze, Mark read, Mark done) stays ink; accent blue stays for
  selection and focus only. Replaces "Ink primary buttons" for Approve.
- **Dock badge, cleared pings, bounce** (2026-09-30): the Dock badge is the
  number of topics with an unread tile, like unread channels in Slack
  (changed later that day; it counted your-move tiles first; replaced
  2026-10-05 by the count of pings not handled yet, see "A helper, not an
  interrupter"). A ping leaves Notification Center once
  its tile is read, done or snoozed. The Dock bounces once for a personal ask
  (mention, question, reply, review requested from you, answer to your
  changes request) while the window is not focused. See DESIGN.md "Live poll
  and Mac pings".
- **From the property tests** (2026-09-30): a re-request after your changes
  request says "Re-review, ada asked" (move `re_review`), with or without a
  push; the PR stays under Changes you requested, and the order inside that
  section follows the move. Every snooze ends on merge or close. An override
  to loud wakes a snooze whether the agent or the user set it. Loud news on
  a pulled-in stack layer dots that layer, and a stack with one tracked PR
  plus such a layer dots both rows while the tracked PR is not done. The
  quiet-read grace counts from the newest activity, human or bot. DESIGN.md
  "Decided from the property tests".
- **Bot-authored PRs belong to their assignees; tiles show assignees that
  differ from the author** (2026-09-30): a PR's owners are its author,
  except a bot author with assignees, then the assignees. A person's PR
  never becomes the viewer's through an assignment. DESIGN.md "PR
  ownership".
- **Teams are home or routing** (2026-09-30): decided from review history
  (20% of reviews via the team and has at most 10 members, 2026-09-30:
  share alone made a 40-person approver group home; size alone decides
  with under 30 reviews);
  the user can flip; no home team is valid; bot-made review requests count
  like human ones. A routing team's chip is neutral without band (sea
  means your team), its mentions are FYI, and its request is never "For
  you" on a teammate's PR. DESIGN.md "Team roles".

- **Review requests by whom they ask; routed reviews ping on Look closer**
  (2026-09-29): a `review_requested` event aimed at the viewer or their team
  counts whoever made it, bot or person. A routed team request never pings
  from the poll; it pings once per request when its glance says
  LOOK_CLOSER, even after a teammate reviewed, and marks the tile unread
  ("Look closer: review routed to <team>"). "Ping all unless not yours" was
  turned down (30-40 pings a day). DESIGN.md "Events" and "Live poll and
  Mac pings".

- **Actions act on what you look at** (2026-09-29): the detail pane's
  Mark read / Mark done / Approve act on the selected PR (per-PR label, per-PR
  undo, Snooze in the pane only on single-PR tiles), the tile footer on the
  tile. One coral dot per unread PR (since 2026-09-30 the dot means exactly
  "unread", it was "Not done yet" before), no second read-only dot. Counts
  are tiles, dots are per PR: the sidebar bubble and footer number count
  unread tiles (owner, 2026-09-30).
  Opening a PR in PostPile also handles it, checked per PR. The lead PR
  (core `leadPrKey`) prefers the turn's PR. Whose turn names the
  re-reviewer after a push and a re-request. The own-PR bot exception first applied only while the PR was
  open (dropped altogether 2026-10-01). Marking read from a guess (finished team requests handled by a
  teammate, lost mentions) stays turned down. Added the same day: "Remove
  <team>" in the detail pane removes a team review request, unsubscribes
  and marks the PR done (confirm once, no undo, blocked while locked);
  moving read routed requests down on their own was turned down. Also the
  same day: the opened mark fires when you move on (dwell arms, leaving
  fires; superseded 2026-10-01: it fires when the dwell ends, with an
  Undo), and the selected tile and its topic row keep their place until
  the selection moves. DESIGN.md "Actions act on what you look at".

- **UI fixes from the screen review (2026-09-29)**: Julian signed off on ten
  items from the mockup page. A stale glance's verdict box goes grey and
  dashed with "out of date" and its advice folded; one wording, "updating"
  while a sync or catch-up runs, else "out of date"; the detail pane leads
  with the tile's action (Approve only while due, "Approve again"
  outlined), role chips are nouns ("Reviewer"); deletions get their own
  diff red and the Checks fact goes neutral grey ("N checks · M not
  passing"); a single PR's title shows once and its detail header has no
  counter or arrows; no cost in the status bar; sidebar faces are PR
  authors with you and your team in a sea team pill; `--hint` for small
  text that carries information (faint only for decoration); a repeated
  source chip once per block; a coral dot on the PR that keeps a tile
  unread. DESIGN.md "Tile faces", "Three-pane balance", "Queue sections",
  "Glance catch-up" › "Out of date wording".

- **A push answers an ask on your own PR; mentions are not called replies**
  (2026-09-29): whose turn counts your last touch (comment, review, push to
  your own PR) as the answer to a mention or reply; the move text says what
  happened ("lyra mentioned you"), only a question says "Answer …".
  DESIGN.md "Whose turn" rule 2.

- **You already dealt with it** (2026-09-29): your own action on a PR (your
  last touch: review, comment, push on your own PR) makes earlier events
  seen; threads whose unread activity all predates it get marked read on
  GitHub (not for pushes); opening a PR in PostPile marks it read when
  nothing is asked of you. DESIGN.md "You already dealt with it".

- **CI is not a signal** (2026-09-29): CI status feeds no agent prompt
  (glance, dossier update, ping decision, memory recheck, chat, topics), no
  hash and no dossier delta; the glance and dossier update prompts say not to
  mention it in any field. Whose turn has no "Fix failing CI" move any more,
  and CI events stay quiet: never a ping or an unread reason. Kept: CI as a
  subject of the work (topic names, workflow files), the "Checks" fact in the
  detail pane, the folded bot/CI activity line, and the user's own snooze
  "Until CI is green". No prompt version bump: stale glances and dossiers
  refresh on the next real change. Julian: "it's always the responsibility
  of the author to bring the PR to green. Except for maybe some details in
  the detail pane, we shouldn't highlight it or put it into text or into any
  risk." Follows design 3a (CI off tiles, same morning). DESIGN.md "CI is
  not a signal".

- **The live poll obeys X-Poll-Interval, plus a cycle on focus**
  (2026-09-29): the poll waits the configured interval (default now 60s)
  or GitHub's X-Poll-Interval, whichever is longer; `POSTPILE_POLL_SECONDS`
  never goes below the header once GitHub sent one. Window focus runs one
  cycle right away, unless one started in the last 15s. Research first: no
  push API for a user's notifications, the docs say "Please obey the
  header", the real log shows 60s every time, and GitHub warns it can ban
  misbehaving integrations. Julian: "switch to 60s plus poll on focus".
  Replaces the 10s poll of 2026-09-28. DESIGN.md "Live poll and Mac pings".

- **Handled quietly: bot-only activity gets marked read** (2026-09-29): a
  thread you had read that turned unread only because of bots is marked read
  on GitHub by PostPile after a full sync, 10 minutes after the last bot
  activity at the earliest, only while writes are unlocked. Never with an unseen merge without your
  review, never while the tile is unread or it is your move. Rules only, no
  agent. The sidebar's "Handled quietly" lists the last 7 days. Pings get
  one hourly telemetry summary (`pings_summarized`, counts only), and the
  notifications debug view shows ping decisions. DESIGN.md "Handled
  quietly".
- **A reply that asks nothing is not your move** (2026-09-29): whose turn,
  Needs reply and the after-read toast skip an ask (reply, mention,
  question) the events agent lowered to quiet or muted. The agent prompt
  says a plain acknowledgement ("thanks", "yeah that's fine") is quiet, and
  read personal asks go to the agent too. Julian: "if the author just
  replies 'Oh yeah, that's fine,' that's not my move to reply again".
  DESIGN.md "Whose turn", rule 2.

- **Each topic once in the sidebar; "Changes you requested" under Needs
  reply** (2026-09-29): a topic shows only in its highest section (the
  queue filters still find it by any PR). New section for open PRs where
  your latest review requests changes, addressed ones first. Your own PR
  stays under My PRs whatever its area. DESIGN.md "Queue sections".

- **Merged without your review is surfaced, never loud** (2026-09-29
  evening, tried on the "PostPile Tile Rules" page first): the tile stays
  open with a grey strip until you mark it read; a "Not yours" glance
  settles it; glances run after the merge; topics wait for it before they
  retire; the topic row shows "N merged without you". The instructions phrase
  that made it loud is gone. Only your own review counts, also for team
  requests. Full rules and their history: DESIGN.md "Merged without your
  review".

- **PostPile never uses the full GitHub quota (2026-09-29)**: it shares the
  hourly limits with the user's own gh and tools (same token), so it leaves
  clear headroom. With 50% or less of a limit left, the hourly auto sync and
  its backlog follow-ups wait for the reset and the live poll slows to once
  a minute; at 20% or less the live poll waits too. "Sync now" and the start
  sync still run (logged). The footer says so only while low. DESIGN.md
  "GitHub quota".
- **Areas name a part of the codebase, not the user's field** (2026-09-29):
  "Dev tooling" held 70 of 113 topics. The prompts now ask for the part the
  work touches ("Data warehouse", "posthog-cli") and replace catch-alls on
  the next dossier update. No area filter for now: see first whether the
  breadcrumb and the area folds become useful with real labels.

- **MCP asks go through the running app, never around it** (2026-09-29):
  `refresh_from_github` and `propose_topic_change` leave a request file in
  the data folder for the app; no port, and the app's HTTP token (it can
  approve PRs) is never handed out. App closed: nothing is queued. Outside
  topic suggestions are never applied without the user's Accept.

- **MCP server: nudge, never install silently** (2026-09-29): a footer item
  ("agents: not connected") and an optional box on the setup Accept step
  offer "Add to Claude Code"; `claude mcp add --scope user` runs only on
  that click, only in the installed app. "Not now" hides the footer item
  for good; setup still offers it.

- **Topics are cut by goal; small splits apply themselves** (2026-09-29):
  one glossary (area, topic, tile, set) for every agent. A PR stays in a live
  goal topic it serves or came out of; with no live goal, a new topic, no
  catch-all "fixes and upkeep" topic. Consolidation (still at most daily)
  applies splits of up to 3 PRs without asking and without undo ("Wrong
  topic" fixes a bad one); bigger splits stay proposals.
- **Finished topics retire on every sync** (2026-09-29): a topic whose PRs
  are all merged or closed, with nothing unread or snoozed and no events for
  3 days (was 14), is retired by every full sync, no agent verdict needed.
  Consolidation keeps its own retire path behind the same gate. Retired
  topics from the last 30 days sit in a folded Finished drawer at the bottom
  of the sidebar and open like any topic; a new event or PR brings them back.
- **Routed team requests go on hold** (2026-09-29): while someone else's
  changes request stands it is the author's move; when the glance says Not
  yours it is nobody's move and a mark-read makes it done. Personal and
  teammate requests never go on hold. Tiers are unchanged (still To review).

- **Selection never moves on its own** (2026-09-29): after an action or a
  refresh the selection stays where it is; the fallback to the first match
  only runs when the user changes the filter or picks something, or the
  pick is gone. A topic kept this way stays listed in the sidebar as usual,
  no extra marker.

- **Mark read vs Mark done honest; after read with your move left, Snooze
  is primary; no re-sorting** (2026-09-29): "Mark done" only where a
  mark-read makes the tile done. A read tile that is still your move shows
  Snooze as the main button with "Review on GitHub" next to it, and the
  toast after the mark-read says it is still your move. The tile keeps its
  place; queues and sections do not change.

- **Revisits** (2026-09-29): the why-now strip says what changed since
  your last touch; New since you looked sits under the title; quiet events
  never count. Layout, size and place of the strip stay; first-time asks
  keep today's wording; nothing is shown twice in the detail pane.

- **Versioning: no `-alpha` suffix, count up minors** (2026-09-29): after
  `0.1.0-alpha.0` every release is the next minor (`0.2.0`, `0.3.0`),
  quick fixes bump the patch (`0.2.1`). Alpha is said in words (README,
  release notes), not in the version. Such releases are not marked
  pre-release on GitHub; that is fine. The update check already orders
  `0.1.0-alpha.0` before `0.2.0`. This release is 0.2.0.

- **Usage analytics on by default, no UI opt-out** (2026-09-29): env
  switches only (`POSTPILE_TELEMETRY=0`, `DO_NOT_TRACK=1`). Identity is a
  hashed GitHub id, never the login. No session replay, no autocapture.

- **Glances catch up automatically** (2026-09-29): ASAP after the poll
  brings news, with one queued follow-up per topic; hourly auto sync; no
  manual refresh button, only Retry on a glance that failed.
- **Stack mark: layers tag with 1/3 before the title, variant A**
  (2026-09-29). A stack layer's PR rows (stack tiles, stacks inside sets,
  the detail member list) and the detail title get a light-blue layers tag
  with the position, 1 = bottom. Lone PRs get nothing; "Stack · N" in the
  tile header stays.
- **No RISK box for a low risk** (2026-09-29): the verdict box covers it;
  medium, high and unlabeled risks keep the red box.
- **The agent places every PR** (2026-09-29): "I want to make sure from the
  beginning that the agent places each PR. If it doesn't fit an existing
  topic, just make up a new one. I don't want to let it leave lingering and
  later need a tidy-up process." No "unsorted" answer, no new-topic cap, no
  deferral. Topics stay few through the prompt (existing first, broad names
  after the work); consolidation still proposes merges for 1-2 PR topics.
- **CI status only in the facts section; PR state as icons + words per the
  3a design** (2026-09-29): rows, tiles and the detail state line show the
  lifecycle as a GitHub-style icon and the review state as icon + word;
  checks show only in the detail pane's "Checks" fact. The agent may still
  mention CI in its own glance text.

- **Sonnet 5.5, pinned** (2026-09-28): the Sonnet calls use the full id
  `claude-sonnet-5-5` instead of the `sonnet` alias. claude CLI 2.1.284
  resolves the alias to the same model, but the pin keeps it from moving
  with CLI updates or user settings. Opus stays on the alias.

- **Bot approvals are a neutral signal, shown in words** (2026-09-28): an
  approval by a bot (an AI review agent like reviewbot[bot]) counts like
  any approval, as on GitHub. The app says who approved ("approved by
  reviewbot (agent)") instead of warning about it, and glances get it as a
  fact. Treating agent-only approvals as a warning was considered and
  dropped.

- **Setup picks** (2026-09-28): Accept does not narrow the repo scope by
  default. The main repo radio starts on "All repos"; the suggested main
  repo carries a "suggested" chip with its reason and the user can pick
  it. A refine keeps the user's own quiet toggles and main repo pick; only
  untouched toggles follow the new draft.

- **Setup real-account check** (2026-09-28): ran the sweep and draft
  against a real account with scratch state (`pnpm cli setup-draft`).
  The reviewed-by search worked; CODEOWNERS alone was too thin for a repo
  that keeps ownership in owners.yaml, so the sweep reads those too, and
  the prompt now asks for owned areas with paths instead of one line per
  PR.

- **Team mentions ask only until read** (2026-09-28): an unanswered
  team_mention is "your move" until the tile is read. After a mark-read (or
  a read on GitHub) it no longer keeps the tile off Done or the topic in
  needs-you. Personal asks are unchanged: they hold until answered.

- **Done means nothing is asked of you** (2026-09-28): a tile is done only
  when merged/closed, approved by you, or marked read with whose turn not
  yours and no review pending of you or your team. Mark read on a PR that
  still waits on your review makes it read but keeps it in the tile list
  and To review, never in the Done fold.

- **Team request on a teammate's PR counts like a personal one**
  (2026-09-28): "For you", whose turn "Review for team-devex: lyra's PR",
  To review before routed team requests, pings like a personal request.
  Covered once another teammate approves or requests changes (a comment
  alone does not). Personal requests on a teammate's PR move from Team's
  PRs to To review as well. Team requests on PRs from outside the team
  keep the sea chip.

- **Approved once stays done** (2026-09-28): Approved once stays done;
  pushes after approval are quiet unless re-pinged or the agent raises
  them. The approve button stays usable after a push (approving again is
  harmless) but never nags.

- **Assessment boxes** (2026-09-28): the detail pane shows the glance as
  a box titled with the verdict plus a risk box, marked short lines, and
  the action bar under it (mockup ForWhom2, part 2 variant 1). The verdict
  and risk level each appear once.

- **For whom as words and a band** (2026-09-28): tiles show "For you" /
  "For <team>" / "Your PR" chips and a 4px left band in honey / sea /
  neutral instead of the RV/RT/@/... code badges (mockup ForWhom2, part 1
  variant B). PR rows get the small chip without the band.

- **Repo scope is one repo that picks topics** (2026-09-28): "All repos"
  or exactly one repo, replacing the multi-select. The repo selects
  topics (at least one PR in it), never tiles: an opened topic shows all
  its tiles across repos, never filtered or faded, with a small neutral
  repo label on the ones from another repo. A stored multi-selection
  migrates: one entry stays, several become All repos.

- **Sweep skip list** (2026-09-28): private projects are kept out by a
  skip list before anything leaves the machine, not only by the prompt.
  `~/.claude/projects` folders matching `personal`, `private` (or `POSTPILE_SWEEP_SKIP`) are
  never read. Defaults made generic for the public repo (2026-09-28): they
  ship with the app, so they hold no real project names; a personal
  list goes in `sweepSkip` of `~/.config/postpile/config.json` (editable in
  the app, works for the packaged app from Finder), or `POSTPILE_SWEEP_SKIP`,
  which wins.

- **Pending writes, not local reads** (2026-09-28): a mark-read while
  locked changes nothing in the app; it waits as a pending write until the
  user sends or discards it. Approve and comment have no pending queue.

- **No bring back** (2026-09-28): GitHub is the source of truth for read
  and unread, and it has no mark-unread (no REST or GraphQL mutation). An
  app-only bring back split the state, so it is removed (migration 010 drops
  `brought_back_at`); old `bring_back` log rows stay.

- **Rules layer** (2026-09-29): facts from a PR's history are one
  projection in core read by every consumer; real lifecycles (read, snooze,
  topic status, pending write) are transition functions. No XState, no rule
  engine. Handled is not reset by new loud activity. Snoozes belong to PRs;
  a tile is snoozed while all its tracked PRs are. See DESIGN.md "Rules
  layer: one home per fact".

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
pnpm install
pnpm --filter @postpile/desktop exec install-electron   # Electron 44 no longer downloads on install
pnpm typecheck
pnpm test
```

CLI (the main way to test without UI):

```
pnpm cli sync --limit 10 --no-agent     # cheap first look, no claude calls
pnpm cli sync                           # full sync with the agent
pnpm cli sync --max-agent-calls 5 --agent-jobs topics,dossiers,glances
pnpm cli topics
pnpm cli topic <id>                     # with the dossier and changes since seen
pnpm cli pr owner/repo#123              # with facts
pnpm cli consolidate [--if-due] [--max-agent-calls n]
pnpm cli poll                           # one live-poll cycle, prints ping decisions
pnpm cli sweep                          # "what you're working on" from ~/.claude, one opus call
pnpm cli setup-draft                    # setup checks, sweep and the drafted instructions with sources, one opus call
pnpm cli tools                          # gh and claude: found where, logged in, the fix when not
pnpm cli simulate-start --from <copy.sqlite> --dry-run   # a new user's first syncs, old vs combined pipeline (docs/development.md)
```

Setup draft against a real account with scratch state (writes no
instructions, stores only the viewer in the scratch database):

```
S=/tmp/pp-setup; mkdir -p $S && : > $S/instructions.md
POSTPILE_DATA_DIR=$S POSTPILE_INSTRUCTIONS=$S/instructions.md XDG_CONFIG_HOME=$S/config \
  POSTPILE_READ_ONLY=1 pnpm cli setup-draft
```

Smoke run on a throwaway database, read-only:

```
POSTPILE_READ_ONLY=1 POSTPILE_DB=/tmp/cm-smoke/db.sqlite \
  pnpm cli sync --limit 15 --max-agent-calls 6
```

Desktop and server:

```
pnpm desktop       # Electron dev mode, server in-process on a random port + token
pnpm server        # standalone API on 127.0.0.1:4870, prints its token
```

The desktop app syncs once on start, on "Sync now" and every 60 minutes in the
background. Between syncs it polls notifications every minute (GitHub's
X-Poll-Interval) and when the window gets focus, pings the Mac for
addressed activity and catches up dossiers and glances of the topics the poll
brought news for. Dev runs start with GitHub writes locked until the lock in
the status footer is opened (the choice is kept in the database; only the
packaged app has them on by default); locked, approve and comment are blocked
and mark-reads wait as pending writes:

```
pnpm build                                 # electron-vite bundle into apps/desktop/out
```

UI check in fake mode as a plain web page (no Electron):

```
POSTPILE_FAKE=1 POSTPILE_TOKEN=devtok PORT=4877 pnpm server
(cd apps/desktop/out/renderer && python3 -m http.server 5177)
open 'http://127.0.0.1:5177/index.html?api=http://127.0.0.1:4877&token=devtok'
```

The renderer syncs on load. Against a real database that means real GitHub
reads and agent calls; use a DB copy with `POSTPILE_READ_ONLY=1
POSTPILE_MAX_AGENT_CALLS=0`, or `POSTPILE_SYNC_ON_START=0` to skip it.

Fake mode (sample "Move CI to Depot" data, no GitHub, no agent, no database):

```
POSTPILE_FAKE=1 pnpm cli topics
POSTPILE_FAKE=1 pnpm desktop
POSTPILE_FAKE=1 pnpm server
```

MCP clients and the UI on one fake sample (the plain `POSTPILE_FAKE=1 pnpm
cli mcp` keeps its own copy, so nothing it files shows in a UI):

```
POSTPILE_FAKE=1 POSTPILE_TOKEN=devtok PORT=4877 pnpm server
POSTPILE_TOKEN=devtok pnpm cli mcp --api http://127.0.0.1:4877   # stdio MCP over that server's engine
```

`note_pr` `covered_by` outside the sample: `acme/app#1000`-`#1999` are
read once as pulled-in PRs, `#90000`+ are missing on GitHub, `#1777`
answers pending once; anything else is refused.

Env switches:

- `POSTPILE_READ_ONLY=1`: real reads, every GitHub write refused, the
  footer lock cannot be opened. Use this for smoke runs against the real
  account.
- `POSTPILE_FAKE_LOCKED=1`: with `POSTPILE_FAKE=1`, the sample starts with
  GitHub writes locked (it starts with them on, like the packaged app).
- `POSTPILE_FAKE_FAIL_WRITES` (with `POSTPILE_FAKE=1`): sample writes fail
  like GitHub would answer (502, a 403 for `react`), logged as `failed`.
  Comma separated `approve`, `comment_review`, `comment`, `reply`, `react`,
  `mark_read`, or `all`; `once:<kind>` fails only the first call.
  `POSTPILE_FAKE_FAIL_SEND=1`: "Send N to GitHub" fails and the rows stay
  pending with the error. `POSTPILE_FAKE_DELAY_MS`: every write, draft,
  topic chat answer and recheck waits that long (default 0):

  ```
  POSTPILE_FAKE=1 POSTPILE_FAKE_FAIL_WRITES=once:approve POSTPILE_FAKE_DELAY_MS=1500 POSTPILE_TOKEN=devtok PORT=4877 pnpm server
  ```
- `POSTPILE_FAKE_DELIVER` (with `POSTPILE_FAKE=1`): scripted news on the
  sample, comma separated steps (`apps/server/src/fake/fake-script.ts`,
  `GET /api/fake/steps` lists them). Each sync after the start sync
  delivers the next one, like a sync that fetched news; steps run once.
  `POST /api/fake/advance {"step":"..."}` runs one at once (fake mode
  only, token needed):

  ```
  POSTPILE_FAKE=1 POSTPILE_FAKE_DELIVER=ask-you,push POSTPILE_TOKEN=devtok PORT=4877 pnpm server
  curl -H 'x-postpile-token: devtok' -H 'content-type: application/json' \
    -d '{"step":"bot-only-read"}' http://127.0.0.1:4877/api/fake/advance
  ```
- `POSTPILE_FAKE_LIVE=1` (with `POSTPILE_FAKE=1`): the standalone server
  starts the fake live poll and the auto sync like Electron main, so the
  footer reads "live · every 60s" in a browser too. No Mac notifications;
  pings show in the debug view only.
- `POSTPILE_FAKE_EXTRA`: with `POSTPILE_FAKE=1`, comma-separated sample
  packs on top of the default sample, which stays as it is
  (`apps/server/src/fake/fake-extras.ts`). `stacks`: topics Search
  ranking, Search indexing, Session export, Query result cache, Flag
  cleanup and Lockfile bumps (#2101 to #2166), for stack tiles, per-layer
  writes, "Blocked:" on a stack, the agent Approve on stacks and a bot set.
  `pane`: topic Webhook delivery (#2201 to #2204), for the PR pane: a
  folded bot review, a bot body cut like a stored snapshot, markdown and a
  long token in a comment, raw HTML that must stay inert, and
  instruction-like text as prompt-injection test data.
  `mcp`: diffs for the overlap check (#1902 and sol's
  #2301 on the same lines, a nearby pair, a quiet lockfile pair and stack
  mates, one capped diff), for MCP checks of overlapping edits.
- `POSTPILE_MAX_AGENT_CALLS`: agent-call cap for syncs and consolidations
  without an explicit cap (launch, "Sync now", `/api/consolidate`, and the
  CLI without `--max-agent-calls`), default 150 (was 30).
- `POSTPILE_CLAUDE_DIR`: the Claude Code folder the work context sweep
  reads, default `~/.claude`. `POSTPILE_SWEEP_MODEL`: its model, default
  `opus`. `POSTPILE_SWEEP_SKIP`: comma-separated project folders the sweep
  never reads; wins over `sweepSkip` in `~/.config/postpile/config.json`
  (dev: `postpile-dev`), then the default `personal,private`;
  empty = none.
- `POSTPILE_DB`, `POSTPILE_INSTRUCTIONS`: override the database
  (default `~/Library/Application Support/PostPile/db.sqlite`) and the
  instructions file (default `~/.config/postpile/instructions.md`).
- `POSTPILE_TOKEN`: fixed token for the standalone server.
- `POSTPILE_SYNC_ON_START=0`: the renderer does not sync when it loads
  (UI and perf runs against a DB copy, no GitHub or agent traffic).
- `POSTPILE_POLL_SECONDS`: live poll interval in the desktop app, default
  60, 0 turns it off (window focus polls too). A lower value only counts
  until GitHub sends its X-Poll-Interval (usually 60); the poll never runs
  faster than that. `POSTPILE_PING_CAP`: ping decision calls per 24h,
  default 200 (then rules only). `POSTPILE_MAC_NOTIFICATIONS=0`: no Mac
  notifications whatever the Interruptions pick, the poll still refreshes
  tiles.
- `POSTPILE_SETUP_MODEL`: model of the setup draft and refine calls,
  default `opus`. `POSTPILE_FAKE_SETUP=1` (with `POSTPILE_FAKE=1`): sample
  data starts with no instructions and the setup flow showing:

  ```
  POSTPILE_FAKE=1 POSTPILE_FAKE_SETUP=1 POSTPILE_TOKEN=devtok PORT=4877 pnpm server
  ```
- `POSTPILE_FAKE_INTERRUPTIONS=unchosen` (with `POSTPILE_FAKE=1`): start
  without an Interruptions pick, like an older install, so the prompt
  shows. By default the sample starts with the pick made (Never), like an
  install that finished setup. `POSTPILE_FAKE_SETUP=1` also starts without
  one; its Accept sends the pick.
- `POSTPILE_FAKE_MISSING` (with `POSTPILE_FAKE=1`): simulates missing
  tools, comma separated `gh`, `gh-auth`, `gh-token`, `gh-offline`,
  `claude`, `claude-auth`, `claude-limit`:

  ```
  POSTPILE_FAKE=1 POSTPILE_FAKE_MISSING=gh,claude POSTPILE_TOKEN=devtok PORT=4877 pnpm server
  ```
- `POSTPILE_FAKE_QUOTA` (with `POSTPILE_FAKE=1`): `low` or `critical`
  simulates a GitHub quota that is low or nearly used, for the footer.
- `POSTPILE_FAKE_EXTRA` (with `POSTPILE_FAKE=1`): comma-separated sample
  packs added to the default sample (`apps/server/src/fake/fake-extras.ts`),
  for states it never shows. `board`: PRs #2001 and up for the board
  scenarios (approved own PR alone in its topic, a You drive trio of
  unread / dealt with / merge-ready, a teammate's draft asking you, a
  thanks that asks nothing, a Not yours merge, a closed PR with an open
  sibling, the retired standing topic "Release train"). `stress`: text
  and counts at their limits for layout checks (a 220-character title with
  emoji, backticks, `<>` and a 96-character token, a topic name over 64
  characters, #12345 in a long repo name, five assignees, "Monorepo test
  sharding" with 25 tiles and 30 PRs by eight authors and a dossier at
  every `DOSSIER_LIMITS` bound). `calm`: replaces the default sample with
  a tiny one where everything is read and dealt with (three merged topics
  showing Archive now, one topic holding only a snoozed tile, 0 unread);
  the server refuses to start when it is combined with another pack. The
  thread-only inbox pile (fake-notifications.ts, "24 merged PRs · Clear")
  still shows with it:

  ```
  POSTPILE_FAKE=1 POSTPILE_FAKE_EXTRA=board POSTPILE_TOKEN=devtok PORT=4877 pnpm server
  ```
- `POSTPILE_FAKE_UPDATE` (with `POSTPILE_FAKE=1`): `0` no sample update,
  `pill` the small pill, `many` 12 newer releases, of which the one-page
  check sees 10 ("10+ releases"); the bar otherwise. The sample work
  context honours `POSTPILE_SWEEP_SKIP` like the real sweep (the skip
  input turns read-only, an empty value skips nothing).
- `POSTPILE_MODEL`, `POSTPILE_GLANCE_MODEL`,
  `POSTPILE_AGENT_CONCURRENCY` (default 8): agent knobs.
