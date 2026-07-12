---
name: Versemark
description: Mark where the verse lives — a calm canon-timeline familiarity game for spare minutes.
colors:
  bg: "oklch(0.985 0.003 50)"
  surface: "oklch(0.972 0.004 50)"
  surface-2: "oklch(0.945 0.006 50)"
  rail: "oklch(0.93 0.005 50)"
  ink: "oklch(0.27 0.008 50)"
  ink-2: "oklch(0.45 0.010 50)"
  ink-3: "oklch(0.60 0.008 50)"
  accent: "oklch(0.55 0.15 40)"
  accent-deep: "oklch(0.45 0.14 40)"
  accent-soft: "oklch(0.90 0.035 45)"
  border: "oklch(0.90 0.006 50)"
  border-strong: "oklch(0.82 0.008 50)"
  row-rule: "oklch(0.86 0.008 50)"
  shadow: "oklch(0.27 0.008 50 / 0.08)"
  success: "oklch(0.52 0.11 145)"
  error: "oklch(0.43 0.12 25)"
  heat-close: "oklch(0.84 0.055 145)"
  heat-far: "oklch(0.48 0.175 40)"
colorsDark:
  bg: "oklch(0.18 0.01 50)"
  surface: "oklch(0.22 0.012 50)"
  surface-2: "oklch(0.28 0.014 50)"
  rail: "oklch(0.32 0.012 50)"
  ink: "oklch(0.92 0.008 50)"
  ink-2: "oklch(0.74 0.01 50)"
  ink-3: "oklch(0.58 0.01 50)"
  accent: "oklch(0.70 0.14 40)"
  accent-deep: "oklch(0.78 0.12 40)"
  accent-soft: "oklch(0.30 0.05 40)"
  border: "oklch(0.34 0.012 50)"
  border-strong: "oklch(0.42 0.014 50)"
  row-rule: "oklch(0.30 0.01 50)"
  shadow: "oklch(0 0 0 / 0.35)"
  success: "oklch(0.68 0.10 145)"
  error: "oklch(0.68 0.12 25)"
  heat-close: "oklch(0.55 0.08 145)"
  heat-far: "oklch(0.62 0.16 40)"
typography:
  display:
    fontFamily: "Charter, Bitstream Charter, Sitka Text, Cambria, Georgia, serif"
    fontSize: "clamp(1.7rem, 7vw, 2.2rem)"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Charter, Bitstream Charter, Sitka Text, Cambria, Georgia, serif"
    fontSize: "1.04rem"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  section-label:
    fontFamily: "Charter, Bitstream Charter, Sitka Text, Cambria, Georgia, serif"
    fontSize: "0.72rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.06em"
    fontVariantCaps: "all-small-caps"
  label:
    fontFamily: "Charter, Bitstream Charter, Sitka Text, Cambria, Georgia, serif"
    fontSize: "0.82rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0.06em"
    fontVariantCaps: "all-small-caps"
  stat-key:
    fontFamily: "Charter, Bitstream Charter, Sitka Text, Cambria, Georgia, serif"
    fontSize: "0.68rem"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "0.06em"
    fontVariantCaps: "all-small-caps"
  stat-value:
    fontFamily: "Charter, Bitstream Charter, Sitka Text, Cambria, Georgia, serif"
    fontSize: "0.92rem"
    fontWeight: 600
    lineHeight: 1.2
    fontVariantNumeric: "lining-nums tabular-nums"
  score:
    fontFamily: "Charter, Bitstream Charter, Sitka Text, Cambria, Georgia, serif"
    fontSize: "1.8rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.01em"
rounded:
  panel: "0px"
  btn: "0px"
  dropcap: "4px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
  3xl: "48px"
  touch: "44px"
layout:
  achievements-measure: "22rem"
  play-content-max: "36rem"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "#fff"
    rounded: "{rounded.panel}"
    padding: "0.75rem 1.25rem"
    height: "44px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    border: "1px solid {colors.border-strong}"
    rounded: "{rounded.panel}"
    padding: "0.75rem 1.25rem"
    height: "44px"
  panel:
    backgroundColor: "{colors.surface}"
    border: "1px solid {colors.border-strong}"
    rounded: "{rounded.panel}"
    padding: "{spacing.md}"
  segmented-control:
    backgroundColor: "{colors.surface-2}"
    border: "1px solid {colors.border-strong}"
    activeBackground: "{colors.accent-soft}"
    activeText: "{colors.accent-deep}"
  verse:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    padding: "0"
  mode-label:
    backgroundColor: "transparent"
    textColor: "{colors.ink-3}"
    padding: "0"
---

# Versemark — Design System

## Overview

A quiet daily ritual: a verse, a timeline of the canon, a marker laid down. Warmth comes from **serif type** and a **single terracotta accent**, not from a tinted page. No glow, foil, cream parchment, or kitsch gamification.

Two surface modes share one token set:

| Surface | Job | Material |
| --- | --- | --- |
| **Play** | The canon is the board | Full-bleed timeline; chrome is type-only overlay |
| **Secondary** (home, achievements) | Progress, mastery, unlocks | Square hairline **panels** on `--surface`, narrow measure |

