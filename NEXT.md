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
  hidden-inset title bar, three panes (264px | 1fr | 404px), status footer,
  toast with Undo. Rules for the renderer are in `apps/desktop/CLAUDE.md`.
- GitHub writes from the UI (approve, comment, mark read, "not mine") are
  blocked unless the app runs with `CODE_MANAGER_ALLOW_WRITES=1`; the server
  reports this at `GET /api/config`. Fake mode allows them (nothing leaves the
  process).
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
  - syncs the app starts are capped (`CODE_MANAGER_MAX_AGENT_CALLS`,
    default 30); the title bar says when a sync stopped at the cap
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
- Tests (vitest) and typecheck green across all workspaces.

## Stubbed or thin

- Desktop UI follows the chosen style, but the layout is still open. Not in
  the UI yet: a "handled quietly" list (shown disabled), keyboard
  navigation, dark mode, one-press approve from a tile (Approve lives in the
  detail pane, next to the glance).
- The write guard is a UI guard. The server itself still accepts writes from
  any caller with the token; `CODE_MANAGER_READ_ONLY=1` is the hard stop.
- Fake mode (`CODE_MANAGER_FAKE=1`) runs `FakeEngine`, a second
  EngineService with its own copies of the tile/loudness/undo rules. It can
  drift from the real engine. See decisions below.
- Sync is on demand only (Sync now, app start). No polling, no live updates.
- The mark-read undo queue is in memory. Quit flushes it; a crash drops
  pending mark-reads (local state already says read, GitHub stays unread).
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
- Relation rules know the user's own teams only (viewer teams); other
  authors' team membership is not fetched, so ownerTeam of routed topics
  comes from the agent. CODEOWNERS is inferred from team review requests
  plus the touched directory, the CODEOWNERS file is not read.
- Existing topics get a relation and area on their next dossier update; until
  then they sit under Your team / "Other".
- Loud topics always show under Needs you, so the Routed and FYI sections
  only hold quiet topics and stay folded; there is no "open when loud" case
  left in practice.
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
  drop it and use `CODE_MANAGER_READ_ONLY=1` + `sync --no-agent` against the
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
  wake-up on any loud human event, the extra loudness rules, repo name.

## Decided

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
```

Smoke run on a throwaway database, read-only:

```
CODE_MANAGER_READ_ONLY=1 CODE_MANAGER_DB=/tmp/cm-smoke/db.sqlite \
  npm run cli -- sync --limit 15 --max-agent-calls 6
```

Desktop and server:

```
npm run desktop       # Electron dev mode, server in-process on a random port + token
npm run server        # standalone API on 127.0.0.1:4870, prints its token
```

The desktop app syncs once on start, then only on "Sync now". Without
`CODE_MANAGER_ALLOW_WRITES=1` it shows GitHub-writing actions but blocks them
with a message:

```
CODE_MANAGER_ALLOW_WRITES=1 npm run desktop   # approve, comment, mark read for real
npm run build                                 # electron-vite bundle into apps/desktop/out
```

Fake mode (sample "Move CI to Depot" data, no GitHub, no agent, no database):

```
CODE_MANAGER_FAKE=1 npm run cli -- topics
CODE_MANAGER_FAKE=1 npm run desktop
CODE_MANAGER_FAKE=1 npm run server
```

Env switches:

- `CODE_MANAGER_READ_ONLY=1`: real reads, every GitHub write refused. Use this
  for smoke runs against the real account.
- `CODE_MANAGER_ALLOW_WRITES=1`: lets the UI send GitHub writes. Off by
  default.
- `CODE_MANAGER_MAX_AGENT_CALLS`: agent-call cap for syncs the app starts
  (launch and "Sync now"), default 30. The CLI uses `--max-agent-calls`.
- `CODE_MANAGER_DB`, `CODE_MANAGER_INSTRUCTIONS`: override the database
  (default `~/Library/Application Support/code-manager/db.sqlite`) and the
  instructions file (default `~/.config/code-manager/instructions.md`).
- `CODE_MANAGER_TOKEN`: fixed token for the standalone server.
- `CODE_MANAGER_MODEL`, `CODE_MANAGER_GLANCE_MODEL`,
  `CODE_MANAGER_AGENT_CONCURRENCY`: agent knobs.
