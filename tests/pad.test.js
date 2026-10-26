// Fake controller in Playwright: Start/A from the menu, right stick turns the chase camera, Y switches view, Start pauses.
// Usage: node tests/pad.test.js <three.min.js>
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: 900, height: 600 } })).newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(() => {
    const pad = { connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    window.__pad = pad; navigator.getGamepads = () => [pad];
    window.__press = (i, on) => { pad.buttons[i].pressed = on; pad.buttons[i].value = on ? 1 : 0; };
  });
  await p.route('**/three.min.js', r => r.fulfill({ path: process.argv[2], contentType: 'application/javascript' }));
  await p.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
  await p.route('http://game.test/', r => r.fulfill({ body: '<!doctype html><html><head><meta charset="utf-8"></head><body>' + html + '</body></html>', contentType: 'text/html' }));
  await p.goto('http://game.test/'); await p.waitForFunction(() => window.__game && window.__game.frames > 10, null, { timeout: 30000 });
  const tapBtn = async i => { await p.evaluate(i => window.__press(i, true), i); await p.waitForTimeout(350); await p.evaluate(i => window.__press(i, false), i); await p.waitForTimeout(350); };
  const res = {};
  await tapBtn(9); res.startedByStart = await p.evaluate(() => document.getElementById('helpOverlay').hidden);
  const y0 = await p.evaluate(() => { const g = window.__game; return Math.atan2(g.camera.position.x - g.world.p.x, g.camera.position.z - g.world.p.z); });
  await p.evaluate(() => { window.__pad.axes[2] = 1; }); await p.waitForTimeout(800); await p.evaluate(() => { window.__pad.axes[2] = 0; }); await p.waitForTimeout(300);
  const y1 = await p.evaluate(() => { const g = window.__game; return Math.atan2(g.camera.position.x - g.world.p.x, g.camera.position.z - g.world.p.z); });
  res.cameraTurned = Math.abs(Math.atan2(Math.sin(y1 - y0), Math.cos(y1 - y0))).toFixed(2);
  await p.evaluate(() => { window.__pad.axes[0] = 1; }); await p.waitForTimeout(500); await p.evaluate(() => { window.__pad.axes[0] = 0; });
  res.moved = await p.evaluate(() => Math.hypot(window.__game.world.p.vx, window.__game.world.p.vz) > 0.5 || window.__game.world.p.x !== 4.5);
  await tapBtn(3); res.isoAfterY = await p.evaluate(() => window.__game.view.mode);
  await tapBtn(3); res.chaseAfterY = await p.evaluate(() => window.__game.view.mode);
  await tapBtn(9); res.pausedByStart = await p.evaluate(() => !document.getElementById('helpOverlay').hidden);
  const yBefore = await p.evaluate(() => window.__game.world.p.y);
  await tapBtn(0); res.resumedByA = await p.evaluate(() => document.getElementById('helpOverlay').hidden);
  await p.waitForTimeout(200); res.noJumpOnResume = await p.evaluate(y => Math.abs(window.__game.world.p.y - y) < 0.05, yBefore);
  const ok = res.startedByStart && Number(res.cameraTurned) > 0.5 && res.moved && res.isoAfterY === 'iso' && res.chaseAfterY === 'chase' && res.pausedByStart && res.resumedByA && res.noJumpOnResume && !errs.length;
  console.log(ok ? 'ok  ' : 'FAIL', JSON.stringify(res), errs);
  await b.close(); process.exit(ok ? 0 : 1);
})();
