"""BOSS6 (dark knight) rebuild: head turned to face forward, sword and shield cut out of the welded body mesh and
re-mounted as rigid parts on the right hand (sword, blade up, one-handed grip) and the shield forearm, five clips merged.

blender -b -P build_boss6.py -- <dir with BOSS6_Walk/Attack1/Attack2/Attack3/Die.glb> <out.glb> [--keep-root-motion] [--debug <png prefix>]

Z-up Blender, the model faces -Y (glTF +Z). Character right = -X, character left = +X.
"""
import bpy, bmesh, math, sys, os
import numpy as np
from mathutils import Vector, Matrix, Quaternion, Euler

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
KEEP_ROOT = '--keep-root-motion' in argv
DEBUG = argv[argv.index('--debug') + 1] if '--debug' in argv else None
CLIPS = [('Walk', 'Walk'), ('Attack1', 'Attack1'), ('Attack2', 'Attack2'), ('Attack3', 'Attack3'), ('Die', 'Die')]
DROP_FRAME = 56               # death clip: the sword leaves the hand here
HEAD_YAW_DEG = -30.0          # measured by mirror-symmetry search of the helmet: it was turned 30 deg to the character's left
SWORD_RADIUS = 0.17
FIST_SPHERE = 0.105
GRIP_ABOVE_GUARD = 0.11       # the fist centre sits this far below the cross-guard after the flip

# ------------------------------------------------------------------ import
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.fps = 30


def import_glb(path):
    before = set(bpy.data.objects.keys())
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o.name not in before]


walk_objs = import_glb(os.path.join(SRC, 'BOSS6_Walk.glb'))
for o in walk_objs:
    if o.type == 'MESH' and len(o.vertex_groups) == 0:
        bpy.data.objects.remove(o, do_unlink=True)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
mesh = next(o for o in bpy.data.objects if o.type == 'MESH')
arm.name = 'Boss6Rig'
mesh.name = 'Boss6'
actions = {}
walk_action = arm.animation_data.action
walk_action.name = 'Walk'
actions['Walk'] = walk_action
for name, label in CLIPS[1:]:
    objs = import_glb(os.path.join(SRC, 'BOSS6_%s.glb' % name))
    other = next(o for o in objs if o.type == 'ARMATURE')
    act = other.animation_data.action
    act.name = label
    act.use_fake_user = True
    actions[label] = act
    for o in objs:
        bpy.data.objects.remove(o, do_unlink=True)
walk_action.use_fake_user = True
arm.animation_data.action = None
arm.data.pose_position = 'REST'
bpy.context.view_layer.update()
me = mesh.data
names = {g.index: g.name for g in mesh.vertex_groups}
bones = arm.data.bones
print('IMPORTED', len(me.vertices), 'verts', len(me.polygons), 'faces; actions', list(actions))

P = np.array([tuple(v.co) for v in me.vertices])
W = [{names[g.group]: g.weight for g in v.groups} for v in me.vertices]
DOM = [max(w.items(), key=lambda kv: kv[1])[0] if w else '' for w in W]

# ------------------------------------------------------------------ 1. head
head_bones = ('mixamorig:Head', 'mixamorig:HeadTop_End', 'headfront')
pivot = Vector(bones['mixamorig:Head'].head_local)
rot = Matrix.Rotation(math.radians(HEAD_YAW_DEG), 3, 'Z')
for i, v in enumerate(me.vertices):
    w = sum(W[i].get(b, 0.0) for b in head_bones)
    if w <= 0:
        continue
    q = Vector(P[i]) - pivot
    v.co = Vector(P[i]) + (pivot + rot @ q - Vector(P[i])) * min(1.0, w)
P = np.array([tuple(v.co) for v in me.vertices])
print('HEAD rotated', HEAD_YAW_DEG, 'deg about', tuple(round(x, 3) for x in pivot))

# ------------------------------------------------------------------ 2. pick sword and shield faces
polys = me.polygons
cent = np.array([tuple(p.center) for p in polys])
face_dom = []
for p in polys:
    face_dom.append([DOM[i] for i in p.vertices])

