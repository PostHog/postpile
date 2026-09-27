# code-manager design

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
- `pulled_in`: added for context, with a one-line reason

A tile only exists if at least one member is pinged. Provenance is derived from
whether a notification thread exists, so a pulled-in PR that later gets a real
ping becomes pinged without anything having to update it.

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

**Glance** per PR: verdict (`LOOKS_SAFE` | `LOOK_CLOSER` | `NOT_YOURS`),
`forYou` (one or two sentences against the user's own instructions), `does`,
`risk`, `othersSaid`, and for pulled-in PRs the pull-in reason. Cached by a
hash of its inputs; regenerated only when the PR moves or instructions change.

**User actions**: approve (single press, immediate, no undo), mark read, snooze
(until someone replies | new push | CI green | a time), "ask <person>" (agent
drafts a PR comment, user edits and sends), feedback on a tile ("not mine",
"not related" for sets, "wrong topic"), chat on a tile. Lasting points from
chat become a tailoring proposal: "keep it" stores it on the topic, "just this
once" only logs it.

**Mark read is deferred**: acting on a tile marks the GitHub notification read
through a queue with a 6s undo window, because GitHub has no mark-unread API.
Batches stack; undo walks back newest first; quitting flushes instead of
dropping. The queue lives in the engine (`MarkReadQueue`), in memory.

**Sync** is on demand: "Sync now" and on app start. No live updates for now.

## Memory / agentic digesting layer (v1, to review)

Everything the agents know persists in SQLite, keyed so it survives restarts
and only recomputes on change.

| what | where | invalidated when |
|---|---|---|
| general instructions | `~/.config/code-manager/instructions.md`, in every prompt; absent = none | file edited (part of every input hash) |
| glance | `pr_glance`, latest per PR + `input_hash`, `model` | PR snapshot moves, or instructions or topic tailoring change |
| topic | `topic`: name, summary + `summary_input_hash`, tailoring, driver, user_role | summary: member PRs change |
| topic membership | `topic_membership`: pr -> topic, `assigned_by` agent/user, reason | never automatically; a user assignment is never replaced by the agent |
| topic proposals | `topic_proposal`: new_topic / rename / merge, pending until the user decides | - |
| sets | `pr_set` + `pr_set_member` with combined take and per-member reason | agent regroups; "not related" drops a member or dissolves the set and is remembered |
| feedback | `feedback`: not_mine / not_related / wrong_topic / unmute / tailoring_kept / tailoring_once | append-only; newest N per topic go into prompts |
| event overrides | `pr_event.override_*` with reason | kept across re-derivation |
| other agent answers | `agent_cache`, keyed by hash of prompt + model | prompt changes |

Topic assignment: new or changed PRs go to the agent together with the list of
existing topics (name + summary). It picks one or proposes a new topic.

Every prompt carries a `PromptContext`: general instructions + topic tailoring
+ recent feedback for that topic.

All agent calls go through one `AgentRunner` interface. Today:
`ClaudeCliRunner`, which runs

```
claude --no-session-persistence -p --output-format json --model <m> \
  --setting-sources "" --strict-mcp-config --tools ""
```

with `MAX_THINKING_TOKENS=0` and the prompt on stdin (flags carried over from
ghatchup, where they took a PR summary from ~30s to ~3s). Glances use
`claude-haiku-4-5` (`CODE_MANAGER_GLANCE_MODEL`), everything else `sonnet`
(`CODE_MANAGER_MODEL`). An API-backed runner can replace it later without
touching callers.

## Architecture

TypeScript everywhere, Node 24, npm workspaces.

```
core  <- store, github, agent  <- engine  <- server, cli
                                             desktop (main: engine + server; renderer: core types only)
```

- **packages/core**: domain types (`types.ts`), API read models (`views.ts`), pure logic: tile
  state, loudness rules, snooze evaluation, provenance, stacks, bot detection. No IO.
- **packages/store**: `node:sqlite`, one migration (`migrations/001_init.ts`), one repository
  class per table group, `Store` bundles them.
- **packages/github**: `GitHubReader` (viewer, notifications with ETag / If-Modified-Since,
  batched GraphQL PR enrichment, 12 PRs per query) and `GitHubWriter` (mark thread read,
  approve, comment) as separate interfaces. Token from `gh auth token`, read once, cached in
  memory.
- **packages/agent**: `AgentRunner`, `ClaudeCliRunner`, `AgentService` (glance, topic
  assignment, set grouping, topic summary, event classification, draft comment, chat).
- **packages/engine**: `EngineService`, the API the server and CLI call. Sync pipeline:
  fetch -> store -> classify -> agent digest -> derive tiles. `MarkReadQueue`. `createEngine`
  wires real dependencies; tests build `Engine` with fakes.
- **apps/server**: Hono + `@hono/node-server`, binds 127.0.0.1 only.
- **apps/desktop**: Electron via electron-vite. Main starts the server in-process on a random
  port with a random token and loads the renderer with `?api=...&token=...`. PATH is taken from
  the login shell (`fix-path`) so `gh` and `claude` resolve on a GUI launch.
- **apps/cli**: `sync`, `topics`, `topic <id>`, `pr <owner/repo#n>`, plain text.

### HTTP API

Ids containing `/`, `#` or `:` (tile ids, event ids) are `encodeURIComponent`-ed
in paths. When the server has a token, every request needs `x-code-manager-token`.

| route | engine call |
|---|---|
| `GET /api/health` | - |
| `POST /api/sync` | `sync()` |
| `GET /api/topics` | `listTopics()` |
| `GET /api/topics/:id` | `getTopic()` |
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

### Build and tooling decisions

- **SQLite: built-in `node:sqlite`, no native module.** Tested: works under Node 24.21 and inside
  the installed Electron 44.4.5 main process (`ELECTRON_RUN_AS_NODE=1 npx electron -e
  "require('node:sqlite')"`, Electron embeds Node 24.21, SQLite 3.53). This avoids
  better-sqlite3 and `@electron/rebuild` entirely. The built Electron main bundle keeps
  `node:sqlite` as an external builtin.
- **Workspace packages export TypeScript source** (`"exports": {".": "./src/index.ts"}`), no
  build step. tsx runs the CLI and server, vitest and electron-vite compile on the fly. The
  desktop main bundle inlines workspace packages (`externalizeDeps.exclude`).
- **Relative imports use `.ts` extensions** (`allowImportingTsExtensions`, `noEmit`). Nothing
  is emitted by tsc.
- **Typecheck** is `tsc --noEmit` per workspace (`npm run typecheck`), not project references:
  simpler with source-first packages. TypeScript 7 (native compiler) is fast enough that the
  repeated work does not matter.
- **electron-vite 5 caps vite at 7**, so vite is pinned to `^7` and `@vitejs/plugin-react` to
  `^5`. Revisit when electron-vite supports vite 8.
- **npm 11 install-script gating**: `allowScripts` in the root package.json approves esbuild and
  denies fsevents. Electron 44 no longer downloads its binary on install; run
  `npx install-electron` after a fresh `npm install`.
- **Localhost API safety**: binds 127.0.0.1, and the desktop app uses a per-launch random token
  so web pages and other local processes cannot drive approve/comment.
- **Paths**: XDG style (`~/.config/code-manager`, `~/.local/share/code-manager`) so the CLI and
  the desktop app share one database. WAL mode lets them run side by side.

### Safety while building

- No GitHub write calls in tests or smoke runs. Tests use fakes; `GitHubWriteClient` is only
  constructed by `createEngine`.
- Live `claude` calls: at most 3 across the build, small inputs.

## Open questions for Julian

- **UI framework, final choice**: Electron + React is scaffolded because it gives a web app for
  free later. Tauri or a native shell are still possible; only `apps/desktop` would change.
- **Carousel vs list** for tiles inside a topic. The placeholder renders a plain list.
- **Layout**: three panes (topics / open topic / PR or stack detail) is the current favourite,
  not final.
- **Memory layer details** (the v1 above is a proposal):
  - how many feedback entries per topic go into prompts (N = 10?)
  - whether topic summaries regenerate on every membership change or only on sync
  - whether sets are regrouped on every sync or only when membership changes
  - how long dissolved sets and "not related" feedback keep suppressing a regroup
  - whether a PR may belong to more than one topic (schema says one; pulled-in appearances
    elsewhere go through sets)
- **Snooze wake-up**: proposed default is that a loud event from a human also ends a snooze,
  so a mention is never hidden. Confirm.
- **Repo name**: `code-manager` is a working title.
