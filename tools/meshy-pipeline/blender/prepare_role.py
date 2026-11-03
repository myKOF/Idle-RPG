"""Fit the licensed Role appearance to the existing hero rig in Blender.

blender -b --python prepare_role.py -- Role.glb knight.glb output.glb source.blend report.json

The existing rig, inverse binds, animation accessors and binary data are copied
verbatim. Only the appearance is fitted to its bind pose; no motion is retargeted.
"""
import copy
import hashlib
import json
import math
import struct
import sys
import tempfile
from pathlib import Path

import bpy
import bmesh
import numpy as np
from mathutils import Matrix, Quaternion, Vector


class Glb:
    def __init__(self, path):
        self.raw = Path(path).read_bytes()
        size = struct.unpack_from('<I', self.raw, 12)[0]
        self.j = json.loads(self.raw[20:20 + size])
        self.b = bytearray(self.raw[28 + size:])

    def array(self, index):
        a = self.j['accessors'][index]
        v = self.j['bufferViews'][a['bufferView']]
        nc = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[a['type']]
        dt = np.dtype({5121: 'u1', 5123: '<u2', 5125: '<u4', 5126: '<f4'}[a['componentType']])
        return np.ndarray((a['count'], nc), dtype=dt, buffer=self.b,
                          offset=v.get('byteOffset', 0) + a.get('byteOffset', 0),
                          strides=(v.get('byteStride', dt.itemsize * nc), dt.itemsize)).copy()

    def view(self, data):
        while len(self.b) % 4:
            self.b.append(0)
        i = len(self.j['bufferViews'])
        self.j['bufferViews'].append({'buffer': 0, 'byteOffset': len(self.b), 'byteLength': len(data)})
        self.b.extend(data)
        return i

    def add(self, values, kind, component=5126):
        arr = np.array(values, dtype={5126: '<f4', 5123: '<u2', 5125: '<u4'}[component])
        if arr.ndim == 1:
            arr = arr.reshape((-1, 1))
        a = {'bufferView': self.view(arr.tobytes()), 'componentType': component,
             'count': len(arr), 'type': kind}
        if kind == 'VEC3' and component == 5126:
            a.update(min=arr.min(0).tolist(), max=arr.max(0).tolist())
        i = len(self.j['accessors'])
        self.j['accessors'].append(a)
        return i

    def save(self, path):
        self.j['buffers'] = [{'byteLength': len(self.b)}]
        js = json.dumps(self.j, separators=(',', ':')).encode()
        js += b' ' * (-len(js) % 4)
        binary = self.b + b'\0' * (-len(self.b) % 4)
        data = (struct.pack('<III', 0x46546c67, 2, 28 + len(js) + len(binary)) +
                struct.pack('<II', len(js), 0x4e4f534a) + js +
                struct.pack('<II', len(binary), 0x004e4942) + binary)
        Path(path).write_bytes(data)


def bind_world(g):
    skin = g.j['skins'][0]
    return {g.j['nodes'][ni]['name']: Matrix(m.reshape((4, 4))).transposed().inverted()
            for ni, m in zip(skin['joints'], g.array(skin['inverseBindMatrices']))}


def shortest(a, b):
    return a.normalized().rotation_difference(b.normalized())


source, knight, output, blend, report = map(Path, sys.argv[sys.argv.index('--') + 1:])
role, gold = Glb(source), Glb(knight)
before = bytes(gold.b)
animation_json = copy.deepcopy(gold.j['animations'])
rw, gw = bind_world(role), bind_world(gold)
rp = role.j['meshes'][0]['primitives'][0]
pos = role.array(rp['attributes']['POSITION'])
uv = role.array(rp['attributes']['TEXCOORD_0'])
joint = role.array(rp['attributes']['JOINTS_0'])
weight = role.array(rp['attributes']['WEIGHTS_0'])
triangles = role.array(rp['indices']).reshape((-1, 3))
rn = [role.j['nodes'][n]['name'] for n in role.j['skins'][0]['joints']]
gn = [gold.j['nodes'][n]['name'] for n in gold.j['skins'][0]['joints']]
mapping = {'Spine': 'Spine02', 'Spine1': 'Spine01', 'Spine2': 'Spine',
           'Neck': 'neck', 'HeadTop_End': 'head_end'}
