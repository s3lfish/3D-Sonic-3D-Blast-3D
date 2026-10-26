# Blast Grid — project map

Browser true-3D take on an isometric Mega Drive platformer. Levels, art and sprites come from the player's own ROM
at run time; original scribbled art otherwise. No Sega data in the repo or the build. Public: GPL-3.0, GitHub Pages
serves index.html from main.

## Files
- `index.html` — the published single file. Tags: `#level` (JSON), `#sim` (pure sim, edit in place), `#art`, `#game`.
- `src/art.js`, `src/game.js` — sources for `#art` / `#game`. Edit these, then `python3 tools/build.py`
  (also re-embeds `tools/scribble_isle.json`). Never hand-edit those tags in index.html.
- `src/s3d.js` — reads level terrain from the player's Sonic 3D Blast MD ROM in the browser (RNC1 + map rules).
  Reverse-engineering notes and reference tools live in `re/` (`re/NOTES.md`). Must contain rules only, never ROM data.
  Also draws sprites from the player's ROM: `heroImage` (player frame codec), `ringImage`, `recipeImage` (object types:
  piece offsets + ROM addresses in `RECIPES`, no pixels), `paletteRGB`, `OCTANT`/`HERO` frame tables.
- `tools/make_level.py` — generates the built-in level "Scribble Isle" (36x32): `python3 tools/make_level.py > tools/scribble_isle.json`.
- `PLAN.md` — v2 plan after independent review. Milestones there.
- `tests/sim.test.js` — `node tests/sim.test.js`; extracts `#sim`/`#level` via regex, runs in vm.
- `tests/render.test.js` — `npm run test:render`; Playwright Chromium with `--use-angle=swiftshader`. Serves three r128
  from node_modules. Screenshots phone + desktop. Fixture levels in `tests/levels/`.
- `re/leakcheck.py` — run before every push: the page must carry no ROM bytes.

## Conventions
- Units: 1 tile = 1 m; grid heights base-36 chars × heightUnit (0.25 m). x east, z south, y up.
- Canonical level = per-tile corner heights [nw,ne,se,sw] m + coll (F floor / P pit / H hazard / W void) + mat + entities.
  W blocks the player walking and jumping, has no floor, is not drawn, and is open air to the camera (`camTop`).
  Converted levels use W for every cell without floor: the original never lets Sonic off the edge.
- Ramp char n/e/s/w: that side's corners copy the neighbour's height. Type chars: . grass, # stone, = bridge (wood), x pit, ^ hazard.
- Entities: start (facing deg), ring (y above floor, or absY absolute), ringLine, ringCircle, spring (power m/s, default 12),
  enemy (radius, speed), monitor, goal, palm/bush/flower (decor, variant, size).
  Optional level `killY`. Loader errors are user-facing sentences.
- Art: everything drawn in code with seeded wobble (`Art.*`); hero is an original blue blob (googly eyes, leaf sprout,
  lime scarf). No spikes, no red shoes, no gloves: keep it clearly original, never a look-alike.
  Hero is a billboard sprite; textures cached lazily per view/pose/phase/boil/flip. Trees/bushes fade when blocking the camera.
- ROM sprites (decomp model): with a ROM loaded and Look = "Sprites from your ROM", hero, rings, springs, monitors and
  enemies come from the ROM; anything without a recipe (goal, decor, enemies 060/0C8) stays scribbled. ROM kept in
  IndexedDB `blastgrid`/`rom` until "Forget ROM"; look in localStorage `blastgrid.look`. 0.025 m per ROM pixel;
  96 px canvases; hero foot line y=84, object anchor y=80. Entities carry optional `skin` (hex type, e.g. "018");
  converted levels carry `palettes` (header bytes +0x26..0x29). Built-in level uses level 1 palettes and default skins.
- Level art: converted levels carry `rom` {level, origin [x0, z0], vscale} and `physics` (original movement scaled by
  vscale). With ROM sprites on, `S3D.artBaker` unprojects the original picture into a 2048-wide atlas of 32 px slots;
  the mesh uses MeshBasicMaterial with that atlas (walls in bands one original unit tall). Falls back to the scribbled
  mesh if baking throws. Converter default is true shape (vscale 1); half height keeps the same timing.
- Sections: `goal` entities in order are big rings; touching the current one (on entry) advances `w.section` and sets the
  respawn there; the last clears the level. `hole` {x, z, opens, exit [x, z], launch} swallows a grounded player once
  `opens` <= section and throws them out at exit (1 s rest after a warp). Only the current ring is drawn.
- Flickies: level `flickies` (converted levels with rings: 5). Each defeated enemy frees one (hops about; touch to
  collect); followers trail the player (every 14 sim frames along `w.trail`); a hit or a death scatters them. A ring
  takes followers up to its share; it opens at min(share, delivered + following + free + enemies alive), so it never
  locks. ROM look: the bird from object art 0x32950 (16 frames, palette 3); scribbled bird otherwise. HUD `#flickyHud`.
- Foliage: `artBaker(...).foliage` lifts clumps of high-priority picture tiles that stand on a floor out of the baked
  art (the ground beneath shows through); the game draws them as camera-facing quads in one mesh (`buildFoliage`,
  `updateFoliage`), tucked away when between the chase camera and the player. Grass along cliff tops and pieces of
  floor drawn in front stay painted. GG1: 58 pieces (palms, flowers, flower beds, a cannon).
