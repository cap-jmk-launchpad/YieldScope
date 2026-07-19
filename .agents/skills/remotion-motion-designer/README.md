# remotion-motion-designer

Elite motion design Claude skill for Remotion — produces broadcast-quality animated videos that look like a $50K studio made them.

## What this does

When installed as a Claude skill, it transforms Claude into a professional motion design studio. Describe your video in plain English, get complete, render-ready Remotion code with:

- Narrative arc (setup → anticipation → reveal → settle)
- Layered motion (primary, secondary, tertiary — never flat)
- Spring physics tuned for specific moods (bouncy, snappy, buttery, heavy)
- Audio-reactive visuals, 3D content, cinematic polish
- The 12 Principles of Animation coded into every output

## Install

### Option 1: Claude Code / Cursor / Windsurf
```bash
# Copy to your skills directory
cp -r remotion-motion-designer ~/.claude/skills/

# Or add to project-level skills
cp -r remotion-motion-designer .claude/skills/
```

### Option 2: Claude Projects (claude.ai)
Copy the contents of `SKILL.md` into your Claude Project's custom instructions.

### Prerequisite: Remotion project
```bash
# Create a Remotion project with official agent skills
npx create-video@latest
# Say YES to "Add Remotion Agent Skills?"
```

This skill layers professional motion design craft on top of the official Remotion Agent Skills foundation.

## Skill structure

```
remotion-motion-designer/
├── SKILL.md                          # Main skill (258 lines)
└── references/
    ├── spring-configs.md             # Tested spring presets for every mood
    ├── animation-patterns.md         # 12 Principles coded + common patterns
    ├── workflow.md                   # Planning/storyboarding methodology
    ├── audio-reactive.md             # Audio viz + beat sync techniques
    └── cinematic-polish.md           # Motion blur, grain, camera, depth
```

## Example prompt

> "Create a 12-second premium brand reveal for a futuristic AI hardware product. Dark cinematic palette, orchestral swell feeling at 4s, logo reveal at 7s with particle burst. Make it feel like Apple keynote quality."

Claude will plan the timing structure, choose appropriate spring configs, layer the motion, and output complete paste-ready TypeScript files.

## License

MIT
