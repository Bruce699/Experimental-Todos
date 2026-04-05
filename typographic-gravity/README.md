# Typographic Gravity

An interactive canvas where every keystroke spawns a **physics-driven letter** that falls, bounces, and piles up. Characters drop from positions mapped to the QWERTY keyboard layout, creating a spatial relationship between typing and where letters land. A small **climbing agent** (stick figure) autonomously navigates the growing letter pile, always heading for the highest peak.

---

## Architecture

```
typographic-gravity/
├── sketch.js          # Main p5.js + Matter.js simulation (618 lines)
├── style.css          # Dark theme, frosted-glass control panel
└── index.html         # Interactive demo (type to spawn letters)
```

**Dependencies (loaded via CDN):**
- **p5.js** v1.9.0 — Canvas rendering and animation loop
- **Matter.js** v0.19.0 — 2D physics engine

---

## How It Works

### Keyboard → Letter Position Mapping (sketch.js)

Each key on a QWERTY keyboard is mapped to a normalized x-position (0–1):

```
Row 1: `1234567890-=     → starts at x=0.00
Row 2: qwertyuiop[]\     → starts at x=0.03  (staggered like real keyboard)
Row 3: asdfghjkl;'       → starts at x=0.06
Row 4: zxcvbnm,./        → starts at x=0.09
Space:                    → x=0.50 (center)
```

The normalized x is scaled to the canvas width with margins, plus small random jitter. This means typing "q" drops a letter near the left, "p" drops near the right — the letter pile's shape reflects what you type.

### Glyph Extraction Pipeline (sketch.js → `getGlyphData()`)

Each character needs a collision shape for the physics engine:

```
1. Render character to offscreen canvas (white on transparent)
2. Threshold alpha channel > 80 → binary pixel grid
3. Find boundary pixels (filled pixels adjacent to empty)
4. Compute convex hull (Andrew's monotone chain algorithm)
5. Simplify hull to ≤12 vertices (Ramer-Douglas-Peucker)
6. Create character image canvas for visual rendering
7. Cache result keyed by "char|size"
```

### Physics (sketch.js → Matter.js)

- Letters spawn at y=-60 (above viewport) with slight random angular velocity
- Ground at `windowHeight - 20px`, walls at screen edges
- Bodies use `fromVertices()` with the glyph's convex hull
- `enableSleeping: true` — letters that stop moving enter sleep state
- Sleeping letters are used for heightmap calculation

### Heightmap (sketch.js → `rebuildHeightmap()`)

A 1D array (one entry per pixel column) tracking the highest point of any sleeping physics body. Updated every 5 frames. The climbing agent reads this to navigate the terrain.

### Climbing Agent (sketch.js → `ClimbingAgent` class)

A procedural stick figure that:
1. Scans the heightmap for the highest peak
2. Accelerates toward it with spring-damped movement
3. Snaps to the surface, applying gravity when airborne
4. Animates limbs with sine-wave walk cycles
5. Switches to climbing pose (arms up) on steep terrain

### Control Panel

Frosted-glass panel (top-right) with:
- **Seed** — Deterministic random seed with prev/next/random controls
- **Gravity** — 0.1–3.0 (default 1.0)
- **Letter Size** — 24–120px (default 40)
- **Bounce** — 0–0.8 (default 0.2)
- **Friction** — 0.01–1.0 (default 0.6)
- **Agent Speed** — 0.5–4.0 (default 1.5)
- **Random Size** — Checkbox, randomizes each letter between 50–100% of base size
- **Stats** — Live letter count, pile height, agent altitude, sleeping ratio
- **Actions** — Reset parameters, clear all letters, export PNG

---

## Running

```bash
# From the repository root:
npx serve . -l 3458
# Open http://localhost:3458/typographic-gravity/
```

For the footer variant: `http://localhost:3458/typographic-gravity/footer.html`

No build step required — vanilla JS served directly.
