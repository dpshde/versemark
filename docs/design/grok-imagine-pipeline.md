# Grok Imagine Asset Pipeline

Dedicated, reproducible pipeline for generating Versemark's UI art with Grok Imagine (xAI image and video generation), per the [generate-assets-with-grok-imagine](../decisions/generate-assets-with-grok-imagine.md) ADR.

## Principles

1. **Prompts are source.** Every shipped asset traces to a versioned manifest entry. Exploration in grok-cast (Raycast) is welcome, but a winning prompt must be captured in a manifest before its output ships.
2. **Generation proposes, the maintainer disposes.** Outputs land in a staging directory; a human promotes winners.
3. **The style bible is the system prompt.** Every prompt begins from the shared style preamble (below) so the asset set stays unified.
4. **Provenance always.** Model ID, prompt, date, and any input image are recorded per shipped asset.

## Layout

```text
design/
  prompts/            # versioned prompt manifests (source of truth)
    strip-textures.json
    reveal-plates.json
    icons-badges.json
    motion.json
  inputs/             # public-domain input images (Doré scans) + sources.md
  out/                # generation staging (gitignored)
assets/               # promoted, shipped assets + provenance.json
scripts/
  generate-assets.mjs # the pipeline script
```

## Manifest format

```json
{
  "stylePreamble": "style/preamble.txt",
  "defaults": { "model": "grok-imagine-<current>", "size": "1536x1024", "n": 4 },
  "assets": [
    {
      "id": "strip-genre-law",
      "kind": "image",
      "prompt": "...asset-specific prompt, appended to preamble...",
      "size": "2048x512",
      "input": null,
      "notes": "tileable horizontally"
    }
  ]
}
```

- `id` is stable and becomes the staged filename (`out/strip-genre-law_01.png`).
- `input` (optional) is a path under `design/inputs/` for image-to-image work (Doré colorization).
- `kind: "video"` entries specify `duration` and are used only for the title loop and reveal moments.

## Script behavior

`scripts/generate-assets.mjs <manifest> [--only id,id] [--dry-run]`

1. Reads the manifest, prepends the style preamble to each prompt.
2. Calls the xAI API image (or video) generation endpoint with `XAI_API_KEY` from the environment. The key is never committed; generation never runs in CI.
3. Writes numbered candidates into `design/out/`, plus a `run.json` log (timestamp, model, full resolved prompt per output).
4. `--dry-run` prints resolved prompts without spending generation credits.

Auth follows the grok-cast precedent: a standard `xai-...` API key against `api.x.ai/v1`. (grok-cast's device-code OAuth is Raycast-specific; the pipeline uses the plain key.)

## Curation and promotion

1. Review `design/out/` candidates against the style bible; be ruthless about the anti-pattern list.
2. Post-process as needed (crop, tile-check, palette nudge toward Inkstone/starry blue/gold, compression to WebP/AVIF).
3. Move the winner to `assets/` and append an entry to `assets/provenance.json`:

```json
{
  "file": "strip-genre-law.webp",
  "generator": "grok-imagine",
  "model": "<model id from run.json>",
  "manifest": "design/prompts/strip-textures.json#strip-genre-law",
  "generated": "2026-07-12",
  "input": null,
  "postProcessing": "cropped, tiled seam fixed, webp q82"
}
```

## Doré colorization workflow

1. Source engravings only from verified public-domain scans (record source URL and PD basis in `design/inputs/sources.md`).
2. Use image-to-image with a colorization prompt that preserves linework and chiaroscuro; the style bible's palette section governs color choices.
3. Reject outputs that redraw rather than colorize; the engraving language must survive.

## Video assets

- Scope: title-screen ambient loop and reveal-moment backdrop only (see style bible, Motion).
- Keep loops short (4-8 s), seamless, and heavily compressed; verify total payload stays within the distribution ADR's first-load budget. Ship as looping video or fall back to a still on data-saver.

## Disclosure

The game's about screen credits: BSB text (public domain), Doré engravings (public domain), and AI-generated artwork produced with Grok Imagine under human art direction. Provenance records back this claim.
