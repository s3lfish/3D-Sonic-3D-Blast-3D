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
RING_TABLE, RING_HOVER = 0x1936, 18
# object types identified from in-game photos (springs, monitors, the act-end ring, player start, main enemies)
KINDS = {0x30: 'start', 0x18: 'spring', 0x158: 'spring', 0x3C: 'monitor', 0x40: 'goal', 0x08: 'mine', 0x54: 'turret', 0x24: 'booster',
         0x0C: 'enemy', 0x94: 'enemy', 0x144: 'enemy', 0x148: 'enemy', 0x60: 'enemy', 0x64: 'enemy', 0x100: 'enemy', 0x10C: 'enemy',
         0xC4: 'enemy', 0xC8: 'enemy', 0x58: 'enemy', 0x9C: 'enemy', 0x8C: 'spring', 0x98: 'lift', 0xAC: 'crawler',
         0x5C: 'enemy', 0x14C: 'enemy', 0x150: 'balloon'}
MONITOR_KINDS = ['oneup', 'rings', 'shield', 'gold', 'invincible', 'speed', 'fire']


# the original's movement, measured in the running game (see s3d.js physicsFor)
def physics_for(vscale):
    r4 = lambda v: jround(v * vscale, 4)
    g, h = 900 / CELL, 60 / CELL
    jump = (g / 60 + math.sqrt((g / 60) ** 2 + 8 * g * h)) / 2   # peaks at h under Blast Grid's 60 Hz stepping
    return {"gravity": r4(g), "jumpV": r4(jump), "jumpCut": r4(jump * 0.4), "maxFall": r4(420 / CELL), "stepUp": r4(12 / CELL), "snapDown": r4(12 / CELL)}


def launch_for(vscale, rise):
    g, hh = 900 / CELL * vscale, rise / CELL * vscale
    return jround((g / 60 + math.sqrt((g / 60) ** 2 + 8 * g * hh)) / 2, 4)


def spring_power(vscale):
    return launch_for(vscale, 140)   # measured: a spring throws Sonic 140 units up


