# Sonic 3D Blast (Mega Drive): reverse-engineering notes

What Blast Grid knows about the ROM format, and how it was found. Addresses are ROM offsets unless they start with
`$`/`0xFFFF` (68k RAM). Verified means checked against the running game in an emulator or byte for byte between
two independent decoders; inferred means it fits the data but was not watched.

**Ground rule:** never publish ROM bytes, extracted maps, ROM-derived binaries, emulator states, or renders of the
original art. The browser code carries reading rules only.

## Setup

- Put your ROM at `re/rom/s3d.bin` (ignored by git) and run every tool from inside `re/`.
  Tested ROM: 4 MB, SHA-1 `89957568386a5023d198ac2251ded9dfb2ab65e7`, header checksum A934.
- Python 3 with Pillow; `capstone` for `tools_dis.py`; `stable-retro` (genesis_plus_gx core) for the emulator probes.
- `tools_dis.py ADDR N` reads labels from `ref/database.idc`, the label database of the Sonic Retro community
  disassembly (s3ddisasm). Fetch only that text file yourself; it is not included here.
- Emulator probes: `python3 mkstart.py NN` writes `rom/startNN.md` (new game starts in level NN), then
  `python3 mkstate.py NN` boots it and saves `emu/lvNN.state`. One emulator per process.

## Tools

| File | What it does |
| --- | --- |
| `rnc.py`, `rnc2.py` | RNC method 1 unpacker (CRC checked); RNC method 2 as the game's routine at 0xC7C does it |
| `convert.py` | Reference converter: level terrain and objects to Blast Grid level JSON |
| `parity.js [vscale]` | Browser converter (`src/s3d.js`) against `convert.py`: all 22 levels identical |
| `levelart.py` | Rebuilds a level's whole isometric picture (both layers, priorities) |
| `bake.py`, `art_parity.js` | Reference level-art bake; the browser bake matches it byte for byte (levels 1 and 9) |
| `sprites.py`, `sprite_parity.js` | Player frame decoder; browser decoder matches on 307 frames |
| `recipe.py`, `recipe_render.py` | Photograph an object in the emulator, find its sprite tiles raw in the ROM |
| `artscan.py`, `artsheet.py` | Find every object-art block (79) and draw a contact sheet |
| `anim_recipe.py` | Find animated static tiles (water, lava) written at run time |
| `artcheck.py`, `artcompare.py`, `occl.py`, `gaps.py` | Alignment, emulator comparison, face visibility, section gaps |
| `edgeprobe.py`, `edgejump.py`, `stepprobe2.py`, `springprobe.py`, `holeprobe.py`, `flickyprobe2.py` | Emulator measurements |
| `huntram.py N FRAMES` | Sonic beside GG1 Hunter N: its RAM record and nearby sprites per frame (spike ball orbit) |
| `objwatch.py LEVEL TYPE N` | Put Sonic beside (or with `DROP=` on) one object, optionally press jump (`JUMP=`), log and photograph |
| `monicons.py LEVEL` | Photograph every monitor and list its sprite pieces with their raw ROM addresses |
| `emu_run.py`, `vdp.py`, `mkstart.py`, `mkstate.py`, `bootto.py`, `typesheet.py` | Emulator helpers |
| `leakcheck.py [page]` | Checks a page for ROM bytes (hex, base64, number lists); default `../index.html` |
| `out/anim.json`, `out/recipes.json`, `out/artblocks.txt`, `out/hero_anim.json` | Addresses and indexes only, no pixels |

## Level format (verified)

- Level headers: 22 records of 0x2A bytes at 0x1AB62 (level id 1..22). LoadLevel at 0x1A262; decompressor at 0xA58
  is RNC method 1.
  - +0x00 objects (RNC to RAM $CCD2)
  - +0x04 terrain map (RNC to RAM $3EC6, 128 x 128 big-endian words)
  - +0x08 static tiles (RNC to VRAM 0); +0x0C streamed tile graphics (raw)
  - +0x10 static blocks; +0x14 streamed blocks; +0x18 picture rows (see Level art)
  - +0x1C extra load list (type 1: RNC source, RAM destination, VRAM destination, words; type 2: RAM only)
  - +0x20 start table (see Sections); +0x26..0x29 palette indexes into 0x25082 (32 bytes each)
- Map word: high byte = floor height, 8 world units per step; low byte = corner raises NW, NE, SE, SW, 2 bits each,
  8 units per step. 0 = no floor. A cell is 32 units (collision masks $FFE0).
- The world is isotropic (same units in x, y, z).
- Objects block: 52-byte records until the code address at +0x30 is 0x400000 or more; +0x22 type, +0x30 handler,
  +6 x, +0xA y, +0xE z. Then tables; the ring list is 10-byte records from block offset 0x1936 (RAM $E608) to the
  block end, after one empty record: word 0 sort key (bit 15 flag) = (x+z)/2, word 2 = screen y of the base,
  word 4 = map offset of the cell. Height above the cell floor = (word0 & 0x7FFF) - |word2| - floor.
- Object types seen in the emulator: 30 start, 18/158 spring, 3C monitor, 40 big ring, 34 Flicky, 15C Tails,
  160 Knuckles, 38 checkpoint posts (probably), enemies 0C (GG), 94 (RR), 144/148 (SS), C4/C8 (DD), 100/10C (VV),
  60/64/58 (GnG, 58 also PP). 84 = spiked mace hazard (RR, not converted). Others unknown.