# --- welded vertex ids (the glTF mesh is split along UV seams) for neighbourhood growing
key = {}
weld = np.zeros(len(P), int)
for i, p in enumerate(P):
    k = (round(p[0] * 2000), round(p[1] * 2000), round(p[2] * 2000))
    weld[i] = key.setdefault(k, len(key))
face_weld = [set(weld[list(p.vertices)]) for p in polys]
vert_faces = {}
for k, ws in enumerate(face_weld):
    for w in ws:
        vert_faces.setdefault(w, []).append(k)

# --- shield: left-hand / left-forearm weighted faces on the character's left side, then grown over the leftovers
shield = np.zeros(len(polys), bool)
for k, p in enumerate(polys):
    fr = sum(1 for d in face_dom[k] if d in ('mixamorig:LeftHand', 'mixamorig:LeftForeArm')) / len(face_dom[k])
    shield[k] = cent[k][0] > 0.45 and fr >= 0.67
no_grow = ('mixamorig:LeftShoulder', 'mixamorig:LeftArm', 'mixamorig:Spine2', 'mixamorig:Spine1')
for _ in range(3):
    add = []
    for k in range(len(polys)):
        if shield[k] or cent[k][0] < 0.47 or cent[k][1] > 0.22 or cent[k][2] > 1.30:
            continue
        if any(d in no_grow for d in face_dom[k]) or any(d.startswith('Bone_03') or d.startswith('Bone_04') for d in face_dom[k][:1]):
            continue
        if any(shield[n] for w in face_weld[k] for n in vert_faces[w]):
            add.append(k)
    for k in add:
        shield[k] = True
sh_c = cent[shield]
print('SHIELD faces', int(shield.sum()), 'bbox', sh_c.min(0).round(2), sh_c.max(0).round(2))

# --- sword: axis fitted on the blade bones; radius profile along the axis (pommel -> tip)
blade_idx = [i for i in range(len(P)) if DOM[i] in ('Bone_027', 'Bone_028')]
blade = P[blade_idx]
m = blade.mean(0)
_, _, vt = np.linalg.svd(blade - m, full_matrices=False)
axis = vt[0]
if axis[2] > 0:
    axis = -axis
rh = np.array([P[i] for i in range(len(P)) if DOM[i] == 'mixamorig:RightHand'])
fist = rh[(rh[:, 2] > 0.95) & (rh[:, 2] < 1.2)].mean(0)
tv = (P - m) @ axis
dv = np.linalg.norm((P - m) - np.outer(tv, axis), axis=1)
t_fist = float((fist - m) @ axis)
t_guard = t_fist + 0.19
def radius(t):
    if t < t_fist - 0.16:
        return 0.09 if t < -0.45 else 0.06          # pommel / upper handle
    if t < t_guard - 0.2:
        return 0.06                                   # handle between fist and guard
    if t < t_guard + 0.12:
        return 0.17                                   # cross-guard
    return 0.12                                       # blade
arm_ok = ('Bone_027', 'Bone_028', 'mixamorig:RightHand', 'Bone_045', '')
sword = np.zeros(len(polys), bool)
for k, p in enumerate(polys):
    if shield[k]:
        continue
    ids = list(p.vertices)
    c = cent[k]
    t = float(tv[ids].mean())
    d = float(dv[ids].mean())
    if t < -0.95 or t > 1.6 or d >= radius(t):
        continue
    dist_fist = np.linalg.norm(c - fist)
    thin_handle = d < 0.055 and dist_fist > 0.045 and t < t_guard
    if dist_fist < FIST_SPHERE and not thin_handle:
        continue
    if thin_handle:
        sword[k] = True
        continue
    if abs(t - t_fist) < 0.2 and not all(dd in arm_ok for dd in face_dom[k]):
        continue                                       # forearm / gauntlet beside the fist stays on the body
    if t > t_guard + 0.12 and c[1] > -0.05:
        continue                                       # never the cape
    if c[2] < 0.09 and d > 0.05:
        continue                                       # the right boot lies right next to the blade tip: only the narrow tip itself
    sword[k] = True
