# Changelog

Notable changes per release. Versions follow semver. PostPile is alpha software: each release counts the minor version up (0.2.0, 0.3.0), quick fixes bump the patch (0.2.1). The first build was 0.1.0-alpha.0; later versions drop the `-alpha` suffix.

## 0.16.1 (unreleased)

### Changed

- The title bar says "up to date" while PostPile keeps checking GitHub every minute, instead of "synced 40m ago", which counted from the last hourly full sync. It says "updates paused" while the checks back off or wait, and shows an age only when they fell behind ("checked 5m ago", amber) or the live poll is off. The full sync's details are in the tooltip; the footer says "last full sync".

## 0.16.1 (unreleased)

### Added

- Reply to a person's comment right in PostPile. Every comment in the PR's activity has Reply (in its review thread for a comment on code, else a new PR comment that quotes it) and Thumbs up, which adds a 👍 reaction on GitHub. In "New since you looked", "Reply ↓" jumps to the comment and opens the reply there.
- "Ask the agent" on the topic header: the agent chat now covers the whole topic and takes over the right pane. "Tell the agent" on a PR's assessment opens it with the PR named. "Back to #1907" returns to the PR.

### Changed

- The PR pane is reorganized. Approve, Comment review and Ask sit in their own row right after the assessment, under a label that says where your review stands ("Review requested from you", "You approved 2h ago"). The buttons keep the same order on every PR.
- Mark read, Snooze and "Remove <team>" sit in a quieter line right under the review row. "Open on GitHub" sits once, next to the PR number, with a menu for Files changed, Commits and Checks.
- One way to write: approving with a note, a comment review, asking the author and replying all open the same box in place, which says where the text goes. The agent drafts only when you click "✨ Draft with agent" at the start of the box, or "✨ Rewrite with agent" once you typed something.
- Recheck moved onto the assessment's title line.
- The agent chat shows your message right away with a "Thinking…" bubble, scrolls to the newest message, and takes several lines (Enter sends, Shift+Enter for a new line). A failed message goes back into the input instead of staying in the chat unanswered.

## 0.16.0 (2026-10-03)

### Added

- PostPile updates itself. A new release downloads in the background, and the title bar says "Update ready" with a "Restart to update" button. Without a restart it installs the next time you quit. PostPile › Check for Updates… checks right away. `brew upgrade --cask postpile` still works, and stays the fallback when the download fails. Turn the download off with `POSTPILE_AUTO_UPDATE=0`. Builds before this one can't update themselves: update to it once with brew.
- Catch up on your inbox: when you come back after a few days, or on the first run, and 20 or more merged PRs sit unread on GitHub, PostPile asks before the agent starts on them. You can clear merged PRs (all of them, or only the ones quiet for 7 or 14 days) together with everything else that had no activity for 14 or 30 days. Clearing marks them read on GitHub in the background, so your GitHub inbox shrinks too, finished topics move to the Archive, and the agent spends its first sync on what is still open. "Start as usual" keeps everything and asks again only once 20 more merged PRs pile up.
- The sidebar footer shows "12 merged PRs · Clear" any day, with the same dialog; while it clears, the footer shows the progress, and a toast says when it is done.
- Next to it, "✨ 8 of them look safe · Clear" marks read only the merged PRs the agent already looked at after the merge and found fine (Looks safe or Not yours). One click, no dialog; the rest stay unread. It uses the assessments that exist and never starts new ones.

### Changed

- The old cleanup ("mark everything older than 14 / 30 days read", its banner and "Not now") is part of the new dialog.
- PostPile leaves notifications that are not PRs (releases, issues, discussions, security alerts) unread on GitHub. It used to mark them read on every sync. Only the catch-up dialog clears them now, when you ask.

## 0.15.2 (2026-10-02)

### Changed

- In a stack, the layers below one that sits in the merge queue say "Merge queue: with 3/3" instead of "Approved", because queueing a layer merges the ones under it too. If the queue takes the top layer out, they show their review again.
- The download is about 19 MB smaller (about 15%), and the app takes about 65 MB less disk space. PostPile no longer ships Chromium's translations for languages other than English (the app is English only), or a software graphics library it never uses. Side effect: the few dates and times that followed your system's language now use the US format, like the rest of the app.

### Fixed

- Clicking between the PRs of a stack or set could leave an extra action bar under the assessment for every PR visited, each with that PR's buttons. The detail pane now shows one action bar, for the PR that is open.

## 0.15.1 (2026-10-02)

### Added

