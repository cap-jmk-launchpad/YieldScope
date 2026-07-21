---
name: branded-demo-broll
description: >-
  Design and ship branded abstract B-roll / interstitial videos with Remotion
  (code-first, seamless loops, MP4). Use when the user wants demo video plates,
  brand motion backgrounds, abstract product metaphors as loops, Remotion B-roll,
  or asks to design video motion from brand tokens without UI chrome or logos.
---

# Branded Demo B-Roll

Produce **silent, seamless, code-first** abstract video plates for demos and edits — not UI walkthroughs, not logo stings unless asked.

Default stack: **Remotion** → H.264 MP4. Prefer quality and re-renderability over generative AI video.

## When this skill applies

- Demo / pitch / launch edit needs atmospheric plates
- Motif should express the **product metaphor** (not generic particles)
- Brand tokens already exist (or can be extracted)
- Output is loopable B-roll the editor can repeat 2–3×

## Non-goals

- Full promo with type, VO, UI mockups (hand off to product-launch / Remotion markup skills)
- CSS/`animate-*` motion (forbidden in Remotion renders)
- Neon crypto glow, purple-indigo defaults, cream+terracotta AI clichés unless brand requires them

---

## Phase 0 — Grill until locked (one question at a time)

Do not code until these are explicit. Ask **one** question per turn; always give a recommended answer.

Lock in order:

1. **Deliverable** — one combined plate vs **N separate masters** (prefer separate versions for alternate motifs)
2. **Duration / loop** — default **10s @ 30fps**, designed so the editor can loop **2–3×** with no seam flash
3. **Spec** — default `1920×1080`, H.264, **silent**, **no logo/text** (add in edit)
4. **Motifs** — 2–4 product-tied concepts; pick winners; avoid hybridizing into one muddy loop
5. **Tooling** — default **Remotion** (code-first). Canvas+ffmpeg only if Remotion is blocked
6. **Density** — default **restrained-high**: crisp geometry, slow primary motion, 1–2 focal moves; quality = timing + seam + brand discipline, not particle count
7. **Done check** — loop each master 3×; story readable in ~3s; seam invisible; brand colors only

Write a one-page lock table before scaffolding.

---

## Phase 1 — Brand → theme object

Extract from product `DESIGN.md` / `BRAND.md` / CSS tokens:

| Role | Use in video |
|------|----------------|
| Canvas / ink | Full-bleed background |
| Elevated surface | Soft radial depth |
| Accent | Primary motion / “signal” |
| Muted | Grid, secondary strokes |
| Paper / text | Peak highlights only (sparingly) |

Create a single `theme.ts` (or equivalent):

- colors
- easings (`out` / `inOut` / `in` — **never linear**)
- timing tokens in **seconds** (convert with `fps`)
- video config (`width`, `height`, `fps`, `durationInFrames`)

**Rule:** no inline hex or easings inside compositions.

---

## Phase 2 — Motif = product metaphor

Abstract B-roll must answer: *what does the product do in one visual sentence?*

| Bad | Good |
|-----|------|
| Generic particle field | Metaphor of the core user win |
| Labeled lanes / logo | Geometry only (sources = weight/color, not text) |
| One sine ribbon “wave” | Intentional graphic language (see below) |

**Concept menu pattern** (adapt to domain):

1. **Scattered → one** — fragments consolidate into a single signal
2. **Many lanes → pulse** — parallel inputs braid/lock into one outcome
3. **Seal / checkpoint** — loose ticks settle into a locked mark
4. **Scan & isolate** — field stays quiet; one row/element verifies

Ship **separate compositions** for chosen concepts (same technical spec).

---

## Phase 3 — Graphic language for motion fields

When the motif involves “waves,” “streams,” or “fields,” **choose a designed unit** — do not default to stroked sine paths.

