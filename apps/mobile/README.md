# @versemark/mobile

Expo / React Native client. Shares game domain via `@versemark/core`.

The authoritative device matrix, Android setup, accessibility scenarios, performance checks, evidence template, and release acceptance criteria live in [Mobile development and device testing](../../docs/mobile-device-testing.md).

## Expo Go (quick, network)

```bash
pnpm run mobile          # from repo root
# or LAN / tunnel:
pnpm run mobile:lan
pnpm run mobile:tunnel
```

## Physical iPhone (native install over USB)

**Not Expo Go.** This compiles a real `.app` and installs it on the connected phone.

### Prerequisites (one-time on the Mac)

1. **Xcode** from the Mac App Store (full app, not only Command Line Tools)
2. Open Xcode once → install additional components → sign in with your Apple ID
   (Xcode → Settings → Accounts)
3. Point CLI tools at Xcode:

   ```bash
   sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
   sudo xcodebuild -license accept
   ```

4. **CocoaPods**: `brew install cocoapods`
5. On the iPhone (**DPS iPhone**):
   - Unlock, **Trust This Computer**
   - Settings → Privacy & Security → **Developer Mode** → On (reboot if asked)
   - Same Apple ID as Xcode signing, or enable automatic signing for a Personal Team

### Build & install

```bash
# USB cable connected, phone unlocked
pnpm run ios:device
```

That runs `expo prebuild` (if needed), `pod install`, then:

```bash
expo run:ios --device "DPS iPhone"
```

First build is slow (native compile). If signing fails, open `apps/mobile/ios/*.xcworkspace` in Xcode, select the **Versemark** target → Signing & Capabilities → your Team, then re-run.

### After install

Keep Metro running (the `run:ios` command usually starts it). Device and Mac should share Wi‑Fi so the JS bundle can load (`REACT_NATIVE_PACKAGER_HOSTNAME` is set to your LAN IP by the script).

For signed TestFlight and App Store delivery, including ASC CLI authentication, archive/export commands, CI secrets, and release gates, see [../../docs/ci-cd.md](../../docs/ci-cd.md).

### Other device name

```bash
pnpm --filter @versemark/mobile exec bash ./scripts/run-ios-device.sh "Some Other iPhone"
```

## Other development targets

From the repository root:

```bash
pnpm ios:simulator        # native iOS Simulator build
pnpm android              # booted Android emulator or connected device
pnpm mobile:web           # React Native Web preview only
pnpm test:all             # core + web + mobile tests
pnpm typecheck
pnpm lint:mobile
```

Do not approve native tab bars, safe areas, haptics, keyboard behavior, accessibility, or gesture performance from the web preview alone.
