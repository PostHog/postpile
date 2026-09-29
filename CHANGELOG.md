# Changelog

Notable changes per release. Versions follow semver. PostPile is alpha software: each release counts the minor version up (0.2.0, 0.3.0), quick fixes bump the patch (0.2.1). The first build was 0.1.0-alpha.0; later versions drop the `-alpha` suffix.

## Unreleased

### Changed

- New sidebar section "Changes you requested", right under Needs reply: open PRs where your latest review asks for changes. The ones where the author pushed or replied since come first; the ones still waiting on the author follow. The "author addressed your changes" case used to sit under To review. The Review filter covers both.
- Each topic shows once in the sidebar, in its most urgent section, instead of in every section where it has a PR. The Mine, Team, Reply and Review filters still find a topic by any of its PRs.
- Your own PRs stay under My PRs whatever area or team the code belongs to; only Needs reply ranks above them.
- The "your move" chip on a topic row names the most urgent move ("Reply", "Re-review", "Review", "Address changes", "Fix CI", "Merge") and how many more ("Reply +2"). Hover it to see every move.
- A reply or mention that asks nothing of you ("thanks", "yeah that's fine") no longer makes it your move: when the agent judges it quiet, the tile stops saying "Reply to …", the topic leaves Needs reply, and marking it read no longer says "still your move". A real question still waits for your answer.
- Comments and review texts from people now show in full in the detail pane, in "New since you looked" and in the activity list. They used to be cut to one short line. Bot and CI lines stay compact.

## 0.5.0 (2026-09-29)

### Changed

- PRs that merged without your review are no longer tucked into Done. Their tile stays in the list with a grey line ("nell merged it without your review"), never unread and never a ping, until you mark it read, which also marks it read on GitHub. The agent now also glances these PRs after the merge, so "Look closer" tells you which ones are worth a look; "Not yours" moves one to Done. The topic row says how many are waiting ("2 merged without you"), and a topic with one doesn't retire. This works for everyone; the "merged without my review" instruction is no longer needed.

## 0.4.0 (2026-09-29)

### New

- Setup checks your instructions before you accept them. The Accept step says which lines PostPile can't act on (rules for coding agents, like pushing or merging), which sit under the wrong heading, and which are too vague. Each note has a fix: remove the line, move it, or use a suggested wording. These are only suggestions: Accept saves the text as it is.
- Each section in setup's review step says what it is for. Preferences says that PostPile never pushes, merges or reviews code.

### Changed

- Topic areas name the part of the product or codebase the work touches ("Data warehouse", "posthog-cli") instead of a catch-all like "Dev tooling". Existing topics get a better area the next time their dossier updates.
- PostPile keeps well under your GitHub rate limit, which it shares with your own `gh` and other tools. With half or less of the hourly limit left, the hourly background sync waits for the reset and the live poll slows to once a minute; at a fifth or less the live poll waits too. "Sync now" still works. The status bar says so while it happens, e.g. "GitHub quota low: background sync paused until 14:05".
- The setup draft leaves rules for coding agents out of Preferences, even when your Claude Code notes have them.
- No live poll, Mac notifications or agent catch-ups while first-run setup is open. They start once you accept or skip setup, so setup's own agent calls don't wait behind them.

## 0.3.1 (2026-09-29)

### Changed

- Finished topics leave the sidebar on their own: every sync retires a topic once all its PRs are merged or closed, nothing is unread or snoozed, and it has been quiet for 3 days (was 14 days, and only in the nightly tidy-up). A new event or PR brings it back. Topics retired in the last 30 days wait in a folded "Finished" drawer at the bottom of the sidebar.

## 0.3.0 (2026-09-29)

### New

- Read-only MCP server, `postpile-mcp`: other agents can ask what PostPile knows about a PR and its topic (`pr_context`, `topic`, `search_prs`, `whats_on_me`). Set it up with `claude mcp add postpile -- postpile-mcp`. It ships inside the app and Homebrew links it. From the repo, run `pnpm cli mcp`.
- "Add to Claude Code": while Claude Code does not have PostPile's MCP server, the status bar shows "agents: not connected". A click offers to add it (`claude mcp add --scope user`), shows the command for other agents, or hides the item with "Not now". The last setup step offers the same. Nothing is added without the click.

### Changed

- Topics are cut by goal: every agent gets the same definition of area, topic, tile and set, and a PR no longer lands in a broad topic it only shares a repo or a word with. With no live goal to join, it gets a new topic.
- The nightly tidy-up applies small topic splits (up to 3 PRs) by itself. Bigger splits still wait in the Inbox.
- A team review request routed to your team is no longer your move while someone else's change request stands (it is the author's move), or when the agent glance says Not yours. Marking such a tile read makes it done.

### Fixed

- The first sync no longer runs for 20+ minutes on a big inbox. Notifications older than 30 days are left alone, one sync takes at most 60 PRs (newest and unread first), and when there are more, the next background sync follows 2 minutes later instead of an hour.
- The repo menu says "6 topics" instead of a bare "6" that read like an unread count.

