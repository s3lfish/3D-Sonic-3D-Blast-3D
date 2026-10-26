import json, struct
from PIL import Image
def pal_rgb(rom, n):
    out = []
    for k in range(16):
        v = struct.unpack('>H', rom[0x25082 + (n - 1) * 32 + k * 2:0x25082 + (n - 1) * 32 + k * 2 + 2])[0]
        out.append((((v >> 1) & 7) * 255 // 7, ((v >> 5) & 7) * 255 // 7, ((v >> 9) & 7) * 255 // 7, 255))
    return out
def render(rom, rec, size=96, ox=48, oy=80):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    pals = [pal_rgb(rom, n) for n in rec['palettes']]
    for p in rec['pieces']:
        pal = pals[p['line']]
        for cx in range(p['w']):
            for cy in range(p['h']):
                tb = rom[p['rom'] + (cx * p['h'] + cy) * 32:][:32]
                for py in range(8):
                    for px in range(8):
                        c = (tb[py * 4 + px // 2] >> (4 if px % 2 == 0 else 0)) & 15
                        if not c: continue
                        X = (p['w'] - 1 - cx) * 8 + 7 - px if p['hf'] else cx * 8 + px
                        Y = (p['h'] - 1 - cy) * 8 + 7 - py if p['vf'] else cy * 8 + py
                        xx, yy = ox + p['dx'] + X, oy + p['dy'] + Y
                        if 0 <= xx < size and 0 <= yy < size: img.putpixel((xx, yy), pal[c])
    return img
if __name__ == '__main__':
    rom = open('rom/s3d.bin', 'rb').read(); recs = json.load(open('out/recipes.json'))
    sheet = Image.new('RGBA', (96 * len(recs), 96), (60, 60, 90, 255))
    for i, (t, r) in enumerate(sorted(recs.items())): sheet.alpha_composite(render(rom, r), (i * 96, 0))
    sheet.resize((sheet.width * 2, 192), Image.NEAREST).save('emu/recipes.png'); print(sorted(recs))
