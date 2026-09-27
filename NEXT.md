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
- Tests (vitest) and typecheck green across all workspaces.

## Stubbed or thin

- Desktop UI follows the chosen style, but the layout is still open. Not in
  the UI yet: editing general instructions, a "handled quietly" list (both
  shown disabled), topic dossier and facts from memory v2, keyboard
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
- Desktop does not show dossiers, facts or rule proposals yet, does not call
  `markTopicSeen` when leaving a topic, and does not run
  `consolidate({onlyIfDue})` when idle. Server routes for all of it exist.
- Fake sample data has no dossiers, facts or rule proposals, so fake mode
  shows none.
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
- `CODE_MANAGER_DB`, `CODE_MANAGER_INSTRUCTIONS`: override the database
  (default `~/Library/Application Support/code-manager/db.sqlite`) and the
  instructions file (default `~/.config/code-manager/instructions.md`).
- `CODE_MANAGER_TOKEN`: fixed token for the standalone server.
- `CODE_MANAGER_MODEL`, `CODE_MANAGER_GLANCE_MODEL`,
  `CODE_MANAGER_AGENT_CONCURRENCY`: agent knobs.