print('SWORD faces', int(sword.sum()), 'axis', axis.round(3), 'fist', fist.round(3), 't_fist', round(t_fist, 3))

if DEBUG:
    mat = bpy.data.materials.new('dbg')
    mat.use_nodes = True
    bs = mat.node_tree.nodes['Principled BSDF']
    bs.inputs['Base Color'].default_value = (1, 0.1, 0.8, 1)
    bs.inputs['Emission Color'].default_value = (1, 0.1, 0.8, 1)
    bs.inputs['Emission Strength'].default_value = 1.0
    mat2 = bpy.data.materials.new('dbg2')
    mat2.use_nodes = True
    bs2 = mat2.node_tree.nodes['Principled BSDF']
    bs2.inputs['Base Color'].default_value = (0.1, 0.9, 1, 1)
    bs2.inputs['Emission Color'].default_value = (0.1, 0.9, 1, 1)
    bs2.inputs['Emission Strength'].default_value = 1.0
    me.materials.append(mat)
    me.materials.append(mat2)
    for k, p in enumerate(polys):
        if sword[k]:
            p.material_index = len(me.materials) - 2
        elif shield[k]:
            p.material_index = len(me.materials) - 1
    sys.exit(0) if False else None

# ------------------------------------------------------------------ 3. split the shells out of the mesh
def carve(src_obj, mask, name):
    """Copy the masked faces of src_obj into a new object (same vertex groups) and remove them from src_obj."""
    me_ = src_obj.data
    bm_ = bmesh.new()
    bm_.from_mesh(me_)
    bm_.faces.ensure_lookup_table()
    part = bmesh.new()
    part.from_mesh(me_)
    part.faces.ensure_lookup_table()
    bmesh.ops.delete(part, geom=[f for k, f in enumerate(part.faces) if not mask[k]], context='FACES')
    bmesh.ops.delete(part, geom=[v for v in part.verts if not v.link_faces], context='VERTS')
    pme = bpy.data.meshes.new(name)
    part.to_mesh(pme)
    part.free()
    for mt in me_.materials:
        pme.materials.append(mt)
    obj_ = bpy.data.objects.new(name, pme)
    bpy.context.scene.collection.objects.link(obj_)
    for g in src_obj.vertex_groups:
        obj_.vertex_groups.new(name=g.name)
    bmesh.ops.delete(bm_, geom=[f for k, f in enumerate(bm_.faces) if mask[k]], context='FACES')
    bmesh.ops.delete(bm_, geom=[v for v in bm_.verts if not v.link_faces], context='VERTS')
    bm_.to_mesh(me_)
    bm_.free()
    return obj_


# the second mask refers to the faces of the body that remain after cutting the first part
keep_idx = np.where(~sword)[0]
sword_obj = carve(mesh, sword, 'SwordPart')
shield_mask2 = shield[keep_idx]
shield_obj = carve(mesh, shield_mask2, 'ShieldPart')
print('SPLIT remainder faces', len(mesh.data.polygons), 'sword', len(sword_obj.data.polygons), 'shield', len(shield_obj.data.polygons))
bpy.ops.wm.save_as_mainfile(filepath=os.path.splitext(OUT)[0] + '_stage1.blend')

# ------------------------------------------------------------------ 4. body: weights of the old weapon bones go to the hands
MOVE = {'Bone_027': 'mixamorig:RightHand', 'Bone_028': 'mixamorig:RightHand', 'Bone_045': 'mixamorig:RightHand',
        'Bone_044': 'mixamorig:LeftHand', 'Bone_022': 'mixamorig:LeftHand', 'Bone_023': 'mixamorig:LeftHand'}
bname = {g.index: g.name for g in mesh.vertex_groups}
for v in mesh.data.vertices:
    add = {}
    for g in v.groups:
        nm = bname[g.group]
        if nm in MOVE:
            add[MOVE[nm]] = add.get(MOVE[nm], 0.0) + g.weight
    for tgt, w in add.items():
        mesh.vertex_groups[tgt].add([v.index], w, 'ADD')
