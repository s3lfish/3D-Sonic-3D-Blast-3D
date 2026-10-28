#!/usr/bin/env python3
"""Chili dog meter: the project's estimated energy and water against chili dogs.

Run before each push: python3 tools/footprint.py [transcript glob]
It adds model calls recorded in Claude's session transcripts since the ledger's last timestamp (tools/footprint.json),
writes footprint/data.js for the meter's page, draws footprint/chilidogs.svg with footprint/model.js, and rewrites the
block between <!-- footprint --> and <!-- /footprint --> in README.md. Method and sources: README, last section.
"""
import glob, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
LEDGER = os.path.join(HERE, 'footprint.json')
README = os.path.join(HERE, '..', 'README.md')
FOOT = os.path.join(HERE, '..', 'footprint')

def usage(paths, after):
    seen, tot, last = {}, dict(calls=0, inp=0, cw=0, cr=0, out=0), after
    for fn in paths:
        for ln in open(fn, errors='replace'):
            try: r = json.loads(ln)
            except ValueError: continue
            m = r.get('message')
            if not isinstance(m, dict) or not m.get('usage') or (r.get('timestamp') or '') <= after: continue
            u, k = m['usage'], (fn, m.get('id') or ln[:80])
            v = [u.get('input_tokens') or 0, u.get('cache_creation_input_tokens') or 0, u.get('cache_read_input_tokens') or 0, u.get('output_tokens') or 0]
            seen[k] = [max(a, b) for a, b in zip(seen.get(k, v), v)]
            last = max(last, r['timestamp'])
    for v in seen.values():
        tot['calls'] += 1; tot['inp'] += v[0]; tot['cw'] += v[1]; tot['cr'] += v[2]; tot['out'] += v[3]
    return tot, last

def main():
    led = json.load(open(LEDGER))
    pat = sys.argv[1] if len(sys.argv) > 1 else '/root/.claude/projects/**/*.jsonl'
    paths = glob.glob(pat, recursive=True)
    t, last = usage(paths, led['measured']['until'])
    for k in t: led['measured'][k] = led['measured'].get(k, 0) + t[k]
    led['measured']['until'] = last
    # the meter's own work (`meter`): calls while `open`; set open to false when work moves off the meter
    mt = led['meter']
    if mt['open']:
        t, mt['until'] = usage(paths, max(mt['until'], mt['from']))
        for k in t: mt[k] = mt.get(k, 0) + t[k]
    json.dump(led, open(LEDGER, 'w'), indent=2); open(LEDGER, 'a').write('\n')
    open(os.path.join(FOOT, 'data.js'), 'w').write('window.FOOTPRINT_LEDGER = ' + json.dumps(led) + ';\n')
    out = json.loads(subprocess.check_output(['node', os.path.join(FOOT, 'model.js'), LEDGER, os.path.join(FOOT, 'chilidogs.svg')]))
    m = out['r'][1]
    text = f"""<!-- footprint -->
[![Chili dog meter: making this game has cost about {m['energyDogs']:.1f} chili dogs of energy and {m['waterDogs']:.1f} of water](footprint/chilidogs.svg)](https://s3lfish.github.io/3D-Sonic-3D-Blast-3D/footprint/)

Making this with Claude, counted in chili dogs; making the meter itself cost about {out['page']['dogs']:.1f} of the chili dogs of energy and {out['page']['water']:.2f} of water. [Pick which parts to count](https://s3lfish.github.io/3D-Sonic-3D-Blast-3D/footprint/), or read [how it works](#how-the-chili-dog-meter-works).
<!-- /footprint -->"""
    s = open(README).read()
    a, z = s.find('<!-- footprint -->'), s.find('<!-- /footprint -->')
    if a < 0: raise SystemExit('README has no <!-- footprint --> block')
    open(README, 'w').write(s[:a] + text + s[z + len('<!-- /footprint -->'):])
    print(f"{m['energyDogs']:.2f} chili dogs of energy, {m['waterDogs']:.2f} of water; the meter itself {out['page']['dogs']:.2f} ({out['day']})")

if __name__ == '__main__':
    main()
