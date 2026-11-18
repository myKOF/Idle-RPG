"""Pose authoring kit: torso rotations, analytic 2-bone arm IK, spear aiming, keying, GIF rendering."""
import bpy, math, os, sys
from mathutils import Vector, Matrix, Quaternion
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from animlib import setup_scene, cam_ortho, render, objs, reset_pose  # noqa

UP = Vector((0, 0, 1))

def upd(): bpy.context.view_layer.update()

def rot(arm, name, axis, deg, pivot=None):
    """Rotate bone `name` (with its subtree) about a world axis through its posed head (or pivot)."""
    pb = arm.pose.bones[name]
    h = pb.matrix.to_translation() if pivot is None else Vector(pivot)
    R = Matrix.Translation(h) @ Matrix.Rotation(math.radians(deg), 4, Vector(axis).normalized()) @ Matrix.Translation(-h)
    pb.matrix = R @ pb.matrix; upd()

def move(arm, name, delta):
    pb = arm.pose.bones[name]; pb.matrix = Matrix.Translation(Vector(delta)) @ pb.matrix; upd()

def pos(arm, name, end="head"):
    pb = arm.pose.bones[name]
    return (pb.head if end == "head" else pb.tail).copy()

def _swing(arm, name, new_dir, roll_ref=None):
    pb = arm.pose.bones[name]
    M = pb.matrix.copy(); h = M.to_translation()
    cur = (M.to_3x3() @ Vector((0, 1, 0))).normalized()
    q = cur.rotation_difference(Vector(new_dir).normalized())
    R = q.to_matrix()
    if roll_ref is not None:   # twist so that bone X axis is as close as possible to roll_ref (perp. to new_dir)
        nd = Vector(new_dir).normalized(); x = (R @ M.to_3x3() @ Vector((1, 0, 0)))
        ref = Vector(roll_ref) - nd * Vector(roll_ref).dot(nd)
        if ref.length > 1e-6:
            x = x - nd * x.dot(nd); ang = x.angle(ref) if x.length > 1e-6 else 0
            if x.cross(ref).dot(nd) < 0: ang = -ang
            R = Quaternion(nd, ang).to_matrix() @ R
    pb.matrix = Matrix.Translation(h) @ (R @ M.to_3x3()).to_4x4(); upd()

def arm_ik(arm, side, wrist, pole):
    """Place upperarm/forearm so the forearm tail lands on `wrist`; elbow bends toward `pole` (direction)."""
    ua, fa = f"upperarm_{side}", f"forearm_{side}"
    S = pos(arm, ua); L1 = arm.pose.bones[ua].length; L2 = arm.pose.bones[fa].length
    W = Vector(wrist); d = W - S; D = min(d.length, (L1 + L2) * 0.995); dn = d.normalized()
    a = (L1 * L1 + D * D - L2 * L2) / (2 * D); h = math.sqrt(max(L1 * L1 - a * a, 0))
    p = Vector(pole) - dn * Vector(pole).dot(dn); p = p.normalized() if p.length > 1e-6 else Vector((0, 1, 0))
    E = S + dn * a + p * h
    _swing(arm, ua, E - S)
    _swing(arm, fa, (S + dn * D) - E)

def spear_dir(arm):
    pb = arm.pose.bones["weapon_r"]; return (pb.matrix.to_3x3() @ Vector((0, 1, 0))).normalized()

def grip(arm): return arm.pose.bones["weapon_r"].head.copy()

def place_spear(arm, grip_target, direction, twist_ref=None, iters=4):
    """Right hand holds the spear at grip_target with the spear tip pointing along direction."""
    direction = Vector(direction).normalized()
    for _ in range(iters):
        # orient hand so spear axis matches direction
        hb = arm.pose.bones["hand_r"]
        q = spear_dir(arm).rotation_difference(direction)
        h = hb.matrix.to_translation()
        hb.matrix = Matrix.Translation(h) @ q.to_matrix().to_4x4() @ Matrix.Translation(-h) @ hb.matrix; upd()
        if twist_ref is not None:
            # twist about spear axis so the hand's X axis follows twist_ref
            x = hb.matrix.to_3x3() @ Vector((1, 0, 0)); x = x - direction * x.dot(direction)
            ref = Vector(twist_ref) - direction * Vector(twist_ref).dot(direction)
            if x.length > 1e-6 and ref.length > 1e-6:
                ang = x.angle(ref); ang = -ang if x.cross(ref).dot(direction) < 0 else ang
                g = grip(arm)
                hb.matrix = Matrix.Translation(g) @ Matrix.Rotation(ang, 4, direction) @ Matrix.Translation(-g) @ hb.matrix; upd()
        # move wrist so grip lands on target
        off = grip(arm) - pos(arm, "hand_r")
        wrist = Vector(grip_target) - off
        Hm = hb.matrix.to_3x3().copy()
        arm_ik(arm, "r", wrist, pole=Vector((-0.4, 0.6, -0.5)))
        hb = arm.pose.bones["hand_r"]
        hb.matrix = Matrix.Translation(pos(arm, "hand_r")) @ Hm.to_4x4(); upd()

def hand_l_to(arm, wrist, pole=(0.6, 0.5, -0.4), palm_dir=None):
    Hm = arm.pose.bones["hand_l"].matrix.to_3x3().copy()
    arm_ik(arm, "l", wrist, pole)
    if palm_dir is not None:
        _swing(arm, "hand_l", palm_dir)