for nm in MOVE:
    g = mesh.vertex_groups.get(nm)
    if g:
        mesh.vertex_groups.remove(g)

# ------------------------------------------------------------------ 5. sword: bridge the handle, flip so the blade points up
F = Vector(fist)
a0 = Vector(axis)                               # pommel -> tip before the flip
sv = np.array([tuple(v.co) for v in sword_obj.data.vertices])
t_s = (sv - m) @ axis
d_s = np.linalg.norm((sv - m) - np.outer(t_s, axis), axis=1)
# the source blade tip is fused with ragged shards next to the right boot: drop the faces that stick out sideways of the blade,
# then taper the last 16 cm into a clean point
bm_t = bmesh.new()
bm_t.from_mesh(sword_obj.data)
bm_t.faces.ensure_lookup_table()
kill = []
for f in bm_t.faces:
    cc = np.array(tuple(f.calc_center_median()))
    tt = float((cc - m) @ axis)
    dd = float(np.linalg.norm((cc - m) - tt * axis))
    if tt > t_guard + 0.3 and dd > 0.105:
        kill.append(f)
bmesh.ops.delete(bm_t, geom=kill, context='FACES')
bmesh.ops.delete(bm_t, geom=[v for v in bm_t.verts if not v.link_faces], context='VERTS')
bm_t.to_mesh(sword_obj.data)
bm_t.free()
print('TIP shards removed', len(kill))
# second pass: anything wider than the blade's own taper close to the tip (centre line measured 25-45 cm before the end)
sv_pre = np.array([tuple(v.co) for v in sword_obj.data.vertices])
t_pre = (sv_pre - m) @ axis
t_end0 = float(t_pre.max())
band0 = [i for i in range(len(t_pre)) if t_end0 - 0.45 < t_pre[i] < t_end0 - 0.25]
co0 = np.mean([sv_pre[i] - (m + axis * t_pre[i]) for i in band0], axis=0) if band0 else np.zeros(3)
co0 = co0 - axis * float(co0 @ axis)
bm_t = bmesh.new()
bm_t.from_mesh(sword_obj.data)
bm_t.faces.ensure_lookup_table()
kill = []
for f in bm_t.faces:
    cc = np.array(tuple(f.calc_center_median()))
    tt = float((cc - m) @ axis)
    dd = float(np.linalg.norm((cc - m - co0) - tt * axis))
    if t_end0 - 0.32 < tt and dd > 0.085:
        kill.append(f)
bmesh.ops.delete(bm_t, geom=kill, context='FACES')
bmesh.ops.delete(bm_t, geom=[v for v in bm_t.verts if not v.link_faces], context='VERTS')
bm_t.to_mesh(sword_obj.data)
bm_t.free()
print('TIP wide faces removed', len(kill))
sv0 = np.array([tuple(v.co) for v in sword_obj.data.vertices])
t_s = (sv0 - m) @ axis
t_s = np.array([0.0])
sv0 = np.array([tuple(v.co) for v in sword_obj.data.vertices])
t_s = (sv0 - m) @ axis
t_end = float(t_s.max())
TAPER = 0.16
band = [i for i in range(len(t_s)) if t_end - 0.45 < t_s[i] < t_end - 0.25]
center_off = np.mean([np.array(tuple(sword_obj.data.vertices[i].co)) - (m + axis * t_s[i]) for i in band], axis=0) if band else np.zeros(3)
center_off = center_off - axis * float(center_off @ axis)
for i, v in enumerate(sword_obj.data.vertices):
    if t_s[i] > t_end - TAPER:
        k = max(0.0, (t_end - t_s[i]) / TAPER)
        base = m + axis * t_s[i] + center_off      # taper toward the blade's own centre line, not the fitted axis
        off = np.array(tuple(v.co)) - base
        v.co = Vector(base + off * (k * k))
