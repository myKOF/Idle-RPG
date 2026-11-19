"""Reopen the refinement and measure tail shape, unchanged flight and limb clearance."""
import bpy,bmesh,sys,json,math,hashlib,struct
import numpy as np
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
source,baseline,out=map(Path,sys.argv[sys.argv.index('--')+1:][:3])
tail=['Bone_%03d'%i for i in range(30,23,-1)]
limbs=['Bone_%03d'%i for i in list(range(6,16))+list(range(37,47))];touched=set(tail+limbs)
def sha(b):return hashlib.sha256(b).hexdigest()
def get():
 a=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE');b=bpy.data.objects['BOSS9_Dragon_SingleTail'];return a,b
def weights(body):
 groups={g.index:g.name for g in body.vertex_groups}
 return [{groups[g.group]:g.weight for g in v.groups} for v in body.data.vertices]
def curve_hash(action):
 rows=[]
 for layer in action.layers:
  for strip in layer.strips:
   for bag in strip.channelbags:
    for fc in bag.fcurves:
     if not any('"'+n+'"' in fc.data_path for n in touched):rows.append([fc.data_path,fc.array_index,[(list(k.co),k.interpolation,list(k.handle_left),list(k.handle_right)) for k in fc.keyframe_points]])
 return sha(json.dumps(sorted(rows),sort_keys=True).encode())
def packed():return {i.name:sha(bytes(i.packed_file.data)) for i in bpy.data.images if i.packed_file}
bpy.ops.wm.open_mainfile(filepath=str(baseline));arm,body=get();sc=bpy.context.scene
before={'bones':{b.name:(np.array(b.matrix_local),b.head_local.copy(),b.tail_local.copy()) for b in arm.data.bones},'vertices':np.array([v.co for v in body.data.vertices]),'weights':weights(body),'uv':np.array([x.uv for x in body.data.uv_layers.active.data]),'faces':[list(f.vertices) for f in body.data.polygons],'images':packed(),'curves':curve_hash(bpy.data.actions['Walk'])}
kept=[n for n in before['bones'] if n not in touched];states=[]
for i in range(241):
 f=i/2;sc.frame_set(math.floor(f),subframe=f%1);bpy.context.view_layer.update();states.append({n:np.array(arm.pose.bones[n].matrix) for n in kept})
bpy.ops.wm.open_mainfile(filepath=str(source));arm,body=get();sc=bpy.context.scene;w=weights(body)
assert len(arm.data.bones)==70 and set(a.name for a in bpy.data.actions)=={'Walk'}
assert curve_hash(bpy.data.actions['Walk'])==before['curves'] and packed()==before['images']
assert [list(f.vertices) for f in body.data.polygons]==before['faces']
assert np.array_equal(np.array([x.uv for x in body.data.uv_layers.active.data]),before['uv'])
rest=np.array([v.co for v in body.data.vertices]);untouched=[i for i,x in enumerate(before['weights']) if sum(x.get(n,0) for n in tail)<1e-6]
assert np.max(np.abs(rest[untouched]-before['vertices'][untouched]))<1e-6
for n,(matrix,_,_) in before['bones'].items():
 if n not in tail:assert np.max(np.abs(np.array(arm.data.bones[n].matrix_local)-matrix))<1e-5,n
assert all(abs(sum(x.values())-1)<1e-5 and len(x)<=4 for x in w)
oldlength=sum((before['bones'][n][2]-before['bones'][n][1]).length for n in tail);newlength=sum(arm.data.bones[n].length for n in tail)
assert abs(newlength/oldlength-.6)<1e-5
radial=[]
for i,x in enumerate(before['weights']):
 n=max(tail,key=lambda n:x.get(n,0))
 if x.get(n,0)<.9 or n=='Bone_024':continue
 _,a,b=before['bones'][n];axis=(b-a).normalized();p=Vector(before['vertices'][i]);oldrad=(p-a-axis*(p-a).dot(axis)).length
 nb=arm.data.bones[n];d=(nb.tail_local-nb.head_local).normalized();p=Vector(rest[i]);newrad=(p-nb.head_local-d*(p-nb.head_local).dot(d)).length
 if oldrad>.005:radial.append(newrad/oldrad)
