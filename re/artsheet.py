"""Private: contact sheet of every object-art block's first frames (palette 3)."""
import struct, sprites, sys
from PIL import Image, ImageDraw
d = open('rom/s3d.bin', 'rb').read()
blocks = [(int(a, 16), int(n)) for a, n in (l.split() for l in open('out/artblocks.txt'))]
pal = sprites.palette(d, int(sys.argv[2]) if len(sys.argv) > 2 else 3)
def frame(base, i):
    t = base + 0x10; off = struct.unpack('>I', d[t + i * 4:t + i * 4 + 4])[0]; F = t + off
    n = struct.unpack('>H', d[F:F + 2])[0] + 1; words = struct.unpack('>H', d[F - 2:F])[0]; doff = struct.unpack('>h', d[F - 4:F - 2])[0]
    pieces = []
    for k in range(n):
        x, xf = struct.unpack('>bb', d[F + 2 + k * 6:F + 4 + k * 6]); y, at = struct.unpack('>hH', d[F + 4 + k * 6:F + 8 + k * 6]); size = at >> 8
        pieces.append(dict(x=x, xf=xf, y=y, w=((size >> 2) & 3) + 1, h=(size & 3) + 1, tile=at & 0xFF))
    return pieces, d[F + doff:F + doff + words * 2]
COLS = 4; S = 80
W = Image.new('RGB', (S * COLS * 4 + 8, S * ((len(blocks) + 3) // 4) ), (60, 60, 60)); dr = ImageDraw.Draw(W)
for bi, (b, n) in enumerate(blocks):
    ox, oy = (bi % 4) * (S * COLS + 2), (bi // 4) * S
    for k, fi in enumerate([0, n // 3, 2 * n // 3, n - 1][:COLS]):
        try:
            p, a = frame(b, fi); im = sprites.render(p, a, pal, size=S, origin=(S // 2, S - 16))
            W.paste(im.convert('RGB'), (ox + k * S, oy), im)
        except Exception: pass
    dr.text((ox + 2, oy + 2), f'{b:x}', fill=(255, 255, 0))
W.save(sys.argv[1])
