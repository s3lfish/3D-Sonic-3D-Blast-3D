import sys; sys.path.insert(0, '.')
from emu_run import *
lid = int(sys.argv[1])
e = Emu(f'rom/start{lid:02d}.md')
for i in range(60):
    e.run(60)
    if i % 3 == 2: e.tap('START')
    if w16(mem(e), 0xFFFF0678) == lid and i > 6:
        e.run(180); break
ok = w16(mem(e), 0xFFFF0678) == lid
if ok: open(f'emu/lv{lid:02d}.state', 'wb').write(e.e.get_state())
print(lid, 'ok' if ok else 'FAILED')
