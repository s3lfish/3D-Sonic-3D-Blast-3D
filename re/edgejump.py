"""Private: walk Sonic +x off flat floor cells whose east neighbour has no floor (map word 0). Does he fall or stop?"""
import sys, struct; sys.path.insert(0, '.')
from emu_run import *
import rnc
d = open('rom/s3d.bin', 'rb').read()
lid = int(sys.argv[1]); h = 0x1AB62 + (lid - 1) * 0x2A
w = struct.unpack('>16384H', rnc.unpack(d, struct.unpack('>I', d[h + 4:h + 8])[0]))
st = open(f'emu/lv{lid:02d}.state', 'rb').read()
e = Emu(f'rom/start{lid:02d}.md'); P = 0xFFFFC1E6
def pos():
    m = mem(e); return w16(m, P + 6, True), w16(m, P + 0xA, True), w16(m, P + 0xE, True)
flat = lambda v: v and not (v & 0xFF)
cands = []
for cz in range(2, 126):
    for cx in range(2, 125):
        A, A0, B = w[cz * 128 + cx], w[cz * 128 + cx - 1], w[cz * 128 + cx + 1]
        if flat(A) and flat(A0) and (A >> 8) == (A0 >> 8) and B == 0 and flat(w[(cz - 1) * 128 + cx]) and flat(w[(cz + 1) * 128 + cx]):
            cands.append((cx, cz))
print(len(cands), 'edge spots; testing', cands[:: max(1, len(cands) // 6)][:6])
for cx, cz in cands[:: max(1, len(cands) // 6)][:6]:
    e.e.set_state(st); e.run(2)
    fy = (w[cz * 128 + cx] >> 8) * 8 - 8
    for _ in range(4):
        poke16(e, P + 6, cx * 32 + 6); poke16(e, P + 0xE, cz * 32 + 16); poke16(e, P + 0xA, fy); poke16(e, P + 0x8C, (cz << 8) + (cx << 1)); e.run(1)
    e.run(15); s = pos()
    tr = []
    for i in range(70): e.run(1, 'DOWN', 'RIGHT', *(['C'] if 8 <= i < 30 else [])); tr.append(pos())
    t = tr[-1]
    print((cx, cz), 'start', s, 'end', t, 'max x', max(p[0] for p in tr), 'edge at', (cx + 1) * 32, '->', 'FELL' if t[1] < s[1] - 16 else ('crossed?' if t[0] > (cx + 1) * 32 else 'stopped'))
