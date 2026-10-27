"""Mirror and skin-weight corrections for the Sunbrand Knight rig (geometry-driven, rest pose).

Meshy's model holds the sword in its left hand, while the animation library is authored for a
right-handed mannequin. mirror_model() flips the mesh left/right and swaps the Left*/Right*
vertex-group names, so the same skeleton and the same animations drive a right-handed knight.

Meshy's auto-rig also bound the lower sword blade to the lower leg and the lower cape to both
legs, and the whole model is one welded mesh, so regions are found from rest-pose vertex
positions (measured on the left-handed original; they are mirrored here). All thresholds live here:

  sword : vertices within SWORD_RADIUS of the blade axis -> 100% hand bone, so the blade is rigid
  cape  : y > CAPE_MIN_Y behind the body, z in CAPE_Z -> Hips (lower) blending to Spine02 (upper)
          so the cloth follows the pelvis instead of being pulled apart by the legs
"""
import bmesh
from mathutils import Vector

# Measured on the left-handed rest pose; x is flipped when the hand is "Right".
SWORD_TIP = Vector((0.40, -0.07, 0.00))
SWORD_GRIP = Vector((0.58, -0.07, 0.98))
# Blade verts reach ~0.09 from the axis, the nearest leg verts start at ~0.14, and forearm
# verts show up at 0.10+, so those are skipped by their current weights.
SWORD_RADIUS = 0.10

CAPE_MIN_Y = 0.11
CAPE_Z = (0.25, 1.15)
CAPE_MAX_ABS_X = 0.6
CAPE_UPPER_BLEND_FROM_Z = 0.7


def _swap_side(name):
    if name.startswith("Left"):
        return "Right" + name[4:]
    if name.startswith("Right"):
        return "Left" + name[5:]
    return name


def mirror_model(ob):
    """Flip the mesh across x=0 (world space) and swap Left*/Right* vertex-group names."""
    m, minv = ob.matrix_world, ob.matrix_world.inverted()
    for v in ob.data.vertices:
        w = m @ v.co
        w.x = -w.x
        v.co = minv @ w
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.reverse_faces(bm, faces=bm.faces)  # a mirror turns the triangle winding inside out
    bm.to_mesh(ob.data)
    bm.free()
    groups = list(ob.vertex_groups)
    for g in groups:
        g.name = "__swap_" + _swap_side(g.name)
    for g in groups:
        g.name = g.name[len("__swap_"):]
    ob.data.update()


def _set_weights(ob, index, weights):
    for g in ob.vertex_groups:
        try:
            g.remove([index])
        except RuntimeError:
            pass  # vertex was not in this group
    for name, w in weights.items():
        group = ob.vertex_groups.get(name) or ob.vertex_groups.new(name=name)
        group.add([index], w, "REPLACE")


def apply(ob, arm, hand="Right"):
    """Fix weights for a sword held in `hand` ("Left" = original model, "Right" = after mirror_model)."""
    sign = 1.0 if hand == "Left" else -1.0
    tip = Vector((sign * SWORD_TIP.x, SWORD_TIP.y, SWORD_TIP.z))
    grip = Vector((sign * SWORD_GRIP.x, SWORD_GRIP.y, SWORD_GRIP.z))
    axis = grip - tip
    keep = (hand + "ForeArm", hand + "Arm", hand + "Shoulder")
    names = {g.index: g.name for g in ob.vertex_groups}
    sword, cape = [], []
    for v in ob.data.vertices:
        p = ob.matrix_world @ v.co
        top = max(((names[g.group], g.weight) for g in v.groups), key=lambda kv: kv[1], default=("", 0))[0]
        t = max(0.0, min(1.0, (p - tip).dot(axis) / axis.length_squared))
        if (p - (tip + axis * t)).length < SWORD_RADIUS and top not in keep:
            sword.append(v.index)
        elif p.y > CAPE_MIN_Y and CAPE_Z[0] < p.z < CAPE_Z[1] and abs(p.x) < CAPE_MAX_ABS_X:
            cape.append((v.index, p.z))
    for i in sword:
        _set_weights(ob, i, {hand + "Hand": 1.0})
    z0, z1 = CAPE_UPPER_BLEND_FROM_Z, CAPE_Z[1]
    for i, z in cape:
        t = min(1.0, max(0.0, (z - z0) / (z1 - z0)))
        _set_weights(ob, i, {"Hips": 1.0 - 0.5 * t, "Spine02": 0.5 * t} if t > 0 else {"Hips": 1.0})
    return {"hand": hand, "swordVerts": len(sword), "capeVerts": len(cape)}
