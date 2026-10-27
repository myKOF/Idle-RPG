"""Skin-weight corrections for the Sunbrand Knight rig (geometry-driven, rest pose).

Meshy's auto-rig bound the lower sword blade to the left lower leg and the lower cape to
both legs, and the whole model is one welded mesh, so regions are found from rest-pose
vertex positions. All thresholds live here:

  sword : vertices within SWORD_RADIUS of the blade axis (a line from the tip to the grip,
          measured from the rest-pose mesh) -> 100% LeftHand, so the blade is rigid
  cape  : y > CAPE_MIN_Y behind the body, z in CAPE_Z -> Hips (lower) blending to Spine02
          (upper) so the cloth follows the pelvis instead of being pulled apart by the legs
"""
from mathutils import Vector

SWORD_TIP = Vector((0.40, -0.07, 0.00))
SWORD_GRIP = Vector((0.58, -0.07, 0.98))
# Measured on the rest pose: blade verts reach ~0.09 from the axis, the nearest leg verts start
# at ~0.14, and forearm verts show up at 0.10+, so they are skipped by their current weights.
SWORD_RADIUS = 0.10
KEEP_BONES = ("LeftForeArm", "LeftArm", "LeftShoulder")

CAPE_MIN_Y = 0.11
CAPE_Z = (0.25, 1.15)
CAPE_MAX_ABS_X = 0.6
CAPE_UPPER_BLEND_FROM_Z = 0.7


def _set_weights(ob, index, weights):
    for g in ob.vertex_groups:
        try:
            g.remove([index])
        except RuntimeError:
            pass  # vertex was not in this group
    for name, w in weights.items():
        group = ob.vertex_groups.get(name) or ob.vertex_groups.new(name=name)
        group.add([index], w, "REPLACE")


def _on_sword(p):
    axis = SWORD_GRIP - SWORD_TIP
    t = max(0.0, min(1.0, (p - SWORD_TIP).dot(axis) / axis.length_squared))
    return (p - (SWORD_TIP + axis * t)).length < SWORD_RADIUS


def apply(ob, arm):
    names = {g.index: g.name for g in ob.vertex_groups}
    sword, cape = [], []
    for v in ob.data.vertices:
        p = ob.matrix_world @ v.co
        top = max(((names[g.group], g.weight) for g in v.groups), key=lambda kv: kv[1], default=("", 0))[0]
        if _on_sword(p) and top not in KEEP_BONES:
            sword.append(v.index)
        elif p.y > CAPE_MIN_Y and CAPE_Z[0] < p.z < CAPE_Z[1] and abs(p.x) < CAPE_MAX_ABS_X:
            cape.append((v.index, p.z))
    for i in sword:
        _set_weights(ob, i, {"LeftHand": 1.0})
    z0, z1 = CAPE_UPPER_BLEND_FROM_Z, CAPE_Z[1]
    for i, z in cape:
        t = min(1.0, max(0.0, (z - z0) / (z1 - z0)))
        _set_weights(ob, i, {"Hips": 1.0 - 0.5 * t, "Spine02": 0.5 * t} if t > 0 else {"Hips": 1.0})
    return {"swordVerts": len(sword), "capeVerts": len(cape)}
