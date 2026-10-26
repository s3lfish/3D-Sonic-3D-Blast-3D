"""Private: find every object-art block (16-byte header, long offset table, frames of pieces + raw tiles) in the ROM."""
import struct, sprites
from PIL import Image, ImageDraw
d = open('rom/s3d.bin', 'rb').read()
def frames(base):
    t = base + 0x10
    first = struct.unpack('>I', d[t:t + 4])[0]
    if first % 4 or not (4 <= first <= 0x200): return None
    n = first // 4; out = []; prev = 0
    for i in range(n):
        off = struct.unpack('>I', d[t + i * 4:t + i * 4 + 4])[0]
        if off < first or off > 0x8000 or off <= prev and i: break
        prev = off; F = t + off
        if F + 8 > len(d): break
        cnt = struct.unpack('>H', d[F:F + 2])[0] + 1; words = struct.unpack('>H', d[F - 2:F])[0]; doff = struct.unpack('>h', d[F - 4:F - 2])[0]
        if not (1 <= cnt <= 12 and 4 <= words <= 1200 and doff == 2 + cnt * 6): break
        out.append(F)
    return out if len(out) >= max(2, n - 1) else None
found = []
for base in range(0x20000, len(d) - 0x40, 2):
    fr = frames(base)
    if fr and len(fr) >= 2: found.append((base, len(fr)))
# drop blocks nested in others' tables
print(len(found), 'blocks')
open('out/artblocks.txt', 'w').write('\n'.join(f'{b:#x} {n}' for b, n in found))
