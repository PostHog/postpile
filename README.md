# code-manager

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
npm install
npm run typecheck
npm test

npm run cli -- sync            # fetch, digest, derive tiles
npm run cli -- sync --limit 10 --no-agent            # cheap first look
npm run cli -- sync --max-agent-calls 5 --agent-jobs topics,glances
npm run cli -- topics
npm run cli -- topic <id>
npm run cli -- pr owner/repo#123

npm run server                 # HTTP API on 127.0.0.1:4870, prints its token
npm run desktop                # Electron dev mode
```

General instructions for every prompt go in
`~/.config/code-manager/instructions.md` (honours `XDG_CONFIG_HOME`, or set
`CODE_MANAGER_INSTRUCTIONS`). The database lives at
`~/Library/Application Support/code-manager/db.sqlite`, or wherever
`CODE_MANAGER_DB` points.

- `CODE_MANAGER_FAKE=1`: sample data, no GitHub, no agent, no database (UI work)
- `CODE_MANAGER_READ_ONLY=1`: real reads, every GitHub write refused
- `CODE_MANAGER_MODEL`, `CODE_MANAGER_GLANCE_MODEL`, `CODE_MANAGER_AGENT_CONCURRENCY`: agent knobs

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
