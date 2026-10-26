"""RNC method 2 unpacker as the game's own routine at 0xC7C does it (header-less variant used for level art rows):
block = packed length (4), unpacked CRC (2), packed CRC (2), leeway (1), chunks (1), then the bit stream.
Bits come MSB first from single bytes; literal bytes and offset low bytes are read straight from the stream."""
import struct


def unpack(d, off, out_len=None):
    plen = struct.unpack('>I', d[off:off + 4])[0]
    p = off + 10
    end_in = p + plen
    out = bytearray()
    st = {'b': 0x80, 'n': 0}      # bit buffer with sentinel

    def byte():
        nonlocal p
        v = d[p]; p += 1; return v

    def bit():
        st['b'] = (st['b'] << 1) & 0x1FF
        c = st['b'] >> 8; st['b'] &= 0xFF
        if st['b'] == 0:            # sentinel fell out: refill (shift in a 1)
            v = byte()
            st['b'] = ((v << 1) | 1) & 0xFF
            c = v >> 7
        return c

    bit(); bit()                  # two flag bits (lock, key)
    while True:
        if not bit():
            out.append(byte()); continue
        d5, d6 = 2, 0
        if not bit():
            d5 = d5 * 2 + bit()                       # 4 or 5
            if bit():
                d5 = (d5 - 1) * 2 + bit()             # 6..9
                if d5 == 9:                           # literal run
                    k = 0
                    for _ in range(4): k = k * 2 + bit()
                    n = (k + 3) * 4
                    out += d[p:p + n]; p += n
                    continue
            d6 = offset_high(bit)
        else:
            if bit():
                d5 = 3
                if bit():
                    d5 = byte()
                    if d5 == 0:
                        if bit(): continue          # next chunk
                        break
                    d5 += 8
                d6 = offset_high(bit)
            # else: length 2, offset from one byte
        dist = ((d6 << 8) | byte()) + 1
        for _ in range(d5): out.append(out[-dist])
        if out_len and len(out) >= out_len: pass
    return bytes(out), p - off


def offset_high(bit):
    if not bit(): return 0
    d6 = bit()
    if bit():
        d6 = (d6 * 2 + bit()) | 4
        if bit(): return d6
        return d6 * 2 + bit()
    if d6: return d6
    return 1 * 2 + bit()
