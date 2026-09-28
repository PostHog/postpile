# PostPile

A macOS app that turns your GitHub PR notifications into topics and tells you which ones need you, and why.

PostPile sits one level above GitHub PRs. It reads what GitHub pings you about, groups the PRs into topics with an agent (Claude, through the `claude` CLI), and shows each PR, stack or set as a tile that answers four questions: for whom, why now, what state, and whose move. It is built for people who get dozens of review requests and mentions a day and want the GitHub inbox to become a short list of things to do.

<!-- TODO: screenshot of the three-pane window (topics, tiles, detail), taken on sample data (POSTPILE_FAKE=1). Save as docs/screenshot.png and link it here. -->

**Status: alpha.** It is used daily by its author at PostHog, on a PostHog-shaped workflow (team review requests, stacked PRs, a busy monorepo). Expect rough edges, database migrations between versions, and features that fit that workflow first. The app is not notarized by Apple (see [First open](#first-open)).

## What it does

- Groups PRs into topics that an agent keeps up to date, with a short dossier per topic. The agent proposes renames and merges; you decide.
- Sorts work into queues: Needs reply, My PRs, Team's PRs, To review, Team mentioned. Each queue holds topics, not a flat list of PRs.
- Shows whose move it is on every PR, from deterministic rules (reviews, pushes, replies, stack order), with the agent's judgement on top where rules can't decide.
- Keeps a stack of PRs together as one unit.
- Gives each PR a short agent "glance" (verdict and risk), with sources you can check.
- Sends Mac notifications only for the pings that are your move.
- Uses GitHub as the source of truth for read and unread. Writes (approve, comment, mark read) stay locked until you open the lock in the status bar.

## When not to use it

- You are not on an Apple silicon Mac. Only macOS arm64 builds exist.
- You don't want PR text sent to Anthropic. The agent parts run through your `claude` CLI (see [Privacy](#privacy)).
- You get a handful of notifications a day. GitHub's own inbox is enough then.

## Install

Requirements:

- macOS 12 or later on Apple silicon (arm64)
- [GitHub CLI](https://cli.github.com) (`gh`), logged in: `gh auth login`
- [Claude Code](https://docs.claude.com/en/docs/claude-code) (`claude`), logged in. PostPile uses it for every agent call, on your own Claude plan or API key.

With Homebrew (once 0.1.0-alpha.0 is released):

```
brew install --cask posthog/tap/postpile
```

Or download `PostPile-<version>-mac-arm64.zip` from [Releases](https://github.com/PostHog/postpile/releases), unzip it and move `PostPile.app` to `/Applications`.

### First open

The app is ad-hoc signed. It is not signed with an Apple Developer ID and not notarized, so macOS blocks the first open. Do one of these:

- Clear the quarantine flag:

  ```
  xattr -dr com.apple.quarantine /Applications/PostPile.app
  ```

- Open the app once, then go to System Settings › Privacy & Security and click Open Anyway. On macOS 14 and older, right-click the app and choose Open.

On the first launch, macOS asks for permission to show notifications. The first sync takes a few minutes while the agent sorts your PRs into topics.

## Privacy

PostPile runs on your Mac only. There is no PostPile server and no telemetry.

- **GitHub**: the app calls the GitHub API with the token from `gh auth token`. It reads your notifications and the PRs they point to. It writes (approve, comment, mark read) only after you unlock writes.
- **Anthropic**: agent calls run through the `claude` CLI on your machine, so PR titles, bodies, comments and review threads go to Anthropic under your Claude account's terms. GitHub text is treated as untrusted input: it is fenced in prompts, and calls that read it run without tools.
- **Work context sweep**: once a day the app reads your Claude Code folder (`~/.claude`: `CLAUDE.md` and its includes, each project's memory files, and light signals from the last 7 days of sessions), masks secrets, and asks Claude for a short digest of what you are working on. The digest helps rank and phrase things. Project folders on the skip list are never opened. The default list is `taxes`, `garden`, `hobby`, `personal`, `private`; `POSTPILE_SWEEP_SKIP` (comma separated) replaces it. The digest shows under Your instructions, with its sources, and you can forget it.
- **Local data**: the database lives in `~/Library/Application Support/PostPile`, logs in `~/Library/Logs/PostPile`, and your instructions for the agent in `~/.config/postpile/instructions.md`.

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

## Development

Contributors start with [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md). The spec is [DESIGN.md](DESIGN.md), the status is [NEXT.md](NEXT.md), changes are in [CHANGELOG.md](CHANGELOG.md).

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

### Configuration

Instructions for every prompt go in `~/.config/postpile/instructions.md` (honours `XDG_CONFIG_HOME`, or set `POSTPILE_INSTRUCTIONS`). The app also changes this file, but only through proposals you accept.

Environment variables. The packaged app only sees them when you start its binary from a terminal; `open` does not pass them.

- `POSTPILE_FAKE=1`: sample data, no GitHub, no agent, no database (UI work)
- `POSTPILE_PROFILE=dev`: the dev database and config folders; `POSTPILE_DATA_DIR` moves the data folder, `POSTPILE_DB` points at a database file
- `POSTPILE_READ_ONLY=1`: real reads, every GitHub write refused, the write lock cannot be opened
- `POSTPILE_SYNC_ON_START=0`, `POSTPILE_MAX_AGENT_CALLS=0`: no sync at start, no agent calls
- `POSTPILE_POLL_SECONDS`: the notification poll interval, default 10 (0 turns it off)
- `POSTPILE_MAC_NOTIFICATIONS=0`: no Mac notifications
- `POSTPILE_MODEL`, `POSTPILE_GLANCE_MODEL`, `POSTPILE_SWEEP_MODEL`, `POSTPILE_AGENT_CONCURRENCY` (claude processes at once, default 8): agent knobs
- `POSTPILE_CLAUDE_BIN`: the `claude` binary to run
- `POSTPILE_CLAUDE_DIR`: the folder the work context sweep reads, default `~/.claude`
- `POSTPILE_SWEEP_SKIP`: comma-separated `~/.claude/projects` folders the sweep never reads (default `taxes,garden,hobby,personal,private`; empty means none)
- `POSTPILE_LOG_DIR`: where logs go

Renamed from code-manager on 2026-09-28. On first start the app moves the old `code-manager` data and config folders over. `CODE_MANAGER_*` env vars still work for now, with a deprecation line.

### Layout

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

## Security

See [SECURITY.md](SECURITY.md). Report vulnerabilities to security-reports@posthog.com, not in public issues.

## License

[MIT](LICENSE). Copyright (c) 2026 PostHog Inc.