- Play order table: words at 0xA2C (entry 1..22): 1, 2, 3, 7, 6, 8, 15, 16, 17, 9, 10, 11, 13, 12, 14, 4, 5, 18, 20,
  19, 21, 22.
- Iso projection: screen x = x - z + 4096 - cam($084E); screen y = (x+z)/2 - y - cam($0850). Player slot $C1E6.
- RAM: ring count $0A5A (BCD HUD $0A56/57), level id $0678. The emulator's RAM is word byte-swapped (use `mem()`).

## Sprites (verified)

- Player frames: long table at 0x100000 (cmdBytes/2 << 24 | offset). Frame F: word n-1, then n pieces of 6 bytes
  [x, x flipped, y word, size << 8 | tile]; offsets are cumulative piece to piece. F-2 = tile words, F-4 = offset to
  a command stream: 0 end; 2..0x50 repeat one long; 0x54..0x7C zero longs; 0x80..0xFE literal longs (jump table
  0x1862). 307 of 308 frames decode. Palette 3 (0x25082 + 2 * 32).
- Hero frames: idle 0..4 = views down, down-left, left, up-left, up; walk = base..+11 and run = base+12..+23 with
  bases 5/29/53/77; up view 101..112 for both; ball 113; spin 126..129; charge 192..197; bored 235..241. Right-hand
  views are mirrors. Ball and charge frames face left as stored.
- Rings: 16 frames raw at 0x14401E + k * 0x80 (2 x 2 tiles), palette 3. Shadow tiles raw at 0x14485E.
- Tiles in a sprite piece are column-major. A piece's palette line maps to level header bytes +0x26..+0x29.
- Object art: per-type long pointers at 0x280E8 + type (Green Grove at least). Block = 16-byte header, long offsets
  from +0x10, frames like the player's but with raw tiles. 14 → 0x32950 Flicky (16 frames), 18 → 0x33B0E spring,
  3C → 0x3C99C monitor (with icon), 40 → 0x3D068 big ring (9 frames, shrinking), 44 → 0x3E5C8 1-up head.
  Also Tails 0x8EFF4, Knuckles 0x93AA2.

## Level art (verified)

- +0x18: word offsets to 128 rows; each row is RNC method 2 without the 'RNC' header (packed length 4, unpacked CRC
  2, packed CRC 2, leeway, chunks) and unpacks to 0x300 bytes.
- A row is 32 px tall and 256 columns of 3 bytes: A = b0 << 4 | b2 >> 4, B = b1 << 4 | b2 & 15. A >> 1 = block in
  +0x14 (A & 1 toggles priority); B >> 1 = block in +0x10 (B & 1 mirrors block A).
- Blocks: 4 x 4 tile words, row-major, 32 bytes. Streamed words: index = low 11 bits + 0x800 if bit 0x4000 is set,
  tiles raw at +0x0C, palette line = bit 13 only. Static words are plain VRAM tile words over the loader's VRAM
  (+0x08, then the +0x1C list).
- Picture pixel (X, Y) = camera ($084E, $0850) + screen pixel, with X = x - z + 4096 and Y = (x+z)/2 - y.
- Animated static tiles (water, lava) are written at run time; `anim_recipe.py` records the first tile, count and
  ROM address of the frame seen. Level 22 only partly found. `animwatch.py LEVEL FRAMES` watches them: every frame of
  each run is raw in the ROM. Green Grove: 12, 6 and 12 frames 0x200 apart, 4 video frames each; Rusty Ruin: 8 frames
  stepping back 0x200, 1 video frame each; Diamond Dust 2: 12 frames, 2 each; Volcano Valley: 12 frames of 40 tiles,
  3 each; Panic Puppet: 8 frames of 2 tiles, 1 each; Final Fight: four runs, one frame held 24. Other levels' runs
  did not change in 300 frames.
- Priority: high-priority tiles are foreground (drawn over Sonic): palms, flowers, grass along front edges, some
  floor at raised edges. Under palms the low layer still has ground; under edge grass it has nothing.
- Bake (Blast Grid's method, not the game's): one 32 x 32 slot per cell top and per 32-unit band of wall. A point
  is visible if a ray toward (1, 1, 1) clears the heightfield. Tops are 99% visible; east and south walls often
  partly hidden; north and west walls are never seen. Hidden faces borrow the nearest visible slot.

## Movement (measured in the emulator)

- Jump rise 60 units; gravity 0.25 units/frame²; terminal fall 7 units/frame; top run speed about 5 units/frame.
- Steps up of 8 units are walked, 16 blocked; drops of any size between floor cells are walked off.
- Springs (type 18) throw Sonic 140 units up: launch speed 8 units/frame, contact at the object's y (`objwatch.py`).
  Some springs stand on a raised cell, so they are jumped onto.
- Cells with no floor (map word 0) are walls: Sonic stops at the edge walking and jumping (18 of 18 edges in GG1,
  GG2, DD1). The map has no bottomless pits. Spring height not measured.

## Sections, rings and holes

- Start table (+0x20, RAM pointer $067A): [x, z, dir] per section (section offset $06B2 = 0, 6, 12); +0x12 >= 0 when
  the act has big rings; ring [x, y, z] per section from +0x14 until x = 0 (y < 0 sets a flag bit); +0x28 lists
  objects removed for later sections. Boss arenas list no ring.
