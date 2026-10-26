"""Private: put Sonic at a cell, hold a sequence, print speed (units/frame, from the 16.16 velocity longs) each frame.
Usage: speedprobe.py LEVEL cx cz 'BTN+BTN:frames,...'"""
import sys, struct; sys.path.insert(0, '.')
from emu_run import *
import rnc
lid, cx, cz, seq = int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
d = open('rom/s3d.bin', 'rb').read(); h = 0x1AB62 + (lid - 1) * 0x2A
w = struct.unpack('>16384H', rnc.unpack(d, struct.unpack('>I', d[h + 4:h + 8])[0]))
fy = (w[cz * 128 + cx] >> 8) * 8 - 8
e = Emu(f'rom/start{lid:02d}.md'); e.e.set_state(open(f'emu/lv{lid:02d}.state', 'rb').read()); e.run(2)
P = 0xFFFFC1E6
for _ in range(3):
    poke16(e, P + 6, cx * 32 + 16); poke16(e, P + 0xE, cz * 32 + 16); poke16(e, P + 0xA, fy); poke16(e, P + 0x8C, (cz << 8) + (cx << 1)); e.run(1)
e.run(60)
def l32(m, a):
    return struct.unpack('>i', m[(a & 0xFFFF):(a & 0xFFFF) + 4])[0] / 65536
f = 0
for part in seq.split(','):
    btns, n = part.split(':'); btns = [b for b in btns.split('+') if b and b != 'NONE']
    for i in range(int(n)):
        e.run(1, *btns); f += 1; m = mem(e)
        vx, vz = l32(m, P + 0x12), l32(m, P + 0x1A)
        print(f, "%.4f %.4f" % (vx, vz), "vy %.3f" % l32(m, P + 0x16), "gr", w16(m, P + 0x44), "56:", w16(m, P + 0x56), "5c:", w16(m, P + 0x5C), "84:", w16(m, P + 0x84), 'x', w16(m, P + 6, True), 'z', w16(m, P + 0xE, True), 'face %X' % w16(m, P + 0x32), 'aca', w16(m, 0xFFFF0ACA))
