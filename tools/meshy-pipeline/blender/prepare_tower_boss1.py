"""Prepare the user-authorized BOSS1 preview with a rigid, separate right sword.

blender -b --python-exit-code 1 --python prepare_tower_boss1.py -- INPUT OUTPUT --hand-source HAND.blend
The five supplied motions are retained at their original speed. Horizontal root
travel is removed from combat clips for later simulation-controlled movement.
Editable .blend, five-action .glb and numerical QA are written to OUTPUT.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

CLIPS = ['Walk', 'Attack1', 'Attack2', 'Attack3', 'Die']
HAND = 'mixamorig:RightHand'
HIPS = 'mixamorig:Hips'
WEAPON = 'Sword_R'
CAPE = ['Cape_Upper', 'Cape_Middle', 'Cape_Lower']
CAPE_HEIGHTS = [1.48, 1.02, .56, .10]
GRIP = Vector((-.775, -.025, 1.355))
TIP = Vector((-.775, -.025, .166))


def bind_action(arm, action):
    ad = arm.animation_data_create()
    ad.action = action
    if action.slots:
        ad.action_slot = action.slots[0]


def trim_faces(obj, keep):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index not in keep], context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def rigid_group(obj, name):
    obj.vertex_groups.clear()
    obj.vertex_groups.new(name=name).add(list(range(len(obj.data.vertices))), 1, 'REPLACE')


def clear_sword_arm(arm):
    """Give a lowered sword hand clearance from the oversized hip/forearm armor."""
    upper = arm.pose.bones['mixamorig:RightArm']
    wrist = arm.pose.bones[HAND].head
    amount = max(0, min(1, (upper.head.z - wrist.z - .12) / .25))
    if amount:
        angle = math.radians(14) * amount
        lateral = arm.pose.bones['mixamorig:LeftShoulder'].head - arm.pose.bones['mixamorig:RightShoulder'].head
        lateral.z = 0
        lateral.normalize()
        back = Vector((0, 0, 1)).cross(lateral)
        pivot = upper.head.copy()
        upper.matrix = Matrix.Translation(pivot) @ Matrix.Rotation(angle, 4, back) @ Matrix.Translation(-pivot) @ upper.matrix
        bpy.context.view_layer.update()


def pronate_forearm(arm, dorsal_rest):
    """Carry wrist rotation through the forearm while retaining the sword pose."""
    hand = arm.pose.bones[HAND]
    forearm = arm.pose.bones['mixamorig:RightForeArm']
    hand_pose = hand.matrix.copy()
    axis = (hand.head - forearm.head).normalized()
    current = (forearm.matrix @ arm.data.bones[forearm.name].matrix_local.inverted()).to_3x3() @ dorsal_rest
    desired = (hand.matrix @ arm.data.bones[HAND].matrix_local.inverted()).to_3x3() @ dorsal_rest
    current -= axis * current.dot(axis)
    desired -= axis * desired.dot(axis)
    if current.length < .001 or desired.length < .001:
        return
    current.normalize()
    desired.normalize()
    angle = math.atan2(axis.dot(current.cross(desired)), current.dot(desired))
    pivot = forearm.head.copy()
    forearm.matrix = Matrix.Translation(pivot) @ Matrix.Rotation(angle, 4, axis) @ Matrix.Translation(-pivot) @ forearm.matrix
    bpy.context.view_layer.update()
    hand.matrix = hand_pose
    bpy.context.view_layer.update()


def hang_cape(arm, time):
    """Keep the cloth descending in world gravity, then lay its hem behind it.

    The upper attachment follows the torso. Its lower chain follows yaw and
    gravity instead of inheriting the torso's forward pitch and flying upward.
    """
    spine = arm.pose.bones['mixamorig:Spine2']
    spine_delta = spine.matrix @ arm.data.bones[spine.name].matrix_local.inverted()
    head = spine_delta @ Vector((0, .145, CAPE_HEIGHTS[0]))
    lateral = arm.pose.bones['mixamorig:LeftShoulder'].matrix.translation - arm.pose.bones['mixamorig:RightShoulder'].matrix.translation
    lateral.z = 0
    lateral.normalize()
    back = Vector((0, 0, 1)).cross(lateral).normalized()
    yaw = math.atan2(back.y, back.x) - math.pi / 2
    yaw_matrix = Matrix.Rotation(yaw, 3, 'Z')
    root = head.copy()
    for index, name in enumerate(CAPE):
        length = CAPE_HEIGHTS[index] - CAPE_HEIGHTS[index + 1]
        remaining = CAPE_HEIGHTS[index] - CAPE_HEIGHTS[-1]
        available = max(.015, head.z - .065)
        angle = math.acos(min(.995, available / (remaining + .035)))
        angle += math.radians(-15 + index * 15)
        angle += math.radians(2.5) * math.sin(time * 4 + index * .8)
        angle = max(math.radians(4), min(math.radians(88), angle))
        direction = back * math.sin(angle) + Vector((0, 0, -math.cos(angle)))
        direction = (direction + lateral * (.012 * math.sin(time * 3 + index))).normalized()
        rest = arm.data.bones[name].matrix_local.copy()
        local_direction = yaw_matrix.inverted() @ direction
        bend = Vector((0, 0, -1)).rotation_difference(local_direction).to_matrix()
        rotation = yaw_matrix @ bend @ rest.to_3x3()
        arm.pose.bones[name].matrix = Matrix.Translation(head) @ rotation.to_4x4()
        bpy.context.view_layer.update()
        head += direction * length
    # The fused source has narrow collar/edge triangles remaining on the body.
    # Drive their original cloak bones with the same curve, so the seam cannot
    # retain the old torso-driven pitch while the detached cloth hangs below it.
    deltas = [arm.pose.bones[name].matrix @ arm.data.bones[name].matrix_local.inverted() for name in CAPE]
    for name in ['Bone_027', 'Bone_026', 'Bone_025', 'Bone_024']:
        rest = arm.data.bones[name].matrix_local
        station = max(0, min(2, (CAPE_HEIGHTS[0] - rest.translation.z) / .46))
        index, weight = min(2, int(station)), station - int(station)
        delta = deltas[index].copy()
        if index < 2:
            delta = delta.lerp(deltas[index + 1], weight)
        arm.pose.bones[name].matrix = delta @ rest
        bpy.context.view_layer.update()
    return root, head


def prepare(source, output, hand_source):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = 30
    output.mkdir(parents=True, exist_ok=True)
    originals, source_sha = {}, {}
    arm = body = None
    for name in CLIPS:
        file = source / f'BOSS1_{name}.glb'
        source_sha[file.name] = hashlib.sha256(file.read_bytes()).hexdigest()
        objects, actions = set(bpy.data.objects), set(bpy.data.actions)
        bpy.ops.import_scene.gltf(filepath=str(file))
        added = set(bpy.data.objects) - objects
        action = next(iter(set(bpy.data.actions) - actions))
        action.name = 'Source_' + name
        originals[name] = action
        if arm is None:
            arm = next(o for o in added if o.type == 'ARMATURE')
            body = next(o for o in added if o.type == 'MESH' and o.vertex_groups)
        else:
            for obj in added:
                bpy.data.objects.remove(obj, do_unlink=True)
    arm.name, body.name = 'BOSS1_Rig', 'BOSS1_Body'
    for track in list(arm.animation_data.nla_tracks):
        arm.animation_data.nla_tracks.remove(track)
    arm.animation_data.action = None
    arm.data.pose_position = 'REST'
    bpy.context.view_layer.update()

    # The blade, crossguard and pommel are fused to an open hand in the source.
    # Extract their existing UV-mapped faces; the short concealed handle is
    # reconstructed rather than transferring silver finger fragments to the sword.
    uv = body.data.uv_layers.active
    color_image = next(n.image for n in body.data.materials[0].node_tree.nodes
                       if n.type == 'TEX_IMAGE' and n.image and 'texture_0' == n.image.name)
    pixels = list(color_image.pixels)
    iw, ih = color_image.size

    def warm_face(face):
        coord = sum((uv.data[i].uv for i in face.loop_indices), Vector((0, 0))) / len(face.loop_indices)
        x, y = int(coord.x * iw) % iw, int(coord.y * ih) % ih
        r, g, b = pixels[4 * (y * iw + x):4 * (y * iw + x) + 3]
        return r > b * 1.12 and r > g * 1.015

    sword_faces = set()
    for face in body.data.polygons:
        p = face.center
        radial = math.hypot(p.x - GRIP.x, p.y - GRIP.y)
        if ((p.x < -.58 and p.z < 1.278)
                or (-.85 < p.x < -.72 and p.z > 1.435)
                or (radial < .029 and 1.265 < p.z < 1.45 and warm_face(face))):
            sword_faces.add(face.index)
    assert 200 < len(sword_faces) < 900, len(sword_faces)
    weapon = body.copy()
    weapon.data = body.data.copy()
    weapon.name = 'BOSS1_Sword'
    scene.collection.objects.link(weapon)
    trim_faces(weapon, sword_faces)
    trim_faces(body, set(range(len(body.data.polygons))) - sword_faces)

    # The generated open fingers share irregular triangles and auxiliary bone
    # weights. Replace the glove with the posed MakeHuman hand, retaining the
    # original forearm armor and blending its wrist attachment.
    old_group_names = {group.index: group.name for group in body.vertex_groups}
    old_hand_vertices = set()
    for vertex in body.data.vertices:
        p = vertex.co
        hand_weight = sum(group.weight for group in vertex.groups
                          if old_group_names[group.group].startswith(HAND)
                          or old_group_names[group.group] == 'Bone_051')
        if p.x < -.625 and 1.23 < p.z < 1.49 and -.16 < p.y < .12 and (hand_weight > .10 or p.x < -.66):
            old_hand_vertices.add(vertex.index)
    old_hand_faces = {face.index for face in body.data.polygons
                      if face.center.x < -.61 and any(index in old_hand_vertices for index in face.vertices)}
    trim_faces(body, set(range(len(body.data.polygons))) - old_hand_faces)
    with bpy.data.libraries.load(str(hand_source), link=False) as (_, imported):
        imported.objects = ['BOSS1_RightHand_Anatomical']
    hand_mesh = imported.objects[0]
    scene.collection.objects.link(hand_mesh)
    dorsal_rest = Vector(hand_mesh['dorsalNormalRest'])
    thumb_axis_rest = Vector(hand_mesh['thumbDistalAxisRest'])
    thumb_tip_rest = Vector(hand_mesh['thumbTipRest'])
    hand_vertices = list(range(len(hand_mesh.data.vertices)))
    hand_mesh.vertex_groups.clear()
    hand_group = hand_mesh.vertex_groups.new(name=HAND)
    forearm_group = hand_mesh.vertex_groups.new(name='mixamorig:RightForeArm')
    for vertex in hand_mesh.data.vertices:
        reach = -.6321539283 - vertex.co.x
        weight = max(0, min(1, (reach - .015) / .060))
        weight = weight * weight * (3 - 2 * weight)
        if weight:
            hand_group.add([vertex.index], weight, 'REPLACE')
        if weight < 1:
            forearm_group.add([vertex.index], 1 - weight, 'REPLACE')
    bpy.ops.object.select_all(action='DESELECT')
    for obj in [body, hand_mesh]:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()

    # SmartRig's original cloak is partly assigned to legs and otherwise inherits
    # Spine2's full pitch. Retain its UV geometry and fit a gravity-led chain.
    group_names = {g.index: g.name for g in body.vertex_groups}
    original_cape = {'Bone_024', 'Bone_025', 'Bone_026', 'Bone_027'}
    cape_vertices = set()
    for vertex in body.data.vertices:
        cape_weight = sum(g.weight for g in vertex.groups if group_names[g.group] in original_cape)
        if cape_weight > .12 and vertex.co.y > .05 and vertex.co.z < 1.54:
            cape_vertices.add(vertex.index)
    uv = body.data.uv_layers.active
    for face in body.data.polygons:
        p = face.center
        if p.y <= .105 or p.z >= 1.50 or abs(p.x) > .60 or face.material_index != 0:
            continue
        coord = sum((uv.data[i].uv for i in face.loop_indices), Vector((0, 0))) / len(face.loop_indices)
        x, y = int(coord.x * iw) % iw, int(coord.y * ih) % ih
        red, green, blue = pixels[4 * (y * iw + x):4 * (y * iw + x) + 3]
        if red > green * 1.32 and red > blue * 1.10:
            cape_vertices.update(face.vertices)
    cape_faces = {face.index for face in body.data.polygons
                  if face.center.y > .065 and face.center.z < 1.525
                  and any(index in cape_vertices for index in face.vertices)}
    cape = body.copy()
    cape.data = body.data.copy()
    cape.name = 'BOSS1_Cape'
    scene.collection.objects.link(cape)
    trim_faces(cape, cape_faces)
    trim_faces(body, set(range(len(body.data.polygons))) - cape_faces)
    # Separate the cloth at the fused shoulder seam. Shared armor vertices must
    # retain their original skin rather than being pulled by the hanging cloak.
    cape.vertex_groups.clear()
    cape.vertex_groups.new(name='mixamorig:Spine2')
    for name in CAPE:
        cape.vertex_groups.new(name=name)
    cape_vertices = list(range(len(cape.data.vertices)))
    for index in cape_vertices:
        z = cape.data.vertices[index].co.z
        station = max(0, min(2, (CAPE_HEIGHTS[0] - z) / .46))
        upper = min(2, int(station))
        weight = station - upper
        attach = max(0, min(1, (z - 1.36) / .16))
        cape.vertex_groups[CAPE[upper]].add([index], (1 - weight) * (1 - attach), 'REPLACE')
        if upper < 2 and weight:
            cape.vertex_groups[CAPE[upper + 1]].add([index], weight * (1 - attach), 'REPLACE')
        if attach:
            cape.vertex_groups['mixamorig:Spine2'].add([index], attach, 'REPLACE')

    # Rebuild the leather grip; all visible original ornament remains textured.
    leather = bpy.data.materials.new('BOSS1_Grip_Leather')
    leather.diffuse_color = (.025, .018, .014, 1)
    leather.use_nodes = True
    bsdf = leather.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = leather.diffuse_color
    bsdf.inputs['Roughness'].default_value = .58
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=.018, depth=.30,
                                        location=(GRIP.x, GRIP.y, 1.38))
    handle = bpy.context.object
    handle.data.materials.append(leather)
    bpy.ops.object.select_all(action='DESELECT')
    weapon.select_set(True)
    handle.select_set(True)
    bpy.context.view_layer.objects.active = weapon
    bpy.ops.object.join()

    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    bone = arm.data.edit_bones.new(WEAPON)
    bone.head, bone.tail = GRIP, TIP
    bone.parent = arm.data.edit_bones[HAND]
    bone.use_connect = False
    for index, name in enumerate(CAPE):
        cape_bone = arm.data.edit_bones.new(name)
        cape_bone.head = (0, .145, CAPE_HEIGHTS[index])
        cape_bone.tail = (0, .145, CAPE_HEIGHTS[index + 1])
        cape_bone.parent = arm.data.edit_bones['mixamorig:Spine2'] if index == 0 else arm.data.edit_bones[CAPE[index - 1]]
        cape_bone.use_connect = index > 0
    bpy.ops.object.mode_set(mode='OBJECT')
    rigid_group(weapon, WEAPON)
    weapon_points = [v.co.copy() for v in weapon.data.vertices]
    arm.data.pose_position = 'POSE'
    hand_rest_inv = arm.data.bones[HAND].matrix_local.inverted()
    bind_action(arm, originals['Walk'])
    scene.frame_set(0)
    clear_sword_arm(arm)
    hand0 = arm.pose.bones[HAND].matrix.copy()
    original_dir = (hand0 @ hand_rest_inv).to_3x3() @ (TIP - GRIP).normalized()
    desired = Vector((0, -.80, -.60)).normalized()
    correction_world = original_dir.rotation_difference(desired).to_matrix()
    aimed_hand = correction_world @ hand0.to_3x3()
    aimed_delta = aimed_hand @ hand_rest_inv.to_3x3()
    back = aimed_delta @ dorsal_rest
    # The latest right-side photograph shows the dorsal surface toward the
    # character's right camera, with the palm toward the body and thumb at guard.
    outward = arm.pose.bones['mixamorig:RightShoulder'].head - arm.pose.bones['mixamorig:LeftShoulder'].head
    outward.z = 0
    back -= desired * back.dot(desired)
    outward -= desired * outward.dot(desired)
    back.normalize()
    outward.normalize()
    roll = math.atan2(desired.dot(back.cross(outward)), back.dot(outward))
    correction_world = Matrix.Rotation(roll, 3, desired) @ correction_world
    correction_local = hand0.to_3x3().inverted() @ correction_world @ hand0.to_3x3()
    print('WALK_SWORD_CORRECTION', list(original_dir), correction_local.to_quaternion().angle)
    arm['handDorsalNormalRest'] = list(dorsal_rest)
    arm['thumbDistalAxisRest'] = list(thumb_axis_rest)
    arm['thumbTipRest'] = list(thumb_tip_rest)
    arm['gripReference'] = 'User right-side hand photograph, 2026-11-08'
    arm['handSource'] = 'MakeHuman / MPFB CC0 anatomical right hand'
    scene.frame_set(1)
    scene.frame_set(0)

    original_bones = [b.name for b in arm.data.bones if b.name not in [WEAPON] + CAPE]
    report = {'blender': bpy.app.version_string, 'license': 'User confirmed self-created/generated and authorized game use/modification in chat, 2026-11-08',
              'sourceSha256': source_sha, 'weaponBone': WEAPON, 'weaponParent': HAND,
              'swordSourceFaces': len(sword_faces), 'closedHandVertices': len(hand_vertices),
              'capeBones': CAPE, 'capeVertices': len(cape_vertices), 'gripReferenceRollDegrees': math.degrees(roll),
              'handSourceSha256': hashlib.sha256(hand_source.read_bytes()).hexdigest(),
              'dorsalNormalRest': list(dorsal_rest), 'thumbDistalAxisRest': list(thumb_axis_rest),
              'thumbTipRest': list(thumb_tip_rest),
              'clips': {}}
    processed = {}
    for name, action in originals.items():
        bind_action(arm, action)
        start, end = map(round, action.frame_range)
        samples = []
        for frame in range(start, end + 1):
            scene.frame_set(frame)
            samples.append({b: arm.pose.bones[b].matrix_basis.copy() for b in original_bones})
        final = bpy.data.actions.new(name)
        final.use_fake_user = True
        bind_action(arm, final)
        min_tip, max_grip_error = 100, 0
        first_hips = None
        for frame, values in enumerate(samples):
            scene.frame_set(frame)
            for b, basis in values.items():
                arm.pose.bones[b].matrix_basis = basis
            arm.pose.bones[WEAPON].matrix_basis = Matrix.Identity(4)
            bpy.context.view_layer.update()
            hip = arm.pose.bones[HIPS]
            hip_matrix = hip.matrix.copy()
            if first_hips is None:
                first_hips = hip_matrix.translation.copy()
            if name == 'Die':
                hip_matrix.translation.x -= first_hips.x
                hip_matrix.translation.y -= first_hips.y
            else:
                hip_matrix.translation.x = 0
                hip_matrix.translation.y = 0
            hip.matrix = hip_matrix
            bpy.context.view_layer.update()
            clear_sword_arm(arm)
            hang_cape(arm, frame / 30)
            hand = arm.pose.bones[HAND]
            hand.matrix = hand.matrix @ correction_local.to_4x4()
            bpy.context.view_layer.update()
            # Rotate the gripping wrist about its own pivot when a long blade
            # would enter the floor. The gauntlet follows, preserving contact.
            for _ in range(6):
                matrix = arm.pose.bones[WEAPON].matrix @ arm.data.bones[WEAPON].matrix_local.inverted()
                grip, tip = matrix @ GRIP, matrix @ TIP
                lowest = min((matrix @ p for p in weapon_points), key=lambda p: p.z)
                if lowest.z >= .035:
                    break
                reach = (lowest - grip).length
                direction = (lowest - grip).normalized()
                target = direction.copy()
                target.z = max(-.95, min(.95, (.045 - grip.z) / reach))
                horizontal = Vector((direction.x, direction.y, 0))
                if horizontal.length < .001:
                    horizontal = Vector((0, -1, 0))
                horizontal.normalize()
                horizontal *= math.sqrt(max(0, 1 - target.z * target.z))
                target.x, target.y = horizontal.x, horizontal.y
                rotation = direction.rotation_difference(target).to_matrix().to_4x4()
                pivot = hand.matrix.translation.copy()
                hand.matrix = Matrix.Translation(pivot) @ rotation @ Matrix.Translation(-pivot) @ hand.matrix
                bpy.context.view_layer.update()
            pronate_forearm(arm, dorsal_rest)
            matrix = arm.pose.bones[WEAPON].matrix @ arm.data.bones[WEAPON].matrix_local.inverted()
            grip, tip = matrix @ GRIP, matrix @ TIP
            expected_grip = hand.matrix @ hand_rest_inv @ GRIP
            max_grip_error = max(max_grip_error, (expected_grip - grip).length)
            min_tip = min(min_tip, tip.z)
            for b in arm.pose.bones:
                b.rotation_mode = 'QUATERNION'
                b.keyframe_insert(data_path='location', frame=frame, group=b.name)
                b.keyframe_insert(data_path='rotation_quaternion', frame=frame, group=b.name)
                b.keyframe_insert(data_path='scale', frame=frame, group=b.name)
        processed[name] = final
        report['clips'][name] = {'frames': len(samples), 'fps': 30, 'duration': (len(samples) - 1) / 30,
                                  'gripErrorMeters': max_grip_error, 'minBladeTipZ': min_tip,
                                  'loop': name == 'Walk'}
        assert max_grip_error < .00001, (name, max_grip_error)
    for action in originals.values():
        bpy.data.actions.remove(action)
    bind_action(arm, processed['Walk'])
    scene.frame_set(0)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in (arm, body, weapon, cape):
        obj.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.data.orphans_purge(do_recursive=True)
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(output / 'BOSS1_preview.blend'))
    bpy.ops.export_scene.gltf(filepath=str(output / 'BOSS1_preview.glb'), export_format='GLB',
                              use_selection=True, export_animations=True,
                              export_animation_mode='ACTIONS', export_force_sampling=True,
                              export_frame_range=False, export_nla_strips=False,
                              export_skins=True, export_morph=False, export_yup=True, export_extras=True)
    report['outputSha256'] = hashlib.sha256((output / 'BOSS1_preview.glb').read_bytes()).hexdigest()
    (output / 'qa.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print('BOSS1_PREPARED', json.dumps(report['clips']))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--hand-source', type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    prepare(args.source, args.output, args.hand_source)
