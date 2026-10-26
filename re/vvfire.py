"""Private: VV1 fire bursts: Sonic held in a zone; log the four fireball slots ($CE0A + k*0x34) and the timer $A(a4)."""
import sys, struct; sys.path.insert(0, '.')
from emu_run import *
e = Emu('rom/start13.md'); e.e.set_state(open('emu/lv13.state', 'rb').read()); e.run(2)
P = 0xFFFFC1E6; A4 = 0xFFFF0B6C; X, Z = int(sys.argv[1]), int(sys.argv[2]); N = int(sys.argv[3])
for i in range(N):
    poke16(e, P + 6, X); poke16(e, P + 0xE, Z); poke16(e, P + 0x8C, ((Z >> 5) << 8) + ((X >> 5) << 1)); poke16(e, 0xFFFF0A5A, 50)
    e.run(1); m = mem(e)
    sl = [[w16(m, 0xFFFFCE0A + 0x34 * k + o, True) for o in (0, 6, 0xA, 0xE, 0x1E)] for k in range(4)]
    act = [s for s in sl if s[0] >= 0]
    if act or i % 20 == 0: print(i, 't', w16(m, A4 + 0xA), 'S', [w16(m, P + o, True) for o in (6, 0xA, 0xE)], 'rings', w16(m, 0xFFFF0A5A), act)
