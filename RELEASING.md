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
- **Signing environment.** Repo settings › Environments: `desktop-signing`, with a deployment tag rule `v*` (no branches). It holds the Apple secrets, see [Signing and notarization](#signing-and-notarization). Until it has them, releases go out ad-hoc signed.
- **Still open:** a ruleset on `main` that requires the CI `check` job, and secret scanning plus Dependabot alerts under Security.

## Every release

1. **Pick the version.** Every release counts the minor up: `0.2.0`, `0.3.0`, … A quick fix on top of a release bumps the patch: `0.2.1`. No `-alpha` suffix (decided 2026-09-29, after `0.1.0-alpha.0`); the app is alpha in words only (README, release notes). A version without a `-` is not marked pre-release on GitHub, which is fine.

2. **Bump it everywhere.** Every `package.json` (root and workspaces) carries the same version; a test fails when they drift. For example:

   ```
   pnpm -r exec npm pkg set version=0.2.0 && npm pkg set version=0.2.0
   ```

3. **Changelog.** Rename `## <version> (unreleased)` to `## <version>` in `CHANGELOG.md`. The release workflow takes this section as the release notes.

4. **Check locally:** `pnpm typecheck`, `pnpm test`, `pnpm dist`. Commit through a PR and merge to `main`.

5. **Tag and push** from the merged `main`:

   ```
   git tag -a v0.2.0 -m "PostPile 0.2.0"
   git push origin v0.2.0
   ```

   If the Release workflow does not start (a tag ruleset bypass does not fire the push trigger), run it by hand: Actions › Release › Run workflow, with the tag. Pick the tag under "Use workflow from" as well: the `desktop-signing` and `homebrew-tap` environments only admit `v*` refs, and GitHub rejects a run from `main` there.

6. **What the workflow does** (`.github/workflows/release.yml`):
   - `build` on `macos-14` (arm64), in the `desktop-signing` environment: checks the tag equals `v` + `apps/desktop/package.json` version, installs with the frozen lockfile, typechecks, tests, builds the app (Developer ID signed and notarized when the Apple secrets are there, else ad-hoc, see below), verifies the signature (`codesign --verify --deep --strict`), the bundle id (`com.posthog.postpile`) and the version in `Info.plist`, then creates the GitHub release with `PostPile-<version>-mac-arm64.zip` and `PostPile-<version>-mac-arm64.zip.sha256`. Versions with a `-` become pre-releases.
   - `publish-homebrew` on ubuntu, in the `homebrew-tap` environment: renders `homebrew/postpile.rb.tmpl` with the version, the sha256 and the right caveats (signed or ad-hoc), mints a tap token from the GitHub App, and commits `Casks/postpile.rb` to PostHog/homebrew-tap `main`.

7. **Verify:**
   - The GitHub release has the zip and the `.sha256`, with the changelog notes. It is marked pre-release only for a version with a `-` (like the old `0.1.0-alpha.0`).
   - `shasum -a 256 -c PostPile-<version>-mac-arm64.zip.sha256` passes on the downloaded zip.
   - PostHog/homebrew-tap has a commit "chore: update postpile cask to <version>" with the right version and sha256.
   - The build log says which way the app was signed: a "building an ad-hoc signed, not notarized release" warning, or a green "Verify signing and notarization" step.
   - On a Mac: `brew update && brew install --cask posthog/tap/postpile` (or `brew upgrade --cask postpile`), open the app (for an ad-hoc release, clear the quarantine flag first as the caveats say). About PostPile shows the version, the status bar shows it too.
   - `brew audit --cask --tap posthog/tap postpile` has no errors worth fixing in the template.

## Signing and notarization

Why: an ad-hoc signed app has no stable identity. Gatekeeper blocks its first open (users need `xattr` or Open Anyway), and every build counts as a new app for macOS privacy permissions (TCC), so grants are forgotten and asked for again after each update. A Developer ID signature fixes both; notarization lets Gatekeeper open the app without asking.

What the workflow does, mirroring PostHog/posthog's `desktop-release.yml` for the PostHog desktop app:

- The `build` job runs in the `desktop-signing` environment. A "Check signing secrets" step looks at the certificate:
  - Not set: a `::warning::` and an ad-hoc build with plain `pnpm dist`. The release still goes out, with the xattr caveat in the cask.
  - Set, but anything else missing: the job fails. A signed app that is not notarized would still be blocked by Gatekeeper.
- Signed build: `pnpm build`, then electron-builder with `electron-builder.yml` plus command-line overrides: `mac.identity` = the team ID (picks the "Developer ID Application: … (<team id>)" certificate), `mac.hardenedRuntime=true`, `mac.notarize=true` and `forceCodeSigning=true`. `electron-builder.yml` stays ad-hoc so local `pnpm dist` works without a certificate.
  - electron-builder imports the base64 `.p12` from `CSC_LINK` into a temporary keychain, so there is no keychain step.
  - Entitlements: `apps/desktop/build/entitlements.mac.plist` (JIT, unsigned executable memory, no library validation; the same as PostHog's desktop app minus the microphone), for the app and its helpers.
  - Notarization: notarytool with the Apple ID and app-specific password, then the ticket is stapled to the app before the zip is made.
- "Verify signing and notarization" unzips the release zip and checks both that app and the one in `dist/`: `codesign --verify --deep --strict`, a Developer ID authority, the hardened runtime flag, `spctl --assess --type execute -vv` and `xcrun stapler validate`.
- The cask drops the ad-hoc caveat block (xattr / Open Anyway) for a signed build.

The `desktop-signing` environment (deployment tag rule `v*`) needs:

| Name | Kind | What |
| --- | --- | --- |
| `APPLE_CODESIGN_CERT_BASE64` | secret | Developer ID Application certificate with its key, `.p12`, base64 (passed as `CSC_LINK`) |
| `APPLE_CODESIGN_CERT_PASSWORD` | secret | Password of the `.p12` (passed as `CSC_KEY_PASSWORD`) |
| `APPLE_APP_SPECIFIC_PASSWORD` | secret | App-specific password of the Apple ID used for notarization |
| `APPLE_ID` | variable or secret | That Apple ID |
| `APPLE_TEAM_ID` | variable or secret | PostHog's Apple team ID |

The workflow reads `vars.X || secrets.X` for the last two, so either kind works, and org secrets shared with the repo work too.

How to get access: PostHog already has these for its desktop app, as `APPLE_*` org secrets managed in PostHog's infrastructure code. Ask the infra team; both ways need approval from the desktop app owners and security:

- Share the five org secrets above with this repo. Simple, but org secrets shared this way are readable by any workflow in the repo, not gated by the environment and its tag rule.
- Or copy the values into the `desktop-signing` environment of PostHog/postpile (`gh secret set <name> -R PostHog/postpile --env desktop-signing`). Only `v*` tag runs can read them then; the copies have to be updated by hand when the certificate or password rotates.

## Notes

- Releases are Developer ID signed and notarized since 0.2.0 (the first one, 2026-09-29). Without the Apple secrets the workflow falls back to ad-hoc: Gatekeeper then blocks the first open until the quarantine flag is cleared or the user clicks Open Anyway, and macOS forgets privacy grants on every update. See [Signing and notarization](#signing-and-notarization).
- The bundle id changed from `com.postpile.app` to `com.posthog.postpile` in 0.1.0-alpha.0. macOS asks for notification permission again on the first launch of the new id. Data in `~/Library/Application Support/PostPile` is unaffected.
- Local builds never publish: the desktop `dist` script passes `--publish never` to electron-builder.
