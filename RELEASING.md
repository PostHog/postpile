# Releasing

How a PostPile release goes out: a `v*` tag builds the app on GitHub Actions, attaches the zip to a GitHub release, and renders the Homebrew cask into [PostHog/homebrew-tap](https://github.com/PostHog/homebrew-tap).

## Repo setup

Done once, on 2026-09-28, when the repo went public. Kept here so a new repo or a rotated key can be set up the same way.

- **History.** The private history was rewritten with `git filter-repo --replace-text` (personal paths, private repo names, real people) and re-signed. All commits and their dates were kept.
- **Repo.** `PostHog/postpile`, public, default branch `main`. The description says "Internal DevEx tool" so the repo does not read like a new PostHog product.
- **Homebrew tap token.** The PostHog GitHub App behind `GH_APP_HOMEBREW_TAP_RELEASER_*` already writes to the tap for phrocs and other PostHog tools. Its secrets are environment secrets per repo, not org secrets, so every repo that publishes to the tap needs its own copy:
  - Repo settings › Environments: `homebrew-tap`, with a deployment tag rule `v*` (no branches), so only release tags can use the token.
  - In that environment, `GH_APP_HOMEBREW_TAP_RELEASER_APP_ID` holds the app's numeric App ID (from the app's settings page), and `GH_APP_HOMEBREW_TAP_RELEASER_PRIVATE_KEY` holds the app's private key. The key is in 1Password as `releaser-homebrew-tap.<date>.private-key`:

    ```
    op document get <item id> | gh secret set GH_APP_HOMEBREW_TAP_RELEASER_PRIVATE_KEY -R PostHog/postpile --env homebrew-tap
    gh secret set GH_APP_HOMEBREW_TAP_RELEASER_APP_ID -R PostHog/postpile --env homebrew-tap --body <app id>
    ```

  - The app needs no change. The token is scoped to `PostHog/homebrew-tap`.
- **Still open:** a ruleset on `main` that requires the CI `check` job, and secret scanning plus Dependabot alerts under Security.

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
