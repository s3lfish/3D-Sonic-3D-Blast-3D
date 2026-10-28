"""Reference converter: Sonic 3D Blast (Mega Drive) level terrain -> Blast Grid "tiles" level JSON.
Usage: python3 convert.py rom.bin LEVEL_ID [vscale, default 1] > level.json      (LEVEL_ID 1..22)
Format notes (verified on Green Grove 1/2):
  level headers: 22 x 0x2A bytes at 0x1AB62; +0x04 = RNC1-packed 128x128 big-endian word map;
  +0x20 = start table (x at +0x14, y at +0x16, z at +0x18, world units).
  map word: high byte = floor height in 8-unit steps; low byte = corner raises NW,NE,SE,SW (2 bits each, 8-unit steps);
  0 = no floor. One cell = 32 world units horizontally."""
import json, math, struct, sys, rnc


def jround(v, n):
    """Round like JavaScript's Math.round (halves go up), so the JS port can match exactly."""
    k = 10 ** n
    return math.floor(v * k + 0.5) / k

HEADERS, HSIZE, CELL, STEP = 0x1AB62, 0x2A, 32, 8
SPLIT = 0x4A08   # per corner byte: the cell is split north-east to south-west (see s3d.js)
PIECES = [0xD5, 0x75, 0x5D, 0x57]   # diagonal corner pieces: NW, NE, SE, SW corner up (see s3d.js)
RING_TABLE, RING_HOVER = 0x1936, 18
# object types identified from in-game photos (springs, monitors, the act-end ring, player start, main enemies)
KINDS = {0x30: 'start', 0x18: 'spring', 0x158: 'spring', 0x3C: 'monitor', 0x40: 'goal', 0x08: 'mine', 0x54: 'turret', 0x24: 'booster',
         0x04: 'enemy', 0x0C: 'enemy', 0x94: 'enemy', 0x144: 'enemy', 0x148: 'enemy', 0x60: 'enemy', 0x64: 'enemy', 0x100: 'enemy', 0x10C: 'enemy',
         0xC4: 'enemy', 0xC8: 'enemy', 0x58: 'enemy', 0x9C: 'enemy', 0x8C: 'spring', 0x98: 'lift', 0xAC: 'crawler',
         0x5C: 'enemy', 0x14C: 'enemy', 0x150: 'balloon', 0xDC: 'spring',
         0x104: 'enemy', 0x108: 'enemy', 0x12C: 'jetLift', 0x120: 'fireSpot', 0x128: 'movePlat', 0x118: 'spikeBall',
         0x7C: 'sprinkler', 0x6C: 'pylon', 0x78: 'movePlat', 0x70: 'prop', 0x74: 'prop',
         0x178: 'enemy', 0x19C: 'capsule', 0x194: 'lever', 0x184: 'prop', 0x17C: 'enemy', 0x180: 'beamPost', 0x18C: 'jetLift',
         0x15C: 'friend', 0x160: 'friend', 0x44: 'head'}
PROP_FRAME = {0x70: 6, 0x74: 0, 0x184: 7}
PATROL = {0x100, 0x108, 0x148, 0x9C, 0x5C, 0x178}   # half a unit a frame (measured; see s3d.js)
WANDER, ROAM = {0x94, 0x144, 0x10C, 0x17C}, {0x60, 0x14C, 0x104, 0xC4, 0x04}   # handlers 0x17346 and 0x17CB6 (see s3d.js)
MONITOR_KINDS = ['oneup', 'rings', 'shield', 'gold', 'invincible', 'speed', 'fire']


# the original's movement, measured in the running game (see s3d.js physicsFor)
def physics_for(vscale):
    r4 = lambda v: jround(v * vscale, 4)
    g = 900 / CELL
    jump = 5.625 * 60 / CELL   # the original's 0x5A000 (see s3d.js)
    return {"gravity": r4(g), "jumpV": r4(jump), "jumpCut": r4(jump * 0.4), "maxFall": r4(420 / CELL), "stepUp": r4(8 / CELL), "snapDown": r4(2 / CELL), "orig": 1}


def launch_for(vscale, rise):
    g, hh = 900 / CELL * vscale, rise / CELL * vscale
    return jround((g / 60 + math.sqrt((g / 60) ** 2 + 8 * g * hh)) / 2, 4)


def spring_power(vscale):
    return launch_for(vscale, 140)   # measured: a spring throws Sonic 140 units up


