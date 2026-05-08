# Experimental Todos

A collection of experimental interactive prototypes exploring the intersection of **typography**, **physics simulation**, and **task management UI**. Each project transforms text into a physical medium — letters that fall, bounce, pile up, and form landscapes.

---

## Projects

| Project | Description | Tech Stack |
|---------|-------------|------------|
| [**Mountain Todo**](./mountain-todo/) | Todo app where completed items form a mountain landscape with a climbing character | Vanilla JS, p5.js, Matter.js |
| [**Typographic Gravity**](./typographic-gravity/) | Interactive canvas where typed characters become physics objects that pile up | Vanilla JS, p5.js, Matter.js |

---

## Repository Structure

```
Experimental Todos/
├── assets/                      # Shared assets across all projects
│   └── fonts/                   # Self-hosted Inter (.woff2, weights 200/300/400/500/600)
│
├── mountain-todo/               # Vanilla JS todo app with mountain landscape
│   ├── app.js                   # All application logic (~1200 lines)
│   ├── style.css                # Styles + font-face declarations
│   ├── lib/                     # Self-hosted p5.min.js + matter.min.js
│   └── index.html               # HTML structure
│
├── typographic-gravity/         # Interactive typing + physics canvas
│   ├── sketch.js                # p5.js + Matter.js physics simulation
│   ├── style.css                # Dark theme control panel styles
└── └── index.html               # Main demo page (loads p5/Matter from cdnjs)
```

---

## Shared Technology

### Core Algorithms (shared across projects)
These algorithms appear in both Typographic Gravity and Mountain Todo:

- **Glyph Extraction** — Renders characters to an offscreen canvas, thresholds alpha to binary, extracts boundary pixels, computes convex hull, simplifies with RDP to ≤12 vertices for efficient physics collision shapes.
- **Convex Hull** — Andrew's monotone chain algorithm, O(n log n).
- **RDP Simplification** — Ramer-Douglas-Peucker recursive line simplification.
- **Heightmap** — 1D array tracking the highest settled body per screen column, used for terrain navigation.
- **Climbing Agent** — Stick figure that finds the highest peak in the heightmap and walks/climbs toward it with procedural limb animation.

### Physics Engine
- **Matter.js** — Full 2D rigid-body physics with sleeping, compound bodies, and convex polygon collision. Used by both projects.

---

## Running Locally

### Mountain Todo
```bash
npx serve . -l 3456
# Open http://localhost:3456/mountain-todo/
```

### Typographic Gravity
```bash
npx serve . -l 3458
# Open http://localhost:3458/typographic-gravity/
```

### Accessing from another device (phone, tablet)
Both dev servers bind to `0.0.0.0` by default, so any device on the same WiFi can reach them. Find your machine's LAN IP with `ipconfig getifaddr en0` (macOS) and replace `localhost` with that address — e.g. `http://192.168.1.42:3456/mountain-todo/`.

---

## Typography

The original prototypes used **TWK Lausanne** (commercial). For this open-source release, every project ships **Inter** (self-hosted from `assets/fonts/`) — no external font CDNs, no license issues.

**Heads up:** the recorded demo videos still show TWK because they were captured pre-migration. Inter has wider metrics and a less geometric feel, so the live experience looks a little less polished than the videos. Every interaction and physics behavior is identical — only the letterforms differ. If you have a TWK Lausanne license and want the original look, drop the `.woff2` files into `assets/fonts/` and rename the `font-family` declarations.