for n in rn:
    name = n.replace('mixamorig:', '')
    if 'Hand' in name:
        mapping[name] = 'RightHand' if name.startswith('Right') else 'LeftHand'
    elif name.endswith('Toe_End'):
        mapping[name] = name.replace('Toe_End', 'ToeBase')
    else:
        mapping.setdefault(name, name)
assert all(mapping[n.replace('mixamorig:', '')] in gn for n in rn)

# Model edit: the sword is a nearly planar strip behind the body. Its seam is
# welded to the strap in the supplied mesh, so classify in its own axis frame.
axis = Vector((0.266, -0.964, 0)).normalized()
edge = Vector((0.964, 0.266, 0)).normalized()
root = Vector((-0.092, 1.445, -0.144))
local = np.array([[Vector(p).dot(edge) - root.dot(edge),
                   (Vector(p) - root).dot(axis), p[2]] for p in pos])
width = np.where(local[:, 1] < .045, .095, .045)
sword = ((np.abs(local[:, 0]) < width) & (local[:, 1] > -.31) &
         (local[:, 1] < .96) & (pos[:, 2] < np.where(local[:, 1] < .04, -.09, -.115)))
remove = sword[triangles].any(1)
body_tri = triangles[~remove]
used = np.unique(body_tri)
hilt_tri = triangles[(sword[triangles].all(1)) &
                     (local[triangles, 1].mean(1) < .025) &
                     (local[triangles, 1].min(1) > -.31)]

# Fit the appearance to the existing rig's bind pose. Swing a source segment
# onto its target, retaining anatomical roll; scale along the bone only. The
# animation/rig itself never changes, including the corrected wrist tracks.
children = {'Hips': 'Spine', 'Spine': 'Spine1', 'Spine1': 'Spine2',
            'Spine2': 'Neck', 'Neck': 'Head', 'Head': 'HeadTop_End'}
for side in ('Left', 'Right'):
    children.update({side + a: side + b for a, b in (
        ('Shoulder', 'Arm'), ('Arm', 'ForeArm'), ('ForeArm', 'Hand'),
        ('UpLeg', 'Leg'), ('Leg', 'Foot'), ('Foot', 'ToeBase'))})
global_scale = 1.8 / 1.7
fits = {}
for name in rn:
    short = name.replace('mixamorig:', '')
    dest = mapping[short]
    base = rw[name]
    if 'Hand' in short:
        hand_name = ('Right' if short.startswith('Right') else 'Left') + 'Hand'
        src_hand = rw['mixamorig:' + hand_name]
        tgt_hand = gw[hand_name]
        # Both rigs use local +Y towards the fingers. Fit a closed, static grip
        # into the old hand frame, then collapse finger weights onto that hand.
        q = tgt_hand.to_quaternion() @ src_hand.to_quaternion().inverted()
        fit = Matrix.LocRotScale(tgt_hand.translation, q, Vector((global_scale,) * 3)) @ Matrix.Translation(-src_hand.translation)
    else:
        q = Quaternion()
        scale = global_scale
        if short in children:
            child = children[short]
            a = rw['mixamorig:' + child].translation - base.translation
            b = gw[mapping[child]].translation - gw[dest].translation
            q = shortest(a, b)
            scale = b.length / a.length
        else:
            q = gw[dest].to_quaternion() @ base.to_quaternion().inverted()
        fit = Matrix.LocRotScale(gw[dest].translation, q, Vector((scale,) * 3)) @ Matrix.Translation(-base.translation)
    fits[name] = fit

# Curl fingers in Blender's bone frame before fitting the closed hand to the
# existing wrist. A constant hand shape follows all the original animations.
role_parent = {}
for i, n in enumerate(role.j['nodes']):
    for child in n.get('children', []):
        role_parent[child] = i