## 0.2.1 (2026-09-29)

### Fixed

- Usage analytics: finishing or skipping setup is now recorded, so the activation funnel shows it.
- Usage analytics: a sync that fails halfway is recorded as failed, not as completed.

## 0.2.0 (2026-09-29)

### New

- Update reminder: when a new release is out, the title bar shows "Update available" with the release notes and the `brew upgrade --cask postpile` command. "Later" hides it until the next version. The app asks api.github.com for releases every 6 hours, without a token. Turn it off with `POSTPILE_UPDATE_CHECK=0`.
- New PRs get their glance within a minute or so instead of waiting for the next sync. When the live poll brings new activity or a PR without a glance, the app updates that topic and its glances right away. Capped per day with `POSTPILE_CATCHUP_CAP` (default 300 agent calls, 0 turns it off).
- A full sync runs in the background every 60 minutes while the app is open, shown in the title bar like any sync. Change the interval or turn it off (0) with `POSTPILE_AUTO_SYNC_MINUTES`.
- Glances name up to three files to look at first, with why and +/- counts, linking to the PR's files on GitHub. FYI: existing glances are written again once on the next sync to get them.
- The PR description shows in the detail pane, in a small scroll box with Expand. Raw HTML, PR template comments and remote images are left out.
- Stack layers show where they sit: a small blue tag like "1/3" (1 = bottom) before the PR title, in tiles, in stacks inside sets and in the detail pane. The tooltip names the PR it builds on.
- Usage analytics, on by default: counts and enums only (syncs, tile opens, proposal decisions, tool health and the like), never PR titles, bodies, repo or branch names, logins, prompts or agent text. Identity is a hashed GitHub id, never the login. Turn it off with `POSTPILE_TELEMETRY=0` or `DO_NOT_TRACK=1`. Details in README › Privacy.

### Changed

- A tile's button only says "Mark done" when marking it read actually makes it done. On a PR that still waits on you (say the author addressed your changes) it says "Mark read", and once read Snooze becomes the main button, next to "Review on GitHub". The toast says "Marked read. Still your move: re-review." and offers "Snooze until next push". Read tiles get a regular-weight title and keep their place in the list.
- Coming back to a PR you already reviewed, commented on or marked read, the tile's "why now" line says what changed since then: "6 commits since your changes request", "lyra replied to your review", "lyra requested changes since you approved". Bot and CI activity never counts. First-time asks keep their wording.
- The detail pane's "New since you looked" box moved up under the title and says since when ("since your changes request yesterday"). It shows up to 3 lines, folds bot and CI activity into one line, and the activity list below no longer repeats it.
- Every PR lands in a topic on the sync that sees it: the agent picks an existing topic or starts a new one named after the work. Unsorted only holds PRs the agent could not get to yet (daily limit, `claude` missing, a failed call), and the next sync places them. PRs an earlier version left in Unsorted get placed on the next sync too.
- The daily memory tidy-up (merge suggestions for small topics, merging duplicate facts, retiring finished topics) runs by itself when it is due.
- PR state reads like GitHub: rows show a state icon (open, draft, merged, closed, queued) and the review state in words ("Needs review", "Approved", "Changes requested"), and drafts get a DRAFT chip. CI status moved out of rows and tiles; it only shows in the detail pane's Checks line.
- Clearer glance status instead of "the next sync picks it up": "Writing the glance…", "Glance queued", "Agent features are off", "Waiting: daily agent limit reached", and "Glance failed" with a Retry button.
- A low-risk glance no longer shows a red RISK box; the verdict already covers it.

### Fixed

- Fewer macOS permission prompts. The app no longer runs your login shell at launch to find tools (that ran your whole `.zshrc` in PostPile's name); it reads `/etc/paths` and `/etc/paths.d` and adds the usual install folders. Tools installed elsewhere (mise, asdf) go in `toolPath` in `~/.config/postpile/config.json`. `gh` and `claude` run in an empty app folder, agent calls leave out your CLAUDE.md, memory, skills and claude.ai connectors, and the work context sweep stays out of Documents, iCloud, cloud drives, other apps' data and `/Volumes`. FYI: old grants can be cleared with `tccutil reset All com.posthog.postpile`.
- Stacks no longer go missing. A stack whose bottom PR merged stays one stack, a closed attempt no longer pushes the open PRs that replaced it out of the stack, and a stack with a PR in a retired topic still shows in its active topic. Stacks inside a set show as stacks. PRs from forks never join a stack by branch name.
- No more stray focus borders on tiles after going back and forward.
- Approving (or marking read) no longer jumps to another topic or tile. The picked topic and tile stay on screen until you pick something else or change a filter, even when the topic leaves the Review filter or the tile turns done or read. The tile also stays in the Unread list while it is selected.

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
