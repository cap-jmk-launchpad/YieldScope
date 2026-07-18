# YieldScope design

**Source:** Majico staging `27834995-58fb-4c5c-98fc-76936193f679` + product surface “Ledger at dusk.”  
Majico owns brand narrative and token roles; product UI stays dark-first for the instrument-panel feel.

Full Majico export: [`docs/majico/DESIGN.md`](docs/majico/DESIGN.md), tokens in [`docs/majico/`](docs/majico/).

## Direction

**Ledger at dusk** — deep ink surfaces, a single cool accent for “earned,” precise type. Feels like an instrument panel for income, not a fintech pastel dashboard.

Avoid: purple-indigo gradients, cream+terracotta, broadsheet hairlines, Inter/Roboto defaults, glow-heavy crypto neon, pill-stat strips in the hero. (Majico marketing export may include light `#ffffff` canvas and a lilac `--accent-muted`; YieldScope product chrome remaps muted accent to cyan-dim, not purple.)

## Color tokens

Majico accent is electric cyan (`#00efff`); dark canvas preserves dusk ink.

| Token | Hex | Role |
|-------|-----|------|
| `--ink` | `#05080f` | App / landing canvas (dusk) |
| `--ink-elevated` | `#0c1524` | Elevated panels |
| `--paper` | `#e8eef6` | Primary text on ink |
| `--mint` / `--accent` | `#00efff` | Earned signal, primary CTA (Majico accent) |
| `--mint-dim` | `#1a6b6b` | Muted accent / hover (product; not Majico lilac) |
| `--warn` | `#f0a060` | Warnings |
| `--error` | `#ff6b6b` | Errors |
| `--muted` | `#8a9bb0` | Secondary text |

Light marketing exports from Majico may use `#ffffff` / `#0a0a0a` / `#00efff`; YieldScope product chrome stays on ink.

## Typography (Majico)

- **Display / headings:** IBM Plex Sans (geometric, strong hierarchy).
- **Body:** IBM Plex Sans for product UI; IBM Plex Serif for long-form blog.
- **Numbers / ledger:** IBM Plex Mono.

Identity-preservation: Majico locked Plex — keep it even if greenfield brand registers ban Plex as a reflex default.

## Brand surface (landing)

- **Composition:** One full-bleed first viewport. Brand name is hero-level. One headline, one sentence, one CTA group. No cards in the hero. No stat strip. No floating badges on media.
- **Background:** Layered ink gradient (`#05080f` → `#0c1524`) with a subtle scan-line / grid texture, plus a soft cyan radial wash behind the wordmark.
- **Headline (locked pitch):** Solving scattered rewards.
- **Support:** Track all your crypto rewards in one place — with Phase 1 sources named honestly.
- **Motion (≥2–3 intentional):**
  1. Wordmark fade+rise on load (~600ms, ease-out expressive).
  2. Soft accent radial pulse behind brand (slow, 8s loop, opacity only).
  3. CTA underline / border draw on hover (150–200ms).
  4. Section border/text settle on scroll (optional, transform/opacity only).
  5. Respect `prefers-reduced-motion: reduce`.

## Product surface (dashboard / connect)

- Restrained ink UI. Plex Sans for titles and interactive chrome; mono for amounts.
- Source status chips: `ok` accent outline, `error` coral, `not_connected` muted — never fake rows.
- Dense event table. Empty state teaches Connect, not “nothing here.”

## Layout rules

- Landing: brand → headline → sentence → CTAs; scroll for How it works / Sources / Checkpoint / Blog.
- App: top bar with YieldScope + wallet; main = total earned + source strip + events; side action = Attest checkpoint.

## Spacing & motion (Majico)

- Spacing: xs 4 · sm 8 · md 16 · lg 24 · xl 40 · 2xl 56
- Duration: micro 140ms · fast 200ms · normal 320ms · emphasis 600ms · choreography 2800ms
- Easing: `cubic-bezier(0.16, 1, 0.3, 1)` (expressive), `cubic-bezier(0.22, 1, 0.36, 1)` (standard)
- Stagger sibling: 100ms · stream: 280ms · hold readable: 1200ms
