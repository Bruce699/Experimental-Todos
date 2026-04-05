# Mountain Todo

A full-screen todo application where completing tasks causes their text to **fall as individual physics-driven letters** that pile up into a **mountain landscape** at the bottom of the screen. A small **climbing agent** (stick figure) autonomously navigates the mountain, searching for the highest peak. Includes an undo system that animates letters back from the mountain into the list.

---

## Product Requirements

### Core Experience
- Full-screen mobile-first todo list occupying the top ~75% of the viewport
- Bottom ~25% is a live mountain landscape built from completed todo text
- Each completed todo's characters fall individually (with a right-to-left stagger cascade), settle via physics, and become part of the mountain
- A climbing character walks and climbs the mountain, always heading for the highest peak
- Undo reverses completion: letters rise from the mountain and fly back to their list position

### Interaction Model
- **Tap the ring** next to a todo item to complete it (triggers falling letter animation)
- **Tap the undo button** (appears after completions) to reverse the most recent completion
- **Type in text fields** — contentEditable divs with Enter to create new items, Backspace to merge/delete
- **Paste multi-line text** — auto-splits into separate todo items
- **Navigate dates** — chevron arrows switch between days (each day has its own list + mountain)

### Visual Design
- Clean white background with dark text (TWKLausanne 300 weight, 19px)
- Todo list fades into the mountain zone via CSS mask gradient
- Mountain rendered as multi-layer silhouettes with decreasing opacity and increasing blur
- Climber rendered as a simple stick figure with procedural walk/climb animation

---

## Architecture

```
mountain-todo/
├── app.js           # ALL application logic: physics, rendering, UI, undo (~1200 lines)
├── style.css        # Layout, typography, animations (fonts from ../assets/fonts/)
├── index.html       # HTML structure (date header, todo list, mountain canvas zone)
```

**Dependencies (loaded via CDN):**
- **p5.js** v1.9.0 — Canvas rendering and animation loop
- **Matter.js** v0.19.0 — 2D physics engine (rigid bodies, sleeping, collision)

---

## How It Works — Mechanism Deep Dive

### 1. Glyph Extraction Pipeline (app.js → `getGlyphData()`)

Every character that falls needs a physics collision shape derived from its actual glyph outline:

```
Character + font size
  → Render to offscreen canvas (white on transparent)
  → Read pixel data, threshold alpha > 80 → binary grid
  → Find boundary pixels (any filled pixel adjacent to empty)
  → Compute convex hull (Andrew's monotone chain, O(n log n))
  → Simplify with Ramer-Douglas-Peucker to ≤12 vertices
  → Create character image canvas for rendering
  → Cache everything keyed by "char|size"
```

**Why ≤12 vertices?** Matter.js performance degrades with complex polygons. The RDP simplification preserves the character's recognizable shape while keeping physics fast.

**Key location:** `app.js`, `getGlyphData()` function.

### 2. Completion → Falling Letters (app.js → `completeTodo()`)

When a user taps the completion ring:

```
1. MEASURE — Use Range API to get each character's bounding rect from the DOM
2. SPAWN — Create pending letter entries with staggered release times
   → Right-to-left cascade: rightmost chars fall first, creating a "peeling" effect
   → Delay = (maxX - charX) / xRange × maxDelayFrames
3. RING ANIMATION — CSS pulse animation on the ring (scale up → fade out)
4. UNDO STACK — Push completion data (text, settled letter indices, item data)
5. COLLAPSE — FLIP animation: measure before/after DOM positions, animate translateY
```

**Two fall modes:**
| Mode | Behavior |
|------|----------|
| `letter` (default) | Each character gets its own physics body (glyph-shaped via convex hull) |
| `word` | Each word gets a single rectangular body; characters are rendered at offsets from body center |

**Key location:** `app.js`, `completeTodo()` and `spawnFallingChars()` functions.

### 3. Physics Simulation (app.js → `releasePendingLetters()` + Matter.js)

p5.js `draw()` loop drives the simulation at 60fps:

```
Per frame:
  1. Matter.Engine.update()           ← Step physics world
  2. releasePendingLetters()          ← Release stagger-delayed letters into physics
  3. updateActiveLetters()            ← Check for settled letters (see below)
  4. rebuildHeightmap()               ← Update terrain profile every 5 frames
  5. Render mountain layers           ← Multi-layer silhouettes
  6. Render settled letters           ← Static text at final positions
  7. Render active (falling) letters  ← Dynamic physics bodies
  8. Update & render climber          ← Stick figure navigation
```

**Key location:** `app.js`, `draw()` function (p5.js entry point).

### 4. Mountain Building (app.js → `updateActiveLetters()`)

