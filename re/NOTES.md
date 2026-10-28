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
  GG2, DD1). The map has no bottomless pits.
- Frame by frame (2026-10-27; movetrace.py records $6/$A/$E, velocities, $1E forward word, $32 facing, $56 state;
  move_parity.js replays the pad in the sim). Three traces (GG1 walk, wall slide, corner, turns, jumps; GG1 spin dash,
  rolls, bounces; GG2 slopes, roll jump, air wall) now match to 1/100 unit with these rules:
  * Turn (0x3134): pad direction from table 0x44A8 into $34; facing $32 moves 0x40 a frame: (facing - target) & 0x7FE
    under 0x400 down, over up, exactly 0x400 against the last turn ($36 = facing before it; none: down). Pad let go:
    the turn goes on while (facing - $34) & 0xFE is not 0, so it ends on an eighth from the target.
  * Velocity (0x342C): $12/$1A (16.16) >> 4, times sin/cos words from 0x276E8 (= floor(sin(i / 0x400 turn) x 0x7FFF),
    0x500 words), >> 15: side and forward at 1/0x1000. Forward + $22 with any direction; side - $2A, forward - $26 toward
    0; a part over the top $2E loses $22 (capped 0x7F00); forward stored in $1E; turned back (x = side cos - fwd sin,
    z = fwd cos + side sin, >> 11). Tables: walk 480/260/380 (top 0x5000, shoes 0x6800), ball ($56 = 1) 300/160/200,
    ice 100/20/20, $5C 200/80/80, roll ($56 = 2) 0/10/200 with $2E left as it was. A roll with $1E under 0x1000 ends
    before the update ($56 = 0, walk table that frame).
  * Dash button (0x31C8, grounded): moving (any of $12/$1A not 0) with B: $56 = 2. Standing with B: $60 = 1, no move
    and no jump (exit 0x3744); once the crouch shows ($94 = 3, $A2 = 0x24: anim 3 picked, started the frame after, three entries of rate 20 = 9 frames; 10 after the press from standing) the rev starts ($56 = 3, $58 = 3,
    $5A = 15, sound 0xAB); every 15 frames $58 - 1 (sound); a new C press zeroes $5A. B let go with $56 = 3: launch
    from table 0x3312 by facing >> 8 ([0, 0x7800], [-0x54DA, 0x54DA], ... 8 ways) x (16 - 2^$58, or 16 at 0), $2E =
    0x7800, $1E = 0x4000, sound 0xB6, no move that frame.
  * Slope (0x3540): the cell's corner byte (all corners odd: flat) picks a triangle (flag 0x4A08: split NE-SW, NW
    triangle when x + z <= 31 within the cell; else split NW-SE) turned to the north-west one (ror 4 / ror 2 / rol 2)
    and reads 0x263574 + 0x44C8[byte] = the triangle's normal at 1/8 a step x 0x5A00, cut toward 0 (checked, all 256).
    Grounded, with a part 0x1000+ or a velocity 0x800+: velocity += g + g/4 (rolling: g/4 first). A jump (0x3660) adds
    g x 32 and leaves at the normal's upright word (0x5A00 on flat), then $56 = 1. It needs $46 > 0 with $44 set and
    $60 clear. $46 (0x2E0E, start of his frame, pad bit 5 = A, set when let go): let go 0; pressed with $46 0 or 2:
    1 if grounded, else 2 (pending: kept while held, a jump on the first grounded frame); otherwise -1. The ice block
    (0x305E) and the rev (0x3252) set it to -1.
  * Floor (0x3BB2..0x429C): same triangle choice; height = high byte x 8 + 0x46C8[byte] (nw x 8 - 8) + floor((T[a +
    2u] + T[b + 2v]) / 4) with 0x4848 T[k x 32 + i] = (k - 3) i and a, b = (corner difference + 3) x 64: so nw +
    floor(((ne - nw) u + (sw - nw) v) / 4) in whole units.
  * Walls (0x40D6): the new cell's floor at his new place 9+ units over his height ($A, whole units) is a wall, walking
    or in the air: x (or z) put back to his old cell's edge, that velocity cleared; rolling ($56 = 2): reversed and
    0x4000 off it (crossing zero clears it, and both clear ends the roll), facing 0x800 - f (x) or 0x400 - f (z) when
    it comes back. Not a wall: in the air, under that floor and falling: lands; rising: put on it, still in the air.
    Grounded: a floor more than 2 under him leaves the ground.
  * Jump 0x5A000; letting go while rising: a speed over 3.125 loses 1.5, then halves, and that frame skips gravity.
  * Landing (0x40F8): in the air, a floor at or under his height: nothing; above it (his whole-unit height under it)
    and falling: lands (y = floor, $44 = 1, speed down 0); rising: y = floor, still in the air.
  * Diagonal pieces (0x3A1A): the cell he was in ($8C, from last frame) or a neighbour holding 0xD5 (this, west,
    north: line x + z = X0 + Z0 + 32, or X0 + Z0 for a neighbour; solid below), 0x5D (this, east, south: + 31 / + 63;
    solid above), 0x57 (this, west, south: z - Z0 = x - X0, or X0 - 32; solid where z - Z0 is more), 0x75 (this, east,
    north: X0 or X0 + 32; solid where less). Past the line: half the overlap + 1 (16.16) on each axis (x and z the same
    way on x + z lines, opposite ways on x - z ones). Then rolling ($56 = 2): x + z lines (-vz, -vx), facing 0x200 - f;
    x - z lines (vz, vx), facing 0x600 - f. Otherwise the speed along the line: t = ((vz >> 4) 0xB5 - (vx >> 4) 0xB5)
    >> 8, then t 0xB5 >> 4: (-t, t); on x - z lines s = ceil(((vx >> 4) + (vz >> 4)) 0xB5 / 256) 0xB5 >> 4: (s, s).
  * A half turn compares $36 (the facing saved before each turn step; bounces and scripts leave it) with $32.
- A hit (0x1B63E, d0 = -1 new, -2 thrown, else counting): with the shield ($0AC2): it goes, sound 0x35; with no rings:
  dying ($42 = 0x22, $94 = 0x11, facing 0x700, 8 up, sound 0x35); else min(rings, 25) into $0A52, rings 0, sound 0xB9.
  Then (all but dying) $94 = 8, facing's low byte cleared, 5 up, $3E = -2, $40 = 100, state cleared. Each frame thrown:
  in the air, $40 - 1 (0 ends it), x/z = table 0x1B826 by facing >> 8 (backward: [0, -0x7800], [0x54DA, -0x54DA],
  ...) x 4; grounded: $3E = 120, speed 0; counting down, blinking. Lost rings (0x19E36): one a frame while $0A52,
  a particle (template 0xD94C, life 0xF0 frames; 0x3C, with bit 3 of $2E set, while $0AF4 is not 0) at Sonic with
  x/z = sin/cos($0A54) x 2 (16.16) and 3 up, $0A54 += 0x480; it first moves the next frame. Particles: pool $C28C, 30 of 0x38 bytes, updated by 0xD20E. Type 0 ($31; lost rings): x moves, a cell crossed
  whose edge corner (NW for +x and +z, NE for -x, SE for -z) is 9+ over the ring's height or has no floor puts it
  at the edge and turns that part back; then z the same; vy += $22 (0x2000), y -= vy; the floor (triangles, NW-SE
  split always) under it while falling: y = floor, vy = -(vy - vy/4), each horizontal part 0x1000 toward 0, and a
  landing with both already 0 ends it; $32 counts the life down (0xF0).
