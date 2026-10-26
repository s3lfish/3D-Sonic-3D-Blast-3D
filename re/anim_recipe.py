"""Private: per level, find static-layer tiles the loader does not fill (animated water, lava...) and the raw ROM
address of the frame the running game shows, as [first tile, count, ROM address] runs → out/anim.json."""
import sys, json, struct
sys.path.insert(0, '.')
import levelart
from vdp import vram
d = open('rom/s3d.bin', 'rb').read()
res = {}
for lid in range(1, 23):
    f, _ = levelart.header(d, lid)
    sv = levelart.static_vram(d, lid)
    vr = vram(open(f'emu/lv{lid:02d}.state', 'rb').read())
    used = set()
    for row in levelart.rows(d, lid):
        for (a, ap, b, mir) in levelart.cells(row):
            if not b: continue
            for k in range(16):
                w = struct.unpack('>H', d[f[4] + b * 32 + k * 2:][:2])[0]
                if w & 0x7FF: used.add(w & 0x7FF)
    bad = sorted(i for i in used if sv[i * 32:i * 32 + 32] != vr[i * 32:i * 32 + 32])
    runs = []
    for i in bad:
        if runs and runs[-1][0] + runs[-1][1] == i: runs[-1][1] += 1
        else: runs.append([i, 1])
    out, missing = [], 0
    for start, n in runs:
        # take each run in chunks that exist contiguously in the ROM
        i = start
        while i < start + n:
            k = start + n - i
            while k > 0:
                a = d.find(vr[i * 32:(i + k) * 32])
                if a >= 0 and vr[i * 32:(i + k) * 32] != bytes(32 * k): break
                k -= 1
            if k == 0: missing += 1; i += 1; continue
            out.append([i, k, a]); i += k
    res[lid] = out
    print(lid, 'static tiles used', len(used), 'not from loader', len(bad), 'runs', out, 'unfound', missing)
json.dump(res, open('out/anim.json', 'w'))
