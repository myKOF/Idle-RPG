"""Bind a textured BOSS4 variant (original Meshy pose, unrigged) to the finished BOSS4 rig and actions.

blender -b --python build_variant.py -- TEXTURED.glb ANIM_RIG.blend CORRECTED_REF.blend OUT.blend OUT_GAME.glb

- body: every textured vertex is matched to the 11-10 corrected mesh by its UV, takes the corrected position and
  the rigid ICP transform that lines the corrected mesh up with the animation rig's rest mesh (head already straight);
- spear: the unmatched vertices; scaled like the body, straightened, grip-gap filled, gripped at 43% from the butt and
  bound 100% to weapon_r with its blade prongs turned to match the animated spear;
- weights: nearest-surface interpolation from the animation rig's body (its spear removed first);
- actions renamed to the tower-boss convention: Walk, Attack1 (thrust), Attack2 (slash), Attack3 (power), Die.
"""
import bpy, bmesh, math, sys, statistics
from mathutils import Vector, Matrix
from mathutils.kdtree import KDTree

TEX, RIG, REF, OUT_BLEND, OUT_GLB = sys.argv[sys.argv.index("--") + 1:][:5]
ICP_YAW, ICP_T = math.radians(-0.62), Vector((0.1177, 0.0372, -0.0005))
GRIP_FRAC = 1.0 / 3.0 + 0.10
CLIP_NAMES = {"Walk": "Walk", "Attack_Thrust": "Attack1", "Attack_Slash": "Attack2", "Attack_Power": "Attack3", "Death": "Die"}

def mesh_uv_pos(ob):
    me = ob.data; uv = me.uv_layers.active.data; U = {}
    for l in me.loops: U.setdefault(l.vertex_index, uv[l.index].uv.copy())
    return [(ob.matrix_world @ v.co, U.get(v.index)) for v in me.vertices]

# ---------------------------------------------------------------- reference: corrected positions by UV
bpy.ops.wm.open_mainfile(filepath=REF)
REFP = mesh_uv_pos(bpy.data.objects["BOSS4_Body"])
ref_kd = KDTree(len(REFP))
for i, (p, uv) in enumerate(REFP): ref_kd.insert(Vector((uv.x, uv.y, 0)), i)
ref_kd.balance()

# ---------------------------------------------------------------- the animation rig
bpy.ops.wm.open_mainfile(filepath=RIG)
arm = bpy.data.objects["BOSS4_Armature"]; old = bpy.data.objects["BOSS4_Body"]
ad = arm.animation_data
for t in ad.nla_tracks: t.mute = True
ad.action = None
for pb in arm.pose.bones: pb.matrix_basis.identity()
bpy.context.view_layer.update()
ogi = {g.index: g.name for g in old.vertex_groups}
old_spear = [v.index for v in old.data.vertices if any(ogi[g.group] == "weapon_r" and g.weight > 0.5 for g in v.groups)]
OSP = [old.matrix_world @ old.data.vertices[i].co for i in old_spear]
wb = arm.data.bones["weapon_r"]
GRIP = arm.matrix_world @ wb.head_local
AXIS = (arm.matrix_world.to_3x3() @ (wb.tail_local - wb.head_local)).normalized()
# blade-prong direction of the animated spear: widest horizontal spread near the spearhead
osz = [(p - GRIP).dot(AXIS) for p in OSP]; top = max(osz)
head = [p for p, s in zip(OSP, osz) if s > top - 0.45]
c = sum(head, Vector()) / len(head)
def perp(v): return v - AXIS * v.dot(AXIS)
cov = [[0, 0, 0] for _ in range(3)]
for p in head:
    d = perp(p - c)
    for a in range(3):
        for b in range(3): cov[a][b] += d[a] * d[b]