assert max(abs(x-1) for x in radial)<.04
regions={}
for label,ns,height in [('handNear',range(42,47),.34),('handFar',range(37,42),.34),('footNear',range(6,9),.26),('footFar',range(11,14),.26),('calfNear',[9],.30),('calfFar',[14],.30)]:
 names={'Bone_%03d'%i for i in ns};regions[label]={v.index for v in body.data.vertices if v.co.z<height and sum(w[v.index].get(n,0) for n in names)>.65}
assert all(len(ids)>20 for ids in regions.values())
torso_names={'Bone_%03d'%i for i in range(6)}|{'Neck_Base','Neck_Upper'}
torso_ids=[i for i,x in enumerate(w) if sum(x.get(n,0) for n in torso_names)>.7 and sum(a for n,a in x.items() if n.startswith('FlightWing_'))<.05 and sum(x.get(n,0) for n in tail)<.05]
polys={label:[list(f.vertices) for f in body.data.polygons if all(i in ids for i in f.vertices)] for label,ids in regions.items()}
wing_ids={i for i,x in enumerate(w) if sum(a for n,a in x.items() if n.startswith('FlightWing_'))>.50}
wing_faces=[list(f.vertices) for f in body.data.polygons if all(i in wing_ids for i in f.vertices)]
minimum={k:float('inf') for k in regions};inside={k:0 for k in regions};overlaps={k:0 for k in ['hand-hand','foot-foot','hand-foot','distal-wing']}
max_bone_error=0;preserved_error=0;hand_forward=1e6;hand_drop=1e6;tail_z=[];wing_z=[];positions=[]
for i in range(241):
 t=i/120;f=t*60;sc.frame_set(math.floor(f),subframe=f%1);bpy.context.view_layer.update()
 ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get());mesh=ev.to_mesh();points=[v.co.copy() for v in mesh.vertices];ev.to_mesh_clear();positions.append(np.array(points) if i in [0,240] else None)
 assert np.all(np.isfinite(np.array(points)))
 preserved_error=max(preserved_error,max(float(np.max(np.abs(np.array(arm.pose.bones[n].matrix)-states[i][n]))) for n in kept))
 for p in arm.pose.bones:
  expected=.65 if p.name=='Bone_024' else 1
  assert max(abs(s-expected) for s in p.scale)<1e-5
  max_bone_error=max(max_bone_error,abs((p.tail-p.head).length-p.bone.length*expected))
 bm=bmesh.new()
 for j in torso_ids:bm.verts.new(points[j])
 bm.verts.ensure_lookup_table();bmesh.ops.convex_hull(bm,input=list(bm.verts),use_existing_faces=False);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));hull=BVHTree.FromBMesh(bm)
 for label,ids in regions.items():
  for j in ids:
   co,normal,_,distance=hull.find_nearest(points[j]);minimum[label]=min(minimum[label],distance*4)
   if (points[j]-co).dot(normal)<-.001:inside[label]+=1
 bm.free()
 trees={label:BVHTree.FromPolygons(points,faces,all_triangles=False) for label,faces in polys.items()}
 wing_tree=BVHTree.FromPolygons(points,wing_faces,all_triangles=False)
 for tree in trees.values():overlaps['distal-wing']+=len(tree.overlap(wing_tree))
 overlaps['hand-hand']+=len(trees['handNear'].overlap(trees['handFar']));overlaps['foot-foot']+=len(trees['footNear'].overlap(trees['footFar']))
 for hand in ['handNear','handFar']:
  for foot in ['footNear','footFar']:overlaps['hand-foot']+=len(trees[hand].overlap(trees[foot]))
 for upper,wrist in [('Bone_041','Bone_039'),('Bone_046','Bone_044')]:
  delta=arm.pose.bones[wrist].head-arm.pose.bones[upper].head;hand_forward=min(hand_forward,-delta.y*4);hand_drop=min(hand_drop,-delta.z*4)
 tail_z.append((arm.pose.bones['Bone_024'].head-arm.pose.bones['Bone_030'].head).z*4)
 wing_z.append((arm.pose.bones['FlightWing_NearTip'].head-arm.pose.bones['Bone_000'].head).z*4)
