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
  ROM address of the frame seen. Level 22 only partly found.
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
