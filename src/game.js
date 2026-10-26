(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const canvas = $('view');
  const isTouch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  const LEVEL_KEY = 'blastgrid.level', CAM_KEY = 'blastgrid.cam', LOOK_KEY = 'blastgrid.look', MUTE_KEY = 'blastgrid.mute';
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
  };

  function showError(list, hint) {
    const ul = $('errList'); ul.textContent = '';
    for (const msg of list) { const li = document.createElement('li'); li.textContent = msg; ul.appendChild(li); }
    if (hint) $('errHint').textContent = hint;
    $('helpOverlay').hidden = true; $('errorOverlay').hidden = false;
  }
  const readError = e => e.list || [(e instanceof SyntaxError ? 'The level data is not valid JSON: ' : 'The level data could not be read: ') + e.message];

  // ---- level: the built-in one, or one this viewer loaded earlier ----
  const builtInRaw = $('level').textContent;
  let L, customLoaded = false;
  try { L = Sim.importLevel(JSON.parse(builtInRaw)); }
  catch (e) { showError(readError(e)); return; }
  const saved = store.get(LEVEL_KEY);
  if (saved) {
    try { L = Sim.importLevel(JSON.parse(saved)); customLoaded = true; }
    catch (e) { store.del(LEVEL_KEY); }
  }
  if (typeof THREE === 'undefined') { showError(['The 3D library did not load.'], 'Check your connection, then reload the page.'); return; }

  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); }
  catch (e) { showError(['This browser could not start WebGL, which the game needs to draw.'], 'Try another browser, or turn on hardware acceleration.'); return; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));

  let world = Sim.createWorld(L);
  const scene = new THREE.Scene();
  const tex = cnv => { const t = new THREE.CanvasTexture(cnv); t.anisotropy = 4; return t; };
  scene.background = tex(Art.sky());
  const sceneFog = new THREE.Fog(0xc4f1ff, 30, 70);
  // ---- sky for levels drawn with the original art: a banded dome in the zone's colours (my palette, not the ROM's;
  // the original has no sky), fading into an abyss below the horizon that the cliffs sink into ----
  const ZONE_SKY = {   // top, horizon, abyss
    'Green Grove': [0x2a6fdb, 0xa6dcff, 0x0d3a7a], 'Rusty Ruin': [0x3a2a6b, 0xf0a060, 0x3a1e14],
    'Spring Stadium': [0x141f70, 0x6aa8ff, 0x0c1240], 'Diamond Dust': [0x5a80d0, 0xeef6ff, 0x8aa2d0],
    'Volcano Valley': [0x2a0a12, 0xd0502a, 0x401008], 'Gene Gadget': [0x0a1a2a, 0x3a8a8a, 0x061018],
    'Panic Puppet': [0x1a0a2a, 0x7a3a9a, 0x0a0410], 'Final Fight': [0x0a0414, 0x4a2060, 0x050208],
  };
  const cartoonSky = scene.background;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(150, 32, 24), new THREE.MeshBasicMaterial({ side: THREE.BackSide, fog: false, depthWrite: false }));
  dome.renderOrder = -1; dome.visible = false; scene.add(dome);
  function skyTexture([top, hor, abyss]) {
    const H = 256, c = document.createElement('canvas'); c.width = 1; c.height = H;
    const g = c.getContext('2d'), A = new THREE.Color(), B = new THREE.Color(), out = new THREE.Color();
    for (let y = 0; y < H; y++) {
      const e = Math.PI / 2 - (y + 0.5) / H * Math.PI;           // elevation of this row
      let k;
      if (e >= 0) { k = Math.floor(Math.pow(e / (Math.PI / 2), 0.6) * 24) / 24; A.setHex(hor); B.setHex(top); }
      else { k = Math.floor(Math.min(1, -e / 0.35) * 8) / 8; A.setHex(hor); B.setHex(abyss); }
      out.copy(A).lerp(B, k); g.fillStyle = '#' + out.getHexString(); g.fillRect(0, y, 1, 1);
    }
    const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
    return t;
  }
  function applySky(art) {
    const name = art ? ((S3D.LEVELS.find(l => l[0] === L.rom.level) || [0, ''])[1]) : '';
    const zone = Object.keys(ZONE_SKY).find(z => name.startsWith(z));
    if (!zone) { dome.visible = false; scene.background = cartoonSky; sceneFog.color.setHex(0xc4f1ff); return; }
    if (dome.userData.zone !== zone) {
      if (dome.material.map) dome.material.map.dispose();
      dome.material.map = skyTexture(ZONE_SKY[zone]); dome.material.needsUpdate = true; dome.userData.zone = zone;
    }
    dome.visible = true; scene.background = null; sceneFog.color.setHex(ZONE_SKY[zone][1]);
  }

  // ---- lights: flat and bright, like a cheap cartoon ----
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a9a, 0.86));
  const sun = new THREE.DirectionalLight(0xfff4e0, 0.42);
  sun.position.set(-6, 14, 4);
  scene.add(sun);

  // ---- shared textures and sprite materials ----
  const tileTex = tex(Art.tile()); tileTex.wrapS = tileTex.wrapT = THREE.RepeatWrapping;
  const waterTex = tex(Art.water()); waterTex.wrapS = waterTex.wrapT = THREE.RepeatWrapping;
  const spriteMat = cnv => new THREE.SpriteMaterial({ map: tex(cnv), alphaTest: 0.5 });
  const ringMats = [0, 1, 2].map(b => spriteMat(Art.ring(b)));
  const springMats = [spriteMat(Art.spring(false)), spriteMat(Art.spring(true))];
  const decorMats = {
    palm: [0, 1].map(v => spriteMat(Art.palm(v))),
    bush: [0, 1].map(v => spriteMat(Art.bush(v))),
    flower: [0, 1, 2, 3].map(v => spriteMat(Art.flower(v))),
  };
  const monitorMats = [spriteMat(Art.monitor(false)), spriteMat(Art.monitor(true))];
  const goalMats = [0, 1].map(b => spriteMat(Art.goal(b)));
  const flickyMats = new Map();
  const flickyMat = (kind, phase, flip) => {
    const k = kind * 4 + phase * 2 + (flip ? 1 : 0);
    if (!flickyMats.has(k)) flickyMats.set(k, spriteMat(Art.flicky(kind, phase, flip)));
    return flickyMats.get(k);
  };
  const enemyMats = new Map();
  const enemyMat = (phase, boil, flip) => {
    const k = phase * 10 + boil + (flip ? 100 : 0);
    if (!enemyMats.has(k)) enemyMats.set(k, spriteMat(Art.enemy(phase, boil, flip)));
    return enemyMats.get(k);
  };
  const DECOR_SIZE = { palm: [2.0, 3.2], bush: [1.3, 0.98], flower: [0.34, 0.45] };

  // ---- sprites drawn from the player's own ROM (decomp model: no ROM, no sprites; scribbled art instead) ----
  const PX = 0.025;                     // metres per ROM pixel
  const ROM_CANVAS = 96, ROM_SIZE = ROM_CANVAS * PX, ROM_RING = 16 * PX * 1.15;
  const HERO_FOOT = 1 - 84 / ROM_CANVAS, OBJ_FOOT = 1 - 80 / ROM_CANVAS;
  const DEFAULT_SKIN = { spring: '018', monitor: '03C', enemy: '00C' };
  let romArt = null, artLook = store.get(LOOK_KEY) === 'scribble' ? 'scribble' : 'rom';
  const romOn = () => !!romArt && artLook === 'rom';
  function pixCanvas(px, size, flip) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d'); g.putImageData(new ImageData(px, size, size), 0, 0);
    if (!flip) return c;
    const m = document.createElement('canvas'); m.width = m.height = size;
    const h = m.getContext('2d'); h.translate(size, 0); h.scale(-1, 1); h.drawImage(c, 0, 0);
    return m;
  }
  function pixTex(cnv) {
    const t = new THREE.CanvasTexture(cnv);
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
    return t;
  }
  function setRom(bytes) {
    const pal = S3D.paletteRGB(bytes, 3);
    romArt = { d: bytes, pal, hero: new Map(), objs: new Map(), levels: new Map(), fallbackPals: S3D.levelPalettes(bytes, 1),
      rings: Array.from({ length: 16 }, (_, k) => new THREE.SpriteMaterial({ map: pixTex(pixCanvas(S3D.ringImage(bytes, k, pal), 16)), alphaTest: 0.5 })) };
  }
  function romHeroTex(idx, flip) {
    const key = idx * 2 + (flip ? 1 : 0);
    let t = romArt.hero.get(key);
    if (!t) { t = pixTex(pixCanvas(S3D.heroImage(romArt.d, idx, flip, romArt.pal), ROM_CANVAS)); romArt.hero.set(key, t); }
    return t;
  }
  // the freed bird (16 frames) and the big ring, drawn from the ROM's own object art
  const FLICKY_HUES = [null, 325, 115, 2];   // blue as drawn, then pink, green, red
  function tintBlue(px, hue) {
    for (let i = 0; i < px.length; i += 4) {
      if (!px[i + 3]) continue;
      const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (b < mx || mx - mn < 0.15) continue;           // only the bluish body pixels change
      const l = (mx + mn) / 2, sat = (mx - mn) / (1 - Math.abs(2 * l - 1) || 1);
      const c = (1 - Math.abs(2 * l - 1)) * sat, hp = hue / 60, x = c * (1 - Math.abs(hp % 2 - 1)), m = l - c / 2;
      const [rr, gg, bb] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
      px[i] = (rr + m) * 255; px[i + 1] = (gg + m) * 255; px[i + 2] = (bb + m) * 255;
    }
    return px;
  }
  function romFlickyMat(frame, flip, kind = 0) {
    const key = 'f' + frame + (flip ? 'L' : 'R') + kind;
    if (!romArt.objs.has(key)) {
      let px = S3D.objImage(romArt.d, S3D.FLICKY_ART, frame, romArt.pal, 64, 32, 48, flip);
      if (FLICKY_HUES[kind % 4] !== null) px = tintBlue(px, FLICKY_HUES[kind % 4]);
      romArt.objs.set(key, new THREE.SpriteMaterial({ map: pixTex(pixCanvas(px, 64)), alphaTest: 0.5 }));
    }
    return romArt.objs.get(key);
  }
  // the big ring's own nine frames (it shrinks away when used) and monitors with the icon of what they hold
  function romRingFrameMat(k) {
    const key = 'bigring' + k;
    if (!romArt.objs.has(key)) romArt.objs.set(key, new THREE.SpriteMaterial({ map: pixTex(pixCanvas(S3D.objImage(romArt.d, S3D.BIG_RING_ART, k, romArt.pal, 96, 48, 72), 96)), alphaTest: 0.5 }));
    return romArt.objs.get(key);
  }
  function romMonitorMat(kind) {
    const pals = L.palettes || romArt.fallbackPals, key = 'mon' + kind + pals.join(',');
    if (!romArt.objs.has(key)) {
      const px = S3D.monitorImage(romArt.d, kind, pals);
      romArt.objs.set(key, px ? new THREE.SpriteMaterial({ map: pixTex(pixCanvas(px, ROM_CANVAS)), alphaTest: 0.5 }) : null);
    }
    return romArt.objs.get(key);
  }
  function romRingMat() {
    if (!romArt.objs.has('bigring')) romArt.objs.set('bigring', new THREE.SpriteMaterial({ map: pixTex(pixCanvas(S3D.objImage(romArt.d, S3D.BIG_RING_ART, 0, romArt.pal, 96, 48, 72), 96)), alphaTest: 0.5 }));
    return romArt.objs.get('bigring');
  }
  // an object's look from the ROM, or null when the ROM has no snapshot for that type
  function romObjMat(kind, skin, flip) {
    const key = skin || DEFAULT_SKIN[kind];
    if (!key || !S3D.RECIPES[key]) return null;
    const pals = L.palettes || romArt.fallbackPals, id = key + pals.join(',') + (flip ? 'f' : '');
    let m = romArt.objs.get(id);
    if (!m) {
      m = new THREE.SpriteMaterial({ map: pixTex(pixCanvas(S3D.recipeImage(romArt.d, key, pals), ROM_CANVAS, flip)), alphaTest: 0.5 });
      romArt.objs.set(id, m);
    }
    return m;
  }

  // springs in the ROM look: a short 3D drum coloured like the ROM's spring (cap, side, base), since the flat sprite
  // is drawn for the original's fixed view and reads as a floating disc from a chase camera
  function romSpringMats(skin) {
    const key = skin || DEFAULT_SKIN.spring;
    if (!S3D.RECIPES[key]) return null;
    const pals = L.palettes || romArt.fallbackPals, id = 'drum' + key + pals.join(',');
    if (!romArt.objs.has(id)) {
      const px = S3D.recipeImage(romArt.d, key, pals), W = Math.round(Math.sqrt(px.length / 4));
      const rows = [];
      for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) if (px[(y * W + x) * 4 + 3]) { rows.push(y); break; }
      const most = (y0, y1, skip) => {
        const n = new Map();
        for (let y = y0; y <= y1; y++) for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4; if (!px[i + 3]) continue;
          const k = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2]; if (k !== skip) n.set(k, (n.get(k) || 0) + 1);
        }
        let best = 0x808080, c = -1; for (const [k, v] of n) if (v > c) { c = v; best = k; }
        return best;
      };
      const top = rows[0], bot = rows[rows.length - 1], cap = most(top, top + Math.floor((bot - top) * 0.45), -1);
      const side = most(top + Math.floor((bot - top) * 0.6), bot - 3, cap), base = most(bot - 2, bot, -1);
      const m = c => new THREE.MeshBasicMaterial({ color: c });
      romArt.objs.set(id, { side: m(side), cap: m(cap), base: m(base) });
    }
    return romArt.objs.get(id);
  }
  function springDrum(mats, sp) {
    const g = new THREE.Group(), R = 0.46;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.92, R * 0.92, 0.07, 24), mats.base); base.position.y = 0.035;
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.16, 24), [mats.side, mats.cap, mats.side]); drum.position.y = 0.15;
    g.add(base, drum); g.position.set(sp.x, sp.y, sp.z); g.userData.drum = drum;
    return g;
  }

  // scribbled stand-ins for mines, turrets and shots (the ROM look uses the original sprites)
  function crudeMat(w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'));
    return spriteMat(c);
  }
  const mineMat = crudeMat(64, 64, g => {
    g.fillStyle = '#5b5f73'; g.strokeStyle = '#1c1830'; g.lineWidth = 3;
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; g.beginPath(); g.moveTo(32 + Math.cos(a) * 14, 34 + Math.sin(a) * 14); g.lineTo(32 + Math.cos(a) * 27, 34 + Math.sin(a) * 27); g.stroke(); }
    g.beginPath(); g.arc(32, 34, 15, 0, 7); g.fill(); g.stroke(); g.fillStyle = '#ff5a4a'; g.beginPath(); g.arc(32, 34, 5, 0, 7); g.fill();
  });
  const turretMat = crudeMat(64, 64, g => {
    g.fillStyle = '#7a3fb0'; g.strokeStyle = '#1c1830'; g.lineWidth = 3;
    g.beginPath(); g.rect(14, 34, 36, 26); g.fill(); g.stroke();
    g.fillStyle = '#c9c9d6'; g.beginPath(); g.arc(32, 34, 17, Math.PI, 0); g.fill(); g.stroke();
    g.fillStyle = '#1c1830'; g.fillRect(28, 12, 8, 10);
  });
  const shotMat = crudeMat(32, 32, g => {
    const r = g.createRadialGradient(16, 16, 2, 16, 16, 14); r.addColorStop(0, '#fff6c0'); r.addColorStop(0.5, '#ff9a2a'); r.addColorStop(1, 'rgba(255,80,0,0)');
    g.fillStyle = r; g.fillRect(0, 0, 32, 32);
  });
  const shieldMats = Object.fromEntries([['shield', '120,180,255'], ['gold', '255,205,60']].map(([k, rgb]) => {
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
    const r = g.createRadialGradient(32, 32, 18, 32, 32, 31); r.addColorStop(0, `rgba(${rgb},0.05)`); r.addColorStop(0.8, `rgba(${rgb},0.35)`); r.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = r; g.fillRect(0, 0, 64, 64);
    return [k, new THREE.SpriteMaterial({ map: tex(c), transparent: true, depthWrite: false })];
  }));
  const starMat = crudeMat(32, 32, g => {
    g.fillStyle = '#fff3a0'; g.beginPath();
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, r = k % 2 ? 5 : 15; g.lineTo(16 + Math.cos(a) * r, 16 + Math.sin(a) * r); }
    g.fill();
  });

  // ---- sound effects: original blips made with Web Audio when they play (nothing from the ROM); M mutes ----
  const Sfx = (() => {
    let ctx = null, out = null, muted = store.get(MUTE_KEY) === '1', lastPlay = {};
    function ready() {
      if (ctx) return ctx.state === 'running';
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); out = ctx.createGain(); out.gain.value = 0.25; out.connect(ctx.destination); } catch (e) { ctx = null; }
      return false;
    }
    function unlock() { ready(); if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {}); }
    // one note: wave, start and end frequency, length, volume, delay
    function tone(type, f0, f1, len, vol = 0.5, at = 0) {
      const t = ctx.currentTime + at, o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + len);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + len);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + len + 0.02);
    }
    function noise(len, vol = 0.5, cutoff = 1800, at = 0) {
      const t = ctx.currentTime + at, n = Math.floor(ctx.sampleRate * len), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      src.buffer = buf; f.type = 'lowpass'; f.frequency.value = cutoff; g.gain.value = vol;
      src.connect(f); f.connect(g); g.connect(out); src.start(t);
    }
    const arp = (notes, step, type = 'square', vol = 0.3) => notes.forEach((f, i) => tone(type, f, f, step * 1.6, vol, i * step));
    const SOUNDS = {
      ring: () => { tone('square', 1568, 1568, 0.07, 0.25); tone('square', 2093, 2093, 0.18, 0.22, 0.06); },
      jump: () => tone('square', 260, 720, 0.16, 0.25),
      spring: () => { tone('triangle', 180, 1400, 0.32, 0.5); tone('square', 360, 2000, 0.25, 0.12); },
      dash: () => { noise(0.25, 0.5, 3000); tone('sawtooth', 900, 140, 0.3, 0.25); },
      boostIn: () => tone('sawtooth', 200, 900, 0.9, 0.18),
      boost: () => { noise(0.35, 0.6, 2500); tone('square', 700, 120, 0.4, 0.25); },
      enemy: () => { noise(0.22, 0.7, 1400); tone('square', 520, 90, 0.2, 0.3); },
      boom: () => { noise(0.5, 0.9, 700); tone('sine', 120, 40, 0.5, 0.6); },
      shot: () => tone('square', 950, 260, 0.12, 0.15),
      monitor: () => { noise(0.15, 0.6, 2000); arp([784, 988, 1175], 0.07, 'triangle', 0.35); },
      hurt: () => { tone('square', 700, 180, 0.35, 0.3); arp([1568, 1397, 1175, 988], 0.05, 'square', 0.12); },
      shieldLost: () => { tone('sine', 600, 150, 0.3, 0.4); noise(0.2, 0.3, 4000); },
      goldDash: () => { noise(0.2, 0.5, 4000); tone('sawtooth', 1200, 300, 0.2, 0.2); },
      warp: () => tone('sine', 1400, 200, 0.5, 0.35),
      section: () => arp([523, 659, 784, 1047, 1319, 1568], 0.06, 'triangle', 0.35),
      goal: () => arp([523, 659, 784, 1047, 784, 1047, 1319, 1568], 0.11, 'square', 0.22),
      respawn: () => arp([392, 330, 262, 196], 0.12, 'triangle', 0.35),
      needFlickies: () => tone('square', 300, 220, 0.25, 0.2),
      flicky: () => tone('sine', 1800, 2600, 0.12, 0.25),
    };
    function play(name) {
      if (muted || !SOUNDS[name] || !ready()) return;
      const now = ctx.currentTime;
      if (now - (lastPlay[name] || -1) < 0.05) return;   // several in one frame (rings in a line) sound once
      lastPlay[name] = now; SOUNDS[name]();
    }
    for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, unlock, { passive: true });
    return { play, unlock, toggle() { muted = !muted; store.set(MUTE_KEY, muted ? '1' : '0'); return muted; }, get muted() { return muted; } };
  })();
  const POWER_TEXT = { rings: 'Ten rings.', shield: 'Shield: it takes one hit for you.', gold: 'Gold shield: press jump again in the air to dash.',
    invincible: 'Invincible for a while.', speed: 'Speed shoes: faster for a while.', oneup: 'One up.', fire: 'Shield: it takes one hit for you.' };

  // ---- level mesh, built by hand (r128 core has no merge utilities) ----
  const COLORS = {
    grassA: [0.47, 0.86, 0.36], grassB: [0.38, 0.76, 0.31],
    stone: [0.66, 0.64, 0.74], hazard: [0.92, 0.36, 0.30], wood: [0.86, 0.58, 0.30],
    earthTop: [0.88, 0.57, 0.31], earthLow: [0.50, 0.29, 0.17],
    stoneLow: [0.40, 0.38, 0.50],
  };
  const BOTTOM = -8;
  // the original level picture, unprojected onto the faces (only for converted levels while ROM sprites are on)
  function levelArtFor(L) {
    if (!romOn() || !L.rom) return null;
    let a = romArt.levels.get(L.rom.level);
    if (!a) {
      try { a = { baker: S3D.artBaker(romArt.d, L.rom.level), tex: null, count: -1 }; }
      catch (e) { console.warn('level art unavailable:', e.message); a = { baker: null }; }
      romArt.levels.set(L.rom.level, a);
    }
    return a.baker ? a : null;
  }
  function artTexture(a) {
    if (a.tex && a.count === a.baker.count) return a.tex;
    const at = a.baker.atlas(), c = document.createElement('canvas');
    c.width = at.width; c.height = at.height;
    c.getContext('2d').putImageData(new ImageData(at.pixels, at.width, at.height), 0, 0);
    if (a.tex) a.tex.dispose();
    a.tex = new THREE.CanvasTexture(c);
    a.tex.magFilter = THREE.NearestFilter; a.tex.minFilter = THREE.LinearFilter; a.tex.generateMipmaps = false;
    a.count = a.baker.count; a.size = [at.width, at.height]; a.cols = at.cols;
    return a.tex;
  }
  // with the level's own art when it can be drawn from the ROM, otherwise (or if drawing fails) the scribbled look
  // tiles with a floor (pits and the void around a converted level have none)
  const solid = (L, t) => L.coll[t] === 'F' || L.coll[t] === 'H';
  // ---- foliage lifted out of the original picture: one quad each, turned to face the camera every frame ----
  let foliage = null;
  const PXH = 1 / (32 * Math.SQRT2);           // metres per picture pixel across (the picture runs along x - z)
  function buildFoliage(art) {
    const list = art && art.baker.foliage;
    if (!list || !list.length) return null;
    // shelf-pack the pictures into one texture
    const W = 1024; let x = 0, y = 0, rowH = 0;
    const spots = list.map(f => {
      if (x + f.w > W) { x = 0; y += rowH + 2; rowH = 0; }
      const at = [x, y]; x += f.w + 2; rowH = Math.max(rowH, f.h); return at;
    });
    let H = 32; while (H < y + rowH) H *= 2;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    list.forEach((f, i) => g.putImageData(new ImageData(f.img, f.w, f.h), spots[i][0], spots[i][1]));
    const tex = new THREE.CanvasTexture(c); tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
    const n = list.length, pos = new Float32Array(n * 12), uv = new Float32Array(n * 8), idx = [];
    const vs = L.rom.vscale, [ox, oz] = L.rom.origin;
    const quads = list.map((f, i) => {
      const [sx, sy] = spots[i];
      uv.set([sx / W, 1 - (sy + f.h) / H, (sx + f.w) / W, 1 - (sy + f.h) / H, (sx + f.w) / W, 1 - sy / H, sx / W, 1 - sy / H], i * 8);
      idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
      return { x: f.x / 32 - ox, y: f.y / 32 * vs, z: f.z / 32 - oz, l: -f.ax * PXH, r: (f.w - f.ax) * PXH, b: -(f.h - f.ay) * vs / 32, t: f.ay * vs / 32 };
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide }));
    mesh.frustumCulled = false;
    return { mesh, quads, tex };
  }
  const _right = new THREE.Vector3();
  function updateFoliage() {
    if (!foliage) return;
    _right.setFromMatrixColumn(cam.matrixWorld, 0); _right.y = 0; _right.normalize();
    const pos = foliage.mesh.geometry.attributes.position, a = pos.array;
    const cx = cam.position.x, cz = cam.position.z, sx = lastRp.x - cx, sz = lastRp.z - cz, len2 = sx * sx + sz * sz || 1;
    foliage.quads.forEach((q, i) => {
      // tuck away anything standing between the chase camera and the player
      let hide = false;
      if (view.mode === 'chase') {
        const dx = q.x - cx, dz = q.z - cz, u = (dx * sx + dz * sz) / len2, ex = dx - sx * u, ez = dz - sz * u;
        hide = u > -0.1 && u < 0.92 && ex * ex + ez * ez < 0.8 && q.y + q.t > lastRp.y;
      }
      const o = i * 12, l = hide ? 0 : q.l, r = hide ? 0 : q.r, b = hide ? 0 : q.b, tp = hide ? 0 : q.t;
      a[o] = q.x + _right.x * l; a[o + 1] = q.y + b; a[o + 2] = q.z + _right.z * l;
      a[o + 3] = q.x + _right.x * r; a[o + 4] = q.y + b; a[o + 5] = q.z + _right.z * r;
      a[o + 6] = q.x + _right.x * r; a[o + 7] = q.y + tp; a[o + 8] = q.z + _right.z * r;
      a[o + 9] = q.x + _right.x * l; a[o + 10] = q.y + tp; a[o + 11] = q.z + _right.z * l;
    });
    pos.needsUpdate = true;
  }
  function buildLevelMesh(L) {
    const art = levelArtFor(L);
    if (art) {
      try { return buildMeshWith(L, art); }
      catch (e) { console.warn('level art failed:', e.message); romArt.levels.set(L.rom.level, { baker: null }); }
    }
    return buildMeshWith(L, null);
  }
  function buildMeshWith(L, art) {
    const pos = [], col = [], nrm = [], uv = [], ART_UV = [];
    // with art, uvs are (slot, s, t in 0..1) until the atlas size is known
    const W = L.width, D = L.depth, c = L.corners;
    const tA = new THREE.Vector3(), tB = new THREE.Vector3(), tN = new THREE.Vector3();
    function tri(a, b, c3, ca, cb, cc, ua, ub, uc, expect) {
      tA.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      tB.set(c3[0] - a[0], c3[1] - a[1], c3[2] - a[2]);
      tN.crossVectors(tA, tB);
      const len = tN.length();
      if (len < 1e-9) return;
      if (tN.dot(expect) < 0) { [b, c3] = [c3, b]; [cb, cc] = [cc, cb]; [ub, uc] = [uc, ub]; tN.negate(); }
      tN.divideScalar(len);
      for (const [v, k, u] of [[a, ca, ua], [b, cb, ub], [c3, cc, uc]]) {
        pos.push(v[0], v[1], v[2]); col.push(k[0], k[1], k[2]); nrm.push(tN.x, tN.y, tN.z);
        if (art) ART_UV.push(u[0], u[1], u[2]); else uv.push(u[0], u[1]);
      }
    }
    const up = new THREE.Vector3(0, 1, 0);
    let minTop = Infinity;
    for (let t = 0; t < W * D; t++) if (solid(L, t)) for (let q = 0; q < 4; q++) minTop = Math.min(minTop, c[t * 4 + q]);
    // with the original art the cliffs drop deep into the abyss under the sky dome; otherwise the island sits on water
    const islandBottom = art ? minTop - 14 : minTop - 2.5, pitBottom = art ? islandBottom : BOTTOM;
    const shade = (base, y) => { const t = 0.92 + Math.min(0.12, Math.max(-0.08, (y - 1) * 0.04)); return [base[0] * t, base[1] * t, base[2] * t]; };
    const lerpC = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const OFF = [[0, 0], [1, 0], [1, 1], [0, 1]], WHITE = [1, 1, 1];
    const TUV = [[0, 0], [1, 0], [1, 1], [0, 1]];
    // [corner a, corner b, neighbour dx, dz, neighbour's corner matching a, matching b, outward normal]
    const EDGES = [
      [0, 1, 0, -1, 3, 2, new THREE.Vector3(0, 0, -1)],
      [1, 2, 1, 0, 0, 3, new THREE.Vector3(1, 0, 0)],
      [2, 3, 0, 1, 1, 0, new THREE.Vector3(0, 0, 1)],
      [3, 0, -1, 0, 2, 1, new THREE.Vector3(-1, 0, 0)],
    ];
    for (let j = 0; j < D; j++) for (let i = 0; i < W; i++) {
      const t = j * W + i, k = t * 4;
      if (!solid(L, t)) continue;
      const mat = L.mat[t];
      const h = [c[k], c[k + 1], c[k + 2], c[k + 3]];
      const V = OFF.map((o, q) => [i + o[0], h[q], j + o[1]]);
      const top = COLORS[mat] || ((i + j) % 2 ? COLORS.grassA : COLORS.grassB);
      const tc = art ? WHITE : shade(top, (h[0] + h[2]) / 2);
      if (art) {
        const slot = art.baker.top(i + L.rom.origin[0], j + L.rom.origin[1]), su = q => [slot, OFF[q][0], OFF[q][1]];
        tri(V[0], V[3], V[2], tc, tc, tc, su(0), su(3), su(2), up);
        tri(V[0], V[2], V[1], tc, tc, tc, su(0), su(2), su(1), up);
      } else {
        tri(V[0], V[3], V[2], tc, tc, tc, TUV[0], TUV[3], TUV[2], up);
        tri(V[0], V[2], V[1], tc, tc, tc, TUV[0], TUV[2], TUV[1], up);
      }
      const stony = mat === 'stone';
      const sideTop = stony ? COLORS.stone : COLORS.earthTop, sideLow = stony ? COLORS.stoneLow : COLORS.earthLow;
      const colAt = y => lerpC(sideLow, sideTop, Math.min(1, Math.max(0, (y + 2) / 5)));
      for (let e = 0; e < 4; e++) {
        const [a, b, dx, dz, na, nb, out] = EDGES[e];
        const ni = i + dx, nj = j + dz;
        const inside = ni >= 0 && nj >= 0 && ni < W && nj < D;
        let ba = inside ? pitBottom : islandBottom, bb = ba;
        if (inside) { const nt = nj * W + ni; if (solid(L, nt)) { ba = c[nt * 4 + na]; bb = c[nt * 4 + nb]; } }
        const ta = h[a], tb = h[b];
        if (ta <= ba + 1e-6 && tb <= bb + 1e-6) continue;
        const ya = Math.min(ba, ta), yb = Math.min(bb, tb);
        const pa = [i + OFF[a][0], j + OFF[a][1]], pb = [i + OFF[b][0], j + OFF[b][1]];
        if (art) {
          // bands one original height unit tall (32 units), following the slope of the top edge
          const bm = L.rom.vscale, n = Math.ceil(Math.max(ta - ya, tb - yb) / bm - 1e-6);
          for (let k = 0; k < n; k++) {
            const a1 = ta - k * bm, b1 = tb - k * bm, a0 = Math.max(ya, a1 - bm), b0 = Math.max(yb, b1 - bm);
            if (a1 <= a0 + 1e-6 && b1 <= b0 + 1e-6) continue;
            const slot = art.baker.wall(i + L.rom.origin[0], j + L.rom.origin[1], e, k);
            const P = (p, y) => [p[0], y, p[1]], da = Math.max(0, a1 - a0) / bm, db = Math.max(0, b1 - b0) / bm;
            tri(P(pa, a0 + da * bm), P(pa, a0), P(pb, b0), WHITE, WHITE, WHITE, [slot, 0, 0], [slot, 0, da], [slot, 1, db], out);
            tri(P(pa, a0 + da * bm), P(pb, b0), P(pb, b0 + db * bm), WHITE, WHITE, WHITE, [slot, 0, 0], [slot, 1, db], [slot, 1, 0], out);
          }
          continue;
        }
        const A1 = [pa[0], ta, pa[1]], A0 = [pa[0], ya, pa[1]], B1 = [pb[0], tb, pb[1]], B0 = [pb[0], yb, pb[1]];
        tri(A1, A0, B0, colAt(ta), colAt(ya), colAt(yb), [0, ta], [0, ya], [1, yb], out);
        tri(A1, B0, B1, colAt(ta), colAt(yb), colAt(tb), [0, ta], [1, yb], [1, tb], out);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    let mat;
    if (art) {
      // slot (row by row in a 64-wide grid of 32 px slots) plus the position inside it, kept half a texel in
      const tex = artTexture(art), [W, H] = art.size;
      for (let q = 0; q < ART_UV.length; q += 3) {
        const slot = ART_UV[q], px = (slot % art.cols) * 32 + 0.5 + ART_UV[q + 1] * 31, py = Math.floor(slot / art.cols) * 32 + 0.5 + ART_UV[q + 2] * 31;
        uv.push(px / W, 1 - py / H);
      }
      mat = new THREE.MeshBasicMaterial({ map: tex });
    } else mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: tileTex });
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const mesh = new THREE.Mesh(g, mat);
    mesh.userData.waterY = minTop - 0.6; mesh.userData.art = !!art;
    return mesh;
  }
  // water sheet under the pits so a gorge reads as a river
  function buildWater(L, y) {
    const pos = [], uv = [];
    for (let j = 0; j < L.depth; j++) for (let i = 0; i < L.width; i++) {
      if (L.coll[j * L.width + i] !== 'P') continue;
      pos.push(i, y, j, i, y, j + 1, i + 1, y, j + 1, i, y, j, i + 1, y, j + 1, i + 1, y, j);
      uv.push(i, j, i, j + 1, i + 1, j + 1, i, j, i + 1, j + 1, i + 1, j);
    }
    if (!pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: waterTex }));
  }

  // ---- everything that belongs to the current level lives in one group, rebuilt on load ----
  let levelGroup = null, waterMesh = null, ringSprites = [], springSprites = [], tallDecor = [];
  let enemySprites = [], monitorSprites = [], goalSprites = [], looseSprites = [], flickySprites = [], ringSize = 0.62;
  let mineSprites = [], turretSprites = [], shotSprites = [], boosterMarks = [], goalFx = null;
  function buildLevelObjects() {
    if (levelGroup) {
      scene.remove(levelGroup);
      if (foliage) foliage.tex.dispose();
      levelGroup.traverse(o => { if (o.isMesh) { o.geometry.dispose(); for (const m of [].concat(o.material)) m.dispose(); } else if (o.isSprite && o.userData.fade !== undefined) o.material.dispose(); });
    }
    levelGroup = new THREE.Group();
    const mesh = buildLevelMesh(L);
    levelGroup.add(mesh);
    foliage = mesh.userData.art ? buildFoliage(levelArtFor(L)) : null;
    if (foliage) levelGroup.add(foliage.mesh);
    waterMesh = mesh.userData.art ? null : buildWater(L, mesh.userData.waterY);
    applySky(mesh.userData.art);
    if (waterMesh) levelGroup.add(waterMesh);
    tallDecor = [];
    const rom = romOn();
    ringSize = rom ? ROM_RING : 0.62;
    ringSprites = world.rings.map((g, q) => {
      const s = new THREE.Sprite(rom ? romArt.rings[0] : ringMats[q % 3]);
      s.position.set(g.x, g.y, g.z); s.scale.set(ringSize, ringSize, 1);
      levelGroup.add(s); return s;
    });
    const bottomSprite = (mat, x, y, z, sx, sy, cy = 0.04) => {
      const s = new THREE.Sprite(mat); s.center.set(0.5, cy); s.position.set(x, y, z); s.scale.set(sx, sy, 1); levelGroup.add(s); return s;
    };
    // each object sprite remembers its size and, when drawn from the ROM, its materials (native and mirrored)
    const objSprite = (kind, o, crudeMat, crudeSize, crudeFoot) => {
      const rm = rom ? romObjMat(kind, o.skin, false) : null;
      const s = rm ? bottomSprite(rm, o.x, o.y, o.z, ROM_SIZE, ROM_SIZE, OBJ_FOOT) : bottomSprite(crudeMat, o.x, o.y, o.z, crudeSize, crudeSize, crudeFoot);
      s.userData.size = rm ? ROM_SIZE : crudeSize;
      if (rm) s.userData.rom = [rm, kind === 'enemy' ? romObjMat(kind, o.skin, true) : rm];
      return s;
    };
    springSprites = world.springs.map(sp => {
      const dm = rom ? romSpringMats(sp.skin) : null;
      if (!dm) return objSprite('spring', sp, springMats[0], 0.95, 0.06);
      const g = springDrum(dm, sp); levelGroup.add(g); return g;
    });
    enemySprites = world.enemies.map(en => objSprite('enemy', en, enemyMat(0, 0, false), 1.05, 0.04));
    monitorSprites = world.monitors.map(mo => {
      const mm = rom ? romMonitorMat(mo.kind) : null;
      if (!mm) return objSprite('monitor', mo, monitorMats[0], 0.85, 0.04);
      const s = bottomSprite(mm, mo.x, mo.y, mo.z, ROM_SIZE, ROM_SIZE, OBJ_FOOT); s.userData.size = ROM_SIZE; s.userData.rom = [mm, mm]; return s;
    });
    mineSprites = world.mines.map(mi => objSprite('mine', mi, mineMat, 0.7, 0.04));
    turretSprites = world.turrets.map(tu => objSprite('turret', tu, turretMat, 0.95, 0.04));
    shotSprites = [];
    for (let i = 0; i < 12; i++) { const s = new THREE.Sprite(shotMat); s.scale.set(0.35, 0.35, 1); s.visible = false; levelGroup.add(s); shotSprites.push(s); }
    // superchargers are painted into the ROM's level art; the scribbled look marks them with a dark pad and an arrow
    boosterMarks = rom && L.rom ? [] : world.boosters.map(b => {
      const g = new THREE.Group();
      const pad = new THREE.Mesh(new THREE.CircleGeometry(0.45, 24), new THREE.MeshBasicMaterial({ color: 0x241d3a }));
      const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.4, 3), new THREE.MeshBasicMaterial({ color: 0xffc43d }));
      pad.rotation.x = -Math.PI / 2; arrow.rotation.x = Math.PI / 2; arrow.position.y = 0.04;
      g.add(pad, arrow); g.position.set(b.x, b.y + 0.02, b.z); g.rotation.y = Math.atan2(b.dir[0], b.dir[1]);
      levelGroup.add(g); return g;
    });
    // the original's big ring floats 56 units above the floor
    const lift = L.rom ? 56 / 32 * L.rom.vscale : 1.2;
    goalSprites = world.goals.map(gl => {
      if (!rom) return bottomSprite(goalMats[0], gl.x, gl.y, gl.z, 1.1, 2.2);
      const s = bottomSprite(romRingMat(), gl.x, gl.y + lift, gl.z, ROM_SIZE, ROM_SIZE, 1 - 72 / ROM_CANVAS);
      s.userData.rom = true; return s;
    });
    flickySprites = [];
    for (let i = 0; i < 24; i++) { const s = new THREE.Sprite(flickyMat(0, 0, false)); s.center.set(0.5, 0.08); s.scale.set(0.55, 0.55, 1); s.visible = false; levelGroup.add(s); flickySprites.push(s); }
    goalFx = null;
    $('flickyHud').hidden = !L.flickies;
    looseSprites = [];
    for (let i = 0; i < Sim.P.scatterMax; i++) { const s = new THREE.Sprite(rom ? romArt.rings[0] : ringMats[0]); s.scale.set(0.5, 0.5, 1); s.visible = false; levelGroup.add(s); looseSprites.push(s); }
    for (const e of L.entities) {
      const mats = decorMats[e.type];
      if (!mats) continue;
      const base = mats[e.variant % mats.length];
      // trees and bushes get their own material so each can fade when it blocks the camera
      const tall = e.type !== 'flower';
      const s = new THREE.Sprite(tall ? base.clone() : base);
      const [w, h] = DECOR_SIZE[e.type];
      s.center.set(0.5, 0.03); s.position.set(e.x, e.y, e.z); s.scale.set(w * e.size, h * e.size, 1);
      if (tall) { s.material.transparent = true; s.userData.fade = 1; tallDecor.push(s); }
      levelGroup.add(s);
    }
    scene.add(levelGroup);
    $('ringTotal').textContent = '/ ' + world.rings.length;
    $('ringCount').textContent = '0';
  }
  buildLevelObjects();

  // ---- the player: a billboard sprite drawn per frame, with line boil ----
  const heroTex = new Map();
  function heroTexture(view, pose, phase, boil, flip) {
    const key = view + pose + phase + boil + (flip ? 'L' : 'R');
    let t = heroTex.get(key);
    if (!t) { t = tex(Art.hero(view, pose, phase, boil, flip)); heroTex.set(key, t); }
    return t;
  }
  const heroMat = new THREE.SpriteMaterial({ map: heroTexture('front', 'idle', 0, 0, false), alphaTest: 0.5 });
  const hero = new THREE.Sprite(heroMat);
  hero.center.set(0.5, 0.04); hero.scale.set(1.5, 1.5, 1);
  scene.add(hero);
  // silhouette: the same drawing, tinted, shown only where the level hides the player
  const silMat = new THREE.SpriteMaterial({ map: heroMat.map, color: 0xffc43d, transparent: true, opacity: 0.55, alphaTest: 0.5, depthWrite: false, depthFunc: THREE.GreaterDepth, fog: false });
  const sil = new THREE.Sprite(silMat);
  sil.center.copy(hero.center); sil.scale.copy(hero.scale); sil.renderOrder = 10;
  scene.add(sil);
  const shieldSprite = new THREE.Sprite(shieldMats.shield); shieldSprite.scale.set(1.25, 1.25, 1); shieldSprite.visible = false; shieldSprite.renderOrder = 5; scene.add(shieldSprite);
  const stars = Array.from({ length: 4 }, () => { const s = new THREE.Sprite(starMat); s.scale.set(0.3, 0.3, 1); s.visible = false; scene.add(s); return s; });
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.34, 20), new THREE.MeshBasicMaterial({ color: 0x1a1430, transparent: true, opacity: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  scene.add(shadow);
  const look3 = { facingLeft: false, view: 'front', idleFor: 0, runCycle: 0, ballCycle: 0, oct: 0, romCycle: 0 };
  // which ROM frame to show: view from the heading on screen, pose from the sim
  function romHeroPick(pose, sp, sx, sf, t, dt) {
    if (sp > 0.6) look3.oct = ((Math.round(Math.atan2(sx, -sf) / (Math.PI / 4)) % 8) + 8) % 8;
    const [v, flip] = S3D.OCTANT[look3.oct], side = !look3.facingLeft; // ball and charge frames face left as stored
    if (pose === 'charge') { const q = S3D.HERO.charge(); return [q[Math.floor(t * 20) % q.length], side]; }
    if (pose === 'ball' || pose === 'spring') { const q = S3D.HERO.ball(); return [q[Math.floor(look3.ballCycle * 2) % q.length], side]; }
    if (pose === 'run' || pose === 'air') {
      look3.romCycle += dt * (6 + sp * 2.2);
      const q = sp > Sim.P.run * 0.75 ? S3D.HERO.run(v) : S3D.HERO.walk(v);
      return [q[pose === 'air' ? 2 : Math.floor(look3.romCycle) % q.length], flip];
    }
    if (look3.idleFor > 5 && look3.oct === 0) return [235 + Math.floor(t * 6) % 7, false];
    return [v, flip];
  }

  // ---- cameras: chase (perspective, on a leash behind the player) and isometric (orthographic) ----
  const PITCH_ISO = Math.atan(1 / Math.SQRT2);
  const isoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  const chaseCam = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
  const view = {
    mode: store.get(CAM_KEY) === 'iso' ? 'iso' : 'chase',
    yaw: 0, yawTarget: 0, zoom: 1, target: new THREE.Vector3(),
    dist: 6.5, pitch: 0.36, effPitch: 0.36, pendingYaw: 0, blockedDist: 6.5, followY: 0,
    pos: new THREE.Vector3(), look: new THREE.Vector3(),
  };
  let cam = view.mode === 'iso' ? isoCam : chaseCam;
  const lastRp = new THREE.Vector3();
  const orbit = { yaw: 0, pitch: 0 }; // continuous look input this frame (radians)
  // put the camera behind the player's start facing
  function resetCamera() {
    const p = world.p, yaw = p.facing + Math.PI;
    lastRp.set(p.x, p.y, p.z);
    view.followY = p.y; view.blockedDist = view.dist; view.pendingYaw = 0;
    view.pos.set(p.x + Math.sin(yaw) * view.dist, p.y + 2.5, p.z + Math.cos(yaw) * view.dist);
    view.yawTarget = view.yaw = Math.round((yaw - Math.PI / 4) / (Math.PI / 2)) * Math.PI / 2 + Math.PI / 4;
    view.target.set(p.x, p.y + 0.4, p.z);
  }
  resetCamera();
  function resize() {
    const w = window.innerWidth, h = window.innerHeight, aspect = w / h;
    renderer.setSize(w, h, false);
    const viewH = (aspect >= 1 ? 11 : Math.max(11, 8.5 / aspect)) / view.zoom;
    isoCam.top = viewH / 2; isoCam.bottom = -viewH / 2; isoCam.left = -viewH * aspect / 2; isoCam.right = viewH * aspect / 2;
    isoCam.updateProjectionMatrix();
    chaseCam.aspect = aspect; chaseCam.fov = aspect >= 1 ? 55 : 72; chaseCam.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();
  // bearing of the camera as seen from the player (0 = camera south of the player)
  function currentYaw() { return view.mode === 'iso' ? view.yaw : Math.atan2(view.pos.x - lastRp.x, view.pos.z - lastRp.z); }
  function setMode(mode) {
    const yawNow = currentYaw();
    view.mode = mode; cam = mode === 'iso' ? isoCam : chaseCam;
    scene.fog = mode === 'chase' ? sceneFog : null;
    if (mode === 'iso') { view.yawTarget = Math.round((yawNow - Math.PI / 4) / (Math.PI / 2)) * Math.PI / 2 + Math.PI / 4; view.yaw = view.yawTarget; }
    else { view.followY = lastRp.y; view.pos.set(lastRp.x + Math.sin(yawNow) * view.dist, lastRp.y + 2.5, lastRp.z + Math.cos(yawNow) * view.dist); view.blockedDist = view.dist; }
    const b = $('camMode'); b.textContent = mode === 'iso' ? '3D' : 'ISO';
    b.setAttribute('aria-label', mode === 'iso' ? 'Switch to the 3D chase camera' : 'Switch to the isometric view');
    store.set(CAM_KEY, mode);
  }
  const rotateCam = dir => {
    if (view.mode === 'iso') view.yawTarget += dir * Math.PI / 2;
    else view.pendingYaw += dir * Math.PI / 4;
  };

  function updateIso(rp, dt) {
    orbit.yaw = orbit.pitch = 0;
    view.yaw += (view.yawTarget - view.yaw) * Math.min(1, dt * 9);
    const k = 1 - Math.exp(-dt * 7);
    const ahead = window.innerHeight > window.innerWidth ? 3.5 / view.zoom : 0;
    const tx = rp.x - Math.sin(view.yaw) * ahead, tz = rp.z - Math.cos(view.yaw) * ahead;
    view.target.x += (tx - view.target.x) * k; view.target.y += (rp.y + 0.4 - view.target.y) * k; view.target.z += (tz - view.target.z) * k;
    const d = 40, t = view.target;
    isoCam.position.set(t.x + Math.sin(view.yaw) * Math.cos(PITCH_ISO) * d, t.y + Math.sin(PITCH_ISO) * d, t.z + Math.cos(view.yaw) * Math.cos(PITCH_ISO) * d);
    isoCam.lookAt(t);
  }

  // Fraction (0..1] of the way from a to b before the level blocks the line of sight.
  // terrain height as the camera sees it: the void that blocks the player is open air to the camera
  const camTop = (L, i, j, x, z) => (i >= 0 && j >= 0 && i < L.width && j < L.depth && L.coll[j * L.width + i] === 'W' ? -Infinity : Sim.tileTopNear(L, i, j, x, z));
  function clearFraction(ax, ay, az, bx, by, bz) {
    const N = 28;
    for (let q = 1; q <= N; q++) {
      const t = q / N, x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t;
      const i = Math.floor(x), j = Math.floor(z);
      if (i < 0 || j < 0 || i >= L.width || j >= L.depth) continue;
      if (camTop(L, i, j, x, z) + 0.35 > y) return Math.max(0, (q - 1) / N);
    }
    return 1;
  }
  // How far the camera can sit from the focus along (yaw, pitch): inside the map, never over or inside a wall
  // taller than the player's chest, and with a clear view of the player.
  function roomAt(yaw, pitch, fx, fy, fz) {
    const dx = Math.sin(yaw), dz = Math.cos(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), m = 0.3;
    let h = view.dist * cp;
    if (dx > 1e-6) h = Math.min(h, (L.width - m - fx) / dx); else if (dx < -1e-6) h = Math.min(h, (m - fx) / dx);
    if (dz > 1e-6) h = Math.min(h, (L.depth - m - fz) / dz); else if (dz < -1e-6) h = Math.min(h, (m - fz) / dz);
    const wallY = view.followY + 0.9;
    for (let t = 0.1; t < h; t += 0.1) {
      const x = fx + dx * t, z = fz + dz * t;
      if (camTop(L, Math.floor(x), Math.floor(z), x, z) > wallY) { h = Math.max(0, t - m); break; }
    }
    const d = Math.max(0, h / cp);
    const frac = clearFraction(fx, fy, fz, fx + dx * cp * d, fy + sp * d, fz + dz * cp * d);
    return { room: frac * d, frac };
  }
  function updateChase(rp, dt, p) {
    const looking = orbit.yaw !== 0 || orbit.pitch !== 0;
    // height to frame: steady during jumps, catches up on landing or long falls
    const fy = p.grounded ? 9 : (rp.y < view.followY - 0.5 ? 6 : 1.5);
    view.followY += (rp.y - view.followY) * Math.min(1, dt * fy);
    const fx = rp.x, fz = rp.z, focusY = view.followY + 0.8;
    // leash: keep the camera's current bearing from the player
    let yaw = Math.atan2(view.pos.x - fx, view.pos.z - fz);
    const stepYaw = view.pendingYaw * Math.min(1, dt * 10);
    view.pendingYaw -= stepYaw;
    yaw += stepYaw + orbit.yaw;
    view.pitch = Math.min(1.15, Math.max(0.05, view.pitch + orbit.pitch));
    orbit.yaw = orbit.pitch = 0;
    // at speed, ease round behind the direction of travel
    const sp = Math.hypot(p.vx, p.vz);
    if (!looking && sp > Sim.P.run * 1.1) {
      let d = Math.atan2(-p.vx, -p.vz) - yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      yaw += d * Math.min(1, dt * 1.6 * Math.min(1, (sp - Sim.P.run) / 8));
    }
    // Mario 64 style obstacle handling: stay inside the level, rise to look over walls,
    // swing toward open space, and only pull in close as a last resort.
    let best = roomAt(yaw, view.pitch, fx, focusY, fz), pitchUse = view.pitch;
    for (let pp = view.pitch + 0.08; best.frac < 0.999 && pp <= 1.25; pp += 0.08) {
      const r = roomAt(yaw, pp, fx, focusY, fz);
      if (r.frac >= 0.999 || r.room > best.room + 0.05) { best = r; pitchUse = pp; }
    }
    view.effPitch += (pitchUse - view.effPitch) * Math.min(1, dt * (looking ? 30 : pitchUse > view.effPitch ? 10 : 2.5));
    if (!looking && best.room < view.dist * 0.6) {
      let bestOff = 0, bestRoom = best.room + 0.5;
      for (const off of [0.4, -0.4, 0.8, -0.8, 1.2, -1.2, 1.6, -1.6]) {
        const r = roomAt(yaw + off, view.effPitch, fx, focusY, fz).room;
        if (r > bestRoom + 0.3 * Math.abs(off)) { bestRoom = r; bestOff = off; }
      }
      if (bestOff) yaw += Math.sign(bestOff) * Math.min(Math.abs(bestOff), dt * 2.2);
    }
    const free = Math.max(1.2, roomAt(yaw, view.effPitch, fx, focusY, fz).room);
    view.blockedDist = free < view.blockedDist ? free : view.blockedDist + (free - view.blockedDist) * Math.min(1, dt * 3);
    const dd = Math.min(view.blockedDist, view.dist), cp = Math.cos(view.effPitch), spch = Math.sin(view.effPitch);
    view.pos.set(fx + Math.sin(yaw) * cp * dd, focusY + spch * dd, fz + Math.cos(yaw) * cp * dd);
    const floorHere = Sim.floorAt(L, view.pos.x, view.pos.z);
    if (Number.isFinite(floorHere) && view.pos.y < floorHere + 0.4) view.pos.y = floorHere + 0.4;
    chaseCam.position.copy(view.pos);
    view.look.set(fx, focusY - 0.15, fz);
    chaseCam.lookAt(view.look);
    view.target.set(fx, focusY, fz);
  }

  // ---- input ----
  const keys = new Set();
  const KEYMAP = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
    Space: 'jump', KeyJ: 'jump', ShiftLeft: 'dash', ShiftRight: 'dash', KeyK: 'dash' };
  window.addEventListener('keydown', e => {
    if (!started && !$('helpOverlay').hidden && (e.code === 'Enter' || e.code === 'Space')) { e.preventDefault(); start(); return; }
    if (e.code in KEYMAP) { keys.add(KEYMAP[e.code]); e.preventDefault(); }
    else if (e.code === 'KeyQ' && !e.repeat) rotateCam(-1);
    else if (e.code === 'KeyE' && !e.repeat) rotateCam(1);
    else if (e.code === 'KeyR' && !e.repeat) restart();
    else if (e.code === 'KeyM' && !e.repeat) toast(Sfx.toggle() ? 'Sound off. M turns it back on.' : 'Sound on.', 1.6);
    else if (e.code === 'KeyV' && !e.repeat) setMode(view.mode === 'iso' ? 'chase' : 'iso');
  });
  window.addEventListener('keyup', e => { if (e.code in KEYMAP) keys.delete(KEYMAP[e.code]); });
  window.addEventListener('blur', () => keys.clear());
  window.addEventListener('wheel', e => {
    if (view.mode === 'iso') { view.zoom = Math.min(1.8, Math.max(0.55, view.zoom * (e.deltaY > 0 ? 0.92 : 1.08))); resize(); }
    else view.dist = Math.min(12, Math.max(3, view.dist * (e.deltaY > 0 ? 1.08 : 0.92)));
  }, { passive: true });

  // touch: floating stick on the left half, look-drag on the right half; mouse drag looks too
  const touch = { stickId: null, ox: 0, oy: 0, x: 0, y: 0, jump: false, dash: false };
  const stickEl = $('stick'), knob = $('stickKnob');
  const STICK_R = 55, DEAD = 0.13;
  if (isTouch) $('touchUI').hidden = false;
  const look = { id: null, lx: 0, ly: 0, acc: 0 };
  canvas.addEventListener('pointerdown', e => {
    canvas.focus();
    if (e.pointerType !== 'mouse' && e.clientX < window.innerWidth * 0.5 && touch.stickId === null) {
      touch.stickId = e.pointerId; touch.ox = e.clientX; touch.oy = e.clientY; touch.x = touch.y = 0;
      stickEl.style.left = e.clientX + 'px'; stickEl.style.top = e.clientY + 'px'; stickEl.hidden = false; $('stickHint').hidden = true;
    } else if (look.id === null) {
      look.id = e.pointerId; look.lx = e.clientX; look.ly = e.clientY; look.acc = 0;
    } else return;
    canvas.setPointerCapture(e.pointerId); e.preventDefault();
  });
  canvas.addEventListener('pointermove', e => {
    if (e.pointerId === look.id) {
      const dx = e.clientX - look.lx, dy = e.clientY - look.ly;
      look.lx = e.clientX; look.ly = e.clientY;
      if (view.mode === 'chase') { orbit.yaw -= dx * 0.009; orbit.pitch += dy * 0.006; }
      else { look.acc += dx; if (Math.abs(look.acc) > 70) { rotateCam(look.acc > 0 ? -1 : 1); look.acc = 0; } }
      return;
    }
    if (e.pointerId !== touch.stickId) return;
    let dx = e.clientX - touch.ox, dy = e.clientY - touch.oy;
    const d = Math.hypot(dx, dy);
    if (d > STICK_R) { dx *= STICK_R / d; dy *= STICK_R / d; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const cd = Math.min(d, STICK_R), mag = cd / STICK_R, live = mag < DEAD ? 0 : (mag - DEAD) / (1 - DEAD);
    touch.x = cd > 1e-6 ? dx / cd * live : 0;
    touch.y = cd > 1e-6 ? dy / cd * live : 0;
  });
  const endPointer = e => {
    if (e.pointerId === look.id) { look.id = null; return; }
    if (e.pointerId !== touch.stickId) return;
    touch.stickId = null; touch.x = touch.y = 0; stickEl.hidden = true; knob.style.transform = '';
  };
  canvas.addEventListener('pointerup', endPointer); canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  for (const [id, key] of [['padJump', 'jump'], ['padDash', 'dash']]) {
    const el = $(id); let pid = null;
    el.addEventListener('pointerdown', e => { pid = e.pointerId; touch[key] = true; el.classList.add('held'); el.setPointerCapture(e.pointerId); e.preventDefault(); });
    const up = e => { if (e.pointerId !== pid) return; pid = null; touch[key] = false; el.classList.remove('held'); };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('contextmenu', e => e.preventDefault());
  }
  document.addEventListener('gesturestart', e => e.preventDefault());
  document.addEventListener('dblclick', e => e.preventDefault());

  // controller: standard mapping (A 0, B 1, X 2, Y 3, LB 4, RB 5, Back 8, Start 9, R3 11, d-pad 12-15);
  // some browsers give non-standard pads the right stick on axes 3 and 4 instead of 2 and 3
  const pad = { held: new Set(), flick: 0 };
  const curve = (v, dz) => (Math.abs(v) < dz ? 0 : Math.sign(v) * Math.pow((Math.abs(v) - dz) / (1 - dz), 1.5));
  window.addEventListener('gamepadconnected', () => toast('Controller ready: left stick moves, right stick looks, Start pauses.', 3));
  function readInput(dt) {
    let ix = (keys.has('right') ? 1 : 0) - (keys.has('left') ? 1 : 0);
    let iy = (keys.has('down') ? 1 : 0) - (keys.has('up') ? 1 : 0);
    let jump = keys.has('jump') || touch.jump, dash = keys.has('dash') || touch.dash;
    if (Math.hypot(touch.x, touch.y) > Math.hypot(ix, iy)) { ix = touch.x; iy = touch.y; }
    const gp = navigator.getGamepads ? Array.from(navigator.getGamepads()).find(g => g && g.connected) : null;
    if (gp) {
      const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0, mag = Math.hypot(ax, ay);
      if (mag > 0.15 && mag > Math.hypot(ix, iy)) { const s = Math.min(1, (mag - 0.15) / 0.85) / mag; ix = ax * s; iy = ay * s; }
      const b = i => !!(gp.buttons[i] && gp.buttons[i].pressed);
      const tap = i => { const now = b(i), was = pad.held.has(i); if (now) pad.held.add(i); else pad.held.delete(i); return now && !was; };
      const startTap = tap(9), aTap = tap(0);
      if (!started) { if ((startTap || aTap) && $('errorOverlay').hidden) { start(); pad.ignoreA = true; } }
      else if (startTap) openHelp();
      if (!b(0)) pad.ignoreA = false;   // the A press that resumed the game is not also a jump
      jump = jump || (b(0) && !pad.ignoreA); dash = dash || b(1) || b(2);
      if (tap(4)) rotateCam(-1);
      if (tap(5)) rotateCam(1);
      if (tap(3) || tap(8)) setMode(view.mode === 'iso' ? 'chase' : 'iso');
      if (tap(11)) resetCamera();
      if (b(12)) iy = -1; if (b(13)) iy = 1; if (b(14)) ix = -1; if (b(15)) ix = 1;
      const [ri, rj] = gp.mapping === 'standard' || gp.axes.length < 6 ? [2, 3] : [3, 4];
      const rx = curve(gp.axes[ri] || 0, 0.18), ry = curve(gp.axes[rj] || 0, 0.18);
      if (view.mode === 'chase') { orbit.yaw -= rx * 2.6 * dt; orbit.pitch += ry * 1.4 * dt; }
      else {   // isometric: flick the right stick to swing 90 degrees
        const f = Math.abs(rx) > 0.6 ? Math.sign(rx) : 0;
        if (f && f !== pad.flick) rotateCam(-f);
        pad.flick = f;
      }
    }
    const m = Math.hypot(ix, iy);
    if (m > 1) { ix /= m; iy /= m; }
    return { ix, iy, jump, dash };
  }
  // chase: relative to where the camera is now; iso: frozen while held so a 90 degree turn does not swerve you
  let basisYaw = view.yawTarget;
  const simInput = { mx: 0, mz: 0, jump: false, dash: false };
  function toWorld(inp) {
    if (view.mode === 'chase') basisYaw = currentYaw();
    else if (Math.hypot(inp.ix, inp.iy) < 0.05) basisYaw = view.yawTarget;
    const s = Math.sin(basisYaw), c = Math.cos(basisYaw);
    simInput.mx = started ? c * inp.ix + s * inp.iy : 0;
    simInput.mz = started ? -s * inp.ix + c * inp.iy : 0;
    simInput.jump = started && inp.jump; simInput.dash = started && inp.dash;
    return simInput;
  }

  // ---- HUD, help card, level loading ----
  const rows = isTouch
    ? [['Left thumb', 'Drag anywhere on the left to move'], ['Right thumb', 'Drag on the right to look around'], ['Jump', 'Jump; hold for height'], ['Dash', 'Hold to stop and rev a spin dash, let go to launch. Tap while running to roll.'], ['⟲ ⟳', 'Swing the camera 45 degrees'], ['ISO / 3D', 'Switch between the chase camera and the isometric view']]
    : [['WASD / arrows', 'Move'], ['Mouse drag', 'Look around'], ['Space or J', 'Jump; hold for height'], ['Shift or K', 'Hold to stop and rev a spin dash, let go to launch. Tap while running to roll.'], ['Q / E', 'Swing the camera 45 degrees'], ['Wheel', 'Camera distance'], ['V', 'Switch to the isometric view and back'], ['R', 'Restart'], ['M', 'Sound on or off'], ['Controller', 'Left stick moves, right stick looks, A jump, B or X dash, LB/RB swing, Y or Back switches view, right stick click recentres, Start pauses']];
  for (const [k, v] of rows) { const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd'); dd.textContent = v; $('keysList').append(dt, dd); }
  let started = false;
  function start() { Sfx.unlock(); started = true; $('helpOverlay').hidden = true; canvas.focus(); }
  function openHelp() { started = false; $('playBtn').textContent = 'Resume'; $('restartBtn').hidden = false; $('helpOverlay').hidden = false; }
  $('playBtn').addEventListener('click', start);
  $('helpBtn').addEventListener('click', openHelp);
  $('restartBtn').addEventListener('click', () => { restart(); start(); });
  $('camLeft').addEventListener('click', () => rotateCam(-1));
  $('camRight').addEventListener('click', () => rotateCam(1));
  $('camMode').addEventListener('click', () => setMode(view.mode === 'iso' ? 'chase' : 'iso'));
  let toastTimer = 0, flickyHudKey = -1;
  function toast(msg, secs) { const t = $('toast'); t.textContent = msg; t.hidden = false; toastTimer = secs; }

  function showLevelName() {
    $('levelName').textContent = customLoaded ? `Playing your level: ${L.name}` : `Playing the built-in level: ${L.name}`;
    $('builtInBtn').hidden = !customLoaded;
    $('playIntro').hidden = customLoaded;
  }
  function setLoadMsg(list, id = 'loadMsg') {
    const ul = $(id); ul.textContent = '';
    for (const m of list) { const li = document.createElement('li'); li.textContent = m; ul.appendChild(li); }
    ul.hidden = !list.length;
  }
  function useLevel(newL, custom) {
    L = newL; customLoaded = custom;
    world = Sim.createWorld(L);
    buildLevelObjects(); resetCamera(); restart();
    showLevelName();
  }
  $('levelFile').addEventListener('change', e => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result);
      try {
        const newL = Sim.importLevel(JSON.parse(text));
        useLevel(newL, true);
        const kept = store.set(LEVEL_KEY, text);
        setLoadMsg(kept ? [] : ['Loaded for this visit only: the browser would not store a file this size.']);
      } catch (err) { setLoadMsg(readError(err).slice(0, 6)); }
    };
    reader.onerror = () => setLoadMsg(['The file could not be read. Try choosing it again.']);
    reader.readAsText(file);
  });
  // ---- the player's own ROM: read on the device, never uploaded; kept in this browser's IndexedDB until forgotten ----
  let romBytes = null;
  const romStore = {
    open() {
      return new Promise((ok, fail) => {
        try {
          const rq = indexedDB.open('blastgrid', 1);
          rq.onupgradeneeded = () => rq.result.createObjectStore('rom');
          rq.onsuccess = () => ok(rq.result); rq.onerror = () => fail(rq.error);
        } catch (e) { fail(e); }
      });
    },
    async run(mode, fn) {
      const db = await this.open();
      return new Promise((ok, fail) => {
        const tx = db.transaction('rom', mode), rq = fn(tx.objectStore('rom'));
        tx.oncomplete = () => { db.close(); ok(rq.result); }; tx.onerror = () => { db.close(); fail(tx.error); };
      });
    },
    get() { return this.run('readonly', s => s.get('rom')).catch(() => null); },
    put(bytes) { return this.run('readwrite', s => s.put(bytes, 'rom')).then(() => true, () => false); },
    del() { return this.run('readwrite', s => s.delete('rom')).catch(() => null); },
  };
  function useRom(bytes) {
    romBytes = bytes;
    const sel = $('romLevel'); sel.textContent = '';
    for (const [id, name] of S3D.LEVELS) { const o = document.createElement('option'); o.value = id; o.textContent = name; sel.appendChild(o); }
    $('romPick').hidden = false; $('lookSel').value = artLook;
    try { setRom(bytes); } catch (e) { romArt = null; setLoadMsg(['The level layouts work, but the sprites could not be read from this ROM: ' + e.message + '.'], 'romMsg'); }
    buildLevelObjects();
  }
  $('lookSel').addEventListener('change', () => { artLook = $('lookSel').value === 'scribble' ? 'scribble' : 'rom'; store.set(LOOK_KEY, artLook); buildLevelObjects(); });
  $('romForget').addEventListener('click', () => {
    romStore.del(); romBytes = null; romArt = null; $('romPick').hidden = true;
    buildLevelObjects(); setLoadMsg(['Forgotten: this browser no longer keeps your ROM.'], 'romMsg');
  });
  romStore.get().then(v => { if (v && !romBytes) { const b = new Uint8Array(v); if (!S3D.check(b)) useRom(b); } });
  $('romFile').addEventListener('change', e => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      let bytes;
      try { bytes = await S3D.openRomFile(reader.result); } catch (err) { setLoadMsg([err.message], 'romMsg'); return; }
      const why = S3D.check(bytes);
      if (why) { setLoadMsg([why], 'romMsg'); return; } // keep any ROM already in use
      setLoadMsg([], 'romMsg'); useRom(bytes);
      romStore.put(bytes).then(kept => { if (!kept) setLoadMsg(['Using your ROM for this visit only: the browser would not keep a copy.'], 'romMsg'); });
    };
    reader.onerror = () => setLoadMsg(['The ROM file could not be read. Try choosing it again.'], 'romMsg');
    reader.readAsArrayBuffer(file);
  });
  $('romGo').addEventListener('click', () => {
    if (!romBytes) return;
    try {
      const raw = S3D.convert(romBytes, Number($('romLevel').value), Number($('romScale').value));
      useLevel(Sim.importLevel(raw), true);
      const kept = store.set(LEVEL_KEY, JSON.stringify(raw));
      setLoadMsg(kept ? [] : ['Loaded for this visit only: the browser would not store a level this size.'], 'romMsg');
      start();
    } catch (err) { setLoadMsg(['That level could not be converted: ' + err.message + '.'], 'romMsg'); }
  });
  $('builtInBtn').addEventListener('click', () => { store.del(LEVEL_KEY); useLevel(Sim.importLevel(JSON.parse(builtInRaw)), false); setLoadMsg([]); });
  showLevelName();

  let cleared = false, clearTimer = 0;
  // a white flash when a big ring is used, as in the original
  function flash() { const f = $('flash'); f.classList.remove('on'); void f.offsetWidth; f.classList.add('on'); }
  function clearCardOff() { $('clearCard').hidden = true; clearTimeout(clearTimer); clearTimer = 0; }
  // act clear: show the result, then move on to the next act in the original's order (ROM levels)
  function actClear() {
    const idx = L.rom ? S3D.LEVELS.findIndex(l => l[0] === L.rom.level) : -1, here = idx >= 0 ? S3D.LEVELS[idx][1] : L.name;
    const next = idx >= 0 && romBytes ? S3D.LEVELS[idx + 1] : null, secs = Math.floor(world.time);
    $('clearTitle').textContent = `${here} clear`;
    $('clearInfo').textContent = `Rings ${world.ringCount}   Time ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` + (next ? `\nNext: ${next[1]}` : '\nOpen ? to play again or choose another level.');
    $('clearCard').hidden = false;
    clearTimeout(clearTimer);
    clearTimer = setTimeout(() => {
      clearTimer = 0; $('clearCard').hidden = true;
      if (!next) return;
      try {
        const raw = S3D.convert(romBytes, next[0], L.rom.vscale);
        useLevel(Sim.importLevel(raw), true);
        store.set(LEVEL_KEY, JSON.stringify(raw));
        $('romLevel').value = String(next[0]);
        toast(next[1], 2.5);
      } catch (err) { toast('The next level could not be converted: ' + err.message + '.', 4); }
    }, 5000);
  }
  function restart() {
    Sim.resetLevel(world);
    for (let q = 0; q < world.rings.length; q++) ringSprites[q].visible = true;
    for (const s of enemySprites) s.visible = true;
    for (const s of monitorSprites) s.visible = true;
    for (const s of mineSprites) s.visible = true;
    clearCardOff();
    prev.x = world.p.x; prev.y = world.p.y; prev.z = world.p.z; cleared = false;
    $('ringCount').textContent = '0';
  }

  // Fade trees and bushes that stand between the camera and the player (or right in front of the lens).
  function fadeBlockers(dt) {
    const cx = cam.position.x, cz = cam.position.z, px = lastRp.x, pz = lastRp.z;
    const sx = px - cx, sz = pz - cz, len2 = sx * sx + sz * sz || 1;
    for (const s of tallDecor) {
      const dx = s.position.x - cx, dz = s.position.z - cz;
      const u = (dx * sx + dz * sz) / len2;
      let block = false;
      if (view.mode === 'chase') {
        const ex = dx - sx * Math.max(0, Math.min(1, u)), ez = dz - sz * Math.max(0, Math.min(1, u));
        block = (u > -0.1 && u < 0.97 && ex * ex + ez * ez < 1.4 * 1.4) || dx * dx + dz * dz < 2.2 * 2.2;
      } else {
        // isometric: fade whatever stands just in front of the player on screen
        const fx = s.position.x - px, fz = s.position.z - pz, toward = fx * Math.sin(view.yaw) + fz * Math.cos(view.yaw);
        block = toward > 0 && toward < 3.5 && Math.abs(fx * Math.cos(view.yaw) - fz * Math.sin(view.yaw)) < 1.2;
      }
      const target = block ? 0.22 : 1;
      s.userData.fade += (target - s.userData.fade) * Math.min(1, dt * 8);
      s.material.opacity = s.userData.fade;
      s.material.depthWrite = s.userData.fade > 0.95;
    }
  }

  // ---- loop: fixed 60 Hz sim, interpolated render ----
  const STEP = Sim.P.dt;
  const prev = { x: world.p.x, y: world.p.y, z: world.p.z };
  let acc = 0, last = performance.now(), frames = 0, shownRings = -1;
  const g2 = [0, 0], nrmV = new THREE.Vector3(), zAxis = new THREE.Vector3(0, 0, 1), rp = new THREE.Vector3();
  function frame(now) {
    const dt = Math.min(0.25, (now - last) / 1000); last = now;
    acc += dt;
    let steps = 0;
    const inp = toWorld(readInput(dt));
    while (acc >= STEP && steps < 5) {
      prev.x = world.p.x; prev.y = world.p.y; prev.z = world.p.z;
      Sim.step(world, inp);
      if (world.events.includes('respawn')) { prev.x = world.p.x; prev.y = world.p.y; prev.z = world.p.z; toast('Back to the start.', 1.4); }
      for (const ev of world.events) Sfx.play(ev);
      if (world.events.includes('section') || world.events.includes('goal')) {
        const used = goalSprites[world.events.includes('goal') ? world.goals.length - 1 : world.section - 1];
        if (used) { const s = used.clone(); if (!used.userData.rom) s.material = used.material.clone(), s.material.transparent = true; levelGroup.add(s); goalFx = { sprite: s, t0: now / 1000, rom: !!used.userData.rom }; }
        flash();
      }
      if (world.events.includes('goal')) actClear();
      if (world.events.includes('monitor')) toast(POWER_TEXT[world.power] || '', 2);
      if (world.events.includes('shieldLost')) toast('The shield took the hit.', 1.6);
      if (world.events.includes('needFlickies')) toast(`The ring needs ${L.flickies} Flickies. Free them from enemies and bring them here.`, 3);
      if (world.events.includes('section')) toast(world.holes.some(h => h.opens === world.section) ? 'Ring used. Step into the hole beneath it.' : 'Ring used. On to the next one.', 3);
      if (world.events.includes('warp')) { prev.x = world.p.x; prev.y = world.p.y; prev.z = world.p.z; }
      acc -= STEP; steps++;
    }
    if (steps === 5) acc = 0;
    const a = acc / STEP, p = world.p, t = now / 1000;
    rp.set(prev.x + (p.x - prev.x) * a, prev.y + (p.y - prev.y) * a, prev.z + (p.z - prev.z) * a);

    // pick the drawing: pose from the sim state, view and left/right from movement relative to the camera
    const sp = Math.hypot(p.vx, p.vz);
    const camYaw = currentYaw(), rx = Math.cos(camYaw), rz = -Math.sin(camYaw), fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
    let pose, phase;
    if (p.charge > 0) { pose = 'charge'; phase = Math.floor(t * 20) % 2; }
    else if (p.ball || p.rolling) { look3.ballCycle += dt * Math.max(sp, 6) * 1.4; pose = 'ball'; phase = Math.floor(look3.ballCycle) % 4; }
    else if (!p.grounded) { pose = p.sprung ? 'spring' : 'air'; phase = 0; }
    else if (sp > 0.6) { look3.runCycle += dt * (3 + sp * 1.1); pose = 'run'; phase = Math.floor(look3.runCycle) % 4; }
    else { pose = 'idle'; phase = Math.floor(t * 2) % 2; }
    if (sp > 0.6) {
      const sx = p.vx * rx + p.vz * rz, sf = p.vx * fx + p.vz * fz;
      if (Math.abs(sx) > 0.3) look3.facingLeft = sx < 0;
      look3.view = sf > sp * 0.35 ? 'back' : 'front';
      look3.idleFor = 0;
    } else if ((look3.idleFor += dt) > 1.2) look3.view = 'front';
    const ballLike = pose === 'ball' || pose === 'charge';
    let map;
    if (romOn()) {
      const [idx, flip] = romHeroPick(pose, sp, p.vx * rx + p.vz * rz, p.vx * fx + p.vz * fz, t, dt);
      map = romHeroTex(idx, flip);
      if (hero.scale.x !== ROM_SIZE) { hero.scale.set(ROM_SIZE, ROM_SIZE, 1); hero.center.set(0.5, HERO_FOOT); sil.scale.copy(hero.scale); sil.center.copy(hero.center); }
    } else {
      map = heroTexture(ballLike ? 'front' : look3.view, pose, phase, Math.floor(t * 8) % 3, look3.facingLeft);
      if (hero.scale.x !== 1.5) { hero.scale.set(1.5, 1.5, 1); hero.center.set(0.5, 0.04); sil.scale.copy(hero.scale); sil.center.copy(hero.center); }
    }
    if (heroMat.map !== map) { heroMat.map = map; silMat.map = map; }
    hero.position.copy(rp); sil.position.copy(rp);
    hero.visible = !(p.invuln > 0 && Math.floor(t * 16) % 2);
    shieldSprite.visible = !!p.shield;
    if (p.shield) { shieldSprite.material = shieldMats[p.shield] || shieldMats.shield; shieldSprite.position.set(rp.x, rp.y + 0.55, rp.z); }
    for (let k = 0; k < stars.length; k++) {
      stars[k].visible = p.inv > 0 && !(p.inv < 3 && Math.floor(t * 10) % 2);
      const a = t * 5 + k * Math.PI / 2;
      stars[k].position.set(rp.x + Math.cos(a) * 0.55, rp.y + 0.5 + Math.sin(t * 7 + k) * 0.3, rp.z + Math.sin(a) * 0.55);
    }

    // shadow on the floor under the player, tilted with the slope
    const f = Sim.floorAt(L, rp.x, rp.z);
    shadow.visible = Number.isFinite(f) && rp.y - f < 6;
    if (shadow.visible) {
      Sim.gradientAt(L, rp.x, rp.z, g2);
      nrmV.set(-g2[0], 1, -g2[1]).normalize();
      shadow.quaternion.setFromUnitVectors(zAxis, nrmV);
      shadow.position.set(rp.x, f + 0.02, rp.z);
      shadow.scale.setScalar(Math.max(0.45, 1 - (rp.y - f) * 0.18));
    }

    // rings turn like flat coins; collected rings pop and vanish
    const boil = Math.floor(t * 8) % 3, rom = romOn(), ringFrame = Math.floor(t * 15) % 16;
    for (let q = 0; q < ringSprites.length; q++) {
      const s = ringSprites[q], g = world.rings[q];
      if (!s.visible) continue;
      s.material = rom ? romArt.rings[ringFrame] : ringMats[(boil + q) % 3];
      if (g.got) {
        const k = (world.time - g.gotAt) / 0.25;
        if (k >= 1) s.visible = false; else { s.scale.set(ringSize * (1 + k), ringSize * (1 + k), 1); s.position.y = g.y + k * 0.6; }
      } else {
        // the ROM rings spin in their own frames; the scribbled ones turn like flat coins
        s.scale.set(rom ? ringSize : 0.06 + 0.56 * Math.abs(Math.cos(t * 2.6 + q * 0.5)), ringSize, 1); s.position.y = g.y;
      }
    }
    // enemies roll along their loop; a defeated one pops and vanishes
    for (let q = 0; q < enemySprites.length; q++) {
      const s = enemySprites[q], en = world.enemies[q];
      if (!en.alive) {
        const k = (world.time - en.diedAt) / 0.3;
        if (k >= 1) { s.visible = false; continue; }
        const z = s.userData.size;
        s.scale.set(z * (1 + k), z * (1 - k), 1); continue;
      }
      s.visible = true; s.scale.set(s.userData.size, s.userData.size, 1);
      const dx = en.x - s.position.x, dz = en.z - s.position.z, sx = dx * rx + dz * rz;
      s.position.set(en.x, en.y, en.z);
      if (Math.abs(sx) > 1e-4) s.userData.left = sx < 0;
      s.material = s.userData.rom ? s.userData.rom[s.userData.left ? 0 : 1] : enemyMat(Math.floor(t * 6) % 2, (Math.floor(t * 8) + q) % 3, !!s.userData.left);
    }
    for (let q = 0; q < monitorSprites.length; q++) {
      const s = monitorSprites[q], broken = world.monitors[q].broken;
      if (s.userData.rom) s.visible = !broken; else s.material = monitorMats[broken ? 1 : 0];
    }
    for (let q = 0; q < mineSprites.length; q++) {
      const s = mineSprites[q], mi = world.mines[q];
      if (mi.alive) { s.visible = true; s.scale.set(s.userData.size, s.userData.size, 1); continue; }
      const k = (world.time - mi.diedAt) / 0.3;
      s.visible = k < 1; if (k < 1) s.scale.set(s.userData.size * (1 + 2 * k), s.userData.size * (1 + 2 * k), 1);
    }
    for (let q = 0; q < turretSprites.length; q++) {
      const s = turretSprites[q], k = world.time - world.turrets[q].firedAt;
      s.scale.set(s.userData.size, s.userData.size * (k < 0.15 ? 0.9 : 1), 1);
    }
    for (let q = 0; q < shotSprites.length; q++) {
      const sh = world.shots[q]; shotSprites[q].visible = !!sh;
      if (sh) shotSprites[q].position.set(sh.x, sh.y, sh.z);
    }
    // Flickies: hop about, face the way they go; the HUD shows how many the ring has and how many follow
    for (let q = 0; q < flickySprites.length; q++) {
      const s = flickySprites[q], f = world.flickies.filter(ff => ff.state !== 'gone')[q];
      s.visible = !!f;
      if (!f) continue;
      const dx = f.x - s.position.x, dz = f.z - s.position.z, sx = dx * rx + dz * rz;
      if (Math.abs(sx) > 1e-3) s.userData.left = sx < 0;
      s.position.set(f.x, f.y, f.z);
      if (rom) { s.material = romFlickyMat(Math.floor(t * 12 + q * 3) % 16, !s.userData.left, f.kind); s.scale.set(64 * PX, 64 * PX, 1); s.center.set(0.5, 1 - 52 / 64); }
      else { s.material = flickyMat(f.kind, Math.floor(t * 8 + q) % 2, !!s.userData.left); s.scale.set(0.55, 0.55, 1); s.center.set(0.5, 0.08); }
    }
    if (L.flickies) {
      const following = world.flickies.filter(f => f.state === 'follow').length, key = world.delivered * 100 + following;
      if (flickyHudKey !== key) {
        flickyHudKey = key;
        const dots = $('flickyDots'); dots.textContent = '';
        for (let i = 0; i < L.flickies; i++) {
          const d = document.createElement('span');
          d.className = i < world.delivered ? 'got' : i < world.delivered + following ? 'with' : '';
          dots.appendChild(d);
        }
      }
    }
    // only the big ring of the current section is out
    for (let q = 0; q < goalSprites.length; q++) {
      if (goalSprites[q].userData.rom) goalSprites[q].scale.x = ROM_SIZE * (0.35 + 0.65 * Math.abs(Math.cos(t * 1.6)));
      else goalSprites[q].material = goalMats[Math.floor(t * 3) % 2];
      goalSprites[q].visible = q === world.section && !world.cleared;
    }
    // a used big ring shrinks away through its own frames (ROM look) or grows and fades (scribbled)
    if (goalFx) {
      const k = (t - goalFx.t0) / 0.6, s = goalFx.sprite;
      if (k >= 1) { s.visible = false; goalFx = null; }
      else if (goalFx.rom) { s.visible = true; s.material = romRingFrameMat(Math.min(8, Math.floor(k * 9))); }
      else { s.visible = true; s.scale.set(1.1 * (1 + k), 2.2 * (1 + k), 1); s.material.opacity = 1 - k; }
    }
    for (let q = 0; q < looseSprites.length; q++) {
      const s = looseSprites[q], r = world.loose[q];
      s.visible = !!r && !(r.age > Sim.P.scatterLife - 1 && Math.floor(t * 12) % 2);
      if (!r) continue;
      s.position.set(r.x, r.y, r.z);
      if (rom) { s.material = romArt.rings[(ringFrame * 2 + q) % 16]; s.scale.set(ringSize * 0.85, ringSize * 0.85, 1); }
      else { s.material = ringMats[(boil + q) % 3]; s.scale.set(0.06 + 0.44 * Math.abs(Math.cos(t * 6 + q)), 0.5, 1); }
    }
    for (let q = 0; q < springSprites.length; q++) {
      const s = springSprites[q], fired = world.time - world.springs[q].firedAt < 0.25;
      if (s.userData.drum) { s.userData.drum.scale.y = fired ? 1.6 : 1; s.userData.drum.position.y = fired ? 0.2 : 0.15; }
      else if (s.userData.rom) s.scale.set(s.userData.size, s.userData.size * (fired ? 1.25 : 1), 1);
      else s.material = springMats[fired ? 1 : 0];
    }
    if (waterMesh) waterTex.offset.set(t * 0.08, t * 0.03);

    if (shownRings !== world.ringCount) { shownRings = world.ringCount; $('ringCount').textContent = String(world.ringCount); }
    if (!cleared && world.rings.length && world.ringCount === world.rings.length) { cleared = true; toast(`All ${world.rings.length} rings. Level clear. Open ? to restart.`, 6); }
    if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) $('toast').hidden = true; }

    if (view.mode === 'iso') updateIso(rp, dt); else updateChase(rp, dt, p);
    lastRp.copy(rp);
    fadeBlockers(dt);
    updateFoliage();
    dome.position.copy(cam.position);
    renderer.render(scene, cam);
    frames++;
    requestAnimationFrame(frame);
  }
  window.__game = { Sim, view, setMode, start, get world() { return world; }, get level() { return L; }, get renderer() { return renderer; }, get camera() { return cam; }, get frames() { return frames; } };
  setMode(view.mode);
  requestAnimationFrame(frame);
})();
