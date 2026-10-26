// Reads Sonic's 3D model and animations from the player's own Sonic Jam (Saturn) disc, in the browser.
// Rules only: no data from the disc is in this file. Formats after the Sonic Retro SCHG pages for Sonic Jam
// (Models, Animations, Textures) and checked by drawing every animation; see re/NOTES.md.
const Jam = (() => {
  const HWRAM = 0x06040000;                  // MUSEUM.MUS is loaded here; its pointers subtract this to give offsets
  const VDP1 = 0xD040;                       // SPRDATA.MUS offset = VDP1 address - this (both tables line up)
  const TEXDEFS = 0x250A4;                   // texture definitions in MUSEUM.MUS, 8 bytes each
  const u16 = (d, o) => (d[o] << 8) | d[o + 1];
  const s16 = (d, o) => { const v = u16(d, o); return v & 0x8000 ? v - 0x10000 : v; };
  const u32 = (d, o) => ((d[o] << 24) >>> 0) + (d[o + 1] << 16) + (d[o + 2] << 8) + d[o + 3];
  const s32 = (d, o) => u32(d, o) | 0;

  // ---- the disc: ISO 9660 in 2048-byte sectors (.iso) or raw 2352-byte Mode 1 sectors (.bin, data at +16) ----
  async function openDisc(file) {
    const raw = file.size % 2352 === 0 && file.size % 2048 !== 0 ? true : file.size % 2048 === 0 ? false : null;
    if (raw === null) throw new Error('That file is not a CD image. Choose the disc\'s data track: the .iso, or the "Track 1" .bin');
    const SS = raw ? 2352 : 2048, OFF = raw ? 16 : 0;
    const sectors = async (lba, n) => {
      const buf = new Uint8Array(await file.slice(lba * SS, (lba + n) * SS).arrayBuffer()), out = new Uint8Array(n * 2048);
      for (let i = 0; i < n; i++) out.set(buf.subarray(i * SS + OFF, i * SS + OFF + 2048), i * 2048);
      return out;
    };
    const pvd = await sectors(16, 1);
    if (String.fromCharCode(...pvd.subarray(1, 6)) !== 'CD001') throw new Error('That file is not a CD image the game can read');
    const sys = String.fromCharCode(...(await sectors(0, 1)).subarray(0, 16));
    if (!sys.startsWith('SEGA SEGASATURN')) throw new Error('That disc image is not a Saturn disc');
    const le32 = (d, o) => d[o] + (d[o + 1] << 8) + (d[o + 2] << 16) + ((d[o + 3] << 24) >>> 0);
    const rootLba = le32(pvd, 156 + 2), rootLen = le32(pvd, 156 + 10);
    const dir = await sectors(rootLba, Math.ceil(rootLen / 2048)), files = {};
    for (let o = 0; o < dir.length;) {
      const len = dir[o];
      if (!len) { o = (Math.floor(o / 2048) + 1) * 2048; continue; }
      const name = String.fromCharCode(...dir.subarray(o + 33, o + 33 + dir[o + 32])).split(';')[0];
      files[name] = [le32(dir, o + 2), le32(dir, o + 10)];
      o += len;
    }
    if (!files['MUSEUM.MUS'] || !files['SPRDATA.MUS']) throw new Error('That Saturn disc is not Sonic Jam');
    const read = async ([lba, size]) => (await sectors(lba, Math.ceil(size / 2048))).slice(0, size);
    const museum = await read(files['MUSEUM.MUS']), sprdata = await read(files['SPRDATA.MUS']);
    const why = check(museum, sprdata);
    if (why) throw new Error(why);
    return { museum, sprdata };
  }
  function check(museum, sprdata) {
    if (museum.length < 0x50000 || sprdata.length < 0x40000) return 'This Sonic Jam disc is a version the game does not know';
    for (const f of SONIC.parts) { const p = u32(museum, f); if (p < HWRAM || p >= HWRAM + museum.length) return 'This Sonic Jam disc is a version the game does not know'; }
    return null;
  }

  // ---- models: Sonic is 15 parts; a group footer lists each part's footer, then each part's offset ----
  const SONIC = {
    group: 0x42620, ball: 0x49D48,
    parts: [0x40058, 0x40C58, 0x40DA8, 0x41048, 0x412A0, 0x413F0, 0x41690, 0x418E8, 0x41A50, 0x41CF0, 0x41F18, 0x42080, 0x42320, 0x42548, 0x42608],
    // body, head, right thigh, calf, foot, left thigh, calf, foot, right bicep, wrist, hand, left bicep, wrist, hand, tail
    parent: [-1, 0, 0, 2, 3, 0, 5, 6, 0, 8, 9, 0, 11, 12, 0],
  };
  // animation jump tables (frames at 30 a second, assumed)
  const ANIMS = { idle: 0x28E1A, walk: 0x298FA, run: 0x27BFE, sprint: 0x277D0, jump: 0x27F92, curl: 0x275B0, fall: 0x2692C,
    skid: 0x290AC, spring: 0x31162, springFall: 0x31666, balance: 0x2C924, push: 0x2A3A6 };

  function part(m, f) {
    const vp = u32(m, f) - HWRAM, nv = u32(m, f + 4), ip = u32(m, f + 8) - HWRAM, nq = u32(m, f + 12);
    const dp = u32(m, f + 16) - HWRAM, np = u32(m, f + 20);
    const verts = [], normals = [], quads = [];
    // most parts keep 16.16 vertices (12 bytes each); some keep whole-unit 16-bit ones (6 bytes), seen from the gap
    // to the index table that follows
    const wide = (ip - vp) >= 12 * nv;
    for (let i = 0; i < nv; i++) verts.push(wide ? [0, 4, 8].map(k => s32(m, vp + 12 * i + k) / 65536) : [0, 2, 4].map(k => s16(m, vp + 6 * i + k)));
    const hasN = np >= HWRAM && np < HWRAM + m.length;
    for (let i = 0; i < nv; i++) normals.push(hasN ? [0, 4, 8].map(k => s32(m, np - HWRAM + 12 * i + k) / 65536) : [0, 1, 0]);
    for (let i = 0; i < nq; i++) {
      // indices count in 8s; a negative index -8k is an alias of vertex k - 1
      const idx = [0, 2, 4, 6].map(k => { const v = s16(m, ip + 8 * i + k); return ((v >= 0 ? v / 8 : -v / 8 - 1) % nv + nv) % nv; });
      const o = dp + 16 * i;
      quads.push({ idx, flags: m[o], tex: u16(m, o + 2), pmod: u16(m, o + 4), colour: u16(m, o + 6), ctrl: u16(m, o + 10) });
    }
    return { verts, normals, quads };
  }
  function group(m, footer, n) {
    const parts = [], offsets = [];
    for (let k = 0; k < n; k++) parts.push(part(m, u32(m, footer + 4 * k) - HWRAM));
    for (let k = 0; k < n; k++) offsets.push([0, 4, 8].map(i => s32(m, footer + 4 * n + 12 * k + i) / 65536));
    return { parts, offsets };
  }
  // a texture: width, height and RGBA pixels (4 bits a pixel through a 16-colour table of 15-bit colours)
  function texture(m, s, id) {
    const o = TEXDEFS + 8 * id, w = m[o + 2] * 8, h = m[o + 3], pa = u16(m, o) * 8 - VDP1, ca = u16(m, o + 4) * 8 - VDP1;
    const lut = [];
    for (let k = 0; k < 16; k++) { const v = u16(s, ca + 2 * k); lut.push([(v & 31) * 255 / 31 | 0, ((v >> 5) & 31) * 255 / 31 | 0, ((v >> 10) & 31) * 255 / 31 | 0]); }
    const px = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const b = s[pa + (i >> 1)], c = i & 1 ? b & 15 : b >> 4;
      px.set(lut[c], i * 4); px[i * 4 + 3] = 255;
    }
    return { w, h, px };
  }
  // frames of one animation: global position, global rotation, then one rotation per part (z, y, x in 1/65536 turns)
  function anim(m, name, parts = 15) {
    const table = ANIMS[name], frames = [];
    for (let o = table; ; o += 2) {
      const off = s16(m, o);
      if (!off) break;
      let p = table + off;
      const flags = u16(m, p); p += 2;
      const pos = [0, 0, 0], rot = [0, 0, 0], rots = [];
      for (let i = 0; i < 3; i++) if (!(flags & (8 << i))) { pos[i] = s32(m, p) / 65536; p += 4; }
      for (let i = 0; i < 3; i++) if (!(flags & (0x40 << i))) { rot[i] = s16(m, p); p += 2; }
      for (let k = 0; k < parts; k++) {
        const r = [0, 0, 0];
        for (let i = 0; i < 3; i++) if (!(flags & (1 << i))) { r[i] = s16(m, p); p += 2; }
        rots.push(r);
      }
      frames.push({ pos, rot, rots });
    }
    return frames;
  }
  function sonic(museum, sprdata) {
    const body = group(museum, SONIC.group, 15), ball = group(museum, SONIC.ball, 1);
    const ids = new Set();
    for (const p of body.parts.concat(ball.parts)) for (const q of p.quads) if (q.tex) ids.add(q.tex);
    const textures = new Map();
    for (const id of ids) textures.set(id, texture(museum, sprdata, id));
    const anims = {};
    for (const name of Object.keys(ANIMS)) anims[name] = anim(museum, name);
    return { parts: body.parts, offsets: body.offsets, parent: SONIC.parent, ball: ball.parts[0], textures, anims };
  }
  return { openDisc, check, sonic, ANIMS };
})();
