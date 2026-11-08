"""Compare every joint's effective skin transform after variant re-binding.

blender -b --python-exit-code 1 --python qa_tower_boss_variant.py -- APPROVED.glb VARIANT.glb REPORT.json
Rest axes can change when a weapon bone is recreated. Pose * inverse(rest),
which actually deforms the mesh, must still match for every motion/sample.
"""
import hashlib
import json
import math
from pathlib import Path
import sys

import bpy
import numpy as np

reference, variant, output = map(Path, sys.argv[sys.argv.index('--') + 1:])


def sample(file):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = 30
    bpy.ops.import_scene.gltf(filepath=str(file))
    arm = next(obj for obj in scene.objects if obj.type == 'ARMATURE')
    for track in list(arm.animation_data.nla_tracks):
        arm.animation_data.nla_tracks.remove(track)
    names = sorted(bone.name for bone in arm.data.bones)
    inverse = {name: arm.data.bones[name].matrix_local.inverted() for name in names}
    clips = {}
    for action in bpy.data.actions:
        arm.animation_data.action = action
        arm.animation_data.action_slot = action.slots[0]
        frames = []
        for step in range(math.ceil(action.frame_range[0] * 2), math.floor(action.frame_range[1] * 2) + 1):
            time = step / 2
            scene.frame_set(math.floor(time), subframe=time % 1)
            frames.append(np.array([list(arm.pose.bones[name].matrix @ inverse[name]) for name in names], dtype=np.float32))
        clips[action.name] = np.stack(frames)
    assert set(clips) == {'Walk', 'Attack1', 'Attack2', 'Attack3', 'Die'}
    return names, clips


names, approved = sample(reference)
actual_names, actual = sample(variant)
assert names == actual_names
report = {'referenceSha256': hashlib.sha256(reference.read_bytes()).hexdigest(),
          'variantSha256': hashlib.sha256(variant.read_bytes()).hexdigest(),
          'jointsCompared': len(names), 'samplingFps': 60, 'clips': {}}
for clip, expected in approved.items():
    result = actual[clip]
    assert result.shape == expected.shape
    difference = np.abs(result - expected)
    frame, bone, _, _ = np.unravel_index(np.argmax(difference), difference.shape)
    maximum = float(np.max(difference))
    report['clips'][clip] = {'samples': len(result), 'maxSkinMatrixError': maximum,
                            'worstJoint': names[bone], 'worstSourceSeconds': float(frame / 60)}
output.write_text(json.dumps(report, indent=2), encoding='utf-8')
for clip, item in report['clips'].items():
    assert item['maxSkinMatrixError'] < .00003, (clip, item)
print('VARIANT_ANIMATION_QA_PASS', json.dumps(report), flush=True)
