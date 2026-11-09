"""Use Role7's original PBR on the approved Role6 geometry and all six clips.

blender -b --python-exit-code 1 --python prepare_role7.py --
  ROLE7_SOURCE ROLE6_SOURCE ROLE6_APPROVED ROLE6_REPORT NEW_SWORD OUTPUT BLEND REPORT
The matching source topology/UV and near-identical positions are prerequisites.
"""
from pathlib import Path

# Reuse the existing binary reader/writer without executing the Role6 fitter.
exec(Path(__file__).with_name('prepare_role6.py').read_text(encoding='utf-8').split(
    'source,approved,sword_file,output,blend,report=')[0])

source, original6, approved, approved_report, sword_file, output, blend, report = map(
    Path, sys.argv[sys.argv.index('--') + 1:])
raw, raw6, base, sword = Glb(source), Glb(original6), Glb(approved), Glb(sword_file)
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
assert sha(source) == '43017e0faa6a242afb923741648882993b51807fea666566d344b1c54a556a01'
assert sha(original6) == 'cdfe8ccab67419b94dffb805a45b06d5370196dd21b43d36a8945a38a77be901'
assert sha(approved) == 'a051e9dd30526b5934110e17d3d4a9a814e5eb30c85a371fac60584aaca09a1c'
assert any(n.get('extras', {}).get('role7SwordV1') for n in sword.j['nodes'])
meta6 = json.loads(approved_report.read_text(encoding='utf-8'))
raw_primitive, original_primitive = raw.j['meshes'][0]['primitives'][0], raw6.j['meshes'][0]['primitives'][0]
for key in ['indices', 'TEXCOORD_0']:
    a = raw_primitive['indices'] if key == 'indices' else raw_primitive['attributes'][key]
    b = original_primitive['indices'] if key == 'indices' else original_primitive['attributes'][key]
    assert np.array_equal(raw.array(a), raw6.array(b)), key + ' correspondence changed'
position_error = float(np.linalg.norm(raw.array(raw_primitive['attributes']['POSITION']) -
                                    raw6.array(original_primitive['attributes']['POSITION']), axis=1).max())
assert position_error < .000001, 'Role7 needs its own geometry fit'

out = Glb(approved)
output.parent.mkdir(parents=True, exist_ok=True)
out.j['asset']['extras']['appearance'] = 'role7'
out.j['asset']['extras']['pbrExternal'] = True
out.j['asset']['extras'].pop('pbrEmbedded', None)
out.j['meshes'][0]['name'] = 'Role7 original PBR, approved native hands and left forearm shield'

# No recoloring or baking: copy the exact three source images and their slots.
material = raw.j['materials'][raw_primitive.get('material', 0)]
pbr = material['pbrMetallicRoughness']
textures = {}
for kind, ti in [('base', pbr['baseColorTexture']['index']), ('normal', material['normalTexture']['index']),
                 ('mr', pbr['metallicRoughnessTexture']['index'])]:
    image = raw.j['images'][raw.j['textures'][ti]['source']]
    view = raw.j['bufferViews'][image['bufferView']]
    offset = view.get('byteOffset', 0)
    data = raw.b[offset:offset + view['byteLength']]
    filename = kind + ('.png' if image['mimeType'] == 'image/png' else '.jpg')
    target = output.parent / 'role7' / filename
    target.parent.mkdir(exist_ok=True)
    target.write_bytes(data)
    index = {'base': 0, 'normal': 1, 'mr': 2}[kind]
    out.j['images'][index] = {'uri': 'role7/' + filename + '?v=20261109-role7-v1',
                              'name': 'Role7 original full-resolution ' + kind}
    textures[kind] = {'file': 'role7/' + filename, 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}
for mi in [0, 1]:
    replacement = copy.deepcopy(material)
    replacement['name'] = 'Role7 original red, white and gold PBR' + (' repair UV' if mi else '')
    replacement['normalTexture']['index'] = 1
    replacement['pbrMetallicRoughness']['baseColorTexture']['index'] = 0
    replacement['pbrMetallicRoughness']['metallicRoughnessTexture']['index'] = 2
    out.j['materials'][mi] = replacement
for mat in out.j['materials']:
    mat['name'] = mat.get('name', '').replace('Role6', 'Role7')

# The new sword uses the exact accepted grip origin and source Sword bone.
skin = out.j['skins'][0]
names = [out.j['nodes'][i]['name'] for i in skin['joints']]
binds = [Matrix(a.reshape(4, 4)).transposed().inverted() for a in out.array(skin['inverseBindMatrices'])]
sword_joint = names.index('Sword')
S = binds[sword_joint]
gp = Vector(out.j['asset']['extras']['gripFrame']['gripPointInSword'])
frame = Matrix.LocRotScale(S @ gp, S.to_quaternion(), Vector((1, 1, 1)))
start, end = meta6['weaponPrimitiveRange']
before = out.j['meshes'][0]['primitives']
new_weapon = []
material_offset = len(out.j['materials'])
assert not sword.j.get('textures'), 'This authored sword is procedural PBR'
out.j['materials'].extend(copy.deepcopy(sword.j['materials']))
for primitive in sword.j['meshes'][0]['primitives']:
    attributes = primitive['attributes']
    points = [frame @ Vector(p) for p in sword.array(attributes['POSITION'])]
    normals = [S.to_quaternion() @ Vector(n) for n in sword.array(attributes['NORMAL'])]
    attrs = {'POSITION': out.add(points, 'VEC3'), 'NORMAL': out.add(normals, 'VEC3'),
             'JOINTS_0': out.add([[sword_joint, 0, 0, 0]] * len(points), 'VEC4', 5123),
             'WEIGHTS_0': out.add([[1, 0, 0, 0]] * len(points), 'VEC4')}
    for key in ['TEXCOORD_0', 'COLOR_0']:
        if key in attributes:
            accessor = sword.j['accessors'][attributes[key]]
            attrs[key] = out.add(sword.array(attributes[key]), accessor['type'], accessor['componentType'])
    accessor = sword.j['accessors'][primitive['indices']]
    new_weapon.append({'attributes': attrs,
                       'indices': out.add(sword.array(primitive['indices']), 'SCALAR', accessor['componentType']),
                       'material': material_offset + primitive.get('material', 0)})
