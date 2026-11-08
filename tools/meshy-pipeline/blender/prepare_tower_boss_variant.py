"""Fit a material variant to the approved BOSS rig without changing its motions.

blender -b --python-exit-code 1 --python prepare_tower_boss_variant.py -- APPROVED.glb VARIANT.glb OUTPUT
UVs are transferred by matching the original surface triangles, not vertex IDs.
The variant's sword is freshly extracted and rigidly bound to a recreated bone.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys

import bmesh
import bpy
from mathutils import Vector
from mathutils.kdtree import KDTree


def trim(obj, faces):
    mesh = bmesh.new()
    mesh.from_mesh(obj.data)
    mesh.faces.ensure_lookup_table()
    bmesh.ops.delete(mesh, geom=[f for f in mesh.faces if f.index not in faces], context='FACES')
    bmesh.ops.delete(mesh, geom=[v for v in mesh.verts if not v.link_faces], context='VERTS')
    mesh.to_mesh(obj.data)
    mesh.free()
    obj.data.update()


def prepare(approved, variant, output, probe=False):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = 60  # Preserve the approved cape's half-frame collision samples.
    bpy.ops.import_scene.gltf(filepath=str(approved))
    arm, body, cape, old_sword = [bpy.data.objects[name] for name in
                                 ['BOSS1_Rig', 'BOSS1_Body', 'BOSS1_Cape', 'BOSS1_Sword']]
    for track in list(arm.animation_data.nla_tracks):
        arm.animation_data.nla_tracks.remove(track)
    approved_actions = set(bpy.data.actions)
    assert sorted(action.name for action in approved_actions) == ['Attack1', 'Attack2', 'Attack3', 'Die', 'Walk']
    for action in approved_actions:
        action.use_fake_user = True  # Keep all five after their import-only NLA tracks are removed.
    existing_objects = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(variant))
    added = set(bpy.data.objects) - existing_objects
    donor = next(obj for obj in added if obj.type == 'MESH' and obj.vertex_groups)
    # Both files use the same surface at different normalized character heights.
    target_points = [body.matrix_world @ v.co for v in body.data.vertices]
    donor_points = [donor.matrix_world @ v.co for v in donor.data.vertices]
    target_height = max(p.z for p in target_points) - min(p.z for p in target_points)
    donor_height = max(p.z for p in donor_points) - min(p.z for p in donor_points)
    scale = target_height / donor_height
    inverse = body.matrix_world.inverted()
    for vertex, point in zip(donor.data.vertices, donor_points):
        vertex.co = inverse @ (point * scale)
    donor.matrix_world = body.matrix_world.copy()
    donor.data.update()
    def point_key(point):
        return tuple(round(value, 4) for value in point)
    def face_key(obj, face):
        return tuple(sorted(point_key(obj.data.vertices[index].co) for index in face.vertices))
    canonical = [vertex.co.copy() for obj in [body, cape, old_sword]
                 for face in obj.data.polygons if obj.data.materials[face.material_index].name == 'BakedMaterial'
                 for vertex in (obj.data.vertices[i] for i in face.vertices)]
    tree = KDTree(len(canonical))
    for index, point in enumerate(canonical):
        tree.insert(point, index)
    tree.balance()
    # A normalized export changes the last float bits. Snap only for matching;
    # retain the supplied source geometry itself in the extracted sword.
    donor_keys = []
    distances = []
    for vertex in donor.data.vertices:
        point, _, distance = tree.find(vertex.co)
        donor_keys.append(point_key(point) if distance < .00003 else None)
        distances.append(distance)
    matches = {}
    for face in donor.data.polygons:
        keys = [donor_keys[index] for index in face.vertices]
        if all(key is not None for key in keys):
            matches.setdefault(tuple(sorted(keys)), []).append(face.index)
    donor_uv = donor.data.uv_layers.active
    report = {'approvedSha256': hashlib.sha256(approved.read_bytes()).hexdigest(),
              'variantSha256': hashlib.sha256(variant.read_bytes()).hexdigest(),
              'scaleToApproved': scale, 'donorVertices': len(donor.data.vertices),
              'meshes': {}, 'sourceSwordFaces': []}
    sword_faces = set()
    for obj in [body, cape, old_sword]:
        uv = obj.data.uv_layers.active
        matched, missing, ambiguity = 0, [], 0
        for face in obj.data.polygons:
            material = obj.data.materials[face.material_index]
            if material.name != 'BakedMaterial':
                continue  # Approved anatomical glove and leather retain their materials.
            candidates = matches.get(face_key(obj, face), [])
            if not candidates:
                missing.append(face.index)
                continue
            source = max((donor.data.polygons[i] for i in candidates), key=lambda f: f.normal.dot(face.normal))
            if len(candidates) > 1:
                ambiguity += 1
            for loop_index in face.loop_indices:
                point = obj.data.vertices[obj.data.loops[loop_index].vertex_index].co
                best = min(source.loop_indices,
                           key=lambda i: (donor.data.vertices[donor.data.loops[i].vertex_index].co - point).length_squared)
                uv.data[loop_index].uv = donor_uv.data[best].uv
            if obj == old_sword:
                sword_faces.add(source.index)
            matched += 1
        report['meshes'][obj.name] = {'matchedFaces': matched, 'missingFaces': missing, 'duplicateCandidates': ambiguity}
    report['sourceSwordFaces'] = sorted(sword_faces)
    output.mkdir(parents=True, exist_ok=True)
    (output / 'variant-qa.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print('VARIANT_SURFACE_MATCH', json.dumps(report), flush=True)
    assert all(not item['missingFaces'] for item in report['meshes'].values()), 'Material surface mapping is incomplete'
    if probe:
        return
    material = donor.data.materials[0]
    material.name = 'BOSS_LV2_PBR'
    for obj in [body, cape]:
        for index, slot in enumerate(obj.material_slots):
            if slot.material.name == 'BakedMaterial':
                obj.data.materials[index] = material
    # Extract native metal parts from the supplied fused mesh; do not simply
    # duplicate the old sword under a new material name.
    sword = donor.copy()
    sword.data = donor.data.copy()
    scene.collection.objects.link(sword)
    trim(sword, sword_faces)
    for modifier in list(sword.modifiers):
        sword.modifiers.remove(modifier)
    sword.parent = arm
    sword.matrix_world = old_sword.matrix_world.copy()
    sword.vertex_groups.clear()
    sword.vertex_groups.new(name='Sword_R').add(list(range(len(sword.data.vertices))), 1, 'REPLACE')
    # Retain the approved, fitted leather handle.
    handle = old_sword.copy()
    handle.data = old_sword.data.copy()
    scene.collection.objects.link(handle)
    trim(handle, {f.index for f in handle.data.polygons
                  if handle.data.materials[f.material_index].name == 'BOSS1_Grip_Leather'})
    bpy.ops.object.select_all(action='DESELECT')
    sword.select_set(True)
    handle.select_set(True)
    bpy.context.view_layer.objects.active = sword
    bpy.ops.object.join()
    bpy.data.objects.remove(old_sword, do_unlink=True)
    sword.name = 'BOSS1_Sword'
    # The bone is recreated with the same rest transform and animation paths.
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    old_bone = arm.data.edit_bones['Sword_R']
    matrix, length = old_bone.matrix.copy(), old_bone.length
    arm.data.edit_bones.remove(old_bone)
    bone = arm.data.edit_bones.new('Sword_R')
    bone.matrix = matrix
    bone.length = length
    bone.parent = arm.data.edit_bones['mixamorig:RightHand']
    bpy.ops.object.mode_set(mode='OBJECT')
    modifier = sword.modifiers.new('Rigid right-hand sword', 'ARMATURE')
    modifier.object = arm
    for obj in added:
        bpy.data.objects.remove(obj, do_unlink=True)
    for action in list(bpy.data.actions):
        if action not in approved_actions:
            bpy.data.actions.remove(action)
    arm.animation_data.action = bpy.data.actions['Walk']
    arm.animation_data.action_slot = arm.animation_data.action.slots[0]
    scene.frame_set(0)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in [arm, body, cape, sword]:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.data.orphans_purge(do_recursive=True)
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(output / 'BOSS2_preview.blend'))
    bpy.ops.export_scene.gltf(filepath=str(output / 'BOSS2_preview.glb'), export_format='GLB',
                              use_selection=True, export_animations=True,
                              export_animation_mode='ACTIONS', export_force_sampling=True,
                              export_frame_range=False, export_nla_strips=False,
                              export_skins=True, export_morph=False, export_yup=True, export_extras=True)
    report['outputSha256'] = hashlib.sha256((output / 'BOSS2_preview.glb').read_bytes()).hexdigest()
    (output / 'variant-qa.json').write_text(json.dumps(report, indent=2), encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('approved', type=Path)
    parser.add_argument('variant', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--probe', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    prepare(args.approved, args.variant, args.output, args.probe)
