"""Repair the mirrored palm of the existing closed grip without changing motion.
blender -b --python forward_grip.py -- input.glb output.glb source.blend report.json
Input: the archived 20261103 grip export (before forwardGripVersion).
"""
import hashlib
import json
from pathlib import Path
import struct
import sys
import bpy
import bmesh
import numpy as np
from mathutils import Matrix, Vector

source, output, blend, report = map(Path, sys.argv[sys.argv.index('--')+1:])
raw = source.read_bytes()
n = struct.unpack_from('<I', raw, 12)[0]
j = json.loads(raw[20:20+n])
binary = bytearray(raw[28+n:])
original_binary = bytes(binary)
assert not j['asset']['extras'].get('forwardGripVersion'), 'Already repaired; use archived input'

def array(index):
    a = j['accessors'][index]
    v = j['bufferViews'][a['bufferView']]
    k = {'SCALAR':1, 'VEC2':2, 'VEC3':3, 'VEC4':4, 'MAT4':16}[a['type']]
    dt = np.dtype({5121:'u1', 5123:'<u2', 5125:'<u4', 5126:'<f4'}[a['componentType']])
    return np.ndarray((a['count'], k), dtype=dt, buffer=binary,
        offset=v.get('byteOffset',0)+a.get('byteOffset',0),
        strides=(v.get('byteStride',dt.itemsize*k),dt.itemsize))

skin = j['skins'][0]
names = [j['nodes'][i]['name'] for i in skin['joints']]
world = [Matrix(a.reshape(4,4)).transposed().inverted() for a in array(skin['inverseBindMatrices'])]
hand, sword = world[names.index('RightHand')], world[names.index('Sword')]
forward = (hand.to_quaternion() @ Vector((0,1,0))).normalized()
axis = (sword.to_quaternion() @ Vector((0,1,0))).normalized()
x = (forward-axis*forward.dot(axis)).normalized()
z = x.cross(axis).normalized()
# The old sculpt has a palm facing +z, while its thumb is on +axis:
# x cross palmNormal points to -axis, making it a left hand on a right wrist.
# Reflect only the hand across its longitudinal plane to restore right-hand
# anatomy. Keep the blade orientation, edge orientation and all wrist tracks.
reflection = Matrix.Identity(4)
for row in range(3):
    for col in range(3):
        reflection[row][col] -= 2*z[row]*z[col]
reflection.translation = hand.translation-reflection.to_3x3()@hand.translation
grip = j['asset']['extras']['gripFrame']
old_center = sword @ Vector(grip['gripPointInSword'])
new_center = reflection @ old_center
delta = new_center-old_center
primitives = j['meshes'][0]['primitives']
hp = primitives[-1]
positions = array(hp['attributes']['POSITION']).copy()
faces = array(hp['indices']).reshape(-1,3).copy()
bpy.ops.wm.read_factory_settings(use_empty=True)
mesh = bpy.data.meshes.new('Anatomical right-hand forward grip')
mesh.from_pydata(positions.tolist(), [], faces.tolist())
mesh.update()
bm = bmesh.new()
bm.from_mesh(mesh)
bmesh.ops.transform(bm, matrix=reflection, verts=list(bm.verts))
bmesh.ops.reverse_faces(bm, faces=list(bm.faces))
bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
bm.normal_update()
assert not any(e.is_boundary for e in bm.edges), 'Grip must remain watertight'
assert bm.calc_volume(signed=True)>0, 'Hand normals must face outward'
bm.to_mesh(mesh)
bm.free()
array(hp['attributes']['POSITION'])[:] = [list(v.co) for v in mesh.vertices]
array(hp['attributes']['NORMAL'])[:] = [list(v.normal) for v in mesh.vertices]
# Mirror reverses winding. Keep the exact vertex/index layout and weights.
array(hp['indices']).reshape(-1,3)[:] = faces[:,[0,2,1]]
for p in primitives[:-1]:
    joints = array(p['attributes']['JOINTS_0'])
    if np.all(joints[:,0] == names.index('Sword')):
        array(p['attributes']['POSITION'])[:] += np.array(delta, dtype=np.float32)
for p in primitives:
    a = j['accessors'][p['attributes']['POSITION']]
    points = array(p['attributes']['POSITION'])
    a['min'], a['max'] = points.min(0).tolist(), points.max(0).tolist()
for key in ['gripPointInSword','bladeRootInSword','bladeTipInSword']:
    grip[key] = list(sword.inverted() @ ((sword @ Vector(grip[key]))+delta))
grip.update(orientation='forward', handedness='right')
j['asset']['extras']['forwardGripVersion'] = 1
# Animation and inverse binds are not regenerated, appended or resampled.
for a in j['animations']:
    for sampler in a['samplers']:
        for key in ['input','output']:
            ac = j['accessors'][sampler[key]]
            view = j['bufferViews'][ac['bufferView']]
            at = view.get('byteOffset',0)
            assert bytes(binary[at:at+view['byteLength']]) == original_binary[at:at+view['byteLength']]
js = json.dumps(j,separators=(',',':')).encode()
js += b' '*(-len(js)%4)
data = struct.pack('<III',0x46546c67,2,28+len(js)+len(binary))+struct.pack('<II',len(js),0x4e4f534a)+js+struct.pack('<II',len(binary),0x004e4942)+binary
output.write_bytes(data)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(output))
bpy.ops.wm.save_as_mainfile(filepath=str(blend))
result = {'inputSha256':hashlib.sha256(raw).hexdigest(), 'outputSha256':hashlib.sha256(data).hexdigest(),
    'forwardGripVersion':1, 'handedness':'right', 'orientation':'forward',
    'allSixAnimationBytesUnchanged':True, 'rigUnchanged':True,
    'bladeOrientationUnchanged':True, 'bladeLengthUnchanged':True,
    'gripTranslationMeters':list(delta), 'handVertices':len(positions), 'handTriangles':len(faces),
    'handWatertight':True, 'blenderVersion':bpy.app.version_string}
report.write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
print(json.dumps(result))
