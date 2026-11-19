"""Retarget the approved five actions to the supplied final gargoyle rig.

blender -b --python-exit-code 1 -P prepare_game.py -- APPROVED.blend FINAL.glb OUTPUT_DIR
"""
import bpy
import hashlib
import json
import math
import sys
from pathlib import Path
from mathutils import Matrix, Vector

approved, source, output = map(Path, sys.argv[sys.argv.index('--') + 1:])
output.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(approved))
scene = bpy.context.scene
assert scene.render.fps == 150
original = next(o for o in scene.objects if o.type == 'ARMATURE')
old_body = next(o for o in scene.objects if o.type == 'MESH' and o.vertex_groups)
old_rest = {b.name: original.matrix_world @ b.matrix_local for b in original.data.bones}
old_parents = {b.name: b.parent.name if b.parent else None for b in original.data.bones}
speeds = {'Walk': 1, 'Attack1': 1.5, 'Attack2': 1.25, 'Attack3': 1, 'Die': 1}
ends = {'Walk': 48, 'Attack1': 78, 'Attack2': 78, 'Attack3': 72, 'Die': 113}
samples = {}
for name in speeds:
    action = bpy.data.actions[name]
    original.animation_data.action = action
    original.animation_data.action_slot = action.slots[0]
    samples[name] = []
    for index in range(ends[name] + 1):
        frame = index * 5 / speeds[name]
        integer = math.floor(frame)
        scene.frame_set(integer, subframe=frame-integer)
        bpy.context.view_layer.update()
        samples[name].append((frame, {p.name: original.matrix_world @ p.matrix for p in original.pose.bones}))

existing = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=str(source))
added = set(bpy.data.objects) - existing
arm = next(o for o in added if o.type == 'ARMATURE')
body = next(o for o in added if o.type == 'MESH' and o.vertex_groups)
assert len(arm.data.bones) == 70
assert set(arm.data.bones.keys()) == set(old_rest)
assert {b.name: b.parent.name if b.parent else None for b in arm.data.bones} == old_parents
new_rest = {b.name: arm.matrix_world @ b.matrix_local for b in arm.data.bones}
rest_report = {name: {'headShift': (new_rest[name].translation-old_rest[name].translation).length,
                      'axisChangeDegrees': math.degrees(new_rest[name].to_quaternion().rotation_difference(old_rest[name].to_quaternion()).angle),
                      'length': arm.data.bones[name].length} for name in old_rest}
for obj in [original, old_body]:
    bpy.data.objects.remove(obj, do_unlink=True)
for action in list(bpy.data.actions):
    bpy.data.actions.remove(action)
arm.name, body.name = 'BOSS8_Gargoyle_Rig', 'BOSS8_Gargoyle_Body'
ad = arm.animation_data_create()
root = arm.pose.bones['Bone_000']
arm_inverse = arm.matrix_world.inverted()
order = sorted(arm.pose.bones, key=lambda p: len(p.parent_recursive))
floor_adjustments = []
max_pose_error = 0


def surface():
    evaluated = body.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    points = [evaluated.matrix_world @ v.co for v in mesh.vertices]
    evaluated.to_mesh_clear()
    return points


