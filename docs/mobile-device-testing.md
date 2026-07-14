# Mobile development and device testing

Last verified: 2026-07-13 with Expo 55, React Native 0.83, and pnpm 10.33.2.

This is the authoritative development and manual QA runbook for the Expo / React Native client in `apps/mobile`. Use it for pull requests, physical-device checks, TestFlight acceptance, and Android bring-up.

## What each environment can prove

| Environment | Best for | Do not approve from it alone |
| --- | --- | --- |
| React Native Web (`mobile:web`) | Fast layout, content, keyboard, and browser accessibility checks | Native tab bars, safe areas, haptics, native menus, system materials, gesture latency, launch behavior |
| Expo Go (`mobile`, `mobile:lan`, `mobile:tunnel`) | Fast JavaScript iteration on a phone | Release startup, signing, native dependency/config changes, production performance |
| iOS Simulator / Android Emulator | Screen-size, theme, text-size, keyboard, and repeatable state testing | Haptics, camera-notch ergonomics, thermal behavior, true touch latency |
| Native debug build on hardware | Gestures, safe areas, keyboard, native navigation, accessibility, and approximate performance | Release startup and fully optimized performance |
| Native release build / TestFlight | Final launch, performance, persistence, sharing, signing, and release acceptance | Nothing material; this is the authoritative pre-release environment |

The browser at `http://127.0.0.1:8081` is a useful React Native Web preview, not evidence that the native tab bar or native navigation chrome is correct.

## Common setup

From the repository root:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm test:all
pnpm typecheck
pnpm lint:mobile
```

Use Node 20 or newer. Do not run `expo prebuild` casually after native projects are committed: it can rewrite Xcode or Gradle configuration. Generated native diffs must be reviewed like source code.

## Run targets

### React Native Web

```bash
pnpm mobile:web
```

Use this for fast iteration and in-app-browser review. Always repeat native-sensitive changes on a simulator or physical device.

### Expo Go on another phone or tablet

```bash
# Same local network
pnpm mobile:lan

