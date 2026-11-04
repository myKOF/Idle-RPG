"""Recover licensed PBR maps without changing approved geometry or animation.
blender -b --python-exit-code 1 --python restore_pbr.py -- PROJECT LIBRARY_PACKAGE
Source packages must already exist in the configured asset library.
"""
import bpy
import copy
import hashlib
import json
from pathlib import Path
import struct
import sys
import tempfile
import numpy as np

project, package = map(Path, sys.argv[sys.argv.index('--') + 1:])
library = package.parent
exports = package / 'exports'
sources = package / 'source'
exports.mkdir(parents=True, exist_ok=True)
sources.mkdir(parents=True, exist_ok=True)
recipes = [
    ('role', 'hero3d-role-20261103', 'Role.glb', [0]),
    ('role1', 'hero3d-role1-20261103', 'Role1.glb', [0]),
    ('role2', 'hero3d-role2-20261104', 'Role2.glb', [0, 1]),
    ('role3', 'hero3d-role3-20261104', 'Role3.glb', [0, 1]),
]

class Glb:
    def __init__(self, file):
        raw = Path(file).read_bytes()
        n = struct.unpack_from('<I', raw, 12)[0]
        self.j = json.loads(raw[20:20+n])
        self.b = bytearray(raw[28+n:])

    def image(self, texture):
        image = self.j['images'][self.j['textures'][texture]['source']]
        view = self.j['bufferViews'][image['bufferView']]
        offset = view.get('byteOffset', 0)
        return self.b[offset:offset+view['byteLength']]

    def add_image(self, file):
        while len(self.b) % 4:
            self.b.append(0)
        data = Path(file).read_bytes()
        vi = len(self.j['bufferViews'])
        self.j['bufferViews'].append({'buffer': 0, 'byteOffset': len(self.b), 'byteLength': len(data)})
        self.b.extend(data)
        ii = len(self.j['images'])
        self.j['images'].append({'bufferView': vi, 'mimeType': 'image/png'})
        ti = len(self.j['textures'])
        self.j['textures'].append({'source': ii})
        return ti

    def save(self, file):
        self.j['buffers'] = [{'byteLength': len(self.b)}]
        js = json.dumps(self.j, separators=(',', ':')).encode()
        js += b' ' * (-len(js) % 4)
        binary = self.b + b'\0' * (-len(self.b) % 4)
        Path(file).write_bytes(struct.pack('<III', 0x46546c67, 2, 28+len(js)+len(binary)) +
            struct.pack('<II', len(js), 0x4e4f534a) + js +
            struct.pack('<II', len(binary), 0x004e4942) + binary)

def sha(file):
    return hashlib.sha256(Path(file).read_bytes()).hexdigest()

report = {'blender': bpy.app.version_string, 'models': {}}
config = {'version': 1, 'appearances': {}}
for role, base_package, filename, body in recipes:
    original = library / base_package / 'source' / filename
    approved = project / 'images/models/hero3d' / (role + '.glb')
    raw = Glb(original)
    material = raw.j['materials'][0]
    mr = material['pbrMetallicRoughness']
    info = {'sourcePackage': base_package, 'sourceSha256': sha(original),
            'approvedModelSha256': sha(approved), 'maps': {}}
    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        for kind, texture in [('normal', material['normalTexture']), ('metallic-roughness', mr['metallicRoughnessTexture'])]:
            file = td / (kind + '.jpg')
            file.write_bytes(raw.image(texture['index']))
            image = bpy.data.images.load(str(file), check_existing=False)
            image.colorspace_settings.name = 'Non-Color'
            original_size = list(image.size)
            image.scale(1024, 1024)
            pixels = np.empty(1024 * 1024 * 4, dtype=np.float32)
            image.pixels.foreach_get(pixels)
            pixels = pixels.reshape(-1, 4)
            if kind == 'normal':
                # Filtering tangent-space normals changes their length.
                vectors = pixels[:, :3] * 2 - 1
                lengths = np.linalg.norm(vectors, axis=1, keepdims=True)
                vectors /= np.maximum(lengths, 1e-6)
                pixels[:, :3] = vectors * .5 + .5
                image.pixels.foreach_set(pixels.reshape(-1))
            target = exports / (role + '-' + kind + '.png')
            image.filepath_raw = str(target)
            image.file_format = 'PNG'
            image.save()
            info['maps'][kind] = {'file': target.name, 'sourceSize': original_size,
                'size': [1024, 1024], 'sha256': sha(target),
                'channelMean': pixels[:, :3].mean(0).tolist(), 'bytes': target.stat().st_size}
            bpy.data.images.remove(image)
        binding = {'primitives': body, 'normal': role+'-normal.png',
            'metallicRoughness': role+'-metallic-roughness.png',
            'metalness': mr.get('metallicFactor', 1), 'roughness': mr.get('roughnessFactor', 1),
            'normalScale': material['normalTexture'].get('scale', 1)}
        # The unchanged guard uses the approved Role atlas. Its metal finish
        # does not borrow the new body's UV map. The sculpted hand has no map.
        bindings = [binding, {'primitives': [3], 'metalness': .7, 'roughness': .4}]
        if role == 'role3':
            bindings.append({'primitives': [5], 'metalness': .65, 'roughness': .45})
        config['appearances'][role] = {'bindings': bindings}
        # Save an editable, packed Blender source with the identical approved
        # mesh / skin / animation and primitive-specific restored materials.
        preview = Glb(approved)
        for spec in bindings:
            normal = preview.add_image(exports / spec['normal']) if spec.get('normal') else None
            packed = preview.add_image(exports / spec['metallicRoughness']) if spec.get('metallicRoughness') else None
            for pi in spec['primitives']:
                primitive = preview.j['meshes'][0]['primitives'][pi]
                mat = copy.deepcopy(preview.j['materials'][primitive['material']])
                mat['name'] += ' PBR primitive ' + str(pi)
                pbr = mat['pbrMetallicRoughness']
                pbr.update(metallicFactor=spec['metalness'], roughnessFactor=spec['roughness'])
                if normal is not None:
                    mat['normalTexture'] = {'index': normal, 'scale': spec['normalScale']}
                    pbr['metallicRoughnessTexture'] = {'index': packed}
                primitive['material'] = len(preview.j['materials'])
                preview.j['materials'].append(mat)
        preview.save(td / 'preview.glb')
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=str(td / 'preview.glb'))
        bpy.ops.file.pack_all()
        bpy.ops.wm.save_as_mainfile(filepath=str(sources / (role + '-pbr.blend')))
        info['actions'] = len(bpy.data.actions)
        info['allUsedImagesPacked'] = all(im.packed_file for im in bpy.data.images if im.users and im.type == 'IMAGE')
        assert info['actions'] == 6 and info['allUsedImagesPacked']
    report['models'][role] = info
(exports / 'materials.json').write_text(json.dumps(config, indent=2)+'\n', encoding='utf-8')
(sources / 'author-report.json').write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
print(json.dumps(report))
