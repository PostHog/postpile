# PostPile

A desktop app one level above GitHub PRs. It groups what GitHub pings you about
into topics, tiles and stacks, digests each PR with an agent against your own
instructions, and lets you approve, snooze or ask from one place.

Successor of [ghatchup](../ghatchup). The engine, CLI and server work end to
end; the desktop UI is an unstyled placeholder. See [DESIGN.md](DESIGN.md).

## Requirements

- Node 24 (uses the built-in `node:sqlite`)
- `gh`, logged in
- `claude` CLI on PATH for the agent parts

## Use

```
pnpm install
pnpm --filter @postpile/desktop exec install-electron   # once, for pnpm desktop
pnpm typecheck
pnpm test

pnpm cli sync            # fetch, digest, derive tiles
pnpm cli sync --limit 10 --no-agent            # cheap first look
pnpm cli sync --max-agent-calls 5 --agent-jobs topics,glances
pnpm cli topics
pnpm cli topic <id>
pnpm cli pr owner/repo#123

pnpm server                 # HTTP API on 127.0.0.1:4870, prints its token
pnpm desktop                # Electron dev mode
```

## App bundle

```
pnpm dist
```

Builds with electron-vite, then electron-builder makes an unsigned macOS app
(Apple silicon):

- `apps/desktop/dist/mac-arm64/PostPile.app`
- `apps/desktop/dist/PostPile-<version>-mac-arm64.zip`

`dist/` is gitignored. Main, preload, renderer, the workspace packages and
the server are bundled into the app, so it runs without tsx or node_modules.
The server runs in-process on a random localhost port, the data lives in
`~/Library/Application Support/PostPile` as with `pnpm desktop`.

It is not signed or notarized, so macOS refuses the first open. Right-click
the app, then Open (once), or clear the quarantine flag:

```
xattr -dr com.apple.quarantine PostPile.app
```

`gh` and `claude` must be installed and logged in. A Finder launch gets a
minimal PATH, so the app reads PATH from the login shell and also looks in
`/opt/homebrew/bin`, `/usr/local/bin` and `~/.local/bin`.

To try it on sample data without syncing, run the binary directly (`open`
does not pass env vars):

```
POSTPILE_FAKE=1 POSTPILE_POLL_SECONDS=0 apps/desktop/dist/mac-arm64/PostPile.app/Contents/MacOS/PostPile
```

## Config

General instructions for every prompt go in
`~/.config/postpile/instructions.md` (honours `XDG_CONFIG_HOME`, or set
`POSTPILE_INSTRUCTIONS`). The database lives at
`~/Library/Application Support/PostPile/db.sqlite`, or wherever
`POSTPILE_DB` points.

Renamed from code-manager on 2026-09-28. On first start the app moves the old
`code-manager` data and config folders over (or copies them and leaves a note
when the database is in use). `CODE_MANAGER_*` env vars still work for now,
with a deprecation line; switch to `POSTPILE_*`.

- `POSTPILE_FAKE=1`: sample data, no GitHub, no agent, no database (UI work)
- `POSTPILE_READ_ONLY=1`: real reads, every GitHub write refused, the footer lock cannot be opened
- GitHub writes (approve, comment, mark read) are off until the lock in the status footer is opened; the choice is kept in the database
- `POSTPILE_MODEL`, `POSTPILE_GLANCE_MODEL`, `POSTPILE_AGENT_CONCURRENCY`: agent knobs
- `POSTPILE_SWEEP_SKIP`: comma-separated `~/.claude/projects` folders the work context sweep never reads (default `taxes,garden,hobby,my-blog-com`)

## Layout

```
packages/core     domain types + pure logic, no IO
packages/store    SQLite schema, migrations, repositories
packages/github   gh token, REST notifications, GraphQL PRs, writer
packages/agent    AgentRunner (claude CLI now), prompts, digesting jobs
packages/engine   sync orchestration + EngineService
apps/server       Hono JSON API over EngineService
apps/desktop      Electron shell + placeholder React UI
apps/cli          dev CLI, plain text
```