sv = np.array([tuple(v.co) for v in sword_obj.data.vertices])
t_s = (sv - m) @ axis
d_s = np.linalg.norm((sv - m) - np.outer(t_s, axis), axis=1)
# measure the handle radius from the thin vertices
thin = d_s < 0.06
handle_r = float(np.percentile(d_s[thin & (t_s < t_guard - 0.1)], 70)) if (thin & (t_s < t_guard - 0.1)).any() else 0.035
handle_r = min(max(handle_r * 0.8, 0.022), 0.034)
# the biggest hole along the axis in the handle zone is where the fist was
ts = np.sort(t_s[(d_s < 0.09) & (t_s < t_guard)])
gaps = [(ts[i + 1] - ts[i], ts[i], ts[i + 1]) for i in range(len(ts) - 1)]
gap = max(gaps)
t0, t1 = float(gap[1]) - 0.01, float(gap[2]) + 0.01
print('HANDLE radius', round(handle_r, 3), 'gap t', round(t0, 3), round(t1, 3), 'len', round(t1 - t0, 3))
# average UV of the leather grip: faces of the handle (thin) of the sword part
sme = sword_obj.data
uvl = sme.uv_layers[0]
uv_acc = []
for p in sme.polygons:
    if dv_f := None:
        pass
for p in sme.polygons:
    ids = list(p.vertices)
    if all(d_s[i] < 0.05 for i in ids) and all(t_s[i] < t_guard - 0.05 for i in ids):
        for li in p.loop_indices:
            uv_acc.append(tuple(uvl.data[li].uv))
if uv_acc:
    med = np.median(uv_acc, axis=0)
    grip_uv = tuple(min(uv_acc, key=lambda u: (u[0] - med[0]) ** 2 + (u[1] - med[1]) ** 2))   # a real texel of the grip, not an average of two colours
else:
    grip_uv = (0.5, 0.5)
print('GRIP uv', grip_uv, 'from', len(uv_acc))
bmc = bmesh.new()
bmc.from_mesh(sme)
uvc = bmc.loops.layers.uv.active
SEG = 14
ring_a = []
ring_b = []
bvec = np.cross(axis, np.array([0.0, 1.0, 0.0]))
bvec = bvec / np.linalg.norm(bvec)
cvec = np.cross(axis, bvec)
for k in range(SEG):
    ang = 2 * math.pi * k / SEG
    off = bvec * math.cos(ang) * handle_r + cvec * math.sin(ang) * handle_r
    pa = Vector(m + axis * t0 + off)
    pb = Vector(m + axis * t1 + off)
    ring_a.append(bmc.verts.new(pa))
    ring_b.append(bmc.verts.new(pb))
for k in range(SEG):
    k2 = (k + 1) % SEG
    f = bmc.faces.new((ring_a[k], ring_a[k2], ring_b[k2], ring_b[k]))
    f.smooth = True
    for l in f.loops:
        l[uvc].uv = grip_uv
bmc.normal_update()
bmc.to_mesh(sme)
bmc.free()

# flip 180 deg about the blade face normal through the fist: blade tip goes up, decorated face stays outward
_, _, vtb = np.linalg.svd(blade - m, full_matrices=False)
nrm = vtb[2]
if nrm[1] > 0:
    nrm = -nrm
nrm_v = Vector(nrm)
R180 = Matrix.Rotation(math.pi, 4, nrm_v)
up_new = -a0                                      # after the flip: tip up
target = Vector((0.0, -math.sin(math.radians(6)), math.cos(math.radians(6)))).normalized()   # nearly vertical, leaning 6 deg forward
Rlean = up_new.rotation_difference(target).to_matrix().to_4x4()
Tfist = Matrix.Translation(F)
M = Tfist @ Rlean @ R180 @ Tfist.inverted()
sword_obj.data.transform(M)
# slide along the new axis so the cross-guard is GRIP_ABOVE_GUARD above the fist, and centre the handle axis on the fist
guard_pt = Vector(m + axis * t_guard)
guard_new = M @ guard_pt
slide = (target.dot(guard_new - F))              # current guard height above fist along the new axis
shift = target * (GRIP_ABOVE_GUARD - slide)
# lateral: handle axis line must pass through F
axis_pt = M @ Vector(m + axis * t_fist)
lat = (F - axis_pt)
lat -= target * lat.dot(target)
sword_obj.data.transform(Matrix.Translation(shift + lat))
print('SWORD flipped; guard above fist before slide', round(slide, 3), 'lateral fix', round(lat.length, 4))
sw_new = np.array([tuple(v.co) for v in sword_obj.data.vertices])
print('SWORD new bbox', sw_new.min(0).round(2), sw_new.max(0).round(2))