- Frame count C (0x4BC6) and global counts (0x6D14): $0AF4 .. $0B06 count down every frame with periods 2, 3, 4, 5,
  6, 8, 10, 16, 32, 60; each equals (-C) mod n. The random pointer $0A26 = table 0xFAB40 + 2 (C mod 500) (500 words;
  users read consecutive words from it). C and both reset at an act's load and at every reload. After a reload only
  the frames with 19 and 18 left of the pad wait run (C = 1, 2); C = 3 on the first frame the pad acts. The sim
  keeps C as `w.gcC`; `gZero(w, n)` is the counter test and `oRand(w, k)` the k-th word on (converted levels carry
  the table as `rom.rand`, read from the player's ROM). Objects off screen do not run.
- Enemy handlers: 0x17CB6 (060, 14C, 104; 0C4 enters at 0x17CE6): angle $24 moves it (sin, cos) words a frame (16.16:
  half a unit), turning $26 by 0x10 a frame (0x20 chasing) the short way; not chasing, a random eighth when $0B06 is 0;
  Sonic within 0x40 on both axes: chasing (bit 15 of $2A), speed doubled, angle & 0xFFE0, aim at his octant when $0B00
  is 0 (0xDBAE: by octant and halving, table 0xDBEE); the box from $28 and $2A & 0x7FFF, 0x7C, sets the aim inward at
  its edges. 0x17BC8 (064): aim = Sonic's octant every frame, turning 0x10; while turning $28 = 30; facing, $28 counts
  to 0, then 120 and a shot (template 0xD9CA, type 5, from (sin, cos) >> 11 out, + 2 in x, 9 up, (sin, cos) x 2 a
  frame, no gravity, until a wall; sound 0x4D). 0x17346 (094, 144, 10C, 17C): wanders (random way per axis -1/+1/0 for
  0..15 calls, a random -1/0/+1 jitter, its 0x40 square). 0x16528 (108, 148): to and fro along x (bit 3 of $16) or z
  between $24 and $26. 0x174B4 (07C sprinkler): armed within 80 units, turns 0x10 a frame, a shot when $0B02 is 0 (from
  (sin, cos) >> 11 out, + 1 in x, 0x11 up, (sin, cos) x 4, 0.25 up, gravity 1/32); a 16 x 16 solid box, not breakable.
  0x16B40 (0C8): shoots at animation frames (not ported). 0x183FE (058): Sonic within 0x30 on both axes: $24 = 40, then
  each frame a particle (template 0xD9B8: type 5, gravity 1/8, 512 frames) from table 0x184C0 + $26 + $24 ((0, -1),
  (0, 1), (-1, 0), (1, 0) a frame for 40, 30, 20, 10), speed up 4 - $24 / 16, $24 - 10; at 0 it becomes type 0x30
  (inert art 0x3A71C), sound 0x59. 0x17294 (09C): the same to and fro as 0x16528.
- Monitors (0x18674): a box in the solid list $CC02 (one entry for all), x - 14, top y + 24, z - 6, 0x1B x 0x15, its
  break flag $2A; broken: an airborne Sonic is thrown 5 up in the ball, sound 0x3D, the power 40 frames later.
- Solid boxes (0x3788; 8 entries of 0x12 at $CC02): Sonic inside the footprint and between top - 48 and top: from a
  side, walking, that speed cleared and he is put at the edge (x0 + 0.99998 or x0 + w); rolling, a break flag is set
  if the box has one, else reflected 0x4000 slower with the facing mirrored; from above (his last height at or over
  the top): in the ball (or rolling) the flag is set, else he stands on it ($8A = the box: carried); from under it
  rising, he is put under it going down 0.25; a box coming down on him grounded kills him.
- Bumpers (0x9974, Spring Stadium): entering an 0xFF cell near its floor sets one speed part to +-5 by the cell's
  diagonals and turns the ice flag $0ACA on for 20 counts of the helper (cleared at 0); triangle bumpers (0x9810) set
  their speed and the same ice. The pad stays.
- Dying: 0x1B6C2 (facing 0x700, 8 up, $42 = 0x22); the rise slows to 0 and stops there; the act reloads 57 frames
  after the hit (52 frames blank), Sonic back at the section's start table entry facing its dir.
- Touches (0x1B846): skipped while Sonic's $94 is 9 or $3E < 0 (thrown back); the boxes are under "Touches (0x1B846
  list scan" below; a particle of type 0 (a lost ring) is caught at once (0x1BAE0: rings + 1, sound 0x33), types 1-4
  are Flickies.

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

- 004 (handler 0x18F9A): Green Grove's roamer, byte +0x19 = 1 (blue Flicky) in GG1's two. As 0x17CB6 but its square
  is 0xA0 from words +0x28, +0x2A & 0x7FFF and it is only turned back at the edges, never put inside; angle +0x24 cut
  to 0x7F0 on its first frame; half a unit a frame (sine >> 16), a unit while chasing (Sonic within 0x40 in x and z,
  for good), aimed every 10 frames ($0B00, 0xDBAE), else a random eighth every 60 ($0B06); turns 0x10 a frame (0x20
  chasing). Frame $1C from the angle ((A - 0x100) & 0x7C0) >> 4, mirrored past 0x40 (bit 3 of +0x16). Two particles
  (template 0xD970) ride 16 units either side of it, bobbing with $0ABA.
- Freed Flicky colour (0x192C2): byte +0x19 picks the particle's attribute word $2E: 1 0xE7EC (line 3, count $069A),
  2 0xA7EC (line 1, $069B), 3 and 4 0xC7EC (line 2, $069C / $069D) plus $0A90. GG1's CRAM mirror at $06BE holds
  palettes 1, 2, 3, 6 (the header's): the bird is purple in line 3, green in line 1, blue in line 2.
- Spring 018 (0x18968): thrown when Sonic's cell is the record's word +0x24 and he is grounded ($44); vy -8.5, $086A
  = 50, sound 0xB1, animation 0xD.

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
- The bonuses (routine 0x2180C, counted in hundreds into the score $06A6, one a frame each): time from $06A8 (frames):
  100 under a minute, halved each minute after (50, 25, 12, 6, 3, 1), none from 7 minutes; rings 1 each ($0A5A);
  Flickies $06A4 (50 for each five taken to a ring, 0xCDB6); Knuckles $06A0 and Tails $069E, 1 a ring given.
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
- Fans: map low byte 0x55 (helper 0x83FA): grounded, not whirling: $5C = 1 (whirl), $56 = 2, a count of 32, his
  target ($6C/$70/$6E) the cell's middle (x & ~31 + 16) and his y: while it counts, his move is a unit a frame toward
  it (as a supercharger's) and the pad nothing ($0A18 = 2); sound 0xAB when the count & 7 is 0. Whirling, the
  velocity routine takes its own table (0x3380: accel 0x200, frictions 0x80 / 0x80, top 0x5000), the turn as ever,
  the slope's pull quartered and walls, corners and diagonal pieces as a roll ($56 = 2); a jump's frame still uses
  the whirl's table. Exact over the RR1 fifth trace. Spike blocks: low byte 0xFF sets $3E = -1 (a hit).
  Low byte 0xAA: green domes, a puff (object 0A8) and sound 0xAA only.
- Pillars: table 0x7ACC (helper 0x85AC), 14-byte records [screen x, screen y, x, y, z, cell, raised word]; InitLevel
  raises each cell by 0x2000; while whirling, cells touched are let in and a pillar whose cell Sonic enters drops by
  0x2000 (sound 0x59). Dash walls (88, 62) and (100, 41) (the latter also lowers (100, 15)) as in Green Grove.
- Maces (helper 0x86B0; RR1 table 0x75C2, 5 records, driver 0x7570; RR2 0x80B8, 6, driver 0x806C): 14-byte records
  [window x, y, centre x, y, z, turn, second]. Each frame the first record whose window minus the scroll is within
  0x240 x 0x1A0 turns one shared angle (slot 9's +0x24) by its turn and places the shared records: four at centre +
  k (sin, cos) x 32 / 2 (k = 1..4, table 0x276E8), the second chain's four (slot 13 in RR1, 19 in RR2) at angle
  (second + A) & 0x7FE. Touch bytes come from those records; touch goes through the sorted display list as any
  object. Helper not yet used: 0x84F2 (flamethrowers: fire objects when Sonic is in front, sound 0x7F).
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
- GG3 (InitLevel 0xDD12, RunLevel_GGz3 0xDDE4; a4 vars: (a4) x, $2 y, $4 z words; $8 timer; $E script offset; $10
  action; $12 next (st.b $13); $14 ball 1 held / 0 loose / 2 still; $16/$1A/$1E ball longs; $22/$26/$2A speed ($26 +
  down); $2E hops; $32 sub-step; $38 cooldown; $3A hit flag; $3C hits left 5; $3E dying count). Script words 0xDFC6:
  0, 1 10, 2, 3, 4, -1 10. Action 0: y -= $0AF4 to 0xA0. 1: toward Sonic + 4 by 2, $8 frames, then each frame until
  within 0x2400 (squares). 2 (at its read): the ball let go. 3: once $14 = 2, a unit a frame to the ball's x, z. 4: y
  - 1 to ball y + 0x28, 60 frames (ball held again at 30, sound 0x76), y + 1 to 0xA0. x, z kept in 0x320..0x55F. The
  check (0xDDF6): Sonic's $3E >= 0, y from pod - 0x20 to + 0x40, squares <= 0x400: vx, vz negated, 5 up, pad 30
  frames; y >= pod + 8: a hit (sound 0x59), else sound 0xB4 only (no hurt). Ball (0xE26A): x += vx, $26 += 0x2000, y
  -= $26, z += vz; x, z kept in 0x321..0x55E (speed negated). Record $CD3A = ball - (4, 0, 4); floor 0xDB36 under it
  (the triangles without the split); loose, falling and the floor >= its y: $26 = -2, record y = floor (the ball's
  long keeps going), $2E + 1, sound 0x96, speed from Sonic's octant to the record (table 0xE4B8 into pairs 0xE498:
  0x1000 / 0xB50) x 32; at 5 hops $14 = 2. The ball's record touches 16/32 and runs (keys valid) only on screen.
  Exact over the three private scripts with the world run 120 frames first.
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
- Touch (armgrid.py, armstand.py): links hurt within about 16 units across and 12 along; a slam coming down on him
  hurts. From a raised fist a jump reaches the pod. The fist (0C0, handler 0x16E42) puts a solid box in the list at
  $CC02 each frame: x from 8 under the record, 32 wide; z from 1 under, 40 deep; top 1 under; no flag.
- Solid boxes (list $CC02: 8 records of 0x12 bytes [x0, top, z0, last frame's x0, top, z0, width, depth, flag
  address]; routine 0x3788 in Sonic's move, after the position step, skipped while $42): the first box whose x and z
  he is strictly inside decides, the scan then ends. Over its top: his floor ($4c) is the top. 48 or more under it:
  nothing. Rising from under it (last frame's top - 48 >= his old y): falling at 0x4000, put 48 under the top
  (grounded with the box coming down: a hit). Else, per axis where his old position was outside the box's last range:
  at the edge (x0 + 0xFFFF/0x10000 on the low side, x0 + width on the high), that part 0 or, rolling ($56 = 2) with
  no flag, negated and 0x4000 toward 0, facing 0x800 - f (x) / 0x400 - f (z), the roll over once both are 0; with a
  flag, rolling sets it (a monitor breaks). Inside on both axes: ball or roll with a flag sets it; else, coming from
  above its last top, he rides it ($8a; carried by its moves). The sim: monSides for monitors, boxSides for boxes.
- An act's start is a reload's end: C = 1, 2 run (a boss's script starts: RR3's timer 140, 139), 17 frames held, the
  pad acts from C = 3 (GG1, RR3, VV3 measured with cardt2.py). Sonic is put on the start cell's floor from the map as
  loaded (0x4FBC); PP3's InitLevel then lowers that cell (0x5D00 to 0x3D00) and holds the pad 50 frames: he drops in,
  at the act's start and at every reload (blank 44, then 32 frames to C = 1). The private emulator states are saved later (about 110
  frames on in RR3), so the boss traces run the world on first (PRE).
- Roll bounces: 0x41A0/0x41C0/0x41DE/0x4202 put him at the old cell's edge on the axis met and stop (or bounce) that
  part whichever way it points (after a diagonal piece's turn it may already point away: DD3 trace); rolling, 0x42A0 (x) /
  0x42E8 (z): the part negated and 0x4000 toward 0 (cleared, no turn, if it crosses 0; both 0 ends the roll), facing
  0x800 - f / 0x400 - f. A corner crossing with both ways blocked (0x3F20) puts him at the old cell's corner and
  0x442C: both parts back as above, facing + 0x400 whatever the speeds (PP3 ex3 frame 359); not rolling, both 0.
- PP3 arms (0x12FA2): links k = 1..6 at shoulder + k ((claw - shoulder) asr 3) in 16.16 (y as 16.16 too), the claw
  its record; 174 links touch 27/21, 1A0 claws 22/24.
- 0x727C exactly: d5 = 2 reach, d6 = 2 lift (words); s = (d5^2 + d6^2) & 0xFFFF; l = isqrt(s), h = isqrt(-s & 0xFFFF)
  (0xBEFE: bitwise root of an unsigned word); d6 -= d5 h / l, d5 += d6 h / l (divs: truncated); both asr 2. Links i =
  1..4: z = (i d5 >> 2) + 0x820, y = (i d6 >> 2) + 0x80; fist z = reach + 0x820, y = lift + 0x94; then
  z = ((4 reach - k e5) >> 2) + 0x820 for k = 1..3 with e5 = reach - link 4's offset (y the same). Link records 0BC
  carry touch bytes 24, 24: Sonic dies in expl_8 at frame 56 exactly as the object scan says.
- Reloads (blank frames, then frames until the pad acts): GG3 44/30, GnG1 51/34, RR3 49/33, VV1 52/34, VV2 55/-,
  VV3 44/34, SS3 46/30: the load time differs by act.
- $0AF8 counts 3, 2, 1, 0 each frame in step with the 8/16/32 counts (= the 8-count & 3); SS1's (0x9D44) and SS3's
  (0x8940) spike count moves only when it is 0. SS3 (0x88F6): grounded on a 0xFF cell, +0x200, and with the count at
  0xA00 (before this frame's step) and $3E clear, $3E = -1: he is hit that frame. Off one: -0x200; >= 0xC00 -> 0xA00.
- 0x6F64: Sonic's cell word 0x4172 or 0x4174 (cells (57, 65), (58, 65): the pit in front of the statue), z <= 0x830
  and y <= 0x70, $3E clear: $3E = -1, a hit (a death in expl_8 at frame 40 of a third script; boss `pit`).

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
  target T = the middle of the cell one step that way (record + 32 that way), d4 the facing that way. Taken when
  $24 = 0, Sonic grounded, $0A18 = 0, $8E = $62 = 0, the record's frame $1E 0x56 or 0xB2, T - 12 <= his x, z < T + 12:
  $24 = 0x46, sound 0x5A, $34 = -d4 (0x800 for 0: he turns 0x40 a frame to it with the pad idle), $6C/$70/$6E = T and
  the record's y. While $6C is set his move (0x3424 -> 0x4330) is a whole unit a frame on each axis toward it,
  fractions and speeds cleared, no walls or floor. Each frame after: $24 - 1; at 0, $6C cleared and the pad nothing
  for 30 ($0A18; the rev lets go: the dash, 7.5 units a frame); else $0A18 = 2 and $0A1A = 0xEF (the dash button) once
  $24 <= 60 and his facing is d4, else 0xFF; the rev wait $5A cut to 6. Exact over SS1/SS2 traces (sim `p.boost`).
- The pad lock $0A18 (0x4BCC): counted down at each frame's start; the pad is replaced by $0A1A while the count was not
  yet 0 before that frame's step, so N replaces N frames.
- Script ends by placing him (negative word, 0x2F3C): x, y, z words (y is his own: floor + 8 style), facing, speed
  words with the fractions cleared, roll ended, sound 0xB6, the pad held 10 frames; no move that frame (0x4330 tail).
  Routines starting a script write his whole x and z only: the fractions stay till the first step clears them. The
  tube tables (0x120F8, 0x11998, 0x13464, 0x13BCA) take him only with $8E clear and the pad free ($0A18 = 0).
- Scripts done (0x8000 then 0, 0x2FA2) leave his speed, roll and top as they were: the SS loops (state 4) carry the
  supercharger's dash on (converted rides without a speed: `keep`). The routines take a ride's cell the frame after
  he enters it, with no rest after the last ride.
- Walls in the air (0x40D6) are met at his height after this frame's fall or rise (0x373A moves y first): rising by
  a ledge he is over it once 8 under its top.
- SS1 opener (emulator): supercharger -> loop at (37, 117) (state 4; pad F5 = run east held 140 frames from the
  loop's start) -> floor spring (46, 115) up onto 0x31 -> supercharger (1632, 384, 3680) -> loop (61, 115) -> loop
  (77, 113) -> downhill.
- Gates (SS1 InitLevel 0x9526, SS2 0x8DEA): cells raised 0x20 over the floor across corridors (SS1 (33, 116..117),
  (41, 114..115), (52, 114..115), (62, 38..39), (50, 40..41); SS2 (64, 104..105), (76, 102..103), (84..85, 78),
  (86..87, 71)), drawn by 038 posts. The routine's flag (a4) is set while a supercharger record is at state 0xF (fired)
  and cleared when Sonic's cell word +0x8C is one of (SS1) 0x7354 (42, 115), 0x719A (77, 113), 0x277E (63, 39); (SS2)
  0x679A (77, 103), 0x46AE (87, 70; facing 0x400), 0x4FAA (85, 79; other facings). While it is set the gate cells go
  into the list at $CC92 + $0AD2 each frame (passable). Ring doors: SS1 (33..34, 78) 0x8500 until ring 1; SS2
  (61..62, 110) 0x4100 until ring 1, (123..124, 51) 0x6500 until ring 2. Checked in the sim: the SS1 opener (two
  superchargers, loops) runs through as in the emulator.
- Floor springs (low byte 0x55, end of 0x9974): grounded -> $16 = $72 = -7.875 (0xFFF82000; set after his move: the
  next frame's gravity comes first) and $086A = 50 (sound 0xB1). Spring 018 (0x18968): -8.5 (0xFFF78000); 08C
  (0x189EE): -7.0; both also $086A = 50. The scroll (0x19A4, a6 = $084E) while $086A counts down aims the lead's y
  at -156; $084A/$084C (if set) replace its target; $083E/$0840 are its speed limits. Bumpers (0xFF, and tables
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
  band, else (+-4, +-4) off the long side; pad 20 frames; sound 0xAE. The once-flag $C(a4) is cleared whenever he is
  in none of them or more than 16 over his floor (0x93D0), so a fall into one bumps as he comes within 16. The routine
  then calls the bumper helper (0x9974), which counts the ice down the same frame.
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
- Objects: 044 Sonic heads (see Lives and deaths); 13C, 140, 154: animation only (13C and 140 take themselves off at frames 0x12 /
  0x0A, 0x1A; 154 runs a script the routine sets): nothing to touch, not drawn.

## Diamond Dust 1 (2026-10-27; dd1_dis, runlog.py, flow.py, simrun.js)
- The game places Sonic at the start table's first [x, z] (header +0x20), not at the 030 object; both converters now
  read the table first.
- RunLevel_DDz1 (0x1009E): pads 0CC in pairs (tables from 0x108C4: pad 1 sends to pad 2 once ring 1 opens it, pad 3
  to pad 4 after ring 2). Ride states with bit 15 are mirrored: (x, z) -> (-z, -x), facing (0x200 - f) & 0x7FF
  (state 0x8004 at (89, 50) watched in the emulator; a plain x/z swap was wrong).
- Cells: ice chute x 39-40, z 52-70 (grounded: +0.25 units a frame per frame south, steered to x 1280, pad let go)
  into state 0x3A at (40, 70) (0x101FE: cell word 0x4650; $64 = 0x3A, $66/$6A cleared, pad lock $0A18 = 0x50 with
  $0A1A = 0xFF, $12 = 0, $1A = 0x78000 (7.5 units a frame south, kept through the move and after it), $16 = 0, $44/$48/
  $4A cleared, $56 = 2, $94 = 2); during the move the scroll follows and the animation player runs on (anim 2); the
  move's first step drops the position's fractions. Exploration trace expl_9 exact to frame 549 (position, animation,
  scroll) since 2026-10-27; dash east at (54, 65) under y 704 (7.5 units a frame for
  24 frames, a jump at 6 a frame on frame 14); sled at (78..79, 66) (pulled to (2528, 2128), then +0.0625 a frame per
  frame south for 300 frames) into state 0x3C at (86, 81); currents x 110-113 z 55-89 (up to 2 a frame) and x 50-53
  z 83-99 (up to 3), +0.375 a frame per frame south; snowdrift springs at (94, 39), (90, 39), (80, 39) (rise 40).
- Snowblowers: table 0x10976 (7), fired like flamethrowers; a blast freezes Sonic (time not measured: 1.5 s used).
- Airborne, Sonic is lifted onto a ledge whose top is within 12 units above his feet (the current to ring 2's ledge).
- DD1 gates (InitLevel 0xFF9A): (88..89, 54) and (90..91, 47) raised to 0x6D00, listed open while $4(a4) is set
  (a supercharger record at state 0xF) until (91, 46); (86..87, 75) to 0x5900 and (78..79, 67) to 0x6500, open while
  $18(a4) is set (the sled run) until (86, 74). Stepping on (38, 76) raises (37..38, 75) to 0x7D00. DD2 (InitLevel
  0xF946): (77..78, 95) to 0x4100 and (91..92, 106) to 0x3900, open while $4(a4) is set (record at state 0xF) until
  (91, 107). The routine's cell word +0x8C is the map offset (z << 8 | x << 1), the same as the gate lists.
- The sled (watched frame by frame, DD1): pulled to (2528, 2128), then the routine holds the pad again every frame
  and adds 1/16 a frame along Sonic's facing (four ways) until the ride at (86, 81) ends it; on ice his speed tops out
  at 5.03 a frame. He is a point: where his next place has no floor he stops at his cell's edge and, on a corner
  piece, turns a right angle off its diagonal (e.g. south at x 2528 to z 2751, then west; west to x 2464, then south).
  The loop: south down x 78-79, the south-west stairs, south on x 74-75, south-east stairs, east, north-east stairs,
  north-west stairs, north on x 86 to the jump. In the sim the turns land within a few units of these.
- Warp holes (routine 0x10350, watched): landing on (57, 50) from the air ($1A(a4) set while airborne over it) hops
  Sonic 4.5 up and lists (57, 50) and (59, 72) as open for good ($1C); falling into (57, 50) under 0x320 puts him at
  (0x770, 0x1E0, 0x910) under (59, 72), into (59, 72) under 0x1C0 at (0x730, 0x340, 0x650); held while the camera pans
  (about 105 frames), then thrown (-2, 8.5 up, -2) in a ball; he lands at (1872, 544, 2288). The sim lands there too.
- Thrown out of the warp hole against its edge, he goes on once over it (the wall rule in Movement: rising within 8
  units of a floor puts him on it); the sim, with the original's walls, lands where the original does.
- (86, 74) after the sled run (0x1064E): $18(a4) and the ice flag cleared, Sonic's states reset, sound 0x59 and a
  burst of ten pieces at (0xAF0, 0x1D0, 0x950) ($A(a4) frames; drawn by 0x10E00). The sim plays the sound.

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
  $8E = 1, $94 = 0x12, sound 0x80 (only while $3E and $64 are 0: 0x1B9A2). Frozen (0x3050, each frame): $56 = 2;
  grounded with the jump word $46 = 1: a hop (vy 2 up, $72, sound 0x94), $88 - 1, at 0 the ice breaks (debris, $3E = 50,
  sound 0x80); else the pad is cleared (d7 0xFF) and $46, if not 0, set to -1. So the jump button hops him free. A hit
  (0x1B794) clears $88 and throws the debris (no safe time of its own).
- Puffs exactly (dd3 traces, puffrep.py, tch.py, kick.py): a slot ($26: 0, then 0x16C down by 0x34) starts when the pod
  record's y is 0xB0, $30 + 1 < 120 and the 3-count $0AF6 is 0: $1E = 0, $1C = 0x20, $1A = self, sums cleared (if its
  blower's $12 is off the slot is switched off instead). Handler 0x165CA: on the 2-count ($0AF4 not 0) its list 0x16646
  steps ($1C: 0x20, 0, 4, .. 0x1C, 0x20, held); touch bytes 27/24 unless $1A (the frame drawn last frame) is 0x20; y = pod
  - 16; x = blower x word (pod - 1 + sin >> 10, fraction 0) + sin x 16 + (sum += sin x 4), z with cos (pod + 1). The
  blowers' angle is $24 before this frame's + 0xC. The chase's octant uses Sonic after his move and the pod record from
  the frame before. Touch (0x1B846): the display list is sorted by the keys (record word 0) of the frame before; objects
  after Sonic pass when K - Ks + 0x20 > 0 and, as a signed byte, >= b4; before him 0x20 - (K - Ks) the same; then the
  picture boxes. A puff restarted past him this frame keeps its old side (seen: expl frame 479). The trace start state
  is 119 frames into the act (pod y 458 descending, $20 283, $24 0x588).
- Drop: at $14 = 30 a snowman (type 0E0, sound 0x51) at pod x - 2, z - 2, y 0xE0; it falls 4 a frame to the floor
  (records 2/3). Snowman handler 0x16992: attacked: broken; Sonic within 48 units each way: wakes ($1E = 6); at
  animation frame 0x2A: over 8 frames 8 snowballs (table 0x16A58: 1 unit a frame out in 8 ways, about 4 up), then it
  breaks (sound 0x59). Seen: a woken snowman hurt Sonic about 40 frames after landing.

## Volcano Valley 1 (2026-10-27; vva620_dis, vvhelp*, objshots.py, iceblock.py, mapdiff.py)
- Labels: RunLevel_VVz2 (0xA620) runs act 1 (level 13; its cell checks match that map), RunLevel_VVz1 (0xAE20) act 2,
  0x9EBA act 3. Each InitLevel sits just before its RunLevel.
- 0xA620 calls: 0xBBC0 rocks (0xAB42, 42), 0xB764 vents (0xA8F6, 6), 0xB9C2 lava spouts (0xA9AA, 10), 0xBA68
  (0xAB26, 2), 0xB900 fire bursts (0xAA5E, 5), pads (0xC9FC with 0xA826/0xA84A/0xA86E/0xA892), 0xB5C8 roofs (0xAA4A),
  0xBCEC (lava tile animation). Cracked walls: in (60, 55) or (66, 63), rolling, forward 0x4000 or more, facing
  0x100..0x300: the wall cell west of it drops 0x20 steps (map raised at the start), record 1 or 25 cleared, sound 0x59.
- 0xB5C8: roofs as Diamond Dust; then (with the fire shield, $0AC2 & 0x7FFF = 0x6C0, nothing) grounded on a 0x55 cell:
  hurt. 0xBBC0: 12-byte records; their cells start 16 units higher (xx00 -> (xx-1)FF, xx55 -> (xx+1)AA); grounded in
  one with $56 = 1 (just landed in a ball): it drops back (+0x0001 or -0x0155), Sonic thrown 4.5 up, sound 0x59.
- 0xB764: 30-byte records [cell, x.l, y.l, z.l, $38.l, word, partner cell, camera words]: grounded, not frozen,
  forward 0x2000 or less: drawn to the middle for 30 frames ($56 = 1, pad 0xFF), then airborne; landing: placed at
  the record's place; once the camera is there, thrown (-2, -8.5, -2) (sound 0xB6), pad back at $14 = 0xD0.
- Objects: 110 pads, 11C cracked wall pieces, 124 rock pieces, 12C jet lift (handler 0x177F6: rises 1 a frame toward
  +0x26 while Sonic stands on it, else sinks to +0x24; box 0x1F x 0x2F from the record, swapped with bit 3 of +0x16),
  120 fire (box 0x1818, none with the fire shield), 114 fireballs (move 1 or 2 a frame along x or z until their
  animation ends), enemies 100 (to and fro along x), 104, 108 scorpion (along z), 10C.
- Lava spouts (0xB9C2, 16-byte records [x, z, y, vx, vy, vz, phase, window], velocities x 16 / 0x10000): a fireball
  particle (template 0xD9DC; 0xDA12 with the fire shield, no touch box) every 8 frames while ((counter + phase) & 255)
  <= window, for records within 0xC0 of Sonic. Fire runs (0xB900, 0x28-byte records [x0, w, z0, h] + 4 x [x, y, z,
  flags]; timing table 0xB9A2 [frame, offset] pairs on a 0..150 count): fireballs (object 114) move 1 or 2 a frame
  (1.5 on average) along x, or z with flag 0x800, until animation frame 0x2A (42 frames); one hurt Sonic about 16 units
  away (vvfire.py).

- Fire bars, exactly (0xBA68): the first bar whose box holds the scroll ($084E - x <= w and $0850 - y <= h, unsigned)
  runs: records $D046.. (the act's first six 120s) get x + 0x11 i, and (y, z) << 16 + k (sin, cos) << 3 for k = 1, 2, 3
  (records 3..5 copy 2..0); angle $10(a4) then - 0x20; frame +4 every 3 frames. Sonic's cell word = the bar's
  ((z & ~31) << 3 | (x & ~31) >> 4) or + 6, z & 16 clear, y <= bar y + 16, $0AC2 & 0x7FFF != 0x6C0: $3E = -1.
- Fire bars (helper 0xBA68; VV1 table 0xAB26 (2), VV2 0xB25C (3); 14-byte records [camera box x, w, z, h, x, y, z]):
  while the camera is in its box, records $D046.. (object 120, line 3, frame 7) at x + 17k (k 0..5), y + r sin(a),
  z + r cos(a) with r 4, 8, 12, 12, 8, 4; a goes down 0x20 of 0x800 a frame (64 frames a turn). They burn (watched:
  Sonic hurt in the bar's middle cell), not with the fire shield.

## Volcano Valley 2 (2026-10-27; vvae20_dis, mapdiff.py)
- RunLevel 0xAE20: 0xBA68 (0xB25C, 3), spouts 0xB286 (16), fire runs 0xB194 (5), rocks 0xB484 (27), vents 0xB394 (8,
  skipped at cell 0x63AC while byte $956F is 0xFF, that is while the rock (0xBBC0 raises its cell to 0x24FF) on the
  partner vent 0x56A8 stands; at 0x63AC the routine also sets bit 1 of $068A and copies $0A48 to $D97C, record 62's +0x12,
  kept over a death: probably cosmetic), pads 0xB10C/0xB130, roofs 0xB386. Cracked walls: trigger (95, 114)
  facing west -> (94, 114) to 0x1500; (55, 62) facing north (0x300..0x500), z <= 0x7D0 -> (55, 61) to 0x3D00.
- Objects 118 (spiked balls): with Sonic past x 0xB90 and z 0xD10 (0xAEE0, signed word compares) the routine sets
  records 10..14's z to 0xE80 +/- (sine x 112 >> 16), alternate signs (0xE80 - d, not a phase of pi: they differ by a
  unit where the product is not whole), angle $C(a4) used then +8 a frame (& 0x7FE). Touched by the object scan (touch
  bytes +4/+5). Trace expl_12 (fitted angle 0x348 at its start) exact through a ball hit, a lava hit and a lava death.
- After a reload the original shows frame 0 (Sonic's $94..$A2 all 0) for 13 frames before its player runs again
  (not modelled). Object 128 (handler 0x176B6): +0x24 = 0: along x (z with bit
  3 of +0x16) at +0x28 + (sine << 7 >> 16) (63 units), angle +0x26 + 4 a frame; else stood on it shakes 64 frames
  (sound 0xD3) and drops to +0x28 (sound 0x96); no level's records use that kind (checked all 22 and VV2's RAM).

## Volcano Valley 3 boss (2026-10-27; vv3_dis, vv3watch.py)
- Init 0x9DF8 writes a path buffer of 37 [x.l, y, z.l] entries over map RAM (row 0); pod record y ($CCDC) 0x1E8.
- RunLevel 0x9EBA: pod y comes down 1 a frame to 0x58 (sound 0x9E). With the pod at 0x58 and Sonic's x and z - 0x7F0
  within 0x40: airborne with $56 = 1: hit (speed reversed, vy -5, pad 30 frames, $3C - 1, sound 0x59; pod frames at
  6/4/2 left), else hurt; $38 = 60 between. At 0 left: 240 frames of explosions as the pod rises, then the act ends.
  Grounded in cells 0x407E, 0x4082, 0x3F80, 0x4180: hurt. Grounded at y 0x40 (the lava): burnt (as 0xB5C8); 0xA2C2
  compares the whole-unit feet-frame y with 0x40 exactly (page: `b.lava`, BOSSES[14] 0x40 + 8).
- Serpent: counter $1C to 0x1FE; at 0x10E the head is put at (0x834, 0x5C, 0x830) (sound 0x4E); from 0x118 it heads for
  Sonic (table 0xDBEE, turn = random & 0x3F + 0x10 a frame), sine x 4 per frame (2 units), y a unit a frame toward
  Sonic's + 0x10, not under 0x60. Each frame the head goes into the ring buffer; nine segment records (138) read it
  back 4 entries apart (12 more after the fifth). At 0x1FE all are put away (x 1).
- Every 10 frames record 9 (134) is put at the next of eight vent places (table 0xA3B2: [record offset, x, y, z], or
  (0x10, 0x60, 0x800) if that vent record is off); if a serpent segment comes within 0x20 of it while $4(a4) is 1..4,
  the vent is put out (sound 0x83).

## Gene Gadget 1 (2026-10-27; gngprobe.py, gngseq.py, emulator)
- RunLevel_GnGdz1 0x11D2A each frame, by Sonic's cell d7 ($8C):
  - 0x7676/0x7678 north of z 0xED0 while record 27 (+0x12) is on, 0x5EEC/0x5FEC west of x 0xED0 while record 30 is: hurt,
    facing 0x400 / 0x200 (thrown back). InitLevel raises the walls behind them to 0x2D00 (58..61, 117) and 0x4500
    (117, 93..94); the ring code lowers them (0x0D00, 0x2500) and turns the records off.
  - 0x6582/0x6682: vx 6 (facing 0x600); 0x5E94/0x5E96: vz 6; sound 0xAE.
  - Boxes at 0x11EE4 (4 x [x, z], 64 units): surface = distance in from the nearest edge (by the diagonals); under it:
    out across that edge at 5.5, vy = the speed coming in, $56 = 1, pad 0xFF for 10 frames, sound 0xAE, 2 frames apart.
  - 0x7076 (any height, no ride on): ride state 0x18, pad 0xFF for 340 frames (the supercharger's lane).
  - Record 1 (024) at state 0xF: flag; while it is up, cells 0x7074, 0x7076, 0x5988, 0x59AA go into the $CC92 list
    (passable); cell 0x5A88 clears it. InitLevel raises 0x7074/76 (0x2D00), 0x5988/8A (0x4900), 0x466C (0x5100).
  - Grounded, no ride, pad free: table 0x120F8 (10 x [cell, x, z, state, effect x, effect y]): Sonic put at (x, z),
    $56 = 2, the state played (tubes). State 6 at script offset 0x10 (4th segment): with $0A8E (Flickies following)
    = 5, state 0x1A (to the last ring) instead; else sound 0xB2. Sound 0x3C each segment.
  - Roofs table 0x12254 [cell, cell, top] as Diamond Dust's.
  - 0x55 cells: $0ACC; grounded: $84 = 0x30 (hover), pose 0x0C, sound 0xC1. Hover (0x2E84, vy up negative, 16.16):
    vy -= 0x4000; line = floor + 0x30; under the line vy -= 0x2000, and if y + vy crosses it with vy >= 0x18000 (down),
    vy = vy / 2; over it vy += 0x2000, halved the same way when crossing upward with vy <= -0x18000; then gravity.
    Flickies on 0x55 cells lifted too (0x6000 a frame).
  - 0xAA cells (helper 0x122C6): entering one grounded puts one of four 068 records (cycling) there with $1E = 6;
    068 (0x17B40) steps its animation every 2 frames; from index 0x1C (22 frames) Sonic grounded on that cell is hurt
    ($24 cleared), unless $0AC2 & 0x7FFF = 0x46C0 (the blue shield; monitor kinds by (kind + 1) * 0x80 at 0xC12E).
- Objects: 07C (0x174B4) turns 0x10 a frame; woken within 80 units; while $0B02 (counts 15..0) is 0, a shot: from 16
  out, 17 up, (sin, cos) x 2 units a frame, vy -0.25, gravity 1/32 (template 0xD9CA); hurts. A 16 x 16 platform on top
  that turns Sonic. 06C pylons (the barriers' posts; followers copy the leader's frame). 070 a door at (54, 70).
  05C patrols a unit a frame between +0x24 and +0x26. 060, 064 enemies.
- Rolling (watched in GG1 and in GnG1's supercharger run): walls reflect the roll; corner pieces (one corner two steps
  over three level ones, against the void) turn it a right angle on their diagonal (Sonic a point: within a unit of
  a wall). Slope pull while rolling: about 0.045 units a frame per frame per unit gradient. The supercharger run keeps
  7.48 units a frame through ride 0x18's hop.

## Gene Gadget 2 (2026-10-27; gng2_dis, gngseq.py)
- InitLevel 0x11540: raises 0x613E to 0x8500 and 0x4088 to 0x8900 (doors), and at section 0 (49..52, 69) to 0x6500
  (the barrier's wall; ring 1 lowers it to 0x4500 and turns records 22..24 off).
- RunLevel 0x115E2: barrier cells 0x4664/0x4666 north of z 0x8D0 (record 22 on; facing 0x400); 0xFF cells hurt a
  grounded Sonic; from cell offset 0x4B00 on, 0xC3 slides east and 0xF0 south (0.25 a frame per frame up to 4, 15 frames
  after); the chute (cells x 50..53, z 83..108, no ride): pad 0xFF 200 frames, $56 = 2, facing 0, vz + 0.25 a frame
  (watched: capped at 8.19), x steered to 0x680; at 0x6B68 ride state 0x20 with vy -5.5 (kept through it, landing on
  (51..52, 111..112)); speed pads (0x11930: vz 6; 0x11942: vx 6); tubes 0x11998 (6 x 12 bytes as act 1's; 0x5D28 and
  0x4EA2 also open the doors 0x613E / 0x4088 until 0x6140 / 0x408A); roofs 0x11AAA; with the pad held and record 1
  (the supercharger) at frame index 0x48, cell 0x692A starts ride 0x1E (vy -5.5 kept): the hop up to the next level;
  cells 0x11B84 set $7A (also VV2 0x5CE6/0x5CE8, VV3, others: read only by the sprite builder at 0x198B0, which then
  calls 0x19B12 with -1, a drawing order matter: nothing to do in 3D); zaps and hovers by the helper at 0x122C6.
- 078 platforms (0x178D6): along z (x with bit 3 of +0x16) between +0x24 and +0x26 a unit a frame, 60 frames' rest at
  each end (sound 0x92 going again); +0x28 way, +0x29 first rest; +0x2A the second half (+0x20 across, box 32 x 64,
  else 32 x 32); a negative +0x2C marks the second half.

## Gene Gadget 3 boss (2026-10-27; gng3_dis, gngseq.py)
- InitLevel 0x110BA: pod (record 0, 048) x 0xE04, y 0x1D0, z 0x240; target y 0x40; lanes base 0x10 (off); hits 8.
- RunLevel 0x11126 per frame: generic check 0xF794 (a hit sets t = 0x1DF, lanes 0xDD0); belt (once on): grounded:
  facing 0x300..0x500 with the pad pushed: vz = -0.5; else vz + 0.25 while <= 1.5; leaving it: vz at least 2;
  z >= 0x380 grounded: hurt. Timer t: 0x190 sound 0x93; 0x1B8 belt on, lanes 0xDD0; 0x1E0 target 0x70; 0x30C lanes off
  (0x10); 0x370 target 0x20; 0x3D4 and 0x46A record 5 (164) dropped at (x - 7, 0, z + 6), 0x3E8 and 0x47E record 6 at
  (x - 0x12, 0, z + 6) (sound 0xA0): z + 4 a frame for 80 frames, then blown up (0x114EA, sound 0x59); 0x406 lanes on;
  0x500 back to 0x1E0. Records 8..13 (16C): z + 1 a frame; at 0x378 blown up and put at x = (random & 3) * 32 + lanes,
  z 0x1C8 (watched: they hurt). The end row's hurt sees $3E before Sonic's count this frame (his last safe frame
  still holds). Pod y toward the target a unit a frame; from 0x1E0 x = 0xE04 + sin * 32, + 0xA a frame.
  Record 7 (168) at (x - 2, y - 16, z - 2). Roofs 0x11482 (the row under the pod, top 32). Belt tiles: 0x40 bytes from
  0xDE8FE + 0x40k to VRAM 0x20 a frame while on.

## Panic Puppet 1 (2026-10-27; pp_a_dis, gngseq.py, objlist.py, emulator)
- Labels swapped as in other zones: InitLevel 0x13336 (labelled PPz1) and RunLevel 0x133BC (labelled PPz2) run level
  20 (PP1); RunLevel 0x13B7E (labelled PPz1) is level 19 (PP2). PP3: Init 0x1258C, Run 0x1268A. Final Fight 0x14170/0x142C0.
- InitLevel raises map cells (68, 97), (68, 98) to 0x4100, (40, 62) to 0x6100 (gates: a per-frame list at $CC92 of
  cell offsets lets them through while the key $18 is set; negative offsets are walls: the roofs helper 0x14040 uses
  them for airborne Sonic outside the roof cells) and (48, 48) to 0x6900 (cracked wall: map back to 0x4900 when Sonic,
  in cell (48, 49), z <= 0x630, rolling ($56 = 2), fast, facing 0x300..0x500, so a spin dash there; sound 0x59).
- Tubes 0x13464: 8-byte records [cell, x, z, state], taken grounded (not with the pad held by the routine), sound 0xAD;
  states 0x58..0x5E keep Sonic hidden ($76 = 1) except in their first segment; state 0x5A sets the key. (69, 98)
  with the key: key off, flag $1A on; (40, 63) with the key: key off, $1A off, sound 0x64.
- Levers (194, handler 0x16136): value word +0x24, frames by the list at 0x1616E (0 for 0, 7 for 1; sound 0x76 when it
  changes). Switch cells set them (grounded): (31, 92) / (31, 91) lever 7 = 0 / 1; (44, 78) / (44, 77) and (86, 63) /
  (86, 62) levers 8 and 9 = 0 / 1. Belt way $1B = ($1A ? lever 8 : lever 7) == 0 (west); belt tiles (VRAM 0x1320,
  0xDE8FE) run backwards while west.
- Belt 1: grounded in x 0x480..0x51F, z 0xB60..0xB9F: held (pad, $0A18 = 2), carried a unit a frame on z 0xB80;
  west: let go at x <= 0x477; east at x >= 0x520: ride 0x56 (roll, vx 7, pad held 220 frames, key, sound 0xAB); at
  the end of its last segment ($66 = 0x10, $6A = 1) Sonic is put at (0x860, 0x100, 0xC40), walking on at 7 a frame and
  stopping at x 2249 (watched; the sim matches to a frame or two). Belt 2: grounded at y 0xE0 in x 0x7C0..0xABF,
  z 0x9A0..0x9DF, on z 0x9C0, let go past 0x7B7 or 0xAC8, hidden in x 0x920..0xA80 (a tunnel through a block).
- Slides: 0xC3 and 0xF0 cells (grounded, $8A clear): +0.25 a frame up to 4 along x while x <= 0x960, else along z;
  15 frames after leaving. Hover 0x55 and zaps 0xAA as Gene Gadget's (also lifts Flickies over 0x55 cells).
- 178 (handler 0x15E20): patrols x or z (bit 3 of byte +0x16) between +0x24 and +0x26 a unit a call (up while word
  +0x28 is 0, down otherwise; past an end it is put on it and +0x28 flips), when $0AF4 (2, 1: = the 8-count & 1) is 0,
  only while on screen (0x16528 and 0x17E80 the same); its shot: template 0xDA24 (touch 24/0, gravity 0x1000, life
  0x70), vy -1, gone at a wall (watched). Half a unit a frame on average (Gene Gadget's 05C and Volcano Valley's 100
  too); when $0B04 (31..0) is 0, a shot
  (template 0xDA24) 16 out and 12 up, 2 a frame from table 0x15EE8 (E, S, W, N; index +0x2A += 12), vy -1, gravity
  1/16, gone where the floor rises over it (watched: a slope 2 cells on), sound 0x9A.
- 19C (handler 0x1680C): Flicky capsule: a platform box at (x - 15, y + 32, z - 15) 30 x 30 ($CC4A list); touched
  from the air: vy -5, ball; then broken (0x192C2: sound 0x3D, Flicky by byte +0x19). Routine 0x192C2 frees a Flicky
  only for byte +0x19 = 1..4 (colour; counts $069A..$069D): Scouters (058) and 178 hold none; in PP1 the capsules
  hold the five.
- Freed Flicky (0x192C2): a particle (template 0xD982) at the holder's position, vx = vz = 0, 4 up, gravity 0x2000,
  no life limit, type = colour 1..4, way $36 = 0; $0AA4 = 30 (no Flicky caught for 30 frames, after any release); a
  catch needs $0A8E (following) < 5 (0x1BA44; sound 0x38). Landing (0xD49C), y put on the floor, no 3/4 bounce:
  type 1 turns (0xD5FA) and hops 1.0 up; 4 turns and hops 0.5; 2 hops 0.5 and steps $36 one way by bit 0 of the
  random byte; 3 hops 4.0 with $36 - 7. The turn: target (4 - 2·octant to Sonic) & 15 (octant from the 0xDBEE byte
  table, as 0xDBAE); $36 - target as a byte: 0 stays, else (& 15) > 8 adds 1, otherwise subtracts 1, and $36 is not
  masked after it (a $36 of 0xF8 against target 8 wobbles a sixteenth each landing). Then speed 1 unit a frame:
  index ((0x12 - $36) & 15) << 6 into the sine table, vx = sin·2, vz = cos·2. Walls as a lost ring's, but type 2
  stops at the edge with its speed kept; the others reverse that part and mirror $36 ((4 - d) & 15 off an x wall,
  (12 - d) & 15 off a z wall).
- Following Flickies (0x56FC, each frame after Sonic's move, before his animation 0x1492 is chosen): history at
  $CAC2, 20 records of 16 bytes (x, z longs, cell, facing | sign, $72 word, y), index $0A60; follower slots at $C9DC,
  0x2E each ($0A8E of them; $6 x, $A z, $E y longs, $1A vy, $16/$18 offsets, $5 colour); follower k takes the record
  3 + 4k frames old. $72 (Sonic's launch: jump -0x5A000, the let-go's new speed with its low byte 0xFF, springs' and
  other objects' constants) is kept as ((it, negated when its low byte is set) << 4) >> 16 and cleared. Animation 0
  or 0xB last frame (0: grounded, no crouch/jump/roll state, x and z speed 0): $0AA1 up 1 to 32, $0AA8 up; else
  $0AA8 = 0, $0AA1 down 2. With $0AA1: offsets (sin, cos)·$0AA1 >> 16 + 2 at byte angle $0A9E + 0x19A k (wrapping
  0x800), $0A9E + 0x18 a frame unless $0AAA = 10; the offset moves x then z from the record, stopped at the cell edge
  by a cell with no floor or a corner 24 or more over the follower (corners as a lost ring's). y: a record word < 0
  puts it at the record's y with vy = word·(0x1000 + 0x200k); > 0 gives vy = -word·(...) from where it is; else vy +
  4·(0x1000 + 0x200k), at most 7, landing on the record's y. $0AA8 = 0xF0: $34 = 0xF900 (the turn routine turns to
  exactly -$34 & 0x7FF = 0x700, then $34 = $32); there, with no box under him and his cell's height byte not over any
  of its 8 neighbours', $0AAA + 1 when $0AF6 (period 3) is 0, to 10; animation 0xB. Otherwise $0AAA - 1. Checked
  exact against two emulator traces (stand, walk, jumps with let-go, walls; 420 frames standing).
- A hit (0x1B6C2, rings or not) sets $0AA6 = followers; 0x5E48 then frees the last one a frame: a particle of its
  colour at its x, y, z, 1 unit a frame at the lost rings' angle $0A54 (then + 0x480), 3 up, $0AA4 = 30.
- Sine table 0x276E8: floor(sin·0x7FFF) except entry 0x400, which is 0.
- Sonic's animation: chooser 0x1492 (after the Flickies, so they read last frame's): $94 kept at 9, 0xA, 0xC, 0xF,
  0x11, 0x12; $5C → 0x10; 0xD (spring) becomes 1 once vy >= 0; $56 = 3 → 7, other $56 → 2; in the air as it was;
  $60 → 3; $12 = $1A = 0 → 0 ($62 = 0) unless 0xB (bored; at script $A2 = 0x228 a random word <= 0x6000 jumps to
  0x230, <= 0x8000 to 0x254) or 0x13; moving: $1E < 0 with the pad let go ($5E) → skid 4/5 when the side word $20
  passes it, else 6 ($62 = +-2); $1E >= 0: with $62 = 0, |$20| >= $1E and >= 0x4800 (0 let go) sets $62 = sign (sound
  0x36) and keeps the animation, else 1; with $62 set, $20 beyond 0x3000 (0) gives 4 (5 for $62 < 0; 6 for +-2),
  else $62 = 0 and 1. Skids drop dust (0xD1B8). Player 0x16AC: $94 new → $96 only; next frame (if still) → $98, $9C =
  0, $A0/$A2 from table 0x25BC2 (6 bytes each); then $9C += the entry's rate (view table 0x16: forward speed's high
  byte, at least 0x20, / 4); at 60 the next entry ($A2 + 4; an entry -1 goes back by its rate; 0: restart); the frame
  shown is the entry before that step. Views 0x25C3A ($A0, 0x16 bytes): ((facing + 0x100) & 0x780) >> 6 = 0..0x1E;
  type 0: >= 0x10 mirrored as 0x20 - it, frame + word 0 (minus twice it at word 1), + word (4 + it); else one side
  (type > 0 mirrored), > 0x10 adds word 0x14 too. Frame < 0: that frame, no view. Mirror: $3C bit 3. Frames are the
  0x100000 table's. Exact over 1100 emulator frames (GG1, VV1: walk, turns, crouch, rev, dash, ball, landing).
- Screen speed (0x3BB2, every frame after the diagonal pieces): (x - $4E) + ($52 - z) in whole units over 8: x - 1,
  z + 1; under -8: x + 1, z - 1.
- After a reload the pad reads as nothing until 33 frames after Sonic reappears (85 after the reload).
- Scroll (0x19A4 on $084E, after the Flickies): lead $0866 toward (high byte of sin word at byte offset
  -(facing + 0x100) & 0x7FF) asr 1 - 0xA0, 2 a frame; $0868 toward (high byte of the word 0x200 on) asr 2 - 0x7C, 1 a
  frame ($086A > 0: -0x9C, counting down); target = Sonic's $38 / $3A + lead (or $084A / $084C when set); the scroll
  adds (target - it) asr 3, at most $083E / $0840 (8) each way (0 when $0A36), then kept in $0842..$0846 (0..0x1EA0)
  and $0844..$0848 (0..0xF20). Act start: lead at its target, scroll = (point + lead) & ~7. Exact over a 729-frame
  GG1 trace. Sonic's $38 = high word of (x - z) + 0x1000, $3A = high word of ((x + z) asr 1 - y's whole part).
- Rings (list $E608, 10-byte records as in the level block: +0 sort key, +4 screen y of the base (sign: which way it
  was found), +8 cell; routine 0x19EAA each frame for rings on screen): caught when Sonic's cell $8C is the ring's,
  (x & 31) and (z & 31) differ by at most 16, and $3A - |+4| is -16..24 (sound 0x33). Exact on a GG1 trace.
- Point walls across a corner (jump table 0x3C1A by the cell change): the cell reached at the point first (floor 9
  or more over his whole-unit y blocks; no floor blocks); else the cell z alone reaches, by its corner on the near side
  toward x's way ($8C moves in z, x stops at the cell edge), else x alone by its corner toward z's way, else both stop
  at the old cell's edges.
- Touches (0x1B846 list scan by sort key = (x + z) / 2; objects 0x1B8FE, particles 0x1B9F0; measured on a GG1 enemy
  and a PP1 sprinkler shot): an object with touch bytes b4/b5 (record +4/+5) touches when |picture x - his| <= 0x2C -
  b4, |key - his| <= 0x20 - b4 and |y - his| <= b5; a particle (b4 24, b5 0) when |x - z - his| <= 20, |key - his| <= 8
  and its y - his is -16..32 (its $12 = x - z + 0x1000 - scroll + 8, $14 = (x + z) / 2 - y - scroll y). Types 5 and 8
  hurt (the particle goes, spark sound 0x9A, even while he blinks); type 0 is a ring. An enemy hit while attacking
  throws him (in the air) exactly 5 up.
- Particle templates (0xD8C6: +0 touch bytes, +2 gravity (low word of $22), +4 attr, +6 art, +10 flags/type, +12
  life, +14 anim): 0xD982 Flicky (1/8), 0xD9B8 058 shot (type 5, 1/8, 512 frames), 0xD9CA sprinkler / 064 / 0C8 / PP2
  beam shot (type 5, none, no end; the sprinkler sets 1/32 and 0.25 up). 058's rise: -0x40000 + ((count << 8) << 4 in
  a word): 3.5, 3.125, 3.75, 3.375 up. Particles move after the objects each frame (a new one moves at once).
- 0C8 (0x16B40): runs the table step only on the dispatcher's count (+0x21 down from rate +0x20: every other frame):
  $1E + 2, frame = word at 0x16C7E + $1E (-1: back by the next word), >= 0x190 mirrored (less 0x190), unmirrored
  0x80 - it; 4 mod 16 fires (16 out, 20 up, sin x 4 a frame, sound 0x4D). Every frame it moves by $1E: 0x30..0x6F z-1,
  0xA0..0xDF x-1, 0x110..0x14F z+1, 0x180..0x1BF x+1. Exact on a DD trace (c8trace.py, c8_parity.js).
- While Sonic rises dying, objects, particles and the scroll go on; at the top everything stops till the reload.
- Object dispatcher 0x1BE72: records from $CCD2 (0x34 each; +0x12/+0x14 its picture point = x - z + 0x1000 + ox and
  (x + z) / 2 - y + oy, ox/oy from its art header at +0x30 = table 0x280E8 by type: [width, height, ox, oy]); it runs
  the handler only while (point - scroll) unsigned is at most width (x) and height (y).
- Palette line of an object's sprite: bits 13-14 of word +0x16 (178, 194, 19C: line 0).
- Ring used: $0A18 = 0x5A, camera to (0xA94, 0x634) (not modelled). Fans: 16 tiles 0xDD8FE at tile 125, speed
  $0ACE up to 0x40 while hovering (here steady).

## Panic Puppet 2 (2026-10-27; pp_b_dis, gngseq.py, emulator)
- RunLevel 0x13B7E (labelled PPz1) runs level 19; InitLevel 0x13B38 raises (67, 63) to 0x5D00 (cracked wall: map back to
  0x3D00 when, from (67, 64), z <= 0x810, rolling fast north; sound 0x59) and sets $0A92 = 5. No big rings (start
  table +0x12 = -1): the act ends ($0A1C = 1: the main loop's act-clear) 110 frames after the lift.
- Lift: grounded in x 0x810..0x830, z 0x620..0x628: held at (0x820, 0x390, 0x628), pad held 120 frames, $94 = 2,
  sound 0x3C; 30 frames later ride 0x54 (sound 0xB6), Sonic in a ball.
- Tubes 0x13BCA: six 8-byte records, states 0x46..0x50, Sonic hidden all the way ($76 = 1), sound 0xAD in, 0x3C out.
- Belt A: grounded in x 0x6A0..0x73F, z 0xB00..0xB3F: carried a unit a frame east on z 0xB20 (on the floor: it rose
  33 units up the belt's slope, watched); at x 0x740 ride 0x52 (roll, vx 7, pad 120 frames, sound 0xAB): 224 units
  down onto the floor below, walking on and stopping at x 2143 (the sim matches). Belt B: x 0xA20..0xA5F, z
  0x720..0x79F: carried south on x 0xA40, let go at z 0x7A0.
- Cells raised for good once Sonic steps into a trigger (map writes): (65, 86..87) to 0x5500 from (66, 87); (63..64,
  33) to 0x9100 from (63..64, 34) (sound 0xC9); (67..68, 45) and (71..72, 45) to 0x9100 from row 46, x 66..72 (0xC9);
  (89, 45) to 0x4D00 from (89, 46) (0x64). The door objects' +0x1E is set to 6 (closing).
- Slides: 0xF0 cells only, south (+0.25 a frame to 4, 15 frames after), not in columns 85 and 86 (low byte 0xAA/0xAC).
- 180 beam posts (handler 0x15F60): animation list 0x16030 (24 steps, 9 frames each, watched; frame offset 0 in steps
  13..20); while frame 0 shows, a shot every 8 frames (watched) 16 out along z (x with bit 3 of byte +0x16), 16 under
  the record, 2 a frame, no fall (template 0xD9CA, or 0xDA36), gone in the wall; sound 0x78. +0x1E: starting step x 2.
- 17C (handler 0x17346): every (random & 15) + 1 calls a random way (bytes: 0 back, 1 on, else still, each axis) plus a
  random jitter of -2..1, a unit a call, kept in the 64-unit square from +0x28, +0x2A; breakable, holds no Flicky.
- 18C (handler 0x17606): a 31-unit platform at (x - 1, y - 1, z - 1) rising a unit a call while stood on to +0x26
  (sound 0xD2), sinking back to +0x24. 188: the cracked wall's sprite (handler 0x18880, as PP1's 198).

## Panic Puppet 3 boss (2026-10-27; pp3_dis, gngseq.py, emulator; level vars a4 = 0xFFFF0B6C)
- InitLevel 0x1258C: pod (x.l, y, z.l) = (0x561, 0x390, 0x540); arm A at a4+0xA {x.l, y, z.l, timer, hits 4, flag/phase
  +E, phase +10} = (0x590, 0x220, 0x590), arm B at a4+0x1C (0x5B0, 0x220, 0x570); delay $2E = 0x190; pod target $32
  0x200; stage $36 0. Map: (45, 44) to 0x3D00 (the start cell), the first 370 bytes cleared to a pattern (the serpent's
  path buffer, as VV3's).
- Pod: y -1 a frame to $32 (sound 0xBE); at a target other than 0x200: x 0x561 -> (0x661, 0x640, y 0x1A0), 0x661 ->
  (0x761, 0x740, 0x140), else gone. Records: 048 pod, 174 links (6 an arm), 1A0 claws, 1A4 shoulder cannons, 190 the
  pad's hatch, 138 serpent links (line 1), 02C/030 debris.
- Arena 1 (0x12BC2, per arm: rest, zone centre): flag set; dead: return. Timer: >= 0xA3 y + 1 (sound 0xC3 at 0xA3),
  0xA2..0x98 y - 8 (sound 0x81 at 0x98), <= 0x20 y + 2, else rest: Sonic not knocked back, y >= 0x1F0, in the
  shoulder's corner cell (A (42, 43) x >= 0x544 z <= 0x57C; B (44, 41) x <= 0x59C z >= 0x524): hit (timer 0x20, sound
  0x59, $34 = 0x46 frames of safety, $38 flash; 0 hits: sound 0x54), else every 8 frames sound 0x92. Timer 0: target
  Sonic if within 48 of the zone centre (dist^2 < 0x900), else the rest place; x and z step half a unit toward it;
  aligned (integer parts): timer 0xBB (sound 0x5A) or the flag. Watched: rise 544 -> 569, slam to 481 (floor 488),
  rests, 481 -> 545; the claw hurts at rest; a jump at (42, 43) during rest took a hit.
- Shoulder shots while both flags: $0B04 = 0 (B, from (0x590, 0x222, 0x530)) and 0x10 (A, (0x550, 0x222, 0x570)),
  template 0xDA24 (type 5, gravity 0x1000, life 112), vy -2, vx and vz two random words x 2 (0..2 units; B: the
  larger as vx; A: as vz), sound 0x4D. B reads words 0 and 1 from the pointer, A words 50 and 51 (matched in the
  traces; why 50 on is not known).
- Both arms broken: $34 = 0x64 each frame (Sonic safe); pod target 0x180 (arena 1) / 0xF0 (2); once the pod has moved,
  0x12FF4 / 0x13144: grounded on cell (47, 41) / (50, 54): held at (0x5F0, 0x1E0, 0x530) / (0x650, 0x180, 0x6D0),
  pad 80 frames, sound 0x3C, $30 = 0x37: at 0x27 put at (0x6F0, 0x2E0, 0x630) / (0x750, 0x280, 0x7D0) (in a ball,
  falls); at 0: stage + 1, timers A 0x190, B 0x2BC, hits 4, B's phases 0x400; otherwise 0x13272 every 600 frames pulls
  the pad toward the lift (not modelled).
- Arenas 2 and 3 (0x12D4C, 0x12EC6; rest A (0x688, 0x1A0, 0x6A8) B (0x6C8, 0x1A0, 0x668); +0x100, -0x60, +0x100
  for arena 3): dead: sink to 0x180 / 0x120. Timer - 1: > 0x78: x = rest + sin(+E) x 32, z = rest - sin(+E) x 32,
  y = rest + sin(+10) x 16 (table 0x276E8, 1024 words of +-32767), +E + 8, +10 + 0x12. Arena 2 at 0x78: the serpent
  (a4+0x3C; from the claw + (0xB, 0, 0xA), first toward + (0x100, 0x100), chasing Sonic once under 0xC8 of its 0xD2
  frames; routine 0xA3F2 as VV3's; five links $D07A..; sound 0x4E). Arena 3, timer <= 0x78: a shot a frame (template
  0xDA5A: type 8, gravity 0x2000, life 180) from the claw + (0xB, 0, 0xA), vx and vz = random word + 0x28000 (2.5..3.5
  units a frame), sound 0x78. Type 8 hops: vy = -2 at each landing, bouncing off walls; type 2 takes a direction from
  bit 8 of a random word (template 0xDA7E: type 8, life 160). Hit window 0x77..1 (y >= 0x190 / 0x130;
  cells A (50, 51) / (58, 59), B (52, 49) / (60, 57)): the arm hit waits 0x294 and the other 0x168 (alone 0x168);
  timer 0: 0x258 (0x12C alone). Arena 3 beaten: pod target 0xC0, $3E = 0x168: explosions (random, sound 0x59), then
  $0A1C = 1 (act over), score + 10.

## Final Fight (2026-10-27; ff_full dump, gngseq.py, ffobj.py, ffpart.py, emulator; level vars a4 = 0xFFFF0B6C)
- InitLevel 0x14170: machine (x.l $8, y $C, z.l $10) = (0x940, 0x190, 0x800); laser cannons' z offsets $14 -0x30,
  $16 0x30, x offset $18 0x10; state $20 0; hits left $3C 10; six doors shut (map words to 0x8500): 0x3C9C/E,
  0x4094/0x4194, 0x3198/0x3298, 0x3180/0x3280, 0x3772/4, 0x407C/0x417C; the first 370 map bytes cleared.
- RunLevel 0x142C0. $3E (final) counts down 360 frames with explosions every 8 (random offsets, routine 0x14D86), then
  $0A1C = 1. $26 (time up): a grounded Sonic loses his rings and dies (watched: about 611 frames after a fight ends).
  States: even = fights (0 0x15760, 2 0x1531C, 4 0x14DBE, 6 0x149B8, 8 0x14772), odd = walks: past a line (1: z <
  0x6E0, 3: x < 0x920, 5: x < 0x7A0, 7: z >= 0x7A0, 9: x >= 0x960) the two doors just opened shut again (sound 0xB8)
  and the next fight starts; else $24 counts 600 frames (sound 0xAD every 64, every 16 in the last 128; at 0 sound
  0x78 and $26).
- Common check 0x15AD4 (each fight, after its script): skipped while $38 or Sonic knocked back; within 31 units in x/z
  (squared 0x3C1), Sonic's y <= machine + 0x40: from + 0x20 and in a jump ($56 = 1) a hit (vx, vz negated, vy 5 up,
  sound 0x59, $3C - 1: left: $38 = 100, $22 = 200; none left: $38 = 8000, $3E = 360); lower, hurt ($38 = 60).
  $22: the fight's script stops; from 100 left the machine rises 4 a frame (sound 0x60 at 100) and drifts back; at
  0 the next walk: two doors open (0x6500), $24 = 600, and the next fight's start is set.
- Fight 0 (lasers, south-east room; machine in the door cell (74, 64)): rise 1 a frame to 0x320 (sound 0xC6 from
  0x220); wait 60; cannon x offset + 1 to 0x2C; [sound 0x9D; for up to 180 frames each cannon's z offset steps a unit
  toward Sonic's z (A -0x50..-0x10, B 0x10..0x50) until one matches; fire 192 frames: count & 63 <= 16 cannon A, 32..48
  B, a laser every 4th (template 0xDA6C: box 0x18, 3.5 a frame along +x, 112 frames) from the cannon + (0x19, 2, dz),
  dz +0xF / +3 / -9 for counts >= 0x80 / >= 0x40 / less] twice; then forward 1 a frame to 0x980 (cannons drawn back),
  wait 90, back to 0x938, loop. The room's west edge is x 0x960: only the forward move brings it in reach (watched:
  a laser 15 units off Sonic's z hurt him).
- Fight 2 (serpent, north-east room): sides A (0x978, 0x660) and B (0xA20, 0x5B8); down from 0x500 on the sine to
  0x300 (128 frames, sound 0xD0), let the serpent go (a4+0x3C: 300 frames, chasing Sonic for the last 200, routine
  0xA3F2, nine links $CF0E..; from A (0x9A0, 0x328, 0x658) heading +x toward + 0x100, from B (0xA18, 0x328, 0x5E0)
  heading +z), wait 60, up the sine (sound 0x73) and change sides; twice, then on the third: down, serpent, wait, up
  to 0x320, in (A: x to 0x9C0; B: z to 0x600; sound 0xBE), back, down to 0x300, up and change sides; loop from there.
- Fight 4 (fists, north corridor): machine at (0x8A0, z 0x5F8) up the sine from 0x150 to 0x350, holds, lets the fists
  go at count 0x300 (sound 0xB6) and rises to 0x550; fists (records $CE72, $CEA6, at machine - 0x40 / + 0x30 x, + 0x10
  y while held) to z 0x640; three times: 240 frames the fist on Sonic's side (B when x >= 0x8A0; A x <= 0x890, B >=
  0x8B0) follows him a unit a frame (sound 0x53 at 120 left), slams 4 a frame to 0x320 (sound 0x5F), waits 50, rises
  1 a frame to 0x360, waits 30 (sound 0x9D); then both to (0x910, z 0x630) and (0x830, 0x650), down 2 a frame, wait
  40, slide apart 6 a frame until B's x >= 0xA60 (sound 0xB6); the machine comes down 8 a frame to 0x320 (sound 0x5F),
  waits 60, comes into the corridor (z to 0x640: the chance), back, sinks to 0x120; loop.
- Fight 6 (bombs, north-west room): machine (0x678, z 0x660) down the sine 0x4E0 to 0x2E0, five bombs at counts 0x320
  .. 0x4A0 (table 0x14D5E: [count, dx, dz], records $D0E2..; sound 0x4E): each rises 8 a frame to 0x480, then 260
  frames: at 95 left it is put over Sonic's cell (sound 0x51, a shadow), falls 8 a frame for the last 44 and blows up
  on the floor (sound 0x59; watched: a bomb on Sonic's cell hurt him 16 units off its middle). Then up the sine
  (sound 0x4E), down 8 a frame to 0x320 (sound 0x5F), wait 60, in 1 a frame to 0x6A0 (the chance) and back (sound
  0x73), down to 0x2E0; loop from the bombs.
- Fight 8 (pod, south-west room; it stands in a 2 x 2 hole, (56..57, 63..64), out of reach): drops 8 a frame from
  0xA00 to 0x320 (sound 0xC9); twice: cannon (record $D2B6, type 1C0, handler 0x15BA6) sweep one way (state 6), 150
  frames, back (0x16), 150; then the hatch ($CEDA state 0x12) opens 20 frames, the pod leans in 1 a frame to x 0x760
  (the chance) and back, the hatch shuts (0x22), wait 60. Shots (watched, ffpart.py): five a sweep 11 frames apart
  on the cannon's own frame clock, directions by frame from table 0x15C2E ([dx, dz, vx, vz] x 16 / 65536: (2, 2),
  (2.5, 1.75), (3, 0.5), (3, -0.5), (2.5, -1.75)), 0..4 one way and 4..0 back, from the cannon + (dx, -9, dz); vy 1
  up, gravity 1/8 (template 0xDA7E), bounce 2 up off the floor, off walls, 160 frames.
- Templates (bytes +0 touch b4 b5, +2 gravity, +0xB type, +0xC life): 0xDA24 shot 0x1000 112; 0xDA5A type 8 0x2000 180;
  0xDA6C (lasers) shot, no gravity, 112; 0xDA7E type 8 0x2000 160; 0xD9CA shot, no gravity, no end; all touch 24 / 0.
  The sim fires them as the original's particles (shotPart), touched by the particle box (partTouch).
- Objects: 1AC floor pads (lit where Sonic steps: 6 while walking, 2 in a fight), 1B0 the machine's two parts, 1B4
  cannons (frame 0) and fists (1..4), 1B8 the hatch, 1BC bombs, 1C0 the pod's cannon, 138 serpent links, 02C debris.
  The machine's tiles are RNC packed (0xEFAFE to VRAM 0x520, 0x15D2BA to 0xF20) and streamed each frame (0x15A4BA,
  0xE87FE), so the page draws its own model.
- Cannons (st 0) and fists (st 4), records 1B4: touch bytes 16 / 24 through the original box test (origTouch, X/Z
  longs); exact over three private traces with the world pre-run 99 frames (PRE=99). Estimated, not measured: the
  serpent links' touch (14), the bombs' (16 falling, 24 on the floor).
- Not done: the floor pads' frames, the hatch's frames and the original's camera.

## Lives and deaths (2026-10-27; main loop 0x59C..0x918)
- Lives $0680: 3 at a new game ($0408 + 1), shown on the HUD; a 1-up monitor (0xC19C, sound 0x19) adds one, as does a
  special stage won with all seven emeralds (0x83C); 9 at most. There is no ring 1-up.
- A death ($C228 = 1): lives - 1, then the act is reloaded (LoadLevel 0x1A262 from 0x59C): rings, enemies and
  monitors back; Sonic at the start table's entry for the section ($06B2 kept); the Flickies already in the ring
  ($0A92) kept; the friends' counts kept; $068A says what the act's routine had done (shown friends, broken walls).
- Lives under 0: with continues ($06AA, one for every ten 044 heads, 0x18124) the continue screen (0x1E68E) and the
  act again from its start with 3 lives; without, game over.
- 044 Sonic heads (0x18086, art 0x3E5C8, 16 frames turning, palette line 2): taken when Sonic's cell is word +0x24
  and his y is from 40 under the record's to 6 over (or by a following Flicky in that cell within 34; not modelled),
  sound 0x68; the tenth (count $06AC) gives a continue (sound 0xAC on both channels), nine at most. 39 in the game,
  most 160 to 256 units over the floor, over springs.
- Score $06A6 in hundreds (not on the HUD; on the results screens): an enemy 1 (0x192CA, 0x19308), a boss 10
  (0x6EB8 and the like), the Final Fight 50 (0x15B76), each Flicky taken to a ring $0A8C (1, doubling: 1, 2, 4, 8,
  16; 0xCD5E), then the act's bonuses and the special stage's (one a frame as they count down). Kept over deaths and
  continues; cleared by a new game.
- The return from a special stage goes through the same reload with Sonic at $0686/$0688 (where he was), facing
  0x700, and $0A92 from $068C.

## Tails, Knuckles and the special stage (2026-10-27; ssrun.py, sstrace.py, bonus_parity.js)
- 15C Tails (handler 0x161C4, art 0x8EFF4) and 160 Knuckles (0x1626A, 0x93AA2; both palette line 2) call 0xCF1E: a
  grounded Sonic with rings whose x + 8 and z + 8 are within 0..16 of the record's is walked beside it (16 units to
  the side); all his rings go to its count for the act ($069E Tails, $06A0 Knuckles; cleared at the act's start), the
  record's $24 = 120 frames; at 50 left the rings go (sound 0xB0) and the count rises over its head (font 0x144C1E).
  If the gift took the count from under 50 to 50 or more, at the end $0684 = 1 (Tails) or 2 (Knuckles) and the main
  loop (0x60C) goes to the special stage (0x760). No y check.
- Hidden ones: InitLevel clears the record's word at +0x12 ($D948 Tails, $D97C Knuckles; 0x1BE60 keeps copies in
  $0A46/$0A48) unless bit 0 / 1 of $068A says the act's routine showed it before (cleared at the act's start, kept
  over a death). GG1: Tails once ring 1's hole opens (0xE5F4, record 32's state 1), Knuckles while the cannon at
  (116, 12) fires (0xE766); Rusty Ruin 2: Tails at the ride from (85, 101) at y 32 or under (0x7FBE / 0x8028);
  Volcano Valley 2: Knuckles at cell 0x63AC (0xB004). All others are out from the start.
- 0x760: stage = emeralds ($06A2; 7 and over: 6 with no emerald); Tails adds 7. The run's result is $A14E (non-zero:
  the emerald reached). A win sets $06AE (Tails) / $06B0 (Knuckles) to stage + 1 and adds an emerald; while set, the
  friend's stages are replays with no emerald; both are cleared at each act's start (0x4FC), so in practice each
  friend gives one stage an act. Screens: 0x21114 with 1 "SONIC GOT A CHAOS EMERALD" (ring bonus 100 a ring, emerald
  bonus 10000), 2 a bonus only, 0 none. After it the act goes on with Sonic where he was ($0686/$0688).
- Table 0x1CA94: 14 entries of 24 bytes [look (1: stone over lava, stages 0-6; 0: a grating over a river, 7-13), top
  speed (x 16 = 16.16), track (RNC1), items (RNC1), palettes: scenery, track, items]. Music request 0x10.
- Track: 8-byte records [count (first) / stripe, distance, x of the left edge, y (down)], farthest first (the
  distance falls by 32); two at one distance are a step. Items: [distance, x, y, kind], nearest first: 0 spiked ball,
  1 ring, 2 gate post (in pairs), 3 the count sign, 4 / 5 new counts (100, 150), 7 the emerald.
- A frame (0x1CBE4; the loop at 0x1E5C2 counts the opening 92 frames ($A146) and the bump ($A144) down before it):
  * emerald in sight ($A162 x set, no gate armed, not failing): steered to its x ((x - its x) >> 3 a frame, at least
    1); else B or C pressed while grounded and not held: jump (vy -5.625, sound 0x62); both let go after a jump: vy
    under -3.125 gets 1.5 added, then halved; left/right add 0.375 a frame to vx (not while thrown back).
  * Speeds: vx loses 0.1875 a frame toward 0 and is capped at the stage's top speed; y += vy, vy += 0.25 (cap 7); vz
    += 1/16 a frame up to the top speed (from fail 3: -1/16 to 0, sound 0xB2 at 3), never under -4.
  * z kept at or past $A148 (the last new count's place); the record at or behind Sonic and the one ahead: at a step
    whose top is more than 2 units over his feet that he was not already past, z = its distance - 1 and vz = 0 (bump
    8). Floor and x: linear between the two records (integer, truncated). Grounded he follows the floor (a step down is
    a drop to it); in the air he lands when at or under it. x kept within [left, left + 64].
  * Camera: z - 180; x eased 1/8; y eased 1/4 toward Sonic's y - 200.
  * Touches: items from 6 units behind to his distance, x within 12, y from 46 above his feet to 8 below: a ring (+1,
    sound 0x33); the emerald (the end: 160 frames, Sonic rising 2 a frame from frame 80, sound 0x6A; sound 0x1A, or
    0x19 with no emerald); a spiked ball unless blinking: thrown (vy -6, vz -3), 10 rings lost (all if fewer; sound
    0xB9), blinking 60 frames once he lands; with no rings thrown off (vy -8, sound 0xB2, the end in 40 frames).
  * The drawing pass: items more than 96 and at most 496 ahead of the camera and on screen in y (256 x (y - camera
    y) / depth in 0x68..0x15C) act: a gate post at scale (0x40000 / depth / 16) 60 or more arms the gate (its
    distance) and keeps a 15-frame count up while in sight; the emerald at scale 48 stops z there and steers x; the
    sign shows the count still wanted; 4 / 5 set the count to 100 / 150 (shown 120 frames, sliding in). An armed gate
    passed: with rings still wanted the stage fails (Sonic slows, the end in 60 frames), else once the count runs out
    sound 0x63.
- The sim's Sim.bonusStep is this, checked against the emulator frame by frame (positions, speeds, rings, timers):
  4 runs (stages 0, 3, 7, 12; two to the emerald), no difference.
