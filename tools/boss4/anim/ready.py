"""Shared combat-ready carry: spear held at its rear third by the right hand at the hip,
tip forward and down, butt rising behind outside the shoulder. Used as the first/last frame of every
attack, the start of Death, and the base of Walk/Run."""
import math
from mathutils import Vector
from posekit import pos, place_spear, hand_l_to, rel, rel_dir, rot

READY = dict(dx=-0.24, dy=-0.06, dz=-0.14, tilt=25.0, ax=0.18)

def ready_dir(tilt=None, ax=None, sway=0.0):
    t = math.radians((READY["tilt"] if tilt is None else tilt) + sway)
    return Vector((READY["ax"] if ax is None else ax, -math.cos(t), -math.sin(t))).normalized()

def ready_grip(arm, extra=(0, 0, 0)):
    S = pos(arm, "upperarm_r")
    return S + Vector((READY["dx"], READY["dy"], READY["dz"])) + Vector(extra)

def pose_ready(arm, sway=0.0, grip_extra=(0, 0, 0), left=True):
    """Apply on top of whatever the horse/torso is doing (call after torso rotations)."""
    place_spear(arm, ready_grip(arm, grip_extra), ready_dir(sway=sway), twist_ref=Vector((0, 0, -1)))
    if left:
        hand_l_to(arm, rel(arm, "upper_chest", (0.24, -0.06, -0.26)), pole=rel_dir(arm, "upper_chest", (0.8, 0.3, -0.4)))
