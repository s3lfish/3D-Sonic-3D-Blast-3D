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
  respawn there (or at its `put` pocket, walked out of); the last clears the level. `hole` {x, z, opens, exit, launch}
  takes a player once `opens` <= section (0: always). Kinds: `pad` {sink, bury, pocket} = the objects' own sequence
  (1C holes in GG, 090 pads in RR; slow grounded player held 100 frames sinking, then 95 frames under the other pad,
  thrown up; `w.padOff` keeps the arrival pad quiet until stepped off); `ride` = scripted move; plain = instant (doors:
  exitY/push/size). Only the current ring is drawn. Every warp fades from black and resets the camera.
- Flickies: level `flickies` (converted levels with rings: 5). Each defeated enemy frees one (hops about; touch to
  collect); followers trail the player (every 14 sim frames along `w.trail`); a hit or a death scatters them. A ring
  takes followers up to its share; it opens at min(share, delivered + following + free + enemies alive), so it never
  locks. ROM look: the bird from object art 0x32950 (16 frames, palette 3); scribbled bird otherwise. HUD `#flickyHud`.
- Foliage: `artBaker(...).foliage` lifts clumps of high-priority picture tiles that stand on a floor out of the baked
  art (the ground beneath shows through); the game draws them as camera-facing quads in one mesh (`buildFoliage`,
  `updateFoliage`), tucked away when between the chase camera and the player. Grass along cliff tops and pieces of
  floor drawn in front stay painted. A piece holding several blobs of 120+ pixels (rows of flowers, a palm with flowers)
  is split (`splitBlobs`, `standPart`), each standing on its own floor; GG1: 76 pieces.
- Hidden walls: bands the original never shows borrow a nearby visible band; body bands prefer plain rock (`leafy`:
  more than 1 in 32 of 64 samples green is refused), so cliffs are not patterns of copied plants. bake.py matches.
- Animated tiles: `ANIM_FRAMES` (per level: tile runs, ROM address per frame, video frames each; from re/animwatch.py);
  the bake keeps slots showing animated texels (`animSlots`, with a texel mask, wall band) and `animStep(videoFrame)`
  redraws them; the game copies changed slots to the atlas with `copyTextureToTexture` (`updateLevelAnim`). With Jam
  objects on, Jam's waterfall texture (def 211) scrolls down over animated wall texels.
- Objects added 2026-10-26: `mine` (hurts, then gone), `turret` (shot every 2.5 s within 8 m), `booster` {dir}
  (supercharger: jump on it, held `P.boostWait`, fired at `P.boostSpeed`); monitor `kind` (rings, shield, gold, invincible,
  speed, oneup, fire); enemy `chase` (Scouter 58) and radius 0 (Hunter 0C stands still, turns to face the player;
  `orbit`/`orbitY`: spike ball circling at 23.5 units, one turn per 256 frames, `P.ballR`, hurts, cannot be broken;
  ROM sprite recipe 'SPK', Hunter recipe 00C without the ball). Player: `shield`, `inv`, `fast`
  timers; shields take a hit without losing rings; gold shield dashes on a second jump press in the air.
- Spin dash: hold dash to brake and rev (any speed), release to launch; a tap under 0.12 s while running rolls.
- Monitors in the ROM look: a 0.56 m box (`romMonitorBox`) in the sprite's commonest colour, the ROM icon
  (`S3D.monitorIcon`) on a dark screen on each side; geometry and materials shared (`userData.shared`, never disposed).
- Scattered (free) Flickies never step onto a ledge above or off a drop of more than 1 m.
- Green Grove gimmicks (`GIMMICKS` in s3d.js and convert.py, from the acts' routines): `cannon` {x, z cell, y mouth,
  h window, vy, vz}: a falling player in the cell's north quarter (+ P.r) within the window is held (`p.cannon`) until
  jump, then fired with no steering (`p.flyT`, `P.cannonFly`); during the flight W cells are open air. `crack` {cells,
  top, dir}: raised for the sim only (`L.up`, read by floorAt, gradientAt, tileTopNear) until a fast roll along dir
  breaks it; drawn as a 3 m rock column from `artBaker(...).rockSlot` (`crackMeshes`). Sounds 0x81 / 0x59.
