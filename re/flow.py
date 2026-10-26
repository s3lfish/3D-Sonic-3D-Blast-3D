"""Private: can a converted level be played through in Blast Grid? Areas reached on foot (steps, jumps, drops),
springs, doors, pads (after their ring), rides (to their end), in ring order. Usage: flow.py out/lvN_1.json"""
import json, sys, collections
L = json.load(open(sys.argv[1])); W, D = L['width'], L['depth']; T = L['tiles']
JUMP, STEP = 64 / 32 * 1.0, 0.3   # 60 units measured; a run up a slope makes up the rest (DD1 ledge)
def top(x, z):
    if not (0 <= x < W and 0 <= z < D): return None
    t = T[z * W + x]
    return None if t['t'] == 'W' else max(t['c'])
ents = L['entities']
start = next(e for e in ents if e['type'] == 'start')
goals = [e for e in ents if e['type'] == 'goal']
holes = [e for e in ents if e['type'] == 'hole']
springs = [e for e in ents if e['type'] == 'spring']
for e in ents:   # lifts: a slab to stand on (or jump from) before it sinks
    if e['type'] == 'lift': springs.append({'x': e['x'], 'z': e['z'], 'absY': e['y'] - 94 / 32 + 1.875})
springcells = {tuple(c): e['power'] ** 2 / (2 * 900 / 32) for e in ents if e['type'] == 'springCells' for c in e['cells']}
boosters = [e for e in ents if e['type'] == 'booster']
dashes = [e for e in ents if e['type'] == 'dash']
sleds = [e for e in ents if e['type'] == 'sled']
vents = [e for e in ents if e['type'] == 'vent']
jets = [e for e in ents if e['type'] == 'jetLift']
def run_on(x, z, dx, dz, n, up=0.6):   # a dash or a held pad: on along (dx, dz) up to n cells, up slopes (0.6 a cell)
    out = []; y = None
    for k in range(1, n + 1):
        hy = h(x + dx * k, z + dz * k)
        if hy is None: break
        prev = h(x + dx * (k - 1), z + dz * (k - 1))
        if prev is not None and hy - prev > up: break
        out.append((x + dx * k, z + dz * k))
    return out
up = {}   # walls and pillars: taken as broken (dash, whirl); a pillar's own floor once broken
for e in ents:
    if e['type'] == 'crack':
        for c in e['cells']:
            if len(c) > 3 and c[3] is not None: up[(c[0], c[1])] = c[3]
# gates (Gene Gadget): walls until their section; the supercharger's gates open for its run (taken once a ride that
# lets runs through has been reached); hover cells: floated over at 48 units, no jumping
gates = {}
for e in ents:
    if e['type'] == 'gate':
        for c in e['cells']: gates[(c[0], c[1])] = (e['top'], e['opens'], e.get('pass'), e.get('key'))
hover = {(c[0], c[1]) for e in ents if e['type'] == 'updraft' for c in e['cells']}
state = {'section': 0, 'pass': False, 'keys': set()}   # keys: taken as held once a ride that gives one has been reached
carriers = [e for e in ents if e['type'] == 'carrier']   # Panic Puppet's belts: either way (the levers are reachable)
capsules = [e for e in ents if e['type'] == 'capsule']   # landing on one throws 5 units a frame up (50 units over it)
def h(x, z):
    g = gates.get((x, z))
    if g and not (0 < g[1] <= state['section']) and not (g[2] and state['pass']) and not (g[3] and g[3] in state['keys']): return g[0]
    if (x, z) in up: return up[(x, z)]
    return top(x, z)
