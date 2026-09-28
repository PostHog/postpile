# desktop renderer: rules that are easy to undo by accident

Read these before editing anything under `src/renderer/src/`. The visual
reference is the "Crisp native, refined" mockup (StyleCrispPro) with the
"Warm reach" tile look on top (see "Tile look" below); the layout is still
open, so keep components small and cheap to move.

## No fictional data

The renderer shows what the local API returned and nothing else.

- **Sample data lives in one place: `FakeEngine`** (apps/server), switched on
  with `CODE_MANAGER_FAKE=1`. The renderer never has its own fixtures and never
  has a `fake ? sample : real` branch. The title bar shows a "Sample data" pill
  when `/api/config` says `fake: true`; that is the only difference.
- **Don't fill empty screens.** No topics, no tiles, no glance, no reviews:
  render the empty state ("No topics yet…", "No glance yet…"), never
  placeholder people, counts or repo names.
- **Don't hardcode account-shaped values** (repo, viewer login, PR counts,
  model names). If the UI needs one, add it to the API first.

## Disabled, not hidden

When something is not wired yet (no endpoint, no data), render it `disabled`
with a `title` that says why, like "Handled quietly" in the sidebar. Hiding it makes the gap invisible to the next agent.

## Data: typed query hooks, types from core

- One file per resource in `api/`: `topics.ts` (`useTopics`, `useTopic`),
  `pr.ts` (`usePr`), `chat.ts` (`useChat`), `config.ts` (`useAppConfig`),
  `proposals.ts` (`useProposals`, the Inbox), `search.ts` (`useSearch`,
  debounced title bar filter), `instructions.ts`
  (`useInstructions`, `useInstructionsChat`), `sources.ts`
  (`useMemorySources`, only enabled while a "Why?" panel is open), `debug.ts`
  (`useDebugNotifications`, the notifications debug pane), `live.ts`
  (`useLivePoll`: the fast poll status every 5s; called once in App, it
  refetches everything else when a poll cycle stored news).
  Each hook wraps `useQuery` with a key from `api/keys.ts`.
- Wire types come from `@code-manager/core` as `import type` only. The
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
  `lib/guard.ts`. They are blocked, with a clear toast, unless the server says
  `writesAllowed` (`CODE_MANAGER_ALLOW_WRITES=1`, or fake mode where nothing
  reaches GitHub). Writes are also blocked until the config has loaded. Don't
  bypass the guard, and put a new GitHub-writing action on the `GithubWrite`
  list.
- Buttons for guarded actions carry the blocked reason as their `title`.
- After an action the provider invalidates every query except the config.
  Mark-read and memory correction results carry an undo token; the toast
  offers Undo for the 6s window and the footer counts pending mark-reads
  (tokens starting with `memory:` are not mark-reads).
- Memory lines get "Recheck" (and "Forget" on a care). Recheck opens
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
- Approve is final (GitHub has no un-approve). Keep it a deliberate click in
  the detail pane, next to the glance.

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

## Components: small files, extract for behavior

- One component per file in `components/`, named like the UI part:
  `TitleBar`, `TopicSidebar`, `TopicHeader` (+ `SinceLastLooked`,
  `DossierPanel`), `InboxPane`, `TileGrid`, `Tile`, `PrRow`, `NotificationsPane` (+ `NotificationRow`),
  `DetailPane` (+ `DetailContext`, `GlanceCard`, `PrFacts`, `ReviewList`,
  `AgentFacts`, `ActivityTimeline`, `ActionBar`, `AskComposer`, `TileChat`),
  `StatusFooter`, `Toast`, `SearchField` (title bar filter).
- Shared kit: `Button`, `Menu`, `Avatar`, `pills.tsx` (verdict, `WhyBadge`,
  `StatusPill`), `icons.tsx` (`Glyph` event set), `TurnLine`, and for memory `MemoryLine` (text, source chips,
  stale / marked-wrong / fixed badge, Why? / Recheck / Forget on hover),
  `MemoryButton` ("Forget"), `RecheckDialog`,
  `SourceChip`, `WhyPanel` + `MemorySourceRow` ("Why?"), `DiffView`,
  `InstructionsProposalCard` (tile chat and the instructions view),
  `WorkContextSection` (instructions pane only),
  `RelationBadge` (in `pills.tsx`).
  Something used in three places goes here; two call
  sites can stay duplicated.
- Don't extract a component that has more props than JSX children.
- Order functions so they are defined before they are used.

## Tile look ("Warm reach")

Four spots per tile, all derived in core and shipped on `TileView` /
`PrSummary` (DESIGN.md "Tile faces"); the renderer only picks labels and
tints (`lib/why.ts`, `lib/events.ts`, `statusParts` in `lib/pr.ts`).

- Why it's here: `WhyBadge`, mono code, honey = you, sea = your team,
  neutral = yours, quiet grey = passive, dashed = stack context, grey on
  done tiles.
- Why now: `UnreadStrip`, warm strip, actor avatar with an ink event
  badge (`Glyph`), coral dot, age.
- PR status: `StatusPill`, one segment pill; open threads after it. Both
  go grey on done tiles, like the why badge.
- Whose turn: `TurnLine` in the tile footer; the footer turns warm for
  "Your move".
- Coral (`unread`) means "new since you looked" and nothing else on a tile.
  Primary buttons are ink; accent blue is for selection and focus only.

## Selection

The sidebar groups topics with `lib/sidebar.ts` (`sidebarGroups`): Needs you,
Your team by area, Routed to you, FYI. Fold state is local UI state; Routed
and FYI start folded. Relation corrections go through `correctMemory` with
`relation` set (`RelationLine`), local only. `TileGrid` shows live tiles and
folds snoozed / done ones. Tiles stay in one column (DESIGN.md "Three-pane
balance"); sidebar rows show the dossier summary and a "your move" chip.

`App.tsx` holds the picked topic, which middle pane shows (topic, Inbox,
"Your instructions", the notifications debug list, which also takes the
detail pane's column), and the picked
tile + PR. Everything else is
derived on render (`resolveSelection`): a missing pick falls back to the first
topic, its first tile and that tile's lead PR. Don't mirror server data into
`useState`.

The picks live in a back / forward history (`lib/history.ts`, hook in
`lib/use-nav-history.ts`): every user pick goes through `go()` in `App.tsx`,
which pushes an entry unless it shows what is already on screen. Cmd+[ / ],
the mouse side buttons and the trackpad swipe (main process 'swipe' -> preload
`onSwipe`) move through it. A click on a Mac notification arrives as preload
`onOpenPing` and goes through `go()` too. Anything new that navigates should
call `go()`.

The title bar search filters, it has no result list: `GET /api/search`
(matcher `searchTopics` in core) returns matching topics and tiles, the
sidebar and tile grid hide the rest (`lib/search.ts`). When the filter hides
the picked topic, the first match shows instead; that is derived, not a
history entry, and clearing the filter brings the pick back.

## Electron shell

- `titleBarStyle: 'hiddenInset'`: the renderer draws the 52px title bar and
  keeps 88px free on the left for the traffic lights. Interactive elements in
  the bar must stay clickable (`.drag-region` sets them to no-drag).
- The preload hands over only the API URL and token, plus the swipe and
  notification-click listeners. As a plain web page the
  renderer takes `?api=…&token=…` instead.
- Sync runs once on app start and then only on "Sync now". The main process
  runs the live poll (`engine.startLivePoll`) and shows Mac notifications
  (`main/mac-notifier.ts`); closing the window hides it on macOS, Cmd+Q quits.
