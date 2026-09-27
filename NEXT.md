# Where things stand

Snapshot after the first build and the review-fix round. DESIGN.md has the
full design; this file is the short "what now".

## Done

- Engine works end to end: notifications (ETag), batched GraphQL PR fetch,
  events with rule loudness, topics, sets, stacks, derived tile state, glances,
  topic summaries, event overrides by the agent. All state in SQLite
  (`node:sqlite`, no native module).
- Actions: approve (pinned to the synced head commit), mark read with the 6s
  undo queue, not mine / not related / wrong topic feedback, snooze, unmute,
  ask-a-person draft + send, tile chat with "keep it" tailoring, topic
  rename/merge proposals (filed by the summary job, applied only on accept).
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
- **Proposals**: rename/merge ideas only come from the summary job, and other
  topics are left out of the summary hash (so a new topic does not rewrite every
  summary). OK?
- Still open from DESIGN.md: UI framework final call, three-pane layout,
  memory numbers (10 feedback entries per prompt, when summaries and sets
  regroup), snooze wake-up on any loud human event, the extra loudness rules,
  repo name.

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
npm run cli -- sync --max-agent-calls 5 --agent-jobs topics,glances
npm run cli -- topics
npm run cli -- topic <id>
npm run cli -- pr owner/repo#123
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
