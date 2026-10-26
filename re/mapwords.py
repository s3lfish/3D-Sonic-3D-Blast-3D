"""Private: print map words around cells. Usage: python3 mapwords.py LEVEL off_hex [off_hex ...] (2 cells around)."""
import sys, struct, rnc
lid = int(sys.argv[1]); d = open('rom/s3d.bin', 'rb').read(); h = 0x1AB62 + (lid - 1) * 0x2A
w = struct.unpack('>16384H', rnc.unpack(d, struct.unpack('>I', d[h + 4:h + 8])[0]))
for a in sys.argv[2:]:
    o = int(a, 16) >> 1; cx, cz = o & 127, o >> 7
    print(f'{a}: cell ({cx}, {cz})')
    for z in range(cz - 2, cz + 3):
        print('  ', ' '.join(('[%04x]' if (x, z) == (cx, cz) else ' %04x ') % w[z * 128 + x] for x in range(cx - 3, cx + 4)))
