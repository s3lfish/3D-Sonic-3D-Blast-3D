"""Private: put Sonic in GG1's cannon (cell 116, 12, just above y 248) and press jump; log where he flies."""
import sys; sys.path.insert(0, '.')
from emu_run import *
from PIL import Image
btn = sys.argv[1] if len(sys.argv) > 1 else 'B'
e = Emu('rom/start01.md'); e.e.set_state(open('emu/lv01.state', 'rb').read()); e.run(2)
P = 0xFFFFC1E6
x, z, y = 116 * 32 + 13, 12 * 32 + 3, 253
for _ in range(4):
    poke16(e, P + 6, x); poke16(e, P + 0xE, z); poke16(e, P + 0xA, y); poke16(e, P + 0x8C, (12 << 8) + (116 << 1)); e.run(1)
def st():
    m = mem(e); return [w16(m, P + o, True) for o in (6, 0xA, 0xE)] + [w16(m, P + 0x64), w16(m, P + 0x8C)]
print('placed', st())
e.run(30); print('after 30', st())
shots = []
for i in range(6): e.run(1, btn)
log = []
for i in range(260):
    e.run(1); log.append(st())
    if i % 20 == 0: shots.append(Image.fromarray(e.e.get_screen()))
for i in range(0, 260, 10): print(i, log[i])
sheet = Image.new('RGB', (320 * 5, 224 * ((len(shots) + 4) // 5)))
for i, im in enumerate(shots): sheet.paste(im, ((i % 5) * 320, (i // 5) * 224))
sheet.save('out/watch/cannon.png')
