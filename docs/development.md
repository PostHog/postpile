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

Crash dumps stay on the Mac, nothing is uploaded: when a process of the app crashes, Crashpad writes a minidump (`.dmp`) under `~/Library/Application Support/PostPile/Crashpad` (dev runs: `PostPile-dev/Crashpad`, or `Crashpad/` in `POSTPILE_DATA_DIR`), in `pending/` or `completed/`. `process.crash()` in the main process makes one for a check. A run that ended without a clean quit also leaves `running.json` in the same folder; the next start logs "the last run ended without a clean quit" and sends `app_crashed_last_run`.

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
- `POSTPILE_FAKE_UPDATE=0`: with `POSTPILE_FAKE=1`, no sample update in the title bar (it shows one by default)
- `POSTPILE_FAKE_INSTALL`: with `POSTPILE_FAKE=1`, the sample self-update state: `ready` (default, "Restart to update", which only relaunches), `downloading`, `failed` or `off` (the brew command)
- `POSTPILE_FAKE_TIDY=1`: with `POSTPILE_FAKE=1`, the first sync runs a sample topic tidy, so the "Tidying up your topics and tiles" overlay shows for a few seconds
- `POSTPILE_FAKE_CATCH_UP=0`: with `POSTPILE_FAKE=1`, no inbox catch-up dialog on start (by default every fake start is a first run with a pile of merged PRs, so it shows)
- `POSTPILE_FAKE_MISSING`: with `POSTPILE_FAKE=1`, simulates missing tools for UI checks (comma separated: `gh`, `gh-auth`, `gh-token`, `gh-offline`, `claude`, `claude-auth`, `claude-limit`)
- `POSTPILE_FAKE_QUOTA`: with `POSTPILE_FAKE=1`, `low` or `critical` simulates a GitHub quota that is low or nearly used
- `POSTPILE_PROFILE=dev`: the dev database and config folders; `POSTPILE_DATA_DIR` moves the data folder, `POSTPILE_DB` points at a database file
- `POSTPILE_READ_ONLY=1`: real reads, every GitHub write refused, the write lock cannot be opened
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
- `POSTPILE_SWEEP_SKIP`: comma-separated `~/.claude/projects` folders the sweep never reads; wins over `sweepSkip` in `~/.config/postpile/config.json`, which wins over the default `personal,private`; empty means none
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
