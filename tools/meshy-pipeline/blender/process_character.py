"""Build the final character .blend from raw Meshy files, driven by a process spec.

Usage:
  blender --background --python process_character.py -- <process.json> <assetsRoot> <out.blend>

Steps:
  1. import the base file (mesh + skeleton), drop helper meshes, mirror the model and fix weights
  2. import every clip file, harvest the wanted actions (other imported objects are discarded)
  3. bake each clip: optionally mirror it left/right, face it forward and recenter it on the origin
     (rotation about the start hips position, so a fall or lunge keeps its travel)
  4. save a .blend whose actions are named after the clips (fake user keeps them)
Bone poses are baked in armature space, so any clip can be mirrored or turned without touching
the hierarchy: basis = (rest_parent^-1 @ rest)^-1 @ parent_pose^-1 @ pose.
"""
import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector, kdtree

sys.path.insert(0, os.path.dirname(__file__))
import skin_fix

argv = sys.argv[sys.argv.index("--") + 1:]
cfg = json.load(open(argv[0], encoding="utf-8"))
assets_root, out_blend = argv[1], argv[2]
MIRROR_X = Matrix.Diagonal((-1, 1, 1, 1))


def import_glb(path):
    before_objs, before_actions = set(bpy.data.objects), set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=path)
    return ([o for o in bpy.data.objects if o not in before_objs],
            [a for a in bpy.data.actions if a not in before_actions])


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = cfg.get("fps", 24)

# 1. base model
base_path = os.path.join(assets_root, cfg["base"])
objs, base_actions = import_glb(base_path)
arm = next(o for o in objs if o.type == "ARMATURE")
for o in objs:
    if o.type == "MESH" and len(o.vertex_groups) == 0:
        bpy.data.objects.remove(o, do_unlink=True)
body = next(o for o in objs if o.type == "MESH" and o.name in bpy.data.objects and len(o.vertex_groups) > 0)
hand = "Left"
if cfg.get("mirrorModel"):
    skin_fix.mirror_model(body)
    hand = "Right"
WEAPON = cfg.get("weaponBone")
if WEAPON:
    skin_fix.add_weapon_bone(arm, hand, WEAPON)
print("SKIN_FIX", skin_fix.apply(body, arm, hand, WEAPON))
if cfg.get("fist"):
    print("FIST", skin_fix.curl_fist(body, arm, cfg["fist"]["side"], cfg["fist"].get("palmSign", -1.0)))

# 2. harvest actions
harvest = {(base_path, a.name): a for a in base_actions}
for clip in cfg["clips"]:
    path = os.path.join(assets_root, clip["file"])
    if (path, clip["action"]) in harvest:
        continue
    if not any(k[0] == path for k in harvest):
        extra_objs, extra_actions = import_glb(path)
        for o in extra_objs:
            bpy.data.objects.remove(o, do_unlink=True)
        for a in extra_actions:
            harvest[(path, a.name)] = a

# 3. bake
bones = sorted(arm.data.bones, key=lambda b: len(b.parent_recursive))
rest = {b.name: b.matrix_local.copy() for b in bones}
parent = {b.name: (b.parent.name if b.parent else None) for b in bones}
rest_yaw = math.atan2(*(rest["LeftUpLeg"].translation - rest["RightUpLeg"].translation).yx)
rest_hips_xy = Vector((rest["Hips"].translation.x, rest["Hips"].translation.y, 0))
ad = arm.animation_data or arm.animation_data_create()
for pb in arm.pose.bones:
    pb.rotation_mode = "QUATERNION"


def ease_tail(times, k):
    """Slow the last k source frames so the clip comes to rest with zero velocity.
    f(s) = -s^3 + s^2 + s: starts at the normal speed (f'(0)=1) and stops (f'(1)=0)."""
    head, ta = times[:-k], times[-k - 1]
    return head + [ta + k * (-(j / k) ** 3 + (j / k) ** 2 + j / k) for j in range(k + 1)]


