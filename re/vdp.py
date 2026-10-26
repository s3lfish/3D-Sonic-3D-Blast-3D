"""Helpers to read VDP memory out of a genesis_plus_gx save state (private RE tooling)."""
import struct
from PIL import Image
VRAM_OFF, CRAM_OFF = 74789, 1742
def sw(b): return bytes(x for i in range(0, len(b), 2) for x in (b[i + 1], b[i]))
def vram(st): return sw(st[VRAM_OFF:VRAM_OFF + 0x10000])
def cram(st): return sw(st[CRAM_OFF:CRAM_OFF + 128])
def colours(cr):
    out = []
    for i in range(64):
        v = struct.unpack('>H', cr[i * 2:i * 2 + 2])[0]
        r, g, b = (v >> 1) & 7, (v >> 5) & 7, (v >> 9) & 7
        out.append((r * 36, g * 36, b * 36))
    return out
def tile(vr, idx):
    t = vr[idx * 32:(idx + 1) * 32]
    return [[(t[y * 4 + x // 2] >> (4 if x % 2 == 0 else 0)) & 15 for x in range(8)] for y in range(8)]
def sprites(vr, sat):
    out, i, seen = [], 0, set()
    while i not in seen and len(out) < 80:
        seen.add(i)
        y, sz, link, attr, x = struct.unpack('>HBBHH', vr[sat + i * 8:sat + i * 8 + 8])
        out.append(dict(y=(y & 0x3FF) - 128, x=(x & 0x1FF) - 128, w=((sz >> 2) & 3) + 1, h=(sz & 3) + 1, link=link & 0x7F,
                        tile=attr & 0x7FF, hf=bool(attr & 0x800), vf=bool(attr & 0x1000), pal=(attr >> 13) & 3, pri=bool(attr & 0x8000)))
        i = link & 0x7F
        if i == 0: break
    return out
def draw_sprite(img, vr, pal, s, ox=0, oy=0):
    for cx in range(s['w']):
        for cy in range(s['h']):
            t = tile(vr, s['tile'] + cx * s['h'] + cy)
            for py in range(8):
                for px in range(8):
                    c = t[py][px]
                    if not c: continue
                    X = (s['w'] - 1 - cx if s['hf'] else cx) * 8 + (7 - px if s['hf'] else px)
                    Y = (s['h'] - 1 - cy if s['vf'] else cy) * 8 + (7 - py if s['vf'] else py)
                    xx, yy = s['x'] + X - ox, s['y'] + Y - oy
                    if 0 <= xx < img.width and 0 <= yy < img.height: img.putpixel((xx, yy), pal[s['pal'] * 16 + c])
