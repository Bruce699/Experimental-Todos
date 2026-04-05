// ═══════════════════════════════════════════════════════════════
// Elastic String Physics — Verlet integration with distance
// constraints, modeled after pushmatrix/textstring.
// Each letter is a point mass. Consecutive letters (in string
// order) are connected by distance constraints capped at 1.2×
// their original spacing. The "string" is invisible — only the
// letters are rendered as DOM elements.
//
// Architecture: This file implements a custom Verlet-integration
// physics engine for elastic string animations. Each completed
// todo item becomes an "elastic string" of letter particles
// connected by distance constraints. The letters fall with
// gravity while maintaining their string connections. The engine
// runs at a fixed 120Hz timestep (driven by App.jsx) and writes
// positions directly to LetterPoint objects, which the React
// layer reads each frame to update DOM transforms.
// ═══════════════════════════════════════════════════════════════

export const DEFAULT_CONFIG = {
  // Colors
  bgColor: '#FFFFFF',
  textColor: '#353535',
  ringColor: '#888888',
  ringCheckedBg: '#0099FF',
  crossColor: '#0099FF',
  dateColor: '#0099FF',
  dateNavColor: '#888888',
  dateNavBorder: 'transparent',
  checkedTextColor: '#0099FF',
  crossedOffOpacity: 0.5,

  // Layout
  frameWidth: 430,
  frameHeight: 932,

  // Typography
  fontSize: 19,
  lineHeight: 27,
  lineSpacing: 1.4,
  font: '300 19px TWKLausanne, sans-serif',

  // Physics
  stringMode: false,         // false = falling letters, true = elastic string
  constraintDist: 1.1,      // max gap = 1.1× original gap (string mode only)
  iterations: 12,            // constraint solver iterations per step
  damping: 0.97,             // velocity damping (verlet)
  gravity: 0.195,            // gravity per tick
  unlockThreshold: 1,        // distance past rest to auto-unlock neighbor

  // Collision
  collisionEnabled: true,
  collisionRadius: 7,        // radius per letter for collision

  // Boundary
  boundaryBounce: 1.0,       // max bounce

  // Visual
  showDebugPoints: false,

  // Unravel
  unravelSpeed: 2,          // letters unlocked per frame during unravel
}

// A single letter particle
class LetterPoint {
  constructor(char, x, y, w, readingIdx) {
    this.char = char
    this.w = w             // measured character width
    this.x = x
    this.y = y
    this.ox = x            // original x (home position)
    this.oy = y            // original y
    this.px = x            // previous x (verlet)
    this.py = y            // previous y
    this.readingIdx = readingIdx  // index in reading order
    this.locked = true     // locked = stays at home position
  }
}

// One todo item's elastic string
export class ElasticString {
  constructor(id, text, font) {
    this.id = id
    this.text = text
    this.font = font
    this.letters = []       // array of LetterPoint (in string/zigzag order)
    this.restLengths = []   // rest distance between consecutive letters
    this.active = true      // not crossed off
    this.opacity = 1.0
    this.targetOpacity = 1.0
    this.unraveling = false
    this.unravelIdx = -1
    this.domElements = []   // <span> references
  }
}

