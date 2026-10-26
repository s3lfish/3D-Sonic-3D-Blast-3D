"""Private: walk Sonic +x from one flat cell into its neighbour for many height differences (up and down), all levels."""
import sys, struct; sys.path.insert(0, '.')
from emu_run import *
import rnc, levelart
d = open('rom/s3d.bin', 'rb').read()
lid = int(sys.argv[1])
f, _ = levelart.header(d, lid)
w = struct.unpack('>16384H', rnc.unpack(d, f[1]))
st = open(f'emu/lv{lid:02d}.state', 'rb').read()
e = Emu(f'rom/start{lid:02d}.md'); P = 0xFFFFC1E6
def pos():
    m = mem(e); return w16(m, P + 6, True), w16(m, P + 0xA, True), w16(m, P + 0xE, True)
flat = lambda v: v and not (v & 0xFF)
pairs = {}
for cz in range(2, 126):
    for cx in range(2, 125):
        A, B, A0 = w[cz * 128 + cx], w[cz * 128 + cx + 1], w[cz * 128 + cx - 1]
        if flat(A) and flat(A0) and (A >> 8) == (A0 >> 8) and B:
            hb = (B >> 8) * 8 + max((B >> 6) & 3, (B >> 0) & 3) * 8   # west edge of B: corners NW, SW
            dd = hb - (A >> 8) * 8
            pairs.setdefault(dd, []).append((cx, cz))
res = []
for dd in sorted(pairs):
    if not -96 <= dd <= 64: continue
    for (cx, cz) in pairs[dd][:2]:
        e.e.set_state(st); e.run(2)
        fy = (w[cz * 128 + cx] >> 8) * 8
        for _ in range(3):
            poke16(e, P + 6, cx * 32 + 8); poke16(e, P + 0xE, cz * 32 + 16); poke16(e, P + 0xA, fy); poke16(e, P + 0x8C, (cz << 8) + (cx << 1)); e.run(1)
        e.run(15); s = pos()
        if abs(s[0] - (cx * 32 + 8)) > 4: continue
        e.run(45, 'DOWN', 'RIGHT'); t = pos()
        res.append((dd, 'crossed' if t[0] > (cx + 1) * 32 + 2 else 'blocked', t[0] - s[0], t[1] - s[1]))
        break
for r in res: print(lid, *r)
