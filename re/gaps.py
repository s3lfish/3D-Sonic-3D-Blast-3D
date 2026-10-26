"""Private: where does the walkable area around one point come closest to the area that leads to another?"""
import struct, rnc, collections, sys
d = open('rom/s3d.bin', 'rb').read()
lid = int(sys.argv[1]); h = 0x1AB62 + (lid - 1) * 0x2A
f = struct.unpack('>9I', d[h:h + 0x24])
w = list(struct.unpack('>16384H', rnc.unpack(d, f[1])))
def cor(cx, cz):
    if not (0 <= cx < 128 and 0 <= cz < 128): return None
    v = w[cz * 128 + cx]
    if not v: return None
    hb = v >> 8; return [(hb + ((v >> s) & 3)) * 8 for s in (6, 4, 2, 0)]
N = ((1, 0, (1, 2), (0, 3)), (-1, 0, (0, 3), (1, 2)), (0, 1, (3, 2), (0, 1)), (0, -1, (0, 1), (3, 2)))
UP = 56
def step_ok(c, n, e): return max(n[e[3][0]], n[e[3][1]]) - max(c[e[2][0]], c[e[2][1]]) <= UP
def reach(start, reverse=False):
    seen = {start}; q = collections.deque([start])
    while q:
        cx, cz = q.popleft()
        for e in N:
            nx, nz = cx + e[0], cz + e[1]
            if (nx, nz) in seen or not cor(nx, nz): continue
            ok = step_ok(cor(nx, nz), cor(cx, cz), (-e[0], -e[1], e[3], e[2])) if reverse else step_ok(cor(cx, cz), cor(nx, nz), e)
            if ok: seen.add((nx, nz)); q.append((nx, nz))
    return seen
a = tuple(int(v) // 32 for v in sys.argv[2].split(',')); b = tuple(int(v) // 32 for v in sys.argv[3].split(','))
RA, RB = reach(a), reach(b, True)
print('from A', len(RA), 'cells; cells that lead to B', len(RB), '; A reaches B', b in RA)
best = []
for (cx, cz) in RA:
    for e in N:
        n = (cx + e[0], cz + e[1])
        if n in RB and n not in RA:
            c, m = cor(cx, cz), cor(*n)
            best.append((max(m[e[3][0]], m[e[3][1]]) - max(c[e[2][0]], c[e[2][1]]), (cx, cz), n))
best.sort()
print('smallest climbs from A-area into B-area (units, from, to):', best[:12])
