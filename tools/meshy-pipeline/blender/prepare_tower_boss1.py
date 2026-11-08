"""Prepare the user-authorized BOSS1 preview with a rigid, separate right sword.

blender -b --python-exit-code 1 --python prepare_tower_boss1.py -- INPUT OUTPUT
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


def prepare(source, output):
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
    # weights. Replace only the distal glove with anatomical, segmented armor
    # fingers wrapped around the grip; preserve the original wrist and forearm.
    old_hand_faces = {f.index for f in body.data.polygons
                      if f.center.x < -.695 and 1.28 < f.center.z < 1.435
                      and -.11 < f.center.y < .085}
    trim_faces(body, set(range(len(body.data.polygons))) - old_hand_faces)
    silver = bpy.data.materials.new('BOSS1_Silver_Gauntlet')
    silver.diffuse_color = (.39, .43, .46, 1)
    silver.use_nodes = True
    principled = silver.node_tree.nodes.get('Principled BSDF')
    principled.inputs['Base Color'].default_value = silver.diffuse_color
    principled.inputs['Metallic'].default_value = .62
    principled.inputs['Roughness'].default_value = .32
    hand_parts = []

    def hand_part(obj):
        obj.data.materials.clear()
        obj.data.materials.append(silver)
        for face in obj.data.polygons:
            face.use_smooth = True
        rigid_group(obj, HAND)
        hand_parts.append(obj)

    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, radius=1,
                                        location=(-.708, -.012, 1.365))
    palm = bpy.context.object
    palm.scale = (.053, .029, .058)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    hand_part(palm)

    def phalanx(a, b, radius):
        a, b = Vector(a), Vector(b)
        bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=radius, radius2=radius * .86,
                                        depth=(b - a).length, location=(a + b) / 2)
        obj = bpy.context.object
        obj.rotation_euler = (b - a).to_track_quat('Z', 'Y').to_euler()
        hand_part(obj)
        bpy.ops.mesh.primitive_uv_sphere_add(segments=8, ring_count=4, radius=radius * .98, location=b)
        hand_part(bpy.context.object)

    for z in (1.326, 1.352, 1.378, 1.404):
        points = [(-.732, .012, z), (-.766, .023, z), (-.806, -.002, z), (-.794, -.041, z)]
        for k in range(3):
            phalanx(points[k], points[k + 1], .012 - k * .001)
    thumb = [(-.693, -.047, 1.325), (-.726, -.061, 1.340),
             (-.761, -.052, 1.359), (-.779, -.039, 1.373)]
    for k in range(3):
        phalanx(thumb[k], thumb[k + 1], .014 - k * .0015)
    hand_vertices = list(range(sum(len(o.data.vertices) for o in hand_parts)))
    bpy.ops.object.select_all(action='DESELECT')
    for obj in [body] + hand_parts:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()

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
    bpy.ops.object.mode_set(mode='OBJECT')
    rigid_group(weapon, WEAPON)
    weapon_points = [v.co.copy() for v in weapon.data.vertices]
    arm.data.pose_position = 'POSE'
    hand_rest_inv = arm.data.bones[HAND].matrix_local.inverted()
    bind_action(arm, originals['Walk'])
    scene.frame_set(0)
    hand0 = arm.pose.bones[HAND].matrix.copy()
    original_dir = (hand0 @ hand_rest_inv).to_3x3() @ (TIP - GRIP).normalized()
    desired = Vector((0, -.80, -.60)).normalized()
    correction_world = original_dir.rotation_difference(desired).to_matrix()
    correction_local = hand0.to_3x3().inverted() @ correction_world @ hand0.to_3x3()
    print('WALK_SWORD_CORRECTION', list(original_dir), correction_local.to_quaternion().angle)

    original_bones = [b.name for b in arm.data.bones if b.name != WEAPON]
    report = {'blender': bpy.app.version_string, 'license': 'User confirmed self-created/generated and authorized game use/modification in chat, 2026-11-08',
              'sourceSha256': source_sha, 'weaponBone': WEAPON, 'weaponParent': HAND,
              'swordSourceFaces': len(sword_faces), 'closedHandVertices': len(hand_vertices),
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
    for obj in (arm, body, weapon):
        obj.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.data.orphans_purge(do_recursive=True)
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(output / 'BOSS1_preview.blend'))
    bpy.ops.export_scene.gltf(filepath=str(output / 'BOSS1_preview.glb'), export_format='GLB',
                              use_selection=True, export_animations=True,
                              export_animation_mode='ACTIONS', export_force_sampling=True,
                              export_frame_range=False, export_nla_strips=False,
                              export_skins=True, export_morph=False, export_yup=True)
    report['outputSha256'] = hashlib.sha256((output / 'BOSS1_preview.glb').read_bytes()).hexdigest()
    (output / 'qa.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print('BOSS1_PREPARED', json.dumps(report['clips']))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    prepare(args.source, args.output)
