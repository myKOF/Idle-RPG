"""Fit licensed Role1 skin; reuse the approved grip, weapon and all six clips.
blender -b --python prepare_role1.py -- Role1.glb knight.glb role.glb output.glb source.blend report.json
"""
import copy
import hashlib
import json
from pathlib import Path
import struct
import sys
import tempfile
import bpy
import numpy as np

source, knight, approved, output, blend, report = map(Path, sys.argv[sys.argv.index('--') + 1:])
folder = Path(__file__).resolve().parent

def run_helper(name, args):
    text = (folder / name).read_text(encoding='utf-8')
    if name == 'prepare_role.py':
        # Resolve the actual material base color, rather than an image slot.
        text = text.replace("image = role.j['images'][1]", "image = role.j['images'][role.j['textures'][role.j['materials'][rp['material']]['pbrMetallicRoughness']['baseColorTexture']['index']]['source']]")
    sys.argv = ['blender', '--'] + list(map(str, args))
    scope = {'__name__': '__main__', '__file__': str(folder / name)}
    exec(compile(text, str(folder / name), 'exec'), scope)
    return scope

with tempfile.TemporaryDirectory() as td:
    td = Path(td)
    fit = run_helper('prepare_role.py', [source, knight, td/'fit.glb', td/'fit.blend', td/'fit.json'])
    hand = run_helper('sculpt_grip.py', [td/'fit.glb', td/'hand.glb', td/'hand.blend', td/'hand.json'])
    Glb = hand['Glb']
    fitted, reference = Glb(td/'hand.glb'), Glb(approved)
    fit_report = json.loads((td/'fit.json').read_text())
    hand_report = json.loads((td/'hand.json').read_text())
    assert fitted.j['nodes'] == reference.j['nodes']
    skin = reference.j['skins'][0]
    sword = next(i for i, n in enumerate(skin['joints']) if reference.j['nodes'][n]['name'] == 'Sword')
    # Construct a compact GLB; unused source body/weapon buffers are excluded.
    result = Glb.__new__(Glb)
    result.b = bytearray()
    result.j = {key: copy.deepcopy(reference.j[key]) for key in ['asset', 'nodes', 'scenes', 'scene'] if key in reference.j}
    result.j.update(accessors=[], bufferViews=[], meshes=[], materials=[], textures=[], images=[], samplers=[])
    result.j['asset']['extras']['appearance'] = 'role1'
    accessors, materials, textures, images, samplers = {}, {}, {}, {}, {}

    def accessor(g, index):
        key = (id(g), index)
        if key not in accessors:
            a = g.j['accessors'][index]
            accessors[key] = result.add(g.array(index), a['type'], a['componentType'])
        return accessors[key]

    def texture(g, index):
        key = (id(g), index)
        if key in textures:
            return textures[key]
        item = copy.deepcopy(g.j['textures'][index])
        ikey = (id(g), item['source'])
        if ikey not in images:
            im = copy.deepcopy(g.j['images'][item['source']])
            view = g.j['bufferViews'][im['bufferView']]
            start = view.get('byteOffset', 0)
            pixels = bytes(g.b[start:start+view['byteLength']])
            if g is reference:
                # Only the small metal guard uses the old character atlas.
                # Keep the new character's full 1024px texture; avoid shipping
                # another full body atlas for those 96 guard triangles.
                f = td/'approved-guard.png'
                f.write_bytes(pixels)
                image = bpy.data.images.load(str(f), check_existing=False)
                image.scale(512, 512)
                image.filepath_raw = str(td/'guard-512.png')
                image.file_format = 'PNG'
                image.save()
                pixels = Path(image.filepath_raw).read_bytes()
                bpy.data.images.remove(image)
            while len(result.b) % 4:
                result.b.append(0)
            im['bufferView'] = len(result.j['bufferViews'])
            result.j['bufferViews'].append({'buffer': 0, 'byteOffset': len(result.b), 'byteLength': len(pixels)})
            result.b.extend(pixels)
            images[ikey] = len(result.j['images'])
            result.j['images'].append(im)
        item['source'] = images[ikey]
        if 'sampler' in item:
            skey = (id(g), item['sampler'])
            if skey not in samplers:
                samplers[skey] = len(result.j['samplers'])
                result.j['samplers'].append(copy.deepcopy(g.j['samplers'][item['sampler']]))
            item['sampler'] = samplers[skey]
        textures[key] = len(result.j['textures'])
        result.j['textures'].append(item)
        return textures[key]

    def material(g, index):
        key = (id(g), index)
        if key not in materials:
            item = copy.deepcopy(g.j['materials'][index])
            def walk(obj):
                if not isinstance(obj, dict):
                    return
                for k, v in obj.items():
                    if k.endswith('Texture') and isinstance(v, dict) and 'index' in v:
                        v['index'] = texture(g, v['index'])
                    else:
                        walk(v)
            walk(item)
            materials[key] = len(result.j['materials'])
            result.j['materials'].append(item)
        return materials[key]

    def primitive(g, p):
        return {'attributes': {k: accessor(g, v) for k, v in p['attributes'].items()},
                'indices': accessor(g, p['indices']), 'material': material(g, p['material'])}

    prims = []
    # New torso/limbs and repaired back; exclude its trial hand and weapon.
    for p in fitted.j['meshes'][0]['primitives'][:-1]:
        if not np.all(fitted.array(p['attributes']['JOINTS_0'])[:, 0] == sword):
            prims.append(primitive(fitted, p))
    body_material = prims[0]['material']
    for p in reference.j['meshes'][0]['primitives'][:-1]:
        if np.all(reference.array(p['attributes']['JOINTS_0'])[:, 0] == sword):
            prims.append(primitive(reference, p))
    # Identical closed hand geometry/weights; use the new character's skin texel.
    p = reference.j['meshes'][0]['primitives'][-1]
    hp = primitive(reference, p)
    hp['material'] = body_material
    hp['attributes']['TEXCOORD_0'] = result.add([hand_report['gripFrame']['skinTexelUV']] * reference.j['accessors'][p['attributes']['POSITION']]['count'], 'VEC2')
    prims.append(hp)
    result.j['meshes'] = [{'name': 'Role1 appearance with approved right-hand grip', 'primitives': prims}]
    result.j['skins'] = copy.deepcopy(reference.j['skins'])
    result.j['skins'][0]['inverseBindMatrices'] = accessor(reference, skin['inverseBindMatrices'])
    result.j['animations'] = copy.deepcopy(reference.j['animations'])
    for anim in result.j['animations']:
        for sampler in anim['samplers']:
            for key in ['input', 'output']:
                sampler[key] = accessor(reference, sampler[key])
    result.save(output)
    # Verify every animation sample, interpolation and target against approved.
    for a, b in zip(result.j['animations'], reference.j['animations']):
        assert a['channels'] == b['channels'] and a['name'] == b['name']
        for x, y in zip(a['samplers'], b['samplers']):
            assert x.get('interpolation', 'LINEAR') == y.get('interpolation', 'LINEAR')
            for key in ['input', 'output']:
                assert np.array_equal(result.array(x[key]), reference.array(y[key]))
    assert output.stat().st_size < 5_000_000
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(output))
    bpy.ops.wm.save_as_mainfile(filepath=str(blend))
    meta = {'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
            'approvedRoleSha256': hashlib.sha256(approved.read_bytes()).hexdigest(),
            'outputSha256': hashlib.sha256(output.read_bytes()).hexdigest(),
            'license': 'User explicitly confirmed authorized for game use and modification in chat, 2026-11-03',
            'blenderVersion': bpy.app.version_string, 'clips': [a['name'] for a in result.j['animations']],
            'allSixAnimationsSampleExact': True, 'rigAndGripUnchanged': True,
            'removedBackSwordTriangles': fit_report['removedBackSwordTriangles'],
            'handVertices': hand_report['handVertices'], 'handWatertight': hand_report['handWatertight'],
            'usesApprovedWeaponAndHandGeometry': True, 'modelBytes': output.stat().st_size}
    report.write_text(json.dumps(meta, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(meta))
