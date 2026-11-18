"""Attack_Slash 長槍揮砍 (full body): from the ready carry the horse rocks back and turns left while the
torso winds left and the spear is raised to the upper left; then the whole body drives forward-right —
left foreleg steps in, hindquarters push — and the spear cleaves diagonally down to the right-back."""
import bpy, sys, os, math, itertools
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
act = new_action(arm, "Attack_Slash")
reset_pose(arm)
PIV = Vector((0.12, 0.0, 0.70))
ik = add_leg_ik(arm)
N = lambda *v: Vector(v).normalized()

def horse(dy=0, dz=0, pitch=0, yaw=0, roll=0):
    rot(arm, "root", (1, 0, 0), pitch, pivot=PIV); rot(arm, "root", (0, 0, 1), yaw, pivot=PIV)
    rot(arm, "root", (0, 1, 0), roll, pivot=PIV); move(arm, "root", (0, dy, dz))

def torso(tw, tc, lw, lc, side=0, ht=0, hl=0):
    rot(arm, "upper_waist", (0, 0, 1), tw); rot(arm, "upper_waist", (1, 0, 0), lw)
    rot(arm, "upper_chest", (0, 0, 1), tc); rot(arm, "upper_chest", (1, 0, 0), lc); rot(arm, "upper_chest", (0, 1, 0), side)
    rot(arm, "upper_head", (0, 0, 1), ht); rot(arm, "upper_head", (1, 0, 0), hl)

# spear placements expressed in the chest frame (offset from the chest head, direction)
WU = dict(g=(0.26, -0.16, 0.34), d=(0.40, 0.35, 0.80))     # wind-up: hand high over the left shoulder
MD = dict(g=(-0.24, -0.34, 0.14), d=(0.30, -0.85, -0.70))  # mid-swing: in front, sweeping down-right
EN = dict(g=(-0.24, -0.18, -0.20), d=(-0.50, 0.55, -0.66))  # end: right hip, spear down to the right-back
T1 = dict(g=(-0.34, -0.26, 0.04), d=(0.35, -0.45, 0.88))   # lift: spear raised upright on the right-front
R1 = dict(g=(-0.26, -0.10, -0.18), d=(-0.50, 0.62, -0.37))  # recover: tip swung up to horizontal behind-right
R2 = dict(g=(-0.38, -0.16, -0.20), d=(-1.10, -0.45, -0.18)) # recover: tip sweeping round the outside to the front

def spear_at(P, k=1.0):
    place_spear(arm, rel(arm, "upper_chest", Vector(P["g"]) * k), rel_dir(arm, "upper_chest", P["d"]), twist_ref=Vector((0, 0, 1)))

def P_ready(): reset_pose(arm); RD.pose_ready(arm)

def P_wind(k):
    reset_pose(arm)
    horse(dy=0.05 * k, dz=-0.03 * k, pitch=-5 * k, yaw=8 * k, roll=2 * k)
    torso(14 * k, 21 * k, -4 * k, -9 * k, side=-6 * k, ht=-24 * k, hl=4 * k)
    spear_at(WU)
    hand_l_to(arm, rel(arm, "upper_chest", (0.30, 0.06, -0.20)), pole=rel_dir(arm, "upper_chest", (0.6, 0.5, -0.4)))

def P_lift():
    reset_pose(arm)
    horse(dy=0.02, dz=-0.01, pitch=-2, yaw=3)
    torso(5, 7, -1, -3, ht=-8)
    spear_at(T1)
    hand_l_to(arm, rel(arm, "upper_chest", (0.28, 0.0, -0.22)), pole=rel_dir(arm, "upper_chest", (0.7, 0.4, -0.4)))

def P_rec(P, k):
    reset_pose(arm)
    horse(dy=-0.09 * k, dz=-0.05 * k, pitch=6 * k, yaw=-10 * k, roll=-4 * k)
    torso(-14 * k, -22 * k, 6 * k, 14 * k, side=6 * k, ht=22 * k, hl=-8 * k)
    spear_at(P)
    hand_l_to(arm, rel(arm, "upper_chest", (0.26, -0.16, -0.16)), pole=rel_dir(arm, "upper_chest", (0.8, 0.3, -0.3)))

