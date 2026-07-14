# CI/CD and release operations

Last verified: 2026-07-13 against `asc` 2.8.1 and Vercel CLI 54.9.1.

This is the operational runbook for Versemark's web and React Native delivery. It describes the repository as it exists today and calls out the remaining setup that cannot be inferred from source control.

## Delivery map

| Surface | Continuous integration | Delivery | Production trigger |
| --- | --- | --- | --- |
| Web PWA | Shared quality gate plus production web build | Vercel Git integration | Merge to `main` |
| React Native iOS | Shared quality gate plus mobile tests; archive on a signed macOS runner | `asc` to TestFlight and App Store Connect | Manual, protected release job |
| React Native Android | Shared quality gate only | Not configured | None |

There is currently no workflow under `.github/workflows/`. Until one is added, the commands below are the contract a CI provider must implement and the checks maintainers must run locally.

## Required CI gate

Run this gate for every pull request and every push to `main` from the repository root:

```bash
corepack enable
CI=true pnpm install --frozen-lockfile
pnpm test
pnpm --filter @versemark/mobile test
pnpm typecheck
pnpm build
```

`pnpm test:all` is the equivalent combined local test command. Before a mobile release, also complete the native device matrix and evidence report in [Mobile development and device testing](mobile-device-testing.md). Automated checks do not validate native tabs, safe areas, haptics, accessibility services, keyboard behavior, or gesture performance.

`pnpm test` covers core and web tests. Mobile tests are a separate command and must not be omitted. `pnpm build` produces the same web artifact expected by Vercel at `apps/web/dist`.

Recommended repository policy:

- Protect `main`; require the CI gate and Vercel preview check before merge.
- Cancel superseded CI runs on the same pull request.
- Do not publish an iOS build from an ordinary pull request or unprotected branch.
- Keep release jobs manually dispatched and attach them to a protected GitHub environment with required reviewer approval.

## Web: Vercel

### Authoritative configuration

The Vercel project should be connected to this Git repository with the project Root Directory set to the repository root (`/`). The root `vercel.json` is authoritative:

| Setting | Value |
| --- | --- |
| Framework | Vite |
| Install | `npm install` |
| Build | `npm run build -w @versemark/web` |
| Output | `apps/web/dist` |
| Production branch | `main` |

Do not also configure the project Root Directory as `apps/web` unless the dashboard settings and `apps/web/vercel.json` are deliberately adopted as the new source of truth. The root configuration is the only one that unambiguously builds the shared `@versemark/core` workspace from a clean checkout.

The repository declares pnpm as its development package manager, while the current Vercel build explicitly uses npm. Dependency changes must therefore keep both `pnpm-lock.yaml` and `package-lock.json` current. If Vercel is moved to pnpm later, change the install command and remove the dual-lockfile requirement in the same pull request.

### Normal Git flow

1. Push a feature branch and open a pull request.
2. Vercel creates a Preview deployment. Verify the PR's Vercel check and preview URL.
3. Run the smoke checks below against the preview.
4. Merge only after the CI gate and preview are green.
5. The merge to `main` creates the Production deployment.

The web app has no required runtime secrets today. If environment variables are added, configure them separately for Preview and Production in Vercel and document them here without recording values.

### Web smoke check

Verify at least:

- The home screen loads without console errors.
- A round can be played through reveal and next round.
- `/manifest.webmanifest` returns the web manifest.
- `/data/pool.json` returns JSON.
- A reload works after the service worker has installed.
- Existing progress survives a reload.

For a quick HTTP check:

```bash
BASE_URL="https://preview-or-production.example"
curl --fail --silent --show-error "$BASE_URL/" >/dev/null
curl --fail --silent --show-error "$BASE_URL/manifest.webmanifest" >/dev/null
curl --fail --silent --show-error "$BASE_URL/data/pool.json" >/dev/null
```

### Manual Vercel recovery path

Git integration is the normal deployment path. Use the CLI only for recovery or a deliberately custom pipeline:

```bash
# One-time local link; .vercel/ is intentionally ignored.
vercel link

# Preview: pull settings, build once, deploy that exact artifact.
vercel pull --yes --environment=preview
vercel build
vercel deploy --prebuilt

# Production: use production settings and deploy the tested artifact.
vercel pull --yes --environment=production
vercel build --prod
vercel deploy --prebuilt --prod
```