def compress(times, cut):
    """Replace the source stretch [from, to] by cut["frames"] frames played through it faster, so a
    pause is removed without a pop: the poses on either side are reached by ordinary motion."""
    a, b, k = cut["from"], cut["to"], cut["frames"]
    return times[:a + 1] + [times[a] + (times[b] - times[a]) * j / k for j in range(1, k + 1)] + times[b + 1:]


def sample(action, tail=None, cuts=()):
    ad.action = action
    if hasattr(action, "slots") and len(action.slots):
        ad.action_slot = action.slots[0]
    start, end = action.frame_range
    times = [start + i for i in range(round(end - start) + 1)]
    for cut in cuts:
        times = compress(times, cut)
    if tail:
        times = ease_tail(times, tail["frames"])
    frames = []
    for t in times:
        fi = math.floor(t)
        scene.frame_set(fi, subframe=t - fi)
        frames.append({pb.name: pb.matrix.copy() for pb in arm.pose.bones})
    return frames


def mirror_pose(pose):
    out = {}
    for b in pose:
        m = skin_fix._swap_side(b)
        delta = pose[m] @ rest[m].inverted()
        out[b] = (MIRROR_X @ delta @ MIRROR_X) @ rest[b]
    return out


def facing_yaw(pose):
    lat = pose["LeftUpLeg"].translation - pose["RightUpLeg"].translation
    return math.atan2(lat.y, lat.x) - rest_yaw


def basis_of(pose):
    out = {}
    for b in bones:
        p = parent[b.name]
        local_rest = rest[b.name] if p is None else rest[p].inverted() @ rest[b.name]
        parent_pose = Matrix.Identity(4) if p is None else pose[p]
        out[b.name] = local_rest.inverted() @ parent_pose.inverted() @ pose[b.name]
    return out


def fk(basis):
    """Armature-space pose matrices from local bases: pose = parent_pose @ (rest_parent^-1 @ rest) @ basis."""
    pose = {}
    for b in bones:
        p = parent[b.name]
        local_rest = rest[b.name] if p is None else rest[p].inverted() @ rest[b.name]
        pose[b.name] = (Matrix.Identity(4) if p is None else pose[p]) @ local_rest @ basis[b.name]
    return pose


def put(basis, pose, name, world):
    """Give bone `name` the armature-space pose `world`; its children keep their local bases and follow."""
    p = parent[name]
    local_rest = rest[name] if p is None else rest[p].inverted() @ rest[name]
    basis[name] = local_rest.inverted() @ (Matrix.Identity(4) if p is None else pose[p]).inverted() @ world
    return fk(basis)


def about(pose_m, pivot, rot3):
    return Matrix.Translation(pivot) @ rot3.to_4x4() @ Matrix.Translation(-pivot) @ pose_m


def aim(pose_m, current, target, weight):
    """Turn a bone so that direction `current` becomes `target`, by `weight` of the way (slerp)."""
    full = (current.rotation_difference(target).to_matrix() @ pose_m.to_3x3()).to_quaternion()
    mixed = pose_m.to_quaternion().slerp(full, weight)
    return Matrix.Translation(pose_m.translation) @ mixed.to_matrix().to_4x4()


def window(i, spec):
    """0 -> 1 over spec["in"], 1 over spec["hold"], 1 -> 0 over spec["out"] (smoothstep), else 0."""
    def smooth(t):
        t = min(1.0, max(0.0, t))
        return t * t * (3 - 2 * t)
    a, b = spec["in"]
    c, d = spec["hold"][1], spec["out"][1]
    if i < a:
        return 0.0
    if i < b:
        return smooth((i - a) / max(b - a, 1))
    if i <= c:
        return 1.0
    return 1.0 - smooth((i - c) / max(d - c, 1)) if i < d else 0.0


