# 3D Sonic 3D Blast 3D³ 

This is the game that would've saved the Saturn.

A true 3D take on an isometric Mega Drive platformer, playable in your browser. It reads the level layouts, level
art and sprites from **your own copy** of the Mega Drive *Sonic 3D Blast* ROM, and falls back to crude original
scribbled art and a built-in level when you have no ROM. Shamlessly vibe coded with Claude because I have absolutely no skills to do any of this.  

## ▶ [Play it in your browser](https://s3lfish.github.io/3D-Sonic-3D-Blast-3D/)

No install. Works with keyboard, mouse, touch or a controller.

## Using your ROM

1. Open the game and choose **Choose ROM file** at the top of the start card. A plain ROM (`.bin`, `.md`), an `.smd` dump, or
   either one inside a `.zip` all work.
2. Pick a level, choose **True shape** to experience the true majesty of THREE DIMENSIONS or **Half height** so that it's actually playable, and press **Play this level**.

The page reads the ROM with JavaScript in your browser and keeps a copy in the browser's own storage (IndexedDB) so the sprites load next time; **Forget ROM** removes it. This repository contains
no ROM data, no extracted levels and no pictures made from the ROM: only the rules for reading it.

Known good ROM: SHA-1 `89957568386a5023d198ac2251ded9dfb2ab65e7` (the 4 MB Mega Drive release). Other releases are
untested.

## Controls

| Input | Action |
| --- | --- |
| WASD / arrows | Move |
| Space or J | Jump (hold for height) |
| Shift or K | Hold while still to charge a spin dash, release to launch; tap while running to roll |
| Mouse drag | Look around |
| Q / E | Swing the camera |
| Mouse wheel | Camera distance |
| V | Switch between the chase camera and the isometric view |
| R | Restart |
| Controller | Left stick moves, right stick looks, A jump, B or X dash, LB/RB swing, Y or Back switches view, right stick click recentres, Start pauses |

## What works

- All 22 levels' terrain, start points, rings, springs, monitors, big rings and most enemies.
- The original level art unprojected onto the 3D faces, with its water, waterfalls and lava animated as in the original;
  foliage as standing sprites (each flower on its own patch of ground), plain rock on cliffs the original never shows, zone skies.
- Movement measured in the original (jump height, spring height, gravity, step height; edges are walls).
- Green Grove sections: Flickies freed from enemies open each big ring; holes carry you to the next section;
  cracked walls break when you spin dash into them, and the cannons fire you across the level as in the original.
  Reaching the last ring ends the act and moves on to the next one.
- Rusty Ruin 1 and 2: fans that set you whirling (it breaks pillars and enemies), spike blocks, doors, slides,
  trampolines, sinking slabs, teleport pads, maces, flamethrowers, and the original's own scripted rides through
  tunnels and arches.
- Spring Stadium: superchargers into loops and dash runs, floor springs, bumpers and triangle bumpers, spike fields
  that rise when you stand still, spears, twisted tunnels, balloons to bounce on, and the boss with its spring fists.
- Diamond Dust 1 and 2: slippery ice, ice spikes you break with a spin dash, the ice chute, sled runs, currents that
  carry you towards spikes, snowdrift springs, bumpers, dash runs, low roofs, and snowblowers that freeze you.
- Volcano Valley 1 and 2: lava that burns unless you carry the fire shield, lava spouts and running fireballs, rocks
  to bounce off, vents that throw you out of another, jet lifts, moving platforms, swinging spiked balls, walls of fire,
  cracked walls, and its scorpions and dragons.
- Gene Gadget 1: floors that float you over them, floors that spark under your feet, pyramid bumpers, electric
  barriers that switch off at the big ring, sprinklers, the supercharger run round the arch, and glass tubes between
  the platforms (the last one takes you to the end only with five Flickies).
- Gene Gadget 2: the long chute that rolls you down into a leap, moving platforms over the conveyor slopes, doors
  that open for the tube you came out of, spikes, and the supercharger run that jumps you up a level.
