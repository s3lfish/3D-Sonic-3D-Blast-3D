"""Rob Northen Compression (RNC) method 1 unpacker, after the public-domain dernc.c algorithm.
unpack(data, offset) -> bytes. Raises ValueError on a bad signature or CRC mismatch."""
import struct

_CRC = []
for i in range(256):
    v = i
    for _ in range(8):
        v = (v >> 1) ^ 0xA001 if v & 1 else v >> 1
    _CRC.append(v)


def crc16(buf):
    c = 0
    for b in buf:
        c ^= b
        c = (c >> 8) ^ _CRC[c & 0xFF]
    return c


def header(data, off=0):
    if data[off:off + 4] != b'RNC\x01':
        raise ValueError('not an RNC method 1 block at %06X' % off)
    unpacked, packed, ucrc, pcrc = struct.unpack('>IIHH', data[off + 4:off + 16])
    return unpacked, packed, ucrc, pcrc


class _Bits:
    def __init__(self, data, pos):
        self.d = data; self.p = pos
        self.buf = self.word(pos); self.cnt = 16

    def word(self, p):
        return self.d[p] | (self.d[p + 1] << 8) if p + 1 < len(self.d) else (self.d[p] if p < len(self.d) else 0)

    def peek(self, mask):
        return self.buf & mask

    def advance(self, n):
        self.buf >>= n; self.cnt -= n
        if self.cnt < 16:
            self.p += 2
            self.buf |= self.word(self.p) << self.cnt
            self.cnt += 16

    def read(self, mask, n):
        r = self.peek(mask); self.advance(n); return r

    def fix(self):
        self.cnt -= 16
        self.buf &= (1 << self.cnt) - 1
        self.buf |= self.word(self.p) << self.cnt
        self.cnt += 16


def _mirror(x, n):
    r = 0
    for _ in range(n):
        r = (r << 1) | (x & 1); x >>= 1
    return r


def _table(bs):
    num = bs.read(0x1F, 5)
    if not num:
        return []
    lens = [bs.read(0x0F, 4) for _ in range(num)]
    tab, code = [], 0
    for i in range(1, max(max(lens), 1) + 1):
        for j in range(num):
            if lens[j] == i:
                tab.append((_mirror(code, i), i, j)); code += 1
        code <<= 1
    return tab


def _huf(tab, bs):
    for code, ln, val in tab:
        if bs.peek((1 << ln) - 1) == code:
            bs.advance(ln)
            if val >= 2:
                v = 1 << (val - 1)
                v |= bs.read(v - 1, val - 1)
                return v
            return val
    raise ValueError('bad Huffman code')


def unpack(data, off=0, check=True):
    unpacked, packed, ucrc, pcrc = header(data, off)
    if check and crc16(data[off + 18:off + 18 + packed]) != pcrc:
        raise ValueError('packed CRC mismatch at %06X' % off)
    out = bytearray()
    bs = _Bits(data, off + 18)
    bs.advance(2)
    while len(out) < unpacked:
        raw, dist, ln = _table(bs), _table(bs), _table(bs)
        count = bs.read(0xFFFF, 16)
        while True:
            n = _huf(raw, bs)
            if n:
                out += data[bs.p:bs.p + n]; bs.p += n
                bs.fix()
            count -= 1
            if count <= 0:
                break
            posn = _huf(dist, bs) + 1
            n = _huf(ln, bs) + 2
            for _ in range(n):
                out.append(out[-posn])
    out = bytes(out[:unpacked])
    if check and crc16(out) != ucrc:
        raise ValueError('unpacked CRC mismatch at %06X' % off)
    return out
