# YieldScope design

## Direction

**Ledger at dusk** — deep ink surfaces, a single cool mint signal for “earned,” sharp geometric type. Feels like an instrument panel for income, not a fintech pastel dashboard.

Avoid: purple-indigo gradients, cream+terracotta, broadsheet hairlines, Inter/Roboto defaults, glow-heavy crypto neon, pill-stat strips in the hero.

## Brand surface (landing)

- **Composition:** One full-bleed first viewport. Brand name is hero-level. One headline, one sentence, one CTA group. No cards in the hero. No stat strip. No floating badges on media.
- **Background:** Layered ink gradient (`#05080f` → `#0c1524`) with a subtle horizontal scan-line / grid texture (low opacity), plus a soft mint radial wash behind the wordmark — atmosphere, not decoration-as-product.
- **Typography:** Display = **Syne** (expressive geometric). Body = **IBM Plex Sans**. Numbers in dashboard = **IBM Plex Mono**.
- **Color tokens:**
  - `--ink`: `#05080f`
  - `--ink-elevated`: `#0c1524`
  - `--paper`: `#e8eef6`
  - `--mint`: `#3dffa8` (earned / primary CTA)
  - `--mint-dim`: `#1a6b4a`
  - `--warn`: `#f0a060`
  - `--error`: `#ff6b6b`
  - `--muted`: `#8a9bb0`
- **Motion (landing, ≥2–3 intentional):**
  1. Wordmark fade+rise on load (~600ms, ease-out).
  2. Soft mint radial pulse behind brand (slow, 8s loop, opacity only).
  3. CTA underline / border draw on hover (150–200ms).

## Product surface (dashboard / connect)

- Restrained ink UI. Syne only for page titles; IBM Plex for everything interactive.
- Source status chips: `ok` mint outline, `error` coral, `not_connected` muted — never fake rows.
- Dense event table with mono amounts. Empty state teaches Connect, not “nothing here.”

## Layout rules

- Landing: brand → headline → sentence → CTAs; scroll for How it works / Sources / Checkpoint.
- App: top bar with YieldScope + wallet; main = total earned + source strip + events; side action = Attest checkpoint.