A headless CI deployment needs `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID`. Pass the token with `--token`; never commit `.vercel/` or tokens.

Prefer promoting a tested deployment over rebuilding it:

```bash
vercel promote DEPLOYMENT_URL_OR_ID
```

For an incident, select the last known-good deployment in the Vercel dashboard and roll back immediately, or use:

```bash
vercel rollback DEPLOYMENT_URL_OR_ID
```

After rollback, fix forward on a branch and repeat the preview checks. Do not delete a deployment that may be needed for rollback.

## React Native iOS: ASC CLI

The native release target is currently iOS. The checked-in Expo configuration identifies `app.versemark.mobile`, and the native workspace and shared scheme are:

```text
apps/mobile/ios/Versemark.xcworkspace
apps/mobile/ios/Versemark.xcodeproj/xcshareddata/xcschemes/Versemark.xcscheme
```

### Release blockers to clear once

Do not enable a release job until all of these are true:

- `apps/mobile/ios/` is committed. It is currently present in the working tree but not tracked, so a clean CI checkout cannot archive it yet.
- The Xcode Release configuration uses an Apple Distribution identity and App Store provisioning. It currently names a development identity and development provisioning profile.
- The app exists in App Store Connect and `ASC_APP_ID` is recorded as a protected repository variable or secret.
- App Store metadata, privacy answers, review contact details, screenshots, age rating, pricing, and availability have been completed.
- A TestFlight internal group exists and its name or ID is recorded as `ASC_TESTFLIGHT_GROUP`.
- The native and Expo versions agree. At verification time `app.json` says version `0.1.0`, while the native project says `MARKETING_VERSION = 1.0`. The archived native values are what App Store Connect receives.

Expo `app.json` is an input to future prebuilds; the Xcode project controls an archive made from the existing native workspace. Keep `expo.version`/`ios.buildNumber` and Xcode `MARKETING_VERSION`/`CURRENT_PROJECT_VERSION` synchronized in every release change.

### Tooling and credentials

The archive runner needs:

- macOS with a deliberately selected Xcode version and accepted license;
- Node 20 or newer, Corepack, and pnpm 10.33.2;
- CocoaPods compatible with the committed `Podfile.lock`;
- `asc` pinned to a reviewed version (2.8.1 was verified for this runbook);
- an Apple Distribution certificate and matching App Store provisioning profile installed in a temporary keychain, or an equivalent documented automatic-signing setup;
- App Store Connect API credentials.

Install and verify ASC locally:

```bash
brew install asc
asc version
asc auth login \
  --name "Versemark" \
  --key-id "KEY_ID" \
  --issuer-id "ISSUER_ID" \
  --private-key "/secure/path/AuthKey_KEY_ID.p8" \
  --network
asc auth status --validate
asc auth doctor
```

For headless CI, use these secrets instead of a repo-local ASC config:

| Name | Purpose |
| --- | --- |
| `ASC_KEY_ID` | App Store Connect API key ID |
| `ASC_ISSUER_ID` | App Store Connect issuer ID |
| `ASC_PRIVATE_KEY_B64` | Base64-encoded contents of the `.p8` key |
| `ASC_APP_ID` | Numeric App Store Connect app ID |
| `ASC_TESTFLIGHT_GROUP` | Internal beta group name or ID; a repository variable is sufficient if it is not sensitive |

Set `ASC_BYPASS_KEYCHAIN=1` and `ASC_STRICT_AUTH=true` in CI so ASC uses only the supplied environment credentials. These API credentials authenticate uploads and App Store Connect operations; they do not replace the Xcode signing certificate and provisioning profile.

The `.gitignore` excludes `.p8`, `.p12`, `.mobileprovision`, `.asc/`, `.secrets/`, and `signing/`. Never print decoded secrets or persist the temporary keychain as an artifact.

### Prepare a clean archive checkout

From the repository root:

```bash
corepack enable
CI=true pnpm install --frozen-lockfile
pnpm test
pnpm --filter @versemark/mobile test
pnpm typecheck

cd apps/mobile/ios
pod install --deployment
cd ../../..
```

Do not run `expo prebuild` in the release job. It can rewrite the native project and signing settings. Prebuild changes belong in a reviewed pull request together with the generated native diff.

### Build number and archive