# When LAN discovery is unavailable
pnpm mobile:tunnel
```

Install Expo Go, scan the QR code, and keep the development machine awake. LAN is faster; tunnel is a connectivity fallback.

### iOS Simulator

Prerequisites: macOS, full Xcode, accepted Xcode license, and CocoaPods.

```bash
pnpm ios:simulator
```

To choose a specific installed simulator:

```bash
pnpm --filter @versemark/mobile exec expo run:ios --device
```

Use Xcode's Features > Location and Environment Overrides, or the simulator Settings app, to test appearance and accessibility variants.

### Physical iPhone or iPad

The complete signing and USB setup is in [`apps/mobile/README.md`](../apps/mobile/README.md). The normal command is:

```bash
pnpm ios:device
```

To select a different paired device:

```bash
pnpm --filter @versemark/mobile run ios:device:any -- "Device Name"
```

The device script builds Release by default so the JavaScript bundle is embedded. Use the debug variant only when live Metro debugging is required:

```bash
pnpm --filter @versemark/mobile run ios:device:debug
```

### Android Emulator

Prerequisites:

1. Install Android Studio and its SDK tools.
2. Install an Android SDK platform supported by Expo 55 and create an emulator in Device Manager.
3. Set `ANDROID_HOME` to the SDK directory and make `adb` available on `PATH`.
4. Boot the emulator before running the app.

```bash
pnpm android
```

### Physical Android device

Enable Developer options and USB debugging, connect and authorize the device, then confirm it is visible:

```bash
adb devices
pnpm --filter @versemark/mobile exec expo run:android --device
```

Android is not yet configured for Play Store delivery. Treat physical Android results as development QA until signing and distribution are added to [`docs/ci-cd.md`](ci-cd.md).

## Resetting local state

Most gameplay state is local. State deliberately persists across reloads and upgrades, so reset it when validating first-run or empty-progress behavior.

| Target | Reset |
| --- | --- |
| iOS Simulator | `xcrun simctl uninstall booted app.versemark.mobile` and reinstall |
| Physical iOS | Delete Versemark from the device and reinstall |
| Android emulator/device | `adb shell pm clear app.versemark.mobile` |
| React Native Web | Clear site data for `127.0.0.1:8081` in browser developer tools |

Record whether a test began with fresh or migrated state. Never reset a tester's device without permission.

## Minimum device matrix

Every UI-affecting pull request needs the **PR minimum**. A release candidate needs the **release matrix**.

### PR minimum

| Platform | Required target | Purpose |
| --- | --- | --- |
| iOS | Small iPhone simulator (for example iPhone SE) | Narrow width, short height, keyboard pressure |
| iOS | Current standard physical iPhone or simulator | Primary interaction and native chrome |
| Android | Current Pixel-class emulator | 48dp targets, system back, keyboard, TalkBack structure |
| Web preview | 390px-ish and tablet/desktop widths | Browser fallback and keyboard focus |

### Release matrix

| Class | Examples | Required variants |
| --- | --- | --- |
| Small iPhone | iPhone SE class | Light/dark, largest accessibility text, keyboard open |
| Modern iPhone | Current 6.1-inch Dynamic Island class | Light/dark, 60Hz/120Hz where available, VoiceOver |
| Large iPhone | Plus / Pro Max class | Reachability, footer width, result composition |
| iPad | 11-inch class | Portrait, Stage Manager/split width when supported, native tab/sidebar adaptation |
| Small Android | Narrow Pixel/A-series class | Font scale 1.3+, gesture and three-button navigation |
| Standard Android | Current Pixel-class hardware or emulator | Light/dark, TalkBack, predictive/system back |
| Android tablet/foldable | At least one expanded-width emulator | Responsive layout and navigation adaptation |

Test the current and previous major OS versions when practical. Record the exact device, OS, build/commit, appearance, text scale, and input method in the PR or release report.

The app is currently configured `orientation: portrait`. Rotation is not an acceptance requirement until that product constraint changes, but iPad multitasking and expanded-width behavior still require deliberate verification.

## Core manual scenarios

Run the scenarios affected by a pull request. Run all of them for a release candidate.

### Install and launch

- Fresh install reaches Home without a blank frame or unexpected intermediate screen.
- Splash background and status bar match light and dark appearance.
- Returning from the background preserves the current round.
- Storage failure or unavailable content produces a recoverable state.

### Home and daily state

- Fresh day: `Play daily` is the single primary action.
- Partial daily: progress and `Continue daily` are correct after force quit/relaunch.
- Completed daily: points and `View result` are correct.
- Streak 0, 1, and milestone checkpoints place and intensify the mark correctly.
- Appearance selection follows System and persists when explicitly overridden.

### Timeline and refinement

- Initial drag updates the marker but does not zoom until the finger lifts.
- OT, NT, and Book refinement preserve the selected reference.
- Book-mode edge hold accelerates smoothly in both directions and stops immediately on release/cancel.
- Haptics are meaningful, not continuous or doubled.
- Timeline labels remain legible without collisions at the tested text scale.
- VoiceOver/TalkBack can adjust the timeline and hear the current reference.
- Keyboard entry, suggestions, validation, Hint, and Lock remain reachable on the smallest screen.
- Dragging the timeline or selecting a suggestion leaves keyboard/focus in a sensible state.

### Result and continuation

- Reveal preserves screen continuity; the timeline does not visibly remount or jump.
- `N pts` is the primary visual and is announced to assistive technology.
- Answer and You are distinct, readable, correctly positioned, and individually reachable.
- Exact, near, and distant results use understandable color-independent feedback.
- Share opens the platform share sheet with correct text.
- Next, Next verse, and Done lead to the expected destination.
- Daily summary handles long book names and large text without truncation or overlap.

### Progress

- Empty, lightly populated, and heavily populated histories render correctly.
- Next milestone appears first and reports progress accessibly.
- Canon map selection works by touch and assistive-technology increment/decrement.
- Books expansion, selection, and collapse preserve scroll position.
- `View all` and `Show earned` switch without stale light/dark rows.
- Native tab/sidebar behavior, safe areas, and scrolling remain correct on phone and tablet.

### Persistence and date behavior

- Daily progress survives force quit, device restart, and app upgrade.
- Translation and appearance preferences persist.
- Practice updates mastery and achievements exactly once.
- Local date rollover starts the correct daily puzzle without corrupting the previous result.
- Offline launch and play work after the app has been installed.

## Accessibility and system variants

For every release candidate, verify:

- Light, dark, and System appearance
- Default text, one larger text setting, and the largest accessibility text setting
- Bold Text
- Increase Contrast / high-contrast text where supported
- Reduce Motion
- VoiceOver on iOS and TalkBack on Android
- Button Shapes or equivalent differentiation settings where supported
- Software keyboard plus at least one hardware-keyboard pass in the web/iPad environment

Acceptance rules:

- No clipped, overlapping, or unreachable content.
- Every actionable item has a role, useful label, state, and minimum 44pt iOS / 48dp Android target.
- Focus remains visible and follows the interaction logically.
- Result, error, and achievement state changes are announced once.
- Meaning is never communicated only through color, animation, position, or haptics.

## Performance and interaction quality

Performance must be judged in a native Release build on hardware, not from React Native Web or only from a debug simulator.

- Timeline tracking remains visually attached to the finger.
- Edge acceleration does not stutter, skip uncontrollably, or continue after release.
- Scrubbing does not produce an uninterrupted haptic buzz.
- Result reveal, native tab changes, keyboard movement, and Progress scrolling remain smooth.
- No repeated render warnings, unhandled promise rejections, or red screens appear.
- Launch does not flash the wrong appearance.

When a gesture or animation changes, capture a screen recording from physical hardware. For regressions, attach an Xcode Instruments or Android Studio profiler trace when available; do not accept “felt okay in the browser” as performance evidence.

## Evidence and report template

Attach screenshots for static visual changes and a recording for gesture, keyboard, navigation, or animation changes. Use a name such as:

```text
play-book-refine__iphone-15-pro__ios-19__dark__text-default.png
timeline-edge-scroll__pixel-9__android-16__dark.mp4
```

Copy this into a pull request or release note:

```markdown
### Mobile verification

- Commit/build:
- Fresh or migrated state:
- iOS devices + OS:
- Android devices + OS:
- Appearance/text/accessibility variants:
- Scenarios exercised:
- Screenshots/recordings:
- Known deviations:
- Result: PASS / FAIL
```

## Automated gate

Before requesting manual device QA:

```bash
pnpm test:all
pnpm typecheck
pnpm lint:mobile
pnpm build
```

The automated tests protect domain behavior and structural wiring. They do not replace the device matrix because native tabs, safe areas, haptics, keyboard behavior, Dynamic Type, TalkBack/VoiceOver, launch continuity, and 120Hz gesture quality require native execution.

## Release acceptance

A mobile release candidate is ready only when:

1. The automated gate is green from a clean install.
2. The release matrix has a named tester and recorded evidence.
3. No P0/P1 accessibility, launch, persistence, navigation, or gameplay issue remains.
4. The exact TestFlight/release build—not a local debug build—passes the core scenarios.
5. Known lower-priority deviations are documented with an owner and follow-up issue.

The upload and App Store Connect procedure remains in [`docs/ci-cd.md`](ci-cd.md).
