"""Private: Gene Gadget sequence probe: steps of 'T x z y' (teleport, units), 'B btn+btn frames' (hold), 'P addr val'
(poke16), logged every N frames. Usage: gngseq.py LEVEL every 'step;step;...' [photo every M] [extra: python expr of m]"""
import sys, struct; sys.path.insert(0, '.')
from emu_run import *
from PIL import Image
lid, every, steps = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
photo = int(sys.argv[4]) if len(sys.argv) > 4 else 0
e = Emu(f'rom/start{lid:02d}.md'); e.e.set_state(open(f'emu/lv{lid:02d}.state', 'rb').read()); e.run(2)
P = 0xFFFFC1E6; f = 0; shots = []
EXTRA = eval('lambda m: ' + sys.argv[5]) if len(sys.argv) > 5 else None
L32 = lambda m, a: struct.unpack('>i', m[a & 0xFFFF:(a & 0xFFFF) + 4])[0] / 65536
def tp(x, z, y):
    for _ in range(3):
        poke16(e, P + 6, x); poke16(e, P + 0xE, z); poke16(e, P + 0xA, y); poke16(e, P + 0x8C, ((z // 32) << 8) + ((x // 32) << 1)); e.run(1)
for st in steps.split(';'):
    a = st.split()
    if a[0] == 'T': tp(int(a[1]), int(a[2]), int(a[3])); continue
    if a[0] == 'P': poke16(e, int(a[1], 16), int(a[2], 0)); continue
    btns = [b for b in a[1].split('+') if b and b != 'NONE']
    for i in range(int(a[2])):
        poke16(e, 0xFFFF0A5A, 50); e.run(1, *btns); f += 1; m = mem(e)
        if f % every == 0:
            print(f, [w16(m, P + o, True) for o in (6, 0xA, 0xE)], 'gr', w16(m, P + 0x44), 'st %X' % w16(m, P + 0x64), '56', w16(m, P + 0x56), '3E', w16(m, P + 0x3E, True),
                  'sec', w16(m, 0xFFFF06B2), 'v', ['%.2f' % L32(m, P + o) for o in (0x12, 0x16, 0x1A)], 'cell (%d,%d)' % ((w16(m, P + 0x8C) >> 1) & 127, w16(m, P + 0x8C) >> 8), 'snd %X' % w16(m, 0xFFFF0AC4), *(EXTRA(m) if EXTRA else []))
        if photo and f % photo == 0: shots.append(Image.fromarray(e.e.get_screen()))
if shots:
    cols = 4; sheet = Image.new('RGB', (320 * cols, 224 * ((len(shots) + cols - 1) // cols)))
    for i, im in enumerate(shots): sheet.paste(im, ((i % cols) * 320, (i // cols) * 224))
    sheet.save('out/watch/gngseq.png')
