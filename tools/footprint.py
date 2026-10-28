#!/usr/bin/env python3
"""Chili dog meter: the project's estimated electricity and water, kept in README.md.

Run before each push: python3 tools/footprint.py [transcript glob]
It adds model calls recorded in Claude's session transcripts since the ledger's last timestamp, then rewrites the
block between <!-- footprint --> and <!-- /footprint --> in README.md. Method and sources: tools/FOOTPRINT.md.
"""
import glob, json, os, sys, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
LEDGER = os.path.join(HERE, 'footprint.json')
README = os.path.join(HERE, '..', 'README.md')

# mWh per token: (low, mid, high). New tokens written to the prompt cache are processed from scratch; output tokens
# are generated on top of a long context; cached reads skip that processing.
F = {'cw': (0.10, 0.17, 0.25), 'out': (0.5, 1.5, 5.0), 'cr': (0.001, 0.004, 0.01), 'inp': (0.10, 0.17, 0.25)}
WATER_ML_PER_WH = 0.26 / 0.24          # Google, median Gemini prompt: on-site cooling water per Wh
# one chili dog: 50 g beef frank, 25 g beef in 60 g of chili, 50 g bun (see FOOTPRINT.md)
DOG_KWH = 0.075 * 210 / 3.6 + 0.05 * 20 / 3.6 + 0.1      # non-renewable energy of beef and bread, plus cooking
DOG_BLUE_L = 0.075 * 15415 * 0.04 + 0.05 * 1608 * 0.10   # irrigation (blue) water: beef ~4%, bread ~10% (assumed)

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

def wh(t, i):
    return sum(t[k] * F[k][i] for k in ('inp', 'cw', 'cr', 'out')) / 1000

def main():
    led = json.load(open(LEDGER))
    pat = sys.argv[1] if len(sys.argv) > 1 else '/root/.claude/projects/**/*.jsonl'
    t, last = usage(glob.glob(pat, recursive=True), led['measured']['until'])
    for k in t: led['measured'][k] = led['measured'].get(k, 0) + t[k]
    led['measured']['until'] = last
    json.dump(led, open(LEDGER, 'w'), indent=2); open(LEDGER, 'a').write('\n')
    b, m = led['baseline'], led['measured']
    kwh = [(b['calls'][i] * b['whPerCall'][i] + wh(m, i)) / 1000 for i in range(3)]
    litres = [k * WATER_ML_PER_WH for k in kwh]
    dogs_e, dogs_w = kwh[1] / DOG_KWH, litres[1] / DOG_BLUE_L
    frac = lambda x: f'{x:.1f}' if x >= 1 else f'{x:.2f}'
    day = datetime.date.fromisoformat(last[:10]).strftime('%-d %B %Y')
    text = f"""<!-- footprint -->
### Chili dog meter

Building this with Claude has used about **{kwh[1]:.0f} kWh** of electricity and **{litres[1]:.0f} L** of cooling water so
far ({kwh[0]:.0f} to {kwh[2]:.0f} kWh, {litres[0]:.0f} to {litres[2]:.0f} L). A chili dog takes about {DOG_KWH:.1f} kWh of energy and
{DOG_BLUE_L:.0f} L of irrigation water to make, so this game has cost **{frac(dogs_e)} chili dogs** of energy and
**{frac(dogs_w)} of a chili dog** of water. Rough estimates, last updated {day}; [how they are worked out](tools/FOOTPRINT.md).
<!-- /footprint -->"""
    s = open(README).read()
    a, z = s.find('<!-- footprint -->'), s.find('<!-- /footprint -->')
    if a < 0: raise SystemExit('README has no <!-- footprint --> block')
    open(README, 'w').write(s[:a] + text + s[z + len('<!-- /footprint -->'):])
    print(f"{m['calls']} measured calls; {kwh[1]:.1f} kWh, {litres[1]:.1f} L; {dogs_e:.2f} dogs (energy), {dogs_w:.2f} (water)")

if __name__ == '__main__':
    main()
