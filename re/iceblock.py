"""Private: put Sonic on a cell, hold buttons, log position, hurt flag, a watched map cell, photos.
Usage: iceblock.py LEVEL cx cz 'BTN+BTN:frames,...' watch_cx watch_cz [shot_every]"""
import sys, struct; sys.path.insert(0, '.')
from emu_run import *
from PIL import Image
import rnc
lid, cx, cz, seq, wx, wz = int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3]), sys.argv[4], int(sys.argv[5]), int(sys.argv[6])
SH = int(sys.argv[7]) if len(sys.argv) > 7 else 8
d = open('rom/s3d.bin', 'rb').read(); h = 0x1AB62 + (lid - 1) * 0x2A
w = struct.unpack('>16384H', rnc.unpack(d, struct.unpack('>I', d[h + 4:h + 8])[0]))
fy = (w[cz * 128 + cx] >> 8) * 8 + 4
e = Emu(f'rom/start{lid:02d}.md'); e.e.set_state(open(f'emu/lv{lid:02d}.state', 'rb').read()); e.run(2)
P = 0xFFFFC1E6
for _ in range(3):
    poke16(e, P + 6, cx * 32 + 16); poke16(e, P + 0xE, cz * 32 + 16); poke16(e, P + 0xA, fy); poke16(e, P + 0x8C, (cz << 8) + (cx << 1)); e.run(1)
e.run(160)
f = 0; shots = []
for part in seq.split(','):
    btns, n = part.split(':'); btns = [b for b in btns.split('+') if b and b != 'NONE']
    for i in range(int(n)):
        e.run(1, *btns); f += 1; m = mem(e)
        print(f, [w16(m, P + o, True) for o in (6, 0xA, 0xE)], 'gr', w16(m, P + 0x44), 'spin', w16(m, P + 0x56), 'hurt', w16(m, P + 0x3E, True),
              'cell %04X' % w16(m, P + 0x8C), 'w %04X' % w16(m, 0xFFFF3EC6 + 2 * (wz * 128 + wx)), 'rings', w16(m, 0xFFFF0A5A), 'aca', w16(m, 0xFFFF0ACA))
        if f % SH == 0: shots.append(Image.fromarray(e.e.get_screen()))
cols = 4; sheet = Image.new('RGB', (320 * cols, 224 * ((len(shots) + cols - 1) // cols)))
for i, im in enumerate(shots): sheet.paste(im, ((i % cols) * 320, (i // cols) * 224))
sheet.save('out/watch/iceblock.png')
