"""Private: Sonic Jam (Saturn) model, texture and animation reader, after the Sonic Retro SCHG notes."""
import struct, math
B = 0x06040000
class Jam:
    def __init__(self, museum, sprdata):
        self.m, self.s = museum, sprdata
    def u32(self, o): return struct.unpack('>I', self.m[o:o + 4])[0]
    def s32(self, o): return struct.unpack('>i', self.m[o:o + 4])[0]
    def group(self, footer, n):
        """n sub-model footer pointers, then n relative positions (fixed 16.16 vectors)."""
        ptrs = [self.u32(footer + 4 * k) - B for k in range(n)]
        o = footer + 4 * n
        vecs = [[self.s32(o + 12 * k + 4 * i) / 65536 for i in range(3)] for k in range(n)]
        return ptrs, vecs
    def submodel(self, f):
        vp, nv, ip, nq, dp, np_ = [self.u32(f + 4 * i) for i in range(6)]
        if ip - vp >= 12 * nv: V = [[self.s32(vp - B + 12 * i + 4 * k) / 65536 for k in range(3)] for i in range(nv)]
        else: V = [list(struct.unpack('>3h', self.m[vp - B + 6 * i:vp - B + 6 * i + 6])) for i in range(nv)]
        Q, D = [], []
        for i in range(nq):
            q = struct.unpack('>4h', self.m[ip - B + 8 * i:ip - B + 8 * i + 8])
            Q.append([(v // 8) % nv if v >= 0 else (-v // 8 - 1) % nv for v in q])
            o = dp - B + 16 * i
            b0, b1, tex, pmod, col, gour, ctrl = struct.unpack('>BBHHHHH', self.m[o:o + 12])
            # texture numbers count from 1 (see NOTES.md)
            if tex: tex -= 1
            D.append(dict(flags=b0, depth=b1, tex=tex, pmod=pmod, col=col, gour=gour, ctrl=ctrl))
        return V, Q, D
    def texture(self, idx):
        """RGBA rows (list of lists) for texture idx (4bpp with a colour table)."""
        o = 0x250A4 + 8 * idx
        srca, w8, h, colr, _ = struct.unpack('>HBBHH', self.m[o:o + 8])
        w = w8 * 8; pa = srca * 8 - 0xD040; ca = colr * 8 - 0xD040
        lut = []
        for k in range(16):
            v = struct.unpack('>H', self.s[ca + 2 * k:ca + 2 * k + 2])[0]
            lut.append(((v & 31) * 255 // 31, ((v >> 5) & 31) * 255 // 31, ((v >> 10) & 31) * 255 // 31, 255 if v & 0x8000 else 0))
        rows = []
        for y in range(h):
            row = []
            for x in range(w):
                b = self.s[pa + (y * w + x) // 2]
                c = b >> 4 if x % 2 == 0 else b & 15
                row.append(lut[c])
            rows.append(row)
        return w, h, rows
    def anim(self, table):
        """frames: list of (gpos, grot, [rot per sub-model]) with angles in 1/65536 turns."""
        offs = []; o = table
        while True:
            v = struct.unpack('>h', self.m[o:o + 2])[0]; o += 2
            if v == 0: break
            offs.append(table + v)
        frames = []
        for f in offs:
            flags = struct.unpack('>H', self.m[f:f + 2])[0]; o = f + 2
            gp = [0, 0, 0]
            for i in range(3):
                if not flags & (8 << i): gp[i] = self.s32(o) / 65536; o += 4
            gr = [0, 0, 0]
            for i in range(3):
                if not flags & (0x40 << i): gr[i] = struct.unpack('>h', self.m[o:o + 2])[0]; o += 2
            rots = []
            for k in range(15):
                r = [0, 0, 0]
                for i in range(3):
                    if not flags & (1 << i): r[i] = struct.unpack('>h', self.m[o:o + 2])[0]; o += 2
                rots.append(r)
            frames.append((gp, gr, rots))
        return frames