GIMMICKS = {
    1: {'cannons': [(116, 12, 248, 9, 7.067)], 'cracks': [([(108, 17)], 480, [0, -1])]},
    2: {'cannons': [(21, 48, 576, 9, 6.1)], 'cracks': [([(59, 47)], 784, [-1, 0]), ([(108, 41), (109, 41)], 688, [0, -1])]},
    # Rusty Ruin 1 (see s3d.js GIMMICKS): spike and fan cell marks, door and pillar tables, pockets after rings, rides
    7: {'spikes': 0xFF, 'fans': 0x55, 'doors': (0x7994, 4), 'pillars': (0x7ACC, 23), 'maces': (0x75C2, 5), 'flames': (0x7548, 5),
        'links': [(1696, 1840, 90), (2576, 1216, 180)],
        'rides': [(60, 48, 1, 0x36, (1888, 392, 768), 0x400, (0, 0, 5)), (80, 50, 2, 0x38, None, None, (0, 0, 0))],
        'pads': [(0, -1, 1), (1, -1, 2)],
        'cracks': [([(88, 62)], 432, [-1, 0]), ([(100, 41), (100, 15, 560)], 432, [0, -1])]},
    # Rusty Ruin 2 (see s3d.js GIMMICKS)
    6: {'spikes': 0xFF, 'fans': 0x55, 'pillars': (0x8266, 23), 'maces': (0x80B8, 6), 'flames': (0x7EC4, 9), 'padRise': 138, 'pads': [(0, 1, 1), (1, 0, 1), (2, 3, 2), (3, 2, 2)],
        'slides': [(0xC3, [1, 0]), (0xF0, [0, 1])], 'pillarLinks': [(85, 101, 0x05, [(99, 96, 0x22)])],
        'rides': [(98, 96, 0, 0x30, None, None, (0, 0, 0)), (85, 101, 0, 0x2E, None, None, (0, 0, 0), 40),
                  (100, 60, 0, 0x32, None, None, (0, 0, 0)), (91, 71, 0, 0x34, None, None, (0, 0, 0))],
        'cracks': [([(101, 60)], 336, [-1, 0])]},
    # Spring Stadium 1 and 2 (see s3d.js GIMMICKS)
    15: {'floorSprings': 0x55, 'bumpers': (0xFF, 0x98DA, 8), 'spikeField': 0xAA,
         'rides': [(37, 117, 0, 4, None, None, None, None, (140, [1, 0])), (61, 115, 0, 4, None, None, None, None, (200, [1, 0])),
                   (77, 113, 0, 4, None, None, None, None, (85, [1, 0])), (59, 41, 0, 4, None, None, None, None, (70, None))],
         'holds': [(55, 115, 100), (53, 41, 100)], 'tubes': (0x98C6, 0x40, 0x42),
         'tris': [('x', 2432, 1600, 0, -4, 4, 1), ('x', 2432, 1792, 1, -4, -4, 1)]},
    17: {'floorSprings': 0x55, 'spikeField': 0xFF},
    16: {'floorSprings': 0x55, 'bumpers': (0xFF, 0x94EA, 30),
         'rides': [(73, 105, 0, 4, None, None, None, None, (70, None)), (85, 76, 0, 0x8004, None, None, None, None, (84, None)),
                   (87, 74, 0, 0x8044, None, None, None, None, (84, None))],
         'holds': [(68, 105, 100)], 'tubes': (0x9480, 0x40, 0x42),
         'tris': [('z', 1472, 1152, 0, 4, -4, 1), ('z', 1472, 1344, 1, -4, -4, 1), ('x', 2752, 3200, 0, -4, 4, 1), ('x', 2752, 3456, 1, -4, -4, 1),
                  ('x', 3264, 1920, 0, -4, 4, 1), ('x', 3264, 2048, 1, -4, -4, 0), ('x', 3072, 2240, 1, -4, -4, 0)],
         'spears': (0x9494, 16), 'spikeWall': (122, [22, 24, 27, 28, 29, 30], 0x380)},
}
DOOR_PUSH = {0: (0, 4), 2: (-4, 0), 4: (0, -4)}
BOSSES = {3: {'kind': 'gg', 'at': (1152, 350, 1152), 'home': (1088, 1088), 'cruise': 160, 'arena': (800, 1375, 800, 1375), 'hp': 5},
          8: {'kind': 'rr', 'at': (1856, 330, 2080), 'cruise': 160, 'cap': 350, 'arms': (1792, 1920), 'root': (136, 2080),
              'reach': (2144, 2190), 'script': 0x7170, 'home': (1856, 2080), 'arena': (1760, 1983, 2080, 2271), 'hp': 5},
          17: {'kind': 'ss', 'at': (1796, 568, 2304), 'cruise': 168, 'hover': 200, 'low': 120, 'hang': 40, 'fists': ((38, 40), (-46, 40)),
               'corners': ((2237, 1560), (2045, 1752)), 'home': (1796, 2304), 'arena': (1496, 1896, 1981, 2398), 'hp': 8}}
SCRIPTS = 0x25DF2


def ride_script(rom, state):
    """RunSonic's scripted moves (see s3d.js rideScript)."""
    u16 = lambda o: struct.unpack('>H', rom[o:o + 2])[0]
    s16 = lambda o: struct.unpack('>h', rom[o:o + 2])[0]
    base = SCRIPTS + s16(SCRIPTS + state - 2); sp = mo = left = 0; path, turns, end = [], [], None
    while len(path) < 5000:
        left -= 1
        if left <= 0:
            a = base + sp; w0 = u16(a)
            if w0 == 0x8000:
                back = s16(a + 2)
                if back > 0: sp -= back; left = 0; continue
                if back < 0: end = [s16(a + 4 + 2 * i) for i in range(7)]
                break
            w1 = u16(a + 2); mo = w0; left = w1 & 0xFF; sp += 4
            if w1 & 0xFF00: turns.append([len(path), (w1 & 0xFF00) - 0x8000])
        if u16(SCRIPTS + mo) == 0x8000: mo -= s16(SCRIPTS + mo + 2)
        path.append([s16(SCRIPTS + mo), s16(SCRIPTS + mo + 2), s16(SCRIPTS + mo + 4)]); mo += 6
    return path, turns, end


def compass_of(f):
    return (180 + f * 360 / 2048) % 360