def reach1(seeds, section, seen=None):
    state['section'] = section
    seen = set(seeds) if seen is None else seen | set(seeds); q = collections.deque(seeds)
    while q:
        x, z = q.popleft(); y = h(x, z)
        if y is None: continue
        nxt = []
        for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            n = (x + dx, z + dz); hy = h(*n)
            if (x, z) in hover:
                if hy is not None and hy - y <= 50 / 32: nxt.append(n)
            elif hy is not None and hy - y <= JUMP: nxt.append(n)
            elif hy is None:   # a running jump over a gap of up to 2 cells, landing no higher than half a jump up
                for k in (2, 3, 4):
                    n2 = (x + dx * k, z + dz * k); h2 = h(*n2)
                    if h2 is not None:
                        if h2 - y <= JUMP / 2: nxt.append(n2)
                        break
        for s in springs:
            sy = s.get('absY')
            near = (int(s['x']), int(s['z'])) == (x, z) or (sy is not None and abs(s['x'] - x - 0.5) < 2 and abs(s['z'] - z - 0.5) < 2 and sy - y <= JUMP)
            if near:
                y0 = sy if sy is not None else y
                for zz in range(z - 3, z + 4):
                    for xx in range(x - 3, x + 4):
                        hy = h(xx, zz)
                        if hy is not None and hy - y0 <= (94 if sy is not None else 140) / 32 + 0.2: nxt.append((xx, zz))
        if (x, z) in springcells:   # a floor spring (Spring Stadium): 124 units up, about 6 cells of run while in the air
            for zz in range(z - 6, z + 7):
                for xx in range(x - 6, x + 7):
                    hy = h(xx, zz)
                    if hy is not None and hy - y <= springcells[(x, z)] * 0.9 and abs(xx - x) + abs(zz - z) <= 6: nxt.append((xx, zz))
        for e in dashes:   # a dash cell: on along it, with a jump (up to 3 cells over a gap)
            if (int(e['x']), int(e['z'])) == (x, z):
                d = e['v']; l = (d[0] ** 2 + d[1] ** 2) ** 0.5; dx_, dz_ = round(d[0] / l), round(d[1] / l)
                run = run_on(x, z, dx_, dz_, 12); nxt += run
                ex, ez = run[-1] if run else (x, z)
                for k in (2, 3, 4):
                    hy = h(ex + dx_ * k, ez + dz_ * k)
                    if hy is not None: nxt.append((ex + dx_ * k, ez + dz_ * k)); nxt += run_on(ex + dx_ * k, ez + dz_ * k, dx_, dz_, 8); break
        for e in sleds:   # a sled: pulled to its start, then run along its way
            if e['box'][0] <= x < e['box'][1] and e['box'][2] <= z < e['box'][3]:
                sx, sz = int(e['at'][0]), int(e['at'][2]); nxt.append((sx, sz)); nxt += run_on(sx, sz, e['dir'][0], e['dir'][1], 30)
        for b in boosters:   # a supercharger: dashed off along its way
            if (int(b['x']), int(b['z'])) == (x, z):
                if gates and not state['pass']: state['pass'] = True; q.extend(seen)   # its run opens the gates
                nxt += run_on(x, z, b['dir'][0], b['dir'][1], 20)
        for e in carriers:
            b = e['box']
            if not (b[0] <= x + 0.5 < b[1] and b[2] <= z + 0.5 < b[3]): continue
            nxt.append((int(e['lo'] - 0.01), z))
            if e.get('launch'):
                k = e['launch'].get('key')
                if k and k not in state['keys']: state['keys'].add(k); q.extend(seen)
                ex, ey, ez = e['launch']['ride']['end']['at']; nxt.append((int(ex), int(ez)))
            else: nxt.append((int(e['hi'] + 0.01), z))
        for e in capsules:
            if abs(e['x'] - x - 0.5) <= 1.5 and abs(e['z'] - z - 0.5) <= 1.5 and e['top'] - y <= JUMP:
                for zz in range(int(e['z']) - 3, int(e['z']) + 4):
                    for xx in range(int(e['x']) - 3, int(e['x']) + 4):
                        hy = h(xx, zz)
                        if hy is not None and hy <= e['top'] + 50 / 32: nxt.append((xx, zz))
        for e in holes:
            if (int(e['x']), int(e['z'])) != (x, z) or e['opens'] > section: continue
            if e.get('key') and e['key'] not in state['keys']: state['keys'].add(e['key']); q.extend(seen)
            if 'ride' in e:
                r = e['ride']; st = r['start'] or [x + 0.5, 0, z + 0.5]
                if r['end']:
                    ex, ey, ez = r['end']['at']; vy = r['end']['vel'][1]
                    top_y = ey + (vy * vy / (2 * 900 / 32) if vy > 0 else 0)
                    for zz in range(int(ez) - 3, int(ez) + 4):
                        for xx in range(int(ex) - 3, int(ex) + 4):
                            hy = h(xx, zz)
                            if hy is not None and hy <= top_y + 0.1 and abs(xx - int(ex)) + abs(zz - int(ez)) <= (3 if vy > 0 else 0): nxt.append((xx, zz))
                else: ex, ez = st[0] + sum(p[0] for p in r['path']), st[2] + sum(p[2] for p in r['path'])
                nxt.append((int(ex), int(ez)))
                if r.get('alt') and r['alt']['ride'].get('end'):   # with the Flickies, the other way (taken as open)
                    ax, ay, az = r['alt']['ride']['end']['at']; nxt.append((int(ax), int(az)))
                f = r.get('force')
                if f and f.get('pass') and not state['pass']:   # the run: the gates open, everything met so far looked at again
                    state['pass'] = True; q.extend(seen)
                if f and f.get('dir'):
                    n = int(max(0, f['t'] - len(r['path']) / 60) * max(8, abs(r['vel'][0]) + abs(r['vel'][2])))
                    nxt += run_on(int(ex), int(ez), f['dir'][0], f['dir'][1], n)
            else: nxt.append((int(e['exit'][0]), int(e['exit'][1])))
        for e in vents:   # a vent: out of the other one, thrown up (a cell or two round it)
            if (int(e['x']), int(e['z'])) == (x, z):
                tx, ty, tz = int(e['to'][0]), e['to'][1], int(e['to'][2]); vy = e['vel'][1]; top_y = ty + vy * vy / (2 * 900 / 32)
                for zz in range(tz - 3, tz + 4):
                    for xx in range(tx - 3, tx + 4):
                        hy = h(xx, zz)
                        if hy is not None and hy <= top_y and abs(xx - tx) + abs(zz - tz) <= 4: nxt.append((xx, zz))
                nxt.append((tx, tz))
        for e in jets:   # a jet lift: stood on, it rises to y1; off it to anything a jump from there, 2 cells round
            if e['x0'] - 0.5 <= x + 0.5 <= e['x1'] + 0.5 and e['z0'] - 0.5 <= z + 0.5 <= e['z1'] + 0.5 and e['y0'] - y <= JUMP:
                for zz in range(int(e['z0']) - 2, int(e['z1']) + 3):
                    for xx in range(int(e['x0']) - 2, int(e['x1']) + 3):
                        hy = h(xx, zz)
                        if hy is not None and hy - e['y1'] <= JUMP: nxt.append((xx, zz))
        for n in nxt:
            if n not in seen: seen.add(n); q.append(n)
    return seen
