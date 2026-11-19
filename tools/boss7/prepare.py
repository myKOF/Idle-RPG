"""Combine the five user-supplied BOSS7 actions in Blender and render its portrait.

blender -b --python-exit-code 1 -P tools/boss7/prepare.py -- SOURCE_DIR OUTPUT_DIR
"""
import bpy
import hashlib
import json
import sys
from pathlib import Path
from mathutils import Vector

source, output = map(Path, sys.argv[sys.argv.index('--') + 1:])
output.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 30
arm = None
records = []
for name in ['Walk', 'Attack1', 'Attack2', 'Attack3', 'Die']:
    file = source / ('BOSS7_' + name + '.glb')
    old_objects = set(bpy.data.objects)
    old_actions = set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=str(file))
    imported = set(bpy.data.objects) - old_objects
    rig = next(o for o in imported if o.type == 'ARMATURE')
    action, = set(bpy.data.actions) - old_actions
    records.append({'file': file.name, 'sha256': hashlib.sha256(file.read_bytes()).hexdigest(),
                    'originalClip': action.name, 'clip': name,
                    'seconds': (action.frame_range[1] - action.frame_range[0]) / scene.render.fps})
    action.name = name
    action.use_fake_user = True
    if arm is None:
        arm = rig
    else:
        assert set(arm.data.bones.keys()) == set(rig.data.bones.keys())
        for bone in arm.data.bones:
            assert max(abs(bone.matrix_local[r][c] - rig.data.bones[bone.name].matrix_local[r][c])
                       for r in range(4) for c in range(4)) < 0.0001, bone.name
        for obj in imported:
            bpy.data.objects.remove(obj, do_unlink=True)

ad = arm.animation_data
for track in list(ad.nla_tracks):
    ad.nla_tracks.remove(track)
ad.action = bpy.data.actions['Walk']
ad.action_slot = ad.action.slots[0]
scene.frame_set(0)
bpy.context.view_layer.update()
bpy.ops.object.select_all(action='DESELECT')
for obj in scene.objects:
    obj.select_set(True)
# Blender owns animation sampling, materials and GLB export.
bpy.ops.export_scene.gltf(filepath=str(output / 'boss7.glb'), export_format='GLB',
    use_selection=True, export_animations=True, export_animation_mode='ACTIONS',
    export_anim_single_armature=True, export_force_sampling=True, export_frame_step=1,
    export_reset_pose_bones=True, export_skins=True, export_image_format='AUTO')

ad.action = bpy.data.actions['Walk']
ad.action_slot = ad.action.slots[0]
scene.frame_set(0)
bpy.context.view_layer.update()
points = []
dg = bpy.context.evaluated_depsgraph_get()
for obj in scene.objects:
    if obj.type == 'MESH' and obj.vertex_groups:
        evaluated = obj.evaluated_get(dg)
        mesh = evaluated.to_mesh()
        points += [evaluated.matrix_world @ v.co for v in mesh.vertices]
        evaluated.to_mesh_clear()
low = Vector(tuple(min(p[i] for p in points) for i in range(3)))
high = Vector(tuple(max(p[i] for p in points) for i in range(3)))
target = Vector(((low.x + high.x) / 2, (low.y + high.y) / 2, low.z + (high.z - low.z) * .70))
camera_data = bpy.data.cameras.new('Portrait')
camera_data.type = 'ORTHO'
camera_data.ortho_scale = (high.z - low.z) * .64
camera = bpy.data.objects.new('Portrait', camera_data)
scene.collection.objects.link(camera)
camera.location = target + Vector((.2, -5, .08))
camera.rotation_euler = (target - camera.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = camera
world = bpy.data.worlds.new('Studio')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = (.45, .50, .58, 1)
world.node_tree.nodes['Background'].inputs[1].default_value = .7
scene.world = world
for name, location, power in [('Key', (-3, -4, 5), 650), ('Fill', (4, -2, 3), 450), ('Rim', (1, 3, 4), 800)]:
    light = bpy.data.lights.new(name, 'AREA')
    light.energy, light.shape, light.size = power, 'DISK', 4
    obj = bpy.data.objects.new(name, light)
    scene.collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler = (target - obj.location).to_track_quat('-Z', 'Y').to_euler()
scene.render.engine = 'BLENDER_EEVEE_NEXT'
scene.eevee.taa_render_samples = 32
scene.view_settings.view_transform = 'AgX'
scene.render.resolution_x = scene.render.resolution_y = 1080
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.filepath = str(output / 'boss7_rock.png')
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(output / 'boss7.blend'))
bpy.ops.render.render(write_still=True)
(output / 'model-qa.json').write_text(json.dumps({'blender': bpy.app.version_string,
    'sources': records, 'bounds': [list(low), list(high)], 'bones': len(arm.data.bones),
    'portrait': [1080, 1080]}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('BOSS7_PASS', json.dumps(records), flush=True)