Choose a marketing version, then ask App Store Connect for a safe next build number:

```bash
export VERSION="1.0.0"

asc builds next-build-number \
  --app "$ASC_APP_ID" \
  --version "$VERSION" \
  --platform IOS \
  --output table
```

Record the returned integer as `BUILD_NUMBER`. Archive with the shared workspace and scheme:

```bash
export BUILD_NUMBER="42"
export ARCHIVE_PATH=".asc/artifacts/Versemark-$VERSION-$BUILD_NUMBER.xcarchive"
export IPA_PATH=".asc/artifacts/Versemark-$VERSION-$BUILD_NUMBER.ipa"
mkdir -p .asc/artifacts

asc xcode archive \
  --workspace "apps/mobile/ios/Versemark.xcworkspace" \
  --scheme "Versemark" \
  --configuration Release \
  --clean \
  --archive-path "$ARCHIVE_PATH" \
  --xcodebuild-flag=-destination \
  --xcodebuild-flag=generic/platform=iOS \
  --xcodebuild-flag="MARKETING_VERSION=$VERSION" \
  --xcodebuild-flag="CURRENT_PROJECT_VERSION=$BUILD_NUMBER" \
  --output json
```

Create `.asc/export-options-app-store.plist` on the runner. `.asc/` is ignored intentionally:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>app-store-connect</string>
  <key>signingStyle</key>
  <string>manual</string>
  <key>signingCertificate</key>
  <string>Apple Distribution</string>
  <key>provisioningProfiles</key>
  <dict>
    <key>app.versemark.mobile</key>
    <string>APP_STORE_PROFILE_NAME_OR_UUID</string>
  </dict>
  <key>teamID</key>
  <string>467UZHSCC3</string>
  <key>uploadSymbols</key>
  <true/>
</dict>
</plist>
```

If the release target is deliberately converted to automatic distribution signing, change `signingStyle` to `automatic` in the generated plist and document the runner authentication that makes automatic signing work.

Export the archive:

```bash
asc xcode export \
  --archive-path "$ARCHIVE_PATH" \
  --export-options ".asc/export-options-app-store.plist" \
  --ipa-path "$IPA_PATH" \
  --timeout 10m \
  --output json
```

Keep the `.xcarchive` and `.ipa` as short-retention, access-controlled CI artifacts. They make a failed upload diagnosable and ensure the reviewed binary is the one promoted.

### TestFlight lane

The first automated delivery target should be an internal TestFlight group:

```bash
asc publish testflight \
  --app "$ASC_APP_ID" \
  --ipa "$IPA_PATH" \
  --group "$ASC_TESTFLIGHT_GROUP" \
  --test-notes "Commit ${GITHUB_SHA:-local}" \
  --locale en-US \
  --wait \
  --timeout 30m \
  --output json
```

Do not add `--submit --confirm` for an internal group. Those flags are for external TestFlight distribution that requires Beta App Review.

After processing:

1. Install from TestFlight on a physical iPhone.
2. Complete the release matrix in [Mobile development and device testing](mobile-device-testing.md).
3. Play Daily and Endless rounds through reveal.
4. Verify persistence, sharing, haptics, appearance switching, accessibility, and achievements.
5. Attach the device report and evidence to the release record.
6. Review ASC processing status and crash feedback.

### App Store lane

Use the build that already passed TestFlight; do not upload the same IPA again. Resolve its build ID:

```bash
asc builds list \
  --app "$ASC_APP_ID" \
  --version "$VERSION" \
  --build-number "$BUILD_NUMBER" \
  --platform IOS \
  --output table
```

Record the result as `BUILD_ID`. Find the App Store version and record its resource ID as `VERSION_ID`; create the version first if it does not exist:

```bash
export BUILD_ID="APP_STORE_CONNECT_BUILD_ID"

asc versions list \
  --app "$ASC_APP_ID" \
  --version "$VERSION" \
  --platform IOS \
  --output table

# Only when the requested version does not exist yet:
asc versions create \
  --app "$ASC_APP_ID" \
  --version "$VERSION" \
  --platform IOS \
  --release-type MANUAL \
  --output table
```

Attach the tested build before strict validation so ASC can include it in the readiness report:

```bash
export VERSION_ID="APP_STORE_CONNECT_VERSION_ID"

