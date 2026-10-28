(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const canvas = $('view');
  const isTouch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  const LEVEL_KEY = 'blastgrid.level', CAM_KEY = 'blastgrid.cam', LOOK_KEY = 'blastgrid.look', MUTE_KEY = 'blastgrid.mute', SCREEN_KEY = 'blastgrid.screen';
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
  const headMats = [0, 1, 2].map(b => spriteMat(Art.head(b)));
  const palMats = new Map(), palMat = (kind, phase, boil) => { const k = kind * 100 + phase * 10 + boil; if (!palMats.has(k)) palMats.set(k, spriteMat(Art.pal(kind, phase, boil))); return palMats.get(k); };
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
  // the original's own animation of Sonic (S3D.heroAnimator: its scripts and views, read from the ROM), played one
  // step per sim frame on converted levels from the sim's pick (`p.anim`)
  let heroAnim = null, heroAnimD = null;
  const origLook = () => romOn() && !!world && !!world.L.rom && !!world.L.phys.orig;
  function stepHeroAnim(p) {
    if (!origLook()) return;
    if (!heroAnim || heroAnimD !== romArt.d) { heroAnim = S3D.heroAnimator(romArt.d); heroAnimD = romArt.d; }
    heroAnim.step(p.pre ? p.pre.anim : p.anim || 0, p.fwdWord || 0, () => Math.floor(Math.random() * 65536));   // (a hit shows from the next frame)
  }
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
  const FLICKY_YAW = Math.PI / 2;             // the Jam Flicky faces its -x, as Jam Sonic does
  // Sonic Jam disc: the 3D hero and the Sonic World objects (declared early: level building asks for them)
  const HERO_KEY = 'blastgrid.hero';
  let hero3d = null, jamProps = null, heroMode = store.get(HERO_KEY) === 'sprite' ? 'sprite' : '3d';
  const jamOn = () => !!jamProps && heroMode === '3d';
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
  // the original draws a freed Flicky in a palette line chosen by its colour byte (routine 0x192C2: 1 line 3, 2 line 1,
  // 3 and 4 line 2; GG1's CRAM watched: lines 1..3 are the header's palettes), so its colour is the level's own (GG1:
  // Hunters' byte 4 blue, 004's byte 1 purple). `look.line` is that line on ROM levels; `look.jam` the nearest of our
  // four colours (blue, pink, green, red: the Jam models and the scribbled birds), from the bird's body in that line
  const FLICKY_LINE = [3, 3, 1, 2, 2], flickyLooks = new Map();
  function flickyLook(f) {
    const pals = L.rom && L.palettes, ok = pals && romArt && romArt.d && f.type >= 1 && f.type <= 4;
    if (!ok) return { line: null, jam: f.kind % 4 };
    const line = FLICKY_LINE[f.type], key = pals.join(',') + '/' + line;
    if (!flickyLooks.has(key)) {
      const px = S3D.objImage(romArt.d, S3D.FLICKY_ART, 0, S3D.paletteRGB(romArt.d, pals[line]), 64, 32, 48), n = new Map();
      for (let i = 0; i < px.length; i += 4) {
        if (!px[i + 3]) continue;
        const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
        if (mx - mn < 0.25 || l < 0.12 || l > 0.88) continue;   // body colours only, not black, white or grey
        let h = mx === r ? ((g - b) / (mx - mn)) % 6 : mx === g ? (b - r) / (mx - mn) + 2 : (r - g) / (mx - mn) + 4;
        h = (h * 60 + 360) % 360;
        const k = h >= 190 && h < 265 ? 0 : h >= 265 && h < 345 ? 1 : h >= 70 && h < 190 ? 2 : 3;
        if (!(h >= 25 && h < 70)) n.set(k, (n.get(k) || 0) + 1);   // (yellow and orange are the beak and belly)
      }
      let jam = 0, best = -1; n.forEach((c, k) => { if (c > best) { best = c; jam = k; } });
      flickyLooks.set(key, { line, jam });
    }
    return flickyLooks.get(key);
  }
  function romFlickyMat(frame, flip, kind = 0, line = null) {
    const key = 'f' + frame + (flip ? 'L' : 'R') + (line === null ? kind : 'p' + line + L.palettes.join(','));
    if (!romArt.objs.has(key)) {
      let px = S3D.objImage(romArt.d, S3D.FLICKY_ART, frame, line === null ? romArt.pal : S3D.paletteRGB(romArt.d, L.palettes[line]), 64, 32, 48, flip);
      if (line === null && FLICKY_HUES[kind % 4] !== null) px = tintBlue(px, FLICKY_HUES[kind % 4]);
      romArt.objs.set(key, new THREE.SpriteMaterial({ map: pixTex(pixCanvas(px, 64)), alphaTest: 0.5 }));
    }
    return romArt.objs.get(key);
  }
  // a boss's own frames (object art by type) in the level's sprite palette (line 3)
  // an object type's own frames from the ROM's art table (enemies without a recipe): materials on the usual 96 px canvas
  // with the object anchor, frames until one does not decode (at most 16)
  function romTypeFrames(type, line = 3) {
    const key = 'frames' + type + '/' + line + (L.palettes || []).join(',');
    if (!romArt.objs.has(key)) {
      const out = [];
      for (let f = 0; f < 16; f++) { try { out.push(romBossMat(type, f, ROM_CANVAS, 80, line)); } catch (e) { break; } }
      romArt.objs.set(key, out);
    }
    return romArt.objs.get(key);
  }
  function romBossMat(type, frame, size, oy, line = 3) {
    const key = 'boss' + type + '/' + frame + '/' + line + (L.palettes || []).join(',');
    if (!romArt.objs.has(key)) {
      const pal = S3D.paletteRGB(romArt.d, (L.palettes || romArt.fallbackPals)[line]);
      romArt.objs.set(key, new THREE.SpriteMaterial({ map: pixTex(pixCanvas(S3D.objImage(romArt.d, S3D.typeArt(romArt.d, type), frame, pal, size, size / 2, oy), size)), alphaTest: 0.5 }));
    }
    return romArt.objs.get(key);
  }
  // Panic Puppet's levers (194): pieces drawn about 55 pixels under the record and 21 to its left, so the frame is drawn
  // shifted to stand on the usual anchor (the place is the switch cells' middle)
  function romLeverMat(frame, line) {
    const key = 'lever' + frame + '/' + line + (L.palettes || []).join(',');
    if (!romArt.objs.has(key)) {
      const pal = S3D.paletteRGB(romArt.d, (L.palettes || romArt.fallbackPals)[line]);
      romArt.objs.set(key, new THREE.SpriteMaterial({ map: pixTex(pixCanvas(S3D.objImage(romArt.d, S3D.typeArt(romArt.d, 0x194), frame, pal, ROM_CANVAS, ROM_CANVAS / 2 + 21, 8), ROM_CANVAS)), alphaTest: 0.5 }));
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
  // monitors in the ROM look: a box in the ROM sprite's own grey, the ROM icon on a dark screen on each side, since the
  // flat sprite is a picture of a box drawn for the original's fixed view
  function romMonitorBox(kind) {
    const pals = L.palettes || romArt.fallbackPals, key = 'monbox' + kind + pals.join(',');
    if (!romArt.objs.has(key)) {
      const px = S3D.monitorImage(romArt.d, kind, pals);
      if (!px) { romArt.objs.set(key, null); return null; }
      const n = new Map();   // the sprite's commonest colours: the body's light and shade
      for (let i = 0; i < px.length; i += 4) if (px[i + 3]) { const c = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2]; n.set(c, (n.get(c) || 0) + 1); }
      const [body] = [...n].sort((a, b) => b[1] - a[1])[0];
      const hex = c => '#' + c.toString(16).padStart(6, '0');
      const c = document.createElement('canvas'); c.width = c.height = 32;
      const g = c.getContext('2d'); g.fillStyle = hex(body); g.fillRect(0, 0, 32, 32);
      g.fillStyle = '#101018'; g.fillRect(5, 4, 22, 21);
      const icon = document.createElement('canvas'); icon.width = icon.height = 16;
      icon.getContext('2d').putImageData(new ImageData(S3D.monitorIcon(romArt.d, kind, pals), 16, 16), 0, 0);
      g.drawImage(icon, 8, 6);
      const side = new THREE.MeshLambertMaterial({ map: pixTex(c) }), plain = new THREE.MeshLambertMaterial({ color: body });
      romArt.objs.set(key, [side, side, plain, plain, side, side]);
    }
    const mats = romArt.objs.get(key);
    if (!mats) return null;
    if (!romArt.objs.has('monboxgeo')) romArt.objs.set('monboxgeo', new THREE.BoxGeometry(0.56, 0.56, 0.56));
    const g = new THREE.Group(), m = new THREE.Mesh(romArt.objs.get('monboxgeo'), mats);
    m.position.y = 0.28; m.userData.shared = true; g.add(m);   // shared geometry and materials: kept when the level is rebuilt
    return g;
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
  const balloonMat = crudeMat(64, 64, g => {   // a balloon of our own: round, a shine, a knot and a bit of string
    g.strokeStyle = '#1c1830'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(32, 50); g.quadraticCurveTo(28, 56, 33, 63); g.stroke();
    g.fillStyle = '#2f6fe0'; g.beginPath(); g.ellipse(32, 26, 18, 21, 0, 0, 7); g.fill(); g.stroke();
    g.fillStyle = '#2f6fe0'; g.beginPath(); g.moveTo(28, 49); g.lineTo(36, 49); g.lineTo(32, 44); g.fill(); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.75)'; g.beginPath(); g.ellipse(25, 18, 5, 7, -0.5, 0, 7); g.fill();
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
  const shieldMats = Object.fromEntries([['shield', '120,180,255'], ['gold', '255,205,60'], ['fire', '255,110,40']].map(([k, rgb]) => {
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
      cannonIn: () => tone('square', 300, 200, 0.2, 0.12),
      cannon: () => { noise(0.4, 0.8, 600); tone('square', 160, 60, 0.5, 0.3); },
      crack: () => { noise(0.5, 0.9, 1400); noise(0.3, 0.5, 300); },
      burst: () => { noise(0.3, 0.6, 2000); }, spark: () => { noise(0.08, 0.25, 3000); },
      whirl: () => tone('sawtooth', 300, 1100, 0.12, 0.12),
      padIn: () => tone('triangle', 500, 120, 0.9, 0.2),
      flame: () => noise(0.25, 0.35, 900),
      ddDrop: () => tone('square', 400, 200, 0.2, 0.15),
      serpent: () => { noise(0.6, 0.8, 600); tone('sawtooth', 90, 220, 0.6, 0.3); },
      snowman: () => tone('triangle', 300, 900, 0.25, 0.2),
      snowPuff: () => noise(0.3, 0.25, 7000),
      bossHit: () => { noise(0.3, 0.8, 2000); tone('square', 300, 80, 0.3, 0.3); },
      bossBump: () => tone('square', 200, 400, 0.12, 0.2),
      bossDrop: () => tone('sawtooth', 400, 150, 0.4, 0.15),
      bossHop: () => tone('triangle', 120, 60, 0.12, 0.3),
      bossGrab: () => tone('square', 150, 600, 0.25, 0.15),
      bossDown: () => { noise(1.2, 0.9, 500); tone('sine', 90, 30, 1.2, 0.6); },
      bossSlam: () => { noise(0.5, 0.9, 300); tone('sine', 70, 35, 0.4, 0.5); },
      ffDoor: () => tone('sawtooth', 120, 300, 0.4, 0.15),
      ffBeep: () => tone('square', 1760, 1760, 0.06, 0.2),
      timeUp: () => tone('square', 880, 220, 0.8, 0.25),
      ffAway: () => tone('sawtooth', 200, 900, 1.2, 0.15),
      ffHum: () => tone('sawtooth', 70, 90, 0.8, 0.12),
      ffReady: () => tone('square', 400, 800, 0.2, 0.15),
      laser: () => tone('square', 2400, 600, 0.12, 0.15),
      ffRise: () => tone('triangle', 120, 300, 0.5, 0.2),
      ffSink: () => tone('triangle', 300, 120, 0.5, 0.2),
      ffLetGo: () => { noise(0.2, 0.5, 1500); tone('square', 300, 150, 0.2, 0.15); },
      ffAim: () => tone('square', 900, 900, 0.1, 0.12),
      ffSlam: () => { noise(0.5, 0.9, 300); tone('sine', 70, 35, 0.4, 0.5); },
      ffTarget: () => tone('square', 1200, 1200, 0.15, 0.15),
      bumper: () => { tone('square', 500, 900, 0.12, 0.2); tone('square', 750, 1300, 0.12, 0.12); },
      balloon: () => { noise(0.15, 0.9, 3000); tone('sine', 300, 700, 0.15, 0.2); },
      spikesUp: () => tone('sawtooth', 180, 420, 0.25, 0.15),
      iceBreak: () => { noise(0.35, 0.8, 5000); tone('triangle', 1800, 600, 0.25, 0.2); },
      rockBreak: () => { noise(0.4, 0.9, 900); tone('square', 160, 70, 0.25, 0.25); },
      spout: () => noise(0.18, 0.3, 700),
      lava: () => { noise(0.3, 0.7, 1200); tone('sawtooth', 300, 120, 0.3, 0.2); },
      ventIn: () => tone('triangle', 600, 150, 0.45, 0.2),
      ventOut: () => { noise(0.4, 0.8, 1500); tone('square', 200, 900, 0.3, 0.25); },
      freeze: () => { noise(0.3, 0.5, 6000); tone('sine', 1400, 2200, 0.3, 0.15); },
      frozenHop: () => tone('triangle', 900, 700, 0.08, 0.12),
      thaw: () => { noise(0.4, 0.8, 5000); tone('triangle', 2000, 500, 0.3, 0.2); },
      spear: () => tone('square', 900, 400, 0.1, 0.1),
      bossCap: () => { noise(0.3, 0.6, 600); tone('square', 120, 90, 0.2, 0.2); },
      padOut: () => { tone('triangle', 180, 1400, 0.32, 0.4); noise(0.2, 0.3, 2000); },
      boost: () => { noise(0.35, 0.6, 2500); tone('square', 700, 120, 0.4, 0.25); },
      enemy: () => { noise(0.22, 0.7, 1400); tone('square', 520, 90, 0.2, 0.3); },
      boom: () => { noise(0.5, 0.9, 700); tone('sine', 120, 40, 0.5, 0.6); },
      blast: () => { noise(0.5, 0.9, 700); tone('sine', 120, 40, 0.5, 0.6); },
      shut: () => { noise(0.3, 0.8, 400); tone('sine', 90, 40, 0.3, 0.5); },
      sprinkle: () => tone('square', 600, 300, 0.08, 0.12),
      shot: () => tone('square', 950, 260, 0.12, 0.15),
      monitor: () => { noise(0.15, 0.6, 2000); arp([784, 988, 1175], 0.07, 'triangle', 0.35); },
      hurt: () => { tone('square', 700, 180, 0.35, 0.3); arp([1568, 1397, 1175, 988], 0.05, 'square', 0.12); },
      shieldLost: () => { tone('sine', 600, 150, 0.3, 0.4); noise(0.2, 0.3, 4000); },
      dying: () => { tone('square', 700, 90, 0.6, 0.35); },
      goldDash: () => { noise(0.2, 0.5, 4000); tone('sawtooth', 1200, 300, 0.2, 0.2); },
      warp: () => tone('sine', 1400, 200, 0.5, 0.35),
      section: () => arp([523, 659, 784, 1047, 1319, 1568], 0.06, 'triangle', 0.35),
      goal: () => arp([523, 659, 784, 1047, 784, 1047, 1319, 1568], 0.11, 'square', 0.22),
      respawn: () => arp([392, 330, 262, 196], 0.12, 'triangle', 0.35),
      needFlickies: () => tone('square', 300, 220, 0.25, 0.2),
      flicky: () => tone('sine', 1800, 2600, 0.12, 0.25),
      tick: () => tone('square', 2200, 2200, 0.03, 0.12),
      skid: () => noise(0.25, 0.35, 900),
      friend: () => arp([659, 784, 988], 0.06, 'triangle', 0.3),
      head: () => tone('square', 880, 1320, 0.1, 0.2),
      sledEnd: () => noise(0.3, 0.7, 1200),
      continue: () => arp([523, 659, 784, 1047, 1319], 0.08, 'square', 0.25),
      gate: () => arp([784, 988, 1175, 1568], 0.06, 'triangle', 0.3),
      emerald: () => arp([523, 784, 1047, 1319, 1568, 2093], 0.09, 'triangle', 0.35),
      emeraldNo: () => arp([523, 784, 1047, 1319], 0.09, 'triangle', 0.3),
      bonusRise: () => tone('sine', 400, 1600, 0.8, 0.3),
      bonusFail: () => arp([392, 330, 262, 196], 0.12, 'square', 0.25),
    };
    function play(name) {
      if (muted) return;
      if (MdSound.on && MdSound.sfx(name)) return;
      if (!SOUNDS[name] || !ready()) return;
      const now = ctx.currentTime;
      if (now - (lastPlay[name] || -1) < 0.05) return;   // several in one frame (rings in a line) sound once
      lastPlay[name] = now; SOUNDS[name]();
    }
    for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, unlock, { passive: true });
    return { play, unlock, toggle() { muted = !muted; store.set(MUTE_KEY, muted ? '1' : '0'); MdSound.pause(muted); return muted; }, get muted() { return muted; } };
  })();
  // ---- Mega Drive sound from the player's ROM: the Z80, YM2612 and PSG emulated (md_sound.wasm, built from sound/),
  // running the game's own sound program in an AudioWorklet; the page plays the 68000's part by writing requests ----
  const MdSound = (() => {
    const WORKLET = `
      class MdSound extends AudioWorkletProcessor {
        constructor() {
          super(); this.ready = false; this.q = []; this.t = 0; this.frac = 0; this.pl = 0; this.pr = 0; this.gain = 1 / 32768;
          this.port.onmessage = e => this.msg(e.data);
        }
        async msg(d) {
          if (d.init) {
            try {
              const { instance } = await WebAssembly.instantiate(d.wasm, {});   // bytes: a compiled Module may not cross
              this.m = instance.exports; this.boot(d); this.step = 53267 / sampleRate; this.ready = true; this.port.postMessage({ ready: true });
            } catch (e) { this.port.postMessage({ error: String(e) }); }
            return;
          }
          if (d.req !== undefined) { if (this.q.length < 6) this.q.push(d.req); }
          if (d.reboot && this.m) this.boot(this.last);
          if (d.volume !== undefined) this.gain = d.volume / 32768;
        }
        boot(d) {
          const m = this.m, mem = new Uint8Array(m.memory.buffer);
          m.md_reset(); mem.set(new Uint8Array(d.rom), m.md_rom()); m.md_set_rom_size(d.rom.byteLength);
          this.z = m.md_zram();
          for (const [src, dst, n] of d.driver) mem.set(new Uint8Array(d.rom, src, n), this.z + dst);
          this.mailbox = d.mailbox; m.md_start(); this.last = d;
          this.t = -0.25;   // let the sound program set itself up before the first request
        }
        process(inputs, outputs) {
          const L = outputs[0][0], R = outputs[0][1] || L, n = L.length;
          if (!this.ready) return true;
          const m = this.m, mem = new Uint8Array(m.memory.buffer);
          this.t += n / sampleRate;
          if (this.t >= 1 / 60) { this.t -= 1 / 60; if (this.q.length && mem[this.z + this.mailbox] === 0) mem[this.z + this.mailbox] = this.q.shift(); }
          const need = Math.floor(this.frac + n * this.step) + 1, got = m.md_render(need);
          const buf = new Int16Array(m.memory.buffer, m.md_out(), got * 2);
          const at = k => k === 0 ? [this.pl, this.pr] : [buf[(k - 1) * 2], buf[(k - 1) * 2 + 1]];
          for (let i = 0; i < n; i++) {
            const p = this.frac + i * this.step, k = Math.floor(p), f = p - k, a = at(Math.min(k, got)), b = at(Math.min(k + 1, got));
            L[i] = (a[0] + (b[0] - a[0]) * f) * this.gain; R[i] = (a[1] + (b[1] - a[1]) * f) * this.gain;
          }
          // report the output level about once a second (for the page's checks)
          this.acc = (this.acc || 0) + n; this.sq = (this.sq || 0) + L.reduce((a, v) => a + v * v, 0);
          if (this.acc >= sampleRate) { this.port.postMessage({ rms: Math.sqrt(this.sq / this.acc) }); this.acc = 0; this.sq = 0; }
          const used = Math.min(got, Math.floor(this.frac + n * this.step));
          this.frac = this.frac + n * this.step - used; [this.pl, this.pr] = at(used);
          return true;
        }
      }
      registerProcessor('md-sound', MdSound);`;
    let ctx = null, node = null, starting = null, romUsed = null, musicNow = 0, level = 0, ready = false;
    const B64 = (document.getElementById('mdsound').textContent || '').trim();
    async function start(rom) {
      if (!B64 || !window.AudioWorkletNode) return false;
      if (node && romUsed === rom) return true;
      if (starting) return starting;
      starting = (async () => {
        try {
          ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
          if (!ctx.audioWorklet) return false;   // only on secure pages (https, localhost, files)
          if (!node) {
            const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
            await ctx.audioWorklet.addModule(url); URL.revokeObjectURL(url);
            node = new AudioWorkletNode(ctx, 'md-sound', { numberOfInputs: 0, outputChannelCount: [2] });
            node.connect(ctx.destination);
            node.port.onmessage = e => { if (e.data.rms !== undefined) level = e.data.rms; if (e.data.error) console.warn('Mega Drive sound:', e.data.error); if (e.data.ready) ready = true; };
          }
          const wasm = Uint8Array.from(atob(B64), c => c.charCodeAt(0)).buffer, copy = rom.slice().buffer;
          node.port.postMessage({ init: true, wasm, rom: copy, driver: S3D.SOUND.driver, mailbox: S3D.SOUND.mailbox }, [wasm, copy]);
          romUsed = rom; musicNow = 0;
          return true;
        } catch (e) { console.warn('Mega Drive sound could not start:', e); node = null; return false; } finally { starting = null; }
      })();
      return starting;
    }
    const send = id => { if (node && id) node.port.postMessage({ req: id }); };
    return {
      start, get level() { return level; }, get music() { return musicNow; }, get state() { return ctx ? ctx.state + (ready ? '/ready' : '') : 'none'; }, get on() { return !!node && romUsed === romBytes && !!romBytes; },
      sfx(name) { const ids = S3D.SOUND.sfx[name]; if (!ids) return false; ids.forEach(send); return true; },
      power(kind) { send(S3D.SOUND.power[kind]); },
      playMusic(id) { if (id && id !== musicNow) { musicNow = id; send(id); } },

      pause(p) { if (ctx) (p ? ctx.suspend() : ctx.resume()).catch(() => {}); },
      volume(v) { if (node) node.port.postMessage({ volume: v }); },
    };
  })();
  // the level's music: its own for converted levels, Green Grove's for the built-in level
  function levelMusic() {
    if (!MdSound.on || Sfx.muted) return;
    MdSound.playMusic(S3D.SOUND.musicFor(romBytes, L.rom ? L.rom.level : 1));
  }

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
  let foliage = null, jamPalms = [], levelAnim = null;
  // ---- the ROM's animated water, waterfalls and lava: slots of the atlas drawn again as the frames change, copied
  // to the graphics card one 32 x 32 slot at a time; with a Sonic Jam disc, its falling-water streaks scroll down over
  // the animated texels of walls (waterfalls) ----
  const slotTex = new THREE.DataTexture(new Uint8Array(32 * 32 * 4), 32, 32, THREE.RGBAFormat), slotAt = new THREE.Vector2();
  function putSlot(a, i, px) {
    if (i >= a.count || !renderer.properties.get(a.tex).__webglTexture) return;
    slotTex.image.data.set(px);
    slotAt.set((i % a.cols) * 32, a.size[1] - Math.floor(i / a.cols) * 32 - 32);   // the atlas canvas is uploaded flipped
    renderer.copyTextureToTexture(slotAt, slotTex, a.tex);
  }
  const jamFall = new Uint8ClampedArray(32 * 32 * 4);
  function updateLevelAnim(t) {
    const A = levelAnim, a = A && A.a;
    if (!a || !a.tex || !a.baker.animSlots.length) return;
    const changed = a.baker.animStep(Math.floor(t * 60));
    const fall = jamOn() && jamProps.waterfall;
    if (!fall) { for (const s of changed) putSlot(a, s.i, a.baker.slotPixels(s.i)); return; }
    // (with Jam's waterfall every animated wall slot is redrawn as the streaks move: keep each slot's own pixels, which
    // only change when its tiles' frame does, and redraw only when the streaks have moved a texel)
    const cache = a.slotCache || (a.slotCache = new Map()), off = Math.floor(t * 48);
    for (const s of changed) if (!s.wall) cache.delete(s.i);   // (a wall slot's animated texels are all under the streaks)
    const moved = a.fallOff !== off; a.fallOff = off;
    const now = new Set(changed.map(s => s.i));
    for (const s of a.baker.animSlots) {
      if (!moved && !now.has(s.i)) continue;
      let px = cache.get(s.i);
      if (!px) { px = a.baker.slotPixels(s.i).slice(); cache.set(s.i, px); }
      if (s.wall) {
        // the streaks move down 48 texels a second; bands stack, so a band's texels continue the one above
        const W = fall.w, H = fall.h, base = s.band * 32;
        jamFall.set(px);
        for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
          if (!s.mask[y * 32 + x]) continue;
          const v = ((y + base - off) % H + H) % H, o = (v * W + x % W) * 4, d = (y * 32 + x) * 4, fp = fall.px;
          jamFall[d] = fp[o]; jamFall[d + 1] = fp[o + 1]; jamFall[d + 2] = fp[o + 2];
        }
        px = jamFall;
      }
      putSlot(a, s.i, px);
    }
  }
  const PXH = 1 / (32 * Math.SQRT2);           // metres per picture pixel across (the picture runs along x - z)
  function buildFoliage(art) {
    // with 3D palms, pieces show what is left once their palms are cut out (`bare`)
    const cut = jamOn() && art && art.baker.palms && art.baker.palms.length > 0;
    const list = art && art.baker.foliage && art.baker.foliage.filter(f => !(cut && f.bare && f.bareCount < 30)).map(f => (cut && f.bare ? { ...f, img: f.bare } : f));
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
  const _right = new THREE.Vector3(), _flkCam = new THREE.Vector3();
  function updateFoliage() {
    const cx0 = cam.position.x, cz0 = cam.position.z, px0 = lastRp.x - cx0, pz0 = lastRp.z - cz0, l0 = px0 * px0 + pz0 * pz0 || 1;
    for (const pm of jamPalms) {
      pm.trunk.rotation.y = Math.atan2(cx0 - pm.x, cz0 - pm.z) - pm.g.rotation.y;
      let hide = false;
      if (view.mode === 'chase') {
        const dx = pm.x - cx0, dz = pm.z - cz0, u = (dx * px0 + dz * pz0) / l0, ex = dx - px0 * u, ez = dz - pz0 * u;
        hide = u > -0.1 && u < 0.92 && ex * ex + ez * ez < 1.2 && pm.top > lastRp.y;
      }
      pm.g.visible = !hide;
    }
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
      // two triangles split north-west to south-east, or north-east to south-west where the original's cell flag says
      // so (converted levels' `s`; Sim origTri), so the floor drawn is the floor Sonic stands on
      const ne = L.split && (L.split[t] & 1), Q = ne ? [[0, 3, 1], [1, 3, 2]] : [[0, 3, 2], [0, 2, 1]];
      for (const [qa, qb, qc] of Q) {
        if (art) {
          const slot = art.baker.top(i + L.rom.origin[0], j + L.rom.origin[1]), su = q => [slot, OFF[q][0], OFF[q][1]];
          tri(V[qa], V[qb], V[qc], tc, tc, tc, su(qa), su(qb), su(qc), up);
        } else tri(V[qa], V[qb], V[qc], tc, tc, tc, TUV[qa], TUV[qb], TUV[qc], up);
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
  let sprinklerObjs = [], pylonObjs = [], zapObjs = [], beamObjs = [], capsuleObjs = [], leverObjs = [], beamPostObjs = [], friendObjs = [], friendBubble = null, headObjs = [];
  // Panic Puppet 2's beam posts (180): the frame shown in each of the 24 animation steps (list 0x16030, frame offsets / 4)
  const BEAM_FRAMES = [4, 4, 4, 4, 3, 3, 3, 2, 2, 2, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3];
  let rockObjs = [], jetObjs = [], moverObjs = [], spikeBallObjs = [], fireObjs = [], fireballObjs = [], iceSpikeObjs = [], mineSprites = [], crawlerSprites = [], balloonSprites = [], spikeMesh = null, spearObj = null, turretSprites = [], shotSprites = [], boosterMarks = [], goalFx = null, satReady = false;
  let barObjs = [], warpHoleMarks = [], doorMeshes = [], jamSprings = [], jamFlickies = [], ballSprites = [], crackMeshes = [], liftMeshes = [], maceObjs = [], puffSprites = [], bossObj = null;
  // a boss machine of our own design (a hovering four-rotor drone with one lamp; never the original's look-alike), its
  // spiked ball on a chain, and a burst of fireballs when beaten
  function buildBoss() {
    const o = buildBossPod(), b = world.boss;
    if (b.kind === 'rr') { o.rr = buildRrStatue(b); o.ball.visible = false; o.links.forEach(l => { l.visible = false; }); }
    if (b.kind === 'ss') { o.ss = buildSsArms(b); o.ball.visible = false; o.links.forEach(l => { l.visible = false; }); }
    if (b.kind === 'dd') { o.dd = buildDdParts(b, o.rom); o.ball.visible = false; o.links.forEach(l => { l.visible = false; }); }
    if (b.kind === 'gng') {   // Gene Gadget 3: the belt's loads (object 16C), the bombs (164) and the pod's lower part (168)
      o.ball.visible = false; o.links.forEach(l => { l.visible = false; });
      const crate = new THREE.MeshLambertMaterial({ color: 0x8a7a68, map: stoneTex() }), mk = (type, crude) => {
        if (o.rom) { const sp = new THREE.Sprite(romBossMat(type, 0, ROM_CANVAS, 80, 3)); sp.center.set(0.5, OBJ_FOOT); sp.scale.set(ROM_SIZE, ROM_SIZE, 1); levelGroup.add(sp); sp.visible = false; return sp; }
        const m = crude(); levelGroup.add(m); m.visible = false; return m;
      };
      o.gng = { loads: b.objs.map(() => mk(0x16C, () => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), crate); m.userData.lift = 0.4; return m; })),
        bombs: [0, 1, 2, 3].map(() => mk(0x164, () => { const m = new THREE.Sprite(mineMat); m.scale.set(0.7, 0.7, 1); m.userData.lift = 0.35; return m; })),
        lower: o.rom ? mk(0x168, null) : null };
    }
    if (b.kind === 'pp') {   // Panic Puppet 3: a glass column in each arena, two arms of links and a claw (object 1A0, line 3), the serpent (138, line 1)
      o.ball.visible = false; o.links.forEach(l => { l.visible = false; });
      const metal = new THREE.MeshLambertMaterial({ color: 0x9aa4b8, emissive: 0x101820 }), dark = new THREE.MeshLambertMaterial({ color: 0x4a505c });
      const glass = new THREE.MeshLambertMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false });
      const cols = b.stages.map(st => {
        const g = new THREE.Group(), floor = st.arms[0].shoulder[1] - 1.25 * b.vs, R = 1.55;
        const base = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.08, R * 1.15, 0.9 * b.vs, 24), dark); base.position.y = 0.45 * b.vs;
        const tube = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 9 * b.vs, 24, 1, true), glass); tube.position.y = 0.9 * b.vs + 4.5 * b.vs; tube.renderOrder = 3;
        const ring = new THREE.Mesh(new THREE.TorusGeometry(R * 1.02, 0.12, 8, 24), metal); ring.rotation.x = Math.PI / 2; ring.position.y = 0.9 * b.vs;
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.1, R * 1.1, 0.5, 24), metal); cap.position.y = 10 * b.vs;
        g.add(base, tube, ring, cap); g.position.set(st.pod[0], floor, st.pod[1]); levelGroup.add(g); return g;
      });
      const claw = (k) => {
        if (o.rom) { const sp = new THREE.Sprite(romBossMat(0x1A0, 0, ROM_CANVAS, 80, 3)); sp.center.set(0.5, OBJ_FOOT); sp.scale.set(ROM_SIZE, ROM_SIZE, 1); levelGroup.add(sp); return sp; }
        const g = new THREE.Group(), head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 10), new THREE.MeshLambertMaterial({ color: 0xc8463a }));
        head.position.y = 0.32; g.add(head);
        for (let i = 0; i < 3; i++) { const f = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.3, 6), metal); const a = i * 2.094; f.position.set(Math.sin(a) * 0.18, 0.08, Math.cos(a) * 0.18); f.rotation.x = Math.PI; g.add(f); }
        levelGroup.add(g); return g;
      };
      const linkGeo = new THREE.SphereGeometry(0.17, 12, 8);
      const arms = [0, 1].map(k => ({ links: Array.from({ length: 6 }, () => { const m = new THREE.Mesh(linkGeo, metal); levelGroup.add(m); return m; }), claw: claw(k) }));
      const fr = o.rom ? romTypeFrames(0x138, 1) : [];
      const serp = Array.from({ length: 5 }, (_, k) => {
        const sp = new THREE.Sprite(fr.length ? fr[Math.min(fr.length - 1, k)] : puffMat);
        if (fr.length) { sp.scale.set(ROM_SIZE * 1.2, ROM_SIZE * 1.2, 1); sp.center.set(0.5, OBJ_FOOT); } else sp.scale.setScalar(0.8 - k * 0.08);
        sp.visible = false; levelGroup.add(sp); return sp;
      });
      o.pp = { cols, arms, serp };
    }
    if (b.kind === 'ff') { o.g.visible = false; o.ball.visible = false; o.links.forEach(l => { l.visible = false; }); o.ff = buildFfParts(b, o.rom || romOn()); }
    if (b.kind === 'vv') {   // the fire serpent: the original's flame frames (object 138, line 3) or our own fireballs
      o.ball.visible = false; o.links.forEach(l => { l.visible = false; });
      const fr = o.rom ? romTypeFrames(0x138, 3) : [];
      o.vv = Array.from({ length: 9 }, (_, k) => {
        const sp = new THREE.Sprite(fr.length ? fr[Math.min(fr.length - 1, 7 - Math.min(7, k))] : puffMat);
        if (fr.length) { sp.scale.set(ROM_SIZE * 1.3, ROM_SIZE * 1.3, 1); sp.center.set(0.5, OBJ_FOOT); } else sp.scale.setScalar(0.9 - k * 0.05);
        levelGroup.add(sp);
        sp.visible = false; sp.userData.frames = fr; return sp;
      });
    }
    return o;
  }
  // Diamond Dust 3's parts: blowers circling the pod, snowmen, their snowballs and the snow puffs. ROM look: the
  // original's object art (blower 0F8 palette line 3, 17 frames by its angle and mirrored past half a turn; snowman 0E0,
  // snow 0FC, line 0); otherwise our own: grey drums with a nozzle, plain snowmen, white balls and soft puffs
  const snowPuffMat = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d');
    const gr = g.createRadialGradient(16, 16, 2, 16, 16, 15); gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.5, 'rgba(225,238,255,0.85)'); gr.addColorStop(1, 'rgba(200,220,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
    return new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false });
  })();
  function buildDdParts(b, rom) {
    const sprite = (mat, size, oy) => { const s = new THREE.Sprite(mat); s.center.set(0.5, 1 - oy / size); s.scale.set(size * 0.025, size * 0.025, 1); s.visible = false; levelGroup.add(s); return s; };
    const grey = new THREE.MeshLambertMaterial({ color: 0x70767e }), dark = new THREE.MeshLambertMaterial({ color: 0x2a2e34 }), snow = new THREE.MeshLambertMaterial({ color: 0xf4f8ff, emissive: 0x303844 });
    const blowers = Array.from({ length: b.hp }, () => {
      if (rom) return sprite(romBossMat(0xF8, 0, 64, 40, 3), 64, 40);
      const g = new THREE.Group(), drum = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.3, 10), grey), nz = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.28), dark);
      nz.position.set(0, 0, 0.22); g.add(drum, nz); g.visible = false; levelGroup.add(g); return g;
    });
    const snowmen = [0, 1].map(() => {
      if (rom) return sprite(romBossMat(0xE0, 0, 64, 48, 0), 64, 48);
      const g = new THREE.Group(), lo = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 10), snow), hi = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), snow);
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.18, 6), new THREE.MeshLambertMaterial({ color: 0xff8a20 }));
      lo.position.y = 0.28; hi.position.y = 0.7; nose.rotation.x = Math.PI / 2; nose.position.set(0, 0.7, 0.24); g.add(lo, hi, nose);
      g.visible = false; levelGroup.add(g); return g;
    });
    const balls = Array.from({ length: 16 }, () => rom ? sprite(romBossMat(0xFC, 1, 32, 16, 0), 32, 16)
      : (() => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), snow); m.visible = false; levelGroup.add(m); return m; })());
    const puffs = Array.from({ length: 8 }, () => { const s = sprite(rom ? romBossMat(0xFC, 0, 64, 32, 0) : snowPuffMat.clone(), 64, 32); if (!rom) s.center.set(0.5, 0.5); return s; });
    return { blowers, snowmen, balls, puffs, rom };
  }
  function updateDdParts(b, d, t) {
    const T = Math.PI / 1024, U = 1 / 32, left = b.hp - b.hits, alive = b.dead < 0;
    // the camera's turn from the original's view (yaw pi/4), in the routine's angle units
    const off = Math.round((Math.atan2(cam.position.x - b.x, cam.position.z - b.z) - Math.PI / 4) / T);
    d.blowers.forEach((o, k) => {
      o.visible = alive && k < left;
      if (!o.visible) return;
      const a = (b.blowA + k * 0x100) & 0x7FE;
      o.position.set(b.x + Math.sin(a * T) * 32 * U, b.y - (d.rom ? 8 * b.vs * U : 0), b.z + Math.cos(a * T) * 32 * U);
      if (d.rom) {
        let f = (((a - off - 0x100) & 0x7C0) >> 6); const flip = f >= 16; if (flip) f = 32 - f;
        o.material = romBossMat(0xF8, f, 64, 40, 3); o.scale.x = (flip ? -1 : 1) * Math.abs(o.scale.x);
      } else o.rotation.y = a * T;
    });
    d.snowmen.forEach((o, k) => {
      const s = b.snowmen[k]; o.visible = !!s;
      if (!s) return;
      o.position.set(s.x, s.y, s.z);
      if (d.rom) o.material = romBossMat(0xE0, s.state === 'wake' ? Math.min(5, Math.floor(s.t / 7)) : 0, 64, 48, 0);
      else o.scale.setScalar(s.state === 'wake' ? 1 + 0.08 * Math.sin(s.t * 0.9) : 1);
    });
    d.balls.forEach((o, k) => { const q = b.balls[k]; o.visible = !!q; if (q) o.position.set(q.x, q.y, q.z); });
    d.puffs.forEach((o, k) => {
      const q = b.puffs[k]; o.visible = !!q;
      if (!q) return;
      o.position.set(q.x, q.y, q.z);
      if (d.rom) o.material = romBossMat(0xFC, q.f, 64, 32, 0);   // (frames 0..7 as the puff's list steps them)
      else { const k2 = q.f / 8; o.scale.setScalar(0.5 + k2 * 0.9); o.material.opacity = 1 - k2 * 0.7; }
    });
  }
  // Rusty Ruin 3's statue, of our own drawing in stone colours (the original's statue sprites are not read): a body
  // under the pod, shoulders on a bar, a helmet (the routine's cap) that comes down over the pod, and per arm the
  // routine's seven links and a flat hand the size of the fist's floor in the sim
  let stoneTexture = null;
  function stoneTex() {
    if (stoneTexture) return stoneTexture;
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    g.fillStyle = '#b8b29c'; g.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 260; i++) { const v = 150 + rnd() * 70 | 0; g.fillStyle = `rgb(${v},${v - 4},${v - 22})`; g.fillRect(rnd() * 64 | 0, rnd() * 64 | 0, 1 + rnd() * 4 | 0, 1 + rnd() * 3 | 0); }
    g.strokeStyle = 'rgba(70,66,52,0.5)'; g.lineWidth = 1;
    for (let i = 0; i < 6; i++) { g.beginPath(); let x = rnd() * 64, y = rnd() * 64; g.moveTo(x, y); for (let k = 0; k < 4; k++) { x += rnd() * 12 - 6; y += rnd() * 12 - 6; g.lineTo(x, y); } g.stroke(); }
    stoneTexture = new THREE.CanvasTexture(c); stoneTexture.wrapS = stoneTexture.wrapT = THREE.RepeatWrapping;
    return stoneTexture;
  }
  // Spring Stadium 1's spike fields: five spikes a cell, all rising together with the sim's count (0 to 5)
  function buildSpikes() {
    const parts = [];
    for (const [ox, oz] of [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]]) {
      const c = new THREE.ConeGeometry(0.09, 1, 6).toNonIndexed(); c.translate(ox - 0.5, 0.5, oz - 0.5); parts.push(c);
    }
    const pos = [], nrm = [];
    for (const c of parts) { pos.push(...c.attributes.position.array); nrm.push(...c.attributes.normal.array); c.dispose(); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    const cells = [...world.spikeCells], m = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0xd8c890 }), cells.length);
    m.userData.cells = cells.map(t => { const cx = t % L.width, cz = (t - cx) / L.width; return [cx + 0.5, Sim.floorAt(L, cx + 0.5, cz + 0.5), cz + 0.5]; });
    m.userData.level = -1; levelGroup.add(m); spikeMesh = m; setSpikes(world.spike);
    return m;
  }
  const _spM = new THREE.Matrix4();
  function setSpikes(level) {
    const m = spikeMesh, h = Math.max(0.001, level / 5 * 0.42 * (L.rom ? L.rom.vscale : 1));
    m.visible = level > 0; m.userData.level = level;
    m.userData.cells.forEach(([x, y, z], i) => { _spM.makeScale(1, h, 1); _spM.setPosition(x, y - 0.02, z); m.setMatrixAt(i, _spM); });
    m.instanceMatrix.needsUpdate = true;
  }
  // Spring Stadium 3's arms, of our own drawing: a chain of grey links from the pod to a red spring fist with a yellow band
  function buildSsArms(b) {
    const grey = new THREE.MeshLambertMaterial({ color: 0xb8bcc4 }), red = new THREE.MeshLambertMaterial({ color: 0xd8382c }), band = new THREE.MeshLambertMaterial({ color: 0xf0c020 });
    const linkGeo = new THREE.SphereGeometry(0.13, 8, 6);
    return b.fists.map(() => {
      const links = Array.from({ length: 6 }, () => { const m = new THREE.Mesh(linkGeo, grey); levelGroup.add(m); return m; });
      const fist = new THREE.Group();
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.45, 0.55), red); box.position.y = 0.22; fist.add(box);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.1, 0.58), band); strip.position.y = 0.22; fist.add(strip);
      levelGroup.add(fist);
      return { links, fist };
    });
  }
  function buildRrStatue(b) {
    const stone = new THREE.MeshLambertMaterial({ map: stoneTex(), color: 0xd0cab4 }), seam = new THREE.MeshLambertMaterial({ color: 0x77735f });
    const g = new THREE.Group(), U = 1 / 32, V = b.vs / 32, floor = Sim.floorAt(L, b.x, b.z + 0.5);
    const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m; };
    const bodyH = Math.max(0.5, b.cruise - floor - 0.15);   // behind the arena's edge (the sim has no wall for it)
    add(new THREE.CylinderGeometry(0.95, 1.15, bodyH, 12), stone, b.x, floor + bodyH / 2, b.z - 0.25);
    add(new THREE.CylinderGeometry(1.0, 1.0, 0.16, 12), seam, b.x, floor + bodyH - 0.1, b.z - 0.25);
    const span = b.armX[1] - b.armX[0];
    add(new THREE.BoxGeometry(span, 0.5 * b.vs, 0.7), stone, (b.armX[0] + b.armX[1]) / 2, b.root[0] - 0.1, b.root[1] - 0.5);
    for (const x of b.armX) add(new THREE.SphereGeometry(0.5, 14, 10), stone, x, b.root[0], b.root[1]);
    const cap = add(new THREE.SphereGeometry(1.05, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2), stone, b.x, b.cap, b.z);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.14, 18), seam); cap.add(rim);
    const linkGeo = new THREE.SphereGeometry(0.3, 10, 8);
    const arms = [0, 1].map(() => {
      const links = Array.from({ length: 7 }, () => add(linkGeo, stone, 0, 0, 0));
      // the hand: a palm the size of the fist's floor (24 x 38 units, 28 high) and four fingers to the south
      const hand = new THREE.Group(), ph = 28 * V;
      const palm = new THREE.Mesh(new THREE.BoxGeometry(24 * U, ph, 30 * U), stone); palm.position.set(0, -ph / 2, -4 * U); hand.add(palm);
      for (let k = 0; k < 4; k++) {
        const f = new THREE.Mesh(new THREE.BoxGeometry(5 * U, ph * 0.55, 9 * U), stone); f.position.set((k - 1.5) * 6 * U, -ph * 0.7, 15 * U); hand.add(f);
      }
      g.add(hand); return { links, hand };
    });
    levelGroup.add(g);
    return { g, cap, arms };
  }
  function buildBossPod() {
    if (romOn()) {   // the original's own pod and ball
      const pod = new THREE.Sprite(romBossMat(0x48, 0, 128, 100)); pod.center.set(0.5, 1 - 100 / 128); pod.scale.set(128 * 0.025, 128 * 0.025, 1);
      const ball = new THREE.Sprite(romBossMat(0x50, 0, 64, 40)); ball.center.set(0.5, 1 - 40 / 64); ball.scale.set(64 * 0.025, 64 * 0.025, 1);
      levelGroup.add(pod); levelGroup.add(ball);
      const links = [1, 2, 3].map(() => { const l = new THREE.Mesh(linkGeo, linkMat); levelGroup.add(l); return l; });
      return { g: pod, pod, ball, links, rom: true };
    }
    const g = new THREE.Group(), metal = new THREE.MeshLambertMaterial({ color: 0x8c949c }), dark = new THREE.MeshLambertMaterial({ color: 0x3a3f46 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.55, 0.55, 8), metal); g.add(body);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.77, 0.77, 0.14, 8), new THREE.MeshLambertMaterial({ color: 0xe0b020 })); band.position.y = 0.12; g.add(band);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff3020 })); lamp.position.set(0, 0.1, 0.62); g.add(lamp);
    const rotors = [];
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + Math.PI / 4, arm = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.12), dark);
      arm.position.set(Math.cos(a) * 0.9, 0.3, Math.sin(a) * 0.9); arm.rotation.y = -a; g.add(arm);
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.03, 16), new THREE.MeshLambertMaterial({ color: 0x20262c, transparent: true, opacity: 0.55 }));
      r.position.set(Math.cos(a) * 1.3, 0.38, Math.sin(a) * 1.3); g.add(r); rotors.push(r);
    }
    levelGroup.add(g);
    const rm = romOn() ? romObjMat('enemy', 'SPK', false) : null, ball = new THREE.Sprite(rm || mineMat);
    if (rm) { ball.center.set(0.5, OBJ_FOOT); ball.scale.set(ROM_SIZE * 1.6, ROM_SIZE * 1.6, 1); } else ball.scale.set(1.1, 1.1, 1);
    levelGroup.add(ball);
    const links = [1, 2, 3].map(() => { const l = new THREE.Mesh(linkGeo, linkMat); levelGroup.add(l); return l; });
    return { g, lamp, rotors, ball, links, rom: !!rm };
  }
  function updateBoss(t) {
    const b = world.boss, o = bossObj;
    if (!b || !o) return;
    if (o.ff) { o.g.visible = false; o.ball.visible = false; o.links.forEach(l => { l.visible = false; }); updateFfParts(b, o.ff, t); return; }
    o.g.position.set(b.x, b.y, b.z);
    o.g.visible = (b.dead < 0 || b.dead < 2 || Math.floor(t * 20) % 2 === 0) && !(b.cool > 0 && Math.floor(t * 16) % 2);
    if (o.rr) {   // the cap over the pod, the arms where the routine puts them
      o.rr.cap.position.y = b.cap + 0.95 * b.vs;
      o.rr.arms.forEach((a, k) => {
        const A = Sim.rrArm(b, k), U = 1 / 32;
        a.links.forEach((m, i) => m.position.set(A.links[i][0], A.links[i][1], A.links[i][2]));
        a.hand.position.set(A.fist[0] + 8 * U, A.fist[1] - b.vs / 32, A.fist[2] + 17 * U);
      });
    }
    if (o.dd) { updateDdParts(b, o.dd, t); if (o.rom) o.g.position.y = b.y - 8 * b.vs / 32; }
    if (o.gng) {
      if (o.rom) o.g.position.y = b.y - 8 * b.vs / 32;
      const put = (m, x, z, on) => { m.visible = on; if (on) m.position.set(x, Sim.floorAt(L, x, z) + (m.userData.lift || 0), z); };
      o.gng.loads.forEach((m, k) => { const q = b.objs[k]; put(m, q.x, q.z, q.on && b.dead < 0); });
      o.gng.bombs.forEach((m, k) => { const q = b.bombs[k]; put(m, q ? q.x : 0, q ? q.z : 0, !!q); });
      if (o.gng.lower) { o.gng.lower.visible = o.g.visible; o.gng.lower.position.set(b.x - 2 / 32, b.y - 24 * b.vs / 32, b.z - 2 / 32); }
    }
    if (o.pp) {   // the pod in its column (gone once the last arena is beaten), the arms, the serpent
      o.g.position.set(b.podX, b.y - (o.rom ? 8 * b.vs / 32 : 0), b.podZ); o.g.visible = b.pod < b.stages.length;
      b.arms.forEach((a, k) => {
        const pts = Sim.ppLinks(a), A = o.pp.arms[k], flash = world.time - a.hitAt < 0.6 && Math.floor(t * 16) % 2;
        A.links.forEach((m, i) => { m.position.set(pts[i][0], pts[i][1] + 0.12, pts[i][2]); m.visible = !flash; });
        const c = pts[6]; A.claw.position.set(c[0], c[1], c[2]); A.claw.visible = !flash;
        const open = b.si === 0 ? a.t > 0x20 && a.t < 0x98 : a.t > 0 && a.t <= 0x78;   // (resting after a punch; stopped for its turn)
        if (o.rom && A.claw.isSprite) A.claw.material = romBossMat(0x1A0, a.hits === 0 ? 2 : open ? 1 : 0, ROM_CANVAS, 80, 3);
      });
      o.pp.serp.forEach((sp, k) => { const q = b.serp && b.serp.segs[k]; sp.visible = !!q; if (q) sp.position.set(q[0], q[1], q[2]); });
    }
    if (o.vv) {
      if (o.rom) o.g.position.y = b.y - 8 * b.vs / 32;
      o.vv.forEach((sp, k) => { const q = b.segs[k]; sp.visible = !!q && b.dead < 0; if (q) sp.position.set(q[0], q[1], q[2]); });
    }
    if (o.ss) o.ss.forEach((a, k) => {   // links from under the pod to the fist
      const [fx, fy, fz] = b.fistAt[k], sx = b.x + b.fists[k][0] * 0.4, sy = b.y - 0.1, sz = b.z + b.fists[k][1] * 0.4;
      a.links.forEach((m, i) => { const t = (i + 1) / 7; m.position.set(sx + (fx - sx) * t, sy + (fy + 0.4 - sy) * t, sz + (fz - sz) * t); });
      a.fist.position.set(fx, fy, fz);
    });
    const bl = b.ball || { x: b.x, y: b.y, z: b.z, state: 'none' };
    if (o.pod) {   // frames 0-7 while whole, 9-11 cracked as its hits run out
      const left = b.hp - b.hits;
      o.pod.material = romBossMat(0x48, left <= 3 && b.hits ? 9 + (3 - Math.max(1, left)) : Math.floor(t * 8) % 8, 128, 100);
      if (b.ball) o.ball.material = romBossMat(0x50, Math.floor(t * 12) % 8, 64, 40);
    } else {
      o.lamp.material.color.setHex(b.cool > 0 && Math.floor(t * 16) % 2 ? 0xffffff : 0xff3020);
      o.rotors.forEach((r, k) => { r.rotation.y = t * 30 + k; });
    }
    if (b.ball) o.ball.position.set(bl.x, bl.y + (o.rom ? 0.3 : 0.45), bl.z);
    o.links.forEach((l, i) => { l.visible = bl.state === 'held'; l.position.set(b.x, b.y - (i + 1) * 0.3, b.z); });
    if (b.dead >= 0) for (let q = 0; q < puffSprites.length; q++) {
      const s = puffSprites[q], k = (t * 3 + q * 0.37) % 1;
      s.visible = q < 12 && b.dead < 3.5; s.position.set(b.x + Math.sin(q * 7.1) * 1.2 * k, b.y + Math.cos(q * 3.3) * 0.8 * k, b.z + Math.cos(q * 5.3) * 1.2 * k); s.scale.setScalar(0.4 + k);
    }
  }
  // Final Fight's machine, our own design in both looks (the original's body is drawn from tiles the act unpacks and
  // streams, not from raw sprites): a steel drum as wide as its hit circle (31 units) and as tall as the hit window's
  // floor (32 units), so a jump onto its top is the hit; a canopy and fins behind, a lamp in front, turned to Sonic.
  // With it: laser cannons (fight 0; object 1B4 frame 0 in the ROM look), fists (fight 4; 1B4 frame 1), bombs and their
  // shadows (fight 6), the pod's cannon (fight 8; 1C0 by its shot), the doors (a force field), the shots and the floor
  // pads lit where Sonic steps (object 1AC: six while walking, two in a fight)
  const hazardTex = (() => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 16; const g = c.getContext('2d');
    g.fillStyle = '#20232a'; g.fillRect(0, 0, 64, 16); g.fillStyle = '#f0c020';
    for (let x = -16; x < 64; x += 16) { g.beginPath(); g.moveTo(x, 16); g.lineTo(x + 8, 0); g.lineTo(x + 16, 0); g.lineTo(x + 8, 16); g.fill(); }
    const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.repeat.set(6, 1); return t;
  })();
  function buildFfParts(b, rom) {
    const V = b.vs, U = 1 / 32, add = m => { levelGroup.add(m); return m; };
    const steel = new THREE.MeshLambertMaterial({ color: 0xa4acb6 }), dark = new THREE.MeshLambertMaterial({ color: 0x30353d }), red = new THREE.MeshBasicMaterial({ color: 0xff3020 });
    const g = new THREE.Group(), R = 31 * U, H = V;
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 1.06, H, 20), steel); drum.position.y = H / 2; g.add(drum);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.02, R * 1.02, H * 0.22, 20, 1, true), new THREE.MeshLambertMaterial({ map: hazardTex })); band.position.y = H * 0.62; g.add(band);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.96, R, 0.06, 20), dark); top.position.y = H + 0.03; g.add(top);
    const canopy = new THREE.Group(), glass = new THREE.Mesh(new THREE.SphereGeometry(0.62, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x5a1820, emissive: 0x200408 }));
    canopy.add(glass); canopy.position.set(-R * 0.9, H, 0); g.add(canopy);
    for (const sz of [-1, 1]) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.08), dark); fin.position.set(-R * 1.1, H * 0.8, sz * R * 0.8); fin.rotation.x = sz * 0.35; g.add(fin);
      const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.8, 12), steel); pod.rotation.z = Math.PI / 2; pod.position.set(-0.1, H * 0.35, sz * (R + 0.2)); g.add(pod);
    }
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), red); lamp.position.set(R * 0.98, H * 0.4, 0); g.add(lamp);
    add(g);
    const sprite = (type, frame) => { const sp = new THREE.Sprite(romBossMat(type, frame, ROM_CANVAS, 80, 3)); sp.center.set(0.5, OBJ_FOOT); sp.scale.set(ROM_SIZE, ROM_SIZE, 1); sp.visible = false; return add(sp); };
    const cannons = [0, 1].map(() => {
      if (rom) return sprite(0x1B4, 0);
      const c = new THREE.Group(), barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.9, 10), dark), tip = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.04, 6, 12), new THREE.MeshBasicMaterial({ color: 0x40e0ff }));
      barrel.rotation.z = Math.PI / 2; barrel.position.set(0.45, 0.25, 0); tip.rotation.y = Math.PI / 2; tip.position.set(0.9, 0.25, 0); c.add(barrel, tip); c.visible = false; return add(c);
    });
    const fists = [0, 1].map(() => {
      if (rom) return sprite(0x1B4, 1);
      const f = new THREE.Group(), box = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.45, 0.7), steel); box.position.y = 0.22; f.add(box);
      for (let k = 0; k < 4; k++) { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.3, 8), new THREE.MeshLambertMaterial({ color: 0xd03020 })); sp.position.set((k % 2 - 0.5) * 0.45, 0.6, (Math.floor(k / 2) - 0.5) * 0.35); f.add(sp); }
      f.visible = false; return add(f);
    });
    const bombMat = new THREE.MeshLambertMaterial({ color: 0x24262c }), shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false });
    const bombs = b.bombs.map(() => {
      const m = add(new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 8), bombMat)), sh = add(new THREE.Mesh(new THREE.CircleGeometry(0.3, 16), shadowMat));
      sh.rotation.x = -Math.PI / 2; m.visible = sh.visible = false; return { m, sh };
    });
    const turret = rom ? sprite(0x1C0, 0) : (() => {
      const c = new THREE.Group(), base = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.25, 12), dark), barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.7, 10), steel);
      base.position.y = 0.12; barrel.rotation.z = Math.PI / 2; barrel.position.set(0.35, 0.18, 0); c.add(base, barrel); c.visible = false; return add(c);
    })();
    // the doors: a force field between two posts, 2.5 m (the cells stand far higher for the sim)
    const field = new THREE.MeshBasicMaterial({ color: 0xff3050, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false });
    const doorFloor = b.doorTop - 0x20 * 8 / 32 * V;
    const doors = b.doors.map(cells => {
      const dg = new THREE.Group(), xs = cells.map(c => c[0]), zs = cells.map(c => c[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs) + 1, z0 = Math.min(...zs), z1 = Math.max(...zs) + 1, alongX = x1 - x0 > z1 - z0;
      const len = alongX ? x1 - x0 : z1 - z0, sheet = new THREE.Mesh(new THREE.PlaneGeometry(len, 2.5), field);
      if (!alongX) sheet.rotation.y = Math.PI / 2;
      sheet.position.y = 1.25; dg.add(sheet);
      for (const e of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.7, 0.2), dark); post.position.set(alongX ? e * len / 2 : 0, 1.35, alongX ? 0 : e * len / 2); dg.add(post); }
      dg.position.set((x0 + x1) / 2, doorFloor, (z0 + z1) / 2); dg.userData.h = 0; return add(dg);
    });
    const laserMat = new THREE.MeshBasicMaterial({ color: 0x70f0ff }), laserGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.7, 6);
    const lasers = Array.from({ length: 30 }, () => { const m = add(new THREE.Mesh(laserGeo, laserMat)); m.rotation.z = Math.PI / 2; m.visible = false; return m; });
    const ballGeo = new THREE.SphereGeometry(0.18, 10, 8), balls = Array.from({ length: 30 }, () => { const m = add(new THREE.Mesh(ballGeo, steel)); m.visible = false; return m; });
    const padMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false });
    const pads = Array.from({ length: 6 }, () => { const m = add(new THREE.Mesh(new THREE.PlaneGeometry(0.96, 0.96), padMat)); m.rotation.x = -Math.PI / 2; m.visible = false; return m; });
    return { g, canopy, lamp, cannons, fists, bombs, turret, doors, lasers, balls, pads, cells: [], yaw: 0, rom };
  }
  function updateFfParts(b, f, t) {
    const p = world.p, V = b.vs, U = 1 / 32, fight = b.st % 2 === 0;
    // the machine (it flickers after a hit, 100 frames; the explosions at the end)
    f.g.position.set(b.x, b.y, b.z);
    const want = Math.atan2(-(p.z - b.z), p.x - b.x); let d = want - f.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); f.yaw += d * 0.06; f.g.rotation.y = f.yaw;
    f.g.visible = !b.hidden && !(world.time - (b.hitAt ?? -9) < 100 / 60 && Math.floor(t * 16) % 2);
    f.canopy.rotation.z = b.hatch ? Math.min(1, (f.canopy.rotation.z || 0) + 0.05) : Math.max(0, (f.canopy.rotation.z || 0) - 0.05);
    f.lamp.material.color.setHex(Math.floor(t * 3) % 2 ? 0xff3020 : 0x801008);
    f.cannons.forEach((c, k) => { const q = b.cannonsM && b.cannonsM[k]; c.visible = !!q && !b.hidden; if (q) c.position.set(q[0], q[1], q[2]); });
    f.fists.forEach((c, k) => { const q = b.st === 4 && b.fistsM && b.fistsM[k]; c.visible = !!q && !b.hidden; if (q) c.position.set(q[0], q[1], q[2]); });
    f.bombs.forEach((o, k) => {
      const q = b.bombsM && b.bombsM[k]; o.m.visible = !!q; o.sh.visible = !!(q && q[3]);
      if (q) { o.m.position.set(q[0], q[1] + 0.25, q[2]); o.sh.position.set(q[0], Sim.floorAt(L, q[0], q[2]) + 0.02, q[2]); }
    });
    f.turret.visible = b.st === 8 && !b.hidden;
    if (f.turret.visible) {
      f.turret.position.set(b.x + U, b.y + 16 * V / 32, b.z + U);
      const k = b.cannon > 0 ? Math.min(4, b.cannonK) : b.cannon < 0 ? Math.max(0, 4 - b.cannonK) : 0, a = Math.atan2(-[36, 28, 12, -12, -31][k], [36, 41, 49, 49, 44][k]);
      if (f.rom) f.turret.material = romBossMat(0x1C0, k, ROM_CANVAS, 80, 3); else f.turret.rotation.y = a;
    }
    // doors slide up and down (a metre a second)
    f.doors.forEach((dg, k) => { const tgt = b.doorUp[k] ? 1 : 0; dg.userData.h += Math.max(-0.05, Math.min(0.05, tgt - dg.userData.h)); dg.visible = dg.userData.h > 0.01; dg.scale.y = Math.max(0.01, dg.userData.h); });
    // the shots
    let li = 0, bi = 0;
    for (const sh of world.shots) {
      if (sh.laser && li < f.lasers.length) { const m = f.lasers[li++]; m.visible = true; m.position.set(sh.x, sh.y + 0.3, sh.z); }
      else if (sh.ball && bi < f.balls.length) { const m = f.balls[bi++]; m.visible = true; m.position.set(sh.x, sh.y + 0.18, sh.z); }
    }
    for (; li < f.lasers.length; li++) f.lasers[li].visible = false;
    for (; bi < f.balls.length; bi++) f.balls[bi].visible = false;
    // the pads lit where Sonic stands
    if (p.grounded) { const c = [Math.floor(p.x), Math.floor(p.z)]; if (!f.cells.length || f.cells[0][0] !== c[0] || f.cells[0][1] !== c[1]) { f.cells.unshift(c); f.cells.length = Math.min(f.cells.length, 6); } }
    const n = fight ? 2 : 6;
    f.pads.forEach((m, k) => { const c = f.cells[k]; m.visible = !!c && k < n; if (c && k < n) m.position.set(c[0] + 0.5, Sim.floorAt(L, c[0] + 0.5, c[1] + 0.5) + 0.02, c[1] + 0.5); });
    // beaten: bursts round the machine
    for (let q = 0; q < puffSprites.length; q++) {
      const s = puffSprites[q], k = (t * 3 + q * 0.37) % 1;
      s.visible = b.end >= 0 && q < 12; if (s.visible) { s.position.set(b.x + Math.sin(q * 7.1) * 1.2 * k, b.y + 0.6 + Math.cos(q * 3.3) * 0.8 * k, b.z + Math.cos(q * 5.3) * 1.2 * k); s.scale.setScalar(0.4 + k); }
    }
  }
  // a fireball: an orange glow drawn once
  const puffMat = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d');
    const gr = g.createRadialGradient(16, 16, 2, 16, 16, 15); gr.addColorStop(0, '#fff6b0'); gr.addColorStop(0.35, '#ffb020'); gr.addColorStop(0.75, '#e04010'); gr.addColorStop(1, 'rgba(160,20,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
    return new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false });
  })();
  const linkGeo = new THREE.SphereGeometry(0.1, 8, 6), linkMat = new THREE.MeshLambertMaterial({ color: 0x6a6660 });
  const SPRING_REST = 0.3;   // how far the Jam spring's coil stands at rest (fired: 1)
  function buildLevelObjects() {
    if (levelGroup) {
      scene.remove(levelGroup);
      if (foliage) foliage.tex.dispose();
      levelGroup.traverse(o => { if (o.isMesh && !o.userData.jam && !o.userData.shared) { o.geometry.dispose(); for (const m of [].concat(o.material)) m.dispose(); } else if (o.isSprite && o.userData.fade !== undefined) o.material.dispose(); });
    }
    levelGroup = new THREE.Group();
    const mesh = buildLevelMesh(L);
    levelGroup.add(mesh);
    foliage = mesh.userData.art ? buildFoliage(levelArtFor(L)) : null;
    levelAnim = mesh.userData.art ? { a: levelArtFor(L), shown: -1 } : null;
    if (foliage) levelGroup.add(foliage.mesh);
    // Green Grove's palms as Sonic Jam's 3D palm, each turned its own way; the trunk is a flat quad facing the camera
    jamPalms = [];
    const art = mesh.userData.art && levelArtFor(L);
    if (jamOn() && art && art.baker.palms) {
      const vs = L.rom.vscale, [ox, oz] = L.rom.origin;
      jamPalms = art.baker.palms.map(pm => {
        const c = jamCopy(jamProps.palm), x = pm.x / 32 - ox, z = pm.z / 32 - oz;
        c.g.position.set(x, pm.y / 32 * vs, z); c.g.scale.y *= vs;
        c.g.rotation.y = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453 % 1) * Math.PI * 2;
        levelGroup.add(c.g);
        return { g: c.g, trunk: c.nodes[1], x, z, top: pm.y / 32 * vs + 80 / 32 * vs };
      });
    }
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
      let rm = rom ? romObjMat(kind, o.skin, false) : null;
      // an enemy with no recipe: its own frames from the art table, mirrored by scale when it faces left
      const tf = !rm && rom && kind === 'enemy' && o.skin && S3D.typeArt(romArt.d, parseInt(o.skin, 16)) ? romTypeFrames(parseInt(o.skin, 16), o.line ?? 3) : null;
      if (tf && tf.length) {
        const s = bottomSprite(tf[0], o.x, o.y, o.z, ROM_SIZE, ROM_SIZE, OBJ_FOOT); s.userData.size = ROM_SIZE; s.userData.frames = tf; s.userData.type = [parseInt(o.skin, 16), o.line ?? 3]; return s;
      }
      const s = rm ? bottomSprite(rm, o.x, o.y, o.z, ROM_SIZE, ROM_SIZE, OBJ_FOOT) : bottomSprite(crudeMat, o.x, o.y, o.z, crudeSize, crudeSize, crudeFoot);
      s.userData.size = rm ? ROM_SIZE : crudeSize;
      if (rm) s.userData.rom = [rm, kind === 'enemy' ? romObjMat(kind, o.skin, true) : rm];
      return s;
    };
    // doors (gates opened by a key, by a ring or for a supercharger's run: Gene Gadget, Spring Stadium, Panic Puppet; not
    // a barrier's wall, drawn with its pylons): a slab of the level's own wall (ROM look) or a striped shutter of our own
    // in the gate's cells, at most 2.4 m tall, sliding into the floor while it is open
    {
      const art = mesh.userData.art && levelArtFor(L), vs = L.rom ? L.rom.vscale : 1;
      const floorOf = (cx, cz) => { const k = (cz * L.width + cx) * 4; return Math.min(L.corners[k], L.corners[k + 1], L.corners[k + 2], L.corners[k + 3]); };
      let shutter = null;
      const zapCells = L.entities.filter(e => e.type === 'barrier').flatMap(e => e.cells);
      const barrierWall = g => g.cells.some(([cx, cz]) => zapCells.some(([zx, zz]) => Math.abs(zx - cx) <= 1 && Math.abs(zz - cz) <= 1));
      const postMat = new THREE.MeshLambertMaterial({ color: 0x7a3aa8 }), fieldMat = new THREE.MeshBasicMaterial({ color: 0xc070ff, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
      doorMeshes = world.gates.filter(g => g.key !== null || g.shut || g.pass || (g.opens > 0 && !barrierWall(g))).map(g => {
        const grp = new THREE.Group();
        if (g.pass) {   // a supercharger's gate (Spring Stadium's 038 posts): two posts and a field between, the field gone while open
          const xs = g.cells.map(c => c[0]), zs = g.cells.map(c => c[1]), x0 = Math.min(...xs), x1 = Math.max(...xs) + 1, z0 = Math.min(...zs), z1 = Math.max(...zs) + 1;
          const alongX = x1 - x0 > z1 - z0, len = alongX ? x1 - x0 : z1 - z0, floor = Math.min(...g.cells.map(([cx, cz]) => floorOf(cx, cz))), h = 1.1 * vs;
          const field = new THREE.Mesh(new THREE.PlaneGeometry(len, h), fieldMat); if (!alongX) field.rotation.y = Math.PI / 2; field.position.y = h / 2;
          const posts = new THREE.Group(); posts.add(field);
          for (const e of [-1, 1]) { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, h + 0.2, 8), postMat); m.position.set(alongX ? e * len / 2 : 0, (h + 0.2) / 2, alongX ? 0 : e * len / 2); posts.add(m); }
          posts.position.set((x0 + x1) / 2, floor, (z0 + z1) / 2); levelGroup.add(posts);
          grp.userData = { gate: g, h: 0, field }; return grp;
        }
        let hMax = 0;
        for (const [cx, cz] of g.cells) {
          const floor = floorOf(cx, cz), h = Math.min(g.top - floor, 2.4 * vs);
          let mat = null;
          const slot = art && L.rom ? art.baker.rockSlot(cx + L.rom.origin[0], cz + L.rom.origin[1]) : -1;
          if (slot >= 0) {
            const cv = document.createElement('canvas'); cv.width = cv.height = 32;
            cv.getContext('2d').putImageData(new ImageData(art.baker.slotPixels(slot).slice(), 32, 32), 0, 0);
            const tex = new THREE.CanvasTexture(cv); tex.magFilter = THREE.NearestFilter; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(1, h / vs);
            mat = new THREE.MeshLambertMaterial({ map: tex });
          } else {
            if (!shutter) {
              const cv = document.createElement('canvas'); cv.width = cv.height = 64; const c2 = cv.getContext('2d');
              c2.fillStyle = '#8c93a3'; c2.fillRect(0, 0, 64, 64); c2.fillStyle = '#6f7686'; for (let y = 4; y < 48; y += 8) c2.fillRect(0, y, 64, 3);
              for (let x = -64; x < 64; x += 16) { c2.fillStyle = '#f2c230'; c2.beginPath(); c2.moveTo(x, 64); c2.lineTo(x + 8, 64); c2.lineTo(x + 24, 48); c2.lineTo(x + 16, 48); c2.fill(); }
              c2.fillStyle = '#26262c'; c2.fillRect(0, 46, 64, 2);
              shutter = new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(cv) });
            }
            mat = shutter;
          }
          const m = new THREE.Mesh(new THREE.BoxGeometry(0.98, h, 0.98), mat);
          m.position.set(cx + 0.5, floor + h / 2, cz + 0.5); grp.add(m); hMax = Math.max(hMax, h);
        }
        grp.userData = { gate: g, h: hMax }; levelGroup.add(grp); return grp;
      });
    }
    // cracked walls: a column of plain rock (from the level's own cliffs in the ROM look) on each cell until broken;
    // pillars (broken by a whirl): a stone column on a pink base, about the original sprite's height
    // Diamond Dust 1's warp holes: a dark well on each cell once they are open
    warpHoleMarks = world.warpHole ? world.warpHole.cells.map(([cx, cz]) => {
      const k = (cz * L.width + cx) * 4, y = Math.max(L.corners[k], L.corners[k + 1], L.corners[k + 2], L.corners[k + 3]);
      const m = new THREE.Mesh(new THREE.CircleGeometry(0.45, 24), new THREE.MeshBasicMaterial({ color: 0x05070c }));
      m.rotation.x = -Math.PI / 2; m.position.set(cx + 0.5, y + 0.02, cz + 0.5); m.visible = false; levelGroup.add(m); return m;
    }) : [];
    crackMeshes = world.cracks.map(c => {
      const g = new THREE.Group(), art = mesh.userData.art && levelArtFor(L), vs = L.rom ? L.rom.vscale : 1;
      const floorOf = (cx, cz) => { const k = (cz * L.width + cx) * 4; return Math.min(L.corners[k], L.corners[k + 1], L.corners[k + 2], L.corners[k + 3]); };
      // a block of plain rock (from the level's own cliffs in the ROM look), at most 3 m tall (the original's 480 units
      // would be a 15 m chimney); no jump clears either
      const rock = (cx, cz, top) => {
        const floor = floorOf(cx, cz), h = Math.min(top - floor, 3 * vs);
        let mat;
        const slot = art && L.rom ? art.baker.rockSlot(cx + L.rom.origin[0], cz + L.rom.origin[1]) : -1;
        if (slot >= 0) {
          const cv = document.createElement('canvas'); cv.width = cv.height = 32;
          cv.getContext('2d').putImageData(new ImageData(art.baker.slotPixels(slot).slice(), 32, 32), 0, 0);
          const tex = new THREE.CanvasTexture(cv); tex.magFilter = THREE.NearestFilter; tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
          tex.repeat.set(1, h / vs);
          mat = new THREE.MeshLambertMaterial({ map: tex });
        } else mat = new THREE.MeshLambertMaterial({ color: 0x8a6a48 });
        const m = new THREE.Mesh(new THREE.BoxGeometry(1, h, 1), mat);
        m.position.set(cx + 0.5, floor + h / 2, cz + 0.5); g.add(m);
      };
      for (const [cx, cz, top, after, quiet] of c.cells) {
        if (c.by !== 'whirl' || quiet) { rock(cx, cz, top); continue; }
        // a pillar: a stone column on a pink base, about the original sprite's height
        const floor = floorOf(cx, cz), hh = 1.7 * vs;
        for (const [r, h, y, col] of [[0.42, 0.18 * vs, 0, 0xb07894], [0.32, hh, 0.18 * vs, 0xa8a492], [0.4, 0.14 * vs, 0.18 * vs + hh, 0xa8a492]]) {
          const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 12), new THREE.MeshLambertMaterial({ color: col }));
          m.position.set(cx + 0.5, floor + y + h / 2, cz + 0.5); g.add(m);
        }
        // one that leaves a pit behind: a dark square over the drawn floor, shown once it breaks
        if (after !== null && after < floor - 0.1) {
          const pit = new THREE.Mesh(new THREE.PlaneGeometry(0.96, 0.96), new THREE.MeshBasicMaterial({ color: 0x0c0a08 }));
          pit.rotation.x = -Math.PI / 2; pit.position.set(cx + 0.5, floor + 0.02, cz + 0.5); pit.visible = false;
          levelGroup.add(pit); g.userData.pit = pit;
        }
      }
      levelGroup.add(g); return g;
    });
    jamSprings = [];
    // stone slabs: trampolines (raised springs) and sinking lifts, in the ruins' stone colours
    const slab = (x, y, z, col) => {
      const g = new THREE.Group(), t = 0.22;
      const m = new THREE.Mesh(new THREE.BoxGeometry(1.15, t, 1.15), new THREE.MeshLambertMaterial({ color: col }));
      m.position.y = -t / 2; g.add(m);
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.03, 0.8), new THREE.MeshLambertMaterial({ color: 0x6f7a52 }));
      top.position.y = 0.01; g.add(top);
      g.position.set(x, y, z); levelGroup.add(g); return g;
    };
    liftMeshes = (world.lifts || []).map(f => slab(Math.floor(f.x) + 0.5, f.top, Math.floor(f.z) + 0.5, 0x9a9680));
    // maces: chain links and the spiked ball (the ROM's spike ball sprite, a size up, or the scribbled one)
    maceObjs = (world.maces || []).map(m => m.balls.map(() => {
      const links = [1, 2, 3].map(() => { const l = new THREE.Mesh(linkGeo, linkMat); levelGroup.add(l); return l; });
      const rm = rom ? romObjMat('enemy', 'SPK', false) : null, b = new THREE.Sprite(rm || mineMat);
      if (rm) { b.center.set(0.5, OBJ_FOOT); b.scale.set(ROM_SIZE * 1.4, ROM_SIZE * 1.4, 1); } else b.scale.set(0.8, 0.8, 1);
      levelGroup.add(b); return { links, ball: b, rom: !!rm };
    }));
    puffSprites = Array.from({ length: 24 }, () => { const s = new THREE.Sprite(puffMat); s.visible = false; levelGroup.add(s); return s; });
    bossObj = world.boss ? buildBoss() : null;
    springSprites = world.springs.map(sp => {
      if (sp.raised) { jamSprings.push(null); return slab(sp.x, sp.y, sp.z, 0xa8a492); }
      if (rom && jamOn()) {
        const c = jamCopy(jamProps.spring); c.g.position.set(sp.x, sp.y, sp.z); c.g.userData.jam = true;
        jamProps.spring.coil(c.nodes, SPRING_REST); jamSprings.push(c.nodes); levelGroup.add(c.g); return c.g;
      }
      jamSprings.push(null);
      const dm = rom ? romSpringMats(sp.skin) : null;
      if (!dm) return objSprite('spring', sp, springMats[0], 0.95, 0.06);
      const g = springDrum(dm, sp); levelGroup.add(g); return g;
    });
    enemySprites = world.enemies.map(en => objSprite('enemy', en, enemyMat(0, 0, false), 1.05, 0.04));
    // Hunters' spike balls: the ROM's ball (its middle on the anchor) or the scribbled spiky ball
    ballSprites = world.enemies.map(en => {
      if (!en.ball) return null;
      const rm = rom ? romObjMat('enemy', 'SPK', false) : null;
      const s = new THREE.Sprite(rm || mineMat);
      if (rm) { s.center.set(0.5, OBJ_FOOT); s.scale.set(ROM_SIZE, ROM_SIZE, 1); } else s.scale.set(0.6, 0.6, 1);
      levelGroup.add(s); return s;
    });
    monitorSprites = world.monitors.map(mo => {
      const box = rom ? romMonitorBox(mo.kind) : null;
      if (box) { box.position.set(mo.x, mo.y, mo.z); box.userData.rom = true; levelGroup.add(box); return box; }
      const mm = rom ? romMonitorMat(mo.kind) : null;
      if (!mm) return objSprite('monitor', mo, monitorMats[0], 0.85, 0.04);
      const s = bottomSprite(mm, mo.x, mo.y, mo.z, ROM_SIZE, ROM_SIZE, OBJ_FOOT); s.userData.size = ROM_SIZE; s.userData.rom = [mm, mm]; return s;
    });
    mineSprites = world.mines.map(mi => objSprite('mine', mi, mineMat, 0.7, 0.04));
    // Spring Stadium's balloons: the original's frames (type art 0x150, palette line 2: whole 0, popping 3 and 4) standing
    // on the sim's height; otherwise a balloon of our own
    balloonSprites = world.balloons.map(b => {
      const sp = new THREE.Sprite(rom ? romBossMat(0x150, 0, 64, 48, 2) : balloonMat);
      if (rom) { sp.center.set(0.5, 1 - 48 / 64); sp.scale.set(64 * 0.025, 64 * 0.025, 1); } else { sp.center.set(0.5, 0.05); sp.scale.set(0.9, 0.9, 1); }
      sp.userData.rom = rom; levelGroup.add(sp); return sp;
    });
    spikeMesh = world.spikeCells.size ? buildSpikes() : null;
    // Spring Stadium 2's spear: a shaft and a point of our own, risen to the sim's tip
    spearObj = null;
    if (world.spearCells.size) {
      const g = new THREE.Group(), mat = new THREE.MeshLambertMaterial({ color: 0xd8c890 });
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 6), mat); shaft.position.y = -0.5 - 0.2; g.add(shaft);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.4, 6), mat); tip.position.y = -0.2; g.add(tip);
      g.visible = false; levelGroup.add(g); spearObj = g;
    }
    // Volcano Valley: rocks as cobbled blocks of our own (the original's are iso sprites), jet lifts as blue slabs with a
    // glowing underside, fire spots with the original's flame frames (type 120, line 3) or our own fireball glow
    const rockMat = new THREE.MeshLambertMaterial({ color: 0xd8c0a0, map: stoneTex() }), rockGeo = new THREE.BoxGeometry(0.96, 1, 0.96);
    rockObjs = [...world.rocks.entries()].map(([t, top]) => {
      const cx = t % L.width, cz = (t - cx) / L.width, f = Sim.floorAt(L, cx + 0.5, cz + 0.5), h = Math.max(0.2, top - f);
      const m = new THREE.Mesh(rockGeo, rockMat); m.scale.y = h; m.position.set(cx + 0.5, f + h / 2, cz + 0.5); m.userData.cell = t; levelGroup.add(m); return m;
    });
    const jetMat = new THREE.MeshLambertMaterial({ color: 0x3a64c8 }), jetGlow = new THREE.MeshBasicMaterial({ color: 0xffa040 });
    const liftMat = new THREE.MeshLambertMaterial({ color: 0x9aa4b8, emissive: 0x101820 });
    jetObjs = world.jets.map(q => {   // (Volcano Valley's jet lifts glow under; Panic Puppet 2's 18C lifts are plain metal)
      const g = new THREE.Group(), w = q.x1 - q.x0, d = q.z1 - q.z0, pp = q.skin === '18C';
      const slab = new THREE.Mesh(new THREE.BoxGeometry(w, pp ? 0.3 : 0.22, d), pp ? liftMat : jetMat); slab.position.y = pp ? -0.15 : -0.11; g.add(slab);
      if (!pp) { const glow = new THREE.Mesh(new THREE.BoxGeometry(w * 0.6, 0.06, d * 0.6), jetGlow); glow.position.y = -0.25; g.add(glow); }
      g.position.set((q.x0 + q.x1) / 2, q.top, (q.z0 + q.z1) / 2); levelGroup.add(g); return g;
    });
    const moverMat = new THREE.MeshLambertMaterial({ color: 0x8a6a48, map: stoneTex() }), metalMat = new THREE.MeshLambertMaterial({ color: 0x9aa4b8, emissive: 0x101820 });
    moverObjs = world.movers.map(q => {   // (Gene Gadget's 078: metal plates)
      const m = new THREE.Mesh(new THREE.BoxGeometry(q.x1 - q.x0, 0.3, q.z1 - q.z0), q.skin === '078' ? metalMat : moverMat); m.position.set((q.x0 + q.x1) / 2, q.top - 0.15, (q.z0 + q.z1) / 2);
      m.userData.base = [m.position.x, m.position.z]; levelGroup.add(m); return m;
    });
    const sbFrames = rom && world.spikeBalls.length ? romTypeFrames(0x118, 3) : [];
    spikeBallObjs = world.spikeBalls.map(q => {
      const s = sbFrames.length ? bottomSprite(sbFrames[0], q.x, q.y, q.z, ROM_SIZE, ROM_SIZE, OBJ_FOOT) : bottomSprite(mineMat, q.x, q.y, q.z, 0.7, 0.7, 0.04);
      s.userData.frames = sbFrames; return s;
    });
    const fireFrames = rom ? romTypeFrames(0x120, 3) : [];
    fireObjs = world.fireSpots.map(q => {
      const sp = fireFrames.length ? bottomSprite(fireFrames[0], q.x, q.y, q.z, ROM_SIZE, ROM_SIZE, OBJ_FOOT) : (() => { const s = new THREE.Sprite(puffMat); s.scale.set(0.7, 0.7, 1); s.position.set(q.x, q.y + 0.35, q.z); levelGroup.add(s); return s; })();
      sp.userData.frames = fireFrames; sp.userData.at = [q.x, q.y, q.z]; return sp;
    });
    // lava spouts' and fire runs' fireballs (ROM look: object 114's frames)
    const ballFrames = rom && (world.spouts.length || world.fireRuns.length) ? romTypeFrames(0x114, 3) : [];
    // fire bars' fireballs: object 120 (fire, line 3) as the original's records are, or our own glow
    barObjs = world.fireBars.flatMap(() => Array.from({ length: 6 }, () => {
      const sp = fireFrames.length ? bottomSprite(fireFrames[0], 0, 0, 0, ROM_SIZE, ROM_SIZE, OBJ_FOOT) : (() => { const s = new THREE.Sprite(puffMat); s.scale.set(0.6, 0.6, 1); levelGroup.add(s); return s; })();
      sp.userData.frames = fireFrames; return sp;
    }));
    fireballObjs = (world.spouts.length || world.fireRuns.length) ? Array.from({ length: 24 }, () => {
      const s = ballFrames.length ? bottomSprite(ballFrames[0], 0, 0, 0, ROM_SIZE, ROM_SIZE, 0.5) : (() => { const q = new THREE.Sprite(puffMat); q.scale.set(0.55, 0.55, 1); levelGroup.add(q); return q; })();
      s.visible = false; s.userData.frames = ballFrames; return s;
    }) : [];
    // Diamond Dust's ice spikes: the original's object art (type 0E8, palette line 0) on each cell, or pale cones of our own;
    // gone when a roll breaks them
    const iceConeGeo = new THREE.ConeGeometry(0.1, 0.55, 6), iceConeMat = new THREE.MeshLambertMaterial({ color: 0xc8dcff, emissive: 0x203050 });
    iceSpikeObjs = [...world.iceSpikes.keys()].map(t => {
      const cx = t % L.width, cz = (t - cx) / L.width, x = cx + 0.5, z = cz + 0.5;
      let o;
      if (rom) { o = new THREE.Sprite(romBossMat(0xE8, 0, 64, 48, 0)); o.center.set(0.5, 1 - 48 / 64); o.scale.set(64 * 0.025, 64 * 0.025, 1); }
      else {
        o = new THREE.Group();
        for (const [ox, oz, h] of [[-0.22, -0.2, 0.8], [0.2, -0.22, 1], [0, 0.02, 1.25], [-0.2, 0.22, 0.9], [0.22, 0.2, 0.75]]) {
          const c = new THREE.Mesh(iceConeGeo, iceConeMat); c.scale.y = h; c.position.set(ox, 0.275 * h, oz); o.add(c);
        }
      }
      o.position.set(x, Sim.floorAt(L, x, z), z); o.userData.cell = t; levelGroup.add(o); return o;
    });
    // Rusty Ruin's spiked crawlers: the original's eight turning frames (object art by type), centred on the sim's height
    crawlerSprites = world.crawlers.map(c => {
      const sp = new THREE.Sprite(rom ? romBossMat(0xAC, 0, 64, 40) : mineMat);
      if (rom) { sp.center.set(0.5, 1 - 50 / 64); sp.scale.set(64 * 0.025, 64 * 0.025, 1); } else sp.scale.set(0.6, 0.6, 1);
      sp.userData.rom = rom; levelGroup.add(sp); return sp;
    });
    turretSprites = world.turrets.map(tu => objSprite('turret', tu, turretMat, 0.95, 0.04));
    shotSprites = [];
    const small = world.sprinklers.length || world.beams.length || (world.boss && world.boss.kind === 'pp');   // (small shots, many at once)
    for (let i = 0; i < (small ? 40 : 12); i++) { const s = new THREE.Sprite(shotMat); s.scale.set(small ? 0.25 : 0.35, small ? 0.25 : 0.35, 1); s.visible = false; levelGroup.add(s); shotSprites.push(s); }
    // Gene Gadget: sprinklers (object 07C: 17 frames by their angle, mirrored past half a turn), the barriers' pylons (06C,
    // five frames, gone with their barrier) and zaps on the floor (068: lit, then eight frames of sparks); otherwise our
    // own: a purple drum with a nozzle, grey posts and a crackling sheet between them, a yellow glow and a spark
    sprinklerObjs = world.sprinklers.map(q => {
      if (rom) { const sp = bottomSprite(romBossMat(0x7C, 0, ROM_CANVAS, 80, 3), q.x, q.y, q.z, ROM_SIZE, ROM_SIZE, OBJ_FOOT); sp.userData.rom = true; return sp; }
      const g = new THREE.Group(), body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.45, 12), new THREE.MeshLambertMaterial({ color: 0x8a4ec0 }));
      const nz = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 8), new THREE.MeshLambertMaterial({ color: 0x3a3a48 }));
      body.position.y = 0.22; nz.rotation.x = Math.PI / 2; nz.position.set(0, 0.5, 0.15); g.add(body, nz); g.position.set(q.x, q.y, q.z); levelGroup.add(g); return g;
    });
    const postMat = new THREE.MeshLambertMaterial({ color: 0x8890a0 }), tipMat = new THREE.MeshBasicMaterial({ color: 0xffe060 });
    // props (Gene Gadget's doors 070 and pads 074, Panic Puppet's door 184): the original's frame in the ROM look (the door
    // with a key slides open, frames 7 to 1, while it is held); a grey door of our own
    const keyCells = world.gates.filter(g => g.key !== null).flatMap(g => g.cells);
    for (const q of world.L.entities.filter(e => e.type === 'prop')) {
      if ((q.skin === '070' || q.skin === '184') && keyCells.some(([cx, cz]) => Math.hypot(cx + 0.5 - q.x, cz + 0.5 - q.z) < 2)) continue;   // (drawn by its gate)
      if (rom) { bottomSprite(romBossMat(parseInt(q.skin, 16), q.frame, ROM_CANVAS, 80, 3), q.x, q.y, q.z, ROM_SIZE, ROM_SIZE, OBJ_FOOT); continue; }
      if (q.skin !== '070') continue;
      const d = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.4, 0.15), postMat); d.position.set(q.x, q.y + 0.7, q.z); levelGroup.add(d);
    }
    // Panic Puppet's Flicky capsules (19C: the original's frame) or a glass jar of our own with the bird inside; gone once
    // broken. Levers (194) at the middle of their switch cells: frame 0 for 0, 7 for 1, swung in between; or a post and a
    // knob of our own tilted the way the belt goes
    // Sonic heads (object art 0x3E5C8, 16 frames turning, palette line 2) or tokens of our hero's face
    headObjs = world.heads.map(h => rom ? bottomSprite(romBossMat(0x44, 0, ROM_CANVAS, 80, 2), h.x, h.y, h.z, ROM_SIZE, ROM_SIZE, OBJ_FOOT)
      : bottomSprite(headMats[0], h.x, h.y, h.z, 0.6, 0.6, 0.04));
    headObjs.forEach(s => { s.userData = { rom }; });
    // Tails and Knuckles: their own frames from the ROM (palette line 2), or our two pals; a bubble shows the rings
    // given while one takes them
    friendObjs = world.friends.map(f => {
      const s = rom ? bottomSprite(romBossMat(f.who === 'tails' ? 0x15C : 0x160, 0, ROM_CANVAS, 80, 2), f.x, f.y, f.z, ROM_SIZE, ROM_SIZE, OBJ_FOOT)
        : bottomSprite(palMat(f.who === 'tails' ? 0 : 1, 0, 0), f.x, f.y, f.z, 1.1, 1.1, 0.04);
      s.userData = { who: f.who, rom }; return s;
    });
    {
      const c = document.createElement('canvas'); c.width = 128; c.height = 64;
      friendBubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
      friendBubble.scale.set(0.9, 0.45, 1); friendBubble.renderOrder = 6; friendBubble.visible = false; friendBubble.userData = { canvas: c, n: -1 }; levelGroup.add(friendBubble);
    }
    capsuleObjs = world.capsules.map(c => {
      if (rom) return bottomSprite(romBossMat(0x19C, 0, ROM_CANVAS, 80, c.line), c.x, c.y, c.z, ROM_SIZE, ROM_SIZE, OBJ_FOOT);
      const g = new THREE.Group(), floor = Sim.floorAt(L, c.x, c.z), h = c.top - floor, r = c.half;
      const glass = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h * 0.8, 16, 1, true), new THREE.MeshLambertMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
      const rim = new THREE.CylinderGeometry(r * 1.06, r * 1.06, h * 0.1, 16), rimMat = new THREE.MeshLambertMaterial({ color: 0x8a8f9c });
      const base = new THREE.Mesh(rim, rimMat), lid = new THREE.Mesh(rim, new THREE.MeshLambertMaterial({ color: 0xff9a2e }));
      glass.position.y = h * 0.5; base.position.y = h * 0.05; lid.position.y = h * 0.95; glass.renderOrder = 2;
      const bird = new THREE.Sprite(flickyMat(c.flicky > 0 ? (c.flicky - 1) & 3 : 0, 0, false)); bird.scale.set(0.5, 0.5, 1); bird.position.y = h * 0.45;
      g.add(base, glass, lid, bird); g.position.set(c.x, floor, c.z); levelGroup.add(g); return g;
    });
    beamPostObjs = world.beams.map(b => {
      if (rom) { const sp = bottomSprite(romBossMat(0x180, BEAM_FRAMES[b.idx], ROM_CANVAS, 80, b.line), b.x, b.y + 0.5, b.z, ROM_SIZE, ROM_SIZE, OBJ_FOOT); sp.userData = { size: ROM_SIZE, rom: true, f: -1 }; return sp; }
      const g = new THREE.Group(), floor = Sim.floorAt(L, b.x, b.z), y0 = Number.isFinite(floor) ? floor : b.y - 0.9, h = b.y - y0 + 0.2;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, h, 8), postMat), tip = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshBasicMaterial({ color: 0x5a5030 }));
      post.position.y = h / 2; tip.position.set(b.dir[0] * 0.12, b.y - y0, b.dir[1] * 0.12); g.add(post, tip); g.position.set(b.x, y0, b.z); g.userData = { tip, f: -1 }; levelGroup.add(g); return g;
    });
    leverObjs = world.levers.map(lv => {
      const near = [...world.switchCells.entries()].filter(([, [reg]]) => reg === lv.reg).map(([t]) => [t % L.width + 0.5, Math.floor(t / L.width) + 0.5])
        .filter(([x, z]) => Math.hypot(x - lv.x, z - lv.z) < 4).sort((a, b) => Math.hypot(a[0] - lv.x, a[1] - lv.z) - Math.hypot(b[0] - lv.x, b[1] - lv.z)).slice(0, 2);
      const x = near.length ? near.reduce((s, q) => s + q[0], 0) / near.length : lv.x, z = near.length ? near.reduce((s, q) => s + q[1], 0) / near.length : lv.z;
      const y = Sim.floorAt(L, x, z), v = world.regs[lv.reg] ? 7 : 0;
      if (rom) { const sp = bottomSprite(romLeverMat(v, lv.line), x, y, z, ROM_SIZE, ROM_SIZE, OBJ_FOOT); sp.userData = { size: ROM_SIZE, f: v, rom: true }; return sp; }
      const g = new THREE.Group(), stick = new THREE.Group();
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.25, 0.3), postMat), rod = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.6, 6), postMat);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshLambertMaterial({ color: 0x2a2a30 }));
      post.position.y = 0.12; rod.position.y = 0.3; knob.position.y = 0.6; stick.add(rod, knob); stick.position.y = 0.2;
      g.add(post, stick); g.position.set(x, y, z); g.userData = { stick, f: v }; levelGroup.add(g); return g;
    });
    pylonObjs = world.L.entities.filter(e => e.type === 'pylon').map(q => {
      if (rom) { const sp = bottomSprite(romBossMat(0x6C, 0, ROM_CANVAS, 80, 3), q.x, q.y, q.z, ROM_SIZE, ROM_SIZE, OBJ_FOOT); sp.userData.opens = q.opens; sp.userData.rom = true; return sp; }
      const g = new THREE.Group(), post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.2, 8), postMat), tip = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), tipMat);
      post.position.y = 0.6; tip.position.y = 1.25; g.add(post, tip); g.position.set(q.x, q.y, q.z); g.userData.opens = q.opens; levelGroup.add(g); return g;
    });
    beamObjs = rom ? [] : world.barriers.map(b => {
      const xs = b.cells.map(c => c[0]), zs = b.cells.map(c => c[1]), y = Sim.floorAt(L, b.cells[0][0] + 0.5, b.cells[0][1] + 0.5);
      const len = b.half === 'n' ? Math.max(...xs) - Math.min(...xs) + 1 : Math.max(...zs) - Math.min(...zs) + 1;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.1), new THREE.MeshBasicMaterial({ color: 0xfff080, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }));
      if (b.half === 'n') m.position.set((Math.min(...xs) + Math.max(...xs) + 1) / 2, y + 0.55, Math.min(...zs) + 0.05);
      else { m.rotation.y = Math.PI / 2; m.position.set(Math.min(...xs) + 0.05, y + 0.55, (Math.min(...zs) + Math.max(...zs) + 1) / 2); }
      m.userData.opens = b.opens; levelGroup.add(m); return m;
    });
    // Gene Gadget's tubes (rides that keep the player's own height): glass pipes along the scripted path, one per pair
    const tubeMat = new THREE.MeshLambertMaterial({ color: 0x9fd8ff, emissive: 0x10283a, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
    const drawn = [];
    for (const h of world.holes) {
      const R = h.ride;
      if (!R || !R.start || Number.isFinite(R.start[1]) || !R.path.length || R.hidden) continue;   // (Panic Puppet's run inside the walls)
      const pts = [new THREE.Vector3(R.start[0], Sim.floorAt(L, h.x, h.z) + 0.45, R.start[2])];
      let [x, y, z] = [pts[0].x, pts[0].y, pts[0].z];
      R.path.forEach(([dx, dy, dz], i) => { x += dx; y += dy; z += dz; if (i % 6 === 5 || i === R.path.length - 1) pts.push(new THREE.Vector3(x, y, z)); });
      const a0 = pts[0], a1 = R.end ? new THREE.Vector3(...R.end.at) : pts[pts.length - 1];
      if (drawn.some(([b0, b1]) => Math.hypot(b0.x - a1.x, b0.z - a1.z) < 3 && Math.hypot(b1.x - a0.x, b1.z - a0.z) < 3)) continue;
      drawn.push([a0, a1]);
      const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 3, 0.4, 10, false), tubeMat);
      m.renderOrder = 2; levelGroup.add(m);
    }
    zapObjs = world.zapCells.size ? Array.from({ length: 4 }, () => {
      const sp = rom ? bottomSprite(romBossMat(0x68, 8, ROM_CANVAS, 80, 3), 0, 0, 0, ROM_SIZE, ROM_SIZE, OBJ_FOOT) : bottomSprite(puffMat.clone(), 0, 0, 0, 0.9, 0.9, 0.1);
      sp.userData.rom = rom; sp.visible = false; return sp;
    }) : [];
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
      if (jamOn()) {   // Sonic Jam's ring, centred where the original's ring sprite is
        const c = jamCopy(jamProps.ring); c.g.position.set(gl.x, gl.y + lift - 0.8, gl.z); c.g.userData.rom = true; c.g.userData.jam = true;
        levelGroup.add(c.g); return c.g;
      }
      const s = bottomSprite(romRingMat(), gl.x, gl.y + lift, gl.z, ROM_SIZE, ROM_SIZE, 1 - 72 / ROM_CANVAS);
      s.userData.rom = true; return s;
    });
    flickySprites = [];
    for (let i = 0; i < 24; i++) { const s = new THREE.Sprite(flickyMat(0, 0, false)); s.center.set(0.5, 0.08); s.scale.set(0.55, 0.55, 1); s.visible = false; levelGroup.add(s); flickySprites.push(s); }
    // Sonic Jam's Flickies: one holder per slot, with a model per colour made when first needed
    jamFlickies = rom && jamOn() ? flickySprites.map(() => { const g = new THREE.Group(); g.visible = false; levelGroup.add(g); return { g, kinds: [], yaw: 0 }; }) : [];
    goalFx = null;
    $('flickyHud').hidden = !L.flickies;
    if (typeof satScene === 'function' && satReady) satScene();
    looseSprites = [];
    for (let i = 0; i < Math.max(Sim.P.scatterMax, 25); i++) { const s = new THREE.Sprite(rom ? romArt.rings[0] : ringMats[0]);   // (the original lets out 25 at most)
      s.scale.set(0.5, 0.5, 1); s.visible = false; levelGroup.add(s); looseSprites.push(s); }
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
  // ---- 3D Sonic from the player's own Sonic Jam disc (Saturn): parts, textures and moves read by Jam (src/jam.js) ----
  const turn = v => v * Math.PI * 2 / 65536;
  // a set of Jam models' textures in one canvas (shelves), with a white corner for the plain-coloured quads;
  // meshOf turns a part into a mesh, each quad two triangles with its texture stretched corner to corner as VDP1 does
  function jamKit(textures) {
    const W = 256, place = new Map();
    let x = 4, y = 0, rowH = 4;
    for (const [key, t] of textures) { if (x + t.w > W) { x = 0; y += rowH; rowH = 0; } place.set(key, [x, y]); x += t.w; rowH = Math.max(rowH, t.h); }
    let H = 4; while (H < y + rowH) H *= 2;
    const cnv = document.createElement('canvas'); cnv.width = W; cnv.height = H;
    const g = cnv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 4, 4);
    for (const [key, t] of textures) { const [px, py] = place.get(key); g.putImageData(new ImageData(t.px, t.w, t.h), px, py); }
    const map = new THREE.CanvasTexture(cnv);
    map.magFilter = THREE.NearestFilter; map.minFilter = THREE.NearestFilter; map.generateMipmaps = false; map.flipY = false;
    const mat = new THREE.MeshLambertMaterial({ map, vertexColors: true, side: THREE.DoubleSide, alphaTest: 0.5 });
    const meshOf = part => {
      const pos = [], nrm = [], uv = [], col = [], white = [[1 / W, 1 / H], [3 / W, 1 / H], [3 / W, 3 / H], [1 / W, 3 / H]];
      const fa = new THREE.Vector3(), fb = new THREE.Vector3(), fn = new THREE.Vector3();
      for (const q of part.quads) {
        let uvs = white, c = [1, 1, 1];
        if (q.key && place.has(q.key)) {
          const t = textures.get(q.key), [px, py] = place.get(q.key);
          let u0 = px / W, v0 = py / H, u1 = (px + t.w) / W, v1 = (py + t.h) / H;
          if (q.ctrl & 0x10) [u0, u1] = [u1, u0];
          if (q.ctrl & 0x20) [v0, v1] = [v1, v0];
          uvs = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
        } else { const v = q.colour; c = [(v & 31) / 31, ((v >> 5) & 31) / 31, ((v >> 10) & 31) / 31]; }
        // parts without normals are lit flat: one normal per quad from its first three corners
        let flat = null;
        if (!part.hasN) {
          const [a, b, d] = [0, 1, 2].map(k => part.verts[q.idx[k]]);
          fa.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]); fb.set(d[0] - a[0], d[1] - a[1], d[2] - a[2]);
          fn.crossVectors(fa, fb); if (fn.lengthSq() < 1e-9) fn.set(0, 1, 0); fn.normalize(); flat = [fn.x, fn.y, fn.z];
        }
        for (const k of [0, 1, 2, 0, 2, 3]) { pos.push(...part.verts[q.idx[k]]); nrm.push(...(flat || part.normals[q.idx[k]])); uv.push(...uvs[k]); col.push(...c); }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      const mesh = new THREE.Mesh(geo, mat); mesh.userData.jam = true;   // shared by every copy: never disposed with a level
      return mesh;
    };
    return { meshOf };
  }
  function buildHero3d(data) {
    const S = Jam.sonic(data.museum, data.sprdata), { meshOf } = jamKit(S.textures);
    // root (place, facing) > lift (feet on the floor) > anim (each frame's global move) > body > limbs
    const root = new THREE.Group(), lift = new THREE.Group(), anim = new THREE.Group();
    root.add(lift); lift.add(anim);
    const nodes = S.parts.map((pt, k) => { const n = new THREE.Group(); n.position.fromArray(S.offsets[k]); n.add(meshOf(pt)); return n; });
    nodes.forEach((n, k) => (S.parent[k] < 0 ? anim : nodes[S.parent[k]]).add(n));
    const ball = new THREE.Group(); ball.add(meshOf(S.ball)); lift.add(ball); ball.visible = false;
    const h = { root, lift, anim, nodes, ball, S, scale: 1, clip: '', t: 0 };
    // size: the idle pose stands about 1.05 m tall with its lowest point on the floor
    poseHero3d(h, 'idle', 0);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(anim);
    h.scale = 1.05 / Math.max(1e-3, box.max.y - box.min.y);
    lift.position.y = -box.min.y;
    // the ball spins about its own middle and rests on the floor
    const bb = new THREE.Box3().setFromObject(ball.children[0]), c = new THREE.Vector3(); bb.getCenter(c);
    ball.children[0].position.sub(c); ball.scale.setScalar(0.8); ball.position.y = (bb.max.y - bb.min.y) / 2 * 0.8 + box.min.y;
    root.scale.setScalar(h.scale);
    scene.add(root);
    return h;
  }
  function poseHero3d(h, clip, frame) {
    const frames = h.S.anims[clip], f = frames[((Math.floor(frame) % frames.length) + frames.length) % frames.length];
    h.anim.position.fromArray(f.pos); h.anim.rotation.set(turn(f.rot[2]), turn(f.rot[1]), turn(f.rot[0]), 'ZYX');
    h.nodes.forEach((n, k) => { const r = f.rots[k]; n.rotation.set(turn(r[2]), turn(r[1]), turn(r[0]), 'ZYX'); });
  }
  // ---- Sonic World objects from the same disc: palms, springs, the big ring and Flickies (Jam.props) ----
  function buildJamProps(data) {
    const P = Jam.props(data.museum, data.sprdata), { meshOf } = jamKit(P.textures);
    // a model as nested groups: part k at its offset, under its parent part when the model has a tree
    const modelOf = (G, parent) => {
      const anim = new THREE.Group();
      const nodes = G.parts.map((pt, k) => { const n = new THREE.Group(); n.position.fromArray(G.offsets[k]); n.add(meshOf(pt)); return n; });
      nodes.forEach((n, k) => (parent && parent[k] >= 0 ? nodes[parent[k]] : anim).add(n));
      return { anim, nodes };
    };
    // stand a model on y = 0 (y-down models turned over), `size` metres along `axis`; the wrapper is what gets placed
    const stand = (anim, size, axis, yDown) => {
      const fit = new THREE.Group(), w = new THREE.Group(); fit.add(anim); w.add(fit);
      if (yDown) fit.scale.y = -1;
      w.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(fit), s = size / (box.max[axis] - box.min[axis]);
      fit.position.y = -box.min.y; w.scale.setScalar(s);
      return { w, fit, s };
    };
    const palm = modelOf(P.palm), spring = modelOf(P.spring), ring = modelOf(P.bigRing);
    const out = {
      palm: stand(palm.anim, 80 / 32, 'y', true),          // as tall as the original's palm picture (80 units)
      spring: stand(spring.anim, 0.92, 'x', true),         // as wide as the drum it replaces
      ring: stand(ring.anim, 1.6, 'y', false),             // as wide as the original's ring sprite (64 px)
      flickies: P.flickies.map(G => { const m = modelOf(G, P.flickyParent); return { ...m, ...stand(m.anim, 0.42, 'y', false) }; }),
      fly: P.fly,
      waterfall: P.waterfall,
    };
    // the spring's coil (part 1, from its top at y = -c up to 0 in the model's y-down units) squashes at rest and
    // stretches when fired; its pad (part 0) rides on top
    const cg = spring.nodes[1].children[0].geometry; cg.computeBoundingBox();
    const c = -cg.boundingBox.min.y, pad0 = spring.nodes[0].position.y;
    out.spring.nodes = spring.nodes;
    out.spring.coil = ([pad, coil], k) => { coil.scale.y = k; pad.position.y = pad0 + c * (1 - k); };
    out.palm.nodes = palm.nodes;
    return out;
  }
  // a copy of a prop, with its parts found again by their place in the tree
  function jamCopy(prop, nodes = prop.nodes || []) {
    const g = prop.w.clone(), a = [], b = [];
    prop.w.traverse(o => a.push(o)); g.traverse(o => b.push(o));
    return { g, nodes: nodes.map(n => b[a.indexOf(n)]), anim: prop.anim ? b[a.indexOf(prop.anim)] : null };
  }
  function poseJam(nodes, anim, f) {
    anim.position.fromArray(f.pos); anim.rotation.set(turn(f.rot[2]), turn(f.rot[1]), turn(f.rot[0]), 'ZYX');
    nodes.forEach((n, k) => { const r = f.rots[k]; n.rotation.set(turn(r[2]), turn(r[1]), turn(r[0]), 'ZYX'); });
  }
  // top running speed: the original's on converted levels (Sim.P.orig), ours otherwise
  const runRef = () => (L && L.phys && L.phys.orig ? Sim.P.orig.run : Sim.P.run);
  // each frame: pick the move from the sim state, like the sprite hero does
  function updateHero3d(p, rp, dt, t) {
    const h = hero3d, sp = Math.hypot(p.vx, p.vz), run = runRef();
    h.root.position.copy(rp); h.root.rotation.y = p.facing + Math.PI / 2;   // the model faces its -x
    h.root.visible = !(p.invuln > 0 && !(p.knockT > 0) && Math.floor(t * 16) % 2);   // (no blinking while thrown back)
    const balled = p.charge > 0 || p.ball || p.rolling;
    h.ball.visible = balled; h.anim.visible = !balled;
    if (balled) { h.ball.rotation.z -= dt * Math.max(sp, p.charge > 0 ? 14 : 8) * 1.6; return; }
    if (p.whirl) h.root.rotation.y = t * 18;   // a whirl: spun round like a top, standing
    // a skid is over in a tenth of a second at the sim's braking; its animation plays through once all the same
    // (converted levels: the original's skid animations 4, 5 and 6 from the sim's pick; ours by speed and stick)
    const skidNow = world.L.rom && world.L.phys.orig ? p.anim >= 4 && p.anim <= 6 : p.skid;
    if (skidNow && !h.wasSkid) h.skidT = h.S.anims.skid.length / 30;
    h.wasSkid = skidNow; h.skidT = Math.max(0, (h.skidT || 0) - dt);
    let clip, rate = 30;
    if (!p.grounded) clip = p.sprung || p.hover ? 'spring' : 'fall';   // (hovering: arms up)
    else if (skidNow || h.skidT > 0) clip = 'skid';
    else if (sp < 0.3 || p.whirl) clip = 'idle', rate = 15;
    else if (sp < run * 0.55) clip = 'walk', rate = 30 * Math.max(0.4, sp / (run * 0.4));
    else if (sp < run * 1.1) clip = 'run', rate = 30 * Math.max(0.7, sp / run);
    else clip = 'sprint', rate = 30 * Math.min(1.6, sp / run);
    if (clip !== h.clip) { h.clip = clip; h.t = 0; }
    h.t += dt * rate;
    if (clip === 'spring' || clip === 'fall' || clip === 'skid') h.t = Math.min(h.t, h.S.anims[clip].length - 1);
    poseHero3d(h, clip, h.t);
  }

  // frozen by snow: a block of ice of our own round the hero (the original draws its own block sprite)
  const iceBlock = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.05, 0.8), new THREE.MeshLambertMaterial({ color: 0xbfe0ff, emissive: 0x284060, transparent: true, opacity: 0.55, depthWrite: false }));
  iceBlock.visible = false; iceBlock.renderOrder = 4; scene.add(iceBlock);
  const shieldSprite = new THREE.Sprite(shieldMats.shield); shieldSprite.scale.set(1.25, 1.25, 1); shieldSprite.visible = false; shieldSprite.renderOrder = 5; scene.add(shieldSprite);
  const stars = Array.from({ length: 4 }, () => { const s = new THREE.Sprite(starMat); s.scale.set(0.3, 0.3, 1); s.visible = false; scene.add(s); return s; });
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.34, 20), new THREE.MeshBasicMaterial({ color: 0x1a1430, transparent: true, opacity: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  scene.add(shadow);
  const look3 = { facingLeft: false, view: 'front', idleFor: 0, runCycle: 0, ballCycle: 0, oct: 0, romCycle: 0 };
  // which ROM frame to show: view from the heading on screen, pose from the sim
  function romHeroPick(pose, sp, sx, sf, t, dt) {
    if (pose === 'whirl') look3.oct = Math.floor(t * 16) % 8;          // a whirl: the standing frame turned round fast
    else if (sp > 0.6) look3.oct = ((Math.round(Math.atan2(sx, -sf) / (Math.PI / 4)) % 8) + 8) % 8;
    const [v, flip] = S3D.OCTANT[look3.oct], side = !look3.facingLeft; // ball and charge frames face left as stored
    if (pose === 'whirl') return [v, flip];
    if (pose === 'charge') { const q = S3D.HERO.charge(); return [q[Math.floor(t * 20) % q.length], side]; }
    if (pose === 'ball' || pose === 'spring') { const q = S3D.HERO.ball(); return [q[Math.floor(look3.ballCycle * 2) % q.length], side]; }
    if (pose === 'run' || pose === 'air') {
      look3.romCycle += dt * (6 + sp * 2.2);
      const q = sp > runRef() * 0.75 ? S3D.HERO.run(v) : S3D.HERO.walk(v);
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
  const camPt = new THREE.Vector3();
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

  // ---- Saturn screen: what made Saturn 3D look the way it did, imitated with no Saturn data ----
  // The scene is drawn into a 224-line target with no smoothing and shown with hard pixels in 15-bit colour; textures
  // on 3D faces are mapped without perspective correction (the wobble of the Saturn's distorted sprites); anything
  // see-through becomes a checkerboard of dropped pixels (the Saturn's mesh transparency); textures are not filtered.
  let saturn = store.get(SCREEN_KEY) === 'saturn';
  const satTarget = new THREE.WebGLRenderTarget(320, 224, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  const postScene = new THREE.Scene(), postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: { tex: { value: satTarget.texture } }, depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform sampler2D tex; varying vec2 vUv; void main() { vec3 c = texture2D(tex, vUv).rgb; gl_FragColor = vec4(floor(c * 31.0 + 0.5) / 31.0, 1.0); }',
  })));
  const SAT_DITHER = `
    if (SAT_ON && gl_FragColor.a < 0.99) {
      if (gl_FragColor.a < 0.12 || mod(floor(gl_FragCoord.x) + floor(gl_FragCoord.y), 2.0) < 1.0) discard;
      gl_FragColor.a = 1.0;
    }`;
  // patch a material once; its program is rebuilt when the screen setting changes (the cache key includes it)
  function satPatch(m, affine) {
    if (!m || m.userData.sat) return;
    m.userData.sat = true;
    const prevKey = m.customProgramCacheKey ? m.customProgramCacheKey.bind(m) : () => '';
    m.customProgramCacheKey = () => prevKey() + (saturn ? '|sat' : '|mod');
    m.onBeforeCompile = sh => {
      sh.fragmentShader = '#define SAT_ON ' + (saturn ? 'true' : 'false') + '\n' + sh.fragmentShader.replace(/}\s*$/, SAT_DITHER + '\n}');
      if (!saturn || !affine || !sh.fragmentShader.includes('#include <map_fragment>')) return;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vAffUv; varying float vAffW;')
        .replace('#include <project_vertex>', '#include <project_vertex>\n#ifdef USE_UV\nvAffUv = vUv * gl_Position.w; vAffW = gl_Position.w;\n#endif');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vAffUv; varying float vAffW;')
        .replace('#include <map_fragment>', THREE.ShaderChunk.map_fragment.replace('vUv', '(vAffUv / vAffW)'));
    };
    m.needsUpdate = true;
  }
  const satMin = new WeakMap();   // textures' own minification filters, put back when the Saturn screen is off
  function satScene(root = scene) {
    root.traverse(o => {
      for (const m of [].concat(o.material || [])) {
        satPatch(m, o.isMesh);
        if (m.map) { if (!satMin.has(m.map)) satMin.set(m.map, m.map.minFilter); const f = saturn ? THREE.NearestFilter : satMin.get(m.map); if (m.map.minFilter !== f) { m.map.minFilter = f; m.map.needsUpdate = true; } }
      }
    });
  }
  function setSaturn(on) {
    saturn = on; store.set(SCREEN_KEY, on ? 'saturn' : 'modern');
    satScene();
    scene.traverse(o => { for (const m of [].concat(o.material || [])) if (m.userData.sat) m.needsUpdate = true; });
    for (const m of Object.values(shieldMats)) { satPatch(m, false); m.needsUpdate = true; }
    $('screenSel').value = on ? 'saturn' : 'modern';
  }
  function satSize() {
    const w = window.innerWidth, h = window.innerHeight;
    satTarget.setSize(Math.max(1, Math.round(224 * w / h)), 224);
  }
  window.addEventListener('resize', satSize); satSize();
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
    const c = world.cam, turned = Math.abs(((view.yawTarget - Math.PI / 4) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI)) > 1e-3;
    if (c && world.L.rom && world.L.phys.orig && !turned) {
      // the original's own scroll (Sim's origCamera): the middle of its 320 x 224 picture, at his height
      const o = world.L.rom.origin, vs = world.L.rom.vscale, Ys = rp.y * 32 / vs - 8, u = c.X + 160 - 0x1000, v = 2 * (c.Y + 112 + Ys);
      view.target.set((u + v) / 64 - o[0], rp.y, (v - u) / 64 - o[1]);
    } else { view.target.x += (tx - view.target.x) * k; view.target.y += (rp.y + 0.4 - view.target.y) * k; view.target.z += (tz - view.target.z) * k; }
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
    if (!looking && sp > runRef() * 1.1) {
      let d = Math.atan2(-p.vx, -p.vz) - yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      yaw += d * Math.min(1, dt * 1.6 * Math.min(1, (sp - runRef()) / 8));
    }
    // a boss: swing round behind the player so it stays in front (gently, and not when it is right overhead)
    const bo = world.boss && world.boss.dead < 0 && !world.boss.hidden ? world.boss : null;   // (Final Fight's is gone between fights)
    if (bo && !looking) {
      const bd = Math.hypot(fx - bo.x, fz - bo.z);
      let d = Math.atan2(fx - bo.x, fz - bo.z) - yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      yaw += d * Math.min(1, dt * 1.2 * Math.min(1, Math.max(0, bd - 1.5) / 2));
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
    if (bo) {   // and tilt up towards it, so a boss overhead is in the picture (not one far up: Final Fight's fists fight then)
      view.look.x += (bo.x - fx) * 0.3; view.look.z += (bo.z - fz) * 0.3; view.look.y += Math.max(0, Math.min(4, bo.y - focusY)) * 0.45;
    }
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
    else if (e.code === 'KeyM' && !e.repeat) { const off = Sfx.toggle(); toast(off ? 'Sound off. M turns it back on.' : 'Sound on.', 1.6); if (!off) startSound(); }
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
  function startSound() {
    Sfx.unlock();
    if (!romBytes || Sfx.muted) return;
    MdSound.start(romBytes).then(ok => { if (ok) { MdSound.pause(false); levelMusic(); } });
  }
  function start() { startSound(); started = true; $('helpOverlay').hidden = true; canvas.focus(); }
  function openHelp() { MdSound.pause(true); started = false; $('playBtn').textContent = 'Resume'; $('restartBtn').hidden = false; $('helpOverlay').hidden = false; }
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
    world = Sim.createWorld(L); heroAnim = null;
    buildLevelObjects(); resetCamera(); restart();
    showLevelName(); levelMusic(); titleCard();
  }
  // the act's title card in the ROM's fonts (ROM look, converted levels), over the level for two seconds, then away
  // to the left as the original's goes
  function titleCard() {
    const c = $('titleCanvas'), box = $('titleCard');
    if (!(romOn() && L.rom)) { box.hidden = true; return; }
    const entry = S3D.LEVELS.find(l => l[0] === L.rom.level), name = entry ? entry[1] : L.name, m = name.match(/^(.*\D)\s*(\d)$/);
    const img = S3D.titleCardImage(romArt.d, m ? m[1].trim() + ' Zone' : name, m ? +m[2] : 0);
    c.getContext('2d').putImageData(new ImageData(img.px, img.width, img.height), 0, 0);
    box.hidden = false; box.classList.remove('away'); void box.offsetWidth;
    clearTimeout(titleCard.t); titleCard.t = setTimeout(() => { box.classList.add('away'); titleCard.t = setTimeout(() => { box.hidden = true; }, 600); }, 2200);
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
    get(key = 'rom') { return this.run('readonly', s => s.get(key)).catch(() => null); },
    put(bytes, key = 'rom') { return this.run('readwrite', s => s.put(bytes, key)).then(() => true, () => false); },
    del(key = 'rom') { return this.run('readwrite', s => s.delete(key)).catch(() => null); },
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
    romStore.del(); romBytes = null; romArt = null; $('romPick').hidden = true; MdSound.pause(true);
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
  // the Sonic Jam disc: only its two Sonic World files are kept (in this browser), never the whole image
  function useJam(data) {
    try {
      if (hero3d) { scene.remove(hero3d.root); hero3d = null; }
      hero3d = buildHero3d(data);
      try { jamProps = buildJamProps(data); } catch (e) { jamProps = null; console.warn('Sonic Jam objects:', e.message); }
      if (levelGroup) buildLevelObjects();
      if (satReady) satScene();
      $('jamPick').hidden = false; $('heroSel').value = heroMode;
      return true;
    } catch (e) { setLoadMsg(['Sonic could not be read from this disc: ' + e.message + '.'], 'jamMsg'); return false; }
  }
  romStore.get('jam').then(v => { if (v && v.museum && !hero3d) useJam({ museum: new Uint8Array(v.museum), sprdata: new Uint8Array(v.sprdata) }); });
  $('jamFile').addEventListener('change', async e => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setLoadMsg(['Reading the disc…'], 'jamMsg');
    try {
      const data = await Jam.openDisc(file);
      if (!useJam(data)) return;
      setLoadMsg([], 'jamMsg');
      romStore.put({ museum: data.museum, sprdata: data.sprdata }, 'jam').then(kept => { if (!kept) setLoadMsg(['Using the disc for this visit only: the browser would not keep a copy.'], 'jamMsg'); });
    } catch (err) { setLoadMsg([err.message + '.'], 'jamMsg'); }
  });
  $('heroSel').addEventListener('change', () => { heroMode = $('heroSel').value === 'sprite' ? 'sprite' : '3d'; store.set(HERO_KEY, heroMode); if (levelGroup) buildLevelObjects(); });
  $('jamForget').addEventListener('click', () => {
    romStore.del('jam'); if (hero3d) { scene.remove(hero3d.root); hero3d = null; }
    jamProps = null; if (levelGroup) buildLevelObjects();
    $('jamPick').hidden = true; setLoadMsg(['Forgotten: this browser no longer keeps the Sonic Jam files.'], 'jamMsg');
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

  let cleared = false, clearTimer = 0, wasCharging = false;
  // a white flash when a big ring is used, as in the original
  function flash() { const f = $('flash'); f.classList.remove('on'); void f.offsetWidth; f.classList.add('on'); }
  // a cut, as the original fades: from black back to the scene (a pocket after a ring, a ride that starts elsewhere)
  function fadeCut() { const f = $('fade'); f.classList.remove('on'); void f.offsetWidth; f.classList.add('on'); }
  function clearCardOff() { $('clearCard').hidden = true; $('tally').hidden = true; tally = null; clearTimeout(clearTimer); clearTimer = 0; }
  // act clear: show the result, then move on to the next act in the original's order (ROM levels)
  // act results: in the ROM look the original's own results screen (fonts and layout from the ROM, bonuses counted
  // into the score), otherwise a plain card; then the next act in the original's order (ROM levels)
  // Bonus rules (the results routine 0x2180C, in hundreds): time 100 under a minute, halved each minute after (50, 25,
  // 12, 6, 3, 1), none from 7 minutes; 1 a ring; 50 for each five Flickies taken to a ring (0xCDB6); 1 a ring given
  // to Knuckles and to Tails
  let tally = null;
  function timeBonus(secs) { const m = Math.floor(secs / 60); return m < 7 ? [100, 50, 25, 12, 6, 3, 1][m] * 100 : 0; }
  function drawTally(now) {
    const k = Math.max(0, Math.min(1, (now - tally.t0 - 1.5) / 2.5)), left = tally.bonus.map(b => Math.round(b * (1 - k)));
    const total = tally.bonus.reduce((a, b) => a + b, 0), shown = Math.round(total * k);
    const key = shown;
    if (tally.key === key) return;
    tally.key = key;
    const img = S3D.tallyImage(romArt.d, { kind: tally.kind, act: tally.act, time: tally.time, score: tally.score0 + shown, bonus: left, total: shown });
    const c = $('tallyCanvas'); c.getContext('2d').putImageData(new ImageData(img.px, img.width, img.height), 0, 0);
    $('tally').style.background = `rgb(${img.background.join(',')})`;
    if (k > 0 && k < 1 && Math.floor(now * 12) % 2) Sfx.play('tick');
  }
  function actClear() {
    const idx = L.rom ? S3D.LEVELS.findIndex(l => l[0] === L.rom.level) : -1, here = idx >= 0 ? S3D.LEVELS[idx][1] : L.name;
    // (the Final Fight comes after Panic Puppet 3 only with all seven Chaos Emeralds, as in the original)
    let next = idx >= 0 && romBytes ? S3D.LEVELS[idx + 1] : null;
    const locked = next && next[0] === 22 && emeraldCount() < 7, secs = Math.floor(world.time);
    if (locked) next = null;
    const time = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    let wait = 5000;
    // the score so far: earlier acts' (with their bonuses) and this act's own (enemies, bosses, Flickies)
    const score0 = score + world.score * 100, bonuses = [timeBonus(secs), world.ringCount * 100, Math.floor(world.saved / 5) * 5000, world.friendRings.knuckles * 100, world.friendRings.tails * 100];
    score = score0 + bonuses.reduce((a, b) => a + b, 0);
    if (romOn() && L.rom) {
      const act = Number((here.match(/(\d)$/) || [0, 1])[1]);
      tally = { t0: performance.now() / 1000, act, time, score0, bonus: bonuses, key: null };
      $('tally').hidden = false; drawTally(tally.t0); wait = 7000;
    } else {
      $('clearTitle').textContent = `${here} clear`;
      $('clearInfo').textContent = `Rings ${world.ringCount}   Time ${time}   Score ${score}` + (next ? `\nNext: ${next[1]}` : '\nOpen ? to play again or choose another level.');
      $('clearCard').hidden = false;
    }
    clearTimeout(clearTimer);
    clearTimer = setTimeout(() => {
      clearCardOff();
      if (!next) { if (locked) toast(`The Final Fight needs all seven Chaos Emeralds (you have ${emeraldCount()}). Give Tails and Knuckles fifty rings an act. It is also in the level list.`, 8); else if (tally) toast('That was the last act. Open ? to play again or choose another level.', 5); return; }
      try {
        const raw = S3D.convert(romBytes, next[0], L.rom.vscale);
        useLevel(Sim.importLevel(raw), true);
        store.set(LEVEL_KEY, JSON.stringify(raw));
        $('romLevel').value = String(next[0]);
        toast(next[1], 2.5);
      } catch (err) { toast('The next level could not be converted: ' + err.message + '.', 4); }
    }, wait);
  }
  function restart() {
    Sim.resetLevel(world); heroAnim = null;
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

  // ---- the special stage: Tails or Knuckles took fifty rings in this act (ROM levels only: the stages are the
  // player's ROM's). The run is the original's own (Sim.bonusStep: its units, its 16.16 fixed point, checked frame
  // by frame against the original), drawn in 3D: the track from its records (64 units wide, y down), the items where
  // the original puts them, and a camera with the original's projection (a focal length of 256 pixels for 224
  // lines, 180 units behind Sonic and eased to 200 above him, its horizon 120 lines over the top of the screen).
  // The track's stone and grating, the river beneath, the spiked balls, the gate posts and the emerald are our own
  // drawing in the stage's own palette colours. ----
  const EM_KEY = 'blastgrid.emeralds';
  const emeraldCount = () => Math.max(0, Math.min(7, Number(store.get(EM_KEY)) || 0));
  const EM_COLORS = [0x37c8ff, 0xffe14a, 0xff5ab0, 0x5cff72, 0xb07aff, 0xff7a3a, 0xf0f0ff];   // ours
  const BU = 1 / 32, bx = x => -x * BU, by = y => -y * BU, bz = z => z * BU;   // (-x: the camera looks along +z)
  let bonus = null;
  const bonusCam = new THREE.PerspectiveCamera(50, 1, 0.1, 40);
  function bonusProjection() {
    const W = window.innerWidth, H = window.innerHeight, f = Math.min(H * 256 / 224, W);
    const py = H * 164 / 224 - f * 200 / 180;   // the principal point: Sonic's feet where the original draws them
    const fullH = 2 * Math.max(H - py, py);
    bonusCam.fov = 2 * Math.atan(fullH / 2 / f) * 180 / Math.PI; bonusCam.aspect = W / fullH;
    bonusCam.setViewOffset(W, fullH, 0, fullH / 2 - py, W, H); bonusCam.updateProjectionMatrix();
  }
  window.addEventListener('resize', () => { if (bonus) bonusProjection(); });
  const css = c => `rgb(${c[0]},${c[1]},${c[2]})`, hex3 = c => (c[0] << 16) | (c[1] << 8) | c[2];
  function bonusTex(draw, w = 64, h = 64) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t;
  }
  // our own surfaces in the stage's colours: stone slabs (Knuckles' stages) or a steel grating (Tails'), rock or grass
  // banks, and lava or water
  function bonusLook(data) {
    const [scen, trk] = data.pal, lava = data.look === 'lava';
    let s = 7;
    const R = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const deck = bonusTex((g, w, h) => {
      if (lava) {
        g.fillStyle = css(trk[12]); g.fillRect(0, 0, w, h);
        for (let k = 0; k < 40; k++) { g.fillStyle = css(trk[10 + (k % 5)]); g.fillRect(R() * w, R() * h, 2 + R() * 6, 2 + R() * 4); }
        g.fillStyle = css(trk[6]); g.fillRect(0, 0, w, 3); g.fillRect(0, 0, 3, h); g.fillRect(w / 2, 0, 2, h);
        g.strokeStyle = css(trk[8]); g.lineWidth = 1; g.beginPath(); g.moveTo(8 + R() * 20, 6); g.lineTo(14 + R() * 10, 30); g.lineTo(6 + R() * 20, 50); g.stroke();
      } else {
        g.clearRect(0, 0, w, h); g.fillStyle = css(trk[10]);
        for (let k = 0; k < 4; k++) g.fillRect(0, k * 16, w, 4);
        for (let k = 0; k < 8; k++) g.fillRect(k * 8 + 2, 0, 3, h);
        g.fillStyle = css(trk[14]); for (let k = 0; k < 4; k++) g.fillRect(0, k * 16, w, 1);
        g.fillStyle = css(trk[6]); g.fillRect(0, 0, 5, h); g.fillRect(w - 5, 0, 5, h);
      }
    });
    const bank = bonusTex((g, w, h) => {
      g.fillStyle = css(scen[lava ? 3 : 4]); g.fillRect(0, 0, w, h);
      for (let k = 0; k < 70; k++) { g.fillStyle = css(scen[1 + Math.floor(R() * (lava ? 6 : 5))]); g.beginPath(); g.ellipse(R() * w, R() * h, 2 + R() * 7, 1 + R() * 4, R() * 3, 0, 7); g.fill(); }
    });
    const flow = bonusTex((g, w, h) => {
      g.fillStyle = css(scen[lava ? 10 : 11]); g.fillRect(0, 0, w, h);
      for (let k = 0; k < 40; k++) { g.fillStyle = css(scen[lava ? 8 + Math.floor(R() * 4) : 9 + Math.floor(R() * 6)]); g.beginPath(); g.ellipse(R() * w, R() * h, 3 + R() * 10, 1 + R() * 2, 0, 0, 7); g.fill(); }
    });
    bank.repeat.set(1 / 3, 1 / 3);
    return { deck, bank, flow, lava, fog: hex3(scen[lava ? 5 : 2]), side: hex3(trk[lava ? 7 : 5]), items: data.pal[2] };
  }
  // the track: a slab per record pair (two records at one distance make a step), its sides down 40 units (stone) or
  // 10 (the grating)
  function bonusTrack(data, look) {
    const t = data.track, P = [], U = [], C = [], top = [], side = [], deep = look.lava ? 40 : 10;
    const v = (x, y, z, u, w, c) => { P.push(bx(x), by(y), bz(z)); U.push(u, w); C.push(c, c, c); };
    const quad = (list, a, b, c, d, sh) => {   // a b c d: [x, y, z, u, v] round the face
      const i0 = P.length / 3; for (const q of [a, b, c, d]) v(q[0], q[1], q[2], q[3], q[4], sh);
      list.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
    };
    for (let i = 0; i + 1 < t.length; i++) {
      const far = { x: t[i][2], y: t[i][3], d: t[i][1] }, near = { x: t[i + 1][2], y: t[i + 1][3], d: t[i + 1][1] };
      if (far.d === near.d) {   // a step: its face
        if (far.y !== near.y) quad(side, [near.x, near.y, near.d, 0, 0], [near.x + 64, near.y, near.d, 1, 0], [near.x + 64, far.y, near.d, 1, 1], [near.x, far.y, near.d, 0, 1], 0.72);
        continue;
      }
      const sh = (t[i][0] & 1) ? 0.86 : 1, v0 = near.d / 32, v1 = far.d / 32;
      quad(top, [near.x, near.y, near.d, 0, v0], [near.x + 64, near.y, near.d, 1, v0], [far.x + 64, far.y, far.d, 1, v1], [far.x, far.y, far.d, 0, v1], sh);
      for (const e of [0, 64]) quad(side, [near.x + e, near.y, near.d, 0, v0], [far.x + e, far.y, far.d, 0, v1], [far.x + e, far.y + deep, far.d, 1, v1], [near.x + e, near.y + deep, near.d, 1, v0], 0.55);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
    g.setIndex(top.concat(side)); g.addGroup(0, top.length, 0); g.addGroup(top.length, side.length, 1);
    return new THREE.Mesh(g, [new THREE.MeshBasicMaterial({ map: look.deck, vertexColors: true, side: THREE.DoubleSide, alphaTest: 0.5 }),
      look.lava ? new THREE.MeshBasicMaterial({ map: look.deck, vertexColors: true, side: THREE.DoubleSide }) : new THREE.MeshBasicMaterial({ color: look.side, vertexColors: true, side: THREE.DoubleSide })]);
  }
  // the river (lava or water) under the track's path, and the banks: drawn 160 units under Sonic, wherever he is
  function bonusGround(data, look) {
    const g = new THREE.Group(), t = data.track.filter((r, i, a) => !i || r[1] !== a[i - 1][1]), P = [], U = [], I = [];
    t.unshift([0, t[0][1] + 1600, t[0][2], 0]); t.push([0, t[t.length - 1][1] - 1600, t[t.length - 1][2], 0]);   // (on past both ends)
    t.forEach((r, i) => { const cx = r[2] + 32; P.push(bx(cx - 110), 0, bz(r[1]), bx(cx + 110), 0, bz(r[1])); U.push(0, r[1] / 128, 1, r[1] / 128); if (i) { const a = (i - 1) * 2; I.push(a, a + 1, a + 3, a, a + 3, a + 2); } });
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); rg.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); rg.setIndex(I);
    const river = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ map: look.flow, side: THREE.DoubleSide }));
    river.position.y = 0.03;
    const bankMesh = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshBasicMaterial({ map: look.bank }));
    bankMesh.rotation.x = -Math.PI / 2; look.bank.repeat.set(80 / 3, 80 / 3);
    g.add(bankMesh, river); g.userData = { bankMesh, river };
    return g;
  }
  const spikeGeo = (() => {   // a ball with twelve spikes, ours
    const P = new THREE.IcosahedronGeometry(1, 0).attributes.position, dirs = [];
    for (let i = 0; i < P.count; i++) { const d = new THREE.Vector3().fromBufferAttribute(P, i).normalize(); if (!dirs.some(q => q.distanceTo(d) < 1e-3)) dirs.push(d); }
    return { ball: new THREE.SphereGeometry(0.2, 14, 10), spike: new THREE.ConeGeometry(0.06, 0.16, 6), dirs };
  })();
  function bonusItems(data, look, group) {
    const it = look.items, objs = [];
    const spikeMat = new THREE.MeshLambertMaterial({ color: hex3(it[4]) }), tipMat = new THREE.MeshLambertMaterial({ color: hex3(it[7]) });
    const postMat = new THREE.MeshLambertMaterial({ color: hex3(it[12]) }), capMat = new THREE.MeshLambertMaterial({ color: hex3(it[7]), emissive: 0x222222 });
    const gemMat = new THREE.MeshLambertMaterial({ color: EM_COLORS[data.n % 7], emissive: EM_COLORS[data.n % 7], emissiveIntensity: 0.35 });
    const pairs = new Map(), rom = romOn();
    // ROM look: the stage's own spiked ball and ring (their largest frames: 0.533 and 1.067 units a pixel)
    const romSpike = rom && new THREE.SpriteMaterial({ map: pixTex(pixCanvas(S3D.bonusSprite(romArt.d, 'spike', data.pal[2]), 64)), alphaTest: 0.5 });
    const romRing = rom && new THREE.SpriteMaterial({ map: pixTex(pixCanvas(S3D.bonusSprite(romArt.d, 'ring', romArt.pal), 64)), alphaTest: 0.5 });
    data.items.forEach((r, q) => {
      const [d, x, y, k] = r;
      let o = null;
      if (k === 1) { o = new THREE.Sprite(rom ? romRing : ringMats[0]); const s = rom ? 64 * 1.067 * BU : 0.55; o.scale.set(s, s, 1); o.position.set(bx(x), by(y - 8), bz(d)); o.userData.s = s; }
      else if (k === 0 && rom) { o = new THREE.Sprite(romSpike); o.scale.set(64 * 0.533 * BU, 64 * 0.533 * BU, 1); o.position.set(bx(x), by(y - 10), bz(d)); }
      else if (k === 0) {
        o = new THREE.Group(); o.add(new THREE.Mesh(spikeGeo.ball, spikeMat));
        for (const dir of spikeGeo.dirs) { const c = new THREE.Mesh(spikeGeo.spike, tipMat); c.position.copy(dir).multiplyScalar(0.24); c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir); o.add(c); }
        o.position.set(bx(x), by(y - 10), bz(d));
      } else if (k === 2) {
        o = new THREE.Group();
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.9, 10), postMat); pole.position.y = 0.95;
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8), capMat); cap.position.y = 1.95;
        o.add(pole, cap); o.position.set(bx(x), by(y), bz(d));
        if (pairs.has(d)) {   // a beam between the pair: the gate, gone once passed
          const a = pairs.get(d), len = Math.abs(a.position.x - o.position.x);
          const beam = new THREE.Mesh(new THREE.BoxGeometry(len, 0.06, 0.06), new THREE.MeshBasicMaterial({ color: 0xfff27a, transparent: true, opacity: 0.8 }));
          beam.position.set((a.position.x + o.position.x) / 2, (a.position.y + o.position.y) / 2 + 1.7, bz(d)); group.add(beam);
          o.userData.beam = beam; a.userData.beam = beam;
        } else pairs.set(d, o);
        o.userData.cap = cap;
      } else if (k === 3) {
        const c = document.createElement('canvas'); c.width = 128; c.height = 64;
        o = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), alphaTest: 0.1 })); o.scale.set(1.4, 0.7, 1);
        o.position.set(bx(x), by(y - 70), bz(d)); o.userData.canvas = c; o.userData.shown = -1;
      } else if (k === 7) {
        o = new THREE.Group();
        const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.32, 0.14, 8), gemMat), pav = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.4, 8), gemMat);
        crown.position.y = 0.07; pav.rotation.x = Math.PI; pav.position.y = -0.2; o.add(crown, pav); o.position.set(bx(x), by(y - 24), bz(d));
      }
      if (o) { o.userData.k = k; o.userData.q = q; group.add(o); objs.push(o); }
    });
    return objs;
  }
  function signDraw(o, n) {
    if (o.userData.shown === n) return;
    o.userData.shown = n;
    const g = o.userData.canvas.getContext('2d'); g.clearRect(0, 0, 128, 64);
    g.fillStyle = 'rgba(16,12,30,0.75)'; g.fillRect(4, 4, 120, 56); g.strokeStyle = '#ffd34a'; g.lineWidth = 4; g.strokeRect(4, 4, 120, 56);
    g.fillStyle = '#ffd34a'; g.font = '700 40px "Chakra Petch", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(n), 64, 34);
    o.material.map.needsUpdate = true;
  }
  function startBonus(who) {
    const em = emeraldCount(), n = Math.min(em, 6) + (who === 'tails' ? 7 : 0);
    let data;
    try { data = S3D.bonusStage(romBytes, n); } catch (e) { toast('The special stage could not be read from this ROM: ' + e.message + '.', 4); return; }
    const look = bonusLook(data), scene2 = new THREE.Scene(), group = new THREE.Group();
    scene2.background = new THREE.Color(look.fog); scene2.fog = new THREE.Fog(look.fog, 11, 17.5);
    scene2.add(new THREE.HemisphereLight(0xffffff, 0x5a4a60, 0.9), (() => { const d = new THREE.DirectionalLight(0xffffff, 0.6); d.position.set(-0.4, 1, -0.6); return d; })());
    const track = bonusTrack(data, look), ground = bonusGround(data, look);
    group.add(track, ground); scene2.add(group);
    const objs = bonusItems(data, look, group);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: heroTexture('back', 'run', 0, 0, false), alphaTest: 0.5 }));
    const shade = new THREE.Mesh(new THREE.CircleGeometry(0.3, 18), new THREE.MeshBasicMaterial({ color: 0x100818, transparent: true, opacity: 0.4, depthWrite: false }));
    shade.rotation.x = -Math.PI / 2; scene2.add(sprite, shade);
    const use3d = !!hero3d && heroMode === '3d';
    if (use3d) scene2.add(hero3d.root);
    const b = Sim.bonusStart(data, em >= 7);
    bonus = { b, data, look, scene: scene2, group, ground, objs, sprite, shade, use3d, who, n, noEm: em >= 7, prev: { x: b.x, y: b.y, z: b.z, cx: b.camX, cy: b.camY, cz: b.camZ },
      acc: 0, cycle: 0, done: null, doneAt: 0, popped: new Map(), lastMsg: '' };
    bonusProjection();
    if (saturn) satScene(scene2);
    $('flickyHud').hidden = true; $('ringCount').textContent = '0'; $('ringTotal').textContent = '';
    if (MdSound.on && !Sfx.muted) MdSound.playMusic(S3D.BONUS.music);
    fadeCut();
  }
  function endBonus() {
    const B = bonus, won = B.done === 'emerald';
    if (B.use3d && hero3d) scene.add(hero3d.root);
    B.scene.traverse(o => { if (o.geometry && o.geometry !== spikeGeo.ball && o.geometry !== spikeGeo.spike) o.geometry.dispose(); });
    for (const t of [B.look.deck, B.look.bank, B.look.flow]) t.dispose();
    let title, info = `Ring bonus ${B.b.rings * 100}`;
    if (won) score += B.b.rings * 100 + (B.noEm ? 0 : 10000);
    if (won && !B.noEm) {
      const n = emeraldCount() + 1; store.set(EM_KEY, String(n));
      title = 'Sonic got a Chaos Emerald'; info += `\nEmerald bonus 10000\n${n} of 7`;
    } else if (won) { title = 'Special stage clear'; setLives(Math.min(9, lives + 1)); info += '\nOne up'; }
    else { title = 'No emerald this time'; info = ''; }
    bonus = null;
    $('bonusMsg').hidden = true;
    clearTimeout(clearTimer);
    if (won && romOn()) {   // the original's own screen, its bonuses counted down
      tally = { kind: B.noEm ? 'bonus' : 'emerald', t0: performance.now() / 1000, score0: score + world.score * 100, bonus: [B.b.rings * 100, B.noEm ? 0 : 10000], key: null };
      $('tally').hidden = false; drawTally(tally.t0); clearTimer = setTimeout(clearCardOff, 6000);
    } else { $('clearTitle').textContent = title; $('clearInfo').textContent = info; $('clearCard').hidden = false; clearTimer = setTimeout(clearCardOff, 4000); }
    // the original reloads the act with Sonic where he was (0x4FCE): rings, enemies and monitors back
    Sim.reloadAct(world, { x: world.p.x, z: world.p.z, facing: world.p.facing });
    for (let q = 0; q < ringSprites.length; q++) ringSprites[q].visible = true;
    prev.x = world.p.x; prev.y = world.p.y; prev.z = world.p.z;
    $('ringCount').textContent = String(world.ringCount); shownRings = world.ringCount; $('ringTotal').textContent = `/ ${world.rings.length}`;
    $('flickyHud').hidden = !L.flickies; flickyHudKey = -1; showEmeralds();
    levelMusic(); fadeCut(); resetCamera();
  }
  // lives (the original's $0680: three at the start of a game, a 1-up monitor adds one, nine at most; a special stage
  // won with all seven emeralds adds one). With none left the act starts again from its beginning with three (the
  // original's continue, without the count of continues)
  // Ten Sonic heads make a continue ($06AC, $06AA, nine at most); with lives gone a continue starts the act again with
  // three; without one it is game over, and the game starts again at the first act (ROM levels; others: the act)
  let lives = 3, heads = 0, continues = 0, score = 0;   // (score: points of acts finished and special stages)
  function setLives(n) { lives = n; $('livesCount').textContent = String(Math.max(0, n)); }
  function gotHead() {
    if (++heads < 10) { toast(`Head ${heads} of 10 for a continue.`, 1.5); return; }
    heads = 0; continues = Math.min(9, continues + 1); Sfx.play('continue'); toast(`A continue! (${continues})`, 2.5);
  }
  function gameOver() {
    const cont = continues > 0;
    if (cont) continues--;
    $('clearTitle').textContent = cont ? 'Continue' : 'Game over';
    $('clearInfo').textContent = cont ? `The act starts again.${continues ? ` ${continues} more.` : ''}` : (L.rom && romBytes ? 'Back to the first act.' : 'The act starts again.');
    $('clearCard').hidden = false;
    clearTimeout(clearTimer); clearTimer = setTimeout(() => {
      clearCardOff(); setLives(3);
      if (cont || !(L.rom && romBytes)) { restart(); return; }
      score = 0;   // (a new game)
      try { const first = S3D.LEVELS[0], raw = S3D.convert(romBytes, first[0], L.rom.vscale); useLevel(Sim.importLevel(raw), true); store.set(LEVEL_KEY, JSON.stringify(raw)); $('romLevel').value = String(first[0]); toast(first[1], 2.5); }
      catch (err) { restart(); }
    }, 3000);
  }
  function showEmeralds() { const n = emeraldCount(); $('emeraldHud').hidden = !n; $('emeraldCount').textContent = String(n); }
  showEmeralds();
  function frameBonus(now, dt) {
    const B = bonus, b = B.b, inp = readInput(dt);
    B.acc += dt;
    let steps = 0;
    while (B.acc >= STEP && steps < 5) {
      Object.assign(B.prev, { x: b.x, y: b.y, z: b.z, cx: b.camX, cy: b.camY, cz: b.camZ });
      if (started && !B.done) {
        Sim.bonusStep(b, { left: inp.ix < -0.3, right: inp.ix > 0.3, jump: inp.jump });
        for (const ev of b.events) Sfx.play(ev);
        if (b.done) { B.done = b.done; B.doneAt = now / 1000; }
      }
      B.acc -= STEP; steps++;
    }
    if (steps === 5) B.acc = 0;
    if (B.done && now / 1000 - B.doneAt > 0.6) { endBonus(); return; }
    const a = B.acc / STEP, t = now / 1000, lerp = (p, q) => p + (q - p) * a, P = B.prev;
    const x = lerp(P.x, b.x) / 65536, y = lerp(P.y, b.y) / 65536, z = lerp(P.z, b.z) / 65536;
    bonusCam.position.set(bx(lerp(P.cx, b.camX) / 65536), by(lerp(P.cy, b.camY) / 65536), bz(lerp(P.cz, b.camZ) / 65536));
    bonusCam.lookAt(bonusCam.position.x, bonusCam.position.y, bonusCam.position.z + 1);
    // Sonic: running away from the camera, a ball in the air, blinking after a hit
    const air = !b.gr, sp = b.vz / 65536 * 60 / 32;
    B.cycle += dt * (4 + sp * 2.2);
    const blink = b.hitT > 0 && Math.floor(t * 16) % 2;
    if (B.use3d) {
      B.sprite.visible = false;
      updateHero3d({ vx: 0, vz: Math.max(0, sp), facing: 0, grounded: !air, ball: air, charge: 0, rolling: false, invuln: b.hitT > 0 ? 1 : 0, sprung: false, hover: false, whirl: false, skid: false }, new THREE.Vector3(bx(x), by(y), bz(z)), dt, t);
    } else {
      let map;
      if (romOn()) {
        const q = air ? S3D.HERO.ball() : S3D.HERO.run(4);
        map = romHeroTex(q[Math.floor(B.cycle) % q.length], false);
        B.sprite.scale.set(ROM_SIZE, ROM_SIZE, 1); B.sprite.center.set(0.5, HERO_FOOT);
      } else {
        map = air ? heroTexture('front', 'ball', Math.floor(B.cycle) % 4, Math.floor(t * 8) % 3, false) : heroTexture('back', 'run', Math.floor(B.cycle) % 4, Math.floor(t * 8) % 3, false);
        B.sprite.scale.set(1.3, 1.3, 1); B.sprite.center.set(0.5, 0.04);
      }
      B.sprite.material.map = map;
      B.sprite.position.set(bx(x), by(y), bz(z)); B.sprite.visible = !blink && !b.out;
    }
    B.shade.position.set(bx(x), by(b.floorY) + 0.02, bz(z)); B.shade.visible = !b.out && !b.end;
    // the river and banks 160 units under the camera's height above Sonic
    B.ground.position.y = by(lerp(P.cy, b.camY) / 65536 + 360);
    const bank = B.ground.userData.bankMesh; bank.position.set(bonusCam.position.x, 0, bonusCam.position.z + 10);
    B.look.bank.offset.set(-bank.position.x / 3, bank.position.z / 3); B.look.flow.offset.set(0, t * (B.look.lava ? 0.15 : 0.4));
    // items: rings pop when taken (the ROM's stage rings do not turn; ours wobble); a gate's beam goes once passed; the
    // emerald spins
    const rom = romOn();
    for (const o of B.objs) {
      const it = b.items[o.userData.q], k = o.userData.k;
      if (k === 1) {
        if (it.gone) {
          if (!B.popped.has(o)) B.popped.set(o, t);
          const p = (t - B.popped.get(o)) / 0.2; o.visible = p < 1; if (p < 1) o.scale.setScalar(o.userData.s * (1 + p));
        } else if (!rom) o.material = ringMats[Math.floor(t * 8) % 3];
      } else if (k === 0 && !o.isSprite) o.rotation.y = t * 2;
      else if (k === 7) { o.visible = !it.gone; o.rotation.y = t * 1.5; }
      else if (k === 3) signDraw(o, b.remain);
      else if (k === 2 && o.userData.beam) o.userData.beam.visible = z < it.d;
    }
    // the messages: "Collect 50 rings" (a new count), the count still wanted while a sign is in sight
    const msg = b.msg === 2 ? `Collect ${b.req}\nrings` : b.msg === 1 && b.remain ? String(b.remain) : '';
    if (msg !== B.lastMsg) { B.lastMsg = msg; const m = $('bonusMsg'); m.textContent = msg; m.hidden = !msg; m.classList.toggle('count', b.msg === 1); }
    if (shownRings !== b.rings) { shownRings = b.rings; $('ringCount').textContent = String(b.rings); }
    if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) $('toast').hidden = true; }
    if (saturn) {
      renderer.setRenderTarget(satTarget); renderer.render(B.scene, bonusCam);
      renderer.setRenderTarget(null); renderer.render(postScene, postCam);
    } else renderer.render(B.scene, bonusCam);
    frames++;
  }

  // ---- loop: fixed 60 Hz sim, interpolated render ----
  const STEP = Sim.P.dt;
  const prev = { x: world.p.x, y: world.p.y, z: world.p.z };
  let acc = 0, last = performance.now(), frames = 0, shownRings = -1;
  const g2 = [0, 0], nrmV = new THREE.Vector3(), zAxis = new THREE.Vector3(0, 0, 1), rp = new THREE.Vector3();
  // The original's Sonic is a point that walks up to a wall's face (Sim resolveWallsOrig); a body drawn there would be
  // half inside it, so the drawing alone keeps WALL_SKIN off faces too high to step onto. The sim is not moved.
  const WALL_SKIN = 0.15;
  function wallSkin(v) {
    const i = Math.floor(v.x), j = Math.floor(v.z), fx = v.x - i, fz = v.z - j, lim = v.y + L.phys.stepUp;
    const tall = (ii, jj) => ii < 0 || jj < 0 || ii >= L.width || jj >= L.depth || Sim.tileTopNear(L, ii, jj, v.x, v.z) > lim;
    if (fx < WALL_SKIN && tall(i - 1, j)) v.x = i + WALL_SKIN; else if (fx > 1 - WALL_SKIN && tall(i + 1, j)) v.x = i + 1 - WALL_SKIN;
    if (fz < WALL_SKIN && tall(i, j - 1)) v.z = j + WALL_SKIN; else if (fz > 1 - WALL_SKIN && tall(i, j + 1)) v.z = j + 1 - WALL_SKIN;
  }
  function frame(now) {
    const dt = Math.min(0.25, (now - last) / 1000); last = now;
    if (bonus) { frameBonus(now, dt); requestAnimationFrame(frame); return; }
    acc += dt;
    let steps = 0;
    const inp = toWorld(readInput(dt));
    while (acc >= STEP && steps < 5) {
      prev.x = world.p.x; prev.y = world.p.y; prev.z = world.p.z;
      Sim.step(world, inp);
      if (world.events.includes('respawn')) heroAnim = null;   // (the reload clears Sonic's animation)
      stepHeroAnim(world.p);
      if (world.events.includes('respawn')) {   // a death: a life gone, the act as it was (see Sim's death)
        prev.x = world.p.x; prev.y = world.p.y; prev.z = world.p.z;
        for (let q = 0; q < ringSprites.length; q++) ringSprites[q].visible = !world.rings[q].got;
        setLives(lives - 1);
        if (lives < 0) gameOver(); else { toast(lives ? `${lives} ${lives === 1 ? 'life' : 'lives'} left.` : 'Last life.', 1.6); fadeCut(); resetCamera(); }   // (the original reloads through black)
      }
      if (world.events.includes('monitor') && world.power === 'oneup') setLives(Math.min(9, lives + 1));
      if (world.events.includes('head')) gotHead();
      for (const ev of world.events) Sfx.play(ev);
      if (world.p.charge > 0 && !wasCharging && !(L.phys && L.phys.orig)) Sfx.play('charge');   // (converted levels: the sim's 'charge' events, as the original's)
      wasCharging = world.p.charge > 0;
      if (world.events.includes('monitor') && MdSound.on && !Sfx.muted) MdSound.power(world.power);
      if (world.events.includes('section') || world.events.includes('goal')) {
        const used = goalSprites[world.events.includes('goal') ? world.goals.length - 1 : world.section - 1];
        if (used) { const s = used.clone(); if (!used.userData.rom) s.material = used.material.clone(), s.material.transparent = true; levelGroup.add(s); goalFx = { sprite: s, t0: now / 1000, rom: !!used.userData.rom, jam: !!used.userData.jam, s0: s.scale.x }; }
        flash();
      }
      if (world.events.includes('goal')) actClear();
      if (world.events.includes('friendGive')) {
        const f = world.friends.find(q => q.t === 120), name = f && (romOn() ? (f.who === 'tails' ? 'Tails' : 'Knuckles') : 'Your pal'), n = f ? world.friendRings[f.who] : 0;
        if (f) toast(n >= 50 ? `${name} has ${n} rings. Off to the special stage!` : `${name} has ${n} rings. Fifty in this act open the special stage.`, 3);
      }
      if (world.events.includes('bonusIn')) { if (romBytes) { startBonus(world.bonusWho); if (bonus) break; } }
      if (world.events.includes('monitor')) toast(POWER_TEXT[world.power] || '', 2);
      if (world.events.includes('shieldLost')) toast('The shield took the hit.', 1.6);
      if (world.events.includes('needFlickies')) toast(`The ring needs ${L.flickies} Flickies. Free them from enemies and bring them here.`, 3);
      if (world.events.includes('section')) toast(world.holes.some(h => h.opens === world.section && h.pad) ? 'Ring used. Stand still on the pad beneath it.'
        : world.holes.some(h => h.opens === world.section && h.exitY === null && !h.ride) ? 'Ring used. Step into the hole beneath it.' : 'Ring used. On to the next one.', 3);
      if (world.events.includes('warp')) {
        prev.x = world.p.x; prev.y = world.p.y; prev.z = world.p.z;
        fadeCut(); resetCamera();   // the original cuts (and fades) whenever it moves Sonic somewhere else
      }
      acc -= STEP; steps++;
    }
    if (steps === 5) acc = 0;
    const a = acc / STEP, p = world.p, t = now / 1000;
    rp.set(prev.x + (p.x - prev.x) * a, prev.y + (p.y - prev.y) * a, prev.z + (p.z - prev.z) * a);
    if (L.phys && L.phys.orig && !p.ride && !(p.flyT > 0)) wallSkin(rp);

    // pick the drawing: pose from the sim state, view and left/right from movement relative to the camera
    const sp = Math.hypot(p.vx, p.vz);
    const camYaw = currentYaw(), rx = Math.cos(camYaw), rz = -Math.sin(camYaw), fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
    let pose, phase;
    if (p.whirl) { pose = 'whirl'; phase = Math.floor(t * 16) % 4; }
    else if (p.charge > 0) { pose = 'charge'; phase = Math.floor(t * 20) % 2; }
    else if (p.ball || p.rolling) { look3.ballCycle += dt * Math.max(sp, 6) * 1.4; pose = 'ball'; phase = Math.floor(look3.ballCycle) % 4; }
    else if (!p.grounded) { pose = p.sprung || p.hover ? 'spring' : 'air'; phase = 0; }
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
      let idx, flip;
      if (heroAnim && origLook()) {
        // the view: his facing as seen from this camera, put in the original's fixed view (right (1, -1), up (-1, -1))
        const fc = p.pre ? p.pre.facing : p.facing, dx = Math.sin(fc || 0), dz = Math.cos(fc || 0), sx = dx * rx + dz * rz, sf = dx * fx + dz * fz;
        const ix = (sx - sf) * Math.SQRT1_2, iz = (-sx - sf) * Math.SQRT1_2;
        const F = Math.round(-Math.atan2(ix, iz) / (2 * Math.PI) * 0x800) & 0x7FF;
        [idx, flip] = heroAnim.frame(F);
      } else [idx, flip] = romHeroPick(pose, sp, p.vx * rx + p.vz * rz, p.vx * fx + p.vz * fz, t, dt);
      map = romHeroTex(idx, flip);
      if (hero.scale.x !== ROM_SIZE) { hero.scale.set(ROM_SIZE, ROM_SIZE, 1); hero.center.set(0.5, HERO_FOOT); sil.scale.copy(hero.scale); sil.center.copy(hero.center); }
    } else {
      map = pose === 'whirl' ? heroTexture(phase < 2 ? 'front' : 'back', 'idle', 0, Math.floor(t * 8) % 3, phase % 2 === 1)
        : heroTexture(ballLike ? 'front' : look3.view, pose, phase, Math.floor(t * 8) % 3, look3.facingLeft);
      if (hero.scale.x !== 1.5) { hero.scale.set(1.5, 1.5, 1); hero.center.set(0.5, 0.04); sil.scale.copy(hero.scale); sil.center.copy(hero.center); }
    }
    if (heroMat.map !== map) { heroMat.map = map; silMat.map = map; }
    hero.position.copy(rp); sil.position.copy(rp);
    hero.visible = !(p.invuln > 0 && !(p.knockT > 0) && Math.floor(t * 16) % 2);
    const use3d = !!hero3d && heroMode === '3d';
    if (hero3d) hero3d.root.visible = use3d;
    if (use3d) { hero.visible = false; sil.visible = false; updateHero3d(p, rp, dt, t); } else sil.visible = true;
    iceBlock.visible = p.frozen > 0;
    if (iceBlock.visible) { iceBlock.position.set(rp.x, rp.y + 0.5, rp.z); iceBlock.rotation.y = p.facing || 0; }
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
      // a moving enemy faces the way it goes; one that stands (a Hunter) turns to face the player
      const still = !(en.radius > 0) && !en.chase;
      const dx = still ? world.p.x - en.x : en.x - s.position.x, dz = still ? world.p.z - en.z : en.z - s.position.z, sx = dx * rx + dz * rz;
      s.position.set(en.x, en.y, en.z);
      if (Math.abs(sx) > 1e-4) s.userData.left = sx < 0;
      if (s.userData.frames && en.roam && s.userData.type) {
        // roamers' art is 17 views by their angle (handlers 0x17CB6, 0x18F9A: ((A - 0x100) & 0x7C0) >> 4, mirrored past
        // half a turn), here taken against the camera's turn from the original's view, as the sprinklers
        const T = Math.PI / 1024, off = Math.round((Math.atan2(cam.position.x - en.x, cam.position.z - en.z) - Math.PI / 4) / T);
        let d0 = ((en.roam.A - off - 0x100) & 0x7C0) >> 4, flip = true;
        if (d0 > 0x40) { d0 = 0x80 - d0; flip = false; }
        s.material = romBossMat(s.userData.type[0], d0 >> 2, ROM_CANVAS, 80, s.userData.type[1]); s.scale.x = (flip ? -1 : 1) * s.userData.size;
      }
      else if (s.userData.frames) { const fr = s.userData.frames; s.material = fr[(Math.floor(t * 8) + q) % fr.length]; if (!s.userData.left) s.scale.x = -s.userData.size; }
      else s.material = s.userData.rom ? s.userData.rom[s.userData.left ? 0 : 1] : enemyMat(Math.floor(t * 6) % 2, (Math.floor(t * 8) + q) % 3, !!s.userData.left);
    }
    for (let q = 0; q < crackMeshes.length; q++) {
      const g = crackMeshes[q], broken = world.cracks[q].broken;
      g.visible = !broken; if (g.userData.pit) g.userData.pit.visible = broken;
    }
    for (let q = 0; q < ballSprites.length; q++) {
      const b = ballSprites[q], en = world.enemies[q];
      if (!b) continue;
      b.visible = en.alive; if (en.alive) b.position.set(en.ball.x, en.ball.y, en.ball.z);
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
    for (let q = 0; q < balloonSprites.length; q++) {
      const s = balloonSprites[q], b = world.balloons[q], k = b.pop > 0 ? 1 - b.pop / Sim.P.balloonBack : -1;
      s.position.set(b.x, b.by, b.z); s.visible = k < 0 || k < 0.12;
      if (s.userData.rom) s.material = romBossMat(0x150, k < 0 ? 0 : k < 0.06 ? 3 : 4, 64, 48, 2);
      else s.scale.set(k < 0 ? 0.9 : 1.3, k < 0 ? 0.9 : 1.3, 1);
    }
    if (spikeMesh && spikeMesh.userData.level !== world.spike) setSpikes(world.spike);
    if (spearObj) {
      const sp = world.spear;
      spearObj.visible = !!sp && sp.tip > sp.y - 0.05;
      if (spearObj.visible) spearObj.position.set(sp.x, sp.tip, sp.z);
    }
    for (const o of iceSpikeObjs) o.visible = !!world.iceSpikes.get(o.userData.cell);
    for (const o of rockObjs) o.visible = world.rocks.has(o.userData.cell);
    for (let q = 0; q < barObjs.length; q++) {
      const o = barObjs[q], b = world.barBalls[q]; o.visible = !!b;
      if (!b) continue;
      o.position.set(b[0], b[1] + (o.userData.frames.length ? 0 : 0.3), b[2]); const fr = o.userData.frames;
      if (fr.length) o.material = fr[(Math.floor(t * 15) + q) % fr.length];
    }
    for (let q = 0; q < fireballObjs.length; q++) {
      const o = fireballObjs[q], b = world.fireballs[q]; o.visible = !!b;
      if (!b) continue;
      o.position.set(b.x, b.y, b.z); const fr = o.userData.frames;
      if (fr && fr.length) o.material = fr[(Math.floor(t * 12) + q) % fr.length];
    }
    for (let q = 0; q < jetObjs.length; q++) { const j = world.jets[q]; jetObjs[q].position.y = j.top; }
    for (let q = 0; q < moverObjs.length; q++) { const m = moverObjs[q], v = world.movers[q], b = m.userData.base; m.position.x = b[0] + (v.axis === 'x' ? v.off : 0); m.position.z = b[1] + (v.axis === 'z' ? v.off : 0); }
    for (let q = 0; q < spikeBallObjs.length; q++) { const o = spikeBallObjs[q], v = world.spikeBalls[q]; o.position.set(v.x, v.y, v.z); const fr = o.userData.frames; if (fr && fr.length) o.material = fr[(Math.floor(t * 10) + q) % fr.length]; }
    for (let q = 0; q < fireObjs.length; q++) {
      const o = fireObjs[q], fs = world.fireSpots[q], at = o.userData.at;   // (the original's fire bars move them)
      if (fs && at && (fs.x !== at[0] || fs.y !== at[1] || fs.z !== at[2])) { o.position.x += fs.x - at[0]; o.position.y += fs.y - at[1]; o.position.z += fs.z - at[2]; o.userData.at = [fs.x, fs.y, fs.z]; }
      const fr = o.userData.frames; if (fr && fr.length) o.material = fr[(Math.floor(t * 12) + q * 3) % fr.length]; else o.scale.setScalar(0.6 + 0.1 * Math.sin(t * 9 + q)); }
    for (let q = 0; q < crawlerSprites.length; q++) {
      const s = crawlerSprites[q], c = world.crawlers[q];
      s.position.set(c.x, c.y, c.z);
      if (s.userData.rom) s.material = romBossMat(0xAC, (Math.floor(world.time * 15) * (c.dir > 0 ? 1 : 7)) % 8, 64, 40);
    }
    for (let q = 0; q < turretSprites.length; q++) {
      const s = turretSprites[q], k = world.time - world.turrets[q].firedAt;
      s.scale.set(s.userData.size, s.userData.size * (k < 0.15 ? 0.9 : 1), 1);
    }
    for (let q = 0; q < shotSprites.length; q++) {
      const sh = world.shots[q]; shotSprites[q].visible = !!sh && !sh.laser && !sh.ball;   // (Final Fight's are drawn with its machine)
      if (sh) shotSprites[q].position.set(sh.x, sh.y, sh.z);
    }
    if (sprinklerObjs.length || pylonObjs.length || zapObjs.length || beamObjs.length) {
      const T = Math.PI / 1024;
      sprinklerObjs.forEach((o, q) => {
        const s = world.sprinklers[q];
        if (!o.userData.rom) { o.rotation.y = s.a * T; return; }
        // the camera's turn from the original's view (yaw pi/4), in the routine's angle units
        const off = Math.round((Math.atan2(cam.position.x - s.x, cam.position.z - s.z) - Math.PI / 4) / T);
        let d0 = ((s.a - off - 0x100) & 0x7C0) >> 4, flip = true;
        if (d0 > 0x40) { d0 = 0x80 - d0; flip = false; }
        o.material = romBossMat(0x7C, d0 >> 2, ROM_CANVAS, 80, 3); o.scale.x = (flip ? -1 : 1) * Math.abs(o.scale.x);
      });
      for (const o of pylonObjs) {
        o.visible = !(o.userData.opens > 0 && world.section >= o.userData.opens);
        if (o.visible && o.userData.rom) o.material = romBossMat(0x6C, Math.floor(world.tick / 4) % 5, ROM_CANVAS, 80, 3);
      }
      for (const o of beamObjs) { o.visible = !(o.userData.opens > 0 && world.section >= o.userData.opens); o.material.opacity = 0.3 + 0.25 * Math.abs(Math.sin(t * 23)); }
      zapObjs.forEach((o, q) => {
        const z = world.zaps[q], A = Sim.P.zapAt - 4;
        o.visible = !!z && z.t < A + 16;
        if (!o.visible) return;
        const cx = z.cell % L.width, cz = (z.cell - cx) / L.width;
        o.position.set(cx + 0.5, Sim.floorAt(L, cx + 0.5, cz + 0.5), cz + 0.5);
        if (o.userData.rom) o.material = romBossMat(0x68, z.t < A ? 8 : Math.min(7, (z.t - A) >> 1), ROM_CANVAS, 80, 3);
        else { const k = z.t < A ? 0.5 : 1.2; o.scale.set(0.9 * k, 0.9 * k, 1); o.material.opacity = z.t < A ? 0.5 : 0.9; }
      });
    }
    // Panic Puppet: capsules gone once broken; levers swing a frame every 3 ticks to their value; doors slide into the
    // floor while their gate is open
    capsuleObjs.forEach((o, q) => { o.visible = world.capsules[q].alive; });
    headObjs.forEach((o, q) => {
      const h = world.heads[q]; o.visible = !h.got;
      if (!o.visible) return;
      if (o.userData.rom) o.material = romBossMat(0x44, Math.floor(t * 12 + q * 5) % 16, ROM_CANVAS, 80, 2);
      else { o.material = headMats[Math.floor(t * 8) % 3]; o.scale.x = 0.6 * Math.abs(Math.cos(t * 2.2 + q)); }
    });
    // the friends: Tails runs through his frames, Knuckles stands and now and then goes through his (our cycles; the
    // original's scripts at 0x16216 and 0x162CA also wait on a wave of its own)
    let giving = null;
    friendObjs.forEach((o, q) => {
      const f = world.friends[q]; o.visible = f.shown;
      if (!f.shown) return;
      if (f.t > 0) giving = f;
      if (o.userData.rom) {
        const tails = f.who === 'tails', c = Math.floor(t * 10 + q * 7);
        const fr = tails ? c % 16 : (c % 90 < 60 ? 0 : c % 90 < 66 ? [0, 1, 2, 2, 1, 0][c % 90 - 60] : 3 + (c % 90 - 66) % 13);
        o.material = romBossMat(tails ? 0x15C : 0x160, fr, ROM_CANVAS, 80, 2);
      } else o.material = palMat(f.who === 'tails' ? 0 : 1, Math.floor(t * 4) % 4, Math.floor(t * 8) % 3);
    });
    friendBubble.visible = !!giving;
    if (giving) {
      const n = world.friendRings[giving.who], u = friendBubble.userData;
      friendBubble.position.set(giving.x, giving.y + 1.5 + (120 - giving.t) / 120 * 0.4, giving.z);
      if (u.n !== n) {
        u.n = n; const g = u.canvas.getContext('2d'); g.clearRect(0, 0, 128, 64);
        g.fillStyle = '#ffd34a'; g.strokeStyle = '#15121f'; g.lineWidth = 8; g.font = '700 44px "Chakra Petch", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.strokeText(String(n), 64, 34); g.fillText(String(n), 64, 34); friendBubble.material.map.needsUpdate = true;
      }
    }
    beamPostObjs.forEach((o, q) => {
      const b = world.beams[q], f = BEAM_FRAMES[b.idx], u = o.userData;
      if (u.f === f) return;
      u.f = f;
      if (u.rom) o.material = romBossMat(0x180, f, ROM_CANVAS, 80, b.line); else u.tip.material.color.setHex(f === 0 ? 0xfff27a : 0x5a5030);
    });
    for (const m of warpHoleMarks) m.visible = !!(world.warpHole && world.warpHole.open);
    for (const d of doorMeshes) {
      if (d.userData.field) { d.userData.field.visible = !d.userData.gate.open; continue; }
      const to = d.userData.gate.open ? -d.userData.h - 0.05 : 0;
      d.position.y += Math.sign(to - d.position.y) * Math.min(Math.abs(to - d.position.y), 4 * dt); d.visible = d.position.y > -d.userData.h;
    }
    if (world.tick % 3 === 0) {
      leverObjs.forEach((o, q) => {
        const lv = world.levers[q], to = world.regs[lv.reg] ? 7 : 0, u = o.userData;
        if (u.f === to) return;
        u.f += to > u.f ? 1 : -1;
        if (u.rom) o.material = romLeverMat(u.f, lv.line); else u.stick.rotation.z = (0.5 - u.f / 7) * 1.2;
      });
    }
    // Flickies: hop about, face the way they go; the HUD shows how many the ring has and how many follow
    for (let q = 0; q < flickySprites.length; q++) {
      const s = flickySprites[q], f = world.flickies.filter(ff => ff.state !== 'gone')[q];
      s.visible = !!f;
      if (jamFlickies[q]) jamFlickies[q].g.visible = !!f;
      if (!f) continue;
      const dx = f.x - s.position.x, dz = f.z - s.position.z, sx = dx * rx + dz * rz;
      if (Math.abs(sx) > 1e-3) s.userData.left = sx < 0;
      s.position.set(f.x, f.y, f.z);
      const jf = jamFlickies[q], look = flickyLook(f);
      if (jf) {
        s.visible = false;
        const k = look.jam;
        if (!jf.kinds[k]) { jf.kinds[k] = jamCopy(jamProps.flickies[k]); jf.g.add(jf.kinds[k].g); }
        jf.kinds.forEach((c, i) => { if (c) c.g.visible = i === k; });
        jf.g.visible = true; jf.g.position.set(f.x, f.y, f.z);
        if (dx * dx + dz * dz > 1e-6) jf.yaw = Math.atan2(dx, dz);
        jf.g.rotation.y = jf.yaw + FLICKY_YAW;
        const c = jf.kinds[k], fly = jamProps.fly;
        poseJam(c.nodes, c.anim, fly[Math.floor(t * 30 + q * 5) % fly.length]);
        // the body is one flat card (Sonic World draws it facing the screen): turn it about its own up axis to face the
        // camera, keeping whichever side is already toward it, so it is never seen edge-on
        const body = c.nodes[0], card = body.children[0];
        jf.g.updateMatrixWorld(true);
        const v = body.worldToLocal(_flkCam.copy(cam.position));
        card.rotation.y = v.x < 0 ? Math.atan2(v.z, -v.x) : Math.atan2(-v.z, v.x);
        continue;
      }
      if (rom) { s.material = romFlickyMat(Math.floor(t * 12 + q * 3) % 16, !s.userData.left, f.kind, look.line); s.scale.set(64 * PX, 64 * PX, 1); s.center.set(0.5, 1 - 52 / 64); }
      else { s.material = flickyMat(look.jam, Math.floor(t * 8 + q) % 2, !!s.userData.left); s.scale.set(0.55, 0.55, 1); s.center.set(0.5, 0.08); }
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
      if (goalSprites[q].userData.jam) goalSprites[q].rotation.y = t * 1.6;
      else if (goalSprites[q].userData.rom) goalSprites[q].scale.x = ROM_SIZE * (0.35 + 0.65 * Math.abs(Math.cos(t * 1.6)));
      else goalSprites[q].material = goalMats[Math.floor(t * 3) % 2];
      goalSprites[q].visible = q === world.section && !world.cleared;
    }
    if (tally && romArt) drawTally(now / 1000);
    // a used big ring shrinks away through its own frames (ROM look) or grows and fades (scribbled)
    if (goalFx) {
      const k = (t - goalFx.t0) / 0.6, s = goalFx.sprite;
      if (k >= 1) { s.visible = false; goalFx = null; }
      else if (goalFx.jam) { s.visible = true; s.scale.setScalar(goalFx.s0 * (1 - k)); s.rotation.y = t * 1.6 + k * 12; }
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
      if (world.springs[q].raised) { s.position.y = world.springs[q].y - (fired ? 0.1 : 0); continue; }
      if (jamSprings[q]) jamProps.spring.coil(jamSprings[q], fired ? 1 : SPRING_REST);
      else if (s.userData.drum) { s.userData.drum.scale.y = fired ? 1.6 : 1; s.userData.drum.position.y = fired ? 0.2 : 0.15; }
      else if (s.userData.rom) s.scale.set(s.userData.size, s.userData.size * (fired ? 1.25 : 1), 1);
      else s.material = springMats[fired ? 1 : 0];
    }
    for (let q = 0; q < liftMeshes.length; q++) liftMeshes[q].position.y = world.lifts[q].top;
    for (let q = 0; q < maceObjs.length; q++) {
      const m = world.maces[q];
      m.balls.forEach((off, k) => {
        const a = m.oa ? m.oa[k] * Math.PI / 1024 : m.phase + off + m.w * world.time, sx = Math.sin(a), sz = Math.cos(a), o = maceObjs[q][k];   // (converted: the original's shared angle)
        o.links.forEach((l, i) => l.position.set(m.x + sx * m.link * (i + 1), m.y, m.z + sz * m.link * (i + 1)));
        o.ball.position.set(m.x + sx * m.r, m.y - (o.rom ? 0.35 : 0), m.z + sz * m.r);
      });
    }
    updateBoss(t);
    if (!world.boss || world.boss.dead < 0) for (let q = 0; q < puffSprites.length; q++) {
      const f = world.puffs[q], s = puffSprites[q];
      s.visible = !!f;
      if (f) { const k = f.t / Sim.P.flameLife; s.position.set(f.x, f.y + 0.3, f.z); s.scale.setScalar(0.45 + 0.6 * k); s.material.opacity = 1; }
    }
    if (waterMesh) waterTex.offset.set(t * 0.08, t * 0.03);

    if (shownRings !== world.ringCount) { shownRings = world.ringCount; $('ringCount').textContent = String(world.ringCount); }
    if (!cleared && world.rings.length && world.ringCount === world.rings.length) { cleared = true; toast(`All ${world.rings.length} rings. Level clear. Open ? to restart.`, 6); }
    if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) $('toast').hidden = true; }

    // a ride that goes through solid ground (a tunnel the original draws over Sonic): hide him and keep the camera on
    // the ground above, as the original keeps its view outside
    const rideFloor = p.ride || p.pad ? Sim.floorAt(L, rp.x, rp.z) : -Infinity, buried = (p.ride || p.pad) && Number.isFinite(rideFloor) && rp.y < rideFloor - 0.3;
    if (buried) { hero.visible = sil.visible = false; if (hero3d) hero3d.root.visible = false; camPt.set(rp.x, rideFloor, rp.z); }
    else if (p.hidden) { hero.visible = sil.visible = false; if (hero3d) hero3d.root.visible = false; }   // (in a tube or a tunnel)
    const cp = buried ? camPt : rp;
    if (view.mode === 'iso') updateIso(cp, dt); else updateChase(cp, dt, p);
    lastRp.copy(cp);
    fadeBlockers(dt);
    updateFoliage();
    updateLevelAnim(t);
    dome.position.copy(cam.position);
    if (saturn) {
      renderer.setRenderTarget(satTarget); renderer.render(scene, cam);
      renderer.setRenderTarget(null); renderer.render(postScene, postCam);
    } else renderer.render(scene, cam);
    frames++;
    requestAnimationFrame(frame);
  }
  satReady = true; setSaturn(saturn);
  $('screenSel').addEventListener('change', () => setSaturn($('screenSel').value === 'saturn'));
  window.__game = { MdSound, Sim, resetCamera, startBonus, get bonus() { return bonus; }, get hero3d() { return hero3d; }, get jamProps() { return jamProps; }, jamCopy, poseJam, get jamPalms() { return jamPalms; }, view, setMode, start, get world() { return world; }, get level() { return L; }, get levelGroup() { return levelGroup; }, get renderer() { return renderer; }, get camera() { return cam; }, get frames() { return frames; } };
  setMode(view.mode);
  requestAnimationFrame(frame);
})();