def key_pose(arm, frame):
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
        pb.keyframe_insert("rotation_quaternion", frame=frame, group=pb.name)
        pb.keyframe_insert("location", frame=frame, group=pb.name)
        pb.keyframe_insert("scale", frame=frame, group=pb.name)

def new_action(arm, name):
    if name in bpy.data.actions: bpy.data.actions.remove(bpy.data.actions[name])
    a = bpy.data.actions.new(name); a.use_fake_user = True
    if arm.animation_data is None: arm.animation_data_create()
    arm.animation_data.action = a
    return a

def fix_quat_continuity(action):
    """Make consecutive quaternion keys take the short path."""
    by = {}
    for fc in action.fcurves:
        if fc.data_path.endswith("rotation_quaternion"): by.setdefault(fc.data_path, {})[fc.array_index] = fc
    for path, d in by.items():
        if len(d) < 4: continue
        n = len(d[0].keyframe_points); prev = None
        for i in range(n):
            q = Quaternion([d[j].keyframe_points[i].co[1] for j in range(4)])
            if prev is not None and q.dot(prev) < 0:
                for j in range(4): d[j].keyframe_points[i].co[1] *= -1
                q = -q
            prev = q
        for j in range(4): d[j].update()

def spear_colors(body):
    me = body.data; gi = {g.index: g.name for g in body.vertex_groups}
    ca = me.color_attributes.get("viz") or me.color_attributes.new("viz", 'FLOAT_COLOR', 'POINT')
    for v in me.vertices:
        w = sum(g.weight for g in v.groups if gi[g.group] == "weapon_r")
        c = Vector((0.8, 0.8, 0.82)) * (1 - w) + Vector((0.95, 0.65, 0.2)) * w
        ca.data[v.index].color = (*c, 1)
    me.color_attributes.active_color = ca

def render_frames(arm, body, frames, outdir, views, res=(480, 520)):
    """views: list of (name, cam_loc, target, ortho_scale)."""
    os.makedirs(outdir, exist_ok=True)
    sc = setup_scene(res); sc.display.shading.color_type = 'VERTEX'
    gmat = bpy.data.materials.get("ground") or bpy.data.materials.new("ground"); gmat.diffuse_color = (0.25, 0.27, 0.3, 1)
    if "Ground" not in bpy.data.objects:
        bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, -0.002)); g = bpy.context.object; g.name = "Ground"
        g.data.materials.append(gmat)
        g.data.color_attributes.new("viz", 'FLOAT_COLOR', 'POINT')
        for i in range(len(g.data.vertices)): g.data.color_attributes["viz"].data[i].color = (0.22, 0.24, 0.27, 1)
    cams = {n: cam_ortho("cam_" + n, a, b, s) for n, a, b, s in views}
    paths = []
    for f in frames:
        sc.frame_set(f)
        row = []
        for n in cams:
            p = f"{outdir}/{n}_{f:03d}.png"; render(cams[n], p); row.append(p)
        paths.append(row)
    return paths

def make_gif(paths, out, labels=None, title=None, ms=42):
    from PIL import Image, ImageDraw, ImageFont
    F = ImageFont.truetype(r"C:\Windows\Fonts\msjh.ttc", 20)
    frames = []
    for i, row in enumerate(paths):
        ims = [Image.open(p).convert("RGB") for p in row]
        w, h = ims[0].size; top = 34 if title else 0
        S = Image.new("RGB", (w * len(ims), h + top), (18, 18, 22)); d = ImageDraw.Draw(S)
        for j, im in enumerate(ims): S.paste(im, (j * w, top))
        if title: d.text((10, 6), title, font=F, fill=(255, 214, 140))
        if labels:
            for j, l in enumerate(labels): d.text((j * w + 10, top + 8), l, font=F, fill=(200, 220, 255))
        d.text((S.size[0] - 90, 6), f"f{i+1:02d}", font=F, fill=(150, 150, 150))
        frames.append(S.convert("P", palette=Image.ADAPTIVE, colors=128))
    frames[0].save(out, save_all=True, append_images=frames[1:], duration=ms, loop=0, optimize=True)

def rel(arm, bone, offset):
    """Point at `offset` (expressed in the rest-pose armature frame) carried along with bone's current rotation."""
    pb = arm.pose.bones[bone]; rest = arm.data.bones[bone].matrix_local.to_3x3()
    delta = pb.matrix.to_3x3() @ rest.inverted()
    return pb.head.copy() + delta @ Vector(offset)

def rel_dir(arm, bone, d):
    pb = arm.pose.bones[bone]; rest = arm.data.bones[bone].matrix_local.to_3x3()
    return (pb.matrix.to_3x3() @ rest.inverted() @ Vector(d)).normalized()

def head_look(arm, target_dir, weight=1.0, bone="upper_head"):
    """Turn the head so its face (rest forward = -Y) points along target_dir (world)."""
    from mathutils import Quaternion
    pb = arm.pose.bones[bone]; rest = arm.data.bones[bone].matrix_local.to_3x3()
    face = (pb.matrix.to_3x3() @ rest.inverted() @ Vector((0, -1, 0))).normalized()
    q = Quaternion().slerp(face.rotation_difference(Vector(target_dir).normalized()), weight)
    h = pb.matrix.to_translation()
    pb.matrix = Matrix.Translation(h) @ q.to_matrix().to_4x4() @ Matrix.Translation(-h) @ pb.matrix; upd()
