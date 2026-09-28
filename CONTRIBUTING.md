# Contributing

Thanks for looking. PostPile is an alpha maintained by PostHog's DevEx team, and it is shaped by one daily user's workflow first. Issues and small PRs are welcome; for anything bigger, open an issue first so the direction can be agreed before code is written.

Read [AGENTS.md](AGENTS.md) before you change anything. It holds the rules for this repo, for people and coding agents alike: what the app is for, the decided and rejected directions, how to keep GitHub and your own database safe while developing, and the git conventions. The spec is [DESIGN.md](DESIGN.md), the status and open decisions are in [NEXT.md](NEXT.md).

The short version:

- Node 24 and pnpm. `pnpm install`, then `pnpm typecheck` and `pnpm test` must be green before every commit.
- Build and check UI on sample data: `POSTPILE_FAKE=1` (see the README).
- Develop with `POSTPILE_READ_ONLY=1`, `POSTPILE_SYNC_ON_START=0` and `POSTPILE_MAX_AGENT_CALLS=0` unless the change needs real calls. Never mark things read on GitHub from a dev session.
- Pure logic goes in `packages/core`, with tests. Boring, readable code over clever code.
- Conventional commits (`feat:`, `fix:`, `docs:`, ...) with a body that says why.
- Update DESIGN.md when a rule changes, NEXT.md for status, and CHANGELOG.md for anything a user would notice.
- Don't commit real data: no real PR text from private repos, no personal paths, no tokens. Tests and sample data use invented names (`acme/app`, `alice`, `bob`).

Security issues go to security-reports@posthog.com, see [SECURITY.md](SECURITY.md).
