"""BOSS6: rewrite the sword arm of the three attack clips so the blade really cuts through an enemy standing in front,
with the cutting edge leading the swing, and let the sword fall out of the hand in the death clip.

Imported by build_boss6.py (Blender, armature space = world, Z up, the model faces -Y, character right = -X).
Vectors in the TRAJ tables are written in character terms (left, forward, up) and converted by v().
"""
import math
import bpy
import numpy as np
from mathutils import Vector, Matrix, Quaternion

ARM = 'mixamorig:RightArm'
FORE = 'mixamorig:RightForeArm'
HAND = 'mixamorig:RightHand'
SWORD = 'Sword_R'
ENEMY_DIST = 1.15          # metres in front of the character centre line (the game's melee distance is about 0.9-1.2 model metres)
ENEMY_RADIUS = 0.42


def v(left, fwd, up):
    """character terms -> armature space (character left = +X, forward = -Y)."""
    return Vector((left, -fwd, up))


def smoothstep(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def sample_keys(keys, f, extra=None):
    """keys: [(frame, vector-ish, ...)]; Catmull-Rom through the vectors, eased in time between keys."""
    if f <= keys[0][0]:
        return Vector(keys[0][1])
    if f >= keys[-1][0]:
        return Vector(keys[-1][1])
    for i in range(len(keys) - 1):
        if keys[i][0] <= f <= keys[i + 1][0]:
            f0, f1 = keys[i][0], keys[i + 1][0]
            t = (f - f0) / (f1 - f0)
            ease = keys[i + 1][2] if len(keys[i + 1]) > 2 else 'smooth'
            if ease == 'in':
                t = t * t
            elif ease == 'out':
                t = 1 - (1 - t) ** 2
            elif ease == 'smooth':
                t = smoothstep(t)
            p0 = Vector(keys[max(0, i - 1)][1])
            p1 = Vector(keys[i][1])
            p2 = Vector(keys[i + 1][1])
            p3 = Vector(keys[min(len(keys) - 1, i + 2)][1])
            t2, t3 = t * t, t * t * t
            return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
    return Vector(keys[-1][1])


def weight(keys, f):
    if f <= keys[0][0]:
        return keys[0][1]
    if f >= keys[-1][0]:
        return keys[-1][1]
    for i in range(len(keys) - 1):
        if keys[i][0] <= f <= keys[i + 1][0]:
            t = (f - keys[i][0]) / (keys[i + 1][0] - keys[i][0])
            return keys[i][1] + (keys[i + 1][1] - keys[i][1]) * smoothstep(t)


# ---------------------------------------------------------------------------------------------- trajectories
# The original clips were authored with the body already turned 55-75 degrees to the right and the chest whipping through the
# front at the strike (Attack1 f20, Attack3 f15 and f33, Attack2 f72), so the designs follow that body rotation:
#   G = grip point relative to the right shoulder joint, in the CHEST frame (left, forward, up) - it turns with the chest.
#   B = blade direction (pommel -> tip) in the ROOT frame (left, forward, up); the enemy stands in front in the root frame.
#   W = how much of the new arm pose replaces the original animation (0 keeps the original).
TRAJ = {
    'Attack1': {   # horizontal sweep right -> left through the enemy while the chest whips from 80 deg right to 70 deg left
        'G': [(0, (0.0, 0.0, 0.0)), (9, (-0.22, 0.05, 0.02)), (13, (-0.30, 0.00, 0.04)), (16, (-0.15, 0.30, 0.02)), (20, (0.02, 0.42, 0.0)),
              (24, (0.22, 0.34, -0.02)), (29, (0.30, 0.22, -0.04)), (40, (0.28, 0.18, -0.05)), (62, (0.0, 0.0, 0.0)), (95, (0.0, 0.0, 0.0))],
        'B': [(0, (0.0, 0.1, 1.0)), (9, (-0.70, -0.40, 0.55)), (13, (-0.88, -0.38, 0.28)), (16, (-0.78, 0.55, 0.15)), (18, (-0.40, 0.90, 0.08)),
              (20, (0.0, 1.0, -0.02)), (22, (0.38, 0.92, -0.06)), (25, (0.80, 0.58, -0.10)), (29, (0.96, 0.10, -0.12)), (40, (0.9, 0.1, -0.1)), (62, (0.2, 0.2, 0.9)), (95, (0.0, 0.1, 1.0))],
        'W': [(0, 0.0), (5, 0.0), (11, 1.0), (40, 1.0), (62, 0.0), (95, 0.0)],
    },
    'Attack2': {   # jump, sword high over the head, slam straight down through the enemy as the boss lands (body faces front from f72)
        'G': [(0, (0.0, 0.0, 0.0)), (40, (0.0, 0.0, 0.0)), (46, (-0.10, 0.0, 0.20)), (56, (-0.08, -0.02, 0.40)), (68, (-0.06, 0.0, 0.42)),
              (70, (0.0, 0.20, 0.30)), (72, (0.04, 0.34, 0.04)), (75, (0.06, 0.44, -0.20)), (79, (0.06, 0.44, -0.26)), (96, (0.06, 0.42, -0.22)), (176, (0.0, 0.0, 0.0))],
        'B': [(0, (0.0, 0.1, 1.0)), (40, (0.0, 0.1, 1.0)), (46, (-0.10, -0.45, 0.89)), (56, (-0.12, -0.55, 0.83)), (68, (-0.10, -0.62, 0.78)),
              (69, (-0.02, 0.10, 0.99)), (71, (0.0, 0.88, 0.47)), (73, (0.0, 0.98, -0.10)), (75, (0.02, 0.80, -0.60)), (79, (0.02, 0.66, -0.75)), (96, (0.02, 0.66, -0.75)), (176, (0.0, 0.1, 1.0))],
        'W': [(0, 0.0), (36, 0.0), (46, 1.0), (98, 1.0), (128, 0.0), (176, 0.0)],
    },
    'Attack3': {   # charged double sweep: right -> left through the front at f14, back left -> right at f33
        'G': [(0, (0.0, 0.0, 0.0)), (7, (-0.28, 0.04, 0.0)), (10, (-0.30, 0.06, 0.0)), (14, (-0.04, 0.40, 0.0)), (19, (0.20, 0.36, -0.02)),
              (24, (0.28, 0.22, -0.03)), (30, (0.28, 0.24, -0.02)), (33, (0.05, 0.42, 0.0)), (37, (-0.22, 0.34, 0.0)), (43, (-0.30, 0.10, 0.0)), (50, (-0.2, 0.05, 0.0)), (66, (0.0, 0.0, 0.0))],
        'B': [(0, (0.0, 0.1, 1.0)), (7, (-0.88, -0.35, 0.30)), (10, (-0.90, 0.10, 0.20)), (12, (-0.62, 0.72, 0.10)), (14, (0.0, 1.0, 0.02)), (18, (0.72, 0.68, 0.0)),
              (22, (0.96, 0.28, 0.0)), (30, (0.95, 0.30, 0.04)), (33, (0.15, 0.97, 0.06)), (36, (-0.60, 0.78, 0.08)), (40, (-0.92, 0.30, 0.10)), (46, (-0.95, -0.15, 0.15)), (52, (-0.7, 0.0, 0.7)), (66, (0.0, 0.1, 1.0))],
        'W': [(0, 0.0), (3, 0.0), (8, 1.0), (46, 1.0), (60, 0.0), (66, 0.0)],
    },
}


def lock_root(arm, act):
    """The game moves the boss itself: remove the horizontal travel of the Hips so the clip plays in place (height is kept)."""
    pbs = arm.pose.bones
    sc = bpy.context.scene
    arm.animation_data.action = act
    f0, f1 = int(act.frame_range[0]), int(act.frame_range[1])
    sc.frame_set(f0)
    bpy.context.view_layer.update()
    base = pbs['mixamorig:Hips'].matrix.translation.copy()
    moved = 0.0
    for f in range(f0, f1 + 1):
        sc.frame_set(f)
        bpy.context.view_layer.update()
        M = pbs['mixamorig:Hips'].matrix.copy()
        t = M.translation.copy()
        moved = max(moved, math.hypot(t.x - base.x, t.y - base.y))
        M.translation = Vector((base.x, base.y, t.z))
        pbs['mixamorig:Hips'].matrix = M
        pbs['mixamorig:Hips'].keyframe_insert('location', frame=f)
        pbs['mixamorig:Hips'].keyframe_insert('rotation_quaternion', frame=f)
    return moved


def build(arm, actions, sword_rest):
    """Rewrite the three attack clips. sword_rest = dict(B0, n0, F) of the sword at rest in armature space."""
    pbs = arm.pose.bones
    bn = arm.data.bones
    L1 = (bn[FORE].head_local - bn[ARM].head_local).length
    L2 = (bn[HAND].head_local - bn[FORE].head_local).length
    H_rest = bn[HAND].matrix_local.copy()
    S_rest = bn[SWORD].matrix_local.copy()
    Lrel = H_rest.inverted() @ S_rest
    B0, n0 = sword_rest['B0'].normalized(), sword_rest['n0'].normalized()
    e0 = B0.cross(n0).normalized()
    basis0 = Matrix((B0, n0, e0)).transposed()          # columns B0, n0, e0
    P_rest = bn[ARM].head_local.copy()
    G_guard = sword_rest['F'] - P_rest                   # grip offset of the guard pose, armature space
    guard_t = (G_guard.x, -G_guard.y, G_guard.z)         # in (left, forward, up) terms
    print('RETARGET arm lengths', round(L1, 3), round(L2, 3), 'guard offset (l,f,u)', tuple(round(x, 3) for x in guard_t), 'reach', round(G_guard.length, 3))
    sc = bpy.context.scene
    report = {}
    for name, spec in TRAJ.items():
        act = actions[name]
        print('LOCK', name, 'horizontal hips travel removed:', round(lock_root(arm, act), 3), 'm')
        arm.animation_data.action = act
        f0, f1 = int(act.frame_range[0]), int(act.frame_range[1])
        # ---------- designed sword path (relative to shoulder) for every frame
        # shoulder position and chest heading of the ORIGINAL pose for every frame (the body animation is kept)
        Pf, Cf = {}, {}
        for f in range(f0, f1 + 1):
            sc.frame_set(f)
            bpy.context.view_layer.update()
            Pf[f] = pbs[ARM].matrix.translation.copy()
            r = pbs['mixamorig:RightShoulder'].head - pbs['mixamorig:LeftShoulder'].head
            fw = Vector((-r.y, r.x, 0.0))
            Cf[f] = fw.normalized() if fw.length > 1e-6 else Vector((0, -1, 0))
        Gs, Bs, Groot = {}, {}, {}
        gkeys = [(k[0], guard_t if tuple(k[1]) == (0.0, 0.0, 0.0) else k[1]) + tuple(k[2:]) for k in spec['G']]
        for f in range(f0, f1 + 1):
            g = sample_keys(gkeys, f)
            Gs[f] = g
            cf = Cf[f]
            cl = Vector((0, 0, 1)).cross(cf)
            Groot[f] = cl * g.x + cf * g.y + Vector((0, 0, 1)) * g.z      # chest frame -> armature space
            Bs[f] = sample_keys(spec['B'], f).normalized()
            Bs[f] = v(Bs[f].x, Bs[f].y, Bs[f].z).normalized()
        # leading edge: along the perpendicular velocity of the mid-blade (world, including the moving shoulder), sign kept continuous
        mid = {f: Pf[f] + Groot[f] + Bs[f] * 0.7 for f in Gs}
        es, e_prev = {}, e0.copy()
        for f in range(f0, f1 + 1):
            fa, fb = max(f0, f - 1), min(f1, f + 1)
            vel = (mid[fb] - mid[fa]) / max(1, fb - fa) * 30.0
            vperp = vel - Bs[f] * vel.dot(Bs[f])
            sp = vperp.length
            if sp > 1e-6:
                cand = vperp.normalized()
                if cand.dot(e_prev) < 0:
                    cand = -cand
                wv = smoothstep(sp / 2.0)
                e = (e_prev * (1 - wv) + cand * wv)
            else:
                e = e_prev.copy()
            e = e - Bs[f] * e.dot(Bs[f])
            e = e.normalized() if e.length > 1e-6 else e_prev
            es[f] = e
            e_prev = e
        # ---------- solve
        stats = {'clamped': 0, 'worst_reach': 0.0, 'cut_hits': 0, 'edge_dot': [], 'over': []}
        for f in range(f0, f1 + 1):
            sc.frame_set(f)
            bpy.context.view_layer.update()
            orig = {b: pbs[b].rotation_quaternion.copy() for b in (ARM, FORE, HAND)}
            P = pbs[ARM].matrix.translation.copy()
            B, e = Bs[f], es[f]
            n = e.cross(B).normalized()
            Rb = Matrix((B, n, e)).transposed()
            R_t = Rb @ basis0.inverted()
            # sword world matrix: pivot at the fist
            G_world = P + Groot[f]
            S_t = Matrix.Translation(G_world) @ (R_t @ S_rest.to_3x3()).to_4x4()      # the bone's own rest orientation, rotated by the designed change
            H_t = S_t @ Lrel.inverted()
            W = H_t.translation.copy()
            d_vec = W - P
            d = d_vec.length
            lo, hi = abs(L1 - L2) * 1.001, (L1 + L2) * 0.999
            if d > hi or d < lo:
                stats['clamped'] += 1
                stats['over'].append((f, round(d - hi, 2)))
                stats['worst_reach'] = max(stats['worst_reach'], d - hi)
                d = min(max(d, lo), hi)
                W = P + d_vec.normalized() * d
            a = (W - P) / d
            hint = Vector((-0.4, 0.3, -0.85))
            perp = hint - a * hint.dot(a)
            if perp.length < 1e-4:
                perp = Vector((-1, 0, 0)) - a * (-a.x)
            perp.normalize()
            cosA = (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d)
            sinA = math.sqrt(max(0.0, 1 - cosA * cosA))
            E = P + a * (L1 * cosA) + perp * (L1 * sinA)
            # upper arm: shortest rotation of the original orientation onto P->E
            M0 = pbs[ARM].matrix.copy()
            y0 = (M0.to_3x3() @ Vector((0, 1, 0))).normalized()
            q = y0.rotation_difference((E - P).normalized())
            M = q.to_matrix().to_4x4() @ M0.to_3x3().to_4x4()
            M.translation = P
            pbs[ARM].matrix = M
            bpy.context.view_layer.update()
            M1 = pbs[FORE].matrix.copy()
            y1 = (M1.to_3x3() @ Vector((0, 1, 0))).normalized()
            q = y1.rotation_difference((W - E).normalized())
            Mf = q.to_matrix().to_4x4() @ M1.to_3x3().to_4x4()
            Mf.translation = M1.translation
            pbs[FORE].matrix = Mf
            bpy.context.view_layer.update()
            Mh = H_t.to_3x3().to_4x4()
            Mh.translation = pbs[HAND].matrix.translation
            pbs[HAND].matrix = Mh
            bpy.context.view_layer.update()
            w = weight(spec['W'], f)
            for b in (ARM, FORE, HAND):
                ik = pbs[b].rotation_quaternion.copy()
                if ik.dot(orig[b]) < 0:
                    ik = Quaternion((-ik.w, -ik.x, -ik.y, -ik.z))
                pbs[b].rotation_quaternion = orig[b].slerp(ik, w)
                pbs[b].keyframe_insert('rotation_quaternion', frame=f)
                pbs[b].location = (0, 0, 0)
                pbs[b].keyframe_insert('location', frame=f)
            # ---------- diagnostics from the final pose
            bpy.context.view_layer.update()
            Sw = pbs[SWORD].matrix
            base = Sw.translation
            axis = (Sw.to_3x3() @ Vector((0, 1, 0))).normalized()
            if w > 0.95:
                ex, ey = 0.16, -ENEMY_DIST
                # closest approach of the blade (from guard to tip, 0.15..1.25 m along the blade) to the enemy axis in the horizontal plane
                best = 9.0
                for s in np.linspace(0.15, 1.25, 12):
                    p = base + axis * s
                    if 0.1 < p.z < 1.9:
                        best = min(best, math.hypot(p.x - ex, p.y - ey))
                if best < ENEMY_RADIUS:
                    stats['cut_hits'] += 1
                vel = (mid[min(f1, f + 1)] - mid[max(f0, f - 1)]).length * 15.0
                if vel > 1.5:
                    nn = (Sw.to_3x3() @ (S_rest.to_3x3().inverted() @ n0)).normalized()
                    stats['edge_dot'].append(abs(nn.dot((mid[min(f1, f + 1)] - mid[max(f0, f - 1)]).normalized())))
        stats['over'] = stats['over'][::4]
        stats['edge_dot'] = round(float(np.mean(stats['edge_dot'])), 3) if stats['edge_dot'] else None
        report[name] = stats
    return report


def drop_sword(arm, act, release_frame, ground=0.0, seed=3):
    """Death clip: from release_frame the sword is a free rigid body (gravity, floor bounce, friction) and settles beside the hand."""
    pbs = arm.pose.bones
    sc = bpy.context.scene
    arm.animation_data.action = act
    f0, f1 = int(act.frame_range[0]), int(act.frame_range[1])
    # sword shape: collision samples (guard, tip, pommel, both blade edges) in sword-local space
    obj = [o for o in bpy.data.objects if o.type == 'MESH' and SWORD in o.vertex_groups][0]
    vg = obj.vertex_groups[SWORD].index
    pts = []
    for vtx in obj.data.vertices:
        for g in vtx.groups:
            if g.group == vg and g.weight > 0.99:
                pts.append(tuple(vtx.co))
    pts = np.array(pts)
    sc.frame_set(release_frame - 1)
    bpy.context.view_layer.update()
    Sm1 = pbs[SWORD].matrix.copy()
    sc.frame_set(release_frame)
    bpy.context.view_layer.update()
    S0 = pbs[SWORD].matrix.copy()
    rest_world_pts = np.array(pts)          # object space == armature space at rest (object has identity transform, parent = armature identity)
    # local sample points in the sword bone frame at REST (rest matrix_local)
    Sbone_rest = arm.data.bones[SWORD].matrix_local
    inv = np.array(Sbone_rest.inverted())
    loc = (inv[:3, :3] @ rest_world_pts.T).T + inv[:3, 3]
    # reduce to ~60 extreme/boundary points
    idx = np.unique(np.concatenate([np.argsort(loc[:, k])[:8] for k in range(3)] + [np.argsort(loc[:, k])[-8:] for k in range(3)] + [np.arange(0, len(loc), max(1, len(loc) // 30))]))
    loc = loc[idx]
    centre = loc.mean(0)
    rel = loc - centre
    mass = 1.0
    cov = rel.T @ rel / len(rel)
    Iloc = (np.trace(cov) * np.eye(3) - cov) * mass
    Iinv_loc = np.linalg.inv(Iloc + 1e-4 * np.eye(3))
    # initial state from the two animated matrices (pivot = centre of the sword)
    def world_state(Mw):
        R = np.array(Mw.to_3x3())
        p = R @ centre + np.array(Mw.translation)
        return p, R
    p1, R1 = world_state(S0)
    pm, Rm = world_state(Sm1)
    vlin = (p1 - pm) * 30.0
    dR = R1 @ Rm.T
    qd = Matrix(dR.tolist()).to_quaternion()
    ang = qd.angle * 30.0
    axis = np.array(qd.axis) if qd.angle > 1e-6 else np.zeros(3)
    omega = axis * ang
    vlin = vlin * 0.8                              # the fingers open: it leaves a little slower than the hand
    omega = omega * 0.6
    rng = np.random.default_rng(seed)
    R = R1.copy()
    p = p1.copy()
    g = np.array([0.0, 0.0, -9.8])
    sub = 8
    dt = 1.0 / (30.0 * sub)
    states = {release_frame: (p.copy(), R.copy())}
    rest_cnt = 0
    for f in range(release_frame + 1, f1 + 1):
        for _ in range(sub):
            vlin = vlin + g * dt
            p = p + vlin * dt
            wq = omega * dt
            ang_ = np.linalg.norm(wq)
            if ang_ > 1e-9:
                dq = Quaternion(tuple(wq / ang_), ang_).to_matrix()
                R = np.array(dq) @ R
            for k in range(len(loc)):
                pw = R @ rel[k] + p
                if pw[2] < ground:
                    r = pw - p
                    vp = vlin + np.cross(omega, r)
                    if vp[2] < 0:
                        n = np.array([0.0, 0.0, 1.0])
                        Iinv = R @ Iinv_loc @ R.T
                        kn = 1.0 / mass + n @ np.cross(Iinv @ np.cross(r, n), r)
                        jn = -(1 + 0.22) * vp[2] / kn
                        imp = jn * n
                        vt = vp - vp[2] * n
                        if np.linalg.norm(vt) > 1e-6:
                            tdir = vt / np.linalg.norm(vt)
                            kt = 1.0 / mass + tdir @ np.cross(Iinv @ np.cross(r, tdir), r)
                            jt = min(np.linalg.norm(vt) / kt, 0.55 * jn)
                            imp = imp - jt * tdir
                        vlin = vlin + imp / mass
                        omega = omega + Iinv @ np.cross(r, imp)
                    p[2] += (ground - pw[2]) * 0.8
            omega = omega * (1.0 - 0.6 * dt)
            vlin = vlin * (1.0 - 0.15 * dt)
            if p[2] < 0.12 and np.linalg.norm(vlin) < 0.08 and np.linalg.norm(omega) < 0.25:
                vlin = vlin * 0.5
                omega = omega * 0.5
        states[f] = (p.copy(), R.copy())
    # write keys: Sword_R follows the hand until release, then the simulated transform
    for f in range(f0, f1 + 1):
        sc.frame_set(f)
        bpy.context.view_layer.update()
        if f >= release_frame:
            p_f, R_f = states[f]
            Mw = Matrix(R_f.tolist()).to_4x4()
            Mw.translation = Vector(p_f) - Matrix(R_f.tolist()) @ Vector(centre)
            pbs[SWORD].matrix = Mw
            bpy.context.view_layer.update()
        pbs[SWORD].keyframe_insert('rotation_quaternion', frame=f)
        pbs[SWORD].keyframe_insert('location', frame=f)
        pbs[SWORD].keyframe_insert('scale', frame=f)
    pbs[SWORD].location = (0, 0, 0)               # the bone keeps its last simulated transform otherwise and would leak into the other clips
    pbs[SWORD].rotation_quaternion = (1, 0, 0, 0)
    pbs[SWORD].scale = (1, 1, 1)
    final_p, final_R = states[f1]
    return {'release': release_frame, 'final_centre': tuple(np.round(final_p, 2)), 'final_height': round(float(final_p[2]), 3)}
