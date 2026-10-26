"""Private: watch a level's animated static tiles (the ANIM runs) in the emulator: every distinct frame, where each is
raw in the ROM, and the order and timing of the frames. Usage: python3 animwatch.py LEVEL FRAMES"""
import sys, json
sys.path.insert(0, '.')
from emu_run import *
from vdp import vram
d = open('rom/s3d.bin', 'rb').read(); lid = int(sys.argv[1]); N = int(sys.argv[2])
runs = json.load(open('out/anim.json'))[str(lid)]
e = Emu(f'rom/start{lid:02d}.md'); e.e.set_state(open(f'emu/lv{lid:02d}.state', 'rb').read()); e.run(2)
seq = {i: [] for i in range(len(runs))}; frames = {i: [] for i in range(len(runs))}
for f in range(N):
    e.run(1); vr = vram(e.e.get_state())
    for i, (t, n, a) in enumerate(runs):
        b = vr[t * 32:(t + n) * 32]
        if b not in frames[i]: frames[i].append(b)
        seq[i].append(frames[i].index(b))
out = []
for i, (t, n, a) in enumerate(runs):
    addrs = [d.find(b) for b in frames[i]]
    # timing: lengths of runs of equal frames in the sequence
    s = seq[i]; lens = []; k = 0
    for j in range(1, len(s) + 1):
        if j == len(s) or s[j] != s[k]: lens.append((s[k], j - k)); k = j
    print('run', t, n, 'frames', len(frames[i]), 'addrs', [hex(x) for x in addrs], 'order/len', lens[:24])
    out.append({'tile': t, 'n': n, 'addrs': addrs, 'lens': lens})
json.dump(out, open(f'out/animwatch_{lid:02d}.json', 'w'))
