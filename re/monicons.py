"""Private: photograph every monitor of a level, list all sprite pieces near it (no tile filter) and where their tiles
sit raw in the ROM, to find the icon. Usage: python3 monicons.py LEVEL"""
import sys, json, struct, rnc
sys.path.insert(0, '.')
from emu_run import *
from vdp import *
from PIL import Image
rom = open('rom/s3d.bin', 'rb').read()
lid = int(sys.argv[1]); h = 0x1AB62 + (lid - 1) * 0x2A
ob = rnc.unpack(rom, struct.unpack('>I', rom[h:h + 4])[0])
w = struct.unpack('>16384H', rnc.unpack(rom, struct.unpack('>I', rom[h + 4:h + 8])[0]))
mons = []; k = 0
while (k + 1) * 0x34 <= len(ob):
    r = ob[k * 0x34:(k + 1) * 0x34]; t = struct.unpack('>H', r[0x22:0x24])[0]; hnd = struct.unpack('>I', r[0x30:0x34])[0]
    if not (hnd < 0x400000 and t < 0x400): break
    if hnd and t == 0x3C: mons.append((*struct.unpack('>hhh', r[6:8] + r[0xA:0xC] + r[0xE:0x10]), struct.unpack('>H', r[0x26:0x28])[0]))
    k += 1
e = Emu(f'rom/start{lid:02d}.md'); st = open(f'emu/lv{lid:02d}.state', 'rb').read(); P = 0xC1E6
crops = []
for (x, y, z, kind) in mons:
    e.e.set_state(st); e.run(2)
    best = None
    for dz in range(-4, 5):
        for dx in range(-4, 5):
            cx, cz = (x >> 5) + dx, (z >> 5) + dz
            if 0 <= cx < 128 and 0 <= cz < 128:
                v = w[cz * 128 + cx]
                if v and not v & 0xFF and 3 <= abs(dx) + abs(dz) <= 5: best = (cx, cz, (v >> 8) * 8); break
        if best: break
    if not best: print('no floor near', (x, z)); continue
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
    vr = vram(e.e.get_state()); sat = sprites(vr, 0xF800)
    print(f'monitor kind {kind:#06x} at ({x},{y},{z}) screen ({sx},{sy})')
    for s in sat:
        if not (sx - 30 <= s['x'] + s['w'] * 4 <= sx + 30 and sy - 72 <= s['y'] + s['h'] * 4 <= sy + 12): continue
        blk = vr[s['tile'] * 32:(s['tile'] + s['w'] * s['h']) * 32]
        print(f"   piece dx {s['x'] - sx} dy {s['y'] - sy} {s['w']}x{s['h']} tile {s['tile']} pal {s['pal']} rom {rom.find(blk):#x}")
    img = Image.fromarray(e.e.get_screen()); crops.append(img.crop((sx - 32, sy - 64, sx + 32, sy + 8)).resize((128, 144), Image.NEAREST))
sheet = Image.new('RGB', (128 * len(crops), 144))
for i, c in enumerate(crops): sheet.paste(c, (i * 128, 0))
sheet.save(f'out/watch/monitors_{lid:02d}.png')
