// ═══════════════════════════════════════════════════════════════
// Mountain Todo — Main Application
// ═══════════════════════════════════════════════════════════════

const { Engine, Bodies, Body, Composite } = Matter;

// ═══════════════════════════════════════════════════════════════
// CONFIG — single centralized config object
// ═══════════════════════════════════════════════════════════════
const CONFIG = {
    // Colors
    bgColor: '#FFFFFF',
    textColor: '#1E1E1E',
    ringColor: '#1E1E1E',
    climberColor: '#000000',
    mountainBaseColor: '#2F2F2F',

    // Layout — full screen, set dynamically
    frameWidth: window.innerWidth,
    frameHeight: window.innerHeight,
    mountainZoneRatio: 0.25,    // bottom 25%
    listZoneRatio: 0.75,        // top 75%

    // Typography
    fontSize: 19,
    lineSpacing: 1.4,
    font: '300 19px TWKLausanne, sans-serif',

    // Physics
    gravity: 1.2,
    bounce: 0.8,
    friction: 0.7,
    frictionAir: 0.02,
    letterSize: 14,

    // Mountain layers
    mountainOpacityBase: 1.0,
    mountainOpacityFalloff: 0.20,
    mountainLayerOffset: 4,
    mountainDayCount: 5,
    mountainBlurBase: 0,
    mountainBlurFalloff: 0.8,

    // Climber
    climberSpeed: 1.5,

    // Animation
    animationSpeed: 1.0,
    letterSpawnSpread: 30,

    // Pile
    pileDensity: 0.0001,

    // Fall mode: 'letter' = individual chars, 'word' = whole words
    fallMode: 'letter',
    rtlStagger: true,
    staggerDelay: 1.2,

    // Undo
    undoRiseTime: 0.7,       // seconds — letters float up
    undoReturnTime: 0.5,     // seconds — letters return to list position
    undoFloatColor: '#5030EF',
};

// ═══════════════════════════════════════════════════════════════
// APP STATE
// ═══════════════════════════════════════════════════════════════
const AppState = {
    currentDate: null,      // Date object for selected day
    days: {},               // dateKey -> DayData
    engine: null,
    world: null,
    heightmap: null,
    climber: null,
    canvasW: 0,
    canvasH: 0,
    groundY: 0,
    p5instance: null,
    undoTrailLayer: null,
};

// ═══════════════════════════════════════════════════════════════
// UNDO STATE
// ═══════════════════════════════════════════════════════════════
// Each entry: { text, settledIndices: [indices into day.settledLetters], itemData: {id, text} }
const undoStack = [];
let undoButtonVisible = false;
let undoButtonEl = null;

// Undo animation state
// Phase: 'rising' | 'returning' | null
let undoAnim = null;
// { phase, letters: [{char, sx, sy, ex, ey, startSize, endSize, angle}], startTime, duration, text, insertIndex }

// ═══════════════════════════════════════════════════════════════
// DAY DATA
// ═══════════════════════════════════════════════════════════════
class DayData {
    constructor(dateKey) {
        this.dateKey = dateKey;
        this.todos = [];            // { id, text, completed }
        this.completedTexts = [];   // strings of completed items
        this.mountainProfile = [];  // settled heightmap profile (array of y values)
        this.settledLetters = [];   // { char, x, y, angle, size } — frozen letters
    }
}

// ═══════════════════════════════════════════════════════════════
// DATE HELPERS
// ═══════════════════════════════════════════════════════════════
function dateKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function formatDate(d) {
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    return `${months[d.getMonth()]} ${d.getDate()}`;
}

function addDays(d, n) {
    const r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
}

function getDayData(d) {
    const key = dateKey(d);
    if (!AppState.days[key]) {
        AppState.days[key] = new DayData(key);
    }
    return AppState.days[key];
}

// ═══════════════════════════════════════════════════════════════
// GLYPH CACHE & EXTRACTION (from original sketch)
// ═══════════════════════════════════════════════════════════════
const glyphCache = {};
const traceCanvas = document.createElement('canvas');
const traceCtx = traceCanvas.getContext('2d', { willReadFrequently: true });

function getGlyphData(char, size) {
    const key = char + '|' + size;
    if (glyphCache[key]) return glyphCache[key];

    const pad = 4;
    const cw = Math.ceil(size * 1.2) + pad * 2;
    const ch = Math.ceil(size * 1.4) + pad * 2;
    traceCanvas.width = cw;
    traceCanvas.height = ch;

    traceCtx.clearRect(0, 0, cw, ch);
    traceCtx.fillStyle = 'white';
    traceCtx.font = `300 ${size}px TWKLausanne, sans-serif`;
    traceCtx.textBaseline = 'alphabetic';
    traceCtx.textAlign = 'left';
    traceCtx.fillText(char, pad, ch - pad - size * 0.2);

    const imgData = traceCtx.getImageData(0, 0, cw, ch);
    const pixels = imgData.data;

    const grid = new Uint8Array(cw * ch);
    for (let i = 0; i < cw * ch; i++) grid[i] = pixels[i * 4 + 3] > 80 ? 1 : 0;

    let boundary = [];
    for (let y = 1; y < ch - 1; y++) {
        for (let x = 1; x < cw - 1; x++) {
            if (grid[y * cw + x] === 1 &&
                (grid[(y-1)*cw+x]===0 || grid[(y+1)*cw+x]===0 ||
                 grid[y*cw+x-1]===0 || grid[y*cw+x+1]===0)) {
                boundary.push({ x, y });
            }
        }
    }

    if (boundary.length < 3) {
        const fw = size * 0.3, fh = size * 0.15;
        const verts = [{x:-fw/2,y:-fh/2},{x:fw/2,y:-fh/2},{x:fw/2,y:fh/2},{x:-fw/2,y:fh/2}];
        const d = { verts, cx: cw/2, cy: ch/2, w: fw, h: fh, charImg: null };
        glyphCache[key] = d;
        return d;
    }

    let hull = convexHull(boundary);
    hull = rdpSimplify(hull, 1.8);
    if (hull.length < 3) hull = convexHull(boundary);
    while (hull.length > 12) {
        hull = rdpSimplify(hull, hull.length > 20 ? 3.0 : 2.0);
        if (hull.length < 4) { hull = convexHull(boundary); break; }
    }

    let cx = 0, cy = 0;
    for (let p of hull) { cx += p.x; cy += p.y; }
    cx /= hull.length; cy /= hull.length;
    let verts = hull.map(p => ({ x: p.x - cx, y: p.y - cy }));

    let minX=Infinity, maxX=-Infinity, minY=Infinity, maxY=-Infinity;
    for (let p of verts) {
        minX=Math.min(minX,p.x); maxX=Math.max(maxX,p.x);
        minY=Math.min(minY,p.y); maxY=Math.max(maxY,p.y);
    }

    const charCanvas = document.createElement('canvas');
    charCanvas.width = cw; charCanvas.height = ch;
    const charCtx = charCanvas.getContext('2d');
    charCtx.fillStyle = 'white';
    charCtx.font = `300 ${size}px TWKLausanne, sans-serif`;
    charCtx.textBaseline = 'alphabetic';
    charCtx.textAlign = 'left';
    charCtx.fillText(char, pad, ch - pad - size * 0.2);

    const d = {
        verts, cx, cy,
        w: maxX - minX, h: maxY - minY,
        charImg: charCanvas, imgW: cw, imgH: ch
    };
    glyphCache[key] = d;
    return d;
}

// ═══════════════════════════════════════════════════════════════
// GEOMETRY UTILS
// ═══════════════════════════════════════════════════════════════
function convexHull(points) {
    let pts = points.slice().sort((a,b) => a.x-b.x || a.y-b.y);
    if (pts.length <= 2) return pts.slice();
    let lower = [];
    for (let p of pts) {
        while (lower.length >= 2 && cross2(lower[lower.length-2], lower[lower.length-1], p) <= 0) lower.pop();
        lower.push(p);
    }
    let upper = [];
    for (let i = pts.length-1; i >= 0; i--) {
        while (upper.length >= 2 && cross2(upper[upper.length-2], upper[upper.length-1], pts[i]) <= 0) upper.pop();
        upper.push(pts[i]);
    }
    lower.pop(); upper.pop();
    return lower.concat(upper);
}

function cross2(o,a,b) {
    return (a.x-o.x)*(b.y-o.y) - (a.y-o.y)*(b.x-o.x);
}

function rdpSimplify(pts, eps) {
    if (pts.length <= 2) return pts;
    let dmax=0, idx=0, end=pts.length-1;
    for (let i=1; i<end; i++) {
        let d = ptLineDist(pts[i], pts[0], pts[end]);
        if (d > dmax) { dmax=d; idx=i; }
    }
    if (dmax > eps) {
        let l = rdpSimplify(pts.slice(0,idx+1), eps);
        let r = rdpSimplify(pts.slice(idx), eps);
        return l.slice(0,-1).concat(r);
    }
    return [pts[0], pts[end]];
}

function ptLineDist(p,a,b) {
    let dx=b.x-a.x, dy=b.y-a.y, l2=dx*dx+dy*dy;
    if (l2===0) return Math.hypot(p.x-a.x, p.y-a.y);
    let t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/l2));
    return Math.hypot(p.x-(a.x+t*dx), p.y-(a.y+t*dy));
}

// ═══════════════════════════════════════════════════════════════
// FALLING LETTERS — active physics simulation
// ═══════════════════════════════════════════════════════════════
let activeLetters = []; // { body, char, glyph, charImg, imgW, imgH, imgOffX, imgOffY, settled }
let staticLetterBodies = []; // physics bodies converted to static for collision

// Get per-character positions from a DOM text element, mapped to canvas coords
function getCharPositions(textEl) {
    const frameRect = document.getElementById('app-frame').getBoundingClientRect();
    const text = textEl.textContent;
    const positions = [];

    // Walk through the text node and measure each character with Range API
    const textNode = textEl.firstChild;
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return positions;

    for (let i = 0; i < text.length; i++) {
        const range = document.createRange();
        range.setStart(textNode, i);
        range.setEnd(textNode, i + 1);
        const rect = range.getBoundingClientRect();

        // Convert from screen coords to canvas coords (relative to app-frame)
        positions.push({
            origIdx: i,
            char: text[i],
            x: rect.left - frameRect.left + rect.width / 2,
            y: rect.top - frameRect.top + rect.height / 2,
            origX: rect.left - frameRect.left + rect.width / 2,
            origY: rect.top - frameRect.top + rect.height / 2
        });
    }

    return positions;
}

// Pending items waiting for their staggered release (right-to-left cascade)
// In letter mode: { type:'letter', char, x, y, origX, origY, origIdx, size, releaseFrame, batchEl, batchId }
// In word mode:   { type:'word', word, chars:[{char,x,y,origX,origY,origIdx}], cx, cy, w, h, size, releaseFrame, batchEl, batchId }
let pendingLetters = [];

function spawnFallingLettersFromPositions(charPositions, batchEl, batchId) {
    if (charPositions.length === 0) return;

    const size = CONFIG.fontSize;

    if (CONFIG.fallMode === 'word') {
        spawnFallingWords(charPositions, batchEl, size, batchId);
    } else {
        spawnFallingChars(charPositions, batchEl, size, batchId);
    }
}

