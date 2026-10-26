"""Private: Diamond Dust 3's boss from the save state with no input: log the boss vars and its dropped objects,
photograph every EVERY frames. Usage: dd3watch.py FRAMES EVERY [teleport_x teleport_z]"""
import sys, struct; sys.path.insert(0, '.')
from emu_run import *
from PIL import Image
N, every = int(sys.argv[1]), int(sys.argv[2])
e = Emu('rom/start11.md'); e.e.set_state(open('emu/lv11.state', 'rb').read()); e.run(2)
P = 0xFFFFC1E6; A4 = 0xFFFF0B6C
if len(sys.argv) > 4:
    tx, tz = int(sys.argv[3]), int(sys.argv[4])
    for _ in range(3):
        poke16(e, P + 6, tx); poke16(e, P + 0xE, tz); poke16(e, P + 0x8C, ((tz >> 5) << 8) + ((tx >> 5) << 1)); e.run(1)
shots = []
def rec(m, a): return [w16(m, a + o, True) for o in (0, 6, 0xA, 0xE, 0x22, 0x26, 0x28)] + ['%X' % (struct.unpack('>I', m[(a + 0x30) & 0xFFFF:(a + 0x34) & 0xFFFF])[0])]
START = int(__import__('os').environ.get('START', '0'))
for i in range(N):
    poke16(e, 0xFFFF0A5A, 50); e.run(1)
    m = mem(e)
    if i >= START and i % every == 0:
        print(i, 'S', [w16(m, P + o, True) for o in (6, 0xA, 0xE)], 'B', [w16(m, A4 + o, True) for o in (0, 4, 6, 0x1A, 0x14, 0x1C, 0x20, 0x3C, 0x24, 0x30)], 'rings', w16(m, 0xFFFF0A5A), 'hurt', w16(m, P + 0x3E, True), 'ctl', w16(m, P + 0x5C, True), w16(m, P + 0x60, True), w16(m, P + 0x62, True), w16(m, P + 0x6C, True), w16(m, P + 0x8E, True),
              'drop', rec(m, 0xFFFFCD3A), rec(m, 0xFFFFCD6E))
        shots.append(Image.fromarray(e.e.get_screen()))
cols = 5; sheet = Image.new('RGB', (320 * cols, 224 * ((len(shots) + cols - 1) // cols)))
for i, im in enumerate(shots): sheet.paste(im, ((i % cols) * 320, (i // cols) * 224))
sheet.save('out/watch/dd3.png')
