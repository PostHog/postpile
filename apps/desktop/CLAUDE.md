# desktop renderer: rules that are easy to undo by accident

Read these before editing anything under `src/renderer/src/`. The visual
reference is the "Crisp native, refined" mockup (StyleCrispPro) with the
"Warm reach" tile look on top (see "Tile look" below); the layout is still
open, so keep components small and cheap to move.

## No fictional data

The renderer shows what the local API returned and nothing else.

- **Sample data lives in one place: `FakeEngine`** (apps/server), switched on
  with `POSTPILE_FAKE=1`. The renderer never has its own fixtures and never
  has a `fake ? sample : real` branch. The title bar shows a "Sample data" pill
  when `/api/config` says `fake: true`. The one other difference: `Avatar`
  loads GitHub avatars only when the config says `fake: false`, so sample
  logins (invented, but maybe real accounts) always show initials.
- **Don't fill empty screens.** No topics, no tiles, no glance, no reviews:
  render the empty state ("No topics yet…", "No glance yet…"), never
  placeholder people, counts or repo names.
- **Don't hardcode account-shaped values** (repo, viewer login, PR counts,
  model names). If the UI needs one, add it to the API first.

## Disabled, not hidden

When something is not wired yet (no endpoint, no data), render it `disabled`
with a `title` that says why, like "Handled quietly" in the sidebar. Hiding it makes the gap invisible to the next agent.

## Data: typed query hooks, types from core

