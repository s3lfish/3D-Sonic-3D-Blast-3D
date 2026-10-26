"""Generates the built-in level ("Scribble Isle") as level JSON.

Usage: python3 tools/make_level.py > tools/scribble_isle.json
Then tools/embed_level.py writes it into index.html.
Grid: x east (columns), z south (rows). Heights in 0.25 m units, base ground 4 (1 m).
"""
import json, random

W, D = 36, 32
B36 = '0123456789abcdefghijklmnopqrstuvwxyz'
h = [[4] * W for _ in range(D)]
ramps = [['.'] * W for _ in range(D)]
types = [['.'] * W for _ in range(D)]
ents = []


def fill(grid, x0, x1, z0, z1, v):
    for z in range(z0, z1 + 1):
        for x in range(x0, x1 + 1):
            grid[z][x] = v


# border wall: 1.5 m above the ground, stone
for i in range(W):
    for z in (0, D - 1):
        h[z][i] = 10; types[z][i] = '#'
for j in range(D):
    for x in (0, W - 1):
        h[j][x] = 10; types[j][x] = '#'

# west ridge, 3 m (2 m above ground), reached by a long staircase of 0.25 m steps
fill(h, 2, 9, 3, 12, 12)
for k, z in enumerate(range(20, 12, -1)):          # z 20..13 rise 5..12
    for x in (4, 5):
        h[z][x] = 5 + k

# downhill run east off the ridge: 8 ramp tiles dropping 2 m (x 10..17, z 5..7)
for k, x in enumerate(range(10, 18)):
    for z in (5, 6, 7):
        h[z][x] = 11 - k; ramps[z][x] = 'w'

# gorge running north to south (x 19..21) with a one-tile bridge at z 9
fill(types, 19, 21, 2, 24, 'x')
fill(h, 19, 21, 2, 24, 0)
fill(types, 19, 21, 9, 9, '=')
fill(h, 19, 21, 9, 9, 4)

# east plateau 2.5 m (1.5 m above ground): reach it by spring
fill(h, 26, 33, 3, 10, 10)

# hop blocks rising 1 m at a time
fill(h, 24, 25, 15, 16, 8)
fill(h, 27, 28, 17, 18, 12)
fill(h, 30, 31, 19, 20, 16)

# south-east basin, 0.5 m deep, ramps in from the north
fill(h, 25, 31, 25, 29, 2)
for x in range(25, 32):
    h[23][x] = 3; ramps[23][x] = 'n'
    h[24][x] = 2; ramps[24][x] = 'n'

# a low mound in the meadow: two steps up, one step down
fill(h, 9, 13, 21, 25, 5)
fill(h, 10, 12, 22, 24, 6)


def ring_line(a, b, n, y=None):
    e = {"type": "ringLine", "from": a, "to": b, "count": n}
    if y is not None:
        e["y"] = y
    ents.append(e)


ents.append({"type": "start", "x": 4.5, "z": 27.5, "facing": 45})
# meadow and mound
ring_line([6.5, 27.5], [16.5, 27.5], 6)
ents.append({"type": "ringCircle", "center": [11, 23], "radius": 1.2, "count": 6})
# up the stairs and along the ridge
ring_line([4.5, 19.5], [4.5, 13.5], 5)
ring_line([3.5, 8.5], [8.5, 8.5], 5)
# down the ramp
ring_line([10.5, 6.5], [17.5, 6.5], 8)
# over the bridge
ring_line([18.5, 9.5], [22.5, 9.5], 5)
# a jump over the gorge further south
ring_line([18.2, 18.5], [22.8, 18.5], 5, 1.2)
# spring to the east plateau
ents.append({"type": "spring", "x": 29.5, "z": 12.0, "power": 12})
ring_line([27.5, 5.5], [32.5, 5.5], 6)
ring_line([27.5, 8.5], [32.5, 8.5], 6)
# hop blocks
for (x, z) in [(25, 16), (28, 18), (31, 20)]:
    ents.append({"type": "ring", "x": x, "z": z})
ents.append({"type": "ringCircle", "center": [31, 20], "radius": 0.6, "count": 4, "y": 1.2})
# basin
ents.append({"type": "ringCircle", "center": [28, 27], "radius": 1.6, "count": 8})

# enemies on small patrol loops, monitors worth ten rings, and the goal flag
for x, z, r in [(12.0, 28.5, 1.5), (24.5, 9.5, 1.2), (30.0, 7.0, 2.0), (28.0, 27.0, 1.0), (6.0, 6.5, 1.5), (13.5, 13.5, 1.8)]:
    ents.append({"type": "enemy", "x": x, "z": z, "radius": r})
for x, z in [(8.5, 4.0), (2.5, 24.5), (32.5, 4.0), (23.0, 23.5)]:
    ents.append({"type": "monitor", "x": x, "z": z})
ents.append({"type": "goal", "x": 33.0, "z": 27.5})

# decor: deterministic scatter
rnd = random.Random(7)
palms = [(2.5, 29.5), (8.5, 30.0), (15.5, 30.0), (2.0, 15.5), (12.5, 2.0), (17.0, 2.0),
         (23.5, 2.0), (34.0, 13.5), (34.0, 22.0), (23.0, 29.5), (33.5, 30.0), (7.5, 18.5), (16.5, 12.5)]
for i, (x, z) in enumerate(palms):
    ents.append({"type": "palm", "x": x, "z": z, "variant": i % 2})
bushes = [(1.8, 21.5), (14.5, 18.0), (17.5, 23.5), (23.0, 13.0), (34.0, 17.5), (24.5, 21.0), (6.0, 1.8), (2.0, 2.2)]
for i, (x, z) in enumerate(bushes):
    ents.append({"type": "bush", "x": x, "z": z, "variant": i % 2})


def free(x, z):
    i, j = int(x), int(z)
    return types[j][i] == '.' and ramps[j][i] == '.' and 0 < i < W - 1 and 0 < j < D - 1


n = 0
while n < 60:
    x, z = rnd.uniform(1.2, W - 1.2), rnd.uniform(1.2, D - 1.2)
    if free(x, z):
        ents.append({"type": "flower", "x": round(x, 2), "z": round(z, 2), "variant": rnd.randrange(4)})
        n += 1

level = {
    "version": 1,
    "format": "grid",
    "name": "Scribble Isle",
    "heightUnit": 0.25,
    "killY": -1.5,
    "heights": ["".join(B36[v] for v in row) for row in h],
    "ramps": ["".join(r) for r in ramps],
    "types": ["".join(t) for t in types],
    "entities": ents,
}
print(json.dumps(level, indent=1))