role_by_name = {n['name']: i for i, n in enumerate(role.j['nodes'])}
finger_world = {}
def curled_world(name):
    if name in finger_world:
        return finger_world[name]
    ni = role_by_name[name]
    pn = role.j['nodes'][role_parent[ni]]['name']
    if 'Hand' not in name or name.endswith('Hand'):
        result = rw[name]
    else:
        rel = rw[pn].inverted() @ rw[name]
        if not name.endswith('4'):
            # Flex around finger local X. Thumb has a shorter opposition curl.
            angle = math.radians(65 if 'Thumb' in name else (80 if name.endswith('1') else 85))
            rel = rel @ Matrix.Rotation(angle, 4, 'X')
        result = curled_world(pn) @ rel
    finger_world[name] = result
    return result
for name in rn:
    short = name.replace('mixamorig:', '')
    if 'Hand' in short and not short.endswith('Hand'):
        fits[name] = fits[name] @ curled_world(name) @ rw[name].inverted()

new_pos, new_joints, new_weights = [], [], []
for vi in used:
    p = Vector(pos[vi])
    v = Vector((0, 0, 0))
    weights = {}
    for ji, w in zip(joint[vi], weight[vi]):
        if w <= 0:
            continue
        name = rn[int(ji)]
        v += (fits[name] @ p) * float(w)
        target_joint = gn.index(mapping[name.replace('mixamorig:', '')])
        weights[target_joint] = weights.get(target_joint, 0) + float(w)
    entries = sorted(weights.items(), key=lambda it: -it[1])[:4]
    total = sum(w for _, w in entries)
    new_pos.append(list(v))
    new_joints.append([j for j, _ in entries] + [0] * (4 - len(entries)))
    new_weights.append([w / total for _, w in entries] + [0] * (4 - len(entries)))
remap = {int(old): i for i, old in enumerate(used)}
body_faces = [[remap[int(i)] for i in t] for t in body_tri]

bpy.ops.wm.read_factory_settings(use_empty=True)
mesh = bpy.data.meshes.new('Role fitted appearance')
mesh.from_pydata(new_pos, [], body_faces)
mesh.update()
uv_layer = mesh.uv_layers.new(name='Role original UV')
for loop in mesh.loops:
    uv_layer.data[loop.index].uv = uv[used[loop.vertex_index]]
# Weld the attachment's duplicated UV seams only inside Blender's editable
# mesh. The boundary left by removing the sword can then be filled as leather,
# while per-corner UVs retain every original garment/skin texture seam.
bm = bmesh.new()
bm.from_mesh(mesh)
original_id = bm.verts.layers.int.new('original_weight_vertex')
for v in bm.verts:
    v[original_id] = v.index
bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=.00001)
layer = bm.loops.layers.uv.active
edges = [e for e in bm.edges if e.is_boundary]
filled = bmesh.ops.holes_fill(bm, edges=edges, sides=0)['faces']
for face in filled:
    face.material_index = 1
    for loop in face.loops:
        nearby = [other for other in loop.vert.link_loops if other.face not in filled]
        if nearby:
            loop[layer].uv = nearby[0][layer].uv
bmesh.ops.triangulate(bm, faces=list(bm.faces))
bm.normal_update()
body_p, body_n, body_uv, body_j, body_w, body_m = [], [], [], [], [], []
for face in bm.faces:
    body_m.append(face.material_index)
    for loop in face.loops:
        old = loop.vert[original_id]
        body_p.append(list(loop.vert.co))
        body_n.append(list(loop.vert.normal))
        body_uv.append(list(loop[layer].uv))
        body_j.append(new_joints[old])
        body_w.append(new_weights[old])
patched_faces = len(filled)
bm.to_mesh(mesh)
bm.free()
# Recompute normals with Blender after fitting and closing the bind mesh.
new_pos, normals, new_joints, new_weights = body_p, body_n, body_j, body_w
body_faces = np.arange(len(body_p)).reshape((-1, 3)).tolist()
body_attributes = {'POSITION': gold.add(new_pos, 'VEC3'), 'NORMAL': gold.add(normals, 'VEC3'),
                   'TEXCOORD_0': gold.add(body_uv, 'VEC2'),
                   'JOINTS_0': gold.add(new_joints, 'VEC4', 5123),
                   'WEIGHTS_0': gold.add(new_weights, 'VEC4')}

