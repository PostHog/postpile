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
with a `title` that says why. Hiding it makes the gap invisible to the next agent.

## Data: typed query hooks, types from core

- One file per resource in `api/`: `topics.ts` (`useTopics`, `useTopic`,
  `useFinishedTopics` for the sidebar's Archive drawer),
  `pr.ts` (`usePr`), `chat.ts` (`useTopicChat`, the agent pane), `config.ts` (`useAppConfig`),
  `viewer.ts` (`useViewer`, login, teammates and home teams for the filter
  buttons; no home team hides Team, `visibleQueueFilters`),
  `team-roles.ts` (`useTeamRoles`, home or routing only per team for "Your
  teams"; flips go through `actions.setTeamRole`, rows are `TeamRolesList`,
  shared with the setup sweep step),
  `proposals.ts` (`useProposals`, the Inbox), `search.ts` (`useSearch`,
  debounced title bar filter), `instructions.ts`
  (`useInstructions`, `useInstructionsChat`), `lessons.ts`
  (`useLessons(topicId)`, a topic's open lessons; key `lessons(topicId)`,
  `lessonsAll` refreshes every topic's after a teach), `sources.ts`
  (`useMemorySources`, only enabled while a "Why?" panel is open), `debug.ts`
  (`useDebugNotifications`, the notifications debug pane), `quiet.ts`
  (`useHandledQuietly`, the "Handled quietly" list), `writes.ts`
  (`useGitHubWrites`, the footer lock), `repos.ts` (`useRepos`, the
  title bar repo menu), `cleanup.ts` (`useInboxCleanup`, polled every
  second while a cleanup runs), `live.ts`
  (`useLivePoll`: the fast poll status every 5s; called once in App, it
  refetches everything else when a poll cycle stored news, a glance
  catch-up run moved (`catchUpChanges`) or a sync started or ended;
  `useLiveStatus` is the same query without that effect,
  `useNextAutoSyncAt` for "next full sync in N min"), `sync.ts`
  (`useLastSyncReport`, the stored last sync, which `useActions().lastSync`
  falls back to before this window's first sync; `useSyncProgress`, polled
  every second only while a sync runs, for the title bar's
  `syncing · nothing new on GitHub · agent calls 34/82 · 2m`, text from
  `lib/sync-progress.ts`),
  `setup.ts` (`useSetupStatus`, `useSetupChecks` (runs gh and claude on
  the server, so only enabled on the checks screen; "Check again" is its
  refetch), `useSetupSweep`, polled every second while the job runs),
  `interruptions.ts` (`useInterruptions`: when PostPile may show a Mac
  notification, never / batches / asap, whether one was ever `chosen`, plus
  the roundup times; read by the setup step "Your day", the sidebar's
  Interruptions menu and the one-time `InterruptionsPrompt`; changed only
  through `useActions().setInterruptions(mode, from)`, a PUT that shows the
  new mode right away and rolls back on failure, no toast),
  `tools.ts` (`useTools`: gh and claude status with fix commands, every
  30s while something is wrong, else every 5 min; "Check again" is
  `useActions().checkTools`),
  `update.ts` (`useUpdate`: the server's last update check, every minute;
  `lib/use-update-reminder.ts`: `useUpdateReminder` asks core's `updateUrgency`
  for none / pill / bar and core's `updateAction` for restart / downloading /
  command, from the main process's install state (preload `installState` and
  `onInstallState`; every change also refetches the update check; null on a
  plain web page, which means the brew command); "Later" is one shared snooze
  timestamp in localStorage, read by `UpdatePill` and `UpdateBar`),
  `mcp.ts` (`useMcpConnection`: is PostPile's MCP server in Claude Code,
  refetched on window focus; the server runs `claude mcp get` at most every
  5 minutes),
  `telemetry.ts` (`sendTelemetry`, fire-and-forget
  POST to `/api/telemetry`; not a query hook, no cache, a dropped call is
  swallowed. Only the events in `RENDERER_TELEMETRY_EVENTS`
  (`@postpile/core`) go through it — search, queue filter, topic and tile
  opens, setup steps and fit fixes, the update pill and bar; everything else is the engine's own.
  `errorReporter` sends renderer errors on the same route as
  `renderer_exception`: `main.tsx` hooks it to the window's `error` and
  `unhandledrejection` events, `components/ErrorBoundary.tsx` at the root to
  render errors. Raw error in, the engine scrubs it; logic in
  `lib/error-report.ts`).
  Each hook wraps `useQuery` with a key from `api/keys.ts`.
- Wire types come from `@postpile/core` as `import type` only. The
  renderer never imports runtime code from other workspace packages; small
  pure helpers live in `lib/` with tests next to them.
- No OpenAPI codegen. When a screen needs a new field, add it to the core view
  type (`views.ts`), fill it in the engine's `read-models.ts` and in
  `FakeEngine`, then read it here.
- Derived UI values ("1 pinged · 2 pulled", check counts, review
  rows) are pure functions in `lib/`, unit tested. Components stay dumb.
  Rules are not display: facts (whose move, done, automation) and offers
  (which buttons, which leads, the lead PR) come from core as view fields,
  and tier order is typed with core's `PrTierOrder`. A tile's group
  (`TileView.group`: unread, open, dealt_with) and the NEW pill
  (`TileView.newBadge`) come from core too; never compare `state.kind`
  with `unread` / `done` or read `unreadOnGitHub` / `automation` here.
  `src/main/renderer-rules.test.ts` greps for that and fails.
- Component tests are rare: only for wiring bugs a `lib/` test cannot see
  (keys, remounts). `*.test.tsx` next to the component, first line
  `// @vitest-environment jsdom`, views from `@postpile/core/fixtures`
  (see `DetailPane.test.tsx`).
- **One key per PR, on `PrBody`.** `DetailPane` keys the whole body by PR
  key. Don't also key its children by PR key: siblings with the same key
  leave stale copies in the DOM (0.15.1 showed one action bar per PR visited).

## Mutations: one guarded ActionsProvider

- **Every POST/DELETE goes through `useActions()`** from `api/actions.tsx`.
  Components never call `request()` for a mutation.
- **GitHub writes are guarded.** approve, comment review, send comment,
  reply, react, mark read (tile and PR-scoped), "not mine" (it queues a
  mark-read) and "Remove <team>" pass through `writeBlockedReason` in
  `lib/guard.ts`, which reads the footer lock (`useGitHubWrites`, `GET
  /api/github-writes`, changes at runtime). With the lock closed
  (read-only, the default) approve and comment are blocked with a clear
  toast (so is "Remove <team>", `removeTeam`: final, never a pending
  write); mark read and "not mine" still run but change nothing in the app:
  after the undo window they become pending writes (buttons carry
  `markReadNote`, the tile shows `PendingWritePill` from `pills.tsx`, its
  Mark read button is disabled). Never show a locked mark-read as done. Everything is blocked
  until the writes state has loaded. Don't bypass the guard, and put a new
  GitHub-writing action on the `GithubWrite` list. The inbox cleanup
  (`clearInbox`, and `clearSafeMerged` for the sidebar's "look safe"
  item) is on it as `cleanup` and behaves like mark read: locked, it
  becomes one pending write. `startAsUsual` is local (it only answers
  the start dialog) and shows no toast.
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
  as "read on github.com or another client"; a quiet mark-read (origin
  `quiet`) as "marked read by PostPile: only bot activity since your last
  read", or with its reason ("you approved after it", "opened in
  PostPile"). Rows also show the newest ping decision (`pingDecisionLine`), the
  expanded row the last three. Keep the tooltips honest about what reaches
  GitHub.
- "Handled quietly" (`HandledQuietlyPane`, pane `quiet`) is read only: the
  engine's own quiet mark-reads of the last 7 days with their reason
  (`quietReasonText` in `lib/quiet.ts`), a click opens the tile.
  No actions, no coral.
- After an action the provider invalidates every query except the config;
  the action's busy key lasts until that refetch lands. Approve, mark read
  (tile and PR) and snooze change the cache on click first (`run`'s
  `optimistic`, next state from `lib/optimistic.ts`, only from shipped
  fields like `afterRead`) and roll back on failure; nothing early while
  locked or blocked.
  Mark-read and memory correction results carry an undo token; the toast
  offers Undo for the 6s window and the footer counts mark-reads in the
  undo window (tokens starting with `memory:` are not mark-reads). When a
  window ends the provider refetches, so a locked mark-read shows up as
  pending.
- Big memory lines get "Recheck" (and "Forget" on a care): `MemoryLine`
  takes `canRecheck` (dossier status, goal, open questions, people, cares;
  facts with `FactView.recheckable`), never change lines or activity. The
  glance's "Recheck" (on its title line, next to "Tell the agent") opens
  `RecheckDialog` for the whole glance (`prKey` set, no Accept, only Tell
  the agent / Close). Recheck opens
  `RecheckDialog`: `recheckMemory` runs one agent call and writes nothing;
  the user then accepts the outcome through `correctMemory` (holds ->
  `confirm`, fix -> `fix` with `fixedText`, drop -> `wrong`) or picks "Tell
  the agent what's wrong", which opens the topic's agent pane with the
  line quoted (`TellAgentContext`, `AgentPane`). Corrections only touch local memory, so
  they are not on the `GithubWrite` list, and carry an undo token (toast
  Undo, 6s). A fact changes right away; a dossier line shows struck through
  (`correctedClaims`) or with its fix (`fixedClaims`) until the next sync
  rewrites the dossier. Never fire `recheckMemory` from an effect without
  a guard: StrictMode would double the agent call.
- Instructions writes (`instructionsChat`, `proposeInstructions`,
  `saveInstructions`) are local (instructions.md + SQLite), not on the
  `GithubWrite` list. The user's instructions are never changed without an
  Accept on a proposal; the card shows a line diff (`lib/diff.ts`), Edit
  and Reject. In the agent pane the user places a lasting point with one
  line ("For this topic · For all topics"; left alone it is just this
  once); the agent never picks the scope. A save that comes back with `rebased` (the
  file changed on disk meanwhile) replaces the card's proposal, it is not
  an error to swallow.
- Lessons (DESIGN.md "Lessons from your reviews") are local, not on the
  `GithubWrite` list. `keepLessonForTopic` and `dismissLesson` go through
  `run` (toast, refetch of everything: lessons, tailoring, instructions).
  `proposeInstructionsFromLesson` writes nothing: its proposal shows in an
  `InstructionsProposalCard` under the lesson and saves through
  `saveInstructions` like a chat one (accepting closes the lesson); a reply
  without a proposal is shown there as text, not a toast. `teachLesson` is
  one agent call; its reply (nothing reusable, agent off, failed call) is
  shown under the glance. Fire both only from a click. Proposal cards are
  keyed with `proposalKey` (`lib/instructions.ts`): a proposal has a chat
  message or a lesson as its source, never both.
- Topic proposals come from consolidation or, through the MCP server, from
  an outside agent (`source: 'agent'`, `client`). Say who suggested an
  outside one wherever it shows: the Inbox card's meta line
  (`proposalMeta`: "topic · suggested by Claude Code · 2h ago") and the
  topic header row ("Claude Code suggests: …"), both from `suggestedBy` in
  `lib/proposals.ts` (unknown clients read "an outside agent"). Accept can
  come back refused when the proposal no longer fits; show the message,
  never retry.
- Setup (`startSetupSweep`, `refineSetup`, `acceptSetup`, `skipSetup`) is
  local, not on the `GithubWrite` list. Accept also carries the "Your day"
  pick (`interruptions`, null leaves the stored mode); the engine sends
  `interruptions_changed`, never the renderer. Accept is the only write and it
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
- `markOpenedRead` has no toast and is on the `GithubWrite` list as
  `openedRead`, blocked while locked. `useOpenedRead` in `App.tsx` calls it
  once per open, when the PR has stayed 1.5s in the detail pane with the
  window visible and focused (`OpenedReadTimer`: the dwell end fires;
  hidden before that restarts the wait, after it changes nothing). Only
  when `opensMarkRead` (`lib/opened-read.ts`) says a mark-read of that PR
  leaves it done (`PrSummary.afterRead.done`, per PR, not the tile's). The
  server checks again and marks it read like the pane's Mark read (its own
  batch, undo token in `OpenedReadResult`). The pane then shows
  `OpenedMarkNote` ("✓ Marked read" / "✓ Done for now") in the mark
  button's place with Undo while the window lasts (`UNDO_WINDOW_MS` in
  `lib/undo-window.ts`); Undo goes through `useActions().undo` and the open
  does not arm again. Never a "Marks read when you leave" promise
  (2026-10-01, DESIGN.md "Marked when the dwell ends").
