/* Reads level terrain from the player's own Sonic 3D Blast Mega Drive ROM, in the browser, and turns it into a
   Blast Grid "tiles" level. No game data is stored in this page; only the reading rules are.
   Format (worked out from the ROM's own loader and collision code):
   - level headers: 22 records of 0x2A bytes at 0x1AB62; +0x04 points to an RNC1-packed 128x128 map of big-endian words;
     +0x20 points to a start table (x at +0x14, height at +0x16, z at +0x18, world units).
   - map word: high byte = floor height in 8-unit steps; low byte = raise of each corner NW, NE, SE, SW
     (2 bits each, 8-unit steps); 0 = no floor. One cell is 32 world units across. */
const S3D = (() => {
  'use strict';
  const HEADERS = 0x1AB62, HSIZE = 0x2A, CELL = 32, STEP = 8, RING_TABLE = 0x1936, RING_HOVER = 18;
  // per corner byte: 1 = the cell is split north-east to south-west for its floor and slope (routines 0x3540, 0x3BB2)
  const SPLIT = 0x4A08, PIECES = [0xD5, 0x75, 0x5D, 0x57];   // (the wall routine's diagonal pieces, 0x3A1A)
  const HUNTER_ORBIT = 23.5, HUNTER_BALL_Y = 20;
  // Green Grove gimmicks that the act's own routine runs (RunLevel_GGz1 0xE59E, RunLevel_GGz2 0xE9C2, cannon 0xF0B0):
  // cannons [cell x, cell z, mouth height, launch up and launch south in units a frame (emulator: the routine asks 9 and
  // 7.5 / 6.5; Sonic moves 7.067 / 6.1 a frame south)]; cracked walls [cells, raised height in units, the way a dash
  // must go to break them]. The ROM map holds the broken walls.
  // Rusty Ruin 1 (RunLevel at 0x742C, labelled RRz2): map cells whose low byte is 0xFF are spike blocks (hurt) and
  // 0x55 are fans (standing on one starts the whirl); doors = table at 0x7994 [cell, x, y, z (16.16), ...; direction
  // word at +0x16: 0 south, 2 west, 4 north, else east, pushed 4 units a frame]; pillars = table at 0x7ACC [screen x,
  // screen y, x, y, z, cell, raised word] (the act raises them at the start; the whirl breaks them). After a big ring
  // the routine puts Sonic in a closed pocket [x, z, compass degrees] and walks him to a cell [x, z, after ring n] that
  // starts a ride: player state n (a scripted move, see rideScript), from [x, y, z] facing f if the routine moves him
  // there first, keeping velocity [vx, vy, vz] units a frame (y up) for when the move ends.
  // cracks: [cells (optionally [x, z, own raised height]), raised height, the way a dash must go].
  const GIMMICKS = {
    // friends: InitLevel hides Tails ($D948) and Knuckles ($D97C) unless $068A says the routine showed them already;
    // RunLevel shows Tails once ring 1's hole opens (0xE5F4) and Knuckles while the cannon at (116, 12) fires (0xE766)
    1: { cannons: [[116, 12, 248, 9, 7.067]], cracks: [[[[108, 17]], 480, [0, -1]]], friends: { tails: { section: 1 }, knuckles: { cannon: [116, 12] } } },
    2: { cannons: [[21, 48, 576, 9, 6.1]], cracks: [[[[59, 47]], 784, [-1, 0]], [[[108, 41], [109, 41]], 688, [0, -1]]] },
    7: { spikes: 0xFF, fans: 0x55, roofs: 0x7AA0 /* the routine's call at 0x74A2 */, doors: [0x7994, 4], pillars: [0x7ACC, 23], maces: [0x75C2, 5], flames: [0x7548, 5],
      links: [[1696, 1840, 90], [2576, 1216, 180]],
      rides: [[60, 48, 1, 0x36, [1888, 392, 768], 0x400, [0, 0, 5]], [80, 50, 2, 0x38, null, null, [0, 0, 0]]],
      pads: [[0, -1, 1], [1, -1, 2]],
      cracks: [[[[88, 62]], 432, [-1, 0]], [[[100, 41], [100, 15, 560]], 432, [0, -1]]] },
    // Rusty Ruin 2 (RunLevel 0x7CFC, labelled RRz1): teleport pads both ways after each ring (table 0x81B8 places
    // Sonic at the other pad, which throws him 138 units up, measured); slides: grounded on a cell whose low byte is
    // 0xC3 (falls east) or 0xF0 (falls south) pushes 0.25 units a frame per frame that way up to 4, and for 15 frames
    // after; rides at four cells, one of them only after the pillar at (85, 101) breaks: the routine then drops that
    // cell to 0x500 and lowers (99, 96) to its map value; it fires below 32 units (Sonic falls through the
  // 0x500 floor to there; ours stops at 40, so the ride here fires at 40). Dash wall (101, 60).
    6: { friends: { tails: { cell: [85, 101], maxY: 32 } } /* 0x7FBE: the ride from (85, 101) at y 32 or under */, spikes: 0xFF, fans: 0x55, roofs: 0x8252 /* 0x7E0C */, pillars: [0x8266, 23], maces: [0x80B8, 6], flames: [0x7EC4, 9], padRise: 138, pads: [[0, 1, 1], [1, 0, 1], [2, 3, 2], [3, 2, 2]],
      slides: [[0xC3, [1, 0]], [0xF0, [0, 1]]], pillarLinks: [[85, 101, 0x05, [[99, 96, 0x22]]]],
      rides: [[98, 96, 0, 0x30, null, null, [0, 0, 0]], [85, 101, 0, 0x2E, null, null, [0, 0, 0], 40],
        [100, 60, 0, 0x32, null, null, [0, 0, 0]], [91, 71, 0, 0x34, null, null, [0, 0, 0]]],
      cracks: [[[[101, 60]], 336, [-1, 0]]] },
    // Spring Stadium 1 (RunLevel_SSz1 0x95DA) and 2 (_SSz2 0x8EC2), helpers 0x9974 (bumpers, then floor springs),
    // 0x9D44 (act 1's spike fields), 0x9B40 (tubes): cells by low byte: floor springs (0x55: grounded, thrown up at 7.875
    // units a frame), bumpers (0xFF and the cells in the table [address, count]; entering one pushes Sonic out across its
    // nearest edge), spike fields (0xAA). Rides at cells (player state 4: a loop; bit 15: turned a quarter, x = -z and
    // z = -x, as watched in Diamond Dust 1), then the pad
    // held for n frames (F5: running east; FF: let go); holds: a cell that keeps the pad held n frames. Tubes: table
    // [address, state in, state out] of two mouths (see the convert loop). Triangle bumpers (the routines' boxes):
    // [band axis, band start, side start, side flipped, push x, push z (units a frame), pushes along the band near its
    // tip]: 64 units square, the triangle where the side offset (flipped: from the far side) is no more than the band
    // offset. SS2: spear cells (table [address, count]; the act's spear object rises in the east quarter of the cell)
    // and a spiked wall facing east at cells [x, [z...], under height].
    // Spring Stadium 1 (InitLevel 0x9526, RunLevel_SSz1 0x95DA): InitLevel raises gates 0x20 over the floor across the
    // corridors at (33, 116..117), (41, 114..115), (52, 114..115), (62, 38..39), (50, 40..41); while the routine's flag
    // is set (a supercharger's record at state 0xF) it lists them as open, until Sonic reaches (42, 115), (77, 113) or
    // (63, 39); (33..34, 78) stands until ring 1
    15: { floorSprings: 0x55, bumpers: [0xFF, 0x98DA, 8], spikeField: 0xAA,
      gates: [[[[33, 116], [33, 117]], 0x45, 0, 1], [[[41, 114], [41, 115]], 0x45, 0, 1], [[[52, 114], [52, 115]], 0x4F, 0, 1],
        [[[62, 38], [62, 39]], 0x91, 0, 1], [[[50, 40], [50, 41]], 0x97, 0, 1], [[[33, 78], [34, 78]], 0x85, 1, 0]],
      passOff: [[42, 115], [77, 113], [63, 39]],
      rides: [[37, 117, 0, 4, null, null, null, undefined, [140, [1, 0]]], [61, 115, 0, 4, null, null, null, undefined, [200, [1, 0]]],
        [77, 113, 0, 4, null, null, null, undefined, [85, [1, 0]]], [59, 41, 0, 4, null, null, null, undefined, [70, null]]],
      holds: [[55, 115, 100], [53, 41, 100]], tubes: [0x98C6, 0x40, 0x42],
      tris: [['x', 2432, 1600, 0, -4, 4, 1], ['x', 2432, 1792, 1, -4, -4, 1]] },
    17: { floorSprings: 0x55, spikeField: 0xFF },   // the boss arena: springs up to a spiked ledge, spikes all round
    // Diamond Dust 1 (RunLevel_DDz1 0x1009E): pads 0CC (pairs; the routine's tables at 0x108C4.. send pad 1 to pad 2
    // once ring 1 opens it, pad 3 to pad 4 after ring 2); the supercharger's loop (state 0x8004) at (89, 50);
    // and its other cells: the opening ice chute (x 39-40, z 52-70: slid down south at 0.25 units a frame per frame, steered
    // to x 1280) into a jump (state 0x3A at (40, 70)); a dash east (cell (54, 65) under 704: 7.5 units a frame for 24
    // frames, a 6 a frame jump at 14); a sled run south from (78..79, 66) (pulled to (2528, 2128), then 0.0625 a frame per
    // frame for 300 frames) into a jump (state 0x3C at (86, 81)); currents (x 110-113 z 55-89 up to 2 a frame, x 50-53
    // z 83-99 up to 3, 0.375 a frame per frame, south); snowdrift springs (4.5 a frame) at (94, 39), (90, 39), (80, 39);
    // snowblowers (table 0x10976, as flamethrowers; they freeze)
    9: { pads: [[0, 1, 1], [2, 3, 2]],
      rides: [[89, 50, 0, 0x8004, null, null, null, undefined, [80, null]], [40, 70, 0, 0x3A, null, null, [0, 0, 7.5], undefined, [80, null, 1], undefined, 2],
        [86, 81, 0, 0x3C, null, null, null]],
      chutes: [[39, 40, 52, 70, [0, 1], 0.25, 1280]], dashes: [[54, 65, 704, [7.5, 0], 24, 14, 6]],
      sleds: [[78, 79, 66, 66, [2528, 672, 2128], [0, 1], 0.0625, 300]],
      currents: [[110, 113, 55, 89, [0, 1], 0.375, 2, 2.5], [50, 53, 83, 99, [0, 1], 0.375, 3, 4]],
      hops: [[[94, 39], [90, 39], [80, 39]], 40], flames: [0x10976, 7], freeze: 1,
      spikes: 0xFF, ice: [0x10B24, 21, 0x10B4E, 25, [[89, 50]], [[86, 74]]], iceSpikes: [0x10B80, 27], roofs: 0x10AF2, bumpers: [0x55, 0, 0],
      // InitLevel 0xFF9A raises gates (88..89, 54), (90..91, 47): open while the supercharger's flag is up (record at
      // state 0xF; cleared at (91, 46)); and (86..87, 75), (78..79, 67): open from the sled's start to (86, 74); stepping
      // on (38, 76) raises (37..38, 75) to 0x7D00 for good
      gates: [[[[88, 54], [89, 54]], 0x6D, 0, 1], [[[90, 47], [91, 47]], 0x6D, 0, 1], [[[86, 75], [87, 75]], 0x59, 0, 2], [[[78, 67], [79, 67]], 0x65, 0, 2]],
      passOff: [[91, 46], [86, 74, 2]], shuts: [[[[38, 76]], [[37, 75], [38, 75]], 0x7D]],
      // warp holes: standing two frames on (57, 50) hops Sonic 4.5 up and opens it and (59, 72); falling into (57, 50)
      // under 0x320 puts him under (59, 72), into (59, 72) under 0x1C0 under (57, 50); thrown out once the camera is there
      warps: [[57, 50, 0x770, 0x1E0, 0x910, 0x320], [59, 72, 0x730, 0x340, 0x650, 0x1C0]] },
    // Diamond Dust 2 (RunLevel_DDz2 0xFA06): pads as in act 1 (tables 0xFC82..); the supercharger (record 9) opens gate cells
    // into a ride (state 0x803E at (78, 95), pad let go 400 frames); a dash east at (50, 45) under 608 (7.5 units a frame,
    // pad held 10 frames); a current east over x 96-117, z 88-95 (0.375 a frame per frame up to 3.5, 3.5 on jumping off)
    // into spikes; snowdrift springs (object records 26-28) at (109, 80), (103, 82), (111, 72); snowblowers (0xFD5E)
    // Both acts (helpers 0x10E78, 0x10EA6, 0x10CC4): 0xFF cells are spikes (hurt under the floor + 24 units); ice on/off
    // cell lists ($0ACA: the slippery table, also on after a pad into the icy part, off back out); ice spikes (12-byte
    // records, cell at +10: map lowered 3 steps and marked 0xFF at the start, so at floor height) broken by a grounded
    // roll; low roofs [cell, cell, top] (no rising above the top in them, walls to a player in the air outside); 0x55 cells
    // are bumpers (grounded, entering: 5 units a frame out across the nearest edge, sound 0xAA)
    // Volcano Valley 1 (RunLevel 0xA620, labelled VVz2; helpers 0xB5C8 roofs and lava, 0xBBC0 rocks, 0xB764 vents): pads
    // 110 (tables 0xA826..: record 2 <-> 4 after ring 1, 15 <-> 28 after ring 2); lava = low byte 0x55; rocks: 12-byte
    // records [screen x, y, x, y, z, cell] (top 16 units over the cell); cracked walls at (59, 55) and (65, 63) broken by
    // a roll west at 4 units a frame or more; vents: 30-byte records [cell, x.l, y.l, z.l, ...] in pairs, thrown out at
    // (-2, 8.5 up, -2) units a frame; lava spouts: 16-byte records [x, z, y, vx, vy, vz (x 16 / 0x10000 units a frame),
    // phase, window]; fire runs: 0x28-byte records [x0, w, z0, h, then 4 x [x, y, z, flags (0x800: along z)]]
    // Volcano Valley 2 (RunLevel 0xAE20, labelled VVz1): pads 0xB10C/0xB130 (record 2 <-> 4 after ring 1); cracked walls
    // at (55, 61) (a roll north) and (94, 114) (west); spiked balls 118 swing about z 0xE80; the vent at 0x63AC is off
    // while the rock on its partner (0x56A8) stands (map low byte 0xFF)
    12: { friends: { knuckles: { cell: [86, 99] } } /* 0xB00C */, pads: [[0, 1, 1]], lava: 0x55, rocks: [0xB484, 27], roofs: 0xB386, vents: [0xB394, 8], spouts: [0xB286, 16], fireRuns: [0xB194, 5], fireBars: [0xB25C, 3],
      cracks: [[[[55, 61]], 744, [0, -1]], [[[94, 114]], 424, [-1, 0]]], balls: [0xE80, 56, 8, 0xB90, 0xD10], ventOff: [[0x63AC, 0x56A8]] },
    13: { pads: [[0, 1, 1], [2, 3, 2]], lava: 0x55, rocks: [0xAB42, 42], roofs: 0xAA4A, vents: [0xA8F6, 6], spouts: [0xA9AA, 10], fireRuns: [0xAA5E, 5], fireBars: [0xAB26, 2],
      cracks: [[[[59, 55]], 680, [-1, 0]], [[[65, 63]], 584, [-1, 0]]] },
    14: { lava: 0x55 },   // Volcano Valley 3: the crater's lava
    18: { roofs: 0x11482 },   // Gene Gadget 3: the row under the pod
    10: { pads: [[0, 1, 1], [2, 3, 2]], rides: [[78, 95, 0, 0x803E, null, null, null, undefined, [400, null]]],
      dashes: [[50, 45, 608, [7.5, 0], 10, 0, 0]], currents: [[96, 117, 88, 95, [1, 0], 0.375, 3.5, 3.5]],
      hops: [[[109, 80], [103, 82], [111, 72]], 40], flames: [0xFD5E, 7], freeze: 1,
      spikes: 0xFF, ice: [0xFE30, 39, 0xFE7E, 40, [[75, 100]], [[70, 105]]], iceSpikes: [0xFECE, 17], roofs: 0xFE04, bumpers: [0x55, 0, 0],
      // InitLevel 0xF946 raises gates (77..78, 95) and (91..92, 106): open while the supercharger's flag is up, to (91, 107)
      gates: [[[[77, 95], [78, 95]], 0x41, 0, 1], [[[91, 106], [92, 106]], 0x39, 0, 1]], passOff: [[91, 107]] },
    // Spring Stadium 2 (InitLevel 0x8DEA, RunLevel_SSz2 0x8EC2): gates (64, 104..105), (76, 102..103), (84..85, 78),
    // (86..87, 71) open while the flag is set (four superchargers), until (77, 103), (87, 70) or (85, 79); (61..62, 110)
    // stands until ring 1, (123..124, 51) until ring 2
    16: { floorSprings: 0x55, bumpers: [0xFF, 0x94EA, 30],
      gates: [[[[64, 104], [64, 105]], 0x3F, 0, 1], [[[76, 102], [76, 103]], 0x39, 0, 1], [[[84, 78], [85, 78]], 0x69, 0, 1],
        [[[86, 71], [87, 71]], 0x69, 0, 1], [[[61, 110], [62, 110]], 0x41, 1, 0], [[[123, 51], [124, 51]], 0x65, 2, 0]],
      passOff: [[77, 103], [87, 70], [85, 79]],
      rides: [[73, 105, 0, 4, null, null, null, undefined, [70, null]], [85, 76, 0, 0x8004, null, null, null, undefined, [84, null]],
        [87, 74, 0, 0x8044, null, null, null, undefined, [84, null]]],
      holds: [[68, 105, 100]], tubes: [0x9480, 0x40, 0x42],
      tris: [['z', 1472, 1152, 0, 4, -4, 1], ['z', 1472, 1344, 1, -4, -4, 1], ['x', 2752, 3200, 0, -4, 4, 1], ['x', 2752, 3456, 1, -4, -4, 1],
        ['x', 3264, 1920, 0, -4, 4, 1], ['x', 3264, 2048, 1, -4, -4, 0], ['x', 3072, 2240, 1, -4, -4, 0]],
      spears: [0x9494, 16], spikeWall: [122, [22, 24, 27, 28, 29, 30], 0x380] },
    // Gene Gadget 1 (RunLevel_GnGdz1 0x11D2A, InitLevel 0x11C78; watched in the emulator): 0x55 cells hover a grounded
    // player (see Sim.P.hover*); 0xAA cells arm zaps (object 068: a spark 22 frames after the step, hurting for 12 frames
    // whoever stands there, the blue shield excepted); speed pads (cells 0x6582/0x6682: 6 units a frame east, 0x5E94/
    // 0x5E96: south); pyramid bumpers (table [address, count] of [x, z], 64-unit boxes); barriers [wall cells, raised to
    // this high byte until ring n, zap cells, the half that hurts, ring n, thrown that way] (the routine's cells 0x7676/
    // 0x7678 north of z 0xED0 while record 27 is on, 0x5EEC/0x5FEC west of x 0xED0 while record 30 is; InitLevel raises
    // the walls, the rings' code lowers them); gates [cells, high byte, ring that opens them (0: none), let a supercharged
    // run through]: InitLevel raises (58..59, 112), (68..69, 89) and (54, 70); the supercharger's flag (record 1 at its
    // state 0xF) lists the first four as open until the run reaches (68, 90); tubes: table [address, count] of 12-byte
    // records [cell, x, z, player state, effect x, effect y], taken grounded: Sonic is put at (x, z) and plays the state
    // (in a roll; the supercharger run keeps its 7.48 units a frame through the hop, watched); the first one, at the start of its 4th segment, goes on as state 0x1A with five Flickies following
    // (to the act's last ring) or as 6 without (sound 0xB2); the run after the supercharger is the ride at (59, 112)
    4: { updrafts: 0x55, zapCells: 0xAA, roofs: 0x12254, pyramids: [0x11EE4, 4],
      dashes: [[65, 101, 0x7FFF, [6, 0], 1, 0, 0], [65, 102, 0x7FFF, [6, 0], 1, 0, 0], [74, 94, 0x7FFF, [0, 6], 1, 0, 0], [75, 94, 0x7FFF, [0, 6], 1, 0, 0]],
      barriers: [[[[58, 117], [59, 117], [60, 117], [61, 117]], 0x2D, [[59, 118], [60, 118]], 'n', 1, [0, 1]],
        [[[117, 93], [117, 94]], 0x45, [[118, 94], [118, 95]], 'w', 2, [1, 0]]],
      gates: [[[[58, 112], [59, 112]], 0x2D, 0, 1], [[[68, 89], [69, 89]], 0x49, 0, 1], [[[54, 70]], 0x51, 0, 0, 1]], keyOff: [[54, 71, 1]], passOff: [[68, 90]],
      tubes2: [0x120F8, 10, [[0, 3, 0x1A]], [[0, 1]]],
      rides: [[59, 112, 0, 0x18, null, null, [0, 0, -7.48], undefined, [340, null, 1, 1]]] },
    // Gene Gadget 2 (RunLevel_GnGdz2 0x115E2, InitLevel 0x11540): as act 1 (hover, zaps, roofs 0x11AAA, a barrier at
    // cells 0x4664/0x4666 north of z 0x8D0, its wall (49..52, 69) raised to 0x6500 until ring 1, tubes table 0x11998
    // whose first and last open the doors 0x613E and 0x4088 (raised by InitLevel) until 0x6140 and 0x408A); spikes
    // (0xFF, grounded); slides from row 75 on (0xC3 east, 0xF0 south, as Rusty Ruin 2's); speed pads (tables 0x11930
    // south, 0x11942 east); the chute x 50..53, z 83..108 (grounded: rolled south, 0.25 a frame per frame up to 8.19,
    // steered to x 0x680, the pad let go 200 frames; watched) into a hop at (52, 107) (state 0x20, vy 5.5 up kept); the
    // supercharger's run hops at (21, 105) (state 0x1E, while the pad is held); platforms 078
    5: { updrafts: 0x55, zapCells: 0xAA, roofs: 0x11AAA, spikes: 0xFF, slides: [[0xC3, [1, 0], 75], [0xF0, [0, 1], 75]],
      dashes: [[56, 70], [57, 70], [32, 88], [33, 88], [64, 66], [65, 66], [66, 66], [67, 66]].map(([cx, cz]) => [cx, cz, 0x7FFF, [0, 6], 1, 0, 0])
        .concat([[59, 103], [59, 104], [59, 111], [59, 112], [59, 113], [59, 114]].map(([cx, cz]) => [cx, cz, 0x7FFF, [6, 0], 1, 0, 0])),
      barriers: [[[[49, 69], [50, 69], [51, 69], [52, 69]], 0x65, [[50, 70], [51, 70]], 'n', 1, [0, 1]]],
      gates: [[[[31, 97]], 0x85, 0, 0, 1], [[[68, 64]], 0x89, 0, 0, 2]], keyOff: [[32, 97, 1], [69, 64, 2]],
      tubes2: [0x11998, 6, [], [[0, 1], [5, 2]]],
      chutes: [[50, 53, 83, 108, [0, 1], 0.25, 1664, 8.19, 200]],
      rides: [[52, 107, 0, 0x20, null, null, [0, 5.5, 0], undefined, [40, null]], [21, 105, 0, 0x1E, null, null, [0, 5.5, 0], undefined, [40, null], 1]] },
    // Panic Puppet 1 (RunLevel 0x133BC labelled PPz2, InitLevel 0x13336 labelled PPz1; the act 2 labels are swapped
    // too): hover cells, zap floors, roofs 0x13B00, slides (0xC3 and 0xF0 by x: east up to x 0x960, south past it);
    // InitLevel raises gates (68, 97..98) and (40, 62) (open while the key $18 is held) and the cracked wall (48, 48)
    // (a fast roll north from (48, 49) breaks it, sound 0x59); tubes 0x13464 (8-byte records, inside the walls: Sonic
    // hidden) give the key on state 0x5A; (69, 98) and (40, 63) take it back, the first setting flag $1A and the second
    // clearing it (sound 0x64); switch cells set the levers' values (sound 0x76); the belts carry Sonic (input held)
    // west or east by the lever value ($1A ? levers 8/9 : lever 7; 1 east): the first, east, throws him into ride 0x56
    // (roll, 7 a frame, pad held 220 frames, the key) and at its end puts him at (0x860, 0x100, 0xC40) (watched); the
    // second runs through a tunnel (hidden x 0x920..0xA80) to the column with the act's ring
    21: { mapSet: [[45, 44, 0x3D00]], mapClear: 185 },   // Panic Puppet 3: InitLevel 0x1258C lowers the start cell and takes the first 370 bytes
    20: { updrafts: 0x55, zapCells: 0xAA, roofs: 0x13B00, slides: [[0xC3, [1, 0]], [0xF0, [0, 1]]], cracks: [[[[48, 48]], 840, [0, -1]]],
      gates: [[[[68, 97], [68, 98]], 0x41, 0, 0, 1], [[[40, 62]], 0x61, 0, 0, 1]], keyOff: [[69, 98, 1, { f: 1 }], [40, 63, 1, { f: 0 }]],
      tubes2: [0x13464, 4, [], [[1, 1]], 8, 1],
      switches: [[31, 92, 'a', 0], [31, 91, 'a', 1], [44, 78, 'b', 0], [44, 77, 'b', 1], [86, 63, 'b', 0], [86, 62, 'b', 1]],
      carryWay: ['f', 'b', 'a'],
      carriers: [[0x480, 0x51F, 0xB60, 0xB9F, null, 0xB80, 0x477, 0x520, null, [0x56, [7, 0, 0], [0x860, 0x100, 0xC40], 0x600, 220, 1]],
        [0x7C0, 0xABF, 0x9A0, 0x9DF, 0xE0, 0x9C0, 0x7B7, 0xAC8, [0x920, 0xA80], null]] },
    // Panic Puppet 2 (RunLevel 0x13B7E labelled PPz1, InitLevel 0x13B38): no big rings; the act ends 110 frames after
    // Sonic steps into the lift (x 0x810..0x830, z 0x620..0x628: held at (0x820, 0x390, 0x628) 30 frames, then ride
    // 0x54); tubes 0x13BCA (Sonic hidden); belt A (x 0x6A0..0x73F, z 0xB00..0xB3F) east into ride 0x52 (vx 7, pad held
    // 120 frames; watched: it ends on the floor below); belt B (x 0xA20..0xA5F, z 0x720..0x79F) south on x 0xA40, let
    // go at z 0x7A0; cells raised behind the player: (65, 86..87) from (66, 87), (63..64, 33) from row 34, (67..68, 45)
    // and (71..72, 45) from row 46 (x 66..72; sound 0xC9), (89, 45) from (89, 46) (sound 0x64); cracked wall (67, 63)
    // (InitLevel 0x5D00; a fast roll north from (67, 64) breaks it); slides 0xF0 south except in columns 85 and 86
    19: { roofs: 0x13FFC, slides: [[0xF0, [0, 1], 0, [85, 86]]], cracks: [[[[67, 63]], 744, [0, -1]]], tubes2: [0x13BCA, 6, [], [], 8, 1],
      carriers: [[0x6A0, 0x73F, 0xB00, 0xB3F, null, 0xB20, null, 0x740, null, [0x52, [7, 0, 0], null, null, 120, null], 'x', 1],
        [0xA20, 0xA5F, 0x720, 0x79F, null, 0xA40, null, 0x7A0, null, null, 'z', 1]],
      shuts: [[[[66, 87]], [[65, 86], [65, 87]], 0x55], [[[63, 34], [64, 34]], [[63, 33], [64, 33]], 0x91, 'shut'],
        [[66, 67, 68, 69, 70, 71, 72].map(cx => [cx, 46]), [[67, 45], [68, 45], [71, 45], [72, 45]], 0x91, 'shut'], [[[89, 46]], [[89, 45]], 0x4D, 'doorShut']],
      lifts: [[0x810, 0x82F, 0x620, 0x627, [0x820, 0x390, 0x628], 0x54, 30, 110]] },
  };   // units: spike ball circle radius (measured) and height (estimated)
  // Bosses run by the act's own routine. Green Grove 3 (RunLevel_GGz3 0xDDE4): Robotnik's pod starts at [x, y, z],
  // comes down to the cruise height, then loops: follows Sonic (2 units a frame) until close, lets its spiked ball go
  // (it falls and hops five times towards Sonic, 2 units a frame out, 2 up, 0.125 gravity), goes back home (1 a frame),
  // sinks to the ball's height + 40, takes the ball back and rises. A hit: Sonic within 32 units, at the pod's height
  // + 8 or above; five hits, 60 frames apart. All inside the arena square.
  // Rusty Ruin 3 (RunLevel_RRz3 0x6DE8): the pod comes down into a stone statue's head (322 to 152, one unit every other
  // frame) under a cap (342 to 162, 4 a frame) between two arms. Each arm is [reach, lift] from its root (y 128, z 2080)
  // and drawn by the routine at 0x727C as a two-link arm (links 64 long): four links root to elbow, the fist at
  // root + (lift + 20, reach), three links between. A script of [action, frames] (table 0x7170, ended by -1 and a step
  // back) reaches a fist out towards Sonic, raises the other arm, slams (sine table 0x27AC8), rests, lifts, pulls back
  // and swaps arms. Heights here are 8 units up on the emulator's (Sonic stands at 56 on a floor the map gives as 64).
  // Any touch on the pod (within 32 units, from 32 below to 64 above it) is a hit, 60 frames apart; five.
  const BOSSES = { 3: { kind: 'gg', at: [1152, 350, 1152], home: [1088, 1088], cruise: 160, arena: [800, 1375, 800, 1375], hp: 5 },
    8: { kind: 'rr', at: [1856, 330, 2080], cruise: 160, cap: 350, arms: [1792, 1920], root: [136, 2080],
      reach: [2144, 2190], script: 0x7170, home: [1856, 2080], arena: [1760, 1983, 2080, 2271], hp: 5 },
    // Spring Stadium 3 (InitLevel 0x87CE, RunLevel_SSz3 0x887A): the pod comes down from 568 to a hover, waits 400
    // frames, then hovers at `hover` (400 frames, arms swinging slowly) and swoops `low` (400 frames, arms pulled in,
    // swinging fast), turning towards Sonic by octant (table 0xDBEE) at (6 - hits left / 2) / 2 units a frame inside
    // the arena; two spring fists hang `hang` units under it (offsets [x, z]) and swing 32 up and down, stopping at the
    // floor. The generic boss check (0xF794): from 8 over the pod and spinning, a hit; otherwise Sonic is hurt. Eight.
    17: { kind: 'ss', at: [1796, 568, 2304], cruise: 168, hover: 200, low: 120, hang: 40, fists: [[38, 40], [-46, 40]],
      corners: [[2237, 1560], [2045, 1752]], home: [1796, 2304], arena: [1496, 1896, 1981, 2398], hp: 8 },
    // Diamond Dust 3 (InitLevel 0xF1CA, RunLevel_DDz3 0xF280): heights given + 8 so they share the player's feet frame
    // (Sonic stands at the floor - 8); script [action / 4, frames] at 0xF2FA, a negative action going back by n bytes,
    // a hit restarting it at byte 0x28; heading turned in at x or z outside 0x740..0x8C0, |x - z| >= 0xD8, and
    // 0x1000 - x - z >= 0x110 or <= -0x118
    11: { kind: 'dd', at: [2052, 0x240 + 8, 2048], cruise: 0xB0 + 8, low: 0xB0 + 8, high: 0x100 + 8, dropY: 0xE0 + 8, script: 0xF2FA, hitAt: 0x28,
      diag: 0xD8, sum: [0x1000 - 0x110, 0x1000 + 0x118], home: [2048, 2048], arena: [0x740, 0x8C0, 0x740, 0x8C0], hp: 8 },
    // Volcano Valley 3 (InitLevel 0x9DF8, RunLevel_VVz3 0x9EBA): pod from 0x1E8 down to 0x58 (+8: the feet frame); hit
    // box x and z 0x7F0..0x830; spiked cells (63, 64), (65, 64), (64, 63), (64, 65); the serpent rises at (0x834, 0x5C,
    // 0x830), never under 0x60
    14: { kind: 'vv', at: [0x800, 0x1E8 + 8, 0x800], cruise: 0x58 + 8, low: 0x58 + 8, hitBox: [0x7F0, 0x830, 0x7F0, 0x830], minY: 0x60 + 8,
      rise: [0x834, 0x5C + 8, 0x830], spikes: [[63, 64], [65, 64], [64, 63], [64, 65]], home: [0x800, 0x800], arena: [0x740, 0x8C0, 0x740, 0x8C0], hp: 8 },
    // Gene Gadget 3 (InitLevel 0x110BA, RunLevel_GnGdz3 0x11126; watched): heights + 8 (the feet frame); the belt's loads
    // (records 8..13: first z of each; four lanes from x 0xDD0, 32 apart) ride from z 0x1C8 to 0x378; the end row from
    // z 0x380 hurts; bombs drop 7 and 18 units west of the pod and 6 south of it
    18: { kind: 'gng', at: [0xE04, 0x1D0 + 8, 0x240], cruise: 0x40 + 8, first: 0x40 + 8, high: 0x70 + 8, low: 0x20 + 8, belt: [0x1C8, 0x378],
      lanes: [0xDD0, 32], end: 0x380, loads: [456, 408, 360, 312, 264, 216], drops: [-7, -18], dropZ: 6, home: [0xE04, 0x240], arena: [0xDC0, 0xE40, 0x200, 0x3A0], hp: 8 },
    // Panic Puppet 3 (InitLevel 0x1258C, RunLevel_PPz3 0x1268A; heights in Sonic's frame, + 8 for the floor): three
    // arenas down a diagonal; in each the pod sinks into a glass column (pod y, then lower once both arms are broken) and
    // two arms (a claw on six links from a shoulder) fight. Arena 1 (routine 0x12BC2): an arm whose zone Sonic is within
    // 48 units of follows him (half a unit a frame each way) and, over him, punches (24 frames up a unit, 11 frames down
    // 8, rests, from 32 frames left rises 2 a frame); else it goes back to rest. Arenas 2 and 3 (0x12D4C, 0x12EC6): the
    // arms sway about their rest (32 units, 8 a frame of 0x800; up and down 16, 0x12 a frame) and every so often (timer
    // from `t`) stop: arena 2 lets a serpent go after Sonic (210 frames, five links), arena 3 sprays shots (a frame each,
    // 2.5..3.5 units a frame south-east). An arm at rest (or stopped) is hit by Sonic in the air over its shoulder's
    // corner cell (`cell`, y >= hitY); four hits each. After arenas 1 and 2 a pad cell lifts Sonic to the next arena
    // (held 55 frames, put at `to` after 16); after arena 3 the act is over 360 frames later.
    21: { kind: 'pp', at: [0x561, 0x390, 0x540], cruise: 0x200, home: [0x561, 0x540], arena: [0x520, 0x800, 0x500, 0x800], hp: 24,
      stages: [
        { pod: [0x561, 0x540, 0x200, 0x180], hitY: 0x1F0, pad: [47, 41], lift: [0x5F0, 0x1E0, 0x530], to: [0x6F0, 0x2E0, 0x630],
          arms: [{ at: [0x590, 0x220, 0x590], rest: [0x570, 0x220, 0x5B0], zone: [0x590, 0x5B0], shoulder: [0x558, 0x208, 0x570], cell: [42, 43] },
            { at: [0x5B0, 0x220, 0x570], rest: [0x5D0, 0x220, 0x550], zone: [0x5D0, 0x570], shoulder: [0x590, 0x208, 0x538], cell: [44, 41] }],
          shots: [[0x550, 0x222, 0x570], [0x590, 0x222, 0x530]] },
        { pod: [0x661, 0x640, 0x1A0, 0xF0], hitY: 0x190, pad: [50, 54], lift: [0x650, 0x180, 0x6D0], to: [0x750, 0x280, 0x7D0],
          arms: [{ rest: [0x688, 0x1A0, 0x6A8], shoulder: [0x658, 0x1A8, 0x670], cell: [50, 51], t: 0x190 },
            { rest: [0x6C8, 0x1A0, 0x668], shoulder: [0x690, 0x1A8, 0x638], cell: [52, 49], t: 0x2BC, phase: 0x400 }] },
        { pod: [0x761, 0x740, 0x140, 0xC0], hitY: 0x130,
          arms: [{ rest: [0x788, 0x140, 0x7A8], shoulder: [0x758, 0x148, 0x770], cell: [58, 59], t: 0x190 },
            { rest: [0x7C8, 0x140, 0x768], shoulder: [0x790, 0x148, 0x738], cell: [60, 57], t: 0x2BC, phase: 0x400 }] }] },
    // Final Fight (InitLevel 0x14170, RunLevel_FFz 0x142C0): the machine's scripts live in the Sim (ffStep, in the
    // original's units); here the doors, map words of two cells each set to 0x8500 (shut) or 0x6500 (open): 0 and 1 the
    // east corridor's ends, 2 and 3 the north corridor's east doors, 4 and 5 its west ones, 6 and 7 the west corridor's
    // ends, 8 and 9 the south corridor's ends
    22: { kind: 'ff', at: [0x940, 0x190, 0x800], cruise: 0x320, home: [0x940, 0x800], arena: [0x660, 0xA80, 0x5A0, 0x860], hp: 10,
      doors: [[0x379C, 0x379E], [0x3C9C, 0x3C9E], [0x3192, 0x3292], [0x3198, 0x3298], [0x317A, 0x327A], [0x3180, 0x3280],
        [0x3772, 0x3774], [0x3C72, 0x3C74], [0x407C, 0x417C], [0x4094, 0x4194]], doorTop: 0x85 } };
  // Scripted moves (RunSonic's interpreter at 0x2EFC): player state n (even) has a script at 0x25DF2 + the word at
  // 0x25DF2 + n - 2. A script is segments [motion offset, word: high byte 0x80 + facing / 256 (0: keep), low byte
  // frames], ended by 0x8000 and then 0 (done: the move ends where it is), a positive step back (repeat from there), or
  // a negative word and [x, y, z, facing, vx, vy, vz] (placed there). Motion (from 0x25DF2 + offset) is [dx, dy, dz]
  // a frame, 0x8000 and a step back repeating it. A segment lasts its frame count (at least one frame). Checked against
  // the emulator: RR1's two rides end where the original's do, to the unit.
  const SCRIPTS = 0x25DF2;
  function rideScript(d, state) {
    const base = SCRIPTS + s16(d, SCRIPTS + state - 2), path = [], turns = [], starts = [];
    let sp = 0, mo = 0, left = 0, end = null;
    while (path.length < 5000) {
      if (--left <= 0) {
        const a = base + sp, w0 = u16(d, a);
        if (w0 === 0x8000) {
          const back = s16(d, a + 2);
          if (back > 0) { sp -= back; left = 0; continue; }
          if (back < 0) end = [0, 1, 2, 3, 4, 5, 6].map(i => s16(d, a + 4 + 2 * i));
          break;
        }
        const w1 = u16(d, a + 2); mo = w0; left = w1 & 0xFF; sp += 4; starts.push(path.length);
        if (w1 & 0xFF00) turns.push([path.length, (w1 & 0xFF00) - 0x8000]);
      }
      if (u16(d, SCRIPTS + mo) === 0x8000) mo -= s16(d, SCRIPTS + mo + 2);
      path.push([s16(d, SCRIPTS + mo), s16(d, SCRIPTS + mo + 2), s16(d, SCRIPTS + mo + 4)]); mo += 6;
    }
    return { path, turns, end, starts };
  }
  const compassOf = f => (180 + f * 360 / 2048) % 360;   // the original's facing: 0 south, 0x200 west, 0x400 north
  // object types, identified by watching the game run: player start, springs, monitors, the act-end ring, main enemies
  const KINDS = { 0x30: 'start', 0x18: 'spring', 0x158: 'spring', 0x3C: 'monitor', 0x40: 'goal', 0x08: 'mine', 0x54: 'turret', 0x24: 'booster',
    0x0C: 'enemy', 0x94: 'enemy', 0x144: 'enemy', 0x148: 'enemy', 0x60: 'enemy', 0x64: 'enemy', 0x100: 'enemy', 0x10C: 'enemy',
    0xC4: 'enemy', 0xC8: 'enemy', 0x58: 'enemy', 0x9C: 'enemy', 0x8C: 'spring', 0x98: 'lift', 0xAC: 'crawler',
    0x5C: 'enemy', 0x14C: 'enemy', 0x150: 'balloon', 0xDC: 'spring',   // 0DC: Diamond Dust's snowdrift springs
    0x104: 'enemy', 0x108: 'enemy', 0x12C: 'jetLift', 0x120: 'fireSpot', 0x128: 'movePlat', 0x118: 'spikeBall',
    0x7C: 'sprinkler', 0x6C: 'pylon', 0x78: 'movePlat', 0x70: 'prop', 0x74: 'prop',
    0x178: 'enemy', 0x19C: 'capsule', 0x194: 'lever', 0x184: 'prop', 0x17C: 'enemy', 0x180: 'beamPost', 0x18C: 'jetLift',
    0x15C: 'friend', 0x160: 'friend',   // Tails and Knuckles (0xCF1E: fifty rings in all open a special stage)
    0x44: 'head' };   // Sonic heads (0x18086): ten make a continue
  // drawn only: Gene Gadget's doors (070, frame 0x18 / 4 shut) and pads (074); Panic Puppet's door (184, frame 7 shut,
  // opened while the key of the gate beside it is held)
  const PROP_FRAME = { 0x70: 6, 0x74: 0, 0x184: 7 };
  // Gene Gadget: sprinklers (07C, handler 0x174B4) turn 0x10 of 0x800 a frame from word +0x24 and, once Sonic has come
  // within 80 units, shoot every 16 frames (watched); pylons (06C, 0x17A1A) are the barriers' electric posts, drawn only
  // moving platform (128, handler 0x176B6, word +0x24 = 0): along x (z with bit 3 of byte +0x16) about word +0x28, 63 units
  // each way, angle word +0x26 + 4 a frame of 0x800; box as the jet lift's (swapped). Spiked balls (118): moved by the
  // act's routine (VV2: z = 0xE80 + or - 112 x sine >> 16, alternate records opposite, angle + 8 a frame)
  // Volcano Valley: enemies 100 and 108 walk to and fro along x or z between words +0x24 and +0x26 (along x if that holds
  // x; measured at half a unit a frame, as Gene Gadget's 05C and Panic Puppet's 178: the handlers add one every other
  // frame); jet lifts (12C, handler 0x177F6): a box 32 x 48 units from the record (48 x 32 with bit 3
  // of byte +0x16) rising a unit a frame from +0x24 to +0x26 while stood on; fire (120): burns unless the fire shield
  const PATROL = new Set([0x100, 0x108, 0x148, 0x9C, 0x5C, 0x178]);   // (0x108 and Spring Stadium's 0x148 share handler 0x16528; Rusty Ruin's 09C, 0x17294, is the same)
  // handler 0x17346 (094, 144, 10C, 17C): wanders; 0x17CB6 (060, 14C, 104; 0C4 joins it): roams and chases
  const WANDER = new Set([0x94, 0x144, 0x10C, 0x17C]), ROAM = new Set([0x60, 0x14C, 0x104, 0xC4]);   // (Gene Gadget's 05C: handler 0x17E80; Panic Puppet's 178: 0x15E20)
  // Spring Stadium's balloons (150, handler 0x164B0): bob 8 units about word +0x26 (phase +0x24, 16 a frame of 2048);
  // touched, they pop and throw Sonic about 43 units up (measured), and are back about 70 frames later
  // Rusty Ruin's spiked crawler (0AC), watched in the emulator: it rolls 1 unit a frame along the foot of a wall between
  // words +0x24 and +0x26, turning at each end, and hurts whatever touches it (it cannot be broken). The range holds
  // the record's x when it runs along x, else it runs along z (all three records; the rule is mine).
  // Rusty Ruin 2, watched in the emulator: 08C is a stone trampoline at its own height (Sonic bounces 94 units up
  // whatever he presses); 098 a stone slab over a gap that sinks 84 units about a second after Sonic lands on it
  const MONITOR_KINDS = ['oneup', 'rings', 'shield', 'gold', 'invincible', 'speed', 'fire'];
  const LEVELS = [
    [1, 'Green Grove 1'], [2, 'Green Grove 2'], [3, 'Green Grove 3'],
    [7, 'Rusty Ruin 1'], [6, 'Rusty Ruin 2'], [8, 'Rusty Ruin 3'],
    [15, 'Spring Stadium 1'], [16, 'Spring Stadium 2'], [17, 'Spring Stadium 3'],
    [9, 'Diamond Dust 1'], [10, 'Diamond Dust 2'], [11, 'Diamond Dust 3'],
    [13, 'Volcano Valley 1'], [12, 'Volcano Valley 2'], [14, 'Volcano Valley 3'],
    [4, 'Gene Gadget 1'], [5, 'Gene Gadget 2'], [18, 'Gene Gadget 3'],
    [20, 'Panic Puppet 1'], [19, 'Panic Puppet 2'], [21, 'Panic Puppet 3'],
    [22, 'Final Fight'],
  ];

  // ---- Rob Northen Compression method 1 (after the public-domain dernc algorithm) ----
  const CRC = new Uint16Array(256);
  for (let i = 0; i < 256; i++) { let v = i; for (let j = 0; j < 8; j++) v = v & 1 ? (v >>> 1) ^ 0xA001 : v >>> 1; CRC[i] = v; }
  function crc16(d, a, b) { let c = 0; for (let i = a; i < b; i++) { c ^= d[i]; c = (c >>> 8) ^ CRC[c & 0xFF]; } return c; }
  const u32 = (d, o) => ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0;
  const u16 = (d, o) => (d[o] << 8) | d[o + 1];
  const s16 = (d, o) => { const v = u16(d, o); return v & 0x8000 ? v - 0x10000 : v; };

  function rncUnpack(d, off) {
    if (d[off] !== 0x52 || d[off + 1] !== 0x4E || d[off + 2] !== 0x43 || d[off + 3] !== 1) throw new Error('no packed block where the map should be');
    const size = u32(d, off + 4), packed = u32(d, off + 8), ucrc = u16(d, off + 12), pcrc = u16(d, off + 14);
    if (off + 18 + packed > d.length || crc16(d, off + 18, off + 18 + packed) !== pcrc) throw new Error('packed map failed its checksum');
    const out = new Uint8Array(size);
    let o = 0, p = off + 18;
    const word = q => (q + 1 < d.length ? d[q] | (d[q + 1] << 8) : q < d.length ? d[q] : 0);
    // bit buffer: numbers stay below 2^32 so plain arithmetic is safe
    let buf = word(p), cnt = 16;
    const advance = n => { buf = Math.floor(buf / 2 ** n); cnt -= n; if (cnt < 16) { p += 2; buf += word(p) * 2 ** cnt; cnt += 16; } };
    const peek = bits => buf % 2 ** bits;
    const read = bits => { const r = peek(bits); advance(bits); return r; };
    const fix = () => { cnt -= 16; buf = buf % 2 ** cnt + word(p) * 2 ** cnt; cnt += 16; };
    const mirror = (x, n) => { let r = 0; for (let i = 0; i < n; i++) { r = (r << 1) | (x & 1); x >>= 1; } return r; };
    const table = () => {
      const num = read(5); if (!num) return [];
      const lens = []; for (let i = 0; i < num; i++) lens.push(read(4));
      const t = []; let code = 0;
      for (let i = 1; i <= Math.max(1, ...lens); i++) { for (let j = 0; j < num; j++) if (lens[j] === i) { t.push([mirror(code, i), i, j]); code++; } code <<= 1; }
      return t;
    };
    const huf = t => {
      for (const [code, ln, val] of t) if (peek(ln) === code) {
        advance(ln);
        if (val < 2) return val;
        const v = 2 ** (val - 1);
        return v + read(val - 1);
      }
      throw new Error('packed map is damaged');
    };
    advance(2);
    while (o < size) {
      const raw = table(), dist = table(), len = table();
      let count = read(16);
      for (;;) {
        let n = huf(raw);
        if (n) { for (let i = 0; i < n && o < size; i++) out[o++] = d[p++]; fix(); }
        if (--count <= 0) break;
        const back = huf(dist) + 1;
        n = huf(len) + 2;
        for (let i = 0; i < n && o < size; i++, o++) out[o] = out[o - back];
      }
    }
    if (crc16(out, 0, size) !== ucrc) throw new Error('unpacked map failed its checksum');
    return out;
  }

  // Is this the Mega Drive ROM this reader understands? Returns null if so, else a reason.
  function check(d) {
    if (d.length < 0x400000) return 'This file is smaller than the 4 MB Mega Drive game.';
    const name = String.fromCharCode(...d.subarray(0x150, 0x16E)).trim();
    if (!/SONIC 3D/.test(name)) return 'This file does not look like the Sonic 3D Blast Mega Drive ROM.';
    let sum = 0; for (let i = 0x200; i + 1 < d.length; i += 2) sum = (sum + u16(d, i)) & 0xFFFF;
    if (sum !== u16(d, 0x18E)) return 'The ROM checksum does not match, so the file may be damaged or modified.';
    const first = u32(d, HEADERS + 4);
    if (first + 4 > d.length || d[first] !== 0x52 || d[first + 1] !== 0x4E || d[first + 2] !== 0x43) return 'This version of the game keeps its levels somewhere this reader does not know.';
    return null;
  }

  // ---------------- opening the player's file: plain ROM, .smd dump, or either inside a .zip ----------------
  // SMD: 512-byte header, then 16 KB blocks holding the odd bytes in their first half and the even bytes in the second.
  function fromSmd(d) {
    const body = d.length - 512, out = new Uint8Array(body);
    for (let b = 0; b < body; b += 16384) for (let i = 0; i < 8192; i++) {
      out[b + i * 2 + 1] = d[512 + b + i]; out[b + i * 2] = d[512 + b + 8192 + i];
    }
    return out;
  }
  // Zip: read the central directory, take the likeliest game file, inflate it with the browser's own DecompressionStream.
  async function fromZip(d) {
    let e = -1;
    for (let i = d.length - 22; i >= Math.max(0, d.length - 65558); i--) if (d[i] === 0x50 && d[i + 1] === 0x4B && d[i + 2] === 5 && d[i + 3] === 6) { e = i; break; }
    if (e < 0) throw new Error('This zip file is damaged: its table of contents is missing.');
    const le16 = o => d[o] | (d[o + 1] << 8), le32 = o => (le16(o) | (le16(o + 2) << 16)) >>> 0;
    const files = [];
    for (let n = le16(e + 10), o = le32(e + 16); n > 0 && o + 46 <= d.length; n--) {
      if (le32(o) !== 0x02014B50) break;
      const nameLen = le16(o + 28);
      files.push({ method: le16(o + 10), csize: le32(o + 20), size: le32(o + 24), local: le32(o + 42),
        name: new TextDecoder().decode(d.subarray(o + 46, o + 46 + nameLen)) });
      o += 46 + nameLen + le16(o + 30) + le16(o + 32);
    }
    const game = /\.(md|bin|gen|smd|68k|sgd)$/i;
    const pick = files.filter(f => !f.name.endsWith('/')).sort((a, b) => (game.test(b.name) - game.test(a.name)) || (b.size - a.size))[0];
    if (!pick) throw new Error('This zip file has no files in it.');
    const start = pick.local + 30 + le16(pick.local + 26) + le16(pick.local + 28), raw = d.subarray(start, start + pick.csize);
    if (pick.method === 0) return raw.slice();
    if (pick.method !== 8) throw new Error('This zip file uses a kind of compression the browser cannot open. Unzip it first and choose the ROM itself.');
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot open zip files. Unzip it first and choose the ROM itself.');
    const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  // returns the ROM bytes ready for check(), or throws an Error with a sentence for the player
  async function openRomFile(buf) {
    let d = new Uint8Array(buf);
    if (d[0] === 0x50 && d[1] === 0x4B && d[2] === 3 && d[3] === 4) d = await fromZip(d);
    if (check(d) && d.length > 512 && (d.length - 512) % 16384 === 0) { const s = fromSmd(d); if (!check(s)) d = s; }
    return d;
  }

  // The original's movement, measured in the running game (world units, 60 frames a second; one cell = 32 units):
  // gravity 0.25 units/frame², a jump at 5.625 units a frame (0x5A000; the first frame rises 5.375, about 60 in all),
  // terminal fall 7 units/frame, steps of 8 walked, 16 blocked.
  // orig: the original's movement tables (Sim.P.orig, routine 0x3330)
  function physicsFor(vscale) {
    const r4 = v => Math.round(v * vscale * 1e4) / 1e4, g = 900 / CELL;
    const jump = 5.625 * 60 / CELL;   // (checked frame by frame against the original: the rise matches to the unit)
    // (steps: 8 units walked up (the sim's walls use the exact rule), a drop of more than 2 leaves the ground: 0x40D0, 0x414A)
    return { gravity: r4(g), jumpV: r4(jump), jumpCut: r4(jump * 0.4), maxFall: r4(420 / CELL), stepUp: r4(8 / CELL), snapDown: r4(2 / CELL), orig: 1 };
  }
  const launchFor = (vscale, rise) => { const g = 900 / CELL * vscale, hh = rise / CELL * vscale; return Math.round((g / 60 + Math.sqrt((g / 60) ** 2 + 8 * g * hh)) / 2 * 1e4) / 1e4; };
  const springPower = vscale => launchFor(vscale, 140);   // measured: a spring throws Sonic 140 units up
  function convert(d, id, vscale = 1) {
    const h = HEADERS + (id - 1) * HSIZE;
    const raw = rncUnpack(d, u32(d, h + 4));
    const map = new Uint16Array(128 * 128);
    for (let i = 0; i < map.length; i++) map[i] = u16(raw, i * 2);
    for (const [cx, cz, v] of (GIMMICKS[id] || {}).mapSet || []) map[cz * 128 + cx] = v;   // (cells the act's InitLevel writes for good)
    map.fill(0, 0, (GIMMICKS[id] || {}).mapClear || 0);   // (words the act uses for other things: Panic Puppet 3's serpent path)
    let x0 = 127, x1 = 0, z0 = 127, z1 = 0;
    for (let i = 0; i < map.length; i++) if (map[i]) { const x = i % 128, z = i >> 7; x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    if (x1 < x0) throw new Error('this level has no floor');
    x0 = Math.max(0, x0 - 1); z0 = Math.max(0, z0 - 1); x1 = Math.min(127, x1 + 1); z1 = Math.min(127, z1 + 1);
    const W = x1 - x0 + 1, D = z1 - z0 + 1, unit = STEP / CELL * vscale;
    const gm = GIMMICKS[id] || {}, mps = 60 / CELL;   // units a frame to metres a second
    const tiles = [];
    let minTop = Infinity, sumX = 0, sumZ = 0, nFloor = 0;
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const v = map[z * 128 + x];
      // no floor: the original never lets Sonic walk or jump into these cells (tested at 18 edges in 3 levels)
      if (!v) { tiles.push({ c: [0, 0, 0, 0], t: 'W' }); continue; }
      const hb = v >> 8, c = [(v >> 6) & 3, (v >> 4) & 3, (v >> 2) & 3, v & 3].map(k => Math.round((hb + k) * unit * 1e4) / 1e4);
      minTop = Math.min(minTop, ...c); sumX += x; sumZ += z; nFloor++;
      // s: bit 0 the cell's split flag; bit 1 all four corners odd, which the slope routine reads as flat (0x3560)
      // bits 2-4: a diagonal corner piece by its byte (0xD5, 0x75, 0x5D, 0x57 = NW, NE, SE, SW corner up), plus one
      const s = (d[SPLIT + (v & 0xFF)] ? 1 : 0) | ((v & 0x55) === 0x55 ? 2 : 0) | ((PIECES.indexOf(v & 0xFF) + 1) << 2);
      tiles.push(Object.assign({ c, t: gm.spikes !== undefined && (v & 0xFF) === gm.spikes ? 'H' : 'F' }, s ? { s } : {}));
    }
    const floorCell = (cx, cz) => cx >= 0 && cz >= 0 && cx < 128 && cz < 128 && map[cz * 128 + cx] !== 0;
    const r3 = v => Math.round(v * 1000) / 1000, r6 = v => Math.round(v * 1e6) / 1e6;
    // objects: 52-byte records in the packed block at header +0x00; type at +0x22, code address at +0x30, x/y/z at +6/+0xA/+0xE
    const ob = rncUnpack(d, u32(d, h));
    const ents = [], holes = [];
    let balls = 0;
    // start table (+0x20): [x, z, facing] per section; +0x12 >= 0 when the act has big rings, listed from +0x14
    // as [x, y, z] per section until x is 0. Each ring used moves the act on a section.
    const st = u32(d, h + 0x20), tableRings = s16(d, st + 0x12) >= 0;
    let start = null;
    for (let k = 0; (k + 1) * 0x34 <= ob.length; k++) {
      const o = k * 0x34, t = u16(ob, o + 0x22), code = u32(ob, o + 0x30);
      if (!(code < 0x400000 && t < 0x400)) break;
      if (!code) continue;
      const x = s16(ob, o + 6), z = s16(ob, o + 0xE);
      // holes (Green Grove): mode 1 = open from the start, 4 = opened by the next big ring; the second record of a pair is 0
      if (t === 0x1C || t === 0x90 || t === 0xCC || t === 0x110) { const mode = u16(ob, o + 0x24); if (mode) holes.push([x, z, mode]); continue; }
      const kind = KINDS[t];
      if (kind === 'goal' && tableRings) continue;
      // (Panic Puppet's levers and door stand in wall cells)
      if (!kind || (!floorCell(Math.floor(x / CELL), Math.floor(z / CELL)) && kind !== 'lever' && t !== 0x184)) continue;
      if (kind === 'start') { start = [x / CELL, z / CELL]; continue; }
      const e = { type: kind, x: r3(x / CELL - x0), z: r3(z / CELL - z0) };
      // Green Grove guide + emulator: Hunters (0C) stand still with a spike ball circling them (radius 23.5 units,
      // measured; about 20 units up, estimated), Scouters (58) chase; monitor kind = word +0x26 / 0x80 (icon order in
      // the ROM); a supercharger fires along z, towards +z when bit 0x800 of word +0x16 is set
      if (kind === 'enemy') {
        e.radius = t === 0x0C ? 0 : 1.0;
        if (t === 0x58) e.burst = 1;   // (handler 0x183FE: bursts into four shots when Sonic comes near; Sim `burst`)
        if (t === 0x0C) { e.orbit = r3(HUNTER_ORBIT / CELL); e.orbitY = r3(HUNTER_BALL_Y / CELL * vscale); }
      }
      if (kind === 'monitor') e.kind = MONITOR_KINDS[u16(ob, o + 0x26) >> 7] || 'rings';
      // superchargers (routine 0xCA6A): word +0x26 set and bit 3 of byte +0x16 pick the way: (0, 0) north, (0, 1) west,
      // (1, 0) south, (1, 1) east; Sonic is taken standing one cell that way from the record, held 70 frames, and dashes
      if (kind === 'booster') {
        const b3 = (ob[o + 0x16] >> 3) & 1, w26 = u16(ob, o + 0x26) !== 0;
        e.dir = w26 ? (b3 ? [1, 0] : [0, 1]) : (b3 ? [-1, 0] : [0, -1]);
        e.x = r3((x + e.dir[0] * CELL) / CELL - x0); e.z = r3((z + e.dir[1] * CELL) / CELL - z0);
      }
      if (kind === 'balloon') { e.y = r3((s16(ob, o + 0x26) + 8) / CELL * vscale); e.phase = u16(ob, o + 0x24) & 0x7FE; e.rise = launchFor(vscale, 43); }
      if (kind === 'spring') e.power = springPower(vscale);
      if (t === 0x8C) { e.power = launchFor(vscale, 94); e.absY = r3(s16(ob, o + 0xA) / CELL * vscale); }
      if (kind === 'lift') { e.y = r3(s16(ob, o + 0xA) / CELL * vscale); e.drop = r3(84 / CELL * vscale); }
      if (kind === 'enemy' && PATROL.has(t)) {
        const a = s16(ob, o + 0x24), b = s16(ob, o + 0x26), alongX = a <= x && x <= b;
        if (b > a) { e.patrol = { axis: alongX ? 'x' : 'z', range: alongX ? [r3(a / CELL - x0), r3(b / CELL - x0)] : [r3(a / CELL - z0), r3(b / CELL - z0)] }; e.speed = r3(30 / CELL); }
      }
      // a defeated enemy (or a broken capsule) frees a Flicky only when byte +0x19 holds its colour 1..4 (routine 0x192C2);
      // the sprite's palette line is bits 13 and 14 of word +0x16 (written only when not 3, the usual one)
      if (kind === 'enemy' || kind === 'capsule' || kind === 'lever' || kind === 'beamPost') {
        if (kind === 'enemy' || kind === 'capsule') { const fb = ob[o + 0x19]; e.flicky = fb >= 1 && fb <= 4 ? fb : 0; }
        const ln = (ob[o + 0x16] >> 5) & 3;
        if (ln !== 3) e.line = ln;
      }
      // Panic Puppet's 178 (handler 0x15E20): every 32 frames (global count $0B04) a shot from 12 units up and 16 out,
      // 2 units a frame east, south, west and north in turn from the index in word +0x2A / 12, one unit a frame up
      if (t === 0x178) e.shoot = (u16(ob, o + 0x2A) / 12) & 3;
      // wanderers (handler 0x17346: 094, 144, 10C, 17C): a unit a call (every other frame) a random way for up to 15 calls,
      // kept in the 64-unit square from words +0x28, +0x2A
      if (WANDER.has(t)) { e.wander = [r3(s16(ob, o + 0x28) / CELL - x0), r3(s16(ob, o + 0x2A) / CELL - z0), 2]; e.speed = r3(30 / CELL); }
      // roamers (handler 0x17CB6, Sim enemy `roam`): the 0x7C square from words +0x28 and +0x2A (its top bit is the chase
      // flag) in the original's units, angle +0x24; 064 (0x17BC8) turns toward Sonic and shoots (`aim`)
      if (ROAM.has(t)) e.roam = { box: [s16(ob, o + 0x28), u16(ob, o + 0x2A) & 0x7FFF], a: u16(ob, o + 0x24) & 0x7FE };
      if (t === 0x64) e.aim = { a: u16(ob, o + 0x24) & 0x7FE };
      // Panic Puppet 2's beam posts (180, handler 0x15F60): animation index from word +0x1E / 2 (24 steps of 9 frames; shown
      // frame 0 in steps 13..20), shooting 2 units a frame along z (x with bit 3 of byte +0x16) from 16 out, 16 under
      // the record, every 8 frames while on (watched)
      if (kind === 'beamPost') { e.y = r3((s16(ob, o + 0xA) - 8) / CELL * vscale); e.dir = (ob[o + 0x16] >> 3) & 1 ? [1, 0] : [0, 1]; e.phase = (u16(ob, o + 0x1E) >> 1) % 24; }
      // Panic Puppet's Flicky capsules (19C, handler 0x1680C): a 30 x 30 unit top 32 over the record (Sonic's frame);
      // landing on it throws him 5 units a frame up and breaks it (watched)
      if (kind === 'capsule') { const y = s16(ob, o + 0xA); e.y = r3((y + 8) / CELL * vscale); e.top = r3((y + 40) / CELL * vscale); e.half = r3(15 / CELL); }
      // levers (194, handler 0x16136): drawn by the value of the switch cells nearest (frame 0 for 0, 7 for 1)
      if (kind === 'lever') {
        let best = 4;
        for (const [cx, cz, reg] of gm.switches || []) { const dd = Math.hypot(cx + 0.5 - x / CELL, cz + 0.5 - z / CELL); if (dd < best) { best = dd; e.reg = reg; } }
        if (!e.reg) continue;
        e.y = r3((s16(ob, o + 0xA) + 8) / CELL * vscale);
      }
      if (kind === 'jetLift') {   // (Panic Puppet 2's lift 18C, handler 0x17606: a 31-unit square)
        const flip = (ob[o + 0x16] >> 3) & 1, sq = t === 0x18C, sx = sq ? 31 : flip ? 48 : 32, sz = sq ? 31 : flip ? 32 : 48;
        delete e.x; delete e.z;
        Object.assign(e, { x0: r3((x - 1) / CELL - x0), x1: r3((x - 1 + sx) / CELL - x0), z0: r3((z - 1) / CELL - z0), z1: r3((z - 1 + sz) / CELL - z0),
          y0: r3((s16(ob, o + 0x24) + 8) / CELL * vscale), y1: r3((s16(ob, o + 0x26) + 8) / CELL * vscale) });
      }
      if (kind === 'fireSpot') e.y = r3((s16(ob, o + 0xA) + 8) / CELL * vscale);
      if (kind === 'head') {   // taken in the cell at word +0x24 by a player from 40 units under it to 6 over
        const c = u16(ob, o + 0x24);
        e.y = r3((s16(ob, o + 0xA) + 8) / CELL * vscale); e.cell = [((c & 0xFF) >> 1) - x0, (c >> 8) - z0];
      }
      if (kind === 'friend') {   // hidden until the act's routine shows it (see GIMMICKS' friends)
        e.who = t === 0x15C ? 'tails' : 'knuckles'; e.y = r3((s16(ob, o + 0xA) + 8) / CELL * vscale);
        const sh = (gm.friends || {})[e.who];
        if (sh && sh.section) e.show = { section: sh.section };
        else if (sh) {
          const sk = sh.cannon ? 'cannon' : 'cell', c = sh[sk];
          e.show = { [sk]: [c[0] - x0, c[1] - z0] };
          if (sh.maxY !== undefined) e.show.maxY = r3((sh.maxY + 8) / CELL * vscale);
        }
      }
      if (kind === 'prop') {
        e.y = r3((s16(ob, o + 0xA) + 8) / CELL * vscale); e.frame = PROP_FRAME[t] || 0;
        if (t === 0x184) for (const [cells, , , , key] of gm.gates || []) if (key && cells.some(([cx, cz]) => Math.hypot(cx + 0.5 - x / CELL, cz + 0.5 - z / CELL) < 2)) e.key = key;
      }
      if (kind === 'sprinkler') { e.y = r3((s16(ob, o + 0xA) + 8) / CELL * vscale); e.phase = u16(ob, o + 0x24) & 0x7FE; }
      // the screen window it runs in (dispatcher 0x1BE72): its type's art header (table 0x280E8) [width, height, x and y
      // from its picture point (x - z + 0x1000, (x + z) / 2 - y)] and its record's y; it runs while that point less the
      // scroll is within 0..width and 0..height
      if (kind === 'enemy' || kind === 'sprinkler') {
        const art = typeArt(d, t);
        if (art > 0 && art + 8 <= d.length) e.win = [u16(d, art), u16(d, art + 2), s16(d, art + 4), s16(d, art + 6), s16(ob, o + 0xA)];
      }
      // its touch bytes (+4, +5; routine 0x1B8FE): touched when x - z is within 0x2C - b4 of Sonic's, (x + z) / 2 within
      // 0x20 - b4, and y within b5
      if ((kind === 'enemy' || kind === 'spikeBall' && gm.balls) && ob[o + 4]) e.touch = [ob[o + 4], ob[o + 5]];
      if (kind === 'enemy' && (u16(ob, o + 8) || u16(ob, o + 0x10))) e.fr = [u16(ob, o + 8), u16(ob, o + 0x10)];   // (x and z fractions, +8 / +0x10)
      // 0C8 (handler 0x16B46): steps through its animation table (0x16C7E, a word a frame from offset +0x1E; -1 jumps
      // back), which moves it round a square and fires where the frame says (Sim origC8)
      if (t === 0xC8) {
        const tab = []; for (let a = 0x16C7E; tab.length < 1024; a += 2) { const v = s16(d, a); tab.push(v); if (v < 0) { tab.push(s16(d, a + 2)); break; } }
        e.c8 = { i: u16(ob, o + 0x1E), r: [ob[o + 0x20], ob[o + 0x21]], t: tab };   // (r: its rate and count, +0x20 / +0x21)
      }
      if (kind === 'pylon') {   // the barrier whose zap cells are nearest turns it off
        e.y = r3((s16(ob, o + 0xA) + 8) / CELL * vscale);
        let best = 4;
        (gm.barriers || []).forEach(([, , zap, , ring]) => { for (const [cx, cz] of zap) { const dd = Math.hypot(cx + 0.5 - x / CELL, cz + 0.5 - z / CELL); if (dd < best) { best = dd; e.opens = ring; } } });
        if (!e.opens) continue;
      }
      if (t === 0x78) {   // Gene Gadget's platforms (078, handler 0x178D6; see GIMMICKS[4])
        if (s16(ob, o + 0x2C) < 0) continue;   // (the second half of a long one follows the first)
        const alongX = (ob[o + 0x16] >> 3) & 1, long = u16(ob, o + 0x2A) !== 0, sx = alongX && long ? 64 : 32, sz = !alongX && long ? 64 : 32;
        const a = s16(ob, o + 0x24), b = s16(ob, o + 0x26), org = alongX ? x0 : z0;
        Object.assign(e, { x0: r3((x - 1) / CELL - x0), x1: r3((x - 1 + sx) / CELL - x0), z0: r3((z - 1) / CELL - z0), z1: r3((z - 1 + sz) / CELL - z0),
          y: r3((s16(ob, o + 0xA) + 8) / CELL * vscale), axis: alongX ? 'x' : 'z',
          lin: { a: r3((a - 1) / CELL - org), b: r3((b - 1) / CELL - org), v: r3(mps), wait: 1, dir: ob[o + 0x28] ? -1 : 1, t: r3(ob[o + 0x29] / 60) } });
        delete e.x; delete e.z;
      }
      else if (kind === 'movePlat') {
        if (u16(ob, o + 0x24)) continue;   // (the sinking kind: in no level's records)
        const alongZ = (ob[o + 0x16] >> 3) & 1, sx = alongZ ? 48 : 32, sz = alongZ ? 32 : 48, T = Math.PI / 1024;
        Object.assign(e, { x0: r3((x - 1) / CELL - x0), x1: r3((x - 1 + sx) / CELL - x0), z0: r3((z - 1) / CELL - z0), z1: r3((z - 1 + sz) / CELL - z0),
          y: r3((s16(ob, o + 0xA) + 8) / CELL * vscale), axis: alongZ ? 'z' : 'x', centre: r3(s16(ob, o + 0x28) / CELL - (alongZ ? z0 : x0)), amp: r3(63 / CELL),
          w: r3(4 * T * 1e4) / 1e4, phase: r3((u16(ob, o + 0x26) & 0x7FE) * T * 1e4) / 1e4 });
      }
      if (kind === 'spikeBall') {
        if (!gm.balls) continue;
        const [mid, amp, step, gx, gz] = gm.balls, T = Math.PI / 1024, k = balls++;
        Object.assign(e, { y: r3((s16(ob, o + 0xA) + 8) / CELL * vscale), axis: 'z', centre: r3(mid / CELL - z0), amp: r3(amp / CELL), w: r3(step * T * 1e4) / 1e4, phase: k % 2 ? r3(Math.PI * 1e4) / 1e4 : 0 });
        e.gate = [r3(gx / CELL - x0), r3(gz / CELL - z0)];   // (they swing only with Sonic at or past x gx and z gz)
      }
      if (kind === 'crawler') {
        const a = s16(ob, o + 0x24), b = s16(ob, o + 0x26), alongX = a <= x && x <= b;
        e.y = r3((s16(ob, o + 0xA) + 8) / CELL * vscale); e.axis = alongX ? 'x' : 'z';
        e.range = alongX ? [r3(a / CELL - x0), r3(b / CELL - x0)] : [r3(a / CELL - z0), r3(b / CELL - z0)];
      }
      if (kind !== 'goal') e.skin = t.toString(16).toUpperCase().padStart(3, '0');
      ents.push(e);
    }
    for (const [cx, cz, mouth, up, south] of gm.cannons || []) if (floorCell(cx, cz))
      ents.push({ type: 'cannon', x: cx - x0, z: cz - z0, y: r3(mouth / CELL * vscale), h: r3(12 / CELL * vscale), vy: r3(up * mps * vscale), vz: r3(south * mps) });
    for (const [cells, top, dir] of gm.cracks || []) if (cells.every(([cx, cz]) => floorCell(cx, cz)))
      ents.push({ type: 'crack', cells: cells.map(([cx, cz, t]) => t ? [cx - x0, cz - z0, r3(t / CELL * vscale)] : [cx - x0, cz - z0]), top: r3(top / CELL * vscale), dir });
    // pillars; a linked one sinks to its own floor when broken and lowers other cells with it (quiet cells: drawn as rock,
    // not broken by touching them)
    const hb = v => r3(v * STEP / CELL * vscale);
    if (gm.pillars) for (let k = 0, o = gm.pillars[0]; k < gm.pillars[1]; k++, o += 14) {
      const c = u16(d, o + 10) >> 1, cx = c % 128, cz = c >> 7;
      if (!floorCell(cx, cz)) continue;
      const link = (gm.pillarLinks || []).find(q => q[0] === cx && q[1] === cz), cells = [[cx - x0, cz - z0]];
      if (link) { cells[0].push(hb(d[o + 12]), hb(link[2])); for (const [lx, lz, top] of link[3]) cells.push([lx - x0, lz - z0, hb(top), null, 1]); }
      ents.push({ type: 'crack', by: 'whirl', cells, top: hb(d[o + 12]) });
    }
    for (const [mark, dir, zMin, skipX] of gm.slides || []) {   // (zMin: Gene Gadget 2's routine looks only at cells from that row on; skipX: columns left out)
      const cells = [];
      for (let z = Math.max(z0, zMin || 0); z <= z1; z++) for (let x = x0; x <= x1; x++) { const v = map[z * 128 + x]; if (v && (v & 0xFF) === mark && !(skipX || []).includes(x)) cells.push([x - x0, z - z0]); }
      if (cells.length) ents.push({ type: 'slide', cells, dir });
    }
    if (gm.fans !== undefined) {
      const cells = [];
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) { const v = map[z * 128 + x]; if (v && (v & 0xFF) === gm.fans) cells.push([x - x0, z - z0]); }
      if (cells.length) ents.push({ type: 'fan', cells });
    }
    // maces (helper 0x86B0): 14-byte records [screen window x, y, centre x, y, z, turn a frame (2048 a turn), second
    // chain's angle after the first (0: none)]; a chain of three links and a spiked ball, 16 units apart, so the ball
    // circles 64 units out at the centre's height. Flamethrowers (helper 0x84F2): 8-byte records [x, z, y, flags];
    // flags 0x800: they fire along z (else x); while Sonic is in the 128 x 64 unit box in front, a fireball every 6 frames
    if (gm.maces) for (let k = 0, o = gm.maces[0]; k < gm.maces[1]; k++, o += 14) {
      const x = s16(d, o + 4), y = s16(d, o + 6), z = s16(d, o + 8), turn = s16(d, o + 10), second = s16(d, o + 12);
      if (!floorCell(Math.floor(x / CELL), Math.floor(z / CELL))) continue;
      ents.push({ type: 'mace', x: r3(x / CELL - x0), z: r3(z / CELL - z0), y: r3(y / CELL * vscale), r: r3(64 / CELL), link: r3(16 / CELL),
        w: r6(turn * Math.PI * 2 / 2048 * 60), balls: second ? [0, r6(second * Math.PI * 2 / 2048)] : [0] });
    }
    if (gm.flames) for (let k = 0, o = gm.flames[0]; k < gm.flames[1]; k++, o += 8) {
      const x = s16(d, o), z = s16(d, o + 2), y = s16(d, o + 4), fl = u16(d, o + 6);
      if (!floorCell(Math.floor(x / CELL), Math.floor(z / CELL))) continue;
      const e = { type: 'flame', x: r3(x / CELL - x0), z: r3(z / CELL - z0), y: r3(y / CELL * vscale), dir: fl & 0x800 ? [0, 1] : [1, 0] };
      if (gm.freeze) e.freeze = 1;   // Diamond Dust's snowblowers freeze rather than burn
      ents.push(e);
    }
    // doors: stepping on the cell (grounded) moves Sonic to the place given and pushes him out of it
    const DOOR_PUSH = { 0: [0, 4], 2: [-4, 0], 4: [0, -4] };
    if (gm.doors) for (let k = 0, o = gm.doors[0]; k < gm.doors[1]; k++, o += 28) {
      const c = u16(d, o) >> 1, cx = c % 128, cz = c >> 7, x = s16(d, o + 2), y = s16(d, o + 6), z = s16(d, o + 10);
      const [vx, vz] = DOOR_PUSH[u16(d, o + 22)] || [4, 0];
      if (floorCell(cx, cz) && floorCell(Math.floor(x / CELL), Math.floor(z / CELL)))
        ents.push({ type: 'hole', x: cx + 0.5 - x0, z: cz + 0.5 - z0, size: 0.5, opens: 0, exit: [r3(x / CELL - x0), r3(z / CELL - z0)],
          exitY: r3(y / CELL * vscale), push: [r3(vx * mps), r3(vz * mps)], launch: 0 });
    }
    // a ride's state with bit 15 set plays the script mirrored across the diagonal (x = -z, z = -x; facings to match:
    // Diamond Dust 1's north loop is the east loop so mirrored, in the emulator); with no velocity
    // given, the move's last step carries on; `force`: [frames, way] the pad is held afterwards (null: let go)
    const rideOf = (state, from, facing, vel) => {
      const sc = rideScript(d, state & 0x7FFF), mir = !!(state & 0x8000), path = mir ? sc.path.map(([a, b, c]) => [-c, b, -a]) : sc.path, last = path[path.length - 1] || [0, 0, 0];
      return { start: from ? [r3(from[0] / CELL - x0), r3(from[1] / CELL * vscale), r3(from[2] / CELL - z0)] : null, facing: facing === null ? null : compassOf(facing),
        vel: vel ? [r6(vel[0] * mps), r6(vel[1] * mps * vscale), r6(vel[2] * mps)] : [r3(last[0] * mps), 0, r3(last[2] * mps)],
        path: path.map(([dx, dy, dz]) => [r6(dx / CELL), r6(dy / CELL * vscale), r6(dz / CELL)]),
        turns: sc.turns.map(([i, f]) => [i, compassOf(mir ? (0x200 - f) & 0x7FF : f)]), sc };
    };
    for (const [cx, cz, after, state, from, facing, vel, maxY, force, run, anim] of gm.rides || []) if (floorCell(cx, cz) && (!from || floorCell(Math.floor(from[0] / CELL), Math.floor(from[2] / CELL)))) {
      const { sc, ...rd } = rideOf(state, from, facing, vel), ride = { ...rd,
        end: sc.end ? { at: [r3(sc.end[0] / CELL - x0), r3(sc.end[1] / CELL * vscale), r3(sc.end[2] / CELL - z0)], facing: compassOf(sc.end[3]),
          vel: [r3(sc.end[4] * mps), r3(-sc.end[5] * mps * vscale), r3(sc.end[6] * mps)] } : null };
      if (anim !== undefined) ride.anim = anim;   // the animation the routine sets (Diamond Dust 1's 0x3A: 2, with $56 = 2)
      if (force) { ride.force = { t: r3(force[0] / 60), dir: force[1] }; if (force[2]) ride.force.roll = 1; if (force[3]) ride.force.pass = 1; }   // roll: left rolling ($56 = 2); pass: gates let it through
      // the routines look only at the cell (and a height), grounded or not
      const e = { type: 'hole', x: cx + 0.5 - x0, z: cz + 0.5 - z0, size: 0.5, opens: after, air: true, ride };
      if (maxY !== undefined) e.maxY = r3(maxY / CELL * vscale);
      if (run) e.run = 1;   // only in a supercharged run
      ents.push(e);
    }
    for (const [cx, cz, frames] of gm.holds || []) if (floorCell(cx, cz)) ents.push({ type: 'hold', x: cx + 0.5 - x0, z: cz + 0.5 - z0, t: r3(frames / 60) });
    // tubes (helper 0x9B40): two mouths; a grounded Sonic in the first's box (x w0..w0 + 32, z w1..w1 + 8) is pulled to
    // [w2, w3, w4] and 30 frames later plays the state in (leaving east), in the second's (z w5..w5 + 32, x w6..w6 + 8)
    // to [w7, w8, w9] and the state out (leaving south)
    if (gm.tubes) {
      const [tab, sa, sb] = gm.tubes, w = k => s16(d, tab + 2 * k);
      for (const [bx0, bx1, bz0, bz1, at, st] of [[w(0), w(0) + 32, w(1), w(1) + 8, [w(2), w(3), w(4)], sa], [w(6), w(6) + 8, w(5), w(5) + 32, [w(7), w(8), w(9)], sb]]) {
        if (!floorCell(Math.floor((bx0 + bx1) / 2 / CELL), Math.floor((bz0 + bz1) / 2 / CELL))) continue;
        const { sc, ...rd } = rideOf(st, at, null, null), ride = { ...rd, end: null, wait: r3(30 / 60) };
        ents.push({ type: 'hole', x: r3((bx0 + bx1) / 2 / CELL - x0), z: r3((bz0 + bz1) / 2 / CELL - z0), half: [r3((bx1 - bx0) / 2 / CELL), r3((bz1 - bz0) / 2 / CELL)], opens: 0, ride });
      }
    }
    const cellsOf = mark => {
      const c = [];
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) { const v = map[z * 128 + x]; if (v && (v & 0xFF) === mark) c.push([x - x0, z - z0]); }
      return c;
    };
    // (floor springs, end of 0x9974: grounded, $16 set to 7.875 units a frame up after his move: `set`)
    if (gm.floorSprings !== undefined) { const cells = cellsOf(gm.floorSprings); if (cells.length) ents.push({ type: 'springCells', cells, power: launchFor(vscale, 124), set: r6(7.875 * mps * vscale) }); }
    if (gm.bumpers) {
      const [mark, tab, n] = gm.bumpers, cells = cellsOf(mark);
      for (let k = 0; k < n; k++) {
        const off = Math.abs(s16(d, tab + 2 * k)) >> 1, cx = off & 127, cz = off >> 7;
        if (cx >= x0 && cx <= x1 && cz >= z0 && cz <= z1 && map[cz * 128 + cx] && !cells.some(c => c[0] === cx - x0 && c[1] === cz - z0)) cells.push([cx - x0, cz - z0]);
      }
      if (cells.length) ents.push({ type: 'bumpers', cells });
    }
    if (gm.spikeField !== undefined) { const cells = cellsOf(gm.spikeField); if (cells.length) ents.push({ type: 'spikeField', cells }); }
    // Diamond Dust: chutes [x0, x1, z0, z1, way, speed-up a frame, steer-to x] (units), dashes [x, z, under y, velocity,
    // frames, jump at frame, jump speed], sleds [x0, x1, z, z, pulled to, way, speed-up, frames], currents [x0, x1, z0, z1,
    // way, speed-up, top, on leaving], hops [cells, rise in units]
    const box = (a, b, c, e) => [a - x0, b - x0 + 1, c - z0, e - z0 + 1];
    for (const [ax, bx, az, bz, dir, acc, cx, top, hold] of gm.chutes || []) {   // (top: units a frame; hold: frames, rolling)
      const e = { type: 'chute', box: box(ax, bx, az, bz), dir, accel: r3(acc * 3600 / CELL), steer: r3(cx / CELL - x0) };
      if (top) { e.top = r3(top * mps); e.hold = r3(hold / 60); }
      ents.push(e);
    }
    for (const [cx, cz, maxY, v, n, at, jv] of gm.dashes || []) if (floorCell(cx, cz))
      ents.push({ type: 'dash', x: cx + 0.5 - x0, z: cz + 0.5 - z0, maxY: r3((maxY + 8) / CELL * vscale), v: [r3(v[0] * mps), r3(v[1] * mps)], t: r3(n / 60), jumpAt: r3(at / 60), jumpV: r3(jv * mps * vscale) });
    for (const [ax, bx, az, bz, at, dir, acc, n] of gm.sleds || [])
      ents.push({ type: 'sled', box: box(ax, bx, az, bz), at: [r3(at[0] / CELL - x0), r3(at[1] / CELL * vscale), r3(at[2] / CELL - z0)], dir, accel: r3(acc * 3600 / CELL), t: r3(n / 60) });
    for (const [ax, bx, az, bz, dir, acc, top, leave] of gm.currents || [])
      ents.push({ type: 'current', box: box(ax, bx, az, bz), dir, accel: r3(acc * 3600 / CELL), top: r3(top * mps), leave: r3(leave * mps) });
    if (gm.hops) { const cells = gm.hops[0].filter(([cx, cz]) => floorCell(cx, cz)).map(([cx, cz]) => [cx - x0, cz - z0]); if (cells.length) ents.push({ type: 'springCells', cells, power: launchFor(vscale, gm.hops[1]) }); }
    if (gm.ice) {
      const [a, na, b, nb, moreOn, moreOff] = gm.ice;
      const cl = (o, n, more) => [...Array.from({ length: n }, (_, k) => u16(d, o + 2 * k) >> 1), ...more.map(([cx, cz]) => cz * 128 + cx)]
        .filter(c => floorCell(c % 128, c >> 7)).map(c => [c % 128 - x0, (c >> 7) - z0]);
      ents.push({ type: 'ice', on: cl(a, na, moreOn), off: cl(b, nb, moreOff) });
    }
    if (gm.iceSpikes) {
      const cells = Array.from({ length: gm.iceSpikes[1] }, (_, k) => u16(d, gm.iceSpikes[0] + 12 * k + 10) >> 1)
        .filter(c => floorCell(c % 128, c >> 7)).map(c => [c % 128 - x0, (c >> 7) - z0]);
      if (cells.length) ents.push({ type: 'iceSpikes', cells });
    }
    if (gm.roofs) for (let o = gm.roofs; s16(d, o) >= 0; o += 6) {
      const cells = [u16(d, o) >> 1, u16(d, o + 2) >> 1].filter(c => floorCell(c % 128, c >> 7)).map(c => [c % 128 - x0, (c >> 7) - z0]);
      if (cells.length) ents.push({ type: 'lowRoof', cells, top: r3((u16(d, o + 4) + 8) / CELL * vscale) });
    }
    if (gm.lava !== undefined) { const cells = cellsOf(gm.lava); if (cells.length) ents.push({ type: 'lava', cells }); }
    if (gm.rocks) {
      const cells = [];
      for (let k = 0; k < gm.rocks[1]; k++) {
        const c = u16(d, gm.rocks[0] + 12 * k + 10) >> 1, cx = c % 128, cz = c >> 7, v = map[c];
        if (!floorCell(cx, cz) || cells.some(q => q[0] === cx - x0 && q[1] === cz - z0)) continue;
        const top = (v >> 8) * STEP + Math.max((v >> 6) & 3, (v >> 4) & 3, (v >> 2) & 3, v & 3) * STEP + 16;
        cells.push([cx - x0, cz - z0, r3(top / CELL * vscale)]);
      }
      if (cells.length) ents.push({ type: 'rocks', cells });
    }
    if (gm.spouts) for (let k = 0; k < gm.spouts[1]; k++) {
      const o = gm.spouts[0] + 16 * k, x = s16(d, o), z = s16(d, o + 2), y = s16(d, o + 4), V = i => s16(d, o + 6 + 2 * i) * 16 / 65536;
      if (!floorCell(Math.floor(x / CELL), Math.floor(z / CELL))) continue;
      ents.push({ type: 'spout', x: r3(x / CELL - x0), y: r3((y + 8) / CELL * vscale), z: r3(z / CELL - z0), v: [r3(V(0) * mps), r3(-V(1) * mps * vscale), r3(V(2) * mps)],
        phase: s16(d, o + 12) & 255, window: s16(d, o + 14) });
    }
    if (gm.fireRuns) for (let k = 0; k < gm.fireRuns[1]; k++) {
      const o = gm.fireRuns[0] + 0x28 * k, bx = s16(d, o), bw = s16(d, o + 2), bz = s16(d, o + 4), bh = s16(d, o + 6), shots = [];
      for (let j = 0; j < 4; j++) {
        const q = o + 8 + 8 * j, x = s16(d, q);
        if (x) shots.push([r3(x / CELL - x0), r3((s16(d, q + 2) + 8) / CELL * vscale), r3(s16(d, q + 4) / CELL - z0), u16(d, q + 6) & 0x800 ? 'z' : 'x', j]);
      }
      if (shots.length) ents.push({ type: 'fireRun', box: [r3(bx / CELL - x0), r3((bx + bw) / CELL - x0), r3(bz / CELL - z0), r3((bz + bh) / CELL - z0)], shots });
    }
    // fire bars (helper 0xBA68: 14-byte records [camera box x, w, z, h, then x, y, z]): six fireballs 17 units apart along
    // x from (x, y, z), turning about it in y and z 4, 8, 12, 12, 8, 4 units out, a turn every 64 frames
    if (gm.fireBars) for (let k = 0; k < gm.fireBars[1]; k++) {
      const o = gm.fireBars[0] + 14 * k, x = s16(d, o + 8), y = s16(d, o + 10), z = s16(d, o + 12);
      if (floorCell(Math.floor(x / CELL), Math.floor(z / CELL))) ents.push({ type: 'fireBar', x: r3(x / CELL - x0), y: r3((y + 8) / CELL * vscale), z: r3(z / CELL - z0) });
    }
    if (gm.vents) for (let k = 0; k < gm.vents[1]; k++) {
      const o = gm.vents[0] + 30 * k, c = u16(d, o) >> 1, cx = c % 128, cz = c >> 7, tx = s16(d, o + 2), ty = s16(d, o + 6), tz = s16(d, o + 10);
      if (!floorCell(cx, cz) || !floorCell(Math.floor(tx / CELL), Math.floor(tz / CELL))) continue;
      ents.push({ type: 'vent', x: cx + 0.5 - x0, z: cz + 0.5 - z0, to: [r3(tx / CELL - x0), r3((ty + 8) / CELL * vscale), r3(tz / CELL - z0)],
        vel: [r3(-2 * mps), r3(8.5 * mps * vscale), r3(-2 * mps)] });
      const off = (gm.ventOff || []).find(q => q[0] === c << 1);
      if (off) ents[ents.length - 1].offWhileRock = [(off[1] >> 1) % 128 - x0, (off[1] >> 8) - z0];
    }
    if (gm.tris) ents.push({ type: 'triBumpers', list: gm.tris.map(([band, b, sd, flip, vx, vz, along]) => ({ band,
      b: r3(b / CELL - (band === 'x' ? x0 : z0)), s: r3(sd / CELL - (band === 'x' ? z0 : x0)), flip: !!flip, v: [r3(vx * mps), r3(vz * mps)], along: !!along })) });
    if (gm.spears) {
      const cells = [];
      for (let k = 0; k < gm.spears[1]; k++) { const off = u16(d, gm.spears[0] + 2 * k) >> 1, cx = off & 127, cz = off >> 7; if (floorCell(cx, cz)) cells.push([cx - x0, cz - z0]); }
      if (cells.length) ents.push({ type: 'spears', cells });
    }
    if (gm.spikeWall) { const [cx, zs, top] = gm.spikeWall; ents.push({ type: 'spikeWall', cells: zs.filter(cz => floorCell(cx, cz)).map(cz => [cx - x0, cz - z0]), side: 'w', top: r3((top + 8) / CELL * vscale) }); }
    // Gene Gadget (see GIMMICKS[4])
    if (gm.updrafts !== undefined) { const cells = cellsOf(gm.updrafts); if (cells.length) ents.push({ type: 'updraft', cells }); }
    if (gm.zapCells !== undefined) { const cells = cellsOf(gm.zapCells); if (cells.length) ents.push({ type: 'zapCells', cells }); }
    if (gm.pyramids) {
      const boxes = [];
      for (let k = 0; k < gm.pyramids[1]; k++) {
        const bx = s16(d, gm.pyramids[0] + 4 * k), bz = s16(d, gm.pyramids[0] + 4 * k + 2);
        if (floorCell(Math.floor((bx + 32) / CELL), Math.floor((bz + 32) / CELL))) boxes.push([r3(bx / CELL - x0), r3(bz / CELL - z0)]);
      }
      if (boxes.length) ents.push({ type: 'pyramids', boxes });
    }
    const gateTop = hb => r3(hb * STEP / CELL * vscale);
    for (const [wall, hb, zap, half, ring, away] of gm.barriers || []) {
      const wc = wall.filter(([cx, cz]) => floorCell(cx, cz)).map(([cx, cz]) => [cx - x0, cz - z0]), zc = zap.filter(([cx, cz]) => floorCell(cx, cz)).map(([cx, cz]) => [cx - x0, cz - z0]);
      if (wc.length) ents.push({ type: 'gate', cells: wc, top: gateTop(hb), opens: ring });
      if (zc.length) ents.push({ type: 'barrier', cells: zc, half, away, opens: ring });
    }
    // cells that end a supercharger's run (flag 1) or a sled's (2): its gates shut again (the routine clears its flag there)
    for (const flag of [1, 2]) {
      const pc = (gm.passOff || []).filter(q => (q[2] || 1) === flag && floorCell(q[0], q[1])).map(([cx, cz]) => [cx - x0, cz - z0]);
      if (pc.length) { const e = { type: 'passOff', cells: pc }; if (flag > 1) e.flag = flag; ents.push(e); }
    }
    for (const [cells, hb, ring, pass, key] of gm.gates || []) {
      const gc = cells.filter(([cx, cz]) => floorCell(cx, cz)).map(([cx, cz]) => [cx - x0, cz - z0]);
      if (gc.length) { const g = { type: 'gate', cells: gc, top: gateTop(hb), opens: ring }; if (pass) g.pass = pass; if (key) g.key = key; ents.push(g); }
    }
    for (const [cx, cz, key, regs] of gm.keyOff || []) if (floorCell(cx, cz)) { const e = { type: 'keyOff', x: cx - x0, z: cz - z0, key }; if (regs) e.regs = regs; ents.push(e); }
    // switch cells (Panic Puppet 1's routine): standing on one sets a named value; carriers read them
    if (gm.switches) { const cells = gm.switches.filter(([cx, cz]) => floorCell(cx, cz)).map(([cx, cz, reg, v]) => [cx - x0, cz - z0, reg, v]); if (cells.length) ents.push({ type: 'switchCells', cells }); }
    // a pair of warp holes (Diamond Dust 1's routine): [cell x, z, then the exit x, y, z (units) and the depth under which
    // falling into this cell puts Sonic at that exit]; out: how he is thrown up from it (2 a frame west and north, 8.5 up)
    if (gm.warps) {
      const [[ax, az, ...ae], [bx, bz, ...be]] = gm.warps, Y = v => r3((v + 8) / CELL * vscale), mps = 60 / CELL;
      if (floorCell(ax, az) && floorCell(bx, bz)) ents.push({ type: 'warpHole', cells: [[ax - x0, az - z0], [bx - x0, bz - z0]],
        exits: [ae, be].map(q => [r3(q[0] / CELL - x0), Y(q[1]), r3(q[2] / CELL - z0)]), below: [Y(ae[3]), Y(be[3])], out: [r3(-2 * mps), r3(8.5 * mps * vscale), r3(-2 * mps)] });
    }
    // carriers (Panic Puppet 1's belts): a grounded Sonic in the box (at height y when given) is held and carried a unit
    // a frame along x on the line z, east when the value picked by `way` is 1 ([flag, then, else]: the flag's value
    // picks which), let go past lo or hi; `launch` instead at hi: the ride, with the key, and where it puts him
    // ("axis" 'z': along z on the line x; a number for "way": always that way; no lo: never let go at that end)
    for (const [ax, bx, az, bz, y, lz, lo, hi, hide, launch, axis, way] of gm.carriers || []) {
      const A = axis === 'z' ? z0 : x0, B = axis === 'z' ? x0 : z0;
      const e = { type: 'carrier', box: [r3(ax / CELL - x0), r3((bx + 1) / CELL - x0), r3(az / CELL - z0), r3((bz + 1) / CELL - z0)], y: y === null ? null : r3((y + 8) / CELL * vscale),
        line: r3(lz / CELL - B), lo: lo === null ? null : r3(lo / CELL - A), hi: r3(hi / CELL - A), v: r3(mps), way: way === undefined ? gm.carryWay : way };
      if (axis === 'z') e.axis = 'z';
      if (hide) e.hide = [r3(hide[0] / CELL - A), r3(hide[1] / CELL - A)];
      if (launch) {
        const [state, vel, at, facing, frames, key] = launch, { sc, ...rd } = rideOf(state, null, null, vel);
        e.launch = { ride: { ...rd, end: at ? { at: [r3(at[0] / CELL - x0), r3((at[1] + 8) / CELL * vscale), r3(at[2] / CELL - z0)], facing: compassOf(facing), vel: rd.vel } : null,
          force: { t: r3(frames / 60), dir: null } }, key };
      }
      ents.push(e);
    }
    // cells that shut behind the player (Panic Puppet 2's routine): stepping into a trigger cell raises them to `top`
    for (const [trig, cells, hb, ev] of gm.shuts || []) {
      const gc = cells.filter(([cx, cz]) => floorCell(cx, cz)).map(([cx, cz]) => [cx - x0, cz - z0]);
      if (gc.length) { const g = { type: 'gate', cells: gc, top: gateTop(hb), opens: 0, shut: trig.map(([cx, cz]) => [cx - x0, cz - z0]) }; if (ev) g.ev = ev; ents.push(g); }
    }
    // the act's end without a ring (Panic Puppet 2): grounded in the box [x0, x1, z0, z1], Sonic is held at `at` for
    // `hold` frames, then the move `state`; the act is over `clear` frames after the box
    for (const [ax, bx, az, bz, at, state, hold, clear] of gm.lifts || []) {
      const { sc, ...rd } = rideOf(state, at, null, null);
      rd.start[1] = r3((at[1] + 8) / CELL * vscale);
      ents.push({ type: 'hole', x: r3((ax + bx + 1) / 2 / CELL - x0), z: r3((az + bz + 1) / 2 / CELL - z0), half: [r3((bx + 1 - ax) / 2 / CELL), r3((bz + 1 - az) / 2 / CELL)], opens: 0,
        ride: { ...rd, end: null, wait: r3(hold / 60), clear: r3(clear / 60) } });
    }
    // tubes: taken grounded in the cell, Sonic put at (x, z) at his own height, rolling; the script's own end puts him out
    if (gm.tubes2) {
      const [tab, n, alts, keys, size, hidden] = gm.tubes2;   // (records of 12 bytes, or `size`; hidden: inside the walls)
      for (let k = 0; k < n; k++) {
        const o = tab + (size || 12) * k, c = u16(d, o) >> 1, cx = c % 128, cz = c >> 7, x = s16(d, o + 2), z = s16(d, o + 4), state = u16(d, o + 6);
        if (!floorCell(cx, cz)) continue;   // (the place is in the tube: no floor there)
        const endOf = sc => sc.end ? { at: [r3(sc.end[0] / CELL - x0), r3(sc.end[1] / CELL * vscale), r3(sc.end[2] / CELL - z0)], facing: compassOf(sc.end[3]),
          vel: [r3(sc.end[4] * mps), r3(-sc.end[5] * mps * vscale), r3(sc.end[6] * mps)] } : null;
        const { sc, ...rd } = rideOf(state, null, null, null), ride = { ...rd, start: [r3(x / CELL - x0), null, r3(z / CELL - z0)], end: endOf(sc) };
        const alt = (alts || []).find(q => q[0] === k);
        if (alt) {
          const a = rideOf(alt[2], null, null, null);
          ride.alt = { at: sc.starts[alt[1]], ride: { vel: a.vel, path: a.path, turns: a.turns, end: endOf(a.sc) } };
        }
        const e = { type: 'hole', x: cx + 0.5 - x0, z: cz + 0.5 - z0, size: 0.5, opens: 0, ride }, key = (keys || []).find(q => q[0] === k);
        if (key) e.key = key[1];   // (the act's routine lets Sonic out through a door after this tube)
        if (hidden) ride.hidden = 1;
        ents.push(e);
      }
    }
    const bs = BOSSES[id];
    if (bs) {
      const e = { type: 'boss', kind: bs.kind, x: r3(bs.at[0] / CELL - x0), y: r3(bs.at[1] / CELL * vscale), z: r3(bs.at[2] / CELL - z0),
        home: [r3(bs.home[0] / CELL - x0), r3(bs.home[1] / CELL - z0)], cruise: r3(bs.cruise / CELL * vscale),
        arena: [r3(bs.arena[0] / CELL - x0), r3(bs.arena[1] / CELL - x0), r3(bs.arena[2] / CELL - z0), r3(bs.arena[3] / CELL - z0)], hp: bs.hp, vs: vscale };
      if (bs.kind === 'ss') {
        const Y = v => r3(v / CELL * vscale);
        e.hover = Y(bs.hover); e.low = Y(bs.low); e.hang = Y(bs.hang); e.fists = bs.fists.map(([fx, fz]) => [r3(fx / CELL), r3(fz / CELL)]);
        e.corners = bs.corners.map(([cz, cx]) => [r3(cz / CELL - z0), r3(cx / CELL - x0)]);
      }
      if (bs.kind === 'rr') {
        const Y = v => r3(v / CELL * vscale), Z = v => r3(v / CELL - z0);
        e.arms = bs.arms.map(x => r3(x / CELL - x0)); e.root = [Y(bs.root[0]), Z(bs.root[1])]; e.cap = Y(bs.cap); e.reach = [Z(bs.reach[0]), Z(bs.reach[1])];
        const sc = [];
        for (let o = bs.script; sc.length < 64; o += 4) { const a = s16(d, o), n = s16(d, o + 2); if (a < 0) { e.loop = sc.length - n / 4; break; } sc.push([a / 4, n]); }
        e.script = sc;
      }
      if (bs.kind === 'vv') {
        const Y = v => r3(v / CELL * vscale);
        e.low = Y(bs.low); e.minY = Y(bs.minY); e.hitBox = [r3(bs.hitBox[0] / CELL - x0), r3(bs.hitBox[1] / CELL - x0), r3(bs.hitBox[2] / CELL - z0), r3(bs.hitBox[3] / CELL - z0)];
        e.rise = [r3(bs.rise[0] / CELL - x0), Y(bs.rise[1]), r3(bs.rise[2] / CELL - z0)]; e.spikes = bs.spikes.filter(([cx, cz]) => floorCell(cx, cz)).map(([cx, cz]) => [cx - x0, cz - z0]);
      }
      if (bs.kind === 'pp') {   // (positions in metres, heights of the floor's frame: Sonic's + 8 units)
        const X = v => r3(v / CELL - x0), Y = v => r3((v + 8) / CELL * vscale), Z = v => r3(v / CELL - z0), P3 = q => [X(q[0]), Y(q[1]), Z(q[2])];
        e.y = Y(bs.at[1]); e.cruise = Y(bs.cruise);
        e.stages = bs.stages.map(st => {
          const o = { pod: [X(st.pod[0]), Z(st.pod[1]), Y(st.pod[2]), Y(st.pod[3])], hitY: Y(st.hitY), arms: st.arms.map(a => {
            const q = { rest: P3(a.rest), shoulder: P3(a.shoulder), cell: [a.cell[0] - x0, a.cell[1] - z0] };
            if (a.at) q.at = P3(a.at);
            if (a.zone) q.zone = [X(a.zone[0]), Z(a.zone[1])];
            if (a.t) q.t = a.t;
            if (a.phase) q.phase = a.phase;
            return q;
          }) };
          if (st.pad) { o.pad = [st.pad[0] - x0, st.pad[1] - z0]; o.lift = P3(st.lift); o.to = P3(st.to); }
          if (st.shots) o.shots = st.shots.map(P3);
          return o;
        });
      }
      if (bs.kind === 'ff') {   // (map word offsets to cells)
        e.org = [x0, z0]; e.doors = bs.doors.map(d => d.map(o => [(o >> 1) % 128 - x0, ((o >> 1) >> 7) - z0])); e.doorTop = r3(bs.doorTop * 8 / CELL * vscale);
      }
      if (bs.kind === 'gng') {
        const Y = v => r3(v / CELL * vscale), Z = v => r3(v / CELL - z0);
        e.first = Y(bs.first); e.high = Y(bs.high); e.low = Y(bs.low); e.belt = bs.belt.map(Z); e.lanes = [r3(bs.lanes[0] / CELL - x0), r3(bs.lanes[1] / CELL)];
        e.end = Z(bs.end); e.loads = bs.loads.map(Z); e.drops = bs.drops.map(v => r3(v / CELL)); e.dropZ = r3(bs.dropZ / CELL);
      }
      if (bs.kind === 'dd') {
        const Y = v => r3(v / CELL * vscale);
        e.low = Y(bs.low); e.high = Y(bs.high); e.dropY = Y(bs.dropY);
        const sc = [];
        for (let o = bs.script, back = 0; sc.length < 32 && back < 2; o += 4) {
          const a = s16(d, o), n = s16(d, o + 2);
          if (a < 0) { sc.push([-1, (o - bs.script - n) / 4]); back++; } else sc.push([a / 4, n]);
        }
        e.script = sc; e.hitAt = bs.hitAt / 4;
        const dz = x0 - z0, sm = x0 + z0;
        e.oct = [r3(-bs.diag / CELL - dz), r3(bs.diag / CELL - dz), r3(bs.sum[0] / CELL - sm), r3(bs.sum[1] / CELL - sm)];
      }
      ents.push(e);
    }
    if (tableRings) for (let k = 0; k < 3; k++) {
      const x = s16(d, st + 0x14 + 6 * k), z = s16(d, st + 0x18 + 6 * k);
      if (!x) break;
      if (!floorCell(Math.floor(x / CELL), Math.floor(z / CELL))) continue;
      const g = { type: 'goal', x: r3(x / CELL - x0), z: r3(z / CELL - z0) }, put = (gm.links || [])[k];
      if (put && floorCell(Math.floor(put[0] / CELL), Math.floor(put[1] / CELL))) g.put = [r3(put[0] / CELL - x0), r3(put[1] / CELL - z0), put[2]];
      // the next section's start [x, z, facing] from the table: where a lost life puts him back (the original restarts
      // a section there; watched in Volcano Valley 1 for the act's start)
      const nx = s16(d, st + 6 * (k + 1)), nz = s16(d, st + 6 * (k + 1) + 2), nd = s16(d, st + 6 * (k + 1) + 4);
      if ((nx || nz) && floorCell(Math.floor(nx / CELL), Math.floor(nz / CELL))) g.spawn = [r3(nx / CELL - x0), r3(nz / CELL - z0), compassOf(nd & 0x7FF)];
      ents.push(g);
    }
    // pads: Green Grove's holes (1C) and Rusty Ruin's teleport pads (090), one object pair each (the first has a mode).
    // gm.pads lists [from, to (-1: that ring's pocket), after ring]; otherwise closed pads (mode 4) open in record order,
    // one per ring, and lead to the next pad in record order (GG1 watched). The objects' own sequence (0xC75A in,
    // 0xC642 out; watched in RR2): a slow, grounded player inside x+3..x+27, z-7..z+17 is held on the middle (x+15,
    // z+5) for 100 frames, sinking 56 units, then waits 47 units under the other pad's floor and is thrown up (127 units
    // in Green Grove, 138 in Rusty Ruin).
    const padList = gm.pads || holes.map((q, i) => (q[2] === 4 && holes[i + 1] ? [i, i + 1] : null)).filter(Boolean).map((q, k) => [q[0], q[1], k + 1]);
    for (const [from, to, after] of padList) {
      const a = holes[from], b = to >= 0 ? holes[to] : null, put = to < 0 ? (gm.links || [])[after - 1] : null;
      if (!a || !(b || put)) continue;
      const e = { type: 'hole', x: r3((a[0] + 15) / CELL - x0), z: r3((a[1] + 5) / CELL - z0), opens: after,
        exit: b ? [r3((b[0] + 15) / CELL - x0), r3((b[1] + 5) / CELL - z0)] : [r3(put[0] / CELL - x0), r3(put[1] / CELL - z0)],
        launch: b ? launchFor(vscale, gm.padRise || 127) : 0, pad: { sink: r3(56 / CELL * vscale), bury: r3(47 / CELL * vscale) } };
      if (!b) e.pad.pocket = true;
      ents.push(e);
    }
    // rings: 10-byte records from block offset 0x1936 to the end of the block (one leading empty record);
    // word 0 = sort key with a flag in bit 15, word 2 = screen y of the ring's base, word 4 = map offset of its cell
    for (let o = RING_TABLE; o + 10 <= ob.length; o += 10) {
      const a = u16(ob, o), c = s16(ob, o + 4), f = u16(ob, o + 8);
      if (a === 0 && f === 0) { if (o === RING_TABLE) continue; break; }
      const cx = (f >> 1) % 128, cz = (f >> 1) >> 7;
      if (cx < x0 || cx > x1 || cz < z0 || cz > z1) continue;
      const yWorld = (a & 0x7FFF) - Math.abs(c) + RING_HOVER;
      // (scr: |screen y of its base|, which the original's catch test reads; see Sim's rings)
      ents.push({ type: 'ring', x: cx + 0.5 - x0, z: cz + 0.5 - z0, absY: Math.round(yWorld / CELL * vscale * 1e4) / 1e4, scr: Math.abs(c) });
    }
    // start: the start table (where the emulator's Sonic stands at every act's start), else the start object (030:
    // not where the game starts Sonic in ten acts), else the floor cell nearest the middle
    let fromTable = false;
    {
      const sx = s16(d, st), sz = s16(d, st + 2);
      if ((sx || sz) && floorCell(Math.floor(sx / CELL), Math.floor(sz / CELL))) { start = [sx / CELL, sz / CELL]; fromTable = true; }
    }
    if (!start) {
      const mx = sumX / nFloor, mz = sumZ / nFloor; let best = Infinity;
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (map[z * 128 + x]) {
        const dd = (x - mx) ** 2 + (z - mz) ** 2; if (dd < best) { best = dd; start = [x + 0.5, z + 0.5]; }
      }
    }
    const st0 = { type: 'start', x: start[0] - x0, z: start[1] - z0 };
    // in a boss arena the player starts facing the boss (compass degrees)
    if (bs) st0.facing = (Math.floor(Math.atan2(bs.at[0] / CELL - start[0], start[1] - bs.at[2] / CELL) * 180 / Math.PI + 0.5) + 360) % 360;
    else if (fromTable) st0.facing = compassOf(s16(d, st + 4) & 0x7FF);   // (the table's facing, as every act starts)
    ents.unshift(st0);
    const name = (LEVELS.find(l => l[0] === id) || [id, 'Level ' + id])[1];
    return {
      version: 1, format: 'tiles', name: name + ' (from your ROM)', width: W, depth: D,
      killY: Math.round((minTop - 3) * 100) / 100, tiles, entities: ents, palettes: levelPalettes(d, id),
      physics: physicsFor(vscale), rom: { level: id, origin: [x0, z0], vscale },
      flickies: tableRings ? 5 : 0,   // every big ring wants five Flickies, freed from enemies
    };
  }
  // ---------------- graphics from the player's ROM ----------------
  // Sprite pieces seen in the running game, by object type: [x, y, tiles wide, tiles high, h-flip, v-flip,
  // palette line, ROM address of the raw tiles]. Only positions and addresses live here; pixels come from the ROM.
  const RECIPES = {
    // the Hunter without its spike ball, and the ball alone with its middle on the anchor
    'SPK': [[-16,-16,4,4,0,0,3,0x028BC2],[-8,-24,2,1,0,0,3,0x028DC2]],
    '00C': [[-10,-22,4,3,1,0,3,0x030788],[-10,-38,3,2,1,0,3,0x030908],[-18,-14,1,2,1,0,3,0x0309C8],[-10,-46,2,1,1,0,3,0x030A08]],
    '018': [[-5,-18,4,4,0,0,2,0x0340C6],[-13,-18,1,3,0,0,2,0x0342C6]],
    '03C': [[-15,-36,4,4,0,0,3,0x03CC5C],[-15,-4,4,1,0,0,3,0x03CE5C]],
    '008': [[-16,-36,4,4,0,0,3,0x028E14],[-8,-44,2,1,0,0,3,0x029014]],
    '054': [[-17,-39,1,3,1,0,3,0x042164],[-9,-47,3,4,1,0,3,0x041EC4]],
    '058': [[-16,-19,4,3,0,0,3,0x042FA2],[-8,-27,2,1,0,0,3,0x043122]],
    '064': [[-24,-34,4,4,0,0,3,0x04D1C4],[8,-34,2,4,0,0,3,0x04D3C4],[-16,-2,4,2,0,0,3,0x04D4C4],[16,-2,1,1,0,0,3,0x04D5C4],[-24,-2,1,1,0,0,3,0x04D5E4]],
    '094': [[-3,-41,4,4,0,0,3,0x05C73C],[-3,-9,2,2,0,0,3,0x05C93C],[13,-9,3,1,0,0,3,0x05C9BC],[5,-49,2,1,0,0,3,0x05CA1C]],
    '0C4': [[-5,-16,4,3,0,0,3,0x064A8C],[-13,-24,4,1,0,0,3,0x064CCC],[3,8,3,1,0,0,3,0x064D4C]],
    '100': [[-46,-39,4,4,1,0,3,0x077F9A],[-38,-55,3,2,1,0,3,0x07819A],[-46,-7,4,1,1,0,3,0x0782DA]],
    '10C': [[11,-50,3,3,0,0,3,0x07DA52]],
    '144': [[-8,-20,4,4,0,0,3,0x085376],[24,-20,1,4,0,0,3,0x085576],[0,-36,2,2,0,0,3,0x0855F6],[0,-44,1,1,0,0,3,0x085716]],
    '148': [[5,-20,4,4,1,0,3,0x0873CA],[-19,-12,3,4,1,0,3,0x0875CA],[-11,-20,2,1,1,0,3,0x0877AA],[13,-28,1,1,1,0,3,0x08782A]],
    '158': [[-14,-27,4,4,0,0,0,0x08EDB4],[-6,-35,2,1,0,0,0,0x08EFB4]],
  };
  const PAL_TABLE = 0x25082, RING_ART = 0x14401E, HERO_TABLE = 0x100000;
  function paletteRGB(d, n) {
    const out = [];
    for (let k = 0; k < 16; k++) {
      const v = u16(d, PAL_TABLE + (n - 1) * 32 + k * 2);
      out.push([((v >> 1) & 7) * 255 / 7 | 0, ((v >> 5) & 7) * 255 / 7 | 0, ((v >> 9) & 7) * 255 / 7 | 0]);
    }
    return out;
  }
  // draw a w x h block of 8x8 4-bit tiles (column-major, as the console stores sprites) into RGBA pixels
  function blit(px, size, src, w, h, x, y, hf, vf, pal) {
    for (let cx = 0; cx < w; cx++) for (let cy = 0; cy < h; cy++) {
      const t = (cx * h + cy) * 32;
      for (let py = 0; py < 8; py++) for (let qx = 0; qx < 8; qx++) {
        const b = src[t + py * 4 + (qx >> 1)];
        if (b === undefined) continue;
        const c = qx & 1 ? b & 15 : b >> 4;
        if (!c) continue;
        const X = x + (hf ? (w - 1 - cx) * 8 + 7 - qx : cx * 8 + qx), Y = y + (vf ? (h - 1 - cy) * 8 + 7 - py : cy * 8 + py);
        if (X < 0 || Y < 0 || X >= size || Y >= size) continue;
        const o = (Y * size + X) * 4, col = pal[c];
        px[o] = col[0]; px[o + 1] = col[1]; px[o + 2] = col[2]; px[o + 3] = 255;
      }
    }
  }
  // Player frames: table of longs (command length/2 << 24 | offset); frame = piece list then a run/literal coded tile block.
  function heroFrame(d, i) {
    const ent = u32(d, HERO_TABLE + i * 4), half = ent >>> 24, F = HERO_TABLE + (ent & 0xFFFFFF);
    const n = u16(d, F) + 1, pieces = [];
    for (let k = 0; k < n; k++) {
      const o = F + 2 + k * 6, sb = v => (v & 0x80 ? v - 256 : v);
      pieces.push({ x: sb(d[o]), xf: sb(d[o + 1]), y: s16(d, o + 2), size: d[o + 4], tile: d[o + 5] });
    }
    const bytes = u16(d, F - 2) * 2, out = new Uint8Array(bytes + 4 * 128);
    let p = F + s16(d, F - 4), a0 = p + half * 2, o = 0;
    for (;;) {
      const c = d[p++];
      if (c === 0) break;
      let n;
      if (c >= 2 && c <= 0x50) { n = (0x50 - c) / 2 + 1; for (let k = 0; k < n && o + 4 <= out.length; k++) { out.set(d.subarray(a0, a0 + 4), o); o += 4; } a0 += 4; }
      else if (c >= 0x54 && c <= 0x7C) { n = (0x7C - c) / 2 + 1; o += 4 * n; }
      else if (c >= 0x80 && c <= 0xFE) { n = (0xFE - c) / 2 + 1; if (o + 4 * n <= out.length) out.set(d.subarray(a0, a0 + 4 * n), o); o += 4 * n; a0 += 4 * n; }
      else throw new Error('player frame ' + i + ' is damaged');
      if (o > out.length) throw new Error('player frame ' + i + ' is damaged');
    }
    return { pieces, art: out.subarray(0, bytes) };
  }
  function heroImage(d, i, flip, pal, size = 96, ox = 48, oy = 80) {
    const { pieces, art } = heroFrame(d, i), px = new Uint8ClampedArray(size * size * 4);
    let x = 0, y = 0, t = 0;
    for (const p of pieces) {
      x += flip ? p.xf : p.x; y += p.y; t += p.tile;
      const w = ((p.size >> 2) & 3) + 1, h = (p.size & 3) + 1;
      blit(px, size, art.subarray(t * 32), w, h, ox + x, oy + y, flip, false, pal);
    }
    return px;
  }
  function recipeImage(d, key, palBytes, size = 96, ox = 48, oy = 80) {
    const rec = RECIPES[key]; if (!rec) return null;
    const pals = palBytes.map(n => paletteRGB(d, n)), px = new Uint8ClampedArray(size * size * 4);
    for (const [dx, dy, w, h, hf, vf, line, addr] of rec) blit(px, size, d.subarray(addr, addr + w * h * 32), w, h, ox + dx, oy + dy, !!hf, !!vf, pals[line]);
    return px;
  }
  // monitor icons: 16 px squares (2 x 2 tiles, raw) at 0x13C7D8 + kind * 0x80 in palette line 2, in the order of
  // MONITOR_KINDS; drawn 2 px right and 13 px down from the top left of the monitor body (emulator snapshot, GG1)
  const MONITOR_ICONS = 0x13C7D8;
  function monitorImage(d, kind, palBytes, size = 96, ox = 48, oy = 80) {
    const px = recipeImage(d, '03C', palBytes, size, ox, oy), k = Math.max(0, MONITOR_KINDS.indexOf(kind));
    if (!px) return null;
    blit(px, size, d.subarray(MONITOR_ICONS + k * 0x80, MONITOR_ICONS + k * 0x80 + 128), 2, 2, ox - 13, oy - 23, false, false, paletteRGB(d, palBytes[2]));
    return px;
  }
  // the icon alone, 16 x 16 (for a game that draws monitors as boxes)
  function monitorIcon(d, kind, palBytes) {
    const k = Math.max(0, MONITOR_KINDS.indexOf(kind)), px = new Uint8ClampedArray(16 * 16 * 4);
    blit(px, 16, d.subarray(MONITOR_ICONS + k * 0x80, MONITOR_ICONS + k * 0x80 + 128), 2, 2, 0, 0, false, false, paletteRGB(d, palBytes[2]));
    return px;
  }
  // The act results screen, drawn as the original lays it out (320 x 224, seen in the emulator): a navy screen,
  // "SONIC GOT THROUGH ACT n" in the big font (sprites, 16 px letters; act digits 16 x 32 after the 26 letters),
  // then lines of the small 8 x 16 font (A to Z, 0 to 9, colon). Both fonts are RNC packed; palettes 26, 27 and 3.
  const TALLY_BIG = 0x15DEBA, TALLY_SMALL = 0x15E3E6, tallyFonts = new WeakMap();
  // drawing with the two fonts into RGBA pixels: big letters (16 x 16), the act digits (16 x 32), small 8 x 16 text
  function textKit(d, W, H) {
    if (!tallyFonts.has(d)) tallyFonts.set(d, { big: rncUnpack(d, TALLY_BIG), small: rncUnpack(d, TALLY_SMALL) });
    const F = tallyFonts.get(d), px = new Uint8ClampedArray(W * H * 4);
    const tile = (src, t, x, y, pal) => {
      for (let py = 0; py < 8; py++) for (let qx = 0; qx < 8; qx++) {
        const b = src[t * 32 + py * 4 + (qx >> 1)], c = qx & 1 ? b & 15 : b >> 4;
        if (!c || x + qx < 0 || x + qx >= W || y + py >= H) continue;
        const o = ((y + py) * W + x + qx) * 4; px[o] = pal[c][0]; px[o + 1] = pal[c][1]; px[o + 2] = pal[c][2]; px[o + 3] = 255;
      }
    };
    const big = (text, x, y, pal) => {
      for (const ch of text) {
        const g = ch.charCodeAt(0) - 65;
        if (g >= 0 && g < 26) for (let k = 0; k < 4; k++) tile(F.big, g * 4 + k, x + (k >> 1) * 8, y + (k & 1) * 8, pal);
        x += 16;
      }
    };
    const small = (text, col, row, pal) => {
      for (const ch of String(text)) {
        const c = ch.charCodeAt(0), g = c >= 65 && c <= 90 ? c - 65 : c >= 48 && c <= 57 ? c - 22 : ch === ':' ? 36 : -1;
        if (g >= 0) { tile(F.small, g * 2, col * 8, row * 8, pal); tile(F.small, g * 2 + 1, col * 8, row * 8 + 8, pal); }
        col++;
      }
    };
    const digit = (n, x, y, pal) => { const a = Math.min(3, Math.max(1, n | 0)) - 1; for (let k = 0; k < 8; k++) tile(F.big, 104 + a * 8 + k, x + (k >> 2) * 8, y + (k & 3) * 8, pal); };
    return { px, tile, big, small, digit };
  }
  function tallyImage(d, info) {
    const W = 320, H = 224, { px, big: big0, small, digit } = textKit(d, W, H);
    const after = info.kind === 'emerald' || info.kind === 'bonus';   // (0x21114 loads palettes 28, 29, 31, 32)
    const white = paletteRGB(d, after ? 28 : 26), yellow = after ? white : paletteRGB(d, 27), digits = paletteRGB(d, 3);
    for (let i = 0; i < W * H; i++) { px.set(white[0], i * 4); px[i * 4 + 3] = 255; }
    const big = (text, x, y) => big0(text, x, y, white);
    const right = (n, endCol, row) => { const t = String(n); small(t, endCol - t.length + 1, row, white); };
    if (after) {   // after a special stage (0x21114, screens 1 and 2)
      const lines = info.kind === 'emerald' ? ['SONIC GOT A', 'CHAOS EMERALD'] : ['SPECIAL STAGE', 'CLEAR'];
      lines.forEach((l, i) => big(l, (W - 16 * l.length) / 2, 16 + i * 20));
      small('SCORE', 14, 10, yellow); right(info.score, 27, 10);
      small('RING', 7, 13, yellow); small('BONUS', 12, 13, yellow); right(info.bonus[0], 27, 13);
      if (info.kind === 'emerald') { small('EMERALD', 4, 15, yellow); small('BONUS', 12, 15, yellow); right(info.bonus[1], 27, 15); }
      return { px, width: W, height: H, background: white[0] };
    }
    big('SONIC GOT', 88, 16); big('THROUGH ACT', 64, 36);
    digit(info.act, 244, 22, digits);
    small('TIME TAKEN', 3, 8, white); small(info.time, 14, 8, white); small('SCORE', 24, 8, white); right(info.score, 37, 8);
    const labels = ['TIME', 'RING', 'FLICKY', 'KNUCKLES', 'TAILS'];
    labels.forEach((l, i) => { small(l, 16 - l.length, 12 + i * 2, yellow); small('BONUS', 17, 12 + i * 2, yellow); right(info.bonus[i], 27, 12 + i * 2); });
    small('TOTAL', 12, 23, white); right(info.total, 27, 23);
    return { px, width: W, height: H, background: white[0] };
  }
  // The act's title card (seen in the emulator at an act's start, over the level): the zone's name in the big font on
  // two lines, "ACT" in the small font and the act's digit; a transparent 320 x 224 picture (palettes 26 and 3)
  function titleCardImage(d, zone, act) {
    const W = 320, H = 224, { px, big, small, digit } = textKit(d, W, H), white = paletteRGB(d, 26), words = zone.toUpperCase().split(' ');
    const lines = words.length > 1 ? [words.slice(0, -1).join(' '), words[words.length - 1]] : words;
    lines.forEach((l, i) => big(l, 44, 76 + i * 16, white));
    if (act) { small('ACT', 13, 13, white); digit(act, 136, 100, paletteRGB(d, 3)); }
    return { px, width: W, height: H };
  }
  // Sound: the game's own Z80 sound program, copied into Z80 RAM by the loader at 0x24FD8 (0x11BF bytes from 0xD1D18 to
  // 0x0000, 0x7BD bytes from 0xD2ED7 to 0x1300); every sound and song is requested by writing its number to Z80 RAM
  // 0x1C0A (0x24FC8), one per frame. Level music: word at 0x24F78 + 2 x level id (0x24F4E). Effect numbers were read
  // from the game's request queue ($0AC4) in the emulator while Sonic did each thing; those marked "near" were only
  // seen next to the routine and are less certain.
  const SOUND = {
    driver: [[0xD1D18, 0x0000, 0x11BF], [0xD2ED7, 0x1300, 0x7BD]], mailbox: 0x1C0A,
    musicFor: (d, level) => u16(d, 0x24F78 + 2 * level),
    sfx: { jump: [0x62], charge: [0xAB], dash: [0xB6], ring: [0x33], spring: [0x68], enemy: [0x3D, 0x38], monitor: [0x3D],
      hurt: [0xB9], shot: [0x4D], boom: [0x9A], spark: [0x9A] /* a shot landing or touching, 0xD5EE, 0x1BAD4 */, goal: [0x6A], boostIn: [0xAB], boost: [0xB6], goldDash: [0xB6],
      shieldLost: [0x35], dying: [0x35] /* 0x1B6F0, 0x1B744 */, section: [0xAC] /* near the big ring routine */,
      cannon: [0x81], crack: [0x59] /* the Green Grove routines' own requests */, burst: [0x59] /* 058 */, whirl: [0xAB] /* Rusty Ruin's fans */, flame: [0x7F] /* flamethrowers */,
      bossHit: [0x59], bossBump: [0xB4], bossDrop: [0x51], bossHop: [0x96], bossGrab: [0x76] /* GG3's routine */,
      bossSlam: [0x5F], bossCap: [0x9E] /* RR3's routine */,
      bumper: [0xB7], balloon: [0x77], spikesUp: [0x52], spear: [0x8C] /* Spring Stadium's routines */,
      ddDrop: [0x7E], snowman: [0x51], snowPuff: [0xC8] /* DD3's routine */,
      rockBreak: [0x59], ventOut: [0xB6] /* Volcano Valley's helpers */, serpent: [0x4E] /* VV3's routine */,
      iceBreak: [0x59] /* Diamond Dust's ice spikes */, sledEnd: [0x59], freeze: [0x80], frozenHop: [0x94], thaw: [0x80] /* routines 0x1B9CA, 0x3050 */,
      hover: [0xC1], pyramid: [0xAE], zapArm: [0x42], sprinkle: [0x4D], tubeNo: [0xB2], tubeYes: [0x3C] /* Gene Gadget 1's routine and objects */,
      lever: [0x76], launch: [0xAB], capsule: [0x3D], pellet: [0x9A], doorShut: [0x64], tubeIn: [0xAD] /* Panic Puppet 1's routine and objects */,
      shut: [0xC9], beam: [0x78], liftUp: [0x3C], liftGo: [0xB6], lift: [0xD2] /* Panic Puppet 2's */,
      armGo: [0x5A], armRise: [0xC3], armSlam: [0x81], armOpen: [0x92], armDown: [0x54], blast: [0x59] /* Panic Puppet 3's routine */,
      ffDoor: [0xB8], ffBeep: [0xAD], timeUp: [0x78], ffAway: [0x60], ffHum: [0xC6], ffReady: [0x9D], laser: [0x5E], ffRise: [0xD0],
      ffSink: [0x73], ffLetGo: [0xB6], ffAim: [0x53], ffSlam: [0x5F], ffTarget: [0x51] /* Final Fight's routine */,
      friend: [0xB0] /* 0xCF1E */, head: [0x68], continue: [0xAC] /* 0x18086 */, bonusFail: [0xB2], gate: [0x63], emerald: [0x1A], emeraldNo: [0x19], bonusRise: [0x6A] /* the special stage */ },
    power: { shield: 0x3A, gold: 0x3F, oneup: 0x19 /* 0xC19C */ },
  };
  // Special stages (entry 0x1E218, set up by 0x1C2AA): table 0x1CA94, 14 entries of 24 bytes [look (1: stone over
  // lava, Knuckles' stages 0-6; 0: a grating over a river, Tails' 7-13), top speed (x 16 / 0x10000 units a frame),
  // track (RNC1), items (RNC1), three palettes (scenery, track, items)]. Track: 8-byte records [stripe, distance, x of
  // the left edge (64 wide), y (down)], farthest first, two at one distance for a step; items: [distance, x, y, kind]
  // (0 spiked ball, 1 ring, 2 gate post, 3 the count sign, 4/5 new counts 100/150, 7 the emerald), nearest first.
  const BONUS = { table: 0x1CA94, music: 0x10 };
  function bonusStage(d, n) {
    const o = BONUS.table + 24 * n, s16s = (b, i) => { const v = (b[i] << 8) | b[i + 1]; return v & 0x8000 ? v - 0x10000 : v; };
    const rec = (b, f) => { const out = []; for (let i = 0; i + 8 <= b.length; i += 8) out.push(f(i)); return out; };
    const a = rncUnpack(d, u32(d, o + 4)), b = rncUnpack(d, u32(d, o + 8));
    const track = rec(a, i => [s16s(a, i), s16s(a, i + 2), s16s(a, i + 4), s16s(a, i + 6)]);
    const items = rec(b, i => [s16s(b, i), s16s(b, i + 2), s16s(b, i + 4), s16s(b, i + 6)]);
    const pal = [12, 16, 20].map(k => { const p = u32(d, o + k), c = []; for (let j = 0; j < 16; j++) { const v = u16(d, p + 2 * j); c.push([((v >> 1) & 7) * 255 / 7 | 0, ((v >> 5) & 7) * 255 / 7 | 0, ((v >> 9) & 7) * 255 / 7 | 0]); } return c; });
    return { n, look: u16(d, o) ? 'lava' : 'river', speed: u16(d, o + 2) * 16, track, items, pal };
  }
  // the special stage's own pre-scaled sprites: spiked ball (table 0x145026, tiles RNC 0x14F2AC to VRAM 0x8420,
  // palette line 1 = the stage's item palette) and ring (0x144F2E, tiles 0x14F0EC at 0x9C00, line 3); a frame is a
  // word (pieces - 1) then pieces [x, x mirrored, y word, size, tile]; the largest is 30 (spiked ball) / 15 (ring)
  const BONUS_SPRITES = { spike: [0x145026, 0x14F2AC, 30], ring: [0x144F2E, 0x14F0EC, 15] };
  function bonusSprite(d, kind, pal, size = 64) {
    const [tab, art, i] = BONUS_SPRITES[kind], tiles = rncUnpack(d, art), px = new Uint8ClampedArray(size * size * 4);
    let a = tab + u32(d, tab + 4 * i), x = size / 2, y = size / 2;
    for (let n = s16(d, a), k = 0; k <= n; k++) {
      const p = a + 2 + 6 * k, sb = v => (v & 0x80 ? v - 256 : v), sz = d[p + 4], t = d[p + 5];
      x += sb(d[p]); y += s16(d, p + 2);
      blit(px, size, tiles.subarray(t * 32), ((sz >> 2) & 3) + 1, (sz & 3) + 1, x, y, false, false, pal);
    }
    return px;
  }
  function ringImage(d, k, pal, size = 16) {
    const px = new Uint8ClampedArray(size * size * 4);
    blit(px, size, d.subarray(RING_ART + k * 0x80, RING_ART + k * 0x80 + 128), 2, 2, 0, 0, false, false, pal);
    return px;
  }
  // Object art blocks (art table at 0x280E8 + type): 16-byte header, then a long offset table from +0x10, frames
  // laid out like the player's (piece list; tile data at frame + s16(frame - 4), length words at frame - 2) but raw.
  const FLICKY_ART = 0x32950, BIG_RING_ART = 0x3D068;   // types 14 (the freed bird, 16 frames) and 40 (9 frames)
  function objFrame(d, base, i) {
    const t = base + 0x10, F = t + u32(d, t + i * 4), n = u16(d, F) + 1, pieces = [];
    for (let k = 0; k < n; k++) {
      const o = F + 2 + k * 6, sb = v => (v & 0x80 ? v - 256 : v);
      pieces.push({ x: sb(d[o]), xf: sb(d[o + 1]), y: s16(d, o + 2), size: d[o + 4], tile: d[o + 5] });
    }
    const start = F + s16(d, F - 4);
    return { pieces, art: d.subarray(start, start + u16(d, F - 2) * 2) };
  }
  function objImage(d, base, i, pal, size = 64, ox = 32, oy = 48, flip = false) {
    const { pieces, art } = objFrame(d, base, i), px = new Uint8ClampedArray(size * size * 4);
    let x = 0, y = 0, t = 0;
    for (const p of pieces) {
      x += flip ? p.xf : p.x; y += p.y; t += p.tile;
      blit(px, size, art.subarray(t * 32), ((p.size >> 2) & 3) + 1, (p.size & 3) + 1, ox + x, oy + y, flip, false, pal);
    }
    return px;
  }
  // palette bytes a level header names: lines 0..3
  const levelPalettes = (d, id) => { const h = HEADERS + (id - 1) * HSIZE; return [d[h + 0x26], d[h + 0x27], d[h + 0x28], d[h + 0x29]]; };
  // which drawn view (0 down, 1 down-left, 2 left, 3 up-left, 4 up) and mirror to use for a heading on screen,
  // in eighths of a turn: 0 toward the camera, 2 to the right, 4 away, 6 to the left
  const OCTANT = [[0, false], [1, true], [2, true], [3, true], [4, false], [3, false], [2, false], [1, false]];
  const HERO = {
    walk: v => (v === 4 ? range(101, 12) : range([5, 29, 53, 77][v], 12)),
    run: v => (v === 4 ? range(101, 12) : range([5, 29, 53, 77][v] + 12, 12)),
    ball: () => [113, 126, 113, 127, 113, 128, 113, 129], charge: () => [192, 193, 192, 194, 192, 195, 192, 196, 192, 197],
  };
  function range(a, n) { const r = []; for (let i = 0; i < n; i++) r.push(a + i); return r; }
  // Sonic's animations as the original plays them (0x16AC): per animation ($94) a script (table 0x25BC2: word, view
  // table offset $A0, script offset $A2) of [frame, rate] entries at 0x258A2; the rate adds to $9C each frame and at 60
  // the next entry shows (the walk, view table 0x16, at its forward speed's high byte / 4, at least 8); an entry -1
  // jumps back by its rate (bytes). A new animation starts the frame after it is picked. The view: the facing
  // ((F + 0x100) & 0x780) >> 6 picks one of 16; view tables at 0x25C3A (type byte 0: the far side mirrored, its frame
  // moved by the first word (wrapping at the second), then one of 9 offsets; else one way only, the other mirrored or
  // not by the type's sign). A frame < 0 takes no view. Bored (0xB) at script 0x228 picks a variation by a random word.
  const ANIM_TABLE = 0x25BC2, ANIM_SCRIPT = 0x258A2, ANIM_VIEW = 0x25C3A;
  function heroAnimator(d) {
    const st = { a96: 0, a98: -1, a9c: 0, A0: 0, A2: 0, cur: ANIM_SCRIPT };
    return {
      st,
      step(anim, fwdWord, rnd) {
        if (anim === 0xB && st.a98 === 0xB && st.A2 === 0x228) { const r = rnd(); if (r <= 0x6000) st.A2 = 0x230; else if (r <= 0x8000) st.A2 = 0x254; }
        if (anim !== st.a96) st.a96 = anim;
        else if (anim !== st.a98) { const t = ANIM_TABLE + 6 * anim; st.a9c = 0; st.A0 = s16(d, t + 2); st.A2 = s16(d, t + 4); st.a98 = anim; }
        const e = ANIM_SCRIPT + st.A2;
        let sp = s16(d, e + 2);
        if (st.A0 === 0x16) { let b = (fwdWord >> 8) & 0xFF; if (((b << 24) >> 24) < 0x20) b = 0x20; sp = b >> 2; }
        st.a9c += sp; st.cur = e;
        if (st.a9c >= 0x3C) {
          st.a9c -= 0x3C; st.A2 += 4;
          if (s16(d, e + 4) === -1) { const back = s16(d, e + 6); if (!back) st.a98 = -1; st.A2 -= back; }
        }
      },
      // [frame, mirrored] for facing F (0x800 a turn, as the original's $32)
      frame(F) {
        const t = ANIM_VIEW + st.A0, ty = d[t];
        let d0 = s16(d, st.cur), d2 = ((F + 0x100) & 0x780) >> 6, flip = false;
        if (ty === 0) {
          if (d2 >= 0x10) { flip = true; d2 = 0x20 - d2; }
          if (d0 < 0) return [-d0, flip];
          if (flip) { const add = s16(d, t); d0 += add; if (d0 >= s16(d, t + 2)) d0 -= 2 * add; }
        } else {
          if (!(ty & 0x80)) { d2 = (0x20 - d2) & 0x1E; flip = true; }
          if (d0 < 0) return [-d0, flip];
          if (d2 > 0x10) { d2 -= 0x10; d0 += s16(d, t + 4 + 0x10); }
        }
        return [d0 + s16(d, t + 4 + d2), flip];
      },
    };
  }

  // ---------------- level art: the isometric picture, unprojected onto the 3D faces ----------------
  // RNC method 2 as the game's routine at 0xC7C runs it: header-less blocks (packed length, two CRCs, leeway, chunks).
  function rnc2Unpack(d, off) {
    let p = off + 10, buf = 0x80;
    const out = [];
    const bit = () => {
      buf = (buf << 1) & 0x1FF;
      let c = buf >> 8; buf &= 0xFF;
      if (buf === 0) { const v = d[p++]; buf = ((v << 1) | 1) & 0xFF; c = v >> 7; }
      return c;
    };
    const high = () => {
      if (!bit()) return 0;
      let h = bit();
      if (bit()) { h = (h * 2 + bit()) | 4; return bit() ? h : h * 2 + bit(); }
      return h || 2 + bit();
    };
    bit(); bit();
    for (;;) {
      if (!bit()) { out.push(d[p++]); continue; }
      let len = 2, hi = 0;
      if (!bit()) {
        len = len * 2 + bit();
        if (bit()) {
          len = (len - 1) * 2 + bit();
          if (len === 9) { let k = 0; for (let i = 0; i < 4; i++) k = k * 2 + bit(); for (let i = 0; i < (k + 3) * 4; i++) out.push(d[p++]); continue; }
        }
        hi = high();
      } else if (bit()) {
        len = 3;
        if (bit()) {
          len = d[p++];
          if (len === 0) { if (bit()) continue; break; }
          len += 8;
        }
        hi = high();
      }
      const dist = ((hi << 8) | d[p++]) + 1;
      for (let i = 0; i < len; i++) out.push(out[out.length - dist]);
    }
    return Uint8Array.from(out);
  }
  // Animated static tiles (water, lava): first tile, count, ROM address of the frame the running game shows.
  // Found by comparing the loader's VRAM with the running game's; addresses only, the pixels come from the ROM.
  const ANIM = {
    1: [[136, 16, 891646], [152, 16, 907006], [168, 16, 897790]], 2: [[197, 16, 891134]], 3: [[29, 16, 887550]],
    4: [[67, 1, 907518], [69, 1, 907582], [71, 12, 907646]], 5: [[138, 1, 907518], [140, 1, 907582], [142, 12, 907646]],
    6: [[126, 11, 914718], [138, 2, 912542]], 7: [[58, 11, 912158], [70, 2, 912542]], 9: [[174, 16, 916990]],
    10: [[99, 16, 918270]], 12: [[125, 40, 945406]], 13: [[69, 40, 945406]], 15: [[93, 16, 949246]], 16: [[95, 16, 949246]],
    17: [[42, 16, 949246]], 19: [[110, 2, 911806]], 20: [[125, 1, 907518], [127, 1, 907582], [129, 12, 907646], [153, 2, 911678]],
    22: [[1, 4, 965118], [7, 3, 965310], [12, 9, 965470], [22, 15, 965790], [121, 16, 1430202], [137, 16, 1430202]],
  };
  // animated static tiles (water, waterfalls, lava) as the emulator shows them: per level, runs of [first tile, count,
  // ROM address of each frame in display order, video frames each is shown (one number when all frames match)]
  // (re/animwatch.py); ANIM above is the frame the bake starts from
  const ANIM_FRAMES = {
    1: [[136, 16, [0xD84FE, 0xD86FE, 0xD88FE, 0xD8AFE, 0xD8CFE, 0xD8EFE, 0xD90FE, 0xD92FE, 0xD94FE, 0xD96FE, 0xD98FE, 0xD9AFE], 4], [152, 16, [0xDCCFE, 0xDCEFE, 0xDD0FE, 0xDD2FE, 0xDD4FE, 0xDD6FE], 4], [168, 16, [0xD9CFE, 0xD9EFE, 0xDA0FE, 0xDA2FE, 0xDA4FE, 0xDA6FE, 0xDA8FE, 0xDAAFE, 0xDACFE, 0xDAEFE, 0xDB0FE, 0xDB2FE], 4]],
    2: [[197, 16, [0xD9AFE, 0xD84FE, 0xD86FE, 0xD88FE, 0xD8AFE, 0xD8CFE, 0xD8EFE, 0xD90FE, 0xD92FE, 0xD94FE, 0xD96FE, 0xD98FE], 4]],
    3: [[29, 16, [0xD8CFE, 0xD8EFE, 0xD90FE, 0xD92FE, 0xD94FE, 0xD96FE, 0xD98FE, 0xD9AFE, 0xD84FE, 0xD86FE, 0xD88FE, 0xD8AFE], 4]],
    6: [[126, 11, [0xDEF1E, 0xDED1E, 0xDEB1E, 0xDF91E, 0xDF71E, 0xDF51E, 0xDF31E, 0xDF11E], 1]],
    7: [[58, 11, [0xDF51E, 0xDF31E, 0xDF11E, 0xDEF1E, 0xDED1E, 0xDEB1E, 0xDF91E, 0xDF71E], 1]],
    10: [[99, 16, [0xE0CFE, 0xE11FE, 0xE16FE, 0xE1BFE, 0xE20FE, 0xE25FE, 0xE2AFE, 0xE2FFE, 0xE34FE, 0xDFDFE, 0xE02FE, 0xE07FE], 2]],
    12: [[125, 40, [0xE71FE, 0xE76FE, 0xE3FFE, 0xE44FE, 0xE49FE, 0xE4EFE, 0xE53FE, 0xE58FE, 0xE5DFE, 0xE62FE, 0xE67FE, 0xE6CFE], 3]],
    13: [[69, 40, [0xE71FE, 0xE76FE, 0xE3FFE, 0xE44FE, 0xE49FE, 0xE4EFE, 0xE53FE, 0xE58FE, 0xE5DFE, 0xE62FE, 0xE67FE, 0xE6CFE], 3]],
    // Gene Gadget's fans (helper 0x12506: 16 tiles from 0xDD8FE, 8 frames; the original turns them faster while Sonic
    // hovers, here a steady rate) and act 3's belt (0x40 bytes from 0xDE8FE a frame, 8 frames)
    4: [[67, 16, [0xDD8FE, 0xDDAFE, 0xDDCFE, 0xDDEFE, 0xDE0FE, 0xDE2FE, 0xDE4FE, 0xDE6FE], 2]],
    5: [[138, 16, [0xDD8FE, 0xDDAFE, 0xDDCFE, 0xDDEFE, 0xDE0FE, 0xDE2FE, 0xDE4FE, 0xDE6FE], 2]],
    18: [[1, 2, [0xDE8FE, 0xDE93E, 0xDE97E, 0xDE9BE, 0xDE9FE, 0xDEA3E, 0xDEA7E, 0xDEABE], 1]],
    19: [[110, 2, [0xDEA7E, 0xDEABE, 0xDE8FE, 0xDE93E, 0xDE97E, 0xDE9BE, 0xDE9FE, 0xDEA3E], 1]],
    // Panic Puppet 1: fans (InitLevel 0x13336: 16 tiles from 0xDD8FE at tile 125) and the belts (tile 153; the routine
    // runs them backwards, as here, while the levers send the belts west)
    20: [[125, 16, [0xDD8FE, 0xDDAFE, 0xDDCFE, 0xDDEFE, 0xDE0FE, 0xDE2FE, 0xDE4FE, 0xDE6FE], 2], [153, 2, [0xDEA7E, 0xDEA3E, 0xDE9FE, 0xDE9BE, 0xDE97E, 0xDE93E, 0xDE8FE, 0xDEABE], 1]],
    22: [[1, 4, [0xEBEFE, 0xE87FE, 0xE8CFE, 0xE91FE, 0xE96FE, 0xE9BFE, 0xEA0FE, 0xEA5FE, 0xEAAFE, 0xEAFFE, 0xEB4FE, 0xEB9FE], 4], [7, 3, [0xEBFBE, 0xE88BE, 0xE8DBE, 0xEABBE, 0xEB0BE, 0xEB5BE, 0xEBABE], [4, 4, 24, 4, 4, 4, 4]], [12, 9, [0xEC05E, 0xE895E, 0xE8E5E, 0xE935E, 0xE985E, 0xE9D5E, 0xEA25E, 0xEA75E, 0xEAC5E, 0xEB15E, 0xEB65E, 0xEBB5E], 4], [22, 15, [0xEC19E, 0xE8A9E, 0xE8F9E, 0xE949E, 0xE999E, 0xE9E9E, 0xEA39E, 0xEA89E, 0xEAD9E, 0xEB29E, 0xEB79E, 0xEBC9E], 4]]
  };
  const PALM_LEVELS = [1, 2, 3];                                       // Green Grove: palms found by their picture
  const EDGE = [[0, 1], [1, 2], [2, 3], [3, 0]];                       // N, E, S, W as corner pairs (mesh order)
  const NEIGH = [[0, -1, 3, 2], [1, 0, 0, 3], [0, 1, 1, 0], [-1, 0, 2, 1]];
  const DONOR_SIDE = [2, 1, 2, 1];                                     // back walls borrow from the side facing the camera
  // Level header +0x18 holds 128 packed rows, each 32 px of the picture: 256 columns x 3 bytes = two block numbers.
  // Streamed blocks (+0x14) draw tiles from +0x0C; static blocks (+0x10) are VRAM tile words over the loader's tiles.
  // One 32x32 atlas slot per cell top and per 32-unit band of wall; hidden faces borrow a nearby visible one.
  function artBaker(d, id, opts = {}) {
    const useFoliage = opts.foliage !== false;
    const S = 32, h = HEADERS + (id - 1) * HSIZE, f = [];
    for (let k = 0; k < 8; k++) f.push(u32(d, h + 4 * k));
    const gfx = f[3], tabB = f[4], tabA = f[5];
    const mp = rncUnpack(d, f[1]), map = new Uint16Array(16384);
    for (let i = 0; i < 16384; i++) map[i] = u16(mp, i * 2);
    for (const [cx, cz, v] of (GIMMICKS[id] || {}).mapSet || []) map[cz * 128 + cx] = v;   // (as the converter)
    map.fill(0, 0, (GIMMICKS[id] || {}).mapClear || 0);
    const vr = new Uint8Array(0x10000);
    vr.set(rncUnpack(d, f[2]).subarray(0, 0x10000));
    for (let a = f[7]; ;) {
      const k = u16(d, a);
      if (k === 0) break;
      if (k === 1) { const src = u32(d, a + 2), vd = u16(d, a + 10), ln = u16(d, a + 12); vr.set(rncUnpack(d, src).subarray(0, ln * 2), vd); a += 14; }
      else if (k === 2) a += 10; else a += 2;
    }
    for (const [tile, n, addr] of ANIM[id] || []) vr.set(d.subarray(addr, addr + n * 32), tile * 32);
    const animRuns = ANIM_FRAMES[id] || [], animT = new Uint8Array(0x800);
    for (const [tile, n] of animRuns) animT.fill(1, tile, tile + n);
    let animPix = false;   // set by pixel() when the texel it returns comes from an animated tile
    const base = f[6], nRows = u16(d, base) / 2, rows = [];
    for (let r = 0; r < nRows; r++) rows.push(rnc2Unpack(d, base + u16(d, base + 2 * r)));
    const pal = [0, 1, 2, 3].map(line => paletteRGB(d, d[h + 0x26 + line]));
    let maxH = 0;
    for (const v of map) if (v) maxH = Math.max(maxH, ((v >> 8) + 3) * 8);
    const slots = [], tops = new Map(), seen = new Map(), walls = new Map();

    const CH = new Float64Array(16384 * 4);           // corner heights, world units
    for (let i = 0; i < 16384; i++) {
      const v = map[i], hb = v >> 8;
      CH[i * 4] = (hb + ((v >> 6) & 3)) * 8; CH[i * 4 + 1] = (hb + ((v >> 4) & 3)) * 8;
      CH[i * 4 + 2] = (hb + ((v >> 2) & 3)) * 8; CH[i * 4 + 3] = (hb + (v & 3)) * 8;
    }
    const corners = (cx, cz) => {
      if (cx < 0 || cz < 0 || cx >= 128 || cz >= 128 || !map[cz * 128 + cx]) return null;
      const k = (cz * 128 + cx) * 4;
      return [CH[k], CH[k + 1], CH[k + 2], CH[k + 3]];
    };
    const height = (x, z) => {
      const cx = Math.floor(x / S), cz = Math.floor(z / S);
      if (cx < 0 || cz < 0 || cx >= 128 || cz >= 128 || !map[cz * 128 + cx]) return -1e9;
      const k = (cz * 128 + cx) * 4, u = x / S - cx, v = z / S - cz;
      return v >= u ? CH[k] + v * (CH[k + 3] - CH[k]) + u * (CH[k + 2] - CH[k + 3]) : CH[k] + u * (CH[k + 1] - CH[k]) + v * (CH[k + 2] - CH[k + 1]);
    };
    // QM: highest terrain in the quadrant ahead (+x, +z) of each cell; the view ray only climbs, so once it is above
    // that, nothing further can hide the point (same answer as marching on, much sooner)
    const QM = new Float64Array(129 * 129).fill(-1e9);
    for (let cz = 127; cz >= 0; cz--) for (let cx = 127; cx >= 0; cx--) {
      const i = cz * 128 + cx, k = i * 4;
      const own = map[i] ? Math.max(CH[k], CH[k + 1], CH[k + 2], CH[k + 3]) : -1e9;
      QM[cz * 129 + cx] = Math.max(own, QM[cz * 129 + cx + 1], QM[(cz + 1) * 129 + cx]);
    }
    const visible = (x, y, z) => {
      for (let t = 1.5; y + t <= maxH; t += 2) {
        const cx = Math.floor((x + t) / S), cz = Math.floor((z + t) / S);
        if (cx >= 128 || cz >= 128) return true;
        if (cx >= 0 && cz >= 0) {
          if (y + t + 0.5 >= QM[cz * 129 + cx]) return true;
          const k = (cz * 128 + cx) * 4, top = map[cz * 128 + cx] ? Math.max(CH[k], CH[k + 1], CH[k + 2], CH[k + 3]) : -1e9;
          if (y + t + 0.5 >= top) {           // nothing in this cell can reach the ray: jump to the step that leaves it
            const exit = Math.min((cx + 1) * S - x, (cz + 1) * S - z);
            while (t + 2 < exit) t += 2;
            continue;
          }
        }
        if (height(x + t, z + t) > y + t + 0.5) return false;
      }
      return true;
    };
    const texel = (src, o, w, px, py) => {
      if (w & 0x0800) px = 7 - px;
      if (w & 0x1000) py = 7 - py;
      const b = src[o + py * 4 + (px >> 1)];
      return px & 1 ? b & 15 : b >> 4;
    };
    // colour of one picture pixel as palette line*16 + index, or -1 where nothing is drawn;
    // high priority beats low, streamed beats static
    const PAL = new Uint8Array(64 * 3);
    pal.forEach((line, l) => line.forEach((c, i) => PAL.set(c, (l * 16 + i) * 3)));
    // mode 0: as the game draws it (high-priority foliage lifted out shows the ground beneath); 1: high priority only
    let masked = null;
    const pixel = (X, Y, mode = 0) => {
      animPix = false;
      const r = Y >> 5, c = X >> 5;
      if (X < 0 || Y < 0 || r >= nRows || c >= 256) return -1;
      const low = mode === 0 && masked !== null && masked[(Y >> 3) * 1024 + (X >> 3)] === 1;
      const row = rows[r], b0 = row[c * 3], b1 = row[c * 3 + 1], b2 = row[c * 3 + 2];
      const A = (b0 << 4) | (b2 >> 4), B = (b1 << 4) | (b2 & 15);
      const ty = (Y >> 3) & 3, tx = (X >> 3) & 3, py = Y & 7, px = X & 7;
      let best = -1, bestPri = -1;
      if (A >> 1) {
        const col = B & 1 ? 3 - tx : tx;
        let w = u16(d, tabA + (A >> 1) * 32 + ty * 8 + col * 2);
        if (B & 1) w ^= 0x0800;
        if (A & 1) w ^= 0x8000;
        const idx = (w & 0x7FF) + (w & 0x4000 ? 0x800 : 0);
        if (idx && !(low && w & 0x8000) && !(mode === 1 && !(w & 0x8000))) { const ci = texel(d, gfx + idx * 32, w, px, py); if (ci) { best = ((w >> 13) & 1) * 16 + ci; bestPri = w >> 15; } }
      }
      if (B >> 1) {
        const w = u16(d, tabB + (B >> 1) * 32 + ty * 8 + tx * 2);
        if (w & 0x7FF && !(low && w & 0x8000) && !(mode === 1 && !(w & 0x8000))) {
          const ci = texel(vr, (w & 0x7FF) * 32, w, px, py);
          if (ci && (best < 0 || (w >> 15) > bestPri)) { best = ((w >> 13) & 3) * 16 + ci; animPix = animT[w & 0x7FF] === 1; }
        }
      }
      return best;
    };
    // ---- foliage: clumps of high-priority tiles (drawn in front of Sonic) that stand on a floor, lifted out as sprites ----
    const foliage = [], rejects = [], palms = [];
    if (useFoliage) {
      const TW = 1024, TH = nRows * 4, hi = new Uint8Array(TW * TH);
      masked = new Uint8Array(TW * TH);
      // which tile graphics the level also draws at low priority (ground), and which graphic each high tile shows
      const lowUse = new Set(), hiTile = new Int32Array(TW * TH).fill(-1);
      for (let r = 0; r < nRows; r++) for (let c = 0; c < 256; c++) {
        const row = rows[r], b0 = row[c * 3], b1 = row[c * 3 + 1], b2 = row[c * 3 + 2];
        const A = (b0 << 4) | (b2 >> 4), B = (b1 << 4) | (b2 & 15);
        for (let ty = 0; ty < 4; ty++) for (let tx = 0; tx < 4; tx++) {
          let high = false, id = -1;
          if (A >> 1) {
            let w = u16(d, tabA + (A >> 1) * 32 + ty * 8 + (B & 1 ? 3 - tx : tx) * 2);
            if (A & 1) w ^= 0x8000;
            const ix = (w & 0x7FF) + (w & 0x4000 ? 0x800 : 0);
            if (ix) { if (w & 0x8000) { high = true; id = ix; } else lowUse.add(ix); }
          }
          if (B >> 1) {
            const w = u16(d, tabB + (B >> 1) * 32 + ty * 8 + tx * 2);
            if (w & 0x7FF) { if (w & 0x8000) { high = true; if (id < 0) id = 0x10000 + (w & 0x7FF); } else lowUse.add(0x10000 + (w & 0x7FF)); }
          }
          if (high) { hi[(r * 4 + ty) * TW + c * 4 + tx] = 1; hiTile[(r * 4 + ty) * TW + c * 4 + tx] = id; }
        }
      }
      // the terrain a picture pixel shows: walk its view ray from the viewer's side; [x, top, z, depth into a wall]
      const ground = (X, Y) => {
        const k = X - 4096;
        for (let u = 2 * (maxH + Y) + 2; u > 2 * (Y - 64); u -= 1) {
          const x = (u + k) / 2, z = (u - k) / 2, y = u / 2 - Y, ht = height(x, z);
          if (ht >= y) return [x, ht, z, ht - y];
        }
        return null;
      };
      // grass hanging over a cliff's top edge: a tile whose centre shows a wall face less than 28 units below its top
      // (or sits just above such an edge: the tufts rise above the edge line too)
      const isLip = t => {
        const tx = t % TW, ty = (t - tx) / TW;
        for (const dy of [4, 12, 20]) { const g = ground(tx * 8 + 4, ty * 8 + dy); if (g && g[3] >= 3 && g[3] < 28) return true; }
        return false;
      };
      const comps = (tiles, allowed) => {
        const out = [], seenT = new Set();
        for (const st of tiles) {
          if (seenT.has(st)) continue;
          const comp = [st]; seenT.add(st);
          for (let q = 0; q < comp.length; q++) {
            const t = comp[q], tx = t % TW, ty = (t - tx) / TW;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
              const nx = tx + dx, ny = ty + dy, n = ny * TW + nx;
              if (nx >= 0 && ny >= 0 && nx < TW && ny < TH && allowed(n) && !seenT.has(n)) { seenT.add(n); comp.push(n); }
            }
          }
          out.push(comp);
        }
        return out;
      };
      const all = []; for (let t = 0; t < hi.length; t++) if (hi[t]) all.push(t);
      const queue = comps(all, n => hi[n] === 1);
      const bbox = comp => {
        let x0 = TW, x1 = 0, y0 = TH, y1 = 0;
        for (const t of comp) { const tx = t % TW, ty = (t - tx) / TW; x0 = Math.min(x0, tx); x1 = Math.max(x1, tx); y0 = Math.min(y0, ty); y1 = Math.max(y1, ty); }
        return [x0, y0, x1, y1];
      };
      // blobs of a piece's picture (pixels within 2 of each other join up); blobs under 120 pixels (a flower's shadow)
      // go with the nearest big one; one big blob or none: the piece stays whole
      const splitBlobs = (img, w, h) => {
        const lab = new Int32Array(w * h).fill(-1), blobs = [];
        for (let s0 = 0; s0 < w * h; s0++) {
          if (!img[s0 * 4 + 3] || lab[s0] >= 0) continue;
          const pts = [s0]; lab[s0] = blobs.length;
          for (let q = 0; q < pts.length; q++) {
            const x = pts[q] % w, y = (pts[q] - x) / w;
            for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
              const nx = x + dx, ny = y + dy, n = ny * w + nx;
              if (nx >= 0 && ny >= 0 && nx < w && ny < h && img[n * 4 + 3] && lab[n] < 0) { lab[n] = blobs.length; pts.push(n); }
            }
          }
          let sx = 0, sy = 0; for (const t of pts) { sx += t % w; sy += Math.floor(t / w); }
          blobs.push({ pts, cx: sx / pts.length, cy: sy / pts.length });
        }
        const big = blobs.filter(b => b.pts.length >= 120);
        if (big.length < 2) return [{ img, w, h, ox: 0, oy: 0 }];
        for (const b of blobs) if (b.pts.length < 120) {
          let best = big[0], bd = Infinity;
          for (const g of big) { const d = (g.cx - b.cx) ** 2 + (g.cy - b.cy) ** 2; if (d < bd) { bd = d; best = g; } }
          best.pts = best.pts.concat(b.pts);
        }
        return big.map(b => {
          let bx0 = w, by0 = h, bx1 = 0, by1 = 0;
          for (const t of b.pts) { const x = t % w, y = (t - x) / w; bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y); }
          const pw = bx1 - bx0 + 1, ph = by1 - by0 + 1, pim = new Uint8ClampedArray(pw * ph * 4);
          for (const t of b.pts) { const x = t % w, y = (t - x) / w; pim.set(img.subarray(t * 4, t * 4 + 4), ((y - by0) * pw + x - bx0) * 4); }
          return { img: pim, w: pw, h: ph, ox: bx0, oy: by0 };
        });
      };
      // a part stands where the middle of its two lowest rows meets the floor (null if that is a wall face or nothing)
      const standPart = (pt, pxo, pyo) => {
        let bottom = -1, sumX = 0, nB = 0;
        for (let o = 3; o < pt.img.length; o += 4) if (pt.img[o]) bottom = Math.max(bottom, Math.floor((o >> 2) / pt.w));
        for (let iy = bottom - 1; iy <= bottom; iy++) for (let ix = 0; ix < pt.w; ix++) if (iy >= 0 && pt.img[(iy * pt.w + ix) * 4 + 3]) { sumX += ix; nB++; }
        const g = nB ? ground(pxo + pt.ox + sumX / nB, pyo + pt.oy + bottom + 1) : null;
        if (!g || g[3] >= 3) return null;
        return { x: g[0], y: g[1], z: g[2], w: pt.w, h: pt.h, ax: sumX / nB, ay: bottom + 1, img: pt.img, px: pxo + pt.ox, py: pyo + pt.oy };
      };
      for (let qi = 0; qi < queue.length; qi++) {
        const comp = queue[qi];
        const [x0, y0, x1, y1] = bbox(comp);
        if (x1 - x0 >= 24 || y1 - y0 >= 24) {
          if (comp.split) { rejects.push([x0, y0, x1, y1, 'big']); continue; }
          // a long strip: drop its grass-lip tiles and look again at what is left standing
          const keep = new Set(comp.filter(t => !isLip(t)));
          for (const part of comps([...keep], n => keep.has(n))) { part.split = true; queue.push(part); }
          continue;
        }
        const w = (x1 - x0 + 1) * 8, h = (y1 - y0 + 1) * 8, img = new Uint8ClampedArray(w * h * 4);
        let opaque = 0, bottom = -1, sumX = 0, nB = 0, top = h;
        for (const t of comp) {
          const tx = t % TW, ty = (t - tx) / TW;
          for (let py = 0; py < 8; py++) for (let px = 0; px < 8; px++) {
            const c = pixel(tx * 8 + px, ty * 8 + py, 1);
            if (c < 0) continue;
            const ix = (tx - x0) * 8 + px, iy = (ty - y0) * 8 + py, o = (iy * w + ix) * 4;
            img[o] = PAL[c * 3]; img[o + 1] = PAL[c * 3 + 1]; img[o + 2] = PAL[c * 3 + 2]; img[o + 3] = 255;
            opaque++; bottom = Math.max(bottom, iy); top = Math.min(top, iy);
          }
        }
        if (opaque < 30 || bottom - top < 10) { rejects.push([x0, y0, x1, y1, 'small']); continue; }
        for (let iy = bottom - 1; iy <= bottom; iy++) for (let ix = 0; ix < w; ix++) if (img[(iy * w + ix) * 4 + 3]) { sumX += ix; nB++; }
        const g = ground(x0 * 8 + sumX / nB, y0 * 8 + bottom + 1);
        if (!g || g[3] >= 3) { rejects.push([x0, y0, x1, y1, 'base']); continue; }   // base on a wall face or nothing: leave it painted
        // pieces of floor drawn in front (raised edges) reuse the ground's own tiles; palms and flowers almost never do
        const groundy = comp.filter(t => lowUse.has(hiTile[t])).length / comp.length;
        if (groundy > 0.3) { rejects.push([x0, y0, x1, y1, 'ground']); continue; }
        // a piece holding several flowers (or a palm with flowers at its foot) is one picture, but each thing in it
        // stands on its own ground: split it into its blobs, each standing where its own foot is
        const parts = splitBlobs(img, w, h).map(pt => standPart(pt, x0 * 8, y0 * 8));
        if (parts.length > 1 && parts.every(Boolean)) foliage.push(...parts);
        else foliage.push({ x: g[0], y: g[1], z: g[2], w, h, ax: sumX / nB, ay: bottom + 1, img, px: x0 * 8, py: y0 * 8 });
        for (const t of comp) masked[t] = 1;
      }
      // ---- Green Grove palms: all one picture, sometimes mirrored, sometimes overlapping flowers or another palm ----
      // A palm standing alone (64 x 80, its leaves 8 x 8 tiles holding 1766 green pixels) is the pattern; any
      // tile-aligned window whose green matches it (or its mirror) nine parts in ten is a palm. Each palm gets its foot
      // on the floor and is cut out of a copy of its piece (`bare`), for a game that draws palms as models.
      if (PALM_LEVELS.includes(id)) {
        const leafy = (img, o) => img[o + 3] && img[o] < 40 && img[o + 2] < 40 && img[o + 1] > 60;
        const greenOf = f => { let n = 0; for (let o = 0; o < f.img.length; o += 4) if (leafy(f.img, o)) n++; return n; };
        // the lone palm whose foot is furthest from its middle has nothing else drawn at its foot
        const lone = foliage.filter(f => f.w === 64 && f.h === 80 && Math.abs(greenOf(f) - 1766) < 40).sort((a, b) => Math.abs(b.ax - 32) - Math.abs(a.ax - 32))[0];
        if (lone) {
          const green = [], solidPx = [];
          for (let y = 0; y < 80; y++) for (let x = 0; x < 64; x++) {
            const o = (y * 64 + x) * 4;
            if (leafy(lone.img, o)) green.push([x, y]);
            if (lone.img[o + 3]) solidPx.push([x, y]);
          }
          foliage.forEach((f, fi) => {
            const found = [];
            for (let ty = 0; ty * 8 + 80 <= f.h; ty++) for (let tx = 0; tx * 8 + 64 <= f.w; tx++) for (const mir of [false, true]) {
              let hit = 0;
              for (const [x, y] of green) if (leafy(f.img, ((ty * 8 + y) * f.w + tx * 8 + (mir ? 63 - x : x)) * 4)) hit++;
              if (hit >= green.length * 0.9) found.push({ tx, ty, mir, hit });
            }
            found.sort((a, b) => b.hit - a.hit);
            const kept = [];
            for (const c of found) if (kept.every(k => Math.abs(k.tx - c.tx) >= 4 || Math.abs(k.ty - c.ty) >= 4)) kept.push(c);
            for (const c of kept) {
              const footX = c.mir ? 64 - lone.ax : lone.ax;
              const g = ground(f.px + c.tx * 8 + footX, f.py + c.ty * 8 + 80);
              if (!g || g[3] >= 3) continue;   // foot on a wall face or nothing: leave this one painted
              if (!f.bare) f.bare = f.img.slice();
              for (const [x, y] of solidPx) f.bare[((c.ty * 8 + y) * f.w + c.tx * 8 + (c.mir ? 63 - x : x)) * 4 + 3] = 0;
              palms.push({ x: g[0], y: g[1], z: g[2], mirror: c.mir, piece: fi });
            }
            if (f.bare) { let n = 0; for (let o = 3; o < f.bare.length; o += 4) if (f.bare[o]) n++; f.bareCount = n; }
          });
        }
      }
    }
    const sample = (x, y, z) => { const c = pixel(Math.floor(x - z + 4096), Math.floor((x + z) / 2 - y)); return c < 0 ? 0 : c; };
    // a slot is drawn by fn(s, t); one that shows any animated tile is remembered (with which texels do) to be drawn
    // again for each frame of the animation
    const animSlots = [];
    const drawSlot = (fn, px, mask) => {
      for (let t = 0; t < S; t++) for (let s = 0; s < S; s++) {
        const c = fn(s, t) * 3, o = (t * S + s) * 4;
        px[o] = PAL[c]; px[o + 1] = PAL[c + 1]; px[o + 2] = PAL[c + 2]; px[o + 3] = 255;
        if (mask && animPix) mask[t * S + s] = 1;
      }
    };
    const newSlot = (fn, wallSlot = false) => {   // wallSlot: the band number of a wall slot
      const px = new Uint8ClampedArray(S * S * 4), mask = animRuns.length ? new Uint8Array(S * S) : null;
      drawSlot(fn, px, mask);
      slots.push(px);
      if (mask && mask.some(Boolean)) animSlots.push({ i: slots.length - 1, fn, mask, wall: wallSlot !== false, band: wallSlot === false ? 0 : wallSlot });
      return slots.length - 1;
    };
    // the animation at a video frame (60 a second): each run shows the frame its durations give; when any run changes,
    // the animated slots are drawn again. Returns the slots that changed ([] when nothing did)
    const animShown = animRuns.map(() => -1);
    function animStep(vf) {
      let changed = false;
      animRuns.forEach(([tile, n, addrs, dur], r) => {
        const durs = Array.isArray(dur) ? dur : addrs.map(() => dur), cycle = durs.reduce((a, b) => a + b, 0);
        let tt = vf % cycle, k = 0;
        while (tt >= durs[k]) tt -= durs[k++];
        if (k !== animShown[r]) { animShown[r] = k; vr.set(d.subarray(addrs[k], addrs[k] + n * 32), tile * 32); changed = true; }
      });
      if (!changed) return [];
      return animSlots.map(a => { drawSlot(a.fn, slots[a.i], null); return a; });
    }
    const topVisible = (cx, cz) => {
      const key = cz * 128 + cx;
      if (!seen.has(key)) {
        const c = corners(cx, cz), X = cx * S, Z = cz * S;
        let ok = !!c;
        for (const [u, v] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
          if (ok && !visible(X + u * S, height(X + u * S, Z + v * S), Z + v * S)) ok = false;
        }
        seen.set(key, ok);
      }
      return seen.get(key);
    };
    function top(cx, cz) {
      const key = cz * 128 + cx;
      if (tops.has(key)) return tops.get(key);
      if (!topVisible(cx, cz)) {
        let found = null;
        for (let rad = 1; rad < 9 && !found; rad++) {
          for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== rad) continue;
            if (found === null && corners(cx + dx, cz + dz) && topVisible(cx + dx, cz + dz)) found = [cx + dx, cz + dz];
          }
        }
        if (found) { const v = top(found[0], found[1]); tops.set(key, v); return v; }
      }
      const X = cx * S, Z = cz * S;
      const v = newSlot((s, t) => { const x = X + s + 0.5, z = Z + t + 0.5; return sample(x, height(x, z), z); });
      tops.set(key, v);
      return v;
    }
    const P4 = (cx, cz) => [[cx * S, cz * S], [cx * S + S, cz * S], [cx * S + S, cz * S + S], [cx * S, cz * S + S]];
    // does this cell have a wall on that side (its top edge above the neighbour's)?
    function hasWall(cx, cz, edge) {
      if (cx < 0 || cz < 0 || cx >= 128 || cz >= 128 || !map[cz * 128 + cx]) return false;
      const [a, b] = EDGE[edge], [dx, dz, na, nb] = NEIGH[edge], k = (cz * 128 + cx) * 4;
      const nx = cx + dx, nz = cz + dz, has = nx >= 0 && nz >= 0 && nx < 128 && nz < 128 && map[nz * 128 + nx];
      const n = (nz * 128 + nx) * 4;
      return !(CH[k + a] <= (has ? CH[n + na] : -1e9) && CH[k + b] <= (has ? CH[n + nb] : -1e9));
    }
    function wallGeom(cx, cz, edge) {
      const c = corners(cx, cz), [a, b] = EDGE[edge], P = P4(cx, cz), [dx, dz, na, nb] = NEIGH[edge], n = corners(cx + dx, cz + dz);
      return [P[a], P[b], c[a], c[b], n ? n[na] : -1e9, n ? n[nb] : -1e9];
    }
    function wallPoint(g, k, s, t) {
      const [pa, pb, ta, tb, ba, bb] = g, fr = (s + 0.5) / S;
      const x = pa[0] + (pb[0] - pa[0]) * fr, z = pa[1] + (pb[1] - pa[1]) * fr;
      return [x, ta + (tb - ta) * fr - S * k - (t + 0.5), z, ba + (bb - ba) * fr];
    }
    const wallSeen = new Map(), donors = new Map();
    function wallVisible(cx, cz, edge, k) {
      if (edge === 0 || edge === 3) return false;
      const key = ((cz * 128 + cx) * 4 + edge) * 4096 + k;
      if (!wallSeen.has(key)) wallSeen.set(key, wallVisibleNow(cx, cz, edge, k));
      return wallSeen.get(key);
    }
    function wallVisibleNow(cx, cz, edge, k) {
      const g = wallGeom(cx, cz, edge);
      let n = 0;
      for (const [s, t] of [[8, 8], [24, 8], [8, 24], [24, 24]]) {
        const [x, y, z, bot] = wallPoint(g, k, s, t);
        if (y < bot) continue;
        if (!visible(x + (edge === 1 ? 0.5 : 0), y, z + (edge === 2 ? 0.5 : 0))) return false;
        n++;
      }
      return n > 0;
    }
    function plain() {
      if (!walls.has('plain')) walls.set('plain', newSlot(() => 9));
      return walls.get('plain');
    }
    // a band painted with leaves or vines: more than 1 in 32 of 64 sampled points green
    function leafy(cx, cz, edge, k) {
      const g = wallGeom(cx, cz, edge);
      let n = 0, m = 0;
      for (let t = 2; t < S; t += 4) for (let s = 2; s < S; s += 4) {
        const [x, y, z, bot] = wallPoint(g, k, s, t);
        if (y < bot) continue;
        const c = sample(x, y, z) * 3; m++;
        if (PAL[c + 1] > PAL[c] + 24 && PAL[c + 1] > PAL[c + 2] + 24) n++;
      }
      return n * 32 > m;
    }
    // nearest visible wall band (same top band or body band) on the side that faces the camera; body bands lend only
    // plain rock (no leaves or vines) when any lies within reach, so a wall the original never shows is not a pattern
    // of copied plants
    function donor(cx, cz, edge, kk) {
      const dkey = ((cz * 128 + cx) * 4 + edge) * 3 + kk;
      if (donors.has(dkey)) return donors.get(dkey);
      const side = DONOR_SIDE[edge];
      let found = null;
      for (const clean of kk ? [true, false] : [false]) {
        for (let rad = 0; rad < 17 && !found; rad++) {
          for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== rad || found) continue;
            const x2 = cx + dx, z2 = cz + dz;
            if (!hasWall(x2, z2, side) || (x2 === cx && z2 === cz && side === edge)) continue;
            if (wallVisible(x2, z2, side, kk) && !(clean && leafy(x2, z2, side, kk))) found = [x2, z2, side, kk];
          }
        }
        if (found) break;
      }
      donors.set(dkey, found);
      return found;
    }
    function wall(cx, cz, edge, k) {
      const key = ((cz * 128 + cx) * 4 + edge) * 4096 + k;
      if (walls.has(key)) return walls.get(key);
      let v;
      if (wallVisible(cx, cz, edge, k)) {
        const g = wallGeom(cx, cz, edge);
        v = newSlot((s, t) => { const [x, y, z] = wallPoint(g, k, s, t); return sample(x, y, z); }, k);
      } else {
        // hidden band: repeat this wall's own visible body bands if it has any, else borrow from a nearby wall,
        // a deep body band (2) for deep bands so the grass under the top edge does not repeat down the cliff
        const own = [];
        for (let j = 1; j < k; j++) if (wallVisible(cx, cz, edge, j)) own.push(j);
        if (own.length) v = wall(cx, cz, edge, own[(k - 1) % own.length]);
        else {
          const found = (k >= 2 && donor(cx, cz, edge, 2)) || donor(cx, cz, edge, Math.min(k, 1));
          v = found ? wall(...found) : plain();
        }
      }
      walls.set(key, v);
      return v;
    }
    function atlas() {
      const cols = 64, rowsUsed = Math.ceil(slots.length / cols);
      let H = 32;
      while (H < rowsUsed * S) H *= 2;
      const W = cols * S, px = new Uint8ClampedArray(W * H * 4);
      slots.forEach((sl, i) => {
        const ox = (i % cols) * S, oy = Math.floor(i / cols) * S;
        for (let t = 0; t < S; t++) px.set(sl.subarray(t * S * 4, (t + 1) * S * 4), ((oy + t) * W + ox) * 4);
      });
      return { width: W, height: H, pixels: px, cols, slot: S };
    }
    // the nearest plain rock wall band to a cell (for a wall the original only hints at, such as a cracked wall): a
    // slot index, or -1
    function rockSlot(cx, cz) {
      for (const kk of [2, 1]) for (const edge of [1, 2]) { const f = donor(cx, cz, edge, kk); if (f && !leafy(...f)) return wall(...f); }
      return -1;
    }
    return { top, wall, atlas, foliage, palms, rejects, rockSlot, get count() { return slots.length; },
      animSlots, animStep, slotPixels: i => slots[i] };
  }

  const typeArt = (d, t) => u32(d, 0x280E8 + t);   // an object type's art block (Green Grove's boss: 48 pod, 50 ball)
  return { LEVELS, BONUS, bonusStage, bonusSprite, check, openRomFile, objImage, typeArt, FLICKY_ART, BIG_RING_ART, convert, rncUnpack, rnc2Unpack, artBaker, RECIPES, paletteRGB, heroImage, heroFrame, recipeImage, monitorImage, MONITOR_KINDS, tallyImage, SOUND, ringImage, monitorIcon, titleCardImage, levelPalettes, OCTANT, HERO, heroAnimator };
})();