BLANK = {3: [44, 30], 4: [51, 34], 8: [49, 33], 12: [55, 32], 14: [44, 34], 17: [46, 30], 18: [44, 32], 20: [51, 34], 21: [44, 32]}   # frames blank while an act reloads (see s3d.js)
GIMMICKS = {
    4: {'updrafts': 0x55, 'zapCells': 0xAA, 'roofs': 0x12254, 'pyramids': (0x11EE4, 4),   # Gene Gadget 1 (see s3d.js)
        'dashes': [(65, 101, 0x7FFF, (6, 0), 1, 0, 0), (65, 102, 0x7FFF, (6, 0), 1, 0, 0), (74, 94, 0x7FFF, (0, 6), 1, 0, 0), (75, 94, 0x7FFF, (0, 6), 1, 0, 0)],
        'barriers': [([(58, 117), (59, 117), (60, 117), (61, 117)], 0x2D, [(59, 118), (60, 118)], 'n', 1, (0, 1)),
                     ([(117, 93), (117, 94)], 0x45, [(118, 94), (118, 95)], 'w', 2, (1, 0))],
        'gates': [([(58, 112), (59, 112)], 0x2D, 0, 1), ([(68, 89), (69, 89)], 0x49, 0, 1), ([(54, 70)], 0x51, 0, 0, 1)], 'keyOff': [(54, 71, 1)], 'passOff': [(68, 90)],
        'tubes2': (0x120F8, 10, [(0, 3, 0x1A)], [(0, 1)]),
        'rides': [(59, 112, 0, 0x18, None, None, (0, 0, -7.48), None, (340, None, 1, 1))]},
    5: {'updrafts': 0x55, 'zapCells': 0xAA, 'roofs': 0x11AAA, 'spikes': 0xFF, 'slides': [(0xC3, [1, 0], 75), (0xF0, [0, 1], 75)],   # Gene Gadget 2
        'dashes': [(cx, cz, 0x7FFF, (0, 6), 1, 0, 0) for cx, cz in ((56, 70), (57, 70), (32, 88), (33, 88), (64, 66), (65, 66), (66, 66), (67, 66))]
                  + [(cx, cz, 0x7FFF, (6, 0), 1, 0, 0) for cx, cz in ((59, 103), (59, 104), (59, 111), (59, 112), (59, 113), (59, 114))],
        'barriers': [([(49, 69), (50, 69), (51, 69), (52, 69)], 0x65, [(50, 70), (51, 70)], 'n', 1, (0, 1))],
        'gates': [([(31, 97)], 0x85, 0, 0, 1), ([(68, 64)], 0x89, 0, 0, 2)], 'keyOff': [(32, 97, 1), (69, 64, 2)],
        'tubes2': (0x11998, 6, [], [(0, 1), (5, 2)]),
        'chutes': [(50, 53, 83, 108, [0, 1], 0.25, 1664, 8.19, 200)],
        'rides': [(52, 107, 0, 0x20, None, None, (0, 5.5, 0), None, (40, None)), (21, 105, 0, 0x1E, None, None, (0, 5.5, 0), None, (40, None), 1)]},
    1: {'cannons': [(116, 12, 248, 9, 7.067)], 'cracks': [([(108, 17)], 480, [0, -1])], 'friends': {'tails': {'section': 1}, 'knuckles': {'cannon': (116, 12)}}},
    2: {'cannons': [(21, 48, 576, 9, 6.1)], 'cracks': [([(59, 47)], 784, [-1, 0]), ([(108, 41), (109, 41)], 688, [0, -1])]},
    # Rusty Ruin 1 (see s3d.js GIMMICKS): spike and fan cell marks, door and pillar tables, pockets after rings, rides
    7: {'spikes': 0xFF, 'fans': 0x55, 'roofs': 0x7AA0, 'doors': (0x7994, 4), 'pillars': (0x7ACC, 23), 'maces': (0x75C2, 5, 13), 'flames': (0x7548, 5),
        'links': [(1696, 1840, 90), (2576, 1216, 180)],
        'rides': [(60, 48, 1, 0x36, (1888, 392, 768), 0x400, (0, 0, 5)), (80, 50, 2, 0x38, None, None, (0, 0, 0))],
        'pads': [(0, -1, 1), (1, -1, 2)],
        'cracks': [([(88, 62)], 432, [-1, 0]), ([(100, 41), (100, 15, 560)], 432, [0, -1])]},
    # Rusty Ruin 2 (see s3d.js GIMMICKS)
    6: {'friends': {'tails': {'cell': (85, 101), 'maxY': 32}}, 'spikes': 0xFF, 'fans': 0x55, 'roofs': 0x8252, 'pillars': (0x8266, 23), 'maces': (0x80B8, 6, 19), 'flames': (0x7EC4, 9), 'padRise': 138, 'pads': [(0, 1, 1), (1, 0, 1), (2, 3, 2), (3, 2, 2)],
        'slides': [(0xC3, [1, 0]), (0xF0, [0, 1])], 'pillarLinks': [(85, 101, 0x05, [(99, 96, 0x22)])],
        'rides': [(98, 96, 0, 0x30, None, None, (0, 0, 0)), (85, 101, 0, 0x2E, None, None, (0, 0, 0), 40),
                  (100, 60, 0, 0x32, None, None, (0, 0, 0)), (91, 71, 0, 0x34, None, None, (0, 0, 0))],
        'cracks': [([(101, 60)], 336, [-1, 0])]},
    # Spring Stadium 1 and 2 (see s3d.js GIMMICKS)
    15: {'floorSprings': 0x55, 'bumpers': (0xFF, 0x98DA, 8), 'spikeField': 0xAA,   # Spring Stadium 1 (see s3d.js)
         'gates': [([(33, 116), (33, 117)], 0x45, 0, 1), ([(41, 114), (41, 115)], 0x45, 0, 1), ([(52, 114), (52, 115)], 0x4F, 0, 1),
                   ([(62, 38), (62, 39)], 0x91, 0, 1), ([(50, 40), (50, 41)], 0x97, 0, 1), ([(33, 78), (34, 78)], 0x85, 1, 0)],
         'passOff': [(42, 115), (77, 113), (63, 39)],
         'rides': [(37, 117, 0, 4, None, None, None, None, (140, [1, 0])), (61, 115, 0, 4, None, None, None, None, (200, [1, 0])),
                   (77, 113, 0, 4, None, None, None, None, (85, [1, 0])), (59, 41, 0, 4, None, None, None, None, (70, None))],
         'holds': [(55, 115, 100), (53, 41, 100)], 'tubes': (0x98C6, 0x40, 0x42),
         'tris': [('x', 2432, 1600, 0, -4, 4, 1), ('x', 2432, 1792, 1, -4, -4, 1)]},
    17: {'floorSprings': 0x55, 'spikeField': 0xFF},
    9: {'pads': [(0, 1, 1), (2, 3, 2)],
        'rides': [(89, 50, 0, 0x8004, None, None, None, None, (80, None)), (40, 70, 0, 0x3A, None, None, (0, 0, 7.5), None, (80, None, 1), None, 2),
                  (86, 81, 0, 0x3C, None, None, None)],
        'chutes': [(39, 40, 52, 70, [0, 1], 0.25, 1280)], 'dashes': [(54, 65, 704, (7.5, 0), 24, 14, 6)],
        'sleds': [(78, 79, 66, 66, (2528, 672, 2128), [0, 1], 0.0625, 300)],
        'currents': [(110, 113, 55, 89, [0, 1], 0.375, 2, 2.5), (50, 53, 83, 99, [0, 1], 0.375, 3, 4)],
        'hops': ([(94, 39), (90, 39), (80, 39)], 40), 'flames': (0x10976, 7), 'freeze': 1,
        'spikes': 0xFF, 'ice': (0x10B24, 21, 0x10B4E, 25, [(89, 50)], [(86, 74)]), 'iceSpikes': (0x10B80, 27), 'roofs': 0x10AF2, 'bumpers': (0x55, 0, 0),
        'gates': [([(88, 54), (89, 54)], 0x6D, 0, 1), ([(90, 47), (91, 47)], 0x6D, 0, 1), ([(86, 75), (87, 75)], 0x59, 0, 2), ([(78, 67), (79, 67)], 0x65, 0, 2)],
        'passOff': [(91, 46), (86, 74, 2)], 'shuts': [([(38, 76)], [(37, 75), (38, 75)], 0x7D)],
        'warps': [(57, 50, 0x770, 0x1E0, 0x910, 0x320), (59, 72, 0x730, 0x340, 0x650, 0x1C0)]},   # Diamond Dust 1 (see s3d.js)
    12: {'friends': {'knuckles': {'cell': (86, 99)}}, 'pads': [(0, 1, 1)], 'lava': 0x55, 'rocks': (0xB484, 27), 'roofs': 0xB386, 'vents': (0xB394, 8), 'spouts': (0xB286, 16), 'fireRuns': (0xB194, 5), 'fireBars': (0xB25C, 3),
         'cracks': [([(55, 61)], 744, [0, -1]), ([(94, 114)], 424, [-1, 0])], 'balls': (0xE80, 56, 8, 0xB90, 0xD10), 'ventOff': [(0x63AC, 0x56A8)]},
    13: {'pads': [(0, 1, 1), (2, 3, 2)], 'lava': 0x55, 'rocks': (0xAB42, 42), 'roofs': 0xAA4A, 'vents': (0xA8F6, 6), 'spouts': (0xA9AA, 10), 'fireRuns': (0xAA5E, 5), 'fireBars': (0xAB26, 2),
         'cracks': [([(59, 55)], 680, [-1, 0]), ([(65, 63)], 584, [-1, 0])]},
    14: {'lava': 0x55},
    18: {'roofs': 0x11482},   # Gene Gadget 3
    19: {'roofs': 0x13FFC, 'slides': [(0xF0, [0, 1], 0, [85, 86])], 'cracks': [([(67, 63)], 744, [0, -1])], 'tubes2': (0x13BCA, 6, [], [], 8, 1),   # Panic Puppet 2 (see s3d.js)
         'carriers': [(0x6A0, 0x73F, 0xB00, 0xB3F, None, 0xB20, None, 0x740, None, (0x52, (7, 0, 0), None, None, 120, None), 'x', 1),
                      (0xA20, 0xA5F, 0x720, 0x79F, None, 0xA40, None, 0x7A0, None, None, 'z', 1)],
         'shuts': [([(66, 87)], [(65, 86), (65, 87)], 0x55), ([(63, 34), (64, 34)], [(63, 33), (64, 33)], 0x91, 'shut'),
                   ([(cx, 46) for cx in range(66, 73)], [(67, 45), (68, 45), (71, 45), (72, 45)], 0x91, 'shut'), ([(89, 46)], [(89, 45)], 0x4D, 'doorShut')],
         'lifts': [(0x810, 0x82F, 0x620, 0x627, (0x820, 0x390, 0x628), 0x54, 30, 110)]},
    21: {'mapSet': [(45, 44, 0x3D00)], 'mapClear': 185, 'startLock': 50},   # Panic Puppet 3 (see s3d.js)
    20: {'updrafts': 0x55, 'zapCells': 0xAA, 'roofs': 0x13B00, 'slides': [(0xC3, [1, 0]), (0xF0, [0, 1])], 'cracks': [([(48, 48)], 840, [0, -1])],   # Panic Puppet 1 (see s3d.js)
         'gates': [([(68, 97), (68, 98)], 0x41, 0, 0, 1), ([(40, 62)], 0x61, 0, 0, 1)], 'keyOff': [(69, 98, 1, {'f': 1}), (40, 63, 1, {'f': 0})],
         'tubes2': (0x13464, 4, [], [(1, 1)], 8, 1),
         'switches': [(31, 92, 'a', 0), (31, 91, 'a', 1), (44, 78, 'b', 0), (44, 77, 'b', 1), (86, 63, 'b', 0), (86, 62, 'b', 1)],
         'carryWay': ['f', 'b', 'a'],
         'carriers': [(0x480, 0x51F, 0xB60, 0xB9F, None, 0xB80, 0x477, 0x520, None, (0x56, (7, 0, 0), (0x860, 0x100, 0xC40), 0x600, 220, 1)),
                      (0x7C0, 0xABF, 0x9A0, 0x9DF, 0xE0, 0x9C0, 0x7B7, 0xAC8, (0x920, 0xA80), None)]},
    10: {'pads': [(0, 1, 1), (2, 3, 2)], 'rides': [(78, 95, 0, 0x803E, None, None, None, None, (400, None))],
         'dashes': [(50, 45, 608, (7.5, 0), 10, 0, 0)], 'currents': [(96, 117, 88, 95, [1, 0], 0.375, 3.5, 3.5)],
         'hops': ([(109, 80), (103, 82), (111, 72)], 40), 'flames': (0xFD5E, 7), 'freeze': 1,
         'spikes': 0xFF, 'ice': (0xFE30, 39, 0xFE7E, 40, [(75, 100)], [(70, 105)]), 'iceSpikes': (0xFECE, 17), 'roofs': 0xFE04, 'bumpers': (0x55, 0, 0),
         'gates': [([(77, 95), (78, 95)], 0x41, 0, 1), ([(91, 106), (92, 106)], 0x39, 0, 1)], 'passOff': [(91, 107)]},   # Diamond Dust 2 (see s3d.js)
    16: {'floorSprings': 0x55, 'bumpers': (0xFF, 0x94EA, 30), 'spikeField': 0xAA,   # Spring Stadium 2 (see s3d.js)
         'gates': [([(64, 104), (64, 105)], 0x3F, 0, 1), ([(76, 102), (76, 103)], 0x39, 0, 1), ([(84, 78), (85, 78)], 0x69, 0, 1),
                   ([(86, 71), (87, 71)], 0x69, 0, 1), ([(61, 110), (62, 110)], 0x41, 1, 0), ([(123, 51), (124, 51)], 0x65, 2, 0)],
         'passOff': [(77, 103), (87, 70), (85, 79)],
         'rides': [(73, 105, 0, 4, None, None, None, None, (70, None)), (85, 76, 0, 0x8004, None, None, None, None, (84, None)),
                   (87, 74, 0, 0x8044, None, None, None, None, (84, None))],
         'holds': [(68, 105, 100)], 'tubes': (0x9480, 0x40, 0x42),
         'tris': [('z', 1472, 1152, 0, 4, -4, 1), ('z', 1472, 1344, 1, -4, -4, 1), ('x', 2752, 3200, 0, -4, 4, 1), ('x', 2752, 3456, 1, -4, -4, 1),
                  ('x', 3264, 1920, 0, -4, 4, 1), ('x', 3264, 2048, 1, -4, -4, 0), ('x', 3072, 2240, 1, -4, -4, 0)],
         'spears': (0x9494, 16), 'spikeWall': (122, [22, 24, 27, 28, 29, 30], 0x380)},
}
DOOR_PUSH = {0: (0, 4), 2: (-4, 0), 4: (0, -4)}
BOSSES = {3: {'kind': 'gg', 'at': (1152, 350, 1152), 'home': (1088, 1088), 'cruise': 160, 'arena': (800, 1375, 800, 1375), 'hp': 5, 'script': 0xDFC6},
          8: {'kind': 'rr', 'at': (1856, 330, 2080), 'cruise': 160, 'cap': 350, 'arms': (1792, 1920), 'root': (136, 2080),
              'reach': (2144, 2190), 'script': 0x7170, 'home': (1856, 2080), 'arena': (1760, 1983, 2080, 2271), 'hp': 5,
              'pit': (((57, 65), (58, 65)), 0x830, 0x70)},
          17: {'kind': 'ss', 'at': (1796, 568, 2304), 'cruise': 168, 'hover': 200, 'low': 120, 'hang': 40, 'fists': ((38, 40), (-46, 40)),
               'corners': ((2237, 1560), (2045, 1752)), 'home': (1796, 2304), 'arena': (1496, 1896, 1981, 2398), 'hp': 8},
          11: {'kind': 'dd', 'at': (2052, 0x240 + 8, 2048), 'cruise': 0xB0 + 8, 'low': 0xB0 + 8, 'high': 0x100 + 8, 'dropY': 0xE0 + 8,
               'script': 0xF2FA, 'hitAt': 0x28, 'diag': 0xD8, 'sum': (0x1000 - 0x110, 0x1000 + 0x118), 'home': (2048, 2048),
               'arena': (0x740, 0x8C0, 0x740, 0x8C0), 'hp': 8},
          14: {'kind': 'vv', 'at': (0x800, 0x1E8 + 8, 0x800), 'cruise': 0x58 + 8, 'low': 0x58 + 8, 'hitBox': (0x7F0, 0x830, 0x7F0, 0x830), 'minY': 0x60 + 8,
               'rise': (0x834, 0x5C + 8, 0x830), 'spikes': ((63, 64), (65, 64), (64, 63), (64, 65)), 'home': (0x800, 0x800), 'arena': (0x740, 0x8C0, 0x740, 0x8C0), 'hp': 8,
          'lava': 0x40 + 8},
          18: {'kind': 'gng', 'at': (0xE04, 0x1D0 + 8, 0x240), 'cruise': 0x40 + 8, 'first': 0x40 + 8, 'high': 0x70 + 8, 'low': 0x20 + 8, 'belt': (0x1C8, 0x378),   # Gene Gadget 3
               'lanes': (0xDD0, 32), 'end': 0x380, 'loads': (456, 408, 360, 312, 264, 216), 'drops': (-7, -18), 'dropZ': 6, 'home': (0xE04, 0x240), 'arena': (0xDC0, 0xE40, 0x200, 0x3A0), 'hp': 8},
          21: {'kind': 'pp', 'at': (0x561, 0x390, 0x540), 'cruise': 0x200, 'home': (0x561, 0x540), 'arena': (0x520, 0x800, 0x500, 0x800), 'hp': 24,   # Panic Puppet 3 (see s3d.js)
               'stages': [
                   {'pod': (0x561, 0x540, 0x200, 0x180), 'hitY': 0x1F0, 'pad': (47, 41), 'lift': (0x5F0, 0x1E0, 0x530), 'to': (0x6F0, 0x2E0, 0x630),
                    'arms': [{'at': (0x590, 0x220, 0x590), 'rest': (0x570, 0x220, 0x5B0), 'zone': (0x590, 0x5B0), 'shoulder': (0x558, 0x208, 0x570), 'cell': (42, 43)},
                             {'at': (0x5B0, 0x220, 0x570), 'rest': (0x5D0, 0x220, 0x550), 'zone': (0x5D0, 0x570), 'shoulder': (0x590, 0x208, 0x538), 'cell': (44, 41)}],
                    'shots': [(0x550, 0x222, 0x570), (0x590, 0x222, 0x530)]},
                   {'pod': (0x661, 0x640, 0x1A0, 0xF0), 'hitY': 0x190, 'pad': (50, 54), 'lift': (0x650, 0x180, 0x6D0), 'to': (0x750, 0x280, 0x7D0),
                    'arms': [{'rest': (0x688, 0x1A0, 0x6A8), 'shoulder': (0x658, 0x1A8, 0x670), 'cell': (50, 51), 't': 0x190},
                             {'rest': (0x6C8, 0x1A0, 0x668), 'shoulder': (0x690, 0x1A8, 0x638), 'cell': (52, 49), 't': 0x2BC, 'phase': 0x400}]},
                   {'pod': (0x761, 0x740, 0x140, 0xC0), 'hitY': 0x130,
                    'arms': [{'rest': (0x788, 0x140, 0x7A8), 'shoulder': (0x758, 0x148, 0x770), 'cell': (58, 59), 't': 0x190},
                             {'rest': (0x7C8, 0x140, 0x768), 'shoulder': (0x790, 0x148, 0x738), 'cell': (60, 57), 't': 0x2BC, 'phase': 0x400}]}]},
          22: {'kind': 'ff', 'at': (0x940, 0x190, 0x800), 'cruise': 0x320, 'home': (0x940, 0x800), 'arena': (0x660, 0xA80, 0x5A0, 0x860), 'hp': 10,   # Final Fight (see s3d.js)
               'doors': ((0x379C, 0x379E), (0x3C9C, 0x3C9E), (0x3192, 0x3292), (0x3198, 0x3298), (0x317A, 0x327A), (0x3180, 0x3280),
                         (0x3772, 0x3774), (0x3C72, 0x3C74), (0x407C, 0x417C), (0x4094, 0x4194)), 'doorTop': 0x85}}
