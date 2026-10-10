# Development

Build PostPile from source, run it in dev mode, and configure it with environment variables.

## Build from source

Requirements: Node 24 (for the built-in `node:sqlite`), pnpm (the version in `package.json` › `packageManager`, for example through Corepack), `gh` and `claude`.

```
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm dist
```

`pnpm test` includes property tests over generated boards (DESIGN.md › Tests across rules). `POSTPILE_PROPERTY_RUNS=10000 pnpm test` checks more boards per invariant than the default 2000.

`pnpm dist` builds with electron-vite, then electron-builder makes an ad-hoc signed app:

- `apps/desktop/dist/mac-arm64/PostPile.app`
- `apps/desktop/dist/PostPile-<version>-mac-arm64.zip`

The signature has to be valid, because macOS drops notifications from an app with a broken signature. Check with `codesign --verify --deep --strict apps/desktop/dist/mac-arm64/PostPile.app`.

To look at the app on sample data (no GitHub, no agent, no database):

```
POSTPILE_FAKE=1 POSTPILE_POLL_SECONDS=0 apps/desktop/dist/mac-arm64/PostPile.app/Contents/MacOS/PostPile
```

## Dev mode

Contributors start with [CONTRIBUTING.md](../CONTRIBUTING.md) and [AGENTS.md](../AGENTS.md). The spec is [DESIGN.md](../DESIGN.md), the status is [NEXT.md](../NEXT.md), changes are in [CHANGELOG.md](../CHANGELOG.md).

```
pnpm --filter @postpile/desktop exec install-electron   # once, for pnpm desktop
pnpm desktop                # Electron dev mode

pnpm cli sync               # fetch, digest, derive tiles
pnpm cli sync --limit 10 --no-agent            # cheap first look
pnpm cli sync --max-agent-calls 5 --agent-jobs topics,glances
pnpm cli topics
pnpm cli topic <id>
pnpm cli pr owner/repo#123
pnpm cli tools              # is gh and claude usable, and the fix if not

pnpm server                 # HTTP API on 127.0.0.1:4870, prints its token
```

Dev runs use their own database: `pnpm desktop` (unpackaged Electron), `pnpm cli` and `pnpm server` run with `POSTPILE_PROFILE=dev`, which keeps data in `~/Library/Application Support/PostPile-dev` and instructions in `~/.config/postpile-dev` (seeded once with a copy of the real `instructions.md`). The title bar shows a DEV badge. To read the real database from the repo on purpose: `POSTPILE_PROFILE=default pnpm cli ...`.

Only one process opens a database at a time (`postpile.lock` next to it). While the app runs, `pnpm cli topics --read-only` (also `topic`, `pr`) still reads; sync, poll and sweep refuse.

The packaged app bundles main, preload, renderer, the workspace packages and the server, so it runs without tsx or node_modules. The server runs in-process on a random localhost port, protected by a random token. A Finder launch gets a minimal PATH, so the app adds the folders from `/etc/paths`, `/etc/paths.d` and `toolPath` (see below), and also looks in `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin` and `~/.claude/local` for `gh` and `claude`. It never runs your login shell.

Logs go to `~/Library/Logs/PostPile/main.log` (dev runs: `~/Library/Logs/PostPile-dev`), rotated at 5 MB. Help › Reveal Logs opens the folder.

Crash dumps stay on the Mac, nothing is uploaded: when a process of the app crashes, Crashpad writes a minidump (`.dmp`) to Electron's default crash dump folder, `~/Library/Application Support/PostPile/Crashpad` (dev runs: `PostPile-dev/Crashpad`, or `Crashpad/` in `POSTPILE_DATA_DIR`), in `pending/` or `completed/`. `process.crash()` in the main process makes one for a check. A run that ended without a clean quit also leaves `running.json` in the same folder; the next start logs "the last run ended without a clean quit" and sends `app_crashed_last_run`.

### MCP on the fake server

`POSTPILE_FAKE=1 pnpm cli mcp` builds its own copy of the sample, so what an MCP client files never reaches a UI. To share one sample between the UI and MCP clients, start the fake server with a fixed token and point the MCP server at it:

```
POSTPILE_FAKE=1 POSTPILE_TOKEN=devtok PORT=4877 pnpm server
POSTPILE_TOKEN=devtok pnpm cli mcp --api http://127.0.0.1:4877
```

