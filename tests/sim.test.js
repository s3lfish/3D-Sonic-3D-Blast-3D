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
test('a cracked wall stops a walking player and breaks under a dash', () => {
  const lvl = () => grid(W12('c' + row('4', 20) + 'c'), { entities: [{ type: 'start', x: 1.5, z: 2.5 }, { type: 'crack', cells: [[8, 2]], top: 6, dir: [1, 0] }] });
  const a = world(lvl());
  run(a, 200, { mx: 1, mz: 0 });
  assert.ok(a.p.x < 8, `walked through to x ${a.p.x}`);
  assert.strictEqual(a.cracks[0].broken, false);
  const b = world(lvl());
  let broke = false;
  // face the wall, stop, rev a spin dash, release it
  run(b, 200, (f, w) => { if (w.events.includes('crack')) broke = true; return { mx: f < 8 ? 1 : 0, mz: 0, dash: f > 30 && f < 80 }; });
  assert.ok(broke, 'the dash broke it');
  assert.ok(b.p.x > 9, `carried on through to x ${b.p.x}`);
  assert.ok(Number.isFinite(Sim.floorAt(b.L, 8.5, 2.5)) && Sim.floorAt(b.L, 8.5, 2.5) < 2, 'the floor beneath is back');
});
test('a cannon catches a player dropping into its mouth and fires them on a jump', () => {
  const w = world(grid(W12('c' + row('4', 20) + 'c'), { entities: [{ type: 'start', x: 1.5, z: 2.5 },
    { type: 'cannon', x: 5, z: 1, y: 1.5, h: 0.4, vy: 12, vz: 6 }] }));
  w.p.x = 5.4; w.p.z = 1.1; w.p.y = 2.5; w.p.vy = 0; w.p.grounded = false;
  run(w, 30, { mx: 0, mz: 0 });
  assert.ok(w.p.cannon, 'caught');
  let fired = false, top = 0, drift = 0, flewTo = 0;
  run(w, 90, (f, ww) => {
    if (ww.events.includes('cannon')) fired = true;
    top = Math.max(top, ww.p.y);
    if (fired && !ww.p.grounded) { drift = Math.max(drift, Math.abs(ww.p.x - 5.40625)); flewTo = ww.p.z; }
    return { mx: f > 3 ? -1 : 0, mz: 0, jump: f === 2 };
  });
  assert.ok(fired && !w.p.cannon, 'fired');
  assert.ok(top > 4.5, `rose to ${top}`);
  assert.ok(drift < 0.01, `no steering in flight (drifted ${drift})`);
  assert.ok(flewTo > 3, `went south to z ${flewTo}`);
});
test('a fan sets the player whirling: held on it, slow to steer, bouncing off walls, ended by a jump', () => {
  const w = world(arena([{ type: 'fan', cells: [[3, 2]] }]));
  w.p.x = 3.5; w.p.z = 2.5;
  let started = false;
  run(w, 20, (f, ww) => { if (ww.events.includes('whirl')) started = true; return { mx: 1, mz: 0 }; });
  assert.ok(started && w.p.whirl, 'whirling'); near(w.p.x, 3.5, 0.05, 'held on the fan');
  run(w, 40, { mx: 1, mz: 0 });
  assert.ok(w.p.vx > 3 && w.p.vx < 6.5, `picks up speed slowly: ${w.p.vx}`);
  let bounced = false;
  run(w, 240, (f, ww) => { if (ww.p.vx < -3) bounced = true; return { mx: 1, mz: 0 }; });
  assert.ok(bounced, 'bounced off the wall'); assert.ok(w.p.whirl, 'still whirling');
  run(w, 5, { mx: 0, mz: 0, jump: true }); assert.ok(!w.p.whirl, 'a jump ends it');
});
test('a pillar stops walking and dashing players but breaks under a whirl', () => {
  const lvl = fan => arena([{ type: 'crack', by: 'whirl', cells: [[8, 2]], top: 6 }, ...(fan ? [{ type: 'fan', cells: [[3, 2]] }] : [])]);
  const a = world(lvl(false));
  run(a, 200, (f, w) => ({ mx: f < 8 ? 1 : 0, mz: 0, dash: f > 30 && f < 80 }));
  run(a, 100, { mx: 1, mz: 0 });
  assert.ok(a.p.x < 8 && !a.cracks[0].broken, `got through to x ${a.p.x}`);
  const b = world(lvl(true));
  run(b, 200, { mx: 1, mz: 0 });
  assert.ok(b.cracks[0].broken, 'the whirl broke it'); assert.ok(b.p.x > 9, `carried on to x ${b.p.x}`);
});
test('a door moves a player standing on it to its exit and pushes them out along the floor', () => {
  const w = world(arena([{ type: 'hole', x: 4.5, z: 2.5, size: 0.5, opens: 0, exit: [15.5, 2.5], exitY: 0.75, push: [7.5, 0], launch: 0 }]));
  let warped = false, grounded = false;
  run(w, 60, (f, ww) => { if (ww.events.includes('warp')) { warped = true; grounded = ww.p.grounded; } return { mx: warped ? 0 : 1, mz: 0 }; });
  assert.ok(warped && grounded, 'came out on the floor'); assert.ok(w.p.x > 15.6, `pushed east to ${w.p.x}`);
});
test('a pad under a used ring holds a slow player, sinks them, and throws them out of the other pad', () => {
  const w = world(arena([{ type: 'goal', x: 4.5, z: 2.5 }, { type: 'goal', x: 19.5, z: 2.5 },
    { type: 'hole', x: 8.5, z: 2.5, opens: 1, exit: [15.5, 2.5], launch: 6, pad: { sink: 1.75, bury: 1.47 } }]));
  run(w, 60, (f, ww) => ({ mx: ww.section ? 0 : 1, mz: 0 }));
  assert.strictEqual(w.section, 1, 'ring used');
  Object.assign(w.p, { x: 10.5, z: 2.5, vx: 0, vz: 0 });
  let held = -1;
  run(w, 120, (f, ww) => { if (held < 0 && ww.p.pad) held = f; return { mx: ww.p.pad ? 1 : -0.4, mz: 0 }; });
  assert.ok(held >= 0, 'taken in walking slowly');
  assert.ok(w.p.pad, 'still held');
  run(w, 100 - (120 - held) + 2, { mx: 1, mz: 0 });
  assert.ok(w.p.pad && w.p.pad.out, 'came out under the other pad'); near(w.p.x, 15.5, 1e-9, 'at the exit'); assert.ok(w.p.y < 0, `buried: y ${w.p.y}`);
  let top = 0; run(w, 140, (f, ww) => { top = Math.max(top, ww.p.y); return {}; });
  assert.ok(!w.p.pad && top > 1.5, `thrown up after a wait: top ${top}`);
});
test('a ring with a pocket: its pad takes the player there, they walk out by themselves, the ride plays its path', () => {
  const path = []; for (let i = 0; i < 30; i++) path.push([0, i < 15 ? 0.1 : -0.05, 0.05]);
  const w = world(arena([{ type: 'goal', x: 4.5, z: 2.5, put: [9.5, 2.5, 90] }, { type: 'goal', x: 19.5, z: 2.5 },
    { type: 'hole', x: 4.5, z: 2.5, opens: 1, exit: [9.5, 2.5], launch: 0, pad: { sink: 1.75, bury: 1.47, pocket: true } },
    { type: 'hole', x: 14.5, z: 2.5, size: 0.5, opens: 1, air: true, ride: { start: [16.5, 2, 1.5], facing: 180, vel: [0, 0, 2], path, turns: [[20, 90]], end: null } }]));
  let warped = -1, rode = -1;
  run(w, 400, (f, ww) => { if (warped < 0 && ww.events.includes('warp')) warped = f; if (ww.events.includes('ride')) rode = f; return { mx: 0.4, mz: 0 }; });
  assert.strictEqual(w.section, 1, 'ring used'); assert.ok(warped > 0, 'the pad took the player to the pocket');
  assert.ok(rode > warped + 60, `walked out by itself after a wait (${rode - warped} frames)`);
  Sim.respawn(w); near(w.p.x, 9.5, 1e-9, 'a lost life starts in the pocket'); assert.ok(w.p.auto, 'and walks out again');
  const w2 = world(arena([{ type: 'hole', x: 3.5, z: 2.5, size: 0.5, opens: 0, air: true, ride: { start: [16.5, 2, 1.5], facing: 180, vel: [0, 0, 2], path, turns: [[20, 90]], end: null } }]));
  for (let f = 0; f < 120 && !(w2.p.ride && w2.p.ride.i === 25); f++) Sim.step(w2, { mx: w2.p.ride ? 0 : 1, mz: 0 });
  assert.ok(w2.p.ride, 'riding'); near(w2.p.x, 16.5, 1e-9, 'moved to the start'); near(w2.p.facing, Math.PI / 2, 1e-9, 'turned on frame 20');
  near(w2.p.z, 1.5 + 25 * 0.05, 1e-9, 'followed the path');
  run(w2, 60, {});
  assert.ok(!w2.p.ride, 'ride over'); assert.ok(w2.p.z > 1.5 + 1.5 + 0.2, `carried on south with the routine's velocity: z ${w2.p.z}`);
});
test('a slide pushes a grounded player down it, and a linked pillar sinks to its own floor and lowers another cell', () => {
  const w = world(arena([{ type: 'slide', cells: [[6, 2], [7, 2], [8, 2]], dir: [1, 0] }]));
  w.p.x = 6.5; run(w, 60, {});
  assert.ok(w.p.x > 9, `slid east to ${w.p.x}`);
  const v = world(arena([{ type: 'fan', cells: [[3, 2]] }, { type: 'crack', by: 'whirl', cells: [[8, 2, 6, 0.5], [12, 3, 5, null, 1]], top: 6 }]));
  run(v, 200, { mx: 1, mz: 0 });
  assert.ok(v.cracks[0].broken, 'broken'); near(Sim.floorAt(v.L, 8.5, 2.5), 0.5, 1e-9, 'sank to its own floor');
  near(Sim.floorAt(v.L, 12.5, 3.5), 1, 1e-9, 'the linked cell is back to the floor');
});
test('a raised spring (a trampoline) bounces a player landing on it; a lift sinks a moment after they land', () => {
  const w = world(arena([{ type: 'spring', x: 6.5, z: 2.5, absY: 2.5, power: 7 }]));
  Object.assign(w.p, { x: 6.5, z: 2.5, y: 3.5, grounded: false, vy: 0 });
  let top = 0, bounced = false; run(w, 60, (f, ww) => { if (ww.events.includes('spring')) bounced = true; top = Math.max(top, ww.p.y); return {}; });
  assert.ok(bounced, 'bounced'); assert.ok(top > 3.5, `went back up to ${top}`);
  const v = world(arena([{ type: 'lift', x: 8.5, z: 2.5, y: 2, drop: 0.8 }]));
  Object.assign(v.p, { x: 8.5, z: 2.5, y: 2 });
  run(v, 30, {}); near(v.p.y, 2, 1e-9, 'still up after half a second');
  run(v, 120, {}); near(v.p.y, 1.2, 1e-9, 'sank with the player on it');
});
test('a mace ball circling its post hurts; a flamethrower fires while the player stands in front of it', () => {
  const w = world(arena([{ type: 'mace', x: 8.5, z: 2.5, y: 1.4, r: 2, w: 1.5, balls: [0] }]));
  let hit = false; Object.assign(w.p, { x: 8.5, z: 4.4 });
  run(w, 300, (f, ww) => { if (ww.events.includes('respawn') || ww.events.includes('hurt')) hit = true; return {}; });
  assert.ok(hit, 'the ball came round and hit');
  const v = world(arena([{ type: 'flame', x: 4, z: 2.5, y: 1, dir: [1, 0] }]));
  let fired = 0, burnt = false; Object.assign(v.p, { x: 6.5, z: 2.5 });
  run(v, 60, (f, ww) => { if (ww.events.includes('flame')) fired++; if (ww.events.includes('respawn')) burnt = true; return {}; });
  assert.ok(fired >= 1 && burnt, `fired ${fired}, burnt ${burnt}`);
  const u = world(arena([{ type: 'flame', x: 4, z: 2.5, y: 1, dir: [1, 0] }]));
  Object.assign(u.p, { x: 12.5, z: 2.5 }); let quiet = true;
  run(u, 60, (f, ww) => { if (ww.events.includes('flame')) quiet = false; return {}; });
  assert.ok(quiet, 'quiet when the player is not in front');
});
test('the Green Grove boss comes down, drops its ball to hop at the player, sinks to take it back, and goes down after five hits', () => {
  const rows = Array.from({ length: 20 }, () => '4'.repeat(20));
  const lvl = grid(rows, { entities: [{ type: 'start', x: 3.5, z: 3.5 }, { type: 'boss', kind: 'gg', x: 12, y: 10, z: 12, home: [10, 10], cruise: 5, arena: [2, 18, 2, 18], hp: 5 }] });
  const w = world(lvl);
  const seen = new Set();
  w.ringCount = 50;
  for (let f = 0; f < 2400 && !(w.boss.step === 3 && w.boss.sub === 1); f++) {
    Sim.step(w, {}); for (const e of w.events) seen.add(e);
    if (w.boss.phase && w.boss.step === 1) seen.add('chased');
  }
  assert.ok(seen.has('bossDrop') && seen.has('bossHop'), `dropped and hopped: ${[...seen]}`);
  assert.ok(w.boss.step === 3 && w.boss.sub === 1, 'sank to the ball');
  near(w.boss.x, 10, 1e-9, 'went home first');
  // five stomps from above while it waits low (the player made invincible so the hopping ball cannot send them back)
  let hits = 0; w.p.inv = 1e9;
  for (let k = 0; k < 5; k++) {
    for (let f = 0; f < 3000 && !(w.boss.step === 3 && w.boss.sub === 1 && w.boss.cool <= 0); f++) Sim.step(w, {});
    Object.assign(w.p, { x: w.boss.x, z: w.boss.z, y: w.boss.y + 0.5, vy: -1, grounded: false, invuln: 0, inv: 1e9 });
    Sim.step(w, {}); if (w.events.includes('bossHit')) hits++;
  }
  assert.strictEqual(hits, 5, 'five hits'); assert.ok(w.boss.dead >= 0, 'beaten');
  let goal = false; run(w, 300, (f, ww) => { if (ww.events.includes('goal')) goal = true; return {}; });
  assert.ok(goal && w.cleared, 'the act ends');
});
test('the Rusty Ruin boss: the pod comes down, an arm reaches to the player and slams, its fist carries the player up, and five touches beat it', () => {
  // the converted act's boss (RR3 at true height); the script is the routine's table read by the converter
  const script = [[6, 140], [12, 1], [6, 200], [7, 45], [2, 20], [11, 1], [2, 30], [0, 500], [8, 25], [3, 16], [2, 20], [10, 1], [2, 100], [4, 64], [9, 25], [1, 500], [5, 1]];
  const boss = { type: 'boss', kind: 'rr', x: 4, y: 10.313, z: 1, home: [4, 1], cruise: 5, arena: [1, 6.969, 1, 6.969], hp: 5, vs: 1,
    arms: [2, 6], root: [4.25, 1], cap: 10.938, reach: [3, 4.438], loop: 7, script };
  const lvl = grid(Array.from({ length: 8 }, () => '8'.repeat(8)), { entities: [{ type: 'start', x: 3, z: 4 }, boss] });
  const w = world(lvl), b = () => w.boss, U = 1 / 32;
  // the player waits beside the fist's path at z 2176 (the emulator's (1830, 2176)): the pod settles at 152 + 8 units,
  // the cap at 162 + 8
  const seen = new Set();
  for (let f = 0; f < 437; f++) { Sim.step(w, {}); for (const e of w.events) seen.add(e); }
  near(b().y, 10.313 - 170 * U, 1e-6, 'pod down'); near(b().cap, 10.938 - 180 * U, 1e-6, 'cap down');
  // the left arm reaches 16 units short of the player (wrist at z 2160: reach 80), the right one rises, the left slams
  let slamAt = -1;
  for (let f = 0; f < 120 && slamAt < 0; f++) { Sim.step(w, {}); if (w.events.includes('bossSlam')) slamAt = f; }
  assert.ok(slamAt > 0, 'slammed');
  assert.strictEqual(JSON.stringify(b().arms), '[[80,-64],[82,-25]]', 'arms as the emulator logged them');
  const A = Sim.rrArm(b(), 0);
  near(A.links[3][1], 4.25 - 62 * U, 0.02, 'elbow height (66 + 8)'); near(A.links[3][2], 1 + 16 * U, 0.02, 'elbow z (2096)');
  near(A.fist[1], (84 + 8) * U, 1e-9, 'fist height'); near(A.fist[2], 1 + 80 * U, 1e-9, 'fist z');
  assert.ok(seen.has('bossCap'), 'the cap came down');
  // ride this fist up: it carries the player as it lifts and pulls back
  Object.assign(w.p, { x: 2.25, z: 4, y: 3.2, vx: 0, vy: 0, vz: 0, grounded: false });
  run(w, 20, {});
  near(w.p.y, (83 + 8) * U, 1e-6, 'standing on the slammed fist');
  run(w, 101 + 64 + 25, {});
  near(w.p.y, (147 + 8) * U, 1e-6, 'lifted with it'); near(b().arms[0][1], 0, 0, 'lift done');
  run(w, 49, {});
  near(w.p.z, 4 - 48 * U, 0.02, 'carried back as it pulls in (2176 to 2128)');
  // any touch on the pod is a hit, 60 frames apart; five beat it
  let hits = 0; w.p.inv = 1e9;
  for (let k = 0; k < 5; k++) {
    for (let f = 0; f < 200 && b().cool > 0; f++) Sim.step(w, {});
    Object.assign(w.p, { x: b().x - 0.5, z: b().z + 0.5, y: b().y + 0.3, vx: 0, vy: -0.5, vz: 0, grounded: false });
    Sim.step(w, {}); if (w.events.includes('bossHit')) hits++;
    assert.ok(w.p.vy > 5, 'knocked up');
  }
  assert.strictEqual(hits, 5, 'five hits'); assert.ok(b().dead >= 0, 'beaten');
  let goal = false; run(w, 300, (f, ww) => { if (ww.events.includes('goal')) goal = true; return {}; });
  assert.ok(goal && w.cleared, 'the act ends');
  // a fist coming down on a player hurts (the emulator: Sonic at (1800, 2176) under the slam)
  const w2 = world(grid(lvl.heights, { entities: [{ type: 'start', x: 2.25, z: 4 }, boss] })); w2.ringCount = 10;
  let hurtUnder = false;
  run(w2, 437 + 120, (f, ww) => { if (ww.events.includes("hurt")) hurtUnder = true; return {}; });
  assert.ok(hurtUnder, 'hurt under the slam');
});
test('a spiked crawler rolls to the ends of its run and back, and hurts a player in its way', () => {
  const lvl = grid(Array.from({ length: 6 }, () => '4'.repeat(10)), { entities: [{ type: 'start', x: 8.5, z: 1.5 },
    { type: 'crawler', x: 3, y: 1.5, z: 3.5, axis: 'x', range: [2, 5] }] });
  const w = world(lvl); w.ringCount = 5;
  let lo = 9, hi = -9;
  run(w, 240, (f, ww) => { lo = Math.min(lo, ww.crawlers[0].x); hi = Math.max(hi, ww.crawlers[0].x); return {}; });
  near(lo, 2, 1e-9, 'west end'); near(hi, 5, 1e-9, 'east end'); near(w.crawlers[0].z, 3.5, 0, 'stays on its line');
  Object.assign(w.p, { x: 3.5, z: 3.5 }); let hurt = false;
  run(w, 120, (f, ww) => { if (ww.events.includes('hurt')) hurt = true; return {}; });
  assert.ok(hurt, 'hurt');
});
test('the Spring Stadium boss comes down, then chases the player; a spin from above hits it, a touch from below hurts; eight', () => {
  const boss = { type: 'boss', kind: 'ss', x: 8, y: 17.75, z: 8, home: [8, 8], cruise: 5.25, arena: [2, 14, 2, 14], hp: 8, vs: 1,
    hover: 6.25, low: 3.75, hang: 1.25, fists: [[1.188, 1.25], [-1.437, 1.25]], corners: [] };
  const lvl = grid(Array.from({ length: 16 }, () => '4'.repeat(16)), { entities: [{ type: 'start', x: 3, z: 3 }, boss] });
  const w = world(lvl), b = () => w.boss, U = 1 / 32;
  w.p.inv = 1e9;
  run(w, 399, {});
  near(b().y, 5.25 + 1 / 32, 1e-6, 'came down to its first height'); near(b().x, 8, 1e-9, 'still till then');
  run(w, 200, {});
  assert.ok(Math.hypot(b().x - 3, b().z - 3) < Math.hypot(5, 5) - 1, `headed for the player (${b().x.toFixed(2)}, ${b().z.toFixed(2)})`);
  near(b().y, 6.25, 1e-6, 'hovering');
  // a touch from below hurts
  const w2 = world(lvl); w2.ringCount = 5; run(w2, 500, {});
  Object.assign(w2.p, { x: w2.boss.x, z: w2.boss.z, y: w2.boss.y - 0.5, vy: 0, grounded: false, ball: false, jumping: false });
  let hurt = false; Sim.step(w2, {}); if (w2.events.includes('hurt')) hurt = true;
  assert.ok(hurt, 'hurt from below');
  // eight spins from above
  let hits = 0;
  for (let k = 0; k < 8; k++) {
    for (let f = 0; f < 200 && b().cool > 0; f++) Sim.step(w, {});
    Object.assign(w.p, { x: b().x, z: b().z, y: b().y + 0.4, vy: -1, grounded: false, ball: true, jumping: true });
    Sim.step(w, {}); if (w.events.includes('bossHit')) hits++;
  }
  assert.strictEqual(hits, 8, 'eight hits'); assert.ok(b().dead >= 0, 'beaten');
  let goal = false; run(w, 300, (f, ww) => { if (ww.events.includes('goal')) goal = true; return {}; });
  assert.ok(goal, 'the act ends');
});
test('the Diamond Dust boss: comes down, chases, puffs freezing snow when low, drops a snowman that throws snowballs; eight', () => {
  const boss = { type: 'boss', kind: 'dd', x: 8.125, y: 18.25, z: 8, home: [8, 8], cruise: 5.75, arena: [2, 14, 2, 14], hp: 8, vs: 1,
    low: 2, high: 4.5, dropY: 3.5, hitAt: 10, oct: [-6.75, 6.75, 7.5, 24.75],
    script: [[1, 400], [0, 500], [1, 20], [2, 1], [1, 44], [0, 150], [1, 20], [2, 1], [1, 44], [-1, 1], [0, 100], [1, 20], [2, 1], [1, 44], [-1, 1]] };
  const lvl = grid(Array.from({ length: 16 }, () => '4'.repeat(16)), { entities: [{ type: 'start', x: 4, z: 4 }, boss] });
  let w = world(lvl); const b = () => w.boss;
  w.p.inv = 1e9; run(w, 400, {});
  near(b().y, 18.25 - 400 / 32, 1e-6, 'a unit a frame down'); near(b().x, 8.125, 1e-9, 'waiting');
  run(w, 300, {}); assert.ok(Math.hypot(b().x - 4, b().z - 4) < Math.hypot(4.125, 4) - 1, 'chasing');
  // snow at the low height freezes a player near it
  w = world(lvl); w.p.inv = 1e9; run(w, 560, {}); Object.assign(w.boss, { x: 4, z: 6, y: 2, target: 2, blowT: 0 });
  let froze = false; run(w, 60, (f, ww) => { ww.p.inv = 1e9; if (ww.events.includes('freeze')) froze = true; return {}; });
  assert.ok(froze, 'frozen by snow');
  // a dropped snowman wakes near the player and throws snowballs
  w = world(lvl); w.p.inv = 0; w.ringCount = 5; Object.assign(w.boss, { x: 5.06, z: 4.06, y: 4.5, target: 4.5, t: 1, si: 2, fresh: false });
  let balls = 0, hurt = false; run(w, 160, (f, ww) => { balls = Math.max(balls, ww.boss.balls.length); if (ww.events.includes('hurt')) hurt = true; return {}; });
  assert.ok(balls === 8 && hurt, `snowballs ${balls}, hurt ${hurt}`);
  // eight spins from above
  w = world(lvl); w.p.inv = 1e9; run(w, 400, {});
  let hits = 0;
  for (let k = 0; k < 8; k++) {
    for (let f = 0; f < 200 && b().cool > 0; f++) Sim.step(w, {});
    Object.assign(w.p, { x: b().x, z: b().z, y: b().y + 0.4, vy: -1, grounded: false, ball: true, jumping: true });
    Sim.step(w, {}); if (w.events.includes('bossHit')) hits++;
  }
  assert.strictEqual(hits, 8, 'eight hits'); assert.ok(b().dead >= 0 && b().blowA !== undefined, 'beaten');
});
test('converted spike blocks (H) hurt', () => {
  const tiles = []; for (let k = 0; k < 15; k++) tiles.push({ c: [1, 1, 1, 1], t: k === 7 ? 'H' : 'F' });
  const w = world({ version: 1, format: 'tiles', width: 5, depth: 3, tiles, entities: [{ type: 'start', x: 0.5, z: 1.5 }] });
  let respawned = false;
  run(w, 60, (f, ww) => { if (ww.events.includes('respawn')) respawned = true; return { mx: 1, mz: 0 }; });
  assert.ok(respawned, 'no rings: a hit sends the player back');
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
test('supercharger: standing on its spot is enough; held 70 frames, then dashed off along its way', () => {
  const w = FLAT([{ type: 'booster', x: 4.5, z: 2.5, dir: [1, 0] }]); place(w, 4.5, 2.5);
  run(w, 2, {});
  assert.ok(w.p.boost, 'taken in');
  run(w, 60, {}); near(w.p.x, 4.5, 1e-9, 'held');
  run(w, 30, {});
  assert.ok(w.p.x > 7 && !w.p.boost && w.p.rolling, `dashed to x ${w.p.x}`);
});
test('Spring Stadium cells: a floor spring, a bumper push, spikes after 18 frames, a loop ride with the pad held after', () => {
  const rows = Array.from({ length: 8 }, () => '4'.repeat(16));
  const ride = { start: null, facing: null, vel: [13, 0, 0], path: Array.from({ length: 10 }, () => [0.2, 0, 0]), turns: [], end: null, force: { t: 1, dir: [1, 0] } };
  const lvl = grid(rows, { entities: [{ type: 'start', x: 1.5, z: 1.5 }, { type: 'springCells', cells: [[3, 1]], power: 9 },
    { type: 'bumpers', cells: [[6, 1]] }, { type: 'spikeField', cells: [[9, 1]] }, { type: 'hole', x: 2.5, z: 5.5, size: 0.5, air: true, ride }] });
  let w = world(lvl); place(w, 3.5, 1.5); run(w, 2, {});
  assert.ok(w.p.vy > 5 && !w.p.grounded, 'sprung');
  w = world(lvl); place(w, 5.5, 1.5); let bumped = -1;
  run(w, 30, (f, ww) => { if (bumped < 0 && ww.events.includes('bumper')) bumped = f; return { mx: 1 }; });
  assert.ok(bumped >= 0 && w.p.x < 6.6, `bumped back west (x ${w.p.x})`);
  w = world(lvl); w.ringCount = 5; place(w, 9.5, 1.5); let hurtAt = -1;
  run(w, 40, (f, ww) => { if (hurtAt < 0 && ww.events.includes('hurt')) hurtAt = f; return {}; });
  assert.ok(hurtAt >= 16 && hurtAt <= 22, `spikes out at frame ${hurtAt}`);
  w = world(lvl); place(w, 2.5, 5.5); run(w, 1, {});
  assert.ok(w.p.ride, 'ride taken'); run(w, 11, {});
  assert.ok(!w.p.ride && w.p.force, 'pad held after'); run(w, 30, {});
  assert.ok(Math.hypot(w.p.vx, w.p.vz) > 12, `running on at ${Math.hypot(w.p.vx, w.p.vz)}`);
});
test('Spring Stadium 2: a triangle bumper bounces off its long side, a spear rises after 34 frames, a spiked wall hurts', () => {
  const rows = Array.from({ length: 8 }, () => '4'.repeat(16));
  const lvl = grid(rows, { entities: [{ type: 'start', x: 1.5, z: 1.5 },
    { type: 'triBumpers', list: [{ band: 'x', b: 4, s: 4, flip: false, v: [-7.5, 7.5], along: true }] },
    { type: 'spears', cells: [[10, 2]] }, { type: 'spikeWall', cells: [[13, 5]], top: 9 }] });
  let w = world(lvl); place(w, 5.0, 4.6); run(w, 1, {});
  near(w.p.vx, -7.5, 1e-9, 'bounced west'); near(w.p.vz, 7.5, 1e-9, 'and south');
  w = world(lvl); w.ringCount = 5; place(w, 10.9, 2.5); let hurtAt = -1;
  run(w, 70, (f, ww) => { if (hurtAt < 0 && ww.events.includes('hurt')) hurtAt = f; return {}; });
  assert.ok(hurtAt >= 34 && hurtAt <= 50, `speared at frame ${hurtAt}`);
  w = world(lvl); w.ringCount = 5; place(w, 13.6, 5.5); let hit = false;
  run(w, 20, (f, ww) => { if (ww.events.includes('hurt')) hit = true; return { mx: -1 }; });
  assert.ok(hit, 'spiked wall');
});
test('a balloon pops under a player, throws them up, and comes back', () => {
  const w = FLAT([{ type: 'balloon', x: 4.5, y: 2.2, z: 2.5, rise: 5.3 }]); place(w, 4.5, 2.5);
  Object.assign(w.p, { y: 3.4, grounded: false, vy: 0 });
  let popped = -1; run(w, 40, (f, ww) => { if (popped < 0 && ww.events.includes('balloon')) popped = f; return {}; });
  assert.ok(popped >= 0, 'popped'); assert.ok(w.balloons[0].pop > 0, 'gone a while');
  run(w, 80, {}); assert.ok(w.balloons[0].pop <= 0, 'back');
});
test('a chasing enemy comes after a nearby player and a still one stays put', () => {
  const w = FLAT([{ type: 'enemy', x: 9.5, z: 2.5, radius: 1, chase: 1 }, { type: 'enemy', x: 14.5, z: 2.5, radius: 0 }]);
  place(w, 6.5, 2.5); run(w, 30, {});
  assert.ok(w.enemies[0].x < 9.2, `chaser at ${w.enemies[0].x}`); near(w.enemies[1].x, 14.5, 1e-9, 'still enemy');
});
test('Diamond Dust: a chute slides and steers, a current pushes, a dash cell runs and jumps, a snowblower freezes', () => {
  let w = FLAT([{ type: 'chute', box: [3, 6, 0, 12], dir: [1, 0], accel: 28 }]); place(w, 4.5, 2.5); run(w, 30, {});
  assert.ok(w.p.chute && w.p.vx > 2, `sliding at ${w.p.vx}`);
  w = FLAT([{ type: 'current', box: [3, 9, 0, 12], dir: [1, 0], accel: 42, top: 3.75, leave: 4.7 }]); place(w, 4.5, 2.5); run(w, 60, {});
  near(w.p.vx, 3.75, 0.05, 'current top speed');
  w = FLAT([{ type: 'dash', x: 3.5, z: 2.5, v: [7, 0], t: 0.6, jumpAt: 0.3, jumpV: 6 }]); place(w, 3.5, 2.5);
  let jumped = -1; run(w, 30, (f, ww) => { if (jumped < 0 && ww.events.includes('jump')) jumped = f; return {}; });
  assert.ok(jumped >= 16 && jumped <= 20 && w.p.x > 6, `dash jump at ${jumped}, x ${w.p.x}`);
  w = FLAT([{ type: 'flame', x: 4, z: 2.5, y: 1, dir: [1, 0], freeze: true }]); w.ringCount = 5; place(w, 5.5, 2.5);
  let froze = -1; run(w, 30, (f, ww) => { if (froze < 0 && ww.events.includes('freeze')) froze = f; return { mx: 1 }; });
  assert.ok(froze >= 0 && w.p.frozen > 0 && w.ringCount === 5, 'frozen, no rings lost');
  let thaw = -1; run(w, 120, (f, ww) => { if (thaw < 0 && ww.events.includes('thaw')) thaw = f; return { mx: 1, jump: true }; });
  assert.ok(thaw > 10 && thaw < 60 && w.p.frozen === 0, `thawed ${thaw} frames into the second run`);
});
// the original's movement tables, against Green Grove 2 in the emulator (units a frame: x 60 / 32 for m/s)
const UF = v => v * 60 / 32;
const ORIGM = (ents = []) => world(grid(W12('c' + row('4', 40) + 'c'), Object.assign({ entities: [{ type: 'start', x: 1.5, z: 2.5, facing: 90 }].concat(ents) },
  { physics: Object.assign({}, ORIG.physics, { orig: 1 }) })));
test('original movement: run up 0.132 units a frame per frame, top near 5, stop at 0.149', () => {
  const w = ORIGM(); place(w, 2.5, 2.5); w.p.facing = Math.PI / 2;
  run(w, 30, { mx: 1 }); near(w.p.vx, UF(3.97), UF(0.02), 'speed after 30 frames');
  run(w, 30, { mx: 1 }); assert.ok(w.p.vx > UF(4.6) && w.p.vx < UF(5.05), `top ${w.p.vx / UF(1)}`);
  const v0 = w.p.vx; run(w, 10, {}); near(v0 - w.p.vx, UF(1.49), UF(0.02), 'ten frames of stopping');
});
test('original movement: a 90 degree turn at top speed takes 8 frames to face and keeps sliding sideways', () => {
  const w = ORIGM(); place(w, 2.5, 2.5); w.p.facing = Math.PI / 2;
  run(w, 45, { mx: 1 }); run(w, 8, { mz: 1 });
  near(w.p.facing, 0, 1e-6, 'facing south after 8 frames');
  assert.ok(w.p.vx > UF(3.9) && w.p.vx < UF(4.4) && w.p.vz > UF(1.5) && w.p.vz < UF(1.95), `v ${w.p.vx / UF(1)}, ${w.p.vz / UF(1)}`);
  run(w, 10, { mz: 1 }); near(w.p.vx, UF(4.21 - 10 * 0.219), UF(0.15), 'side part lost at 0x380');
});
test('original movement: the spin dash launches in steps of held time, and a roll lasts', () => {
  const sp = held => { const w = ORIGM(); place(w, 2.5, 2.5); w.p.facing = Math.PI / 2; run(w, held, { dash: true }); run(w, 1, {}); return w; };
  near(sp(10).p.vx, 0, 1e-9, 'too short');
  near(sp(20).p.vx, UF(3.75), UF(0.01), 'first step');
  near(sp(35).p.vx, UF(5.625), UF(0.01), 'second');
  near(sp(80).p.vx, UF(7.5), UF(0.01), 'full');
  const w = sp(80); run(w, 60, {}); assert.ok(w.p.rolling && w.p.vx > UF(7.2), `still rolling at ${w.p.vx / UF(1)}`);
});
test('original movement: a jump without the stick loses 0.086 a frame per frame; ice is slippery', () => {
  let w = ORIGM(); place(w, 2.5, 2.5); w.p.facing = Math.PI / 2; run(w, 45, { mx: 1 });
  run(w, 1, { mx: 1, jump: true }); const v0 = w.p.vx; run(w, 10, { jump: true });
  near(v0 - w.p.vx, UF(0.86), UF(0.03), 'air drag in the ball');
  w = ORIGM([{ type: 'ice', on: [[3, 2]], off: [] }]); place(w, 3.5, 2.5); w.p.facing = Math.PI / 2;
  run(w, 2, {}); assert.ok(w.ice, 'ice on');
  run(w, 30, { mx: 1 }); near(w.p.vx, UF(30 * (0x100 - 0x20) / 0x1000), UF(0.02), 'slow start on ice');
  const v1 = w.p.vx; run(w, 30, {}); near(v1 - w.p.vx, UF(30 * 0x20 / 0x1000), UF(0.01), 'long slide');
});
test('Diamond Dust: ice spikes hurt until a roll breaks them; a low roof stops a jump', () => {
  let w = ORIGM([{ type: 'iceSpikes', cells: [[5, 2]] }]); w.ringCount = 5; place(w, 3.5, 2.5); w.p.facing = Math.PI / 2;
  let hit = false; run(w, 40, (f, ww) => { if (ww.events.includes('hurt')) hit = true; return { mx: 1 }; });
  assert.ok(hit, 'walking in hurts');
  w = ORIGM([{ type: 'iceSpikes', cells: [[5, 2]] }]); w.ringCount = 5; place(w, 2.5, 2.5); w.p.facing = Math.PI / 2;
  run(w, 80, { dash: true }); let broke = false; hit = false;
  run(w, 30, (f, ww) => { if (ww.events.includes('iceBreak')) broke = true; if (ww.events.includes('hurt')) hit = true; return {}; });
  assert.ok(broke && !hit && w.ringCount === 5, 'rolled through');
  w = ORIGM([{ type: 'lowRoof', cells: [[3, 2]], top: 1.25 }]); place(w, 3.5, 2.5);
  let top = 0; run(w, 30, (f, ww) => { top = Math.max(top, ww.p.y); return { jump: true }; });
  assert.ok(top < 1.1, `kept down (${top})`);
});

test('Volcano Valley: lava hurts unless the fire shield, a rock breaks under a ball and bounces, a vent throws, a jet lift rises', () => {
  let w = FLAT([{ type: 'lava', cells: [[5, 2]] }]); w.ringCount = 5; place(w, 3.5, 2.5);
  let burnt = false; run(w, 60, (f, ww) => { if (ww.events.includes('lava')) burnt = true; return { mx: 1 }; });
  assert.ok(burnt, 'lava burns');
  w = FLAT([{ type: 'lava', cells: [[5, 2]] }]); w.ringCount = 5; w.p.shield = 'fire'; place(w, 3.5, 2.5); burnt = false;
  run(w, 60, (f, ww) => { if (ww.events.includes('lava') || ww.events.includes('hurt')) burnt = true; return { mx: 1 }; });
  assert.ok(!burnt && w.p.shield === 'fire', 'the fire shield spares');
  w = FLAT([{ type: 'rocks', cells: [[4, 2, 1.5]] }]); place(w, 4.5, 2.5); Object.assign(w.p, { y: 2.5, grounded: false, ball: true, jumping: true, vy: -1 });
  let broke = false; run(w, 30, (f, ww) => { if (ww.events.includes('rockBreak')) broke = true; return {}; });
  assert.ok(broke && !w.rocks.has(2 * w.L.width + 4), 'rock broken');
  w = FLAT([{ type: 'vent', x: 4.5, z: 2.5, to: [9.5, 1, 2.5], vel: [-3.75, 15.9, 0] }]); place(w, 4.5, 2.5);
  let out = -1, at = null; run(w, 80, (f, ww) => { if (out < 0 && ww.events.includes('ventOut')) { out = f; at = [ww.p.x, ww.p.vy]; } return {}; });
  assert.ok(out > 60 && at[1] > 15 && Math.abs(at[0] - 9.5) < 0.1, `thrown from the other vent at frame ${out} (${at})`);
  w = FLAT([{ type: 'jetLift', x0: 5, x1: 6, z0: 2, z1: 3.5, y0: 1, y1: 2 }]); place(w, 5.5, 2.5);
  run(w, 20, {}); near(w.jets[0].top, 1 + 20 / 32, 0.05, 'rising a unit a frame'); near(w.p.y, w.jets[0].top, 0.05, 'carried');
  place(w, 2.5, 2.5); run(w, 40, {}); near(w.jets[0].top, 1, 1e-6, 'back down');
});
test('Volcano Valley: a lava spout throws fireballs in its window; a fire run shoots on its frames; the fire shield spares', () => {
  let w = FLAT([{ type: 'spout', x: 6.5, y: 1, z: 2.5, v: [0, 9, 0], phase: 0, window: 16 }]); place(w, 2.5, 2.5);
  let n = 0; run(w, 257, (f, ww) => { if (ww.events.includes('spout')) n++; return {}; });
  assert.strictEqual(n, 3, `three in a window of 16 (${n})`);
  w = FLAT([{ type: 'fireRun', box: [0, 12, 0, 5], shots: [[3.5, 1.2, 2.5, 'x', 0]] }]); w.ringCount = 5; place(w, 5.5, 2.5);
  let hurtAt = -1; run(w, 120, (f, ww) => { if (hurtAt < 0 && ww.events.includes('hurt')) hurtAt = f; return {}; });
  assert.ok(hurtAt > 69 && hurtAt < 69 + 42, `burnt at ${hurtAt}`);
  w = FLAT([{ type: 'fireRun', box: [0, 12, 0, 5], shots: [[3.5, 1.2, 2.5, 'x', 0]] }]); w.ringCount = 5; w.p.shield = 'fire'; place(w, 5.5, 2.5);
  let hit = false; run(w, 120, (f, ww) => { if (ww.events.includes('hurt')) hit = true; return {}; });
  assert.ok(!hit, 'spared');
});
test('Volcano Valley 2: a moving platform carries the player; a swinging spiked ball hurts', () => {
  let w = FLAT([{ type: 'movePlat', x0: 4, x1: 5, z0: 2, z1: 3.5, y: 1.5, axis: 'x', centre: 5, amp: 2, w: 0.05, phase: 0 }]); place(w, 4.5, 2.5);
  Object.assign(w.p, { y: 1.5 }); run(w, 20, {});
  assert.ok(w.p.x > 5.7 && Math.abs(w.p.y - 1.5) < 0.05, `carried to ${w.p.x.toFixed(2)}`);
  w = FLAT([{ type: 'spikeBall', x: 6.5, z: 2.5, y: 1, axis: 'x', centre: 6.5, amp: 3, w: 0.05, phase: 0 }]); w.ringCount = 5; place(w, 3.5, 2.5);
  let hit = false; run(w, 120, (f, ww) => { if (ww.events.includes('hurt')) hit = true; return {}; });
  assert.ok(hit, 'spiked');
});
test('the Volcano Valley boss: comes down into the crater, a ball on it is a hit, the serpent rises and chases; eight', () => {
  const boss = { type: 'boss', kind: 'vv', x: 6, y: 15.5, z: 6, home: [6, 6], cruise: 3, arena: [0, 12, 0, 12], hp: 8, vs: 1,
    low: 3, minY: 3.25, hitBox: [5.5, 7.5, 5.5, 7.5], rise: [7.625, 3.125, 7.5], spikes: [[5, 6]] };
  const lvl = grid(Array.from({ length: 12 }, () => 'd'.repeat(12)), { entities: [{ type: 'start', x: 10.5, z: 10.5 }, boss] });   // floor 3.25 m, as the arena's
  let w = world(lvl); const b = () => w.boss;
  w.p.inv = 1e9; run(w, 200, {}); near(b().y, 15.5 - 200 / 32, 1e-6, 'coming down');
  run(w, 300, {}); near(b().y, 3, 1e-6, 'low');
  let hits = 0;
  for (let k = 0; k < 8; k++) {
    for (let f = 0; f < 200 && b().cool > 0; f++) Sim.step(w, {});
    Object.assign(w.p, { x: 6.5, z: 6.5, y: 4.5, vx: 3, vz: 3, vy: -1, grounded: false, ball: true, jumping: true });
    Sim.step(w, {}); if (w.events.includes('bossHit')) hits++;
  }
  assert.strictEqual(hits, 8, `eight hits (${hits}, y ${b().y}, cool ${b().cool})`); assert.ok(b().dead >= 0, 'beaten');
  w = world(lvl); w.ringCount = 5; Object.assign(w.boss, { y: 3 });
  let rose = -1, hurtAt = -1; run(w, 700, (f, ww) => { if (rose < 0 && ww.events.includes('serpent')) rose = f; if (hurtAt < 0 && ww.events.includes('hurt')) hurtAt = f; return {}; });
  assert.ok(rose >= 268 && rose <= 272 && hurtAt > rose, `rose at ${rose}, hurt at ${hurtAt}`);
});
test('a patrolling enemy walks to and fro between its two values', () => {
  const w = FLAT([{ type: 'enemy', x: 6.5, z: 2.5, patrol: { axis: 'x', range: [5, 8] }, speed: 1.875 }]); place(w, 1.5, 2.5);
  let lo = 9, hi = 0; run(w, 300, (f, ww) => { lo = Math.min(lo, ww.enemies[0].x); hi = Math.max(hi, ww.enemies[0].x); return {}; });
  near(lo, 5, 0.05, 'west end'); near(hi, 8, 0.05, 'east end'); near(w.enemies[0].z, 2.5, 1e-9, 'on its line');
});
// Gene Gadget 1 (watched in the emulator; see s3d.js GIMMICKS[4])
const GNG = (ents, extra = {}) => world(grid(W12('c' + row('4', 16) + 'c'), Object.assign({ entities: [{ type: 'start', x: 1.5, z: 2.5 }].concat(ents) },
  { physics: Object.assign({}, ORIG.physics, { orig: 1 }) }, extra)));
test('hover cells hold a player about 48 units over them, steering, until they leave them', () => {
  const w = GNG([{ type: 'updraft', cells: [[4, 1], [4, 2], [4, 3], [5, 2], [6, 2]] }]); place(w, 4.5, 2.5);
  let lo = 9, hi = 0, ev = false;
  run(w, 240, (f, ww) => { if (ww.events.includes('hover')) ev = true; if (f > 90) { lo = Math.min(lo, ww.p.y); hi = Math.max(hi, ww.p.y); } return {}; });
  assert.ok(ev && w.p.hover, 'hovering');
  assert.ok(lo > 1 + 1.25 && hi < 1 + 1.75, `held near 1.5 m over the floor: ${lo.toFixed(2)}..${hi.toFixed(2)}`);
  run(w, 120, { mx: 1 }); assert.ok(!w.p.hover && w.p.grounded && w.p.x > 7, `left the cells and landed at x ${w.p.x.toFixed(2)}`);
});
test('a pyramid bumper throws a player out over the nearest edge and up by the speed they came in with', () => {
  const w = GNG([{ type: 'pyramids', boxes: [[6, 1.5]] }]); place(w, 4.5, 2.5); w.p.facing = Math.PI / 2;
  let got = null; run(w, 90, (f, ww) => { if (!got && ww.events.includes('pyramid')) got = { vx: ww.p.vx, vy: ww.p.vy }; return { mx: 1 }; });
  assert.ok(got, 'bounced'); near(got.vx, -Sim.P.pyrSpeed, 1e-6, 'thrown back west'); assert.ok(got.vy > 3, `up by its speed in: ${got.vy}`);
});
test('a zap cell sparks 22 frames after the step; the blue shield is spared', () => {
  let w = GNG([{ type: 'zapCells', cells: [[5, 2]] }]); w.ringCount = 5; place(w, 5.5, 2.5);
  let at = -1; run(w, 40, (f, ww) => { if (at < 0 && ww.events.includes('zap')) at = f; return {}; });
  assert.ok(at >= 21 && at <= 24 && w.ringCount === 0, `zapped at ${at}`);
  w = GNG([{ type: 'zapCells', cells: [[5, 2]] }]); w.ringCount = 5; w.p.shield = 'shield'; place(w, 5.5, 2.5);
  run(w, 40, {}); assert.ok(w.ringCount === 5 && w.p.shield === 'shield', 'spared');
});
test('gates stand until their ring or a supercharged run; barriers hurt in their half until their ring', () => {
  let w = GNG([{ type: 'gate', cells: [[6, 1], [6, 2], [6, 3]], top: 3, opens: 1 }, { type: 'goal', x: 2.5, z: 2.5 }, { type: 'goal', x: 12.5, z: 2.5 }]); place(w, 4.5, 2.5);
  run(w, 90, { mx: 1 }); assert.ok(w.p.x < 6, `held at ${w.p.x.toFixed(2)}`);
  w.section = 1; run(w, 90, { mx: 1 }); assert.ok(w.p.x > 7, `through at ${w.p.x.toFixed(2)}`);
  w = GNG([{ type: 'gate', cells: [[6, 1], [6, 2], [6, 3]], top: 3, pass: true }, { type: 'booster', x: 3.5, z: 2.5, dir: [1, 0] }]); place(w, 3.5, 2.5);
  run(w, 150, {}); assert.ok(w.p.x > 7, `the run went through: ${w.p.x.toFixed(2)}`);
  w = GNG([{ type: 'barrier', cells: [[6, 2]], half: 'n', away: [0, 1], opens: 1 }]); w.ringCount = 5; place(w, 6.5, 2.8);
  run(w, 30, { mz: -1 }); assert.ok(w.ringCount === 0, 'zapped in its north half');
});
test('a sprinkler woken within 80 units shoots every 16 frames along its turning angle; shots hurt', () => {
  const w = GNG([{ type: 'sprinkler', x: 6.5, z: 2.5, y: 1, phase: 0 }]); w.ringCount = 5; place(w, 1.5, 2.5);
  run(w, 60, {}); assert.strictEqual(w.shots.length, 0, 'asleep');
  place(w, 8.5, 2.5); let shots = 0, hurt = false;
  run(w, 128, (f, ww) => { if (ww.events.includes('sprinkle')) shots++; if (ww.events.includes('hurt')) hurt = true; return {}; });
  assert.strictEqual(shots, 8, 'eight shots in 128 frames'); assert.ok(hurt, 'one came his way');
});
test('the original movement: a roll bounces off walls; a corner piece is a diagonal wall that turns it', () => {
  let w = GNG([]); place(w, 10.5, 2.5); Object.assign(w.p, { vx: UF(6), rolling: true, facing: Math.PI / 2 });
  run(w, 60, {}); assert.ok(w.p.vx < -UF(4) && w.events !== null, `bounced back: vx ${w.p.vx.toFixed(2)}`);
  const tiles = [];
  for (let z = 0; z < 8; z++) for (let x = 0; x < 6; x++) {
    const inside = x >= 1 && x <= 4 && z >= 1 && z <= 6;
    tiles.push(!inside ? { c: [0, 0, 0, 0], t: 'W' } : x === 1 && z === 1 ? { c: [1.5, 1, 1, 1], t: 'F' } : { c: [1, 1, 1, 1], t: 'F' });
  }
  w = world({ version: 1, format: 'tiles', width: 6, depth: 8, tiles, entities: [{ type: 'start', x: 1.3, z: 5.5 }], physics: Object.assign({}, ORIG.physics, { orig: 1 }), rom: { level: 4, origin: [0, 0], vscale: 1 } });
  assert.ok(w.L.diag.has(1 * 6 + 1), 'found the corner piece');
  near(Sim.floorAt(w.L, 1.8, 1.8), 1, 1e-9, 'its open half is flat');
  place(w, 1.3, 5.5); Object.assign(w.p, { vz: -UF(6), rolling: true, facing: Math.PI });
  run(w, 28, {}); assert.ok(w.p.vx > UF(4) && Math.abs(w.p.vz) < 0.5, `turned east: (${w.p.vx.toFixed(2)}, ${w.p.vz.toFixed(2)})`);
});
test('a tube with a way for the Flickies takes it only with them following', () => {
  const alt = { at: 2, ride: { path: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 1], [0, 0, 1]], end: { at: [9.5, 1, 3.5], facing: 0, vel: [0, 0, 0] } } };
  const tube = { type: 'hole', x: 4.5, z: 2.5, size: 0.5, opens: 0, ride: { start: [4.5, null, 2.5], path: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [1, 0, 0], [1, 0, 0]], end: { at: [2.5, 1, 3.5], facing: 0, vel: [0, 0, 0] }, alt } };
  let w = GNG([tube, { type: 'enemy', x: 10.5, z: 3.5 }], { flickies: 1 }); place(w, 4.5, 2.5);
  let no = false; run(w, 20, (f, ww) => { if (ww.events.includes('tubeNo')) no = true; return {}; });
  assert.ok(no && Math.floor(w.p.x) === 2, `refused, out at ${w.p.x}`);
  w = GNG([tube], { flickies: 1 }); w.flickies.push({ state: 'follow', x: 4, z: 2.5, y: 1 }); place(w, 4.5, 2.5);
  run(w, 20, {}); assert.ok(Math.floor(w.p.x) === 9, `taken the other way: ${w.p.x}`);
});
test('Gene Gadget 2: a chute rolls the player down it to its top speed; a platform goes to and fro, resting at the ends', () => {
  let w = GNG([{ type: 'chute', box: [3, 15, 1, 4], dir: [1, 0], accel: 28.125, steer: null, top: 15.35, hold: 3.33 }]); place(w, 3.5, 2.5); w.p.facing = Math.PI;
  run(w, 60, {}); near(w.p.vx, 15.35, 0.05, 'top speed'); assert.ok(w.p.rolling, 'rolling');
  w = GNG([{ type: 'movePlat', x0: 4, x1: 5, z0: 2, z1: 3, y: 1.5, axis: 'x', lin: { a: 4, b: 6, v: 1.875, wait: 1, dir: 1, t: 0 } }]);
  const xs = []; run(w, 260, (f, ww) => { xs.push(ww.movers[0].off); return {}; });
  near(Math.max(...xs), 2, 1e-6, 'to b'); near(xs[100], 2, 1e-6, 'resting at b'); assert.ok(xs[200] < 2, 'on its way back');
});
test('a door gate opens for the ride that gives its key until its keyOff cell; a run-only ride wants a run', () => {
  const tube = { type: 'hole', x: 2.5, z: 2.5, size: 0.5, opens: 0, key: 7, ride: { start: [2.5, null, 2.5], path: [[0, 0, 0]], end: { at: [4.5, 1, 2.5], facing: 90, vel: [3, 0, 0] } } };
  let w = GNG([tube, { type: 'gate', cells: [[6, 1], [6, 2], [6, 3]], top: 3, key: 7 }, { type: 'keyOff', x: 8, z: 2, key: 7 }]); place(w, 1.5, 2.5);
  run(w, 150, (f) => f < 20 ? { mx: 1 } : f > 60 ? { mx: 1 } : {}); assert.ok(w.p.x > 8 && !w.keys.has(7), `through the door, key gone: ${w.p.x.toFixed(2)}`);
  run(w, 90, { mx: -1 }); assert.ok(w.p.x > 7, `shut behind: ${w.p.x.toFixed(2)}`);
  const hop = { type: 'hole', x: 5.5, z: 2.5, size: 0.5, opens: 0, air: true, run: true, ride: { path: [[0, 0.1, 0]], end: null, vel: [0, 0, 0] } };
  w = GNG([hop]); place(w, 3.5, 2.5); let rode = false;
  run(w, 60, (f, ww) => { if (ww.events.includes('ride')) rode = true; return { mx: 1 }; }); assert.ok(!rode, 'walked over it');
  w = GNG([hop, { type: 'booster', x: 3.5, z: 2.5, dir: [1, 0] }]); place(w, 3.5, 2.5);
  run(w, 150, (f, ww) => { if (ww.events.includes('ride')) rode = true; return {}; }); assert.ok(rode, 'taken in the run');
});
test('the Gene Gadget boss: the belt carries the player to the hurting end, loads ride it, the pod is hit while low; eight', () => {
  const boss = { type: 'boss', kind: 'gng', x: 3, y: 14.75, z: 3, home: [3, 3], cruise: 2.25, arena: [1, 5, 1, 14], hp: 8, vs: 1,
    first: 2.25, high: 3.75, low: 1.25, belt: [-0.75, 12.75], lanes: [1.5, 1], end: 13, loads: [-0.75, -2.25], drops: [-0.22, -0.56], dropZ: 0.19 };
  const lvl = grid(Array.from({ length: 15 }, (_, z) => z === 0 || z === 14 ? 'cccccc' : 'c1111c'), { entities: [{ type: 'start', x: 3, z: 5 }, boss], physics: Object.assign({}, ORIG.physics, { orig: 1 }) });
  let w = world(lvl); w.ringCount = 5;
  run(w, 0x1B8 + 120, {}); assert.ok(w.p.vz > UF(1.4), `carried south: ${(w.p.vz / UF(1)).toFixed(2)}`);
  let end = false; run(w, 400, (f, ww) => { if (ww.events.includes('beltEnd')) end = true; return {}; }); assert.ok(end, 'the end row hurts');
  w = world(lvl); w.ringCount = 50; let hits = 0;
  for (let f = 0; f < 20000 && w.boss.dead < 0; f++) {
    const b = w.boss, low = b.y < b.low + 0.05;
    w.ringCount = 50; w.p.invuln = 1;
    if (low && w.p.grounded) Object.assign(w.p, { x: b.x, z: b.z + 0.1, vx: 0, vz: 0 });
    Sim.step(w, low ? { jump: true } : {}); if (w.events.includes('bossHit')) hits++;
  }
  assert.strictEqual(hits, 8, 'eight hits'); assert.ok(w.boss.dead >= 0, 'beaten');
});
// Panic Puppet 1 (watched in the emulator; see s3d.js GIMMICKS[20])
test('Panic Puppet 1: switch cells throw the levers; a belt carries the player their way and lets go at its ends, or launches its ride with the key', () => {
  const ride = { path: [[0, 0, 0], [0, 0, 0]], end: { at: [12.5, 1, 2.5], facing: 90, vel: [3, 0, 0] }, force: { t: 0.2, dir: null } };
  const belt = { type: 'carrier', box: [5, 8, 1, 4], y: null, line: 2.5, lo: 4.7, hi: 8, v: 1.875, way: ['f', 'b', 'a'], launch: { ride, key: 3 } };
  const w = GNG([belt, { type: 'switchCells', cells: [[2, 1, 'a', 1], [2, 3, 'a', 0]] }]); place(w, 6.5, 2.5);
  run(w, 5, {}); assert.ok(w.p.carry, 'taken');
  run(w, 120, {}); assert.ok(!w.p.carry && w.p.x <= 4.7 + 1e-6 && w.p.x > 4.6, `west by default, let go at ${w.p.x.toFixed(3)}`);
  place(w, 2.5, 1.5); let lever = false; run(w, 3, (f, ww) => { if (ww.events.includes('lever')) lever = true; return {}; });
  assert.ok(lever && w.regs.a === 1, 'lever thrown');
  place(w, 6.5, 2.5); let at = -1; run(w, 120, (f, ww) => { if (at < 0 && ww.events.includes('launch')) at = f; return {}; });
  assert.ok(at >= 47 && at <= 50 && w.keys.has(3) && Math.floor(w.p.x) >= 12, `launched at frame ${at}, out at ${w.p.x.toFixed(2)}`);
  w.regs.f = 1; w.regs.b = 0; place(w, 6.5, 2.5); run(w, 120, {}); assert.ok(w.p.x <= 4.7 + 1e-6, 'with the flag, the other lever: west');
});
test('a Flicky capsule: its sides are walls; landing on it breaks it, throws the player 5 units a frame up, frees its Flicky', () => {
  const w = GNG([{ type: 'capsule', x: 6.5, z: 2.5, y: 1.5, top: 2.5, half: 0.47, flicky: 3 }, { type: 'enemy', x: 10.5, z: 2.5, radius: 0, flicky: 0 }], { flickies: 5 });
  place(w, 4.5, 2.5); run(w, 60, { mx: 1 }); assert.ok(w.p.x < 6.03 && w.capsules[0].alive, `stopped by its side at ${w.p.x.toFixed(2)}`);
  place(w, 6.5, 2.5); Object.assign(w.p, { y: 2.9, grounded: false, vy: 0 });
  let vy = null; run(w, 30, (f, ww) => { if (vy === null && ww.events.includes('capsule')) vy = ww.p.vy; return {}; });
  near(vy, UF(5), 0.25, 'thrown up'); assert.ok(!w.capsules[0].alive && w.flickies.length === 1 && w.flickies[0].kind === 2, 'broken, its Flicky free');
  place(w, 10.5, 2.5); w.p.ball = true; Object.assign(w.p, { y: 1.5, grounded: false, vy: -1 }); run(w, 20, {});
  assert.ok(!w.enemies[0].alive && w.flickies.length === 1, 'an enemy holding none frees none');
});
test('a 178 shoots every 32 frames, east, south, west and north in turn from its index; the shots fall to the floor', () => {
  const w = GNG([{ type: 'enemy', x: 8.5, z: 2.5, radius: 0, shoot: 1 }]); place(w, 3.5, 2.5);
  const dirs = []; let oldest = 0;
  run(w, 130, (f, ww) => {
    if (ww.events.includes('pellet')) { const s = ww.shots[ww.shots.length - 1]; dirs.push([Math.sign(Math.round(s.vx)), Math.sign(Math.round(s.vz))]); }
    for (const s of ww.shots) oldest = Math.max(oldest, s.age); return {};
  });
  // (20 units up, one a frame up, 1/16 down: back to the floor after about 46 frames)
  assert.deepStrictEqual(dirs, [[0, 1], [-1, 0], [0, -1], [1, 0]]); assert.ok(oldest < 48 / 60 && oldest > 43 / 60, `oldest shot ${oldest.toFixed(3)} s`);
});
// Panic Puppet 2 (watched in the emulator; see s3d.js GIMMICKS[19])
test('Panic Puppet 2: cells shut behind the player; a belt along z; the lift ends the act', () => {
  let w = GNG([{ type: 'gate', cells: [[5, 1], [5, 2], [5, 3]], top: 3, shut: [[6, 2]], ev: 'shut' }]); place(w, 3.5, 2.5);
  let shut = false; run(w, 60, (f, ww) => { if (ww.events.includes('shut')) shut = true; return { mx: 1 }; });
  assert.ok(shut && w.p.x > 7, `through and shut: ${w.p.x.toFixed(2)}`);
  run(w, 90, { mx: -1 }); assert.ok(w.p.x > 6, `held at ${w.p.x.toFixed(2)}`);
  w = GNG([{ type: 'carrier', box: [3, 5, 1, 3], y: null, line: 4, lo: null, hi: 3, v: 1.875, way: 1, axis: 'z' }]); place(w, 4, 1.5);
  run(w, 3, {}); assert.ok(w.p.carry && Math.abs(w.p.x - 4) < 1e-9, 'held on its line');
  run(w, 60, {}); assert.ok(!w.p.carry && w.p.z >= 3 && w.p.z < 3.2, `carried south, let go at z ${w.p.z.toFixed(3)}`);
  const lift = { type: 'hole', x: 8, z: 2.5, half: [0.5, 0.25], opens: 0, ride: { start: [8, 2, 2.5], path: [[0, 0.02, 0], [0, 0.02, 0]], end: null, wait: 0.5, clear: 110 / 60 } };
  w = GNG([lift]); place(w, 8, 2.5); let at = -1, go = -1;
  run(w, 150, (f, ww) => { if (go < 0 && ww.events.includes('liftGo')) go = f; if (at < 0 && ww.events.includes('goal')) at = f; return {}; });
  assert.ok(w.cleared && at >= 110 && at <= 112 && go >= 30 && go <= 32, `lift off at ${go}, act over at ${at}`);
});
test('beam posts shoot across every 8 frames in their on steps (72 of 216 frames); 17C wanders in its square', () => {
  const w = GNG([{ type: 'beamPost', x: 6.5, z: 1.2, y: 1.9, dir: [0, 1], phase: 0 }, { type: 'enemy', x: 10.5, z: 2.5, radius: 1, speed: 0.94, wander: [10, 2, 1] }]); place(w, 2.5, 2.5);
  const at = []; let lo = [99, 99], hi = [0, 0];
  run(w, 432, (f, ww) => { if (ww.events.includes('beam')) at.push(ww.tick); const e = ww.enemies[0]; lo = [Math.min(lo[0], e.x), Math.min(lo[1], e.z)]; hi = [Math.max(hi[0], e.x), Math.max(hi[1], e.z)]; return {}; });
  assert.strictEqual(at.length, 18, `two bursts of nine (${at.join(',')})`);
  assert.ok(at.every(t => t % 8 === 0) && at[9] - at[0] === 216, 'every 8 frames, 216 apart');
  assert.ok(lo[0] >= 10 && lo[1] >= 2 && hi[0] <= 11 && hi[1] <= 3 && hi[0] - lo[0] > 0.2, `kept in its square ${lo} ${hi}`);
});
test('the Panic Puppet boss: an arm follows the player, punches down to the floor, rests; a jump over its shoulder is a hit; the act ends', () => {
  const arm = (x, sx) => ({ at: [x, 3, 2.5], rest: [x, 3, 2.5], zone: [x, 2.5], shoulder: [sx, 2.25, 2.5], cell: [Math.floor(sx), 2] });
  const boss = { type: 'boss', kind: 'pp', x: 3, y: 3.5, z: 3, cruise: 3, hp: 8, vs: 1, stages: [{ pod: [3, 3, 3, 2.5], hitY: 1.5, arms: [arm(6, 4.5), arm(10, 8.5)] }] };
  let w = GNG([boss]); w.ringCount = 50; place(w, 6.6, 2.5);
  let slam = -1; run(w, 0x190 + 90, (f, ww) => { if (slam < 0 && ww.events.includes('armSlam')) slam = f; return {}; });
  assert.ok(slam > 0x190, `slammed at ${slam}`); near(w.boss.arms[0].y, 1 + 1 / 32, 1e-6, 'the claw on the floor');
  assert.ok(w.p.invuln > 0, 'the player under it was hurt');
  w = GNG([boss]); w.ringCount = 50; place(w, 1.5, 2.5); w.boss.delay = 0;
  const b = w.boss; let downs = 0, end = -1;
  for (let f = 0; f < 2000 && end < 0; f++) {
    const a = b.arms.find(q => q.hits > 0);
    if (a && a.t === 0) Object.assign(a, { t: 0x60 });   // (as if it had punched and rests now)
    if (a && a.t > 0x20 && a.t < 0x98 && w.p.invuln <= 0) Object.assign(w.p, { x: a.cell[0] + 0.5, z: a.cell[1] + 0.5, y: 1.6, vy: 0, grounded: false });
    Sim.step(w, {}); w.ringCount = 50;
    if (w.events.includes('armDown')) downs++;
    if (w.events.includes('goal')) end = f;
  }
  assert.strictEqual(downs, 2, 'both arms broken'); assert.ok(b.arms.every(a => a.hits === 0) && end > 0 && w.cleared, `the act ended (${end})`);
});
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
