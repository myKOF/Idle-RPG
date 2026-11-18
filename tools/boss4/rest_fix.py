"""Move the textured mesh's arms into the animation rig's rest arm pose (so the fist closes on the spear grip).

blender -b --python rest_fix.py -- VARIANT.blend ANIM_RIG.blend OUT.blend OUT.glb
Per arm bone: rigid ICP (Kabsch) from the animation mesh's region to the textured mesh's region, then the
textured vertices are pulled back with inverse linear-blend skinning using their own weights.
"""
import bpy, sys, math
import numpy as np
from mathutils import Vector, Matrix
from mathutils.kdtree import KDTree
VAR, RIG, OUT_BLEND, OUT_GLB = sys.argv[sys.argv.index("--") + 1:][:4]
BONES = ["upperarm_r", "forearm_r", "hand_r", "upperarm_l", "forearm_l", "hand_l"]

def regions(ob, thr=0.4):
    gi = {g.index: g.name for g in ob.vertex_groups}; out = {b: [] for b in BONES}
    for v in ob.data.vertices:
        for g in v.groups:
            n = gi[g.group]
            if n in out and g.weight > thr: out[n].append((ob.matrix_world @ v.co).copy())
    return out

bpy.ops.wm.open_mainfile(filepath=RIG)
A = regions(bpy.data.objects["BOSS4_Body"])
bpy.ops.wm.open_mainfile(filepath=VAR)
body = bpy.data.objects["BOSS4_Body"]; T = regions(body)

def kabsch(P, Q):
    P = np.array(P); Q = np.array(Q); cp, cq = P.mean(0), Q.mean(0)
    H = (P - cp).T @ (Q - cq); U, S, Vt = np.linalg.svd(H); d = np.sign(np.linalg.det(Vt.T @ U.T))
    D = np.diag([1, 1, d]); R = Vt.T @ D @ U.T; t = cq - R @ cp
    M = Matrix.Identity(4)
    for i in range(3):
        for j in range(3): M[i][j] = R[i, j]
        M[i][3] = t[i]
    return M

M = {}
SOLVE = ["upperarm_l", "forearm_l", "hand_l"]   # right arm is occluded by armour/spear: handled by the fist translation below
for b in SOLVE:
    src, dst = A[b], T[b]
    if len(src) < 6 or len(dst) < 6:
        print("skip", b, len(src), len(dst)); continue
    kd = KDTree(len(dst))
    for i, p in enumerate(dst): kd.insert(p, i)
    kd.balance()
    cur = Matrix.Identity(4)
    for it in range(40):
        P, Q = [], []
        for p in src:
            q = cur @ p; co, i, d = kd.find(q)
            if d < 0.08: P.append(p); Q.append(co)
        if len(P) < 6: break
        cur = kabsch(P, Q)
    res = np.median([kd.find(cur @ p)[2] for p in src])
    M[b] = cur
    print(f"{b:11s} n {len(src):3d}->{len(dst):3d}  move {cur.to_translation().length:.3f}  rot {math.degrees(cur.to_quaternion().angle):.1f} deg  residual {res:.4f}")

# chain fallback: a bone without enough vertices takes its parent's transform
for b, parent in (("hand_r", "forearm_r"), ("forearm_r", "upperarm_r"), ("hand_l", "forearm_l"), ("forearm_l", "upperarm_l")):
    if b not in M and parent in M: M[b] = M[parent]
Minv = {b: m.inverted() for b, m in M.items() if b.endswith("_l")}
# right fist: translate the textured fist onto the rig's fist, fading along the forearm (elbow 0 -> wrist 1)
def fist(ob, thr=0.3):
    gi_ = {g.index: g.name for g in ob.vertex_groups}; pts = []
    for v in ob.data.vertices:
        if any(gi_[g.group] == "hand_r" and g.weight > thr for g in v.groups): pts.append(ob.matrix_world @ v.co)
    return sum(pts, Vector()) / len(pts), len(pts)
bpy.ops.wm.open_mainfile(filepath=RIG); AF, na = fist(bpy.data.objects["BOSS4_Body"])
arm_r = bpy.data.objects["BOSS4_Armature"]; EL = arm_r.matrix_world @ arm_r.data.bones["forearm_r"].head_local; WR = arm_r.matrix_world @ arm_r.data.bones["hand_r"].head_local
GRIP_W = arm_r.matrix_world @ arm_r.data.bones["weapon_r"].head_local
bpy.ops.wm.open_mainfile(filepath=VAR); body = bpy.data.objects["BOSS4_Body"]
TF, nt = fist(body, 0.5)
GR = GRIP_W
DF = Vector((GR.x - TF.x, GR.y - TF.y, 0.0))      # the fist closes around the spear axis (vertical in rest)
print("fist: rig %s (n %d)  textured %s (n %d)  shift %.3f" % (tuple(round(x, 3) for x in AF), na, tuple(round(x, 3) for x in TF), nt, DF.length))
gi = {g.index: g.name for g in body.vertex_groups}
mw = body.matrix_world; mwi = mw.inverted(); moved = 0
for v in body.data.vertices:
    p = mw @ v.co; acc = Vector(); wsum = 0.0; other = 0.0
    for g in v.groups:
        n = gi[g.group]
        if n in Minv: acc += (Minv[n] @ p) * g.weight; wsum += g.weight
        else: other += g.weight
    if wsum > 1e-4:
        new = (acc + p * other) / (wsum + other)
        v.co = mwi @ new; moved += 1; p = new
    wr = sum(g.weight for g in v.groups if gi[g.group] in ("hand_r", "weapon_r"))
    wf = sum(g.weight for g in v.groups if gi[g.group] == "forearm_r")
    if wr + wf > 1e-4 and not any(gi[g.group] == "weapon_r" for g in v.groups):
        seg = WR - EL; t = max(0.0, min(1.0, (p - EL).dot(seg) / seg.length_squared))
        v.co = mwi @ (p + DF * (wr + wf * t)); moved += 1
print("vertices pulled back to the rig's rest arms:", moved)
bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
bpy.ops.object.select_all(action='DESELECT')
for o in bpy.data.objects:
    if o.type in ('ARMATURE', 'MESH', 'EMPTY'): o.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format='GLB', use_selection=True, export_animations=True,
                          export_animation_mode='ACTIONS', export_skins=True, export_force_sampling=True, export_frame_step=1,
                          export_anim_single_armature=True, export_reset_pose_bones=True, export_image_format='AUTO')
print("exported", OUT_GLB)