The mountain grows through a **sleep → freeze → static** pipeline:

```
For each active (falling) letter:
  If body.isSleeping for 60+ consecutive frames:
    → Save {char, x, y, angle, size} to day.settledLetters
    → Convert physics body to static (Body.setStatic(body, true))
    → Future letters now collide with and pile ON TOP of this letter
    → Remove from activeLetters array
```

This is the core mountain-building mechanism: settled letters become terrain that new letters stack upon.

**Key location:** `app.js`, `updateActiveLetters()` function.

### 5. Mountain Rendering (app.js → `draw()`)

Mountains are rendered as layered silhouettes using the heightmap:

```
For each layer (0 to mountainDayCount):
  → Offset heightmap vertically by layer × mountainLayerOffset
  → Set opacity: mountainOpacityBase - layer × mountainOpacityFalloff
  → Set blur: mountainBlurBase + layer × mountainBlurFalloff
  → Draw filled shape from heightmap profile to ground line
```

Back layers are fainter and blurrier, creating a parallax depth effect. The front layer is the current day's actual letter pile.

**Key location:** `app.js`, mountain rendering section in `draw()`.

### 6. Heightmap (app.js → `rebuildHeightmap()`)

A 1D `Float32Array` with one entry per screen pixel column, storing the highest point of any solid surface:

```
1. Fill with groundY (bottom of screen)
2. For each settled letter:
   → At columns [x - halfWidth, x + halfWidth], set min(current, letter.y - offset)
3. For each active sleeping body:
   → Walk physics body vertices, interpolate edge heights per column
```

The climbing agent reads this heightmap to know where the "ground" is at any x-position.

**Key location:** `app.js`, `rebuildHeightmap()` function.

### 7. Climbing Agent (app.js → `Climber` class)

A procedurally animated stick figure:

```
Per frame:
  1. FIND TARGET — Scan heightmap for lowest y-value (highest point)
  2. MOVE — Spring-damped horizontal acceleration toward target
     vx += sign(dx) × 0.1 × climberSpeed; vx *= 0.85
  3. SURFACE TRACKING — Snap y to heightmap surface minus body height
     If above surface: apply gravity. If below: lerp upward.
  4. ANIMATE LIMBS — Procedural walk cycle:
     walkPhase += speed × 0.15
     Feet: sin(walkPhase) × stride along surface
     Arms: opposite phase; reach upward when climbing steep terrain
  5. LOOK-UP POSE — After new letters fall, climber pauses and looks up
```

The climber has two modes: **walking** (arms swing at sides, legs stride) and **climbing** (arms reach upward, shorter stride) based on slope steepness.

**Key location:** `app.js`, `Climber` class.

### 8. Undo System (app.js → `triggerUndo()`)

Two-phase animation:

```
Phase 1: RISING (undoRiseTime = 0.7s)
  → Letters float upward from settled mountain positions
  → Move to a staging y-position above the list
  → Color shifts to undoFloatColor (#5030EF)
  → Size interpolates from settled size to original font size

Phase 2: RETURNING (undoReturnTime = 0.5s)
  → Letters fly from staging area to their original DOM positions
  → Each letter targets its original (x, y) from when the todo was completed
  → On completion: re-insert the todo item into the list
  → Remove letters from settledLetters, remove static bodies from physics
  → Rebuild heightmap (mountain shrinks)
```

**Key location:** `app.js`, `triggerUndo()` and `updateUndoAnimation()` functions.

---

## Key Configuration (CONFIG object in app.js)

| Parameter | Default | What it controls |
|-----------|---------|-----------------|
| `gravity` | 1.2 | Matter.js world gravity |
| `bounce` | 0.8 | Restitution (bounciness) of letter bodies |
| `friction` | 0.7 | Surface friction between letters |
| `mountainZoneRatio` | 0.25 | Bottom 25% of viewport reserved for mountain |
| `climberSpeed` | 1.5 | Horizontal acceleration multiplier for climber |
| `staggerDelay` | 1.2 | RTL cascade timing (higher = slower cascade) |
| `fallMode` | `'letter'` | `'letter'` = individual chars, `'word'` = word groups |
| `undoRiseTime` | 0.7 | Seconds for undo rise animation |
| `undoReturnTime` | 0.5 | Seconds for undo return animation |
| `mountainOpacityFalloff` | 0.20 | Opacity decrease per mountain layer |
| `mountainBlurFalloff` | 0.8 | Blur increase per mountain layer (px) |

---

## Running

```bash
# From the repository root:
npx serve . -l 3456
# Open http://localhost:3456/mountain-todo/
```

No build step required — vanilla JS served directly.