- Big ring (type 40, code 0x18542): when used it sets $0A5E, clears the Flicky followers and moves itself to the
  next section's position. It does not move Sonic. The act's run routine then advances $06B2 and writes 1 into one
  hole's mode word.
- Holes (type 1C, code 0x18AFE; GG1 and GG2 only): record +0x24 mode 1 open, 4 closed until a ring opens it; the
  second record of each pair has mode 0. Swallow window x+3..x+27, z-7..z+17. GG1 (watched): the hole under ring 1
  throws Sonic out of the other hole with a 127-unit rise, onto the area that leads to ring 2. Rule used: closed
  holes open in record order, one per ring, and exit at the next hole in record order (GG2 fits; not watched).
- Object dispatch: jsr 0x1BF42 + type (branch table). Records in RAM: base = word0 - 0xE; mode word = word0 + 0x16.
- Other zones: sections are not linked on foot either; their gimmicks (lifts, tubes and so on) are not decoded.
  GG1's map in RAM differs from the ROM map in 7 cells at the start (raised blocks and bridges written by objects).
- Flickies: each 0C enemy record is followed by a 34 record at nearly its position (the Flicky it holds); 58 enemies
  have none. GG1 section 0 has 4 x 0C + 1 x 58 = 5 enemies, so 58 probably holds one too (unconfirmed). Blast Grid
  models it as: every converted enemy frees one, five per ring.

## Green Grove objects (emulator + the StrategyWiki Green Grove guide)

- 08 Mine (explodes on touch), 0C Hunter (stands still), 58 Scouter (chases), 54 Turret (fires at Sonic; killed a
  test Sonic with no rings), 44 continue (a head above a spring), 28 cracked wall (raises its cell to 480 units until
  broken), 38 supercharger posts (raise two cells by 32), 24 supercharger pad.
- Supercharger pad (24): stand on it and press jump; Sonic is held revving about one second, then fired as a ball
  along z, towards +z when bit 0x800 of word +0x16 is set. The player slot does not move while the pad carries him.
- Monitors (3C): word +0x26 / 0x80 = kind, in icon order: 1-up, rings, blue shield, gold shield, invincibility,
  speed shoes, a red shield (then score digits). Icons are 2 x 2 raw tiles at 0x13C7D8 + kind * 0x80, palette line 2,
  drawn 2 px right and 13 px down from the body's top left (`monicons.py`). GG1 holds 3 rings, 2 blue, 2 gold,
  1 invincibility, 1 speed shoes, matching the guide.
- Hunter (0C): stands still but turns to face Sonic, with a spike ball orbiting it (Sonic Retro "Hunter" page).
  Measured (`huntram.py`: Sonic two cells away, camera left to the game; the Hunter wakes only once on screen, about
  160 frames after a teleport): the ball (sprite tiles at 0x028BC2, 4 x 4 plus a 2 x 1 spike) runs a flat circle of
  radius 23.5 units (fit residual 1.8) in 253 frames (taken as 256: one 256th of a turn a frame), clockwise seen from
  above. Its height, about 20 units, is estimated from the screen. The Hunter at times stretched up tall with no ball
  in an earlier run with the camera poked; not modelled.
