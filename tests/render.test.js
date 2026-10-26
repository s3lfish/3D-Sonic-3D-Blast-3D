// Headless render check: node tests/render.test.js <path-to-three.min.js> <out-dir>
'use strict';
const path = require('path'), fs = require('fs');
const { chromium } = require('playwright');
const sharp = require('sharp');
const [threePath, outDir] = process.argv.slice(2);
const page_html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const wrapped = '<!doctype html><html><head><meta charset="utf-8"></head><body>' + page_html + '</body></html>';

const sizes = [
  { name: 'phone', width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  { name: 'desktop', width: 1280, height: 800, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
];

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  let failed = 0;
  for (const s of sizes) {
    const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, isMobile: s.isMobile, hasTouch: s.hasTouch, deviceScaleFactor: s.deviceScaleFactor });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await page.route('**/three.min.js', r => r.fulfill({ path: threePath, contentType: 'application/javascript' }));
    await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
    await page.route('http://game.test/', r => r.fulfill({ body: wrapped, contentType: 'text/html' }));
    await page.goto('http://game.test/');
    await page.waitForFunction(() => window.__game && window.__game.frames > 30, null, { timeout: 20000 });
    await page.screenshot({ path: path.join(outDir, `${s.name}-help.png`) });
    await page.evaluate(() => window.__game.start());
    // drive the player: run east along the ring line, then jump
    if (s.name === 'desktop') {
      await page.keyboard.down('KeyD'); await page.waitForTimeout(900);
      await page.keyboard.down('Space'); await page.waitForTimeout(250); await page.keyboard.up('Space');
      await page.waitForTimeout(400); await page.keyboard.up('KeyD');
    } else {
      await page.waitForTimeout(1500);
    }
    const camCheck = () => page.evaluate(() => {
      const g = window.__game, c = g.camera.position, f = g.Sim.floorAt(g.level, c.x, c.z);
      return { mode: g.view.mode, camY: +c.y.toFixed(2), floor: Number.isFinite(f) ? +f.toFixed(2) : null, ok: !Number.isFinite(f) || c.y > f + 0.3 };
    });
    const cams = [await camCheck()];
    if (s.name === 'desktop') {
      // run into the south-east corner, where walls should pull the camera in rather than letting it clip
      await page.keyboard.down('KeyS'); await page.keyboard.down('KeyD'); await page.waitForTimeout(1500);
      await page.keyboard.up('KeyS'); await page.keyboard.up('KeyD');
      cams.push(await camCheck());
      await page.screenshot({ path: path.join(outDir, `${s.name}-corner.png`) });
      await page.evaluate(() => window.__game.setMode('iso')); await page.waitForTimeout(300);
      cams.push(await camCheck());
      await page.screenshot({ path: path.join(outDir, `${s.name}-iso.png`) });
      await page.evaluate(() => window.__game.setMode('chase')); await page.waitForTimeout(300);
      // level loading through the real file input: a broken file, then a valid one, then back to built-in
      const lv = path.join(__dirname, 'levels');
      await page.click('#helpBtn');
      await page.setInputFiles('#levelFile', path.join(lv, 'broken.json'));
      await page.waitForFunction(() => !document.getElementById('loadMsg').hidden);
      const brokenMsg = await page.textContent('#loadMsg');
      await page.setInputFiles('#levelFile', path.join(lv, 'tiny.json'));
      await page.waitForFunction(() => window.__game.level.name === 'Tiny Test');
      const tiny = await page.evaluate(() => ({ name: window.__game.level.name, rings: window.__game.world.rings.length, label: document.getElementById('levelName').textContent, builtInShown: !document.getElementById('builtInBtn').hidden }));
      await page.click('#playBtn'); await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(outDir, `${s.name}-tiny.png`) });
      await page.click('#helpBtn'); await page.click('#builtInBtn');
      const back = await page.evaluate(() => window.__game.level.name);
      await page.click('#playBtn');
      const loadOk = /Row 1 of "heights" has 2 tiles/.test(brokenMsg) && tiny.rings === 1 && tiny.builtInShown && back === 'Scribble Isle';
      cams.push({ mode: 'load-test', ok: loadOk, brokenMsg, tiny, back });
    }
    const state = await page.evaluate(() => {
      const g = window.__game;
      return { frames: g.frames, rings: g.world.ringCount, x: g.world.p.x, y: g.world.p.y, touchUI: !document.getElementById('touchUI').hidden,
        helpHidden: document.getElementById('helpOverlay').hidden, errorShown: getComputedStyle(document.getElementById('errorOverlay')).display !== 'none' };
    });
    const shot = await page.screenshot({ path: path.join(outDir, `${s.name}-play.png`) });
    const { data } = await sharp(shot).raw().toBuffer({ resolveWithObject: true });
    const seen = new Set();
    for (let q = 0; q < data.length; q += 3 * 97) seen.add((data[q] >> 4) << 8 | (data[q + 1] >> 4) << 4 | (data[q + 2] >> 4));
    state.colours = seen.size; state.cams = cams;
    const ok = errors.length === 0 && state.frames > 60 && state.colours > 20 && !state.errorShown && state.helpHidden && cams.every(c => c.ok);
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${s.name}: ${JSON.stringify(state)}${errors.length ? '\n     ' + errors.join('\n     ') : ''}`);
    await ctx.close();
  }
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
