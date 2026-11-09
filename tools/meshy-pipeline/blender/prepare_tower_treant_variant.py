"""Apply a supplied treant surface to the approved five-motion rig in Blender.

blender -b --python-exit-code 1 --python prepare_tower_treant_variant.py -- APPROVED.glb VARIANT.glb OUTPUT
The two meshes must have the same rest surface. Keep approved geometry, skin,
and all actions; transfer supplied material and per-corner UV by triangle.
"""
import hashlib
import json
from pathlib import Path
import sys

import bpy
from mathutils.kdtree import KDTree


def prepare(approved, variant, output):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = 30
    bpy.ops.import_scene.gltf(filepath=str(approved))
    arm = next(o for o in scene.objects if o.type == 'ARMATURE')
    body = next(o for o in scene.objects if o.type == 'MESH' and o.vertex_groups)
    for track in list(arm.animation_data.nla_tracks):
        arm.animation_data.nla_tracks.remove(track)
    actions = set(bpy.data.actions)
    assert {a.name for a in actions} == {'Unsteady_Walk', 'Weapon_Combo_2', 'Attack', 'Basic_Jump', 'Shot_and_Fall_Forward'}
    for action in actions:
        action.use_fake_user = True
    existing = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(variant))
    added = set(bpy.data.objects) - existing
    donor = next(o for o in added if o.type == 'MESH' and o.vertex_groups)
    # UV seams can split an otherwise identical surface into different vertex
    # counts. Require every triangle/corner to match uniquely instead of IDs.
    assert len(body.data.polygons) == len(donor.data.polygons)
    # Compare in the approved mesh's local coordinates, ignoring donor bones.
    inverse = body.matrix_world.inverted()
    points = [inverse @ donor.matrix_world @ v.co for v in donor.data.vertices]
    tree = KDTree(len(body.data.vertices))
    for v in body.data.vertices:
        tree.insert(v.co, v.index)
    tree.balance()
    keys, distances = [], []
    def key(p):
        return tuple(round(x, 5) for x in p)
    for point in points:
        near, _, distance = tree.find(point)
        assert distance < .00001, ('Different rest surface', distance)
        keys.append(key(near))
        distances.append(distance)
    faces = {}
    for face in donor.data.polygons:
        faces.setdefault(tuple(sorted(keys[i] for i in face.vertices)), []).append(face)
    target_uv, source_uv = body.data.uv_layers.active, donor.data.uv_layers.active
    for face in body.data.polygons:
        candidates = faces.get(tuple(sorted(key(body.data.vertices[i].co) for i in face.vertices)), [])
        assert len(candidates) == 1, ('Triangle mapping must be unique', face.index, len(candidates))
        source = candidates[0]
        face.material_index = source.material_index
        for li in face.loop_indices:
            p = body.data.vertices[body.data.loops[li].vertex_index].co
            source_li = min(source.loop_indices, key=lambda i: (points[donor.data.loops[i].vertex_index] - p).length_squared)
            target_uv.data[li].uv = source_uv.data[source_li].uv
    body.data.materials.clear()
    for material in donor.data.materials:
        body.data.materials.append(material)
    for obj in added:
        bpy.data.objects.remove(obj, do_unlink=True)
    for obj in list(scene.objects):
        if obj not in {arm, body}:
            bpy.data.objects.remove(obj, do_unlink=True)
    for action in list(bpy.data.actions):
        if action not in actions:
            bpy.data.actions.remove(action)
    arm.animation_data.action = bpy.data.actions['Unsteady_Walk']
    arm.animation_data.action_slot = arm.animation_data.action.slots[0]
    scene.frame_set(0)
    bpy.ops.object.select_all(action='DESELECT')
    arm.select_set(True)
    body.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.file.pack_all()
    output.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(output / 'Treant_LV2.blend'))
    model = output / 'treant_lv2.glb'
    bpy.ops.export_scene.gltf(filepath=str(model), export_format='GLB', use_selection=True,
                              export_animations=True, export_animation_mode='ACTIONS',
                              export_force_sampling=True, export_frame_range=False,
                              export_nla_strips=False, export_skins=True, export_morph=False,
                              export_yup=True, export_extras=True)
    report = {'blender': bpy.app.version_string, 'approvedSha256': hashlib.sha256(approved.read_bytes()).hexdigest(),
              'variantSha256': hashlib.sha256(variant.read_bytes()).hexdigest(),
              'outputSha256': hashlib.sha256(model.read_bytes()).hexdigest(),
              'vertices': len(body.data.vertices), 'donorVertices': len(points),
              'matchedTriangles': len(body.data.polygons),
              'maxRestSurfaceError': max(distances), 'bones': len(arm.data.bones),
              'actions': sorted(a.name for a in actions), 'geometryAndWeights': 'approved, unchanged',
              'materialAndUV': 'supplied ' + variant.name + ', exact triangle/corner mapping'}
    (output / 'surface-qa.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print('TREANT_VARIANT_PASS', json.dumps(report), flush=True)


if __name__ == '__main__':
    prepare(*map(Path, sys.argv[sys.argv.index('--') + 1:]))
