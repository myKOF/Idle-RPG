"""Render the actual second-stage treant from its NPC row, preserving speed."""
import argparse
import csv
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import sys
import bpy
from mathutils import Vector

spec = importlib.util.spec_from_file_location('treant', Path(__file__).with_name('render_tower_treant.py'))
treant = importlib.util.module_from_spec(spec)
spec.loader.exec_module(treant)


def render(output, root, portrait=False, size=1080, samples=32, fps=20, only=None, npc='tower_boss_12'):
    with (root / 'config/CSV/NPC.csv').open(encoding='utf-8-sig', newline='') as file:
        row = next(r for r in csv.DictReader(file) if r['NPC識別碼'] == npc)
    model = root / row['3D模型']
    output.mkdir(parents=True, exist_ok=True)
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
    scene.render.engine = 'BLENDER_EEVEE_NEXT' if bpy.app.version < (5, 0, 0) else 'BLENDER_EEVEE'
    if hasattr(scene, 'eevee'):
        scene.eevee.taa_render_samples = samples
    scene.render.resolution_x = scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGB'
    scene.render.image_settings.compression = 15
    scene.view_settings.view_transform = 'AgX'
    world = bpy.data.worlds.new('Slate studio')
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
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -.005))
    material = bpy.data.materials.new('Matte slate floor')
    material.diffuse_color = (.018, .023, .033, 1)
    bpy.context.object.data.materials.append(material)
    camera_data = bpy.data.cameras.new('Fixed clip camera')
    camera_data.type = 'ORTHO'
    camera = bpy.data.objects.new('Fixed clip camera', camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    if portrait:
        treant.render_portrait(output)
        (output / 'portrait-source.json').write_text(json.dumps({'model': row['3D模型'],
            'modelSha256': hashlib.sha256(model.read_bytes()).hexdigest(), 'dimensions': [size, size],
            'transparent': True, 'clip': row['3D站立動作']}, indent=2), encoding='utf-8')
    else:
        direction = Vector((2, -5.5, 2)).normalized()
        rotation = (-direction).to_track_quat('-Z', 'Y')
        camera.rotation_euler = rotation.to_euler()
        manifest = {'npc': row['NPC識別碼'], 'model': row['3D模型'],
                    'modelSha256': hashlib.sha256(model.read_bytes()).hexdigest(),
                    'width': size, 'height': size, 'renderFps': 20, 'playbackSpeed': 1,
                    'engine': 'Blender EEVEE', 'blender': bpy.app.version_string, 'clips': {}}
        if only and (output / 'manifest.json').exists():
            existing = json.loads((output / 'manifest.json').read_text(encoding='utf-8'))
            assert existing['modelSha256'] == manifest['modelSha256'] and existing['width'] == size
            manifest = existing
        for semantic, field in treant.renderer.MAPPING:
            if only and semantic not in only:
                continue
            action = bpy.data.actions[row[field]]
            arm.animation_data.action = action
            arm.animation_data.action_slot = action.slots[0]
            start, end = action.frame_range
            duration = (end - start) / 30
            projected = []
            for i in range(61):
                frame = start + (end - start) * i / 60
                scene.frame_set(math.floor(frame), subframe=frame % 1)
                for obj in meshes:
                    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
                    projected.extend(rotation.inverted() @ (evaluated.matrix_world @ Vector(p)) for p in evaluated.bound_box)
            low = Vector(tuple(min(p[i] for p in projected) for i in range(3)))
            high = Vector(tuple(max(p[i] for p in projected) for i in range(3)))
            camera.location = rotation @ ((low + high) / 2) + direction * 8
            camera_data.ortho_scale = max(high.x - low.x, high.y - low.y) * 1.18
            count = math.ceil(duration * fps)
            directory = output / semantic
            directory.mkdir(exist_ok=True)
            for i in range(count):
                frame = start + min(duration, i / fps) * 30
                scene.frame_set(math.floor(frame), subframe=frame % 1)
                scene.render.filepath = str(directory / f'{i:04d}.png')
                bpy.ops.render.render(write_still=True)
            manifest['clips'][semantic] = {'clip': action.name, 'frames': count, 'duration': duration,
                                           'sourceDuration': duration, 'playbackSpeed': 1, 'fps': fps}
            (output / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
            print('CLIP_RENDERED', semantic, count, flush=True)
    treant.save_scene(output)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('output', type=Path)
    parser.add_argument('--portrait', action='store_true')
    parser.add_argument('--npc', default='tower_boss_12')
    parser.add_argument('--size', type=int, default=1080)
    parser.add_argument('--samples', type=int, default=32)
    parser.add_argument('--fps', type=int, choices=[10, 20, 25], default=20)
    parser.add_argument('--only', nargs='+', choices=[name for name, _ in treant.renderer.MAPPING])
    parser.add_argument('--config-root', type=Path, help='Optional isolated NPC/GLB snapshot for preview before table integration')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    render(args.output, args.config_root.resolve() if args.config_root else treant.renderer.ROOT,
           args.portrait, args.size, args.samples, args.fps, args.only, args.npc)
