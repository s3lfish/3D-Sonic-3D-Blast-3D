"""Write rom/startNN.md: a copy of your ROM whose new game starts in level NN (for the emulator probes).
The play order table is words at 0xA2C (entry 1 first); this patches entry 1 only. Usage: python3 mkstart.py NN"""
import sys

lid = int(sys.argv[1])
assert 1 <= lid <= 22, 'level id is 1..22'
d = bytearray(open('rom/s3d.bin', 'rb').read())
assert d[0xA2C:0xA30] == b'\x00\x01\x00\x02', 'unexpected ROM: play order table not found at 0xA2C'
d[0xA2C:0xA2E] = lid.to_bytes(2, 'big')
open(f'rom/start{lid:02d}.md', 'wb').write(d)
print(f'rom/start{lid:02d}.md')
