"""Private: make GG1 think its last big ring was used ($06B2 = 6, $0A5E = 1) and photograph what follows."""
import sys; sys.path.insert(0, '.')
from emu_run import *
from PIL import Image, ImageDraw
e = Emu('rom/start01.md'); e.e.set_state(open('emu/lv01.state', 'rb').read()); e.run(5)
P = 0xFFFFC1E6
x, z, fy = 1312, 1088, 544
for _ in range(3):
    poke16(e, P + 6, x); poke16(e, P + 0xE, z); poke16(e, P + 0xA, fy); poke16(e, P + 0x8C, ((z >> 5) << 8) + ((x >> 5) << 1)); e.run(1)
poke16(e, 0xFFFF06B2, 6); e.run(1); poke16(e, 0xFFFF0A5E, 1)
shots = []
N = int(sys.argv[1]) if len(sys.argv) > 1 else 900
for i in range(N):
    e.run(1)
    if i % 60 == 0: m = mem(e); print(i, [hex(w16(m, a)) for a in (0xFFFF0A18, 0xFFFF0A1A, 0xFFFF0A1E, 0xFFFF06B2, 0xFFFF0678)])
    if i % 30 == 0:
        im = Image.fromarray(e.e.get_screen()); ImageDraw.Draw(im).text((4, 210), str(i), fill=(255, 255, 0)); shots.append(im)
    if i in (int(a) for a in sys.argv[2:]): open(f'out/clear/state_{i}.state', 'wb').write(e.e.get_state()); Image.fromarray(e.e.get_screen()).save(f'out/clear/f{i}.png')
cols = 6; sheet = Image.new('RGB', (320 * cols, 224 * ((len(shots) + cols - 1) // cols)))
for i, im in enumerate(shots): sheet.paste(im, ((i % cols) * 320, (i // cols) * 224))
sheet.resize((sheet.width // 2, sheet.height // 2)).save('out/clear/sheet.png')
