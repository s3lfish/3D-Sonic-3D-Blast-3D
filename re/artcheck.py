"""Private: overlay projected terrain cell outlines on the decoded level art to check alignment."""
import struct, sys, rnc, numpy as np
from PIL import Image, ImageDraw
import levelart
d = open('rom/s3d.bin', 'rb').read(); lid = int(sys.argv[1]); out = sys.argv[2]
dx, dy = (int(v) for v in sys.argv[3:5]) if len(sys.argv) > 4 else (0, 0)
f, _ = levelart.header(d, lid)
w = struct.unpack('>16384H', rnc.unpack(d, f[1]))
a = levelart.render(d, lid); bg = np.array([*levelart.sprites.palette(d, levelart.header(d, lid)[1][0])[0], 255], dtype=np.uint8)
a[a[:, :, 3] == 0] = bg
img = Image.fromarray(a).convert('RGB'); dr = ImageDraw.Draw(img)
P = lambda x, y, z: (x - z + 4096 + dx, (x + z) / 2 - y + dy)
for i, v in enumerate(w):
    if not v: continue
    cx, cz = i % 128, i // 128; hb = v >> 8
    cs = [(v >> 6) & 3, (v >> 4) & 3, (v >> 2) & 3, v & 3]
    pts = [(cx * 32, cz * 32), (cx * 32 + 32, cz * 32), (cx * 32 + 32, cz * 32 + 32), (cx * 32, cz * 32 + 32)]
    q = [P(x, (hb + c) * 8, z) for (x, z), c in zip(pts, cs)]
    dr.line(q + [q[0]], fill=(255, 0, 255, 255), width=1)
box = tuple(int(v) for v in sys.argv[5].split(',')) if len(sys.argv) > 5 else None
(img.crop(box) if box else img).save(out)
