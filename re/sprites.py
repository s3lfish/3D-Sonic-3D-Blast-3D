"""Player (and similar) sprite frames: table at 0x100000 of longs (cmdBytes/2 << 24 | offset from 0x100000).
Frame F: word count-1, then per piece 6 bytes [x, x_flipped, y(word), size<<8 | tile_offset];
word F-2 = tile data size in words; word F-4 = offset from F to the command stream; longs follow the commands."""
import struct
TABLE = 0x100000
def frame_count(d): return (struct.unpack('>I', d[TABLE:TABLE + 4])[0] & 0xFFFFFF) // 4
def frame(d, i, table=TABLE):
    ent = struct.unpack('>I', d[table + i * 4:table + i * 4 + 4])[0]
    half, F = ent >> 24, table + (ent & 0xFFFFFF)
    n = struct.unpack('>H', d[F:F + 2])[0] + 1
    pieces = []
    for k in range(n):
        x, xf = struct.unpack('>bb', d[F + 2 + k * 6:F + 4 + k * 6])
        y, at = struct.unpack('>hH', d[F + 4 + k * 6:F + 8 + k * 6])
        size = at >> 8
        pieces.append(dict(x=x, xf=xf, y=y, w=((size >> 2) & 3) + 1, h=(size & 3) + 1, tile=at & 0xFF))
    words = struct.unpack('>H', d[F - 2:F])[0]
    C = F + struct.unpack('>h', d[F - 4:F - 2])[0]
    a0 = C + half * 2
    out = bytearray()
    p = C
    while True:
        c = d[p]; p += 1
        if c == 0: break
        if 2 <= c <= 0x50:
            n_ = (0x50 - c) // 2 + 1; out += d[a0:a0 + 4] * n_; a0 += 4
        elif 0x54 <= c <= 0x7C:
            n_ = (0x7C - c) // 2 + 1; out += b'\0' * (4 * n_)
        elif 0x80 <= c <= 0xFE:
            n_ = (0xFE - c) // 2 + 1; out += d[a0:a0 + 4 * n_]; a0 += 4 * n_
        else:
            raise ValueError(f'bad command {c:#x} in frame {i}')
    return pieces, bytes(out[:words * 2]), words * 2

def palette(d, n):
    """Palette n (1-based) from the table at 0x25082, as 16 RGB tuples (index 0 transparent)."""
    out = []
    for k in range(16):
        v = struct.unpack('>H', d[0x25082 + (n - 1) * 32 + k * 2:0x25082 + (n - 1) * 32 + k * 2 + 2])[0]
        out.append(((v >> 1) & 7) * 36, ) if False else out.append((((v >> 1) & 7) * 255 // 7, ((v >> 5) & 7) * 255 // 7, ((v >> 9) & 7) * 255 // 7))
    return out

def render(pieces, art, pal, flip=False, size=96, origin=(48, 72)):
    """Draw a frame into an RGBA image; offsets accumulate piece to piece, as the game does."""
    from PIL import Image
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    x = y = t = 0
    for p in pieces:
        x += p['xf'] if flip else p['x']; y += p['y']; t += p['tile']
        for cx in range(p['w']):
            for cy in range(p['h']):
                ti = t + cx * p['h'] + cy
                tb = art[ti * 32:ti * 32 + 32]
                if len(tb) < 32: continue
                for py in range(8):
                    for px in range(8):
                        c = (tb[py * 4 + px // 2] >> (4 if px % 2 == 0 else 0)) & 15
                        if not c: continue
                        X = ((p['w'] - 1 - cx) * 8 + 7 - px) if flip else (cx * 8 + px)
                        xx, yy = origin[0] + x + X, origin[1] + y + cy * 8 + py
                        if 0 <= xx < size and 0 <= yy < size: img.putpixel((xx, yy), pal[c] + (255,))
    return img


if __name__ == '__main__':
    # python3 sprites.py > out/player_frames.json : every decodable player frame's tile bytes (hex), for sprite_parity.js
    import json
    d = open('rom/s3d.bin', 'rb').read(); ref = {}
    for i in range(frame_count(d)):
        try: ref[i] = frame(d, i)[1].hex()
        except Exception: pass
    json.dump(ref, __import__('sys').stdout)