SCRIPTS = 0x25DF2


def ride_script(rom, state):
    """RunSonic's scripted moves (see s3d.js rideScript)."""
    u16 = lambda o: struct.unpack('>H', rom[o:o + 2])[0]
    s16 = lambda o: struct.unpack('>h', rom[o:o + 2])[0]
    base = SCRIPTS + s16(SCRIPTS + state - 2); sp = mo = left = 0; path, turns, end, starts = [], [], None, []
    while len(path) < 5000:
        left -= 1
        if left <= 0:
            a = base + sp; w0 = u16(a)
            if w0 == 0x8000:
                back = s16(a + 2)
                if back > 0: sp -= back; left = 0; continue
                if back < 0: end = [s16(a + 4 + 2 * i) for i in range(7)]
                break
            w1 = u16(a + 2); mo = w0; left = w1 & 0xFF; sp += 4; starts.append(len(path))
            if w1 & 0xFF00: turns.append([len(path), (w1 & 0xFF00) - 0x8000])
        if u16(SCRIPTS + mo) == 0x8000: mo -= s16(SCRIPTS + mo + 2)
        path.append([s16(SCRIPTS + mo), s16(SCRIPTS + mo + 2), s16(SCRIPTS + mo + 4)]); mo += 6
    return path, turns, end, starts


def compass_of(f):
    return (180 + f * 360 / 2048) % 360