def convert(rom, level_id, vscale=1.0):
    h = HEADERS + (level_id - 1) * HSIZE
    mp, start_tab = struct.unpack('>I', rom[h + 4:h + 8])[0], struct.unpack('>I', rom[h + 0x20:h + 0x24])[0]
    w = struct.unpack('>16384H', rnc.unpack(rom, mp))
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
            tiles.append({"c": [jround((hb + c) * unit, 4) for c in cs], "t": "H" if spike else "F"})
    ents = []
    floor_cell = lambda cx, cz: 0 <= cx < 128 and 0 <= cz < 128 and w[cz * 128 + cx] != 0
    # objects: 52-byte records in the RNC block at header +0x00; type at +0x22, x/y/z at +6/+0xA/+0xE
    ob = rnc.unpack(rom, struct.unpack('>I', rom[h:h + 4])[0])
    st = struct.unpack('>I', rom[h + 0x20:h + 0x24])[0]
    table_rings = struct.unpack('>h', rom[st + 0x12:st + 0x14])[0] >= 0
    holes = []
    start = None
    k = 0
    while (k + 1) * 0x34 <= len(ob):
        r = ob[k * 0x34:(k + 1) * 0x34]; k += 1
        t, hnd = struct.unpack('>H', r[0x22:0x24])[0], struct.unpack('>I', r[0x30:0x34])[0]
        if not (hnd < 0x400000 and t < 0x400): break
        if not hnd: continue
        x, z = struct.unpack('>h', r[6:8])[0], struct.unpack('>h', r[0xE:0x10])[0]
        if t in (0x1C, 0x90):
            mode = struct.unpack('>H', r[0x24:0x26])[0]
            if mode: holes.append((x, z, mode))
            continue
        kind = KINDS.get(t)
        if kind == 'goal' and table_rings: continue
        if not kind or not floor_cell(x // CELL, z // CELL): continue
        if kind == 'start': start = (x / CELL, z / CELL); continue
        e = {"type": kind, "x": jround(x / CELL - x0, 3), "z": jround(z / CELL - z0, 3)}
        if kind == 'enemy':
            e["radius"] = 0 if t == 0x0C else 1.0
            if t == 0x58: e["chase"] = 1
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
    for mark, dr in gm.get('slides', []):
        cells = [[x - x0, z - z0] for z in range(z0, z1 + 1) for x in range(x0, x1 + 1) if w[z * 128 + x] and (w[z * 128 + x] & 0xFF) == mark]
        if cells: ents.append({"type": "slide", "cells": cells, "dir": dr})
    if 'fans' in gm:
        cells = [[x - x0, z - z0] for z in range(z0, z1 + 1) for x in range(x0, x1 + 1) if w[z * 128 + x] and (w[z * 128 + x] & 0xFF) == gm['fans']]
        if cells: ents.append({"type": "fan", "cells": cells})
    import math
    if 'maces' in gm:
        o, n = gm['maces']
        for k in range(n):
            x, y, z, turn, second = struct.unpack('>5h', rom[o + 14 * k + 4:o + 14 * k + 14])
            if not floor_cell(x // CELL, z // CELL): continue
            ents.append({"type": "mace", "x": jround(x / CELL - x0, 3), "z": jround(z / CELL - z0, 3), "y": jround(y / CELL * vscale, 3), "r": jround(64 / CELL, 3),
                         "link": jround(16 / CELL, 3), "w": jround(turn * math.pi * 2 / 2048 * 60, 6), "balls": [0, jround(second * math.pi * 2 / 2048, 6)] if second else [0]})
    if 'flames' in gm:
        o, n = gm['flames']
        for k in range(n):
            x, z, y = struct.unpack('>3h', rom[o + 8 * k:o + 8 * k + 6]); fl = struct.unpack('>H', rom[o + 8 * k + 6:o + 8 * k + 8])[0]
            if not floor_cell(x // CELL, z // CELL): continue
            ents.append({"type": "flame", "x": jround(x / CELL - x0, 3), "z": jround(z / CELL - z0, 3), "y": jround(y / CELL * vscale, 3), "dir": [0, 1] if fl & 0x800 else [1, 0]})
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
    def ride_of(state, frm, facing, vel):   # bit 15 of the state: x and z swapped; no velocity: the last step carries on
        path, turns, end = ride_script(rom, state & 0x7FFF); mir = bool(state & 0x8000)
        if mir: path = [[c, b, a] for a, b, c in path]
        last = path[-1] if path else [0, 0, 0]
        return ({"start": [r3(frm[0] / CELL - x0), r3(frm[1] / CELL * vscale), r3(frm[2] / CELL - z0)] if frm else None,
                 "facing": None if facing is None else compass_of(facing),
                 "vel": [r3(vel[0] * mps), r3(vel[1] * mps * vscale), r3(vel[2] * mps)] if vel else [r3(last[0] * mps), 0, r3(last[2] * mps)],
                 "path": [[r6(dx / CELL), r6(dy / CELL * vscale), r6(dz / CELL)] for dx, dy, dz in path],
                 "turns": [[i, compass_of((0x600 - f) & 0x7FF if mir else f)] for i, f in turns]}, end)
    for cx, cz, after, state, frm, facing, vel, *rest in gm.get('rides', []):
        if floor_cell(cx, cz) and (frm is None or floor_cell(frm[0] // CELL, frm[2] // CELL)):
            ride, end = ride_of(state, frm, facing, vel)
            ride["end"] = {"at": [r3(end[0] / CELL - x0), r3(end[1] / CELL * vscale), r3(end[2] / CELL - z0)], "facing": compass_of(end[3]),
                           "vel": [r3(end[4] * mps), r3(-end[5] * mps * vscale), r3(end[6] * mps)]} if end else None
            if len(rest) > 1 and rest[1]: ride["force"] = {"t": r3(rest[1][0] / 60), "dir": rest[1][1]}
            e = {"type": "hole", "x": cx + 0.5 - x0, "z": cz + 0.5 - z0, "size": 0.5, "opens": after, "air": True, "ride": ride}
            if rest and rest[0] is not None: e["maxY"] = r3(rest[0] / CELL * vscale)
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
        if cells: ents.append({"type": "springCells", "cells": cells, "power": launch_for(vscale, 124)})
    if 'bumpers' in gm:
        mark, tab, n = gm['bumpers']; cells = cells_of(mark)
        for k in range(n):
            off = abs(struct.unpack('>h', rom[tab + 2 * k:tab + 2 * k + 2])[0]) >> 1; cx, cz = off & 127, off >> 7
            if x0 <= cx <= x1 and z0 <= cz <= z1 and w[cz * 128 + cx] and [cx - x0, cz - z0] not in cells: cells.append([cx - x0, cz - z0])
        if cells: ents.append({"type": "bumpers", "cells": cells})
    if 'spikeField' in gm:
        cells = cells_of(gm['spikeField'])
        if cells: ents.append({"type": "spikeField", "cells": cells})
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
        ents.append({"type": "ring", "x": cx + 0.5 - x0, "z": cz + 0.5 - z0, "absY": jround(y_world / CELL * vscale, 4)})
    if start is None:
        sx, sz = struct.unpack('>hh', rom[start_tab:start_tab + 4])
        if (sx or sz) and floor_cell(sx // CELL, sz // CELL): start = (sx / CELL, sz / CELL)
    if start is None:
        cells = [(i % 128, i // 128) for i, v in enumerate(w) if v]
        mx, mz = sum(c[0] for c in cells) / len(cells), sum(c[1] for c in cells) / len(cells)
        bx, bz = min(cells, key=lambda c: (c[0] - mx) ** 2 + (c[1] - mz) ** 2)
        start = (bx + 0.5, bz + 0.5)
    st0 = {"type": "start", "x": start[0] - x0, "z": start[1] - z0}
    if bs:   # in a boss arena the player starts facing the boss (compass degrees)
        st0["facing"] = (math.floor(math.atan2(bs['at'][0] / CELL - start[0], start[1] - bs['at'][2] / CELL) * 180 / math.pi + 0.5) + 360) % 360
    ents.insert(0, st0)
    return {"version": 1, "format": "tiles", "name": f"ROM level {level_id}", "width": W, "depth": D,
            "killY": jround(min(min(t["c"]) for t in tiles if t["t"] != "W") - 3, 2), "tiles": tiles, "entities": ents,
            "physics": physics_for(vscale), "rom": {"level": level_id, "origin": [x0, z0], "vscale": vscale},
            "flickies": 5 if table_rings else 0}


if __name__ == '__main__':
    rom = open(sys.argv[1], 'rb').read()
    lv = convert(rom, int(sys.argv[2]), float(sys.argv[3]) if len(sys.argv) > 3 else 0.5)
    json.dump(lv, sys.stdout)
