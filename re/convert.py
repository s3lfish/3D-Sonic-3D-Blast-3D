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
KINDS = {0x30: 'start', 0x18: 'spring', 0x158: 'spring', 0x3C: 'monitor', 0x40: 'goal',
         0x0C: 'enemy', 0x94: 'enemy', 0x144: 'enemy', 0x148: 'enemy', 0x60: 'enemy', 0x64: 'enemy', 0x100: 'enemy', 0x10C: 'enemy',
         0xC4: 'enemy', 0xC8: 'enemy', 0x58: 'enemy'}


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
    return jround(math.sqrt(2 * (900 / CELL) * 3.27) * vscale, 4)


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
    tiles = []
    for z in range(z0, z1 + 1):
        for x in range(x0, x1 + 1):
            v = w[z * 128 + x]
            if not v:
                tiles.append({"c": [0, 0, 0, 0], "t": "W"}); continue   # no floor: Sonic cannot enter (edgeprobe.py)
            hb = v >> 8
            cs = [(v >> 6) & 3, (v >> 4) & 3, (v >> 2) & 3, v & 3]
            tiles.append({"c": [jround((hb + c) * unit, 4) for c in cs], "t": "F"})
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
        if t == 0x1C:
            mode = struct.unpack('>H', r[0x24:0x26])[0]
            if mode: holes.append((x, z, mode))
            continue
        kind = KINDS.get(t)
        if kind == 'goal' and table_rings: continue
        if not kind or not floor_cell(x // CELL, z // CELL): continue
        if kind == 'start': start = (x / CELL, z / CELL); continue
        e = {"type": kind, "x": jround(x / CELL - x0, 3), "z": jround(z / CELL - z0, 3)}
        if kind == 'enemy': e["radius"] = 1.0
        if kind == 'spring': e["power"] = spring_power(vscale)
        if kind != 'goal': e["skin"] = f'{t:03X}'
        ents.append(e)
    if table_rings:
        for k in range(3):
            x, z = struct.unpack('>h', rom[st + 0x14 + 6 * k:st + 0x16 + 6 * k])[0], struct.unpack('>h', rom[st + 0x18 + 6 * k:st + 0x1A + 6 * k])[0]
            if not x: break
            if floor_cell(x // CELL, z // CELL): ents.append({"type": "goal", "x": jround(x / CELL - x0, 3), "z": jround(z / CELL - z0, 3)})
    opens = 0
    for i, (x, z, mode) in enumerate(holes):
        if mode != 4 or i + 1 >= len(holes): continue
        nx = holes[i + 1]
        opens += 1
        ents.append({"type": "hole", "x": jround((x + 15) / CELL - x0, 3), "z": jround((z + 5) / CELL - z0, 3), "opens": opens,
                     "exit": [jround((nx[0] + 15) / CELL - x0, 3), jround((nx[1] + 5) / CELL - z0, 3)], "launch": launch_for(vscale, 127)})
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
    ents.insert(0, {"type": "start", "x": start[0] - x0, "z": start[1] - z0})
    return {"version": 1, "format": "tiles", "name": f"ROM level {level_id}", "width": W, "depth": D,
            "killY": jround(min(min(t["c"]) for t in tiles if t["t"] == "F") - 3, 2), "tiles": tiles, "entities": ents,
            "physics": physics_for(vscale), "rom": {"level": level_id, "origin": [x0, z0], "vscale": vscale},
            "flickies": 5 if table_rings else 0}


if __name__ == '__main__':
    rom = open(sys.argv[1], 'rb').read()
    lv = convert(rom, int(sys.argv[2]), float(sys.argv[3]) if len(sys.argv) > 3 else 0.5)
    json.dump(lv, sys.stdout)