def final_strike(frames, spec):
    """Finish the chop in a clean forward strike: chest and head square to the front, the sword arm
    straight with the blade pointing forward, the free arm relaxed. Blended in and out by `spec`."""
    forward = Vector((0, -1, 0))
    aim_dir = Vector(spec["armDirection"]).normalized()
    rest_lat = rest["LeftShoulder"].translation - rest["RightShoulder"].translation
    rest_yaw_s = math.atan2(rest_lat.y, rest_lat.x)

    def heading(v):
        h = Vector((v.x, v.y, 0))
        return math.atan2(forward.cross(h).z, forward.dot(h))

    rest_face = heading(rest["headfront"].translation - rest["Head"].translation)
    link = rest["RightHand"].inverted() @ rest[WEAPON] if WEAPON else Matrix.Identity(4)
    for i, pose in enumerate(frames):
        w = window(i, spec)
        if w <= 0:
            continue
        B = basis_of(pose)
        D = fk(B)
        lat = D["LeftShoulder"].translation - D["RightShoulder"].translation
        yaw = math.atan2(lat.y, lat.x) - rest_yaw_s
        pivot = D["Spine02"].translation
        D = put(B, D, "Spine02", about(D["Spine02"], pivot, Matrix.Rotation(-yaw * w, 3, "Z")))
        err = heading(D["headfront"].translation - D["Head"].translation) - rest_face
        D = put(B, D, "Head", about(D["Head"], D["Head"].translation, Matrix.Rotation(-err * w, 3, "Z")))
        for bone, child in (("RightArm", "RightForeArm"), ("RightForeArm", "RightHand")):
            limb = D[child].translation - D[bone].translation
            D = put(B, D, bone, aim(D[bone], limb.normalized(), aim_dir, w))
        sword_axis = ((D["RightHand"] @ link).to_3x3() @ Vector((0, 1, 0))).normalized()
        D = put(B, D, "RightHand", aim(D["RightHand"], sword_axis, aim_dir, w))
        for bone in ("LeftArm", "LeftForeArm", "LeftHand"):  # the free arm drops back towards its rest pose
            relaxed = B[bone].to_quaternion().slerp(Quaternion(), spec.get("relaxLeft", 0.7) * w)
            B[bone] = Matrix.Translation(B[bone].translation) @ relaxed.to_matrix().to_4x4()
            D = fk(B)
        frames[i] = D


def hand_pose_from(frames, spec):
    """Give a hand the pose it has, relative to its forearm, in another clip (averaged over that clip).
    Used where an animation's own wrist is wrong for this character: the library's combat stance
    was made for a shield hand, so its off-hand wrist is twisted; the run's off-hand is a natural fist."""
    bone = spec["bone"]
    ref = next(c for c in cfg["clips"] if c["name"] == spec["fromClip"])
    ref_frames = sample(harvest[(os.path.join(assets_root, ref["file"]), ref["action"])])
    quats = [basis_of(p)[bone].to_quaternion() for p in ref_frames]
    mean = quats[0].copy()
    for q in quats[1:]:
        mean = Quaternion((mean.w + (q.w if q.dot(quats[0]) >= 0 else -q.w), mean.x + (q.x if q.dot(quats[0]) >= 0 else -q.x),
                           mean.y + (q.y if q.dot(quats[0]) >= 0 else -q.y), mean.z + (q.z if q.dot(quats[0]) >= 0 else -q.z)))
    mean.normalize()
    for i, pose in enumerate(frames):
        B = basis_of(pose)
        B[bone] = Matrix.Translation(B[bone].translation) @ mean.to_matrix().to_4x4()
        frames[i] = fk(B)


def hand_inward(frames, spec):
    """Tilt a hand at the wrist, towards the middle of the body, by `degrees` on every frame.
    The forearm direction and the inward direction (horizontal, towards the hips, made square to the
    forearm) are recomputed each frame, so the tilt stays 'inward' however the arm is turned."""
    bone, fore, hips = spec["bone"], spec["forearm"], spec.get("hips", "Hips")
    angle = math.radians(spec["degrees"])
    for i, pose in enumerate(frames):
        wrist = pose[bone].translation
        a = (wrist - pose[fore].translation).normalized()
        inward = pose[hips].translation - wrist
        inward.z = 0
        inward -= a * inward.dot(a)
        if inward.length < 1e-4:
            continue
        axis = a.cross(inward.normalized()).normalized()  # turning a about this axis swings it towards `inward`
        B = basis_of(pose)
        D = fk(B)
        D = put(B, D, bone, about(D[bone], wrist, Matrix.Rotation(angle, 3, axis)))
        frames[i] = D


