// ═══════════════════════════════════════════════════════════════
// Matter.js aliases
// ═══════════════════════════════════════════════════════════════
const { Engine, Bodies, Body, Composite } = Matter;

// ═══════════════════════════════════════════════════════════════
// PARAMS
// ═══════════════════════════════════════════════════════════════
let params = {
    seed: 12345,
    gravity: 1.0,
    letterSize: 40,
    bounce: 0.2,
    friction: 0.6,
    agentSpeed: 1.5,
    randomSize: false
};
let defaultParams = { ...params };

// QWERTY key → normalized x [0..1]
const keyXMap = {};
[
    { keys: '`1234567890-=', s: 0 },
    { keys: 'qwertyuiop[]\\', s: 0.03 },
    { keys: "asdfghjkl;'", s: 0.06 },
    { keys: 'zxcvbnm,./', s: 0.09 },
].forEach(row => {
    for (let i = 0; i < row.keys.length; i++)
        keyXMap[row.keys[i]] = row.s + (i + 0.5) / 14;
});
'qwertyuiopasdfghjklzxcvbnm'.split('').forEach(c => {
    keyXMap[c.toUpperCase()] = keyXMap[c];
});
keyXMap[' '] = 0.5;

// ═══════════════════════════════════════════════════════════════
// GLOBALS
// ═══════════════════════════════════════════════════════════════
let CW, CH, groundY;
let letterCount = 0;
let letterBodies = [];
let engine, world;
let agent;
let heightmap;
const glyphCache = {};
const traceCanvas = document.createElement('canvas');
const traceCtx = traceCanvas.getContext('2d', { willReadFrequently: true });

// ═══════════════════════════════════════════════════════════════
// MATTER.JS INIT
// ═══════════════════════════════════════════════════════════════
function initPhysics() {
    engine = Engine.create({ enableSleeping: true });
    world = engine.world;
    engine.gravity.y = params.gravity;

    const ground = Bodies.rectangle(CW / 2, groundY + 25, CW + 200, 50, {
        isStatic: true, friction: 0.8, restitution: 0.1
    });
    const wallL = Bodies.rectangle(-25, CH / 2, 50, CH + 200, {
        isStatic: true, friction: 0.3
    });
    const wallR = Bodies.rectangle(CW + 25, CH / 2, 50, CH + 200, {
        isStatic: true, friction: 0.3
    });
    Composite.add(world, [ground, wallL, wallR]);
}

// ═══════════════════════════════════════════════════════════════
// GLYPH OUTLINE EXTRACTION
// ═══════════════════════════════════════════════════════════════
// GLYPH EXTRACTION PIPELINE: Converts each typed character into a physics-ready shape.
// Steps: 1) Render character to offscreen canvas, 2) Binary threshold on alpha channel,
// 3) Find boundary pixels, 4) Compute convex hull, 5) Simplify to ≤12 vertices with RDP,
// 6) Generate character image for rendering. All results are cached by char+size.
function getGlyphData(char, size) {
    const key = char + '|' + size;
    if (glyphCache[key]) return glyphCache[key];

    const pad = 8;
    const cw = Math.ceil(size * 1.2) + pad * 2;
    const ch = Math.ceil(size * 1.4) + pad * 2;
    traceCanvas.width = cw;
    traceCanvas.height = ch;

    traceCtx.clearRect(0, 0, cw, ch);
    traceCtx.fillStyle = 'white';
    traceCtx.font = `600 ${size}px Inter, sans-serif`;
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
    charCtx.font = `600 ${size}px Inter, sans-serif`;
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
// Andrew's monotone chain algorithm — O(n log n) convex hull using cross-product orientation test.
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

// Ramer-Douglas-Peucker line simplification — recursively removes points within epsilon distance of the simplified line.
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
// SPAWN LETTER
// ═══════════════════════════════════════════════════════════════
// Letters are spawned at x-positions mapped from the QWERTY keyboard layout — each key has
// a corresponding horizontal position on screen, creating a spatial relationship between
// typing and where letters land.
function spawnLetter(char, dropX) {
    // Determine size — random if checkbox is checked
    let size = params.letterSize;
    if (params.randomSize) {
        size = Math.floor(size * (0.5 + Math.random() * 0.5));
        // Ensure minimum usable size
        size = Math.max(16, size);
    }

    const glyph = getGlyphData(char, size);

    let body;
    try {
        body = Bodies.fromVertices(dropX, -60, [glyph.verts.map(v => ({ x: v.x, y: v.y }))], {
            restitution: params.bounce,
            friction: params.friction,
            frictionAir: 0.01,
            density: 0.002,
            sleepThreshold: 30,
            label: 'letter_' + char
        });
    } catch(e) {
        body = Bodies.rectangle(dropX, -60, glyph.w || 20, glyph.h || 30, {
            restitution: params.bounce,
            friction: params.friction,
            frictionAir: 0.01,
            density: 0.002,
            sleepThreshold: 30,
            label: 'letter_' + char
        });
    }

    if (!body) return;

    Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.05);
    Body.setVelocity(body, { x: (Math.random() - 0.5) * 1, y: 0 });

    Composite.add(world, body);

    letterBodies.push({
        body, char, glyph,
        charImg: glyph.charImg,
        imgW: glyph.imgW, imgH: glyph.imgH,
        imgOffX: glyph.cx, imgOffY: glyph.cy
    });

    letterCount++;
}