# Keep only the licensed base color, downsampled by Blender to the existing
# runtime texture budget. The old knight's embedded textures remain untouched.
image = role.j['images'][1]
view = role.j['bufferViews'][image['bufferView']]
png = bytes(role.b[view.get('byteOffset', 0):view.get('byteOffset', 0) + view['byteLength']])
with tempfile.TemporaryDirectory() as td:
    src_png = Path(td) / 'role.png'
    src_png.write_bytes(png)
    texture = bpy.data.images.load(str(src_png))
    texture.scale(1024, 1024)
    texture.filepath_raw = str(Path(td) / 'role-1024.png')
    texture.file_format = 'PNG'
    texture.save()
    tex_bytes = Path(texture.filepath_raw).read_bytes()
image_idx = len(gold.j['images'])
gold.j['images'].append({'bufferView': gold.view(tex_bytes), 'mimeType': 'image/png', 'name': 'Role authorized base color'})
tex_idx = len(gold.j['textures'])
gold.j['textures'].append({'source': image_idx})
body_mat = len(gold.j['materials'])
gold.j['materials'].append({'name': 'Role cloth and skin', 'doubleSided': True,
                            'pbrMetallicRoughness': {'baseColorTexture': {'index': tex_idx}, 'metallicFactor': 0, 'roughnessFactor': .85}})
patch_mat = len(gold.j['materials'])
gold.j['materials'].append({'name': 'Repaired leather under back sword', 'doubleSided': True,
                            'pbrMetallicRoughness': {'baseColorFactor': [.16,.085,.04,1], 'metallicFactor': 0, 'roughnessFactor': .9}})

# Rebuild the blade as straight planar faces with beveled edges. It is 80% of
# the attachment's guard-to-tip length, not 80% of hilt + blade together.
blade_before = float(local[sword, 1].max())
blade_length = blade_before * .8
sword_world = gw['Sword']
center_x, center_z, guard_y = .053, .005, .115
verts, faces, material_ids = [], [], []
def ring(y, width, thick):
    start = len(verts)
    for x, z in [(-width, 0), (-width * .78, thick), (width * .78, thick),
                 (width, 0), (width * .78, -thick), (-width * .78, -thick)]:
        p = sword_world @ Vector(((center_x + x) * 100, (guard_y + y) * 100, (center_z + z) * 100))
        verts.append(list(p))
    return start
def connect(a, b, mat):
    for k in range(6):
        faces.append((a + k, a + (k + 1) % 6, b + (k + 1) % 6, b + k))
        material_ids.append(mat)
previous = None
for y, width0 in [(0, .026), (blade_length * .7, .023), (blade_length * .92, .012), (blade_length, .0002)]:
    r = ring(y, width0, .0035 if y < blade_length else .0002)
    if previous is not None:
        connect(previous, r, 0)
    previous = r
faces.extend([(0, 5, 4, 3, 2, 1), tuple(range(previous, previous + 6))])
material_ids.extend([0, 0])
smesh = bpy.data.meshes.new('Straight shortened blade and right hand sword')
smesh.from_pydata(verts, [], faces)
smesh.update()
steel = len(gold.j['materials'])
gold.j['materials'].extend([
    {'name': 'Role sword flat steel', 'pbrMetallicRoughness': {'baseColorFactor': [.57,.63,.68,1], 'metallicFactor': .7, 'roughnessFactor': .3}}])
primitives = []
for material, index in [(0, body_mat), (1, patch_mat)]:
    fs = np.array(body_faces)[np.array(body_m) == material].reshape(-1)
    primitives.append({'attributes': body_attributes, 'indices': gold.add(fs, 'SCALAR', 5123), 'material': index})