The achievements screen is the reference for secondary UI: Lifetime → Canon map → Focus (Farther / Coverage / Closer) → Unlocks. Prefer that pattern over inventing new card chrome.

## Appearance

Preference cycles **System → Light → Dark** (`data-theme` on `<html>`; System leaves the attribute off so `prefers-color-scheme` wins). Theme changes must **not remount screens** — flip tokens, sync the toggle icon, and repaint only non-CSS surfaces (canvas strip, mastery heat).

Dark keeps the same warm hue (~50) with inverted luminance: near-black page, elevated surfaces, brighter terracotta for contrast. Genre and heat tokens have dark counterparts.

Toggle chrome clusters with other top-bar actions (home: theme left of crown; achievements: theme left of home), top-right, ghost ink.

## Colors

### Light

- **bg** — near-white, barely warm (not cream/sand/parchment).
- **surface / surface-2** — lifted panels and inset headers.
- **rail** — timeline / heat track underlay.
- **ink → ink-3** — primary → tertiary warm near-black.
- **accent / accent-deep / accent-soft** — terracotta action, active fill, soft selected wells.
- **border** — quiet rules (inputs, unlock dividers).
- **border-strong** — panel outlines and segmented controls (must read at a glance).
- **row-rule** — list row dividers inside panels (lighter than panel edge).
- **success / error** — olive true-marker; brick invalid.
- **heat-close → heat-far** — olive → terracotta mastery ramp (legend + map segments).

### Dark

Same roles; see frontmatter `colorsDark`. Accent lightens; surfaces step up from `bg`; borders stay visible without neon.

Genre tints on the play timeline stay whisper-level in light, muted midtones in dark — never cartoon blocks.

## Typography

Book serif throughout (Charter stack). One family for display, body, labels, and data.

| Role | Use |
| --- | --- |
| **Display** | Home wordmark |
| **Body** | Verse, supporting copy |
| **Section label** | `LIFETIME`, `CANON MAP`, `BOOKS` — all-small-caps, ~0.72rem, tracking 0.06em |
| **Stat key / value** | Lifetime grid — tiny caps key + tabular lining value |
| **Score** | Round result |

Data rows use lining/tabular nums. Body may keep oldstyle nums on prose. Never pair a second display face into UI chrome.

## Elevation & panels

Secondary screens use **square panels** (`border-radius: 0`):

- `1px solid var(--border-strong)`
- `background: var(--surface)`
- padding from the 4pt scale (`md` default)
- **One stroke per edge** — no stacked border + background-image hairlines

Depth is the surface step, not shadow stacking. Soft shadow token exists for rare lifts (toasts); do not decorate panels with it.

Lists inside panels: `--row-rule` between rows; do not also draw a full panel bottom that doubles the last rule. Collapsible section headers sit on `--surface-2` with a chevron; preview ~4 rows, expand in place.

## Layout

- **Play content**: `--content-max` (~36rem) for verse + dock.
- **Achievements body**: ~22rem centered column; vertical stack with `md` gaps between panels.
- **Touch**: 44px minimum targets; icon chrome may visually sit tighter but hit area stays 44px.
- **Safe areas**: top/bottom insets on home and achievements.

## Components

### Play

- **Primary / secondary buttons**: terracotta solid vs transparent hairline (`--border-strong`); **square corners** everywhere (same panel language as home Daily · Practice); 44px min height.
- **Ghost / nav**: tertiary ink icons (home, theme, crown).
- **Verse**: type over soft gradient; no card.
- **Canon timeline**: full-width canvas; genre segments; terracotta diamond marker; olive true on reveal; precision notch ruler; edge scrubbing; Genesis→Revelation bounds.

### Secondary (achievements-shaped)

- **Panel**: Lifetime, Canon map, Focus block — identical material language.
- **Segmented control**: three equal small-caps radios in a square hairline frame; active = `--accent-soft` fill + `--accent-deep` type (`Farther` / `Coverage` / `Closer`).
- **Canon heat map**: book-width segments; untested = `--rail`; tested = heat oklch from median miss; Closer←→Farther legend ramp; detail row + optional book picker.
- **Focus lists**: Books / Genres collapsible; metric column matches mode (`~N chapters off`, `not tested`, `n/n close`).
- **Unlocks**: horizontal rows, drop-cap tile (bronze / gold / snow); literary titles — not badge shelves or confetti.

## Motion

150–250ms, `--ease-out`. `fadeRise` must end on opacity only (no leftover `transform`) so hairline borders stay crisp. Respect `prefers-reduced-motion`. Theme flips are instant token swaps, not page transitions.

## Do's and Don'ts

- **Do** treat achievements as the secondary-screen template for any new progress UI.
- **Do** keep play chrome thin so the timeline teaches proportion.
- **Do** use terracotta only for player action, selection, and earned accents.
- **Do** keep panel corners square and borders single-weight.
- **Do** collapse long lists by default; never dump the full canon unprompted.
- **Don't** use cream/sand/parchment page backgrounds.
- **Don't** add glow, foil, starfield, or SaaS purple gradients.
- **Don't** remount the DOM to change theme.
- **Don't** nest cards inside cards, or double-draw bottom borders.
- **Don't** gamify with streak-fire, coins, cartoon trophies, or celebratory loops.
- **Don't** invent a second type family for labels or data.