- Cannons and cracked walls are run by the acts' own routines (RunLevel_GGz1 0xE59E, RunLevel_GGz2 0xE9C2), not by
  objects. Cannon routine 0xF0B0 (args: player's map cell offset to match, mouth height, two launch speeds): Sonic in
  the cell, z & 31 < 8, y in (mouth, mouth + 12) is caught ($64 = 2), held at cell x + 13, mouth + 3; a new press of
  jump (A or C) fires him: up 9 units a frame and south (asked 7.5 GG1 / 6.5 GG2; measured 7.067 / 6.1 a frame,
  `cannonprobe.py`), with control off for up to 100 frames; sound 0x81. GG1: cell (116, 12), mouth 248, lands at
  (3725, 56, 1201) on Knuckles' ledge. GG2: cell (21, 48), mouth 576, lands about (685, 328, 2258).
- Cracked walls (same routines): while a flag stands the routine writes a raised map word into the wall's cells; a
  dash breaks it (player in the cell before it, $56 = 2, speed word $1E >= 0x4000, within 16 units, facing within 45
  degrees of the wall; sound 0x59) and the cells get the ROM map's word back. GG1: (108, 17) raised to 480 units,
  broken from the south. GG2: (59, 47) raised to 784, broken from the east; (108, 41) and (109, 41) raised to 688,
  broken from the south. The 28 objects nearby are not the walls. `wallprobe.py` reads the map in RAM.
- Sprite recipes 008 (mine) and 054 (turret) captured with `recipe.py`; the 008 snapshot also caught a spring and
  was trimmed to the mine's two pieces.
- Act 1 ends at the second big ring from the start table, at ground level inside the brick U.

## Act results screen (emulator, `actclear.py`)

- Poking $06B2 = 6 and $0A5E = 1 with Sonic at GG1's second ring ends the act: about 200 frames later the results
  screen ("SONIC GOT THROUGH ACT 1", time taken, score, time, ring, Flicky, Knuckles and Tails bonuses, total) counts
  down, then the Act 2 title card.
- Big font (title, sprites): RNC block 0x15DEBA, 134 tiles: A to Z as 2 x 2 column-major glyphs from tile 0, act
  digits 1 to 3 as 2 x 4 from tiles 104, 112 and 120. Small font (plane A at 0xC000): RNC block 0x15E3E6, 76 tiles:
  A to Z, 0 to 9 and a colon, each a top tile and the one below it.
- Palettes: line 0 = palette 26 (white text, navy background colour 0), line 1 = 27 (yellow), line 2 = 3 (act digit).
- Layout (screen = plane, no scroll): title letters 16 px apart from (88, 16) and (64, 36), act digit at (244, 22);
  small text rows 8, 12 to 20 (every other row) and 23. The bonus tables themselves are not decoded.

## Sound

- Loader at 0x24FD8: clears Z80 RAM, copies 0x11BF bytes from 0xD1D18 to Z80 0x0000 and 0x7BD bytes from 0xD2ED7 to
  0x1300, clears 0x1C00 to 0x1C0F, sets 0x1C02 = 1 on PAL consoles, then releases the Z80.
- Every request goes through one routine (0x24FA6): music queue $0AC6 first, else effects queue $0AC4, written to Z80
  RAM 0x1C0A; the driver clears it once read. Level music: word at 0x24F78 + 2 x level id (0x24F4E): GG1 1, GG2 2, ...
- Effect numbers, read from $0AC4 in the emulator while Sonic did each thing (`sfxlog.py`, `sfxlog2.py`, with a private
  ROM copy whose two clears at 0x24FAE and 0x24FBE are NOPs): jump 62, spin dash rev AB and launch B6, ring 33, spring
  68 (then B1), monitor or enemy pop 3D, Flicky freed 38, rings lost B9, turret shot 4D and 9A, act end B6 then 6A.
  Monitors also queue on $0AC6: blue shield 3A, gold shield 3F (others in code at 0xC190 to 0xC210: 33, 19, 3E, 1B).
- Emulated in the page (sound/md_sound.c) and checked against the reference emulator: Green Grove's music matches.

## Sonic Jam (Saturn): the 3D Sonic and Sonic World objects

The formats come from the Sonic Retro SCHG pages for Sonic Jam (Models, Animations, Textures); `re/jam/jam.py` reads
them and `re/jam/render.py` draws poses for checking. Put the disc's MUSEUM.MUS and SPRDATA.MUS in `re/jam/files/`.

- The disc is ISO 9660 (data track Mode 1, 2352-byte sectors with the data at +16). Sonic World's models, animations
  and texture definitions are in MUSEUM.MUS (loaded at 0x06040000; pointers minus that give file offsets); texture
  pixels and colour tables are in SPRDATA.MUS at (VDP1 address - 0xD040).
- Sonic: 15 parts with footers listed at 0x42620, then (straight after the 15 pointers, no terminator) each part's
  offset from its parent. Parents (my reading, confirmed by the poses): body; head, thighs, biceps and tail on the
  body; calf on thigh, foot on calf; wrist on bicep, hand on wrist. Jump ball: one part, footer list at 0x49D48.
- Animation angles are stored z, y, x and applied as Rz Ry Rx (the only order that gives a natural run, walk and
  somersault). The model faces its -x. Textured quads use 4-bit colour tables with transparent-pixel disable set, so
  colour 0 is drawn; CMDCTRL bits 0x10 and 0x20 flip the texture.
- Some parts keep whole-unit 16-bit vertices (6 bytes each, told apart by the gap to the index table), drawn y-down
  (palm tree, bush, arch, checkpoint); those have no vertex normals. Other models' footers are listed in the SCHG page.
- Texture numbers in quads count from 1 (SCHG: $1..$1DB): definition = number - 1. Checked by eye: palm and bush
  (fronds, coconuts, trunk, base and a star-shaped shadow line up), Sonic (eyes, muzzle, shoes with strap and buckle,
  blue back), spring (emblem on the pad, metal coil). Read without the - 1, Sonic had peach spines and striped shoes.
- Textures in quads whose CMDPMOD lacks bit 6 (palm, spring coil, Flickies) draw colour 0 as see-through.
- Skid: the jump table is at 0x290A6 (11 frames), 6 bytes before the address the SCHG page gives; read from 0x290AC
  the frames come out as nonsense flags.
- Objects used: palm 0x5034C (2 parts: fronds with coconuts and shadow; trunk, one flat quad the game turns to the
  camera), spring 0x50B44 (pad, coil), big ring 0x52FDC, Flickies blue 0x53880, purple 0x53F08, green 0x53BC4,
  red 0x5424C (10 parts; parents body; L leg, R leg, L arm, R arm and head on the body; each foot or hand on its limb).
  Flicky flying animation 0x1FAD0 (17 frames) keeps 16-bit global positions (frames are 48 bytes: flags, y, z, rot x,
  then 10 x 2 words).
- The "bush" (0x506F4) is a short pineapple-like plant; Green Grove's foliage has no bushes (palms, flowers, flower
  beds and the cannon), so it is not used.
- Green Grove palms in the level art (`artBaker(...).palms`): a lone 64 x 80 palm picture is the pattern; every
  tile-aligned window whose green pixels match it or its mirror nine in ten is a palm (GG1 16, GG2 36, GG3 4; 16
  of 16 checked by eye in GG1). Cut out of the foliage pieces when the game draws Jam palms.
