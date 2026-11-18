"""Attack_Power 奮力一擊 (full body): from the ready carry the centaur crouches and rears, torso thrown back,
spear cocked high (held at its rear third), left hand bent before the chest, forelegs paw the air three times;
then it slams down — forelegs land and buckle to absorb, hindquarters drive — and the torso whips forward
into a violent downward thrust, before settling back to the ready carry."""
import bpy, sys, os, math
D = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, D)
from posekit import *
from legkit import add_leg_ik, key_target, key_influence, bake_visual, clip_report
import ready as RD
import spearpath as SPP
from mathutils import Vector
args = sys.argv[sys.argv.index("--") + 1:]
SRC, DST, GO = args[0], args[1], len(args) > 2
bpy.ops.wm.open_mainfile(filepath=SRC)
arm, body = objs()
act = new_action(arm, "Attack_Power")
N = lambda *v: Vector(v).normalized()
reset_pose(arm)
HIP = (pos(arm, "back_leg_upper_l") + pos(arm, "back_leg_upper_r")) / 2
ik = add_leg_ik(arm)
TW = Vector((0, 0, -1))

def body_pitch(deg, crouch=0.0, fwd=0.0):
    rot(arm, "root", (1, 0, 0), deg, pivot=HIP); move(arm, "root", (0, fwd, -crouch))

def torso(lean_w=0, lean_c=0, turn_w=0, turn_c=0, head_lean=0, head_turn=0):
    rot(arm, "upper_waist", (1, 0, 0), lean_w); rot(arm, "upper_waist", (0, 0, 1), turn_w)
    rot(arm, "upper_chest", (1, 0, 0), lean_c); rot(arm, "upper_chest", (0, 0, 1), turn_c)
    rot(arm, "upper_head", (1, 0, 0), head_lean); rot(arm, "upper_head", (0, 0, 1), head_turn)

def front_leg(s, humerus, forearm, knee, ankle=0):
    rot(arm, f"front_humerus_{s}", (1, 0, 0), humerus); rot(arm, f"front_leg_upper_{s}", (1, 0, 0), forearm)
    rot(arm, f"front_leg_lower_{s}", (1, 0, 0), knee); rot(arm, f"front_leg_ankle_{s}", (1, 0, 0), ankle)

FOLD = (-35, -55, 105, 25); KICK = (-55, -60, 15, 5)
MID = tuple((a + b) / 2 for a, b in zip(FOLD, KICK))
def legs(l, r): front_leg("l", *l); front_leg("r", *r)

def cocked(extra=0.0):
    G = rel(arm, "upper_chest", (-0.30, 0.08 + 0.03 * extra, 0.30 + 0.03 * extra))
    place_spear(arm, G, N(-0.20, -0.80, -0.42), twist_ref=TW)   # aimed forward-down at the target, in world space
    hand_l_to(arm, rel(arm, "upper_chest", (0.03, -0.21, -0.05)), pole=rel_dir(arm, "upper_chest", (0.8, 0.1, -0.5)))

def P_ready(): reset_pose(arm); RD.pose_ready(arm)

def P_crouch():          # gather before the rear: sit back, head down, spear drawn up
    reset_pose(arm); body_pitch(4, 0.07, fwd=0.04); torso(6, 8, head_lean=-6)
    legs((-6, -8, 20, 6), (-6, -8, 20, 6))
    G = rel(arm, "upper_chest", (-0.30, -0.02, 0.12))
    place_spear(arm, G, rel_dir(arm, "upper_chest", (-0.15, -0.85, -0.20)), twist_ref=TW)
    hand_l_to(arm, rel(arm, "upper_chest", (0.06, -0.22, -0.08)), pole=rel_dir(arm, "upper_chest", (0.8, 0.1, -0.5)))

