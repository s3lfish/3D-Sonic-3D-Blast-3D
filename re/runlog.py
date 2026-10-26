"""Private: from a level's start state, hold buttons (sequence 'BTN+BTN:frames,...'), log Sonic (x, y, z), state $64,
the pad lock $0A18, and save a screenshot every SHOT frames. Usage: python3 runlog.py LEVEL 'DOWN:300,DOWN+C:10' [every]"""
import sys, os; sys.path.insert(0, '.')
from emu_run import *
from PIL import Image
lid, seq = int(sys.argv[1]), sys.argv[2]; every = int(sys.argv[3]) if len(sys.argv) > 3 else 10
SHOT = int(os.environ.get('SHOT', '0'))
e = Emu(f'rom/start{lid:02d}.md'); e.e.set_state(open(f'emu/lv{lid:02d}.state', 'rb').read()); e.run(2)
P = 0xFFFFC1E6; f = 0; shots = []
for part in seq.split(','):
    btns, n = part.split(':'); btns = [b for b in btns.split('+') if b and b != 'NONE']
    for i in range(int(n)):
        e.run(1, *btns); f += 1; m = mem(e)
        if f % every == 0:
            print(f, [w16(m, P + o, True) for o in (6, 0xA, 0xE)], 'st %X' % w16(m, P + 0x64), 'lock', w16(m, 0xFFFF0A18), 'pad %X' % w16(m, 0xFFFF0A1A), 'cell %04X' % w16(m, P + 0x8C), 'rings', w16(m, 0xFFFF0A5A), 'aca', w16(m, 0xFFFF0ACA), 'v', w16(m, P + 0x12, True), w16(m, P + 0x1A, True))
        if SHOT and f % SHOT == 0: shots.append(Image.fromarray(e.e.get_screen()))
if shots:
    cols = 4; sheet = Image.new('RGB', (320 * cols, 224 * ((len(shots) + cols - 1) // cols)))
    for i, im in enumerate(shots): sheet.paste(im, ((i % cols) * 320, (i // cols) * 224))
    sheet.save(f'out/watch/runlog_{lid}.png')