The second command serves MCP on stdin/stdout and sends every engine read and ask to the server's `POST /api/fake/engine/:method` (token-protected, only the 14 methods MCP uses, only on a server started with `POSTPILE_FAKE=1`). Topic suggestions show in the Inbox, notes in the PR pane, and a Reject or Clear in the UI reaches the next MCP answer. A real server has no such route; the real MCP server reads the database and asks the app through files as before.

`note_pr` with `covered_by` a PR outside the sample works like a real GitHub read: `acme/app#1000` to `#1999` are "read" once and kept as a pulled-in PR (no tile, no topic), `#90000` and up are PRs GitHub does not have, and `acme/app#1777` answers `pending` the first time (a retry finds it). Any other PR outside the sample is refused. The reads go through the engine's cover reader, so its hourly cap and `POSTPILE_FAKE_QUOTA=critical` apply.

### Simulate a fresh start

`pnpm cli simulate-start` replays a new user's first syncs on a copy of a database, once per agent pipeline, to compare them from the same start:

```
pnpm cli simulate-start --from <db file> [--days 7] [--round-size 60] [--out <dir>] \
  [--arms old,combined] [--max-agent-calls 1000] [--rounds <n>] [--now <iso>] [--dry-run]
```

- `--from` is opened read-only and copied (SQLite backup) into the out folder (default: a new folder under the system temp folder). Everything else happens on copies there. The source must have synced at least once (it needs the stored viewer). An `--out` under `~/Library/Application Support` or the XDG data or config folders is refused.
- Fresh start: topics, memberships, dossiers, facts, glances, sets, proposals, cursors, agent calls, chats, snoozes, agent event overrides and the agent's meta keys are wiped; GitHub data and the user's read state stay (`packages/engine/src/simulation/fresh-start.ts` lists every table with its reason).
- Only threads of the last `--days` count, plus found PRs. "Now" is the newest activity in the source. The PRs come in rounds the way a backlog drains (unread first, newest first, `--round-size` per round, found PRs and stack layers ride along), and each round runs only the digest a sync runs after its fetch (`Engine.digestStored`), in a child process per arm with `POSTPILE_TOPIC_DIGEST=0` (old) or `1` (combined), `POSTPILE_READ_ONLY=1`, no GitHub calls at all.
- The first arm assigns topics; the others get its topics each round and run every other job. Prompts use the instructions the source database last recorded (`instructions.md` in the out folder).
- `report.md` and `report.json` in the out folder: agent calls, cost and time per round and arm, tiles per topic, tile churn (a tile that changed topic counts as moved, a stack in several topics once), then glances, dossiers and tiles side by side. They hold real PR data: keep them out of the repo.
- `--dry-run` makes no agent calls (for checking the plumbing).

## Screenshots

The README screenshots in `docs/images/` come from `pnpm screenshots`. It builds the renderer, starts the sample data server and a static file server on free ports, and takes one cropped shot per entry of the list at the top of `scripts/screenshots.ts`. Add a shot by adding an entry (name, selector, optional setup and cursor).

```
npx playwright install chromium   # once
pnpm screenshots
```

Run it on a Mac only, because the macOS system font is part of the look, so there is no CI job. Commit the changed PNGs with the UI change that caused them.

## Configuration

Instructions for every prompt go in `~/.config/postpile/instructions.md` (honours `XDG_CONFIG_HOME`, or set `POSTPILE_INSTRUCTIONS`). The app also changes this file, but only through proposals you accept.

`~/.config/postpile/config.json` (dev: `~/.config/postpile-dev/config.json`) holds settings that must also work for a Finder launch:

- `toolPath`: folders to look for `gh` and `claude` in, before anything else, e.g. `{ "toolPath": ["~/.local/share/mise/shims"] }`. Read once at app launch. The app no longer runs your login shell, so tools that only your shell setup puts on PATH need this.
- `sweepSkip`: `~/.claude/projects` folders the work context sweep never reads (also edited in the app).

Environment variables. The packaged app only sees them when you start its binary from a terminal; `open` does not pass them.

