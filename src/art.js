/* Scribbled art drawn in code: wobbly, flat, thick-outlined, on purpose. Every function returns a canvas.
   The same seed always draws the same picture; different "boil" seeds give the shaky redraw of bad hand animation. */
const Art = (() => {
  'use strict';
  const INK = '#15121f';
  const BLUE = '#2f6bff', BLUE_DARK = '#1c45c2', SCARF = '#b8f02a', LEAF = '#3fc94a';

  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeCanvas(w, h, scale = 1) {
    const c = document.createElement('canvas');
    c.width = Math.round(w * scale); c.height = Math.round(h * scale);
    const ctx = c.getContext('2d');
    ctx.scale(scale, scale);
    return { c, ctx };
  }
  function blobPath(ctx, R, cx, cy, rx, ry, wob, n = 14) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, k = 1 + (R() - 0.5) * wob;
      pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
    }
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const p = pts[i % n], q = pts[(i + 1) % n], mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
      if (i === 0) ctx.moveTo(mx, my); else ctx.quadraticCurveTo(p[0], p[1], mx, my);
    }
    ctx.closePath();
  }
  function ink(ctx, w) { ctx.lineWidth = w; ctx.strokeStyle = INK; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke(); }
  function blob(ctx, R, cx, cy, rx, ry, fill, wob = 0.18, w = 5) {
    blobPath(ctx, R, cx, cy, rx, ry, wob);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (w) ink(ctx, w);
  }
  // shaky polyline: every segment split into three jittered pieces
  function shaky(ctx, R, pts, w, color = INK, jit = 2.5) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0] + (R() - 0.5) * jit, pts[0][1] + (R() - 0.5) * jit);
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      for (let s = 1; s <= 3; s++) {
        const t = s / 3;
        ctx.lineTo(x0 + (x1 - x0) * t + (R() - 0.5) * jit, y0 + (y1 - y0) * t + (R() - 0.5) * jit);
      }
    }
    ctx.lineWidth = w; ctx.strokeStyle = color; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
  }
  // an outlined band: ink underneath, colour on top, drawn with separate wobble so they never quite line up
  function band(ctx, R, pts, w, color) { shaky(ctx, R, pts, w + 7, INK, 2); shaky(ctx, R, pts, w, color, 1.5); }
  function hatch(ctx, R, cx, cy, rx, ry, color, n, w = 3) {
    ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const a = R() * Math.PI * 2, r = Math.sqrt(R()) * 0.8;
      const x = cx + Math.cos(a) * rx * r, y = cy + Math.sin(a) * ry * r, l = 5 + R() * 9, d = -0.7 + (R() - 0.5) * 0.5;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(d) * l, y + Math.sin(d) * l); ctx.stroke();
    }
  }
  function flipped(ctx, w, flip) { if (flip) { ctx.translate(w, 0); ctx.scale(-1, 1); } }

  // ---- the hero: an original blue blob with googly eyes, a leaf sprout, and a lime scarf. Drawn facing right. ----
  // view: 'front' | 'back'; pose: 'idle' | 'run' | 'air' | 'spring' | 'ball' | 'charge'; phase: animation frame
  function hero(view, pose, phase, boil, flip) {
    const S = 192, { c, ctx } = makeCanvas(S, S, 128 / S);
    const R = rng(9000 + ['idle', 'run', 'air', 'spring', 'ball', 'charge'].indexOf(pose) * 100 + phase * 10 + boil + (view === 'back' ? 50 : 0));
    flipped(ctx, S, flip);
    const g = 184;
    if (pose === 'ball' || pose === 'charge') { drawBall(ctx, R, g, pose, phase); return c; }
    const bob = pose === 'run' ? (phase % 2 ? -5 : 2) : pose === 'idle' ? (phase ? -2 : 0) : -6;
    const cx = 100, cy = 100 + bob;
    const front = view === 'front';

    // scarf tail streams behind (to the left)
    const fl = [0, 9, -5, 6][phase % 4];
    const tail = pose === 'spring' ? [[cx - 30, cy + 26], [cx - 44, cy + 48], [cx - 38, cy + 72]]
      : pose === 'idle' ? [[cx - 30, cy + 26], [cx - 46, cy + 40], [cx - 52, cy + 58]]
      : [[cx - 30, cy + 24], [cx - 58, cy + 16 + fl], [cx - 86, cy + 26 - fl]];
    band(ctx, R, tail, 12, SCARF);

    // legs and feet
    let A, B;
    if (pose === 'run') { A = [cx + [26, 8, -22, 8][phase], g - [0, 12, 0, 4][phase]]; B = [cx + [-22, 8, 26, 8][phase], g - [0, 4, 0, 12][phase]]; }
    else if (pose === 'air') { A = [cx + 22, g - 16]; B = [cx - 18, g - 6]; }
    else if (pose === 'spring') { A = [cx + 8, g - 2]; B = [cx - 10, g - 2]; }
    else { A = [cx + 16, g]; B = [cx - 14, g]; }
    for (const [f, hx] of [[B, cx - 12], [A, cx + 10]]) {
      shaky(ctx, R, [[hx, cy + 40], [f[0], f[1] - 6]], 7);
      blob(ctx, R, f[0] + 6, f[1] - 5, 15, 8, BLUE_DARK, 0.25, 4);
    }

    // arms: back arm first, front arm after the body
    let hf, hb;
    if (pose === 'run') { hf = [[cx + 46, cy - 6], [cx + 34, cy + 34], [cx + 44, cy + 8], [cx + 30, cy + 30]][phase]; hb = [[cx - 40, cy + 30], [cx - 46, cy - 4], [cx - 36, cy + 26], [cx - 44, cy]][phase]; }
    else if (pose === 'air') { hf = [cx + 38, cy - 48]; hb = [cx - 32, cy - 50]; }
    else if (pose === 'spring') { hf = [cx + 14, cy - 76]; hb = [cx - 14, cy - 76]; }
    else { hf = [cx + 36, cy + 36]; hb = [cx - 38, cy + 34]; }
    shaky(ctx, R, [[cx - 26, cy + 8], hb], 6); blob(ctx, R, hb[0], hb[1], 8, 8, BLUE, 0.3, 4);

    // body
    blob(ctx, R, cx, cy, 46, 50, BLUE, 0.16, 6);
    hatch(ctx, R, cx - 14, cy + 18, 22, 20, BLUE_DARK, 12, 3);
    // leaf sprout on top
    shaky(ctx, R, [[cx + 2, cy - 46], [cx + 8, cy - 64]], 4);
    blob(ctx, R, cx + 20, cy - 68, 13, 6, LEAF, 0.3, 4);
    // scarf round the middle
    band(ctx, R, [[cx - 42, cy + 20], [cx - 10, cy + 30], [cx + 28, cy + 28], [cx + 44, cy + 18]], 11, SCARF);

    if (front) {
      // googly eyes, never quite matching
      blob(ctx, R, cx + 16, cy - 16, 17, 19, '#ffffff', 0.12, 4);
      blob(ctx, R, cx + 40, cy - 10, 11, 12, '#ffffff', 0.15, 4);
      blob(ctx, R, cx + 16 + (R() - 0.3) * 12, cy - 14 + (R() - 0.5) * 10, 5, 5, INK, 0.2, 0);
      blob(ctx, R, cx + 42 + (R() - 0.5) * 6, cy - 9 + (R() - 0.5) * 6, 4, 4, INK, 0.2, 0);
      shaky(ctx, R, [[cx + 6, cy + 6], [cx + 24, cy + 13], [cx + 42, cy + 5]], 4);
      ctx.beginPath(); ctx.rect(cx + 18, cy + 9, 7, 8); ctx.fillStyle = '#ffffff'; ctx.fill(); ink(ctx, 3);
    } else {
      // back of the scarf knot
      blob(ctx, R, cx - 4, cy + 26, 9, 7, SCARF, 0.3, 4);
    }
    shaky(ctx, R, [[cx + 26, cy + 8], hf], 6); blob(ctx, R, hf[0], hf[1], 8, 8, BLUE, 0.3, 4);

    if (pose === 'run') for (let k = 0; k < 3; k++) {
      const y = cy - 20 + k * 22 + (R() - 0.5) * 6;
      shaky(ctx, R, [[cx - 66 - k * 4, y], [cx - 92, y + 2]], 3, 'rgba(21,18,31,0.55)', 2);
    }
    return c;
  }
  function drawBall(ctx, R, g, pose, phase) {
    const cx = 100, cy = g - 58;
    if (pose === 'charge') for (let k = 0; k < 3; k++) blob(ctx, R, cx - 56 - k * 18, g - 10 - (phase + k) % 2 * 6, 14 - k * 3, 9 - k * 2, '#e9e4d8', 0.4, 3);
    band(ctx, R, [[cx - 40, cy + 30], [cx - 66, cy + 40 + (phase % 2) * 8], [cx - 90, cy + 30]], 11, SCARF);
    blob(ctx, R, cx, cy, 54, 54, BLUE, 0.1, 6);
    // spiral, turned a quarter each frame
    const pts = [], rot = phase * Math.PI / 2;
    for (let t = 0; t <= Math.PI * 3.2; t += 0.35) { const r = 6 + t * 4.6; pts.push([cx + Math.cos(t + rot) * r, cy + Math.sin(t + rot) * r]); }
    shaky(ctx, R, pts, 5, BLUE_DARK, 2);
    blob(ctx, R, cx + Math.cos(rot) * 34, cy + Math.sin(rot) * 34, 10, 5, LEAF, 0.3, 3);
    for (let k = 0; k < 3; k++) { const y = cy - 30 + k * 30; shaky(ctx, R, [[cx - 64, y], [cx - 94, y]], 3, 'rgba(21,18,31,0.55)', 2); }
  }

  function ring(boil) {
    const { c, ctx } = makeCanvas(64, 64);
    const R = rng(300 + boil);
    blob(ctx, R, 32, 32, 26, 27, '#ffd21f', 0.1, 0);
    ctx.globalCompositeOperation = 'destination-out';
    blob(ctx, R, 32, 32, 13, 14, '#000', 0.15, 0);
    ctx.globalCompositeOperation = 'source-over';
    blob(ctx, R, 32, 32, 26, 27, null, 0.1, 4);
    blob(ctx, R, 32, 32, 13, 14, null, 0.15, 3);
    shaky(ctx, R, [[18, 24], [22, 17]], 3, '#fff8c8', 1);
    return c;
  }
  function palm(variant) {
    const { c, ctx } = makeCanvas(160, 256);
    const R = rng(500 + variant);
    const lean = variant % 2 ? -18 : 20, top = [80 + lean, 78];
    const trunk = [[80, 252], [80 + lean * 0.3, 190], [80 + lean * 0.75, 130], top];
    shaky(ctx, R, trunk, 26, INK, 2); shaky(ctx, R, trunk, 18, '#b9783c', 1.5);
    for (let k = 1; k < 7; k++) { const t = k / 7, x = 80 + lean * t * t, y = 252 - t * 174; shaky(ctx, R, [[x - 8, y], [x + 8, y - 4]], 3); }
    for (let k = 0; k < 6; k++) {
      const a = Math.PI + (k / 5) * Math.PI + (R() - 0.5) * 0.3, len = 62 + R() * 14;
      const mid = [top[0] + Math.cos(a) * len * 0.55, top[1] + Math.sin(a) * 30 - 16];
      const end = [top[0] + Math.cos(a) * len, top[1] + Math.sin(a) * 26 + 22];
      band(ctx, R, [top, mid, end], 14, LEAF);
    }
    for (let k = 0; k < 3; k++) blob(ctx, R, top[0] - 10 + k * 10, top[1] + 10 + (k % 2) * 4, 8, 8, '#7a4a22', 0.3, 3);
    return c;
  }
  function bush(variant) {
    const { c, ctx } = makeCanvas(128, 96);
    const R = rng(700 + variant);
    blob(ctx, R, 40, 62, 32, 28, '#36b84a', 0.2, 5);
    blob(ctx, R, 88, 60, 32, 30, '#36b84a', 0.2, 5);
    blob(ctx, R, 64, 44, 34, 30, '#45cc55', 0.2, 5);
    hatch(ctx, R, 64, 58, 50, 26, 'rgba(21,18,31,0.25)', 14, 3);
    if (variant % 2) for (let k = 0; k < 5; k++) blob(ctx, R, 30 + R() * 70, 34 + R() * 40, 4, 4, '#ff4d6d', 0.2, 2);
    return c;
  }
  function flower(variant) {
    const { c, ctx } = makeCanvas(48, 64);
    const R = rng(800 + variant);
    shaky(ctx, R, [[24, 63], [23, 44], [25, 26]], 4, '#2f9e3c', 1.5);
    const col = ['#ff6fb5', '#ffffff', '#ffd21f', '#b77bff'][variant % 4];
    for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; blob(ctx, R, 24 + Math.cos(a) * 9, 20 + Math.sin(a) * 9, 7, 7, col, 0.3, 2.5); }
    blob(ctx, R, 24, 20, 5, 5, '#ff9a1f', 0.3, 2.5);
    return c;
  }
  function spring(sprung) {
    const { c, ctx } = makeCanvas(96, 96);
    const R = rng(900 + (sprung ? 1 : 0));
    const topY = sprung ? 18 : 46;
    blob(ctx, R, 48, 84, 36, 10, '#8a4fd6', 0.12, 4);
    const pts = []; const n = 5;
    for (let k = 0; k <= n; k++) pts.push([48 + (k % 2 ? 18 : -18), 80 - (80 - topY - 8) * (k / n)]);
    shaky(ctx, R, pts, 9, INK, 1.5); shaky(ctx, R, pts, 4, '#f2f2f2', 1);
    blob(ctx, R, 48, topY, 32, 9, '#ff8a2a', 0.12, 4);
    return c;
  }
  function sky() {
    const { c, ctx } = makeCanvas(512, 512);
    const R = rng(42);
    const gr = ctx.createLinearGradient(0, 0, 0, 512);
    gr.addColorStop(0, '#55c2ff'); gr.addColorStop(1, '#c4f1ff');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, 512, 512);
    blob(ctx, R, 420, 90, 38, 38, '#ffe14d', 0.12, 5);
    for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2; shaky(ctx, R, [[420 + Math.cos(a) * 50, 90 + Math.sin(a) * 50], [420 + Math.cos(a) * 72, 90 + Math.sin(a) * 72]], 5); }
    for (const [x, y, s] of [[90, 120, 1], [250, 70, 0.8], [180, 230, 1.2], [400, 260, 0.9], [60, 330, 0.8]]) {
      blob(ctx, R, x, y, 44 * s, 20 * s, '#ffffff', 0.2, 4);
      blob(ctx, R, x - 22 * s, y - 12 * s, 24 * s, 18 * s, '#ffffff', 0.25, 4);
      blob(ctx, R, x + 18 * s, y - 14 * s, 26 * s, 20 * s, '#ffffff', 0.25, 4);
      blob(ctx, R, x, y + 2 * s, 40 * s, 14 * s, '#ffffff', 0.15, 0);
    }
    return c;
  }
  // multiplied over the level's vertex colours: white with scribbled hatching and a wobbly outline per tile
  function tile() {
    const { c, ctx } = makeCanvas(128, 128);
    const R = rng(77);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 128, 128);
    hatch(ctx, R, 64, 64, 70, 70, 'rgba(21,18,31,0.10)', 46, 3);
    for (const pts of [[[4, 4], [124, 5]], [[124, 5], [123, 124]], [[123, 124], [5, 123]], [[5, 123], [4, 4]]]) shaky(ctx, R, pts, 5, 'rgba(21,18,31,0.55)', 3);
    return c;
  }
  function water() {
    const { c, ctx } = makeCanvas(128, 128);
    const R = rng(88);
    ctx.fillStyle = '#3aa8ff'; ctx.fillRect(0, 0, 128, 128);
    for (let k = 0; k < 6; k++) { const y = 12 + k * 21; shaky(ctx, R, [[8, y], [36, y - 6], [64, y], [92, y - 6], [120, y]], 3, 'rgba(255,255,255,0.75)', 2); }
    return c;
  }
  // an original enemy: a dented tin-can robot on two wheels, one angry eye, a siren on top
  function enemy(phase, boil, flip) {
    const S = 128, { c, ctx } = makeCanvas(S, S);
    const R = rng(1200 + phase * 10 + boil);
    flipped(ctx, S, flip);
    const cx = 64, bob = phase ? -2 : 0;
    for (const wx of [38, 90]) { blob(ctx, R, wx, 112, 13, 13, '#3a3550', 0.15, 4); shaky(ctx, R, [[wx - 6, 112 + (phase ? 4 : -4)], [wx + 6, 112 - (phase ? 4 : -4)]], 3, '#9a96b0', 1); }
    blob(ctx, R, cx, 74 + bob, 40, 34, '#8f8aa8', 0.14, 5);
    hatch(ctx, R, cx - 14, 86 + bob, 18, 14, 'rgba(21,18,31,0.25)', 8, 3);
    shaky(ctx, R, [[cx - 38, 70 + bob], [cx + 38, 72 + bob]], 3, 'rgba(21,18,31,0.6)', 2);
    blob(ctx, R, cx + 12, 62 + bob, 15, 15, '#ffffff', 0.12, 4);
    blob(ctx, R, cx + 16 + (R() - 0.5) * 4, 62 + bob, 6, 6, '#e0302a', 0.2, 0);
    shaky(ctx, R, [[cx - 2, 44 + bob], [cx + 26, 50 + bob]], 5);
    blob(ctx, R, cx - 6, 38 + bob, 9, 7, phase ? '#ff4d3a' : '#ffb03a', 0.2, 4);
    shaky(ctx, R, [[cx - 40, 80 + bob], [cx - 56, 92 + bob]], 5); shaky(ctx, R, [[cx + 40, 82 + bob], [cx + 54, 96 + bob]], 5);
    return c;
  }
  function monitor(broken) {
    const { c, ctx } = makeCanvas(96, 96);
    const R = rng(1300 + (broken ? 1 : 0));
    if (broken) {
      for (let k = 0; k < 5; k++) blob(ctx, R, 22 + k * 13, 82 + (k % 2) * 4, 9, 6, '#9a98a8', 0.4, 3);
      return c;
    }
    blob(ctx, R, 48, 52, 36, 36, '#a9a7b6', 0.08, 5);
    ctx.beginPath(); ctx.rect(24, 30, 48, 38); ctx.fillStyle = '#2e6bd8'; ctx.fill(); ink(ctx, 4);
    blob(ctx, R, 48, 49, 12, 13, null, 0.12, 0); ctx.lineWidth = 6; ctx.strokeStyle = '#ffd21f'; ctx.stroke();
    shaky(ctx, R, [[30, 36], [38, 33]], 3, 'rgba(255,255,255,0.8)', 1);
    shaky(ctx, R, [[20, 88], [76, 88]], 5);
    return c;
  }
  function goal(boil) {
    const { c, ctx } = makeCanvas(96, 192);
    const R = rng(1400 + boil);
    shaky(ctx, R, [[22, 188], [22, 20]], 7);
    const wave = boil % 2 ? 4 : -4;
    ctx.save(); ctx.beginPath(); ctx.moveTo(24, 22); ctx.quadraticCurveTo(54, 14 + wave, 88, 24); ctx.lineTo(88, 70); ctx.quadraticCurveTo(54, 62 - wave, 24, 70); ctx.closePath();
    ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.clip();
    ctx.fillStyle = INK;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) if ((i + j) % 2) ctx.fillRect(24 + i * 16, 18 + j * 17 + (R() - 0.5) * 2, 16, 17);
    ctx.restore();
    ctx.beginPath(); ctx.moveTo(24, 22); ctx.quadraticCurveTo(54, 14 + wave, 88, 24); ctx.lineTo(88, 70); ctx.quadraticCurveTo(54, 62 - wave, 24, 70); ctx.closePath(); ink(ctx, 4);
    blob(ctx, R, 22, 16, 7, 7, '#ffd21f', 0.2, 3);
    return c;
  }
  // a freed bird: round body, pale belly, stubby beak; wings up or down by phase (kind picks the colour)
  function flicky(kind, phase, flip) {
    const { c, ctx } = makeCanvas(96, 96, 1);
    const R = rng(900 + kind * 31 + phase * 7);
    if (flip) { ctx.translate(96, 0); ctx.scale(-1, 1); }
    const body = ['#3d8bff', '#ff6fae', '#4fd16a', '#ff5a4a'][kind % 4];
    blob(ctx, R, 48, 58, 25, 22, body);
    blob(ctx, R, 54, 64, 13, 11, '#fff6dc', 0.2, 3);
    ctx.beginPath(); ctx.moveTo(70, 50); ctx.lineTo(86, 56); ctx.lineTo(70, 61); ctx.closePath();
    ctx.fillStyle = '#ffb02e'; ctx.fill(); ink(ctx, 3.5);
    blob(ctx, R, 60, 47, 5, 6, '#fff', 0.1, 2.5);
    ctx.beginPath(); ctx.arc(62, 48, 2.4, 0, Math.PI * 2); ctx.fillStyle = INK; ctx.fill();
    const wy = phase ? 30 : 64;
    shaky(ctx, R, [[36, 56], [18, wy], [32, wy + (phase ? 8 : -4)]], 5);
    shaky(ctx, R, [[44, 79], [42, 88]], 3.5); shaky(ctx, R, [[54, 79], [56, 88]], 3.5);
    return c;
  }
  // the two friends who take rings for the bonus run: round pals of our own (a mint one with a bow, a lilac one in a
  // cap), waving; `kind` 0 or 1, `phase` 0..3 the wave, `boil` the redraw
  function pal(kind, phase, boil) {
    const { c, ctx } = makeCanvas(128, 128), R = rng(7700 + kind * 97 + boil * 13);
    const body = kind ? '#c7a6ff' : '#5fe0b4', dark = kind ? '#8f6ad8' : '#2fa883', cx = 64, cy = 74;
    blob(ctx, R, cx - 14, 116, 12, 7, dark, 0.3, 4); blob(ctx, R, cx + 14, 116, 12, 7, dark, 0.3, 4);
    const hand = [[cx + 44, cy - 34], [cx + 50, cy - 18], [cx + 44, cy - 40], [cx + 48, cy - 26]][phase & 3];
    shaky(ctx, R, [[cx - 30, cy + 4], [cx - 44, cy + 22]], 6); blob(ctx, R, cx - 46, cy + 24, 8, 8, body, 0.3, 4);
    blob(ctx, R, cx, cy, 38, 40, body, 0.16, 6);
    hatch(ctx, R, cx - 12, cy + 16, 18, 16, dark, 10, 3);
    blob(ctx, R, cx - 12, cy - 10, 12, 14, '#ffffff', 0.14, 4); blob(ctx, R, cx + 12, cy - 12, 10, 12, '#ffffff', 0.14, 4);
    blob(ctx, R, cx - 10 + (R() - 0.5) * 6, cy - 8, 4, 5, INK, 0.2, 0); blob(ctx, R, cx + 13 + (R() - 0.5) * 5, cy - 10, 4, 4, INK, 0.2, 0);
    shaky(ctx, R, [[cx - 12, cy + 12], [cx, cy + 18], [cx + 12, cy + 11]], 4);
    if (kind) { blob(ctx, R, cx, cy - 40, 26, 10, '#ffd34a', 0.2, 5); blob(ctx, R, cx + 22, cy - 34, 14, 5, '#ffd34a', 0.3, 4); }
    else { blob(ctx, R, cx - 12, cy - 42, 12, 8, '#ff6fa8', 0.3, 4); blob(ctx, R, cx + 12, cy - 42, 12, 8, '#ff6fa8', 0.3, 4); blob(ctx, R, cx, cy - 42, 5, 5, '#ff6fa8', 0.3, 4); }
    shaky(ctx, R, [[cx + 30, cy - 4], hand], 6); blob(ctx, R, hand[0], hand[1], 8, 8, body, 0.3, 4);
    return c;
  }
  return { hero, ring, palm, bush, flower, spring, sky, tile, water, enemy, monitor, goal, flicky, pal };
})();
