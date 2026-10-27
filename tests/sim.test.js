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
// (a converted act starts as the original does, the pad held a few frames; tests start where it acts, unless they say)
function world(raw, start = false) { const w = Sim.createWorld(Sim.importLevel(raw)); if (!start) w.padWait = 0; return w; }
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
const ORIG = { physics: { gravity: 28.125, jumpV: 10.5469, jumpCut: 4.2188, maxFall: 13.125, stepUp: 0.25, snapDown: 0.0625 } };
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
  assert.strictEqual(w.score, 1, 'an enemy scores 1 (100 points)');
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
  assert.strictEqual(w.score, 5 + 1 + 2 + 4 + 8 + 16, 'five enemies, then the Flickies 1, 2, 4, 8, 16');
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
  for (let f = 0; f < 2400 && !(w.boss.act === 4 && w.boss.c32 === 1); f++) {
    Sim.step(w, {}); for (const e of w.events) seen.add(e);
  }
  assert.ok(seen.has('bossDrop') && seen.has('bossHop'), `dropped and hopped: ${[...seen]}`);
  assert.ok(w.boss.act === 4 && w.boss.c32 === 1, 'sank to the ball');
  near(w.boss.x, w.boss.ball.x + 4 / 32, 1e-9, 'went to the ball first');
  // five stomps from above while it waits low (the player made invincible so the hopping ball cannot send them back)
  let hits = 0; w.p.inv = 1e9;
  for (let k = 0; k < 5; k++) {
    for (let f = 0; f < 3000 && !(w.boss.act === 4 && w.boss.c32 === 1 && w.boss.c38 === 0); f++) Sim.step(w, {});
    Object.assign(w.p, { x: w.boss.x, z: w.boss.z, y: w.boss.y + 0.6, vy: -1, grounded: false, invuln: 0, inv: 1e9 });
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
  // (not while invulnerable: the original's touch does nothing while his safe count runs)
  w = world(lvl); w.p.inv = 1e9; run(w, 560, {}); Object.assign(w.boss, { x: 4, z: 5.6, y: 2, target: 2, X: undefined }); w.p.inv = 0; w.ringCount = 50;
  let froze = false; run(w, 60, (f, ww) => { if (ww.events.includes('freeze')) froze = true; return {}; });
  assert.ok(froze, 'frozen by snow');
  w = world(lvl); w.p.inv = 1e9; run(w, 560, {}); Object.assign(w.boss, { x: 4, z: 5.6, y: 2, target: 2, X: undefined });
  froze = false; run(w, 60, (f, ww) => { if (ww.events.includes('freeze')) froze = true; return {}; });
  assert.ok(!froze, 'not while invulnerable');
  // a dropped snowman wakes near the player and throws snowballs
  w = world(lvl); w.p.inv = 0; w.ringCount = 5; Sim.step(w, {});
  Object.assign(w.boss, { X: (5.06 * 32 | 0) * 65536, Z: (4.06 * 32 | 0) * 65536, Yw: 4.5 * 32 - 8, target: 4.5, c20: 1, c1c: 3 });
  let balls = 0, hurt = false; run(w, 160, (f, ww) => { balls = Math.max(balls, ww.boss.balls.length); if (ww.events.includes('hurt')) hurt = true; return {}; });
  assert.ok(balls === 8 && hurt, `snowballs ${balls}, hurt ${hurt}`);
  // eight spins from above
  w = world(lvl); w.p.inv = 1e9; run(w, 400, {});
  let hits = 0;
  for (let k = 0; k < 8; k++) {
    for (let f = 0; f < 200 && b().c38 > 0; f++) Sim.step(w, {});
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
test('original movement: a spin dash goes the way of its facing\'s high byte, as turned on the frame it is let go', () => {
  // (facing 0x600 (east); let go with the stick north-east: turned to 0x5C0 that frame, so way 5, the diagonal)
  const w = ORIGM(); place(w, 2.5, 2.5); w.p.facing = Math.PI / 2; run(w, 80, { dash: true });
  run(w, 1, { mx: Math.SQRT1_2, mz: -Math.SQRT1_2 });
  near(w.p.vx, -w.p.vz, 1e-9, 'a diagonal'); assert.ok(w.p.vx > 0, 'north-east');
});
test('original movement: a jump without the stick loses 0.086 a frame per frame; ice is slippery', () => {
  let w = ORIGM(); place(w, 2.5, 2.5); w.p.facing = Math.PI / 2; run(w, 45, { mx: 1 });
  run(w, 1, { mx: 1, jump: true }); const v0 = w.p.vx; run(w, 10, { jump: true });
  near(v0 - w.p.vx, UF(0.86), UF(0.03), 'air drag in the ball');
  w = ORIGM([{ type: 'ice', on: [[3, 2]], off: [] }]); place(w, 3.5, 2.5); w.p.facing = Math.PI / 2;
  run(w, 2, {}); assert.ok(w.ice, 'ice on');
  run(w, 30, { mx: 1 }); near(w.p.vx, UF(30 * (0x100 - 0x20) / 0x1000), UF(0.02), 'slow start on ice');
  const v1 = w.p.vx; run(w, 30, {}); near(v1 - w.p.vx, UF(30 * 0x21 / 0x1000), UF(0.01), 'long slide (its fixed point loses a little more)');
});
test('original movement: a wall stops a point at its cell edge and keeps the other part; letting go of jump cuts the rise; a half turn goes its way', () => {
  const box = () => world(grid(['cccccc', 'c4444c', 'c4444c', 'c4444c', 'cccccc'], { entities: [{ type: 'start', x: 2.5, z: 2.5, facing: 90 }],
    physics: Object.assign({}, ORIG.physics, { orig: 1 }) }));
  let w = box(); place(w, 2.5, 2.5); w.p.facing = Math.atan2(1, -1); w.p.vx = UF(2); w.p.vz = UF(-2);
  run(w, 40, { mx: Math.SQRT1_2, mz: -Math.SQRT1_2 });
  assert.ok(w.p.x < 5 && w.p.x > 5 - 1e-6 && w.p.vx === 0, `stopped at the cell edge: ${w.p.x}`);
  near(w.p.z, 1, 1e-6, 'slid on into the corner');
  const peak = jump => { const ww = box(); place(ww, 2.5, 2.5); const y0 = ww.p.y; let top = 0;
    run(ww, 60, f => { top = Math.max(top, ww.p.y - y0); return { jump: f < jump }; }); return top * 32; };
  near(peak(40), 60, 3, 'a held jump rises about 60 units');
  assert.ok(peak(2) < 20, `a tapped jump rises ${peak(2).toFixed(1)} units`);
  const half = f36 => { const ww = box(); place(ww, 2.5, 2.5); ww.p.facing = -Math.PI / 2; ww.p.face36 = f36; run(ww, 1, { mx: 1 }); return ww.p.facing + Math.PI / 2; };
  near(half(undefined), Sim.P.orig.turn / 60, 1e-6, 'with no turn before, its angle goes down (ours up)');
  near(half(0x240), -Sim.P.orig.turn / 60, 1e-6, 'after a turn down from 0x240 to 0x200, a half turn goes up (ours down)');
});
// a converted-style level (rom set): flat at 1 m with walls round, and a ramp row z 3 (north edge `up` steps higher)
const ROMLV = (up = 1, split = 0, ents = [], vs = 1) => {
  const W = 8, D = 6, tiles = [];
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    if (x === 0 || z === 0 || x === W - 1 || z === D - 1) { tiles.push({ c: [3, 3, 3, 3], t: 'F' }); continue; }
    const t = { c: z === 3 ? [1 + up / 4, 1 + up / 4, 1, 1] : z < 3 ? [1 + up / 4, 1 + up / 4, 1 + up / 4, 1 + up / 4] : [1, 1, 1, 1], t: 'F' };
    if (split && z === 3) t.s = split;
    tiles.push(t);
  }
  return world({ version: 1, format: 'tiles', width: W, depth: D, tiles, entities: [{ type: 'start', x: 1.5, z: 4.5, facing: 90 }].concat(ents),
    physics: Object.assign({}, ORIG.physics, { orig: 1 }), rom: { level: 1, origin: [0, 0], vscale: vs } });
};
test('original movement: a roll into a corner comes back on both axes, turned half round (0x442C)', () => {
  const w = ROMLV(0); place(w, 1.5, 4.5);
  Object.assign(w.p, { x: 1 + 1 / 32, z: 5 - 1 / (32 * 65536), rolling: true, grounded: true, facing: 0x80 / 0x800 * -2 * Math.PI + 2 * Math.PI, vx: -4 * 60 / 32, vz: 0.5 * 60 / 32 });
  const f0 = w.p.facing; run(w, 1, {});
  assert.ok(w.p.vx > 0 && w.p.vz <= 0, `back on both (${w.p.vx}, ${w.p.vz})`);
  const d = ((w.p.facing - f0) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
  assert.ok(Math.abs(Math.abs(d) - Math.PI) < 0.3, `half round (${d})`);
});
test('a half-height level keeps the original\'s speeds across', () => {
  const sp = vs => { const w = ROMLV(0, 0, [], vs); place(w, 1.5, 4.5); w.p.facing = Math.PI / 2; run(w, 40, { mx: 1 }); return w.p.vx; };
  near(sp(0.5), sp(1), 1e-9, 'same speed');
});
test('the original\'s jump button: pressed in the air and held, he jumps as he lands; held on, never again', () => {
  const w = ROMLV(0); place(w, 3.5, 4.5); Object.assign(w.p, { grounded: false, y: w.p.y + 0.5, vy: 0 });
  let jumps = 0, landed = -1; run(w, 120, (f, ww) => { if (ww.events.includes('land') && landed < 0) landed = f; if (ww.events.includes('jump')) jumps++; return { jump: true }; });
  assert.ok(landed >= 0 && jumps === 1, `one jump from the press in the air (landed ${landed}, jumps ${jumps})`);
  const v = ROMLV(0); place(v, 3.5, 4.5); jumps = 0;
  run(v, 5, {}); run(v, 120, (f, ww) => { if (ww.events.includes('jump')) jumps++; return { jump: true }; });
  assert.strictEqual(jumps, 1, 'pressed on the ground: one jump, none while held');
});
test('the original\'s floor and slopes: triangles in whole units, the pull on steep ones, a jump thrown downhill', () => {
  let w = ROMLV(1);
  near(Sim.floorAt(w.L, 3.5, 3.5), 1 + 3 / 32, 1e-9, 'a one-step ramp: whole units on its triangle (bilinear would be 1.125)');
  near(Sim.floorAt(ROMLV(1, 1).L, 3.25, 3.25), 1.25 - 2 / 32, 1e-9, 'split the other way: its north-west triangle');
  place(w, 3.5, 3.5); run(w, 20, {}); near(w.p.vz, 0, 1e-9, 'one step: standing still is not pulled');
  w = ROMLV(2); place(w, 3.5, 3.5); run(w, 1, {});
  near(w.p.vz / UF(1) * 65536, 5588 + 1397, 1, 'two steps: pulled g + g/4 a frame (5588 there)');
  w = ROMLV(1); place(w, 3.5, 3.5); run(w, 1, { jump: true });
  near(w.p.vz / UF(1) * 65536, 2857 * 32, 1, 'a jump there takes 32 g downhill');
  near(w.p.vy / UF(1) * 65536, 22862 * 16 - 0x4000, 1, 'and rises at the upright part (less that frame\'s gravity)');
});
test('the original\'s dash button: a roll with any speed, the launch frame stands, a roll bounces 0x4000 slower', () => {
  let w = ROMLV(0); place(w, 2.5, 4.5); w.p.facing = Math.PI / 2;
  run(w, 10, { mx: 1 }); const v = w.p.vx; run(w, 1, { dash: true });
  assert.ok(w.p.rolling && w.p.vx > v * 0.95, `rolled at ${w.p.vx / UF(1)}`);
  w = ROMLV(0); place(w, 2.5, 4.5); w.p.facing = Math.PI / 2; run(w, 20, { dash: true }); const x0 = w.p.x; run(w, 1, {});
  assert.ok(w.p.x === x0 && w.p.vx > 0 && w.p.rolling, 'launched, not moved that frame');
  w = ROMLV(0); place(w, 6.5, 4.5); w.p.facing = Math.PI / 2; w.p.vx = UF(3); w.p.rolling = true; w.p.fwdWord = 0x3000;
  let before = 0; for (let f = 0; f < 20 && w.p.vx > 0; f++) { before = w.p.vx; run(w, 1, {}); }
  assert.ok(w.p.vx < 0, 'came back');
  near(-w.p.vx / UF(1), before / UF(1) - 0x11 / 0x1000 - 0.25, 0.002, 'a quarter unit slower');
});
test('the original\'s hit: thrown back along his facing till he lands, rings out one a frame (25 at most), then 2 s safe', () => {
  const ww = ROMLV(0, 0, [{ type: 'mine', x: 4.5, z: 4.5 }]);
  place(ww, 3.9, 4.5); ww.p.facing = Math.PI / 2; ww.ringCount = 30;
  let hitAt = -1; run(ww, 12, (f, x) => { if (hitAt < 0 && x.events.includes('hurt')) hitAt = f; return hitAt < 0 ? { mx: 1 } : {}; });
  assert.ok(hitAt >= 0, 'hit');
  near(ww.p.vx / UF(1), -0x7800 * 4 / 65536, 1e-9, 'back at 1.875 units a frame'); near(ww.p.vz, 0, 1e-9, 'straight back');
  assert.ok(ww.ringCount === 0 && ww.loose.length > 0 && ww.loose.length + ww.ringOut === 25, `rings coming out one a frame: ${ww.loose.length} + ${ww.ringOut}`);
  let landed = -1; run(ww, 60, (f, x) => { if (landed < 0 && x.p.grounded && !(x.p.knockT > 0)) landed = f; return {}; });
  assert.ok(landed > 0 && ww.p.grounded && ww.p.vx === 0, 'landed and stopped');
  assert.ok(ww.ringOut === 0 && ww.loose.length + ww.ringCount <= 25, `all out: ${ww.loose.length} + ${ww.ringCount}`);
  near(ww.p.invuln, 2 - (59 - landed) / 60, 0.05, 'safe 2 s from landing');
});
test('the original\'s death: thrown 8 up, held at the top, the act again 57 frames after the hit', () => {
  const w = ROMLV(0, 0, [{ type: 'mine', x: 4.5, z: 4.5 }]); place(w, 3.9, 4.5); w.p.facing = Math.PI / 2; w.ringCount = 0;
  let hit = -1, back = -1, top = 0;
  run(w, 90, (f, x) => { if (hit < 0 && x.events.includes('dying')) hit = f; if (back < 0 && x.events.includes('respawn')) back = f; if (hit >= 0 && back < 0) top = Math.max(top, x.p.y); return hit < 0 ? { mx: 1 } : {}; });
  assert.ok(hit >= 0 && back - hit === 57, `back ${back - hit} frames after the hit`);
  near((top - 1) * 32, 124, 1, 'rose 124 units');
});
test('the original\'s act start: count from 0, two frames run, 17 held, the pad acts from C = 3', () => {
  const w = ROMLV(0); Sim.resetLevel(w); const x0 = w.p.x, C = [], X = [];
  run(w, 22, (f, x) => { C.push(x.gcC); X.push(x.p.x); return { mx: 1 }; });   // (seen before each frame: [k] after frame k)
  assert.deepStrictEqual(C.slice(1, 21), [1, 2].concat(Array(17).fill(2), [3]), `counts ${C}`);
  assert.ok(X.slice(1, 20).every(x => x === x0) && X[21] > x0, 'still till the pad acts');
});
test('058 bursts into four shots when Sonic comes near, then is gone', () => {
  const w = ROMLV(0, 0, [{ type: 'enemy', x: 5.5, z: 4.5, radius: 1, burst: 1, flicky: 0 }]); place(w, 2.5, 4.5); w.p.facing = Math.PI / 2;
  let first = -1; run(w, 40, (f, x) => { if (first < 0 && x.shots.length) first = f; return { mx: 1 }; });
  assert.ok(first > 0 && !w.enemies[0].alive, `burst at frame ${first}`);
});
test('the original\'s freed Flickies: 4 units up, a hop a landing turning toward Sonic, not caught for 30 frames', () => {
  const w = ROMLV(0, 0, [{ type: 'enemy', x: 4.5, z: 4.5, radius: 0, flicky: 1 }], 1); w.L.flickies = 5; place(w, 2.5, 4.5); w.p.facing = Math.PI / 2;
  let freed = -1, top = 0, lands = 0, caught = -1, x0 = 0;
  run(w, 300, (f, x) => {
    const fl = x.flickies[0];
    if (fl && freed < 0) { freed = f; x0 = fl.x; }
    if (fl && fl.state === 'free') { top = Math.max(top, fl.y); if (fl.vy === -65536) lands++; }
    if (fl && caught < 0 && fl.state === 'follow') caught = f;
    return freed < 0 ? { mx: 1, dash: f > 12 } : {};
  });
  const f = w.flickies[0];
  assert.ok(freed > 0 && f.type === 1, 'freed, type 1');
  near((top - 1) * 32, 62, 1, 'rises 62 units (4 up, gravity 1/8)');
  assert.ok(lands >= 3, `hops 1.0 up at each landing (${lands} seen, caught ${caught - freed})`);
  assert.ok(caught < 0 || caught - freed >= 30, `not caught for 30 frames (${caught - freed})`);
  // with Sonic far to the north-west it turns a sixteenth a landing (from way 0, the tie going down) and comes his way
  const v = ROMLV(0, 0, [{ type: 'enemy', x: 4.5, z: 4.5, radius: 0, flicky: 1 }], 1); v.L.flickies = 5; place(v, 2.5, 4.5); v.p.facing = Math.PI / 2;
  run(v, 60, (f, x) => x.flickies.length ? {} : { mx: 1, dash: f > 12 });
  const d0 = Math.hypot(v.flickies[0].x - 1.5, v.flickies[0].z - 1.5), ways = [];
  run(v, 300, (f, x) => { place(x, 1.5, 1.5); if (x.flickies[0].vy === -65536) ways.push(x.flickies[0].d & 15); return {}; });
  assert.deepStrictEqual(ways.slice(0, 5), [15, 14, 13, 12, 11], `ways ${ways.join(' ')}`);
  assert.ok(Math.hypot(v.flickies[0].x - 1.5, v.flickies[0].z - 1.5) < d0 - 1, 'closer to Sonic');
});
test('the original\'s following Flickies: 3 + 4k frames behind, circling him when he stands, out one a frame when hit', () => {
  const w = ROMLV(0, 0, [], 1); w.L.flickies = 5; place(w, 1.5, 4.5); w.p.facing = Math.PI / 2;
  for (let k = 0; k < 3; k++) w.flickies.push({ state: 'follow', kind: k, x: 1.5, y: 1, z: 4.5, age: 1 });
  const at = [];
  run(w, 30, (f, x) => { at.push([x.p.x, x.p.z]); return { mx: 1 }; });
  const fol = w.flickies;
  for (let k = 0; k < 3; k++) { const [x, z] = at[at.length - 3 - 4 * k]; near(fol[k].x, x, 1e-9, `follower ${k} x`); near(fol[k].z, z, 1e-9, `follower ${k} z`); }
  // standing: the circle grows to 32 (half a metre round a point 2 units off his records)
  run(w, 80, {});
  const c = fol.map(f => Math.hypot(f.x * 32 - (w.p.x * 32 + 2), f.z * 32 - (w.p.z * 32 + 2)));
  assert.ok(c.every(r => r > 14 && r < 17.5), `round him: ${c.map(r => r.toFixed(1))}`);
  // standing 240 frames he turns to face 0x700 (the original's bored look)
  run(w, 200, {}); near(((-w.p.facing / (2 * Math.PI) * 0x800) % 0x800 + 0x800) % 0x800, 0x700, 1e-6, 'bored facing');
  // a hit with rings: the followers go one a frame, as particles, not caught for 30 frames
  w.ringCount = 3; const out = [];
  Sim.hurt(w, 1, 0);
  run(w, 4, (f, x) => { out.push(x.flickies.filter(q => q.state === 'follow').length); return {}; });
  assert.deepStrictEqual(out, [3, 2, 1, 0], `followers left (before each step): ${out}`);
  assert.ok(fol.every(f => f.state === 'free' && f.o), 'all free particles');
});
test('the original\'s scroll: led by his facing, an eighth of the way a frame; objects with a window run only inside it', () => {
  const w = ROMLV(0, 0, [{ type: 'enemy', x: 6.5, z: 4.5, radius: 1, roam: { box: [200, 140], a: 0 }, win: [352, 256, 16, 12, 0] }]); place(w, 1.5, 4.5);
  run(w, 120, {});
  const X = Math.round(w.p.x * 32), Z = Math.round(w.p.z * 32), Y = Math.floor(w.p.y * 32 - 8 + 1e-6), F = Math.round(((-w.p.facing / (2 * Math.PI) * 0x800) % 0x800 + 0x800) % 0x800);
  const sin = Sim.P.orig.sin, a = (-(F + 0x100)) & 0x7FF, lx = ((sin[a >> 1] >> 8) >> 1) - 0xA0, ly = ((sin[(a >> 1) + 0x100] >> 8) >> 2) - 0x7C;
  assert.deepStrictEqual([w.cam.lx, w.cam.ly], [lx, ly], 'the lead');
  assert.ok(Math.abs(w.cam.X - (X - Z + 0x1000 + lx)) < 8 && Math.abs(w.cam.Y - Math.max(0, ((X + Z) >> 1) - Y + ly)) < 8, `settled: ${w.cam.X}, ${w.cam.Y}`);
  // a window entirely off to the right: the roamer does not move
  w.enemies[0].win = [352, 256, -400, 12, 0]; const x0 = w.enemies[0].x; run(w, 30, {}); near(w.enemies[0].x, x0, 1e-9, 'asleep off screen');
  w.enemies[0].win = [352, 256, 16, 12, 0]; run(w, 30, {}); assert.ok(w.enemies[0].X !== undefined, 'awake on screen');
});
test('the original\'s rings: caught in their cell, x and z there within 16, his picture y 16 over to 24 under the base', () => {
  const at = (x, z, scr) => { const w = ROMLV(0, 0, [{ type: 'ring', x: 3.5, z: 4.5, absY: 1.5, scr }]); place(w, x, z); run(w, 1, {}); return w.ringCount; };
  // Sonic at (112, 144) units, 1 m up: picture y (112 + 144) / 2 - 24 = 104
  assert.strictEqual(at(3.5, 4.5, 104), 1, 'in the middle');
  assert.strictEqual(at(3.5, 4.5, 104 + 17), 0, 'base over him');
  assert.strictEqual(at(3.5, 4.5, 104 - 24), 1, '24 under');
  assert.strictEqual(at(3 + 2 / 32, 4 + 30 / 32, 104), 0, 'outside the band (2 and 30 in the cell)');
  assert.strictEqual(at(2.9, 4.5, 104), 0, 'the next cell');
});
test('the original\'s shooters: 0C8 fires where its table says, shots are particles that hurt by their own box', () => {
  // a table of three frames then back: 20, 24, 28 (28 unmirrored is 0x64: 4 mod 16, a shot), its rate every frame
  const c8 = { type: 'enemy', x: 4.5, z: 3.5, radius: 1, win: [352, 256, 16, 12, 24], touch: [21, 31], c8: { i: 0, r: [0, 0], t: [20, 24, 28, -1, 6] } };
  const w = ROMLV(0, 0, [c8]); place(w, 1.5, 4.5);
  const seen = []; run(w, 3, (f, x) => { seen.push(x.shots.length); return {}; });
  assert.ok(w.shots.length === 1 && w.shots[0].type === 5, `one shot after the third step: ${seen} ${w.shots.length}`);
  const sh = w.shots[0], v = Math.hypot(sh.vx, sh.vz) / 65536;
  near(v, 2, 0.01, 'two units a frame');
  // a shot particle on him hurts (and is gone)
  const u = ROMLV(0, 0, []); place(u, 3.5, 4.5); u.ringCount = 5;
  u.shots.push({ o: 1, type: 5, d: 0, t: Infinity, X: 112 * 65536, Y: 30 * 65536, Z: 144 * 65536, vx: 0, vy: 0, vz: 0, g: 0, age: 0, x: 0, y: 0, z: 0 });
  run(u, 1, {}); assert.ok(u.shots.length === 0 && u.events.includes('hurt'), `hurt: ${u.events}`);
});
test('the original\'s monitors are solid boxes: walking stops at a side, a roll or the ball onto it breaks it', () => {
  const mon = [{ type: 'monitor', x: 4.5, z: 4.5, kind: 'rings' }];
  let w = ROMLV(0, 0, mon); place(w, 3.2, 4.5); w.p.facing = Math.PI / 2;
  run(w, 40, { mx: 1 }); assert.ok(!w.monitors[0].broken && Math.abs(w.p.x * 32 - (4.5 * 32 - 14 + 65535 / 65536)) < 0.01, `stopped at its side: ${(w.p.x * 32).toFixed(3)}`);
  w = ROMLV(0, 0, mon); place(w, 3.2, 4.5); w.p.facing = Math.PI / 2; run(w, 15, { mx: 1 });
  run(w, 10, { mx: 1, dash: true }); assert.ok(w.monitors[0].broken && w.ringCount === 10, 'a roll breaks it');
  w = ROMLV(0, 0, mon); place(w, 4.5, 4.5); w.p.y += 2; w.p.grounded = false; w.p.ball = true;
  run(w, 40, {}); assert.ok(w.monitors[0].broken, 'the ball onto it breaks it');
  w = ROMLV(0, 0, mon); place(w, 4.5, 4.5); w.p.y += 2; w.p.grounded = false;
  run(w, 40, {}); assert.ok(!w.monitors[0].broken && w.p.grounded && Math.abs(w.p.y - (1 + 24 / 32)) < 1e-6, `stands on it: ${w.p.y}`);
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
  // VV2's vent at 0x63AC: off while the rock on its partner stands
  const ventOff = [{ type: 'vent', x: 4.5, z: 2.5, to: [9.5, 1, 2.5], vel: [-3.75, 15.9, 0], offWhileRock: [9, 2] }, { type: 'rocks', cells: [[9, 2, 1.5]] }];
  w = FLAT(ventOff); place(w, 4.5, 2.5); let drawn = false;
  run(w, 20, (f, ww) => { if (ww.events.includes('ventIn')) drawn = true; return {}; });
  assert.ok(!drawn && !w.p.vent, 'vent off while the rock stands');
  w = FLAT(ventOff); w.rocks.delete(2 * w.L.width + 9); w.L.up.delete(2 * w.L.width + 9); place(w, 4.5, 2.5); drawn = false;
  run(w, 20, (f, ww) => { if (ww.events.includes('ventIn')) drawn = true; return {}; });
  assert.ok(drawn, 'vent on once the rock is broken');
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
test('Volcano Valley 2 as the original: the balls swing on one angle only past the gate, in whole units, touched as objects', () => {
  const ball = (z, phase) => ({ type: 'spikeBall', x: 3.5, z, y: 1, axis: 'z', centre: 2.5, amp: 1.75, w: 8 * Math.PI / 1024, phase, gate: [3, 0], touch: [8, 16] });
  let w = ROMLV(0, 0, [ball(2.5, 0), ball(2.5, Math.PI)]); w.p.inv = 1e9; place(w, 1.5, 4.5);
  run(w, 30, {}); assert.ok(w.spikeBalls.every(q => q.z === 2.5) && !w.ballA, 'still with the player short of the gate');
  w = ROMLV(0, 0, [ball(2.5, 0), ball(2.5, Math.PI)]); w.p.inv = 1e9; place(w, 3.5, 4.5);
  run(w, 40, {});
  const v = Math.floor(Sim.P.orig.sin[(8 * 39 & 0x7FE) >> 1] * 112 / 65536);
  assert.strictEqual(w.spikeBalls[0].z * 32, 80 + v, 'first: centre + (sine x 112) >> 16 at the angle before this frame');
  assert.strictEqual(w.spikeBalls[1].z * 32, 80 - v, 'second: the other way');
  assert.strictEqual(w.ballA, 8 * 40 & 0x7FE, 'angle 8 a frame');
  w = ROMLV(0, 0, [ball(2.5, 0)]); w.ringCount = 5; place(w, 3.5, 4.5);
  // (x - z within 0x2C - 8 of his: 144 - z <= 36; (x + z) / 2 within 0x20 - 8: looser)
  let at = -1, first = -1; run(w, 120, (f, ww) => { if (ww.events.includes('hurt') && at < 0) at = f; if (first < 0 && ww.spikeBalls[0].z * 32 >= 108) first = f; return {}; });
  assert.ok(at > 0 && at === first, `hurt as it comes within reach (frames ${at}, ${first})`);
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
test('the original\'s patrol: a whole unit every other frame, its way first, put on an end and turned; it runs and shoots only on screen', () => {
  // (ROMLV: origin 0, so units are 1/32 m; the window [w, h, x, y, record y] puts it always on screen)
  const en = { type: 'enemy', x: 4.125, z: 2.5, patrol: { axis: 'x', range: [4, 4.25], dir: -1 }, speed: 0.9375, win: [0xFFFF, 0xFFFF, 0, 0, 24], skin: '178' };
  const w = ROMLV(0, 0, [en]); place(w, 1.5, 4.5);
  const xs = []; run(w, 30, (f, ww) => { if (ww.enemies[0].X !== undefined) xs.push(Math.round(ww.enemies[0].X / 65536)); return {}; });
  const steps = xs.slice(1).map((v, i) => v - xs[i]), moves = steps.filter(d => d);
  assert.ok(moves.every(d => Math.abs(d) === 1) && steps.every((d, i) => !d || !steps[i + 1]), `a unit every other frame (${xs.join(' ')})`);
  assert.strictEqual(moves[0], -1, 'its way first: down');
  assert.ok(Math.min(...xs) === 128 && moves.includes(1), `put on its end (128) and turned (${xs.join(' ')})`);
  const v = ROMLV(0, 0, [Object.assign({}, en, { shoot: 0, win: [1, 1, 0, 0, 24] })]); place(v, 1.5, 4.5);   // (a window it is never in)
  run(v, 70, {}); assert.ok(v.enemies[0].X === undefined && !(v.shots || []).length, 'off screen: still and silent');
});
test('the original\'s bumper picks its way in whole units of the cell (30.6, 30.1 is 30, 30: south)', () => {
  const w = ROMLV(0, 0, [{ type: 'bumpers', cells: [[3, 4]] }]); place(w, 2.5, 4.5);
  Object.assign(w.p, { x: 3 + 30.6 / 32, z: 4 + 30.1 / 32, vx: 0, vz: 0 }); run(w, 1, {});
  assert.ok(w.events.includes('bumper') && w.p.vz > 9 && Math.abs(w.p.vx) < 1e-9, `south (${w.p.vx}, ${w.p.vz})`);
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
test('gates stand until their ring or a supercharged run (until a passOff cell); barriers hurt in their half until their ring', () => {
  let w = GNG([{ type: 'gate', cells: [[6, 1], [6, 2], [6, 3]], top: 3, opens: 1 }, { type: 'goal', x: 2.5, z: 2.5 }, { type: 'goal', x: 12.5, z: 2.5 }]); place(w, 4.5, 2.5);
  run(w, 90, { mx: 1 }); assert.ok(w.p.x < 6, `held at ${w.p.x.toFixed(2)}`);
  w.section = 1; run(w, 90, { mx: 1 }); assert.ok(w.p.x > 7, `through at ${w.p.x.toFixed(2)}`);
  w = GNG([{ type: 'gate', cells: [[6, 1], [6, 2], [6, 3]], top: 3, pass: true }, { type: 'booster', x: 3.5, z: 2.5, dir: [1, 0] }]); place(w, 3.5, 2.5);
  run(w, 150, {}); assert.ok(w.p.x > 7, `the run went through: ${w.p.x.toFixed(2)}`);
  // (a passOff cell ends the run's pass: the gates stand again, walking back is blocked)
  w = GNG([{ type: 'gate', cells: [[6, 1], [6, 2], [6, 3]], top: 3, pass: true }, { type: 'booster', x: 3.5, z: 2.5, dir: [1, 0] }, { type: 'passOff', cells: [[9, 2]] }]); place(w, 3.5, 2.5);
  run(w, 150, {}); assert.ok(w.p.x > 9 && !w.passOn.has(1), `through, and the flag cleared at ${w.p.x.toFixed(2)}`);
  place(w, 7.5, 2.5); run(w, 90, { mx: -1 }); assert.ok(w.p.x >= 7, `held behind the gate at ${w.p.x.toFixed(2)}`);
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
  run(w, 90, { mx: -1 }); assert.ok(w.p.x >= 7, `shut behind: ${w.p.x.toFixed(2)}`);
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
  run(w, 90, { mx: -1 }); assert.ok(w.p.x >= 6, `held at ${w.p.x.toFixed(2)}`);
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
test('a sled runs Sonic along its way and turns a right angle where a corner piece meets no floor (Diamond Dust 1)', () => {
  const tiles = [];
  for (let z = 0; z < 8; z++) for (let x = 0; x < 5; x++) {
    const floor = (x === 2 && z <= 5) || (z === 5 && x <= 2);
    tiles.push(!floor ? { c: [0, 0, 0, 0], t: 'W' } : x === 2 && z === 5 ? { c: [1, 1, 1.5, 1], t: 'F' } : { c: [1, 1, 1, 1], t: 'F' });
  }
  const w = world({ version: 1, format: 'tiles', width: 5, depth: 8, tiles, rom: { level: 9, origin: [0, 0], vscale: 1 }, physics: Object.assign({}, ORIG.physics, { orig: 1 }),
    entities: [{ type: 'start', x: 2.5, z: 0.5 }, { type: 'sled', box: [2, 3, 0, 1], dir: [0, 1], accel: 7, at: [2.5, 1, 0.5], t: 5 }] });
  w.ice = true; w.iceCell = 2;
  let turned = null;
  run(w, 240, (f, ww) => { ww.ice = true; if (!turned && ww.p.vx < -0.5) turned = { x: ww.p.x, z: ww.p.z }; return {}; });
  assert.ok(turned && turned.z > 5.9 && turned.z < 6, `turned west at the edge of the corner piece (${turned && turned.z.toFixed(3)})`);
  assert.ok(w.p.x < 1.05 && w.p.z > 5.9, `then ran west along the row to its end (${w.p.x.toFixed(2)}, ${w.p.z.toFixed(2)})`);
});
test('warp holes: landing on the first opens both; falling in comes out of the other, thrown up (Diamond Dust 1)', () => {
  const w = GNG([{ type: 'warpHole', cells: [[4, 2], [12, 2]], exits: [[12.5, 0.25, 2.5], [4.5, 0.25, 2.5]], below: [0.5, 0.5], out: [-3.75, 15.94, 0] }]);
  w.ringCount = 5; place(w, 4.5, 2.5);
  run(w, 60, {}); assert.ok(!w.warpHole.open, 'standing does not open it');
  let warped = -1, out = -1;
  run(w, 400, (f, ww) => { if (warped < 0 && ww.events.includes('warp')) warped = f; if (warped >= 0 && out < 0 && ww.p.vy > 5) out = f; return f < 4 ? { jump: true } : {}; });
  assert.ok(w.warpHole.open && warped > 0, `opened and fell through (${warped})`);
  assert.ok(out - warped >= 100 && out - warped <= 110, `held while the camera pans (${out - warped})`);
  assert.ok(w.p.grounded && w.p.x > 9 && w.p.x < 12 && Math.abs(w.p.y - 1) < 0.01, `landed by the other hole (${w.p.x.toFixed(2)}, ${w.p.y.toFixed(2)})`);
});
test('a fire bar turns six fireballs about its line every 64 frames; they burn, but not with the fire shield', () => {
  let w = GNG([{ type: 'fireBar', x: 6, y: 1.5, z: 2.5 }]); w.ringCount = 5; place(w, 6.8, 2.5);
  const ys = []; run(w, 65, (f, ww) => { if (f) ys.push(ww.barBalls[2][1]); return {}; });
  assert.ok(w.barBalls.length === 6 && Math.abs(w.barBalls[5][0] - w.barBalls[0][0] - 85 / 32) < 1e-6, 'six, 85 units along x');
  near(Math.max(...ys) - Math.min(...ys), 24 / 32, 0.01, 'the middle ones swing 12 units each way');
  assert.ok(w.ringCount === 0, 'burnt');
  w = GNG([{ type: 'fireBar', x: 6, y: 1.5, z: 2.5 }]); w.ringCount = 5; w.p.shield = 'fire'; place(w, 6.8, 2.5);
  run(w, 64, {}); assert.ok(w.ringCount === 5, 'the fire shield spares');
});
// Final Fight: a flat floor at the act's height (25.25 m) over the act's 34 x 22 cells; the doors as the converter makes them
const FF = () => {
  const tiles = []; for (let k = 0; k < 34 * 22; k++) tiles.push({ c: [25.25, 25.25, 25.25, 25.25], t: 'F' });
  const doors = [[[26, 9], [27, 9]], [[26, 14], [27, 14]], [[21, 3], [21, 4]], [[24, 3], [24, 4]], [[9, 3], [9, 4]], [[12, 3], [12, 4]], [[5, 9], [6, 9]], [[5, 14], [6, 14]], [[10, 18], [10, 19]], [[22, 18], [22, 19]]];
  const w = world({ version: 1, format: 'tiles', width: 34, depth: 22, tiles, entities: [{ type: 'start', x: 26.5, z: 18.5 },
    { type: 'boss', kind: 'ff', x: 22, y: 12.5, z: 18, home: [22, 18], cruise: 25, arena: [-1, 32, -1, 21], hp: 10, vs: 1, org: [52, 46], doors, doorTop: 33.25 }] });
  w.ringCount = 50; return w;
};
const ffTp = (w, x, y, z, ball) => Object.assign(w.p, { x: x / 32 - 52, y: (y + 8) / 32, z: z / 32 - 46, vx: 0, vy: 0, vz: 0, grounded: !ball, ball: !!ball, jumping: false });
const ffUp = (w, cx, cz) => w.L.up.has(cz * 34 + cx);
test('the Final Fight machine rises, aims and fires lasers across Sonic\'s row; a jump onto it when it comes forward is a hit', () => {
  const w = FF(); let laser = null, f = 0;
  assert.ok(ffUp(w, 22, 18) && ffUp(w, 10, 19) && !ffUp(w, 26, 9), 'six doors shut at the start');
  for (; f < 1200 && !laser; f++) { Sim.step(w, {}); w.ringCount = 50; w.p.invuln = 0.1; laser = w.shots.find(q => q.laser); }
  assert.ok(laser && f > 400, `a laser at frame ${f}`); assert.ok(Math.abs(laser.z - w.p.z) < 0.6, `along Sonic's row (z ${laser.z.toFixed(2)} vs ${w.p.z.toFixed(2)})`);
  const b = w.boss; let hit = false;
  for (f = 0; f < 3000 && !hit; f++) {
    if (b.si === 9 && b.ux >= 0x960) ffTp(w, b.ux + 28, b.uy + 40, b.uz + 4, true);
    Sim.step(w, {}); w.ringCount = 50; hit = w.events.includes('bossHit');
  }
  assert.ok(hit && b.left === 9 && b.def === 200, 'one hit of ten');
  run(w, 200, {}); assert.strictEqual(b.st, 1, 'beaten: the walk to the next room');
  assert.ok(!ffUp(w, 26, 9) && !ffUp(w, 27, 14), 'the east corridor\'s doors open');
});
test('Final Fight: 600 frames to reach the next room or Sonic is killed; walking on shuts the doors behind and the next fight starts', () => {
  let w = FF(), b = w.boss; Object.assign(b, { def: 1 }); Sim.step(w, {});
  assert.strictEqual(b.st, 1); const deaths = w.deaths; let up = false;
  run(w, 610, (k, ww) => { if (ww.events.includes('timeUp')) up = true; ww.ringCount = 50; return {}; });
  assert.ok(up && w.deaths === deaths + 1 && w.boss.st === 0 && w.boss.left === 10 && ffUp(w, 22, 18), 'time up: killed, the fight starts again');
  w = FF(); b = w.boss; Object.assign(b, { def: 1 }); Sim.step(w, {});
  ffTp(w, 2592, 800, 1700); Sim.step(w, {});
  assert.ok(b.st === 2 && ffUp(w, 26, 9) && ffUp(w, 26, 14), 'in the north-east room, both doors shut');
});
test('Final Fight: ten hits, one a fight round the rooms, end the act', () => {
  const w = FF(), b = w.boss, room = { 1: [2592, 1632], 3: [2200, 1600], 5: [1800, 1632], 7: [1880, 2050], 9: [2512, 2064] };
  const chance = q => (q.st === 0 && q.si === 9 && q.ux >= 0x960) || (q.st === 2 && q.si === 12) || (q.st === 4 && q.si === 23) || (q.st === 6 && q.si === 4 && q.ux >= 0x690) || (q.st === 8 && q.si === 12);
  const fights = []; let end = -1;
  for (let f = 0; f < 30000 && end < 0; f++) {
    if (b.st % 2 && room[b.st]) ffTp(w, room[b.st][0], 800, room[b.st][1]);
    else if (!b.def && !b.cool && chance(b)) { w.p.invuln = 0; ffTp(w, b.ux + 28, b.uy + 40, b.uz + 4, true); }
    Sim.step(w, {}); w.ringCount = 50;
    if (w.events.includes('bossHit')) fights.push(b.st);
    if (w.events.includes('goal')) end = f;
  }
  assert.deepStrictEqual(fights, [0, 2, 4, 6, 8, 0, 2, 4, 6, 8], 'one hit in each fight, twice round');
  assert.ok(end > 0 && w.cleared, `the act ended (${end})`);
});
test('Tails and Knuckles: hidden until shown; fifty rings given in all open the special stage', () => {
  const w = FLAT([{ type: 'friend', x: 6.5, z: 2.5, y: 1, who: 'tails', show: { cell: [4, 2] } }, { type: 'friend', x: 9.5, z: 2.5, y: 1, who: 'knuckles' }]);
  place(w, 6.5, 2.5); w.ringCount = 30; Sim.step(w, {});
  assert.strictEqual(w.ringCount, 30, 'a hidden friend takes nothing');
  place(w, 4.5, 2.5); Sim.step(w, {}); assert.ok(w.friends[0].shown, 'shown from its cell');
  place(w, 6.5, 2.5); let took = -1, open = -1, at = 0;
  run(w, 130, (f, ww) => { if (took < 0 && ww.ringCount === 0) took = f; if (ww.events.includes('bonusIn')) open = f; if (f === 100) at = ww.p.x; return { mx: 1 }; });
  assert.ok(took >= 68 && took <= 71 && open < 0 && w.friendRings.tails === 30, `30 given (taken at frame ${took}), no stage`);
  assert.ok(Math.abs(at - (6.5 + 0.5)) < 0.01, `walked beside, the pad held (${at.toFixed(2)})`);
  w.ringCount = 25; place(w, 6.5, 2.5);
  run(w, 130, (f, ww) => { if (ww.events.includes('bonusIn')) open = f; return {}; });
  assert.ok(open > 110 && w.bonusWho === 'tails' && w.friendRings.tails === 55, `55 in all: the stage at frame ${open}`);
  w.ringCount = 60; place(w, 6.5, 2.5); open = -1;
  run(w, 130, (f, ww) => { if (ww.events.includes('bonusIn')) open = f; return {}; });
  assert.ok(open < 0, 'only the gift that passes 50 opens it');
});
test('a death reloads the act: rings, enemies and monitors are back; the player starts at the section start', () => {
  const w = FLAT([{ type: 'ring', x: 4.5, z: 2.5 }, { type: 'enemy', x: 10.5, z: 2.5, radius: 0 }, { type: 'monitor', x: 13.5, z: 2.5 }]);
  place(w, 4.5, 2.5); Sim.step(w, {});
  w.enemies[0].alive = false; w.monitors[0].broken = true;
  assert.ok(w.rings[0].got && w.ringCount === 1, 'ring taken');
  w.L.killY = 5; Sim.step(w, {}); w.L.killY = -50;
  assert.ok(w.events.includes('respawn') && w.deaths === 1, 'died');
  assert.ok(!w.rings[0].got && w.enemies[0].alive && !w.monitors[0].broken && w.ringCount === 0, 'all back');
});
test('Sonic heads: taken in their cell from 40 units under them to 6 over', () => {
  const w = FLAT([{ type: 'head', x: 5.5, z: 2.5, y: 3, cell: [5, 2] }]);
  place(w, 5.5, 2.5); Sim.step(w, {});
  assert.ok(!w.heads[0].got, 'too far under');
  Object.assign(w.p, { y: 3 - 30 / 32, grounded: false, vy: 0 }); Sim.step(w, {});
  assert.ok(w.heads[0].got && w.events.includes('head'), 'taken in reach');
});
// a special stage of my own: a straight track 64 wide, a step up of 40 at distance 200, rings, a spiked ball, a gate
// at 900 wanting 50, the emerald at 1200
function bonusData(rings) {
  const track = [];
  for (let d = 1600; d >= -512; d -= 32) { track.push([0, d, 0, d > 200 ? -40 : 0]); if (d === 224) track.push([0, 200, 0, -40], [0, 200, 0, 0]); }
  const items = [];
  for (let k = 0; k < rings; k++) { const d = -300 + k * 12; items.push([d, 32, (d > 200 ? -40 : 0) - 10, 1]); }
  items.push([800, 32, -50, 3], [900, 10, -50, 2], [900, 54, -50, 2], [1200, 32, -60, 7]);
  items.sort((a, b) => a[0] - b[0]);
  return { n: 0, look: 'lava', speed: 0x20000, track: track.map((r, i) => i ? r : [track.length, ...r.slice(1)]), items, pal: [] };
}
const bonusRun = (b, frames, inp) => { for (let f = 0; f < frames && !b.done; f++) Sim.bonusStep(b, typeof inp === 'function' ? inp(f, b) : inp); return b; };
test('Special stage: a step stops Sonic unless he jumps it; rings count; the emerald ends it', () => {
  let b = bonusRun(Sim.bonusStart(bonusData(60)), 600, {});
  assert.ok((b.z >> 16) === 199, `held at the step (${b.z / 65536})`);
  b = bonusRun(Sim.bonusStart(bonusData(60)), 3000, (f, q) => ({ jump: (q.z >> 16) > 150 && (q.z >> 16) < 200 }));
  assert.strictEqual(b.done, 'emerald', 'over the step, through the gate, the emerald');
  assert.ok(b.rings >= 50, `rings ${b.rings}`);
});
test('Special stage: too few rings at a gate fail it; a spiked ball takes 10, or throws him off with none', () => {
  let b = bonusRun(Sim.bonusStart(bonusData(30)), 3000, (f, q) => ({ jump: (q.z >> 16) > 150 && (q.z >> 16) < 200 }));
  assert.ok(b.done === 'fail' && b.rings === 30, `failed at the gate with ${b.rings}`);
  const d = bonusData(0); d.items.push([0, 32, 0, 0]); d.items.sort((a, c) => a[0] - c[0]);
  b = Sim.bonusStart(d); b.rings = 25; let hit = false;
  bonusRun(b, 700, (f, q) => { if (q.events.includes('hurt')) hit = true; return {}; });
  assert.ok(hit && b.rings === 15 && b.hitT === 0, `one hit costs 10 (${b.rings})`);
  b = Sim.bonusStart(d); bonusRun(b, 400, {});
  assert.strictEqual(b.done, 'fail', 'none: thrown off');
});
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