balloons = [e for e in ents if e['type'] == 'balloon']
def reach(seeds, section):
    # balloons (Spring Stadium): one is reached by a jump from a cell within 2 (its foot no more than a jump up) or from
    # another reached balloon within 3 cells; a pop throws the player 43 units over its top (26 units over its base)
    seen = reach1(seeds, section); got = set()
    while True:
        new = []
        for k, b in enumerate(balloons):
            if k in got: continue
            bx, bz, top = int(b['x']), int(b['z']), b['y'] + 26 / 32
            ok = any((xx, zz) in seen and h(xx, zz) is not None and b['y'] - h(xx, zz) <= JUMP for zz in range(bz - 2, bz + 3) for xx in range(bx - 2, bx + 3))
            ok = ok or any((xx, zz) in seen and (xx, zz) in springcells and b['y'] - h(xx, zz) <= springcells[(xx, zz)] * 0.9 for zz in range(bz - 3, bz + 4) for xx in range(bx - 3, bx + 4))
            ok = ok or any(j in got and abs(int(c['x']) - bx) + abs(int(c['z']) - bz) <= 3 and b['y'] <= c['y'] + 26 / 32 + 43 / 32 for j, c in enumerate(balloons))
            if ok: got.add(k); new.append(k)
        if not new: return seen
        cells = []
        for k in new:
            b = balloons[k]; bx, bz = int(b['x']), int(b['z'])
            for zz in range(bz - 3, bz + 4):
                for xx in range(bx - 3, bx + 4):
                    hy = h(xx, zz)
                    if hy is not None and hy <= b['y'] + (26 + 43) / 32 and (xx, zz) not in seen: cells.append((xx, zz))
        seen = reach1(cells, section, seen) if cells else seen
area = reach([(int(start['x']), int(start['z']))], 0)
for k, g in enumerate(goals):
    gc = (int(g['x']), int(g['z']))
    print(f'ring {k + 1} at {gc}: reached {gc in area} (area {len(area)} cells)')
    if gc not in area: break
    seeds = [gc] + ([(int(g['put'][0]), int(g['put'][1]))] if 'put' in g else [])
    area = reach(seeds, k + 1) | area
