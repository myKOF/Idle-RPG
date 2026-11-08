"""Render the NPC-table treant and save an editable packed Blender scene.

blender -b --python-exit-code 1 --python render_tower_treant.py -- OUTPUT
"""
import argparse
import importlib.util
from pathlib import Path
import sys
import bpy
from mathutils import Vector

spec = importlib.util.spec_from_file_location('boss_renderer', Path(__file__).with_name('render_tower_boss1.py'))
renderer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(renderer)


def save_scene(output):
    scene = bpy.context.scene
    arm = next(o for o in scene.objects if o.type == 'ARMATURE')
    arm.data.pose_position = 'POSE'
    for action in bpy.data.actions:
        action.use_fake_user = True
    arm.animation_data.action = bpy.data.actions['Unsteady_Walk']
    arm.animation_data.action_slot = arm.animation_data.action.slots[0]
    scene.frame_set(0)
    points = [o.matrix_world @ Vector(p) for o in scene.objects if o.type == 'MESH' and o.vertex_groups
              for p in o.evaluated_get(bpy.context.evaluated_depsgraph_get()).bound_box]
    low = Vector(tuple(min(p[i] for p in points) for i in range(3)))
    high = Vector(tuple(max(p[i] for p in points) for i in range(3)))
    target = (low + high) / 2
    direction = Vector((2, -5.5, 2)).normalized()
    scene.camera.location = target + direction * 8
    scene.camera.rotation_euler = (-direction).to_track_quat('-Z', 'Y').to_euler()
    scene.camera.data.ortho_scale = max(high.x - low.x, high.z - low.z) * 1.25
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(output / 'Treant_preview.blend'))


def render_portrait(output):
    scene = bpy.context.scene
    arm = next(o for o in scene.objects if o.type == 'ARMATURE')
    arm.data.pose_position = 'POSE'
    arm.animation_data.action = bpy.data.actions['Unsteady_Walk']
    arm.animation_data.action_slot = arm.animation_data.action.slots[0]
    scene.frame_set(0)
    body = max((o for o in scene.objects if o.type == 'MESH' and o.vertex_groups), key=lambda o: len(o.data.vertices))
    points = [body.matrix_world @ Vector(p) for p in body.evaluated_get(bpy.context.evaluated_depsgraph_get()).bound_box]
    low = Vector(tuple(min(p[i] for p in points) for i in range(3)))
    high = Vector(tuple(max(p[i] for p in points) for i in range(3)))
    target = Vector(((low.x + high.x) / 2, (low.y + high.y) / 2, low.z + (high.z - low.z) * .71))
    scene.camera.location = target + Vector((.20, -4, .12))
    scene.camera.rotation_euler = (target - scene.camera.location).to_track_quat('-Z', 'Y').to_euler()
    scene.camera.data.ortho_scale = max((high.x - low.x) * .86, (high.z - low.z) * .66)
    scene.render.film_transparent = True
    scene.render.image_settings.color_mode = 'RGBA'
    for obj in scene.objects:
        if obj.type == 'MESH' and not obj.vertex_groups:
            obj.hide_render = True
    scene.render.filepath = str(output / 'boss_treant.png')
    bpy.ops.render.render(write_still=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('output', type=Path)
    parser.add_argument('--portrait', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    renderer.render(args.output, 'tower_boss_2', only=['Walk'] if args.portrait else None, fps=1 if args.portrait else 20)
    if args.portrait:
        render_portrait(args.output)
    save_scene(args.output)
