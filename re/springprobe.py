"""Private: measure spring launch height and run speed in the original."""
import sys, struct; sys.path.insert(0, '.')
from emu_run import *
import rnc, levelart
d = open('rom/s3d.bin', 'rb').read(); lid = 1
f, _ = levelart.header(d, lid)
ob = rnc.unpack(d, f[0]); w = struct.unpack('>16384H', rnc.unpack(d, f[1]))
st = open(f'emu/lv{lid:02d}.state', 'rb').read()
e = Emu(f'rom/start{lid:02d}.md'); P = 0xFFFFC1E6
def pos():
    m = mem(e); return w16(m, P + 6, True), w16(m, P + 0xA, True), w16(m, P + 0xE, True)
# run speed
e.e.set_state(st); e.run(3); xs = []
for i in range(90): e.run(1, 'DOWN', 'RIGHT'); xs.append(pos()[0])
print('run speed units/frame by second:', [(xs[k] - xs[k - 10]) / 10 for k in range(10, 90, 10)])
springs = []
k = 0
while (k + 1) * 0x34 <= len(ob):
    r = ob[k * 0x34:(k + 1) * 0x34]; k += 1
    t, h = struct.unpack('>H', r[0x22:0x24])[0], struct.unpack('>I', r[0x30:0x34])[0]
    if not (h < 0x400000 and t < 0x400): break
    if t in (0x18, 0x158) and h: springs.append((t, *struct.unpack('>h', r[6:8]), *struct.unpack('>h', r[0xA:0xC]), *struct.unpack('>h', r[0xE:0x10])))
print(springs[:4])
for (t, x, y, z) in springs[:4]:
    e.e.set_state(st); e.run(2)
    for _ in range(4):
        poke16(e, P + 6, x); poke16(e, P + 0xE, z); poke16(e, P + 0xA, y + 24); poke16(e, P + 0x8C, ((z >> 5) << 8) + ((x >> 5) << 1)); e.run(1)
    ys = []
    for i in range(120): e.run(1); ys.append(pos()[1])
    print(hex(t), 'spring at', (x, y, z), 'ys', ys[:60:4], 'max rise above spring', max(ys) - y)
