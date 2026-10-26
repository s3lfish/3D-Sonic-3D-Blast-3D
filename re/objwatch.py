"""Private: put Sonic two cells from one object, let the camera settle, walk into it, log Sonic's position and
photograph the screen. Usage: python3 objwatch.py LEVEL TYPE NTH [frames] [extra buttons...]"""
import sys, struct; sys.path.insert(0, '.')
from emu_run import *
from PIL import Image, ImageDraw
import rnc
d = open('rom/s3d.bin', 'rb').read()
lid, typ, nth = int(sys.argv[1]), int(sys.argv[2], 16), int(sys.argv[3])
N = int(sys.argv[4]) if len(sys.argv) > 4 else 120
extra = sys.argv[5:]
import os; JUMP = int(os.environ.get('JUMP', '-1'))
h = 0x1AB62 + (lid - 1) * 0x2A
ob = rnc.unpack(d, struct.unpack('>I', d[h:h + 4])[0]); w = struct.unpack('>16384H', rnc.unpack(d, struct.unpack('>I', d[h + 4:h + 8])[0]))
objs = []; k = 0
while (k + 1) * 0x34 <= len(ob):
    r = ob[k * 0x34:(k + 1) * 0x34]; t = struct.unpack('>H', r[0x22:0x24])[0]; hnd = struct.unpack('>I', r[0x30:0x34])[0]
    if not (hnd < 0x400000 and t < 0x400): break
    if hnd and t == typ: objs.append((*struct.unpack('>hhh', r[6:8] + r[0xA:0xC] + r[0xE:0x10]), k, r))
    k += 1
x, y, z, k, rec = objs[nth]
print(f'type {typ:03X} #{nth} rec {k} at ({x},{y},{z}) of {len(objs)}; rec bytes {rec[0x10:0x34].hex()}')
cx, cz = x >> 5, z >> 5
DIRS = {(-2, 0): ('DOWN', 'RIGHT'), (2, 0): ('UP', 'LEFT'), (0, -2): ('DOWN', 'LEFT'), (0, 2): ('UP', 'RIGHT')}
best = None
for (dx, dz), btn in DIRS.items():
    v = w[(cz + dz) * 128 + cx + dx]
    if v:
        s = abs((v >> 8) * 8 - y)
        if best is None or s < best[0]: best = (s, dx, dz, btn, (v >> 8) * 8)
_, dx, dz, btn, fy = best
e = Emu(f'rom/start{lid:02d}.md'); e.e.set_state(open(f'emu/lv{lid:02d}.state', 'rb').read()); e.run(2)
P = 0xFFFFC1E6
px, pz = (cx + dx) * 32 + 16, (cz + dz) * 32 + 16
for _ in range(3):
    poke16(e, P + 6, px); poke16(e, P + 0xE, pz); poke16(e, P + 0xA, fy + 2); poke16(e, P + 0x8C, ((pz >> 5) << 8) + ((px >> 5) << 1)); e.run(1)
def settle():
    tx, ty = (px - pz + 4096) - 160, (px + pz) // 2 - fy - 120
    for _ in range(60):
        for a, v in ((0xFFFF084E, tx), (0xFFFF0852, tx), (0xFFFF0850, ty), (0xFFFF0854, ty)): poke16(e, a, v)
        e.run(1)
settle()
def pos():
    m = mem(e); return w16(m, P + 6, True), w16(m, P + 0xA, True), w16(m, P + 0xE, True)
if os.environ.get('DROP'):
    for _ in range(3):
        poke16(e, P + 6, x); poke16(e, P + 0xE, z); poke16(e, P + 0xA, y + int(os.environ['DROP'])); poke16(e, P + 0x8C, ((z >> 5) << 8) + ((x >> 5) << 1)); e.run(1)
    btn = ()
print('start', pos(), 'walking', btn)
shots, log = [], []
for i in range(N):
    e.run(1, *btn, *extra, *(('B',) if JUMP <= i < JUMP + 12 else ()))
    log.append(pos())
    if i % 10 == 0:
        im = Image.fromarray(e.e.get_screen()); ImageDraw.Draw(im).text((4, 4), str(i), fill=(255, 255, 0)); shots.append(im)
print('y track', [p[1] for p in log[::5]]); print('y full', [p[1] for p in log])
print('x track', [p[0] for p in log[::5]]); print('z track', [p[2] for p in log[::5]]); print('xyz full', log[30:200])
sheet = Image.new('RGB', (320 * 4, 224 * ((len(shots) + 3) // 4)))
for i, im in enumerate(shots): sheet.paste(im, ((i % 4) * 320, (i // 4) * 224))
sheet.save(f'out/watch/{lid:02d}_{typ:03X}_{nth}.png')
m = mem(e); ram = struct.unpack('>16384H', m[0x3EC6:0x3EC6 + 32768])
for zz in range(cz - 2, cz + 3):
    print(' '.join(f"{w[zz*128+xx]>>8:3d}/{ram[zz*128+xx]>>8:<3d}" for xx in range(cx - 2, cx + 3)))
print('max y', max(p[1] for p in log), 'object y', y)
