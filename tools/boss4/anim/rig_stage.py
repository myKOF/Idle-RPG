"""BOSS4 animated: add humanoid upper body rig, rebuild straight spear bound to weapon_r.
blender -b --python rig_stage.py -- OUT.blend
"""
import bpy, bmesh, math, sys, os
from mathutils import Vector, Matrix
from mathutils.geometry import intersect_point_line
OUT = sys.argv[sys.argv.index("--") + 1]
SRC = os.environ.get("BOSS4_ANIMATED_SRC", r"C:\Users\user\OneDrive\Desktop\BOSS4_-animated.glb")   # the user's afk-horse rig + Walk/Run

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
bpy.data.objects.remove(bpy.data.objects['Icosphere'])
arm = bpy.data.objects['Armature']; body = bpy.data.objects['low_poly_unwrapped']
arm.name = "BOSS4_Armature"; body.name = "BOSS4_Body"
arm.animation_data.action = None
for t in arm.animation_data.nla_tracks: t.mute = True
for pb in arm.pose.bones: pb.matrix_basis.identity()
bpy.context.view_layer.update()
me = body.data

# ---------------------------------------------------------------- spear split
AXP = Vector((-0.15, -0.513))
def R(z):
    if z < 0.97: return 0.045
    if z < 1.12: return 0.030      # grip zone (fist wraps the shaft)
    if z < 1.16: return 0.05
    return 0.15
spear_faces = set()
gi0 = {g.index: g.name for g in body.vertex_groups}
def dom0(v): return gi0[max(v.groups, key=lambda g: g.weight).group] if v.groups else None
for f in me.polygons:
    vs = [me.vertices[i] for i in f.vertices]
    if all((v.co.xy - AXP).length < R(v.co.z) for v in vs) or        all(dom0(v) in ("mouth", "ear_1_l") and (v.co.xy - AXP).length < 0.16 for v in vs):
        spear_faces.add(f.index)
spear = body.copy(); spear.data = me.copy(); spear.name = "BOSS4_Spear"
bpy.context.scene.collection.objects.link(spear)
for ob, keep in ((body, False), (spear, True)):
    bm = bmesh.new(); bm.from_mesh(ob.data); bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if (f.index in spear_faces) != keep], context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(ob.data); bm.free()
spear.modifiers.clear(); spear.vertex_groups.clear(); spear.parent = None; spear.matrix_world = Matrix()
sm = spear.data
print("spear verts", len(sm.vertices), "body verts", len(me.vertices))

# straighten: remove per-height centreline offset, make the axis exactly vertical
bins = {}
for v in sm.vertices:
    k = int(v.co.z / 0.05)
    if (v.co.xy - AXP).length < 0.035: bins.setdefault(k, []).append(v.co.xy.copy())
cent = {k: sum(p, Vector((0, 0))) / len(p) for k, p in bins.items() if len(p) >= 3}
ks = sorted(cent)
def centre(z):
    k = z / 0.05 - 0.5
    lo = max([q for q in ks if q <= k], default=ks[0]); hi = min([q for q in ks if q >= k], default=ks[-1])
    if lo == hi: return cent[lo]
    u = (k - lo) / (hi - lo); return cent[lo] * (1 - u) + cent[hi] * u
dev = max((cent[k] - AXP).length for k in ks)
for v in sm.vertices:
    c = centre(v.co.z); v.co.x += AXP.x - c.x; v.co.y += AXP.y - c.y
print("spear max centreline deviation before straighten %.4f" % dev)

# fill grip gap with an 8-sided shaft if faces are missing
iv = sorted((min(sm.vertices[i].co.z for i in f.vertices), max(sm.vertices[i].co.z for i in f.vertices)) for f in sm.polygons)
gaps = []; cur = iv[0]
for a, b in iv[1:]:
    if a > cur[1] + 1e-4: gaps.append((cur[1], a)); cur = (a, b)
    else: cur = (cur[0], max(cur[1], b))
