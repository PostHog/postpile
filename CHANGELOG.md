# Changelog

Notable changes per release. Versions follow semver, with `-alpha.N` pre-releases until 0.1.0.

## 0.1.0-alpha.1 (unreleased)

- Fewer macOS permission prompts. The app no longer runs your login shell at launch to find PATH (that ran your whole `.zshrc` in PostPile's name); it reads `/etc/paths` and `/etc/paths.d` instead and adds the usual install folders. Tools elsewhere (mise, asdf) go in `toolPath` in `~/.config/postpile/config.json`. `gh` and `claude` run in an empty app folder, claude calls skip CLAUDE.md, auto memory, skills, the autoupdater and claude.ai connectors, and the work context sweep stays out of Documents, iCloud, cloud drives, other apps' containers and `/Volumes`. FYI: old grants can be cleared with `tccutil reset All com.posthog.postpile`.
- Every PR now lands in a topic on the sync that sees it: the agent picks an existing topic or starts a new one named after the work. Unsorted only holds PRs the agent could not get to yet (call cap, claude missing, failed call), and the next sync places them. PRs parked in Unsorted by an earlier build are picked up on the next sync.
- The app runs its daily memory tidy-up (merge proposals for small topics, fact merges, retiring finished topics) by itself when it is due.
- Stacks no longer go missing. A stack whose bottom layer merged (GitHub moved the next PR down by itself) now stays one stack, a closed attempt no longer pushes the open layers that replaced it out of the stack, and a stack with a layer in a retired topic still shows in its active topic. PRs from forks never join a stack by branch name.
- Tiles now carry which PRs form a stack, bottom first, also for a stack inside a set, so the UI can draw it as a stack.
- Update reminder: when a new release is out, the title bar shows "Update available" with the release notes link and `brew upgrade --cask postpile`. "Later" hides it for that version. The app asks api.github.com for releases every 6 hours, no token; `POSTPILE_UPDATE_CHECK=0` turns it off.
- PR state reads like GitHub: rows show a state icon (open, draft, merged, closed, queued) and the review state in words ("Needs review", "Approved", "Changes requested"), drafts get a DRAFT chip. CI status moved out of rows and tiles; it only shows in the detail pane's Checks fact.
- The PR description shows in the detail pane, in a small scroll box with Expand. Markdown is rendered without raw HTML, PR template comments are hidden and remote images are not loaded.
- Glances name up to three files to look at first, with why and +/- counts, linking to the PR's files on GitHub. FYI: existing glances regenerate once on the next sync to get them.
- No more stray focus borders on tiles after going back and forward.
- Stack layers show where they sit: a small blue tag like "1/3" (1 = bottom) before the PR title in tiles, in stacks inside sets and in the detail pane. The tooltip names the PR it is built on.
- A low-risk glance no longer shows a red RISK box; the verdict box already covers it.
- New PRs get their glance within a minute or so instead of waiting for a manual sync: when the live poll brings new activity or a PR without a glance, the app updates that topic's dossier and glances right away. Runs are coalesced per topic and capped per day (`POSTPILE_CATCHUP_CAP`, default 300 calls; 0 turns it off).
- A full sync runs in the background every 60 minutes while the app is open (`POSTPILE_AUTO_SYNC_MINUTES`, 0 turns it off). The title bar shows it like any sync.
- Clearer glance status instead of "the next sync picks it up": "Writing the glance…", "Glance queued", "Agent features are off", "Waiting: daily agent limit reached, next full sync in N min", and "Glance failed" with a Retry button.

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