function spawnFallingChars(charPositions, batchEl, size, batchId) {
    const maxX = Math.max(...charPositions.map(cp => cp.x));
    const minX = Math.min(...charPositions.map(cp => cp.x));
    const xRange = Math.max(1, maxX - minX);
    const maxDelayFrames = Math.round(charPositions.length * CONFIG.staggerDelay);

    for (let i = 0; i < charPositions.length; i++) {
        const cp = charPositions[i];
        if (cp.char === ' ') continue;

        let delayFrames = 0;
        if (CONFIG.rtlStagger && xRange > 0) {
            // rightmost = 0 delay, leftmost = maxDelay
            const normalizedPos = (maxX - cp.x) / xRange;
            delayFrames = Math.round(normalizedPos * maxDelayFrames);
        }

        pendingLetters.push({
            type: 'letter',
            char: cp.char,
            origIdx: cp.origIdx != null ? cp.origIdx : i,
            x: cp.x,
            y: cp.y,
            origX: cp.origX ?? cp.x,
            origY: cp.origY ?? cp.y,
            size: size,
            releaseFrame: frameCount + delayFrames,
            batchEl: batchEl,
            batchId: batchId
        });
    }
}

function spawnFallingWords(charPositions, batchEl, size, batchId) {
    // Group character positions into words (split on spaces)
    const words = [];
    let currentWord = [];

    for (const cp of charPositions) {
        if (cp.char === ' ') {
            if (currentWord.length > 0) {
                words.push(currentWord);
                currentWord = [];
            }
        } else if (false) {
            currentWord.push(cp);
        }
    }
    if (currentWord.length > 0) words.push(currentWord);
    if (words.length === 0) return;

    // For each word, compute bounding box center
    const wordData = words.map(chars => {
        const xs = chars.map(c => c.x);
        const ys = chars.map(c => c.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const w = Math.max(maxX - minX + size * 0.8, size * 0.5);
        const h = Math.max(maxY - minY + size * 0.6, size * 0.8);
        const word = chars.map(c => c.char).join('');
        return { word, chars, cx, cy, w, h };
    });

    // Rightmost word falls first
    const maxCx = Math.max(...wordData.map(wd => wd.cx));
    const minCx = Math.min(...wordData.map(wd => wd.cx));
    const cxRange = Math.max(1, maxCx - minCx);
    const maxDelayFrames = Math.round(words.length * Math.max(4, CONFIG.staggerDelay * 3));

    for (const wd of wordData) {
        let delayFrames = 0;
        if (CONFIG.rtlStagger && cxRange > 0) {
            const normalizedPos = (maxCx - wd.cx) / cxRange;
            delayFrames = Math.round(normalizedPos * maxDelayFrames);
        }

        pendingLetters.push({
            type: 'word',
            word: wd.word,
            chars: wd.chars,
            cx: wd.cx,
            cy: wd.cy,
            w: wd.w,
            h: wd.h,
            size: size,
            releaseFrame: frameCount + delayFrames,
            batchEl: batchEl,
            batchId: batchId
        });
    }
}

function releasePendingLetters() {
    const CW = AppState.canvasW;
    const now = frameCount;

    for (let i = pendingLetters.length - 1; i >= 0; i--) {
        const pl = pendingLetters[i];
        if (now < pl.releaseFrame) continue;

        if (pl.type === 'word') {
            releaseWord(pl, CW);
        } else {
            releaseLetter(pl, CW);
        }

        pendingLetters.splice(i, 1);
    }
}

function releaseLetter(pl, CW) {
    const physicsSize = pl.size * 1.25;
    const glyph = getGlyphData(pl.char, physicsSize);
    const dropX = Math.max(5, Math.min(CW - 5, pl.x));
    const dropY = pl.y;

    let body;
    try {
        body = Bodies.fromVertices(dropX, dropY, [glyph.verts.map(v => ({ x: v.x, y: v.y }))], {
            restitution: CONFIG.bounce,
            friction: CONFIG.friction,
            frictionAir: CONFIG.frictionAir,
            density: CONFIG.pileDensity,
            sleepThreshold: 40,
            label: 'letter_' + pl.char
        });
    } catch(e) {
        body = Bodies.rectangle(dropX, dropY, glyph.w || 8, glyph.h || 12, {
            restitution: CONFIG.bounce,
            friction: CONFIG.friction,
            frictionAir: CONFIG.frictionAir,
            density: CONFIG.pileDensity,
            sleepThreshold: 40,
            label: 'letter_' + pl.char
        });
    }

    if (body) {
        Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.04);
        Body.setVelocity(body, { x: (Math.random() - 0.5) * 1.0, y: 0.3 + Math.random() * 0.5 });
        Composite.add(AppState.world, body);

        activeLetters.push({
            body, char: pl.char,
            origIdx: pl.origIdx,
            origX: pl.origX,
            origY: pl.origY,
            size: pl.size,
            isWord: false,
            batchId: pl.batchId,
            settled: false,
            settleTimer: 0
        });
    }
}

function releaseWord(pl, CW) {
    const dropX = Math.max(10, Math.min(CW - 10, pl.cx));
    const dropY = pl.cy;

    // Use a rectangle body sized to the word's bounding box
    let body;
    try {
        body = Bodies.rectangle(dropX, dropY, pl.w * 1.25, pl.h * 1.25, {
            restitution: CONFIG.bounce,
            friction: CONFIG.friction,
            frictionAir: CONFIG.frictionAir,
            density: CONFIG.pileDensity,
            sleepThreshold: 40,
            label: 'word_' + pl.word
        });
    } catch(e) {
        return;
    }

    if (body) {
        Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.03);
        Body.setVelocity(body, { x: (Math.random() - 0.5) * 0.8, y: 0.3 + Math.random() * 0.4 });
        Composite.add(AppState.world, body);

        // Store per-character offsets relative to word center for rendering
        const charOffsets = pl.chars.map(c => ({
            char: c.char,
            origIdx: c.origIdx,
            origX: c.origX ?? c.x,
            origY: c.origY ?? c.y,
            ox: c.x - pl.cx,
            oy: c.y - pl.cy
        }));

        activeLetters.push({
            body,
            char: pl.word,
            word: pl.word,
            charOffsets: charOffsets,
            size: pl.size,
            isWord: true,
            batchId: pl.batchId,
            settled: false,
            settleTimer: 0
        });
    }
}

