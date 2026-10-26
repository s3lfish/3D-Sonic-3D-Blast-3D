"""Reference for the browser's level-art bake (s3d.js artBaker): unproject the isometric level picture onto
the faces of the 3D terrain, one 32x32 atlas slot per cell top and per 32-unit band of wall.
Usage: python3 bake.py LEVEL out.png  (private: writes the atlas for inspection)."""
import json, math, struct, sys
import rnc, rnc2, sprites

HEADERS, HSIZE, S = 0x1AB62, 0x2A, 32
ANIM = {int(k): v for k, v in json.load(open('out/anim.json')).items()}
EDGE = [(0, 1), (1, 2), (2, 3), (3, 0)]          # N, E, S, W as corner pairs (mesh order)
NEIGH = [(0, -1, 3, 2), (1, 0, 0, 3), (0, 1, 1, 0), (-1, 0, 2, 1)]
DONOR_SIDE = [2, 1, 2, 1]                         # back walls borrow from the facing side across


def u16(d, o): return d[o] << 8 | d[o + 1]
def u32(d, o): return u16(d, o) << 16 | u16(d, o + 2)


class Baker:
    def __init__(self, d, lid):
        self.d = d
        h = HEADERS + (lid - 1) * HSIZE
        f = [u32(d, h + 4 * k) for k in range(8)]
        self.gfx, self.tabB, self.tabA = f[3], f[4], f[5]
        self.map = struct.unpack('>16384H', rnc.unpack(d, f[1]))
        # static VRAM: +0x08 tiles, the +0x1C load list, then the animated tiles' first frames
        vr = bytearray(0x10000)
        t = rnc.unpack(d, f[2]); vr[:len(t)] = t
        a = f[7]
        while True:
            k = u16(d, a)
            if k == 0: break
            if k == 1:
                src, vd, ln = u32(d, a + 2), u16(d, a + 10), u16(d, a + 12)
                vr[vd:vd + ln * 2] = rnc.unpack(d, src)[:ln * 2]; a += 14
            elif k == 2: a += 10
            else: a += 2
        for tile, n, addr in ANIM.get(lid, []): vr[tile * 32:(tile + n) * 32] = d[addr:addr + n * 32]
        self.vr = bytes(vr)
        base = f[6]; n = u16(d, base) // 2
        self.rows = [rnc2.unpack(d, base + u16(d, base + 2 * r))[0] for r in range(n)]
        self.pal = [[(*c, 255) for c in sprites.palette(d, d[h + 0x26 + line])] for line in range(4)]
        self.maxH = max(((v >> 8) + 3) * 8 for v in self.map if v)
        self.slots = []                            # list of pixel lists (S*S rgba tuples)
        self.tops, self.walls = {}, {}

    # ---- terrain queries in world units ----
    def corners(self, cx, cz):
        if not (0 <= cx < 128 and 0 <= cz < 128): return None
        v = self.map[cz * 128 + cx]
        if not v: return None
        hb = v >> 8
        return [(hb + ((v >> s) & 3)) * 8 for s in (6, 4, 2, 0)]

    def height(self, x, z):
        cx, cz = math.floor(x / S), math.floor(z / S)
        c = self.corners(cx, cz)
        if c is None: return -1e9
        u, v = x / S - cx, z / S - cz
        if v >= u: return c[0] + v * (c[3] - c[0]) + u * (c[2] - c[3])   # triangle NW, SW, SE
        return c[0] + u * (c[1] - c[0]) + v * (c[2] - c[1])              # triangle NW, SE, NE

    def visible(self, x, y, z):
        t = 1.5
        while y + t <= self.maxH:
            if self.height(x + t, z + t) > y + t + 0.5: return False
            t += 2
        return True

    # ---- the picture ----
    def pixel(self, X, Y):
        r, c = Y >> 5, X >> 5
        if Y < 0 or X < 0 or r >= len(self.rows) or c >= 256: return None
        row = self.rows[r]; b0, b1, b2 = row[c * 3], row[c * 3 + 1], row[c * 3 + 2]
        A, B = b0 << 4 | b2 >> 4, b1 << 4 | (b2 & 15)
        ty, tx, py, px = (Y >> 3) & 3, (X >> 3) & 3, Y & 7, X & 7
        best = None
        if A >> 1:
            col = 3 - tx if B & 1 else tx
            w = u16(self.d, self.tabA + (A >> 1) * 32 + ty * 8 + col * 2)
            if B & 1: w ^= 0x0800
            if A & 1: w ^= 0x8000
            idx = (w & 0x7FF) + (0x800 if w & 0x4000 else 0)
            if idx:
                ci = self.texel(self.d, self.gfx + idx * 32, w, px, py)
                if ci: best = (w >> 15, 1, self.pal[(w >> 13) & 1][ci])
        if B >> 1:
            w = u16(self.d, self.tabB + (B >> 1) * 32 + ty * 8 + tx * 2)
            if w & 0x7FF:
                ci = self.texel(self.vr, (w & 0x7FF) * 32, w, px, py)
                if ci and (best is None or (w >> 15) > best[0]): best = (w >> 15, 0, self.pal[(w >> 13) & 3][ci])
        return best[2] if best else None

    @staticmethod
    def texel(src, o, w, px, py):
        if w & 0x0800: px = 7 - px
        if w & 0x1000: py = 7 - py
        b = src[o + py * 4 + (px >> 1)]
        return b & 15 if px & 1 else b >> 4

    def sample(self, x, y, z):
        p = self.pixel(math.floor(x - z + 4096), math.floor((x + z) / 2 - y))
        return p if p else self.pal[0][0][:3] + (255,)

    def new_slot(self, fn):
        self.slots.append([fn(s, t) for t in range(S) for s in range(S)])
        return len(self.slots) - 1

    # ---- cell tops ----
    def top_visible(self, cx, cz):
        key = ('v', cx, cz)
        if key not in self.tops:
            c = self.corners(cx, cz); X, Z = cx * S, cz * S
            ok = c is not None
            for (u, v) in ((0.25, 0.25), (0.75, 0.25), (0.25, 0.75), (0.75, 0.75)):
                if ok and not self.visible(X + u * S, self.height(X + u * S, Z + v * S), Z + v * S): ok = False
            self.tops[key] = ok
        return self.tops[key]

    def top(self, cx, cz):
        key = ('s', cx, cz)
        if key in self.tops: return self.tops[key]
        sx, sz = cx, cz
        if not self.top_visible(cx, cz):
            found = None
            for rad in range(1, 9):
                for dz in range(-rad, rad + 1):
                    for dx in range(-rad, rad + 1):
                        if max(abs(dx), abs(dz)) != rad: continue
                        if found is None and self.corners(cx + dx, cz + dz) and self.top_visible(cx + dx, cz + dz): found = (cx + dx, cz + dz)
                if found: break
            if found:
                self.tops[key] = self.top(*found); return self.tops[key]
        X, Z = sx * S, sz * S
        def fn(s, t):
            x, z = X + s + 0.5, Z + t + 0.5
            return self.sample(x, self.height(x, z), z)
        self.tops[key] = self.new_slot(fn)
        return self.tops[key]

    # ---- walls: edge 0..3 (N, E, S, W), band k counted down from the top edge ----
    def wall_geom(self, cx, cz, edge):
        c = self.corners(cx, cz); a, b = EDGE[edge]
        P = [(cx * S, cz * S), (cx * S + S, cz * S), (cx * S + S, cz * S + S), (cx * S, cz * S + S)]
        dx, dz, na, nb = NEIGH[edge]; n = self.corners(cx + dx, cz + dz)
        return P[a], P[b], c[a], c[b], (n[na] if n else -1e9), (n[nb] if n else -1e9)

    def wall_point(self, g, k, s, t):
        pa, pb, ta, tb, ba, bb = g; f = (s + 0.5) / S
        x, z = pa[0] + (pb[0] - pa[0]) * f, pa[1] + (pb[1] - pa[1]) * f
        y = ta + (tb - ta) * f - S * k - (t + 0.5)
        return x, y, z, ba + (bb - ba) * f

    def wall_visible(self, cx, cz, edge, k):
        if edge in (0, 3): return False
        g = self.wall_geom(cx, cz, edge); seen = 0
        for (s, t) in ((8, 8), (24, 8), (8, 24), (24, 24)):
            x, y, z, bot = self.wall_point(g, k, s, t)
            if y < bot: continue
            if not self.visible(x + (0.5 if edge == 1 else 0), y, z + (0.5 if edge == 2 else 0)): return False
            seen += 1
        return seen > 0

    def wall(self, cx, cz, edge, k):
        key = (cx, cz, edge, k)
        if key in self.walls: return self.walls[key]
        if self.wall_visible(cx, cz, edge, k):
            g = self.wall_geom(cx, cz, edge)
            def fn(s, t):
                x, y, z, _ = self.wall_point(g, k, s, t)
                return self.sample(x, y, z)
            self.walls[key] = self.new_slot(fn); return self.walls[key]
        # hidden band: this wall's own visible body bands if any, else a nearby wall's (deep band 2 first for deep bands)
        own = [j for j in range(1, k) if self.wall_visible(cx, cz, edge, j)]
        if own:
            self.walls[key] = self.wall(cx, cz, edge, own[(k - 1) % len(own)]); return self.walls[key]
        found = (k >= 2 and self.donor(cx, cz, edge, 2)) or self.donor(cx, cz, edge, min(k, 1))
        self.walls[key] = self.wall(*found) if found else self.plain()
        return self.walls[key]

    def leafy(self, cx, cz, edge, k):
        """A band painted with leaves or vines: more than 1 in 32 of 64 sampled points green."""
        g = self.wall_geom(cx, cz, edge); n = m = 0
        for t in range(2, S, 4):
            for s in range(2, S, 4):
                x, y, z, bot = self.wall_point(g, k, s, t)
                if y < bot: continue
                p = self.sample(x, y, z); m += 1
                if p[1] > p[0] + 24 and p[1] > p[2] + 24: n += 1
        return n * 32 > m

    def donor(self, cx, cz, edge, kk):
        # body bands lend only plain rock (no leaves or vines) when any lies within reach
        side = DONOR_SIDE[edge]
        for clean in ((True, False) if kk else (False,)):
            for rad in range(0, 17):
                for dz in range(-rad, rad + 1):
                    for dx in range(-rad, rad + 1):
                        if max(abs(dx), abs(dz)) != rad: continue
                        x2, z2 = cx + dx, cz + dz
                        if not self.corners(x2, z2): continue
                        g = self.wall_geom(x2, z2, side)
                        if g[2] <= g[4] and g[3] <= g[5]: continue          # no wall there
                        if (x2, z2, side) == (cx, cz, edge): continue
                        if self.wall_visible(x2, z2, side, kk) and not (clean and self.leafy(x2, z2, side, kk)):
                            return (x2, z2, side, kk)
        return None

    def plain(self):
        if ('plain',) not in self.walls: self.walls[('plain',)] = self.new_slot(lambda s, t: self.pal[0][9])
        return self.walls[('plain',)]

    def atlas(self):
        cols = 64; rows = -(-len(self.slots) // cols); H = 32
        while H < rows * S: H *= 2
        from PIL import Image
        img = Image.new('RGBA', (cols * S, H))
        px = img.load()
        for i, sl in enumerate(self.slots):
            ox, oy = (i % cols) * S, (i // cols) * S
            for k, p in enumerate(sl): px[ox + k % S, oy + k // S] = tuple(p)
        return img


if __name__ == '__main__':
    d = open('rom/s3d.bin', 'rb').read(); lid = int(sys.argv[1])
    bk = Baker(d, lid)
    cells = [(i % 128, i // 128) for i, v in enumerate(bk.map) if v]
    for cx, cz in cells: bk.top(cx, cz)
    print('tops', len(cells), 'slots', len(bk.slots), 'hidden tops', sum(1 for (cx, cz) in cells if not bk.top_visible(cx, cz)))
    for cx, cz in cells:
        for e in range(4):
            g = bk.wall_geom(cx, cz, e)
            if g[2] <= g[4] and g[3] <= g[5]: continue
            top = max(g[2], g[3]); bot = max(min(g[4], g[2]), min(g[5], g[3]), top - 3 * S)
            for k in range(int(math.ceil((top - bot) / S))): bk.wall(cx, cz, e, k)
    print('slots with walls', len(bk.slots))
    im = bk.atlas(); im.save(sys.argv[2])
    open(sys.argv[2] + '.rgba', 'wb').write(im.tobytes())
