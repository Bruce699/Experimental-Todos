const { Engine, Bodies, Body, Composite } = Matter;

const FOOTER_WIDTH = 1443;
const FOOTER_HEIGHT = 421;

let params = {
    seed: 12345,
    gravity: 1.0,
    letterSize: 40,
    bounce: 0.2,
    friction: 0.6,
    agentSpeed: 1.5,
    randomSize: true
};

const marketingWords = [
    'Write',
    'faster',
    'collaborate',
    'smarter',
    'and',
    'bring',
    'every',
    'idea',
    'to',
    'life',
    'in',
    'Google',
    'Docs'
];

const keyXMap = {};
[
    { keys: '`1234567890-=', s: 0 },
    { keys: 'qwertyuiop[]\\', s: 0.03 },
    { keys: "asdfghjkl;'", s: 0.06 },
    { keys: 'zxcvbnm,./', s: 0.09 },
].forEach((row) => {
    for (let i = 0; i < row.keys.length; i++) {
        keyXMap[row.keys[i]] = row.s + (i + 0.5) / 14;
    }
});
'qwertyuiopasdfghjklzxcvbnm'.split('').forEach((c) => {
    keyXMap[c.toUpperCase()] = keyXMap[c];
});
keyXMap[' '] = 0.5;
const mappedKeyPositions = Object.values(keyXMap);
const minMappedKeyX = Math.min(...mappedKeyPositions);
const maxMappedKeyX = Math.max(...mappedKeyPositions);

let CW = FOOTER_WIDTH;
let CH = FOOTER_HEIGHT;
let groundY;
let letterCount = 0;
let letterBodies = [];
let engine;
let world;
let agent;
let heightmap;
const glyphCache = {};
const traceCanvas = document.createElement('canvas');
const traceCtx = traceCanvas.getContext('2d', { willReadFrequently: true });
let currentWordIndex = 0;
let currentCharIndex = 0;

function initPhysics() {
    engine = Engine.create({ enableSleeping: true });
    world = engine.world;
    engine.gravity.y = params.gravity;

    const ground = Bodies.rectangle(CW / 2, groundY + 25, CW + 200, 50, {
        isStatic: true,
        friction: 0.8,
        restitution: 0.1
    });
    const wallL = Bodies.rectangle(-25, CH / 2, 50, CH + 200, {
        isStatic: true,
        friction: 0.3
    });
    const wallR = Bodies.rectangle(CW + 25, CH / 2, 50, CH + 200, {
        isStatic: true,
        friction: 0.3
    });
    Composite.add(world, [ground, wallL, wallR]);
}

function getGlyphData(char, size) {
    const key = char + '|' + size;
    if (glyphCache[key]) {
        return glyphCache[key];
    }

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
    for (let i = 0; i < cw * ch; i++) {
        grid[i] = pixels[i * 4 + 3] > 80 ? 1 : 0;
    }

    let boundary = [];
    for (let y = 1; y < ch - 1; y++) {
        for (let x = 1; x < cw - 1; x++) {
            if (
                grid[y * cw + x] === 1 &&
                (grid[(y - 1) * cw + x] === 0 ||
                    grid[(y + 1) * cw + x] === 0 ||
                    grid[y * cw + x - 1] === 0 ||
                    grid[y * cw + x + 1] === 0)
            ) {
                boundary.push({ x, y });
            }
        }
    }

    if (boundary.length < 3) {
        const fw = size * 0.3;
        const fh = size * 0.15;
        const verts = [
            { x: -fw / 2, y: -fh / 2 },
            { x: fw / 2, y: -fh / 2 },
            { x: fw / 2, y: fh / 2 },
            { x: -fw / 2, y: fh / 2 }
        ];
        const fallback = { verts, cx: cw / 2, cy: ch / 2, w: fw, h: fh, charImg: null };
        glyphCache[key] = fallback;
        return fallback;
    }

    let hull = convexHull(boundary);
    hull = rdpSimplify(hull, 1.8);
    if (hull.length < 3) {
        hull = convexHull(boundary);
    }

    while (hull.length > 12) {
        hull = rdpSimplify(hull, hull.length > 20 ? 3.0 : 2.0);
        if (hull.length < 4) {
            hull = convexHull(boundary);
            break;
        }
    }

    let cx = 0;
    let cy = 0;
    for (const point of hull) {
        cx += point.x;
        cy += point.y;
    }
    cx /= hull.length;
    cy /= hull.length;

    const verts = hull.map((point) => ({ x: point.x - cx, y: point.y - cy }));

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const point of verts) {
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
        minY = Math.min(minY, point.y);
        maxY = Math.max(maxY, point.y);
    }

    const charCanvas = document.createElement('canvas');
    charCanvas.width = cw;
    charCanvas.height = ch;
    const charCtx = charCanvas.getContext('2d');
    charCtx.fillStyle = 'white';
    charCtx.font = `600 ${size}px Inter, sans-serif`;
    charCtx.textBaseline = 'alphabetic';
    charCtx.textAlign = 'left';
    charCtx.fillText(char, pad, ch - pad - size * 0.2);

    const data = {
        verts,
        cx,
        cy,
        w: maxX - minX,
        h: maxY - minY,
        charImg: charCanvas,
        imgW: cw,
        imgH: ch
    };
    glyphCache[key] = data;
    return data;
}