- The Mega Drive game has no skid frames as far as the emulator shows: reversing turns Sonic through his views.
- Checked on the USA and European discs. The European MUSEUM.MUS has 96 bytes more before 0x1BBC (the rest is the
  same, with every pointer 96 higher); SPRDATA.MUS is the same file. Everything the page reads (Sonic, ball, palm,
  spring, big ring, Flickies, all animations and textures) comes out identical from both. `Jam` finds the shift by
  checking Sonic's group footer.

## Open questions

- Section gimmicks per zone; objects that write the map.
- Supercharger flight path (where it lands), the cannon, cracked walls and posts as map changes, continues.
- The 060 and 0C8 enemies, level 22 animated tiles, sound (the driver is not decoded).

## Rusty Ruin 1 (2026-10-26; private emulator tools sectionwatch.py, secexit.py, fan2.py, cellseq.py, objram.py)
- Act routine 0x742C (labelled RunLevel_RRz2; the labels swap RR acts 1 and 2). A big ring sets $0A5E; the routine
  writes 1 into the mode of a type 090 object beside the ring; when its +2 word turns 1 the routine places Sonic in a
  closed pocket ((1696, 232, 1840) after ring 1, (2576, 200, 1216) after ring 2), fades, and walks him by itself to a
  cell ((60, 48) / (80, 50)) that starts a ride (player state 0x36: a roll out through a curved arch, ending at
  (1888, 455, 730) moving 5 units a frame south; 0x38: a hop up a wall onto (2576, 264, 1676)). Ring 3's part is
  only reachable this way (`gaps.py`). After a lost life InitLevel sets mode 3 and the pocket is used again.
- Doors: table 0x7994, 28-byte records [cell, x, y, z (16.16), $38, cell, sprite, direction, camera x2]; grounded on
  the cell, Sonic is moved and pushed 4 units a frame (direction 0 south, 2 west, 4 north, else east).
- Fans: map low byte 0x55 (helper 0x83A8): grounded, not whirling: $5C = 1 (whirl), $56 = 2, held 32 frames with
  sound 0xAB every 8. Measured: 0.094 units a frame per frame towards the stick, top 5, drag 0.03 with the stick
  released, a wall sends back about 0.94 of the speed. Spike blocks: low byte 0xFF sets $3E = -1 (a hit).
  Low byte 0xAA: green domes, a puff (object 0A8) and sound 0xAA only.
- Pillars: table 0x7ACC (helper 0x85AC), 14-byte records [screen x, screen y, x, y, z, cell, raised word]; InitLevel
  raises each cell by 0x2000; while whirling, cells touched are let in and a pillar whose cell Sonic enters drops by
  0x2000 (sound 0x59). Dash walls (88, 62) and (100, 41) (the latter also lowers (100, 15)) as in Green Grove.
- Helpers not yet used: 0x84F2 (flamethrowers: fire objects when Sonic is in front, sound 0x7F), 0x86B0 (maces: a
  ball circling a centre, angle step per frame from the table at 0x75C2).
- Scripted moves (player states 2..0x5E): RunSonic's interpreter at 0x2EFC plays a script from 0x25DF2 + the word at
  0x25DF2 + state - 2: segments [motion offset, word (high byte 0x80 + facing / 256, low byte frames)], ended by
  0x8000 then 0 (done), a positive step back (repeat), or a negative word then [x, y, z, facing, vx, vy, vz]. Motion
  at 0x25DF2 + offset is [dx, dy, dz] a frame, with 0x8000 and a step back to repeat. Bit 7 of the state mirrors x/z.
  RR1's 0x36 from (1888, 392, 768) ends at (1888, 455, 730) and 0x38 from (2576, 136, 1607) at (2576, 262, 1676), as
  in the emulator. The original's facing word: 0 south, 0x200 west, 0x400 north, 0x600 east.
- The pocket walk: while $0A18 counts down, the pad byte is replaced by $0A1A (0xFF: nothing); the routine holds
  Sonic still about a second, then he walks to the ride's cell (modelled as walking straight at it, sliding on walls).

## Rusty Ruin 2 (2026-10-27; padwatch.py, rr2pit.py, slideprobe.py, tramp.py, ridescript.py)
- Act routine 0x7CFC. Pads (objects 1C/090, code 0xC75A in, 0xC642 out): a slow (under 2 units a frame) grounded
  Sonic inside x+3..x+27, z-7..z+17 is held 100 frames, sinks 56 units from frame 51 over 21 frames, waits 47 units
  under the other pad 95 frames and is thrown up (127 units in GG, 138 in RR). Slides: low byte 0xC3 east, 0xF0 south,
  0.25 a frame per frame up to 4, and for 15 frames after. Trampolines 08C rise 94 units; slabs 098 sink 84 units
  about 1 s after landing. Maces: tables 0x75C2/0x80B8, ball 64 units out, 2048 a turn. Flamethrowers: tables
  0x7548/0x7EC4, a box 128 x 64 units in front, a fireball every 6 frames. The pit under pillar (85, 101) fires ride
  0x2E below 32 units.

## Bosses (bosswatch.py, rr3watch.py, armstand.py, armgrid.py)
- Object art by type: the long at 0x280E8 + type. Type 48 is Robotnik's pod in every boss (frames 0-7, 9-11 cracked,
  12 front); GG3: 50 ball, 4C claw.
