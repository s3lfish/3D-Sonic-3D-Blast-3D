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
  Converted levels launch at the original's steps (P.orig.dash).
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
- Bosses (`BOSSES` in s3d.js/convert.py, `boss` entity {kind, x, y, z, home, cruise, arena, hp, vs}, `w.boss`,
  `bossStep`, `initBoss` on every respawn: a lost life restarts the fight). GG3 (`gg`, RunLevel_GGz3 0xDDE4): pod
  descends to 160, then loops follow (2/frame, 10 frames, until within 96) / drop the ball (falls, hops 5 times at
  the player in 8 directions, 2 out 2 up, gravity 0.125) / home (1/frame) / sink to ball + 40, wait 60 (takes it
  back at 30) / rise. Hit = within 32 units and at pod y + 8 or above; 5 hits, 60 frames apart; beaten: rises 4 s,
  then `goal`. ROM look: object art by type (`S3D.typeArt`: 0x280E8 + type): 48 pod (frames 0-7, 9-11 cracked),
  50 ball, 4C claw (unused), level palette line 3 (`romBossMat`); otherwise a drone of our own design.
  RR3 (`rr`, RunLevel_RRz3 0x6DE8, `rrStep`): pod 330 to 160 (every other frame), cap 350 to 170; script of [action,
  frames] read from 0x7170 (`script`, `loop`); arms [reach, lift] from `root`, joints by `Sim.rrArm` (routine 0x727C:
  two links of 64); links hurt, a slam on the player hurts, the fist's top is a floor (`w.plats`, `platFloor`, box
  x -4..+20, z -2..+36 units) that carries him; any pod touch is a hit (knock-back locks the pad 30 frames, `p.lock`).
  Drawn as a stone statue of our own (`buildRrStatue`; ROM pod sprite). Start faces the boss in boss arenas; the
  chase cam swings behind the player away from a boss and tilts up to it. Notes in re/NOTES.md "Bosses".
