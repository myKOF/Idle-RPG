"""Verify all treant joints at 60 Hz against the approved first stage."""
import hashlib
import json
import math
from pathlib import Path
import sys

import bpy
import numpy as np


def sample(file):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = 30
    bpy.ops.import_scene.gltf(filepath=str(file))
    arm = next(o for o in scene.objects if o.type == 'ARMATURE')
    for track in list(arm.animation_data.nla_tracks):
        arm.animation_data.nla_tracks.remove(track)
    names = sorted(b.name for b in arm.data.bones)
    inverse = {n: arm.data.bones[n].matrix_local.inverted() for n in names}
    clips = {}
    for action in bpy.data.actions:
        arm.animation_data.action = action
        arm.animation_data.action_slot = action.slots[0]
        start, end = action.frame_range
        frames = []
        for time in np.linspace(start, end, math.ceil((end - start) * 2) + 1):
            scene.frame_set(math.floor(time), subframe=float(time % 1))
            frames.append(np.array([list(arm.matrix_world @ arm.pose.bones[n].matrix @ inverse[n]) for n in names], dtype=np.float32))
        clips[action.name] = {'range': [float(start), float(end)], 'matrices': np.stack(frames)}
    return names, clips


if __name__ == '__main__':
    approved, variant, output = map(Path, sys.argv[sys.argv.index('--') + 1:])
    names, expected = sample(approved)
    actual_names, actual = sample(variant)
    assert names == actual_names
    assert expected.keys() == actual.keys()
    report = {'approvedSha256': hashlib.sha256(approved.read_bytes()).hexdigest(),
              'variantSha256': hashlib.sha256(variant.read_bytes()).hexdigest(),
              'jointsCompared': len(names), 'samplingFps': 60, 'clips': {}}
    for name, clip in expected.items():
        result = actual[name]
        assert np.allclose(clip['range'], result['range'], atol=.00001)
        assert clip['matrices'].shape == result['matrices'].shape
        error = float(np.max(np.abs(clip['matrices'] - result['matrices'])))
        report['clips'][name] = {'seconds': clip['range'][1] / 30, 'samples': len(clip['matrices']), 'maxSkinMatrixError': error}
    output.write_text(json.dumps(report, indent=2), encoding='utf-8')
    assert all(c['maxSkinMatrixError'] < .00003 for c in report['clips'].values()), report
    print('TREANT_ANIMATION_QA_PASS', json.dumps(report), flush=True)
