// Private: the browser's artBaker against bake.py, same request order, whole atlas compared byte for byte.
const fs = require('fs'), vm = require('vm');
const { PNG } = {};
const ctx = {}; vm.createContext(ctx); vm.runInContext(fs.readFileSync(require('path').join(__dirname, '..', 'src', 's3d.js'), 'utf8') + ';this.S3D=S3D;', ctx);
const S = ctx.S3D, d = new Uint8Array(fs.readFileSync('rom/s3d.bin')), lid = Number(process.argv[2]), ref = process.argv[3];
const t0 = Date.now(), bk = S.artBaker(d, lid, { foliage: false });
const map = S.rncUnpack(d, ((d[0x1AB62 + (lid - 1) * 0x2A + 4] << 24) | (d[0x1AB62 + (lid - 1) * 0x2A + 5] << 16) | (d[0x1AB62 + (lid - 1) * 0x2A + 6] << 8) | d[0x1AB62 + (lid - 1) * 0x2A + 7]) >>> 0);
const w = i => (map[i * 2] << 8) | map[i * 2 + 1];
const cells = []; for (let i = 0; i < 16384; i++) if (w(i)) cells.push([i % 128, i >> 7]);
for (const [cx, cz] of cells) bk.top(cx, cz);
console.log("tops done ms", Date.now() - t0);
const corners = (cx, cz) => { if (cx < 0 || cz < 0 || cx > 127 || cz > 127) return null; const v = w(cz * 128 + cx); if (!v) return null; const h = v >> 8; return [(h + ((v >> 6) & 3)) * 8, (h + ((v >> 4) & 3)) * 8, (h + ((v >> 2) & 3)) * 8, (h + (v & 3)) * 8]; };
const EDGE = [[0, 1], [1, 2], [2, 3], [3, 0]], NEIGH = [[0, -1, 3, 2], [1, 0, 0, 3], [0, 1, 1, 0], [-1, 0, 2, 1]];
for (const [cx, cz] of cells) for (let e = 0; e < 4; e++) {
  const c = corners(cx, cz), [a, b] = EDGE[e], [dx, dz, na, nb] = NEIGH[e], n = corners(cx + dx, cz + dz);
  const ba = n ? n[na] : -1e9, bb = n ? n[nb] : -1e9;
  if (c[a] <= ba && c[b] <= bb) continue;
  const top = Math.max(c[a], c[b]), bot = Math.max(Math.min(ba, c[a]), Math.min(bb, c[b]), top - 96);
  for (let k = 0; k < Math.ceil((top - bot) / 32); k++) bk.wall(cx, cz, e, k);
}
const at = bk.atlas();
console.log('level', lid, 'slots', bk.count, 'atlas', at.width + 'x' + at.height, 'ms', Date.now() - t0);
if (ref) {
  const raw = fs.readFileSync(ref);   // raw RGBA dump written by bake.py --raw
  let diff = 0; for (let i = 0; i < raw.length; i++) if (raw[i] !== at.pixels[i]) diff++;
  console.log('bytes differing from Python:', diff, 'of', raw.length, raw.length === at.pixels.length ? '' : 'LENGTH MISMATCH ' + at.pixels.length);
}
