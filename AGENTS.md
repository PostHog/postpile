# PostPile: how to work on this repo

PostPile is a macOS desktop app (Electron, with a web version later) that sits one level above GitHub PRs. It turns the notification firehose into agent-maintained **topics**. Each topic holds **tiles** (one PR, a real stack, or an agent-grouped set), and the app tells its user what needs them and why. The user is a DevEx engineer at PostHog getting dozens of notifications a day. The app is built for that workflow first.

Read this file first. Details live elsewhere:

- `DESIGN.md`: the spec. Product model, engine memory, tile faces, sidebar, writes, and every rule with its reasoning.
- `NEXT.md`: status. Done, stubbed, open decisions, later, decided, how to run.
- `apps/desktop/CLAUDE.md`: renderer rules (Tailwind tokens, react-query hooks, components).
- `README.md`: what the app is, install, privacy. Written in the product-docs style: facts, no hype, pitch only at the top, and it leads with "internal DevEx tool, not a PostHog product".
- `docs/development.md`: build from source, dev mode, env vars, layout.
- `RELEASING.md`: how a release goes out (tag, workflow, Homebrew cask). `CHANGELOG.md`: add user-visible changes under the unreleased version.

## What the app is for (focus)

1. **Tell the user what needs them, and why, at a glance.** Every tile answers four questions in fixed spots: for whom (word chip + left band), why now (actor avatar + event), status (segment pill), and whose turn (footer). Attention goes where it's the user's move, not where the unread count is highest.
2. **Keep topics as the structure.** The agent layer's job is to cluster work into topics and remember what's going on in them (dossiers, facts). Queues (Needs reply, Changes you requested, My PRs, Team's PRs, To review, Team mentioned) are sections that *contain topics*. They never become a flat pile of PRs.
3. **Memory the user can trust and correct.** The user owns `instructions.md` (changed only through accepted diffs or hand edits). The agent owns dossiers, facts and the work-context digest. Every agent claim shows its sources ("Why?") and can be rechecked or forgotten.
4. **GitHub is the source of truth for read and unread.** The app never holds a read state GitHub doesn't have. The only local-only state is the explicit, visible pending-writes queue while writes are locked.

## Principles

- **Rules first, agent second.** Deterministic rules (loudness, tiers, whose turn, stack completion) decide what they can. The agent judges what needs judgement and can veto or rephrase, never silently override.
- **The agent proposes, the user decides** anything lasting: topic renames and merges, instruction changes, and the scope of a chat point.
- **GitHub text is untrusted data.** It's fenced in prompts, and calls that read it run without tools.
- **Quality over cost.** The user is on a Claude subscription. Default to Sonnet (pinned as `claude-sonnet-5-5` in `models.ts`); use Opus where depth matters (context sweep, setup). Call caps are generous.
- **Boring code.** Readable over clever, functions defined before use, pure logic in `packages/core` with tests.

## Decided (don't re-propose the rejected ones)

- **Look:** "Crisp native" three-pane layout (topics | one-column tiles | detail), system font plus JetBrains Mono, and the "Warm reach" palette:
  - Honey means aimed at you, sea means your team.
  - Coral is **only** "new since you looked", plus the "not done yet" dot on PR rows (2026-09-29).
  - Ink primary buttons; accent blue only for selection and focus.
- **Tile spots:** a "for whom" word chip plus a 4px left band ("For you" honey, "For team-devex" sea, "Your PR" neutral, else nothing; replaced the RV/RT/@/... code badges 2026-09-28), actor avatar with event badge, worded segment pill, and a footer line saying whose move and what. The user prefers words and codes over pictograms, with people (GitHub avatars) first.
- **Rejected:**
  - Layouts: maps, timelines/lanes, kanban feel, one-card-per-view decks, agent-sized tiles.
  - Chat or stream as the main way content arrives.
  - Interaction: ⌘K palettes, keyboard-first design.
  - Full custom icon sets (found overdone), hand-drawn styles.
  - A Rolodex/3D right pane, flat queue views that replace topics, and an app-only "bring back" (GitHub can't mark unread).
- **Deferred:** "Dig deeper", a chat send mode running Opus with read-only tools for a user's hunch.

The full dated list is under "Decided" in `NEXT.md`. Add to it when the user decides something.

## How to work here

- **Design first when unsure.** For UI questions, make quick side-by-side mockups of the same one or two tiles on the design canvas before coding. Don't build full design systems.
- **Fake mode for building and checking:** `POSTPILE_FAKE=1` runs on sample data. Check UI in the static renderer build with the chrome-devtools MCP (see `NEXT.md` › How to run).
- **Never touch the real database** (`~/Library/Application Support/PostPile`). For real data, work on a copy made with `sqlite3 .backup`.
- **Keep GitHub safe while developing:**
  - Use `POSTPILE_READ_ONLY=1`, `POSTPILE_SYNC_ON_START=0` and `POSTPILE_MAX_AGENT_CALLS=0` unless the task needs real calls.
  - Never mark anything read on GitHub from a dev session.
  - Real GitHub reads are fine.
- **Stop what you start:** kill processes by PID, never with broad `pkill` patterns.
- **Checks before every commit:** typecheck and tests green (commands in `docs/development.md`).
- **Git:**
  - Stage with explicit paths, never `git add -A` or `git add .`.
  - Never run `reset`, `stash`, `checkout` or `restore` on shared work, never amend, don't push without asking.
  - Conventional commits with a body explaining why, in a neutral tone.
  - If 1Password signing fails, commit with `-c commit.gpgsign=false` and note the hash for re-signing.
- **Parallel agents:** use a separate git worktree per agent when two touch the engine or the same files. Merge with `--no-ff`.
- **Keep docs current:** update `DESIGN.md` for rule changes, `NEXT.md` for status and decisions, and `apps/desktop/CLAUDE.md` for renderer conventions.
- **Public repo:** tests, sample data and docs use invented names and data (`acme/app`, `alice`). Never paste real PR text, agent answers from a real database, personal paths or private repo names.

## Repo map

- `packages/core`: pure logic (tiles, loudness, tiers, whose turn, urgency, memory rules). Always tested.
- `packages/store`: `node:sqlite`, migrations in order (`NNN_name.ts`), repos.
- `packages/github`: reader (ETag, batched GraphQL, `gh auth token`) and writer.
- `packages/agent`: the claude CLI runner, prompts, zod schemas, models (`models.ts`).
- `packages/engine`: sync, live poll, digest pipeline, actions, writes lock and action log, work-context sweep.
- `packages/mcp`: read-only MCP server (`pr_context`, `topic`, `search_prs`, `whats_on_me`) over the engine's read methods.
- `apps/server`: Hono API, token-protected, bound to 127.0.0.1, with the fake engine in `src/fake/`.
- `apps/desktop`: Electron main (poll, Mac notifications) and the React renderer.
- `apps/cli`: dev CLI (`sync`, `poll`, `sweep`, `topics`, `topic`, `pr`, `mcp`, …).
