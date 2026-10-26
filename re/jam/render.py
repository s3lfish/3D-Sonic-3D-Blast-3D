import sys, math, numpy as np
sys.path.insert(0, 'tools')
from jam import *
from PIL import Image, ImageDraw
PARENT = [-1, 0, 0, 2, 3, 0, 5, 6, 0, 8, 9, 0, 11, 12, 0]   # body, head, RThigh, RCalf, RFoot, LThigh, LCalf, LFoot, RBicep, RWrist, RHand, LBicep, LWrist, LHand, Tail
def rot(a, order):
    ax, ay, az = [v * 2 * math.pi / 65536 for v in a]
    X = np.array([[1, 0, 0], [0, math.cos(ax), -math.sin(ax)], [0, math.sin(ax), math.cos(ax)]])
    Y = np.array([[math.cos(ay), 0, math.sin(ay)], [0, 1, 0], [-math.sin(ay), 0, math.cos(ay)]])
    Z = np.array([[math.cos(az), -math.sin(az), 0], [math.sin(az), math.cos(az), 0], [0, 0, 1]])
    M = {'X': X, 'Y': Y, 'Z': Z}; R = np.eye(3)
    for c in order: R = R @ M[c]
    return R
def pose(j, frame, order='ZYX', footer=0x42620):
    ptrs, vecs = j.group(footer, 15)
    gp, gr, rots = frame
    world = []
    for k in range(15):
        R = rot(rots[k], order); t = np.array(vecs[k])
        if PARENT[k] < 0: W = (rot(gr, order) @ R, np.array(gp) + t)
        else:
            PR, Pt = world[PARENT[k]]; W = (PR @ R, Pt + PR @ t)
        world.append(W)
    polys = []
    for k, f in enumerate(ptrs):
        V, Q, D = j.submodel(f); R, t = world[k]
        P = [R @ np.array(v) + t for v in V]
        for q, d in zip(Q, D):
            polys.append(([P[i] for i in q], d))
    return polys
def colour(j, d, cache={}):
    if d['tex']:
        if d['tex'] not in cache:
            w, h, rows = j.texture(d['tex']); px = [p for r in rows for p in r if p[3]]
            cache[d['tex']] = tuple(int(sum(p[i] for p in px) / max(1, len(px))) for i in range(3)) if px else (255, 0, 255)
        return cache[d['tex']]
    c = d['col']; return ((c & 31) * 8, ((c >> 5) & 31) * 8, ((c >> 10) & 31) * 8)
def draw(j, polys, yaw=0.6, size=300, scale=2.2):
    img = Image.new('RGB', (size, size), (40, 40, 60)); dr = ImageDraw.Draw(img)
    cy, sy = math.cos(yaw), math.sin(yaw)
    def proj(p): x = p[0] * cy - p[2] * sy; z = p[0] * sy + p[2] * cy; return (size / 2 + x * scale, size * 0.45 - p[1] * scale, z)
    items = []
    for pts, d in polys:
        q = [proj(p) for p in pts]; items.append((sum(v[2] for v in q) / 4, q, d))
    for _, q, d in sorted(items, key=lambda a: -a[0]):
        dr.polygon([(v[0], v[1]) for v in q], fill=colour(j, d), outline=(0, 0, 0))
    return img
if __name__ == '__main__':
    j = Jam(open('files/MUSEUM.MUS', 'rb').read(), open('files/SPRDATA.MUS', 'rb').read())
    sheet = Image.new('RGB', (1200, 600))
    idle = j.anim(0x28E1A)[0]; run = j.anim(0x27BFE)
    for i, order in enumerate(['XYZ', 'ZYX', 'YXZ', 'ZXY']):
        sheet.paste(draw(j, pose(j, idle, order)), (i * 300, 0))
        sheet.paste(draw(j, pose(j, run[4], order), yaw=1.57), (i * 300, 300))
    sheet.save('notes/pose_orders.png')
