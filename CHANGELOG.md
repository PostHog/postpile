# Changelog

Notable changes per release. Versions follow semver, with `-alpha.N` pre-releases until 0.1.0.

## 0.1.0-alpha.1 (unreleased)

- Every PR now lands in a topic on the sync that sees it: the agent picks an existing topic or starts a new one named after the work. Unsorted only holds PRs the agent could not get to yet (call cap, claude missing, failed call), and the next sync places them. PRs parked in Unsorted by an earlier build are picked up on the next sync.
- The app runs its daily memory tidy-up (merge proposals for small topics, fact merges, retiring finished topics) by itself when it is due.

## 0.1.0-alpha.0 (2026-09-28)

First public build. macOS arm64 only, ad-hoc signed, not notarized.

- Topics instead of a notification pile: an agent groups PRs into topics and keeps a dossier per topic. Renames and merges are proposals you accept.
- Queues (Needs reply, My PRs, Team's PRs, To review, Team mentioned) that hold topics, with tiles that say for whom, why now, what state and whose move.
- Stacks stay together as one unit; agent-grouped sets for related PRs.
- Per-PR glances (verdict and risk) with sources, recheck and forget.
- Live notification poll with Mac notifications for pings that are your move.
- GitHub stays the source of truth for read/unread. Writes (approve, comment, mark read) sit behind a lock, and queued mark-reads have an undo window.
- `instructions.md` for your own rules, changed only by hand or through accepted proposals.
- Setup on first run: checks gh, your GitHub login, notification access and the claude CLI (with the exact fix commands), sweeps your last 30 days of PRs, CODEOWNERS or owners.yaml rules and work context, and has the agent draft your `instructions.md`. Every line says where it came from; edit it, tell the agent what's off, pick quiet repos and, if you like, a main repo, then accept. Skip it or run it again from "Your instructions"; a re-run shows up as a diff and a new version. `POSTPILE_SETUP_MODEL` picks its model (default opus).
- Daily work context sweep over `~/.claude` with secret masking and a skip list (default `personal,private`). Edit your own list under "What you're working on"; it is saved to `~/.config/postpile/config.json` as `sweepSkip`, so it also holds when the app is started from Finder. `POSTPILE_SWEEP_SKIP` still wins when set.
- A team @-mention stops being your move once you read the tile; personal questions and mentions stay until you answer.
- The CLI's `sync` and `consolidate` now respect `POSTPILE_MAX_AGENT_CALLS` (default 150) when no `--max-agent-calls` is given, and `pnpm cli ... --read-only` opens the database read-only.
- Approvals say who gave them: "approved by agent" in the status pill and "approved by reviewbot (agent)" in the detail when only a bot (for example an AI review agent) approved. Still counts as approved, like on GitHub; glances know whether a person or an agent approved.
- Sonnet calls are pinned to Sonnet 5.5 (`claude-sonnet-5-5`) instead of the `sonnet` alias. FYI: the model is part of the glance and set hashes, so existing glances and sets regenerate once on the next sync. `POSTPILE_MODEL` / `POSTPILE_GLANCE_MODEL` still override it.
- About box with version, Help links to the repo and issues.
- Missing `gh` or `claude` no longer ends in failing syncs and a red footer. The app checks both once, says what is missing with the exact fix (`brew install gh` + `gh auth login`; install Claude Code + `claude auth login`) and a Check again button, and looks again by itself on a backoff. Without gh the first screen is that fix instead of errors; without claude everything runs on rules only and says so ("Agent features are off: claude not found"). An expired gh token is picked up after `gh auth login` without a restart, and a Claude usage limit pauses the agent until it resets. `pnpm cli tools` prints the same check; `~/.claude/local` joins the folders searched for a Finder launch.
- FYI for anyone who ran a pre-release build: the bundle id changed from `com.postpile.app` to `com.posthog.postpile`, so macOS asks for notification permission again. Data stays in `~/Library/Application Support/PostPile`.
