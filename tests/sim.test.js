// Runs the pure sim from index.html in Node. Usage: node tests/sim.test.js
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const simSrc = html.match(/<script id="sim">([\s\S]*?)<\/script>/)[1];
const levelSrc = html.match(/<script type="application\/json" id="level">([\s\S]*?)<\/script>/)[1];
const ctx = {};
vm.createContext(ctx);
vm.runInContext(simSrc + '\nthis.Sim = Sim;', ctx);
const Sim = ctx.Sim;
const LEVEL = JSON.parse(levelSrc);

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}
const clone = o => JSON.parse(JSON.stringify(o));
function grid(heights, extra = {}) {
  return Object.assign({ version: 1, format: 'grid', heights, entities: [{ type: 'start', x: 1.5, z: 1.5 }] }, extra);
}
function world(raw) { return Sim.createWorld(Sim.importLevel(raw)); }
function run(w, frames, input) {
  for (let f = 0; f < frames; f++) Sim.step(w, typeof input === 'function' ? input(f, w) : input);
  return w;
}
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: expected ${b} +/- ${eps}, got ${a}`);
const expectErr = (raw, re) => {
  try { Sim.importLevel(raw); } catch (e) { assert.ok(re.test(e.message), `wrong error: ${e.message}`); return; }
  assert.fail('expected the loader to reject this level');
};
const row = (ch, n) => ch.repeat(n);

console.log('loader');
test('accepts the shipped level with 67 rings and one spring', () => {
  const L = Sim.importLevel(LEVEL);
  assert.strictEqual(L.width, 36); assert.strictEqual(L.depth, 32);
  assert.strictEqual(L.entities.filter(e => e.type === 'ring').length, 67);
  assert.strictEqual(L.entities.filter(e => e.type === 'spring').length, 1);
});
test('rejects ragged rows', () => expectErr(grid(['4444', '444', '4444']), /Row 1 of "heights" has 3 tiles; expected 4/));
test('rejects unknown height char', () => expectErr(grid(['4444', '44!4', '4444']), /Unknown height character "!"/));
test('rejects unknown tile type', () => expectErr(grid(['4444', '4444', '4444'], { types: ['....', '..?.', '....'] }), /Unknown tile type "\?"/));
test('rejects missing start', () => expectErr(grid(['4444', '4444', '4444'], { entities: [] }), /exactly one start; it has 0/));
test('rejects two starts', () => expectErr(grid(['4444', '4444', '4444'], { entities: [{ type: 'start', x: 1.5, z: 1.5 }, { type: 'start', x: 2.5, z: 1.5 }] }), /it has 2/));
test('rejects start over a pit', () => expectErr(grid(['4444', '4444', '4444'], { types: ['....', '.x..', '....'] }), /start is over a pit/));
test('rejects wrong version', () => expectErr(Object.assign(grid(['444', '444', '444']), { version: 2 }), /version is 2/));
test('rejects ramp pointing off map', () => expectErr(grid(['4444', '4444', '4444'], { ramps: ['n...', '....', '....'] }), /points off the map/));
test('tiles format round trip', () => {
  const tiles = []; for (let k = 0; k < 9; k++) tiles.push({ c: [1, 1, 1, 1], t: 'F' });
  tiles[5] = { c: [1, 2, 2, 1] };
  const L = Sim.importLevel({ version: 1, format: 'tiles', width: 3, depth: 3, tiles, entities: [{ type: 'start', x: 0.5, z: 0.5 }] });
  near(Sim.floorAt(L, 2.5, 1.5), 1.5, 1e-9, 'tile ramp midpoint');
});

console.log('level queries');
test('floor on the downhill ramp interpolates', () => {
  const L = Sim.importLevel(LEVEL);
  near(Sim.floorAt(L, 13.5, 6.5), 2.125, 1e-9, 'mid ramp tile');
  near(Sim.floorAt(L, 17.5, 6.5), 1.125, 1e-9, 'bottom ramp tile');
  assert.strictEqual(Sim.floorAt(L, 20.5, 15.5), -Infinity, 'gorge has no floor');
  near(Sim.floorAt(L, 20.5, 9.5), 1.0, 1e-9, 'bridge');
});

console.log('movement');
const W12 = n => Array.from({ length: 5 }, () => n);
test('reaches top speed about 8 m/s on flat ground', () => {
  const w = world(grid(W12('c' + row('4', 40) + 'c'), { entities: [{ type: 'start', x: 1.5, z: 2.5 }] }));
  run(w, 60, { mx: 1, mz: 0 });
  near(Math.hypot(w.p.vx, w.p.vz), 8, 0.05, 'speed');
});
test('walks up a 0.25 m step', () => {
  const w = world(grid(W12('c4444' + '5' + '4444c'), { entities: [{ type: 'start', x: 1.5, z: 2.5 }] }));
  run(w, 90, { mx: 1, mz: 0 });
  assert.ok(w.p.x > 6.5, `x ${w.p.x}`);
});
test('blocked by a 0.5 m step', () => {
  const w = world(grid(W12('c4444' + '6' + '4444c'), { entities: [{ type: 'start', x: 1.5, z: 2.5 }] }));
  run(w, 90, { mx: 1, mz: 0 });
  assert.ok(w.p.x < 5 - Sim.P.r + 0.01, `x ${w.p.x}`);
  assert.ok(w.p.grounded);
});
test('walks off a ledge and lands below', () => {
  const w = world(grid(W12('c888' + '4444444c'), { entities: [{ type: 'start', x: 1.5, z: 2.5 }] }));
  let wasAir = false;
  run(w, 120, (f, ww) => { if (!ww.p.grounded) wasAir = true; return { mx: 1, mz: 0 }; });
  assert.ok(wasAir, 'never airborne'); assert.ok(w.p.grounded); near(w.p.y, 1.0, 1e-6, 'landed height');
});
test('jumps onto a 1 m ledge', () => {
  const w = world(grid(W12('c4444' + '8888c'), { entities: [{ type: 'start', x: 2.5, z: 2.5 }] }));
  run(w, 120, f => ({ mx: 1, mz: 0, jump: f >= 10 && f < 40 }));
  near(w.p.y, 2.0, 1e-6, 'on top'); assert.ok(w.p.x > 6);
});
test('cannot jump onto a 1.5 m ledge', () => {
  const w = world(grid(W12('c4444' + 'aaaac'), { entities: [{ type: 'start', x: 2.5, z: 2.5 }] }));
  run(w, 120, f => ({ mx: 1, mz: 0, jump: f >= 10 && f < 40 }));
  near(w.p.y, 1.0, 1e-6, 'still on the ground'); assert.ok(w.p.x < 5);
});
// the physics a converted level brings at true shape (see S3D physicsFor): jump peak 1.875 m, step limit 0.375 m
const ORIG = { physics: { gravity: 28.125, jumpV: 10.5068, jumpCut: 4.2027, maxFall: 13.125, stepUp: 0.375, snapDown: 0.375 } };
test('level physics: jump peaks near 1.875 m', () => {
  const w = world(grid(W12(row('4', 12)), Object.assign({ entities: [{ type: 'start', x: 5.5, z: 2.5 }] }, ORIG)));
  let top = 0;
  run(w, 90, (f, ww) => { top = Math.max(top, ww.p.y); return { mx: 0, mz: 0, jump: f < 60 }; });
  near(top - 1, 1.875, 0.02, 'jump rise');
});
test('level physics: 0.25 m step walked, 0.5 m border blocks', () => {
  const a = world(grid(W12('c4444' + '5' + '4444c'), Object.assign({ entities: [{ type: 'start', x: 1.5, z: 2.5 }] }, ORIG)));
  run(a, 90, { mx: 1, mz: 0 }); assert.ok(a.p.x > 6.5, `x ${a.p.x}`);
  const b = world(grid(W12('c4444' + '6' + '4444c'), Object.assign({ entities: [{ type: 'start', x: 1.5, z: 2.5 }] }, ORIG)));
  run(b, 90, { mx: 1, mz: 0 }); assert.ok(b.p.x < 5, `x ${b.p.x}`);
});
test('rejects bad physics', () => expectErr(grid(['444', '444', '444'], { physics: { jumpV: 'high' } }), /physics "jumpV" must be a number/));
test('full-speed spin dash does not tunnel a 1-tile wall', () => {
  const w = world(grid(W12('c44444444c4444c'), { entities: [{ type: 'start', x: 1.5, z: 2.5 }] }));
  let maxX = 0;
  run(w, 200, (f, ww) => { maxX = Math.max(maxX, ww.p.x); return { mx: f < 50 ? 0 : 1, mz: 0, dash: f < 45 }; });
  assert.ok(maxX < 9 - Sim.P.r + 0.01, `reached x ${maxX}`);
});
test('dash launches at full charge speed', () => {
  const w = world(grid(W12('c' + row('4', 40) + 'c'), { entities: [{ type: 'start', x: 1.5, z: 2.5 }] }));
  w.p.facing = Math.PI / 2;
  run(w, 45, { dash: true });
  run(w, 1, { dash: false });
  near(Math.hypot(w.p.vx, w.p.vz), Sim.P.dashMax, 0.2, 'launch speed');
  assert.ok(w.p.rolling);
});
const place = (w, x, z) => Object.assign(w.p, { x, z, y: Sim.floorAt(w.L, x, z), vx: 0, vy: 0, vz: 0, grounded: true });
test('ramp side entry is blocked', () => {
  const w = world(LEVEL); place(w, 13.5, 8.5);
  run(w, 60, { mx: 0, mz: -1 });
  assert.ok(w.p.z > 8 + Sim.P.r - 0.01, `z ${w.p.z}`);
});
test('runs down the ramp from the ridge to the ground', () => {
  const w = world(LEVEL); place(w, 9.5, 6.5);
  for (let f = 0; f < 150 && w.p.x < 18.3; f++) Sim.step(w, { mx: 1, mz: 0 });
  near(w.p.y, 1.0, 1e-6, 'ground height'); assert.ok(w.p.x >= 18.3); assert.strictEqual(w.deaths, 0);
});
test('a roll speeds up down the ramp', () => {
  const w = world(LEVEL); place(w, 9.5, 6.5);
  w.p.facing = Math.PI / 2;
  run(w, 10, { dash: true }); run(w, 1, {});
  const v0 = Math.hypot(w.p.vx, w.p.vz);
  run(w, 25, {});
  assert.ok(w.p.rolling, 'still rolling');
  assert.ok(Math.hypot(w.p.vx, w.p.vz) > v0, 'gained speed');
});
test('climbs the 0.25 m stairs to the ridge and runs back down without leaving the ground', () => {
  const w = world(LEVEL); place(w, 4.5, 22.5);
  run(w, 75, { mx: 0, mz: -1 });
  near(w.p.y, 3.0, 1e-6, 'ridge height');
  let air = 0;
  run(w, 110, (f, ww) => { if (!ww.p.grounded) air++; return { mx: 0, mz: 1 }; });
  near(w.p.y, 1.0, 1e-6, 'bottom'); assert.strictEqual(air, 0, 'airborne frames on the way down');
});
test('crosses the gorge on the bridge', () => {
  const w = world(LEVEL); place(w, 17.5, 9.5);
  run(w, 70, { mx: 1, mz: 0 });
  assert.strictEqual(w.deaths, 0); assert.ok(w.p.x > 22.5);
});
test('the spring reaches the east plateau', () => {
  const w = world(LEVEL); place(w, 29.5, 13.5);
  run(w, 80, { mx: 0, mz: -1 });
  near(w.p.y, 2.5, 1e-6, 'plateau height'); assert.ok(w.p.z < 10.5);
});
test('slides along a wall when pushing diagonally into it', () => {
  const w = world(grid(['cccccccc', 'c444444c', 'c444444c', 'c444444c', 'cccccccc'], { entities: [{ type: 'start', x: 3.5, z: 2.5 }] }));
  run(w, 60, { mx: Math.SQRT1_2, mz: -Math.SQRT1_2 });
  assert.ok(w.p.x > 5.5, `x ${w.p.x}`); near(w.p.z, 1 + Sim.P.r, 0.02, 'pressed against north wall');
});
test('falls in the gorge and respawns at the start', () => {
  const w = world(LEVEL); place(w, 17.5, 15.5);
  run(w, 200, (f) => ({ mx: f < 30 ? 1 : 0, mz: 0 }));
  assert.strictEqual(w.deaths, 1); near(w.p.x, 4.5, 1e-9, 'start x'); near(w.p.z, 27.5, 1e-9, 'start z');
});
test('collects the meadow rings on the run east from the start', () => {
  const w = world(LEVEL);
  run(w, 120, { mx: 1, mz: 0 });
  assert.strictEqual(w.ringCount, 6);
});
test('deterministic for the same inputs', () => {
  const inp = f => ({ mx: Math.sin(f / 20), mz: Math.cos(f / 33), jump: f % 50 < 10, dash: f % 120 < 30 });
  const a = run(world(LEVEL), 600, inp).p, b = run(world(LEVEL), 600, inp).p;
  assert.deepStrictEqual(clone(a), clone(b));
});

console.log('springs, bridges, decor');
test('spring launches the player onto a 1.5 m cliff', () => {
  const w = world(grid(W12('c444' + 'aaaac'), { entities: [{ type: 'start', x: 1.5, z: 2.5 }, { type: 'spring', x: 3.5, z: 2.5 }] }));
  let launched = false;
  run(w, 150, (f, ww) => { if (ww.events.includes('spring')) launched = true; return { mx: 1, mz: 0 }; });
  assert.ok(launched, 'spring never fired'); near(w.p.y, 2.5, 1e-6, 'on the cliff'); assert.ok(w.p.x > 4.5);
});
test('rejects a spring over a pit', () => expectErr(grid(['4444', '4444', '4444'], { types: ['....', '..x.', '....'], entities: [{ type: 'start', x: 0.5, z: 0.5 }, { type: 'spring', x: 2.5, z: 1.5 }] }), /spring .* is over a pit/));
test('bridge tiles are walkable floor', () => {
  const w = world(grid(W12('c444444c'), { types: Array(5).fill('...==...'), entities: [{ type: 'start', x: 1.5, z: 2.5 }] }));
  run(w, 60, { mx: 1, mz: 0 });
  near(w.p.y, 1.0, 1e-6, 'still on the ground'); assert.ok(w.p.x > 5);
});
test('decor is placed but never blocks', () => {
  const w = world(grid(W12('c444444c'), { entities: [{ type: 'start', x: 1.5, z: 2.5 }, { type: 'palm', x: 3.5, z: 2.5 }, { type: 'flower', x: 4.5, z: 2.5, variant: 2 }] }));
  assert.strictEqual(w.L.entities.filter(e => e.type === 'palm').length, 1);
  run(w, 60, { mx: 1, mz: 0 });
  assert.ok(w.p.x > 5);
});
test('per-level kill height respawns sooner', () => {
  const w = world(grid(W12('c44444444c'), { killY: 0, types: Array(5).fill('....xx....'), entities: [{ type: 'start', x: 2.5, z: 2.5 }] }));
  let t = 0;
  run(w, 120, (f, ww) => { if (!t && ww.events.includes('respawn')) t = f; return { mx: 1, mz: 0 }; });
  assert.ok(t > 0 && t < 60, `respawned at frame ${t}`);
});

console.log('enemies, monitors, damage');
const arena = ents => grid(W12('c' + row('4', 20) + 'c'), { entities: [{ type: 'start', x: 1.5, z: 2.5 }, ...ents] });
test('jumping onto an enemy defeats it and bounces', () => {
  const w = world(arena([{ type: 'enemy', x: 4.5, z: 2.5, radius: 0.01, speed: 0 }]));
  let bounced = false;
  run(w, 90, (f, ww) => { if (ww.events.includes('enemy') && ww.p.vy > 5) bounced = true; return { mx: 1, mz: 0, jump: f > 5 && f < 30 }; });
  assert.strictEqual(w.enemies[0].alive, false); assert.ok(bounced, 'no bounce');
});
test('walking into an enemy with rings throws them out', () => {
  const w = world(arena([{ type: 'enemy', x: 5.5, z: 2.5, radius: 0.01, speed: 0 }]));
  w.ringCount = 7;
  let hurtAt = -1;
  run(w, 40, (f, ww) => { if (hurtAt < 0 && ww.events.includes('hurt')) hurtAt = f; return { mx: 1, mz: 0 }; });
  assert.ok(hurtAt >= 0, 'never hurt'); assert.strictEqual(w.ringCount, 0); assert.ok(w.loose.length === 7, `loose ${w.loose.length}`);
  assert.ok(w.p.invuln > 0); assert.strictEqual(w.enemies[0].alive, true);
});
test('thrown rings can be caught again', () => {
  const w = world(arena([{ type: 'enemy', x: 5.5, z: 2.5, radius: 0.01, speed: 0 }]));
  w.ringCount = 3;
  run(w, 40, { mx: 1, mz: 0 }); run(w, 50, {});
  assert.ok(w.loose.length === 3, 'rings still out');
  // drop them on the player once they can be caught
  for (const r of w.loose) { r.vx = r.vz = 0; r.x = w.p.x; r.z = w.p.z; r.y = w.p.y + 1; r.vy = 0; }
  run(w, 60, {});
  assert.ok(w.ringCount >= 1, `caught ${w.ringCount}`);
});
test('a hit with no rings sends you back to the start', () => {
  const w = world(arena([{ type: 'enemy', x: 5.5, z: 2.5, radius: 0.01, speed: 0 }]));
  run(w, 60, { mx: 1, mz: 0 });
  assert.strictEqual(w.deaths, 1);
});
test('a rolling monitor hit pays ten rings', () => {
  const w = world(arena([{ type: 'monitor', x: 8.5, z: 2.5 }]));
  w.p.facing = Math.PI / 2;
  run(w, 40, { dash: true }); run(w, 60, {});
  assert.strictEqual(w.ringCount, 10); assert.ok(w.monitors[0].broken);
});
test('walking into a monitor does nothing', () => {
  const w = world(arena([{ type: 'monitor', x: 5.5, z: 2.5 }]));
  run(w, 60, { mx: 1, mz: 0 });
  assert.strictEqual(w.ringCount, 0); assert.ok(!w.monitors[0].broken);
});
test('reaching the goal clears the level once', () => {
  const w = world(arena([{ type: 'goal', x: 6.5, z: 2.5 }]));
  let n = 0;
  run(w, 120, (f, ww) => { n += ww.events.includes('goal') ? 1 : 0; return { mx: 1, mz: 0 }; });
  assert.strictEqual(n, 1); assert.ok(w.cleared);
});
test('big rings in order: the first opens the next section, the last clears', () => {
  const w = world(arena([{ type: 'goal', x: 5.5, z: 2.5 }, { type: 'goal', x: 12.5, z: 2.5 }]));
  const seen = [];
  run(w, 150, (f, ww) => { for (const e of ww.events) if (e === 'section' || e === 'goal') seen.push(e); return { mx: 1, mz: 0 }; });
  assert.deepStrictEqual(seen, ['section', 'goal']); assert.ok(w.cleared); assert.strictEqual(w.section, 1);
  Sim.respawn(w); near(w.p.x, 5.5, 1e-9, 'respawns at the ring used');
});
test('a hole opened by the first ring throws the player out of its exit', () => {
  const w = world(arena([{ type: 'goal', x: 4.5, z: 2.5 }, { type: 'goal', x: 18.5, z: 2.5 },
    { type: 'hole', x: 6.5, z: 2.5, opens: 1, exit: [15.5, 2.5], launch: 6 }]));
  let warped = false;
  run(w, 90, (f, ww) => { if (ww.events.includes('warp')) warped = true; return { mx: warped ? 0 : 1, mz: 0 }; });
  assert.ok(warped, 'never warped'); near(w.p.x, 15.5, 0.6, 'came out at the exit');
});
test('landing in the next ring from a hole does not use it until the player walks in again', () => {
  const w = world(arena([{ type: 'goal', x: 4.5, z: 2.5 }, { type: 'goal', x: 15.5, z: 2.5 }, { type: 'goal', x: 19.5, z: 2.5 },
    { type: 'hole', x: 6.5, z: 2.5, opens: 1, exit: [15.5, 2.5], launch: 2 }]));
  let warped = false;
  run(w, 150, (f, ww) => { if (ww.events.includes('warp')) warped = true; return { mx: warped ? 0 : 1, mz: 0 }; });
  assert.ok(warped); assert.strictEqual(w.section, 1, 'ring under the exit used too early');
  run(w, 30, { mx: -1, mz: 0 }); run(w, 70, { mx: 1, mz: 0 });
  assert.ok(w.section >= 2, `section ${w.section}`);
});
test('void tiles (W) stop the player walking and jumping, and are not floor', () => {
  const tiles = []; for (let k = 0; k < 15; k++) tiles.push({ c: [1, 1, 1, 1], t: k % 5 === 4 ? 'W' : 'F' });
  const raw = { version: 1, format: 'tiles', width: 5, depth: 3, tiles, entities: [{ type: 'start', x: 1.5, z: 1.5 }] };
  const a = world(raw); run(a, 90, { mx: 1, mz: 0 });
  assert.ok(a.p.x < 4 && a.p.grounded, `walked to x ${a.p.x}`);
  const b = world(raw); let top = 0;
  run(b, 120, (f, w) => { top = Math.max(top, w.p.x); return { mx: 1, mz: 0, jump: f > 20 && f < 50 }; });
  assert.ok(top < 4, `jumped to x ${top}`);
  assert.strictEqual(Sim.floorAt(b.L, 4.5, 1.5), -Infinity);
});
test('a closed hole does nothing', () => {
  const w = world(arena([{ type: 'goal', x: 18.5, z: 2.5 }, { type: 'hole', x: 6.5, z: 2.5, opens: 1, exit: [15.5, 2.5] }]));
  let warped = false;
  run(w, 60, (f, ww) => { if (ww.events.includes('warp')) warped = true; return { mx: 1, mz: 0 }; });
  assert.ok(!warped);
});
test('Flickies: freed by enemies, follow, scatter when hit, and open the ring when five are delivered', () => {
  const ents = [{ type: 'goal', x: 20.5, z: 2.5 }];
  for (let i = 0; i < 5; i++) ents.push({ type: 'enemy', x: 7.5 + i * 2, z: 2.5, radius: 0.01, speed: 0 });
  const w = world(Object.assign(grid(W12('c' + row('4', 22) + 'c'), { entities: [{ type: 'start', x: 1.5, z: 2.5 }, ...ents] }), { flickies: 5 }));
  // roll through the enemies, then keep running into the ring
  let freed = 0, picked = 0, need = 0;
  run(w, 400, (f, ww) => {
    freed += ww.events.filter(e => e === 'enemy').length; picked += ww.events.filter(e => e === 'flicky').length;
    need += ww.events.includes('needFlickies') ? 1 : 0;
    return { mx: 1, mz: 0, dash: f === 40 };   // a tap of dash at full speed rolls through them
  });
  assert.strictEqual(freed, 5, 'enemies popped');
  assert.ok(w.flickies.length === 5, 'five Flickies');
  // the line may not have caught every Flicky on one pass; walk back and forth until all are delivered
  for (let pass = 0; pass < 6 && !w.cleared; pass++) { run(w, 120, { mx: -1, mz: 0 }); run(w, 120, { mx: 1, mz: 0 }); }
  assert.ok(w.cleared, `cleared (delivered ${w.delivered}, states ${w.flickies.map(f => f.state).join(',')})`);
});
test('a hit scatters the Flickies following the player', () => {
  const w = world(Object.assign(arena([{ type: 'goal', x: 18.5, z: 2.5 }]), { flickies: 5 }));
  w.flickies.push({ x: 1, y: 1, z: 2.5, vx: 0, vy: 0, vz: 0, state: 'follow', age: 1, kind: 0, dir: 0 });
  w.ringCount = 3; w.p.invuln = 0;
  // an enemy right on top of the player hurts them on the next step
  w.enemies.push({ x0: 1.5, z0: 2.5, x: 1.5, z: 2.5, y: 1, radius: 0.01, speed: 0, ang: 0, alive: true, diedAt: -9 });
  run(w, 3, { mx: 0, mz: 0 });
  assert.strictEqual(w.flickies[0].state, 'free');
});
test('scattered Flickies do not hop off a big drop', () => {
  // a 4 m shelf (cells 1 to 6) above 1 m ground; Flickies thrown about on the shelf stay on it
  const w = world(Object.assign(grid(W12('g' + row('g', 6) + row('4', 14) + 'g'), { entities: [{ type: 'start', x: 3.5, z: 2.5 }] }), { flickies: 5 }));
  for (let k = 0; k < 4; k++) w.flickies.push({ x: 5.5, y: 4, z: 2.5, vx: 3, vy: 5, vz: 0, state: 'free', age: 0, kind: k, dir: k * 1.5 });
  let low = 9;
  run(w, 600, (f, ww) => { for (const fl of ww.flickies) if (fl.state === 'free') low = Math.min(low, fl.y); return { mx: 0, mz: 0 }; });
  assert.ok(low > 3.5, `a Flicky got down to y ${low}`);
});
test("a Hunter's spike ball circles it and hurts a player standing in its path", () => {
  const w = world(arena([{ type: 'enemy', x: 6.5, z: 2.5, radius: 0, speed: 0, orbit: 0.73, orbitY: 0.6 }]));
  w.ringCount = 5; w.p.invuln = 0; w.p.x = 6.5 + 0.73; w.p.z = 2.5;   // on the circle, east of the Hunter
  const seen = [];
  let hit = false;
  run(w, 300, (f, ww) => { seen.push([ww.enemies[0].ball.x, ww.enemies[0].ball.z]); if (ww.ringCount === 0) hit = true; return { mx: 0, mz: 0 }; });
  assert.ok(hit, 'the ball hit the player');
  // it stays on its circle and turns clockwise seen from above (x east, z south: the angle from east grows toward south)
  for (const [x, z] of seen.slice(1)) assert.ok(Math.abs(Math.hypot(x - 6.5, z - 2.5) - 0.73) < 0.01);
  const a0 = Math.atan2(seen[1][1] - 2.5, seen[1][0] - 6.5), a1 = Math.atan2(seen[2][1] - 2.5, seen[2][0] - 6.5);
  assert.ok(((a1 - a0 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI > 0, "clockwise from above");
  assert.strictEqual(w.enemies[0].alive, true, 'the ball is not the Hunter: touching it does not defeat it');
});
test('jumping on a Hunter still defeats it', () => {
  const w = world(arena([{ type: 'enemy', x: 4.5, z: 2.5, radius: 0, speed: 0, orbit: 0.73, orbitY: 0.6 }]));
  run(w, 90, (f) => ({ mx: 1, mz: 0, jump: f > 5 && f < 30 }));
  assert.strictEqual(w.enemies[0].alive, false);
});
test('a ring with no Flickies left in the level still opens', () => {
  const w = world(Object.assign(arena([{ type: 'goal', x: 6.5, z: 2.5 }]), { flickies: 5 }));
  run(w, 90, { mx: 1, mz: 0 });
  assert.ok(w.cleared);
});
test('hazard tiles hurt', () => {
  const w = world(grid(W12('c44444444c'), { types: Array(5).fill('.....^....'), entities: [{ type: 'start', x: 1.5, z: 2.5 }] }));
  w.ringCount = 2;
  let hurt = false;
  run(w, 60, (f, ww) => { if (ww.events.includes('hurt')) hurt = true; return { mx: 1, mz: 0 }; });
  assert.ok(hurt);
});
test('resetLevel restores enemies, monitors and rings', () => {
  const w = world(arena([{ type: 'enemy', x: 4.5, z: 2.5, radius: 0.01, speed: 0 }, { type: 'monitor', x: 9.5, z: 2.5 }]));
  w.enemies[0].alive = false; w.monitors[0].broken = true; w.ringCount = 5;
  Sim.resetLevel(w);
  assert.ok(w.enemies[0].alive && !w.monitors[0].broken && w.ringCount === 0);
});

console.log('objects from the original');
const FLAT = (ents, extra = {}) => world(grid(W12('c' + row('4', 16) + 'c'), Object.assign({ entities: [{ type: 'start', x: 1.5, z: 2.5 }].concat(ents) }, ORIG, extra)));
test('spring throws the player 140 original units (4.375 m)', () => {
  const w = FLAT([{ type: 'spring', x: 5.5, z: 2.5, power: 15.9235 }]);   // S3D springPower at true shape
  place(w, 5.5, 2.5); let top = 0;
  run(w, 120, (f, ww) => { top = Math.max(top, ww.p.y); return { mx: 0, mz: 0 }; });
  near(top - 1, 4.375, 0.03, 'spring rise');
});
test('holding dash while running brakes, revs and launches', () => {
  const w = FLAT([]);
  w.p.facing = Math.PI / 2;
  run(w, 40, { mx: 1, mz: 0 });
  assert.ok(Math.hypot(w.p.vx, w.p.vz) > 6, 'running first');
  run(w, 40, { mx: 1, mz: 0, dash: true });
  assert.ok(w.p.charge > 0.3 && Math.hypot(w.p.vx, w.p.vz) < 1, `charge ${w.p.charge}`);
  run(w, 1, { mx: 1, mz: 0, dash: false });
  assert.ok(w.p.rolling && Math.hypot(w.p.vx, w.p.vz) > Sim.P.dashMin, 'launched');
});
test('pushing against the direction of travel skids', () => {
  const w = FLAT([]);
  run(w, 40, { mx: 1, mz: 0 });
  let skid = false; run(w, 6, (f, ww) => { if (ww.p.skid) skid = true; return { mx: -1, mz: 0 }; });
  assert.ok(skid, 'skidding');
  run(w, 60, { mx: -1, mz: 0 }); assert.ok(!w.p.skid && w.p.vx < 0, 'turned round');
});
test('a quick dash tap while running rolls without losing speed', () => {
  const w = FLAT([]);
  run(w, 40, { mx: 1, mz: 0 });
  const v0 = Math.hypot(w.p.vx, w.p.vz);
  run(w, 4, { mx: 1, mz: 0, dash: true }); run(w, 1, { mx: 1, mz: 0 });
  assert.ok(w.p.rolling && Math.hypot(w.p.vx, w.p.vz) > v0 * 0.9, 'rolling at speed');
});
const attack = w => run(w, 12, { dash: true });
test('monitors give what their icon shows', () => {
  for (const [kind, check] of [['rings', w => w.ringCount === 10], ['shield', w => w.p.shield === 'shield'], ['gold', w => w.p.shield === 'gold'],
    ['invincible', w => w.p.inv > 19], ['speed', w => w.p.fast > 19], ['oneup', w => w.lives === 4]]) {
    const w = FLAT([{ type: 'monitor', x: 5.5, z: 2.5, kind }]); place(w, 5.3, 2.5); attack(w);
    assert.ok(w.monitors[0].broken && check(w), kind);
  }
});
test('a shield takes a hit: no rings lost, shield gone', () => {
  const w = FLAT([{ type: 'mine', x: 8.5, z: 2.5 }]); w.ringCount = 7; w.p.shield = 'shield';
  place(w, 7.5, 2.5); run(w, 30, { mx: 1, mz: 0 });
  assert.strictEqual(w.ringCount, 7); assert.strictEqual(w.p.shield, null); assert.ok(!w.mines[0].alive);
});
test('a mine hurts and scatters rings', () => {
  const w = FLAT([{ type: 'mine', x: 8.5, z: 2.5 }]); w.ringCount = 7;
  place(w, 7.5, 2.5); run(w, 30, { mx: 1, mz: 0 });
  assert.strictEqual(w.ringCount, 0); assert.ok(w.loose.length === 7);
});
test('a turret fires at a player in range, and the shot hurts', () => {
  const w = FLAT([{ type: 'turret', x: 10.5, z: 2.5 }]); w.ringCount = 3;
  place(w, 6.5, 2.5); let fired = false;
  run(w, 240, (f, ww) => { if (ww.events.includes('shot')) fired = true; return {}; });
  assert.ok(fired, 'fired'); assert.strictEqual(w.ringCount, 0, 'hit');
});
test('invincibility: enemies and mines do not hurt, enemies pop on touch', () => {
  const w = FLAT([{ type: 'enemy', x: 8.5, z: 2.5, radius: 0 }, { type: 'mine', x: 11.5, z: 2.5 }]); w.ringCount = 5; w.p.inv = 10;
  place(w, 6.5, 2.5); run(w, 90, { mx: 1, mz: 0 });
  assert.strictEqual(w.ringCount, 5); assert.ok(!w.enemies[0].alive);
});
test('supercharger: jump on it, held a second, fired along its direction', () => {
  const w = FLAT([{ type: 'booster', x: 4.5, z: 2.5, dir: [1, 0] }]); place(w, 4.5, 2.5);
  run(w, 2, { jump: true });
  assert.ok(w.p.boost, 'taken in');
  run(w, 30, {}); near(w.p.x, 4.5, 1e-9, 'held');
  run(w, 40, {});
  assert.ok(w.p.x > 8 && !w.p.boost, `fired to x ${w.p.x}`);
});
test('a chasing enemy comes after a nearby player and a still one stays put', () => {
  const w = FLAT([{ type: 'enemy', x: 9.5, z: 2.5, radius: 1, chase: 1 }, { type: 'enemy', x: 14.5, z: 2.5, radius: 0 }]);
  place(w, 6.5, 2.5); run(w, 30, {});
  assert.ok(w.enemies[0].x < 9.2, `chaser at ${w.enemies[0].x}`); near(w.enemies[1].x, 14.5, 1e-9, 'still enemy');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
