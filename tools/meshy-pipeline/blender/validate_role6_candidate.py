"""Validate the archived native-hand candidate; args: package reference result.json."""
from pathlib import Path
exec(Path(__file__).with_name('prepare_role6.py').read_text(encoding='utf-8').split('source,approved,sword_file,output,blend,report=')[0])
package,reference,result_file=map(Path,sys.argv[sys.argv.index('--')+1:])
p=package/'exports';g=Glb(p/'role6.glb');ref=Glb(reference);raw=Glb(package/'source/Role6.glb');meta=json.loads((p/'role6.json').read_text());h=meta['nativeHands']['Right'];prims=g.j['meshes'][0]['primitives'];positions=g.array(prims[h['skinPrimitive']]['attributes']['POSITION']);accepted=np.load(package/'qa/accepted-four-fingers.npz');source_points=np.array(h['sourcePositionsBeforePose']);thumb=h['thumbAdjustment'];longitudinal=(source_points-np.array(thumb['sourceWrist']))@np.array(thumb['sourceForward']);accepted_ids={finger:[int(i)for i in accepted[finger]if finger!='Index'or longitudinal[i]>.135]for finger in ['Index','Middle','Ring','Pinky']};shifts={finger:float(np.linalg.norm(positions[ids]-accepted['positions'][ids],axis=1).max())for finger,ids in accepted_ids.items()};print('ACCEPTED_FINGER_SHIFTS',shifts)
assert max(shifts.values())<.000002,shifts
assert g.j['nodes']==ref.j['nodes'];assert np.array_equal(g.array(g.j['skins'][0]['inverseBindMatrices']),ref.array(ref.j['skins'][0]['inverseBindMatrices']))
for a,b in zip(g.j['animations'],ref.j['animations']):
 assert a['name']==b['name'] and len(a['channels'])==len(b['channels'])
 for ca,cb in zip(a['channels'],b['channels']):
  assert ca['target']==cb['target']
  if ca['target']['path']=='rotation'and g.j['nodes'][ca['target']['node']]['name']in ['RightHand','LeftHand']:continue
  x,y=a['samplers'][ca['sampler']],b['samplers'][cb['sampler']]
  for key in ['input','output']:assert np.array_equal(g.array(x[key]),ref.array(y[key]))
# Use the actual authored hilt triangles, not an approximate bounding cylinder.
sword=Glb(p/'role6-sword.glb');sp=[];sf=[]
for primitive in sword.j['meshes'][0]['primitives']:
 v=sword.array(primitive['attributes']['POSITION']);f=sword.array(primitive['indices']).reshape(-1,3);start=len(sp);sp.extend(v)
 for face in f:
  q=v[face]
  if q[:,1].min()>-.064 and q[:,1].max()<.085 and np.linalg.norm(q[:,[0,2]],axis=1).max()<.030:sf.append([int(i)+start for i in face])
tree=BVHTree.FromPolygons([Vector(v)for v in sp],sf,all_triangles=True)
skin=g.j['skins'][0];binds=[Matrix(a.reshape(4,4)).transposed().inverted()for a in g.array(skin['inverseBindMatrices'])];S=binds[16];gp=Vector(g.j['asset']['extras']['gripFrame']['gripPointInSword']);center=S@gp;Q=S.to_quaternion().inverted();contact={}
for finger,ids in h['contactVertexIndicesByFinger'].items():
 assert len(ids)>0
 distances=[tree.find_nearest(Q@(Vector(positions[i])-center))[3]for i in ids];contact[finger]={'vertices':len(ids),'minGapMeters':min(distances),'maxGapMeters':max(distances)}
 assert min(distances)<.0012,(finger,min(distances))
# Verify separate hand armor is wholly rigid on its own hand bone.
for side,hand in meta['nativeHands'].items():
 primitive=prims[hand['platePrimitive']];ids=g.array(primitive['indices']).reshape(-1);j=g.array(primitive['attributes']['JOINTS_0'])[ids];w=g.array(primitive['attributes']['WEIGHTS_0'])[ids];ji=15 if side=='Right' else 11;assert np.all(j[:,0]==ji)and np.all(w[:,0]==1)
 for d in meta['originalTextures'].values():assert hashlib.sha256((p/d['file']).read_bytes()).hexdigest()==d['sha256']
thumb=h['thumbAdjustment'];assert max(abs(a-b)for a,b in zip(thumb['restSegmentLengthsMeters'],thumb['posedSegmentLengthsMeters']))<.000001
bpy.ops.wm.open_mainfile(filepath=str(package/'source/role6.blend'));assert len(bpy.data.actions)==6;assert sum(bool(i.packed_file)for i in bpy.data.images if i.source=='FILE')==3
result={'modelSha256':hashlib.sha256((p/'role6.glb').read_bytes()).hexdigest(),'acceptedFourFingerMaximumShiftMeters':shifts,'actualHiltSurfaceContact':contact,'bodyMotionSamplesExactExceptRequestedWrists':True,'separateHandArmorRigidlyBound':True,'originalPbrHashesExact':True,'thumbSegmentLengthsPreserved':True,'thumbRestSegmentLengthsMeters':thumb['restSegmentLengthsMeters'],'thumbPosedSegmentLengthsMeters':thumb['posedSegmentLengthsMeters'],'blendActions':len(bpy.data.actions),'packedOriginalTextures':3};result_file.parent.mkdir(parents=True,exist_ok=True);result_file.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