- Rusty Ruin 1 (`GIMMICKS[7]`, from RunLevel 0x742C, labelled RRz2): map low byte 0xFF = spike blocks (tile 'H'),
  0x55 = fans (`fan` entity: grounded on one sets `p.whirl`: held 32 frames, `P.whirl*` steering, bounces off walls,
  breaks enemies and pillars, ended by a jump or a hit); pillars = `crack` with `by: 'whirl'` from the table at 0x7ACC
  (drawn as stone columns); doors = `hole` with `exitY`/`push`/`size`, `opens` 0 (table 0x7994); after rings 1 and 2
  the routine puts Sonic in a closed pocket (`goal.put`, also the respawn) and a ride (hole opened by that ring) takes
  him on: the pocket walks him out itself (`p.auto`, after `P.autoWait`), and the ride plays the original's scripted
  move (`rideScript`: RunSonic's interpreter 0x2EFC, scripts at 0x25DF2 per player state; hole `ride` {start, facing,
  vel, path, turns, end}; `p.ride`), checked to the unit against the emulator. Cuts fade from black (`fadeCut`); while
  a ride is under the ground the hero is hidden and the camera stays on the ground above. Crock (9C) is an enemy. Crack cells may carry their own height ([x, z, top]). Holes with `opens` 0 are open.
- Rusty Ruin 2 (`GIMMICKS[6]`, RunLevel 0x7CFC): pads both ways after each ring (rise 138); slides (low byte 0xC3 east,
  0xF0 south: `slide` entity, `P.slide*`); trampolines 08C (spring with `absY`, rise 94, drawn as slabs); sinking slabs
  098 (`lift`: raised cell in `L.up`, sinks 84 units 1 s after landing); pillar (85, 101) breaks into a pit (crack
  cell [x, z, top, after, quiet]; quiet linked cell (99, 96)) whose ride 0x2E runs under the floor to (98, 96); rides
  0x30/0x32/0x34; dash wall (101, 60). Private flow check: s3d/flow.py, comps.py, simat.js.
- Springs: `power` = launchFor(140 units); the sim subtracts one step of gravity on launch so the rise matches.
  ROM look draws springs as 3D drums coloured from the ROM sprite (`romSpringMats`).
- Act end: the `goal` event shows `#clearCard`, flashes, and after 5 s converts the next act in `S3D.LEVELS` order.
- Act results (ROM look): `S3D.tallyImage` draws the original's results screen (fonts RNC 0x15DEBA/0x15E3E6, palettes
  26/27/3) into `#tallyCanvas`; bonus rules are mine (`timeBonus`, 100 a ring, 100 a Flicky saved = `w.saved`).
- Saturn screen (`#screenSel`, `blastgrid.screen`): scene into a 224-line target, 15-bit colour, nearest filtering;
  `satPatch` adds affine texture mapping (vAffUv/vAffW) to meshes and checkerboard mesh transparency to all materials.
  Texture userData does not exist in r128: original filters live in the `satMin` WeakMap.
- Sound: with a ROM, `MdSound` runs `src/md_sound.wasm` (sound/md_sound.c: Z80 + Nuked-OPN2 + own PSG, NTSC master
  clock) in an AudioWorklet built from a string; JS uploads the driver (`S3D.SOUND.driver`) and writes request numbers
  to Z80 RAM 0x1C0A (one per 1/60 s, queue of 6). Music per level `S3D.SOUND.musicFor`; effects `S3D.SOUND.sfx`.
  AudioWorklet needs a secure page (https or file); otherwise, and without a ROM, `Sfx` synthesises blips. M mutes
  (`blastgrid.mute`); the help card pauses the audio context. Rebuild the wasm with `sh sound/build.sh`, then build.py.
- Scar: a compiled WebAssembly.Module posted to the AudioWorklet never arrived (no error); post the bytes instead.
  Requests sent before the worklet's async start were wiped by boot(): boot no longer clears the queue.
