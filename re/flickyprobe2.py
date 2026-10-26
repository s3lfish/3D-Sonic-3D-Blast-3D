"""Private: jump, then steer Sonic onto an enemy's live RAM position from above; photograph what pops out."""
import sys, struct; sys.path.insert(0, '.')
from emu_run import *
from vdp import *
from PIL import Image
e = Emu('rom/start01.md'); st = open('emu/lv01.state', 'rb').read(); P = 0xFFFFC1E6
SCR = 'out/'
def rd(m, a): return w16(m, a, True)
for base in (0xCD14 - 0xE, 0xCDB0 - 0xE, 0xCEE8 - 0xE):
    e.e.set_state(st); e.run(2)
    m = mem(e); ex, ey, ez = rd(m, 0xFFFF0000 | (base + 6)), rd(m, 0xFFFF0000 | (base + 0xA)), rd(m, 0xFFFF0000 | (base + 0xE))
    # jump from wherever Sonic is
    e.run(4, 'C')
    for i in range(40):
        m = mem(e); ex, ey, ez = rd(m, 0xFFFF0000 | (base + 6)), rd(m, 0xFFFF0000 | (base + 0xA)), rd(m, 0xFFFF0000 | (base + 0xE))
        if i < 6:
            poke16(e, P + 6, ex); poke16(e, P + 0xE, ez); poke16(e, P + 0xA, ey + 24 - i * 3); poke16(e, P + 0x8C, ((ez >> 5) << 8) + ((ex >> 5) << 1))
        e.run(1, 'C')
    alive_after = rd(mem(e), 0xFFFF0000 | (base + 6))
    shots = []
    for i in range(8):
        e.run(6); shots.append(Image.fromarray(e.e.get_screen()).convert('RGB'))
    W = Image.new('RGB', (320 * 4, 224 * 2))
    for k, im in enumerate(shots): W.paste(im, ((k % 4) * 320, (k // 4) * 224))
    W.save(SCR + f'flpop_{base:04x}.png')
    m = mem(e); print(hex(base), 'enemy at', (ex, ey, ez), 'sonic', (rd(m, P + 6), rd(m, P + 0xA), rd(m, P + 0xE)), 'followers', w16(m, 0xFFFF0A8E))
    open(SCR + f'flpop_{base:04x}.state', 'wb').write(e.e.get_state())
