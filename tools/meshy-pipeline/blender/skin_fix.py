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
import bpy
from mathutils import Vector

# Measured on the left-handed rest pose; x is flipped when the hand is "Right".
SWORD_TIP = Vector((0.40, -0.07, 0.00))
SWORD_GRIP = Vector((0.58, -0.07, 0.98))
# Blade verts reach ~0.09 from the axis, the nearest leg verts start at ~0.14, and forearm
# verts show up at 0.10+, so those are skipped by their current weights.
SWORD_RADIUS = 0.10
# The pommel (a stem and a sun disc) continues the blade axis past the grip, where the forearm runs
# almost parallel: only verts hugging the axis count, whatever bone they were weighted to
# (Meshy put them on the forearm, so the hilt bent when the blade was turned).
POMMEL_LENGTH = 0.27
POMMEL_RADIUS = 0.095
POMMEL_RING_FROM = 0.08  # the neighbour ring starts above the wrist so the forearm itself stays free
POMMEL_RING_RADIUS = 0.13

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
    # Meshy's custom normals no longer match the mirrored faces; drop them so normals follow the faces
    if ob.data.has_custom_normals:
        bpy.context.view_layer.objects.active = ob
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
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


def _sword_axis(hand):
    sign = 1.0 if hand == "Left" else -1.0
    return (Vector((sign * SWORD_TIP.x, SWORD_TIP.y, SWORD_TIP.z)),
            Vector((sign * SWORD_GRIP.x, SWORD_GRIP.y, SWORD_GRIP.z)))


def add_weapon_bone(arm, hand, name="Sword"):
    """Add a bone along the blade (head at the grip, tail at the tip) as a child of the hand bone,
    so the weapon can later be posed on its own (laid flat when the character falls)."""
    tip, grip = _sword_axis(hand)
    to_local = arm.matrix_world.inverted()
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones.new(name)
    eb.head, eb.tail = to_local @ grip, to_local @ tip
    eb.parent = arm.data.edit_bones[hand + "Hand"]
    eb.use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")


def apply(ob, arm, hand="Right", weapon_group=None):
    """Fix weights for a sword held in `hand` ("Left" = original model, "Right" = after mirror_model).
    With weapon_group the blade is bound 100% to that bone (add_weapon_bone) instead of the hand."""
    tip, grip = _sword_axis(hand)
    axis = grip - tip
    keep = (hand + "ForeArm", hand + "Arm", hand + "Shoulder")
    names = {g.index: g.name for g in ob.vertex_groups}
    sword, cape = [], []
    for v in ob.data.vertices:
        p = ob.matrix_world @ v.co
        top = max(((names[g.group], g.weight) for g in v.groups), key=lambda kv: kv[1], default=("", 0))[0]
        t = max(0.0, min(1.0, (p - tip).dot(axis) / axis.length_squared))
        beyond = (p - grip).dot(axis.normalized())  # > 0 past the grip, towards the pommel
        on_pommel = 0 < beyond < POMMEL_LENGTH and (p - (grip + axis.normalized() * beyond)).length < POMMEL_RADIUS
        if on_pommel or ((p - (tip + axis * t)).length < SWORD_RADIUS and top not in keep):
            sword.append(v.index)
        elif p.y > CAPE_MIN_Y and CAPE_Z[0] < p.z < CAPE_Z[1] and abs(p.x) < CAPE_MAX_ABS_X:
            cape.append((v.index, p.z))
    # one ring of neighbours around the pommel, so no stretched sliver is left joining it to the forearm
    chosen = set(sword)
    unit = axis.normalized()
    for e in ob.data.edges:
        a, b = e.vertices
        if (a in chosen) != (b in chosen):
            other = b if a in chosen else a
            p = ob.matrix_world @ ob.data.vertices[other].co
            beyond = (p - grip).dot(unit)
            if POMMEL_RING_FROM < beyond < POMMEL_LENGTH + 0.03 and (p - (grip + unit * beyond)).length < POMMEL_RING_RADIUS:
                sword.append(other)
    for i in sword:
        _set_weights(ob, i, {weapon_group or hand + "Hand": 1.0})
    z0, z1 = CAPE_UPPER_BLEND_FROM_Z, CAPE_Z[1]
    for i, z in cape:
        t = min(1.0, max(0.0, (z - z0) / (z1 - z0)))
        _set_weights(ob, i, {"Hips": 1.0 - 0.5 * t, "Spine02": 0.5 * t} if t > 0 else {"Hips": 1.0})
    return {"hand": hand, "swordVerts": len(sword), "capeVerts": len(cape)}
