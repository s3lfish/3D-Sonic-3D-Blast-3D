"""Snapshot an object type's sprite pieces and find each piece's tiles stored raw in the ROM.
Usage: python3 recipe.py LEVEL TYPEHEX[,TYPEHEX...]  -> appends to out/recipes.json (private RE tooling)."""
import sys, json, struct, os, rnc
sys.path.insert(0, '.')
from emu_run import *
from vdp import *
rom = open('rom/s3d.bin', 'rb').read()
lid = int(sys.argv[1]); wanted = [int(t, 16) for t in sys.argv[2].split(',')]
h = 0x1AB62 + (lid - 1) * 0x2A
ob = rnc.unpack(rom, struct.unpack('>I', rom[h:h + 4])[0])
w = struct.unpack('>16384H', rnc.unpack(rom, struct.unpack('>I', rom[h + 4:h + 8])[0]))
objs = []; k = 0
while (k + 1) * 0x34 <= len(ob):
    r = ob[k * 0x34:(k + 1) * 0x34]; t = struct.unpack('>H', r[0x22:0x24])[0]; hnd = struct.unpack('>I', r[0x30:0x34])[0]
    if not (hnd < 0x400000 and t < 0x400): break
    if hnd and t in wanted: objs.append((t, *struct.unpack('>h', r[6:8]), *struct.unpack('>h', r[0xA:0xC]), *struct.unpack('>h', r[0xE:0x10])))
    k += 1
path = 'out/recipes.json'
recipes = json.load(open(path)) if os.path.exists(path) else {}
e = Emu(f'rom/start{lid:02d}.md'); st = open(f'emu/lv{lid:02d}.state', 'rb').read()
P = 0xC1E6
for t in wanted:
    cands = [o for o in objs if o[0] == t]
    done = False
    for (t_, x, y, z) in cands[:4]:
        e.e.set_state(st); e.run(2)
        # stand nearby on the floor
        best = None
        for dz in range(-4, 5):
            for dx in range(-4, 5):
                cx, cz = (x >> 5) + dx, (z >> 5) + dz
                if 0 <= cx < 128 and 0 <= cz < 128:
                    v = w[cz * 128 + cx]
                    if v and not v & 0xFF and 3 <= abs(dx) + abs(dz) <= 5:
                        best = (cx, cz, (v >> 8) * 8); break
            if best: break
        if not best: continue
        cx, cz, fy = best
        for _ in range(3):
            poke16(e, P + 6, cx * 32 + 16); poke16(e, P + 0xE, cz * 32 + 16); poke16(e, P + 0xA, fy); poke16(e, P + 0x8C, (cz << 8) + (cx << 1)); e.run(1)
        e.run(30)
        tx, ty = (x - z + 4096) - 160, (x + z) // 2 - y - 120
        for _ in range(90):
            for a, v in ((0xFFFF084E, tx), (0xFFFF0852, tx), (0xFFFF0850, ty), (0xFFFF0854, ty)): poke16(e, a, v)
            e.run(1)
        e.run(10)
        m = mem(e); camx, camy = w16(m, 0xFFFF084E, True), w16(m, 0xFFFF0850, True)
        sx, sy = (x - z + 4096) - camx, (x + z) // 2 - y - camy
        st2 = e.e.get_state(); vr = vram(st2); sat = sprites(vr, 0xF800)
        pieces = []
        for s in sat:
            if 1664 <= s['tile'] < 1704 or s['tile'] in (2004, 2018, 2020) or s['tile'] >= 1696 and s['tile'] < 1730: continue
            if not (sx - 30 <= s['x'] + s['w'] * 4 <= sx + 30 and sy - 72 <= s['y'] + s['h'] * 4 <= sy + 12): continue
            blk = vr[s['tile'] * 32:(s['tile'] + s['w'] * s['h']) * 32]
            addr = rom.find(blk)
            pieces.append(dict(dx=s['x'] - sx, dy=s['y'] - sy, w=s['w'], h=s['h'], hf=s['hf'], vf=s['vf'], line=s['pal'], rom=addr))
        if pieces and all(p['rom'] >= 0 for p in pieces):
            pal = list(rom[h + 0x26:h + 0x2A])
            recipes[f'{t:03X}'] = dict(level=lid, palettes=pal, pieces=pieces)
            print(f'type {t:03X}: {len(pieces)} pieces, all tiles found raw in ROM')
            done = True; break
        elif pieces:
            print(f'type {t:03X}: {len(pieces)} pieces, raw tiles missing for {sum(1 for p in pieces if p["rom"] < 0)}; trying another')
    if not done: print(f'type {t:03X}: no usable snapshot')
json.dump(recipes, open(path, 'w'), indent=1)