- 3D hero: `src/jam.js` (tag `#jam`) reads the player's Sonic Jam disc image (ISO 9660; only MUSEUM.MUS and
  SPRDATA.MUS kept, IndexedDB key 'jam'). Images: plain (.iso/.bin/.img/.mdf/.nrg: sector size 2048/2352/2448, data
  offset and lead-in found by scanning the first 1 MB for CD001 + the Saturn header), CHD v5 (Huffman map, codecs
  cdlz/cdzl/cdfl with own LZMA and FLAC decoders, deflate by DecompressionStream; not cdzs/zstd, not v3/v4, no
  parents), ECM (record list, then random access), zip (stored: random; deflate: one sweep per fetch). A source has
  read(o, n) or pass(ranges); sectors are fetched as spans. Private test images: scratchpad discs/ + disctest.js. `buildHero3d` makes a group per part
  (Lambert, vertex colours + texture atlas, DoubleSide) and the jump ball; `updateHero3d` picks idle/walk/run/sprint/
  spring/fall/skid (sim `p.skid`: grounded, fast, stick against travel) at 30 frames a second (assumed) scaled by speed; angles z,y,x → Euler 'ZYX'; model faces -x so
  rotation.y = facing + pi/2. Model select `#heroSel` ('3d' default when a disc is loaded; `blastgrid.hero`).
  Skid table 0x290A6 (SCHG's 0x290AC is 6 bytes off); the skid clip plays through once (`h.skidT`).
- Jam objects (`Jam.props`, `buildJamProps`, `jamOn()` = disc loaded and Models = 3D; ROM look only): Green Grove palms
  where `artBaker(...).palms` finds them (pattern match on the picture; pieces use `bare` with the palm cut out),
  trunk quad turned to the camera, hidden between chase camera and player; springs (coil squashed to `SPRING_REST`,
  stretched when fired), big ring (1.6 m, centred at the sprite's anchor, spins; shrinks when used), Flickies (one
  model per colour per slot, flying animation, `FLICKY_YAW`). Texture definition = quad's number - 1 (all models; Sonic
  was wrong before 2026-10-26 evening). 16-bit parts: flat normals, shadow lifted out of the floor. Jam meshes carry `userData.jam` and are shared: never disposed with a level.
  `jamOn`/`heroMode`/`hero3d` are declared near the top of game.js: level building reads them during start-up.
  Addresses are the USA disc's; the European MUSEUM.MUS is the same 96 bytes later (`shiftOf`), SPRDATA.MUS identical.
- Scar: `sun` is already the scene's light at the top of game.js; the scene's hemisphere and sun light the hero.
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
- 2026-10-27 early: RR2 gimmicks; pads with the original sequence (GG too); 78 sim tests. Open: RR maces, flamethrowers,
  0AC crawler (hurts), RR3 boss.
- 2026-10-26 late: Jam discs as CHD, ECM, zip, .img, .mdf, .nrg (all checked byte for byte against the files).
- 2026-10-26 evening: Rusty Ruin 1 gimmicks (above); 75 sim tests. Open in RR: maces (084/088 orbit, helper 0x86B0),
  flamethrowers (helper 0x84F2, sound 0x7F), green dome buttons (0xAA cells, cosmetic), RR2 rides (states 2E-34),
  conveyor cells (0xC3/0xF0), RR2 pillars and wall, RR3 boss.
- 2026-10-26: ROM results screen, Saturn screen option, ROM music and effects by emulation (GG1 music checked against
  the reference emulator: same notes at the same tempo, top-note agreement 0.53 vs 0.14 chance). 3D Sonic from Bill's Sonic Jam USA disc (formats from Sonic Retro SCHG),
  with skid, and Jam palms (GG 16/36/4), springs, big ring and Flickies; European disc; monitor boxes. 66 sim tests.
  Hunter spike ball measured and in. Animated water/lava, single flowers, rock on hidden cliffs, GG cannons and cracked
  walls (GG1 cannon lands where the original does; GG2 about 2 m further). 70 sim tests. Open: Knuckles/Tails and the
  bonus stage, Flicky body is a flat quad (edge-on from the side), other zones' gimmicks.
- 2026-10-26: Springs measured (140 units), monitors with ROM icons and effects, mines, turrets, superchargers, Scouters
  chase, Hunters stand, Flickies coloured in turn, act end moves to the next act, sound effects, spin dash on hold. 64 sim tests.
- 2026-10-26: Published on GitHub (s3lfish/3D-Sonic-3D-Blast-3D), Pages at https://s3lfish.github.io/3D-Sonic-3D-Blast-3D/.
  All 22 levels convert; level art, foliage, zone skies, ROM sprites, measured physics, zip/SMD ROMs, controller.
  Green Grove sections, rings, holes and Flickies work (GG1 playable to the end). 54 sim tests, pad test, render test.
  Gaps then: other zones' section gimmicks, bosses; palms on cliff edges stay painted;
  stretched texture on steep slopes facing away from the original camera; GG2 foliage bake about 1.25 s.
