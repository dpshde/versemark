# React Native implementation rules

This app follows the Vercel Labs React Native Skills v1.0.0 guide:
https://github.com/vercel-labs/agent-skills/tree/main/skills/react-native-skills

Apply these rules to every change under `apps/mobile`:

## Critical rendering

- Render strings only inside `Text`.
- Do not use a potentially empty string or zero as the left side of `&&` in JSX. Prefer an early return, a ternary, or explicit boolean coercion. Keep `react/jsx-no-leaked-render` enabled.

## Lists and images

- Virtualize every scrollable collection. Prefer `LegendList` with `recycleItems`.
- Keep list `data` and inner object references stable. Do not map dynamic parent state into new row objects on every render.
- Hoist list callbacks and `renderItem`; pass primitive row props when practical; keep row components free of fetching and expensive computation.
- Give heterogeneous lists a discriminated `kind` and `getItemType`.
- Use `expo-image`, appropriately sized sources, caching, and `recyclingKey` in recycled rows.

## Animation and scrolling

- Animate only `transform` and `opacity` unless layout animation is unavoidable.
- Store semantic animation state and derive visual values from it.
- Prefer `useDerivedValue` for derivation and `GestureDetector` for animated press feedback.
- Never put scroll position in React state; use a ref or Reanimated shared value.

## Navigation and state

- Keep native stack and native bottom tabs on native platforms.
- Store only ground truth and user intent. Derive display values during render.
- Use `undefined` plus `??` for reactive fallback state.
- Use functional state updaters whenever next state depends on previous state.
- If React Compiler is enabled, destructure hook functions early and use Reanimated `.get()` / `.set()`.

## Native UI

- Measure layout synchronously in `useLayoutEffect` and keep it current with `onLayout` when a component depends on dimensions.
- Prefer `gap`, internal `padding`, continuous border curves, native shadows/gradients, and the shared theme tokens.
- Use `contentInsetAdjustmentBehavior="automatic"` on root scroll containers and `contentInset` for dynamic scroll spacing.
- Use design-system exports rather than importing third-party UI primitives throughout feature code.
- Prefer native menus and form-sheet modals when those features are needed. Use `Pressable`, never legacy Touchable components.
- Prefer compound components when a control must compose text and icons polymorphically.

## Repository architecture

- Native dependencies must be direct dependencies of `apps/mobile` for autolinking.
- Keep one exact version of shared dependencies across workspaces; do not add `^` or `~` ranges.
- Hoist static `Intl` formatters to module scope; memoize only when locale/options are dynamic.
- Embed custom fonts with the Expo font config plugin rather than async runtime loading.

Rules for galleries, menus, modals, Reanimated, and custom fonts become mandatory when those features or packages are introduced; do not add unused dependencies solely to demonstrate a rule.

## Verification and handoff

- Follow [`docs/mobile-device-testing.md`](../../docs/mobile-device-testing.md) for environment limits, simulator and physical-device setup, the PR/release device matrix, accessibility variants, manual gameplay scenarios, performance checks, and the evidence template.
- Before manual device QA, run `pnpm test:all`, `pnpm typecheck`, and `pnpm lint:mobile` from the repository root.
- React Native Web is a preview only. Do not claim that native tabs, navigation materials, safe areas, haptics, keyboard behavior, accessibility services, launch continuity, or gesture performance are verified from the browser.
- UI changes require the PR-minimum device matrix. Gesture, animation, keyboard, navigation, or performance changes require a native screen recording; release claims require the exact TestFlight/release build and recorded device/OS evidence.
