"""Pose a CC0 MakeHuman right hand into a measured forward sword grip.

blender -b --python-exit-code 1 --python build_tower_boss_hand.py -- MPFB_CHECKOUT OUTPUT
The anatomical palm, finger webs and phalanges come from the official basemesh.
The source .blend preserves the MakeHuman body/rig, pose and fitted hand mesh.
"""
import hashlib
import importlib
import json
import math
from pathlib import Path
import subprocess
import sys

import addon_utils
import bmesh
import bpy
from mathutils import Matrix, Vector

mpfb, output = map(Path, sys.argv[sys.argv.index('--') + 1:])
output.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.preferences.extensions.repos.new(name='Codex BOSS hand source', module='codex_boss_hand',
                                              custom_directory=str(mpfb / 'src'))
module = 'bl_ext.codex_boss_hand.mpfb'
addon_utils.enable(module, default_set=True, persistent=False)
HumanService = importlib.import_module(module + '.services.humanservice').HumanService
TargetService = importlib.import_module(module + '.services.targetservice').TargetService
macro = TargetService.get_default_macro_info_dict()
macro.update(gender=1, age=.5, muscle=.45, weight=.45, height=.5)
body = HumanService.create_human(macro_detail_dict=macro)
rig = HumanService.add_builtin_rig(body, 'mixamo')
body.name, rig.name = 'MakeHuman_CC0_Hand_Anatomy', 'MakeHuman_CC0_Hand_Rig'
for modifier in list(body.modifiers):
    if modifier.type == 'MASK':
        body.modifiers.remove(modifier)
prefix = 'mixamorig:RightHand'
wrist = rig.data.bones[prefix].head_local.copy()
u = (rig.data.bones[prefix + 'Middle1'].head_local - wrist).normalized()
v = rig.data.bones[prefix + 'Index1'].head_local - rig.data.bones[prefix + 'Pinky1'].head_local
v = (v - u * v.dot(u)).normalized()
n = u.cross(v).normalized()
source_basis = Matrix((u, v, n)).transposed()
source_inverse = source_basis.inverted()
bpy.context.view_layer.update()
rest_mesh = body.evaluated_get(bpy.context.evaluated_depsgraph_get())
rest_positions = [vertex.co.copy() for vertex in rest_mesh.data.vertices]


def place_bone(name, direction):
    bone = rig.pose.bones[name]
    rest = rig.data.bones[name]
    rotation = (rest.tail_local - rest.head_local).rotation_difference(direction)
    bone.matrix = Matrix.Translation(bone.head) @ rotation.to_matrix().to_4x4() @ rest.matrix_local.to_3x3().to_4x4()
    bpy.context.view_layer.update()


for finger, angles in [('Index', (35, 120, 190)), ('Middle', (45, 125, 200)),
                        ('Ring', (35, 120, 190)), ('Pinky', (20, 95, 180))]:
    for index, degrees in enumerate(angles, 1):
        angle = math.radians(degrees)
        place_bone(prefix + finger + str(index), (u * math.cos(angle) - n * math.sin(angle)).normalized())
for index, target in enumerate([(.070, .040, -.015), (.103, .022, -.049), (.104, .054, -.054)], 1):
    bone = rig.pose.bones[prefix + 'Thumb' + str(index)]
    point = wrist + source_basis @ Vector(target)
    place_bone(bone.name, (point - bone.head).normalized())

group_names = {group.index: group.name for group in body.vertex_groups}
hand_vertices = set()
for vertex in body.data.vertices:
    local = source_inverse @ (rest_positions[vertex.index] - wrist)
    total = sum(group.weight for group in vertex.groups if group_names[group.group].startswith(prefix))
    if (vertex.index < 13380 and local.x > -.025 and abs(local.y) < .10 and abs(local.z) < .10
            and (total > .05 or local.x < .065)):
        hand_vertices.add(vertex.index)
faces = [face for face in body.data.polygons if all(index in hand_vertices for index in face.vertices)]
graph = bpy.context.evaluated_depsgraph_get()
posed = body.evaluated_get(graph)
selected = sorted({index for face in faces for index in face.vertices})
indices = {old: new for new, old in enumerate(selected)}

