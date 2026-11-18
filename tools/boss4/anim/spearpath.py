"""Per-frame spear path: record the spear placement (grip + direction, chest frame) at each key pose, then after
baking re-solve the right arm every frame along a smooth placement path, nudging outward/upward where the
spear would touch the body or the ground."""
import bpy
from mathutils import Vector, Matrix
from posekit import grip, spear_dir, place_spear, upd
from legkit import clip_now

ARM_R = ("clavicle_r", "upperarm_r", "forearm_r", "hand_r", "weapon_r")
BUTT, TIP = 0.737, 0.963

def chest_frame(arm):
    pb = arm.pose.bones["upper_chest"]; rest = arm.data.bones["upper_chest"].matrix_local.to_3x3()
    return pb.head.copy(), pb.matrix.to_3x3() @ rest.inverted()

def record(arm):
    h, R = chest_frame(arm); Ri = R.inverted()
    return (Ri @ (grip(arm) - h), (Ri @ spear_dir(arm)).normalized())

def _cr(p0, p1, p2, p3, t):
    t2, t3 = t * t, t * t * t
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)

def sample(rec, f):
    ks = sorted(rec)
    if f <= ks[0]: return rec[ks[0]]
    if f >= ks[-1]: return rec[ks[-1]]
    i = max(j for j in range(len(ks)) if ks[j] <= f)
    a, b = ks[i], ks[i + 1]; t = (f - a) / (b - a)
    k0, k3 = ks[max(i - 1, 0)], ks[min(i + 2, len(ks) - 1)]
    g = _cr(rec[k0][0], rec[a][0], rec[b][0], rec[k3][0], t)
    d = _cr(rec[k0][1], rec[a][1], rec[b][1], rec[k3][1], t).normalized()
    return g, d

def apply_path(arm, body, rec, f0, f1, min_clear=0.02, ground=0.03, twist_ref=Vector((0, 0, -1)), log=True):
    sc = bpy.context.scene; fixes = 0
    for f in range(f0, f1 + 1):
        sc.frame_set(f)
        g, d = sample(rec, f)
        h, R = chest_frame(arm)
        out = Vector((0, 0, 0)); dtilt = Vector((0, 0, 0))
        for it in range(10):
            gw = h + R @ (g + out); dw = (R @ (d + dtilt)).normalized()
            place_spear(arm, gw, dw, twist_ref=twist_ref)
            gg = grip(arm); dd = spear_dir(arm)
            low = min((gg + dd * TIP).z, (gg - dd * BUTT).z)
            c = clip_now(arm, body)
            if c >= min_clear and low >= ground: break
            if c < min_clear:
                if it % 2 == 0: out += Vector((-0.03, 0.0, 0.0))
                else:   # swing the butt away from the body: tip leans inward, butt outward
                    dtilt += Vector((0.10, 0.0, 0.0)) if d.y < 0 else Vector((-0.10, 0.0, 0.0))
            if low < ground: out += Vector((0, 0, min(0.06, ground - low + 0.01)))
        if it: fixes += 1
        if c < min_clear and log: print(f"   spearpath f{f}: still {c:.3f} after nudging")
        for n in ARM_R:
            pb = arm.pose.bones[n]
            for path in ("rotation_quaternion", "location", "scale"):
                pb.keyframe_insert(path, frame=f, group=n)
    if log: print(f"SPEARPATH frames {f0}-{f1}, nudged {fixes}")
