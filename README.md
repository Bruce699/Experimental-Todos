# Experimental Todos

A collection of experimental interactive prototypes exploring the intersection of **typography**, **physics simulation**, and **task management UI**. Each project transforms text into a physical medium — letters that fall, bounce, pile up, and form landscapes.

---

## Projects

| Project | Description | Tech Stack |
|---------|-------------|------------|
| [**Elastic Todo**](./elastic-todo/) | Todo app where completed items collapse into falling elastic letter strings | React 19, Vite, custom Verlet physics |
| [**Mountain Todo**](./mountain-todo/) | Todo app where completed items form a mountain landscape with a climbing character | Vanilla JS, p5.js, Matter.js |
| [**Typographic Gravity**](./typographic-gravity/) | Interactive canvas where typed characters become physics objects that pile up | Vanilla JS, p5.js, Matter.js |

---

## Repository Structure

```
Experimental Todos/
├── assets/                      # Shared assets across all projects
│   ├── fonts/                   # Self-hosted Inter (.woff2, weights 200/300/400/500/600)
│   └── icons/                   # Shared SVG icons (chevron, undo)
│
├── elastic-todo/                # React + Vite todo app with elastic string physics
│   ├── src/
│   │   ├── App.jsx              # Main React component, DOM ↔ physics bridge
│   │   ├── physics.js           # Verlet physics engine (strings, constraints, collision)
│   │   ├── style.css            # Styles + font-face declarations
│   │   └── main.jsx             # React entry point
│   ├── public/                  # Vite static assets (fonts, icons)
│   ├── index.html               # HTML shell
│   ├── package.json             # Dependencies: react, lil-gui, @chenglou/pretext
│   └── vite.config.js           # Dev server config (port 3457, HTTPS)
│
├── mountain-todo/               # Vanilla JS todo app with mountain landscape
│   ├── app.js                   # All application logic (~1200 lines)
│   ├── style.css                # Styles + font-face declarations
│   └── index.html               # HTML structure
│
├── typographic-gravity/         # Interactive typing + physics canvas
│   ├── sketch.js                # p5.js + Matter.js physics simulation
│   ├── style.css                # Dark theme control panel styles
└── └── index.html               # Main demo page
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

### Physics Engines
- **Matter.js** (Typographic Gravity, Mountain Todo) — Full 2D rigid-body physics with sleeping, compound bodies, and convex polygon collision.
- **Custom Verlet** (Elastic Todo) — Position-based integrator with distance constraints for elastic string behavior.

---

## Running Locally

### Mountain Todo
```bash
npx serve . -l 3456
# Open http://localhost:3456/mountain-todo/
```

### Elastic Todo
```bash
cd elastic-todo
npm install
npm run dev
# Opens at https://localhost:3457
```

### Typographic Gravity
```bash
npx serve . -l 3458
# Open http://localhost:3458/typographic-gravity/
```

---

## Typography

The original prototypes used **TWK Lausanne** (commercial). For this open-source release, every project ships **Inter** (self-hosted from `assets/fonts/`) — no external font CDNs, no license issues.

**Heads up:** the recorded demo videos still show TWK because they were captured pre-migration. Inter has wider metrics and a less geometric feel, so the live experience looks a little less polished than the videos. Every interaction and physics behavior is identical — only the letterforms differ. If you have a TWK Lausanne license and want the original look, drop the `.woff2` files into `assets/fonts/` and rename the `font-family` declarations.
