"""Attack_Thrust 長槍直刺 (full body): horse sits back while the torso coils right and the spear is drawn
to the right hip, then the whole body lunges — right foreleg steps in, hind legs drive, torso unwinds left
and the spear (held at its rear third) drives forward 30° downward."""
import bpy, sys, os, math
D = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, D)
from posekit import *
from legkit import add_leg_ik, key_target, bake_visual, clip_report, clip_now
import ready as RD
import spearpath as SPP
from mathutils import Vector
args = sys.argv[sys.argv.index("--") + 1:]
SRC, DST, GO = args[0], args[1], len(args) > 2
bpy.ops.wm.open_mainfile(filepath=SRC)
arm, body = objs()
act = new_action(arm, "Attack_Thrust")
reset_pose(arm)
PIV = Vector((0.12, 0.0, 0.70))
ik = add_leg_ik(arm)
N = lambda *v: Vector(v).normalized()
DOWN30 = N(0.0, -math.cos(math.radians(30)), -math.sin(math.radians(30)))
AIM = N(0.11, -math.cos(math.radians(30)), -math.sin(math.radians(30)))   # tip angled in, butt clears the shoulder

def horse(dy=0, dz=0, pitch=0, yaw=0, roll=0):
    rot(arm, "root", (1, 0, 0), pitch, pivot=PIV); rot(arm, "root", (0, 0, 1), yaw, pivot=PIV)
    rot(arm, "root", (0, 1, 0), roll, pivot=PIV); move(arm, "root", (0, dy, dz))

def torso(tw, tc, lw, lc, ht=0, hl=0):
    rot(arm, "upper_waist", (0, 0, 1), tw); rot(arm, "upper_waist", (1, 0, 0), lw)
    rot(arm, "upper_chest", (0, 0, 1), tc); rot(arm, "upper_chest", (1, 0, 0), lc)
    rot(arm, "upper_head", (0, 0, 1), ht); rot(arm, "upper_head", (1, 0, 0), hl)

def P_rest():
    reset_pose(arm); RD.pose_ready(arm)

CO = dict(dx=-0.31, ax=0.14, az=-0.05)
def P_coil(k):
    reset_pose(arm)
    horse(dy=0.07 * k, dz=-0.045 * k, pitch=-3 * k, yaw=-5 * k)
    torso(-14 * k, -20 * k, -4 * k, -8 * k, ht=26 * k, hl=4 * k)
    S = pos(arm, "upperarm_r")
    d = N(CO["ax"], -0.94, CO["az"])
    place_spear(arm, S + Vector((CO["dx"], 0.12 * k - 0.06 * (1 - k), -0.21)), d, twist_ref=Vector((0, 0, -1)))
    hand_l_to(arm, rel(arm, "upper_chest", (0.10, -0.30 * k - 0.05, 0.02)), pole=rel_dir(arm, "upper_chest", (0.8, 0.2, -0.5)))

def P_thrust(k):
    reset_pose(arm)
    horse(dy=-0.10 * k, dz=-0.05 * k, pitch=5 * k, yaw=4 * k)
    torso(10 * k, 16 * k, 8 * k, 14 * k, ht=-22 * k, hl=-10 * k)
    S = pos(arm, "upperarm_r")
    aim = N(TH["ax"], -math.cos(math.radians(30)), -math.sin(math.radians(30)))
    place_spear(arm, S + DOWN30 * (TH["reach"] + 0.06 * k) + Vector((TH["dx"], 0, TH["dz"])), aim, twist_ref=Vector((0, 0, -1)))
    hand_l_to(arm, rel(arm, "upper_chest", (0.22, 0.14, -0.24)), pole=rel_dir(arm, "upper_chest", (0.7, -0.2, -0.6)))

TH = dict(dx=-0.12, ax=0.10, dz=-0.36, reach=0.33)
if os.environ.get("SEARCHCOIL"):
    res = []
    for dx in (-0.19, -0.25, -0.31):
        for ax in (0.14, 0.25, 0.36):
            for az in (-0.36, -0.20, -0.05):
                CO.update(dx=dx, ax=ax, az=az); P_coil(1.08); c1 = clip_now(arm, body); w = clip_now.who
                res.append((c1, dx, ax, az, w))
    res.sort(reverse=True)
    for r in res[:4]: print("COIL clear %.3f dx %.2f ax %.2f az %.2f near %s" % r)
    raise SystemExit
if os.environ.get("SEARCH"):
    best = []
    for dx in (-0.06, -0.12, -0.18, -0.24):
        for ax in (0.10, 0.20, 0.30):
            for dz in (-0.20, -0.28, -0.36):
                TH.update(dx=dx, ax=ax, dz=dz)
                P_thrust(1.06); d1 = clip_now(arm, body); w1 = clip_now.who; P_thrust(0.75); d2 = clip_now(arm, body); w2 = clip_now.who
                best.append((min(d1, d2), dx, ax, dz, w1 if d1 < d2 else w2))
    best.sort(reverse=True)
    for b in best[:6]: print("SEARCH clear %.3f dx %.2f ax %.2f dz %.2f near %s" % b)
    raise SystemExit

def P_recover():
    reset_pose(arm)
    horse(dy=-0.04, dz=-0.02, pitch=2, yaw=2)
    torso(2, 4, 3, 5, ht=-6, hl=-3)
    S = pos(arm, "upperarm_r")
    place_spear(arm, S + Vector((-0.18, -0.16, -0.24)), N(0.14, -0.90, -0.42), twist_ref=Vector((0, 0, -1)))
    hand_l_to(arm, rel(arm, "upper_chest", (0.20, 0.0, -0.24)), pole=rel_dir(arm, "upper_chest", (0.8, 0.0, -0.5)))

KEYS = [(1, P_rest), (7, lambda: P_coil(0.7)), (11, lambda: P_coil(1.0)), (13, lambda: P_coil(1.08)),
        (15, lambda: P_thrust(0.75)), (17, lambda: P_thrust(1.0)), (21, lambda: P_thrust(1.06)),
        (26, P_recover), (36, P_rest)]
REC = {}
for f, fn in KEYS:
    fn(); key_pose(arm, f); REC[f] = SPP.record(arm)
# right foreleg steps in with the lunge and back out on recovery
for f, off, tr in [(1, (0, 0, 0), 0), (13, (0, 0, 0), 0), (14.5, (0, -0.07, 0.08), 25), (16, (0, -0.15, 0), 0),
                   (26, (0, -0.15, 0), 0), (29, (0, -0.08, 0.07), 25), (32, (0, 0, 0), 0), (36, (0, 0, 0), 0)]:
    key_target(ik, "FR", f, off, tr)
fix_quat_continuity(act)
bake_visual(arm, 1, 36, act)
SPP.apply_path(arm, body, REC, 1, 36)
fix_quat_continuity(act)
act.frame_range = (1, 36); act.use_frame_range = True
bpy.context.scene.frame_start, bpy.context.scene.frame_end = 1, 36
bpy.ops.wm.save_as_mainfile(filepath=DST)
clip_report(arm, body, range(1, 37), "Attack_Thrust")
if GO:
    spear_colors(body)
    views = [("q34", (-3.4, -4.4, 1.6), (0.1, -0.45, 0.85), 2.7), ("side", (-6, -0.5, 0.9), (0, -0.5, 0.9), 2.7)]
    render_frames(arm, body, range(1, 37), D + "/frames_thrust", views)
