"""Death 死亡: rear up like the power strike, arms flung open and thrashing, then collapse onto the left side."""
import bpy, sys, os, math
D = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, D)
from posekit import *
from rearkit import add_hind_ik, bake_visual
import ready as RD
import spearpath as SPP
from legkit import clip_report
from mathutils import Vector, Matrix
args = sys.argv[sys.argv.index("--") + 1:]
SRC, DST, GO = args[0], args[1], len(args) > 2
bpy.ops.wm.open_mainfile(filepath=SRC)
arm, body = objs()
act = new_action(arm, "Death")
N = lambda *v: Vector(v).normalized()
reset_pose(arm)
HIP = (pos(arm, "back_leg_upper_l") + pos(arm, "back_leg_upper_r")) / 2
LEFT_GROUND = Vector((0.27, 0.0, 0.0))          # roll pivot: the left hooves' line
gi = {g.index: g.name for g in body.vertex_groups}
SPEAR = {v.index for v in body.data.vertices if any(gi[g.group] == "weapon_r" and g.weight > 0.5 for g in v.groups)}
ik = add_hind_ik(arm)
ik_cons = [arm.pose.bones[f"back_leg_ankle_{s}"].constraints[0] for s in ("l", "r")] + \
          [arm.pose.bones[f"back_leg_foot_{s}"].constraints[0] for s in ("l", "r")]

def min_z(skip_spear=True, only_spear=False):
    dg = bpy.context.evaluated_depsgraph_get(); e = body.evaluated_get(dg); m = e.to_mesh()
    mw = body.matrix_world; z = 9
    for v in m.vertices:
        sp = v.index in SPEAR
        if (only_spear and not sp) or (skip_spear and sp and not only_spear): continue
        z = min(z, (mw @ v.co).z)
    e.to_mesh_clear(); return z

def body_pitch(deg, crouch=0.0):
    rot(arm, "root", (1, 0, 0), deg, pivot=HIP); move(arm, "root", (0, 0, -crouch))

def torso(lean_w=0, lean_c=0, side_w=0, side_c=0, turn_c=0, head_lean=0, head_turn=0, head_side=0):
    rot(arm, "upper_waist", (1, 0, 0), lean_w); rot(arm, "upper_waist", (0, 1, 0), side_w)
    rot(arm, "upper_chest", (1, 0, 0), lean_c); rot(arm, "upper_chest", (0, 1, 0), side_c); rot(arm, "upper_chest", (0, 0, 1), turn_c)
    rot(arm, "upper_head", (1, 0, 0), head_lean); rot(arm, "upper_head", (0, 0, 1), head_turn); rot(arm, "upper_head", (0, 1, 0), head_side)

def front_leg(s, humerus, forearm, knee, ankle=0):
    rot(arm, f"front_humerus_{s}", (1, 0, 0), humerus); rot(arm, f"front_leg_upper_{s}", (1, 0, 0), forearm)
    rot(arm, f"front_leg_lower_{s}", (1, 0, 0), knee); rot(arm, f"front_leg_ankle_{s}", (1, 0, 0), ankle)

FOLD = (-35, -55, 105, 25); KICK = (-50, -55, 30, 10); LIMP = (-15, -20, 60, 20)

def arms_open(phase):
    """phase 0..1 cycles the thrash: right arm (with spear) and left arm swing wide and high."""
    a = math.sin(phase * 2 * math.pi)
    G = rel(arm, "upper_chest", (-0.42, -0.02 + 0.10 * a, 0.16 + 0.12 * a))
    place_spear(arm, G, rel_dir(arm, "upper_chest", (-0.55, -0.25 - 0.35 * a, 0.75 - 0.2 * a)), twist_ref=Vector((0, 0, 1)))
    hand_l_to(arm, rel(arm, "upper_chest", (0.44, -0.04 - 0.10 * a, 0.20 - 0.14 * a)), pole=rel_dir(arm, "upper_chest", (0.3, 0.6, -0.6)))