- The topic header shows the topic's repo on the "Owned by" line, with "+2" when its PRs touch other repos. With one repo picked in the title bar, a topic that is listed for a PR or two but mostly lives in another repo says "mostly in infra" in yellow, and the hover says why it is listed.
- The repo button has an × that goes back to All repos in one click.

### Changed

- With one repo picked, the repo button reads "Only app" in blue, the same look as a narrowing "Topics with" filter, so a narrowed list is hard to miss.
- "All repos" in the repo menu is marked Recommended, with a short note: dealt-with topics hide on their own, so the full list stays short.
- The notes the agent drafts for Approve with comment and Comment review are one or two sentences. They no longer retell what the PR does or list what was checked; they say what the author does not know yet, like a risk to watch or a follow-up, or just one short line when there is nothing to add.
- When someone mentions you, replies or asks you something within two hours of your own comment or review on a PR, you always get a Mac notification. The agent still writes the text but can no longer drop it because the reply "asks nothing".

### Fixed

- A reply that came in right after you commented on a PR often gave no Mac notification: GitHub still showed the thread as read when PostPile picked up the reply, and later it was no longer new. PostPile now keeps such replies and notifies once GitHub marks the thread unread.

## 0.15.0 (2026-10-02)

### Added

- When you request changes on a PR whose assessment said Looks safe (or rated it low risk), PostPile turns your review into a line it could check next time, such as "When core imports from ee/, say Look closer". The topic shows it under "Remember for future assessments?": keep it for the topic, add it to your instructions (you see the diff first), or dismiss it. Nothing changes until you pick. Reviews with nothing reusable in them, like nits, give no line.
- "Teach future assessments" under a PR's assessment: say what it should check next time, and PostPile offers the same three choices.
- "<login> drives" on the topic header is now a menu: pick You, a teammate, Your team or Someone outside your team, and the topic moves to that section at once. Each item shows where the topic would go. The pick sticks until you change it or choose Reset to automatic; new activity never lifts it, and the agent's topic memory follows it. Local only, nothing goes to GitHub.
- The agent can name your team as the driver of a standing topic that your team keeps up with nobody leading the current wave, so such topics sit under Your team owns instead of under whoever led one wave.
- Approve on the PR pane is split: the main part approves right away as before, the speech-bubble segment opens "Approve with comment" with a short review note the agent drafts for you to edit.
- "Comment review" next to Approve posts a review with a comment only. It answers a review request (yours or your team's) without approving, so branch protection does not count it as the approval that clears the PR. The agent drafts the note; an empty note cannot be posted.

### Changed

- Topic and rule suggestions in the Inbox are fewer and need a real reason. A merge has to say what the topics share and what you gain; "both are small" or "both are finished" no longer count. Rules only come from corrections where you said something in words, not from bare "Wrong topic" clicks. A suggestion you rejected is not asked again, and suggestions about topics that were since retired or archived are withdrawn instead of waiting in the Inbox.
- Sidebar sections now say whose topic it is, not whose PRs it holds. Below the asks (Needs reply, Changes you requested, To review, Team mentioned) topics sit under You drive, Your team owns or Other work, by who drives them; the owner team only decides when nobody is known to drive a topic. My PRs and Team's PRs are gone, so your own project no longer lands under Team's PRs because a teammate has a PR in it. The "Topics with any PR | my PRs | team PRs" switch still finds your PRs in any section.
- Inside each section, topics with your open PR or your move come first, then unread ones.
- Other work folds by area, single-topic areas under "More". It starts open when it holds your PR, your move or something unread, else folded; folded, urgent unread topics stay visible and the header counts what is unread.
- Topics without a dossier and without a known driver sit in Other topics with a "not sorted yet" mark. The Needs you, Your team and Routed to you groups inside Other topics are gone; FYI stays.
- Topics you have dealt with (nothing unread, no move of yours) leave You drive, Your team owns and Other work until something new comes in, like archiving in Gmail. Each of these sections ends with "+ N dealt with", which shows them dimmed; a section with nothing left says "all N dealt with". The selected topic stays put until you move on, and the search and the my PRs / team PRs filters still show everything. Archive stays for topics that are over.
- "Ask <owner>" opens in the same small popover as the review notes instead of a strip under the action bar. It works as before: pick the person, say what to ask, draft, edit, post.
- A review request you never opened no longer stays unread forever once it stops asking anything: when the request for you and your teams was removed or a teammate reviewed, and since then only bots and replies that don't need you came in, PostPile marks the thread read on GitHub and lists it under Handled quietly ("request gone"). A request that still stands stays unread as before.

### Fixed

- PRs with lots of bot reviews no longer stay unread for days. When a PR has more reviews, comments or review threads than PostPile reads in one go and its notification is unread, PostPile now fetches the older ones back to your last read (a few pages per list, a handful of PRs per sync) and then checks it like any other PR. If the older pages still don't reach your last read, the PR stays unread as before.
- A stack layer in the Trunk merge queue showed as not queued while Trunk tested the stack ("Running tests on this stack"). Trunk status lines in a wording PostPile does not know yet are now read by their emoji, so a PR keeps its queue state when Trunk rewords a message.

## 0.14.1 (2026-10-02)

### Added

- A topic whose tiles are all Dealt with but that still holds an open PR now says so after the Tiles count ("· 1 PR open"), with the PR named in the tooltip. Before, the Archive box stayed away without a reason.
- PRs in the Trunk merge queue show it like Trunk's browser extension: the merge queue icon replaces the PR icon, amber while it waits or tests and red when the queue takes it out, with "Merge queue: Testing" (or Submitted, Waiting, Failed) in place of the review status. The sidebar row and the topic header follow. A queued PR says "Waiting on the merge queue" instead of asking anyone to merge it; a failed one asks its author to re-submit it and says why, and on your own PR it counts as new activity.

### Changed

- Threads that came back unread only because of bots are marked read on the next live poll, usually within a minute. Before, PostPile waited 10 minutes after the last bot activity and then for the next sync, often up to an hour. Still only while GitHub writes are unlocked. The same goes for PRs you already dealt with, activity judged as not needing you, and releases and issues.
- Bot noise no longer rewrites topic memory. Merge queue status comments (Trunk's "Submitted", "Testing", "Merged successfully"), bot comment edits, deploy statuses and CI never start a dossier update. Review bot findings (CodeRabbit, Codex, Greptile, Copilot, stamphog) wait and are read with the next real update. A bot merging or closing a PR still counts.
- "Out of date: N newer events" counts only what would update the dossier, so a bot refreshing its comment no longer makes memory look out of date. "Since you last looked" no longer counts CI results and bot status refreshes either.

## 0.14.0 (2026-10-02)

### Added

- "Archive now": once everything in a topic is dealt with (every PR merged or closed, every thread read), a box under the Tiles count says when the topic moves to the Archive by itself, with a button to do it right away. In the Archive the box says what brings the topic back.

### Changed

- ✨ Approve on a stack goes from the base up: a layer is only offered when no layer below it needs a closer look. The confirm list says what the others wait on ("waits on #2104"). When the button approves one PR out of several it names it ("Approve #2107"), and "Approve stack" shows only when it approves the whole stack. If a lower layer fails to approve, the layers above it are skipped.
- Bot reviews and bot comments in review threads on your own open PR no longer keep it unread. They clear quietly like other bot activity; failing checks and unresolved threads still show up on the PR.
- Opening a PR marks it read as soon as the 1.5s fill completes, instead of later when you move on. The button then says "✓ Marked read" with an Undo link for a few seconds, and the unread dot fades out. The tile and its topic row stay put until you pick something else, then slide to their new place. Tiles a sync moves slide too. "Marks read when you leave" and the "Keep unread" X are gone, and these marks no longer show under Handled quietly.
- Topics come in two kinds: projects, which have a finish line, and standing topics, which keep a standard up for months ("Migration safety"). A standing topic stays ready for its next PR for half a year after the last one joined; a finished project takes follow-ups for 30 days.
- After this update, PostPile tidies your topics once more: it sorts them into projects and standing topics, folds the pieces of one standard into one topic, and renames a topic named after one step of its goal. PRs you moved by hand stay where you put them. It runs as the first step of the first full sync, behind the sync overlay, and takes about a minute on a large database.
- A topic with nothing left moves to the Archive 2 days after the last human activity (was 3 days of any activity). Deploy, CI and bot comments after a merge no longer keep it in the sidebar.
- The sidebar's "Finished" drawer is now "Archive".
- An out-of-date assessment is rewritten when you look at the PR: keep it open in the detail pane for a moment and it says "Updating now" instead of waiting up to an hour for the next sync. Only the PR you look at is rewritten, and it counts against the daily catch-up limit (`POSTPILE_CATCHUP_CAP`). The note says "next sync" only when that limit is spent or catch-up is off.

## 0.13.3 (2026-10-01)

### Changed

- Each topic in the sidebar shows one PR state icon at the end of its summary line: open if any PR is open, else draft, else merged, else closed. Hover it for the counts ("5 open · 1 merged").
- A tile's verdict pill shows the worst glance among its open PRs, not only the lead PR's. A stack whose top PR looks safe but whose third layer needs a closer look now says "Look closer"; a missing or out-of-date glance beats "Looks safe".
- One colour per meaning: amber is only the agent's "Look closer". "Needs review" is now neutral, a queued PR is merged purple, closed PRs, changes requested, risk and errors share one red, and approved, "Looks safe" and Approve share one green.
- The topic header's PR pill counts every PR in the topic, also the ones the sync found on its own (your open PRs, review requests, recent merges), so a topic of only found PRs no longer says "0 PRs". It shows the same state icon as the sidebar; hover it for the mix ("3 open · 1 draft · 1 merged; 2 need review, 1 approved").
- The topic header's breadcrumb names the sidebar section the topic sits in (To review, My PRs, …) with its coloured dot, instead of "Needs you" or "Quiet".
- A tile's Draft chip and the topic's draft icon follow one rule, so they can't disagree.
- The topic header shows the same honey "your move" chip as the sidebar row, and the group headings say how many of their tiles are your move: "Open 4 · 2 your move". Tiles waiting on others and snoozed tiles don't count.
- The detail pane's PR list now shows the same row as the tile, with open threads, the author and "assigned to" (the last two step aside when the pane is narrow). PR numbers and titles line up on read and unread rows, tile text and right edges line up, and the sidebar's FYI and Finished headers and filter lines start where topic names do.

## 0.13.2 (2026-10-01)

### Changed

- After an update, the PostPile MCP server in a running Claude Code session says "PostPile was updated. Run /mcp and reconnect postpile to load the new version." instead of answering from old code against the new database.
- A tile's ✨ Approve now approves the PRs the agent finds safe, like the topic's Approve, instead of greying out when any PR in the tile needs a closer look. It says "Approve 2 of 3 PRs" and the confirm list names the ones left out.
- Opening a tile in the app takes its notifications out of Notification Center; notifications about other tiles stay.

### Fixed

- Clicking a Mac notification opens the right tile again, even after topics were tidied or merged since the ping, and even while a filter, the search or the repo menu hides that topic. The filters stay as they were.
- Approving a PR no longer flips it back to unread a moment later, and the sidebar's unread count and dot clear once the mark-read reaches GitHub.
- Opening a PR that shows "Marks read when you leave" now really marks it read. It failed for about half of unread PRs, whose stored copy looked incomplete even when nothing was missing; the button now only shows when the mark will happen.
- The MCP tools no longer answer "PostPile isn't running" while the app is open. After a slow app launch, the app's own lock looked like it belonged to another process.

## 0.13.1 (2026-10-01)

### Changed

- While the one-time topic tidy after an update runs, the window shows "Tidying up your topics and tiles" with a spinner instead of topics moving under you. It takes a minute or two and goes away on its own.

## 0.13.0 (2026-10-01)

### Added

- "Move to topic…" in a tile's ⋯ menu opens a searchable picker instead of listing every topic. It suggests topics with the same people and the most recently active ones; finished topics only show when you search.
- Agent-assisted Approve and Mark read on topics and tiles, marked ✨; Approve updates at once and no longer shows Undo.

### Changed

- The sidebar's four filter buttons are now one switch: "Topics with any PR | my PRs | team PRs". The sections stay while it narrows, and a line says how many topics it hides, with "Show all". Reply and Review are gone: the Needs reply and To review sections show those.
- A topic that holds your own PR next to other people's work sits where that work puts it (a review waiting on you puts it under To review), not under My PRs.
- Inside a topic, your own tiles come first in each group.
- Topics are sized like projects: one goal over days or weeks, not one PR each. After this upgrade, PostPile tidies your existing topics once: it merges ones that are too small and splits ones that are too broad. PRs you moved by hand stay where you put them, and the tidy doesn't ask you through proposals.
- The MCP server refuses to answer while the PostPile app is closed, with a one-line error asking you to open it. It answers again as soon as the app is back, no reconnect.
- Update reminder: after 24 hours behind, the small title bar pill becomes a bar under the title bar with how many releases you missed, the brew command and release notes. "Later" brings back the pill for a day, then the bar returns.
- Sets (tiles that hold several PRs) now group PRs you can judge in one go: the same change in several places, or one small step of the goal, with similar risk. A set keeps its PRs until the agent changes it for a stated reason; a PR never moves because of its status, a review or a merge, and merged PRs stay in their set.
- Each change to a set is recorded with its reason. The CLI `topic` command and the MCP `topic` tool (detail "full") list them.

## 0.12.4 (2026-09-30)

### Changed

- Usage analytics: once a day, after a sync, PostPile sends how many tiles and topics there are and how many PRs sit in each, stacked or not. Counts only, no names or numbers.

## 0.12.3 (2026-09-30)

### Changed

- A topic shows its tiles in three groups, always in this order: Unread, Open and Dealt with. The All / Unread toggle is gone. Dealt with starts folded and stays open or closed as you last left it for the session; empty groups don't show.
- Tiles that used to be labelled "Done" say "Dealt with", in the app and in MCP answers. Topics that are over stay "Finished".
- Snoozed tiles sit in Open, or in Unread while a thread is unread on GitHub, instead of their own folded row.
- The detail pane's activity list puts the unread dot on every event you have not seen yet, not only loud ones. When a PR is unread because GitHub changed the notification and no event explains it, the list starts with one dotted line saying so.
- The "Mark done" button is now "Done for now".
- The automatic mark when you open a PR and move on is visible: the button fills over the 1.5s dwell, then says "Marks read when you leave" (or "done"), and a small X ("Keep unread") cancels it for that PR.

## 0.12.2 (2026-09-30)

### Changed

- Bots editing their sticky comments (CI reports, review summaries, test analytics) no longer keep PRs unread with nothing to do: each comment's latest edit is an event, and bot-only edits clear quietly. A person editing a comment to mention you is loud and stays unread.
- On your own open PR only a bot's review or inline comment keeps the thread unread; plain bot comments, CI and deploys clear like elsewhere.
- A move that was already yours before you last read the PR no longer blocks clearing new bot or judged-quiet activity, and "Merge, it is approved" never does.
- A comment edited to mention you shows as your move to reply and puts the PR under Needs reply.
- Acting on a PR (a comment, a review, marking it ready) counts as having seen earlier news only when you read the PR in between. When you did, the PR is done without a Mark read if nothing else is your move.

## 0.12.1 (2026-09-30)

### Changed

- The Dock badge counts topics with an unread dot, like unread channels in Slack, instead of tiles that are your move. Looking at them clears it; your move stays visible in the app.

### Fixed

- The sidebar topic bubble and the footer unread number count unread tiles again (0.12.0 counted PRs). The per-PR dots stay.
- Queue filters (Mine, Team, Reply, Review) only pick topics; they no longer fade tiles inside a topic.
- The grid's Unread filter lists unread tiles without fading them, and switching to it clears the tile selection.
- Mark read no longer pops a tile back to unread a few seconds later just because the PR moved after the last sync (your own pushes, a bot's review). PostPile fetches the PR again and marks it read after all when only your own activity and automation came since. When a person commented or reviewed since, the tile stays unread and a toast says what is new, e.g. "New since you looked: a review from alice".
- A tile unread on quiet events leads with the most important one (asks, merges without your review, human reviews) instead of the newest bot event, bots never get NEW, and HTML comment markers no longer show in summaries.

## 0.12.0 (2026-09-30)

### Added

- Comments and reviews in the timeline render Markdown (bold, lists, code, links, task lists) instead of raw text. Raw HTML and remote images stay out.
- The Dock shows how many tiles are your move as a badge, pings leave Notification Center once their tile is read or done in PostPile, and the Dock bounces once for a personal ask (mention, question, reply, review requested from you) while the window is in the background.
- Agent PRs a bot opens for someone count as that person's PR: one assigned to you shows as "Your PR" under My PRs, and one assigned to a teammate counts as your team's (a team review request on it is for you). Whose move names the assignee instead of the bot, and "Ask" asks them.
- PR rows and the detail pane show "assigned to" with faces when someone other than the author is assigned.
- The full sync also finds every open PR assigned to you. Only the ones a bot opened become yours; a PR a person assigned to you stays theirs and shows "assigned to you".
- Team roles: each of your GitHub teams is a home team or routing only. A home team works as before: its members are your teammates. A routing-only team, such as a big approvers team, only brings you its review requests and mentions: its members are not your teammates, its requests never count as "For you" on a teammate's PR, its chip is neutral without the side band, and its mentions no longer make a tile unread. Setup decides the roles from how your reviews of the last 90 days reached you (existing installs on the next sync), and you can flip one under the setup sweep or in "Your teams" below your instructions. With no home team there is no Team filter and no Team's PRs.
- Errors in the window are reported to PostHog Error Tracking like the app's other errors: scrubbed the same way, and off whenever usage analytics are off. A crash while drawing a screen shows a Reload button instead of a blank window.
- Error reports carry the release they came from, and release builds upload their source maps to PostHog (never shipped in the app), so error stacks point at the source instead of bundled files. Needs a one-time `POSTHOG_CLI_API_KEY` secret, see RELEASING.md.

### Changed

- GitHub unread is PostPile unread: a tile is unread while one of its PR threads is unread on GitHub, done or not, so nothing stays "done here, unread there". Pings, the coral "new since you looked" and the topic's "needs you" still follow loud news only; a tile unread with only quiet news counts in the Unread filter and the sidebar count but does not ping. A snoozed tile keeps its snooze and counts in the Unread filter.
- PostPile clears more by itself on GitHub (only while GitHub writes are unlocked, listed under Handled quietly): threads where everything since you last looked is bots or people's activity the events agent judged as not needing you. Review requests to you or your team, mentions, team mentions, questions and replies to you, and merges without your review are never cleared by PostPile. The events agent now also sees quiet activity by people on unread threads, and raising one to loud pings as usual.
- Release and issue notifications are marked read on GitHub by the sync (while writes are unlocked); PostPile does not show them.
- A finished topic never holds an unread thread: it retires only once every thread is read, and a finished topic whose thread turns unread comes back.
- Interface polish pass: a lighter selected tile with a pointer to the detail pane, one text grid in the detail pane, a ruled "Since you last looked" timeline, quieter sidebar rows, ink numbers in the title bar and footer, thin scrollbars. Approve is green now, the color of the "Approved" state it produces.
- Error messages sent to PostHog also drop repo names, PR numbers and quoted text, and stack frames from dependencies are always left out.
- Approve, Mark read, Mark done and Snooze change the tile and buttons as soon as they're clicked instead of after a few seconds. A failed action puts things back and says why.
- A snooze on a stack or set wakes when any of its tracked PRs meets the condition, for example the first PR to go green, instead of waiting for all of them.
- Under the hood: each rule (automation, who a review request asks, whose move, loudness, pings, button offers) is worked out once in core and read by the app, pings, MCP and sample mode alike, so they can no longer disagree.
- The coral dot means exactly "unread", on PR rows (single-PR tiles too), in the detail pane and on topics, and replaces the "Not done yet" dot. Dotted PRs add up to the tile, the topic bubble (now counting unread PRs, not tiles) and the footer count, so they match GitHub's unread count. What you saw but still owe shows as the honey "Your move", not as a dot.
- A bot's event the agent raised to loud wakes a snooze like a person's loud news: the tile turns unread and pings. A bot's event the agent left alone, and PostPile's own "Look closer" event, still never wake one.

### Fixed

- A sync touching many PRs no longer fails with "Expression tree is too large": the facts lookup built two SQL conditions per PR and SQLite gave up past about 500.
- A review request a bot made for you counts as an ask everywhere: it pings, wakes a snooze, and keeps quiet reads from marking the thread read as bot activity.
- A dismissed review no longer counts as reviewed for "To review" while whose move says "Review".
- Asked again after you requested changes, without a new push, whose move says "Re-review, ada asked", like with a push. It said "ada to address your changes".
- Inside "Changes you requested", a topic whose move says Re-review sorts first, also after a re-request. It sorted among the ones waiting on the author.
- Asked again after you requested changes, with only a comment from you since, whose move says "Re-review, ada asked" to match "Changes you requested". It said "Review, ada asked".
- Snoozes belong to PRs, not tiles, so they survive a PR joining a stack or set. A new unsnoozed PR in a snoozed tile makes the tile show again.
- Every snooze ends when its PR is merged or closed, so its topic can retire. A "someone replies" or "until" snooze on a finished PR still held it.
- A finished topic's retired time no longer moves when the topic is renamed.
- A mention the agent turns quiet no longer brings back a finished topic when the full sync is first to see it.
- A done PR in the detail pane offers only Open on GitHub, like a done tile, also on a snoozed tile. A handled PR by someone else with nothing asked still led with Approve.
- A snoozed tile whose PRs are all done shows Open in its footer, like the detail pane, instead of "Mark done". Snooze stays to take the snooze back.
- "Ask <author>" is hidden for every automation account PostPile knows, not only `[bot]` logins.
- MCP `pr_context` and `search_prs` name the move of the PR itself, not of its tile, so they match the detail pane on stacks and sets.
- The MCP server says so, and asks for a reconnect, when the app was updated while it kept running.
- A snoozed tile no longer pings. A bot's event the agent raised to loud used to leave the snooze in place and still send a Mac notification for it.
- An event the agent raises to loud after the poll saw it, like a push after your approval, now pings (and wakes a snooze) while it is fresh. The poll had already decided it while it was quiet, so no notification came.

### Removed

- "Leave GitHub alone, start fresh here" in the inbox cleanup. It hid things in PostPile that stayed unread on GitHub; a stored start-fresh date is dropped on upgrade, so they show again. "Mark everything older than 14 / 30 days read on GitHub" stays.

## 0.11.1 (2026-09-29)

### Fixed

- Your own unsubmitted review no longer counts as your reply. A pending review, or its pending inline comments, kept an ask quiet while the answer was still unsent, and could let PostPile mark the thread read on GitHub.
- Approve approves the commit you looked at. If new commits arrived since the pane last refreshed, the approval is refused with "New commits since you looked; take another look".
- PRs with more activity than PostPile fetches (more than 50 reviews, 60 comments, 50 review threads, 30 comments in one thread, 50 commits or 60 timeline events) are never marked read on GitHub by PostPile itself (bot-only, "you already dealt with it" or opened): something past those caps may be missing from what PostPile fetched.
- The MCP server no longer fails on a PR or topic after `instructions.md` was edited while the app was closed. It shows the glance as out of date until the app records the edit.
- With several reviewers asking for changes, the author's move stays until every one of them was asked to re-review after the author's push. Before, "Bob to re-review" could hide open work for Carol.
- A pending inbox cleanup stays pending when the lock closes while pending writes are sent, instead of being dropped as sent.
- Two processes taking over the same stale lock no longer delete each other's fresh lock: a takeover runs under a short-lived `postpile.lock.takeover` folder.
- Topic names are stored as one line of at most 80 characters, and agents only ever see them as data. A name that is empty after cleaning is refused. Existing names are cleaned once on update.

## 0.11.0 (2026-09-29)

### New

- MCP `refresh_from_github`: an agent can have the running app re-read a PR, or a topic's open PRs, from GitHub now. It only reads, skips PRs fetched in the last minute, allows 20 refreshes an hour across all agents, and only single PRs while your GitHub quota is low. Each one is in the action log.
- MCP `propose_topic_change`: an agent can suggest splitting PRs out of a topic, renaming it or merging it into another. The suggestion shows in the Inbox as "suggested by Claude Code", with the agent's reason, and nothing changes until you accept it. It comes with a preview of what accepting would do (a stack moves as a whole), at most 3 per topic, 10 in total and 20 a day, and expires after 14 days. The MCP `topic` tool shows agents what became of their suggestions.
- "Remove <team>" in the detail pane on PRs with a pending review request for one of your teams: removes the team's review request, unsubscribes you from the PR's notifications and marks the PR done. Asks once, cannot be undone, blocked while GitHub writes are locked.

### Changed

- A topic opens with no tile selected when nothing in it is unread (under Unread), and the right pane says "No tile selected". The app only auto-selects an unread tile (under All, else the first open one), never a done one. Switching the All / Unread filter picks again under an app-picked tile; if that tile changes state while you look at it, it stays in the pane and in the grid until you move on.
- Done tiles offer Open and nothing else: no Mark read button and no Snooze, in the tile footer and in the detail pane (where Open on GitHub leads).
- The detail pane acts on the PR you look at: on a stack or set, Mark read and Mark done mark only the selected PR (with its own undo), the label follows that PR, and there is no mark button while that PR is still your move. Snooze stays in the tile footer for sets and stacks. Single-PR tiles behave as before, and the tile footer still acts on the whole tile.
- The coral dot marks every PR of a stack or set that keeps the tile from being done ("Not done yet"), on read tiles too, so an open set says which PR still holds it. Mark a dotted PR done and its dot goes.
- Opening a PR in PostPile also marks it done there when nothing is asked of you on that PR (checked per PR now, not for the whole tile), not only read on GitHub. It happens when you move on (another PR or tile, closing the pane, leaving the app) after looking at it for 1.5 seconds, never while it is still on screen. A visit on github.com still only marks it read.
- The selected tile, and its topic in the sidebar, keep their place while selected, even when their state changes; they move once you select something else.
- The verdict pill on a multi-PR tile talks about the PR the footer names.
- Whose turn names the re-reviewer: once the author pushed after a change request and requested that reviewer again, it says "ada to re-review" instead of "rowan to address ada's changes". Also on your own PRs.
- A review request a bot made for you or your team counts like one a person made: it makes the tile unread and pings the same way. Before, a reviewer-assigning bot's request to your team was taken for bot activity and never pinged.
- Reviews routed to your team on PRs from outside the team no longer go through the ping check on every event. They ping once, when the PR's assessment says "Look closer" (even if a teammate reviewed already), and the tile turns unread with "Look closer: review routed to <team>". "Looks safe" and "Not yours" never ping for them.
- Your own merged or closed PRs are marked read on GitHub when only bots came after your last read or touch (the own-PR exception now only applies while the PR is open). Your own review after the last read no longer counts as someone else's activity.
- MCP answers are short by default: `pr_context` and `topic` take `detail: "full"` for everything. `search_prs` and `whats_on_me` page (`limit`, `offset`) and filter (`state`, `repo`, `whose_move`). Unknown PRs and topics, and bad filters, come back as errors with an example.
- `pr_context` says when PostPile last fetched the PR and whether the running app checks it again within a minute.
- Accepting a topic proposal that no longer fits (its topic was merged or retired, or a split's PRs moved elsewhere) is refused with the reason instead of moving PRs from other topics.
- GitHub text in MCP answers sits in a fence with a random id, with control characters and invisible Unicode removed.

## 0.10.0 (2026-09-29)

### Changed

- Whatever happened on a PR before your own last action on it counts as seen, however you acted (github.com, the gh CLI, GitHub Mobile, an agent commenting as you): your review, a comment or reply, a push to your own PR, or merging or closing it yourself. A "ready for review" from before your CLI approval no longer keeps the tile unread, and never pings.
- "New since you looked" can now say "since you merged it" or "since you closed it"; a push to someone else's PR no longer counts as your last look.
- Threads where you reviewed or replied after everything unread (from the gh CLI, GitHub Mobile or an agent) are marked read on GitHub after a sync, your own PRs included, only while GitHub writes are unlocked. A push does not count, and a merge without your review stays unread unless you acted after it. "Handled quietly" lists them with the reason ("you approved after it").
- A push to your own PR answers a mention or reply before it, like a comment would: "this needs a merge-in from master" stops being your move once you pushed.
- The move for a mention or a reply says what happened ("lyra mentioned you", "lyra replied to you") instead of "Reply to …". A question still says "Answer lyra's question".
- Opening a PR in the detail pane marks it read on GitHub, like a visit on github.com, when nothing is asked of you (the tile would be done after a mark-read), it is not snoozed and GitHub writes are unlocked. "Handled quietly" lists these as "opened in PostPile".
- A stale assessment looks stale: the verdict box goes grey and dashed, says "out of date" and folds the old advice behind "Show old assessment".
- One wording for "not up to date": "updating" while a sync or catch-up runs, "out of date" otherwise. The live footer says "paused while syncing".
- The detail pane's main button is the tile's main button (Mark read, Mark done, Snooze), with "Approve again" outlined next to it. The role chip reads "Reviewer", "Driver" and so on.
- Deletions in the Size fact get their own red; the Checks fact is plain grey with "N checks · M not passing".
- A single-PR tile shows its title once; the detail header shows just "PR" without a counter or arrows.
- The status bar drops the dollar figure from "last sync".
- Sidebar faces are PR authors only: you and your team in a sea team pill, then the other authors.
- Small grey text that carries information is darker and readable (4.5:1 or more).
- A repeated source chip shows once per block.
- A coral dot marks the PR that keeps a tile unread.

## 0.9.0 (2026-09-29)

### Changed

- CI is no longer a signal: the agents no longer see or mention check status (no more "hold approval until CI is green"), and failing CI on your own PR is no longer your move. The "Checks" line in the detail pane and the "Until CI is green" snooze stay.

## 0.8.0 (2026-09-29)

### Changed

- The live poll checks GitHub every minute, as GitHub's `X-Poll-Interval` asks, instead of every 10 seconds, and once right away when you switch to the app. `POSTPILE_POLL_SECONDS` can no longer go below GitHub's value.

## 0.7.0 (2026-09-29)

### Changed

- Threads you had read that came back only because of bots (CI, merge queue, review and deploy bots) are marked read on GitHub by PostPile after a sync, 10 minutes after the last bot activity at the earliest. Never your own PRs, never when something is your move or new for you, never a merge without your review, and only while GitHub writes are unlocked. "Handled quietly" in the sidebar lists the last 7 days.
- The notifications debug view shows each thread's ping decisions: pinged or withheld, by the rules or the agent, and why.
- One hourly usage event counts pings sent and withheld and threads handled quietly (counts only).

## 0.6.0 (2026-09-29)

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