def convert(rom, level_id, vscale=1.0):
    h = HEADERS + (level_id - 1) * HSIZE
    mp, start_tab = struct.unpack('>I', rom[h + 4:h + 8])[0], struct.unpack('>I', rom[h + 0x20:h + 0x24])[0]
    w = struct.unpack('>16384H', rnc.unpack(rom, mp)); w0 = w
    if GIMMICKS.get(level_id, {}).get('mapSet') or GIMMICKS.get(level_id, {}).get('mapClear'):   # (InitLevel's writes; see s3d.js)
        w = list(w)
        for cx, cz, v in GIMMICKS[level_id].get('mapSet', []): w[cz * 128 + cx] = v
        for i in range(GIMMICKS[level_id].get('mapClear', 0)): w[i] = 0
    used = [(i % 128, i // 128) for i, v in enumerate(w) if v]
    x0, x1 = min(u[0] for u in used) - 1, max(u[0] for u in used) + 1
    z0, z1 = min(u[1] for u in used) - 1, max(u[1] for u in used) + 1
    x0, z0 = max(0, x0), max(0, z0)
    x1, z1 = min(127, x1), min(127, z1)
    W, D = x1 - x0 + 1, z1 - z0 + 1
    unit = STEP / CELL * vscale          # metres per 8-unit step
    gm = GIMMICKS.get(level_id, {}); mps = 60 / CELL
    tiles = []
    for z in range(z0, z1 + 1):
        for x in range(x0, x1 + 1):
            v = w[z * 128 + x]
            if not v:
                tiles.append({"c": [0, 0, 0, 0], "t": "W"}); continue   # no floor: Sonic cannot enter (edgeprobe.py)
            hb = v >> 8
            cs = [(v >> 6) & 3, (v >> 4) & 3, (v >> 2) & 3, v & 3]
            spike = gm.get('spikes') is not None and (v & 0xFF) == gm['spikes']
            tile = {"c": [jround((hb + c) * unit, 4) for c in cs], "t": "H" if spike else "F"}
            s = (1 if rom[SPLIT + (v & 0xFF)] else 0) | (2 if (v & 0x55) == 0x55 else 0) | ((PIECES.index(v & 0xFF) + 1 if (v & 0xFF) in PIECES else 0) << 2)
            if s: tile["s"] = s
            tiles.append(tile)
    ents = []
    floor_cell = lambda cx, cz: 0 <= cx < 128 and 0 <= cz < 128 and w[cz * 128 + cx] != 0
    # objects: 52-byte records in the RNC block at header +0x00; type at +0x22, x/y/z at +6/+0xA/+0xE
    ob = rnc.unpack(rom, struct.unpack('>I', rom[h:h + 4])[0])
    st = struct.unpack('>I', rom[h + 0x20:h + 0x24])[0]
    table_rings = struct.unpack('>h', rom[st + 0x12:st + 0x14])[0] >= 0
    holes = []; balls = [0]
    start = None
    k = 0
    while (k + 1) * 0x34 <= len(ob):
        r = ob[k * 0x34:(k + 1) * 0x34]; k += 1
        t, hnd = struct.unpack('>H', r[0x22:0x24])[0], struct.unpack('>I', r[0x30:0x34])[0]
        if not (hnd < 0x400000 and t < 0x400): break
        if not hnd: continue
        x, z = struct.unpack('>h', r[6:8])[0], struct.unpack('>h', r[0xE:0x10])[0]
        if t in (0x1C, 0x90, 0xCC, 0x110):
            mode = struct.unpack('>H', r[0x24:0x26])[0]
            if mode: holes.append((x, z, mode))
            continue
        kind = KINDS.get(t)
        if kind == 'goal' and table_rings: continue
        if not kind or (not floor_cell(x // CELL, z // CELL) and kind != 'lever' and t != 0x184): continue   # (levers, door: in walls)
        if kind == 'start': start = (x / CELL, z / CELL); continue
        e = {"type": kind, "x": jround(x / CELL - x0, 3), "z": jround(z / CELL - z0, 3)}
        if kind == 'enemy':
            e["radius"] = 0 if t == 0x0C else 1.0
            if t == 0x58: e["burst"] = 1   # bursts into four shots (see s3d.js)
            if t == 0x0C:   # spike ball: circle radius 23.5 units (measured), about 20 units up (estimated)
                e["orbit"] = jround(23.5 / CELL, 3); e["orbitY"] = jround(20 / CELL * vscale, 3)
        if kind == 'monitor':
            k2 = struct.unpack('>H', r[0x26:0x28])[0] >> 7
            e["kind"] = MONITOR_KINDS[k2] if k2 < len(MONITOR_KINDS) else 'rings'
        if kind == 'booster':   # routine 0xCA6A: +0x26 set and bit 3 of +0x16 pick the way; taken one cell that way
            b3 = (r[0x16] >> 3) & 1; w26 = struct.unpack('>H', r[0x26:0x28])[0] != 0
            e["dir"] = ([1, 0] if b3 else [0, 1]) if w26 else ([-1, 0] if b3 else [0, -1])
            e["x"] = jround((x + e["dir"][0] * CELL) / CELL - x0, 3); e["z"] = jround((z + e["dir"][1] * CELL) / CELL - z0, 3)
        if kind == 'balloon':
            e["y"] = jround((struct.unpack('>h', r[0x26:0x28])[0] + 8) / CELL * vscale, 3); e["phase"] = struct.unpack('>H', r[0x24:0x26])[0] & 0x7FE
            e["rise"] = launch_for(vscale, 43)
        if kind == 'spring': e["power"] = spring_power(vscale)
        y_obj = struct.unpack('>h', r[0xA:0xC])[0]
        if t == 0x8C: e["power"] = launch_for(vscale, 94); e["absY"] = jround(y_obj / CELL * vscale, 3)
        if kind == 'lift': e["y"] = jround(y_obj / CELL * vscale, 3); e["drop"] = jround(84 / CELL * vscale, 3)
        if kind == 'enemy' and t in PATROL:   # to and fro between +0x24 and +0x26 (see s3d.js)
            a, b = struct.unpack('>hh', r[0x24:0x28]); along_x = bool((r[0x16] >> 3) & 1)
            if b > a:
                e["patrol"] = {"axis": 'x' if along_x else 'z', "range": [jround(a / CELL - x0, 3), jround(b / CELL - x0, 3)] if along_x else [jround(a / CELL - z0, 3), jround(b / CELL - z0, 3)],
                               "dir": -1 if struct.unpack('>H', r[0x28:0x2A])[0] else 1}
                e["speed"] = jround(30 / CELL, 3)
        if kind in ('enemy', 'capsule', 'lever', 'beamPost'):   # Flicky colour byte +0x19 (1..4), palette line bits 13-14 of +0x16
            if kind in ('enemy', 'capsule'): fb = r[0x19]; e["flicky"] = fb if 1 <= fb <= 4 else 0
            ln = (r[0x16] >> 5) & 3
            if ln != 3: e["line"] = ln
        if t == 0x178: e["shoot"] = (struct.unpack('>H', r[0x2A:0x2C])[0] // 12) & 3
        if t in WANDER:   # wanders in the 64-unit square from +0x28, +0x2A (see s3d.js)
            wx, wz = struct.unpack('>hh', r[0x28:0x2C]); e["wander"] = [jround(wx / CELL - x0, 3), jround(wz / CELL - z0, 3), 2]; e["speed"] = jround(30 / CELL, 3)
        if t in ROAM:   # roams its 0x7C square from +0x28, +0x2A & 0x7FFF, chasing once near (see s3d.js)
            rx, rz = struct.unpack('>hH', r[0x28:0x2C]); e["roam"] = {"box": [rx, rz & 0x7FFF], "a": struct.unpack('>H', r[0x24:0x26])[0] & (0x7F0 if t == 4 else 0x7FE)}
            if t == 4: e["roam"].update({"size": 0xA0, "free": 1})   # 004 (0x18F9A): a 0xA0 square, not held in it
        if t == 0x64: e["aim"] = {"a": struct.unpack('>H', r[0x24:0x26])[0] & 0x7FE}
        if kind == 'beamPost':
            e["y"] = jround((struct.unpack('>h', r[0xA:0xC])[0] - 8) / CELL * vscale, 3); e["dir"] = [1, 0] if (r[0x16] >> 3) & 1 else [0, 1]
            e["phase"] = (struct.unpack('>H', r[0x1E:0x20])[0] >> 1) % 24
        y_c = struct.unpack('>h', r[0xA:0xC])[0]
        if kind == 'capsule': e["y"] = jround((y_c + 8) / CELL * vscale, 3); e["top"] = jround((y_c + 40) / CELL * vscale, 3); e["half"] = jround(15 / CELL, 3)
        if kind == 'lever':
            best = 4
            for cx, cz, reg, _v in gm.get('switches', []):
                dd = math.hypot(cx + 0.5 - x / CELL, cz + 0.5 - z / CELL)
                if dd < best: best = dd; e["reg"] = reg
            if not e.get("reg"): continue
            e["y"] = jround((y_c + 8) / CELL * vscale, 3)
        if kind == 'jetLift':
            flip = (r[0x16] >> 3) & 1; sx, sz = (31, 31) if t == 0x18C else (48, 32) if flip else (32, 48)
            del e["x"], e["z"]
            a, b = struct.unpack('>hh', r[0x24:0x28])
            e.update({"x0": jround((x - 1) / CELL - x0, 3), "x1": jround((x - 1 + sx) / CELL - x0, 3), "z0": jround((z - 1) / CELL - z0, 3), "z1": jround((z - 1 + sz) / CELL - z0, 3),
                      "y0": jround((a + 8) / CELL * vscale, 3), "y1": jround((b + 8) / CELL * vscale, 3)})
        if kind == 'fireSpot':
            e["y"] = jround((y_obj + 8) / CELL * vscale, 3)
            if r[4]: e["touch"] = [r[4], r[5]]
        if kind == 'head':   # see s3d.js
            c = struct.unpack('>H', r[0x24:0x26])[0]
            e["y"] = jround((y_obj + 8) / CELL * vscale, 3); e["cell"] = [((c & 0xFF) >> 1) - x0, (c >> 8) - z0]
        if kind == 'friend':   # see s3d.js
            e["who"] = 'tails' if t == 0x15C else 'knuckles'; e["y"] = jround((y_obj + 8) / CELL * vscale, 3)
            sh = gm.get('friends', {}).get(e["who"])
            if sh:
                if 'section' in sh: e["show"] = {"section": sh['section']}
                else:
                    sk = 'cannon' if 'cannon' in sh else 'cell'; c = sh[sk]
                    e["show"] = {sk: [c[0] - x0, c[1] - z0]}
                    if 'maxY' in sh: e["show"]["maxY"] = jround((sh['maxY'] + 8) / CELL * vscale, 3)
        if kind == 'prop':
            e["y"] = jround((y_obj + 8) / CELL * vscale, 3); e["frame"] = PROP_FRAME.get(t, 0)
            if t == 0x184:
                for cells, _hb, _ring, _pss, *ky in gm.get('gates', []):
                    if ky and ky[0] and any(math.hypot(cx + 0.5 - x / CELL, cz + 0.5 - z / CELL) < 2 for cx, cz in cells): e["key"] = ky[0]
        if kind == 'sprinkler': e["y"] = jround((y_obj + 8) / CELL * vscale, 3); e["phase"] = struct.unpack('>H', r[0x24:0x26])[0] & 0x7FE
        if kind in ('enemy', 'sprinkler'):   # its screen window: the type's art header (table 0x280E8) and the record's y (see s3d.js)
            art = struct.unpack('>I', rom[0x280E8 + t:0x280EC + t])[0]
            if 0 < art and art + 8 <= len(rom): e["win"] = list(struct.unpack('>HHhh', rom[art:art + 8])) + [y_obj]
        if (kind == 'enemy' or kind == 'sprinkler' or kind == 'spikeBall' and 'balls' in gm) and r[4]: e["touch"] = [r[4], r[5]]   # touch bytes (see s3d.js)
        if kind == 'enemy':
            fx, fz = struct.unpack('>H', r[8:10])[0], struct.unpack('>H', r[0x10:0x12])[0]
            if fx or fz: e["fr"] = [fx, fz]
        if t == 0xC8:   # its animation table (see s3d.js)
            tab = []; a = 0x16C7E
            while len(tab) < 1024:
                v = struct.unpack('>h', rom[a:a + 2])[0]; tab.append(v); a += 2
                if v < 0: tab.append(struct.unpack('>h', rom[a:a + 2])[0]); break
            e["c8"] = {"i": struct.unpack('>H', r[0x1E:0x20])[0], "r": [r[0x20], r[0x21]], "t": tab}
        if kind == 'pylon':   # the barrier whose zap cells are nearest turns it off
            e["y"] = jround((y_obj + 8) / CELL * vscale, 3); best = 4
            for _w, _h, zap, _half, ring, _a in gm.get('barriers', []):
                for zx, zz in zap:
                    dd = math.hypot(zx + 0.5 - x / CELL, zz + 0.5 - z / CELL)
                    if dd < best: best = dd; e["opens"] = ring
            if not e.get("opens"): continue
        if t == 0x78:   # Gene Gadget's platforms (see s3d.js)
            if struct.unpack('>h', r[0x2C:0x2E])[0] < 0: continue
            along_x = (r[0x16] >> 3) & 1; long_ = struct.unpack('>H', r[0x2A:0x2C])[0] != 0
            sx = 64 if along_x and long_ else 32; sz = 64 if (not along_x) and long_ else 32
            a, b = struct.unpack('>hh', r[0x24:0x28]); org = x0 if along_x else z0
            del e["x"], e["z"]
            e.update({"x0": jround((x - 1) / CELL - x0, 3), "x1": jround((x - 1 + sx) / CELL - x0, 3), "z0": jround((z - 1) / CELL - z0, 3), "z1": jround((z - 1 + sz) / CELL - z0, 3),
                      "y": jround((y_obj + 8) / CELL * vscale, 3), "axis": 'x' if along_x else 'z',
                      "lin": {"a": jround((a - 1) / CELL - org, 3), "b": jround((b - 1) / CELL - org, 3), "v": jround(mps, 3), "wait": 1, "dir": -1 if r[0x28] else 1, "t": jround(r[0x29] / 60, 3)}})
        elif kind == 'movePlat':
            if struct.unpack('>H', r[0x24:0x26])[0]: continue   # (the sinking kind: in no level's records)
            along_z = (r[0x16] >> 3) & 1; sx, sz = (48, 32) if along_z else (32, 48); T = math.pi / 1024
            e.update({"x0": jround((x - 1) / CELL - x0, 3), "x1": jround((x - 1 + sx) / CELL - x0, 3), "z0": jround((z - 1) / CELL - z0, 3), "z1": jround((z - 1 + sz) / CELL - z0, 3),
                      "y": jround((y_obj + 8) / CELL * vscale, 3), "axis": 'z' if along_z else 'x', "centre": jround(struct.unpack('>h', r[0x28:0x2A])[0] / CELL - (z0 if along_z else x0), 3),
                      "amp": jround(63 / CELL, 3), "w": jround(4 * T * 1e4, 3) / 1e4, "phase": jround((struct.unpack('>H', r[0x26:0x28])[0] & 0x7FE) * T * 1e4, 3) / 1e4})
        if kind == 'spikeBall':
            if 'balls' not in gm: continue
            mid, amp, step, gx, gz = gm['balls']; T = math.pi / 1024; kb = balls[0]; balls[0] += 1
            e.update({"y": jround((y_obj + 8) / CELL * vscale, 3), "axis": 'z', "centre": jround(mid / CELL - z0, 3), "amp": jround(amp / CELL, 3), "w": jround(step * T * 1e4, 3) / 1e4,
                      "phase": jround(math.pi * 1e4, 3) / 1e4 if kb % 2 else 0})
            e["gate"] = [jround(gx / CELL - x0, 3), jround(gz / CELL - z0, 3)]
        if kind == 'crawler':   # spiked crawler: 1 unit a frame between +0x24 and +0x26, along x if that holds x
            a, b = struct.unpack('>hh', r[0x24:0x28]); along_x = a <= x <= b
            e["y"] = jround((y_obj + 8) / CELL * vscale, 3); e["axis"] = 'x' if along_x else 'z'
            e["range"] = [jround(a / CELL - x0, 3), jround(b / CELL - x0, 3)] if along_x else [jround(a / CELL - z0, 3), jround(b / CELL - z0, 3)]
        if kind != 'goal': e["skin"] = f'{t:03X}'
        ents.append(e)
    # gimmicks run by the act's own routine (see s3d.js GIMMICKS)
    for cx, cz, mouth, up, south in gm.get('cannons', []):
        if floor_cell(cx, cz):
            ents.append({"type": "cannon", "x": cx - x0, "z": cz - z0, "y": jround(mouth / CELL * vscale, 3), "h": jround(12 / CELL * vscale, 3),
                         "vy": jround(up * mps * vscale, 3), "vz": jround(south * mps, 3)})
    for cells, top, dr in gm.get('cracks', []):
        if all(floor_cell(c[0], c[1]) for c in cells):
            ents.append({"type": "crack", "cells": [[c[0] - x0, c[1] - z0] + ([jround(c[2] / CELL * vscale, 3)] if len(c) > 2 else []) for c in cells],
                         "top": jround(top / CELL * vscale, 3), "dir": dr})
    hb = lambda v: jround(v * STEP / CELL * vscale, 3)
    if 'pillars' in gm:
        o, n = gm['pillars']
        for k in range(n):
            c = struct.unpack('>H', rom[o + 14 * k + 10:o + 14 * k + 12])[0] >> 1
            cx, cz = c % 128, c // 128
            if not floor_cell(cx, cz): continue
            link = next((q for q in gm.get('pillarLinks', []) if q[0] == cx and q[1] == cz), None)
            cells = [[cx - x0, cz - z0]]
            if link:
                cells[0] += [hb(rom[o + 14 * k + 12]), hb(link[2])]
                for lx, lz, top in link[3]: cells.append([lx - x0, lz - z0, hb(top), None, 1])
            ents.append({"type": "crack", "by": "whirl", "cells": cells, "top": hb(rom[o + 14 * k + 12])})
    for mark, dr, *zm in gm.get('slides', []):   # (zMin, skipX: see s3d.js)
        skip = zm[1] if len(zm) > 1 else []
        cells = [[x - x0, z - z0] for z in range(max(z0, zm[0] if zm else 0), z1 + 1) for x in range(x0, x1 + 1) if w[z * 128 + x] and (w[z * 128 + x] & 0xFF) == mark and x not in skip]
        if cells: ents.append({"type": "slide", "cells": cells, "dir": dr})
    if 'fans' in gm:
        cells = [[x - x0, z - z0] for z in range(z0, z1 + 1) for x in range(x0, x1 + 1) if w[z * 128 + x] and (w[z * 128 + x] & 0xFF) == gm['fans']]
        if cells: ents.append({"type": "fan", "cells": cells})
    if 'maces' in gm:   # (see s3d.js: all of them, the shared records and angle)
        o, n, slot2 = gm['maces']
        for k in range(n):
            wx, wy, x, y, z, turn, second = struct.unpack('>7h', rom[o + 14 * k:o + 14 * k + 14])
            ents.append({"type": "mace", "x": jround(x / CELL - x0, 3), "z": jround(z / CELL - z0, 3), "y": jround(y / CELL * vscale, 3), "r": jround(64 / CELL, 3),
                         "link": jround(16 / CELL, 3), "w": jround(turn * math.pi * 2 / 2048 * 60, 6), "balls": [0, jround(second * math.pi * 2 / 2048, 6)] if second else [0],
                         "win": [wx, wy], "turn": turn, "second": second})
        recs = []
        for base in (9, slot2):
            for k in range(4):
                q = (base + k) * 0x34; rx, ry, rz = struct.unpack('>h', ob[q + 6:q + 8])[0], struct.unpack('>h', ob[q + 0xA:q + 0xC])[0], struct.unpack('>h', ob[q + 0xE:q + 0x10])[0]
                recs.append([rx, ry, rz, ob[q + 4], ob[q + 5]])
        ents.append({"type": "maceRecs", "a": struct.unpack('>H', ob[9 * 0x34 + 0x24:9 * 0x34 + 0x26])[0] & 0x7FE, "recs": recs})
    if 'flames' in gm:
        o, n = gm['flames']
        for k in range(n):
            x, z, y = struct.unpack('>3h', rom[o + 8 * k:o + 8 * k + 6]); fl = struct.unpack('>H', rom[o + 8 * k + 6:o + 8 * k + 8])[0]
            if not floor_cell(x // CELL, z // CELL): continue
            e = {"type": "flame", "x": jround(x / CELL - x0, 3), "z": jround(z / CELL - z0, 3), "y": jround(y / CELL * vscale, 3), "dir": [0, 1] if fl & 0x800 else [1, 0]}
            if gm.get('freeze'): e["freeze"] = 1
            ents.append(e)
    if 'doors' in gm:
        o, n = gm['doors']
        for k in range(n):
            r = rom[o + 28 * k:o + 28 * k + 28]
            c = struct.unpack('>H', r[0:2])[0] >> 1
            cx, cz = c % 128, c // 128
            x, y, z, dr = struct.unpack('>h', r[2:4])[0], struct.unpack('>h', r[6:8])[0], struct.unpack('>h', r[10:12])[0], struct.unpack('>H', r[22:24])[0]
            vx, vz = DOOR_PUSH.get(dr, (4, 0))
            if floor_cell(cx, cz) and floor_cell(x // CELL, z // CELL):
                ents.append({"type": "hole", "x": cx + 0.5 - x0, "z": cz + 0.5 - z0, "size": 0.5, "opens": 0, "exit": [jround(x / CELL - x0, 3), jround(z / CELL - z0, 3)],
                             "exitY": jround(y / CELL * vscale, 3), "push": [jround(vx * mps, 3), jround(vz * mps, 3)], "launch": 0})
    r3, r6 = (lambda v: jround(v, 3)), (lambda v: jround(v, 6))
    def ride_of(state, frm, facing, vel, want_starts=False):   # bit 15 of the state: x and z swapped; no velocity: the last step carries on
        path, turns, end, starts = ride_script(rom, state & 0x7FFF); mir = bool(state & 0x8000)
        if mir: path = [[-c, b, -a] for a, b, c in path]
        last = path[-1] if path else [0, 0, 0]
        return ({"start": [r3(frm[0] / CELL - x0), r3(frm[1] / CELL * vscale), r3(frm[2] / CELL - z0)] if frm else None,
                 "facing": None if facing is None else compass_of(facing),
                 "vel": [r6(vel[0] * mps), r6(vel[1] * mps * vscale), r6(vel[2] * mps)] if vel else [r3(last[0] * mps), 0, r3(last[2] * mps)],
                 "path": [[r6(dx / CELL), r6(dy / CELL * vscale), r6(dz / CELL)] for dx, dy, dz in path],
                 "turns": [[i, compass_of((0x200 - f) & 0x7FF if mir else f)] for i, f in turns], **({} if vel else {"keep": 1})}, end) if not want_starts else starts
    for cx, cz, after, state, frm, facing, vel, *rest in gm.get('rides', []):
        if floor_cell(cx, cz) and (frm is None or floor_cell(frm[0] // CELL, frm[2] // CELL)):
            ride, end = ride_of(state, frm, facing, vel)
            ride["end"] = {"at": [r3(end[0] / CELL - x0), r3((end[1] + 8) / CELL * vscale), r3(end[2] / CELL - z0)], "facing": compass_of(end[3]),
                           "vel": [r3(end[4] * mps), r3(-end[5] * mps * vscale), r3(end[6] * mps)]} if end else None
            if len(rest) > 3 and rest[3] is not None: ride["anim"] = rest[3]   # the animation the routine sets
            if len(rest) > 1 and rest[1]:
                ride["force"] = {"t": r3(rest[1][0] / 60), "dir": rest[1][1]}
                if len(rest[1]) > 2 and rest[1][2]: ride["force"]["roll"] = 1
                if len(rest[1]) > 3 and rest[1][3]: ride["force"]["pass"] = 1
            e = {"type": "hole", "x": cx + 0.5 - x0, "z": cz + 0.5 - z0, "size": 0.5, "opens": after, "air": True, "ride": ride}
            if rest and rest[0] is not None: e["maxY"] = r3(rest[0] / CELL * vscale)
            if len(rest) > 2 and rest[2]: e["run"] = 1
            ents.append(e)
    for cx, cz, frames in gm.get('holds', []):
        if floor_cell(cx, cz): ents.append({"type": "hold", "x": cx + 0.5 - x0, "z": cz + 0.5 - z0, "t": r3(frames / 60)})
    if 'tubes' in gm:   # two mouths (see s3d.js)
        tab, sa, sb = gm['tubes']; wv = lambda k: struct.unpack('>h', rom[tab + 2 * k:tab + 2 * k + 2])[0]
        for bx0, bx1, bz0, bz1, at, state in ((wv(0), wv(0) + 32, wv(1), wv(1) + 8, (wv(2), wv(3), wv(4)), sa), (wv(6), wv(6) + 8, wv(5), wv(5) + 32, (wv(7), wv(8), wv(9)), sb)):
            if not floor_cell(int((bx0 + bx1) / 2 // CELL), int((bz0 + bz1) / 2 // CELL)): continue
            ride, _ = ride_of(state, at, None, None); ride["end"] = None; ride["wait"] = r3(30 / 60)
            ents.append({"type": "hole", "x": r3((bx0 + bx1) / 2 / CELL - x0), "z": r3((bz0 + bz1) / 2 / CELL - z0),
                         "half": [r3((bx1 - bx0) / 2 / CELL), r3((bz1 - bz0) / 2 / CELL)], "opens": 0, "ride": ride})
    cells_of = lambda mark: [[x - x0, z - z0] for z in range(z0, z1 + 1) for x in range(x0, x1 + 1) if w[z * 128 + x] and (w[z * 128 + x] & 0xFF) == mark]
    if 'floorSprings' in gm:
        cells = cells_of(gm['floorSprings'])
        if cells: ents.append({"type": "springCells", "cells": cells, "power": launch_for(vscale, 124), "set": r6(7.875 * mps * vscale)})
    if 'bumpers' in gm:
        mark, tab, n = gm['bumpers']; cells = cells_of(mark)
        for k in range(n):
            off = abs(struct.unpack('>h', rom[tab + 2 * k:tab + 2 * k + 2])[0]) >> 1; cx, cz = off & 127, off >> 7
            if x0 <= cx <= x1 and z0 <= cz <= z1 and w[cz * 128 + cx] and [cx - x0, cz - z0] not in cells: cells.append([cx - x0, cz - z0])
        if cells: ents.append({"type": "bumpers", "cells": cells})
    if 'spikeField' in gm:
        cells = cells_of(gm['spikeField'])
        if cells: ents.append({"type": "spikeField", "cells": cells})
    box = lambda a, b, c, e: [a - x0, b - x0 + 1, c - z0, e - z0 + 1]   # Diamond Dust (see s3d.js)
    for ax, bx, az, bz, dr, acc, cx, *th in gm.get('chutes', []):
        e = {"type": "chute", "box": box(ax, bx, az, bz), "dir": dr, "accel": r3(acc * 3600 / CELL), "steer": r3(cx / CELL - x0)}
        if th: e["top"] = r3(th[0] * mps); e["hold"] = r3(th[1] / 60)
        ents.append(e)
    for cx, cz, max_y, v, n, at, jv in gm.get('dashes', []):
        if floor_cell(cx, cz):
            ents.append({"type": "dash", "x": cx + 0.5 - x0, "z": cz + 0.5 - z0, "maxY": r3((max_y + 8) / CELL * vscale), "v": [r3(v[0] * mps), r3(v[1] * mps)],
                         "t": r3(n / 60), "jumpAt": r3(at / 60), "jumpV": r3(jv * mps * vscale)})
    for ax, bx, az, bz, at, dr, acc, n in gm.get('sleds', []):
        ents.append({"type": "sled", "box": box(ax, bx, az, bz), "at": [r3(at[0] / CELL - x0), r3(at[1] / CELL * vscale), r3(at[2] / CELL - z0)], "dir": dr,
                     "accel": r3(acc * 3600 / CELL), "t": r3(n / 60)})
    for ax, bx, az, bz, dr, acc, top_v, leave in gm.get('currents', []):
        ents.append({"type": "current", "box": box(ax, bx, az, bz), "dir": dr, "accel": r3(acc * 3600 / CELL), "top": r3(top_v * mps), "leave": r3(leave * mps)})
    if 'hops' in gm:
        cells = [[cx - x0, cz - z0] for cx, cz in gm['hops'][0] if floor_cell(cx, cz)]
        if cells: ents.append({"type": "springCells", "cells": cells, "power": launch_for(vscale, gm['hops'][1])})
    if 'ice' in gm:   # ice on/off cell lists (see s3d.js)
        a, na, b, nb, more_on, more_off = gm['ice']
        cl = lambda o, n, more: [[c % 128 - x0, c // 128 - z0] for c in [struct.unpack('>H', rom[o + 2 * k:o + 2 * k + 2])[0] >> 1 for k in range(n)] + [cz * 128 + cx for cx, cz in more] if floor_cell(c % 128, c // 128)]
        ents.append({"type": "ice", "on": cl(a, na, more_on), "off": cl(b, nb, more_off)})
    if 'iceSpikes' in gm:
        o, n = gm['iceSpikes']
        cells = [[c % 128 - x0, c // 128 - z0] for c in [struct.unpack('>H', rom[o + 12 * k + 10:o + 12 * k + 12])[0] >> 1 for k in range(n)] if floor_cell(c % 128, c // 128)]
        if cells: ents.append({"type": "iceSpikes", "cells": cells})
    if 'roofs' in gm:
        o = gm['roofs']
        while struct.unpack('>h', rom[o:o + 2])[0] >= 0:
            c1, c2, ymax = struct.unpack('>3H', rom[o:o + 6]); o += 6
            cells = [[c % 128 - x0, c // 128 - z0] for c in (c1 >> 1, c2 >> 1) if floor_cell(c % 128, c // 128)]
            if cells: ents.append({"type": "lowRoof", "cells": cells, "top": jround((ymax + 8) / CELL * vscale, 3)})
    if 'lava' in gm:
        cells = cells_of(gm['lava'])
        if cells: ents.append({"type": "lava", "cells": cells})
    if 'rocks' in gm:
        o, n = gm['rocks']; cells = []
        for k in range(n):
            c = struct.unpack('>H', rom[o + 12 * k + 10:o + 12 * k + 12])[0] >> 1; cx, cz = c % 128, c // 128; v = w[c]
            if not floor_cell(cx, cz) or any(q[0] == cx - x0 and q[1] == cz - z0 for q in cells): continue
            top = (v >> 8) * 8 + max((v >> 6) & 3, (v >> 4) & 3, (v >> 2) & 3, v & 3) * 8 + 16
            cells.append([cx - x0, cz - z0, r3(top / CELL * vscale)])
        if cells: ents.append({"type": "rocks", "cells": cells})
    s16 = lambda o: struct.unpack('>h', rom[o:o + 2])[0]
    if 'spouts' in gm:
        o0, n = gm['spouts']
        for k in range(n):
            o = o0 + 16 * k; x, z, y = s16(o), s16(o + 2), s16(o + 4); V = lambda i: s16(o + 6 + 2 * i) * 16 / 65536
            if not floor_cell(x // CELL, z // CELL): continue
            ents.append({"type": "spout", "x": r3(x / CELL - x0), "y": r3((y + 8) / CELL * vscale), "z": r3(z / CELL - z0), "v": [r3(V(0) * mps), r3(-V(1) * mps * vscale), r3(V(2) * mps)],
                         "phase": s16(o + 12) & 255, "window": s16(o + 14)})
    if 'fireRuns' in gm:
        o0, n = gm['fireRuns']
        for k in range(n):
            o = o0 + 0x28 * k; bx, bw, bz, bh = s16(o), s16(o + 2), s16(o + 4), s16(o + 6); shots = []
            for j in range(4):
                q = o + 8 + 8 * j; x = s16(q)
                if x: shots.append([r3(x / CELL - x0), r3((s16(q + 2) + 8) / CELL * vscale), r3(s16(q + 4) / CELL - z0), 'z' if struct.unpack('>H', rom[q + 6:q + 8])[0] & 0x800 else 'x', j])
            if shots: ents.append({"type": "fireRun", "box": [r3(bx / CELL - x0), r3((bx + bw) / CELL - x0), r3(bz / CELL - z0), r3((bz + bh) / CELL - z0)], "shots": shots})
    if 'fireBars' in gm:   # fire bars (helper 0xBA68; see s3d.js)
        o0, n = gm['fireBars']
        for k in range(n):
            o = o0 + 14 * k; x, y, z = s16(o + 8), s16(o + 10), s16(o + 12)
            if floor_cell(x // CELL, z // CELL): ents.append({"type": "fireBar", "x": r3(x / CELL - x0), "y": r3((y + 8) / CELL * vscale), "z": r3(z / CELL - z0), "box": [struct.unpack('>H', rom[o + 2 * i:o + 2 * i + 2])[0] for i in range(4)]})
    if 'vents' in gm:
        o0, n = gm['vents']
        for k in range(n):
            o = o0 + 30 * k; c = struct.unpack('>H', rom[o:o + 2])[0] >> 1; cx, cz = c % 128, c // 128
            tx, ty, tz = struct.unpack('>h', rom[o + 2:o + 4])[0], struct.unpack('>h', rom[o + 6:o + 8])[0], struct.unpack('>h', rom[o + 10:o + 12])[0]
            if not floor_cell(cx, cz) or not floor_cell(tx // CELL, tz // CELL): continue
            ents.append({"type": "vent", "x": cx + 0.5 - x0, "z": cz + 0.5 - z0, "to": [r3(tx / CELL - x0), r3((ty + 8) / CELL * vscale), r3(tz / CELL - z0)],
                         "vel": [r3(-2 * mps), r3(8.5 * mps * vscale), r3(-2 * mps)]})
            off = next((q for q in gm.get('ventOff', []) if q[0] == c << 1), None)
            if off: ents[-1]["offWhileRock"] = [(off[1] >> 1) % 128 - x0, (off[1] >> 8) - z0]
    if 'tris' in gm:   # triangle bumpers (see s3d.js)
        ents.append({"type": "triBumpers", "list": [{"band": band, "b": r3(b / CELL - (x0 if band == 'x' else z0)), "s": r3(sd / CELL - (z0 if band == 'x' else x0)),
                                                       "flip": bool(flip), "v": [r3(vx * mps), r3(vz * mps)], "along": bool(along)} for band, b, sd, flip, vx, vz, along in gm['tris']]})
    if 'spears' in gm:
        cells = []
        for k in range(gm['spears'][1]):
            off = struct.unpack('>H', rom[gm['spears'][0] + 2 * k:gm['spears'][0] + 2 * k + 2])[0] >> 1; cx, cz = off & 127, off >> 7
            if floor_cell(cx, cz): cells.append([cx - x0, cz - z0])
        if cells: ents.append({"type": "spears", "cells": cells})
    if 'spikeWall' in gm:
        cx, zs, top_y = gm['spikeWall']
        ents.append({"type": "spikeWall", "cells": [[cx - x0, cz - z0] for cz in zs if floor_cell(cx, cz)], "side": 'w', "top": r3((top_y + 8) / CELL * vscale)})
    # Gene Gadget (see s3d.js GIMMICKS[4])
    if 'updrafts' in gm:
        cells = cells_of(gm['updrafts'])
        if cells: ents.append({"type": "updraft", "cells": cells})
    if 'zapCells' in gm:
        cells = cells_of(gm['zapCells'])
        if cells: ents.append({"type": "zapCells", "cells": cells})
    if 'pyramids' in gm:
        boxes = []
        for k2 in range(gm['pyramids'][1]):
            bx, bz = struct.unpack('>hh', rom[gm['pyramids'][0] + 4 * k2:gm['pyramids'][0] + 4 * k2 + 4])
            if floor_cell((bx + 32) // CELL, (bz + 32) // CELL): boxes.append([r3(bx / CELL - x0), r3(bz / CELL - z0)])
        if boxes: ents.append({"type": "pyramids", "boxes": boxes})
    gate_top = lambda hb: r3(hb * STEP / CELL * vscale)
    for wall, hb, zap, half, ring, away in gm.get('barriers', []):
        wc = [[cx - x0, cz - z0] for cx, cz in wall if floor_cell(cx, cz)]; zc = [[cx - x0, cz - z0] for cx, cz in zap if floor_cell(cx, cz)]
        if wc: ents.append({"type": "gate", "cells": wc, "top": gate_top(hb), "opens": ring})
        if zc: ents.append({"type": "barrier", "cells": zc, "half": half, "away": list(away), "opens": ring})
    for flag in (1, 2):   # cells that end a supercharger's run (flag 1) or a sled's (2): its gates shut again (see s3d.js)
        pc = [[q[0] - x0, q[1] - z0] for q in gm.get('passOff', []) if (q[2] if len(q) > 2 else 1) == flag and floor_cell(q[0], q[1])]
        if pc:
            e = {"type": "passOff", "cells": pc}
            if flag > 1: e["flag"] = flag
            ents.append(e)
    for cells, hb, ring, pss, *ky in gm.get('gates', []):
        gc = [[cx - x0, cz - z0] for cx, cz in cells if floor_cell(cx, cz)]
        if gc:
            g = {"type": "gate", "cells": gc, "top": gate_top(hb), "opens": ring}
            if pss: g["pass"] = pss
            if ky and ky[0]: g["key"] = ky[0]
            ents.append(g)
    for cx, cz, key, *regs in gm.get('keyOff', []):
        if floor_cell(cx, cz):
            e = {"type": "keyOff", "x": cx - x0, "z": cz - z0, "key": key}
            if regs: e["regs"] = regs[0]
            ents.append(e)
    if 'switches' in gm:   # switch cells and carriers (Panic Puppet 1; see s3d.js)
        cells = [[cx - x0, cz - z0, reg, v] for cx, cz, reg, v in gm['switches'] if floor_cell(cx, cz)]
        if cells: ents.append({"type": "switchCells", "cells": cells})
    if gm.get('warps'):   # a pair of warp holes (see s3d.js)
        (ax, az, *ae), (bx, bz, *be) = gm['warps']
        if floor_cell(ax, az) and floor_cell(bx, bz):
            Y = lambda v: r3((v + 8) / CELL * vscale)
            ents.append({"type": "warpHole", "cells": [[ax - x0, az - z0], [bx - x0, bz - z0]],
                         "exits": [[r3(q[0] / CELL - x0), Y(q[1]), r3(q[2] / CELL - z0)] for q in (ae, be)], "below": [Y(ae[3]), Y(be[3])],
                         "out": [r3(-2 * mps), r3(8.5 * mps * vscale), r3(-2 * mps)]})
    for ax, bx, az, bz, y, lz, lo, hi, hide, launch, *aw in gm.get('carriers', []):
        axis = aw[0] if aw else 'x'; way = aw[1] if len(aw) > 1 else gm['carryWay']
        A, B = (z0, x0) if axis == 'z' else (x0, z0)
        e = {"type": "carrier", "box": [r3(ax / CELL - x0), r3((bx + 1) / CELL - x0), r3(az / CELL - z0), r3((bz + 1) / CELL - z0)], "y": None if y is None else r3((y + 8) / CELL * vscale),
             "line": r3(lz / CELL - B), "lo": None if lo is None else r3(lo / CELL - A), "hi": r3(hi / CELL - A), "v": r3(mps), "way": way}
        if axis == 'z': e["axis"] = 'z'
        if hide: e["hide"] = [r3(hide[0] / CELL - A), r3(hide[1] / CELL - A)]
        if launch:
            state, vel, at, facing, frames, key = launch
            rd, _end = ride_of(state, None, None, vel)
            rd["end"] = {"at": [r3(at[0] / CELL - x0), r3((at[1] + 8) / CELL * vscale), r3(at[2] / CELL - z0)], "facing": compass_of(facing), "vel": rd["vel"]} if at else None
            rd["force"] = {"t": r3(frames / 60), "dir": None}
            e["launch"] = {"ride": rd, "key": key}
        ents.append(e)
    for trig, cells, hb, *ev in gm.get('shuts', []):   # cells raised behind the player (see s3d.js)
        gc = [[cx - x0, cz - z0] for cx, cz in cells if floor_cell(cx, cz)]
        if gc:
            g = {"type": "gate", "cells": gc, "top": gate_top(hb), "opens": 0, "shut": [[cx - x0, cz - z0] for cx, cz in trig]}
            if ev and ev[0]: g["ev"] = ev[0]
            ents.append(g)
    for ax, bx, az, bz, at, state, hold, clear in gm.get('lifts', []):   # the act's end without a ring (see s3d.js)
        rd, _end = ride_of(state, at, None, None); rd["start"][1] = r3((at[1] + 8) / CELL * vscale)
        rd.update({"end": None, "wait": r3(hold / 60), "clear": r3(clear / 60)})
        ents.append({"type": "hole", "x": r3((ax + bx + 1) / 2 / CELL - x0), "z": r3((az + bz + 1) / 2 / CELL - z0), "half": [r3((bx + 1 - ax) / 2 / CELL), r3((bz + 1 - az) / 2 / CELL)], "opens": 0, "ride": rd})
    if 'tubes2' in gm:   # taken grounded in the cell, put at (x, z) at his own height (see s3d.js)
        tab, n, alts, *more = gm['tubes2']; kys = more[0] if more else []; size = more[1] if len(more) > 1 else 12; hidden = len(more) > 2 and more[2]
        end_of = lambda end: {"at": [r3(end[0] / CELL - x0), r3((end[1] + 8) / CELL * vscale), r3(end[2] / CELL - z0)], "facing": compass_of(end[3]),
                              "vel": [r3(end[4] * mps), r3(-end[5] * mps * vscale), r3(end[6] * mps)]} if end else None
        for k2 in range(n):
            c, x, z, state = struct.unpack('>HhhH', rom[tab + size * k2:tab + size * k2 + 8]); c >>= 1; cx, cz = c % 128, c >> 7
            if not floor_cell(cx, cz): continue   # (the place is in the tube: no floor there)
            ride, end = ride_of(state, None, None, None)
            ride["start"] = [r3(x / CELL - x0), None, r3(z / CELL - z0)]; ride["end"] = end_of(end)
            alt = next((q for q in alts if q[0] == k2), None)
            if alt:
                a, aend = ride_of(alt[2], None, None, None)
                ride["alt"] = {"at": ride_of(state, None, None, None, True)[alt[1]], "ride": {"vel": a["vel"], "path": a["path"], "turns": a["turns"], "end": end_of(aend)}}
            e = {"type": "hole", "x": cx + 0.5 - x0, "z": cz + 0.5 - z0, "size": 0.5, "opens": 0, "free": 1, "ride": ride}
            key = next((q for q in kys if q[0] == k2), None)
            if key: e["key"] = key[1]
            if hidden: ride["hidden"] = 1
            ents.append(e)
    bs = BOSSES.get(level_id)
    if bs:
        e = {"type": "boss", "kind": bs['kind'], "x": jround(bs['at'][0] / CELL - x0, 3), "y": jround(bs['at'][1] / CELL * vscale, 3), "z": jround(bs['at'][2] / CELL - z0, 3),
             "home": [jround(bs['home'][0] / CELL - x0, 3), jround(bs['home'][1] / CELL - z0, 3)], "cruise": jround(bs['cruise'] / CELL * vscale, 3),
             "arena": [jround(bs['arena'][0] / CELL - x0, 3), jround(bs['arena'][1] / CELL - x0, 3), jround(bs['arena'][2] / CELL - z0, 3), jround(bs['arena'][3] / CELL - z0, 3)], "hp": bs['hp'], "vs": vscale}
        if bs['kind'] == 'ss':
            Y = lambda v: jround(v / CELL * vscale, 3)
            e["hover"] = Y(bs['hover']); e["low"] = Y(bs['low']); e["hang"] = Y(bs['hang']); e["fists"] = [[jround(fx / CELL, 3), jround(fz / CELL, 3)] for fx, fz in bs['fists']]
            e["corners"] = [[jround(cz / CELL - z0, 3), jround(cx / CELL - x0, 3)] for cz, cx in bs['corners']]
        if bs['kind'] == 'rr':
            Y = lambda v: jround(v / CELL * vscale, 3); Z = lambda v: jround(v / CELL - z0, 3)
            e["arms"] = [jround(x / CELL - x0, 3) for x in bs['arms']]; e["root"] = [Y(bs['root'][0]), Z(bs['root'][1])]; e["cap"] = Y(bs['cap']); e["reach"] = [Z(bs['reach'][0]), Z(bs['reach'][1])]
            sc = []; o = bs['script']
            while len(sc) < 64:
                a, n = struct.unpack('>hh', rom[o:o + 4]); o += 4
                if a < 0: e["loop"] = len(sc) - n // 4; break
                sc.append([a // 4, n])
            e["script"] = sc
            if 'pit' in bs: e["pit"] = {"cells": [[cx - x0, cz - z0] for cx, cz in bs['pit'][0]], "z": Z(bs['pit'][1]), "y": jround((bs['pit'][2] + 8) / CELL * vscale, 3)}
        if bs['kind'] == 'vv':
            Y = lambda v: jround(v / CELL * vscale, 3)
            e["low"] = Y(bs['low']); e["minY"] = Y(bs['minY'])
            e["hitBox"] = [jround(bs['hitBox'][0] / CELL - x0, 3), jround(bs['hitBox'][1] / CELL - x0, 3), jround(bs['hitBox'][2] / CELL - z0, 3), jround(bs['hitBox'][3] / CELL - z0, 3)]
            e["rise"] = [jround(bs['rise'][0] / CELL - x0, 3), Y(bs['rise'][1]), jround(bs['rise'][2] / CELL - z0, 3)]
            e["spikes"] = [[cx - x0, cz - z0] for cx, cz in bs['spikes'] if floor_cell(cx, cz)]
            if 'lava' in bs: e["lava"] = Y(bs['lava'])
        if bs['kind'] == 'ff':   # (see s3d.js)
            e["org"] = [x0, z0]; e["doors"] = [[[(o >> 1) % 128 - x0, ((o >> 1) >> 7) - z0] for o in d] for d in bs['doors']]; e["doorTop"] = jround(bs['doorTop'] * 8 / CELL * vscale, 3)
        if bs['kind'] == 'pp':   # (see s3d.js)
            X = lambda v: r3(v / CELL - x0); Y = lambda v: r3((v + 8) / CELL * vscale); Z = lambda v: r3(v / CELL - z0); P3 = lambda q: [X(q[0]), Y(q[1]), Z(q[2])]
            e["y"] = Y(bs['at'][1]); e["cruise"] = Y(bs['cruise']); stages = []
            for st in bs['stages']:
                o = {"pod": [X(st['pod'][0]), Z(st['pod'][1]), Y(st['pod'][2]), Y(st['pod'][3])], "hitY": Y(st['hitY']), "arms": []}
                for a in st['arms']:
                    q = {"rest": P3(a['rest']), "shoulder": P3(a['shoulder']), "cell": [a['cell'][0] - x0, a['cell'][1] - z0]}
                    if 'at' in a: q["at"] = P3(a['at'])
                    if 'zone' in a: q["zone"] = [X(a['zone'][0]), Z(a['zone'][1])]
                    if a.get('t'): q["t"] = a['t']
                    if a.get('phase'): q["phase"] = a['phase']
                    o["arms"].append(q)
                if 'pad' in st: o["pad"] = [st['pad'][0] - x0, st['pad'][1] - z0]; o["lift"] = P3(st['lift']); o["to"] = P3(st['to'])
                if 'shots' in st: o["shots"] = [P3(q) for q in st['shots']]
                stages.append(o)
            e["stages"] = stages
        if bs['kind'] == 'gng':
            Y = lambda v: r3(v / CELL * vscale); Z = lambda v: r3(v / CELL - z0)
            e["first"] = Y(bs['first']); e["high"] = Y(bs['high']); e["low"] = Y(bs['low']); e["belt"] = [Z(v) for v in bs['belt']]
            e["lanes"] = [r3(bs['lanes'][0] / CELL - x0), r3(bs['lanes'][1] / CELL)]; e["end"] = Z(bs['end']); e["loads"] = [Z(v) for v in bs['loads']]
            e["drops"] = [r3(v / CELL) for v in bs['drops']]; e["dropZ"] = r3(bs['dropZ'] / CELL)
        if bs['kind'] == 'gg':   # (see s3d.js)
            sc = []; o = bs['script']
            while len(sc) < 16:
                sc.append(struct.unpack('>h', rom[o:o + 2])[0]); o += 2
                if sc[-1] < 0: sc.append(struct.unpack('>h', rom[o:o + 2])[0]); break
            e["script"] = sc
            art = struct.unpack('>I', rom[0x280E8 + 0x50:0x280EC + 0x50])[0]
            if 0 < art and art + 8 <= len(rom): e["ballWin"] = list(struct.unpack('>HHhh', rom[art:art + 8]))
        if bs['kind'] == 'dd':
            Y = lambda v: jround(v / CELL * vscale, 3)
            e["low"] = Y(bs['low']); e["high"] = Y(bs['high']); e["dropY"] = Y(bs['dropY'])
            sc = []; o = bs['script']; back = 0
            while len(sc) < 32 and back < 2:
                a, n = struct.unpack('>hh', rom[o:o + 4])
                if a < 0: sc.append([-1, (o - bs['script'] - n) // 4]); back += 1
                else: sc.append([a // 4, n])
                o += 4
            e["script"] = sc; e["hitAt"] = bs['hitAt'] // 4
            dz, sm = x0 - z0, x0 + z0
            e["oct"] = [jround(-bs['diag'] / CELL - dz, 3), jround(bs['diag'] / CELL - dz, 3), jround(bs['sum'][0] / CELL - sm, 3), jround(bs['sum'][1] / CELL - sm, 3)]
        ents.append(e)
    if table_rings:
        for k in range(3):
            x, z = struct.unpack('>h', rom[st + 0x14 + 6 * k:st + 0x16 + 6 * k])[0], struct.unpack('>h', rom[st + 0x18 + 6 * k:st + 0x1A + 6 * k])[0]
            if not x: break
            if not floor_cell(x // CELL, z // CELL): continue
            g = {"type": "goal", "x": jround(x / CELL - x0, 3), "z": jround(z / CELL - z0, 3)}
            links = gm.get('links', [])
            if k < len(links) and floor_cell(links[k][0] // CELL, links[k][1] // CELL):
                g["put"] = [jround(links[k][0] / CELL - x0, 3), jround(links[k][1] / CELL - z0, 3), links[k][2]]
            nx, nz, nd = struct.unpack('>hhh', rom[st + 6 * (k + 1):st + 6 * (k + 2)])   # the next section's start (see s3d.js)
            if (nx or nz) and floor_cell(nx // CELL, nz // CELL): g["spawn"] = [jround(nx / CELL - x0, 3), jround(nz / CELL - z0, 3), compass_of(nd & 0x7FF)]
            ents.append(g)
    # pads (see s3d.js): listed, or closed ones in record order leading to the next
    pad_list = gm.get('pads') or [(i, i + 1, k + 1) for k, i in enumerate([i for i, q in enumerate(holes) if q[2] == 4 and i + 1 < len(holes)])]
    for frm, to, after in pad_list:
        a = holes[frm] if frm < len(holes) else None
        b = holes[to] if 0 <= to < len(holes) else None
        links = gm.get('links', [])
        put = links[after - 1] if to < 0 and after - 1 < len(links) else None
        if not a or not (b or put): continue
        e = {"type": "hole", "x": jround((a[0] + 15) / CELL - x0, 3), "z": jround((a[1] + 5) / CELL - z0, 3), "opens": after,
             "exit": [jround((b[0] + 15) / CELL - x0, 3), jround((b[1] + 5) / CELL - z0, 3)] if b else [jround(put[0] / CELL - x0, 3), jround(put[1] / CELL - z0, 3)],
             "launch": launch_for(vscale, gm.get('padRise', 127)) if b else 0,
             "pad": {"sink": jround(56 / CELL * vscale, 3), "bury": jround(47 / CELL * vscale, 3)}}
        if not b: e["pad"]["pocket"] = True
        ents.append(e)
    # rings: 10-byte records at block offset 0x1936; word 0 = sort key (flag in bit 15), word 2 = screen y of the base,
    # word 4 = map offset of the cell. Height above the cell floor = key - |screen y| - floor.
    o = RING_TABLE
    while o + 10 <= len(ob):
        a, _, c, _, f = struct.unpack('>HhhhH', ob[o:o + 10]); o += 10
        if o == RING_TABLE + 10 and a == 0 and f == 0: continue   # leading empty record
        if a == 0 and f == 0: break
        a &= 0x7FFF; cx, cz = (f // 2) % 128, (f // 2) // 128
        if not (x0 <= cx <= x1 and z0 <= cz <= z1): continue
        y_world = a - abs(c) + RING_HOVER
        ents.append({"type": "ring", "x": cx + 0.5 - x0, "z": cz + 0.5 - z0, "absY": jround(y_world / CELL * vscale, 4), "scr": abs(c)})
    sx, sz, sdir = struct.unpack('>hhh', rom[start_tab:start_tab + 6])   # the start table first (see s3d.js)
    from_table = False
    if (sx or sz) and floor_cell(sx // CELL, sz // CELL): start = (sx / CELL, sz / CELL); from_table = True
    if start is None:
        cells = [(i % 128, i // 128) for i, v in enumerate(w) if v]
        mx, mz = sum(c[0] for c in cells) / len(cells), sum(c[1] for c in cells) / len(cells)
        bx, bz = min(cells, key=lambda c: (c[0] - mx) ** 2 + (c[1] - mz) ** 2)
        start = (bx + 0.5, bz + 0.5)
    st0 = {"type": "start", "x": start[0] - x0, "z": start[1] - z0}
    if from_table: st0["facing"] = compass_of(sdir & 0x7FF)   # the table's (see s3d.js)
    elif bs:   # in a boss arena the player starts facing the boss (compass degrees)
        st0["facing"] = (math.floor(math.atan2(bs['at'][0] / CELL - start[0], start[1] - bs['at'][2] / CELL) * 180 / math.pi + 0.5) + 360) % 360
    if from_table and any(cx == int(start[0]) and cz == int(start[1]) for cx, cz, v in gm.get('mapSet', [])):   # (dropped in: see s3d.js)
        st0["dropY"] = jround((w0[int(start[1]) * 128 + int(start[0])] >> 8) * unit, 4)
    if gm.get('startLock'): st0["lock"] = gm['startLock']
    ents.insert(0, st0)
    return {"version": 1, "format": "tiles", "name": f"ROM level {level_id}", "width": W, "depth": D,
            "killY": jround(min(min(t["c"]) for t in tiles if t["t"] != "W") - 3, 2), "tiles": tiles, "entities": ents,
            "physics": physics_for(vscale), "rom": dict({"level": level_id, "origin": [x0, z0], "vscale": vscale}, **({"blank": BLANK[level_id]} if level_id in BLANK else {}),
                                                         rand=list(struct.unpack('>500H', rom[0xFAB40:0xFAB40 + 1000]))),
            "flickies": 5 if table_rings else 0}


if __name__ == '__main__':
    rom = open(sys.argv[1], 'rb').read()
    lv = convert(rom, int(sys.argv[2]), float(sys.argv[3]) if len(sys.argv) > 3 else 0.5)
    json.dump(lv, sys.stdout)