- Panic Puppet 1: levers that turn the belts round, belts that carry you (one throws you down a hidden run to a door
  that opens only for it, one runs through a tunnel to the act's ring), Flicky capsules to jump on, the robots that
  patrol and shoot all four ways, tubes inside the walls, a door the tube opens, and a cracked wall to spin dash through.
- Panic Puppet 2: belts that throw you down to the floor below, doors that slam shut behind you, posts that fire
  bursts across the corridors, wandering robots, lifts that rise while you stand on them, and the lift at the end.
- On levels from your ROM, Sonic moves by the original's own rules: how fast he speeds up, stops, turns, slides on
  ice, rolls (bouncing off walls and turning on corner pieces), and how hard each spin dash launches him.
- Monitors show their icon and give rings, a shield, a gold shield, invincibility, speed shoes or a 1-up.
- The Green Grove, Rusty Ruin, Spring Stadium, Diamond Dust, Volcano Valley, Gene Gadget and Panic Puppet bosses, moving as the original's routines move them: in Rusty Ruin, ride a stone
  fist up after it slams and jump at the pod; in Diamond Dust, keep clear of the snow its blowers puff (it freezes
  you) and of its snowmen, and jump on it while it is low; in Volcano Valley, land on the pod in the crater and
  outrun the fire serpent; in Gene Gadget, keep off the end of the belt, dodge its loads and the bombs, and jump on the
  pod when it comes down; in Panic Puppet, three arenas of arms that punch, sway, set a serpent on you and spray
  shots: jump at an arm's shoulder while it rests, then ride the lift to the next arena.
- The Final Fight: Robotnik's machine fights you in four rooms and a corridor, twice round, ten hits: lasers along
  your row, a fire serpent, two spiked fists that slam and then slide apart, bombs that fall on where you stand, and
  a pod whose cannon sprays bouncing balls. Each time it comes close, jump on it. Doors shut you in; once it is hit,
  you have ten seconds to reach the next room. (The machine is our own model: the original draws it from tiles the
  game unpacks as it plays.)
- Mines, Turrets, chasing enemies, Hunters with their circling spike balls, and superchargers (stand on one and press jump).
- Tails and Knuckles (or, in the scribbled look, two pals of our own): give one fifty rings in an act and you go to
  the special stage, run by the original's own rules from your ROM and drawn in 3D: a stone path over lava or a
  steel grating over a river, rings to collect, spiked balls to dodge and steps to jump, gates that want 50, 100 and
  150 rings, and a Chaos Emerald at the end. With all seven, the Final Fight follows Panic Puppet 3.
- Three lives, 1-ups from monitors; a death puts the act back as it was (rings, enemies, monitors) and you start
  again at the last big ring, as in the original. Ten Sonic heads (often high over a spring) make a continue; with
  no continue left it is game over.
- The original's act results screen, with its own bonuses, then the next act.
- With your own Sonic Jam (Saturn) disc image (.chd, .iso, .bin, .img, .mdf, .nrg, .ecm, or zipped): a 3D Sonic using the Saturn game's own model, textures and moves
  (including his skid), and Sonic World's palm trees, springs, big ring and Flickies in place of the flat sprites.
- A Saturn screen option: low resolution, wobbly textures, and checkerboard see-through effects.
- With your ROM: the original music and sound effects, played by an emulated Mega Drive sound chip running the
  game's own sound program from your ROM. Without a ROM: simple sound effects made in the browser. M turns sound off.

Not done yet: see `re/NOTES.md` for what is known and what is not.

## Working on it

The page is one self-contained file, `index.html`, built from `src/`:

- `src/s3d.js`: reads the ROM (decompression, level maps, level art bake, sprites). Rules only, never ROM bytes.
- `src/game.js`: rendering, camera, input, HUD (Three.js r128 from a CDN).
- `src/art.js`: the scribbled fallback art, drawn in code.
- `sound/md_sound.c`: the Mega Drive's sound hardware (Z80, YM2612, SN76489) for WebAssembly, built with
  `sh sound/build.sh` (needs clang with the wasm32 target) into `src/md_sound.wasm`, which `tools/build.py` embeds.
  Third-party parts and their licences are listed in `third_party/README.md`.
- The simulation lives in the `#sim` script inside `index.html` and is edited there.

```sh
python3 tools/build.py          # rebuild index.html from src/
npm install                     # playwright, sharp, three@0.128.0 for the browser tests
npm test                        # simulation tests (Node only)
npm run test:render             # headless render check, screenshots in test-out/
npm run test:pad                # fake controller test
```

To try changes, serve the folder (for example `python3 -m http.server`) and open `http://localhost:8000/`.

`CLAUDE.md` is a terse project map kept for coding agents; it doubles as a list of conventions and past mistakes.

## Reverse-engineering notes and tools

`re/` holds the notes (`re/NOTES.md`) and the Python reference tools used to work out the formats: RNC unpackers,
the reference level converter and art bake that the browser code is checked against byte for byte, sprite
decoders, and emulator probes used to measure movement. Put your own ROM at `re/rom/s3d.bin` (ignored by git) and
run the tools from inside `re/`. Their outputs stay on your machine; please keep it that way.

## Contributing

Pull requests welcome. Two hard rules:

1. Never commit ROM bytes, extracted maps, ROM-derived binaries, emulator states, or screenshots and renders of the
   original art. `re/leakcheck.py` checks the page; run it before you push.
2. Keep the fallback hero clearly original. No look-alikes of existing characters.

## Credits

The Sonic Jam model, animation and texture formats come from the Sonic Community Hacking Guide on Sonic Retro
(SCHG: Sonic Jam). Sega's data is never included: the page reads it from the player's own disc image.

## Licence and disclaimer

GPL-3.0 (see `LICENSE`). Copyright 2026 Bill Page and contributors. The sound emulation includes a Z80 core
(zlib licence) and Nuked-OPN2 (LGPL-2.1); see `third_party/README.md`.

This is an unofficial fan project, not affiliated with or endorsed by Sega or Sonic Team. Sonic the Hedgehog and
Sonic 3D Blast are trademarks of Sega. You need your own legally obtained copy of the game to use the ROM features.