def P_rest():
    reset_pose(arm); RD.pose_ready(arm)

def P_rise(k):
    reset_pose(arm); body_pitch(-28 * k, 0.07 * k); torso(-5 * k, -8 * k, head_lean=12 * k)
    front_leg("l", *[x * k for x in FOLD]); front_leg("r", *[x * k for x in FOLD]); arms_open(0.25 * k)

def P_thrash(a, ph, l, r, ht):
    reset_pose(arm); body_pitch(-a, 0.07); torso(-7, -12, side_c=6 * math.sin(ph * 6.28), head_lean=18, head_turn=ht)
    front_leg("l", *l); front_leg("r", *r); arms_open(ph)

def P_drop():
    reset_pose(arm); body_pitch(3, 0.06); torso(6, 10, side_w=4, side_c=6, head_lean=-18, head_side=10)
    front_leg("l", -12, -10, 30, 8); front_leg("r", -8, -6, 22, 6)
    S = pos(arm, "upperarm_r")
    place_spear(arm, S + Vector((-0.12, -0.12, -0.30)), N(-0.3, -0.6, -0.75), twist_ref=Vector((-1, 0, 0)))
    hand_l_to(arm, rel(arm, "upper_chest", (0.30, -0.05, -0.20)), pole=(0.8, 0.3, -0.4))
    ground_fix()

UPPER_BONES = ("upper_", "clavicle_", "upperarm_", "forearm_", "hand_")
UPPER_V = {v.index for v in body.data.vertices
           if v.groups and gi[max(v.groups, key=lambda g: g.weight).group].startswith(UPPER_BONES)}
def _dom(v): return gi[max(v.groups, key=lambda g: g.weight).group] if v.groups else ""
HEAD_V = {v.index for v in body.data.vertices if _dom(v) in ("upper_head", "upper_neck")}
ARML_V = {v.index for v in body.data.vertices if _dom(v) in ("upperarm_l", "forearm_l", "hand_l")}
TORSO_V = UPPER_V - HEAD_V - ARML_V

def zmin(sel):
    dg = bpy.context.evaluated_depsgraph_get(); e = body.evaluated_get(dg); m = e.to_mesh()
    mw = body.matrix_world; z = 9
    for v in m.vertices:
        if sel(v.index): z = min(z, (mw @ v.co).z)
    e.to_mesh_clear(); return z

def hind_leg(s, upper, lower, ankle):
    rot(arm, f"back_leg_upper_{s}", (1, 0, 0), upper); rot(arm, f"back_leg_lower_{s}", (1, 0, 0), lower)
    rot(arm, f"back_leg_ankle_{s}", (1, 0, 0), ankle)

def P_collapse(pitch, crouch, roll, fl, fr, hl, hr, tor, head, tail=0, spear="hold", larm=(0.30, -0.05, -0.20)):
    """Whole-body collapse pose. Legs/torso are posed in the upright body frame first; the body is then rolled
    onto its left side about the barrel's lower-left edge, the horse is grounded on its own lowest point and the
    human torso is kept from sinking into the floor separately (so the horse never floats to make room for it)."""
    reset_pose(arm)
    body_pitch(pitch, crouch)
    lw, lc, sw, sc = tor
    torso(lw, lc, side_w=sw, side_c=sc, head_lean=head[0], head_side=head[1], head_turn=head[2] if len(head) > 2 else 0)
    front_leg("l", *fl); front_leg("r", *fr); hind_leg("l", *hl); hind_leg("r", *hr)
    rot(arm, "tail_1", (1, 0, 0), tail); rot(arm, "tail_2", (1, 0, 0), tail * 0.7)
    if spear == "hold":
        S = pos(arm, "upperarm_r")
        place_spear(arm, S + Vector((-0.14, -0.14, -0.28)), N(-0.35, -0.65, -0.6), twist_ref=Vector((-1, 0, 0)))
    bar = pos(arm, "spine_2")
    rot(arm, "root", (0, 1, 0), roll, pivot=Vector((bar.x + 0.20, bar.y, max(0.0, bar.z - 0.32))))
    hand_l_to(arm, rel(arm, "upper_chest", larm), pole=rel_dir(arm, "upper_chest", (0.8, 0.3, -0.4)))
    # ground the horse on its own lowest point
    move(arm, "root", (0, 0, -zmin(lambda i: i not in SPEAR and i not in UPPER_V)))
    # keep the rider out of the floor, part by part: torso (waist), then head, then the trapped left arm
    for _ in range(15):
        if zmin(lambda i: i in TORSO_V) >= 0.0: break
        rot(arm, "upper_waist", (0, 1, 0), -3.0)
    for _ in range(15):
        if zmin(lambda i: i in HEAD_V) >= 0.0: break
        rot(arm, "upper_head", (0, 1, 0), -4.0)
    for k in range(10):
        z = zmin(lambda i: i in ARML_V)
        if z >= 0.0: break
        w = pos(arm, "hand_l") + Vector((0, 0, -z + 0.02))
        hand_l_to(arm, w, pole=rel_dir(arm, "upper_chest", (0.8, 0.3, -0.4)))
    if spear == "floor":
        ground_fix(True, regrounded=True)

