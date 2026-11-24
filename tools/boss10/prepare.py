"""Build the five-clip GLB, import it into Blender and render its portrait.

blender -b --python-exit-code 1 -P tools/boss10/prepare.py -- SOURCE_DIR OUTPUT_DIR
"""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import struct
import sys

import bpy
from mathutils import Vector


CLIPS = ('Walk', 'Attack1', 'Attack2', 'Attack3', 'Die')
ANIMATION_KEYS = {'animations', 'accessors', 'bufferViews', 'buffers'}


def read_glb(raw):
    magic, version, length, json_size, json_tag = struct.unpack_from('<4sIIII', raw)
    assert (magic, version, length, json_tag) == (b'glTF', 2, len(raw), 0x4e4f534a)
    json_end = 20 + json_size
    binary_size, binary_tag = struct.unpack_from('<II', raw, json_end)
    assert binary_tag == 0x004e4942 and json_end + 8 + binary_size == len(raw)
    doc = json.loads(raw[20:json_end])
    binary = raw[json_end+8:]
    assert len(doc['buffers']) == 1 and len(binary) - 3 <= doc['buffers'][0]['byteLength'] <= len(binary)
    return doc, binary


def view_data(doc, binary, index):
    view = doc['bufferViews'][index]
    start = view.get('byteOffset', 0)
    end = start + view['byteLength']
    assert view['buffer'] == 0 and 0 <= start <= end <= len(binary) and not view.get('extensions')
    return {k: v for k, v in view.items() if k != 'byteOffset'}, binary[start:end]


def accessor_data(doc, binary, index):
    accessor = doc['accessors'][index]
    assert not accessor.get('sparse') and not accessor.get('extensions')
    return ({k: v for k, v in accessor.items() if k != 'bufferView'},
            view_data(doc, binary, accessor['bufferView']))


def static_data(doc, binary):
    geometry = set()
    for mesh in doc['meshes']:
        for prim in mesh['primitives']:
            assert 'targets' not in prim and 'extensions' not in prim
            geometry.update(prim['attributes'].values())
            geometry.add(prim['indices'])
    geometry.update(skin['inverseBindMatrices'] for skin in doc['skins'])
    return (
        {k: v for k, v in doc.items() if k not in ANIMATION_KEYS},
        {i: accessor_data(doc, binary, i) for i in geometry},
        [view_data(doc, binary, image['bufferView']) for image in doc['images']],
    )


