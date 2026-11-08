"""Validate the exported BOSS1 cloak, forward grip and rigid weapon per frame.

blender -b --python-exit-code 1 --python qa_tower_boss1.py -- MODEL.glb REPORT.json
"""
import hashlib
import json
import math
from pathlib import Path
import sys

import bpy
from mathutils import Vector

model, destination = map(Path, sys.argv[sys.argv.index('--') + 1:])
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 30
bpy.ops.import_scene.gltf(filepath=str(model))
arm = next(obj for obj in scene.objects if obj.type == 'ARMATURE')
cape = bpy.data.objects['BOSS1_Cape']
weapon = bpy.data.objects['BOSS1_Sword']
for track in list(arm.animation_data.nla_tracks):
    arm.animation_data.nla_tracks.remove(track)
allowed = {'Cape_Upper', 'Cape_Middle', 'Cape_Lower', 'mixamorig:Spine2'}
for vertex in cape.data.vertices:
    assert all(cape.vertex_groups[group.group].name in allowed for group in vertex.groups if group.weight > .00001)
    assert abs(sum(group.weight for group in vertex.groups) - 1) < .00001
hem = [vertex.index for vertex in cape.data.vertices if vertex.co.z < .60]
grip = Vector((-.775, -.025, 1.355))
tip = Vector((-.775, -.025, .166))
metadata = next(obj for obj in scene.objects if obj.get('handDorsalNormalRest'))
dorsal_normal = Vector(metadata['handDorsalNormalRest'])
thumb_direction = Vector(metadata['thumbDistalAxisRest'])
report = {'sha256': hashlib.sha256(model.read_bytes()).hexdigest(), 'capeVertices': len(cape.data.vertices), 'clips': {}}
for action in bpy.data.actions:
    arm.animation_data.action = action
    arm.animation_data.action_slot = action.slots[0]
    item = {'frames': 0, 'maxCapeBoneRise': -100, 'maxHemAboveAttachment': -100,
            'minCapeVertexZ': 100, 'minWeaponVertexZ': 100, 'maxGripError': 0,
            'minHandBackOutwardDot': 1, 'minThumbToBladeDot': 1}
    for frame in range(math.ceil(action.frame_range[0]), math.floor(action.frame_range[1]) + 1):
        scene.frame_set(frame)
        graph = bpy.context.evaluated_depsgraph_get()
        cloth = cape.evaluated_get(graph)
        attachment = arm.pose.bones['Cape_Upper'].head
        item['maxCapeBoneRise'] = max(item['maxCapeBoneRise'], *(arm.pose.bones[name].tail.z - arm.pose.bones[name].head.z for name in allowed if name.startswith('Cape_')))
        item['maxHemAboveAttachment'] = max(item['maxHemAboveAttachment'], max(cloth.data.vertices[index].co.z for index in hem) - attachment.z)
        item['minCapeVertexZ'] = min(item['minCapeVertexZ'], min(v.co.z for v in cloth.data.vertices))
        sword = weapon.evaluated_get(graph)
        item['minWeaponVertexZ'] = min(item['minWeaponVertexZ'], min(v.co.z for v in sword.data.vertices))
        hand = arm.pose.bones['mixamorig:RightHand']
        hand_delta = hand.matrix @ arm.data.bones[hand.name].matrix_local.inverted()
        weapon_delta = arm.pose.bones['Sword_R'].matrix @ arm.data.bones['Sword_R'].matrix_local.inverted()
        item['maxGripError'] = max(item['maxGripError'], ((hand_delta @ grip) - (weapon_delta @ grip)).length)
        blade = (hand_delta.to_3x3() @ (tip - grip)).normalized()
        thumb = (hand_delta.to_3x3() @ thumb_direction).normalized()
        item['minThumbToBladeDot'] = min(item['minThumbToBladeDot'], thumb.dot(blade))
        back = hand_delta.to_3x3() @ dorsal_normal
        outward = arm.pose.bones['mixamorig:RightShoulder'].head - arm.pose.bones['mixamorig:LeftShoulder'].head
        outward.z = 0
        back -= blade * back.dot(blade)
        outward -= blade * outward.dot(blade)
        if back.length > .0001 and outward.length > .0001:
            item['minHandBackOutwardDot'] = min(item['minHandBackOutwardDot'], back.normalized().dot(outward.normalized()))
        item['frames'] += 1
    report['clips'][action.name] = item
destination.write_text(json.dumps(report, indent=2), encoding='utf-8')
for name, item in report['clips'].items():
    assert item['maxCapeBoneRise'] < .001, (name, 'cape rises', item)
    assert item['maxHemAboveAttachment'] < .02, (name, 'hem raised above shoulders', item)
    assert item['minWeaponVertexZ'] > .015, (name, 'weapon below floor', item)
    assert item['maxGripError'] < .00001, (name, 'weapon detaches', item)
    assert item['minThumbToBladeDot'] > .5, (name, 'reverse grip', item)
assert report['clips']['Walk']['minHandBackOutwardDot'] > .85, report['clips']['Walk']
print('BOSS1_QA_PASS', json.dumps(report))