Mcov = Matrix(cov); vec = Vector((1, 0, 0))
for _ in range(50): vec = (Mcov @ vec).normalized()
PRONG = perp(vec).normalized()
print("anim spear: grip", tuple(round(x, 3) for x in GRIP), "axis", tuple(round(x, 3) for x in AXIS), "prongs", tuple(round(x, 2) for x in PRONG))

# ---------------------------------------------------------------- import the textured variant
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=TEX)
tex = [o for o in bpy.data.objects if o not in before and o.type == 'MESH'][0]
for o in [o for o in bpy.data.objects if o not in before and o is not tex]: bpy.data.objects.remove(o)
bpy.ops.object.select_all(action='DESELECT'); tex.select_set(True); bpy.context.view_layer.objects.active = tex
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
tex.parent = None
TP = mesh_uv_pos(tex)
match = {}
for i, (p, uv) in enumerate(TP):
    co, j, d = ref_kd.find(Vector((uv.x, uv.y, 0)))
    if d < 1e-5: match[i] = j
print("textured verts", len(TP), "matched to the corrected body", len(match))

# similarity scale textured -> corrected (from matched lower-body pairs, which were only moved rigidly)
pairs = [(TP[i][0], REFP[j][0]) for i, j in match.items() if REFP[j][0].z < 0.55]
pairs = pairs[::max(1, len(pairs) // 1500)]
ratios = []
for k in range(len(pairs) - 1):
    a, b = pairs[k], pairs[k + 1]
    dt = (a[0] - b[0]).length; dr = (a[1] - b[1]).length
    if dt > 0.05: ratios.append(dr / dt)
SCALE = statistics.median(ratios)
print("scale textured -> rig units %.4f" % SCALE)

Rz = Matrix.Rotation(ICP_YAW, 3, 'Z')
me = tex.data
for i, j in match.items():
    me.vertices[i].co = Rz @ REFP[j][0] + ICP_T

# ---------------------------------------------------------------- spear: unmatched verts
bm = bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table(); bm.faces.ensure_lookup_table()
spear_faces = [f for f in bm.faces if any(v.index not in match for v in f.verts)]
spear_vidx = {v.index for f in spear_faces for v in f.verts}
print("spear faces", len(spear_faces), "spear verts", len(spear_vidx))
# shared boundary verts were moved with the body: give the spear its own copies first
geom = bmesh.ops.duplicate(bm, geom=spear_faces + list({e for f in spear_faces for e in f.edges}) + [bm.verts[i] for i in spear_vidx])
new_faces = [g for g in geom["geom"] if isinstance(g, bmesh.types.BMFace)]
new_verts = [g for g in geom["geom"] if isinstance(g, bmesh.types.BMVert)]
vmap = geom["vert_map"]
# restore the duplicated spear verts to the textured (original-pose) coordinates, scaled to rig units
orig = {i: TP[i][0] for i in spear_vidx}
for src, dst in vmap.items():
    if isinstance(src, bmesh.types.BMVert) and src.index in orig:
        dst.co = orig[src.index] * SCALE
SV = [v for v in new_verts]
bmesh.ops.delete(bm, geom=spear_faces, context='FACES')
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
# axis by PCA of the shaft, then straighten per height and stand it on +Z through the origin
cen = sum((v.co for v in SV), Vector()) / len(SV)
cov = [[0, 0, 0] for _ in range(3)]
for v in SV:
    d = v.co - cen
    for a in range(3):
        for b in range(3): cov[a][b] += d[a] * d[b]
ax = Vector((0, 0, 1))
for _ in range(60): ax = (Matrix(cov) @ ax).normalized()
if ax.z < 0: ax = -ax
R = ax.rotation_difference(Vector((0, 0, 1))).to_matrix()
for v in SV: v.co = R @ (v.co - cen)
zs = [v.co.z for v in SV]; z0, z1 = min(zs), max(zs)
bins = {}
for v in SV:
    if v.co.xy.length < 0.04: bins.setdefault(int((v.co.z - z0) / 0.05), []).append(v.co.xy.copy())
cent = {k: sum(p, Vector((0, 0))) / len(p) for k, p in bins.items() if len(p) >= 3}
ks = sorted(cent)
def centre(z):
    k = (z - z0) / 0.05 - 0.5
    lo = max([q for q in ks if q <= k], default=ks[0]); hi = min([q for q in ks if q >= k], default=ks[-1])
    if lo == hi: return cent[lo]
    u = (k - lo) / (hi - lo); return cent[lo] * (1 - u) + cent[hi] * u
for v in SV:
    c2 = centre(v.co.z); v.co.x -= c2.x; v.co.y -= c2.y
print("spear length %.3f" % (z1 - z0))
# fill the fist gap in the shaft if faces are missing
iv = sorted((min(v.co.z for v in f.verts), max(v.co.z for v in f.verts)) for f in new_faces)
gaps = []; cur = iv[0]
for a, b in iv[1:]:
    if a > cur[1] + 1e-4: gaps.append((cur[1], a)); cur = (a, b)
    else: cur = (cur[0], max(cur[1], b))
shaft = sorted(v.co.xy.length for v in SV if z0 + 0.3 < v.co.z < z0 + 0.9 and v.co.xy.length < 0.035)
rad = shaft[len(shaft) // 2] if shaft else 0.024
uvl = bm.loops.layers.uv.active
skd = KDTree(len(SV))
for k, v in enumerate(SV): skd.insert(v.co, k)
skd.balance()
def uvn(p):
    v = SV[skd.find(p)[1]]; return v.link_loops[0][uvl].uv.copy() if v.link_loops else Vector((0, 0))
for a, b in gaps:
    if b - a < 0.005: continue
    N = 8; rings = [[Vector((rad * math.cos(2 * math.pi * k / N), rad * math.sin(2 * math.pi * k / N), z)) for k in range(N)] for z in (a - 0.01, b + 0.01)]
    uvs = [[uvn(p) for p in r] for r in rings]
    vs = [[bm.verts.new(p) for p in r] for r in rings]; SV += vs[0] + vs[1]
    nf = []
    for k in range(N):
        k2 = (k + 1) % N; f = bm.faces.new((vs[0][k], vs[0][k2], vs[1][k2], vs[1][k]))
        for l, uv in zip(f.loops, (uvs[0][k], uvs[0][k2], uvs[1][k2], uvs[1][k])): l[uvl].uv = uv
        nf.append(f)
    bmesh.ops.recalc_face_normals(bm, faces=nf); bmesh.ops.triangulate(bm, faces=nf)
print("spear gaps filled", [(round(a, 3), round(b, 3)) for a, b in gaps])
# prongs: textured spearhead's widest horizontal spread -> the animated spear's prong direction
top = max(v.co.z for v in SV)
hp = [v.co for v in SV if v.co.z > top - 0.45]
hc = sum(hp, Vector()) / len(hp)
cov2 = [[0, 0], [0, 0]]
for p in hp:
    d = p - hc; cov2[0][0] += d.x * d.x; cov2[0][1] += d.x * d.y; cov2[1][1] += d.y * d.y
ang = 0.5 * math.atan2(2 * cov2[0][1], cov2[0][0] - cov2[1][1])
grip_z = z0 + (z1 - z0) * GRIP_FRAC
# frame: local z -> AXIS, local x (prong) -> PRONG
X = PRONG; Z = AXIS; Y = Z.cross(X)
F = Matrix((X, Y, Z)).transposed()
Rp = Matrix.Rotation(-ang, 3, 'Z')
for v in SV:
    if not v.is_valid: continue
    v.co = GRIP + F @ (Rp @ Vector((v.co.x, v.co.y, v.co.z - grip_z)))
valid = [v for v in SV if v.is_valid]
spear_keys = {(round(v.co.x, 5), round(v.co.y, 5), round(v.co.z, 5)) for v in valid}
print("spear verts valid", len(valid), "of", len(SV))
bm.to_mesh(me); bm.free()
me_v = me.vertices
sp_idx = [v.index for v in me_v if (round(v.co.x, 5), round(v.co.y, 5), round(v.co.z, 5)) in spear_keys]
print("spear vertices bound to weapon_r", len(sp_idx))

# ---------------------------------------------------------------- weights from the animation body
src = old.copy(); src.data = old.data.copy(); bpy.context.scene.collection.objects.link(src)
bms = bmesh.new(); bms.from_mesh(src.data); bms.verts.ensure_lookup_table()
bmesh.ops.delete(bms, geom=[bms.verts[i] for i in old_spear], context='VERTS'); bms.to_mesh(src.data); bms.free()
src.modifiers.clear(); src.parent = None; src.matrix_world = old.matrix_world.copy()
for g in list(tex.vertex_groups): tex.vertex_groups.remove(g)
for g in old.vertex_groups: tex.vertex_groups.new(name=g.name)
dt = tex.modifiers.new("dt", 'DATA_TRANSFER'); dt.object = src
dt.use_vert_data = True; dt.data_types_verts = {'VGROUP_WEIGHTS'}; dt.vert_mapping = 'POLYINTERP_NEAREST'
dt.layers_vgroup_select_src = 'ALL'; dt.layers_vgroup_select_dst = 'NAME'
bpy.context.view_layer.objects.active = tex
with bpy.context.temp_override(object=tex, active_object=tex):
    bpy.ops.object.modifier_apply(modifier=dt.name)
spset = set(sp_idx); gi = {g.index: g.name for g in tex.vertex_groups}
for v in me.vertices:
    if v.index in spset:
        for g in list(v.groups): tex.vertex_groups[g.group].remove([v.index])
        tex.vertex_groups["weapon_r"].add([v.index], 1.0, 'REPLACE'); continue
    items = sorted(((gi[g.group], g.weight) for g in v.groups if gi[g.group] != "weapon_r" and g.weight > 0.01), key=lambda x: -x[1])[:4]
    s = sum(w for _, w in items) or 1
    for g in list(v.groups): tex.vertex_groups[g.group].remove([v.index])
    for n, w in items: tex.vertex_groups[n].add([v.index], w / s, 'REPLACE')
bpy.data.objects.remove(src)
unw = sum(1 for v in me.vertices if not v.groups)
print("unweighted verts", unw)

# ---------------------------------------------------------------- swap meshes, rename clips
mats = list(me.materials)
bpy.data.objects.remove(old)
tex.name = "BOSS4_Body"; tex.data.name = "BOSS4_Body"
tex.parent = arm; tex.matrix_parent_inverse = arm.matrix_world.inverted()
m = tex.modifiers.new("Armature", 'ARMATURE'); m.object = arm
for t in list(ad.nla_tracks): ad.nla_tracks.remove(t)
keep = {}
for a in list(bpy.data.actions):
    if a.name in CLIP_NAMES:
        keep[CLIP_NAMES[a.name]] = a
    else:
        bpy.data.actions.remove(a)
for new, a in keep.items():
    a.name = new; a.use_fake_user = True
for new in ("Walk", "Attack1", "Attack2", "Attack3", "Die"):
    a = keep[new]; t = ad.nla_tracks.new(); t.name = new; t.strips.new(new, int(a.frame_range[0]), a); t.mute = True
bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
bpy.ops.object.select_all(action='DESELECT')
for o in bpy.data.objects:
    if o.type in ('ARMATURE', 'MESH', 'EMPTY'): o.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format='GLB', use_selection=True, export_animations=True,
                          export_animation_mode='ACTIONS', export_skins=True, export_force_sampling=True, export_frame_step=1,
                          export_anim_single_armature=True, export_reset_pose_bones=True, export_image_format='AUTO')
print("exported", OUT_GLB)
