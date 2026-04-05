import React, { useState, useRef, useEffect, useCallback } from 'react'
import { prepareWithSegments, layoutWithLines } from '@chenglou/pretext'
import { PhysicsWorld, DEFAULT_CONFIG } from './physics.js'
import GUI from 'lil-gui'

// ═══════════════════════════════════════════════════════════════
// CONFIG — mutable, shared between React and physics
// ═══════════════════════════════════════════════════════════════
const CONFIG = { ...DEFAULT_CONFIG }

// Canvas for measuring character widths
const measureCtx = document.createElement('canvas').getContext('2d')

// ═══════════════════════════════════════════════════════════════
// DATE HELPERS
// ═══════════════════════════════════════════════════════════════
function dateKey(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatDate(d) {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
  return `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}`
}

function formatDateShort(d) {
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December']
  return `${months[d.getMonth()]} ${d.getDate()}`
}

function addDays(d, n) {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

// ═══════════════════════════════════════════════════════════════
// TEXT MEASUREMENT with Pretext + canvas measureText
// ═══════════════════════════════════════════════════════════════
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

function measureCharPositions(text, font, maxWidth, lineHeight, offsetX, offsetY) {
  if (!text) return []

  measureCtx.font = font
  const graphemes = [...segmenter.segment(text)].map(s => s.segment)
  const widths = graphemes.map(g => measureCtx.measureText(g).width)

  // Use Pretext to get proper line breaks
  let lines
  try {
    const prepared = prepareWithSegments(text, font)
    const result = layoutWithLines(prepared, maxWidth, lineHeight)
    lines = result.lines
  } catch {
    // Fallback: simple word-wrap
    lines = [{ text }]
  }

  // Build character positions line by line
  const positions = []
  let gi = 0
  let lineY = 0

  for (let li = 0; li < lines.length; li++) {
    const lineText = lines[li].text
    const lineGraphemes = [...segmenter.segment(lineText)].map(s => s.segment)
    let x = 0

    for (let j = 0; j < lineGraphemes.length; j++) {
      if (gi < graphemes.length) {
        positions.push({
          char: graphemes[gi],
          x: x + offsetX,
          y: lineY + offsetY,
          w: widths[gi],
        })
        x += widths[gi]
        gi++
      }
    }
    lineY += lineHeight
  }

  // Handle any remaining graphemes (shouldn't happen, but safety)
  while (gi < graphemes.length) {
    positions.push({
      char: graphemes[gi],
      x: offsetX,
      y: positions.length > 0 ? positions[positions.length - 1].y + lineHeight : offsetY,
      w: widths[gi],
    })
    gi++
  }

  return positions
}

// ═══════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════
export default function App() {
  const [currentDate, setCurrentDate] = useState(new Date())
  const [daysData, setDaysData] = useState({})
  const [, forceRender] = useState(0)
  const frameRef = useRef(null)
  const physicsRef = useRef(null)
  const guiRef = useRef(null)
  const letterContainerRef = useRef(null)
  const todoAreaRef = useRef(null)
  const crossedOffRef = useRef(new Map()) // id -> { spans: [], string: ElasticString }

  const key = dateKey(currentDate)

  const getDayTodos = useCallback((dateObj) => {
    const k = dateKey(dateObj)
    return daysData[k]?.todos || []
  }, [daysData])

  const todos = getDayTodos(currentDate)
  const effectiveTodos = todos.length === 0
    ? [{ id: Date.now() + '_init', text: '', completed: false }]
    : todos

  // Keep frameWidth/frameHeight in sync with window size
  useEffect(() => {
    function updateSize() {
      CONFIG.frameWidth = window.innerWidth
      CONFIG.frameHeight = window.innerHeight
      if (physicsRef.current) {
        physicsRef.current.groundY = CONFIG.frameHeight - 4
        physicsRef.current.updateConfig(CONFIG)
      }
    }
    updateSize()
    window.addEventListener('resize', updateSize)
    return () => window.removeEventListener('resize', updateSize)
  }, [])

  // ═══════════════════════════════════════════════════════════════
  // PHYSICS INIT + ANIMATION LOOP (single effect to avoid RAF conflicts)
  // ═══════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!physicsRef.current) {
      physicsRef.current = new PhysicsWorld(CONFIG)
    }

    const FIXED_DT = 1 / 120
    const MAX_STEPS = 4
    let accumulator = 0
    let lastTime = -1
    let animId = 0

    function updateStaticBodies() {
      const world = physicsRef.current
      const frame = frameRef.current
      const todoArea = todoAreaRef.current
      if (!world || !frame || !todoArea) return

      const frameRect = frame.getBoundingClientRect()
      const bodies = []
      const items = todoArea.querySelectorAll('.todo-item:not(.completed)')
      for (const item of items) {
        const textEl = item.querySelector('.todo-text')
        if (!textEl || !textEl.textContent.trim()) continue
        const rect = textEl.getBoundingClientRect()
        if (rect.width === 0) continue
        bodies.push({
          x: rect.left - frameRect.left,
          y: rect.top - frameRect.top,
          w: rect.width,
          h: rect.height,
        })
      }
      world.setStaticBodies(bodies)
    }

    function tick(now) {
      if (lastTime < 0) { lastTime = now; animId = requestAnimationFrame(tick); return }
      const dt = Math.min((now - lastTime) / 1000, MAX_STEPS * FIXED_DT)
      lastTime = now
      accumulator += dt

      const world = physicsRef.current

      // Track scroll offset
      const todoArea = todoAreaRef.current
      if (todoArea) {
        world.setScrollOffset(todoArea.scrollTop)
      }

      // Update static bodies for collision (throttled — every ~4 frames)
      if (Math.random() < 0.25) updateStaticBodies()

      while (accumulator >= FIXED_DT) {
        world.simulate()
        accumulator -= FIXED_DT
      }

      // Update DOM positions for all crossed-off strings
      for (const [, entries] of crossedOffRef.current) {
        for (const entry of entries) {
          const s = entry.string
          const spans = entry.spans
          for (let i = 0; i < s.letters.length; i++) {
            const lp = s.letters[i]
            const span = spans[i]
            if (span) {
              span.style.transform = `translate(${lp.x}px, ${lp.y}px)`
              span.style.opacity = s.opacity
            }
          }
        }
      }

      animId = requestAnimationFrame(tick)
    }

    animId = requestAnimationFrame(tick)

    // Device motion — use accelerometer to control gravity direction
    // accelerationIncludingGravity gives values in m/s²
    // On a phone held upright in portrait: x≈0, y≈-9.8, z≈0
    // Tilt left: x goes negative. Tilt right: x goes positive.
    // Tilt forward: y less negative. Tilt back: y more negative.
    function handleMotion(e) {
      const world = physicsRef.current
      if (!world) return
      const ag = e.accelerationIncludingGravity
      if (!ag) return

      const ax = ag.x ?? 0
      const ay = ag.y ?? 0

      // Normalize: earth gravity ≈ 9.8, map to -1..1
      // x: positive = tilt right, we want gravity to pull right
      // y: negative = upright/tilted forward, positive = upside down
      // Negate x because accelerometer reports reaction force
      world.gravityX = ax / 9.8
      world.gravityY = -ay / 9.8  // flip: accelerometer y is inverted from screen y
    }

    // Request permission on iOS 13+
    let motionListenerAdded = false
    if (typeof DeviceMotionEvent !== 'undefined' &&
        typeof DeviceMotionEvent.requestPermission === 'function') {
      const requestPerm = async () => {
        try {
          const perm = await DeviceMotionEvent.requestPermission()
          if (perm === 'granted') {
            window.addEventListener('devicemotion', handleMotion)
            motionListenerAdded = true
          }
        } catch (err) { /* ignore */ }
      }
      document.addEventListener('click', requestPerm, { once: true })
    } else if (typeof DeviceMotionEvent !== 'undefined') {
      window.addEventListener('devicemotion', handleMotion)
      motionListenerAdded = true
    }

    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('devicemotion', handleMotion)
    }
  }, [])

  // ═══════════════════════════════════════════════════════════════
  // CROSS OFF A TODO
  // ═══════════════════════════════════════════════════════════════
  function handleComplete(item) {
    if (!item.text.trim()) return

    const world = physicsRef.current
    const frame = frameRef.current
    const letterContainer = letterContainerRef.current
    if (!world || !frame || !letterContainer) return

    // Find the DOM element for this item and measure character positions
    const li = frame.querySelector(`[data-id="${item.id}"]`)
    const textEl = li?.querySelector('.todo-text')
    if (!textEl) return

    const frameRect = frame.getBoundingClientRect()
    const textRect = textEl.getBoundingClientRect()
    const font = CONFIG.font
    const lineHeight = CONFIG.lineHeight
    const maxWidth = textRect.width || (CONFIG.frameWidth - 60 - 28)

    // Compute position of text relative to app-frame
    const offsetX = textRect.left - frameRect.left
    const offsetY = textRect.top - frameRect.top

    // Guard against broken layout (e.g. zero-size viewport)
    if (!isFinite(offsetX) || !isFinite(offsetY) || textRect.width === 0) return

    // Account for scroll offset — charData positions should be relative to app-frame,
    // but the text element scrolls inside todo-area. Store the initial scroll offset
    // so pinned letters' home positions are in app-frame coordinates.
    const todoArea = todoAreaRef.current
    const scrollTop = todoArea ? todoArea.scrollTop : 0

    const charData = measureCharPositions(item.text, font, maxWidth, lineHeight, offsetX, offsetY)
    if (charData.length === 0) return

    // Adjust charData y positions to account for scroll — store as absolute positions
    // relative to the scrollable content, not the viewport
    for (const cd of charData) {
      cd.y += scrollTop
    }

    // Add one string per wrapped line to physics world (left end pinned)
    const strings = world.addStrings(item.id, item.text, charData, lineHeight, font)
    if (strings.length === 0) return

    // Create DOM <span> for each letter across all line-strings
    const allEntries = []
    for (const str of strings) {
      const spans = []
      for (let i = 0; i < str.letters.length; i++) {
        const lp = str.letters[i]
        const span = document.createElement('span')
        span.className = 'elastic-letter'
        span.textContent = lp.char
        span.style.cssText = `
          position: absolute;
          top: 0; left: 0;
          font: ${font};
          color: ${CONFIG.checkedTextColor};
          pointer-events: none;
          will-change: transform;
          transform: translate(${lp.x}px, ${lp.y}px);
          line-height: ${lineHeight}px;
          white-space: pre;
        `
        letterContainer.appendChild(span)
        spans.push(span)
      }
      allEntries.push({ string: str, spans })
    }

    // Store references for animation loop
    crossedOffRef.current.set(item.id, allEntries)

    // Trigger cross-off physics on all line-strings
    world.crossOffItem(item.id)

    // Mark as completed (keep in list, don't remove)
    setDaysData(prev => {
      const k = dateKey(currentDate)
      const day = prev[k] || { todos: [] }
      return {
        ...prev,
        [k]: { ...day, todos: day.todos.map(t => t.id === item.id ? { ...t, completed: true } : t) }
      }
    })
  }

  // ═══════════════════════════════════════════════════════════════
  // TODO TEXT EDITING
  // ═══════════════════════════════════════════════════════════════
  function handleTextChange(item, newText) {
    setDaysData(prev => {
      const k = dateKey(currentDate)
      const day = prev[k] || { todos: [] }
      return {
        ...prev,
        [k]: { ...day, todos: day.todos.map(t => t.id === item.id ? { ...t, text: newText } : t) }
      }
    })
  }

  function handleKeyDown(e, item) {
    if (e.key === 'Enter') {
      e.preventDefault()
      const sel = window.getSelection()
      const textEl = e.target
      let cursorOffset = (item.text || '').length
      if (sel.rangeCount > 0) {
        const range = sel.getRangeAt(0)
        if (textEl.contains(range.startContainer)) {
          cursorOffset = range.startContainer.nodeType === Node.TEXT_NODE
            ? range.startOffset
            : (range.startOffset === 0 ? 0 : (item.text || '').length)
        }
      }

      const before = (item.text || '').substring(0, cursorOffset)
      const after = (item.text || '').substring(cursorOffset)
      const newId = Date.now() + '_' + Math.random().toString(36).slice(2, 6)

      setDaysData(prev => {
        const k = dateKey(currentDate)
        const day = prev[k] || { todos: [] }
        const newTodos = [...day.todos]
        const idx = newTodos.findIndex(t => t.id === item.id)
        if (idx >= 0) {
          newTodos[idx] = { ...newTodos[idx], text: before }
          newTodos.splice(idx + 1, 0, { id: newId, text: after, completed: false })
        }
        return { ...prev, [k]: { ...day, todos: newTodos } }
      })

      setTimeout(() => {
        const newEl = document.querySelector(`[data-id="${newId}"] .todo-text`)
        if (newEl) {
          newEl.focus()
          const range = document.createRange()
          range.selectNodeContents(newEl)
          range.collapse(true)
          const s = window.getSelection()
          s.removeAllRanges()
          s.addRange(range)
        }
      }, 30)
    }

    if (e.key === 'Backspace' && (item.text || '') === '') {
      e.preventDefault()
      const allTodos = getDayTodos(currentDate)
      if (allTodos.length > 1) {
        const idx = allTodos.findIndex(t => t.id === item.id)
        if (idx > 0) {
          setDaysData(prev => {
            const k = dateKey(currentDate)
            const day = prev[k] || { todos: [] }
            return { ...prev, [k]: { ...day, todos: day.todos.filter(t => t.id !== item.id) } }
          })
          setTimeout(() => {
            const items = document.querySelectorAll('.todo-text')
            const prev = items[Math.min(idx - 1, items.length - 1)]
            if (prev) {
              prev.focus()
              const range = document.createRange()
              range.selectNodeContents(prev)
              range.collapse(false)
              const sel = window.getSelection()
              sel.removeAllRanges()
              sel.addRange(range)
            }
          }, 30)
        }
      }
    }
  }

  function handlePaste(e, item) {
    e.preventDefault()
    const pasted = (e.clipboardData || window.clipboardData).getData('text/plain') || ''
    const lines = pasted.split(/\r?\n/).filter(l => l.trim() !== '')
    if (lines.length === 0) return

    const sel = window.getSelection()
    const cursorOffset = sel.rangeCount > 0 ? sel.getRangeAt(0).startOffset : (item.text || '').length
    const before = (item.text || '').substring(0, cursorOffset)
    const after = (item.text || '').substring(cursorOffset)

    setDaysData(prev => {
      const k = dateKey(currentDate)
      const day = prev[k] || { todos: [] }
      const newTodos = [...day.todos]
      const idx = newTodos.findIndex(t => t.id === item.id)
      if (idx < 0) return prev
      newTodos[idx] = { ...newTodos[idx], text: before + lines[0] }
      const extra = lines.slice(1)
      if (after.trim()) {
        if (extra.length > 0) extra[extra.length - 1] += after
        else extra.push(after)
      }
      for (let i = 0; i < extra.length; i++) {
        newTodos.splice(idx + 1 + i, 0, {
          id: Date.now() + '_' + Math.random().toString(36).slice(2, 6),
          text: extra[i], completed: false
        })
      }
      return { ...prev, [k]: { ...day, todos: newTodos } }
    })
  }

  // ═══════════════════════════════════════════════════════════════
  // DATE NAVIGATION
  // ═══════════════════════════════════════════════════════════════
  function navigateDate(offset) {
    // Clean up crossed-off spans when changing days
    const letterContainer = letterContainerRef.current
    if (letterContainer) {
      for (const [, entries] of crossedOffRef.current) {
        for (const entry of entries) {
          for (const span of entry.spans) span.remove()
        }
      }
      crossedOffRef.current.clear()
    }
    if (physicsRef.current) physicsRef.current.strings = []
    setCurrentDate(prev => addDays(prev, offset))
  }

  // ═══════════════════════════════════════════════════════════════
  // LIL-GUI
  // ═══════════════════════════════════════════════════════════════
  useEffect(() => {
    if (guiRef.current) return
    const gui = new GUI({ title: 'Elastic Todo', width: 280, autoPlace: false })
    document.body.appendChild(gui.domElement)
    gui.domElement.id = 'tuning-panel'
    guiRef.current = gui
    const world = physicsRef.current

    const colors = gui.addFolder('Colors')
    colors.addColor(CONFIG, 'bgColor').name('Background').onChange(v => {
      document.getElementById('app-frame').style.background = v
      document.body.style.background = v
    })
    colors.addColor(CONFIG, 'textColor').name('Text').onChange(v => {
      document.querySelectorAll('.todo-text').forEach(el => el.style.color = v)
      document.querySelectorAll('.elastic-letter').forEach(el => el.style.color = v)
    })
    colors.addColor(CONFIG, 'ringColor').name('Ring').onChange(v => {
      document.querySelectorAll('.todo-ring:not(.checked)').forEach(el => el.style.borderColor = v)
    })
    colors.addColor(CONFIG, 'ringCheckedBg').name('Checked Ring Fill').onChange(v => {
      document.querySelectorAll('.todo-ring.checked').forEach(el => el.style.background = v)
    })
    colors.addColor(CONFIG, 'crossColor').name('Checked Ring').onChange(v => {
      CONFIG.ringCheckedBg = v
      document.querySelectorAll('.todo-ring.checked').forEach(el => {
        el.style.background = v
        el.style.borderColor = v
      })
    })
    colors.addColor(CONFIG, 'checkedTextColor').name('Checked Text').onChange(v => {
      document.querySelectorAll('.todo-item.completed .todo-text').forEach(el => el.style.color = v)
      document.querySelectorAll('.elastic-letter').forEach(el => el.style.color = v)
    })
    colors.addColor(CONFIG, 'dateColor').name('Date Text').onChange(v => {
      const el = document.getElementById('date-display')
      if (el) el.style.color = v
    })
    colors.addColor(CONFIG, 'dateNavColor').name('Nav Arrows').onChange(v => {
      document.querySelectorAll('.date-nav').forEach(el => el.style.color = v)
    })
    colors.addColor(CONFIG, 'dateNavBorder').name('Nav Border').onChange(v => {
      document.querySelectorAll('.date-nav').forEach(el => el.style.borderColor = v)
    })
    colors.add(CONFIG, 'crossedOffOpacity', 0.1, 0.8, 0.05).name('Crossed Opacity').onChange(() => {
      world?.updateConfig(CONFIG)
      for (const s of world.strings) { if (!s.active) s.targetOpacity = CONFIG.crossedOffOpacity }
    })
    colors.open()

    const physics = gui.addFolder('String Physics')
    physics.add(CONFIG, 'constraintDist', 1.0, 2.5, 0.05).name('Max Gap (×rest)').onChange(() => world?.updateConfig(CONFIG))
    physics.add(CONFIG, 'iterations', 1, 30, 1).name('Solver Iterations').onChange(() => world?.updateConfig(CONFIG))
    physics.add(CONFIG, 'damping', 0.8, 0.999, 0.005).name('Damping').onChange(() => world?.updateConfig(CONFIG))
    physics.add(CONFIG, 'gravity', 0.0, 1.0, 0.01).name('Gravity').onChange(() => world?.updateConfig(CONFIG))
    physics.add(CONFIG, 'unlockThreshold', 0, 10, 0.5).name('Unlock Threshold').onChange(() => world?.updateConfig(CONFIG))
    physics.add(CONFIG, 'unravelSpeed', 1, 10, 1).name('Unravel Speed').onChange(() => world?.updateConfig(CONFIG))
    physics.open()

    const collision = gui.addFolder('Collision')
    collision.add(CONFIG, 'collisionEnabled').name('Enabled').onChange(() => world?.updateConfig(CONFIG))
    collision.add(CONFIG, 'collisionRadius', 2, 20, 1).name('Letter Radius').onChange(() => world?.updateConfig(CONFIG))
    collision.close()

    const boundary = gui.addFolder('Boundary')
    boundary.add(CONFIG, 'boundaryBounce', 0.0, 1.0, 0.05).name('Bounce').onChange(() => world?.updateConfig(CONFIG))
    boundary.close()

    const visual = gui.addFolder('Visual')
    visual.add(CONFIG, 'fontSize', 10, 24, 1).name('Font Size').onChange(v => {
      CONFIG.font = `300 ${v}px TWKLausanne, sans-serif`
      CONFIG.lineHeight = Math.round(v * CONFIG.lineSpacing)
      document.querySelectorAll('.todo-text').forEach(el => el.style.fontSize = v + 'px')
    })
    visual.add(CONFIG, 'lineSpacing', 1.2, 2.5, 0.1).name('Line Spacing').onChange(v => {
      CONFIG.lineHeight = Math.round(CONFIG.fontSize * v)
      document.querySelectorAll('.todo-text').forEach(el => el.style.lineHeight = v)
    })
    visual.close()

    const actions = gui.addFolder('Actions')
    actions.add({
      clearFallen: () => {
        const letterContainer = document.getElementById('letter-overlay')
        if (letterContainer) {
          for (const [, entries] of crossedOffRef.current) {
            for (const entry of entries) {
              for (const span of entry.spans) span.remove()
            }
          }
          crossedOffRef.current.clear()
        }
        if (world) world.strings = world.strings.filter(s => s.active)
      }
    }, 'clearFallen').name('Clear Fallen Letters')
    actions.close()

    return () => { gui.destroy(); guiRef.current = null }
  }, [])

  // ═══════════════════════════════════════════════════════════════
  // SEED DEFAULT TODOS
  // ═══════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!daysData[key] || !daysData[key].todos || daysData[key].todos.length === 0) {
      setDaysData(prev => ({
        ...prev,
        [key]: {
          ...prev[key],
          todos: [
            { id: 'demo_1', text: 'Tensorlake Explorations #1', completed: false },
            { id: 'demo_2', text: 'Tensorlake Explorations #2', completed: false },
            { id: 'demo_3', text: 'Collect items from the mailbox', completed: false },
            { id: 'demo_4', text: 'CVD Assignment + Reading', completed: false },
            { id: 'demo_5', text: 'Talk to Prof. Raquel', completed: false },
            { id: 'demo_6', text: 'Duke in LA - Karen\'s Midterm', completed: false },
            { id: 'demo_7', text: 'Duke in LA - Karen\'s Essay', completed: false },
            { id: 'demo_8', text: 'Project Blue - Full Screen Overheat', completed: false },
            { id: 'demo_9', text: 'Project Blue - Building State', completed: false },
            { id: 'demo_10', text: 'Project Blue - Level selection', completed: false },
            { id: 'demo_11', text: 'Project Blue - Movement system', completed: false },
            { id: 'demo_12', text: 'Duke in NY living preferences', completed: false },
            { id: 'demo_13', text: 'OK Food Night', completed: false },
            { id: 'demo_14', text: '', completed: false },
          ]
        }
      }))
    }
  }, [key])

  // ═══════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════
  return (
    <div id="app-frame" ref={frameRef} style={{ background: CONFIG.bgColor }}>
      {/* Overlay container for elastic letter spans */}
      <div id="letter-overlay" ref={letterContainerRef} />

      <div id="date-header">
        <button className="date-nav" onClick={() => navigateDate(-1)}>
          <img src="/chevron-left.svg" alt="prev" />
        </button>
        <div id="date-display" style={{ color: CONFIG.dateColor }}>{formatDateShort(currentDate)}</div>
        <button className="date-nav" onClick={() => navigateDate(1)}>
          <img src="/chevron-left.svg" alt="next" style={{ transform: 'rotate(180deg)' }} />
        </button>
      </div>
      <div id="header-line" />

      <div id="todo-area" ref={todoAreaRef}>
        <ul id="todo-list">
          {effectiveTodos.map((item, i) => (
            <TodoItem
              key={item.id}
              item={item}
              index={i}
              onComplete={handleComplete}
              onTextChange={handleTextChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              config={CONFIG}
            />
          ))}
        </ul>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// TODO ITEM COMPONENT
// ═══════════════════════════════════════════════════════════════
function TodoItem({ item, index, onComplete, onTextChange, onKeyDown, onPaste, config }) {
  const textRef = useRef(null)

  useEffect(() => {
    if (textRef.current && textRef.current.textContent !== item.text) {
      textRef.current.textContent = item.text
    }
  }, [item.text])

  useEffect(() => {
    if (item.text === '' && !item.completed && textRef.current) {
      setTimeout(() => textRef.current?.focus(), 50)
    }
  }, [])

  const completed = item.completed

  return (
    <li className={`todo-item${completed ? ' completed' : ''}`} data-id={item.id}>
      <div
        className={`todo-ring${completed ? ' checked' : ''}`}
        style={{
          borderColor: completed ? config.ringCheckedBg : config.ringColor,
          background: completed ? config.ringCheckedBg : 'none',
        }}
        onClick={() => !completed && onComplete(item)}
      />
      <div
        ref={textRef}
        className="todo-text"
        contentEditable={!completed}
        suppressContentEditableWarning
        spellCheck={false}
        style={{
          color: config.textColor,
          fontSize: config.fontSize + 'px',
          lineHeight: config.lineSpacing,
          visibility: completed ? 'hidden' : 'visible',
        }}
        onInput={(e) => !completed && onTextChange(item, e.currentTarget.textContent)}
        onKeyDown={(e) => !completed && onKeyDown(e, item, index)}
        onPaste={(e) => !completed && onPaste(e, item)}
      />
    </li>
  )
}