- GG3 (RunLevel_GGz3 0xDDE4): see CLAUDE.md "Bosses"; measured to the unit.
- RR3 (InitLevel 0x6D84, RunLevel_RRz3 0x6DE8). Level vars (a4 = 0xFFFF0B6C): arm 1 [reach, lift], arm 2, script
  offset $8, action $A, timer $C, pod y $E (0x142 to 152), cap y $10 (0x156 to 162), active arm pointer $12, hits left
  $3C (5). Hit: Sonic within 32 units of the pod (0xCCD8/0xCCE0) and y in [pod - 32, pod + 64], his $3E not negative,
  $38 clear: vx, vz negated, vy = -5 (up), pad locked 30 frames, $38 = 60, sound 0x59; at 3/2/1 left the pod frame
  changes ($CCF0 = 0x34/0x3A/0x40); at 0, $3E = 240 frames of explosions (cap rises 4 a frame to 0x154), then the act ends.
- Script table 0x7170: [action, frames] pairs, -1 then a step back to loop. Each frame: timer - 1, at 0 the next pair.
  Actions (/4): 0 reach (+1 while the wrist z is under 2144, or under both Sonic z - 16 and 2190), 1 pull back (-1 to
  32), 2 idle, 3 slam (lift = -64 + ceil(64 sin((t - 1) pi / 32)) from the sine table 0x27AC8; sound 0x5F at t = 1),
  4 lift + 1, 5 swap arms, 6 pod - 1 (only when $0AF4 is clear: every other frame), 7 cap - 4 (sound 0x9E at t = 1),
  8 other arm reach + 2, lift - 1, 9 the reverse, 10/11/12 picture and camera only.
- Arm joints (0x727C, checked against the records in RAM): root (y 128, z 2080); r = [reach, lift]; with L = 2|r| and
  h = sqrt(65536 - L^2), the elbow is root + (r + perp(r) h / L) / 2 (links 64 long, the elbow up and back); records
  0BC: four from the root to the elbow, three from the wrist (root + r) back to it; record 0C0 the fist, 20 over the wrist.
- Touch (armgrid.py, armstand.py): links hurt within about 16 units across and 12 along; the fist's top (one unit under
  its record) holds Sonic over x -4..+20, z -2..+36 of the record and carries him as it lifts and pulls back; a slam
  coming down on him hurts. From a raised fist a jump reaches the pod.
- Not used: cells 0x4172/0x4174 with z <= 0x830 and y <= 0x70 set Sonic's $3E to -1 (no hits there).

## Rusty Ruin crawler 0AC (objtrack.py, crawltest.py)
- Rolls 1 unit a frame between words +0x24 and +0x26 and back (RR2 (3017, 546, 1135) along x 2969..3062; RR1 two
  along z). It wakes once on screen. A Sonic dropped onto it is hurt ($3E = -2). Art: type art 0xAC, eight turning
  frames. Axis rule (the range holds x: along x) is inferred from three records.

## Spring Stadium (2026-10-27; objshots.py, boost2.py, balloon2.py, runlog.py, simrun.js, mapview.py)
- Object handlers: `bra.w` table at 0x1BF42 + type (024 0x18896, 038 0x18006, 044 0x18086, 05C 0x17E80, 13C 0x1704C,
  140 0x16FFE, 14C 0x17CB6, 150 0x164B0, 154 0x160CA, 15C 0x161C4, 160 0x1626A, 0AC 0x16F80, 01C 0x18AFE, 090 0x18BD0).
- SS1 uses InitLevel_SSz1/RunLevel_SSz1 (labels not swapped). Sonic's word +0x8C is his cell's map offset
  (z << 8 | x << 1); routines compare it with fixed cells. Teleporting Sonic needs +0x8C set too.
- Superchargers (0xCA6A): (word +0x26 != 0, bit 3 of +0x16): (0,0) north, (0,1) west, (1,0) south, (1,1) east;
  grounded, no pad lock, object at a ready frame, Sonic within 12 units of the cell one step that way: held 70
  frames (pad 0xEF: spin dash rev), then off at 7.4 units a frame; pad let go 30 frames. Measured in SS1.
