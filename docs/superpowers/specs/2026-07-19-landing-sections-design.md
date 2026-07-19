# YieldScope landing sections — design brief

**Date:** 2026-07-19  
**Surface:** Brand register (`/`) — marketing, not dashboard  
**Pitch (locked):** Solving scattered rewards. Track all your crypto rewards in one place.

## Direction

- **Lane:** Ledger at dusk (Majico + DESIGN.md) — deep ink, electric cyan `#00efff`, IBM Plex (identity-preserved).
- **Color strategy:** Committed on hero (cyan wash + ink canvas); Restrained below the fold.
- **Scene:** A builder at dusk, terminal glow, asking “what did I earn this month?” — dark canvas is forced.
- **Anchors:** Instrument-panel income ledger; Sage + Everyman voice; proof over hype.
- **Imagery:** Atmosphere (grain, soft cyan radial, scan texture) + a mono “checkpoint hash” artifact in the proof section — not stock crypto collage, not hero cards.

## Section map

| # | Section | Job | Content |
|---|---------|-----|---------|
| 0 | Top nav | Orient | Mark + YieldScope · How · Sources · Blog · Register · Sign in |
| 1 | Hero | Brand + pitch + CTA | Wordmark hero-level · “Solving scattered rewards.” · one support sentence naming Phase 1 · **Track my rewards** / Sign in. No cards, no stats, no badges. |
| 2 | Problem | Name the pain | Scattered rewards across Binance / OKX / Monad / LUNC → three apps + a spreadsheet. |
| 3 | How it works | Teach the flow | Ordered 3 steps: Connect → Sync → Attest. Numbers earn their place (real sequence). |
| 4 | Sources | Honest Phase 1 | Binance Simple Earn · OKX savings/earn · Monad staking · LUNC stake. Explicit “not every chain yet.” |
| 5 | Checkpoint | Differentiator | `EarningsCheckpoint` on Monad — Merkle-style root, explorer-verifiable. Show a mono hash artifact as visual proof motif. |
| 6 | Blog | Depth / SEO | Tease 3 editorial posts + link to `/blog` (21 posts exist). |
| 7 | Closing CTA | Convert | Short restate + Track my rewards. |
| 8 | Footer | Wayfinding | Host + Blog + Sign in |

## Motion (DESIGN.md)

1. Wordmark / hero copy rise (~600ms, expressive ease-out).
2. Soft cyan radial pulse behind brand (8s opacity loop).
3. CTA underline draw on hover (150–200ms).
4. How-steps sibling stagger on view (transform/opacity only; not uniform section fades).
5. `prefers-reduced-motion: reduce` → no pulse / entrance / stagger.

## Anti-goals

- No inventing Phase 2 chains as live.
- No hero metric strips, floating badges, or identical icon-card grids.
- No dashboard load work (sorting / aggregates / skeletons) — other agent owns `/app`.
- No Zerion/Koinly/APY-farm positioning.

## Success

First viewport reads as one composition with YieldScope as the hero signal. Scroll tells problem → path → honest sources → proof → reading → CTA. Copy stays Sage/Everyman: rewards, ledger, checkpoint, fail-closed.