function updateActiveLetters() {
    const day = getDayData(AppState.currentDate);

    for (let i = activeLetters.length - 1; i >= 0; i--) {
        const al = activeLetters[i];
        if (al.body.isSleeping) {
            al.settleTimer++;
        } else {
            al.settleTimer = 0;
        }

        // After sleeping for a while, freeze into mountain
        if (al.settleTimer > 60) {
            // Compute scaled size based on y position (same logic as rendering)
            const CH = AppState.canvasH;
            const gY = AppState.groundY;
            const scaleZoneStart = CH * 0.8;
            const baseSz = al.size || CONFIG.fontSize;
            const byPos = al.body.position.y;
            const yProgress = Math.max(0, Math.min(1, (byPos - scaleZoneStart) / (gY - scaleZoneStart)));
            const settledSize = baseSz * (1.0 + yProgress * 0.25);

            if (al.isWord && al.charOffsets) {
                // Word mode: break into individual settled characters
                const bx = al.body.position.x;
                const by = al.body.position.y;
                const angle = al.body.angle;
                const cosA = Math.cos(angle);
                const sinA = Math.sin(angle);
                for (const co of al.charOffsets) {
                    // Rotate offset by body angle
                    const rx = co.ox * cosA - co.oy * sinA;
                    const ry = co.ox * sinA + co.oy * cosA;
                    day.settledLetters.push({
                        char: co.char,
                        origIdx: co.origIdx,
                        origX: co.origX,
                        origY: co.origY,
                        x: bx + rx,
                        y: by + ry,
                        angle: angle,
                        size: settledSize,
                        batchId: al.batchId
                    });
                }
            } else {
                day.settledLetters.push({
                    char: al.char,
                    origIdx: al.origIdx,
                    origX: al.origX,
                    origY: al.origY,
                    x: al.body.position.x,
                    y: al.body.position.y,
                    angle: al.body.angle,
                    size: settledSize,
                    batchId: al.batchId
                });
            }

            // Convert to static body so future letters can pile on top
            Body.setStatic(al.body, true);
            staticLetterBodies.push(al.body);

            activeLetters.splice(i, 1);
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// HEIGHTMAP for current letters
// ═══════════════════════════════════════════════════════════════
function rebuildHeightmap() {
    const CW = AppState.canvasW;
    const groundY = AppState.groundY;
    const hm = AppState.heightmap;
    hm.fill(groundY);

    // From settled letters of current day
    const day = getDayData(AppState.currentDate);
    for (const sl of day.settledLetters) {
        const halfW = CONFIG.letterSize * 0.5;
        const colStart = Math.max(0, Math.floor(sl.x - halfW));
        const colEnd = Math.min(CW - 1, Math.ceil(sl.x + halfW));
        for (let col = colStart; col <= colEnd; col++) {
            const topY = sl.y - CONFIG.letterSize * 0.4;
            if (topY < hm[col]) hm[col] = topY;
        }
    }

    // From active physics letters
    for (const al of activeLetters) {
        const b = al.body;
        if (!b.isSleeping) continue;
        const parts = b.parts;
        for (let p = (parts.length > 1 ? 1 : 0); p < parts.length; p++) {
            const verts = parts[p].vertices;
            for (let vi = 0; vi < verts.length; vi++) {
                const a = verts[vi];
                const next = verts[(vi + 1) % verts.length];
                const x0 = Math.min(a.x, next.x), x1 = Math.max(a.x, next.x);
                const colStart = Math.max(0, Math.floor(x0));
                const colEnd = Math.min(CW - 1, Math.ceil(x1));
                for (let col = colStart; col <= colEnd; col++) {
                    const dx = next.x - a.x;
                    let y;
                    if (Math.abs(dx) < 0.001) {
                        y = Math.min(a.y, next.y);
                    } else {
                        let t = (col - a.x) / dx;
                        t = Math.max(0, Math.min(1, t));
                        y = a.y + t * (next.y - a.y);
                    }
                    if (y < hm[col]) hm[col] = y;
                }
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// MOUNTAIN PROFILE — generate smooth profile from settled letters
// ═══════════════════════════════════════════════════════════════
function getMountainProfile(dayData, canvasW, groundY) {
    if (!dayData || dayData.settledLetters.length === 0) return null;

    const profile = new Float32Array(canvasW);
    profile.fill(groundY);

    for (const sl of dayData.settledLetters) {
        const halfW = CONFIG.letterSize * 0.6;
        const colStart = Math.max(0, Math.floor(sl.x - halfW));
        const colEnd = Math.min(canvasW - 1, Math.ceil(sl.x + halfW));
        for (let col = colStart; col <= colEnd; col++) {
            const topY = sl.y - CONFIG.letterSize * 0.35;
            if (topY < profile[col]) profile[col] = topY;
        }
    }

    // Smooth the profile
    const smooth = new Float32Array(canvasW);
    const radius = 6;
    for (let x = 0; x < canvasW; x++) {
        let sum = 0, count = 0;
        for (let dx = -radius; dx <= radius; dx++) {
            const xi = Math.max(0, Math.min(canvasW - 1, x + dx));
            sum += profile[xi];
            count++;
        }
        smooth[x] = sum / count;
    }

    return smooth;
}

// ═══════════════════════════════════════════════════════════════
// CLIMBING AGENT
// ═══════════════════════════════════════════════════════════════
class Climber {
    constructor(CW, groundY) {
        this.x = CW / 2;
        this.y = groundY;
        this.vx = 0;
        this.vy = 0;
        this.targetX = CW / 2;
        this.targetY = groundY;
        this.facing = 1;
        this.bodyH = 16;
        this.headR = 4;
        this.limbLen = 10;
        this.walkPhase = 0;
        this.armPhase = 0;
        this.isClimbing = false;
        this.lookUpTimer = 0; // frames remaining in lookUp pose
        this.lookUpBlend = 0; // 0 = normal, 1 = full lookUp pose
    }

    findHighest(heightmap, CW, groundY) {
        let bestY = groundY, bestX = CW / 2;
        for (let x = 5; x < CW - 5; x += 2) {
            if (heightmap[x] < bestY) { bestY = heightmap[x]; bestX = x; }
        }
        this.targetX = bestX;
        this.targetY = bestY - this.bodyH - this.headR;
    }

    surfaceY(atX, heightmap, CW) {
        let ix = Math.max(0, Math.min(CW - 1, Math.round(atX)));
        let best = heightmap[ix];
        for (let d = -3; d <= 3; d++) {
            let xi = Math.max(0, Math.min(CW - 1, ix + d));
            if (heightmap[xi] < best) best = heightmap[xi];
        }
        return best;
    }

    update(heightmap, CW, groundY) {
        if (this.lookUpTimer > 0) {
            this.lookUpTimer--;
            // Stay still during lookUp
            this.vx *= 0.9;
            this.x += this.vx;
            const sy = this.surfaceY(this.x, heightmap, CW);
            const target = sy - this.bodyH;
            this.y += (target - this.y) * 0.25;
            this.x = Math.max(12, Math.min(CW - 12, this.x));
            return;
        }

        this.findHighest(heightmap, CW, groundY);

        const dx = this.targetX - this.x;
        if (Math.abs(dx) > 2) {
            this.vx += Math.sign(dx) * 0.1 * CONFIG.climberSpeed;
            this.facing = Math.sign(dx);
        }
        this.vx *= 0.85;
        this.x += this.vx;

        const sy = this.surfaceY(this.x, heightmap, CW);
        const target = sy - this.bodyH;

        if (this.y < target - 2) {
            this.vy += 0.3;
        } else if (this.y > target + 1) {
            this.y += (target - this.y) * 0.25;
            this.vy = 0;
        } else {
            this.vy = 0;
            this.y = target;
        }
        this.y += this.vy;

        if (this.y > groundY - this.bodyH) { this.y = groundY - this.bodyH; this.vy = 0; }
        this.x = Math.max(12, Math.min(CW - 12, this.x));

        const spd = Math.abs(this.vx);
        if (spd > 0.2) {
            this.walkPhase += spd * 0.15;
            this.armPhase += spd * 0.15;
            this.isClimbing = this.targetY < this.y - 8;
        } else {
            this.walkPhase += 0.02;
            this.armPhase += 0.015;
            this.isClimbing = false;
        }
    }

    display() {
        push();
        const c = color(CONFIG.climberColor);
        stroke(c); strokeWeight(2); noFill();

        const hipY = this.y + this.bodyH;
        const shY = this.y + 3;
        const headY = this.y - this.headR + 1;
        const f = this.facing;
        const spd = Math.abs(this.vx);

        if (this.lookUpTimer > 0) {
            // Look-up pose: normal legs, arms stretched upward
            const wc2 = Math.sin(this.walkPhase);
            const stride2 = 1.5;

            // Normal legs (standing still)
            const lFx2 = this.x + wc2 * stride2 * f;
            const lFy2 = Math.min(hipY + this.limbLen * 0.4, this.surfaceY(lFx2, AppState.heightmap, AppState.canvasW));
            const rFx2 = this.x - wc2 * stride2 * f;
            const rFy2 = Math.min(hipY + this.limbLen * 0.4, this.surfaceY(rFx2, AppState.heightmap, AppState.canvasW));
            this.drawLimb(this.x - 2, hipY, lFx2, lFy2, -1);
            this.drawLimb(this.x + 2, hipY, rFx2, rFy2, 1);

            // Torso
            line(this.x, hipY, this.x, shY);

            // Arms stretched upward
            const armSway = Math.sin(performance.now() * 0.003) * 1.5;
            this.drawLimb(this.x - 1.5, shY, this.x - 8 + armSway, shY - this.limbLen, -1);
            this.drawLimb(this.x + 1.5, shY, this.x + 8 - armSway, shY - this.limbLen, 1);

            // Head — normal position
            fill(c); noStroke();
            ellipse(this.x, headY, this.headR * 2, this.headR * 2);

            // Eyes looking up
            fill(255);
            ellipse(this.x - 1, headY - 1.5, 1.5, 1.5);
            ellipse(this.x + 1, headY - 1.5, 1.5, 1.5);

            pop();
            return;
        }

        const wc = Math.sin(this.walkPhase);
        const ac = Math.sin(this.armPhase + Math.PI);
        const stride = Math.min(spd > 0.2 ? spd * 3.5 : 1.5, this.limbLen * 0.7);

        // Legs
        const lFx = this.x + wc * stride * f;
        const lFy = Math.min(hipY + this.limbLen * 0.4, this.surfaceY(lFx, AppState.heightmap, AppState.canvasW));
        const rFx = this.x - wc * stride * f;
        const rFy = Math.min(hipY + this.limbLen * 0.4, this.surfaceY(rFx, AppState.heightmap, AppState.canvasW));

        this.drawLimb(this.x - 2, hipY, lFx, lFy, -1);
        this.drawLimb(this.x + 2, hipY, rFx, rFy, 1);

        // Torso
        line(this.x, hipY, this.x, shY);

        // Arms
        let lHx, lHy, rHx, rHy;
        if (this.isClimbing && spd > 0.2) {
            lHx = this.x + ac * 6 * f; lHy = shY - this.limbLen * 0.7;
            rHx = this.x - ac * 6 * f; rHy = shY - this.limbLen * 0.5;
        } else {
            lHx = this.x + ac * stride * 0.4 * f;
            lHy = shY + this.limbLen * 0.6 + Math.sin(this.armPhase) * 1.5;
            rHx = this.x - ac * stride * 0.4 * f;
            rHy = shY + this.limbLen * 0.6 - Math.sin(this.armPhase) * 1.5;
        }
        this.drawLimb(this.x - 1.5, shY, lHx, lHy, -1);
        this.drawLimb(this.x + 1.5, shY, rHx, rHy, 1);

        // Head
        fill(c); noStroke();
        ellipse(this.x, headY, this.headR * 2, this.headR * 2);

        // Eyes
        fill(255);
        const eo = this.facing * 1.5;
        ellipse(this.x + eo - 1, headY - 0.5, 1.5, 1.5);
        ellipse(this.x + eo + 1, headY - 0.5, 1.5, 1.5);

        pop();
    }

    drawLimb(sx, sy, ex, ey, side) {
        const ddx = ex - sx, ddy = ey - sy, len = Math.hypot(ddx, ddy);
        const nx = len > 0 ? -ddy / len : 0, ny = len > 0 ? ddx / len : 1;
        const mx = (sx + ex) / 2 + nx * 4 * side;
        const my = (sy + ey) / 2 + ny * 4 * side;
        line(sx, sy, mx, my);
        line(mx, my, ex, ey);
    }
}

// ═══════════════════════════════════════════════════════════════
// PHYSICS INIT
// ═══════════════════════════════════════════════════════════════
function initPhysics() {
    const CW = AppState.canvasW;
    const CH = AppState.canvasH;
    const groundY = AppState.groundY;

    AppState.engine = Engine.create({ enableSleeping: true });
    AppState.world = AppState.engine.world;
    AppState.engine.gravity.y = CONFIG.gravity;

    const ground = Bodies.rectangle(CW / 2, groundY + 25, CW + 100, 50, {
        isStatic: true, friction: 0.9, restitution: 0.05
    });
    const wallL = Bodies.rectangle(-15, CH / 2, 30, CH + 100, {
        isStatic: true, friction: 0.3
    });
    const wallR = Bodies.rectangle(CW + 15, CH / 2, 30, CH + 100, {
        isStatic: true, friction: 0.3
    });
    Composite.add(AppState.world, [ground, wallL, wallR]);
}

function clearPhysics() {
    if (AppState.world) {
        // Remove all non-static letter bodies (active + settled)
        const bodies = Composite.allBodies(AppState.world);
        for (const b of bodies) {
            if (!b.isStatic) Composite.remove(AppState.world, b);
        }
        // Remove static letter bodies (but keep walls/ground)
        for (const b of staticLetterBodies) {
            Composite.remove(AppState.world, b);
        }
    }
    activeLetters = [];
    staticLetterBodies = [];
    pendingLetters = [];
}

// Rebuild static collision bodies from a day's settled letters
// so new falling letters can pile on top of the existing mountain
function rebuildStaticBodiesFromSettled() {
    // Clear old static letter bodies
    for (const b of staticLetterBodies) {
        Composite.remove(AppState.world, b);
    }
    staticLetterBodies = [];

    const day = getDayData(AppState.currentDate);
    const size = CONFIG.letterSize;

    for (const sl of day.settledLetters) {
        // Use the settled letter's actual size for collision
        const slSize = sl.size || size;
        const w = slSize * 0.8;
        const h = slSize * 0.9;
        const body = Bodies.rectangle(sl.x, sl.y, w, h, {
            isStatic: true,
            friction: CONFIG.friction,
            restitution: 0.05,
            angle: sl.angle || 0,
            label: 'settled_' + sl.char
        });
        Composite.add(AppState.world, body);
        staticLetterBodies.push(body);
    }
}

// ═══════════════════════════════════════════════════════════════
// TODO LIST — DOM management
// ═══════════════════════════════════════════════════════════════

// Update mask classes based on scroll position
function updateScrollFade() {
    const el = document.getElementById('todo-area');
    if (!el) return;

    const scrollable = el.scrollHeight > el.clientHeight + 2;
    if (!scrollable) {
        el.className = 'no-overflow';
        return;
    }

    const atTop = el.scrollTop < 4;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 4;

    el.classList.remove('scrolled-top', 'scrolled-bottom', 'no-overflow');
    if (!atTop && !atBottom) {
        el.classList.add('scrolled-top'); // both fades (top class adds top fade, default has bottom)
    } else if (!atTop && atBottom) {
        el.classList.add('scrolled-bottom'); // top fade only
    }
    // else atTop && !atBottom → default (bottom fade only)
    // else atTop && atBottom → shouldn't happen if scrollable
}

function captureTodoItemRects() {
    const rects = new Map();
    document.querySelectorAll('.todo-item').forEach(li => {
        rects.set(li.dataset.id, li.getBoundingClientRect());
    });
    return rects;
}

function animateTodoItemReflow(previousRects) {
    if (!previousRects || previousRects.size === 0) return;

    const items = [...document.querySelectorAll('.todo-item')];
    const animated = [];

    for (const li of items) {
        const prev = previousRects.get(li.dataset.id);
        if (!prev) continue;

        const next = li.getBoundingClientRect();
        const dy = prev.top - next.top;
        if (Math.abs(dy) < 0.5) continue;

        li.style.transition = 'none';
        li.style.transform = `translateY(${dy}px)`;
        animated.push(li);
    }

    if (animated.length === 0) return;

    requestAnimationFrame(() => {
        for (const li of animated) {
            li.style.transition = 'transform 0.3s cubic-bezier(0.5, 0, 0, 1)';
            li.style.transform = 'translateY(0)';

            const cleanup = () => {
                li.style.transition = '';
                li.style.transform = '';
                li.removeEventListener('transitionend', cleanup);
            };
            li.addEventListener('transitionend', cleanup);
        }
    });
}

function updateTodoAreaBounds() {
    const todoArea = document.getElementById('todo-area');
    const frame = document.getElementById('app-frame');
    if (!todoArea || !frame) return;

    const viewportH = frame.clientHeight || window.innerHeight;
    const top = todoArea.offsetTop;
    const targetBottom = viewportH * 0.70;
    const minHeight = Math.max(160, viewportH * 0.18);
    const maxAvailable = viewportH - top;
    const targetHeight = Math.max(minHeight, Math.min(maxAvailable, targetBottom - top));

    todoArea.style.height = `${Math.round(targetHeight)}px`;
    todoArea.style.maxHeight = `${Math.round(targetHeight)}px`;
}

function renderTodoList() {
    const list = document.getElementById('todo-list');
    list.innerHTML = '';

    const day = getDayData(AppState.currentDate);

    if (day.todos.length === 0) {
        addNewTodoItem(day, '');
    }

    for (let i = 0; i < day.todos.length; i++) {
        const item = day.todos[i];
        const li = createTodoElement(item, i, day);
        list.appendChild(li);
    }

    // Focus last item if empty
    const items = list.querySelectorAll('.todo-text');
    if (items.length > 0) {
        const last = items[items.length - 1];
        if (last.textContent === '') {
            setTimeout(() => last.focus(), 50);
        }
    }

    // Update scroll fade state
    setTimeout(() => {
        updateTodoAreaBounds();
        updateScrollFade();
    }, 60);
}

function createTodoElement(item, index, day) {
    const li = document.createElement('li');
    li.className = 'todo-item';
    li.dataset.id = item.id;

    // Ring
    const ring = document.createElement('div');
    ring.className = 'todo-ring';
    ring.style.borderColor = CONFIG.ringColor;
    ring.addEventListener('click', () => completeTodo(item, li, day));

    // Text
    const text = document.createElement('div');
    text.className = 'todo-text';
    text.contentEditable = 'true';
    text.spellcheck = false;
    text.textContent = item.text;
    text.style.color = CONFIG.textColor;
    text.style.font = CONFIG.font;
    text.style.lineHeight = CONFIG.lineSpacing;

    // Input handler
    text.addEventListener('input', () => {
        item.text = text.textContent;
        saveTolocalStorage();
    });

    // Paste handler — split pasted text by newlines into separate items
    text.addEventListener('paste', (e) => {
        e.preventDefault();
        const pasted = (e.clipboardData || window.clipboardData).getData('text/plain') || '';
        const lines = pasted.split(/\r?\n/).filter(l => l.trim() !== '');
        if (lines.length === 0) return;

        // Get cursor position to split current text
        const sel = window.getSelection();
        const cursorOffset = sel.rangeCount > 0 ? sel.getRangeAt(0).startOffset : (item.text || '').length;
        const beforeCursor = (item.text || '').substring(0, cursorOffset);
        const afterCursor = (item.text || '').substring(cursorOffset);

        // First line merges with text before cursor
        item.text = beforeCursor + lines[0];
        text.textContent = item.text;

        // Find current position in todo array
        const currentIdx = day.todos.indexOf(item);

        // Create new items for remaining lines + any text after cursor
        const newLines = lines.slice(1);
        // If there was text after the cursor, append it to the last new line (or make its own)
        if (afterCursor.trim()) {
            if (newLines.length > 0) {
                newLines[newLines.length - 1] += afterCursor;
            } else {
                newLines.push(afterCursor);
            }
        }

        let lastLi = li;
        for (let i = 0; i < newLines.length; i++) {
            const newItem = {
                id: Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                text: newLines[i],
                completed: false
            };
            const insertIdx = currentIdx + 1 + i;
            day.todos.splice(insertIdx, 0, newItem);

            const newLi = createTodoElement(newItem, insertIdx, day);
            lastLi.after(newLi);
            lastLi = newLi;
        }

        // Focus the last created item and place cursor at end
        const lastText = lastLi.querySelector('.todo-text');
        setTimeout(() => {
            lastText.focus();
            const range = document.createRange();
            range.selectNodeContents(lastText);
            range.collapse(false);
            const s = window.getSelection();
            s.removeAllRanges();
            s.addRange(range);
        }, 10);

        saveTolocalStorage();
    });

    // Keydown for Enter and Backspace
    text.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();

            // Get cursor position to split text at caret
            const sel = window.getSelection();
            let cursorOffset = (item.text || '').length;
            if (sel.rangeCount > 0) {
                const range = sel.getRangeAt(0);
                // Only use offset if cursor is inside this element
                if (text.contains(range.startContainer)) {
                    // For text nodes, startOffset is the character offset
                    if (range.startContainer.nodeType === Node.TEXT_NODE) {
                        cursorOffset = range.startOffset;
                    } else {
                        // For element nodes, compute from child nodes
                        cursorOffset = range.startOffset === 0 ? 0 : (item.text || '').length;
                    }
                }
            }

            const fullText = item.text || '';
            const beforeCursor = fullText.substring(0, cursorOffset);
            const afterCursor = fullText.substring(cursorOffset);

            // Update current item to only have text before cursor
            item.text = beforeCursor;
            text.textContent = beforeCursor;

            // Create new item with text after cursor, inserted right after current
            const currentIdx = day.todos.indexOf(item);
            const newItem = {
                id: Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                text: afterCursor,
                completed: false
            };
            day.todos.splice(currentIdx + 1, 0, newItem);

            const newLi = createTodoElement(newItem, currentIdx + 1, day);
            li.after(newLi);

            // Focus new item and place cursor at beginning
            const newText = newLi.querySelector('.todo-text');
            setTimeout(() => {
                newText.focus();
                const range = document.createRange();
                range.selectNodeContents(newText);
                range.collapse(true); // collapse to start
                const s = window.getSelection();
                s.removeAllRanges();
                s.addRange(range);
            }, 10);

            saveTolocalStorage();
        }

        if (e.key === 'Backspace' && text.textContent === '') {
            e.preventDefault();
            if (day.todos.length > 1) {
                const idx = day.todos.findIndex(t => t.id === item.id);
                if (idx > 0) {
                    day.todos.splice(idx, 1);
                    li.remove();
                    // Focus previous
                    const items = document.querySelectorAll('.todo-text');
                    if (items.length > 0) {
                        const prev = items[Math.min(idx - 1, items.length - 1)];
                        prev.focus();
                        // Move cursor to end
                        const range = document.createRange();
                        range.selectNodeContents(prev);
                        range.collapse(false);
                        const sel = window.getSelection();
                        sel.removeAllRanges();
                        sel.addRange(range);
                    }
                    saveTolocalStorage();
                }
            }
        }
    });

    li.appendChild(ring);
    li.appendChild(text);
    return li;
}

function addNewTodoItem(day, text) {
    const item = {
        id: Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        text: text,
        completed: false
    };
    day.todos.push(item);
    return item;
}

// ═══════════════════════════════════════════════════════════════
// COMPLETE TODO — trigger falling letters
// ═══════════════════════════════════════════════════════════════
function completeTodo(item, li, day) {
    if (!item.text.trim()) return;

    // Visual feedback
    const ring = li.querySelector('.todo-ring');
    ring.classList.add('completing');

    // Capture character positions from the DOM BEFORE removing the element
    const textEl = li.querySelector('.todo-text');
    const charPositions = getCharPositions(textEl);

    // Record completion
    day.completedTexts.push(item.text);

    // Track undo batch — we'll record settled letter start index
    const undoBatchId = Date.now() + '_undo';
    const currentSettledCount = day.settledLetters.length;
    // Store the index in the todo list for re-insertion
    const todoIndex = day.todos.indexOf(item);

    // Hide the DOM text immediately — the canvas will take over rendering
    // both the stationary (pending) and falling (active) letters
    textEl.style.visibility = 'hidden';
    ring.style.visibility = 'hidden';

    // Spawn falling letters from their original screen positions
    spawnFallingLettersFromPositions(charPositions, li, undoBatchId);

    // Only remove the DOM element once ALL its letters have been released
    // (the pending queue is empty for this batch). We track this via a
    // check interval that collapses the row once all chars are physics bodies.
    const checkRemove = setInterval(() => {
        // All pending from this batch released?
        const stillPending = pendingLetters.some(pl => pl.batchEl === li);
        if (stillPending) return;

        clearInterval(checkRemove);

        // Measure current height then animate collapse after 0.2s delay
        const previousItemRects = captureTodoItemRects();
        li.style.pointerEvents = 'none';
        li.style.transition = 'opacity 0.22s cubic-bezier(0.5, 0, 0, 1), transform 0.22s cubic-bezier(0.5, 0, 0, 1)';
        li.style.opacity = '0';
        li.style.transform = 'translateY(-4px)';

        setTimeout(() => {
            const idx = day.todos.findIndex(t => t.id === item.id);
            if (idx >= 0) day.todos.splice(idx, 1);
            li.remove();
            animateTodoItemReflow(previousItemRects);

            // Push to undo stack — record which settled letters belong to this completion
            undoStack.push({
                batchId: undoBatchId,
                text: item.text,
                settledStartIndex: currentSettledCount,
                insertIndex: todoIndex,
                originalCharPositions: charPositions, // exact DOM positions at time of cross-off
            });

            // Ensure at least one empty item
            if (day.todos.length === 0) {
                const newItem = addNewTodoItem(day, '');
                const list = document.getElementById('todo-list');
                const newLi = createTodoElement(newItem, 0, day);
                list.appendChild(newLi);
                const newText = newLi.querySelector('.todo-text');
                setTimeout(() => newText.focus(), 50);
            }
            saveTolocalStorage();
        }, 220);
    }, 30);
}

// ═══════════════════════════════════════════════════════════════
// DATE NAVIGATION
// ═══════════════════════════════════════════════════════════════
function navigateDate(offset) {
    // Save current active letters to settled before switching
    settleAllActiveLetters();

    AppState.currentDate = addDays(AppState.currentDate, offset);
    updateDateDisplay();
    renderTodoList();
    clearPhysics();
    // Rebuild static collision bodies from the new day's existing mountain
    rebuildStaticBodiesFromSettled();
    saveTolocalStorage();
}

function settleAllActiveLetters() {
    const day = getDayData(AppState.currentDate);
    for (const al of activeLetters) {
        if (al.isWord && al.charOffsets) {
            const bx = al.body.position.x;
            const by = al.body.position.y;
            const angle = al.body.angle;
            const cosA = Math.cos(angle);
            const sinA = Math.sin(angle);

            for (const co of al.charOffsets) {
                const rx = co.ox * cosA - co.oy * sinA;
                const ry = co.ox * sinA + co.oy * cosA;
                day.settledLetters.push({
                    char: co.char,
                    origIdx: co.origIdx,
                    origX: co.origX,
                    origY: co.origY,
                    x: bx + rx,
                    y: by + ry,
                    angle: angle,
                    size: al.size || CONFIG.letterSize,
                    batchId: al.batchId
                });
            }
        } else {
            day.settledLetters.push({
                char: al.char,
                origIdx: al.origIdx,
                origX: al.origX,
                origY: al.origY,
                x: al.body.position.x,
                y: al.body.position.y,
                angle: al.body.angle,
                size: al.size || CONFIG.letterSize,
                batchId: al.batchId
            });
        }
        Composite.remove(AppState.world, al.body);
    }
    activeLetters = [];
}

function updateDateDisplay() {
    document.getElementById('date-display').textContent = formatDate(AppState.currentDate);
}

// ═══════════════════════════════════════════════════════════════
// LOCAL STORAGE
// ═══════════════════════════════════════════════════════════════
function saveTolocalStorage() {
    try {
        const data = {
            currentDate: dateKey(AppState.currentDate),
            days: {}
        };
        for (const [key, day] of Object.entries(AppState.days)) {
            data.days[key] = {
                dateKey: day.dateKey,
                todos: day.todos,
                completedTexts: day.completedTexts,
                settledLetters: day.settledLetters
            };
        }
        localStorage.setItem('mountainTodo', JSON.stringify(data));
    } catch(e) { /* silent */ }
}

function loadFromLocalStorage() {
    try {
        const raw = localStorage.getItem('mountainTodo');
        if (!raw) return false;
        const data = JSON.parse(raw);
        for (const [key, dayRaw] of Object.entries(data.days)) {
            const day = new DayData(key);
            day.todos = dayRaw.todos || [];
            day.completedTexts = dayRaw.completedTexts || [];
            day.settledLetters = dayRaw.settledLetters || [];
            AppState.days[key] = day;
        }

        // Migrate settled letter positions if they were saved with an older,
        // smaller canvas. Detect by checking if letters are far above the
        // current ground — if so, remap them to sit near the bottom.
        migrateSettledPositions();

        return true;
    } catch(e) {
        return false;
    }
}

function migrateSettledPositions() {
    const groundY = AppState.groundY;
    for (const day of Object.values(AppState.days)) {
        if (day.settledLetters.length === 0) continue;
        const maxY = Math.max(...day.settledLetters.map(sl => sl.y));
        // If the lowest letter is more than 100px above the ground,
        // the data is from an older layout — remap to current ground
        if (maxY < groundY - 100) {
            const oldGround = maxY + CONFIG.letterSize * 0.5;
            const shift = groundY - oldGround;
            for (const sl of day.settledLetters) {
                sl.y += shift;
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// SEED DEMO DATA
// ═══════════════════════════════════════════════════════════════
function seedDemoData() {
    const today = new Date();

    // Day -4: light day
    const d4 = getDayData(addDays(today, -4));
    d4.completedTexts = ['morning coffee', 'reply to emails'];
    seedSettledLetters(d4, AppState.canvasW, AppState.groundY);

    // Day -3: moderate
    const d3 = getDayData(addDays(today, -3));
    d3.completedTexts = ['write proposal draft', 'review pull requests', 'lunch meeting'];
    seedSettledLetters(d3, AppState.canvasW, AppState.groundY);

    // Day -2: productive
    const d2 = getDayData(addDays(today, -2));
    d2.completedTexts = ['fix navigation bug', 'deploy staging build', 'update documentation', 'code review session'];
    seedSettledLetters(d2, AppState.canvasW, AppState.groundY);

    // Day -1: big day
    const d1 = getDayData(addDays(today, -1));
    d1.completedTexts = ['finalize design system', 'ship feature release', 'write changelog', 'team standup', 'plan sprint goals'];
    seedSettledLetters(d1, AppState.canvasW, AppState.groundY);

    // Today: some items already done, some active
    const d0 = getDayData(today);
    d0.todos = [
        { id: 'demo_1', text: 'review mountain todo prototype', completed: false },
        { id: 'demo_2', text: 'tweak physics parameters', completed: false },
        { id: 'demo_3', text: '', completed: false }
    ];
    d0.completedTexts = ['morning standup', 'check email'];
    seedSettledLetters(d0, AppState.canvasW, AppState.groundY);
}

function seedSettledLetters(dayData, CW, groundY) {
    const allText = dayData.completedTexts.join(' ');
    const size = CONFIG.letterSize;
    let currentX = 15;
    let currentY = groundY - size * 0.5;
    const baseY = groundY;

    for (let i = 0; i < allText.length; i++) {
        const char = allText[i];
        if (char === ' ') {
            currentX += size * 0.3;
            continue;
        }

        // Create a rough pile shape — gaussian-ish distribution
        const centerX = CW / 2;
        const spread = CW * 0.35;
        const xPos = centerX + (Math.random() - 0.5) * spread;

        // Height based on distance from center — more letters near center pile higher
        const distFromCenter = Math.abs(xPos - centerX) / (CW * 0.5);
        const maxPileHeight = dayData.completedTexts.join('').replace(/ /g, '').length * 0.8;
        const pileY = baseY - (1 - distFromCenter * distFromCenter) * maxPileHeight * (0.6 + Math.random() * 0.4);

        dayData.settledLetters.push({
            char: char,
            x: xPos,
            y: Math.min(baseY - size * 0.3, pileY),
            angle: (Math.random() - 0.5) * 0.6,
            size: size
        });
    }
}

// ═══════════════════════════════════════════════════════════════
// P5.JS SKETCH — instance mode
// ═══════════════════════════════════════════════════════════════
// (p5 global mode — setup() and draw() defined at bottom of file)

// Offscreen canvas pool — one per day layer, reused each frame
const _offscreenPool = [];
function getOffscreen(w, h) {
    // Reuse or create an offscreen canvas of at least the needed size
    let oc = _offscreenPool.pop();
    if (!oc || oc.width < w || oc.height < h) {
        oc = document.createElement('canvas');
        oc.width = w;
        oc.height = h;
    }
    return oc;
}
function returnOffscreen(oc, ctx) {
    // Clear before returning to pool
    ctx.clearRect(0, 0, oc.width, oc.height);
    _offscreenPool.push(oc);
}

function drawMountainLayer(dayData, opacity, yOffset, CW, CH, blurPx) {
    if (dayData.settledLetters.length === 0) return;

    if (blurPx <= 0.05) {
        // No blur — draw directly, no offscreen overhead
        push();
        translate(0, yOffset);
        drawingContext.globalAlpha = opacity;
        fill(CONFIG.mountainBaseColor); noStroke();
        textAlign(CENTER, CENTER); textFont('TWKLausanne');
        for (const sl of dayData.settledLetters) {
            push();
            translate(sl.x, sl.y);
            rotate(sl.angle || 0);
            textSize(sl.size || CONFIG.letterSize);
            text(sl.char, 0, 0);
            pop();
        }
        drawingContext.globalAlpha = 1.0;
        pop();
        return;
    }

    // Blurred path — render layer to offscreen, blit with single filter op
    const oc  = getOffscreen(CW, CH);
    const ctx = oc.getContext('2d');
    ctx.clearRect(0, 0, CW, CH);

    // Draw all letters onto the offscreen canvas (plain, no filter)
    ctx.fillStyle   = CONFIG.mountainBaseColor;
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'middle';
    for (const sl of dayData.settledLetters) {
        const sz = sl.size || CONFIG.letterSize;
        ctx.font = `500 ${sz}px Inter, sans-serif`;
        ctx.save();
        ctx.translate(sl.x, sl.y);
        if (sl.angle) ctx.rotate(sl.angle);
        ctx.fillText(sl.char, 0, 0);
        ctx.restore();
    }

    // Blit the offscreen onto the main canvas — one filter + alpha op total
    drawingContext.save();
    drawingContext.globalAlpha = opacity;
    drawingContext.filter      = `blur(${blurPx.toFixed(1)}px)`;
    drawingContext.drawImage(oc, 0, yOffset);
    drawingContext.filter      = 'none';
    drawingContext.globalAlpha = 1.0;
    drawingContext.restore();

    returnOffscreen(oc, ctx);
}

// ═══════════════════════════════════════════════════════════════
// LIL-GUI — Prototype tuning panel
// ═══════════════════════════════════════════════════════════════
function setupGUI() {
    const gui = new lil.GUI({
        title: '⛰ Tuning Panel',
        width: 280,
        autoPlace: false
    });
    document.body.appendChild(gui.domElement);
    gui.domElement.id = 'tuning-panel';

    // Colors
    const colors = gui.addFolder('🎨 Colors');
    colors.addColor(CONFIG, 'bgColor').name('Background').onChange(v => {
        document.getElementById('app-frame').style.background = v;
    });
    colors.addColor(CONFIG, 'textColor').name('Text').onChange(v => {
        document.querySelectorAll('.todo-text').forEach(el => el.style.color = v);
    });
    colors.addColor(CONFIG, 'ringColor').name('Ring').onChange(v => {
        document.querySelectorAll('.todo-ring').forEach(el => el.style.borderColor = v);
    });
    colors.addColor(CONFIG, 'climberColor').name('Climber');
    colors.addColor(CONFIG, 'mountainBaseColor').name('Mountain Base');

    // Layout
    const layout = gui.addFolder('📐 Layout');
    layout.add(CONFIG, 'frameWidth', 300, 500, 10).name('Frame Width').onChange(resizeApp);
    layout.add(CONFIG, 'frameHeight', 600, 1000, 10).name('Frame Height').onChange(resizeApp);
    layout.add(CONFIG, 'mountainZoneRatio', 0.15, 0.45, 0.01).name('Mountain Zone %').onChange(resizeApp);

    // Typography
    const typo = gui.addFolder('✏️ Typography');
    typo.add(CONFIG, 'fontSize', 10, 24, 1).name('Font Size').onChange(v => {
        document.querySelectorAll('.todo-text').forEach(el => el.style.fontSize = v + 'px');
    });
    typo.add(CONFIG, 'lineSpacing', 1.2, 2.5, 0.1).name('Line Spacing').onChange(v => {
        document.querySelectorAll('.todo-text').forEach(el => el.style.lineHeight = v);
    });

    // Physics
    const physics = gui.addFolder('🍎 Physics');
    physics.add(CONFIG, 'gravity', 0.1, 3.0, 0.1).name('Gravity');
    physics.add(CONFIG, 'bounce', 0.0, 1.0, 0.05).name('Bounce');
    physics.add(CONFIG, 'friction', 0.01, 1.0, 0.01).name('Friction');
    physics.add(CONFIG, 'frictionAir', 0.0, 0.1, 0.005).name('Air Friction');
    physics.add(CONFIG, 'letterSize', 8, 28, 1).name('Letter Size');
    physics.add(CONFIG, 'pileDensity', 0.001, 0.01, 0.001).name('Pile Density');
    physics.add(CONFIG, 'letterSpawnSpread', 5, 80, 1).name('Spawn Spread');

    // Mountain
    const mountain = gui.addFolder('🏔 Mountain Layers');
    mountain.add(CONFIG, 'mountainOpacityBase', 0.5, 1.0, 0.05).name('Base Opacity');
    mountain.add(CONFIG, 'mountainOpacityFalloff', 0.1, 0.3, 0.01).name('Opacity Falloff');
    mountain.add(CONFIG, 'mountainLayerOffset', 0, 15, 1).name('Layer Offset Y');
    mountain.add(CONFIG, 'mountainDayCount', 1, 7, 1).name('Visible Days');
    mountain.add(CONFIG, 'mountainBlurBase', 0, 8, 0.1).name('Today Blur (px)');
    mountain.add(CONFIG, 'mountainBlurFalloff', 0, 4, 0.1).name('Blur per Past Day');

    // Animation
    const anim = gui.addFolder('▶️ Animation');
    anim.add(CONFIG, 'animationSpeed', 0.2, 3.0, 0.1).name('Speed');
    anim.add(CONFIG, 'climberSpeed', 0.5, 4.0, 0.25).name('Climber Speed');
    anim.add(CONFIG, 'fallMode', ['letter', 'word']).name('Fall Unit');
    anim.add(CONFIG, 'rtlStagger').name('Right→Left Stagger');
    anim.add(CONFIG, 'staggerDelay', 0.3, 5.0, 0.1).name('Stagger Delay');

    // Actions
    const actions = gui.addFolder('⚡ Actions');
    actions.add({
        clearToday: () => {
            const day = getDayData(AppState.currentDate);
            day.settledLetters = [];
            day.completedTexts = [];
            clearPhysics();
            saveTolocalStorage();
        }
    }, 'clearToday').name('Clear Today\'s Mountain');
    actions.add({
        clearAll: () => {
            localStorage.removeItem('mountainTodo');
            AppState.days = {};
            clearPhysics();
            renderTodoList();
        }
    }, 'clearAll').name('Reset All Data');

    // Start with all folders closed except Physics (most tweaked)
    colors.close();
    layout.close();
    typo.close();
    physics.open();
    mountain.close();
    anim.close();
    actions.close();
}

// ═══════════════════════════════════════════════════════════════
// UNDO BUTTON & INTERACTION
// ═══════════════════════════════════════════════════════════════

function createUndoButton() {
    const btn = document.createElement('div');
    btn.id = 'undo-button';
    btn.innerHTML = `<img src="undo-button.svg" width="40" height="40">`;
    btn.style.cssText = `
        position: absolute;
        width: 40px; height: 40px;
        pointer-events: auto;
        cursor: pointer;
        z-index: 5;
        opacity: 0;
        transform: scale(0.2);
        transition: none;
        display: none;
        border-radius: 20px;
    `;
    document.getElementById('app-frame').appendChild(btn);

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        performUndo();
    });

    // Pressed state
    btn.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        btn.style.background = 'rgba(0,0,0,0.80)';
        const img = btn.querySelector('img');
        if (img) img.style.filter = 'brightness(0) invert(1)';
    });
    btn.addEventListener('pointerup', () => {
        btn.style.background = 'transparent';
        const img = btn.querySelector('img');
        if (img) img.style.filter = 'none';
    });
    btn.addEventListener('pointerleave', () => {
        btn.style.background = 'transparent';
        const img = btn.querySelector('img');
        if (img) img.style.filter = 'none';
    });

    return btn;
}

function showUndoButton() {
    if (!undoButtonEl || undoStack.length === 0) return;
    const climber = AppState.climber;
    if (!climber) return;

    // Position 16px above climber's head
    const headY = climber.y - climber.headR + 1;
    const btnX = climber.x - 20;
    const btnY = headY - 16 - 40;
    // Distance from climber head to button center
    const riseDistance = headY - (btnY + 20);

    undoButtonEl.style.display = 'block';
    undoButtonEl.style.left = btnX + 'px';
    undoButtonEl.style.top = btnY + 'px';
    undoButtonEl.style.transition = 'none';
    undoButtonEl.style.opacity = '0';
    undoButtonEl.style.transform = `scale(0.2) translateY(${riseDistance}px)`;

    // Force reflow then animate in with spring curve — rises up from climber's head
    undoButtonEl.offsetHeight;
    undoButtonEl.style.transition = 'opacity 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
    undoButtonEl.style.opacity = '1';
    undoButtonEl.style.transform = 'scale(1) translateY(0)';

    undoButtonVisible = true;
}

function hideUndoButton() {
    if (!undoButtonEl || !undoButtonVisible) return;

    const climber = AppState.climber;
    const headY = climber ? climber.y - climber.headR + 1 : 0;
    const btnY = parseFloat(undoButtonEl.style.top) || 0;
    const riseDistance = headY - (btnY + 20);

    undoButtonEl.style.transition = 'opacity 0.25s ease-out, transform 0.25s ease-out';
    undoButtonEl.style.opacity = '0';
    undoButtonEl.style.transform = `scale(0.2) translateY(${riseDistance}px)`;

    setTimeout(() => {
        if (!undoButtonVisible) {
            undoButtonEl.style.display = 'none';
        }
    }, 250);

    undoButtonVisible = false;
}

function updateUndoButtonPosition() {
    if (!undoButtonEl || !undoButtonVisible) return;
    const climber = AppState.climber;
    if (!climber) return;

    const headY = climber.y - climber.headR + 1;
    const btnX = climber.x - 20;
    const btnY = headY - 16 - 40;
    undoButtonEl.style.left = btnX + 'px';
    undoButtonEl.style.top = btnY + 'px';
}

// Check if a screen tap is within the climber's 40x40 touch area
function isInClimberArea(screenX, screenY) {
    const climber = AppState.climber;
    if (!climber) return false;
    const frame = document.getElementById('app-frame');
    const rect = frame.getBoundingClientRect();
    // climber coords are in canvas space which matches frame coords
    const cx = climber.x;
    const cy = climber.y;
    const dx = screenX - rect.left - cx;
    const dy = screenY - rect.top - cy;
    return Math.abs(dx) <= 20 && Math.abs(dy) <= 20;
}

function collectUndoSettledLetters(day, entry) {
    if (entry.batchId) {
        const removed = [];
        day.settledLetters = day.settledLetters.filter(sl => {
            if (sl.batchId === entry.batchId) {
                removed.push(sl);
                return false;
            }
            return true;
        });
        return removed;
    }

    return day.settledLetters.splice(entry.settledStartIndex);
}

function collectUndoLettersFromActive(entry) {
    const removed = [];

    for (let i = activeLetters.length - 1; i >= 0; i--) {
        const al = activeLetters[i];
        if (entry.batchId && al.batchId !== entry.batchId) continue;

        if (al.isWord && al.charOffsets) {
            const bx = al.body.position.x;
            const by = al.body.position.y;
            const angle = al.body.angle;
            const cosA = Math.cos(angle);
            const sinA = Math.sin(angle);

            for (const co of al.charOffsets) {
                const rx = co.ox * cosA - co.oy * sinA;
                const ry = co.ox * sinA + co.oy * cosA;
                removed.push({
                    char: co.char,
                    origIdx: co.origIdx,
                    source: 'active',
                    sx: bx + rx,
                    sy: by + ry,
                    startAngle: angle,
                    startSize: al.size || CONFIG.fontSize,
                    ex: co.origX ?? bx + rx,
                    ey: co.origY ?? by + ry,
                    endSize: CONFIG.fontSize,
                });
            }
        } else {
            removed.push({
                char: al.char,
                origIdx: al.origIdx,
                source: 'active',
                sx: al.body.position.x,
                sy: al.body.position.y,
                startAngle: al.body.angle || 0,
                startSize: al.size || CONFIG.fontSize,
                ex: al.origX ?? al.body.position.x,
                ey: al.origY ?? al.body.position.y,
                endSize: CONFIG.fontSize,
            });
        }

        Composite.remove(AppState.world, al.body);
        activeLetters.splice(i, 1);
    }

    return removed;
}

function collectUndoLettersFromPending(entry) {
    const removed = [];

    for (let i = pendingLetters.length - 1; i >= 0; i--) {
        const pl = pendingLetters[i];
        if (entry.batchId && pl.batchId !== entry.batchId) continue;

        if (pl.type === 'word') {
            for (const ch of pl.chars) {
                removed.push({
                    char: ch.char,
                    origIdx: ch.origIdx,
                    source: 'pending',
                    sx: ch.origX ?? ch.x,
                    sy: ch.origY ?? ch.y,
                    startAngle: 0,
                    startSize: pl.size || CONFIG.fontSize,
                    ex: ch.origX ?? ch.x,
                    ey: ch.origY ?? ch.y,
                    endSize: CONFIG.fontSize,
                });
            }
        } else {
            removed.push({
                char: pl.char,
                origIdx: pl.origIdx,
                source: 'pending',
                sx: pl.origX ?? pl.x,
                sy: pl.origY ?? pl.y,
                startAngle: 0,
                startSize: pl.size || CONFIG.fontSize,
                ex: pl.origX ?? pl.x,
                ey: pl.origY ?? pl.y,
                endSize: CONFIG.fontSize,
            });
        }

        pendingLetters.splice(i, 1);
    }

    return removed;
}

// ═══════════════════════════════════════════════════════════════
// PERFORM UNDO
// ═══════════════════════════════════════════════════════════════
function measureUndoLetterBox(letter) {
    const sampleSize = Math.max(letter.startSize || 0, letter.endSize || 0, CONFIG.fontSize);
    const glyph = getGlyphData(letter.char, sampleSize);
    return {
        width: Math.max(sampleSize * 0.5, (glyph && glyph.w) ? glyph.w : sampleSize * 0.6),
        height: Math.max(sampleSize * 0.85, (glyph && glyph.h) ? glyph.h : sampleSize)
    };
}

function layoutUndoFloatTargets(letters, canvasW, mountainTopY, mountainHeight) {
    if (letters.length === 0) return [];

    const sidePadding = Math.max(20, canvasW * 0.04);
    const gapX = Math.max(10, CONFIG.fontSize * 0.65);
    const gapY = Math.max(12, CONFIG.fontSize * 0.95);
    const closeXThreshold = 18;
    const closeXMinGap = 10;
    const minLift = Math.max(mountainHeight * 0.4, CONFIG.fontSize * 2.8);
    const maxLift = Math.max(mountainHeight * 0.8, minLift + CONFIG.fontSize * 3.2);
    const bandBottom = mountainTopY - minLift;
    const bandTop = Math.max(28, mountainTopY - maxLift);
    const usableBandHeight = Math.max(40, bandBottom - bandTop);

    const measuredLetters = letters.map(letter => ({
        ...letter,
        ...measureUndoLetterBox(letter)
    }));

    const byArea = [...measuredLetters].sort((a, b) => (b.height * b.width) - (a.height * a.width));
    const placed = [];

    function requiredVerticalGap(candidate, other) {
        const xDiff = Math.abs(candidate.x - other.x);
        const xReach = (candidate.width + other.width) * 0.5 + gapX;
        if (xDiff >= xReach) return 0;

        const baseGap = (candidate.height + other.height) * 0.5 + gapY;
        const closeXGap = (candidate.height + other.height) * 0.5 + closeXMinGap;
        return xDiff <= closeXThreshold ? Math.max(baseGap, closeXGap) : baseGap;
    }

    function overlaps(candidate, other) {
        const requiredGap = requiredVerticalGap(candidate, other);
        return requiredGap > 0 && Math.abs(candidate.y - other.fy) < requiredGap;
    }

    function getClearance(candidate) {
        let minClearance = Number.POSITIVE_INFINITY;

        for (const other of placed) {
            const requiredGap = requiredVerticalGap(candidate, other);
            if (requiredGap <= 0) continue;

            const clearance = Math.abs(candidate.y - other.fy) - requiredGap;
            if (clearance < minClearance) minClearance = clearance;
        }

        return minClearance;
    }

    function getPreferredY(letter) {
        const xNorm = (letter.x - sidePadding) / Math.max(1, canvasW - sidePadding * 2);
        const waveBase = 0.5 + 0.5 * Math.sin(xNorm * Math.PI * 2.35 + (letter.origIdx || 0) * 0.73);
        const spiral = (((letter.origIdx || 0) * 0.61803398875) % 1);
        return bandTop + (0.16 + waveBase * 0.38 + spiral * 0.22) * usableBandHeight;
    }

    for (const letter of byArea) {
        const fixedX = letter.sx;
        let best = null;
        let bestScore = Infinity;
        const preferredY = getPreferredY({ ...letter, x: fixedX });

        for (let attempt = 0; attempt < 220; attempt++) {
            const minY = bandTop + letter.height * 0.5;
            const maxY = bandBottom - letter.height * 0.5;

            const spreadY = usableBandHeight * (0.12 + Math.random() * 0.28);
            const candidateY = Math.max(minY, Math.min(maxY, preferredY + (Math.random() - 0.5) * spreadY * 2));
            const candidate = { x: fixedX, y: candidateY, width: letter.width, height: letter.height };

            if (placed.some(other => overlaps(candidate, other))) continue;

            const yBias = Math.abs(candidateY - preferredY) * 0.9;
            const irregularity = Math.random() * 10;
            const score = yBias + irregularity;

            if (score < bestScore) {
                best = candidate;
                bestScore = score;
            }
        }

        if (!best) {
            const minY = bandTop + letter.height * 0.5;
            const maxY = bandBottom - letter.height * 0.5;
            const stepY = 4;
            let fallbackCandidate = null;
            let fallbackClearance = -Infinity;
            let fallbackBias = Number.POSITIVE_INFINITY;

            for (let y = minY; y <= maxY; y += stepY) {
                const candidate = { x: fixedX, y, width: letter.width, height: letter.height };
                const bias = Math.abs(y - preferredY);
                const clearance = getClearance(candidate);

                if (!placed.some(other => overlaps(candidate, other))) {
                    const score = bias;
                    if (score < bestScore) {
                        best = candidate;
                        bestScore = score;
                    }
                }

                if (
                    clearance > fallbackClearance + 0.25 ||
                    (Math.abs(clearance - fallbackClearance) <= 0.25 && bias < fallbackBias)
                ) {
                    fallbackCandidate = candidate;
                    fallbackClearance = clearance;
                    fallbackBias = bias;
                }
            }

            if (!best && fallbackCandidate) {
                best = fallbackCandidate;
            }
        }

        if (!best) {
            best = {
                x: fixedX,
                y: Math.max(bandTop + letter.height * 0.5, Math.min(bandBottom - letter.height * 0.5, preferredY)),
                width: letter.width,
                height: letter.height
            };
        }

        placed.push({
            ...letter,
            fx: fixedX,
            fy: best.y,
            dipY: Math.min(AppState.groundY - 2, letter.sy + Math.max(letter.height * 0.12, Math.abs(letter.sy - best.y) * 0.08, 6)),
            x: fixedX
        });
    }

    return placed.sort((a, b) => (a.origIdx ?? Number.MAX_SAFE_INTEGER) - (b.origIdx ?? Number.MAX_SAFE_INTEGER));
}

function revealRestoredTodo(targetTextEl, targetRing) {
    if (targetTextEl) {
        targetTextEl.style.visibility = 'visible';
        targetTextEl.style.opacity = '0';
        targetTextEl.style.transition = 'none';
        requestAnimationFrame(() => {
            targetTextEl.style.transition = 'opacity 0.5s cubic-bezier(0.22, 1, 0.36, 1)';
            targetTextEl.style.opacity = '1';
        });
    }

    if (targetRing) {
        targetRing.style.visibility = 'visible';
        targetRing.style.opacity = '0';
        targetRing.style.transform = 'scale(0.84)';
        targetRing.style.transition = 'none';
        requestAnimationFrame(() => {
            targetRing.style.transition = 'opacity 0.6s cubic-bezier(0.22, 1, 0.36, 1), transform 0.6s cubic-bezier(0.22, 1, 0.36, 1)';
            targetRing.style.opacity = '1';
            targetRing.style.transform = 'scale(1)';
        });
    }
}

function performUndo() {
    if (undoStack.length === 0 || undoAnim) return;

    const entry = undoStack.pop();
    const day = getDayData(AppState.currentDate);
    const previousItemRects = captureTodoItemRects();
    const mountainSnapshot = day.settledLetters.map(sl => ({ ...sl }));

    // Pull out all letters for this undo batch, regardless of whether
    // they're still pending, actively falling, or already settled.
    const settledLetters = collectUndoSettledLetters(day, entry);
    const activeUndoLetters = collectUndoLettersFromActive(entry);
    const pendingUndoLetters = collectUndoLettersFromPending(entry);

    // Rebuild static bodies to stay in sync
    rebuildStaticBodiesFromSettled();
    rebuildHeightmap();

    // Also remove from completedTexts
    const ctIdx = day.completedTexts.lastIndexOf(entry.text);
    if (ctIdx >= 0) day.completedTexts.splice(ctIdx, 1);

    // Re-insert the todo item immediately (hidden) so DOM positions can be measured
    const newItem = {
        id: Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        text: entry.text,
        completed: false
    };
    const insertIdx = Math.min(entry.insertIndex, day.todos.length);
    day.todos.splice(insertIdx, 0, newItem);
    renderTodoList();
    animateTodoItemReflow(previousItemRects);

    // Find and hide the re-inserted DOM element
    let targetTextEl = null;
    let targetRing = null;
    const listItems = document.querySelectorAll('.todo-item');
    for (const li of listItems) {
        if (li.dataset.id === newItem.id) {
            const textEl = li.querySelector('.todo-text');
            targetTextEl = textEl;
            targetRing = li.querySelector('.todo-ring');
            break;
        }
    }
    if (targetTextEl) {
        targetTextEl.style.visibility = 'hidden';
        targetTextEl.style.opacity = '0';
        if (targetRing) {
            targetRing.style.visibility = 'hidden';
            targetRing.style.opacity = '0';
        }
    }

    // Use original char positions recorded at cross-off time for return targets
    const originalPositions = entry.originalCharPositions || [];

    // Compute mountain height for float target
    const CW = AppState.canvasW;
    const gY = AppState.groundY;
    let mountainTopY = gY;
    if (AppState.heightmap) {
        for (let x = 0; x < CW; x++) {
            if (AppState.heightmap[x] < mountainTopY) mountainTopY = AppState.heightmap[x];
        }
    }
    const mountainHeight = Math.max(0, gY - mountainTopY);

    const settledUndoLetters = settledLetters.map(sl => {
        const origPos = (sl.origIdx != null && sl.origIdx < originalPositions.length)
            ? originalPositions[sl.origIdx]
            : null;

        return {
            char: sl.char,
            origIdx: sl.origIdx,
            source: 'settled',
            sx: sl.x,
            sy: sl.y,
            startAngle: sl.angle || 0,
            startSize: sl.size || CONFIG.fontSize,
            ex: sl.origX ?? origPos?.x ?? sl.x,
            ey: sl.origY ?? origPos?.y ?? sl.y,
            endSize: CONFIG.fontSize,
        };
    });

    // Every character returns to the exact x/y it had when the fall started.
    const undoLetters = [...settledUndoLetters, ...activeUndoLetters, ...pendingUndoLetters]
        .sort((a, b) => (a.origIdx ?? Number.MAX_SAFE_INTEGER) - (b.origIdx ?? Number.MAX_SAFE_INTEGER))
        .map(letter => ({
            ...letter,
            endSize: letter.endSize || CONFIG.fontSize,
            particles: [],
        }));

    const animLetters = layoutUndoFloatTargets(undoLetters, CW, mountainTopY, mountainHeight);

    if (animLetters.length > 0) {
        const maxStagger = Math.min(864, Math.max(230, animLetters.length * 40.3));
        for (let i = 0; i < animLetters.length; i++) {
            animLetters[i].staggerDelay = (i / Math.max(1, animLetters.length - 1)) * maxStagger;
        }
    }

    if (animLetters.length === 0) {
        revealRestoredTodo(targetTextEl, targetRing);
        hideUndoButton();
        saveTolocalStorage();
        return;
    }

    // Set climber to lookUp mode
    AppState.climber.lookUpTimer = 120; // frames

    const totalDuration = (CONFIG.undoRiseTime + CONFIG.undoReturnTime) * 1000;
    const maxStagger = animLetters.reduce((max, al) => Math.max(max, al.staggerDelay || 0), 0);

    // Single unified floating phase
    undoAnim = {
        phase: 'floating',
        letters: animLetters,
        startTime: performance.now(),
        duration: totalDuration + maxStagger,
        baseDuration: totalDuration,
        trailFadeDuration: 360,
        mountainSnapshot,
        text: entry.text,
        _targetTextEl: targetTextEl,
        _targetRing: targetRing,
        _revealed: false,
    };

    // Hide undo button only if stack is now empty
    if (undoStack.length === 0) hideUndoButton();
    saveTolocalStorage();
}

// Ease in-out cubic
function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function cubicBezier1D(t, p1, p2) {
    const inv = 1 - t;
    return 3 * inv * inv * t * p1 + 3 * inv * t * t * p2 + t * t * t;
}

function cubicBezierSlope(t, p1, p2) {
    const inv = 1 - t;
    return 3 * inv * inv * p1 + 6 * inv * t * (p2 - p1) + 3 * t * t * (1 - p2);
}

function cubicBezierEase(t, x1, y1, x2, y2) {
    let estimate = t;
    for (let i = 0; i < 6; i++) {
        const x = cubicBezier1D(estimate, x1, x2) - t;
        const slope = cubicBezierSlope(estimate, x1, x2);
        if (Math.abs(slope) < 1e-6) break;
        estimate = Math.max(0, Math.min(1, estimate - x / slope));
    }
    return cubicBezier1D(estimate, y1, y2);
}

function easeUndoFloat(t) {
    return cubicBezierEase(t, 0.42, 0, 0.07, 1);
}

function updateUndoAnimation() {
    if (!undoAnim) return;

    const now = performance.now();
    const elapsed = now - undoAnim.startTime;
    const t = Math.min(1, elapsed / undoAnim.duration);

    if (undoAnim.phase === 'floating') {
        if (t >= 1) {
            // All letters arrived — start cross-fade
            undoAnim.phase = 'crossFade';
            undoAnim.startTime = performance.now();
            undoAnim.duration = 500; // cross-fade duration in ms
            revealRestoredTodo(undoAnim._targetTextEl, undoAnim._targetRing);
            // Keep mountainSnapshot alive through crossFade so the pile doesn't jump
        }
    } else if (undoAnim.phase === 'crossFade') {
        if (t >= 1) {
            undoAnim.phase = 'trailFade';
            undoAnim.startTime = performance.now();
            undoAnim.duration = undoAnim.trailFadeDuration || 360;
            undoAnim.mountainSnapshot = null;
            undoAnim._targetTextEl = null;
            undoAnim._targetRing = null;
        }
    } else if (undoAnim.phase === 'trailFade') {
        const allParticlesDead = undoAnim.letters.every(al => !al.particles || al.particles.length === 0);
        if (t >= 1 && allParticlesDead) {
            undoAnim = null;
            saveTolocalStorage();
        }
    }
}
function drawUndoAnimation() {
    if (!undoAnim) return;

    const now = performance.now();
    const elapsed = now - undoAnim.startTime;
    const baseColor = color(CONFIG.textColor);
    const drawStates = [];

    for (const al of undoAnim.letters) {
        let x = al.sx;
        let y = al.sy;
        let sz = al.startSize;
        let angle = al.startAngle || 0;

        if (undoAnim.phase === 'trailFade') {
            continue;
        }

        if (undoAnim.phase === 'floating') {
            const localT = Math.max(0, Math.min(1, (elapsed - (al.staggerDelay || 0)) / undoAnim.baseDuration));

            // Direct position interpolation through 3 waypoints:
            // t=0: start (sx,sy)  →  t=0.4: apex (fx,fy)  →  t=0.55: dip  →  t=1: end (ex,ey)
            // Dip target is 10% back from apex toward start in Y
            const apexT = 0.4;
            const dipT = 0.55;
            const dipFrac = 0.10; // how far back toward start

            if (localT <= apexT) {
                // Rise to apex — use ease-out for smooth deceleration at top
                const segT = localT / apexT;
                const e = 1 - Math.pow(1 - segT, 3); // ease-out cubic
                x = al.sx + (al.fx - al.sx) * e;
                y = al.sy + (al.fy - al.sy) * e;
                sz = al.startSize;
                angle = (al.startAngle || 0) * (1 - e);
            } else if (localT <= dipT) {
                // Dip: ease down slightly from apex
                const segT = (localT - apexT) / (dipT - apexT);
                const dipY = al.fy + (al.sy - al.fy) * dipFrac;
                const e = Math.sin(segT * Math.PI); // smooth bump 0→1→0
                x = al.fx;
                y = al.fy + (dipY - al.fy) * e;
                sz = al.startSize;
                angle = 0;
            } else {
                // Return to end — ease-in-out for fluid continuation
                const segT = (localT - dipT) / (1 - dipT);
                const e = segT * segT * segT * (segT * (segT * 6 - 15) + 10); // smootherstep — steeper mid-section
                x = al.fx + (al.ex - al.fx) * e;
                y = al.fy + (al.ey - al.fy) * e;
                sz = al.startSize + (al.endSize - al.startSize) * e;
                angle = 0;
            }

            // Spawn particles throughout, but stop early so they die before landing
            if (localT > 0 && localT < 0.82) {
                al.particles.push({ x, y, sz, life: 80 });
            }

            drawStates.push({ char: al.char, x, y, sz, angle, opacity: 1 });
        } else if (undoAnim.phase === 'crossFade') {
            // Letters hold at final position and fade out
            x = al.ex;
            y = al.ey;
            sz = al.endSize;
            angle = 0;
            const fadeT = Math.min(1, elapsed / undoAnim.duration);
            drawStates.push({ char: al.char, x, y, sz, angle, opacity: 1 - fadeT });
        }
    }

    noStroke();
    textAlign(CENTER, CENTER);
    textFont('TWKLausanne');

    if (undoAnim.phase === 'floating' || undoAnim.phase === 'crossFade' || undoAnim.phase === 'trailFade') {
        noStroke();
        const globalT = Math.min(1, elapsed / undoAnim.duration);
        // Fast decay — particles have life=80, decay at 5+, so they die well before landing
        const decayRate = undoAnim.phase === 'trailFade' ? 12 : (5 + globalT * 15);
        for (const al of undoAnim.letters) {
            if (!al.particles || al.particles.length === 0) continue;
            for (let i = al.particles.length - 1; i >= 0; i--) {
                const p = al.particles[i];
                p.life -= decayRate;
                fill(0, Math.max(0, p.life) * 0.06);
                ellipse(p.x, p.y, p.sz * 0.6, p.sz * 0.6);
                if (p.life <= 0) al.particles.splice(i, 1);
            }
        }
    }

    // Draw lines between neighboring letters
    if (drawStates.length > 1 && undoAnim.phase === 'floating') {
        const globalT = Math.min(1, elapsed / undoAnim.duration);
        // Lines fade out in the second half of the motion
        const lineFade = globalT < 0.5 ? 1 : 1 - (globalT - 0.5) / 0.5;
        stroke(0, 51 * lineFade);
        strokeWeight(1);
        for (let i = 0; i < drawStates.length - 1; i++) {
            const a = drawStates[i];
            const b = drawStates[i + 1];
            line(a.x, a.y, b.x, b.y);
        }
        noStroke();
    }

    for (const state of drawStates) {
        const c = color(CONFIG.textColor);
        c.setAlpha(255 * (state.opacity ?? 1));
        fill(c);
        push();
        translate(state.x, state.y);
        rotate(state.angle || 0);
        textSize(state.sz);
        text(state.char, 0, 0);
        pop();
    }
}
function resizeApp() {
    CONFIG.frameWidth = window.innerWidth;
    CONFIG.frameHeight = window.innerHeight;

    const CW = CONFIG.frameWidth;
    const CH = CONFIG.frameHeight;

    AppState.canvasW = CW;
    AppState.canvasH = CH;
    AppState.groundY = CH - 4;

    resizeCanvas(CW, CH);

    AppState.heightmap = new Float32Array(CONFIG.frameWidth);
    AppState.heightmap.fill(AppState.groundY);

    // Rebuild physics walls
    if (AppState.world) {
        const statics = Composite.allBodies(AppState.world).filter(b => b.isStatic);
        for (const s of statics) Composite.remove(AppState.world, s);

        const CW = CONFIG.frameWidth;
        const ground = Bodies.rectangle(CW / 2, AppState.groundY + 25, CW + 100, 50, {
            isStatic: true, friction: 0.9, restitution: 0.05
        });
        const wallL = Bodies.rectangle(-15, CH / 2, 30, CH + 100, {
            isStatic: true, friction: 0.3
        });
        const wallR = Bodies.rectangle(CW + 15, CH / 2, 30, CH + 100, {
            isStatic: true, friction: 0.3
        });
        Composite.add(AppState.world, [ground, wallL, wallR]);
        rebuildStaticBodiesFromSettled();
    }

    AppState.climber = new Climber(CONFIG.frameWidth, AppState.groundY);
    updateTodoAreaBounds();
    updateScrollFade();
}

// ═══════════════════════════════════════════════════════════════
// P5.JS GLOBAL MODE — setup and draw
// ═══════════════════════════════════════════════════════════════
function setup() {
    // Full-screen layout
    CONFIG.frameWidth = window.innerWidth;
    CONFIG.frameHeight = window.innerHeight;
    const frame = document.getElementById('app-frame');
    frame.style.background = CONFIG.bgColor;

    // Date navigation
    document.getElementById('date-prev').addEventListener('click', () => navigateDate(-1));
    document.getElementById('date-next').addEventListener('click', () => navigateDate(1));

    // Todo area scroll-fade detection
    const todoArea = document.getElementById('todo-area');
    todoArea.addEventListener('scroll', updateScrollFade);
    // Also observe DOM changes (items added/removed) to re-check
    new MutationObserver(updateScrollFade).observe(
        document.getElementById('todo-list'), { childList: true, subtree: true }
    );

    // Canvas setup — full frame size, ground at bottom
    const CW = CONFIG.frameWidth;
    const CH = CONFIG.frameHeight;

    AppState.canvasW = CW;
    AppState.canvasH = CH;
    AppState.groundY = CH - 4;
    AppState.heightmap = new Float32Array(CW);
    AppState.heightmap.fill(AppState.groundY);

    pixelDensity(window.devicePixelRatio || 2);
    const canvas = createCanvas(CW, CH);
    canvas.parent('mountain-zone');

    initPhysics();
    AppState.climber = new Climber(CW, AppState.groundY);

    // Always start fresh
    localStorage.removeItem('mountainTodo');
    AppState.days = {};
    AppState.currentDate = new Date();
    {
        const day = getDayData(AppState.currentDate);
        const defaultTodos = [
            'Tensorlake Explorations #1',
            'Tensorlake Explorations #2',
            'Collect items from the mailbox',
            'CVD Assignment + Reading',
            'Talk to Prof. Raquel',
            "Duke in LA - Karen's Midterm",
            "Duke in LA - Karen's Essay",
            'Project Blue - Full Screen Overheat',
            'Project Blue - Building State',
            'Project Blue - Level selection',
            'Project Blue - Movement system',
            'Duke in NY living preferences',
            'OK Food Night',
            'SVSD - Design Wrapped',
            'Fellou.ai - Update #1',
            'Fellou.ai - Update #2',
            'talk to academic advisor',
            'Send email to professor holly willis',
            'Send email intro to professor Fred',
            'OK - Big Reach-out #1',
            'OK - Big Reach-out #2',
            'OK - Big Reach-out #3',
            'OK - Big Reach-out #4',
            ''
        ];
        for (const t of defaultTodos) {
            addNewTodoItem(day, t);
        }
    }
    updateDateDisplay();
    renderTodoList();
    updateTodoAreaBounds();

    // Rebuild static collision bodies from existing settled letters
    rebuildStaticBodiesFromSettled();

    textFont('TWKLausanne');

    // Create undo button
    undoButtonEl = createUndoButton();

    // Click handler for climber touch area and dismiss
    document.getElementById('app-frame').addEventListener('pointerdown', (e) => {
        // Check if click is on the undo button itself — handled by its own listener
        if (e.target.closest('#undo-button')) return;

        if (isInClimberArea(e.clientX, e.clientY)) {
            // Prevent focus on any text input / keyboard popup
            e.preventDefault();
            // Blur any focused element
            if (document.activeElement) document.activeElement.blur();

            if (undoButtonVisible) {
                hideUndoButton();
            } else {
                showUndoButton();
            }
        } else if (undoButtonVisible) {
            // Click outside climber + undo button → dismiss
            hideUndoButton();
        }
    });

    // Handle window resize
    window.addEventListener('resize', () => {
        resizeApp();
    });
}

function draw() {
    const CW = AppState.canvasW;
    const CH = AppState.canvasH;
    const gY = AppState.groundY;

    // Update physics
    if (AppState.engine) {
        AppState.engine.gravity.y = CONFIG.gravity;
        Engine.update(AppState.engine, (1000/60) * CONFIG.animationSpeed);
    }

    // Release staggered pending letters (right-to-left cascade)
    releasePendingLetters();

    // Settle active letters
    updateActiveLetters();

    // Rebuild heightmap
    if (frameCount % 3 === 0) {
        rebuildHeightmap();
    }

    // Draw
    background(CONFIG.bgColor);

    // Ground line
    stroke(200); strokeWeight(0.5);
    line(0, gY, CW, gY);

    // Render older day mountains (back to front)
    for (let daysAgo = CONFIG.mountainDayCount - 1; daysAgo >= 1; daysAgo--) {
        const pastDate = addDays(AppState.currentDate, -daysAgo);
        const pastDay = AppState.days[dateKey(pastDate)];
        if (!pastDay || pastDay.settledLetters.length === 0) continue;

        const opacity = CONFIG.mountainOpacityBase - daysAgo * CONFIG.mountainOpacityFalloff;
        if (opacity <= 0) continue;

        const yOffset = daysAgo * CONFIG.mountainLayerOffset;
        const blurPx = CONFIG.mountainBlurBase + daysAgo * CONFIG.mountainBlurFalloff;
        drawMountainLayer(pastDay, opacity, yOffset, CW, CH, blurPx);
    }

    // Draw current day's settled letters
    const currentDay = getDayData(AppState.currentDate);
    const currentMountainDay = (undoAnim && undoAnim.mountainSnapshot)
        ? { settledLetters: undoAnim.mountainSnapshot }
        : currentDay;
    if (currentMountainDay.settledLetters.length > 0) {
        drawMountainLayer(currentMountainDay, CONFIG.mountainOpacityBase, 0, CW, CH, CONFIG.mountainBlurBase);
    }

    // Draw pending letters still waiting at their original positions
    // These replace the hidden DOM text so the transition feels seamless
    fill(CONFIG.textColor);
    noStroke();
    textAlign(CENTER, CENTER);
    textFont('TWKLausanne');
    for (const pl of pendingLetters) {
        textSize(pl.size);
        if (pl.type === 'word') {
            // Draw each character of the word at its original position
            for (const c of pl.chars) {
                text(c.char, c.x, c.y);
            }
        } else {
            text(pl.char, pl.x, pl.y);
        }
    }

    // Draw active falling letters — use native p5 text() for crisp rendering
    fill(CONFIG.mountainBaseColor);
    noStroke();
    textAlign(CENTER, CENTER);
    textFont('TWKLausanne');
    const scaleZoneStart = CH * 0.8; // top of bottom 20%
    for (const al of activeLetters) {
        const b = al.body;
        const baseSz = al.size || CONFIG.fontSize;
        // Gradually scale from 1.0 to 1.25 as letter falls into bottom 20%
        const yProgress = Math.max(0, Math.min(1, (b.position.y - scaleZoneStart) / (gY - scaleZoneStart)));
        const scaleFactor = 1.0 + yProgress * 0.25;
        const sz = baseSz * scaleFactor;
        push();
        translate(b.position.x, b.position.y);
        rotate(b.angle);
        textSize(sz);

        if (al.isWord && al.charOffsets) {
            // Word mode: draw each character at its offset within the word body
            for (const co of al.charOffsets) {
                text(co.char, co.ox, co.oy);
            }
        } else {
            text(al.char, 0, 0);
        }

        pop();
    }

    // Undo animation
    updateUndoAnimation();
    drawUndoAnimation();

    // Climber
    AppState.climber.update(AppState.heightmap, CW, gY);
    AppState.climber.display();

    // Keep undo button positioned over climber
    updateUndoButtonPosition();
}