sj = gn.index('Sword')
for material in range(1):
    ids = [i for i, m in enumerate(material_ids) if m == material]
    # Split corners to preserve flat blade planes and hard bevels.
    ps, ns, indices = [], [], []
    for pi in ids:
        face = faces[pi]
        normal = smesh.polygons[pi].normal
        start = len(ps)
        for vi in face:
            ps.append(verts[vi]); ns.append(list(normal))
        for k in range(1, len(face)-1):
            indices.extend([start, start+k, start+k+1])
    attrs = {'POSITION': gold.add(ps, 'VEC3'), 'NORMAL': gold.add(ns, 'VEC3'),
             'JOINTS_0': gold.add([[sj,0,0,0]] * len(ps), 'VEC4', 5123),
             'WEIGHTS_0': gold.add([[1,0,0,0]] * len(ps), 'VEC4')}
    primitives.append({'attributes': attrs, 'indices': gold.add(indices, 'SCALAR', 5123), 'material': steel + material})
# The supplied textured hilt is moved as a rigid part, with the same grip frame
# as the old knight. Only the blade is rebuilt/shortened.
hp, hn, hu = [], [], []
for triangle in hilt_tri:
    converted = []
    for vi in triangle:
        x, y, z = local[vi]
        converted.append(sword_world @ Vector(((center_x + x) * 100,
                                               (guard_y + y) * 100,
                                               (center_z - (z - root.z)) * 100)))
    normal = (converted[1]-converted[0]).cross(converted[2]-converted[0]).normalized()
    for vi, p in zip(triangle, converted):
        hp.append(list(p)); hn.append(list(normal)); hu.append(uv[vi].tolist())
attrs = {'POSITION': gold.add(hp, 'VEC3'), 'NORMAL': gold.add(hn, 'VEC3'),
         'TEXCOORD_0': gold.add(hu, 'VEC2'),
         'JOINTS_0': gold.add([[sj,0,0,0]] * len(hp), 'VEC4', 5123),
         'WEIGHTS_0': gold.add([[1,0,0,0]] * len(hp), 'VEC4')}
primitives.append({'attributes': attrs, 'indices': gold.add(list(range(len(hp))), 'SCALAR', 5123), 'material': body_mat})
gold.j['meshes'][0] = {'name': 'Role appearance with original hero motions', 'primitives': primitives}
gold.j['asset']['extras'] = {'appearance': 'role', 'capeCollision': False, 'textureGrade': False}
assert bytes(gold.b[:len(before)]) == before
assert gold.j['animations'] == animation_json
gold.save(output)

# Complete textured, rigged editable Blender source, including every unchanged
# imported action. Save the original attachment separately in the asset library.
bpy.data.meshes.remove(mesh)
bpy.data.meshes.remove(smesh)
bpy.data.images.remove(texture)
bpy.ops.import_scene.gltf(filepath=str(output))
for obj in bpy.context.scene.objects:
    obj['appearance_source'] = 'Role.glb; user confirmed licensed 2026-11-03'
    obj['animation_source'] = 'Existing Sunbrand Knight; binary animation data unchanged'
bpy.ops.wm.save_as_mainfile(filepath=str(blend))
result = {'sourceSha256': hashlib.sha256(role.raw).hexdigest(),
          'knightSha256': hashlib.sha256(Glb(knight).raw).hexdigest(),
          'outputSha256': hashlib.sha256(Path(output).read_bytes()).hexdigest(),
          'blenderVersion': bpy.app.version_string,
          'originalAnimationBinaryPreserved': True,
          'originalRigPreserved': True, 'sourceAnimationIgnored': True,
          'clips': [a['name'] for a in animation_json],
          'removedBackSwordVertices': int(sword.sum()), 'removedBackSwordTriangles': int(remove.sum()),
          'bodyVertices': len(new_pos), 'bodyTriangles': len(body_faces),
          'patchedBackFaces': patched_faces,
          'bladeBeforeMeters': blade_before, 'bladeAfterMeters': blade_length, 'bladeRatio': .8,
          'gripBone': 'Sword', 'textureSize': [1024,1024]}
Path(report).write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
print(json.dumps(result))
