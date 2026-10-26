"""Private: emulator frame vs the decoded level art at the same camera position."""
import sys, numpy as np
from PIL import Image
sys.path.insert(0, '.')
from emu_run import *
import levelart
lid = int(sys.argv[1]); out = sys.argv[2]
e = Emu(f'rom/start{lid:02d}.md'); e.e.set_state(open(f'emu/lv{lid:02d}.state', 'rb').read()); e.run(3)
m = mem(e); cx, cy = w16(m, 0xFFFF084E, True), w16(m, 0xFFFF0850, True)
frame = Image.fromarray(e.e.get_screen()).convert('RGB')
d = open('rom/s3d.bin', 'rb').read()
a = levelart.render(d, lid)
crop = Image.fromarray(a[max(cy, 0):cy + frame.height, max(cx, 0):cx + frame.width]).convert('RGB')
W = Image.new('RGB', (frame.width * 2 + 8, frame.height), (255, 0, 255))
W.paste(frame, (0, 0)); W.paste(crop, (frame.width + 8, 0))
W.resize((W.width * 2, W.height * 2), Image.NEAREST).save(out)
print('camera', cx, cy, 'frame', frame.size)
