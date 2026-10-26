"""Private: Volcano Valley 3's boss from its save state, Sonic held with 50 rings; log the boss vars and photograph."""
import sys, struct, os; sys.path.insert(0, '.')
from emu_run import *
from PIL import Image
N, every = int(sys.argv[1]), int(sys.argv[2]); START = int(os.environ.get('START', '0'))
e = Emu('rom/start14.md'); e.e.set_state(open('emu/lv14.state', 'rb').read()); e.run(2)
P = 0xFFFFC1E6; A4 = 0xFFFF0B6C; shots = []
for i in range(N):
    poke16(e, 0xFFFF0A5A, 50); e.run(1); m = mem(e)
    if i >= START and i % every == 0:
        print(i, 'S', [w16(m, P + o, True) for o in (6, 0xA, 0xE)], 'pod y', w16(m, 0xFFFFCCDC, True), 'B', [w16(m, A4 + o, True) for o in (2, 4, 6, 0xA, 0xC, 0x1C, 0x3C, 0x38)],
              'seg0', [w16(m, 0xFFFFCEDA + o, True) for o in (6, 0xA, 0xE)], 'ball', [w16(m, 0xFFFFCEA6 + o, True) for o in (0, 6, 0xA, 0xE)])
        shots.append(Image.fromarray(e.e.get_screen()))
cols = 5; sheet = Image.new('RGB', (320 * cols, 224 * ((len(shots) + cols - 1) // cols)))
for i, im in enumerate(shots): sheet.paste(im, ((i % cols) * 320, (i // cols) * 224))
sheet.save('out/watch/vv3.png')