- Spring Stadium (`GIMMICKS[15]`/`[16]`, RunLevel_SSz1 0x95DA, _SSz2 0x8EC2; helpers 0x9974 bumpers + floor springs,
  0x9D44 spike fields, 0x9B40 tubes): cell marks by low byte (geometry stays the map's): `springCells` (0x55, 124
  units up), `bumpers` (0xFF + table cells: entering one near its floor pushes 5 units a frame across the nearest
  edge, pad taken 20 frames, `p.bumpCell`), `spikeField` (0xAA, act 1: one count `w.spike` +1 every 4 frames while
  stood on, -1 off; at 5 it hurts; drawn as an InstancedMesh of cones). Rides at cells take `force` [frames, dir]
  (`p.force`: pad held, counted from the move's start, `force.top` keeps the speed); states with bit 15 are mirrored
  (x, z) -> (-z, -x), facing (0x200 - f) & 0x7FF (checked with DD1's 0x8004);
  `hold` cells extend a held pad; tubes = holes with `half` [hx, hz] and ride `wait`. `balloon` (150): bobs 8 units,
  pops (43 units up), back after 70 frames; ROM art type 0x150 palette line 2 (`romBossMat(..., line)`).
  Superchargers (routine 0xCA6A, all zones): way from word +0x26 and bit 3 of byte +0x16 (N/W/S/E), taken standing
  one cell that way (`boostSpot` 12 units, no button), held 70 frames, dash at 7.4 units a frame, pad let go 30 frames.
  Holes are half-open squares (a 0.5 hole is exactly its cell). Rides ending at the floor land on it.
  SS2 extras: `triBumpers` (the routines' 64-unit boxes: bounce off the long side, or along the band near the tip),
  `spears` (cells at 0x9494: east quarter; waits 34 frames, rises 28, hurts under its tip; `w.spear`), `spikeWall`
  (west faces of cells, under `top`). SS3 boss `ss` (`ssStep`): descends 400 frames, then hover 400 (arms swing
  0x10) / low 400 (0x40, arms in), heading for Sonic by octant (table 0xDBEE), speed (6 - left/2)/2, arena bounds
  and two corners; spring fists hang and swing 32 units, stop at the floor, hurt; generic boss check 0xF794 (from 8
  over and spinning: hit, else hurt); 8 hits. Arms drawn as our own chain and red fists (`buildSsArms`).
- Diamond Dust 1 (`GIMMICKS[9]`, RunLevel_DDz1 0x1009E): pads 0CC (pairs from tables 0x108C4..); `chute` {box, dir,
  accel, steer} (grounded: slid along, pad let go, steered to x, until a ride); `dash` {x, z, maxY, v, t, jumpAt,
  jumpV} (a cell that sets a forced run and a jump on cue, `p.force.jumpAt`); `sled` {box, at, dir, accel, t} (pulled
  to `at`, then carried); `current` {box, dir, accel, top, leave} (pushed along up to `top`, `leave` on jumping off);
  `hops` (snowdrift springs as `springCells`); ride `force` [frames, dir, roll]; snowblowers are flames with `freeze`
  (`p.frozen` = hops left: the original's routine 0x3050, 4 counts, a 2-unit hop at each landing, ice table, no input,
  50 frames safe after; no rings lost; game.js draws an ice block `iceBlock`). On the original's levels (`L.rom`) an airborne player
  within stepUp of a ledge top is lifted onto it (measured in DD1). The game starts Sonic at the start table (header
  +0x20), not the 030 object (both converters).
- Diamond Dust 2 (`GIMMICKS[10]`, RunLevel_DDz2 0xFA06) and both acts' helpers 0x10E78 (ice lists), 0x10EA6 (ice
  spikes), 0x10CC4 (roofs, 0xFF spikes, 0x55 bumpers): `ice` {on, off} cells toggle `w.ice` (the original's $0ACA:
  P.orig.ice table; pads into the icy part count as on/off cells); `iceSpikes` {cells} (object 0E8, ROM art palette
  line 0; map lowered 3 steps + 0xFF at start, so at floor height; a grounded roll breaks one, `iceBreak`, else hurt);
  `lowRoof` {cells, top} (no rising above top in them; walls via `L.up` while airborne outside, `w.roofUp`); 0xFF map
  cells = 'H' spikes; 0x55 = `bumpers`. DD2: ride 0x803E at (78, 95), dash (50, 45), current east into spikes.
- DD3 boss `dd` (`ddStep`, InitLevel 0xF1CA, RunLevel_DDz3 0xF280): heights in the feet frame (+8 units); script
  0xF2FA [0 chase / 1 wait / 2 drop, frames], [-1, entry] loops, hit entry 10; at 400 frames left of a chase it goes
  low (184), at 100 high (264); octagon `oct`; blowers (one per hit left, `blowA` += 0xC) puff snow (object 0FC: 8
  past the blower, out 2 a frame along its turning angle, 24 frames) for 120 of 180 frames while low: freezes; snowmen
  (0E0: fall 4 a frame from `dropY`, wake within 48 units, 40 frames later 8 snowballs and break; attack breaks them).
  Drawn with ROM art (blowers 0F8 line 3, 17 frames + mirror by angle against the camera; 0E0, 0FC line 0) or our own.
  Checked against the emulator (dd3watch.py, ddprobe.js): pod track and timings match until the player moves.
- Volcano Valley 1 (`GIMMICKS[13]`, RunLevel 0xA620 labelled VVz2 — VV2 is 0xAE20 labelled VVz1, VV3 0x9EBA): pads 110;
  `lava` (low byte 0x55, helper 0xB5C8: grounded, hurts unless `p.shield === 'fire'`; the red monitor now gives the
  fire shield, drawn orange); `rocks` [x, z, top] (0xBBC0: raised 16 units via `L.up`; landing in a ball breaks one,
  bounce 4.5 units a frame, `rockBreak`); `vent` {x, z, to, vel} (0xB764: stood on at 2 units a frame or less: drawn in
  30 frames, sinks, out of the partner and thrown (-2, 8.5, -2); `p.vent`); `jetLift` (object 12C: box from the record
  32 x 48 units, rises a unit a frame from +0x24 to +0x26 while stood on; `w.jets`, read by `platFloor`); `fireSpot`
  (120: burns unless fire shield); cracked walls (11C) at (59, 55), (65, 63); enemies 104/108 (108 and 100 `patrol`
  {axis, range} from +0x24/+0x26). Recipe-less enemies draw their own frames (`romTypeFrames`, line 3, mirrored by
  scale). `spout` (0xB9C2: fireball every 8 frames while ((frame + phase) & 255) <= window, thrown at `v` with
  gravity) and `fireRun` (0xB900: in its box, fireballs at slot frames 69/79, 70/80, 139/149, 140/150 of a 151 count,
  1.5 units a frame for 42 frames; measured) share `w.fireballs`; the fire shield spares. VV2 (`GIMMICKS[12]`, 0xAE20):
  the same helpers, `movePlat` (128: box swinging 63 units along x/z about +0x28, +4 a frame of 0x800 from +0x26) and
  `spikeBall` (118: swung by the routine about z 0xE80, 56 units, alternate records opposite). Not yet: 0xBA68 fire
  wheels, the sinking 128 kind, VV2's 0x63AC vent exception and $7A flag.
- Gene Gadget 1 (`GIMMICKS[4]`, RunLevel_GnGdz1 0x11D2A, InitLevel 0x11C78; GnG labels are not swapped): `updraft`
  (0x55: grounded, `p.hover`: 0.125 a frame per frame up under floor + 48, down over it, the climb halved crossing it,
  ball table steers, pose spring); `zapCells` (0xAA, object 068: armed on stepping on, sparks at 22 frames for 12,
  four at a time, blue shield spared); `pyramids` (0x11EE4: 64-unit boxes, surface rises one a unit from each edge by
  the diagonals, thrown 5.5 out and up by the speed in, `pyramid`); `gate` {cells, top, opens, pass} (InitLevel's
  raised cells via `L.up`; pass = open while `p.force.pass`: the supercharger's and ride 0x18's run); `barrier` (the
  zap half of cells 0x7676/78, 0x5EEC/0x5FEC until rings 1/2); speed pads as `dash`; roofs 0x12254; tubes `tubes2`
  (0x120F8: [cell, x, z, state, effect x, y], grounded; start y null keeps the height; entry 0 `alt` at its 4th
  segment to state 0x1A with the Flickies, else `tubeNo`); `sprinkler` (07C: within 80 units, a shot every 16 frames
  along its angle, 0x10 a frame; shots in `w.shots` with `g`); `pylon` (06C, drawn, gone with its barrier); 05C patrols.
  Drawn: 07C 17 frames + mirror by angle, 06C five frames, 068 lit/sparks, glass tubes along tube paths.
- Converted levels, all zones (watched in GnG1 and GG1): a roll bounces off walls (`rollBounce`, facing turned); corner
  pieces (one corner two steps over three level ones, both neighbours by it without floor; `L.diag`, findDiagonals) are
  diagonal walls (that half solid, rest flat), met as a point (`P.rDiag`); walls keep `P.rOrig` 0.12 m; slope pull
  `P.slopeOrig` (0.045 units a frame per frame per gradient, measured rolling).
- VV3 boss `vv` (`vvStep`, 0x9EBA): pod down to `low` (feet frame) in the crater; a falling ball inside `hitBox` is a hit
  (bounce 5, pad 30, 60 frames apart), grounded there hurts; `spikes` cells round the mouth hurt; every 510 frames a fire
  serpent rises at frame 270 at `rise` and chases 240 frames (octant heading, random turn 16..79, 2 units a frame, height
  toward Sonic + 16, not under `minY`), nine segments along its path (`b.segs`); drawn with object 138's frames (line 3).
  `GIMMICKS[14]` lava. Not modelled: the vents' fire ball hopping (0xA0A8) and its fight with the serpent.
- Original movement (`physics.orig` = 1 on converted levels, `P.orig`, routine 0x3330): velocity split along
  `p.facing` (which is the heading there, turned 0x40/0x800 a frame toward the stick); tables [A, F, G] walk, ball,
  ice, roll; top 5 units a frame; spin dash steps by held frames 14/29/44/59. Measured in GG2 (speedprobe.py): sim
  within 1% of the emulator over a 60-frame run. A cannon's flight skips it. `runRef()` in game.js scales animation
  and camera thresholds.
- Object handlers: the table at 0x1BF42 + type (bra.w per type); `re/NOTES.md` lists the ones read.
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
- Sim tuning lives in `Sim.P`; a level's `physics` overrides gravity, jumpV, jumpCut, maxFall, stepUp, snapDown, orig (`L.phys`).
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
- 2026-10-27: Gene Gadget 1 (hover cells, zap floors, pyramid bumpers, barriers and gates, sprinklers, tubes with the
  Flicky way, the supercharger run round the arch); rolls bounce off walls and corner pieces are diagonal walls in every
  converted level; 105 sim tests. flow.py: GnG1 can be finished. Next: GnG2 (0x115E2), GnG3 boss (0x11126).
- 2026-10-27: Volcano Valley 1 and 2 (lava, rocks, vents, jet lifts, fire, spouts, fire runs, moving platforms, spiked
  balls, pads, cracked walls, patrols) and the VV3 boss; 98 sim tests. Next: Gene Gadget.
- 2026-10-27: DD3 boss; freezing as the original's hops; 93 sim tests.
- 2026-10-27: the original's movement tables on converted levels (run up, stop, turn, ice, jump ball, roll, spin dash
  steps, all measured); Diamond Dust 2 gimmicks; ice, ice spikes, low roofs, spikes and bumpers in both DD acts;
  92 sim tests. flow.py: DD2 can be finished. Open: DD2 gate cells (raised until the supercharger fires), DD3 boss.
- 2026-10-27: Diamond Dust 1: chute, dash, sled, currents, snowdrift springs, snowblowers that freeze, CC pads, rides
  mirrored correctly, start from the start table, airborne step-up; 87 sim tests. flow.py says DD1 can be finished.
  Open in DD1: warp holes (57,50)<->(59,72), the 0x4C4C wall, gates. Next: DD2 (RunLevel_DDz2 0xFA06), DD3 boss.
- 2026-10-27: Spring Stadium 1 and 2: superchargers fixed (way and spot from the routine), loops and held runs,
  floor springs, bumpers, spike fields, tubes, balloons, triangle bumpers, spears, spiked wall; SS enemies 05C/14C;
  SS3 boss; 86 sim tests; private flow.py says SS1 and SS2 can be finished. Open in SS: gates (038, raised cells),
  13C/140, Tails and Knuckles.
- 2026-10-27: RR3 boss (statue arms, slams, fist rides; checked in the emulator and the page); spiked crawler 0AC
  (`crawler` {y, axis, range}: 1 unit a frame, hurts, ROM look draws type art 0xAC frames 0-7); 82 sim tests.
- 2026-10-27 early: RR2 gimmicks; pads with the original sequence (GG too); maces (`mace`: tables 0x75C2/0x80B8, ball 64
  units out, 2048 a turn) and flamethrowers (`flame`: tables 0x7548/0x7EC4, box 128x64 units, a fireball every 6
  frames, `w.puffs`); GG3 boss; 80 sim tests. Open: 0AC crawler (patrols 1 unit a frame, hurts), other bosses.
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