- `POSTPILE_FAKE=1`: sample data, no GitHub, no agent, no database (UI work)
- `POSTPILE_FAKE_UPDATE`: with `POSTPILE_FAKE=1`, the sample update in the title bar: `0` none, `pill` the small pill (1 release), `many` more releases than one page of the release list ("10+"); the bar (3 releases) otherwise
- `POSTPILE_FAKE_INSTALL`: with `POSTPILE_FAKE=1`, the sample self-update state: `ready` (default, "Restart to update", which only relaunches), `downloading`, `failed` or `off` (the brew command)
- `POSTPILE_FAKE_TIDY=1`: with `POSTPILE_FAKE=1`, the first sync runs a sample topic tidy, so the "Tidying up your topics and tiles" overlay shows for a few seconds
- `POSTPILE_FAKE_CATCH_UP=0`: with `POSTPILE_FAKE=1`, no inbox catch-up dialog on start (by default every fake start is a first run with a pile of merged PRs, so it shows)
- `POSTPILE_FAKE_MISSING`: with `POSTPILE_FAKE=1`, simulates missing tools for UI checks (comma separated: `gh`, `gh-auth`, `gh-token`, `gh-offline`, `claude`, `claude-auth`, `claude-limit`)
- `POSTPILE_FAKE_QUOTA`: with `POSTPILE_FAKE=1`, `low` or `critical` simulates a GitHub quota that is low or nearly used
- `POSTPILE_FAKE_BUSY=1`: with `POSTPILE_FAKE=1`, `GET /api/busy-inbox` reports a busy inbox (the board cap cut the hot set) with invented numbers, for building the busy inbox card
- `POSTPILE_FAKE_LOCKED=1`: with `POSTPILE_FAKE=1`, the sample starts with GitHub writes locked (it starts with them on, like the packaged app)
- `POSTPILE_FAKE_FAIL_WRITES`: with `POSTPILE_FAKE=1`, sample writes fail with a GitHub-shaped error (502, a 403 for `react`), logged as `failed`, nothing changes. Comma separated `approve`, `comment_review`, `comment`, `reply`, `react`, `mark_read`, or `all`; `once:<kind>` fails only the first call. A failed `mark_read` puts the PR back to unread
- `POSTPILE_FAKE_FAIL_SEND=1`: with `POSTPILE_FAKE=1`, "Send N to GitHub" fails: the pending writes stay with the error, the tiles stay unread
- `POSTPILE_FAKE_DELAY_MS`: with `POSTPILE_FAKE=1`, every sample write, draft, topic chat answer and memory recheck takes this many milliseconds (default 0), so busy states and late answers can be watched
- `POSTPILE_FAKE_DELIVER`: with `POSTPILE_FAKE=1`, scripted news, comma separated step names in order (`ask-you`, `approve-set-member`, `merge-set-member`, `push`, `merge-open-pr`, `revive-archived`, `bot-on-archived`, `bot-only-read`, `bot-and-mention`). Each sync after the start sync ("Sync now", or the first one with `POSTPILE_SYNC_ON_START=0`) delivers the next step and reports it as fetched news. Steps run once; the core rules work out tiles and sections again. `GET /api/fake/steps` lists them (what each does, whether it ran, the next delivery) and `POST /api/fake/advance {"step":"ask-you"}` runs one now; both exist only in fake mode and need the token
- `POSTPILE_FAKE_LIVE=1`: with `POSTPILE_FAKE=1`, the standalone server (`pnpm server`) starts the sample live poll (a question from rowan, lyra or nell about every 45 s, interval from `POSTPILE_POLL_SECONDS`) and the auto sync (`POSTPILE_AUTO_SYNC_MINUTES`) like the desktop app does, so the footer and title bar show live, paused and auto sync states in a browser. No Mac notifications: a ping shows in the Notifications debug view only
- `POSTPILE_FAKE_EXTRA`: with `POSTPILE_FAKE=1`, comma-separated sample packs added on top of the default sample (which stays as it is):
  - `stacks`: stacks and a bot set in their own topics (#2101 to #2166): a 3-layer stack with an approved bottom, a layer asking you and a draft top; 3 unread layers that are not your move; a 2-layer stack whose top waits on another team (a teammate's and your own); safe and look-closer layers for the agent Approve; a stack with only its middle layer merged; a set of 5 renovate[bot] PRs next to a single one
  - `pane`: PR pane content in the topic Webhook delivery (#2201 to #2204): a rich unread teammate PR; a review bot's review with 6 inline comments, the author's replies and a bot comment cut like a stored snapshot; a comment with a code block, a list, a link, an emoji, a 300-character token and a quote, next to raw HTML that must render inert; a PR whose title and comment read like instructions to an agent (prompt-injection test data)
  - `mcp`: diffs for the overlap check, so `pr_context` and `whats_on_me` report overlapping edits (#1902 and sol's new #2301 on the same workflow lines, a nearby pair, a lockfile pair and stack mates that stay quiet, one capped diff)
- `POSTPILE_FAKE_EXTRA`: with `POSTPILE_FAKE=1`, comma-separated sample packs on top of the default sample, for board states it never shows. `board`: topics and PRs #2001 and up (an approved own PR alone in its topic, a whole You drive trio, a teammate's draft asking you, a thanks that asks nothing, a merge the glance calls Not yours, a closed PR next to an open one, a retired standing topic, a long reviewer list, approvals right after a comment). `stress`: text and counts at their limits (a 220-character title with emoji, backticks, `<>` and a 96-character token, a topic name over 64 characters, #12345 in a long repo name, five assignees, a topic with 25 tiles and 30 PRs by eight authors, a dossier at every `DOSSIER_LIMITS` bound). `calm`: replaces the default sample with a tiny one where everything is read and dealt with (three merged topics with the Archive-now box, one topic holding only a snoozed tile, 0 unread); the server refuses to start when `calm` is combined with another pack
- `POSTPILE_PROFILE=dev`: the dev database and config folders; `POSTPILE_DATA_DIR` moves the data folder, `POSTPILE_DB` points at a database file
- `POSTPILE_READ_ONLY=1`: real reads, every GitHub write refused, the write lock cannot be opened. Without it, dev runs (`pnpm desktop`, `pnpm server`, `pnpm cli`) still start with writes locked until the footer lock is opened; only the packaged app has them on by default
- `POSTPILE_SYNC_ON_START=0`, `POSTPILE_MAX_AGENT_CALLS=0`: no sync at start, no agent calls
- `POSTPILE_POLL_SECONDS`: the notification poll interval, default 60 (0 turns it off). A lower value only counts until GitHub sends its `X-Poll-Interval` (usually 60): the poll never runs faster than GitHub asks
- `POSTPILE_AUTO_SYNC_MINUTES`: minutes between background full syncs in the desktop app, default 60 (0 turns it off; the default is off when `POSTPILE_SYNC_ON_START=0`)
- `POSTPILE_CATCHUP_CAP`: agent calls per rolling 24h for glance catch-up after the poll, default 600 (0 turns catch-up off; the default is 0 when `POSTPILE_MAX_AGENT_CALLS=0`)
- `POSTPILE_MAC_NOTIFICATIONS=0`: no Mac notifications, whatever is picked under Interruptions (default Never; the pick is kept in the database)
- `POSTPILE_UPDATE_CHECK=0`: no update check (the title bar reminder asks `api.github.com` for releases ~30s after start, then every 6 hours) and no self-update
- `POSTPILE_AUTO_UPDATE=0`: no self-update download in the packaged app; the reminder offers the brew command instead (a dev run never updates itself)
- `POSTPILE_TELEMETRY=0` or `DO_NOT_TRACK=1`: no usage analytics (also off by default under `POSTPILE_PROFILE=dev`, `POSTPILE_FAKE=1` and in tests). `POSTPILE_TELEMETRY=1` forces it on, including in dev, for checking the pipeline by hand — never in tests. See README › Privacy and DESIGN.md › Usage analytics.
- `POSTPILE_MODEL`, `POSTPILE_GLANCE_MODEL` (default `claude-sonnet-5-5`), `POSTPILE_SWEEP_MODEL`, `POSTPILE_SETUP_MODEL` (default `opus`), `POSTPILE_AGENT_CONCURRENCY` (claude processes at once, default 8): agent knobs
- `POSTPILE_TOPIC_DIGEST=1`: one agent call per topic for the dossier and its first glances (`topic_digest`), instead of separate dossier and glance calls. Off by default while it is compared (DESIGN.md › One call per topic)
- `POSTPILE_CLAUDE_BIN`: the `claude` binary to run
- `POSTPILE_CLAUDE_DIR`: the folder the work context sweep reads, default `~/.claude`
- `POSTPILE_SWEEP_SKIP`: comma-separated `~/.claude/projects` folders the sweep never reads; wins over `sweepSkip` in `~/.config/postpile/config.json`, which wins over the default `personal,private`; empty means none. Sample data (`POSTPILE_FAKE=1`) honours it too
- `POSTPILE_LOG_DIR`: where logs go

## Layout

```
packages/core     domain types + pure logic, no IO
packages/store    SQLite schema, migrations, repositories
packages/github   gh token, REST notifications, GraphQL PRs, writer
packages/agent    AgentRunner (claude CLI), prompts, answer schemas
packages/engine   sync orchestration, live poll, work context sweep, EngineService
packages/mcp      MCP server: reads over the engine, asks the running app for the rest
apps/server       Hono JSON API over EngineService, plus the sample-data engine
apps/desktop      Electron shell, Mac notifications, React UI
apps/cli          dev CLI, plain text
```