def write_glb(path, doc, binary):
    payload = json.dumps(doc, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    payload += b' ' * (-len(payload) % 4)
    binary += b'\0' * (-len(binary) % 4)
    path.write_bytes(struct.pack('<4sIIII', b'glTF', 2, 28+len(payload)+len(binary), len(payload), 0x4e4f534a)
                     + payload + struct.pack('<II', len(binary), 0x004e4942) + binary)


def combine(sources, destination):
    originals = {}
    records = {}
    for clip in CLIPS:
        file = sources / f'BOSS10_{clip}.glb'
        raw = file.read_bytes()
        doc, binary = originals[clip] = read_glb(raw)
        animation, = doc['animations']
        assert len(animation['channels']) == 144
        records[clip] = {
            'source': file.name, 'sha256': hashlib.sha256(raw).hexdigest(),
            'originalClip': animation['name'], 'channels': len(animation['channels']),
            'seconds': max(doc['accessors'][s['input']]['max'][0] for s in animation['samplers']),
        }
    walk, walk_binary = originals['Walk']
    shared = static_data(walk, walk_binary)
    output = deepcopy(walk)
    output['animations'] = []
    binary = bytearray(walk_binary)
    for clip, (doc, source_binary) in originals.items():
        assert static_data(doc, source_binary) == shared, f'{clip} source mesh, material or bind rig differs'
        action = deepcopy(doc['animations'][0])
        action['name'] = clip
        if clip != 'Walk':
            mapping = {}
            for sampler in action['samplers']:
                for key in ('input', 'output'):
                    index = sampler[key]
                    if index not in mapping:
                        accessor, (view, samples) = accessor_data(doc, source_binary, index)
                        binary.extend(b'\0' * (-len(binary) % 4))
                        view['byteOffset'] = len(binary)
                        accessor['bufferView'] = len(output['bufferViews'])
                        mapping[index] = len(output['accessors'])
                        output['bufferViews'].append(view)
                        output['accessors'].append(accessor)
                        binary.extend(samples)
                    sampler[key] = mapping[index]
        output['animations'].append(action)
    output['buffers'][0]['byteLength'] = len(binary)
    write_glb(destination, output, bytes(binary))
    exported, exported_binary = read_glb(destination.read_bytes())
    assert static_data(exported, exported_binary) == shared
    for clip, action in zip(CLIPS, exported['animations'], strict=True):
        doc, source_binary = originals[clip]
        source_action = doc['animations'][0]
        assert action['name'] == clip and action['channels'] == source_action['channels']
        for after, before in zip(action['samplers'], source_action['samplers'], strict=True):
            assert after.get('interpolation') == before.get('interpolation')
            for key in ('input', 'output'):
                assert accessor_data(exported, exported_binary, after[key]) == accessor_data(doc, source_binary, before[key])
    return records


def render_portrait(scene, output, low, high, suffix):
    height = high.z - low.z
    target = Vector(((low.x + high.x)/2, (low.y + high.y)/2, low.z + height*.72))
    camera_data = bpy.data.cameras.new('Portrait')
    camera_data.type = 'ORTHO'
    camera_data.ortho_scale = height*.69
    camera = bpy.data.objects.new('Portrait', camera_data)
    scene.collection.objects.link(camera)
    camera.location = target + Vector((.2,-5,.08))
    camera.rotation_euler = (target-camera.location).to_track_quat('-Z','Y').to_euler()
    scene.camera = camera
    world = bpy.data.worlds.new('Studio')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (.45,.50,.58,1)
    world.node_tree.nodes['Background'].inputs[1].default_value = .7
    scene.world = world
    for name, location, power in [('Key',(-3,-4,5),650),('Fill',(4,-2,3),450),('Rim',(1,3,4),800)]:
        light = bpy.data.lights.new(name,'AREA')
        light.energy, light.shape, light.size = power,'DISK',4
        obj = bpy.data.objects.new(name,light)
        scene.collection.objects.link(obj)
        obj.location = location
        obj.rotation_euler = (target-obj.location).to_track_quat('-Z','Y').to_euler()
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
    scene.eevee.taa_render_samples = 32
    scene.view_settings.view_transform = 'AgX'
    scene.render.resolution_x = scene.render.resolution_y = 1080
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.filepath = str(output / f'boss10_lava{suffix}.png')
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(output / f'boss10{suffix}.blend'), compress=True)
    bpy.ops.render.render(write_still=True)


def import_and_render(runtime, output, records, suffix='', expected_bones=52):
    output = output.resolve()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = 30
    bpy.ops.import_scene.gltf(filepath=str(runtime))
    arm, = [obj for obj in scene.objects if obj.type == 'ARMATURE']
    body, = [obj for obj in scene.objects if obj.type == 'MESH'
             and any(mod.type == 'ARMATURE' and mod.object == arm for mod in obj.modifiers)]
    assert len(arm.data.bones) == expected_bones
    actions = {action.name: action for action in bpy.data.actions}
    assert set(actions) == set(CLIPS)
    animation = arm.animation_data
    for track in list(animation.nla_tracks):
        animation.nla_tracks.remove(track)
    for name, action in actions.items():
        action.use_fake_user = True
        animation.action = action
        animation.action_slot = action.slots[0]
        assert abs((action.frame_range[1]-action.frame_range[0])/30-records[name]['seconds']) < .0001
    animation.action = actions['Walk']
    animation.action_slot = actions['Walk'].slots[0]
    scene.frame_set(0)
    evaluated = body.evaluated_get(bpy.context.evaluated_depsgraph_get())
    points = [evaluated.matrix_world @ vertex.co for vertex in evaluated.data.vertices]
    low = Vector(min(point[i] for point in points) for i in range(3))
    high = Vector(max(point[i] for point in points) for i in range(3))
    render_portrait(scene, output, low, high, suffix)
    return len(arm.data.bones)


def prepare(source, output):
    output.mkdir(parents=True, exist_ok=True)
    runtime = output / 'boss10.glb'
    records = combine(source, runtime)
    bones = import_and_render(runtime, output, records)
    report = {'blender': bpy.app.version_string, 'clips': records, 'bones': bones,
              'bindRigMeshAndTexturesIdentical': True, 'originalMotionSamplesIdentical': True,
              'portrait': [1080,1080]}
    (output / 'model-qa.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print('BOSS10_PREPARED', json.dumps(report), flush=True)


if __name__ == '__main__':
    prepare(*map(Path, sys.argv[sys.argv.index('--')+1:]))