# Match the original BOSS wrist and handle while preserving right-hand chirality.
target_wrist = Vector((-.6321539283, -.0187027138, 1.3700504303))
target_grip = Vector((-.775, -.025, 1.355))
blade = Vector((0, 0, -1))
center_u, center_n = .108, -.027
delta = target_grip - target_wrist
perpendicular = delta - blade * delta.dot(blade)
scale = perpendicular.length / math.hypot(center_u, center_n)
target_u = Matrix.Rotation(math.atan2(center_n, center_u), 3, blade) @ perpendicular.normalized()
target_n = target_u.cross(blade).normalized()
target_basis = Matrix((target_u, blade, target_n)).transposed()
transform = target_basis @ source_inverse
points = [target_wrist + transform @ (posed.data.vertices[index].co - wrist) * scale for index in selected]
polygons = [tuple(indices[index] for index in face.vertices) for face in faces]
mesh = bpy.data.meshes.new('MakeHuman anatomical closed hand')
mesh.from_pydata(points, [], polygons)
mesh.update()
hand = bpy.data.objects.new('BOSS1_RightHand_Anatomical', mesh)
bpy.context.scene.collection.objects.link(hand)
bpy.context.view_layer.objects.active = hand
hand.select_set(True)
for face in mesh.polygons:
    face.use_smooth = True
subdivision = hand.modifiers.new('Anatomical finger surfaces', 'SUBSURF')
subdivision.levels = 1
bpy.ops.object.modifier_apply(modifier=subdivision.name)

# Keep the leather shaft clear while retaining the real anatomical surface.
radius = .0184
for vertex in hand.data.vertices:
    relative = vertex.co - target_grip
    along = relative.dot(blade)
    radial = relative - blade * along
    if -.14 < along < .14 and .0001 < radial.length < radius:
        vertex.co += radial.normalized() * (radius - radial.length)
hand.data.update()
bm = bmesh.new()
bm.from_mesh(hand.data)
bmesh.ops.holes_fill(bm, edges=[edge for edge in bm.edges if edge.is_boundary], sides=0)
bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
bm.to_mesh(hand.data)
bm.free()
hand.data.update()
silver = bpy.data.materials.new('Anatomical silver glove')
silver.use_nodes = True
silver.diffuse_color = (.46, .47, .45, 1)
shader = silver.node_tree.nodes['Principled BSDF']
shader.inputs['Base Color'].default_value = silver.diffuse_color
shader.inputs['Metallic'].default_value = .22
shader.inputs['Roughness'].default_value = .58
hand.data.materials.append(silver)
thumb_tip = target_wrist + transform @ (rig.pose.bones[prefix + 'Thumb3'].tail - wrist) * scale
thumb_axis = (transform @ (rig.pose.bones[prefix + 'Thumb3'].tail - rig.pose.bones[prefix + 'Thumb3'].head)).normalized()
hand['dorsalNormalRest'] = list(target_n)
hand['thumbTipRest'] = list(thumb_tip)
hand['thumbDistalAxisRest'] = list(thumb_axis)
hand['license'] = 'MakeHuman / MPFB official basemesh CC0; posed and fitted in Blender'
hand['wristRest'] = list(target_wrist)
body.hide_render = True
body.hide_set(True)
rig.hide_render = True
rig.hide_set(True)
bpy.ops.wm.save_as_mainfile(filepath=str(output / 'BOSS1_anatomical_hand.blend'))
sources = ['src/mpfb/data/3dobjs/base.obj', 'src/mpfb/data/rigs/standard/rig.mixamo.json',
           'src/mpfb/data/rigs/standard/weights.mixamo.json', 'LICENSE.ASSETS.md']
report = {'macro': macro, 'mpfbRevision': subprocess.check_output(['git', '-C', str(mpfb), 'rev-parse', 'HEAD'], text=True).strip(),
          'sources': {file: hashlib.sha256((mpfb / file).read_bytes()).hexdigest() for file in sources},
          'license': 'CC0 1.0 Universal', 'handVertices': len(hand.data.vertices), 'scale': scale,
          'dorsalNormalRest': list(target_n), 'thumbTipRest': list(thumb_tip), 'thumbDistalAxisRest': list(thumb_axis),
          'thumbBladeAlignment': thumb_axis.dot(blade), 'targetWrist': list(target_wrist), 'targetGrip': list(target_grip)}
(output / 'hand-source.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print('ANATOMICAL_HAND_CREATED', json.dumps(report))