- The selected tile and its topic row hold their place (`useHeldPlace`)
  until the selection moves; list moves then slide with `useFlip`
  (`lib/use-flip.ts`): mark the moving elements `data-flip-key` (never one
  inside another) and `data-flip-group`. The unread dot (`UnreadDot`
  `shown`) stays mounted and fades out. Respect `prefers-reduced-motion`
  (`motion-reduce:` or the hook's check) in any new motion.
- A missing glance is worded from `PrSummary.glanceState` /
  `PrDetail.glanceState` through `glanceStateText` (`lib/glance.ts`),
  never "the next sync picks it up". Only a failed glance gets a button:
  Retry (`useActions().retryGlance`, local, not on the `GithubWrite`
  list). No manual refresh per PR or topic (decided 2026-09-29).
  Refresh on look is automatic, not a button (2026-10-01): `useGlanceLook`
  in `DetailPane` asks `useActions().refreshGlanceOnLook` once per open
  after the 1.5s dwell when the glance is stale; the server decides, and
  the words come from `glanceState` and `glanceRefreshBlock`. Its timer
  (`lib/glance-look.ts`) is its own, apart from the opened mark's.
- Approve is final (GitHub has no un-approve). Keep it a deliberate click in
  the detail pane, in the review row right after the glance (DESIGN.md
  "The PR pane", 2026-10-05): its own row with a GitHub review-state label
  (`reviewRowLabel` over core's `PrDetail.viewerReview`), never inside the
  glance, same order on every PR.
- The pane's writes share one inline `Composer` (state per PR in `PrBody`
  through `ComposeProvider`, one open at a time, drafts kept per target):
  a header that says where it goes, one box with the agent's pill where the
  text starts ("✨ Draft with agent" / "✨ Rewrite with agent", never an
  automatic draft), Cancel and a button that names the target. Replies live in the activity list
  (core's `ActivityLine.reply`, once per comment); "New since" only jumps there
  ("Reply ↓", `jumpToReply`). Housekeeping (`PaneHousekeeping`) is a quiet
  line right under the review row, never in `DetailContext` (that band is
  the stack/set PR picker); "Open on GitHub" (`OpenOnGitHub`) only on the
  state line.
- The agent pane (`AgentPane`, App's `agentRequest`) replaces the detail
  pane for the topic on screen; `go()` clears it, so any pick hands the
  column back to the PR. Never put agent talk inside the PR pane.
- The detail pane acts on the selected PR, the tile footer on the tile
  (2026-09-29). What each button says, whether it shows and which one leads
  come from core (`TileView.offers`: `footer`, `markLabel`, `github`,
  `leadPrKey`, and `pane[prKey]` with `scope`, `lead`, `approve`, `open`,
  `ask`, `markLabel`, `snooze`, `removeTeams`, `pendingWrite`). On a stack
  or set (`scope: 'pr'`) the mark button marks only that PR
  (`useActions().markPrRead`, own undo, toast without the Snooze offer) and
  Snooze is not in the pane. A done tile or PR offers Open on GitHub only.
  Don't pick a primary or decide a button's visibility in a component or
  in `lib/`; add it to core's offers. Approve's label and look
  (`approveButton`) stay display.
- "Remove <team>" (one item per `PaneOffers.removeTeams` entry via
  `removeTeamButtons` in `lib/team-request.ts`, in `PaneHousekeeping`'s ⋯
  menu) removes the team's review request, unsubscribes and marks the PR
  done. It asks once in the menu's panel and has no undo. Never the primary.
- "Not up to date" has one wording (`lib/staleness.ts`): "updating" while
  `useActions().syncing` or a catch-up writes (`glanceState` `writing`
  for a glance; `memoryUpdating` on the topic or PR for dossier and facts,
  since a glance-only refresh rewrites no memory), else "out of date".
  Never write "stale" or "Sync to refresh" in the UI. `MemoryLine` and
  `WhyPanel` take `updating` from their caller (topic or PR state via
  `updatingNow`); don't read `syncing` alone there.
  A stale glance shows `StaleVerdictBox` (grey, dashed) with the advice
  folded behind "Show old assessment".

## Styling: tokens + Tailwind utilities

- **Tokens live in `styles/tokens.css`** on `:root`: every color, radius,
  shadow and font. `styles/app.css` maps them onto Tailwind names in `@theme`
  (`bg-surface`, `text-muted`, `border-hairline`, `bg-unread-soft`,
  `rounded-tile`, `shadow-selected`, `font-mono`, …).
- **Small grey text**: `text-hint` (#666b79, at least 4.5:1 on white and
  the sidebar) for small text that says something (why-here lines,
  out-of-date notes, "Dossier v3", roles, fold labels, empty states, hover
  actions). `text-faint` (2.3-2.6:1) is decoration only: separators,
  chevrons, ages next to a louder line, done tiles.
- **Diff red**: `--diff-red` for deletions in the Size fact. Coral
  (`unread`) is never a diff or CI colour; the Checks fact is grey.
- **One colour per meaning** (2026-10-01, DESIGN.md "Colour per
  meaning"): `closer` only for the agent's Look closer; `status-bad` the
  one red for bad (closed, changes requested, risk, errors); `safe` the one
  good green (approved, Looks safe, Approve); merged purple also for
  queued; coral only for unread; honey only for aimed at you and your
  move; app-health warnings use `amber-*`.
- **Tailwind's default palette is switched off** (`--color-*: initial`). Only
  token colors exist as utilities. Need a new color? Add a token to
  `tokens.css` and a `--color-*` line to `@theme`, don't reach for hex in a
  component.
- **Utilities first, inline `style` only for render-time values** (e.g. the
  flex weights of the size and checks bars). Comment why when you do it.
- Hover, focus and selected states are utilities or props-driven class
  strings, never `onMouseEnter` handlers.
- Type sizes follow the mockup with arbitrary values (`text-[11.5px]`);
  spacing uses the scale where it is close enough. The root font size is
  13px, so `app.css` pins `--spacing`, `text-xs`, `text-lg` and the radius
  steps to px: `px-3` is 12px, `h-7` 28px, as the mockups read them.
- Edges on white chips, secondary buttons, rows and boxes are inset rings
  (`inset-ring inset-ring-edge-*`, tokens `--ring-*`), not borders: no layout
  shift, crisp on tints. `shadow-tile` carries a card's hairline ring. The
  tile is the exception: every tile frame is a 1px border (resting:
  `border-edge-hairline bg-clip-padding shadow-tile-lift`, the ring's look),
  so selection only changes colors and moves nothing.
- One-line labels that the mockups size by their text get
  `leading-[normal]`; the inherited 1.5 from preflight makes them taller.
- The detail pane keeps three keylines from its edge: boxes and rows at
  22px (pane padding), line starts at 34 (`px-3`), text after an icon at 62
  (icon centered in a 20px slot, 8px gap). Section labels use
  `SectionLabel`.
- Numbers, PR numbers, ids and ages use `font-mono` (JetBrains Mono, bundled
  in `styles/fonts/`, no network). UI text uses the system font.
- Plain CSS in `app.css` only for things Tailwind can't say well: the
  `.drag-region` for the title bar, base `html/body` rules, `.pane-scroll`.
- Every pane-level scroll area (sidebar, tile column, detail pane, chat,
  full-width panes) carries `pane-scroll`: it reserves the 10px scrollbar
  gutter at all times, so a pane does not jump sideways when its content
  starts or stops overflowing. Small inner lists (pickers, menus, diffs) do
  not need it.

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
  `DossierPanel`, `TopicRepo` on the owner line), `InboxPane`, `TileGrid`, `Tile`, `PrRow` (+ `AssignedTo`, also in `PrBody`), `NotificationsPane` (+ `NotificationRow`), `HandledQuietlyPane`,
  `DetailPane` (+ `DetailContext`, `PrBody` with `OpenOnGitHub`,
  `GlanceCard`, `ReviewRow`, `PaneHousekeeping`, `Composer`, `KeyFiles`,
  `PrDescription`, `PrFacts`, `ReviewList`, `NewSinceBox` (the digest
  under the title, "Reply ↓" jumps), `AgentFacts`, `ActivityTimeline`
  (every line, Reply and React on people's comments)), `AgentPane` (the
  topic's agent, in the detail pane's place),
  `StatusFooter` (+ `WritesLock`), `Toast`, `SearchField` (title bar filter),
  `ToolsNotice` (missing gh or claude, with `FixCommand`, shared with setup),
  `RepoScopeMenu` (title bar repo scope + "Let it go stale"),
  `InboxCleanupLine` (sidebar footer: "12 merged PRs · Clear", "Clearing
  84 / 191" while a run goes; next to merged PRs "✨ 8 of them look safe ·
  Clear", `safeMergedText`, which calls `clearSafeMerged` right away, no
  dialog, disabled while a cleanup waits in the lock) +
  `InboxStartDialog` (mounted once in App, opens while the server holds
  the start sync, `view.start`) + `InboxCleanupDialog` (both modes; picks
  set once from core `cleanupDialogSetup`; words in `lib/cleanup.ts`; Esc,
  Enter and a click outside follow the case; the illustration bobs only
  under `motion-safe:`). The footer shows the run's progress, and the
  done toast's "Show" opens the notifications view (`Toast` prop
  `onShowActionLog`),
  `UpdatePill` (title bar update reminder, self-contained so it can move;
  neutral, never coral; under 24h behind; "Update ready" once staged) +
  `UpdateNextStep` (the offer both share: ink "Restart to update", the
  download note, or the brew command `FixCommand`) + `UpdateBar` (full-width bar under
  the title bar from 24h behind, amber `--amber-*` tokens, never coral; mounted
  in `App.tsx`; Later drops back to the pill for 24h; `update_bar_shown` once per run),
  `InterruptionsMenu` (sidebar footer row after "Handled quietly": bell-off
  icon for Never, bell otherwise, the mode as a quiet word; opens a menu
  above it with the three modes as menuitemradio rows and "Send a test
  notification", disabled outside the desktop app; the bell means only
  interruptions, notification lists use `ListIcon`),
  `InterruptionsChoice` (the three mode cards with `InterruptionsArt`,
  shared by `SetupDayStep` and the prompt) + `InterruptionsPrompt` (mounted
  once in App: the one-time dialog for installs that never chose,
  `InterruptionsView.chosen` false, `showsInterruptionsPrompt` in
  `lib/interruptions.ts`; blocked while setup shows or its status loads,
  and while the inbox cleanup view loads or its start dialog is due; Save
  stores the pick, Esc and a click outside store the current mode, both
  through `setInterruptions(mode, 'prompt')`, and it hides at once),
  `McpFooterItem` ("agents: not connected" in the footer, only while
  `mcpFooterShows` in `lib/mcp.ts`; never while the state is unknown) +
  `McpConnectOffer` (the offer body, shared with `SetupAcceptStep`'s
  optional box; secondary button there so Accept stays the one primary).
- Shared kit: `Button` (variants primary, safe, secondary, move for the
  "Your move" footer, quiet for the pane's housekeeping; sizes sm, md, icon, icon-md), `Menu`, `Avatar`, `SectionLabel`, `pills.tsx` (verdict, `UnreadDot`
  (the coral dot before a PR number and on a topic, core `TileView.unreadPrKeys`), `ForWhomChip`,
  `StateWordLabel`, `StackMark`: the "1/3" layers tag, place from
  `stackPlaces` in `lib/stacks.ts` over `tile.stacks`), `icons.tsx` (`Glyph` event set, `PrStateIcon`), `TurnLine`, and for memory `MemoryLine` (text, source chips,
  stale / marked-wrong / fixed badge, Why? / Recheck / Forget on hover),
  `MemoryButton` ("Forget"), `RecheckDialog`,
  `SourceChip`, `WhyPanel` + `MemorySourceRow` ("Why?"), `DiffView`,
  `InstructionsProposalCard` (the agent pane, the instructions view and under a
  lesson; `onDone(accepted)`),
  `LessonCard` (one lesson: "Remember for future assessments?", the line,
  `lessonSource` / `earlierAssessmentText` from `lib/lessons.ts`, then
  Remember in this topic / Use across topics… / Dismiss; neutral grey, never
  coral, honey or accent), used by `TopicLessons` (under the topic header's
  "You told the agent" line, renders nothing without open lessons) and
  `TeachLesson` ("Teach future assessments" under the verdict explanation in
  `GlanceCard`, only with a glance; keyed by PR; hides its lesson once it
  left the topic's open list),
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
- PR state: `PrStateIcon` with core's `PrStatus.icon` (open green pull
  request, draft dashed grey circle, merged purple, closed red, the filled
  Octicons merge-queue icon in `--pending` amber while queued and red once
  the queue took it out; the word from `ICON_WORDS` as its title). A queued
  PR's row shows `mergeQueueWord` ("Merge queue: Testing") in place of the
  review word, and so do the open layers below a queued layer of the same
  stack (`stackQueueWord`, "Merge queue: with 3/3"): the top branch holds
  their commits, so they merge with it. Review state: `StateWordLabel` with a
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

- For whom: `ForWhomChip` ("For you" honey, "For team-devex" sea, "For
  approvers" neutral for a routing team, "Your PR" neutral, nothing else)
  from `TileView.forWhom` / `PrSummary.forWhom`, plus a 3px left band on
  the tile in the same color (`BANDS` in `Tile.tsx`; a routing team gets
  no band, sea means your team); PR rows get the small chip, no band. The tooltip keeps the
  long why-here reason (`whyTitle`). Grey on done tiles.
- Why now: `UnreadStrip`, warm strip, actor avatar with an ink event
  badge (`Glyph`), a coral "NEW" pill (only while `TileView.newBadge`), age. On a revisit (`PrSummary.whatsNew`
  of the strip's PR, `stripNews`) the text, avatar, badge, "+N" and age
  come from core's `whatsNew`, worded by `whatsNewText` in
  `lib/whats-new.ts`; never add a second line or change the strip's size. Only tiles in the Unread group have the
  warm strip; an open tile with an unseen merge without the user's review
  (`TileState.unseenMerges`) gets the same-sized grey `UnseenMergeStrip`,
  no NEW pill; read tiles get a quieter (ink-2) title, Dealt with and draft tiles a
  muted one. Drafts (core's `TileView.draft`, `isDraftTile`): grey "Draft"
  chip and a dashed frame or dashed left band.
- PR status (design 3a, 2026-09-29): `PrStateIcon` at the start of the row,
  `StateWordLabel` on the right ("Needs review", "Approved", "Changes
  requested", DRAFT chip, "Merged", "Closed"), open threads after it. The
  state keeps its color on done tiles; title and counts go grey. When only
  agents approved (`PrStatus.agentApprovers`) the word reads "Approved by
  agent", names in the tooltip; the detail uses `PrDetail.agentApprovers`
  with `approvedText` in `lib/pr.ts`. **No CI on rows, tiles, the detail
  state line, the RISK box or the your-move chip**: checks only show in
  `PrFacts` (DESIGN.md "CI is not a signal"; `PrStatus` has no checks).
- PR rows: a single-PR tile's row has no title (`PrRow` `showTitle`
  false; the heading is the title). The author's avatar is who opened it
  (`PrSummary.author`, a bot for agent PRs); when someone else is assigned,
  `AssignedTo` follows ("assigned to" + faces, two then "+N", from
  `assigneeLine` in `lib/assignees.ts`), and `PrBody` says "opened by ·
  assigned to" under the branch line. Whose PR it is for rules is core's
  (`authorRelation`, `facts.owners`: "Ask <owner>"), never decided here.
  Every PR in core's `TileView.unreadPrKeys` (what makes the tile unread: a
  thread unread on GitHub, a pulled-in layer's loud news, an unseen Look
  closer event) gets `UnreadDot` ("Unread") before its number, on the tile
  (single-PR tiles too) and in `DetailContext`'s list. A topic with unread
  PRs gets it too, and its bubble counts `TopicListItem.unreadTiles` (counts are tiles, dots are per PR; the footer's number too). The renderer only reads the
  field. `DetailContext` shows kind, title, "PR x of n"
  and the arrows only for several PRs; one PR is just "PR".
- Source chips repeat once per block (`blockRefs` in `lib/memory.ts`):
  pass its result as `MemoryLine` `refs` in lists.
- Whose turn: `TurnLine` in the tile footer; the footer turns warm for
  "Your move".
- Coral (`unread`) means "new since you looked" and nothing else on a tile,
  with one exception: the unread dot on PR rows and topics (DESIGN.md "Actions act
  on what you look at": one dot, no second read-only one).
  Primary buttons are ink, except Approve: `Button` variant `safe` (`--safe`
  green, `--elev-safe`), the color of the "Approved" state it produces
  (2026-09-30). Accent blue is for selection and focus only.

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
`SetupRepoChoices`), `SetupDayStep` ("Your day": `InterruptionsChoice`, three `aria-pressed`
cards for never / batches / asap with `InterruptionsArt`, small animated
illustrations on the `interrupt-*` keyframes in `app.css`, only under
`motion-safe:`; words in `lib/interruptions.ts`; the pick lives in
`SetupFlow`, preselected from `useInterruptions`, Never while it loads),
`SetupAcceptStep`, with `SetupSteps` (worded step
chips) and `SetupChip` (OK / Fix this / Working ...). The step lives in
`App` so the sidebar can name it; the draft, edits and picks live in
`SetupFlow`. Pure helpers in `lib/setup.ts`, including `draftText`, a copy
of core's `formatInstructionsSections`: keep them in step. The repo picks
are a `SetupPicks` (`picksFromDraft`: suggested quiet repos on, main repo
"All repos"; `toggleQuiet` records touched toggles; `picksAfterRefine`
keeps them and the main repo on a refine).

## Selection

Sidebar faces (`FaceStack` in `TopicSidebar`): `TopicListItem.people` is
PR authors only (core `topicFaces`); `teamPill` (`lib/faces.ts`) splits
them into the team pill (you and teammates: sea tint, `inset-ring-sea-ring`,
`PeopleIcon` first, avatars overlapping, tooltip "You and your team: …")
and the other authors after it, overlapping the same way.

The sidebar lists topics in sections (`lib/queues.ts`, `sidebarBuckets`,
order typed with core's `TopicSectionOrder`; DESIGN.md "Ownership
sections"): Needs reply, Changes you requested, To review, Team mentioned,
You drive, Your team owns, Other work, then Other topics. Each topic sits
once, in the section core gives it (`TopicListItem.section`,
`topicSection`), in core's order; the topic header's breadcrumb reads the
same field on `TopicDetail` and the same label and dot
(`lib/sections.ts`). `lib/sidebar.ts` holds the folds: Other work's area
folds (`areaFolds`, "More" for single-topic areas), their default
(`startsOpen`: your PR, move or unread), the rows a folded fold keeps
(`rowsWhileFolded`, urgent unread) and its header summary; the selected topic counts like an urgent row (a fold holding it stays open, a folded one keeps its row); Other topics
splits into unplaced rows ("not sorted yet" without a dossier) and the FYI
fold. The queue filters still match a topic by any PR. Fold choices are
local UI state for the session; FYI and the Archive start folded.
Dealt-with topics (core `quiet`) leave You drive, Your team owns and Other
work (DESIGN.md "Dealt-with topics leave the list"): `sidebarBuckets(items,
hideDealt)` puts them in a `dealt:<section>` bucket after their section
(`dealtItems`), so `useHeldPlace` keeps a selected row that turns quiet or
gets news; `DealtLine` ("+ N dealt with", `dealtLineLabel`, fold key
`dealtKey`) opens them, folded it keeps only the selected one
(`rowsWhileFolded`), `allDealtNote` marks an all-dealt header, and Other
work's default is `otherWorkStartsOpen`. `hideDealt` is off while the
search or a queue filter narrows. The Archive drawer (retired topics, `useFinishedTopics`) hides while search
or a queue filter narrows; a finished topic is not in `useTopics`, so
`App` opens it by id (`pickedFinishedId`) instead of through `visibleTopic`. The "Topics with
any PR | my PRs | team PRs" switch (`QueueFilters`) is plain UI state in
`App.tsx`, not a history entry; it narrows together with the search, and
`App` passes how many topics it hides for the "N topics … hidden · Show
all" line. Relation
corrections go through `correctMemory` with `relation` set
(`RelationLine`), local only. `TileGrid` shows three groups by
`TileView.group`, always Unread, Open, Dealt with (`gridGroups` in
`lib/queues.ts`, order typed with core's `TileGroupOrder`), tier order
inside, snoozed last; empty groups don't render. Dealt with is folded
until opened, then as the user last clicked it (`dealtWithOpen` in `App`,
kept for the session; search or a selection never changes it), and opens
while the search filters or one of its tiles is selected. No All / Unread
toggle (removed 2026-09-30). Queue filters pick topics; tiles inside a topic are never faded by them.
A click anywhere on a tile selects it (`onTileClick` in `Tile.tsx`), except
on a control inside it (button, link, menu: `clickedControl`), which keeps
its own action; a PR row selects that PR. The keyboard path is the title,
a `<button>`. A click on the already selected tile keeps the open PR.
Tiles stay in one column (DESIGN.md "Three-pane balance"). The selected
tile keeps the place it had when it was selected, in its group (`useHeldPlace` over
`holdPlace`, `lib/hold-place.ts`), and the open topic's sidebar row too,
until the selection moves; its look still changes right away.

`App.tsx` holds the picked topic, which middle pane shows (topic, Inbox,
"Your instructions", the notifications debug list and "Handled quietly",
which both also take the detail pane's column), and the picked
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
  notification-click listeners and `sendTestNotification` ("Send a test
  notification" in the sidebar's Interruptions menu, through
  `useActions().sendTestNotification`). The welcome notification
  (`main/welcome.ts`, flag in userData) comes only once the user picks
  batches or asap, never on a plain first launch. The Dock badge is main's
  (`BoardWatcher` over the engine's `pingBadge`); the renderer only sends
  `tileVisited`. As a plain web page the
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
  `last_sync_report` and shows in the footer's "last full sync" and the
  title bar's sync status tooltips (`lib/sync-report.ts`) and in the notifications
  debug pane. Title bar elements with a `title` are no-drag, so tooltips work.
- The title bar's sync status headline follows the live poll
  (`useLiveStatus`, `lib/live.ts` `pollIsFresh`): "up to date" while it
  keeps up, an age only once it fell behind or is off. Don't put the full
  sync's age back in the headline: it reads as stale data while the poll
  runs.
- Sync runs once on app start, on "Sync now", and every
  `AppConfig.autoSyncMinutes` (default 60) in the background (the engine's
  `AutoSyncSchedule`, started by main). `POSTPILE_SYNC_ON_START=0`
  (`AppConfig.syncOnStart`) skips the start sync. `useActions().syncing` is
  true for any running sync (`LivePollStatus.syncRunning`), so the title bar
  shows background syncs too; `lastSync` is the newer of this window's and
  the stored report (`newerReport`). The main process
  runs the live poll (`engine.startLivePoll`) and shows Mac notifications
  (`main/mac-notifier.ts`); closing the window hides it on macOS, Cmd+Q quits.
