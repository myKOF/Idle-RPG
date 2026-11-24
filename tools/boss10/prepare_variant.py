"""Apply BOSS10's five approved clips to the second material's own bind rig.

blender -b --python-exit-code 1 -P tools/boss10/prepare_variant.py -- FIRST.glb BOSS10_2.glb OUTPUT_DIR
"""
from copy import deepcopy
import hashlib
import json
import math
from pathlib import Path
import struct
import sys

import bpy
from mathutils import Matrix, Quaternion, Vector

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from prepare import CLIPS, accessor_data, import_and_render, read_glb, static_data, write_glb


class BindPose:
    def __init__(self, doc):
        nodes = doc['nodes']
        self.parents = {child: index for index, node in enumerate(nodes) for child in node.get('children', [])}
        self.local = []
        for node in nodes:
            assert 'matrix' not in node
            x, y, z, w = node.get('rotation', (0, 0, 0, 1))
            translation = Vector(node.get('translation', (0, 0, 0)))
            rotation = Quaternion((w, x, y, z)).normalized()
            scale = Vector(node.get('scale', (1, 1, 1)))
            assert min(scale) > 0
            self.local.append((translation, rotation, scale))
        self.world = [self.parent_transform(i) @ Matrix.LocRotScale(*self.local[i]) for i in range(len(nodes))]

    def parent_transform(self, index):
        parent = self.parents.get(index)
        if parent is None:
            return Matrix.Identity(4)
        return self.parent_transform(parent) @ Matrix.LocRotScale(*self.local[parent])


def compare_fingers(first, variant, old, new):
    aliases = {i: (a['name'], b['name']) for i, (a, b) in
               enumerate(zip(first['nodes'], variant['nodes'], strict=True)) if a['name'] != b['name']}
    expected = {}
    for index, digit in enumerate(range(4, 0, -1)):
        thumb = f'mixamorig:RightHandThumb{digit}'
        middle = f'mixamorig:RightHandMiddle{digit}'
        expected[20+index] = (middle, thumb)
        expected[28+index] = (thumb, middle)
    assert aliases == expected, aliases

    # The exported names swap two branches. Their actual locations relative to
    # the palm match by index, so keep each clip on the same physical finger.
    wrist = next(i for i, n in enumerate(first['nodes']) if n['name'] == 'mixamorig:RightHand')
    palm = lambda bind, i: bind.world[i].translation - bind.world[wrist].translation
    matching = max((palm(old, i)-palm(new, i)).length for i in aliases)
    swapped = min((palm(old, i)-palm(new, i+8 if i<24 else i-8)).length for i in aliases)
    assert matching < .06 and matching < swapped, (matching, swapped)
    return {'aliasesByNode': aliases, 'maxSamePositionError': matching, 'minSwappedPositionError': swapped}


def samples(doc, binary, index, kind):
    accessor, (view, raw) = accessor_data(doc, binary, index)
    components = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4}[kind]
    assert accessor['componentType'] == 5126 and accessor['type'] == kind
    width = 4*components
    start = accessor.get('byteOffset', 0)
    stride = view.get('byteStride', width)
    values = [struct.unpack_from('<'+'f'*components, raw, start+stride*i) for i in range(accessor['count'])]
    assert all(math.isfinite(value) for row in values for value in row)
    return accessor, values


def append_samples(doc, binary, descriptor, values):
    binary.extend(b'\0' * (-len(binary) % 4))
    flat = [component for row in values for component in row]
    buffer_view = len(doc['bufferViews'])
    doc['bufferViews'].append({'buffer': 0, 'byteOffset': len(binary), 'byteLength': 4*len(flat)})
    binary.extend(struct.pack('<'+'f'*len(flat), *flat))
    accessor = {k: v for k, v in descriptor.items() if k not in {'min', 'max', 'byteOffset'}}
    accessor['bufferView'] = buffer_view
    if 'min' in descriptor:
        accessor['min'] = [min(column) for column in zip(*values)]
        accessor['max'] = [max(column) for column in zip(*values)]
    doc['accessors'].append(accessor)
    return len(doc['accessors'])-1


