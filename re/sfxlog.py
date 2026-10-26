"""Private: log the sound IDs the game queues ($0AC4 effects, $0AC6 music) while Sonic does things. Uses a private
copy of the ROM with the two clears in the send routine (0x24FAE, 0x24FBE) replaced by NOPs, so IDs stay readable."""
import sys, struct, json; sys.path.insert(0, '.')
from emu_run import *
e = Emu('rom/start01_log.md'); e.e.set_state(open('emu/lv01.state', 'rb').read()); e.run(2)
P = 0xFFFFC1E6; log = []
def tick(n=1, *b, tag=''):
    for _ in range(n):
        e.run(1, *b); m = mem(e)
        for a in (0xFFFF0AC4, 0xFFFF0AC6):
            v = w16(m, a)
            if v: log.append((tag, hex(a), hex(v))); poke16(e, a, 0)
def put(x, y, z):
    for _ in range(3):
        poke16(e, P + 6, x); poke16(e, P + 0xE, z); poke16(e, P + 0xA, y); poke16(e, P + 0x8C, ((z >> 5) << 8) + ((x >> 5) << 1)); e.run(1)
    tx, ty = (x - z + 4096) - 160, (x + z) // 2 - y - 120
    for _ in range(20):
        for a, v in ((0xFFFF084E, tx), (0xFFFF0852, tx), (0xFFFF0850, ty), (0xFFFF0854, ty)): poke16(e, a, v)
        e.run(1)
    m = mem(e)
    for a in (0xFFFF0AC4, 0xFFFF0AC6): poke16(e, a, 0)
st = e.e.get_state()
tick(30, tag='idle')
tick(6, 'A', tag='jump'); tick(60, tag='jump')
e.e.set_state(st); tick(45, 'B', tag='dashcharge'); tick(30, tag='dashrelease')
L = json.load(open('out/lv1_1.json')); x0, z0 = L['rom']['origin']
import rnc
d = open('rom/s3d.bin', 'rb').read(); h = 0x1AB62
W = struct.unpack('>16384H', rnc.unpack(d, struct.unpack('>I', d[h + 4:h + 8])[0]))
def floor(x, z):
    v = W[(z >> 5) * 128 + (x >> 5)]
    return (v >> 8) * 8 + 8 * max((v >> 6) & 3, (v >> 4) & 3, (v >> 2) & 3, v & 3)
for kind, n, dy, extra in (('ring', 3, 12, ()), ('spring', 2, 40, ()), ('monitor', 3, 50, ('A',)), ('enemy', 3, 50, ('A',)), ('mine', 2, 30, ()), ('turret', 1, 4, ()), ('goal', 1, 70, ())):
    ents = [en for en in L['entities'] if en['type'] == kind][:n]
    for en in ents:
        e.e.set_state(st); e.run(1)
        x, z = int((en['x'] + x0) * 32), int((en['z'] + z0) * 32)
        if extra: tick(4, *extra, tag='jumpstart')
        put(x, floor(x, z) + dy, z)
        tick(90, tag=kind)
print(json.dumps(log))
