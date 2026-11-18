"""Add upper-body motion to Walk / Run: torso steadied against the horse back, gait-synced twist,
left arm swing, right hand carrying the spear tilted forward with a light sway."""
import bpy, sys, os, math
D = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, D)
from posekit import *
import ready as RD
from mathutils import Vector, Matrix, Quaternion
args = sys.argv[sys.argv.index("--") + 1:]
SRC, DST, GO = args[0], args[1], len(args) > 2
bpy.ops.wm.open_mainfile(filepath=SRC)
arm, body = objs(); ad = arm.animation_data
for t in ad.nla_tracks: t.mute = True
UPPER = ["upper_waist", "upper_chest", "upper_neck", "upper_head", "clavicle_r", "upperarm_r", "forearm_r", "hand_r",
         "weapon_r", "clavicle_l", "upperarm_l", "forearm_l", "hand_l"]
REST = {n: arm.data.bones[n].matrix_local.copy() for n in arm.data.bones.keys()}
GRIP_OFF = REST["weapon_r"].translation - REST["upper_chest"].translation

CFG = {  # peak = frame where the right foreleg reaches furthest forward
    "Walk": dict(peak=10.8, steady=0.6, twist=4.0, bob_lean=2.0, arm_a=14, elbow=15, elbow_fwd=10, tilt=22, sway=2.5, grip_bob=0.012),
    "Run":  dict(peak=6.8,  steady=0.6, twist=6.0, bob_lean=4.0, arm_a=26, elbow=32, elbow_fwd=18, tilt=28, sway=4.0, grip_bob=0.02),
}

def rot_q(name, q):
    pb = arm.pose.bones[name]; h = pb.matrix.to_translation()
    pb.matrix = Matrix.Translation(h) @ q.to_matrix().to_4x4() @ Matrix.Translation(-h) @ pb.matrix; upd()

for name, c in CFG.items():
    act = bpy.data.actions[name]; ad.action = act; reset_pose(arm)
    times = sorted({round(k.co[0], 4) for fc in act.fcurves for k in fc.keyframe_points
                    if not any(f'"{u}"' in fc.data_path for u in UPPER)})
    t0, t1 = times[0], times[-1]
    step = sorted(b - a for a, b in zip(times, times[1:]))[len(times) // 2]
    T = t1 - t0 + step      # the source gait wraps last -> first as one ordinary step
    for fc in list(act.fcurves):
        if any(f'pose.bones["{u}"]' in fc.data_path for u in UPPER): act.fcurves.remove(fc)
    for t in times:
        bpy.context.scene.frame_set(int(t), subframe=t - int(t))
        for u in UPPER: arm.pose.bones[u].matrix_basis.identity()
        upd()
        ph = 2 * math.pi * (t - c["peak"]) / T
        cs, sn = math.cos(ph), math.sin(ph)
        # 1) steady the human torso against the horse back's rotation
        s3 = arm.pose.bones["spine_3"]
        dq = (s3.matrix.to_3x3() @ REST["spine_3"].to_3x3().inverted()).to_quaternion()
        rot_q("upper_waist", Quaternion().slerp(dq.inverted(), c["steady"]))
        # 2) gait-synced twist (left arm forward -> shoulders turn right) and a small breathing lean
        rot(arm, "upper_waist", (0, 0, 1), -0.4 * c["twist"] * cs)
        rot(arm, "upper_chest", (0, 0, 1), -0.6 * c["twist"] * cs)
        rot(arm, "upper_chest", (1, 0, 0), c["bob_lean"] * 0.5 * (1 + math.cos(2 * ph)) * 0.5)
        rot(arm, "upper_head", (0, 0, 1), 0.8 * c["twist"] * cs)                  # head keeps facing forward
        hq = (arm.pose.bones["upper_head"].matrix.to_3x3() @ REST["upper_head"].to_3x3().inverted()).to_quaternion()
        rot_q("upper_head", Quaternion().slerp(hq.inverted(), 0.35))              # extra head stabilisation
        rot(arm, "upper_head", (0, 0, 1), 0.8 * c["twist"] * cs)
        # 3) left arm swing (forward when the right foreleg is forward)
        rot(arm, "upperarm_l", (1, 0, 0), -c["arm_a"] * cs)
        rot(arm, "forearm_l", (1, 0, 0), -(c["elbow"] + c["elbow_fwd"] * max(0.0, cs)))
        # 4) right hand: the shared combat-ready carry (rear-third grip, tip forward-down), swaying with the stride
        RD.pose_ready(arm, grip_extra=(0, -c["grip_bob"] * cs, 0.5 * c["grip_bob"] * sn), left=False)
        place_spear(arm, RD.ready_grip(arm, (0, -c["grip_bob"] * cs, 0.5 * c["grip_bob"] * sn)),
                    RD.ready_dir(tilt=c["tilt"], sway=c["sway"] * cs), twist_ref=Vector((0, 0, -1)))
        for u in UPPER:
            pb = arm.pose.bones[u]; pb.rotation_mode = 'QUATERNION'
            for path in ("rotation_quaternion", "location", "scale"):
                pb.keyframe_insert(path, frame=t, group=u)
    fix_quat_continuity(act)
    print(name, "keyed", len(times), "samples over", round(T, 2), "frames")
bpy.ops.wm.save_as_mainfile(filepath=DST)
if GO:
    spear_colors(body)
    for name in CFG:
        act = bpy.data.actions[name]; ad.action = act
        f0, f1 = int(math.ceil(act.frame_range[0])), int(act.frame_range[1])
        views = [("side", (-6, -0.1, 0.9), (0, -0.1, 0.9), 2.4), ("q34", (-3.4, -4.4, 1.6), (0.15, -0.2, 0.85), 2.4)]
        render_frames(arm, body, range(f0, f1 + 1), D + "/frames_" + name.lower(), views)