print("spear gaps", [(round(a, 3), round(b, 3)) for a, b in gaps])
shaft = sorted((v.co.xy - AXP).length for v in sm.vertices if 0.3 < v.co.z < 0.95 and (v.co.xy - AXP).length < 0.035)
rad = shaft[len(shaft) // 2]
bm = bmesh.new(); bm.from_mesh(sm); uvl = bm.loops.layers.uv.active
bm.verts.ensure_lookup_table()
from mathutils.kdtree import KDTree
kd = KDTree(len(bm.verts))
for v in bm.verts: kd.insert(v.co, v.index)
kd.balance()
def uvn(p):
    v = bm.verts[kd.find(p)[1]]; return v.link_loops[0][uvl].uv.copy() if v.link_loops else Vector((0, 0))
for a, b in gaps:
    if b - a < 0.005: continue
    z0, z1 = a - 0.01, b + 0.01; N = 8
    rings = [[Vector((AXP.x + rad * math.cos(2 * math.pi * k / N), AXP.y + rad * math.sin(2 * math.pi * k / N), z)) for k in range(N)] for z in (z0, z1)]
    uvs = [[uvn(p) for p in r] for r in rings]; vs = [[bm.verts.new(p) for p in r] for r in rings]
    nf = []
    for k in range(N):
        k2 = (k + 1) % N
        f = bm.faces.new((vs[0][k], vs[0][k2], vs[1][k2], vs[1][k]))
        for l, uv in zip(f.loops, (uvs[0][k], uvs[0][k2], uvs[1][k2], uvs[1][k])): l[uvl].uv = uv
        nf.append(f)
    bmesh.ops.recalc_face_normals(bm, faces=nf); bmesh.ops.triangulate(bm, faces=nf)
bm.to_mesh(sm); bm.free()

# re-grip: slide the spear along its axis so the fist (z 1.05) holds it one third up from the butt
zs = [v.co.z for v in sm.vertices]; zmin, zmax = min(zs), max(zs)
GRIP_FRAC = 1.0 / 3.0 + 0.10      # user: rear third, then 10% of the length further forward
shift = 1.05 - (zmin + (zmax - zmin) * GRIP_FRAC)
for v in sm.vertices: v.co.z += shift
print("spear length %.3f, slid up %.3f (grip now %.0f%% from the butt)" % (zmax - zmin, shift, GRIP_FRAC * 100))

# ---------------------------------------------------------------- new bones
X = 0.14
J = {
    "waist": (X, -0.25, 0.92), "chest": (X, -0.25, 1.08), "chest_top": (X, -0.25, 1.24), "neck_top": (X, -0.26, 1.34), "head_top": (X, -0.26, 1.58),
    "clav_r0": (X - 0.03, -0.25, 1.21), "sh_r": (-0.03, -0.27, 1.20), "el_r": (-0.07, -0.29, 1.02), "wr_r": (-0.14, -0.43, 1.03), "hd_r": (-0.155, -0.53, 1.05),
    "clav_l0": (X + 0.03, -0.25, 1.21), "sh_l": (0.30, -0.21, 1.19), "el_l": (0.35, -0.18, 1.00), "wr_l": (0.44, -0.20, 0.83), "hd_l": (0.455, -0.24, 0.75),
}
J = {k: Vector(v) for k, v in J.items()}
BONES = [  # name, head, tail, parent, capsule radius
    ("upper_waist", "waist", "chest", "spine_3", 0.15),
    ("upper_chest", "chest", "chest_top", "upper_waist", 0.16),
    ("upper_neck", "chest_top", "neck_top", "upper_chest", 0.07),
    ("upper_head", "neck_top", "head_top", "upper_neck", 0.11),
    ("clavicle_r", "clav_r0", "sh_r", "upper_chest", 0.07),
    ("upperarm_r", "sh_r", "el_r", "clavicle_r", 0.065),
    ("forearm_r", "el_r", "wr_r", "upperarm_r", 0.055),
    ("hand_r", "wr_r", "hd_r", "forearm_r", 0.055),
    ("clavicle_l", "clav_l0", "sh_l", "upper_chest", 0.07),
    ("upperarm_l", "sh_l", "el_l", "clavicle_l", 0.065),
    ("forearm_l", "el_l", "wr_l", "upperarm_l", 0.055),
    ("hand_l", "wr_l", "hd_l", "forearm_l", 0.055),
]
DELETE = ["spine_5", "spine_6", "head", "ear_1_r", "ear_2_r", "ear_leaf_r", "ear_1_l", "ear_2_l", "ear_leaf_l",
          "nose", "head_leaf", "mouth", "mouth_tip"]
UPPER_OLD = set(DELETE) | {"spine_4"}

gi = {g.index: g.name for g in body.vertex_groups}
def wget(v): return {gi[g.group]: g.weight for g in v.groups}

bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
eb = arm.data.edit_bones
for n, a, b, par, r in BONES:
    e = eb.new(n); e.head = J[a]; e.tail = J[b]; e.parent = eb[par]
    e.use_connect = n in ("upper_chest", "upper_neck", "upper_head", "upperarm_r", "forearm_r", "hand_r", "upperarm_l", "forearm_l", "hand_l")
    e.align_roll(Vector((0, -1, 0)) if n.startswith("upper_") else Vector((0, 0, 1)))
grip = Vector((AXP.x, AXP.y, 1.05))
w = eb.new("weapon_r"); w.head = grip; w.tail = grip + Vector((0, 0, 0.3)); w.parent = eb["hand_r"]; w.align_roll(Vector((0, -1, 0)))
for n in DELETE: eb.remove(eb[n])
bpy.ops.object.mode_set(mode='OBJECT')

# ---------------------------------------------------------------- weights
def ss(a, b, x):
    if x <= a: return 0.0
    if x >= b: return 1.0
    u = (x - a) / (b - a); return u * u * (3 - 2 * u)
for n, *_ in BONES: body.vertex_groups.new(name=n)
caps = [(n, J[a], J[b], r) for n, a, b, par, r in BONES]
res = []; nU = 0
for v in me.vertices:
    p = v.co; old = wget(v)
    dom = max(old.items(), key=lambda kv: kv[1])[0] if old else None
    isU = dom in UPPER_OLD or (dom == "spine_3" and p.z > 0.88) or (p.z > 0.95 and dom in ("spine_2", "spine_3"))
    oldr = {}
    for k, wv in old.items():
        k2 = "spine_3" if k in DELETE else k
        oldr[k2] = oldr.get(k2, 0) + wv
    if not isU:
        res.append(oldr); continue
    nU += 1
    raw = {}
    for n, a, b, r in caps:
        t = max(0, min(1, intersect_point_line(p, a, b)[1]))
        d = (p - (a + (b - a) * t)).length
        raw[n] = 1.0 / max(d / r, 0.25) ** 4
    if p.z > 1.36 and abs(p.x - X) < 0.34 and p.y > -0.42 and min((p - J["hd_r"]).length, (p - J["sh_r"]).length, (p - J["sh_l"]).length) > 0.12:
        raw = {"upper_head": 1.0}           # helmet + horns ride the head
    tot = sum(raw.values()); up = {k: x / tot for k, x in raw.items()}
    armw = sum(x for k, x in up.items() if k.endswith(("_r", "_l")))
    f = armw + (1 - armw) * ss(0.86, 0.97, p.z)   # waist blends into the horse withers; arms never do
    s0 = sum(oldr.values()) or 1
    new = {k: x * f for k, x in up.items()}
    for k, x in oldr.items():
        k2 = "spine_3" if k == "spine_4" else k
        new[k2] = new.get(k2, 0) + x / s0 * (1 - f)
    res.append(new)
print("upper-body verts", nU)
# smooth across mesh (merge UV seams by position)
key = lambda co: (round(co.x, 5), round(co.y, 5), round(co.z, 5))
rep = [key(v.co) for v in me.vertices]
grp = {}
for i, k in enumerate(rep): grp.setdefault(k, i)
adj = {}
for e in me.edges:
    ka, kb = rep[e.vertices[0]], rep[e.vertices[1]]
    if ka != kb: adj.setdefault(ka, set()).add(kb); adj.setdefault(kb, set()).add(ka)
Wk = {k: dict(res[i]) for k, i in grp.items()}
NEW = {n for n, *_ in BONES}
zone = {k for k, d in Wk.items() if any(b in NEW for b in d)}
for it in range(3):
    nxt = {}
    for k in zone:
        nb = adj.get(k)
        if not nb: continue
        acc = {}
        for q in nb:
            for b, x in Wk[q].items(): acc[b] = acc.get(b, 0) + x / len(nb)
        cur = Wk[k]; nxt[k] = {b: 0.5 * cur.get(b, 0) + 0.5 * acc.get(b, 0) for b in set(cur) | set(acc)}
    Wk.update(nxt)
for v in me.vertices:
    new = Wk[rep[v.index]]
    items = sorted(((k, x) for k, x in new.items() if x > 0.01 and k in body.vertex_groups), key=lambda kv: -kv[1])[:4]
    s = sum(x for _, x in items) or 1
    for g in list(v.groups): body.vertex_groups[g.group].remove([v.index])
    for k, x in items: body.vertex_groups[k].add([v.index], x / s, 'REPLACE')
for n in DELETE:
    if n in body.vertex_groups: body.vertex_groups.remove(body.vertex_groups[n])

# ---------------------------------------------------------------- merge spear, 100% on weapon_r
for g in list(spear.vertex_groups): spear.vertex_groups.remove(g)
spear.vertex_groups.new(name="weapon_r").add(list(range(len(spear.data.vertices))), 1.0, 'REPLACE')
bpy.ops.object.select_all(action='DESELECT')
spear.select_set(True); body.select_set(True); bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
print("merged verts", len(body.data.vertices))

# ---------------------------------------------------------------- face forward
# The source model's head is turned ~27 deg to the character's left. Bake a counter-turn into the rest pose
# (neck 9 + head 18 deg to the right) so every animation starts with the head facing straight ahead.
HEAD_FIX = (("upper_neck", -9.0), ("upper_head", -18.0))
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='POSE')
for pb in arm.pose.bones: pb.matrix_basis.identity()
bpy.context.view_layer.update()
for n, deg in HEAD_FIX:
    pb = arm.pose.bones[n]; h = pb.matrix.to_translation()
    pb.matrix = Matrix.Translation(h) @ Matrix.Rotation(math.radians(deg), 4, 'Z') @ Matrix.Translation(-h) @ pb.matrix
    bpy.context.view_layer.update()