- Objects added 2026-10-26: `mine` (hurts, then gone), `turret` (shot every 2.5 s within 8 m), `booster` {dir}
  (supercharger: jump on it, held `P.boostWait`, fired at `P.boostSpeed`); monitor `kind` (rings, shield, gold, invincible,
  speed, oneup, fire); enemy `chase` (Scouter 58) and radius 0 (Hunter 0C stands still). Player: `shield`, `inv`, `fast`
  timers; shields take a hit without losing rings; gold shield dashes on a second jump press in the air.
- Spin dash: hold dash to brake and rev (any speed), release to launch; a tap under 0.12 s while running rolls.
- Springs: `power` = launchFor(140 units); the sim subtracts one step of gravity on launch so the rise matches.
  ROM look draws springs as 3D drums coloured from the ROM sprite (`romSpringMats`).
- Act end: the `goal` event shows `#clearCard`, flashes, and after 5 s converts the next act in `S3D.LEVELS` order.
- Act results (ROM look): `S3D.tallyImage` draws the original's results screen (fonts RNC 0x15DEBA/0x15E3E6, palettes
  26/27/3) into `#tallyCanvas`; bonus rules are mine (`timeBonus`, 100 a ring, 100 a Flicky saved = `w.saved`).
- Saturn screen (`#screenSel`, `blastgrid.screen`): scene into a 224-line target, 15-bit colour, nearest filtering;
  `satPatch` adds affine texture mapping (vAffUv/vAffW) to meshes and checkerboard mesh transparency to all materials.
  Texture userData does not exist in r128: original filters live in the `satMin` WeakMap.
- Sound: `Sfx` in game.js, Web Audio blips per sim event (original, nothing from the ROM); M mutes (`blastgrid.mute`).
- Big ring in ROM look: object art 0x3D068 frame 0, floating 56 units up, squeezed in x to turn.
- ROM files: `S3D.openRomFile` takes a plain ROM, an .smd dump (de-interleaved) or either inside a .zip (stored or
  deflate via DecompressionStream).
- Controller (standard mapping): Start/A start from the menu, Start pauses, A jump, B/X dash, LB/RB swing, Y or Back
  switches view, R3 recentres, right stick looks (2.6 rad/s yaw, 1.4 pitch; flick in iso). Non-standard pads with six
  or more axes read the right stick from axes 3/4. `tests/pad.test.js` drives a fake pad.
- Sky: converted levels with art get a banded dome in zone colours (my palette, `ZONE_SKY`) that follows the camera,
  fog in the horizon colour, cliffs 14 m deep, no water. Built-in level keeps the cartoon sky and water.
- Level loading: help card "Load level file" (JSON, grid or tiles format), stored in localStorage `blastgrid.level`.
  Never embed Sega level data in the published page; players load their own files locally.
- Sim tuning lives in `Sim.P`; a level's `physics` overrides gravity, jumpV, jumpCut, maxFall, stepUp, snapDown (`L.phys`).
  Defaults: stepUp 0.3 m grounded; airborne must clear ledge top (+0.02); jump peak ~1.28 m (built-in level: 1 m ledges
  reachable, 1.5 m not; border walls 'a' 1.5 m above ground).
- Three r128 core only: no BufferGeometryUtils, Geometry, CapsuleGeometry. Hand-built BufferGeometry.
- Camera: default is the chase cam (perspective, leash at 6.5 m, Mario 64 style); iso is a toggle (V / ISO button,
  remembered in localStorage `blastgrid.cam`). Chase cam: stays inside map, stops at tiles taller than
  followY+0.9, raises pitch to see over obstacles, swings toward open space when backed into walls,
  min distance 1.2 m. Chase input basis is continuous (circling is intended); iso basis freezes while held.
- Start entity takes `facing` in compass degrees (0 north, 90 east); camera starts behind it.
- Look controls: right-half touch drag, mouse drag, right stick; Q/E swing 45° (chase) or 90° (iso).

## Scars
- `.overlay{display:grid}` beat the `hidden` attribute without an explicit `[hidden]{display:none!important}` rule.
- Tests that run too many frames overshoot the level edges; size frame counts to the geometry.
- First chase cam version sat on top of border walls or outside the map when the player ran toward it;
  fixed by bounding to the map, stopping at tall tiles, and the open-space swing.

## Status
- 2026-10-26: Springs measured (140 units), monitors with ROM icons and effects, mines, turrets, superchargers, Scouters
  chase, Hunters stand, Flickies coloured in turn, act end moves to the next act, sound effects, spin dash on hold. 64 sim tests.
  Bill asked about music: offered own audio files, VGM rips, or full emulation; awaiting his choice.
- 2026-10-26: Published on GitHub (s3lfish/3D-Sonic-3D-Blast-3D), Pages at https://s3lfish.github.io/3D-Sonic-3D-Blast-3D/.
  All 22 levels convert; level art, foliage, zone skies, ROM sprites, measured physics, zip/SMD ROMs, controller.
  Green Grove sections, rings, holes and Flickies work (GG1 playable to the end). 54 sim tests, pad test, render test.
  Gaps: other zones' section gimmicks, Flicky colours, monitor icons, bosses, sound; palms on cliff edges stay painted;
  stretched texture on steep slopes facing away from the original camera; GG2 foliage bake about 1.25 s.
