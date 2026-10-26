"""Private: cells where map RAM differs from the ROM map at level start."""
import sys, struct; sys.path.insert(0, '.')
from emu_run import *
import rnc
lid = int(sys.argv[1])
d = open('rom/s3d.bin', 'rb').read(); h = 0x1AB62 + (lid - 1) * 0x2A
w = struct.unpack('>16384H', rnc.unpack(d, struct.unpack('>I', d[h + 4:h + 8])[0]))
e = Emu(f'rom/start{lid:02d}.md'); e.e.set_state(open(f'emu/lv{lid:02d}.state', 'rb').read()); e.run(30)
m = mem(e); out = []
for i in range(16384):
    v = w16(m, 0xFFFF3EC6 + 2 * i)
    if v != w[i]: out.append(((i % 128, i // 128), hex(w[i]), hex(v)))
print(len(out)); print(out)
