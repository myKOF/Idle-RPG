"""Render the actual NPC-table GLB at native 1080px, preserving clip speed.

blender -b --python-exit-code 1 --python render_tower_boss1.py -- OUTPUT [--npc tower_boss_1]
Use --only Attack3 --camera front --speed 0.2 for the five-times-slower front inspection.
"""
import argparse
import csv
import hashlib
import json
import math
from pathlib import Path
import sys

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[3]
MAPPING = [('Walk', '3D移動動作'), ('Attack1', '3D攻擊1動作'),
           ('Attack2', '3D攻擊2動作'), ('Attack3', '3D攻擊3動作'), ('Die', '3D死亡動作')]


def render(output, npc, only=None, camera_view='three-quarter', speed=1, fps=25, portrait=False):
    with (ROOT / 'config/CSV/NPC.csv').open(encoding='utf-8-sig', newline='') as file:
        row = next(r for r in csv.DictReader(file) if r['NPC識別碼'] == npc and r['類型'] == 'tower_boss')
    model = ROOT / row['3D模型']
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
    scene.render.engine = 'BLENDER_EEVEE'
    scene.eevee.taa_render_samples = 48
    scene.render.resolution_x = scene.render.resolution_y = 1080
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
    for name, loc, power, size, color in [
            ('Key', (-3, -4, 5), 650, 4, (1, .88, .72)),
            ('Fill', (4, -2, 3), 450, 4, (.68, .82, 1)),
            ('Rim', (1, 3, 4), 1000, 3, (.72, .83, 1))]:
        light = bpy.data.lights.new(name, 'AREA')
        light.energy, light.shape, light.size, light.color = power, 'DISK', size, color
        obj = bpy.data.objects.new(name, light)
        scene.collection.objects.link(obj)
        obj.location = loc
        obj.rotation_euler = (Vector((0, 0, 1)) - obj.location).to_track_quat('-Z', 'Y').to_euler()
    slate = bpy.data.materials.new('Matte slate floor')
    slate.use_nodes = True
    bsdf = slate.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (.018, .023, .033, 1)
    bsdf.inputs['Roughness'].default_value = .8
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -.005))
    floor = bpy.context.object
    floor.data.materials.append(slate)
    camera_data = bpy.data.cameras.new('Fixed clip camera')
    camera_data.type = 'ORTHO'
    camera = bpy.data.objects.new('Fixed clip camera', camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    directions = {'front': (0, -5.5, .55), 'rear': (2, 5.5, 1.2), 'three-quarter': (2, -5.5, 2)}
    direction = Vector(directions[camera_view]).normalized()
    rotation = (-direction).to_track_quat('-Z', 'Y')
    camera.rotation_euler = rotation.to_euler()
    inverse_rotation = rotation.inverted()
    if portrait:
        action = bpy.data.actions[row['3D站立動作']]
        arm.animation_data.action = action
        arm.animation_data.action_slot = action.slots[0]
        scene.frame_set(0)
        floor.hide_render = True
        scene.render.film_transparent = True
        scene.render.image_settings.color_mode = 'RGBA'
        scene.render.image_settings.compression = 70
        direction = Vector((.35, -7, .85)).normalized()
        rotation = (-direction).to_track_quat('-Z', 'Y')
        body = next(obj for obj in meshes if obj.name == 'BOSS1_Body')
        evaluated = body.evaluated_get(bpy.context.evaluated_depsgraph_get())
        upper_body = [rotation.inverted() @ (evaluated.matrix_world @ evaluated.data.vertices[v.index].co)
                      for v in body.data.vertices if v.co.z > 1.15 and abs(v.co.x) < .48]
        low = Vector(tuple(min(p[i] for p in upper_body) for i in range(3)))
        high = Vector(tuple(max(p[i] for p in upper_body) for i in range(3)))
        target = rotation @ ((low + high) / 2)
        camera.location = target + direction * 8
        camera.rotation_euler = rotation.to_euler()
        camera_data.ortho_scale = max(high.x - low.x, high.y - low.y) * 1.15
        scene.render.filepath = str(output / 'boss_skeleton_king.png')
        bpy.ops.render.render(write_still=True)
        (output / 'portrait-source.json').write_text(json.dumps({
            'model': row['3D模型'], 'modelSha256': hashlib.sha256(model.read_bytes()).hexdigest(),
            'clip': action.name, 'frame': 0, 'dimensions': [1080, 1080], 'transparent': True
        }, indent=2), encoding='utf-8')
        return
    manifest = {'npc': npc, 'model': row['3D模型'], 'width': 1080, 'height': 1080,
                'renderFps': fps, 'camera': camera_view, 'playbackSpeed': speed,
                'engine': 'Blender EEVEE', 'clips': {}}
    if only and (output / 'manifest.json').exists():
        manifest = json.loads((output / 'manifest.json').read_text(encoding='utf-8'))
        if (manifest.get('camera', 'three-quarter') != camera_view
                or manifest.get('renderFps', 25) != fps
                or manifest.get('playbackSpeed', 1) != speed):
            raise ValueError('Use a fresh output directory when changing camera, speed or fps')
    for semantic, field in MAPPING:
        if only and semantic not in only:
            continue
        action = bpy.data.actions.get(row[field])
        if action is None:
            raise ValueError(f'{field}: {row[field]} does not exist in the exported GLB')
        arm.animation_data.action = action
        arm.animation_data.action_slot = action.slots[0]
        start, end = action.frame_range
        source_duration = (end - start) / 30
        duration = source_duration / speed
        projected = []
        for index in range(61):
            frame = start + (end - start) * index / 60
            scene.frame_set(math.floor(frame), subframe=frame % 1)
            depsgraph = bpy.context.evaluated_depsgraph_get()
            for obj in meshes:
                evaluated = obj.evaluated_get(depsgraph)
                projected.extend(inverse_rotation @ (evaluated.matrix_world @ Vector(p)) for p in evaluated.bound_box)
        low = Vector(tuple(min(p[i] for p in projected) for i in range(3)))
        high = Vector(tuple(max(p[i] for p in projected) for i in range(3)))
        target = rotation @ ((low + high) / 2)
        camera.location = target + direction * 8
        camera_data.ortho_scale = max(high.x - low.x, high.y - low.y) * 1.18
        count = max(2, math.ceil(duration * fps))
        directory = output / semantic
        directory.mkdir(exist_ok=True)
        for index in range(count):
            time = min(source_duration, index / fps * speed)
            frame = start + time * 30
            scene.frame_set(math.floor(frame), subframe=frame % 1)
            scene.render.filepath = str(directory / f'{index:04d}.png')
            bpy.ops.render.render(write_still=True)
        manifest['clips'][semantic] = {'clip': row[field], 'frames': count, 'duration': duration,
                                       'sourceDuration': source_duration, 'playbackSpeed': speed,
                                       'loop': semantic == 'Walk', 'cameraSpan': camera_data.ortho_scale}
        print('CLIP_RENDERED', semantic, count, flush=True)
    arm.data.pose_position = 'REST'
    target = Vector((-.765, -.025, 1.35))
    camera.location = target + Vector((.65, -2, .35))
    camera.rotation_euler = (target - camera.location).to_track_quat('-Z', 'Y').to_euler()
    camera_data.ortho_scale = .53
    scene.render.filepath = str(output / 'grip-detail.png')
    bpy.ops.render.render(write_still=True)
    (output / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('output', type=Path)
    parser.add_argument('--npc', default='tower_boss_1')
    parser.add_argument('--only', nargs='+', choices=[key for key, _ in MAPPING])
    parser.add_argument('--camera', choices=['front', 'rear', 'three-quarter'], default='three-quarter')
    parser.add_argument('--speed', type=float, default=1)
    parser.add_argument('--fps', type=int, default=25)
    parser.add_argument('--portrait', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    if not 0 < args.speed <= 4 or not 1 <= args.fps <= 60:
        parser.error('speed must be positive and fps must be within 1..60')
    render(args.output, args.npc, args.only, args.camera, args.speed, args.fps, args.portrait)