- One file per resource in `api/`: `topics.ts` (`useTopics`, `useTopic`,
  `useFinishedTopics` for the sidebar's Finished drawer),
  `pr.ts` (`usePr`), `chat.ts` (`useChat`), `config.ts` (`useAppConfig`),
  `viewer.ts` (`useViewer`, login and teammates for the filter buttons),
  `proposals.ts` (`useProposals`, the Inbox), `search.ts` (`useSearch`,
  debounced title bar filter), `instructions.ts`
  (`useInstructions`, `useInstructionsChat`), `sources.ts`
  (`useMemorySources`, only enabled while a "Why?" panel is open), `debug.ts`
  (`useDebugNotifications`, the notifications debug pane), `writes.ts`
  (`useGitHubWrites`, the footer lock), `repos.ts` (`useRepos`, the
  title bar repo menu), `cleanup.ts` (`useInboxCleanup`), `live.ts`
  (`useLivePoll`: the fast poll status every 5s; called once in App, it
  refetches everything else when a poll cycle stored news, a glance
  catch-up run moved (`catchUpChanges`) or a sync started or ended;
  `useLiveStatus` is the same query without that effect,
  `useNextAutoSyncAt` for "next full sync in N min"), `sync.ts`
  (`useLastSyncReport`, the stored last sync, which `useActions().lastSync`
  falls back to before this window's first sync; `useSyncProgress`, polled
  every second only while a sync runs, for the title bar's
  `syncing · agent 34/82 · 2m`, text from `lib/sync-progress.ts`),
  `setup.ts` (`useSetupStatus`, `useSetupChecks` (runs gh and claude on
  the server, so only enabled on the checks screen; "Check again" is its
  refetch), `useSetupSweep`, polled every second while the job runs),
  `tools.ts` (`useTools`: gh and claude status with fix commands, every
  30s while something is wrong, else every 5 min; "Check again" is
  `useActions().checkTools`),
  `update.ts` (`useUpdate`: the server's last update check, every minute;
  `UpdatePill` in the title bar, "Later" per version in localStorage),
  `mcp.ts` (`useMcpConnection`: is PostPile's MCP server in Claude Code,
  refetched on window focus; the server runs `claude mcp get` at most every
  5 minutes),
  `telemetry.ts` (`sendTelemetry`, fire-and-forget
  POST to `/api/telemetry`; not a query hook, no cache, a dropped call is
  swallowed. Only the events in `RENDERER_TELEMETRY_EVENTS`
  (`@postpile/core`) go through it — search, queue filter, topic and tile
  opens, setup steps and fit fixes, the update pill; everything else is the engine's own).
  Each hook wraps `useQuery` with a key from `api/keys.ts`.
- Wire types come from `@postpile/core` as `import type` only. The
  renderer never imports runtime code from other workspace packages; small
  pure helpers live in `lib/` with tests next to them.
- No OpenAPI codegen. When a screen needs a new field, add it to the core view
  type (`views.ts`), fill it in the engine's `read-models.ts` and in
  `FakeEngine`, then read it here.
- Derived UI values (lead PR, "1 pinged · 2 pulled", check counts, review
  rows) are pure functions in `lib/`, unit tested. Components stay dumb.

## Mutations: one guarded ActionsProvider

- **Every POST/DELETE goes through `useActions()`** from `api/actions.tsx`.
  Components never call `request()` for a mutation.
- **GitHub writes are guarded.** approve, send comment, mark read and "not
  mine" (it queues a mark-read) pass through `writeBlockedReason` in
  `lib/guard.ts`, which reads the footer lock (`useGitHubWrites`, `GET
  /api/github-writes`, changes at runtime). With the lock closed
  (read-only, the default) approve and comment are blocked with a clear
  toast; mark read and "not mine" still run but change nothing in the app:
  after the undo window they become pending writes (buttons carry
  `markReadNote`, the tile shows `PendingWritePill` from `pills.tsx`, its
  Mark read button is disabled). Never show a locked mark-read as done. Everything is blocked
  until the writes state has loaded. Don't bypass the guard, and put a new
  GitHub-writing action on the `GithubWrite` list. The inbox cleanup
  (`cleanUpInbox`, "mark everything older than N days read") is on it as
  `cleanup` and behaves like mark read: locked, it becomes one pending
  write. Start fresh and "Not now" are local.
- "Add to Claude Code" (`connectMcp(from)`) changes Claude Code's config,
  never GitHub, so it is not on the `GithubWrite` list. Fire it only from a
  click, never from an effect or along with Accept: the app never installs
  the MCP server by itself. `hideMcpConnect` is the footer's "Not now".
- **The lock** (`WritesLock` in the footer): locked = read-only. Opening it
  asks in a small popover ("Mark-read and approvals will reach GitHub")
  that also lists the pending writes (`lib/pending.ts`) with "Send N to
  GitHub" / "Discard" / "Cancel" and "Discard pending, stay locked"; the
  count badge sits on the lock. Closing it is instant unless something is
  pending. With `POSTPILE_READ_ONLY=1` it cannot unlock, only discard. The
  server keeps the choice and the pending writes; the renderer never
  stores them.
- Buttons for guarded actions carry the blocked reason as their `title`.
- The notifications debug pane has "Mark read" (thread level, same queue,
  undo, lock and action log as a tile). There is no "bring back": GitHub has
  no mark-unread, and the app never holds a read state GitHub doesn't have. Each row shows its last action log entry
  (`actionLine` in `lib/notifications.ts`); a read thread without one reads
  as "read on github.com or another client". Keep the tooltips honest about
  what reaches GitHub.
- After an action the provider invalidates every query except the config.
  Mark-read and memory correction results carry an undo token; the toast
  offers Undo for the 6s window and the footer counts mark-reads in the
  undo window (tokens starting with `memory:` are not mark-reads). When a
  window ends the provider refetches, so a locked mark-read shows up as
  pending.
- Big memory lines get "Recheck" (and "Forget" on a care): `MemoryLine`
  takes `canRecheck` (dossier status, goal, open questions, people, cares;
  facts with `FactView.recheckable`), never change lines or activity. The
  action bar's "Recheck" opens `RecheckDialog` for the whole glance
  (`prKey` set, no Accept, only Tell the agent / Close). Recheck opens
  `RecheckDialog`: `recheckMemory` runs one agent call and writes nothing;
  the user then accepts the outcome through `correctMemory` (holds ->
  `confirm`, fix -> `fix` with `fixedText`, drop -> `wrong`) or picks "Tell
  the agent what's wrong", which opens the selected tile's chat with the
  line quoted (`TellAgentContext`). Corrections only touch local memory, so
  they are not on the `GithubWrite` list, and carry an undo token (toast
  Undo, 6s). A fact changes right away; a dossier line shows struck through
  (`correctedClaims`) or with its fix (`fixedClaims`) until the next sync
  rewrites the dossier. Never fire `recheckMemory` from an effect without
  a guard: StrictMode would double the agent call.
- Instructions writes (`instructionsChat`, `proposeInstructions`,
  `saveInstructions`) are local (instructions.md + SQLite), not on the
  `GithubWrite` list. The user's instructions are never changed without an
  Accept on a proposal; the card shows a line diff (`lib/diff.ts`), Edit
  and Reject. In tile chat the user places a lasting point ("Keep for this
  topic" / "Keep for all topics" / "Just this once"); the agent never picks
  the scope. A save that comes back with `rebased` (the
  file changed on disk meanwhile) replaces the card's proposal, it is not
  an error to swallow.
- Setup (`startSetupSweep`, `refineSetup`, `acceptSetup`, `skipSetup`) is
  local, not on the `GithubWrite` list. Accept is the only write and it
  writes a new instructions version; a result with `current` means the
  file changed meanwhile: go back to review with that as the base, never
  retry blindly. `refineSetup` is one agent call and writes nothing; fire
  it only from a click.
- "What you're working on" (`WorkContextSection`, bottom of the instructions
  pane) is agent-written from local Claude Code notes and stays visibly apart
  from the user's instructions (dashed frame, "agent-written"). It is steered
  by Forget (`forgetWorkThread`, local, undo token with the `memory:` prefix)
  and Refresh (`refreshWorkContext`, one agent call); never add an edit box.
- Agent-derived memory is steered only by chat, Recheck and Forget, never by
  editing its text. Every memory line takes a `why` target
  (`lib/sources.ts`: `lineTarget`, `changePath`) and shows "Why?".
- `markTopicSeen` is quiet (no toast). `App.tsx` calls it when the user
  leaves a topic (another topic or the Inbox), not on a timer.
- A missing glance is worded from `PrSummary.glanceState` /
  `PrDetail.glanceState` through `glanceStateText` (`lib/glance.ts`),
  never "the next sync picks it up". Only a failed glance gets a button:
  Retry (`useActions().retryGlance`, local, not on the `GithubWrite`
  list). No manual refresh per PR or topic (decided 2026-09-29).
- Approve is final (GitHub has no un-approve). Keep it a deliberate click in
  the detail pane, in the action bar right under the assessment boxes.

## Styling: tokens + Tailwind utilities

- **Tokens live in `styles/tokens.css`** on `:root`: every color, radius,
  shadow and font. `styles/app.css` maps them onto Tailwind names in `@theme`
  (`bg-surface`, `text-muted`, `border-hairline`, `bg-unread-soft`,
  `rounded-tile`, `shadow-selected`, `font-mono`, …).
- **Tailwind's default palette is switched off** (`--color-*: initial`). Only
  token colors exist as utilities. Need a new color? Add a token to
  `tokens.css` and a `--color-*` line to `@theme`, don't reach for hex in a
  component.
- **Utilities first, inline `style` only for render-time values** (e.g. the
  flex weights of the size and checks bars). Comment why when you do it.
- Hover, focus and selected states are utilities or props-driven class
  strings, never `onMouseEnter` handlers.
- Type sizes follow the mockup with arbitrary values (`text-[11.5px]`);
  spacing uses the scale where it is close enough.
- Numbers, PR numbers, ids and ages use `font-mono` (JetBrains Mono, bundled
  in `styles/fonts/`, no network). UI text uses the system font.
- Plain CSS in `app.css` only for things Tailwind can't say well: the
  `.drag-region` for the title bar, base `html/body` rules.

## Missing tools (gh, claude)

The server says what works (`GET /api/tools`, `ToolsView` with headline,
detail and fix commands); `lib/tools.ts` only picks where it shows, and
`ToolsNotice` renders it. Never write your own wording for a tool state.

- gh missing, logged out or refused: with no topics the note is the middle
  column's empty state (`place="empty"`), otherwise a banner above the
  topics. The Sync button is disabled with the reason as `title`, the
  title bar says "sync off", and the start sync is skipped quietly.
- claude off or at its limit: one "Rules only" / "Paused" line above the
  topics with a "How to fix" fold. Agent actions still show their own
  error toast.
- gh offline only shows in the footer ("GitHub unreachable"); the poll backs
  off by itself.
- Check with `POSTPILE_FAKE_MISSING=gh|gh-auth|gh-token|gh-offline|claude|claude-auth|claude-limit`.

## Components: small files, extract for behavior

- One component per file in `components/`, named like the UI part:
  `TitleBar`, `TopicSidebar`, `TopicHeader` (+ `SinceLastLooked`,
  `DossierPanel`), `InboxPane`, `TileGrid`, `Tile`, `PrRow`, `NotificationsPane` (+ `NotificationRow`),
  `DetailPane` (+ `DetailContext`, `PrBody`, `GlanceCard`, `KeyFiles`,
  `PrDescription`, `PrFacts`, `ReviewList`, `NewSinceBox` (under the
  title; the activity list then shows only earlier events),
  `AgentFacts`, `ActivityTimeline`, `ActionBar`, `AskComposer`, `TileChat`),
  `StatusFooter` (+ `WritesLock`), `Toast`, `SearchField` (title bar filter),
  `ToolsNotice` (missing gh or claude, with `FixCommand`, shared with setup),
  `RepoScopeMenu` (title bar repo scope + "Let it go stale"),
  `InboxCleanup` (sidebar footer line or middle-column banner, as the
  server's `look` says) + `InboxCleanupDialog`,
  `UpdatePill` (title bar update reminder, self-contained so it can move;
  neutral, never coral),
  `McpFooterItem` ("agents: not connected" in the footer, only while
  `mcpFooterShows` in `lib/mcp.ts`; never while the state is unknown) +
  `McpConnectOffer` (the offer body, shared with `SetupAcceptStep`'s
  optional box; secondary button there so Accept stays the one primary).
- Shared kit: `Button`, `Menu`, `Avatar`, `pills.tsx` (verdict, `ForWhomChip`,
  `StateWordLabel`, `StackMark`: the "1/3" layers tag, place from
  `stackPlaces` in `lib/stacks.ts` over `tile.stacks`), `icons.tsx` (`Glyph` event set, `PrStateIcon`), `TurnLine`, and for memory `MemoryLine` (text, source chips,
  stale / marked-wrong / fixed badge, Why? / Recheck / Forget on hover),
  `MemoryButton` ("Forget"), `RecheckDialog`,
  `SourceChip`, `WhyPanel` + `MemorySourceRow` ("Why?"), `DiffView`,
  `InstructionsProposalCard` (tile chat and the instructions view),
  `WorkContextSection` (instructions pane only),
  `RelationBadge` (in `pills.tsx`).
  Something used in three places goes here; two call
  sites can stay duplicated.
- Don't extract a component that has more props than JSX children.

## Icons

- All icons are inline stroke SVGs in `components/icons.tsx`, 16px
  viewBox, `stroke="currentColor"`, colored with `text-*` utilities. No
  icon font, no icon package, no emoji. Shapes follow GitHub's Octicons,
  drawn simply, so PR states read like on github.com.
- One-path glyphs go in `GLYPH_PATHS` (`Glyph`); anything with a fill or
  a dash pattern gets its own small component (`PrStateIcon` draft,
  `RingDotIcon`).
- PR state: `PrStateIcon` (open green pull request, draft dashed grey
  circle, merged purple, closed red, queued amber; the word from
  `LIFECYCLE_WORDS` as its title). Review state: `StateWordLabel` with a
  `StateWord` from `reviewWord` / `rowStateWord` (`lib/pr.ts`). Never a CI
  icon or word outside `PrFacts`.
- Icons carry words: a lone icon gets a `title` (and `aria-label` when it
  is the only content of a control).

## Focus

`app.css` drops the ring for mouse focus (`:focus:not(:focus-visible)`) and
draws one accent ring with an offset for keyboard focus on buttons and
links. Rows inside a rounded box use `focus-visible:-outline-offset-2` so
the box cannot clip the ring. Back / forward (`useNavShortcuts`) blur the
focused element of the old view; without that, a clicked row kept focus
and showed Chromium's ring after the next key press, on a tile that was no
longer selected.
- Order functions so they are defined before they are used.

## Tile look ("Warm reach")

Four spots per tile, all derived in core and shipped on `TileView` /
`PrSummary` (DESIGN.md "Tile faces"); the renderer only picks labels and
tints (`lib/why.ts`, `lib/events.ts`, `reviewWord` / `rowStateWord` in `lib/pr.ts`).

- For whom: `ForWhomChip` ("For you" honey, "For team-devex" sea, "Your
  PR" neutral, nothing else) from `TileView.forWhom` / `PrSummary.forWhom`,
  plus a 4px left band on the tile in the same color (`BANDS` in
  `Tile.tsx`); PR rows get the small chip, no band. The tooltip keeps the
  long why-here reason (`whyTitle`). Grey on done tiles.
- Why now: `UnreadStrip`, warm strip, actor avatar with an ink event
  badge (`Glyph`), a coral "NEW" pill, age. On a revisit (`PrSummary.whatsNew`
  of the strip's PR, `stripNews`) the text, avatar, badge, "+N" and age
  come from core's `whatsNew`, worded by `whatsNewText` in
  `lib/whats-new.ts`; never add a second line or change the strip's size. Only unread tiles have the
  strip; read tiles get a quieter (ink-2) title, done and draft tiles a
  muted one. Drafts (`isDraftTile`): grey "Draft" chip and a dashed frame
  or dashed left band.
- PR status (design 3a, 2026-09-29): `PrStateIcon` at the start of the row,
  `StateWordLabel` on the right ("Needs review", "Approved", "Changes
  requested", DRAFT chip, "Merged", "Closed"), open threads after it. The
  state keeps its color on done tiles; title and counts go grey. When only
  agents approved (`PrStatus.agentApprovers`) the word reads "Approved by
  agent", names in the tooltip; the detail uses `PrDetail.agentApprovers`
  with `approvedText` in `lib/pr.ts`. **No CI on rows, tiles, the detail
  state line or the RISK box**: checks only show in `PrFacts`.
- Whose turn: `TurnLine` in the tile footer; the footer turns warm for
  "Your move".
- Coral (`unread`) means "new since you looked" and nothing else on a tile.
  Primary buttons are ink; accent blue is for selection and focus only.

## Setup flow

`App.tsx` shows `SetupFlow` over the middle and right columns (`col-span-2`,
no detail pane or tile divider) and `SetupSidebar` instead of the topics
when `useSetupStatus().needed` is true or after "Run setup again"
(`InstructionsPane`'s `onRunSetup`). Once open it stays open (a latch in
`App`) until Accept's sync ends or the user closes it: Accept makes the
server stop saying `needed`, and the screen must not vanish mid-sync. The
start sync waits for the setup status and is skipped while setup is
needed; a first-run "Skip for now" runs it. Screens: `SetupChecksStep`,
`SetupSweepStep`, `SetupReviewStep` (+ `SetupSectionCard` with "Why?",
`SetupRepoChoices`), `SetupAcceptStep`, with `SetupSteps` (worded step
chips) and `SetupChip` (OK / Fix this / Working ...). The step lives in
`App` so the sidebar can name it; the draft, edits and picks live in
`SetupFlow`. Pure helpers in `lib/setup.ts`, including `draftText`, a copy
of core's `formatInstructionsSections`: keep them in step. The repo picks
are a `SetupPicks` (`picksFromDraft`: suggested quiet repos on, main repo
"All repos"; `toggleQuiet` records touched toggles; `picksAfterRefine`
keeps them and the main repo on a refine).

## Selection

The sidebar lists topics in queue sections (`lib/queues.ts`,
`queueLayout`; DESIGN.md "Queue sections"): Needs reply, My PRs, Team's
PRs, To review, Team mentioned, then Other topics, which keeps the old
groups from `lib/sidebar.ts` (`sidebarGroups`: Needs you, Your team by
area, Routed, FYI). A topic can sit in several sections on purpose. Fold
state is local UI state; Routed, FYI and Finished start folded. The
Finished drawer (retired topics, `useFinishedTopics`) hides while search
or a queue filter narrows; a finished topic is not in `useTopics`, so
`App` opens it by id (`pickedFinishedId`) instead of through `visibleTopic`. The Mine / Team /
Reply / Review buttons (`QueueFilters`) are plain UI state in `App.tsx`,
not history entries; they narrow together with the search. Relation
corrections go through `correctMemory` with `relation` set
(`RelationLine`), local only. `TileGrid` shows tiles in tier order, fades
the ones a queue filter does not match and folds snoozed / done ones.
Tiles stay in one column (DESIGN.md "Three-pane balance").

`App.tsx` holds the picked topic, which middle pane shows (topic, Inbox,
"Your instructions", the notifications debug list, which also takes the
detail pane's column), and the picked
tile + PR. Everything else is
derived on render (`resolveSelection` in `lib/selection.ts`): a missing
pick falls back to the first topic, its first tile and that tile's lead PR;
a vanished tile id follows its PR to the tile that holds it now. Don't
mirror server data into `useState`. The one exception is `KeptView`: what
was on screen for the current entry and filter key (queue filter plus the
query the shown search results answer). While both stay the same it is
shown again even when it no longer matches, so a refetch after an action
never moves the selection; a new pick or a filter change drops it.

The picks live in a back / forward history (`lib/history.ts`, hook in
`lib/use-nav-history.ts`): every user pick goes through `go()` in `App.tsx`,
which pushes an entry unless it shows what is already on screen. Cmd+[ / ],
the mouse side buttons and the trackpad swipe (main process 'swipe' -> preload
`onSwipe`) move through it. A click on a Mac notification arrives as preload
`onOpenPing` and goes through `go()` too. Anything new that navigates should
call `go()`.

The repo scope (`RepoScopeMenu`, a radio list: All repos or one) is
applied by the server: `/api/topics` and `/api/search` only return the
topics with a PR in the chosen repo, and `/api/topics/:id` always returns
every tile with `repoLabel` set on tiles and PR rows from another repo
(drawn with `RepoLabel` from `pills.tsx`). The renderer never filters or
fades by repo itself. Setting the scope or a quiet
repo goes through `useActions()` (`setRepoScope`, `setRepoQuiet`, local,
not on the `GithubWrite` list). Popovers use `lib/use-dismiss.ts` to close
on outside click and Escape.

The title bar search filters, it has no result list: `GET /api/search`
(matcher `searchTopics` in core) returns matching topics and tiles, the
sidebar and tile grid hide the rest (`lib/search.ts`). When the filter hides
the picked topic, the first match shows instead; that is derived, not a
history entry, and clearing the filter brings the pick back. Only a filter
change does that: a topic that drops out of the results after a refetch
stays on screen and listed (`KeptView`).

## Electron shell

- The app is PostPile (renamed from code-manager 2026-09-28). The icon lives
  in `apps/desktop/build/` (`icon.icns`, `icon.png`, original artwork in
  `icon-source.png`); main uses `build/icon.png` for the window and the dev
  Dock icon. The title bar logo is `renderer/src/assets/logo-64.png`, a crop
  of the same icon. Regenerate it with `sips` when the icon changes.
- Names on the wire: preload global `window.postpile`, IPC channels
  `postpile:*`, API header `x-postpile-token`.
- `titleBarStyle: 'hiddenInset'`: the renderer draws the 52px title bar and
  keeps 88px free on the left for the traffic lights. Left column: logo +
  name, DEV badge / Sample data pill, then the back / forward chevrons at
  the right end (`ml-auto`), next to the centered search. Interactive elements in
  the bar must stay clickable (`.drag-region` sets them to no-drag).
- The preload hands over only the API URL and token (asked from main with
  `ipcRenderer.sendSync('postpile:connection')`; main answers only its own
  page, and nothing secret goes into `additionalArguments`), plus the swipe and
  notification-click listeners and `sendTestNotification` (the footer's
  "test ping", through `useActions().sendTestNotification`). The first
  launch shows a welcome notification (`main/welcome.ts`, flag in userData). As a plain web page the
  renderer takes `?api=…&token=…` instead.
- Packaging: `pnpm dist` (root) -> `apps/desktop/dist/mac-arm64/PostPile.app`,
  config in `electron-builder.yml`. Main must stay self-contained: keep
  runtime packages bundled by electron-vite (the desktop package has only
  devDependencies, and no node_modules go into the app). Don't read files
  from `build/` at runtime in a packaged app; it is not shipped.
- Dev vs packaged: unpackaged (`pnpm desktop`) sets `POSTPILE_PROFILE=dev`
  and userData to the dev data folder before anything else, so it never opens
  the real database; the title bar shows a DEV badge from `AppConfig.profile`.
  Main takes the database lock (`engineFromEnv({ lockKind })`) and shows a
  Quit dialog when another process holds it; `requestSingleInstanceLock`
  focuses the first window on a second launch.
- Logs: main and the in-process server log to
  `~/Library/Logs/PostPile/main.log` (`PostPile-dev` for dev runs,
  `POSTPILE_LOG_DIR` overrides), console output plus uncaught errors,
  rotated at 5 MB, 3 files (`main/file-log.ts`). Help › Reveal Logs shows it
  in Finder. The sync logs its start, a summary and each error.
- The last sync report (errors, timing) is stored in meta
  `last_sync_report` and shows in the footer's "last sync" and the title
  bar's sync status tooltips (`lib/sync-report.ts`) and in the notifications
  debug pane. Title bar elements with a `title` are no-drag, so tooltips work.
- Sync runs once on app start, on "Sync now", and every
  `AppConfig.autoSyncMinutes` (default 60) in the background (the engine's
  `AutoSyncSchedule`, started by main). `POSTPILE_SYNC_ON_START=0`
  (`AppConfig.syncOnStart`) skips the start sync. `useActions().syncing` is
  true for any running sync (`LivePollStatus.syncRunning`), so the title bar
  shows background syncs too; `lastSync` is the newer of this window's and
  the stored report (`newerReport`). The main process
  runs the live poll (`engine.startLivePoll`) and shows Mac notifications
  (`main/mac-notifier.ts`); closing the window hides it on macOS, Cmd+Q quits.