def hand_roll(frames, spec):
    """As the character drops, roll the sword hand about the forearm so the back of the hand faces
    down (palm up), the natural way a hand lies; blended in by how far the hips have fallen."""
    back_local = rest["RightHand"].to_3x3().inverted() @ Vector((-1, 0, 0))  # at rest the back of the hand faces outwards
    z0 = frames[0]["Hips"].translation.z
    drop = max(z0 - frames[-1]["Hips"].translation.z, 1e-6)
    seen = {}
    for pose in frames:
        if id(pose) in seen:
            continue
        seen[id(pose)] = True
        s = min(1.0, max(0.0, (z0 - pose["Hips"].translation.z) / drop))
        s = s * s * (3 - 2 * s)
        B = basis_of(pose)
        D = fk(B)
        axis = (D["RightHand"].translation - D["RightForeArm"].translation).normalized()
        back = D["RightHand"].to_3x3() @ back_local
        b_p, t_p = back - axis * back.dot(axis), Vector((0, 0, -1)) - axis * Vector((0, 0, -1)).dot(axis)
        if b_p.length < 1e-4 or t_p.length < 1e-4:
            continue
        phi = math.atan2(axis.dot(b_p.cross(t_p)), b_p.dot(t_p))
        wrist = D["RightHand"].translation
        D = put(B, D, "RightHand", about(D["RightHand"], wrist, Matrix.Rotation(phi * s, 3, axis)))
        pose.clear()
        pose.update(D)


dominant = []
group_names = {g.index: g.name for g in body.vertex_groups}
for v in body.data.vertices:
    dominant.append(max(((group_names[g.group], g.weight) for g in v.groups), key=lambda kv: kv[1], default=("", 0))[0])
leg_idx = [i for i, d in enumerate(dominant) if d.endswith(("UpLeg", "Leg", "Foot", "ToeBase"))]


def eval_positions(n):
    """World-space (metres) positions of every vertex at each of the n frames of the active action."""
    out = []
    for i in range(n):
        scene.frame_set(i)
        ev = body.evaluated_get(bpy.context.evaluated_depsgraph_get())
        me = ev.to_mesh()
        co = np.empty(len(me.vertices) * 3)
        me.vertices.foreach_get("co", co)
        ev.to_mesh_clear()
        m = np.array(ev.matrix_world)
        out.append(co.reshape(-1, 3) @ m[:3, :3].T + m[:3, 3])
    return np.array(out)


rest_world = np.array([(body.matrix_world @ v.co)[:] for v in body.data.vertices])
to_arm = np.array(arm.matrix_world.inverted())  # world -> armature space (the armature works in cm)
sword_idx = [i for i, d in enumerate(dominant) if d == WEAPON] if WEAPON else []
# what the blade must stay clear of: legs, feet and the hips-bound front (not the cape behind)
avoid_idx = [i for i, d in enumerate(dominant) if d.endswith(("UpLeg", "Leg", "Foot", "ToeBase"))
             or (d == "Hips" and rest_world[i, 1] <= 0.11)]


def to_armature(points):
    return points @ to_arm[:3, :3].T + to_arm[:3, 3]