seam=float(np.max(np.abs(positions[0]-positions[-1])));tail_range=max(tail_z)-min(tail_z)
correlations=[float(np.corrcoef(np.array(wing_z[:-1]),np.roll(np.array(tail_z[:-1]),-shift))[0,1]) for shift in range(61)]
report={'sourceSHA256':sha(baseline.read_bytes()),'samples':241,'bones':70,'clips':['Walk'],'tailLengthRatio':newlength/oldlength,'tailLengthMetersBefore':oldlength*4,'tailLengthMetersAfter':newlength*4,'tailRadialRatioRange':[min(radial),max(radial)],'tailVerticalTravelRelativeRootMeters':tail_range,'tailWingCorrelation':max(correlations),'tailLagAfterWingSeconds':correlations.index(max(correlations))/120,'preservedWingTorsoHeadMatrixError':preserved_error,'retainedCurvesSHA256':before['curves'],'loopVertexError':seam,'maxBoneLengthError':max_bone_error,'handsMinimumForwardOfShoulderMeters':hand_forward,'handsMinimumDropFromShoulderMeters':hand_drop,'distalLimbRegions':{k:len(v) for k,v in regions.items()},'torsoConvexHullMinimumClearanceMeters':minimum,'torsoConvexHullInsideVertexSamples':inside,'distalLimbTriangleOverlaps':overlaps}
out.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print('FLIGHT_REFINE_CHECKS',json.dumps(report),flush=True)
assert preserved_error<1e-5 and seam<1e-5 and max_bone_error<1e-5
assert tail_range>.3 and max(correlations)>.6 and hand_forward>.06 and hand_drop>1
assert not any(inside.values()) and not any(overlaps.values()),report
def glb(path):
 b=path.read_bytes();n=struct.unpack_from('<I',b,12)[0];return json.loads(b[20:20+n]),b[28+n:]
j,data=glb(source.with_suffix('.glb'));old,olddata=glb(baseline.with_suffix('.glb'))
def images(j,b):
 return [sha(b[j['bufferViews'][x['bufferView']].get('byteOffset',0):j['bufferViews'][x['bufferView']].get('byteOffset',0)+j['bufferViews'][x['bufferView']]['byteLength']]) for x in j['images']]
assert images(j,data)==images(old,olddata) and len(j['skins'][0]['joints'])==70 and [a['name'] for a in j['animations']]==['Walk']
def accessor(index):
 a=j['accessors'][index];v=j['bufferViews'][a['bufferView']];dims={'SCALAR':1,'VEC3':3,'VEC4':4}[a['type']]
 assert a['componentType']==5126
 return np.frombuffer(data,dtype='<f4',count=a['count']*dims,offset=v.get('byteOffset',0)+a.get('byteOffset',0)).reshape(-1,dims)
channel_seam=0
for channel in j['animations'][0]['channels']:
 sampler=j['animations'][0]['samplers'][channel['sampler']];times=accessor(sampler['input']);values=accessor(sampler['output'])
 assert np.all(np.isfinite(values)) and abs(times[0,0])<1e-6 and abs(times[-1,0]-2)<1e-6
 if channel['target']['path']=='rotation':
  assert np.max(np.abs(np.linalg.norm(values,axis=1)-1))<1e-5
  error=min(np.max(np.abs(values[0]-values[-1])),np.max(np.abs(values[0]+values[-1])))
 else:error=np.max(np.abs(values[0]-values[-1]))
 channel_seam=max(channel_seam,float(error))
assert channel_seam<1e-5
report['glbChannelLoopError']=channel_seam
report['glbSHA256']=sha(source.with_suffix('.glb').read_bytes());report['originalTexturesPreserved']=True
out.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print('FLIGHT_REFINE_VERIFY_PASS',flush=True)