- SS1 opener (emulator): supercharger -> loop at (37, 117) (state 4; pad F5 = run east held 140 frames from the
  loop's start) -> floor spring (46, 115) up onto 0x31 -> supercharger (1632, 384, 3680) -> loop (61, 115) -> loop
  (77, 113) -> downhill. Init raises gate cells by 0x20 (closed); boosters' mode 15 opens them. Not modelled: gates.
- Floor springs (low byte 0x55, end of 0x9974): grounded -> vy 7.875 up (sound 0xB1). Bumpers (0xFF, and tables
  0x98DA SS1 / 0x94EA SS2, negative entries a second look): on entering the cell within 12 of the floor, by the
  cell's diagonals: north -> vz -5, west -> vx -5, east -> vx +5, south -> vz +5; $0ACA 20 frames; sound 0xB7.
  The cell is flush (its corner raises bring it to its neighbours' height). Spike fields (0xAA, SS1 only, 0x9D44):
  shared count $2(a4) +0x200 every 4 frames ($0AF8) while grounded on one, -0x200 off; at 0xA00 a hit (18 frames).
- Tubes (0x9B40; tables 0x98C6 / 0x9480): [x, z, to x, y, z] in x boxes of 32 x 8, then [z, x, to ...] in z: held 30
  frames (pad locked 120, sound 0x3C), then states 0x40 / 0x42 (twisted tunnel down / up between the two mouths).
- Balloons (150): y = word +0x26 + 8 sin (phase +0x24, +16 a frame of 2048); touched (from above at its top, 26 over
  its base) they pop (frames 8..16 then gone ~70 frames, sound 0x77) and throw Sonic ~43 units up. A jump from the
  floor (51-60 units) under SS2's first does not reach it; floor springs beside it do.
- Triangle bumpers (SS1 0x9818, SS2 0x925C): 64-unit boxes; inside the triangle (side offset, from the far side when
  flipped, no more than the band offset) within 16 of the floor: near the tip (side < 2 band - 64) pushed 5 along the
  band, else (+-4, +-4) off the long side; once until outside; pad 20 frames; sound 0xAE.
- SS2 spears (0x9146, cells 0x9494, object $D422): Sonic's cell in the list with x & 31 >= 24 raises a spear at the
  cell's east edge (sound 0x8C); it waits ~34 frames, then rises (counter 28 -> 0 by 4 every 2 frames); its tip is
  floor - 16 + 2 x (28 - counter); Sonic in that quarter under the tip is hurt. Spiked wall: x == 0xF40, y < 0x380 in
  cells (122, 22/24/27..30): hurt.
- SS3 boss (InitLevel 0x87CE, RunLevel 0x887A): a4 vars: x.l, y $4 (0x230), z.l $6, swing $A += $C, hang $1E -> $20,
  timer $16, heading $2C -> $2A, speed $2E, hits left $3C (8). Timer 0x190: swing 0x10, height 0x60 + 0x60; 0x320:
  swing 0x40, height 0x10 + 0x60, hang 0, $A &= 0x7C0; 0x4B0: back to 0x190 (hang 0x28). A hit sets the timer to
  0x31F (or 0x4AF when low). Bounds x 0x5D8..0x768, z 0x7BD..0x95E; corners (z < 0x8BD and x < 0x618) and (z < 0x7FD
  and x < 0x6D8) turn it to 0x100. Fists at (+0x26, +0x28) and (-0x2E, +0x28), y = pod - hang + (sin << 6 >> 16),
  floor-limited (slam: sound 0x5F when low). Generic check 0xF794: within 32, y in [pod - 32, pod + 64]: at pod + 8
  or over and spinning ($56 = 1): hit (bounce, pad 30, 0x59); else Sonic hurt; 60 frames apart. Spikes: 0xFF cells
  with the spike count ($18). Floor springs 0x55 up to the spiked ledge. Arms' art (170, 174) does not decode.
- Not used yet: 044 (Sonic head pickups:
  ten add one to $06AA), 13C (a red button), 140, 154 (spear-like posts, animated when a ring opens a gate), 15C/160
  Tails and Knuckles.

## Diamond Dust 1 (2026-10-27; dd1_dis, runlog.py, flow.py, simrun.js)
- The game places Sonic at the start table's first [x, z] (header +0x20), not at the 030 object; both converters now
  read the table first.
- RunLevel_DDz1 (0x1009E): pads 0CC in pairs (tables from 0x108C4: pad 1 sends to pad 2 once ring 1 opens it, pad 3
  to pad 4 after ring 2). Ride states with bit 15 are mirrored: (x, z) -> (-z, -x), facing (0x200 - f) & 0x7FF
  (state 0x8004 at (89, 50) watched in the emulator; a plain x/z swap was wrong).
- Cells: ice chute x 39-40, z 52-70 (grounded: +0.25 units a frame per frame south, steered to x 1280, pad let go)
  into state 0x3A at (40, 70) (rolling, pad held 80 frames); dash east at (54, 65) under y 704 (7.5 units a frame for
  24 frames, a jump at 6 a frame on frame 14); sled at (78..79, 66) (pulled to (2528, 2128), then +0.0625 a frame per
  frame south for 300 frames) into state 0x3C at (86, 81); currents x 110-113 z 55-89 (up to 2 a frame) and x 50-53
  z 83-99 (up to 3), +0.375 a frame per frame south; snowdrift springs at (94, 39), (90, 39), (80, 39) (rise 40).
- Snowblowers: table 0x10976 (7), fired like flamethrowers; a blast freezes Sonic (time not measured: 1.5 s used).
- Airborne, Sonic is lifted onto a ledge whose top is within 12 units above his feet (the current to ring 2's ledge).
- Not modelled: warp holes (57, 50) <-> (59, 72), the wall cells 0x4C4C, gates.

## Movement tables (2026-10-27; speedprobe.py)
- Routine 0x3330 picks [accel $22, side loss $2A, forward loss $26] and top $2E: walking 480/380/260, top 0x5000; the
  jump ball ($56 = 1 or $84) 300/200/160; rolling ($56 = 2) 0/200/10, a roll ends under forward 0x1000; ice ($0ACA or
  $88) 100/20/20; $5C set: 200/80/80 (not identified); speed shoes ($7E) top 0x6800. Units 1/0x1000 unit a frame
  (per frame). 0x342C: velocity is turned into Sonic's facing frame ($32, 0x800 a turn); forward gains $22 with any
  direction held; each part loses its loss toward 0; above the top a part loses $22 instead; capped at 0x7F00.
- Measured in GG2 (straight at (87, 37)): run up 0.1323 a frame per frame, top 4.73 to 5.0, stop 0.1489; facing turns
  0x40 a frame, side part then lost at 0.219; jump ball without the stick 0.0864; walking off a ledge keeps the
  walking table; rolling 0.0044. Spin dash (B held from standing): under 14 frames nothing, then 3.75, from 29 frames
  5.625, from 44 6.5625, from 59 7.5 units a frame.

## Diamond Dust 2 (2026-10-27; dd2_dis, mapdiff.py, iceblock.py, mapwords.py)
- RunLevel_DDz2 (0xFA06): pads as act 1 (tables 0xFC82, 0xFCA6, 0xFCCA, 0xFCEE: record 1 <-> 3, 5 <-> 7); pad 5 used
  sets the ice flag, pad 7 used clears it. The supercharger (record 9, mode 0x0F when fired) sets $4(a4), which lowers
  cells (77..78, 95) and (91..92, 106) back to the ROM's heights (InitLevel raises them 0x20 steps: gates); cell
  (91, 107) clears it. Cell (78, 95) starts ride 0x803E (pad let go 400 frames).
- Grounded on (109, 80), (103, 82), (111, 72) (snowdrift records 26..28 still there): thrown 4.5 a frame up (40
  units), sound 0x59. Cell (50, 45) under y 608: 7.5 a frame east, rolling, pad held 10 frames, sound 0xB1.
  Current: x 96..117, z 88..95: grounded, +0.375 a frame per frame east while under 3.5; airborne once, at least 3.5.
  Snowblowers: table 0xFD5E (7), as act 1.
- Helper 0x10E78: ice on entering a cell of the first list, off entering one of the second (DD1 0x10B24 (21) /
  0x10B4E (25); DD2 0xFE30 (39) / 0xFE7E (40)). DD1 also sets ice at the start of ride 0x8004 and clears it at
  (86, 74).
- Helper 0x10CC4: [cell, cell, y] until a negative word (DD1 0x10AF2, DD2 0xFE04): airborne in one under y, vy is set
  to 0.25 down; while airborne elsewhere, the cells are raised 0x20 steps for collision (list at $CC92, applied at
  0x2DDE, undone at 0x5CD6: negative entries raise, positive lower). Map 0xFF cells: hurt when y <= floor + 24.
  Grounded, entering a 0x55 cell: pushed 5 a frame across the nearest edge (diagonals), sound 0xAA.
- Helper 0x10EA6: 12-byte records [screen x, screen y, x, y, z, cell] (DD1 0x10B80 (27), DD2 0xFECE (17)): ice spikes
  (object 0E8, palette line 0). At the start their cells are 3 steps lower and marked 0xFF (mapdiff.py), so the spikes
  stand at the old floor height and hurt; grounded and rolling in one: the cell gets its height back (+0x0201), sound
  0x59.

## Diamond Dust 3 boss (2026-10-27; dd3_dis, dd3watch.py, dd3puff.py, ddprobe.js)
- a4 vars: x.l (0), y $4 (0x240 at the start), z.l $6, target y $1A (0xB0), drop timer $14, script offset $1C, frames
  left $20, heading $2C, speed $2E, blower angle $24 (+0xC a frame), puff cycle $30, puff slot $26, hits left $3C (8).
- Script 0xF2FA: [action 0 chase / 4 wait (heading 0) / 8 drop ($14 = 60, sound 0x7E), frames]; a negative action
  steps back by the second word (bytes). A hit (generic check 0xF794) sets $1C = 0x28. Chasing: at $20 = 0x190
  target 0xB0, at 0x64 target 0x100; y moves 1 a frame toward it. Heading by octant (table 0xDBEE), turn 4 x speed,
  speed 6 - hits left / 2, moving speed / 2 a frame. Heading forced: x or z < 0x740 or > 0x8C0, x - z >= 0xD8 or
  <= -0xD8, 0x1000 - x - z >= 0x110 or <= -0x118.
- Blowers (records 4..11, type 0F8, handler 0x16660): angle $24 + k x 0x100, 32 units out (sin << 6); frame = ((angle
  - 0x100) & 0x7C0) >> 6, mirrored from 16 (32 - frame). As many as hits left; the rest are switched off.
- At y = 0xB0: $30 counts 0..179; under 120, one puff slot a step (one every 3 frames or so) is started if its
  blower is on (sound 0xC8). Puff (0FC, handler 0x165CA): y = pod - 16; position = blower + sin/cos x 8 + a sum of
  sin/cos x 2 a frame along the blower's current angle (it curls). Touching 0E4 or 0FC freezes (0x1B9CA): $88 = 4,
  $8E = 1, $94 = 0x12, sound 0x80. Frozen (0x3050): ice table, no pad; each landing a hop (vy 2 up, sound 0x94) and
  $88 - 1; at 0 the ice breaks (debris, $3E = 50, sound 0x80).
- Drop: at $14 = 30 a snowman (type 0E0, sound 0x51) at pod x - 2, z - 2, y 0xE0; it falls 4 a frame to the floor
  (records 2/3). Snowman handler 0x16992: attacked: broken; Sonic within 48 units each way: wakes ($1E = 6); at
  animation frame 0x2A: over 8 frames 8 snowballs (table 0x16A58: 1 unit a frame out in 8 ways, about 4 up), then it
  breaks (sound 0x59). Seen: a woken snowman hurt Sonic about 40 frames after landing.

