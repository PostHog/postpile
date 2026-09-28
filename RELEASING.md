# Releasing

How a PostPile release goes out: a `v*` tag builds the app on GitHub Actions, attaches the zip to a GitHub release, and renders the Homebrew cask into [PostHog/homebrew-tap](https://github.com/PostHog/homebrew-tap).

The first part is one-time setup for the public repo. The second part is the checklist for every release.

## One-time setup (first public push)

1. **Decide the history.** The private history has personal paths, a private repo's PR numbers and similar breadcrumbs in old commits and messages (nothing secret). The recommendation is one fresh squashed commit for the first public push:

   ```
   git checkout --orphan public-main main
   git commit -m "feat: PostPile 0.1.0-alpha.0"   # the tree of main as one commit
   ```

   Keep the private history in the old local repo (or a private archive repo). To keep history instead, run `git filter-repo --replace-text` over it first; the audit notes list what to replace.

2. **Create the repo** `PostHog/postpile`, public, default branch `main`, no template files (the repo already has README, LICENSE, SECURITY.md). Description: "Internal DevEx tool: a macOS app that turns GitHub PR notifications into a short list of what needs you". The "internal" word keeps it from reading like a new PostHog product.

3. **Push:**

   ```
   git remote add origin git@github.com:PostHog/postpile.git
   git push -u origin public-main:main     # or main:main when keeping history
   ```

4. **Repo settings:**
   - Branch protection or a ruleset on `main`: require the `check` job from CI and a PR.
   - Actions › General: allow the actions the workflows use (pinned by SHA: `actions/*`, `pnpm/action-setup`, `planetscale/ghcommit-action`), if the org restricts actions.
   - Security: turn on secret scanning and Dependabot alerts.

5. **Homebrew tap token.** The org-level GitHub App `GH_APP_HOMEBREW_TAP_RELEASER` already writes to the tap for phrocs and other PostHog tools.
   - Org settings › Secrets and variables › Actions: add `PostHog/postpile` to the selected repositories of `GH_APP_HOMEBREW_TAP_RELEASER_APP_ID` and `GH_APP_HOMEBREW_TAP_RELEASER_PRIVATE_KEY`.
   - Repo settings › Environments: create `homebrew-tap`, with a deployment tag rule `v*` (no branches), so only release tags can use the token.
   - The app needs no change; the token is scoped to `PostHog/homebrew-tap`.

6. **Tap README.** Open a PR on PostHog/homebrew-tap that lists the `postpile` cask (a drafted patch exists from the release prep). The tap has no `Casks/` folder yet; the first release workflow run creates `Casks/postpile.rb`.

## Every release

1. **Pick the version.** Pre-releases are `0.1.0-alpha.N`, `0.1.0-beta.N`; then `0.1.0`.

2. **Bump it everywhere.** Every `package.json` (root and workspaces) carries the same version; a test fails when they drift. For example:

   ```
   pnpm -r exec npm pkg set version=0.1.0-alpha.1 && npm pkg set version=0.1.0-alpha.1
   ```

3. **Changelog.** Rename `## <version> (unreleased)` to `## <version>` in `CHANGELOG.md`. The release workflow takes this section as the release notes.

4. **Check locally:** `pnpm typecheck`, `pnpm test`, `pnpm dist`. Commit through a PR and merge to `main`.

5. **Tag and push** from the merged `main`:

   ```
   git tag -a v0.1.0-alpha.0 -m "PostPile 0.1.0-alpha.0"
   git push origin v0.1.0-alpha.0
   ```

   If the Release workflow does not start (a tag ruleset bypass does not fire the push trigger), run it by hand: Actions › Release › Run workflow, with the tag.

6. **What the workflow does** (`.github/workflows/release.yml`):
   - `build` on `macos-14` (arm64): checks the tag equals `v` + `apps/desktop/package.json` version, installs with the frozen lockfile, typechecks, tests, runs `pnpm dist`, verifies the signature (`codesign --verify --deep --strict`), the bundle id (`com.posthog.postpile`) and the version in `Info.plist`, then creates the GitHub release with `PostPile-<version>-mac-arm64.zip` and `PostPile-<version>-mac-arm64.zip.sha256`. Versions with a `-` become pre-releases.
   - `publish-homebrew` on ubuntu, in the `homebrew-tap` environment: renders `homebrew/postpile.rb.tmpl` with the version and sha256, mints a tap token from the GitHub App, and commits `Casks/postpile.rb` to PostHog/homebrew-tap `main`.

7. **Verify:**
   - The GitHub release has the zip and the `.sha256`, marked pre-release for an alpha, with the changelog notes.
   - `shasum -a 256 -c PostPile-<version>-mac-arm64.zip.sha256` passes on the downloaded zip.
   - PostHog/homebrew-tap has a commit "chore: update postpile cask to <version>" with the right version and sha256.
   - On a Mac: `brew update && brew install --cask posthog/tap/postpile` (or `brew upgrade --cask postpile`), clear the quarantine flag as the caveats say, open the app. About PostPile shows the version, the status bar shows it too.
   - `brew audit --cask --tap posthog/tap postpile` has no errors worth fixing in the template.

## Notes

- The app is ad-hoc signed, not notarized. Gatekeeper blocks the first open until the quarantine flag is cleared or the user clicks Open Anyway. Notarization needs an Apple Developer ID certificate and account in CI; it is not set up.
- The bundle id changed from `com.postpile.app` to `com.posthog.postpile` in 0.1.0-alpha.0. macOS asks for notification permission again on the first launch of the new id. Data in `~/Library/Application Support/PostPile` is unaffected.
- Local builds never publish: the desktop `dist` script passes `--publish never` to electron-builder.
