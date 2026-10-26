import sys, struct, collections, rnc
sys.path.insert(0, '.')
from emu_run import *
from PIL import Image, ImageDraw
rom = open('rom/s3d.bin', 'rb').read()
lid = int(sys.argv[1]); state = sys.argv[2]; out = sys.argv[3]
h = 0x1AB62 + (lid - 1) * 0x2A
ob = rnc.unpack(rom, struct.unpack('>I', rom[h:h + 4])[0])
w = struct.unpack('>16384H', rnc.unpack(rom, struct.unpack('>I', rom[h + 4:h + 8])[0]))
objs = []; k = 0
while (k + 1) * 0x34 <= len(ob):
    r = ob[k * 0x34:(k + 1) * 0x34]; t = struct.unpack('>H', r[0x22:0x24])[0]; hnd = struct.unpack('>I', r[0x30:0x34])[0]
    if not (hnd < 0x400000 and t < 0x400): break
    if hnd: objs.append((t, *struct.unpack('>h', r[6:8]), *struct.unpack('>h', r[0xA:0xC]), *struct.unpack('>h', r[0xE:0x10]), k))
    k += 1
first = {}
for o in objs: first.setdefault(o[0], o)
tiles = []
e = Emu(sys.argv[4] if len(sys.argv) > 4 else 'rom/s3d.md'); st = open(state, 'rb').read()
for t, (t_, x, y, z, k) in sorted(first.items()):
    e.e.set_state(st); e.run(2)
    # stand two cells "south-east" of the object on the nearest floor
    best = None
    for dz in range(-4, 5):
        for dx in range(-4, 5):
            cx, cz = (x >> 5) + dx, (z >> 5) + dz
            if not (0 <= cx < 128 and 0 <= cz < 128): continue
            v = w[cz * 128 + cx]
            if v and (v & 0xFF) == 0 and 2 <= abs(dx) + abs(dz) <= 4:
                score = abs(abs(dx) + abs(dz) - 3)
                if best is None or score < best[0]: best = (score, cx, cz, (v >> 8) * 8)
    if not best: continue
    _, cx, cz, fy = best
    px, pz = cx * 32 + 16, cz * 32 + 16
    for _ in range(3):
        poke16(e, 0xC1E6 + 6, px); poke16(e, 0xC1E6 + 0xE, pz); poke16(e, 0xC1E6 + 0xA, fy)
        poke16(e, 0xC1E6 + 0x8C, ((pz >> 5) << 8) + ((px >> 5) << 1))
        e.run(1)
    e.run(30)
    tx, ty = (x - z + 4096) - 160, (x + z) // 2 - y - 120
    for _ in range(90):
        m = mem(e); cx0, cy0 = w16(m, 0xFFFF084E, True), w16(m, 0xFFFF0850, True)
        if abs(cx0 - tx) < 4 and abs(cy0 - ty) < 4: break
        for a, v in ((0xFFFF084E, tx), (0xFFFF0852, tx), (0xFFFF0850, ty), (0xFFFF0854, ty)): poke16(e, a, v)
        e.run(1)
    e.run(20)
    m = mem(e)
    camx, camy = w16(m, 0xFFFF084E, True), w16(m, 0xFFFF0850, True)
    sx = (x - z + 4096) - camx; sy = (x + z) // 2 - y - camy
    img = Image.fromarray(e.e.get_screen())
    crop = img.crop((sx - 40, sy - 56, sx + 40, sy + 24)).resize((160, 160), Image.NEAREST)
    ImageDraw.Draw(crop).text((4, 2), f'{t:03X}', fill=(255, 255, 0))
    tiles.append(crop)
    print(f'type {t:03X} obj#{k} at ({x},{y},{z}) screen ({sx},{sy}) count {sum(1 for o in objs if o[0]==t)}')
sheet = Image.new('RGB', (160 * 6, 160 * ((len(tiles) + 5) // 6)), (40, 40, 40))
for i, c in enumerate(tiles): sheet.paste(c, ((i % 6) * 160, (i // 6) * 160))
sheet.save(out)
