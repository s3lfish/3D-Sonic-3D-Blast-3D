// Reads Sonic's 3D model, some Sonic World objects and their animations from the player's own Sonic Jam (Saturn) disc.
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

  // ---- the disc: ISO 9660 inside whatever image the player has ----
  // Plain images (.iso, .bin, .img, .mdf, .nrg) are read where they lie: the sector size (2048, 2352 or 2448 with
  // subchannel), where the user data sits in a sector (0, 16 for Mode 1, 24 for Mode 2) and any lead-in before the
  // first sector are found by looking for the ISO volume descriptor ("CD001" in sector 16) with the Saturn header in
  // sector 0. MAME CHD (v5), ECM and zip are unpacked as far as needed, never whole.
  const SIZES = [2048, 2352, 2448], OFFS = [0, 16, 24], SCAN = 1 << 20;
  const text = (d, o, n) => String.fromCharCode(...d.subarray(o, o + n));
  async function slice(file, a, b) { return new Uint8Array(await file.slice(a, b).arrayBuffer()); }

  // a source gives bytes of the image's raw form: read(offset, length) at random, or pass(ranges) in one sweep
  async function sourceFor(file) {
    const head = await slice(file, 0, 64), name = (file.name || '').toLowerCase();
    if (text(head, 0, 8) === 'MComprHD') return chdSource(file, head);
    if (text(head, 0, 4) === 'ECM\0') return ecmSource(file);
    if (head[0] === 0x50 && head[1] === 0x4B && head[2] === 3 && head[3] === 4) return zipSource(file);
    if (/\.(7z|rar)$/.test(name) || text(head, 0, 6) === '7z\xBC\xAF\x27\x1C' || text(head, 0, 4) === 'Rar!')
      throw new Error('This page cannot open .7z or .rar files. Unpack the disc image first, then choose it');
    if (/\.(cue|ccd|mds|toc|gdi|m3u)$/.test(name)) {
      const t = new TextDecoder().decode(await slice(file, 0, 4096)), m = t.match(/FILE\s+"([^"]+)"/i);
      throw new Error('That file only describes the disc. Choose the image it points to' + (m ? ` ("${m[1]}")` : ' (the .bin, .img or .mdf beside it)'));
    }
    return { size: file.size, read: (o, n) => slice(file, o, o + n) };
  }
  // the bytes asked for, as one array each: sweep sources fetch all of them in a single pass
  async function fetchRanges(src, ranges) {
    if (src.pass) return src.pass(ranges);
    const out = [];
    for (const [o, n] of ranges) out.push(await src.read(o, n));
    return out;
  }

  async function openDisc(file) {
    const src = await sourceFor(file);
    // find sector 16 (the volume descriptor) and check sector 0
    const [first] = await fetchRanges(src, [[0, Math.min(SCAN, src.size)]]);
    let geo = null;
    for (let p = first.indexOf(1); p >= 0 && !geo; p = first.indexOf(1, p + 1)) {
      if (first[p + 1] !== 0x43 || text(first, p + 1, 5) !== 'CD001') continue;
      for (const SS of SIZES) for (const OFF of OFFS) {
        const base = p - 16 * SS - OFF;
        if (!geo && base >= 0 && text(first, base + OFF, 15) === 'SEGA SEGASATURN') geo = { SS, OFF, base };
      }
      if (!geo) for (const SS of SIZES) for (const OFF of OFFS) if (!geo && p - 16 * SS - OFF >= 0) geo = { SS, OFF, base: p - 16 * SS - OFF, notSaturn: true };
    }
    if (!geo) throw new Error('That file is not a CD image the game can read. Choose the disc image: .chd, .iso, .bin, .img, .mdf, .nrg or .ecm');
    if (geo.notSaturn) throw new Error('That disc image is not a Saturn disc');
    const { SS, OFF, base } = geo;
    // sectors are fetched as whole spans of the image, then their 2048 data bytes picked out
    const span = (lba, n) => [base + lba * SS, n * SS];
    const pick = (buf, n) => {
      if (SS === 2048) return buf;
      const out = new Uint8Array(n * 2048);
      for (let i = 0; i < n; i++) out.set(buf.subarray(i * SS + OFF, i * SS + OFF + 2048), i * 2048);
      return out;
    };
    const sectors = async (lba, n) => pick((await fetchRanges(src, [span(lba, n)]))[0], n);
    const pvd = await sectors(16, 1);
    const le32 = (d, o) => d[o] + (d[o + 1] << 8) + (d[o + 2] << 16) + ((d[o + 3] << 24) >>> 0);
    const rootLba = le32(pvd, 156 + 2), rootLen = le32(pvd, 156 + 10);
    const dir = await sectors(rootLba, Math.ceil(rootLen / 2048)), files = {};
    for (let o = 0; o < dir.length;) {
      const len = dir[o];
      if (!len) { o = (Math.floor(o / 2048) + 1) * 2048; continue; }
      files[text(dir, o + 33, dir[o + 32]).split(';')[0]] = [le32(dir, o + 2), le32(dir, o + 10)];
      o += len;
    }
    if (!files['MUSEUM.MUS'] || !files['SPRDATA.MUS']) throw new Error('That Saturn disc is not Sonic Jam');
    // both files in one go (a sweep source reads the image once)
    const want = [files['MUSEUM.MUS'], files['SPRDATA.MUS']].map(([lba, size]) => [lba, Math.ceil(size / 2048), size]);
    const parts = await fetchRanges(src, want.map(([lba, n]) => span(lba, n)));
    const [museum, sprdata] = want.map(([, n, size], k) => pick(parts[k], n).slice(0, size));
    const why = check(museum, sprdata);
    if (why) throw new Error(why);
    return { museum, sprdata };
  }

  // ---- ECM (.ecm, a .bin with the error-correction bytes taken out): records [type, count]; sectors of type 1 keep
  // 3 address bytes and 2048 data bytes and come back as 2352-byte Mode 1 sectors; types 2 and 3 (Mode 2) as 2336
  // bytes; type 0 is bytes kept as they are. The record list is read once; then any part can be read at random.
  async function ecmSource(file) {
    const recs = [];   // [output start, type, input start, count]
    let ip = 4, op = 0, win = null, winAt = -1;
    const byte = async at => { if (!win || at < winAt || at >= winAt + win.length) { winAt = at; win = await slice(file, at, at + 65536); } return at - winAt < win.length ? win[at - winAt] : -1; };
    const IN = [1, 2051, 0x804, 0x918], OUT = [1, 2352, 2336, 2336];
    for (;;) {
      let c = await byte(ip++); if (c < 0) throw new Error('That .ecm file is cut short');
      const type = c & 3; let num = (c >> 2) & 0x1F, bits = 5;
      while (c & 0x80) { c = await byte(ip++); if (c < 0) throw new Error('That .ecm file is cut short'); num += (c & 0x7F) * 2 ** bits; bits += 7; }
      if (num === 0xFFFFFFFF) break;
      num += 1;
      recs.push([op, type, ip, num]); ip += num * IN[type]; op += num * OUT[type];
      if (ip > file.size) throw new Error('That .ecm file is cut short');
    }
    async function read(o, n) {
      const out = new Uint8Array(n);
      for (const [os, type, is, num] of recs) {
        const oe = os + num * OUT[type];
        if (oe <= o || os >= o + n) continue;
        if (type === 0) { const a = Math.max(o, os), b = Math.min(o + n, oe); out.set(await slice(file, is + a - os, is + b - os), a - o); continue; }
        // sector records: rebuild the sectors that overlap (the data bytes are what matters; check bytes stay 0)
        const s0 = Math.floor((Math.max(o, os) - os) / OUT[type]), s1 = Math.ceil((Math.min(o + n, oe) - os) / OUT[type]);
        const inb = await slice(file, is + s0 * IN[type], is + s1 * IN[type]);
        for (let s = s0; s < s1; s++) {
          const sec = new Uint8Array(OUT[type]), q = inb.subarray((s - s0) * IN[type], (s - s0 + 1) * IN[type]);
          if (type === 1) { sec.set([0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 0]); sec.set(q.subarray(0, 3), 12); sec[15] = 1; sec.set(q.subarray(3), 16); }
          else { sec.set(q.subarray(0, 4), 0); sec.set(q.subarray(0, 4), 4); sec.set(q.subarray(4), 8); }
          const at = os + s * OUT[type], a = Math.max(o, at), b = Math.min(o + n, at + OUT[type]);
          out.set(sec.subarray(a - at, b - at), a - o);
        }
      }
      return out;
    }
    return { size: op, read };
  }

  // ---- zip: the biggest disc image in it; stored files are read at random, deflated ones in one sweep ----
  async function zipSource(file) {
    const tail = await slice(file, Math.max(0, file.size - 65558), file.size);
    let e = -1;
    for (let i = tail.length - 22; i >= 0; i--) if (tail[i] === 0x50 && tail[i + 1] === 0x4B && tail[i + 2] === 5 && tail[i + 3] === 6) { e = i; break; }
    if (e < 0) throw new Error('That zip file is damaged');
    const le16 = (d, o) => d[o] | (d[o + 1] << 8), le32 = (d, o) => (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16)) + d[o + 3] * 2 ** 24;
    const cdSize = le32(tail, e + 12), cdAt = le32(tail, e + 16), cd = await slice(file, cdAt, cdAt + cdSize);
    let best = null;
    for (let o = 0; o + 46 <= cd.length && le32(cd, o) === 0x02014B50;) {
      const method = le16(cd, o + 10), csize = le32(cd, o + 20), usize = le32(cd, o + 24), nl = le16(cd, o + 28), xl = le16(cd, o + 30), cl = le16(cd, o + 32);
      const name = new TextDecoder().decode(cd.subarray(o + 46, o + 46 + nl)), at = le32(cd, o + 42);
      if (/\.(iso|bin|img|mdf|nrg|chd|ecm)$/i.test(name) && (!best || usize > best.usize)) best = { name, method, csize, usize, at };
      o += 46 + nl + xl + cl;
    }
    if (!best) throw new Error('There is no disc image in that zip file');
    if (/\.(chd|ecm)$/i.test(best.name)) throw new Error(`Unzip "${best.name}" first, then choose it`);
    const lh = await slice(file, best.at, best.at + 30), start = best.at + 30 + le16(lh, 26) + le16(lh, 28);
    if (best.method === 0) return { size: best.usize, read: (o, n) => slice(file, start + o, start + o + n) };
    if (best.method !== 8) throw new Error('That zip file is packed in a way this page cannot read');
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot unzip files. Unzip the disc image first');
    // one sweep through the unpacked bytes, keeping only the ranges asked for (it stops after the last one)
    async function pass(ranges) {
      const out = ranges.map(([, n]) => new Uint8Array(n)), end = Math.max(...ranges.map(([o, n]) => o + n));
      const reader = file.slice(start, start + best.csize).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
      let pos = 0;
      while (pos < end) {
        const { done, value } = await reader.read();
        if (done) break;
        ranges.forEach(([o, n], k) => {
          const a = Math.max(o, pos), b = Math.min(o + n, pos + value.length);
          if (a < b) out[k].set(value.subarray(a - pos, b - pos), a - o);
        });
        pos += value.length;
      }
      reader.cancel().catch(() => {});
      return out;
    }
    return { size: best.usize, pass };
  }

  // ---- MAME CHD v5 (CD codecs cdlz, cdzl, cdfl, and plain zlib, lzma, flac) ----
  // Header: 'MComprHD', length, version 5, four codec tags, logical bytes, map offset, metadata offset, hunk bytes, unit
  // bytes. The hunk map is packed: a Huffman-coded type per hunk (with repeat codes), then per hunk its compressed
  // length and CRC, or the hunk it copies. A CD hunk holds frames of 2448 bytes (2352 sector + 96 subchannel); the CD
  // codecs pack the sectors (LZMA, deflate or FLAC) and the subchannel (deflate) apart, after a bitmap of sectors whose
  // sync and check bytes were left out (only the sector data matters here).
  async function chdSource(file, head) {
    const be32 = (d, o) => d[o] * 2 ** 24 + (d[o + 1] << 16) + (d[o + 2] << 8) + d[o + 3], be64 = (d, o) => be32(d, o) * 2 ** 32 + be32(d, o + 4);
    const version = be32(head, 12);
    if (version !== 5) throw new Error(`That CHD file is an old kind (version ${version}). Remake it with a recent chdman (MAME 0.146 or later)`);
    const codecs = [0, 1, 2, 3].map(k => text(head, 16 + 4 * k, 4)), logical = be64(head, 32), mapAt = be64(head, 40);
    const hunkBytes = be32(head, 56), unitBytes = be32(head, 60), hunks = Math.ceil(logical / hunkBytes);
    if (head.subarray(104, 124).some(b => b)) throw new Error('That CHD file needs a parent CHD; this page reads only stand-alone ones');
    const map = [];   // [type, offset, length] per hunk; types 0-3 codec, 4 none, 5 copy of hunk, 6 parent
    if (codecs[0] === '\0\0\0\0') {
      const raw = await slice(file, mapAt, mapAt + 4 * hunks);
      for (let h = 0; h < hunks; h++) { const o = be32(raw, 4 * h) * hunkBytes; map.push(o ? [4, o, hunkBytes] : [7, 0, 0]); }
    } else {
      const mh = await slice(file, mapAt, mapAt + 16), mapBytes = be32(mh, 0);
      const bs = bits(await slice(file, mapAt + 16, mapAt + 16 + mapBytes));
      const lengthBits = mh[12], selfBits = mh[13], parentBits = mh[14];
      const huff = huffman(bs, 16, 8), types = new Uint8Array(hunks);
      let rep = 0, last = 0;
      for (let h = 0; h < hunks; h++) {
        if (rep > 0) { types[h] = last; rep--; continue; }
        const v = huff();
        if (v === 7) { types[h] = last; rep = 2 + huff(); }
        else if (v === 8) { types[h] = last; rep = 2 + 16 + (huff() << 4); rep += huff(); }
        else types[h] = last = v;
      }
      let cur = be32(mh, 4) * 65536 + ((mh[8] << 8) | mh[9]), lastSelf = 0;
      for (let h = 0; h < hunks; h++) {
        const t = types[h];
        if (t <= 3) { const n = bs.read(lengthBits); bs.read(16); map.push([t, cur, n]); cur += n; }
        else if (t === 4) { bs.read(16); map.push([4, cur, hunkBytes]); cur += hunkBytes; }
        else if (t === 5) { lastSelf = bs.read(selfBits); map.push([5, lastSelf, 0]); }
        else if (t === 9 || t === 10) { if (t === 10) lastSelf++; map.push([5, lastSelf, 0]); }
        else if (t === 6) { bs.read(parentBits); map.push([6, 0, 0]); }
        else map.push([6, 0, 0]);
      }
    }
    const cache = new Map();
    async function hunk(h) {
      if (cache.has(h)) return cache.get(h);
      const [t, o, n] = map[h];
      let out;
      if (t === 5) out = await hunk(o);
      else if (t === 6) throw new Error('That CHD file needs a parent CHD; this page reads only stand-alone ones');
      else if (t === 7) out = new Uint8Array(hunkBytes);
      else if (t === 4) out = await slice(file, o, o + hunkBytes);
      else out = await unpackHunk(codecs[t], await slice(file, o, o + n), hunkBytes);
      if (cache.size > 64) cache.delete(cache.keys().next().value);
      cache.set(h, out); return out;
    }
    async function read(o, n) {
      const out = new Uint8Array(n);
      for (let h = Math.floor(o / hunkBytes); h * hunkBytes < o + n && h < hunks; h++) {
        const d = await hunk(h), at = h * hunkBytes, a = Math.max(o, at), b = Math.min(o + n, at + hunkBytes);
        out.set(d.subarray(a - at, b - at), a - o);
      }
      return out;
    }
    void unitBytes;
    return { size: logical, read };
  }
  async function inflate(src, n) {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot unpack CHD files');
    const reader = new Blob([src]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader(), out = new Uint8Array(n);
    let o = 0;
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; out.set(value.subarray(0, Math.min(value.length, n - o)), o); o += value.length; if (o >= n) break; } }
    catch (e) { if (o < n) throw new Error('That CHD file is damaged'); }
    reader.cancel().catch(() => {});
    return out;
  }
  async function unpackHunk(codec, src, n) {
    if (codec === 'zlib') return inflate(src, n);
    if (codec === 'lzma') return lzma(src, n);
    if (codec === 'cdlz' || codec === 'cdzl' || codec === 'cdfl') {
      const frames = n / 2448, eccBytes = codec === 'cdfl' ? 0 : (frames + 7) >> 3, lenBytes = n < 65536 ? 2 : 3;
      let baseLen = (src[eccBytes] << 8) | src[eccBytes + 1];
      if (lenBytes > 2) baseLen = (baseLen << 8) | src[eccBytes + 2];
      const hb = eccBytes + lenBytes, sec = frames * 2352;
      const base = codec === 'cdlz' ? lzma(src.subarray(hb, hb + baseLen), sec)
        : codec === 'cdzl' ? await inflate(src.subarray(hb, hb + baseLen), sec)
        : flac(src, sec);   // cdfl: FLAC from the first byte (no bitmap or length before it)
      const out = new Uint8Array(n);
      for (let f = 0; f < frames; f++) out.set(base.subarray(f * 2352, (f + 1) * 2352), f * 2448);
      return out;
    }
    throw new Error(`That CHD file is packed with "${codec.trim()}", which this page cannot unpack. Remake it with chdman's default settings`);
  }
  function bits(d) {   // most significant bit first
    let pos = 0;
    return {
      read(n) { let v = 0; for (let i = 0; i < n; i++, pos++) v = v * 2 + ((pos >> 3) < d.length ? (d[pos >> 3] >> (7 - (pos & 7))) & 1 : 0); return v; },
      peek(n) { const p = pos, v = this.read(n); pos = p; return v; },
      skip(n) { pos += n; },
      get pos() { return pos; }, set pos(v) { pos = v; },
    };
  }
  // MAME's Huffman tables: code lengths sent with a run-length escape, canonical codes from the longest down
  function huffman(bs, numCodes, maxBits) {
    const nb = maxBits >= 16 ? 5 : maxBits >= 8 ? 4 : 3, len = new Uint8Array(numCodes);
    for (let c = 0; c < numCodes;) {
      let v = bs.read(nb);
      if (v !== 1) { len[c++] = v; continue; }
      v = bs.read(nb);
      if (v === 1) { len[c++] = 1; continue; }
      let r = bs.read(nb) + 3;
      if (c + r > numCodes) throw new Error('That CHD file is damaged');
      while (r--) len[c++] = v;
    }
    const histo = new Array(33).fill(0);
    for (const l of len) histo[l]++;
    let start = 0;
    for (let l = 32; l > 0; l--) { const next = (start + histo[l]) >> 1; histo[l] = start; start = next; }
    const table = new Int32Array(1 << maxBits).fill(-1);
    for (let c = 0; c < numCodes; c++) if (len[c]) {
      const code = histo[len[c]]++, shift = maxBits - len[c];
      for (let k = 0; k < (1 << shift); k++) table[(code << shift) | k] = (c << 8) | len[c];
    }
    return () => { const e = table[bs.peek(maxBits)]; if (e < 0) throw new Error('That CHD file is damaged'); bs.skip(e & 0xFF); return e >> 8; };
  }

  // ---- FLAC frames with no stream header (16-bit stereo; CHD's cdfl), out as big-endian samples L R L R ----
  function flac(src, nBytes) {
    const out = new Uint8Array(nBytes), bs = bits(src);
    const sread = n => { const v = bs.read(n); return n && v >= 2 ** (n - 1) ? v - 2 ** n : v; };
    const unary = () => { let q = 0; while (!bs.read(1)) q++; return q; };
    let op = 0;
    while (op < nBytes) {
      if (bs.read(14) !== 0x3FFE) throw new Error('That CHD file is damaged');
      bs.read(2);
      const bsCode = bs.read(4), srCode = bs.read(4), chan = bs.read(4), ssCode = bs.read(3); bs.read(1);
      let c = bs.read(8), more = 0; while (c & 0x80) { more++; c = (c << 1) & 0xFF; } if (more > 1) bs.read(8 * (more - 1));
      const n = bsCode === 1 ? 192 : bsCode <= 5 ? 576 << (bsCode - 2) : bsCode === 6 ? bs.read(8) + 1 : bsCode === 7 ? bs.read(16) + 1 : 256 << (bsCode - 8);
      if (srCode === 12) bs.read(8); else if (srCode === 13 || srCode === 14) bs.read(16);
      bs.read(8);
      const bps = [16, 8, 12, 0, 16, 20, 24, 32][ssCode], nch = chan < 8 ? chan + 1 : 2, ch = [];
      for (let k = 0; k < nch; k++) {
        const sb = bps + ((chan === 8 && k === 1) || (chan === 9 && k === 0) || (chan === 10 && k === 1) ? 1 : 0);
        bs.read(1); const type = bs.read(6);
        let wasted = 0; if (bs.read(1)) wasted = unary() + 1;
        const b = sb - wasted, s = new Float64Array(n);
        if (type === 0) s.fill(sread(b));
        else if (type === 1) for (let i = 0; i < n; i++) s[i] = sread(b);
        else {
          const fixed = type >= 8 && type <= 12, order = fixed ? type - 8 : (type & 31) + 1;
          if (!fixed && type < 32) throw new Error('That CHD file is damaged');
          for (let i = 0; i < order; i++) s[i] = sread(b);
          let coef = null, shift = 0;
          if (!fixed) { const prec = bs.read(4) + 1; shift = sread(5); coef = []; for (let i = 0; i < order; i++) coef.push(sread(prec)); }
          // residual: Rice-coded partitions
          const method = bs.read(2), pb = method ? 5 : 4, esc = method ? 31 : 15, po = bs.read(4);
          let i = order;
          for (let part = 0; part < (1 << po); part++) {
            const cnt = (n >> po) - (part ? 0 : order), param = bs.read(pb), raw = param === esc ? bs.read(5) : -1;
            for (let j = 0; j < cnt; j++, i++) {
              if (raw >= 0) { s[i] = sread(raw); continue; }   // an escaped partition: plain signed numbers
              const u = unary() * 2 ** param + bs.read(param);
              s[i] = u % 2 ? -(u + 1) / 2 : u / 2;
            }
          }
          for (let t = order; t < n; t++) {
            let pr = 0;
            if (fixed) pr = [0, s[t - 1], 2 * s[t - 1] - s[t - 2], 3 * s[t - 1] - 3 * s[t - 2] + s[t - 3], 4 * s[t - 1] - 6 * s[t - 2] + 4 * s[t - 3] - s[t - 4]][order];
            else { for (let j = 0; j < order; j++) pr += coef[j] * s[t - j - 1]; pr = Math.floor(pr / 2 ** shift); }
            s[t] += pr;
          }
        }
        if (wasted) for (let i = 0; i < n; i++) s[i] *= 2 ** wasted;
        ch.push(s);
      }
      bs.pos = (bs.pos + 7) & ~7; bs.read(16);
      const [a, d] = ch;
      for (let i = 0; i < n && op < nBytes; i++) {
        let l = a[i], r = d ? d[i] : a[i];
        if (chan === 8) r = l - r; else if (chan === 9) l = l + r;
        else if (chan === 10) { const m = l * 2 + (r & 1); l = (m + r) / 2; r = (m - r) / 2; }
        for (const v of [l, r]) { out[op++] = (v >> 8) & 255; out[op++] = v & 255; }
      }
    }
    return out;
  }

  // ---- LZMA, raw stream (lc 3, lp 0, pb 2, as CHD writes it), after the LZMA SDK's reference decoder ----
  function lzma(src, outLen) {
    const out = new Uint8Array(outLen);
    let range = 0xFFFFFFFF, code = 0, ip = 1;
    for (let i = 0; i < 4; i++) code = code * 256 + src[ip++];
    const norm = () => { if (range < 0x1000000) { range *= 256; code = code * 256 + (ip < src.length ? src[ip++] : 0); } };
    const bit = (p, i) => {
      const v = p[i], bound = Math.floor(range / 2048) * v;
      if (code < bound) { range = bound; p[i] = v + ((2048 - v) >> 5); norm(); return 0; }
      range -= bound; code -= bound; p[i] = v - (v >> 5); norm(); return 1;
    };
    const tree = (p, base, n) => { let m = 1; for (let i = 0; i < n; i++) m = (m << 1) + bit(p, base + m); return m - (1 << n); };
    const rtree = (p, base, n) => { let m = 1, s = 0; for (let i = 0; i < n; i++) { const b = bit(p, base + m); m = (m << 1) + b; s |= b << i; } return s; };
    const direct = n => { let r = 0; while (n--) { range = Math.floor(range / 2); let b = 0; if (code >= range) { code -= range; b = 1; } r = r * 2 + b; norm(); } return r; };
    const probs = n => new Uint16Array(n).fill(1024);
    const lc = 3, lp = 0, pb = 2, pbMask = (1 << pb) - 1, lpMask = (1 << lp) - 1;
    const isMatch = probs(192), isRep = probs(12), isRepG0 = probs(12), isRepG1 = probs(12), isRepG2 = probs(12), isRep0Long = probs(192);
    const lit = probs(0x300 << (lc + lp)), posSlot = probs(4 << 6), specPos = probs(115), align = probs(16);
    const lenCoder = () => ({ choice: probs(2), low: probs(16 << 3), mid: probs(16 << 3), high: probs(256) });
    const matchLen = lenCoder(), repLen = lenCoder();
    const length = (L, ps) => !bit(L.choice, 0) ? tree(L.low, ps << 3, 3) : !bit(L.choice, 1) ? 8 + tree(L.mid, ps << 3, 3) : 16 + tree(L.high, 0, 8);
    let state = 0, rep0 = 0, rep1 = 0, rep2 = 0, rep3 = 0, op = 0;
    while (op < outLen) {
      const ps = op & pbMask;
      if (!bit(isMatch, (state << 4) + ps)) {
        const prev = op ? out[op - 1] : 0, base = 0x300 * (((op & lpMask) << lc) + (prev >> (8 - lc)));
        let sym = 1;
        if (state >= 7) {
          let mb = out[op - rep0 - 1];
          do { const m = (mb >> 7) & 1; mb <<= 1; const b = bit(lit, base + ((1 + m) << 8) + sym); sym = (sym << 1) | b; if (m !== b) break; } while (sym < 0x100);
        }
        while (sym < 0x100) sym = (sym << 1) | bit(lit, base + sym);
        out[op++] = sym & 0xFF;
        state = state < 4 ? 0 : state < 10 ? state - 3 : state - 6;
        continue;
      }
      let len;
      if (bit(isRep, state)) {
        if (!op) throw new Error('That CHD file is damaged');
        if (!bit(isRepG0, state)) {
          if (!bit(isRep0Long, (state << 4) + ps)) { state = state < 7 ? 9 : 11; out[op] = out[op - rep0 - 1]; op++; continue; }
        } else {
          let d;
          if (!bit(isRepG1, state)) d = rep1;
          else { if (!bit(isRepG2, state)) d = rep2; else { d = rep3; rep3 = rep2; } rep2 = rep1; }
          rep1 = rep0; rep0 = d;
        }
        len = length(repLen, ps); state = state < 7 ? 8 : 11;
      } else {
        rep3 = rep2; rep2 = rep1; rep1 = rep0;
        len = length(matchLen, ps); state = state < 7 ? 7 : 10;
        const slot = tree(posSlot, Math.min(len, 3) << 6, 6);
        if (slot < 4) rep0 = slot;
        else {
          const nd = (slot >> 1) - 1;
          let d = (2 | (slot & 1)) * 2 ** nd;
          if (slot < 14) d += rtree(specPos, d - slot, nd);
          else d += direct(nd - 4) * 16 + rtree(align, 0, 4);
          if (d === 0xFFFFFFFF) break;   // end marker
          rep0 = d;
        }
        if (rep0 >= op) throw new Error('That CHD file is damaged');
      }
      for (let n = len + 2; n > 0 && op < outLen; n--, op++) out[op] = out[op - rep0 - 1];
    }
    return out;
  }
  // Addresses below are the USA disc's. The European MUSEUM.MUS has 96 more bytes before 0x1BBC and is otherwise the
  // same, with every pointer 96 higher; SPRDATA.MUS is the same file. A version is known when Sonic's group footer
  // (at its address plus the shift) lists his 15 parts at their addresses plus the shift.
  const SHIFTS = [0, 96];
  function shiftOf(museum) {
    if (museum.length < 0x60000) return null;
    for (const sh of SHIFTS) if (SONIC.parts.every((f, k) => u32(museum, SONIC.group + sh + 4 * k) - HWRAM === f + sh)) return sh;
    return null;
  }
  function check(museum, sprdata) {
    if (sprdata.length < 0x40000 || shiftOf(museum) === null) return 'This Sonic Jam disc is a version the game does not know';
    return null;
  }

  // ---- models: Sonic is 15 parts; a group footer lists each part's footer, then each part's offset ----
  const SONIC = {
    group: 0x42620, ball: 0x49D48,
    parts: [0x40058, 0x40C58, 0x40DA8, 0x41048, 0x412A0, 0x413F0, 0x41690, 0x418E8, 0x41A50, 0x41CF0, 0x41F18, 0x42080, 0x42320, 0x42548, 0x42608],
    // body, head, right thigh, calf, foot, left thigh, calf, foot, right bicep, wrist, hand, left bicep, wrist, hand, tail
    parent: [-1, 0, 0, 2, 3, 0, 5, 6, 0, 8, 9, 0, 11, 12, 0],
  };
  // animation jump tables (frames at 30 a second, assumed); the skid table sits 6 bytes before the address SCHG gives
  const ANIMS = { idle: 0x28E1A, walk: 0x298FA, run: 0x27BFE, sprint: 0x277D0, jump: 0x27F92, curl: 0x275B0, fall: 0x2692C,
    skid: 0x290A6, spring: 0x31162, springFall: 0x31666, balance: 0x2C924, push: 0x2A3A6 };
  // Sonic World objects: group footer and part count. Palm and spring stand y-down like Sonic's parts; the palm's
  // second part (the trunk) is one flat quad the game turns to face the camera. Flickies in the order blue, purple,
  // green, red (Blast Grid's Flicky colours in turn), 10 parts: body, L leg, L foot, R leg, R foot, L arm, L hand,
  // R arm, R hand, head; their flying animation keeps 16-bit positions.
  const MODELS = { palm: [0x5034C, 2], spring: [0x50B44, 2], bigRing: [0x52FDC, 1],
    flicky: [[0x53880, 0x53F08, 0x53BC4, 0x5424C], 10] };
  const FLICKY = { parent: [-1, 0, 1, 0, 3, 0, 5, 0, 7, 0], fly: 0x1FAD0 };
  const WATERFALL = 211;                     // texture definition: Sonic World's falling-water streaks

  function part(m, f) {
    const vp = u32(m, f) - HWRAM, nv = u32(m, f + 4), ip = u32(m, f + 8) - HWRAM, nq = u32(m, f + 12);
    const dp = u32(m, f + 16) - HWRAM, np = u32(m, f + 20);
    const verts = [], normals = [], quads = [];
    // most parts keep 16.16 vertices (12 bytes each); some keep whole-unit 16-bit ones (6 bytes), seen from the gap
    // to the index table that follows
    const wide = (ip - vp) >= 12 * nv;
    for (let i = 0; i < nv; i++) verts.push(wide ? [0, 4, 8].map(k => s32(m, vp + 12 * i + k) / 65536) : [0, 2, 4].map(k => s16(m, vp + 6 * i + k)));
    // parts with 16-bit vertices have no normals (their pointer is not an address): the game lights them flat
    const hasN = wide && np >= HWRAM && np < HWRAM + m.length;
    for (let i = 0; i < nv; i++) normals.push(hasN ? [0, 4, 8].map(k => s32(m, np - HWRAM + 12 * i + k) / 65536) : null);
    for (let i = 0; i < nq; i++) {
      // indices count in 8s; a negative index -8k is an alias of vertex k - 1
      const idx = [0, 2, 4, 6].map(k => { const v = s16(m, ip + 8 * i + k); return ((v >= 0 ? v / 8 : -v / 8 - 1) % nv + nv) % nv; });
      const o = dp + 16 * i, tex = u16(m, o + 2), pmod = u16(m, o + 4);
      // VDP1 draws colour 0 of a 16-colour texture as see-through unless CMDPMOD bit 6 (SPD) is set. Texture numbers
      // count from 1 (SCHG: $1..$1DB): definition = number - 1
      const key = tex ? (tex - 1) * 2 + (pmod & 0x40 ? 0 : 1) : 0;
      quads.push({ idx, flags: m[o], tex, key, pmod, colour: u16(m, o + 6), ctrl: u16(m, o + 10) });
    }
    // a 16-bit part's shadow lies flat at y = 0, in the floor: lift it a little (y is down)
    if (!wide) for (const q of quads) if (q.idx.every(i => verts[i][1] === 0)) for (const i of q.idx) verts[i] = [verts[i][0], -3, verts[i][2]];
    return { verts, normals, quads, hasN };
  }
  function group(m, footer, n) {
    const parts = [], offsets = [];
    for (let k = 0; k < n; k++) parts.push(part(m, u32(m, footer + 4 * k) - HWRAM));
    for (let k = 0; k < n; k++) offsets.push([0, 4, 8].map(i => s32(m, footer + 4 * n + 12 * k + i) / 65536));
    return { parts, offsets };
  }
  // a texture: width, height and RGBA pixels (4 bits a pixel through a 16-colour table of 15-bit colours);
  // key = id * 2 + 1 when colour 0 is see-through
  function texture(m, s, key) {
    const id = key >> 1, clear = key & 1, o = TEXDEFS + shiftOf(m) + 8 * id, w = m[o + 2] * 8, h = m[o + 3], pa = u16(m, o) * 8 - VDP1, ca = u16(m, o + 4) * 8 - VDP1;
    const lut = [];
    for (let k = 0; k < 16; k++) { const v = u16(s, ca + 2 * k); lut.push([(v & 31) * 255 / 31 | 0, ((v >> 5) & 31) * 255 / 31 | 0, ((v >> 10) & 31) * 255 / 31 | 0]); }
    const px = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const b = s[pa + (i >> 1)], c = i & 1 ? b & 15 : b >> 4;
      px.set(lut[c], i * 4); px[i * 4 + 3] = clear && !c ? 0 : 255;
    }
    return { w, h, px };
  }
  // frames of one animation: global position, global rotation, then one rotation per part (z, y, x in 1/65536 turns)
  function anim(m, table, parts = 15, wordPos = false) {
    const frames = [];
    for (let o = table; ; o += 2) {
      const off = s16(m, o);
      if (!off) break;
      let p = table + off;
      const flags = u16(m, p); p += 2;
      const pos = [0, 0, 0], rot = [0, 0, 0], rots = [];
      for (let i = 0; i < 3; i++) if (!(flags & (8 << i))) { if (wordPos) { pos[i] = s16(m, p); p += 2; } else { pos[i] = s32(m, p) / 65536; p += 4; } }
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
    const sh = shiftOf(museum), body = group(museum, SONIC.group + sh, 15), ball = group(museum, SONIC.ball + sh, 1);
    const anims = {};
    for (const name of Object.keys(ANIMS)) anims[name] = anim(museum, ANIMS[name] + sh);
    return { parts: body.parts, offsets: body.offsets, parent: SONIC.parent, ball: ball.parts[0], textures: texturesOf(museum, sprdata, body.parts.concat(ball.parts)), anims };
  }
  function texturesOf(museum, sprdata, parts) {
    const textures = new Map();
    for (const p of parts) for (const q of p.quads) if (q.key && !textures.has(q.key)) textures.set(q.key, texture(museum, sprdata, q.key));
    return textures;
  }
  // the Sonic World objects Blast Grid uses, with one texture map for all of them
  function props(museum, sprdata) {
    const out = {}, all = [];
    const sh = shiftOf(museum);
    for (const name of ['palm', 'spring', 'bigRing']) { out[name] = group(museum, MODELS[name][0] + sh, MODELS[name][1]); all.push(...out[name].parts); }
    out.flickies = MODELS.flicky[0].map(f => { const g = group(museum, f + sh, MODELS.flicky[1]); all.push(...g.parts); return g; });
    out.flickyParent = FLICKY.parent;
    out.fly = anim(museum, FLICKY.fly + sh, MODELS.flicky[1], true);
    out.textures = texturesOf(museum, sprdata, all);
    out.waterfall = texture(museum, sprdata, WATERFALL * 2);
    return out;
  }
  return { openDisc, check, sonic, props, ANIMS };
})();
