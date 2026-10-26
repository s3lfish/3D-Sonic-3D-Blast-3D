"""Private: more sound IDs: hurt with rings, mine, act end (see sfxlog.py)."""
import sys, struct, json; sys.path.insert(0, '.')
exec(open('sfxlog.py').read().split("st = e.e.get_state()")[0])
import rnc
d = open('rom/s3d.bin', 'rb').read(); h = 0x1AB62
W = struct.unpack('>16384H', rnc.unpack(d, struct.unpack('>I', d[h + 4:h + 8])[0]))
def floor(x, z):
    v = W[(z >> 5) * 128 + (x >> 5)]
    return (v >> 8) * 8 + 8 * max((v >> 6) & 3, (v >> 4) & 3, (v >> 2) & 3, v & 3)
st = e.e.get_state()
L = json.load(open('out/lv1_1.json')); x0, z0 = L['rom']['origin']
for kind in ('enemy', 'mine', 'turret'):
    en = [q for q in L['entities'] if q['type'] == kind][0]
    e.e.set_state(st); e.run(1); poke16(e, 0xFFFF0A5A, 10)
    x, z = int((en['x'] + x0) * 32), int((en['z'] + z0) * 32)
    put(x - 40, floor(x - 40, z) + 2, z); poke16(e, 0xFFFF0A5A, 10)
    tick(120, 'DOWN', 'RIGHT', tag='hurt-' + kind)
# act end
e.e.set_state(st); e.run(1)
put(1312, 546, 1088); poke16(e, 0xFFFF06B2, 6); tick(1); poke16(e, 0xFFFF0A5E, 1)
tick(700, tag='actend')
print(json.dumps(log))