def prepare(clip):
    src = harvest[(os.path.join(assets_root, clip["file"]), clip["action"])]
    tail = clip.get("easeTail")
    frames = sample(src, tail, clip.get("cuts", ()))
    if clip.get("mirrorClip"):
        frames = [mirror_pose(p) for p in frames]
    c0 = frames[0]["Hips"].translation
    yaw0 = facing_yaw(frames[0])
    fix = (Matrix.Translation(rest_hips_xy) @ Matrix.Rotation(-yaw0, 4, "Z")
           @ Matrix.Translation(Vector((-c0.x, -c0.y, 0))))
    frames = [{b: fix @ m for b, m in p.items()} for p in frames]
    if tail:
        frames += [frames[-1]] * tail.get("hold", 0)
    if clip.get("finalStrike"):
        final_strike(frames, clip["finalStrike"])
    if clip.get("handRoll"):
        hand_roll(frames, clip["handRoll"])
    if clip.get("handPose"):
        hand_pose_from(frames, clip["handPose"])
    if clip.get("handInward"):
        hand_inward(frames, clip["handInward"])
    return frames, c0, yaw0


def weapon_poses(frames, clip, lift=0.0):
    """The weapon bone follows the hand rigidly; with weaponLay it is laid down as the character drops:
    the blade ends horizontal, tilted just enough that its tip touches the floor (lift = the settle lift, cm)."""
    if not WEAPON:
        return
    hand_bone = parent[WEAPON]
    link = rest[hand_bone].inverted() @ rest[WEAPON]
    unique = list({id(p): p for p in frames}.values())  # held frames share one dict: touch each once
    for p in unique:
        p[WEAPON] = p[hand_bone] @ link
    if not clip.get("weaponLay"):
        return
    hz = {id(p): p["Hips"].translation.z for p in unique}
    z0, drop = frames[0]["Hips"].translation.z, max(frames[0]["Hips"].translation.z - frames[-1]["Hips"].translation.z, 1e-6)
    end = frames[-1][WEAPON]
    d = end.to_3x3() @ Vector((0, 1, 0))  # bone axis = grip -> tip
    flat = Vector((d.x, d.y, 0))
    if flat.length < 0.3:  # blade nearly vertical: lay it out along the arm instead
        out = frames[-1][hand_bone].translation - frames[-1]["Hips"].translation
        flat = Vector((out.x, out.y, 0))
    flat.normalize()
    hand_z = frames[-1][hand_bone].translation.z + lift
    sin_a = min(0.6, max(0.0, (hand_z - 6.0) / arm.data.bones[WEAPON].length))
    target = flat * math.sqrt(1 - sin_a * sin_a) + Vector((0, 0, -sin_a))
    q = d.rotation_difference(target)
    for p in unique:
        s = min(1.0, max(0.0, (z0 - hz[id(p)]) / drop))
        s = s * s * (3 - 2 * s)
        g = p[WEAPON].translation
        R = Quaternion().slerp(q, s).to_matrix().to_4x4()
        p[WEAPON] = Matrix.Translation(g) @ R @ Matrix.Translation(-g) @ p[WEAPON]


GRIP_ZONE_CM = 15.0  # blade verts closer than this to the grip are not judged against the body


def _about(point, rot3, m):
    return Matrix.Translation(point) @ rot3.to_4x4() @ Matrix.Translation(-point) @ m


