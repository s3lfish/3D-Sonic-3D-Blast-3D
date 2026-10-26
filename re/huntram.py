"""Private: a GG1 Hunter's RAM record over time with Sonic standing near it (camera left to the game).
Usage: python3 huntram.py NTH FRAMES"""
import sys, struct; sys.path.insert(0, '.')
from emu_run import *
from vdp import vram, sprites
import rnc
d = open('rom/s3d.bin', 'rb').read(); lid = 1; nth = int(sys.argv[1]); N = int(sys.argv[2])
h = 0x1AB62 + (lid - 1) * 0x2A
ob = rnc.unpack(d, struct.unpack('>I', d[h:h + 4])[0]); w = struct.unpack('>16384H', rnc.unpack(d, struct.unpack('>I', d[h + 4:h + 8])[0]))
recs = []; k = 0
while (k + 1) * 0x34 <= len(ob):
    r = ob[k * 0x34:(k + 1) * 0x34]; t = struct.unpack('>H', r[0x22:0x24])[0]; hnd = struct.unpack('>I', r[0x30:0x34])[0]
    if not (hnd < 0x400000 and t < 0x400): break
    if hnd and t == 0x0C: recs.append((k, struct.unpack('>hhh', r[6:8] + r[0xA:0xC] + r[0xE:0x10])))
    k += 1
k, (x, y, z) = recs[nth]; cx, cz = x >> 5, z >> 5
best = None
for dx, dz in ((-2, 0), (2, 0), (0, -2), (0, 2)):
    v = w[(cz + dz) * 128 + cx + dx]
    if v and (best is None or abs((v >> 8) * 8 - y) < best[0]): best = (abs((v >> 8) * 8 - y), dx, dz, (v >> 8) * 8)
_, dx, dz, fy = best
e = Emu(f'rom/start{lid:02d}.md'); e.e.set_state(open(f'emu/lv{lid:02d}.state', 'rb').read()); e.run(2)
P = 0xFFFFC1E6; px, pz = (cx + dx) * 32 + 16, (cz + dz) * 32 + 16
for _ in range(3):
    poke16(e, P + 6, px); poke16(e, P + 0xE, pz); poke16(e, P + 0xA, fy + 2); poke16(e, P + 0x8C, ((pz >> 5) << 8) + ((px >> 5) << 1)); e.run(1)
e.run(90)
base = 0xFFFFCCD2 + k * 0x34
print('hunter rec', k, (x, y, z), 'sonic at cell offset', (dx, dz))
from PIL import Image
shots = []
prev = None
for i in range(N):
    e.run(1)
    m = mem(e); words = [w16(m, base + 2 * j, True) for j in range(0x1A)]
    if i >= 160:
        camx, camy = w16(m, 0xFFFF084E), w16(m, 0xFFFF0850)
        ax, ay = x - z + 4096 - camx, (x + z) // 2 - y - camy
        sp = [s for s in sprites(vram(e.e.get_state()), 0xF800) if abs(s['x'] - ax) < 160 and abs(s['y'] - ay) < 160]
        print('F', i, words[13], words[14], words[15], words[16], words[20], '|', ' '.join(f"{s['w']}x{s['h']}@{s['x']-ax},{s['y']-ay}:{s['tile']}{'h' if s['hf'] else ''}" for s in sp))
    if i >= 160 and i % 6 == 0 and len(shots) < 60: shots.append(Image.fromarray(e.e.get_screen()))
sheet = Image.new('RGB', (320 * 6, 224 * ((len(shots) + 5) // 6)))
for i, im in enumerate(shots): sheet.paste(im, ((i % 6) * 320, (i // 6) * 224))
sheet.save('out/watch/hunter_ram.png')