function convexHull(points) {
    const pts = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
    if (pts.length <= 2) {
        return pts.slice();
    }

    const lower = [];
    for (const point of pts) {
        while (lower.length >= 2 && cross2(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
            lower.pop();
        }
        lower.push(point);
    }

    const upper = [];
    for (let i = pts.length - 1; i >= 0; i--) {
        while (upper.length >= 2 && cross2(upper[upper.length - 2], upper[upper.length - 1], pts[i]) <= 0) {
            upper.pop();
        }
        upper.push(pts[i]);
    }

    lower.pop();
    upper.pop();
    return lower.concat(upper);
}

function cross2(o, a, b) {
    return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function rdpSimplify(pts, eps) {
    if (pts.length <= 2) {
        return pts;
    }

    let dmax = 0;
    let idx = 0;
    const end = pts.length - 1;
    for (let i = 1; i < end; i++) {
        const distance = ptLineDist(pts[i], pts[0], pts[end]);
        if (distance > dmax) {
            dmax = distance;
            idx = i;
        }
    }

    if (dmax > eps) {
        const left = rdpSimplify(pts.slice(0, idx + 1), eps);
        const right = rdpSimplify(pts.slice(idx), eps);
        return left.slice(0, -1).concat(right);
    }
    return [pts[0], pts[end]];
}

function ptLineDist(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    if (l2 === 0) {
        return Math.hypot(p.x - a.x, p.y - a.y);
    }

    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function getDropXFromNormalized(nx) {
    return Math.max(0, Math.min(CW, nx * CW + (Math.random() - 0.5) * 12));
}

function getDropXForKey(character) {
    const mappedX = keyXMap[character];
    if (mappedX === undefined) {
        return getDropXFromNormalized(Math.random());
    }

    const normalizedX = (mappedX - minMappedKeyX) / (maxMappedKeyX - minMappedKeyX);
    return getDropXFromNormalized(normalizedX);
}

function spawnLetter(char, dropX) {
    let size = params.letterSize;
    if (params.randomSize) {
        size = Math.floor(size * (0.5 + Math.random() * 1.5));
        size = Math.max(16, size);
    }

    const glyph = getGlyphData(char, size);

    let body;
    try {
        body = Bodies.fromVertices(dropX, -60, [glyph.verts.map((v) => ({ x: v.x, y: v.y }))], {
            restitution: params.bounce,
            friction: params.friction,
            frictionAir: 0.01,
            density: 0.002,
            sleepThreshold: 30,
            label: 'letter_' + char
        });
    } catch (error) {
        body = Bodies.rectangle(dropX, -60, glyph.w || 20, glyph.h || 30, {
            restitution: params.bounce,
            friction: params.friction,
            frictionAir: 0.01,
            density: 0.002,
            sleepThreshold: 30,
            label: 'letter_' + char
        });
    }

    if (!body) {
        return;
    }

    Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.05);
    Body.setVelocity(body, { x: (Math.random() - 0.5) * 1, y: 0 });

    Composite.add(world, body);

    letterBodies.push({
        body,
        char,
        glyph,
        charImg: glyph.charImg,
        imgW: glyph.imgW,
        imgH: glyph.imgH,
        imgOffX: glyph.cx,
        imgOffY: glyph.cy
    });

    letterCount++;
}

function getActiveWord() {
    return marketingWords[currentWordIndex] || '';
}

function isScriptComplete() {
    return currentWordIndex >= marketingWords.length;
}

function advanceTyping(character) {
    if (isScriptComplete()) {
        return false;
    }

    const activeWord = getActiveWord();
    const expectedChar = activeWord[currentCharIndex];
    if (!expectedChar) {
        return false;
    }

    if (character.toLowerCase() !== expectedChar.toLowerCase()) {
        return false;
    }

    spawnLetter(expectedChar, getDropXForKey(expectedChar));
    currentCharIndex++;

    if (currentCharIndex >= activeWord.length) {
        currentWordIndex++;
        currentCharIndex = 0;
    }

    return true;
}

function rebuildHeightmap() {
    heightmap.fill(groundY);

    for (const letterBody of letterBodies) {
        const body = letterBody.body;
        if (!body.isSleeping) {
            continue;
        }

        const parts = body.parts;
        for (let p = parts.length > 1 ? 1 : 0; p < parts.length; p++) {
            const verts = parts[p].vertices;
            for (let i = 0; i < verts.length; i++) {
                const a = verts[i];
                const next = verts[(i + 1) % verts.length];

                const x0 = Math.min(a.x, next.x);
                const x1 = Math.max(a.x, next.x);
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
                    if (y < heightmap[col]) {
                        heightmap[col] = y;
                    }
                }
            }
        }
    }
}

class ClimbingAgent {
    constructor() {
        this.x = CW / 2;
        this.y = groundY;
        this.vx = 0;
        this.vy = 0;
        this.targetX = CW / 2;
        this.targetY = groundY;
        this.facing = 1;
        this.bodyH = 22;
        this.headR = 6;
        this.limbLen = 14;
        this.walkPhase = 0;
        this.armPhase = 0;
        this.isClimbing = false;
        this.lFx = 0;
        this.lFy = 0;
        this.rFx = 0;
        this.rFy = 0;
        this.lHx = 0;
        this.lHy = 0;
        this.rHx = 0;
        this.rHy = 0;
    }

    findHighest() {
        let bestY = groundY;
        let bestX = CW / 2;
        for (let x = 10; x < CW - 10; x += 3) {
            if (heightmap[x] < bestY) {
                bestY = heightmap[x];
                bestX = x;
            }
        }
        this.targetX = bestX;
        this.targetY = bestY - this.bodyH - this.headR;
    }

    surfaceY(atX) {
        const ix = Math.max(0, Math.min(CW - 1, Math.round(atX)));
        let best = heightmap[ix];
        for (let d = -4; d <= 4; d++) {
            const xi = Math.max(0, Math.min(CW - 1, ix + d));
            if (heightmap[xi] < best) {
                best = heightmap[xi];
            }
        }
        return best;
    }

    update() {
        this.findHighest();

        const dx = this.targetX - this.x;
        if (Math.abs(dx) > 3) {
            this.vx += Math.sign(dx) * 0.12 * params.agentSpeed;
            this.facing = Math.sign(dx);
        }
        this.vx *= 0.85;
        this.x += this.vx;

        const sy = this.surfaceY(this.x);
        const target = sy - this.bodyH;

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

        if (this.y > groundY - this.bodyH) {
            this.y = groundY - this.bodyH;
            this.vy = 0;
        }
        this.x = Math.max(20, Math.min(CW - 20, this.x));

        const speed = Math.abs(this.vx);
        if (speed > 0.3) {
            this.walkPhase += speed * 0.15;
            this.armPhase += speed * 0.15;
            this.isClimbing = this.targetY < this.y - 10;
        } else {
            this.walkPhase += 0.02;
            this.armPhase += 0.015;
            this.isClimbing = false;
        }
        this.calcLimbs();
    }

    calcLimbs() {
        const hipY = this.y + this.bodyH;
        const shY = this.y + 4;
        const facing = this.facing;
        const speed = Math.abs(this.vx);
        const wc = Math.sin(this.walkPhase);
        const ac = Math.sin(this.armPhase + Math.PI);
        const stride = Math.min(speed > 0.3 ? speed * 4 : 2, this.limbLen * 0.7);

        this.lFx = this.x + wc * stride * facing;
        this.lFy = Math.min(hipY + this.limbLen * 0.5, this.surfaceY(this.lFx));
        this.rFx = this.x - wc * stride * facing;
        this.rFy = Math.min(hipY + this.limbLen * 0.5, this.surfaceY(this.rFx));

        if (this.isClimbing && speed > 0.3) {
            this.lHx = this.x + ac * 8 * facing;
            this.lHy = shY - this.limbLen * 0.8;
            this.rHx = this.x - ac * 8 * facing;
            this.rHy = shY - this.limbLen * 0.6;
        } else {
            this.lHx = this.x + ac * stride * 0.5 * facing;
            this.lHy = shY + this.limbLen * 0.7 + Math.sin(this.armPhase) * 2;
            this.rHx = this.x - ac * stride * 0.5 * facing;
            this.rHy = shY + this.limbLen * 0.7 - Math.sin(this.armPhase) * 2;
        }
    }

    display() {
        push();
        stroke(0, 220, 80);
        strokeWeight(2.5);
        noFill();
        const hipY = this.y + this.bodyH;
        const shY = this.y + 4;
        const headY = this.y - this.headR + 2;

        this.drawLimb(this.x - 3, hipY, this.lFx, this.lFy, -1);
        this.drawLimb(this.x + 3, hipY, this.rFx, this.rFy, 1);
        line(this.x, hipY, this.x, shY);
        this.drawLimb(this.x - 2, shY, this.lHx, this.lHy, -1);
        this.drawLimb(this.x + 2, shY, this.rHx, this.rHy, 1);

        fill(0, 220, 80);
        noStroke();
        ellipse(this.x, headY, this.headR * 2, this.headR * 2);
        fill(0);
        const eyeOffset = this.facing * 2;
        ellipse(this.x + eyeOffset - 1.5, headY - 1, 2, 2);
        ellipse(this.x + eyeOffset + 1.5, headY - 1, 2, 2);
        pop();
    }

    drawLimb(sx, sy, ex, ey, side) {
        const ddx = ex - sx;
        const ddy = ey - sy;
        const len = Math.hypot(ddx, ddy);
        const nx = len > 0 ? -ddy / len : 0;
        const ny = len > 0 ? ddx / len : 1;
        const mx = (sx + ex) / 2 + nx * 6 * side;
        const my = (sy + ey) / 2 + ny * 6 * side;
        line(sx, sy, mx, my);
        line(mx, my, ex, ey);
    }
}

function setup() {
    const canvas = createCanvas(CW, CH);
    canvas.parent('canvas-root');
    groundY = CH;
    heightmap = new Float32Array(CW);
    heightmap.fill(groundY);

    randomSeed(params.seed);
    noiseSeed(params.seed);

    initPhysics();
    agent = new ClimbingAgent();
}

function drawTypingHint() {
    push();
    textAlign(LEFT, CENTER);
    textFont('Inter, sans-serif');
    textSize(32);
    textStyle(BOLD);

    const wordsToDraw = marketingWords.slice(currentWordIndex);
    if (wordsToDraw.length === 0) {
        fill(255);
        noStroke();
        textAlign(CENTER, CENTER);
        text('All words dropped', CW / 2, 54);
        pop();
        return;
    }

    let totalWidth = 0;
    for (let i = 0; i < wordsToDraw.length; i++) {
        totalWidth += textWidth(wordsToDraw[i]);
        if (i < wordsToDraw.length - 1) {
            totalWidth += textWidth('   ');
        }
    }

    let cursorX = (CW - totalWidth) / 2;
    const baselineY = 54;

    for (let i = 0; i < wordsToDraw.length; i++) {
        const word = wordsToDraw[i];
        const isCurrentWord = i === 0;

        if (isCurrentWord) {
            const typedPart = word.slice(0, currentCharIndex);
            const remainingPart = word.slice(currentCharIndex);

            if (typedPart) {
                fill(255);
                noStroke();
                text(typedPart, cursorX, baselineY);
                cursorX += textWidth(typedPart);
            }

            if (remainingPart) {
                fill(115);
                noStroke();
                text(remainingPart, cursorX, baselineY);
                cursorX += textWidth(remainingPart);
            }
        } else {
            fill(115);
            noStroke();
            text(word, cursorX, baselineY);
            cursorX += textWidth(word);
        }

        if (i < wordsToDraw.length - 1) {
            fill(80);
            text('   ', cursorX, baselineY);
            cursorX += textWidth('   ');
        }
    }

    pop();
}

function draw() {
    Engine.update(engine, 1000 / 60);

    if (frameCount % 5 === 0) {
        rebuildHeightmap();
    }

    background(0);
    drawTypingHint();

    for (const letterBody of letterBodies) {
        const body = letterBody.body;
        push();
        translate(body.position.x, body.position.y);
        rotate(body.angle);
        if (letterBody.charImg) {
            drawingContext.drawImage(letterBody.charImg, -letterBody.imgOffX, -letterBody.imgOffY);
        } else {
            fill(255);
            noStroke();
            textAlign(CENTER, CENTER);
            textSize(params.letterSize);
            textFont('Inter, sans-serif');
            text(letterBody.char, 0, -2);
        }
        pop();
    }

    agent.update();
    agent.display();

    if (letterBodies.length === 0 && !isScriptComplete()) {
        push();
        fill(60);
        noStroke();
        textAlign(CENTER, CENTER);
        textSize(16);
        textFont('Inter, sans-serif');
        text('type the highlighted phrase', CW / 2, CH / 2);
        pop();
    }
}

function keyTyped() {
    const activeTag = document.activeElement && document.activeElement.tagName;
    if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') {
        return;
    }

    const character = key;
    if (character.length === 1 && advanceTyping(character)) {
        return false;
    }
}

function keyPressed() {
    const activeTag = document.activeElement && document.activeElement.tagName;
    if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') {
        return;
    }
}
