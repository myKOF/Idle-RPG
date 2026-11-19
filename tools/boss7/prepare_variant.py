"""Apply a supplied BOSS7 material to the approved mesh, rig and five actions.

blender -b --python-exit-code 1 -P prepare_variant.py -- APPROVED.blend VARIANT.glb OUTPUT_DIR 2|3
"""
import bpy
import hashlib
import json
import sys
from pathlib import Path

approved, variant, output = map(Path, sys.argv[sys.argv.index('--') + 1:][:3])
number = int(sys.argv[-1])
assert number in (2, 3)
suffix = '_lv' + str(number)
output.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(approved))
scene = bpy.context.scene
arm = next(o for o in scene.objects if o.type == 'ARMATURE')
body = next(o for o in scene.objects if o.type == 'MESH' and o.vertex_groups)
actions = set(bpy.data.actions)
assert {a.name for a in actions} == {'Walk', 'Attack1', 'Attack2', 'Attack3', 'Die'}
existing = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=str(variant))
added = set(bpy.data.objects) - existing
donor = next(o for o in added if o.type == 'MESH' and o.vertex_groups)
assert len(body.data.vertices) == len(donor.data.vertices)
errors = [(a.co - b.co).length for a, b in zip(body.data.vertices, donor.data.vertices)]
assert max(errors) < 0.00001, ('Different rest surface', max(errors))
assert [tuple(p.vertices) for p in body.data.polygons] == [tuple(p.vertices) for p in donor.data.polygons]
assert len(body.data.uv_layers.active.data) == len(donor.data.uv_layers.active.data)
assert max((a.uv - b.uv).length for a, b in zip(body.data.uv_layers.active.data, donor.data.uv_layers.active.data)) < 0.000001
# The supplied rigs have different bone lengths (and material 3 adds index fingers).
# The surface/UV is identical, so retaining the approved skin avoids retargeting
# drift and keeps every motion identical to the first material.
body.data.materials.clear()
for material in donor.data.materials:
    body.data.materials.append(material)
for a, b in zip(body.data.polygons, donor.data.polygons):
    a.material_index = b.material_index
for obj in added:
    bpy.data.objects.remove(obj, do_unlink=True)
for action in list(bpy.data.actions):
    if action not in actions:
        bpy.data.actions.remove(action)
for action in actions:
    action.use_fake_user = True
ad = arm.animation_data
ad.action = bpy.data.actions['Walk']
ad.action_slot = ad.action.slots[0]
scene.frame_set(0)
bpy.ops.object.select_all(action='DESELECT')
arm.select_set(True)
body.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.export_scene.gltf(filepath=str(output / ('boss7' + suffix + '.glb')), export_format='GLB',
    use_selection=True, export_animations=True, export_animation_mode='ACTIONS',
    export_anim_single_armature=True, export_force_sampling=True, export_frame_step=1,
    export_reset_pose_bones=True, export_skins=True, export_image_format='AUTO')
ad.action = bpy.data.actions['Walk']
ad.action_slot = ad.action.slots[0]
scene.frame_set(0)
scene.render.filepath = str(output / ('boss7_rock' + suffix + '.png'))
bpy.data.orphans_purge(do_recursive=True)
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(output / ('boss7' + suffix + '.blend')), compress=True)
bpy.ops.render.render(write_still=True)
report = {'blender': bpy.app.version_string, 'approvedSha256': hashlib.sha256(approved.read_bytes()).hexdigest(),
    'variantSha256': hashlib.sha256(variant.read_bytes()).hexdigest(), 'material': number,
    'vertices': len(body.data.vertices), 'matchedTriangles': len(body.data.polygons),
    'maxRestSurfaceError': max(errors), 'bones': len(arm.data.bones),
    'actions': {a.name: (a.frame_range[1] - a.frame_range[0]) / scene.render.fps for a in actions},
    'geometryAndWeights': 'approved, unchanged', 'materialAndUV': 'supplied material; identical UV',
    'portrait': [1080, 1080]}
(output / ('model-qa' + suffix + '.json')).write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print('BOSS7_VARIANT_PASS', json.dumps(report), flush=True)