def ground_fix(spear_on_floor=False, regrounded=False):
    if not regrounded:
        move(arm, "root", (0, 0, -min_z()))
    if spear_on_floor:
        # the dying hand lets go: weapon_r leaves the fist and the spear lies flat on the floor in front
        S = pos(arm, "upperarm_r")
        arm_ik(arm, "r", Vector((S.x + 0.02, S.y - 0.30, max(0.05, S.z - 0.28))), pole=(0.0, 0.6, 0.6))
        G = Vector((S.x, S.y - 0.70, 0.05)); d = N(0.20, -1.0, 0.0)
        wb = arm.pose.bones["weapon_r"]
        q = (wb.matrix.to_3x3() @ Vector((0, 1, 0))).rotation_difference(d)
        R3 = q.to_matrix() @ wb.matrix.to_3x3()
        x = R3 @ Vector((1, 0, 0)); xh = Vector((x.x, x.y, 0))
        if xh.length > 1e-6:
            xh = (xh - d * xh.dot(d)).normalized(); ang = x.angle(xh)
            if x.cross(xh).dot(d) < 0: ang = -ang
            R3 = Matrix.Rotation(ang, 3, d) @ R3
        wb.matrix = Matrix.Translation(G) @ R3.to_4x4(); upd()
        move(arm, "weapon_r", (0, 0, 0.004 - min_z(only_spear=True)))