asc versions attach-build \
  --version-id "$VERSION_ID" \
  --build "$BUILD_ID" \
  --output json

asc validate \
  --app "$ASC_APP_ID" \
  --version "$VERSION" \
  --platform IOS \
  --strict \
  --output table

asc review submit \
  --app "$ASC_APP_ID" \
  --version-id "$VERSION_ID" \
  --build "$BUILD_ID" \
  --dry-run
```

Only after strict validation and human approval:

```bash
asc review submit \
  --app "$ASC_APP_ID" \
  --version-id "$VERSION_ID" \
  --build "$BUILD_ID" \
  --confirm

asc status --app "$ASC_APP_ID" --watch
```

For a later release with tracked metadata, use `asc release stage --metadata-dir ... --dry-run`, then repeat with `--confirm`, validate, and call `asc review submit`.

App Store submissions cannot be rolled back like a web deployment. Before release, choose manual release or a phased release in App Store Connect. If a bad version becomes live, stop the phased release or remove the version from sale, then ship a new version/build; an uploaded build number is immutable and cannot be reused.

### CI job shape

Use a protected, manually dispatched job on a signed macOS runner. The important controls are:

```yaml
name: iOS release

on:
  workflow_dispatch:
    inputs:
      version:
        description: Marketing version, for example 1.0.0
        required: true
      channel:
        type: choice
        options: [testflight, app-store]
        required: true

concurrency:
  group: ios-release
  cancel-in-progress: false

jobs:
  release:
    runs-on: [self-hosted, macOS, versemark-ios]
    environment: app-store
    env:
      ASC_KEY_ID: ${{ secrets.ASC_KEY_ID }}
      ASC_ISSUER_ID: ${{ secrets.ASC_ISSUER_ID }}
      ASC_PRIVATE_KEY_B64: ${{ secrets.ASC_PRIVATE_KEY_B64 }}
      ASC_APP_ID: ${{ secrets.ASC_APP_ID }}
      ASC_TESTFLIGHT_GROUP: ${{ vars.ASC_TESTFLIGHT_GROUP }}
      ASC_BYPASS_KEYCHAIN: "1"
      ASC_STRICT_AUTH: "true"
```

Install ASC with `rudrankriyam/setup-asc@v1` and request version `2.8.1`; in the actual workflow, pin third-party actions to a reviewed commit SHA. Then implement the quality, pod install, archive, export, and selected delivery steps above. Keep the `app-store` environment approval immediately before a mutating submit command.

## React Native Android status

`apps/mobile/app.json` reserves the Android application ID `app.versemark.mobile`, but the repository has no `apps/mobile/android/`, `eas.json`, Play signing configuration, service account, or Play Console release workflow. Therefore Android is CI-tested as React Native code but is not continuously delivered.

Before claiming Android CD support, choose either EAS Build/Submit or a checked-in Gradle project, configure Play App Signing and a protected upload credential, add an internal-testing lane, document version-code ownership, and add Play rollback/halting procedures to this runbook.

## Release evidence and maintenance

For each production release, retain links to:

- the source commit and successful required CI run;
- the Vercel deployment, or iOS archive job and ASC build ID;
- preview/TestFlight verification notes;
- the approval that promoted or submitted the build;
- any rollback, rejection, or follow-up issue.

Re-verify this runbook whenever Vercel configuration, the native project, signing, package-manager policy, release channels, or pinned CLI versions change. For ASC, `asc --help` and `asc <command> --help` are the command-line source of truth.

## References

- [ASC CLI](https://asccli.sh/)
- [ASC authentication](https://github.com/rorkai/App-Store-Connect-CLI/blob/main/authentication.mdx)
- [ASC CI/CD integrations](https://github.com/rorkai/App-Store-Connect-CLI/blob/main/docs/CI_CD.md)
- [ASC publish commands](https://github.com/rorkai/App-Store-Connect-CLI/blob/main/commands/publish.mdx)
- [Vercel monorepos](https://vercel.com/docs/monorepos)
- [Vercel deployments](https://vercel.com/docs/deployments)
- [Apple: choose an App Store release option](https://developer.apple.com/help/app-store-connect/manage-your-apps-availability/select-an-app-store-version-release-option/)
- [Apple: release an update in phases](https://developer.apple.com/help/app-store-connect/update-your-app/release-a-version-update-in-phases)