def edge_align(frames):
    """Roll the blade about its own axis so a cutting edge leads the swing.
    The flat of the blade is its thinnest direction (PCA of the blade verts); during fast motion the
    flat normal is turned perpendicular to the tip's direction of travel, then eased in and out."""
    length = arm.data.bones[WEAPON].length
    head = rest[WEAPON].translation
    axis_rest = (rest[WEAPON] @ Vector((0, length, 0)) - head).normalized()
    pts = to_armature(rest_world[sword_idx])
    s = ((pts - np.array(head)) @ np.array(axis_rest)) / length
    blade = pts[(s > 0.35) & (s < 0.95)]
    w, v = np.linalg.eigh(np.cov((blade - blade.mean(0)).T))
    f_local = rest[WEAPON].to_3x3().inverted() @ Vector(v[:, 0])  # thinnest direction = flat normal
    n = len(frames)
    tip = [p[WEAPON] @ Vector((0, length, 0)) for p in frames]
    vel = [(tip[min(i + 1, n - 1)] - tip[max(i - 1, 0)]) * (scene.render.fps / 2) for i in range(n)]
    axes = [(p[WEAPON].to_3x3() @ Vector((0, 1, 0))).normalized() for p in frames]
    perp = [v - a * v.dot(a) for v, a in zip(vel, axes)]
    speed = [m.length for m in perp]
    peak = max(speed)
    raw, lead_before, lead_after = [], [], []
    for i, p in enumerate(frames):
        f = p[WEAPON].to_3x3() @ f_local
        wgt = min(1.0, max(0.0, (speed[i] - 0.15 * peak) / (0.35 * peak)))
        if speed[i] > 0.5 * peak:
            lead_before.append(abs(f.dot(perp[i].normalized())))
        target = axes[i].cross(perp[i]).normalized() if speed[i] > 1e-6 else f
        phi = math.atan2(axes[i].dot(f.cross(target)), f.dot(target))
        # a double-edged blade looks the same rolled by 180 degrees, so the roll is only defined
        # modulo pi: average it as a doubled angle (a vector), weighted by how fast the swing is
        raw.append((wgt * math.cos(2 * phi), wgt * math.sin(2 * phi)))
    smooth = []
    for i in range(n):
        win = raw[max(0, i - 1):i + 2]
        vx, vy = sum(w[0] for w in win) / len(win), sum(w[1] for w in win) / len(win)
        smooth.append(0.5 * math.atan2(vy, vx) * min(1.0, math.hypot(vx, vy)))
    for i, p in enumerate(frames):
        p[WEAPON] = _about(p[WEAPON].translation, Matrix.Rotation(smooth[i], 3, axes[i]), p[WEAPON])
        if speed[i] > 0.5 * peak:
            lead_after.append(abs((p[WEAPON].to_3x3() @ f_local).dot(perp[i].normalized())))
    mean = lambda a: round(float(np.mean(a)), 3) if a else None
    return {"flatFacingTravelBefore": mean(lead_before), "flatFacingTravelAfter": mean(lead_after),
            "maxRollDeg": round(math.degrees(max(abs(x) for x in smooth)), 1),
            "note": "1 = flat of the blade leads the swing, 0 = an edge leads (self-consistent measure, check the GIF)"}


def avoid_legs(frames, body_pts, dz, margin, cyclic):
    """Swing the blade out about its grip, by the least angle that keeps it `margin` cm clear of the
    legs on every frame, smoothed (max filter, then mean) so it never dips back inside."""
    n = len(frames)
    rest_blade = to_armature(rest_world[sword_idx])
    rest_blade = rest_blade[np.linalg.norm(rest_blade - np.array(rest[WEAPON].translation), axis=1) > GRIP_ZONE_CM]
    inv = rest[WEAPON].inverted()

    def tree_for(i):
        tree = kdtree.KDTree(len(avoid_idx))
        for k, q in enumerate(body_pts[i]):
            tree.insert((q[0], q[1], q[2] + dz[i]), k)
        tree.balance()
        return tree

    def blade_of(i):
        return [frames[i][WEAPON] @ inv @ Vector(r) for r in rest_blade]

    best, before = [], []
    for i in range(n):
        tree, blade, g = tree_for(i), blade_of(i), frames[i][WEAPON].translation

        def clear(a):
            rot = Matrix.Rotation(a, 3, "Y")  # +a swings the tip out to the character's right (-x)
            return min(tree.find(g + rot @ (b - g))[2] for b in blade)

        c0 = clear(0.0)
        before.append(c0)
        chosen, top = 0.0, c0
        if c0 < margin:
            for deg in range(2, 62, 2):
                c = clear(math.radians(deg))
                if c > top:
                    chosen, top = math.radians(deg), c
                if c >= margin:
                    break
        best.append(chosen)

    def window(arr, i, r):
        return [arr[(i + d) % n] if cyclic else arr[min(max(i + d, 0), n - 1)] for d in range(-r, r + 1)]

    grown = [max(window(best, i, 2)) for i in range(n)]
    smooth = [sum(window(grown, i, 2)) / 5 for i in range(n)]
    after = []
    for i in range(n):
        tree, blade, g = tree_for(i), blade_of(i), frames[i][WEAPON].translation
        rot = Matrix.Rotation(smooth[i], 3, "Y")
        after.append(min(tree.find(g + rot @ (b - g))[2] for b in blade))
        frames[i][WEAPON] = _about(g, rot, frames[i][WEAPON])
    return {"minClearanceCmBefore": round(min(before), 2), "minClearanceCmAfter": round(min(after), 2),
            "maxSwingOutDeg": round(math.degrees(max(smooth)), 1), "marginCm": margin}