C = P_collapse
KNEEL_F = (-25, -35, 120, 30); TUCK_H = (-30, 70, -55)
KEYS = [(1, P_rest), (6, lambda: P_rise(0.55)), (11, lambda: P_rise(1.0)),
        (15, lambda: P_thrash(30, 0.25, KICK, FOLD, 20)), (19, lambda: P_thrash(33, 0.75, FOLD, KICK, -22)),
        (23, lambda: P_thrash(31, 0.25, KICK, LIMP, 16)), (27, lambda: P_thrash(34, 0.75, LIMP, KICK, -18)),
        (31, lambda: P_thrash(32, 0.30, FOLD, FOLD, 10)), (36, P_drop),
        # stagger: legs wobble, body sways right, torso sags forward, head droops
        (40, lambda: C(6, 0.07, -5, (-10, -8, 35, 12), (-6, -6, 25, 8), (0, 0, 0), (0, 0, 0), (10, 16, -4, -6), (22, -6))),
        # forelegs buckle: knees fold, chest drops, rider slumps over the withers
        (44, lambda: C(16, 0.10, 2, KNEEL_F, (-20, -30, 110, 25), (0, 0, 0), (0, 0, 0), (14, 20, 2, 4), (30, 6))),
        # hindquarters give way: sinks low, starts to tip left; rider lags upright
        (48, lambda: C(6, 0.30, 10, KNEEL_F, KNEEL_F, TUCK_H, TUCK_H, (12, 18, -3, -5), (30, -4))),
        (52, lambda: C(4, 0.30, 40, (-22, -30, 105, 28), (-20, -28, 100, 26), TUCK_H, (-25, 60, -45), (10, 14, -9, -11), (22, -10))),
        (55, lambda: C(3, 0.30, 75, (-18, -22, 80, 22), (-22, -24, 85, 22), (-25, 55, -40), (-22, 45, -35), (8, 12, -5, -4), (16, -6), 0, "floor")),
        # impact (slight overshoot), then the rider whips down after the horse
        (57, lambda: C(2, 0.30, 93, (-18, -20, 70, 20), (-24, -20, 70, 18), (-25, 50, -38), (-20, 40, -30), (8, 12, 10, 14), (12, 10), 10, "floor")),
        (59, lambda: C(2, 0.30, 86, (-18, -18, 62, 18), (-26, -16, 55, 15), (-24, 45, -35), (-18, 32, -24), (10, 14, 22, 26), (10, 24), 18, "floor")),
        # limbs flop: the top legs lose tension and drop/extend, head settles with a small bounce
        (62, lambda: C(2, 0.30, 89, (-20, -15, 50, 15), (-25, -10, 35, 10), (-25, 38, -28), (-15, 20, -12), (10, 14, 26, 28), (8, 32), 24, "floor")),
        (66, lambda: C(2, 0.30, 89.5, (-20, -14, 46, 14), (-24, -8, 30, 8), (-24, 36, -26), (-14, 16, -10), (10, 14, 27, 29), (8, 28), 26, "floor")),
        (72, lambda: C(2, 0.30, 89.5, (-20, -14, 44, 14), (-24, -8, 28, 8), (-24, 35, -25), (-14, 15, -10), (10, 14, 27, 29), (8, 30), 28, "floor"))]
REC = {}
for f, fn in KEYS:
    fn(); key_pose(arm, f)
    if f <= 52: REC[f] = SPP.record(arm)
# hand the hind legs from IK (planted) to FK as the body rolls over
for c in ik_cons:
    c.influence = 1.0; c.keyframe_insert("influence", frame=1); c.keyframe_insert("influence", frame=44)
    c.influence = 0.0; c.keyframe_insert("influence", frame=48)
fix_quat_continuity(act)
bake_visual(arm, 1, 72, act)
SPP.apply_path(arm, body, REC, 1, 52, twist_ref=Vector((0, 0, 1)))
# after letting go: keep the dropped spear on (not in) the floor every frame
for f in range(53, 73):
    bpy.context.scene.frame_set(f)
    zs = min_z(only_spear=True)
    if zs < 0.002:
        move(arm, "weapon_r", (0, 0, 0.004 - zs))
        pb = arm.pose.bones["weapon_r"]
        for path in ("rotation_quaternion", "location", "scale"): pb.keyframe_insert(path, frame=f, group="weapon_r")
fix_quat_continuity(act)
act.frame_range = (1, 72); act.use_frame_range = True
bpy.context.scene.frame_start, bpy.context.scene.frame_end = 1, 72
bpy.ops.wm.save_as_mainfile(filepath=DST)
clip_report(arm, body, range(1, 73), "Death")
for f in (1, 36, 44, 48, 52, 55, 57, 59, 62, 72):
    bpy.context.scene.frame_set(f); print("frame", f, "min z body %.3f spear %.3f" % (min_z(), min_z(only_spear=True)))
if GO:
    spear_colors(body)
    views = [("front", (0.4, -6, 0.8), (0.4, 0, 0.8), 2.8), ("q34", (-3.6, -4.6, 1.8), (0.4, -0.2, 0.7), 2.8)]
    if os.environ.get("LOW"): views = [("low", (-4.0, -4.0, 0.25), (0.5, -0.2, 0.25), 2.6)]
    render_frames(arm, body, range(1, 73), D + "/frames_death", views)