export class PhysicsWorld {
  constructor(config) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.strings = []
    this.staticBodies = []  // rectangular collision bodies for active items
    this.groundY = this.config.frameHeight - 4
    this.scrollOffset = 0   // current scroll offset of todo-area
    this.gravityX = 0       // horizontal gravity from device tilt
    this.gravityY = 1       // vertical gravity multiplier (1 = down)
  }

  updateConfig(newConfig) {
    Object.assign(this.config, newConfig)
    this.groundY = this.config.frameHeight - 4
  }

  setScrollOffset(offset) {
    this.scrollOffset = offset
  }

  // Update static collision bodies from active todo item positions
  setStaticBodies(bodies) {
    // bodies: [{ x, y, w, h }]
    this.staticBodies = bodies
  }

  // Build one string per wrapped line. Index 0 of each string is pinned (left end fixed).
  //
  // Groups characters into visual lines (by y-position clustering) and creates
  // one ElasticString per line. Rest lengths between consecutive letters —
  // multiplied by constraintDist — define how far apart letters can drift before
  // the distance constraint snaps them back. A constraintDist of 1.0 means
  // letters stay at their exact original spacing; values >1.0 allow slack.
  addStrings(id, text, charData, lineHeight, font) {
    if (charData.length === 0) return []

    // Group characters into visual lines by y position
    const lines = [[0]]
    let currentY = charData[0].y
    for (let i = 1; i < charData.length; i++) {
      if (Math.abs(charData[i].y - currentY) > lineHeight * 0.3) {
        lines.push([i])
        currentY = charData[i].y
      } else {
        lines[lines.length - 1].push(i)
      }
    }

    const strings = []
    for (let li = 0; li < lines.length; li++) {
      const lineIndices = lines[li]
      const lineId = lines.length > 1 ? `${id}_line${li}` : id
      const str = new ElasticString(lineId, '', font)
      str.parentId = id

      for (const idx of lineIndices) {
        const cd = charData[idx]
        str.letters.push(new LetterPoint(cd.char, cd.x, cd.y, cd.w, idx))
        str.text += cd.char
      }

      str.restLengths = []
      for (let i = 0; i < str.letters.length - 1; i++) {
        const a = str.letters[i]
        const b = str.letters[i + 1]
        const dist = Math.hypot(
          (b.ox + b.w / 2) - (a.ox + a.w / 2),
          (b.oy + lineHeight / 2) - (a.oy + lineHeight / 2)
        )
        str.restLengths.push(dist * this.config.constraintDist)
      }

      this.strings.push(str)
      strings.push(str)
    }

    return strings
  }

  removeString(id) {
    this.strings = this.strings.filter(s => s.id !== id && s.parentId !== id)
  }

  getStringsForItem(itemId) {
    return this.strings.filter(s => s.id === itemId || s.parentId === itemId)
  }

  // Cross off all strings for a todo item
  crossOffItem(itemId) {
    const strings = this.getStringsForItem(itemId)
    for (const str of strings) {
      str.active = false
      str.targetOpacity = this.config.crossedOffOpacity

      // Two cross-off modes:
      // - String mode: keeps the first letter pinned (like a nail in the wall) and
      //   unravels right-to-left, progressively unlocking letters like pulling a
      //   thread. The distance constraints keep it connected as a dangling string.
      // - Falling mode: drops all letters at once with small random velocity kicks,
      //   so they scatter independently (no constraints enforced).
      if (this.config.stringMode) {
        // String mode: unravel from right, keep index 0 pinned
        str.unraveling = true
        str.unravelIdx = str.letters.length - 1

        for (let i = 0; i < str.restLengths.length; i++) {
          str.restLengths[i] *= 1.1
        }

        const unlockCount = Math.min(6, str.letters.length)
        for (let i = str.letters.length - 1; i >= str.letters.length - unlockCount; i--) {
          if (i >= 0 && i > 0) {
            str.letters[i].locked = false
            str.letters[i].py = str.letters[i].y - 0.5
          }
        }
        str.unravelIdx = str.letters.length - unlockCount - 1
      } else {
        // Falling mode: unlock ALL letters immediately, small random kick
        str.unraveling = false
        for (const lp of str.letters) {
          lp.locked = false
          lp.py = lp.y - (Math.random() * 1.5 + 0.5)
          lp.px = lp.x + (Math.random() - 0.5) * 2
        }
      }
    }
  }

  // Reposition a string's home positions (for reflow)
  repositionString(id, charData, lineHeight) {
    const str = this.getString(id)
    if (!str || !str.active) return
    for (const lp of str.letters) {
      const cd = charData[lp.readingIdx]
      if (!cd) continue
      if (lp.locked) {
        lp.x = cd.x
        lp.y = cd.y
        lp.px = cd.x
        lp.py = cd.y
      }
      lp.ox = cd.x
      lp.oy = cd.y
    }
  }

  simulate() {
    const cfg = this.config
    const LH = cfg.lineHeight
    const scrollOff = this.scrollOffset

    for (const s of this.strings) {
      // Opacity interpolation
      s.opacity += (s.targetOpacity - s.opacity) * 0.06

      if (s.active) continue // active strings don't simulate

      if (cfg.stringMode) {
        // Keep index 0 (left end) pinned at home position adjusted for scroll
        const lp0 = s.letters[0]
        if (lp0) {
          lp0.x = lp0.ox
          lp0.y = lp0.oy - scrollOff
          lp0.px = lp0.x
          lp0.py = lp0.y
          lp0.locked = true
        }

        // Unravel: progressively unlock letters from right to left
        if (s.unraveling) {
          for (let u = 0; u < cfg.unravelSpeed; u++) {
            if (s.unravelIdx < 1) {
              s.unraveling = false
              break
            }
            const lp = s.letters[s.unravelIdx]
            if (lp.locked) {
              lp.locked = false
              lp.px = lp.x
              lp.py = lp.y - 0.5
            }
            s.unravelIdx--
          }
        }

        // Auto-unlock
        for (let i = s.letters.length - 2; i >= 1; i--) {
          if (s.letters[i].locked && !s.letters[i + 1].locked) {
            const a = s.letters[i], b = s.letters[i + 1]
            const dx = (b.x + b.w / 2) - (a.ox + a.w / 2)
            const dy = (b.y + LH / 2) - (a.oy + LH / 2)
            const dist = Math.hypot(dx, dy)
            if (dist > s.restLengths[i] + cfg.unlockThreshold) {
              a.locked = false
              a.px = a.x
              a.py = a.y
            }
          }
        }
      }

      // Verlet integration: position-based physics where velocity is implicit
      // (current pos - previous pos). Each frame, we compute velocity from the
      // positional delta, apply damping to bleed energy, then advance position
      // by velocity + gravity. No explicit velocity variable is stored.
      for (const lp of s.letters) {
        if (lp.locked) continue
        const vx = (lp.x - lp.px) * cfg.damping
        const vy = (lp.y - lp.py) * cfg.damping
        lp.px = lp.x
        lp.py = lp.y
        lp.x += vx + cfg.gravity * this.gravityX
        lp.y += vy + cfg.gravity * this.gravityY
      }

      // Distance constraints (string mode only): iteratively enforces max distance
      // between consecutive letters. If two letters drift farther apart than their
      // rest length, they are pulled back toward each other. Multiple iterations
      // (cfg.iterations) converge toward a stable solution — more iterations = stiffer
      // string. This is what gives the "elastic string" feel.
      if (!cfg.stringMode) continue
      for (let iter = 0; iter < cfg.iterations; iter++) {
        for (let i = 0; i < s.letters.length - 1; i++) {
          const a = s.letters[i], b = s.letters[i + 1]
          if (a.locked && b.locked) continue

          const ax = a.x + a.w / 2, ay = a.y + LH / 2
          const bx = b.x + b.w / 2, by = b.y + LH / 2
          const dx = bx - ax, dy = by - ay
          const dist = Math.hypot(dx, dy) || 0.001
          const rest = s.restLengths[i]
          const diff = (dist - rest) / dist

          if (a.locked && !b.locked) {
            b.x -= dx * diff
            b.y -= dy * diff
          } else if (!a.locked && b.locked) {
            a.x += dx * diff
            a.y += dy * diff
          } else if (!a.locked && !b.locked) {
            a.x += dx * diff * 0.5
            a.y += dy * diff * 0.5
            b.x -= dx * diff * 0.5
            b.y -= dy * diff * 0.5
          }
        }
      }
    }

    // Inter-string collision: prevents overlapping letter clusters from different
    // strings (or non-adjacent letters within the same string) by pushing apart
    // any two unlocked letters closer than 2× collisionRadius.
    if (cfg.collisionEnabled) {
      this.resolveCollisions(cfg, LH)
    }

    // Static body collision: letters collide with the bounding boxes of active
    // (uncompleted) todo items. This creates the visual of crossed-off text
    // falling *around* the remaining list items rather than passing through them.
    // For each letter, find the closest point on each rectangle and push the
    // letter out if it overlaps.
    if (this.staticBodies.length > 0) {
      for (const s of this.strings) {
        if (s.active) continue
        for (const lp of s.letters) {
          if (lp.locked) continue
          const cx = lp.x + lp.w / 2
          const cy = lp.y + LH / 2
          const R = cfg.collisionRadius

          for (const body of this.staticBodies) {
            // Find closest point on rectangle to letter center
            const nearX = Math.max(body.x, Math.min(cx, body.x + body.w))
            const nearY = Math.max(body.y, Math.min(cy, body.y + body.h))
            const dx = cx - nearX
            const dy = cy - nearY
            const dist = Math.hypot(dx, dy) || 0.001
            if (dist < R) {
              // Push letter out of rectangle
              const push = (R - dist) / dist
              lp.x += dx * push
              lp.y += dy * push
            }
          }
        }
      }
    }

    // Boundary constraints: keeps letters on-screen by clamping to ground, left
    // wall, and right wall. Reflects the previous position to simulate bounce
    // (the Verlet equivalent of reversing velocity on collision).
    for (const s of this.strings) {
      if (s.active) continue
      for (const lp of s.letters) {
        if (lp.locked) continue
        // Ground
        if (lp.y + LH > this.groundY) {
          lp.y = this.groundY - LH
          lp.py = lp.y + (lp.y - lp.py) * cfg.boundaryBounce
        }
        // Left wall
        if (lp.x < 0) {
          lp.x = 0
          lp.px = lp.x + (lp.x - lp.px) * cfg.boundaryBounce
        }
        // Right wall
        if (lp.x + lp.w > cfg.frameWidth) {
          lp.x = cfg.frameWidth - lp.w
          lp.px = lp.x + (lp.x - lp.px) * cfg.boundaryBounce
        }
      }
    }
  }

  resolveCollisions(cfg, LH) {
    const R = cfg.collisionRadius
    const minDist = R * 2

    // Collect all unlocked, non-sleeping letters with their string index
    // so we can skip adjacent letters within the same string
    const allLetters = [] // { lp, stringIdx, letterIdx }
    for (let si = 0; si < this.strings.length; si++) {
      const s = this.strings[si]
      if (s.active) continue
      for (let li = 0; li < s.letters.length; li++) {
        const lp = s.letters[li]
        if (!lp.locked) {
          allLetters.push({ lp, si, li })
        }
      }
    }

    for (let i = 0; i < allLetters.length; i++) {
      const a = allLetters[i]
      const acx = a.lp.x + a.lp.w / 2, acy = a.lp.y + LH / 2
      for (let j = i + 1; j < allLetters.length; j++) {
        const b = allLetters[j]

        // Skip adjacent letters in the same string — distance constraint handles them
        if (a.si === b.si && Math.abs(a.li - b.li) <= 1) continue

        const bcx = b.lp.x + b.lp.w / 2, bcy = b.lp.y + LH / 2
        const dx = bcx - acx, dy = bcy - acy
        const dist = Math.hypot(dx, dy) || 0.001
        if (dist < minDist) {
          const overlap = (minDist - dist) / dist * 0.5
          a.lp.x -= dx * overlap
          a.lp.y -= dy * overlap
          b.lp.x += dx * overlap
          b.lp.y += dy * overlap
        }
      }
    }
  }
}
