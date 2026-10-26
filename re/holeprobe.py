"""Private: use each ring in turn ($0A5E) and stand on the hole next to it; record where Sonic comes out."""
import sys; sys.path.insert(0, '.')
from emu_run import *
lid = int(sys.argv[1]); holes = [tuple(int(v) for v in h.split(',')) for h in sys.argv[2:]]
e = Emu(f'rom/start{lid:02d}.md'); st = open(f'emu/lv{lid:02d}.state', 'rb').read(); P = 0xFFFFC1E6
def pos():
    m = mem(e); return (w16(m, P + 6, True), w16(m, P + 0xA, True), w16(m, P + 0xE, True))
e.e.set_state(st); e.run(2)
for n, (hx, hy, hz) in enumerate(holes):
    poke16(e, 0xFFFF0A5E, 1); e.run(30)
    x, z = hx + 15, hz + 5
    for _ in range(4):
        poke16(e, P + 6, x); poke16(e, P + 0xE, z); poke16(e, P + 0xA, hy); poke16(e, P + 0x8C, ((z >> 5) << 8) + ((x >> 5) << 1)); e.run(1)
    tr = []
    for i in range(900):
        e.run(1)
        if i % 75 == 0: tr.append(pos())
    m = mem(e)
    print('ring', n + 1, 'hole', (hx, hy, hz), 'section', w16(m, 0xFFFF06B2), '->', tr[-1], tr)