# ------------------------------------------------------------------ 6. rigid binding: new bones, weights, join
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
eb = arm.data.edit_bones
sw_b = eb.new('Sword_R')
sw_b.head = F
sw_b.tail = F + target * 0.30
sw_b.parent = eb['mixamorig:RightHand']
fa = eb['mixamorig:LeftForeArm']
sh_b = eb.new('Shield_L')
sh_b.head = fa.head.copy()
sh_b.tail = fa.head + (fa.tail - fa.head).normalized() * 0.2
sh_b.parent = fa
bpy.ops.object.mode_set(mode='OBJECT')

for o, bname_ in ((sword_obj, 'Sword_R'), (shield_obj, 'Shield_L')):
    for g in list(o.vertex_groups):
        o.vertex_groups.remove(g)
    vg = o.vertex_groups.new(name=bname_)
    vg.add([v.index for v in o.data.vertices], 1.0, 'REPLACE')
for o in (sword_obj, shield_obj):
    for nm in ('Sword_R', 'Shield_L'):
        if nm not in o.vertex_groups:
            o.vertex_groups.new(name=nm)
for nm in ('Sword_R', 'Shield_L'):
    if nm not in mesh.vertex_groups:
        mesh.vertex_groups.new(name=nm)
for o in bpy.data.objects:
    o.select_set(False)
for o in (mesh, sword_obj, shield_obj):
    o.select_set(True)
bpy.context.view_layer.objects.active = mesh
bpy.ops.object.join()
body = mesh
body.name = 'Boss6'
for p in body.data.polygons:
    p.use_smooth = True
if not any(mod.type == 'ARMATURE' for mod in body.modifiers):
    md = body.modifiers.new('Armature', 'ARMATURE')
    md.object = arm
body.parent = arm
print('JOINED verts', len(body.data.vertices), 'groups', len(body.vertex_groups))
bpy.ops.wm.save_as_mainfile(filepath=os.path.splitext(OUT)[0] + '_stage2.blend')

# ------------------------------------------------------------------ 6b. attacks re-aimed through the enemy, sword dropped in the death clip
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib
import retarget
importlib.reload(retarget)
arm.data.pose_position = 'POSE'
for a_ in actions.values():
    a_.use_fake_user = True
if arm.animation_data is None:
    arm.animation_data_create()
n0 = (Rlean.to_3x3() @ nrm_v).normalized()
report = retarget.build(arm, actions, {'B0': target.copy(), 'n0': n0, 'F': F.copy()})
print('RETARGET report', report)
drop = retarget.drop_sword(arm, actions['Die'], DROP_FRAME)
print('DROP', drop)
arm.animation_data.action = None
bpy.ops.wm.save_as_mainfile(filepath=os.path.splitext(OUT)[0] + '_stage3.blend')

# ------------------------------------------------------------------ 7. export
arm.data.pose_position = 'POSE'
for o in bpy.data.objects:
    o.select_set(False)
body.select_set(True)
arm.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_animations=True,
                          export_animation_mode='ACTIONS', export_force_sampling=True, export_optimize_animation_size=False,
                          export_skins=True, export_def_bones=False, export_yup=True, export_apply=False,
                          export_image_format='AUTO', export_normals=True, export_materials='EXPORT')
print('EXPORTED', OUT, os.path.getsize(OUT))
