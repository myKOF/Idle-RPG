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
import math

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

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


# ---- fist -------------------------------------------------------------------------------------
# Meshy's left hand is open and the rig has no finger bones, so the fist is a rest-pose mesh edit. The
# gauntlet is metal: the plates between the joints must not bend or stretch, so each finger section is
# moved as one rigid piece and only the vertices inside a joint's own span (measured from the rings of
# vertices in the original hand) turn. The path out of the knuckle folds three times, the way real
# fingers close, and every vertex keeps its offset from the finger's centre line. The hand is not turned.
# Reach = metres from the wrist along the hand; the spans are the knuckle, middle and fingertip joints.
FIST_JOINTS = ((0.075, 0.105), (0.115, 0.145), (0.158, 0.175))
FIST_FOLDS_DEG = (95.0, 100.0, 75.0)  # bend at each of the three joints
# The whole hand (palm and fist) is then flexed inward at the wrist as one rigid piece. The vertices
# thin out between the wrist plate and the knuckles, so that gap carries the turn.
FIST_WRIST_BEND_DEG = 45.0
FIST_WRIST_PIVOT = 0.045  # reach of the pivot
FIST_WRIST_BLEND = (0.035, 0.07)  # reach span over which the bend is eased in


def curl_fist(ob, arm, side="Left", palm_sign=-1.0):
    """Close the open hand of `side` into a fist (rest pose, weights untouched).
    palm_sign picks the face of the hand the fingers fold towards (-1 = the palm)."""
    names = {g.index: g.name for g in ob.vertex_groups}
    idx = [v.index for v in ob.data.vertices
           if max(((names[g.group], g.weight) for g in v.groups), key=lambda kv: kv[1], default=("", 0))[0] == side + "Hand"]
    m, minv = ob.matrix_world, ob.matrix_world.inverted()
    pts = np.array([(m @ ob.data.vertices[i].co)[:] for i in idx])
    wrist = np.array(arm.matrix_world @ arm.data.bones[side + "Hand"].head_local)
    w, vecs = np.linalg.eigh(np.cov((pts - pts.mean(0)).T))
    along, normal = vecs[:, 2], vecs[:, 0]
    if ((pts - wrist) @ along).mean() < 0:
        along = -along
    normal = normal - along * (normal @ along)
    normal = palm_sign * normal / np.linalg.norm(normal)
    lateral = np.cross(along, normal)
    start = FIST_JOINTS[0][0]
    knuckle = wrist + along * start

    def smooth(t):
        t = np.clip(t, 0.0, 1.0)
        return t * t * (3 - 2 * t)

    du = 0.001
    us = np.arange(0.0, 0.25, du)
    phi = sum(math.radians(a) * smooth((us + start - lo) / (hi - lo)) for (lo, hi), a in zip(FIST_JOINTS, FIST_FOLDS_DEG))
    heading = np.outer(np.cos(phi), along) + np.outer(np.sin(phi), normal)
    path = np.cumsum(heading * du, axis=0) - heading * du  # position of the centre line at each u
    side_dir = np.outer(-np.sin(phi), along) + np.outer(np.cos(phi), normal)  # the "up" of the finger at each u
    pivot = wrist + along * FIST_WRIST_PIVOT
    bend = Matrix.Rotation(math.radians(FIST_WRIST_BEND_DEG), 3, Vector(lateral))  # + turns the fingers towards the palm
    moved = 0
    for k, i in enumerate(idx):
        d = pts[k] - knuckle
        u, h, lat = d @ along, d @ normal, d @ lateral
        pos = pts[k]
        if u > 0:
            u = min(u, us[-1])
            centre = np.array([np.interp(u, us, path[:, c]) for c in range(3)])
            up = np.array([np.interp(u, us, side_dir[:, c]) for c in range(3)])
            pos = knuckle + centre + up * h + lateral * lat
            moved += 1
        reach = (pts[k] - wrist) @ along
        t = float(smooth((reach - FIST_WRIST_BLEND[0]) / (FIST_WRIST_BLEND[1] - FIST_WRIST_BLEND[0])))
        if t > 0:
            turned = Matrix.Rotation(math.radians(FIST_WRIST_BEND_DEG) * t, 3, Vector(lateral))
            pos = np.array(pivot + turned @ Vector(pos - pivot))
        ob.data.vertices[i].co = minv @ Vector(pos)
    ob.data.update()
    return {"handVerts": len(idx), "curledVerts": moved}
