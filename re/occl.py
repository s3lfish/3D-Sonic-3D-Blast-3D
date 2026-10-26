"""Private: how much of each terrain face is visible in the iso art (painter's ID buffer)."""
import struct, sys, rnc, numpy as np
from PIL import Image, ImageDraw
import levelart
d = open('rom/s3d.bin', 'rb').read(); lid = int(sys.argv[1])
f, _ = levelart.header(d, lid)
w = struct.unpack('>16384H', rnc.unpack(d, f[1]))
H = lambda cx, cz: None
def corners(cx, cz):
    if not (0 <= cx < 128 and 0 <= cz < 128): return None
    v = w[cz * 128 + cx]
    if not v: return None
    hb = v >> 8
    return [(hb + c) * 8 for c in ((v >> 6) & 3, (v >> 4) & 3, (v >> 2) & 3, v & 3)]
P = lambda x, y, z: (x - z + 4096, (x + z) / 2 - y)
faces = []  # (depth, kind, poly)
for cz in range(128):
    for cx in range(128):
        c = corners(cx, cz)
        if not c: continue
        X, Z = cx * 32, cz * 32
        pts = [(X, c[0], Z), (X + 32, c[1], Z), (X + 32, c[2], Z + 32), (X, c[3], Z + 32)]
        faces.append((sum(p[0] + p[1] + p[2] for p in pts) / 4, 'top', [P(*p) for p in pts]))
        # east wall (corners 1,2 against neighbour's 0,3) and south wall (2,3 against neighbour's 1,0)
        for (a, b, dx, dz, na, nb, kind) in ((1, 2, 1, 0, 0, 3, 'east'), (2, 3, 0, 1, 1, 0, 'south')):
            n = corners(cx + dx, cz + dz)
            ba, bb = (n[na], n[nb]) if n else (-600, -600)
            if c[a] <= ba and c[b] <= bb: continue
            pa, pb = pts[a], pts[b]
            q = [(pa[0], c[a], pa[2]), (pa[0], min(ba, c[a]), pa[2]), (pb[0], min(bb, c[b]), pb[2]), (pb[0], c[b], pb[2])]
            faces.append((sum(p[0] + p[1] + p[2] for p in q) / 4, kind, [P(*p) for p in q]))
faces.sort(key=lambda t: t[0])
img = Image.new('I', (8192, 4096), -1); dr = ImageDraw.Draw(img)
for i, (_, k, poly) in enumerate(faces): dr.polygon(poly, fill=i)
ids = np.array(img); cnt = np.bincount(ids[ids >= 0].ravel(), minlength=len(faces))
for kind in ('top', 'east', 'south'):
    idx = [i for i, t in enumerate(faces) if t[1] == kind]
    area = []
    for i in idx:
        m = Image.new('1', (8192, 4096)); ImageDraw.Draw(m).polygon(faces[i][2], fill=1) if False else None
    # area via shoelace
    vis = []
    for i in idx:
        p = faces[i][2]; a = abs(sum(p[k][0] * p[(k + 1) % 4][1] - p[(k + 1) % 4][0] * p[k][1] for k in range(4))) / 2
        vis.append(min(1, cnt[i] / a) if a > 1 else 1)
    vis = np.array(vis)
    print(kind, len(idx), 'fully(>95%)', (vis > .95).mean().round(3), 'mostly(>60%)', (vis > .6).mean().round(3), 'hidden(<5%)', (vis < .05).mean().round(3))
