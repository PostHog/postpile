# desktop renderer: rules that are easy to undo by accident

Read these before editing anything under `src/renderer/src/`. The visual
reference is the "Crisp native, refined" mockup (StyleCrispPro); the layout
is still open, so keep components small and cheap to move.

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
with a `title` that says why, like "Your instructions" and "Handled quietly"
in the sidebar. Hiding it makes the gap invisible to the next agent.

## Data: typed query hooks, types from core

- One file per resource in `api/`: `topics.ts` (`useTopics`, `useTopic`),
  `pr.ts` (`usePr`), `chat.ts` (`useChat`), `config.ts` (`useAppConfig`).
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
  Mark-read results carry an undo token; the toast offers Undo for the 6s
  window and the footer counts pending mark-reads.
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
  `TitleBar`, `TopicSidebar`, `TopicHeader`, `TileGrid`, `Tile`, `PrRow`,
  `DetailPane` (+ `DetailContext`, `GlanceCard`, `PrFacts`, `ReviewList`,
  `ActivityTimeline`, `ActionBar`, `AskComposer`, `TileChat`), `StatusFooter`,
  `Toast`.
- Shared kit: `Button`, `Menu`, `Avatar`, `pills.tsx` (verdict, provenance,
  PR state), `icons.tsx`. Something used in three places goes here; two call
  sites can stay duplicated.
- Don't extract a component that has more props than JSX children.
- Order functions so they are defined before they are used.

## Selection

`App.tsx` holds the picked topic and the picked tile + PR. Everything else is
derived on render (`resolveSelection`): a missing pick falls back to the first
topic, its first tile and that tile's lead PR. Don't mirror server data into
`useState`.

## Electron shell

- `titleBarStyle: 'hiddenInset'`: the renderer draws the 52px title bar and
  keeps 88px free on the left for the traffic lights. Interactive elements in
  the bar must stay clickable (`.drag-region` sets them to no-drag).
- The preload hands over only the API URL and token. As a plain web page the
  renderer takes `?api=…&token=…` instead.
- Sync runs once on app start and then only on "Sync now".