bpy.ops.object.mode_set(mode='OBJECT')
mod = [m for m in body.modifiers if m.type == 'ARMATURE'][0]
bpy.context.view_layer.objects.active = body
with bpy.context.temp_override(object=body, active_object=body):
    bpy.ops.object.modifier_apply(modifier=mod.name)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='POSE'); bpy.ops.pose.armature_apply(selected=False); bpy.ops.object.mode_set(mode='OBJECT')
m2 = body.modifiers.new("Armature", 'ARMATURE'); m2.object = arm
print("head turned to face forward:", HEAD_FIX)

# ---------------------------------------------------------------- clean actions of deleted bones; drop old Death
for a in list(bpy.data.actions):
    if a.name == "Death":
        bpy.data.actions.remove(a); continue
    for fc in list(a.fcurves):
        if any(f'pose.bones["{n}"]' in fc.data_path for n in DELETE): a.fcurves.remove(fc)
for t in list(arm.animation_data.nla_tracks):
    if not t.strips or any(s.action is None for s in t.strips): arm.animation_data.nla_tracks.remove(t)
for a in bpy.data.actions: a.use_fake_user = True
print("actions", [a.name for a in bpy.data.actions], "bones", len(arm.data.bones))
bpy.ops.wm.save_as_mainfile(filepath=OUT)