| Language | Feel | Use when |
|----------|------|----------|
| **Blocks / bars** | Instrument panel, data, EQ-meets-surface | Aggregation, sources, metrics |
| **Particles** | Foam, foam-on-crest, constellation | Scattered inputs, soft density |
| **Bands / ribbons** | Aura-like geometric waves | High-frequency abstract fields |
| **Hybrid** | Bars sample a surface; particles ride crests | Ocean / fluid + product clarity |

**Ocean / fluid fields** (if metaphor fits): use **multi-layer** motion — swell + sea + chop (or domain equivalent) — not a single frequency. Sample the surface into discrete units (bars/particles). Add subtle slope lean / crest emphasis.

Research briefly when stuck: motion principles (easing, stagger, overlapping action), Remotion agent skills, procedural wave/particle references — then commit to one language.

---

## Phase 4 — Motion craft (every composition)

### Narrative arc (even for 10s loops)

Seamless loop still needs story phases inside the cycle:

`anticipate → converge/payoff → hold (readable) → release → settle`

- **Hold** ≈ 1–1.2s equivalent at peak so the thesis registers
- Frame 0 visual state must match end-of-loop (periodic envelopes / wrap-safe travel)
- Prefer `0.5 - 0.5 * cos(2π t)` style pulses for seamless 0→1→0

### Layers (minimum)

1. **Background** — slowest, atmospheric (grid drift, soft washes, vignette base)
2. **Primary** — the metaphor (bars / particles / streams)
3. **Secondary** — follow-through (traveling energy, crest foam, ticks, rings)
4. **Polish** — color grade → film grain → vignette (above graphics)

### Timing rules

- Drive everything from `useCurrentFrame()` + `interpolate` / `spring`
- Easing: brand expressive out for converge; editorial inOut for state blends; faster **exits** than entrances
- **Stagger** by hierarchy (important elements move first), ~50–120ms equivalent
- **Idle breathe** on anything visible >2s (tiny sin micro-motion)
- Derive delays from `fps` / theme timing tokens — no magic frame literals scattered around

### Remotion hard rules

- No CSS transitions / Tailwind `animate-*`
- Always `extrapolateLeft/Right: "clamp"` unless intentionally unbounded
- Deterministic only (`random("seed")` if needed — never `Math.random()`)
- Opt-in package (don’t tangle with app build); pin render `--port` on Windows if port scan fails

Companion skills (install if useful): `remotion-dev/skills`, remotion-motion-graphics, remotion-motion-designer.

---

## Phase 5 — Scaffold & ship

```
demo-broll/   (or packages/demo-broll)
  src/
    theme.ts
    motion.ts          # loopPulse, storyProgress, stagger, breathe
    ocean.ts           # optional domain field math
    components/        # InkBackground, PolishStack
    compositions/      # one file per motif
    Root.tsx
    index.ts
  scripts/render-all.mjs
docs/demo/broll/       # MP4 outputs + README
```

**Render defaults:** H.264, high jpeg quality / moderate CRF, concurrency 1 if unstable, overwrite outputs.

**Verify before done:**

- [ ] Each master loops 3× with no flash
- [ ] Motif readable in ~3 seconds
- [ ] Brand colors only; no text/logo
- [ ] Separate files if multiple concepts
- [ ] Studio preview + render script documented

---

## Iteration order

When the user says “make it better,” improve in this order:

1. **Graphic language** (blocks/particles vs ribbons) — biggest taste win  
2. **Field math** (multi-layer / anticipation / gather)  
3. **Story phases / hold**  
4. **Polish stack** (grade/grain/vignette)  
5. **Encode quality**  

Do not add density without purpose.

---

## Output checklist for the agent

1. Lock table (spec + motifs + done check)
2. Theme from brand tokens
3. Remotion package + one composition per motif
4. Rendered MP4s in a stable docs/assets path
5. Short README: files, concept, render commands
6. Optional: list which motion skills informed the pass

## Anti-patterns

- Combining two motifs into one 10s loop “to save files”
- Logo/wordmark in B-roll when the edit will overlay brand anyway
- Linear easing, simultaneous entrances, opacity-only motion
- Single sine wave sold as “ocean”
- Shipping without a 3× loop check
