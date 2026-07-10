# Style Bible

**Versemark** is a calm daily ritual, not a spectacle. A verse on a card, a timeline of the canon, a marker laid down. The design is quiet, warm, literary, and fast.

## Thesis

Unified, restrained, no decoration without purpose. The canon timeline is the product; every visual element exists to make the player's relationship to Scripture's structure clearer. No foil, no glow, no ambient effects, no image assets.

## Palette

| Role | Color | Notes |
| --- | --- | --- |
| Background | Near-white OKLCH | A true light surface, not cream or parchment. Warmth comes from accent and type. |
| Surface | Slightly lifted warm-white | Verse cards, result cards |
| Rail | Warm neutral | The timeline track |
| Accent | Terracotta (OKLCH) | The player's marker, primary buttons, active states. One accent only. |
| Success | Muted olive-green | The true position marker on reveal |
| Ink | Warm near-black | Body text |
| Ink-2 / Ink-3 | Warm grays | Secondary and tertiary text |

Genre tints on timeline segments are whisper-level warm/cool shifts — barely perceptible, never cartoon blocks.

## Type

Book serif throughout (Iowan Old Style / Palatino / Georgia stack). Display headings are tight and weighty, not spaced-out. Labels use small-caps with modest tracking. Body at 1.04rem with comfortable line-height. Score is large and confident. No display fonts in UI labels or buttons.

## The canon timeline (game board)

The game board is a clean timeline rail. The canon renders as genre-tinted book segments along a straight rail — no meander, no arc, no glow.

- Books are colored segments sized by chapter count; the canon's proportions are visible at a glance.
- The testament boundary is a dashed line labeled OT / NT.
- Chapter ticks appear at deep zoom.
- The player's guess is a **filled diamond** in terracotta; on reveal, the true position appears as a green diamond with a dashed connector line between them.
- Orientation is responsive: vertical on portrait phones (Genesis at top, thumb-scrolled), horizontal on wide viewports. One geometry, one axis.

## Materiality

Minimal. Cards use a hairline border and a very subtle shadow (4px blur max). No heavy drop shadows, no glassmorphism, no glow. Depth comes from the surface color step, not from shadow stacking. No image textures, no grain overlays.

## Motion

Fast and purposeful (150–250ms). No ambient loops, no orchestrated page-load sequences. A correct guess is a quiet mark landing, not a celebration. Reveal is a quick connector draw, not a flare. Everything respects `prefers-reduced-motion`.

## Anti-patterns (do not ship)

- Cream, sand, parchment, or beige backgrounds with no real color identity.
- Foil, glow, diffraction spikes, starfield, or celestial effects.
- Gamification kitsch: coins, streak-on-fire emoji, cartoon trophies, confetti.
- Garish oversaturated color or SaaS gradients.
- Heavy shadows or glassmorphism as decoration.
- Display fonts in UI labels, buttons, or data.