for name, frames in samples.items():
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    ad.action = action
    previous = {}
    for frame, old_pose in frames:
        integer = math.floor(frame)
        scene.frame_set(integer, subframe=frame-integer)
        target_world, target_arm = {}, {}
        for p in order:
            delta = old_pose[p.name].to_quaternion() @ old_rest[p.name].to_quaternion().inverted()
            rotation = delta @ new_rest[p.name].to_quaternion()
            if p.parent:
                head = target_world[p.parent.name] @ new_rest[p.parent.name].inverted() @ new_rest[p.name].translation
            else:
                head = new_rest[p.name].translation + old_pose[p.name].translation - old_rest[p.name].translation
            target_world[p.name] = Matrix.LocRotScale(head, rotation, Vector((1, 1, 1)))
            target_arm[p.name] = arm_inverse @ target_world[p.name]
            kwargs = {'parent_matrix': target_arm[p.parent.name], 'parent_matrix_local': p.parent.bone.matrix_local} if p.parent else {}
            p.matrix_basis = p.bone.convert_local_to_pose(target_arm[p.name], p.bone.matrix_local, invert=True, **kwargs)
            p.rotation_mode = 'QUATERNION'
        bpy.context.view_layer.update()
        max_pose_error = max(max_pose_error, max(abs(p.matrix[r][c]-target_arm[p.name][r][c])
                                                for p in order for r in range(4) for c in range(4)))
        if name == 'Die':
            low = min(p.z for p in surface())
            correction = max(0, .025-low)
            if frame / 565 >= .80:
                correction = .025-low
            if correction:
                root.location += (arm.matrix_world @ root.bone.matrix_local).to_3x3().inverted() @ Vector((0, 0, correction))
            floor_adjustments.append(correction)
        for p in order:
            if p.name in previous:
                p.rotation_quaternion.make_compatible(previous[p.name])
            previous[p.name] = p.rotation_quaternion.copy()
            p.keyframe_insert('rotation_quaternion', frame=frame, group=p.name)
            if not p.parent:
                p.keyframe_insert('location', frame=frame, group=p.name)
        if action.slots:
            ad.action_slot = action.slots[0]
    print('RETARGETED', name, float(action.frame_range[1])/150, flush=True)
assert max_pose_error < .0001, max_pose_error
ad.action = bpy.data.actions['Walk']
ad.action_slot = ad.action.slots[0]
scene.frame_set(0)
bpy.ops.object.select_all(action='DESELECT')
arm.select_set(True)
body.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.export_scene.gltf(filepath=str(output / 'boss8.glb'), export_format='GLB', use_selection=True,
    export_animations=True, export_animation_mode='ACTIONS', export_anim_single_armature=True,
    export_force_sampling=True, export_frame_step=1, export_reset_pose_bones=True,
    export_skins=True, export_image_format='AUTO')

# Preserve a full-body review camera and make a separate close portrait camera.
ad.action = bpy.data.actions['Walk']
ad.action_slot = ad.action.slots[0]
scene.frame_set(0)
points = surface()
head_names = {'Bone_' + str(i).zfill(3) for i in range(23, 28)}
head_groups = {g.index for g in body.vertex_groups if g.name in head_names}
head_points = [points[v.index] for v in body.data.vertices if sum(g.weight for g in v.groups if g.group in head_groups) > .5]
low = Vector(tuple(min(p[i] for p in head_points) for i in range(3)))
high = Vector(tuple(max(p[i] for p in head_points) for i in range(3)))
target = (low+high)/2
target.z -= (high.z-low.z)*.22
camera_data = bpy.data.cameras.new('Portrait_camera')
camera_data.type = 'ORTHO'
camera_data.ortho_scale = max((high.x-low.x)*1.20, (high.z-low.z)*1.75)
camera = bpy.data.objects.new('Portrait_camera', camera_data)
scene.collection.objects.link(camera)
camera.location = target + Vector((.15, -5, .05))
camera.rotation_euler = (target-camera.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = camera
for obj in scene.objects:
    if obj.type == 'MESH' and not obj.vertex_groups:
        obj.hide_render = True
scene.render.resolution_x = scene.render.resolution_y = 1080
scene.render.resolution_percentage = 100
scene.eevee.taa_render_samples = 32
scene.render.film_transparent = True
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.filepath = str(output / 'boss8_gargoyle.png')
bpy.data.orphans_purge(do_recursive=True)
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(output / 'boss8.blend'), compress=True)
bpy.ops.render.render(write_still=True)
report = {'blender': bpy.app.version_string, 'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
          'approvedBlendSha256': hashlib.sha256(approved.read_bytes()).hexdigest(),
          'vertices': len(body.data.vertices), 'triangles': sum(len(p.vertices)-2 for p in body.data.polygons),
          'bones': len(arm.data.bones), 'restDifferences': rest_report, 'maxRetargetMatrixError': max_pose_error,
          'deathFloorCorrectionRange': [min(floor_adjustments), max(floor_adjustments)],
          'clips': {name: ends[name]/30/speeds[name] for name in speeds},
          'retarget': 'World rest-space rotation deltas; final hierarchy, joint positions, mesh and weights retained',
          'portrait': [1080, 1080]}
(output / 'model-qa.json').write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
print('BOSS8_GAME_PREPARED', json.dumps({k:v for k,v in report.items() if k!='restDifferences'}), flush=True)
