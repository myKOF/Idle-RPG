"""Save packed Blender source and portrait from the third-boss five-clip GLB.

blender -b --python-exit-code 1 --python prepare_tower_boss3_character.py -- MODEL.glb OUTPUT
The game export retains the walk surface and the five supplied animation clips.
"""
import hashlib
import json
from pathlib import Path
import sys

import bpy
from mathutils import Vector


def prepare(model, output):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = 30
    bpy.ops.import_scene.gltf(filepath=str(model))
    arm = next(o for o in scene.objects if o.type == 'ARMATURE')
    meshes = [o for o in scene.objects if o.type == 'MESH' and o.vertex_groups]
    for obj in list(scene.objects):
        if obj.type == 'MESH' and obj not in meshes:
            bpy.data.objects.remove(obj, do_unlink=True)
    for track in list(arm.animation_data.nla_tracks):
        arm.animation_data.nla_tracks.remove(track)
    assert {a.name for a in bpy.data.actions} == {'Running', 'Basic_Jump', 'Right_Hand_Sword_Slash',
                                                'Shield_Push_Left', 'Shot_and_Fall_Forward'}
    for action in bpy.data.actions:
        action.use_fake_user = True
    action = bpy.data.actions['Running']
    arm.animation_data.action = action
    arm.animation_data.action_slot = action.slots[0]
    scene.frame_set(0)
    points = [o.evaluated_get(bpy.context.evaluated_depsgraph_get()).matrix_world @ Vector(p)
              for o in meshes for p in o.evaluated_get(bpy.context.evaluated_depsgraph_get()).bound_box]
    low = Vector(tuple(min(p[i] for p in points) for i in range(3)))
    high = Vector(tuple(max(p[i] for p in points) for i in range(3)))
    world = bpy.data.worlds.new('Portrait studio')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (.06, .075, .10, 1)
    world.node_tree.nodes['Background'].inputs[1].default_value = .35
    scene.world = world
    for name, location, power, color in [('Key', (-3, -4, 5), 650, (1, .88, .72)),
                                          ('Fill', (4, -2, 3), 450, (.68, .82, 1)),
                                          ('Rim', (1, 3, 4), 1000, (.72, .83, 1))]:
        light = bpy.data.lights.new(name, 'AREA')
        light.energy, light.shape, light.size, light.color = power, 'DISK', 4, color
        obj = bpy.data.objects.new(name, light)
        scene.collection.objects.link(obj)
        obj.location = location
        obj.rotation_euler = (Vector((0, 0, 1)) - obj.location).to_track_quat('-Z', 'Y').to_euler()
    camera_data = bpy.data.cameras.new('Portrait camera')
    camera_data.type = 'ORTHO'
    camera = bpy.data.objects.new('Portrait camera', camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    target = Vector(((low.x + high.x) / 2, (low.y + high.y) / 2, low.z + (high.z - low.z) * .68))
    camera.location = target + Vector((.2, -4, .12))
    camera.rotation_euler = (target - camera.location).to_track_quat('-Z', 'Y').to_euler()
    camera_data.ortho_scale = max((high.x - low.x) * .95, (high.z - low.z) * .76)
    scene.render.engine = 'BLENDER_EEVEE_NEXT' if bpy.app.version < (5, 0, 0) else 'BLENDER_EEVEE'
    scene.eevee.taa_render_samples = 16
    scene.view_settings.view_transform = 'AgX'
    scene.render.resolution_x = scene.render.resolution_y = 1080
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    output.mkdir(parents=True, exist_ok=True)
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(output / 'BOSS3_Character.blend'))
    scene.render.filepath = str(output / 'boss3_character.png')
    bpy.ops.render.render(write_still=True)
    report = {'sourceSha256': hashlib.sha256(model.read_bytes()).hexdigest(),
              'clip': action.name, 'seconds': (action.frame_range[1] - action.frame_range[0]) / 30,
              'clips': {a.name: (a.frame_range[1] - a.frame_range[0]) / 30 for a in bpy.data.actions},
              'bones': len(arm.data.bones), 'meshes': len(meshes),
              'vertices': sum(len(o.data.vertices) for o in meshes),
              'triangles': sum(len(o.data.polygons) for o in meshes),
              'bounds': [list(low), list(high)], 'portrait': [1080, 1080],
              'gameExport': 'walk geometry/materials unchanged; four supplied clips appended',
              'blender': bpy.app.version_string}
    (output / 'model-qa.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print('BOSS3_WALK_PASS', json.dumps(report), flush=True)


if __name__ == '__main__':
    prepare(*map(Path, sys.argv[sys.argv.index('--') + 1:]))
