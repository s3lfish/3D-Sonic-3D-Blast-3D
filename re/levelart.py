"""Level art (private RE tool): rebuild a level's whole isometric picture from the ROM.
Header +0x18: word offsets to 128 RNC2 rows (32 px each); row = 256 columns x 3 bytes = two 12-bit block refs.
  A = b0<<4 | b2>>4 → block table +0x14 (bit 0: priority toggle); B = b1<<4 | b2&15 → block table +0x10
  (bit 0 of B: mirror block A). Blocks: 4x4 tile words, row-major. Tile word: 0x8000 priority, 0x1000 v-flip,
  0x0800 h-flip, 0x2000 palette line 1, 0x4000 tile index + 0x800, low 11 bits tile index → raw tiles at +0x0C."""
import struct, sys
import numpy as np
import rnc, rnc2, sprites

def header(d, lid):
    h = 0x1AB62 + (lid - 1) * 0x2A
    return struct.unpack('>8I', d[h:h + 0x20]), list(d[h + 0x26:h + 0x2A])

def rows(d, lid):
    f, _ = header(d, lid); base = f[6]
    n = struct.unpack('>H', d[base:base + 2])[0] // 2
    offs = struct.unpack('>%dH' % n, d[base:base + 2 * n])
    return [rnc2.unpack(d, base + o)[0] for o in offs]

def cells(row):
    """per column: (A block number, A priority flag, B block number, mirror A)"""
    out = []
    for c in range(256):
        b0, b1, b2 = row[c * 3:c * 3 + 3]
        A = b0 << 4 | b2 >> 4; B = b1 << 4 | (b2 & 15)
        out.append((A >> 1, A & 1, B >> 1, B & 1))
    return out

def tile_pixels(d, gfx, idx):
    t = np.frombuffer(d[gfx + idx * 32:gfx + idx * 32 + 32], dtype=np.uint8)
    px = np.empty(64, dtype=np.uint8); px[0::2] = t >> 4; px[1::2] = t & 15
    return px.reshape(8, 8)

def static_vram(d, lid):
    """VRAM as the level loader leaves it: +0x08 tiles at 0, then the +0x1C load list (type 1 entries)."""
    f, _ = header(d, lid)
    vr = bytearray(0x10000)
    t = rnc.unpack(d, f[2]); vr[:len(t)] = t
    a = f[7]
    while True:
        k = struct.unpack('>H', d[a:a + 2])[0]
        if k == 0: break
        if k == 1:
            src, _, vd, ln = struct.unpack('>IIHH', d[a + 2:a + 14]); u = rnc.unpack(d, src)
            vr[vd:vd + ln * 2] = u[:ln * 2]; a += 14
        elif k == 2: a += 10
        else: a += 2
    return bytes(vr)

def render(d, lid, layers='BA', pris=(0, 1)):
    """Whole-level picture, 8192 x (rows*32). Streamed layer A: tiles from +0x0C, palette lines 0/1.
    Static layer B: VRAM tile words straight (tiles from static_vram), palette lines 0..3. Priority respected."""
    f, pals = header(d, lid)
    gfx, tabA, tabB = f[3], f[5], f[4]
    vr = static_vram(d, lid)
    ga = d[gfx:gfx + 0x1000 * 32]
    pal = np.zeros((4, 16, 4), dtype=np.uint8)
    for line in range(4):
        for k, c in enumerate(sprites.palette(d, pals[line])): pal[line, k] = (*c, 255 if k else 0)
    R = rows(d, lid)
    H, W = len(R) * 32, 256 * 32
    img = np.zeros((H, W, 4), dtype=np.uint8)
    cache = {}
    def tile(src, idx, w):
        key = (src is vr, idx, w & 0x7800)
        if key not in cache:
            t = np.frombuffer(src[idx * 32:idx * 32 + 32], dtype=np.uint8)
            p = np.empty(64, dtype=np.uint8); p[0::2] = t >> 4; p[1::2] = t & 15; p = p.reshape(8, 8)
            if w & 0x0800: p = p[:, ::-1]
            if w & 0x1000: p = p[::-1, :]
            cache[key] = pal[(w >> 13) & 3][p]
        return cache[key]
    passes = []          # (priority, layer, y, x, rgba)
    for r, row in enumerate(R):
        for c, (a, ap, b, mir) in enumerate(cells(row)):
            for ty in range(4):
                for tx in range(4):
                    y, x = r * 32 + ty * 8, c * 32 + tx * 8
                    if 'B' in layers and b:
                        w = struct.unpack('>H', d[tabB + b * 32 + ty * 8 + tx * 2:][:2])[0]
                        if w & 0x7FF: passes.append((w >> 15, 0, y, x, tile(vr, w & 0x7FF, w)))
                    if 'A' in layers and a:
                        col = 3 - tx if mir else tx
                        w = struct.unpack('>H', d[tabA + a * 32 + ty * 8 + col * 2:][:2])[0]
                        if mir: w ^= 0x0800
                        if ap: w ^= 0x8000
                        idx = (w & 0x7FF) + (0x800 if w & 0x4000 else 0)
                        if idx: passes.append((w >> 15, 1, y, x, tile(ga, idx, w & 0xBFFF)))
    for pri in pris:
        for lay in (0, 1):
            for p, l, y, x, t in passes:
                if p != pri or l != lay: continue
                m = t[:, :, 3] > 0
                img[y:y + 8, x:x + 8][m] = t[m]
    return img

if __name__ == '__main__':
    from PIL import Image
    d = open('rom/s3d.bin', 'rb').read(); lid = int(sys.argv[1])
    img = render(d, lid, sys.argv[3] if len(sys.argv) > 3 else 'BA')
    ys, xs = np.nonzero(img[:, :, 3])
    print('extent x', xs.min(), xs.max(), 'y', ys.min(), ys.max())
    Image.fromarray(img).crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)).save(sys.argv[2])