def retarget_clip(first, first_binary, original, result, binary, old, new):
    converted = deepcopy(original)
    used = set()
    time_targets = {}
    timelines = {}
    for channel in converted['channels']:
        index = channel['target']['node']
        prop = channel['target']['path']
        slot = channel['sampler']
        assert slot not in used and index in first['skins'][0]['joints']
        used.add(slot)
        sampler = converted['samplers'][slot]
        assert sampler['interpolation'] == 'LINEAR'
        time_index = sampler['input']
        if time_index not in time_targets:
            desc, times = samples(first, first_binary, time_index, 'SCALAR')
            assert all(a[0]<b[0] for a,b in zip(times,times[1:])) and times[0][0] == 0
            time_targets[time_index] = append_samples(result, binary, desc, times)
            timelines[time_index] = times
        sampler['input'] = time_targets[time_index]

        desc, data = samples(first, first_binary, sampler['output'], 'VEC4' if prop=='rotation' else 'VEC3')
        assert len(data) == len(timelines[time_index])
        old_pos, _, old_scale = old.local[index]
        new_pos, _, new_scale = new.local[index]
        old_parent = old.parent_transform(index)
        new_parent_inverse = new.parent_transform(index).inverted()
        if prop == 'rotation':
            # Preserve the world-space rotation delta, conjugated into the
            # second skeleton's parent and local bind axes.
            prefix = new_parent_inverse.to_quaternion() @ old_parent.to_quaternion()
            suffix = old.world[index].to_quaternion().inverted() @ new.world[index].to_quaternion()
            values = []
            for x, y, z, w in data:
                q = (prefix @ Quaternion((w,x,y,z)) @ suffix).normalized()
                values.append((q.x,q.y,q.z,q.w))
        elif prop == 'translation':
            delta_axes = (new_parent_inverse @ old_parent).to_3x3()
            values = [tuple(new_pos + delta_axes @ (Vector(row)-old_pos)) for row in data]
        else:
            assert prop == 'scale'
            values = [tuple(value*new_scale[i]/old_scale[i] for i,value in enumerate(row)) for row in data]
        sampler['output'] = append_samples(result, binary, desc, values)

    assert len(used) == len(converted['samplers'])
    return converted, max(times[-1][0] for times in timelines.values())


def prepare(first_path, material_path, output):
    output.mkdir(parents=True, exist_ok=True)
    first_raw, material_raw = first_path.read_bytes(), material_path.read_bytes()
    first, first_binary = read_glb(first_raw)
    material, material_binary = read_glb(material_raw)
    assert tuple(clip['name'] for clip in first['animations']) == CLIPS
    assert first['skins'][0]['joints'] == material['skins'][0]['joints']
    old, new = BindPose(first), BindPose(material)
    assert old.parents == new.parents
    fingers = compare_fingers(first, material, old, new)

    result = deepcopy(material)
    result['animations'] = []
    binary = bytearray(material_binary)
    records = {}
    for original in first['animations']:
        clip, length = retarget_clip(first, first_binary, original, result, binary, old, new)
        assert len(clip['channels']) == 144
        result['animations'].append(clip)
        records[clip['name']] = {'seconds': length, 'channels': len(clip['channels'])}
    result['buffers'][0]['byteLength'] = len(binary)
    runtime = output / 'boss10_lv2.glb'
    write_glb(runtime, result, bytes(binary))
    exported, exported_binary = read_glb(runtime.read_bytes())
    assert static_data(exported, exported_binary) == static_data(material, material_binary)
    for original, clip in zip(first['animations'], exported['animations'], strict=True):
        assert clip['channels'] == original['channels']
        for source, target in zip(original['samplers'], clip['samplers'], strict=True):
            assert source['interpolation'] == target['interpolation']
            assert samples(first, first_binary, source['input'], 'SCALAR')[1] == samples(exported, exported_binary, target['input'], 'SCALAR')[1]
        for channel in clip['channels']:
            prop = channel['target']['path']
            values = samples(exported, exported_binary, clip['samplers'][channel['sampler']]['output'],
                             'VEC4' if prop=='rotation' else 'VEC3')[1]
            if prop == 'rotation':
                assert all(abs(math.hypot(*q)-1) < .00001 for q in values)
            if prop == 'scale':
                assert all(min(row)>0 for row in values)
    bones = import_and_render(runtime, output, records, '_lv2')
    report = {'blender': bpy.app.version_string, 'clips': records, 'bones': bones,
              'sourceSha256': hashlib.sha256(material_raw).hexdigest(),
              'motionSha256': hashlib.sha256(first_raw).hexdigest(),
              'fingerMapping': fingers, 'bindRigMeshAndTexturesIdenticalToMaterial2': True,
              'sourceAnimationTimesIdentical': True, 'portrait': [1080,1080]}
    (output/'model-qa.json').write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
    print('BOSS10_MATERIAL2_PREPARED', json.dumps(report), flush=True)


if __name__ == '__main__':
    prepare(*map(Path, sys.argv[sys.argv.index('--')+1:]))