out.j['meshes'][0]['primitives'] = before[:start] + new_weapon + before[end:]
delta = len(new_weapon) - (end - start)

# Discard all unreferenced old sword material/geometry data. The body, original
# hands, shield and every clip remain bit-exact arrays from the accepted skin.
used_materials = sorted({p['material'] for p in out.j['meshes'][0]['primitives']})
material_map = {old: new for new, old in enumerate(used_materials)}
out.j['materials'] = [out.j['materials'][i] for i in used_materials]
for primitive in out.j['meshes'][0]['primitives']:
    primitive['material'] = material_map[primitive['material']]
old = out
out = Glb.__new__(Glb)
out.j, out.b = copy.deepcopy(old.j), bytearray()
out.j['accessors'], out.j['bufferViews'] = [], []
accessors = {}


def acc(index):
    if index not in accessors:
        spec = old.j['accessors'][index]
        new = out.add(old.array(index), spec['type'], spec['componentType'])
        for key in ['normalized', 'name', 'extras']:
            if key in spec:
                out.j['accessors'][new][key] = copy.deepcopy(spec[key])
        accessors[index] = new
    return accessors[index]


for primitive in out.j['meshes'][0]['primitives']:
    primitive['attributes'] = {k: acc(v) for k, v in primitive['attributes'].items()}
    primitive['indices'] = acc(primitive['indices'])
for skin in out.j['skins']:
    skin['inverseBindMatrices'] = acc(skin['inverseBindMatrices'])
for animation in out.j['animations']:
    for sampler in animation['samplers']:
        for key in ['input', 'output']:
            sampler[key] = acc(sampler[key])
out.save(output)

assert out.j['nodes'] == base.j['nodes']
assert np.array_equal(out.array(out.j['skins'][0]['inverseBindMatrices']), base.array(base.j['skins'][0]['inverseBindMatrices']))
for animation, original in zip(out.j['animations'], base.j['animations']):
    assert animation['name'] == original['name'] and animation['channels'] == original['channels']
    for sampler, other in zip(animation['samplers'], original['samplers']):
        assert sampler.get('interpolation') == other.get('interpolation')
        for key in ['input', 'output']:
            assert np.array_equal(out.array(sampler[key]), base.array(other[key]))
for i, original in enumerate(base.j['meshes'][0]['primitives']):
    if start <= i < end:
        continue
    result = out.j['meshes'][0]['primitives'][i if i < start else i + delta]
    assert np.array_equal(out.array(result['indices']), base.array(original['indices']))
    for key, index in original['attributes'].items():
        assert np.array_equal(out.array(result['attributes'][key]), base.array(index)), key

# Native editable source with the original Role7 maps packed, like Role6.
local = Glb(output)
for image in local.j['images']:
    if 'uri' in image:
        image['uri'] = image['uri'].split('?')[0]
local_file = output.with_name('role7-local.glb')
local.save(local_file)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(local_file))
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(blend))
local_file.unlink()
native_hands = copy.deepcopy(meta6['nativeHands'])
for hand in native_hands.values():
    for key in ['primitive', 'skinPrimitive', 'platePrimitive', 'flexibleWristPrimitive']:
        hand[key] += delta
shield = copy.deepcopy(meta6['shield'])
for key in ['primitiveRange', 'strapPrimitiveRange']:
    shield[key] = [i + delta for i in shield[key]]
result = {'sourceSha256': sha(source), 'approvedRole6Sha256': sha(approved), 'originalRole6Sha256': sha(original6),
          'outputSha256': sha(output), 'approvedSwordSha256': sha(sword_file), 'modelBytes': output.stat().st_size,
          'license': 'User confirmed Role7.glb licensed for this game and modification, 2026-11-09',
          'sourceTopologyAndUvExact': True, 'sourcePositionMaximumDifferenceMeters': position_error,
          'allSixAnimationsSampleExactToRole6': True, 'allNonWeaponGeometryExactToRole6': True,
          'clips': [a['name'] for a in out.j['animations']], 'wristLimitDegrees': 48,
          'weaponPrimitiveRange': [start, start + len(new_weapon)], 'shield': shield,
          'nativeHands': native_hands, 'originalTextures': textures,
          'removedBackShieldTriangles': meta6['removedBackShieldTriangles'],
          'blenderVersion': bpy.app.version_string}
report.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
print(json.dumps({k: result[k] for k in ['outputSha256', 'modelBytes', 'allSixAnimationsSampleExactToRole6', 'allNonWeaponGeometryExactToRole6']}))