// ═══════════════════════════════════════════════════════════════
// HEIGHTMAP
// ═══════════════════════════════════════════════════════════════
// The heightmap is a 1D array (one entry per screen pixel column) tracking the highest point
// of any sleeping (settled) physics body. Used by the climbing agent to navigate the letter
// pile's terrain.
function rebuildHeightmap() {
    heightmap.fill(groundY);

    for (let lb of letterBodies) {
        let b = lb.body;
        if (!b.isSleeping) continue;

        let parts = b.parts;
        for (let p = (parts.length > 1 ? 1 : 0); p < parts.length; p++) {
            let verts = parts[p].vertices;
            for (let i = 0; i < verts.length; i++) {
                let a = verts[i];
                let next = verts[(i + 1) % verts.length];

                let x0 = Math.min(a.x, next.x), x1 = Math.max(a.x, next.x);
                let colStart = Math.max(0, Math.floor(x0));
                let colEnd = Math.min(CW - 1, Math.ceil(x1));

                for (let col = colStart; col <= colEnd; col++) {
                    let dx = next.x - a.x;
                    let y;
                    if (Math.abs(dx) < 0.001) {
                        y = Math.min(a.y, next.y);
                    } else {
                        let t = (col - a.x) / dx;
                        t = Math.max(0, Math.min(1, t));
                        y = a.y + t * (next.y - a.y);
                    }
                    if (y < heightmap[col]) heightmap[col] = y;
                }
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// CLIMBING AGENT
// ═══════════════════════════════════════════════════════════════
// The climbing agent is an animated stick figure that autonomously navigates the letter pile.
// It searches the heightmap for the highest peak, walks/climbs toward it using spring-damped
// movement, and animates limbs procedurally using sine-wave walk cycles.
class ClimbingAgent {
    constructor() {
        this.x = CW / 2; this.y = groundY;
        this.vx = 0; this.vy = 0;
        this.targetX = CW / 2; this.targetY = groundY;
        this.facing = 1;
        this.bodyH = 22; this.headR = 6; this.limbLen = 14;
        this.walkPhase = 0; this.armPhase = 0; this.isClimbing = false;
        this.lFx=0; this.lFy=0; this.rFx=0; this.rFy=0;
        this.lHx=0; this.lHy=0; this.rHx=0; this.rHy=0;
    }

    findHighest() {
        let bestY = groundY, bestX = CW / 2;
        for (let x = 10; x < CW - 10; x += 3) {
            if (heightmap[x] < bestY) { bestY = heightmap[x]; bestX = x; }
        }
        this.targetX = bestX;
        this.targetY = bestY - this.bodyH - this.headR;
    }

    surfaceY(atX) {
        let ix = Math.max(0, Math.min(CW - 1, Math.round(atX)));
        let best = heightmap[ix];
        for (let d = -4; d <= 4; d++) {
            let xi = Math.max(0, Math.min(CW - 1, ix + d));
            if (heightmap[xi] < best) best = heightmap[xi];
        }
        return best;
    }

    update() {
        this.findHighest();

        let dx = this.targetX - this.x;
        if (Math.abs(dx) > 3) {
            this.vx += Math.sign(dx) * 0.12 * params.agentSpeed;
            this.facing = Math.sign(dx);
        }
        this.vx *= 0.85;
        this.x += this.vx;

        let sy = this.surfaceY(this.x);
        let target = sy - this.bodyH;

        if (this.y < target - 2) {
            this.vy += 0.4;
        } else if (this.y > target + 1) {
            this.y += (target - this.y) * 0.3;
            this.vy = 0;
        } else {
            this.vy = 0;
            this.y = target;
        }
        this.y += this.vy;

        if (this.y > groundY - this.bodyH) { this.y = groundY - this.bodyH; this.vy = 0; }
        this.x = Math.max(20, Math.min(CW - 20, this.x));

        let spd = Math.abs(this.vx);
        if (spd > 0.3) {
            this.walkPhase += spd * 0.15;
            this.armPhase += spd * 0.15;
            this.isClimbing = this.targetY < this.y - 10;
        } else {
            this.walkPhase += 0.02;
            this.armPhase += 0.015;
            this.isClimbing = false;
        }
        this.calcLimbs();
    }

    calcLimbs() {
        let hipY = this.y + this.bodyH, shY = this.y + 4;
        let f = this.facing, spd = Math.abs(this.vx);
        let wc = Math.sin(this.walkPhase), ac = Math.sin(this.armPhase + Math.PI);
        let stride = Math.min(spd > 0.3 ? spd * 4 : 2, this.limbLen * 0.7);

        this.lFx = this.x + wc * stride * f;
        this.lFy = Math.min(hipY + this.limbLen * 0.5, this.surfaceY(this.lFx));
        this.rFx = this.x - wc * stride * f;
        this.rFy = Math.min(hipY + this.limbLen * 0.5, this.surfaceY(this.rFx));

        if (this.isClimbing && spd > 0.3) {
            this.lHx = this.x + ac * 8 * f; this.lHy = shY - this.limbLen * 0.8;
            this.rHx = this.x - ac * 8 * f; this.rHy = shY - this.limbLen * 0.6;
        } else {
            this.lHx = this.x + ac * stride * 0.5 * f;
            this.lHy = shY + this.limbLen * 0.7 + Math.sin(this.armPhase) * 2;
            this.rHx = this.x - ac * stride * 0.5 * f;
            this.rHy = shY + this.limbLen * 0.7 - Math.sin(this.armPhase) * 2;
        }
    }

    display() {
        push();
        stroke(0, 220, 80); strokeWeight(2.5); noFill();
        let hipY = this.y + this.bodyH, shY = this.y + 4, headY = this.y - this.headR + 2;

        this.drawLimb(this.x - 3, hipY, this.lFx, this.lFy, -1);
        this.drawLimb(this.x + 3, hipY, this.rFx, this.rFy, 1);
        line(this.x, hipY, this.x, shY);
        this.drawLimb(this.x - 2, shY, this.lHx, this.lHy, -1);
        this.drawLimb(this.x + 2, shY, this.rHx, this.rHy, 1);

        fill(0, 220, 80); noStroke();
        ellipse(this.x, headY, this.headR * 2, this.headR * 2);
        fill(0);
        let eo = this.facing * 2;
        ellipse(this.x + eo - 1.5, headY - 1, 2, 2);
        ellipse(this.x + eo + 1.5, headY - 1, 2, 2);
        pop();
    }

    drawLimb(sx, sy, ex, ey, side) {
        let ddx = ex - sx, ddy = ey - sy, len = Math.hypot(ddx, ddy);
        let nx = len > 0 ? -ddy / len : 0, ny = len > 0 ? ddx / len : 1;
        let mx = (sx + ex) / 2 + nx * 6 * side;
        let my = (sy + ey) / 2 + ny * 6 * side;
        line(sx, sy, mx, my);
        line(mx, my, ex, ey);
    }
}

// ═══════════════════════════════════════════════════════════════
// P5.JS — SETUP & DRAW
// ═══════════════════════════════════════════════════════════════
function setup() {
    CW = windowWidth;
    CH = windowHeight;
    createCanvas(CW, CH);
    groundY = CH - 20;
    heightmap = new Float32Array(CW);
    heightmap.fill(groundY);

    randomSeed(params.seed);
    noiseSeed(params.seed);

    initPhysics();
    agent = new ClimbingAgent();
}

function windowResized() {
    CW = windowWidth;
    CH = windowHeight;
    resizeCanvas(CW, CH);
    groundY = CH - 20;

    // Rebuild heightmap at new width
    heightmap = new Float32Array(CW);
    heightmap.fill(groundY);

    // Rebuild physics boundaries
    // Remove old static bodies and re-add
    let statics = Composite.allBodies(world).filter(b => b.isStatic);
    for (let s of statics) Composite.remove(world, s);

    const ground = Bodies.rectangle(CW / 2, groundY + 25, CW + 200, 50, {
        isStatic: true, friction: 0.8, restitution: 0.1
    });
    const wallL = Bodies.rectangle(-25, CH / 2, 50, CH + 200, {
        isStatic: true, friction: 0.3
    });
    const wallR = Bodies.rectangle(CW + 25, CH / 2, 50, CH + 200, {
        isStatic: true, friction: 0.3
    });
    Composite.add(world, [ground, wallL, wallR]);
}

function draw() {
    Engine.update(engine, 1000 / 60);

    if (frameCount % 5 === 0) rebuildHeightmap();

    background(0);

    // Ground line
    stroke(40); strokeWeight(1);
    line(0, groundY, CW, groundY);

    // Letters
    for (let lb of letterBodies) {
        let b = lb.body;
        push();
        translate(b.position.x, b.position.y);
        rotate(b.angle);
        if (lb.charImg) {
            drawingContext.drawImage(lb.charImg, -lb.imgOffX, -lb.imgOffY);
        } else {
            fill(255); noStroke();
            textAlign(CENTER, CENTER);
            textSize(params.letterSize);
            textFont('Inter, sans-serif');
            text(lb.char, 0, -2);
        }
        pop();
    }

    // Agent
    agent.update();
    agent.display();

    // Prompt
    if (letterBodies.length === 0) {
        push(); fill(60); noStroke(); textAlign(CENTER, CENTER);
        textSize(16); textFont('Inter, sans-serif');
        text('start typing', CW / 2, CH / 2);
        pop();
    }

    // Stats
    if (frameCount % 15 === 0) {
        let hy = groundY;
        for (let x = 0; x < CW; x++) { if (heightmap[x] < hy) hy = heightmap[x]; }
        let sleeping = letterBodies.filter(lb => lb.body.isSleeping).length;
        document.getElementById('stat-letters').textContent = letterCount;
        document.getElementById('stat-height').textContent = Math.round(groundY - hy);
        document.getElementById('stat-agent').textContent = Math.round(groundY - agent.y);
        document.getElementById('stat-sleeping').textContent = sleeping + '/' + letterBodies.length;
    }
}

// ═══════════════════════════════════════════════════════════════
// KEYBOARD INPUT
// ═══════════════════════════════════════════════════════════════
function keyTyped() {
    // Don't capture if user is focused on an input field
    if (document.activeElement.tagName === 'INPUT') return;

    let c = key;
    let nx = keyXMap[c];
    if (nx === undefined) nx = 0.3 + Math.random() * 0.4;
    let margin = 50;
    let dropX = margin + nx * (CW - margin * 2) + (Math.random() - 0.5) * 12;
    spawnLetter(c, dropX);
    return false;
}

function keyPressed() {
    if (document.activeElement.tagName === 'INPUT') return;
    if (key === ' ') {
        let dropX = 50 + 0.5 * (CW - 100) + (Math.random() - 0.5) * 12;
        spawnLetter('_', dropX);
        return false;
    }
}

// ═══════════════════════════════════════════════════════════════
// UI HANDLERS
// ═══════════════════════════════════════════════════════════════
function togglePanel() {
    const panel = document.getElementById('panel');
    const toggle = document.getElementById('menu-toggle');
    const isOpen = panel.classList.contains('open');

    if (isOpen) {
        panel.classList.remove('open');
        toggle.classList.remove('hidden');
    } else {
        panel.classList.add('open');
        toggle.classList.add('hidden');
    }
}

function updateParam(n, v) {
    params[n] = parseFloat(v);
    document.getElementById(n + '-value').textContent = parseFloat(v).toFixed(2);

    if (n === 'gravity') engine.gravity.y = params.gravity;
    if (n === 'bounce' || n === 'friction') {
        for (let lb of letterBodies) {
            lb.body.restitution = params.bounce;
            lb.body.friction = params.friction;
        }
    }
}

function clearLetters() {
    for (let lb of letterBodies) Composite.remove(world, lb.body);
    letterBodies = [];
    letterCount = 0;
    heightmap.fill(groundY);
    agent = new ClimbingAgent();
}

function exportImage() {
    saveCanvas('typographic-gravity-' + params.seed, 'png');
}

function updateSeedDisplay() {
    document.getElementById('seed-input').value = params.seed;
}

function updateSeed() {
    let v = parseInt(document.getElementById('seed-input').value);
    if (v > 0) { params.seed = v; randomSeed(v); noiseSeed(v); }
    else updateSeedDisplay();
}

function previousSeed() {
    params.seed = Math.max(1, params.seed - 1);
    updateSeedDisplay(); randomSeed(params.seed); noiseSeed(params.seed);
}

function nextSeed() {
    params.seed++;
    updateSeedDisplay(); randomSeed(params.seed); noiseSeed(params.seed);
}

function randomSeedAndUpdate() {
    params.seed = Math.floor(Math.random() * 999999) + 1;
    updateSeedDisplay(); randomSeed(params.seed); noiseSeed(params.seed);
}

function resetParameters() {
    params = { ...defaultParams };
    engine.gravity.y = params.gravity;
    ['gravity','letterSize','bounce','friction','agentSpeed'].forEach(k => {
        document.getElementById(k).value = params[k];
        document.getElementById(k + '-value').textContent = parseFloat(params[k]).toFixed(2);
    });
    document.getElementById('randomSize').checked = false;
    updateSeedDisplay();
    clearLetters();
}

window.addEventListener('load', updateSeedDisplay);