def P_mid():
    reset_pose(arm)
    horse(dy=-0.03, dz=-0.03, pitch=2, yaw=0, roll=-1)
    torso(0, 0, 4, 8, ht=0, hl=-4)
    spear_at(MD)
    hand_l_to(arm, rel(arm, "upper_chest", (0.30, -0.10, -0.20)), pole=rel_dir(arm, "upper_chest", (0.8, 0.2, -0.4)))

def P_end(k):
    reset_pose(arm)
    horse(dy=-0.09 * k, dz=-0.05 * k, pitch=6 * k, yaw=-10 * k, roll=-4 * k)
    torso(-14 * k, -22 * k, 6 * k, 14 * k, side=6 * k, ht=22 * k, hl=-8 * k)
    spear_at(EN)
    hand_l_to(arm, rel(arm, "upper_chest", (0.26, -0.24, -0.08)), pole=rel_dir(arm, "upper_chest", (0.8, 0.3, -0.3)))

if os.environ.get("SEARCH"):
    G = lambda v, dv: (v - dv, v, v + dv)
    jobs = [("MD", MD, P_mid), ("T1", T1, P_lift), ("R1", R1, lambda: P_rec(R1, 0.7)), ("R2", R2, lambda: P_rec(R2, 0.35))]
    for label, P, fn in jobs:
        g0, d0 = P["g"], P["d"]; res = []
        for gx, gz, dx, dz in itertools.product(G(g0[0], 0.07), G(g0[2], 0.08), G(d0[0], 0.25), G(d0[2], 0.25)):
            P["g"] = (gx, g0[1], gz); P["d"] = (dx, d0[1], dz); fn()
            g = grip(arm); d = spear_dir(arm)
            lowest = min((g + d * 1.13).z, (g - d * 0.57).z)
            res.append((clip_now(arm, body) if lowest > 0.05 else -1, P["g"], P["d"]))
        res.sort(key=lambda r: -r[0])
        print("SEARCH", label, "clear %.3f" % res[0][0], "g", tuple(round(x, 2) for x in res[0][1]), "d", tuple(round(x, 2) for x in res[0][2]))
        P["g"], P["d"] = res[0][1], res[0][2]
    raise SystemExit

KEYS = [(1, P_ready), (4, P_lift), (8, lambda: P_wind(0.8)), (11, lambda: P_wind(1.0)), (13, lambda: P_wind(1.06)),
        (15, P_mid), (17, lambda: P_end(1.0)), (21, lambda: P_end(1.06)), (26, lambda: P_rec(R1, 0.7)),
        (31, lambda: P_rec(R2, 0.35)), (36, P_ready)]
REC = {}
for f, fn in KEYS:
    fn(); key_pose(arm, f); REC[f] = SPP.record(arm)
# left foreleg steps forward-right into the cut, then back
for f, off, tr in [(1, (0, 0, 0), 0), (13, (0, 0, 0), 0), (14.5, (-0.02, -0.06, 0.08), 25), (16.5, (-0.04, -0.13, 0), 0),
                   (26, (-0.04, -0.13, 0), 0), (29, (-0.02, -0.06, 0.07), 25), (32, (0, 0, 0), 0), (36, (0, 0, 0), 0)]:
    key_target(ik, "FL", f, off, tr)
fix_quat_continuity(act)
bake_visual(arm, 1, 36, act)
SPP.apply_path(arm, body, REC, 1, 36, twist_ref=Vector((0, 0, 1)))
fix_quat_continuity(act)
act.frame_range = (1, 36); act.use_frame_range = True
bpy.context.scene.frame_start, bpy.context.scene.frame_end = 1, 36
bpy.ops.wm.save_as_mainfile(filepath=DST)
clip_report(arm, body, range(1, 37), "Attack_Slash")
if GO:
    spear_colors(body)
    views = [("front", (0.1, -6, 1.0), (0.1, 0, 1.0), 2.8), ("q34", (-3.4, -4.4, 1.6), (0.1, -0.35, 0.95), 2.8)]
    render_frames(arm, body, range(1, 37), D + "/frames_slash", views)
