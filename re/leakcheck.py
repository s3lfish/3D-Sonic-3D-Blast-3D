"""Private: confirm the published page carries no ROM bytes (as hex, base64, or number lists)."""
import re, base64, sys
rom = open('rom/s3d.bin', 'rb').read(); romhex = rom.hex()
html = open(sys.argv[1] if len(sys.argv) > 1 else '../index.html').read()
hits = []
for m in re.finditer(r'[0-9a-fA-F]{16,}', html):
    if m.group().lower() in romhex: hits.append(('hex', m.group()[:40]))
for m in re.finditer(r'[A-Za-z0-9+/]{24,}={0,2}', html):
    try:
        b = base64.b64decode(m.group() + '=' * (-len(m.group()) % 4))
        if len(b) >= 12 and b[:12] in rom and b in rom: hits.append(('b64', m.group()[:40]))
    except Exception: pass
for m in re.finditer(r'\[((?:\s*(?:0x[0-9a-fA-F]+|\d+)\s*,){7,}\s*(?:0x[0-9a-fA-F]+|\d+))\s*\]', html):
    nums = [int(x, 0) for x in m.group(1).split(',')]
    if all(0 <= n < 256 for n in nums) and bytes(nums) in rom: hits.append(('list', m.group()[:60]))
print('ROM data found in page:', len(hits), hits[:5])
