"""Independent native QA: Role7 output, approved Role6 package, new sword, result.

blender -b --python-exit-code 1 --python validate_role7.py --
  ROLE7_GLB ROLE7_REPORT ROLE7_BLEND ROLE6_PACKAGE NEW_SWORD RESULT_JSON
"""
from pathlib import Path
exec(Path(__file__).with_name('prepare_role6.py').read_text(encoding='utf-8').split(
    'source,approved,sword_file,output,blend,report=')[0])

model, report, blend, package, sword_file, result_file = map(Path, sys.argv[sys.argv.index('--') + 1:])
g, ref, sword = Glb(model), Glb(package / 'exports/role6.glb'), Glb(sword_file)
meta = json.loads(report.read_text(encoding='utf-8'))
previous = json.loads((package / 'exports/role6.json').read_text(encoding='utf-8'))
assert hashlib.sha256(model.read_bytes()).hexdigest() == meta['outputSha256']
assert g.j['nodes'] == ref.j['nodes']
assert np.array_equal(g.array(g.j['skins'][0]['inverseBindMatrices']), ref.array(ref.j['skins'][0]['inverseBindMatrices']))
for a, b in zip(g.j['animations'], ref.j['animations']):
    assert a['name'] == b['name'] and a['channels'] == b['channels']
    for x, y in zip(a['samplers'], b['samplers']):
        assert x.get('interpolation') == y.get('interpolation')
        for key in ['input', 'output']:
            assert np.array_equal(g.array(x[key]), ref.array(y[key])), a['name']

primitives, original = g.j['meshes'][0]['primitives'], ref.j['meshes'][0]['primitives']
start, end = previous['weaponPrimitiveRange']
delta = meta['weaponPrimitiveRange'][1] - end
for i, p in enumerate(original):
    if start <= i < end:
        continue
    q = primitives[i if i < start else i + delta]
    assert np.array_equal(g.array(q['indices']), ref.array(p['indices']))
    for key, accessor in p['attributes'].items():
        assert np.array_equal(g.array(q['attributes'][key]), ref.array(accessor)), (i, key)

names = [g.j['nodes'][i]['name'] for i in g.j['skins'][0]['joints']]
for p in primitives[slice(*meta['weaponPrimitiveRange'])]:
    j, w = g.array(p['attributes']['JOINTS_0']), g.array(p['attributes']['WEIGHTS_0'])
    assert np.all(j[:, 0] == names.index('Sword')) and np.all(w[:, 0] == 1) and np.all(w[:, 1:] == 0)
for key in ['primitiveRange', 'strapPrimitiveRange']:
    for p in primitives[slice(*meta['shield'][key])]:
        j, w = g.array(p['attributes']['JOINTS_0']), g.array(p['attributes']['WEIGHTS_0'])
        assert np.all(j[:, 0] == names.index('LeftForeArm')) and np.all(w[:, 0] == 1)
assert abs(meta['shield']['rodLengthRatio'] - .30) < .000001

# Contact uses the actual new pommel, collar and grip triangle surfaces.
points, faces = [], []
for p in sword.j['meshes'][0]['primitives']:
    v, f = sword.array(p['attributes']['POSITION']), sword.array(p['indices']).reshape(-1, 3)
    offset = len(points)
    points.extend(Vector(q) for q in v)
    for face in f:
        q = v[face]
        if q[:, 1].min() > -.064 and q[:, 1].max() < .085 and np.linalg.norm(q[:, [0, 2]], axis=1).max() < .030:
            faces.append([int(i) + offset for i in face])
tree = BVHTree.FromPolygons(points, faces, all_triangles=True)
binds = [Matrix(a.reshape(4, 4)).transposed().inverted() for a in g.array(g.j['skins'][0]['inverseBindMatrices'])]
S = binds[names.index('Sword')]
center = S @ Vector(g.j['asset']['extras']['gripFrame']['gripPointInSword'])
Q = S.to_quaternion().inverted()
h = meta['nativeHands']['Right']
hand_positions = g.array(primitives[h['skinPrimitive']]['attributes']['POSITION'])
contact = {}
for finger, ids in h['contactVertexIndicesByFinger'].items():
    distances = [tree.find_nearest(Q @ (Vector(hand_positions[i]) - center))[3] for i in ids]
    assert min(distances) < .0012, (finger, min(distances))
    contact[finger] = {'vertices': len(ids), 'minGapMeters': min(distances), 'maxGapMeters': max(distances)}
for d in meta['originalTextures'].values():
    assert hashlib.sha256((model.parent / d['file']).read_bytes()).hexdigest() == d['sha256']
bpy.ops.wm.open_mainfile(filepath=str(blend))
assert len(bpy.data.actions) == 6
assert sum(bool(i.packed_file) for i in bpy.data.images if i.source == 'FILE') == 3
result = {'modelSha256': meta['outputSha256'], 'allSixClipsAndRigExactToApprovedRole6': True,
          'allNonWeaponGeometryAndUvExactToApprovedRole6': True, 'swordRigidlyOnRightSwordBone': True,
          'shieldAndHardwareRigidlyOnLeftForearm': True, 'shieldRodLengthRatio': .30,
          'actualNewSwordContact': contact, 'originalRole7TextureHashesExact': True,
          'nativeActions': 6, 'packedOriginalTextures': 3}
result_file.parent.mkdir(parents=True, exist_ok=True)
result_file.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
print(json.dumps(result))