def write(clip, frames, dz):
    """Bake the frames into a new action; dz[i] lifts frame i (armature units, 1 unit = 1 cm)."""
    action = bpy.data.actions.new(clip["name"])
    action.use_fake_user = True
    ad.action = action
    last_q = {}
    for i, pose in enumerate(frames):
        lifted = {b: Matrix.Translation((0, 0, dz[i])) @ m for b, m in pose.items()}
        for name, basis in basis_of(lifted).items():
            pb = arm.pose.bones[name]
            q = basis.to_quaternion()
            if name in last_q and q.dot(last_q[name]) < 0:
                q.negate()
            last_q[name] = q
            pb.location, pb.rotation_quaternion, pb.scale = basis.to_translation(), q, basis.to_scale()
            for path in ("location", "rotation_quaternion", "scale"):
                pb.keyframe_insert(path, frame=i)
    action.use_frame_range = True
    action.frame_start, action.frame_end = 0, len(frames) - 1
    return action


report = {}
for clip in cfg["clips"]:
    frames, c0, yaw0 = prepare(clip)
    n = len(frames)
    # pass 1 without a ground correction, measure where the legs end up, then bake again with it
    weapon_poses(frames, clip, 0.0)
    extra = {}
    if WEAPON and clip.get("weaponEdgeAlign"):
        extra["edgeAlign"] = edge_align(frames)
    action = write(clip, frames, [0.0] * n)
    pass1 = eval_positions(n)
    leg_z = list(pass1[:, leg_idx, 2].min(axis=1))
    if clip.get("alignGround", True):
        # planted feet: the lowest leg/foot vertex of the clip sits on the floor
        shift = -min(leg_z) * 100
        dz = [shift] * n
        info = {"groundShiftCm": round(shift, 2)}
    else:
        # a fall: lift in proportion to how far the hips have dropped, so the standing start is untouched
        hz = [frames[i]["Hips"].translation.z for i in range(n)]
        settled = -min(leg_z[-8:]) * 100
        drop = max(hz[0] - hz[-1], 1e-6)
        dz = [settled * min(1.0, max(0.0, (hz[0] - h) / drop)) for h in hz]
        info = {"settleLiftCm": round(settled, 2)}
        weapon_poses(frames, clip, settled)
    if WEAPON and clip.get("avoidLegs"):
        arm_pts = to_armature(pass1.reshape(-1, 3)).reshape(n, -1, 3)[:, avoid_idx]
        extra["avoidLegs"] = avoid_legs(frames, arm_pts, dz, clip["avoidLegs"]["marginCm"], bool(clip.get("loop")))
    bpy.data.actions.remove(action)
    action = write(clip, frames, dz)
    report[clip["name"]] = {"frames": n, "sourceYawDeg": round(math.degrees(yaw0), 1),
                            "sourceHipsStart": [round(c, 3) for c in c0], "mirrored": bool(clip.get("mirrorClip")),
                            "easeTail": clip.get("easeTail"), "cuts": clip.get("cuts"), **info, **extra}
    print("BAKED", clip["name"], report[clip["name"]])

for a in set(harvest.values()):
    bpy.data.actions.remove(a)
ad.action = bpy.data.actions[cfg["clips"][0]["name"]]
bpy.ops.outliner.orphans_purge(do_recursive=True)
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=out_blend, compress=True)
with open(os.path.splitext(out_blend)[0] + ".process.json", "w", encoding="utf-8") as fh:
    json.dump(report, fh, indent=2)
print("PROCESS_DONE", out_blend)
