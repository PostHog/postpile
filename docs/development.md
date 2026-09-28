# Development

Build PostPile from source, run it in dev mode, and configure it with environment variables.

## Build from source

Requirements: Node 24 (for the built-in `node:sqlite`), pnpm (the version in `package.json` › `packageManager`, for example through Corepack), `gh` and `claude`.

```
pnpm install
pnpm typecheck
pnpm test
pnpm dist
```

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

pnpm server                 # HTTP API on 127.0.0.1:4870, prints its token
```

Dev runs use their own database: `pnpm desktop` (unpackaged Electron), `pnpm cli` and `pnpm server` run with `POSTPILE_PROFILE=dev`, which keeps data in `~/Library/Application Support/PostPile-dev` and instructions in `~/.config/postpile-dev` (seeded once with a copy of the real `instructions.md`). The title bar shows a DEV badge. To read the real database from the repo on purpose: `POSTPILE_PROFILE=default pnpm cli ...`.

Only one process opens a database at a time (`postpile.lock` next to it). While the app runs, `pnpm cli topics --read-only` (also `topic`, `pr`) still reads; sync, poll and sweep refuse.

The packaged app bundles main, preload, renderer, the workspace packages and the server, so it runs without tsx or node_modules. The server runs in-process on a random localhost port, protected by a random token. A Finder launch gets a minimal PATH, so the app reads PATH from the login shell and also looks in `/opt/homebrew/bin`, `/usr/local/bin` and `~/.local/bin` for `gh` and `claude`.

Logs go to `~/Library/Logs/PostPile/main.log` (dev runs: `~/Library/Logs/PostPile-dev`), rotated at 5 MB. Help › Reveal Logs opens the folder.

## Configuration

Instructions for every prompt go in `~/.config/postpile/instructions.md` (honours `XDG_CONFIG_HOME`, or set `POSTPILE_INSTRUCTIONS`). The app also changes this file, but only through proposals you accept.

Environment variables. The packaged app only sees them when you start its binary from a terminal; `open` does not pass them.

- `POSTPILE_FAKE=1`: sample data, no GitHub, no agent, no database (UI work)
- `POSTPILE_PROFILE=dev`: the dev database and config folders; `POSTPILE_DATA_DIR` moves the data folder, `POSTPILE_DB` points at a database file
- `POSTPILE_READ_ONLY=1`: real reads, every GitHub write refused, the write lock cannot be opened
- `POSTPILE_SYNC_ON_START=0`, `POSTPILE_MAX_AGENT_CALLS=0`: no sync at start, no agent calls
- `POSTPILE_POLL_SECONDS`: the notification poll interval, default 10 (0 turns it off)
- `POSTPILE_MAC_NOTIFICATIONS=0`: no Mac notifications
- `POSTPILE_MODEL`, `POSTPILE_GLANCE_MODEL` (default `claude-sonnet-5-5`), `POSTPILE_SWEEP_MODEL`, `POSTPILE_SETUP_MODEL` (default `opus`), `POSTPILE_AGENT_CONCURRENCY` (claude processes at once, default 8): agent knobs
- `POSTPILE_CLAUDE_BIN`: the `claude` binary to run
- `POSTPILE_CLAUDE_DIR`: the folder the work context sweep reads, default `~/.claude`
- `POSTPILE_SWEEP_SKIP`: comma-separated `~/.claude/projects` folders the sweep never reads; wins over `sweepSkip` in `~/.config/postpile/config.json`, which wins over the default `taxes,garden,hobby,personal,private`; empty means none
- `POSTPILE_LOG_DIR`: where logs go

## Layout

```
packages/core     domain types + pure logic, no IO
packages/store    SQLite schema, migrations, repositories
packages/github   gh token, REST notifications, GraphQL PRs, writer
packages/agent    AgentRunner (claude CLI), prompts, answer schemas
packages/engine   sync orchestration, live poll, work context sweep, EngineService
apps/server       Hono JSON API over EngineService, plus the sample-data engine
apps/desktop      Electron shell, Mac notifications, React UI
apps/cli          dev CLI, plain text
```
