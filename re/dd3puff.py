"""Private: DD3 boss low phase: log boss, one orbiting blower, and the snow puff records ($D012 + k*0x34)."""
import sys, struct; sys.path.insert(0, '.')
from emu_run import *
e = Emu('rom/start11.md'); e.e.set_state(open('emu/lv11.state', 'rb').read()); e.run(2)
P = 0xFFFFC1E6; A4 = 0xFFFF0B6C
for _ in range(3):
    poke16(e, P + 6, 1800); poke16(e, P + 0xE, 1800); poke16(e, P + 0x8C, ((1800 >> 5) << 8) + ((1800 >> 5) << 1)); e.run(1)
def rec(m, a): return [w16(m, a + o, True) for o in (0, 6, 0xA, 0xE, 0x12, 0x1C, 0x1E, 0x22, 0x24)] + ['%X' % (struct.unpack('>I', m[(a + 0x30) & 0xFFFF:(a + 0x34) & 0xFFFF])[0])]
lo, hi, step = int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3])
for i in range(hi):
    poke16(e, 0xFFFF0A5A, 50); e.run(1)
    if i >= lo and i % step == 0:
        m = mem(e)
        print(i, 'S', [w16(m, P + o, True) for o in (6, 0xA, 0xE)], 'fr', w16(m, P + 0x3E, True), 'B', [w16(m, A4 + o, True) for o in (0, 4, 6, 0x30, 0x26)], 'orb', rec(m, 0xFFFFCDA2)[:5], 'puff0', rec(m, 0xFFFFD012), 'puff7', rec(m, 0xFFFFD012 + 7 * 0x34)[:5])
