"""Apply BOSS10's five approved clips to a variant's own bind rig.

blender -b --python-exit-code 1 -P tools/boss10/prepare_variant.py -- FIRST.glb VARIANT.glb OUTPUT_DIR [2|3]
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


def map_nodes(first, variant, old, new, material_number):
    first_names = {node['name']: i for i, node in enumerate(first['nodes'])}
    variant_names = {node['name']: i for i, node in enumerate(variant['nodes'])}
    assert len(first_names) == len(first['nodes']) and len(variant_names) == len(variant['nodes'])
    extras = set(variant_names) - set(first_names)
    assert extras == ({'Bone_003', 'Bone_004'} if material_number == 3 else set())
    mapping = {i: variant_names[name] for name, i in first_names.items()}

    # Both variants label two right-hand branches in reverse. Confirm the
    # correspondence using the rest positions relative to each palm.
    aliases = {}
    matching, name_only = [], []
    wrist = first_names['mixamorig:RightHand']
    for digit in range(1, 5):
        for source, target in [('Thumb', 'Middle'), ('Middle', 'Thumb')]:
            first_name = f'mixamorig:RightHand{source}{digit}'
            target_name = f'mixamorig:RightHand{target}{digit}'
            i, j = first_names[first_name], variant_names[target_name]
            original_offset = old.world[i].translation - old.world[wrist].translation
            new_wrist = new.world[mapping[wrist]].translation
            matching.append((original_offset - (new.world[j].translation-new_wrist)).length)
            name_only.append((original_offset - (new.world[mapping[i]].translation-new_wrist)).length)
            mapping[i] = j
            aliases[i] = (first_name, target_name)
    assert all(correct < crossed for correct, crossed in zip(matching, name_only, strict=True)), (matching, name_only)

    mapped = set(mapping.values())
    extra_ids = {variant_names[name] for name in extras}
    assert len(mapped) == len(mapping)
    assert {mapping[i] for i in first['skins'][0]['joints']} | extra_ids == set(variant['skins'][0]['joints'])
    for i, j in mapping.items():
        parent = new.parents.get(j)
        while parent in extra_ids:
            parent = new.parents.get(parent)
        assert parent == mapping.get(old.parents.get(i)), (first['nodes'][i]['name'], parent)
    fingers = {'aliasesByNode': aliases, 'maxSamePositionError': max(matching),
               'minSwappedPositionError': min(name_only)}
    return mapping, fingers, sorted(extras)


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


def retarget_clip(first, first_binary, original, result, binary, old, new, mapping):
    converted = deepcopy(original)
    used = set()
    time_targets = {}
    timelines = {}
    for channel in converted['channels']:
        index = channel['target']['node']
        target_index = mapping[index]
        channel['target']['node'] = target_index
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
        new_pos, _, new_scale = new.local[target_index]
        old_parent = old.parent_transform(index)
        new_parent_inverse = new.parent_transform(target_index).inverted()
        if prop == 'rotation':
            # Preserve the world-space rotation delta, conjugated into the
            # second skeleton's parent and local bind axes.
            prefix = new_parent_inverse.to_quaternion() @ old_parent.to_quaternion()
            suffix = old.world[index].to_quaternion().inverted() @ new.world[target_index].to_quaternion()
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


def prepare(first_path, material_path, output, material_number=2):
    assert material_number in (2, 3)
    output.mkdir(parents=True, exist_ok=True)
    first_raw, material_raw = first_path.read_bytes(), material_path.read_bytes()
    first, first_binary = read_glb(first_raw)
    material, material_binary = read_glb(material_raw)
    assert tuple(clip['name'] for clip in first['animations']) == CLIPS
    old, new = BindPose(first), BindPose(material)
    mapping, fingers, extras = map_nodes(first, material, old, new, material_number)

    result = deepcopy(material)
    result['animations'] = []
    binary = bytearray(material_binary)
    records = {}
    for original in first['animations']:
        clip, length = retarget_clip(first, first_binary, original, result, binary, old, new, mapping)
        assert len(clip['channels']) == 144
        result['animations'].append(clip)
        records[clip['name']] = {'seconds': length, 'channels': len(clip['channels'])}
    result['buffers'][0]['byteLength'] = len(binary)
    suffix = f'_lv{material_number}'
    runtime = output / f'boss10{suffix}.glb'
    write_glb(runtime, result, bytes(binary))
    exported, exported_binary = read_glb(runtime.read_bytes())
    assert static_data(exported, exported_binary) == static_data(material, material_binary)
    for original, clip in zip(first['animations'], exported['animations'], strict=True):
        expected = deepcopy(original['channels'])
        for channel in expected:
            channel['target']['node'] = mapping[channel['target']['node']]
        assert clip['channels'] == expected
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
    bones = import_and_render(runtime, output, records, suffix, 52+len(extras))
    report = {'blender': bpy.app.version_string, 'clips': records, 'bones': bones,
              'sourceSha256': hashlib.sha256(material_raw).hexdigest(),
              'motionSha256': hashlib.sha256(first_raw).hexdigest(),
              'fingerMapping': fingers, 'additionalBonesFollowingParent': extras,
              'bindRigMeshAndTexturesIdenticalToVariant': True,
              'sourceAnimationTimesIdentical': True, 'portrait': [1080,1080]}
    (output/'model-qa.json').write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
    print(f'BOSS10_MATERIAL{material_number}_PREPARED', json.dumps(report), flush=True)


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:]
    assert len(args) in (3, 4)
    prepare(*map(Path, args[:3]), material_number=int(args[3]) if len(args)==4 else 2)
