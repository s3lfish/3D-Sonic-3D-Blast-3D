// JS sprite decoder vs Python reference for every player frame, plus recipe/ring renders run without error.
// First: python3 sprites.py > out/player_frames.json   Then: node sprite_parity.js [out/player_frames.json]
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'src', 's3d.js'), 'utf8');
const ctx = {}; vm.createContext(ctx); vm.runInContext(src + ';this.S3D=S3D;', ctx);
const S = ctx.S3D, d = new Uint8Array(fs.readFileSync('rom/s3d.bin'));
const ref = JSON.parse(fs.readFileSync(process.argv[2] || 'out/player_frames.json', 'utf8'));
let ok = 0, bad = [];
for (const [i, hex] of Object.entries(ref)) {
  try { const f = S.heroFrame(d, +i); const h = Buffer.from(f.art).toString('hex'); h === hex ? ok++ : bad.push(i); } catch (e) { bad.push(i + ':' + e.message); }
}
console.log('player frames identical', ok, 'of', Object.keys(ref).length, bad.slice(0, 5));
const pal = S.paletteRGB(d, 3);
let lit = 0; for (const k of Object.keys(S.RECIPES)) { const px = S.recipeImage(d, k, [1, 2, 3, 3]); for (let j = 3; j < px.length; j += 4) if (px[j]) lit++; }
const r = S.ringImage(d, 0, pal); let rl = 0; for (let j = 3; j < r.length; j += 4) if (r[j]) rl++;
console.log('recipe pixels', lit, 'ring pixels', rl);
