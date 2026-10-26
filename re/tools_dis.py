import sys, capstone, re
d = open('rom/s3d.bin', 'rb').read()
md = capstone.Cs(capstone.CS_ARCH_M68K, capstone.CS_MODE_M68K_000)
md.skipdata = True
labels = {}
for m in re.finditer(r'MakeName\s*\(0X([0-9A-F]+),\s*"([^"]+)"\)', open('ref/database.idc').read()):
    labels[int(m.group(1), 16)] = m.group(2)
def dis(start, n):
    out = []
    for ins in md.disasm(d[start:start + n * 8], start):
        lab = labels.get(ins.address, '')
        out.append(f"{lab:>14} {ins.address:06X}: {ins.mnemonic:8} {ins.op_str}")
        if len(out) >= n: break
    print('\n'.join(out))
if __name__ == '__main__':
    dis(int(sys.argv[1], 16), int(sys.argv[2]))