GAZE = N(0, -1.0, -0.18)       # eyes on the enemy ahead, slightly below the horizon
def P_rise(k):
    reset_pose(arm); body_pitch(-30 * k, 0.09 * k); torso(-5 * k, -8 * k)
    rot(arm, "upper_neck", (1, 0, 0), 12 * k); head_look(arm, GAZE, weight=k)
    legs(tuple(x * k for x in FOLD), tuple(x * k for x in FOLD)); cocked()

def P_air(a, l, r, extra=0.0):
    reset_pose(arm); body_pitch(-a, 0.09); torso(-6 - 2 * extra, -10 - 3 * extra)
    rot(arm, "upper_neck", (1, 0, 0), 14); head_look(arm, GAZE)
    legs(l, r); cocked(extra)

DOWN = N(0.0, -math.cos(math.radians(40)), -math.sin(math.radians(40)))
AIM = N(0.18, -math.cos(math.radians(40)), -math.sin(math.radians(40)))
def P_strike(k=1.0):
    reset_pose(arm); body_pitch(4 * k, 0.05 * k, fwd=-0.06 * k)
    torso(10 * k, 18 * k, turn_c=8 * k)
    head_look(arm, N(0, -1.0, -0.45))
    S = pos(arm, "upperarm_r")
    place_spear(arm, S + DOWN * (0.36 + 0.06 * k) + Vector((-0.18, 0, -0.02)), AIM, twist_ref=TW)
    hand_l_to(arm, rel(arm, "upper_chest", (0.26, 0.04, -0.16)), pole=rel_dir(arm, "upper_chest", (0.8, 0.3, -0.4)))

KEYS = [(1, P_ready), (5, P_crouch), (10, lambda: P_rise(0.7)), (13, lambda: P_rise(1.0)),
        (17, lambda: P_air(32, KICK, FOLD)), (21, lambda: P_air(31, FOLD, KICK)),
        (25, lambda: P_air(34, MID, FOLD, 0.6)), (29, lambda: P_air(37, FOLD, FOLD, 1.0)),
        (33, lambda: P_strike(1.0)), (36, lambda: P_strike(1.1)), (44, lambda: P_strike(0.45)), (54, P_ready)]
REC = {}
for f, fn in KEYS:
    fn(); key_pose(arm, f); REC[f] = SPP.record(arm)
# forelegs: planted -> free (FK paws) while reared -> land ahead and buckle -> step back
for leg in ("FL", "FR"):
    key_influence(ik, leg, 1, 1.0); key_influence(ik, leg, 6, 1.0); key_influence(ik, leg, 10, 0.0)
    key_influence(ik, leg, 30, 0.0); key_influence(ik, leg, 33, 1.0); key_influence(ik, leg, 54, 1.0)
for leg, side in (("FL", 1), ("FR", -1)):
    for f, off, tr in [(1, (0, 0, 0), 0), (30, (0, -0.10, 0), 0), (44, (0, -0.10, 0), 0),
                       (47 + (side > 0) * 2, (0, -0.05, 0.07), 25), (50 + (side > 0) * 2, (0, 0, 0), 0), (54, (0, 0, 0), 0)]:
        key_target(ik, leg, f, off, tr)
fix_quat_continuity(act)
bake_visual(arm, 1, 54, act)
SPP.apply_path(arm, body, REC, 1, 54, twist_ref=TW)
fix_quat_continuity(act)
act.frame_range = (1, 54); act.use_frame_range = True
bpy.context.scene.frame_start, bpy.context.scene.frame_end = 1, 54
bpy.ops.wm.save_as_mainfile(filepath=DST)
clip_report(arm, body, range(1, 55), "Attack_Power")
if GO:
    spear_colors(body)
    views = [("side", (-6, -0.3, 1.0), (0, -0.3, 1.0), 2.9), ("q34", (-3.4, -4.4, 1.6), (0.1, -0.3, 1.0), 2.9)]
    render_frames(arm, body, range(1, 55), D + "/frames_power", views)
