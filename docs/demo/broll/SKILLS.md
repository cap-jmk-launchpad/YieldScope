# B-roll motion skills applied

Skills installed for YieldScope demo B-roll craft:

| Skill | Source | What it adds |
|-------|--------|----------------|
| `remotion-best-practices` (+ markup/render/…) | remotion-dev/skills | Frame-driven `interpolate`, bezier easing, no CSS anim |
| `remotion-motion-designer` | myceldigital/remotion-claude-skill | Narrative arc, motion layers, 12 principles |
| `remotion-motion-graphics` | haidrrrry/claude-remotion-skill | Five-layer stack, grain/grade/vignette, idle breathe, theme |
| `motion-designer` | dylantarre/animation-principles | Disney principles for purposeful motion |
| `motion-system` | owl-listener/designer-skills | Motion system / tokens thinking |
| `product-launch-video` | heygen-com/hyperframes | Storyboard / launch pacing (reference) |

## Concept upgrades from skills

1. **Theme object** (`src/theme.ts`) — colors + easings + timing in one place  
2. **Polish stack** — cyan soft-light grade → film grain → vignette  
3. **Idle breathe** — ocean amp / scene scale micro-motion while looping  
4. **Story phases** kept — anticipate → converge → hold → release (narrative gravity)  
5. **Ocean blocks + particles** — primary graphic language unchanged, now graded

## Commands

```bash
pnpm demo:broll:studio
pnpm demo:broll
```
