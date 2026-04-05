# Elastic Todo

A mobile-first todo application where completing a task triggers a **physics-based letter animation** — each character in the completed text becomes an independent particle that falls, collides, and settles at the bottom of the screen. In "string mode," letters stay connected by elastic constraints, creating a thread-like unraveling effect.

---

## Product Requirements

### Core Experience
- Users manage daily todo items with a simple, distraction-free interface
- Completing a todo triggers a satisfying physics animation: the text transforms from static list item into falling letter particles
- Fallen letters accumulate at the bottom, creating a visual artifact of the day's completed work
- Date navigation lets users switch between days (each day has its own todo list and fallen letters)

### Interaction Model
- **Tap the ring** to complete a todo (triggers the fall animation)
- **Type in text fields** — contentEditable divs with Enter to split, Backspace to merge
- **Paste multi-line text** — automatically splits into multiple todo items
- **Swipe date arrows** — navigate between days
- **Device tilt** (mobile) — accelerometer controls gravity direction for fallen letters

### Physics Modes
| Mode | Behavior |
|------|----------|
| **Falling** (default) | All letters unlock simultaneously with random velocity kicks, fall freely |
| **String** | First letter stays pinned; letters unravel right-to-left like pulling a thread, connected by distance constraints |

### Tuning Panel
A hidden `lil-gui` panel (accessible via code) exposes all configurable parameters: colors, physics constants, collision settings, typography, and visual options.

---

## Architecture

```
elastic-todo/
├── src/
│   ├── App.jsx          # React component: UI, DOM↔physics bridge, animation loop
│   ├── physics.js       # Verlet physics engine: strings, constraints, collision
│   ├── style.css        # All styles, font-face, layout
│   └── main.jsx         # Entry point
├── public/
│   ├── fonts/           # TWKLausanne WOFF2 (250, 300, 400, 500)
│   └── chevron-left.svg # Navigation arrow
├── index.html           # HTML shell
├── package.json         # Dependencies
└── vite.config.js       # Vite dev server (port 3457, HTTPS, network access)
```

---

## How It Works — Mechanism Deep Dive

### 1. Text Measurement (App.jsx → `measureCharPositions()`)

When a todo is completed, we need exact (x, y) coordinates for every character in the text.

```
User taps ring → handleComplete(item)
  → Read DOM element's bounding rect
  → Use Pretext library for proper line-breaking at the element's width
  → Map each grapheme cluster to an (x, y, width) using canvas measureText
  → Adjust for scroll offset (positions are in app-frame coordinates)
```

**Key file:** `src/App.jsx`, lines around `measureCharPositions()` function.

The [Pretext](https://github.com/chenglou/pretext) library handles Unicode-aware line breaking. Canvas `measureText` gives per-character widths. Together they produce layout-accurate positions matching what the browser rendered.

### 2. Physics String Creation (physics.js → `addStrings()`)

Character positions are grouped into visual lines, and each line becomes an `ElasticString`:

```
charData [{char, x, y, w}, ...]
  → Group by y-position into lines
  → For each line: create ElasticString
     → Each char → LetterPoint(x, y, width, locked=true)
     → Compute rest lengths between consecutive letters
     → Rest length = actual distance × constraintDist (default 1.1×)
```

**Key file:** `src/physics.js`, `addStrings()` method.

### 3. Cross-Off Trigger (physics.js → `crossOffItem()`)

Two modes of unlocking:

**Falling mode** (`stringMode: false`, default):
- All letters unlock simultaneously
- Each gets a small random downward + horizontal velocity kick
- No constraints between letters — they fall independently

**String mode** (`stringMode: true`):
- Letter[0] (leftmost) stays permanently pinned at its home position
- Letters unlock progressively from right to left (`unravelSpeed` per frame)
- Distance constraints keep consecutive letters within `constraintDist × rest` of each other
- Creates a dangling thread effect as gravity pulls the unlocked end down

**Key file:** `src/physics.js`, `crossOffItem()` method.

### 4. Physics Simulation (physics.js → `simulate()`)

Runs at 120Hz via fixed-timestep accumulator in `App.jsx`.

**Per frame, for each inactive (crossed-off) string:**

```
1. OPACITY INTERPOLATION
   Fade toward target opacity (0.5 for crossed-off items)

2. STRING MODE BOOKKEEPING (if string mode)
   - Keep letter[0] pinned to its scroll-adjusted home position
   - Unravel: unlock next N letters from right-to-left
   - Auto-unlock: if a locked letter's unlocked neighbor drifts past threshold

3. VERLET INTEGRATION (all unlocked letters)
   vx = (x - previousX) × damping
   vy = (y - previousY) × damping
   newX = x + vx + gravity × gravityX   ← gravityX from accelerometer
   newY = y + vy + gravity × gravityY

4. DISTANCE CONSTRAINTS (string mode only, N iterations)
   For each consecutive pair (a, b):
     If distance > restLength: pull them closer
     Locked letters don't move; force goes entirely to the unlocked one

5. INTER-STRING COLLISION
   All unlocked letters from different strings repel if overlapping
   (Skip adjacent letters within same string — constraints handle those)

6. STATIC BODY COLLISION
   Fallen letters bounce off bounding boxes of active todo items
   → Creates the visual of text tumbling around the list

7. BOUNDARY CONSTRAINTS
   Ground (bottom), left wall, right wall
   Bounce factor = boundaryBounce (default 1.0)
```

**Key file:** `src/physics.js`, `simulate()` method.

### 5. DOM Rendering (App.jsx → animation loop)

Each letter is a positioned `<span>` in the `#letter-overlay` div:

```
Per animation frame:
  → world.simulate()  (physics step)
  → For each crossed-off string:
     → For each letter:
        span.style.transform = translate(lp.x, lp.y)
        span.style.opacity = string.opacity
```

No canvas — pure DOM transforms with `will-change: transform` for GPU compositing.

**Key file:** `src/App.jsx`, `tick()` function inside the physics useEffect.

---

## Key Configuration (DEFAULT_CONFIG in physics.js)

| Parameter | Default | What it controls |
|-----------|---------|-----------------|
| `gravity` | 0.195 | Downward acceleration per tick |
| `damping` | 0.97 | Velocity damping (1.0 = no friction, 0.9 = heavy) |
| `constraintDist` | 1.1 | Max gap between letters = 1.1× their original spacing |
| `iterations` | 12 | Constraint solver iterations per step (higher = stiffer strings) |
| `collisionRadius` | 7 | Per-letter collision radius in pixels |
| `boundaryBounce` | 1.0 | Energy retained on wall/ground bounce |
| `unravelSpeed` | 2 | Letters unlocked per frame in string mode |
| `stringMode` | false | false = falling letters, true = elastic string |

---

## Running

```bash
npm install
npm run dev        # Dev server at https://localhost:3457
npm run build      # Production build → dist/
```

Requires HTTPS for device motion API (accelerometer). The Vite config includes `@vitejs/plugin-basic-ssl` for local dev.
