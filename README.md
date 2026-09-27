# code-manager

A desktop app one level above GitHub PRs. It groups what GitHub pings you about
into topics, tiles and stacks, digests each PR with an agent against your own
instructions, and lets you approve, snooze or ask from one place.

Successor of [ghatchup](../ghatchup). Early scaffold: contracts are in place,
most logic is not implemented yet. See [DESIGN.md](DESIGN.md).

## Requirements

- Node 24 (uses the built-in `node:sqlite`)
- `gh`, logged in
- `claude` CLI on PATH for the agent parts

## Use

```
npm install
npm run typecheck
npm test

npm run cli -- sync            # fetch, digest, derive tiles
npm run cli -- topics
npm run cli -- topic <id>
npm run cli -- pr owner/repo#123

npm run server                 # HTTP API on 127.0.0.1:4870
npm run desktop                # Electron dev mode
```

General instructions for every prompt go in
`~/.config/code-manager/instructions.md` (honours `XDG_CONFIG_HOME`). The
database lives at `~/.local/share/code-manager/code-manager.db`, or wherever
`CODE_MANAGER_DB` points.

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
