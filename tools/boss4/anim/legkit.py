"""Four-leg IK (hooves planted, steppable targets), whole-body helpers, visual bake, clipping check."""
import bpy, math
from mathutils import Vector, Matrix
from mathutils.kdtree import KDTree

LEGS = {  # leg id: (ik bone, chain length, hoof bone)
    "FL": ("front_leg_ankle_l", 4, "front_leg_foot_l"),
    "FR": ("front_leg_ankle_r", 4, "front_leg_foot_r"),
    "HL": ("back_leg_ankle_l", 3, "back_leg_foot_l"),
    "HR": ("back_leg_ankle_r", 3, "back_leg_foot_r"),
}

def add_leg_ik(arm, legs=("FL", "FR", "HL", "HR")):
    """Returns {leg: (target_empty, [constraints])}. Move/key the empty's location to step a hoof."""
    out = {}
    for k in legs:
        ikb, chain, hoof = LEGS[k]
        b = arm.data.bones[ikb]; h = arm.data.bones[hoof]
        e = bpy.data.objects.new(f"IK_{k}", None); bpy.context.scene.collection.objects.link(e)
        e.matrix_world = arm.matrix_world @ Matrix.Translation(b.tail_local)
        r = bpy.data.objects.new(f"ROT_{k}", None); bpy.context.scene.collection.objects.link(r)
        r.parent = e; r.matrix_world = arm.matrix_world @ h.matrix_local
        c = arm.pose.bones[ikb].constraints.new('IK'); c.target = e; c.chain_count = chain; c.use_tail = True
        c2 = arm.pose.bones[hoof].constraints.new('COPY_ROTATION'); c2.target = r
        c2.target_space = 'WORLD'; c2.owner_space = 'WORLD'
        out[k] = (e, [c, c2])
    bpy.context.view_layer.update()
    return out

def key_target(ik, leg, frame, offset=(0, 0, 0), lift_rot=0.0):
    """Key a hoof target at rest + offset (world), optional hoof pitch (deg, + = toe down) while lifted."""
    e, _ = ik[leg]
    if not hasattr(key_target, "rest"): key_target.rest = {}
    if leg not in key_target.rest: key_target.rest[leg] = e.location.copy()
    e.location = key_target.rest[leg] + Vector(offset); e.keyframe_insert("location", frame=frame)
    r = e.children[0]
    r.rotation_mode = 'XYZ'; r.rotation_euler.x = math.radians(lift_rot); r.keyframe_insert("rotation_euler", frame=frame)

def key_influence(ik, leg, frame, value):
    for c in ik[leg][1]:
        c.influence = value; c.keyframe_insert("influence", frame=frame)

def bake_visual(arm, f0, f1, action):
    sc = bpy.context.scene; order = []
    def walk(b):
        order.append(b.name)
        for c in b.children: walk(c)
    for b in arm.data.bones:
        if b.parent is None: walk(b)
    samples = {}
    for f in range(f0, f1 + 1):
        sc.frame_set(f); samples[f] = {n: arm.pose.bones[n].matrix.copy() for n in order}
    for pb in arm.pose.bones:
        for c in list(pb.constraints): pb.constraints.remove(c)
    for o in [o for o in bpy.data.objects if o.name.startswith(("IK_", "ROT_"))]:
        bpy.data.objects.remove(o)
    for fc in list(action.fcurves): action.fcurves.remove(fc)
    for f in range(f0, f1 + 1):
        for n in order:
            arm.pose.bones[n].matrix = samples[f][n]; bpy.context.view_layer.update()
        for pb in arm.pose.bones:
            for path in ("rotation_quaternion", "location", "scale"):
                pb.keyframe_insert(path, frame=f, group=pb.name)

def clip_report(arm, body, frames, label=""):
    """Spear-to-body proximity (excluding the gripping hand/forearm) and ground penetration per frame."""
    gi = {g.index: g.name for g in body.vertex_groups}
    def dom(v): return gi[max(v.groups, key=lambda g: g.weight).group] if v.groups else ""
    SP = [v.index for v in body.data.vertices if any(gi[g.group] == "weapon_r" and g.weight > 0.5 for g in v.groups)]
    spset = set(SP)
    BODY = [v.index for v in body.data.vertices if v.index not in spset and dom(v) not in ("hand_r", "forearm_r")]
    worst = []
    for f in frames:
        bpy.context.scene.frame_set(f)
        dg = bpy.context.evaluated_depsgraph_get(); e = body.evaluated_get(dg); m = e.to_mesh()
        P = [body.matrix_world @ v.co for v in m.vertices]; e.to_mesh_clear()
        kd = KDTree(len(BODY))
        for k, i in enumerate(BODY): kd.insert(P[i], k)
        kd.balance()
        near = 0; dmin = 9; who = ""
        for i in SP:
            co, k, d = kd.find(P[i])
            if d < dmin: dmin = d; who = dom(body.data.vertices[BODY[k]])
            if d < 0.012: near += 1
        gz = min(P[i].z for i in BODY); sz = min(P[i].z for i in SP)
        worst.append((f, near, dmin, who, gz, sz))
    bad = [w for w in worst if w[1] > 0 or w[4] < -0.01 or w[5] < -0.005]
    print(f"CLIP {label}: frames {len(worst)}, spear-touch frames {sum(1 for w in worst if w[1] > 0)}, "
          f"min spear-body {min(w[2] for w in worst):.3f}, min body z {min(w[4] for w in worst):.3f}, min spear z {min(w[5] for w in worst):.3f}")
    for f, n, d, who, gz, sz in bad[:12]:
        print(f"   f{f:3d} spear verts touching {n:3d} (nearest {d:.3f} on {who}) body z {gz:+.3f} spear z {sz:+.3f}")
    return worst

def clip_now(arm, body, exclude=("hand_r", "forearm_r")):
    """Min spear-to-body distance for the current evaluated pose (no frame change)."""
    gi = {g.index: g.name for g in body.vertex_groups}
    if not hasattr(clip_now, "cache"):
        def dom(v): return gi[max(v.groups, key=lambda g: g.weight).group] if v.groups else ""
        SP = [v.index for v in body.data.vertices if any(gi[g.group] == "weapon_r" and g.weight > 0.5 for g in v.groups)]
        s = set(SP)
        clip_now.cache = (SP, [v.index for v in body.data.vertices if v.index not in s and dom(v) not in exclude])
    SP, BODY = clip_now.cache
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get(); e = body.evaluated_get(dg); m = e.to_mesh()
    P = [body.matrix_world @ v.co for v in m.vertices]; e.to_mesh_clear()
    kd = KDTree(len(BODY))
    for k, i in enumerate(BODY): kd.insert(P[i], k)
    kd.balance()
    best = (9, -1, -1)
    for i in SP:
        co, k, d = kd.find(P[i])
        if d < best[0]: best = (d, k, i)
    v = body.data.vertices[BODY[best[1]]]
    clip_now.who = gi[max(v.groups, key=lambda g: g.weight).group] if v.groups else ""
    clip_now.where = P[best[2]].copy()
    return best[0]
