"""Private: GG1's cracked wall (type 28). Read the map in RAM around it, then spin dash into it from the south."""
import sys; sys.path.insert(0, '.')
from emu_run import *
from PIL import Image
e = Emu('rom/start01.md'); e.e.set_state(open('emu/lv01.state', 'rb').read()); e.run(2)
P = 0xFFFFC1E6
cx, cz = int(sys.argv[1]), int(sys.argv[2]); y = 226
x, z = cx * 32 + 16, cz * 32 + 16
for _ in range(4):
    poke16(e, P + 6, x); poke16(e, P + 0xE, z); poke16(e, P + 0xA, y); poke16(e, P + 0x8C, (cz << 8) + (cx << 1)); e.run(1)
def grid(tag):
    m = mem(e); print(tag)
    for zz in range(12, 20): print(' ', zz, ' '.join(f"{w16(m, 0xFFFF3EC6 + (zz * 128 + xx) * 2):04x}" for xx in range(104, 112)))
def pos(): m = mem(e); return [w16(m, P + o, True) for o in (6, 0xA, 0xE)]
e.run(200); grid('after 200 frames'); print('sonic', pos())
shots = []
for i in range(6): e.run(1, 'UP', 'RIGHT')
print('facing', pos())
for i in range(8): e.run(1)
for i in range(40): e.run(1, 'B')
for i in range(60):
    e.run(1)
    if i % 6 == 0: shots.append(Image.fromarray(e.e.get_screen()))
    if i in (10, 20): grid(f'dash +{i}'); print('sonic', pos())
grid('after the spin dash'); print('sonic', pos())
sheet = Image.new('RGB', (320 * 5, 224 * ((len(shots) + 4) // 5)))
for i, im in enumerate(shots): sheet.paste(im, ((i % 5) * 320, (i // 5) * 224))
sheet.save('out/watch/crackwall.png')
