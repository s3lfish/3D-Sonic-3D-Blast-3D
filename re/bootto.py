import sys; sys.path.insert(0, '.')
from emu_run import *
def boot_to(e, index):
    e.e.set_state(open('emu/boot0.state', 'rb').read())
    for i in range(80):
        for _ in range(30):
            poke16(e, 0xFFFF067E, index); e.run(1)
        if i % 3 == 2: e.tap('START')
        m = mem(e)
        if w16(m, 0xFFFF0678) not in (0,) and i > 6:
            e.run(150); return w16(mem(e), 0xFFFF0678)
    return None
