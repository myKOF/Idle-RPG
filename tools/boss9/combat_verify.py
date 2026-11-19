"""Verify the immutable approved model/Walk and the actual combat deformations."""
import bpy,bmesh,sys,math,json,hashlib,struct
import numpy as np
from pathlib import Path
from mathutils import Vector,Quaternion
from mathutils.bvhtree import BVHTree
source,baseline,out=map(Path,sys.argv[sys.argv.index('--')+1:][:3]);quick='--quick' in sys.argv
cfg=json.loads(Path(__file__).with_name('combat.json').read_text(encoding='utf-8'))
def sha(b):return hashlib.sha256(b).hexdigest()
def actions_hash(action):
 rows=[]
 for layer in action.layers:
  for strip in layer.strips:
   for bag in strip.channelbags:
    for fc in bag.fcurves:rows.append([fc.data_path,fc.array_index,[(list(k.co),k.interpolation,list(k.handle_left),list(k.handle_right)) for k in fc.keyframe_points]])
 return sha(json.dumps(sorted(rows),sort_keys=True).encode())
def get():
 a=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE');return a,[o for o in a.children_recursive if o.type=='MESH']
def model_hash(a,meshes):
 h=hashlib.sha256()
 for ob in sorted(meshes,key=lambda ob:ob.name):
  h.update(ob.name.encode());h.update(np.array([v.co for v in ob.data.vertices],dtype='<f4').tobytes());h.update(np.array([n.vector for n in ob.data.corner_normals],dtype='<f4').tobytes())
  h.update(json.dumps([list(f.vertices) for f in ob.data.polygons]).encode())
  for layer in ob.data.uv_layers:h.update(np.array([x.uv for x in layer.data],dtype='<f4').tobytes())
  groups={g.index:g.name for g in ob.vertex_groups};h.update(json.dumps([sorted([(groups[g.group],g.weight) for g in v.groups]) for v in ob.data.vertices]).encode())
  h.update(json.dumps([(s.material.name,list(s.material.diffuse_color)) for s in ob.material_slots]).encode())
 for b in a.data.bones:h.update(b.name.encode());h.update(np.array(b.matrix_local,dtype='<f4').tobytes());h.update((b.parent.name if b.parent else '').encode())
 return h.hexdigest()
def packed():return {i.name:sha(bytes(i.packed_file.data)) for i in bpy.data.images if i.packed_file}
bpy.ops.wm.open_mainfile(filepath=str(baseline));arm,meshes=get();sc=bpy.context.scene
approved={'model':model_hash(arm,meshes),'walk':actions_hash(bpy.data.actions['Walk']),'images':packed()}
arm.animation_data.action=bpy.data.actions['Walk'];arm.animation_data.action_slot=arm.animation_data.action.slots[0];sc.frame_set(0);bpy.context.view_layer.update()
start_matrices={p.name:np.array(p.matrix) for p in arm.pose.bones}
bpy.ops.wm.open_mainfile(filepath=str(source));arm,meshes=get();sc=bpy.context.scene;body=bpy.data.objects['BOSS9_Dragon_SingleTail']
assert model_hash(arm,meshes)==approved['model'] and packed()==approved['images']
assert actions_hash(bpy.data.actions['Walk'])==approved['walk']
assert len(arm.data.bones)==70 and set(a.name for a in bpy.data.actions)=={'Walk',*cfg['durations']}
groups={g.index:g.name for g in body.vertex_groups};weights=[{groups[g.group]:g.weight for g in v.groups} for v in body.data.vertices]
core={v.index for v in body.data.vertices if sum(weights[v.index].get('Bone_%03d'%i,0) for i in range(6))>.7}
head={v.index for v in body.data.vertices if weights[v.index].get('Head',0)>.8}
hand={v.index for v in body.data.vertices if v.co.z<.34 and sum(weights[v.index].get('Bone_%03d'%i,0) for i in [42,43,44])>.7}
regions={}
for label,ns,height in [('handNear',range(42,47),.34),('handFar',range(37,42),.34),('footNear',range(6,9),.26),('footFar',range(11,14),.26),('calfNear',[9],.30),('calfFar',[14],.30)]:
 regions[label]={v.index for v in body.data.vertices if v.co.z<height and sum(weights[v.index].get('Bone_%03d'%i,0) for i in ns)>.65}
torso_names={'Bone_%03d'%i for i in range(6)}|{'Neck_Base','Neck_Upper'}
torso_ids=[i for i,w in enumerate(weights) if sum(w.get(n,0) for n in torso_names)>.7 and sum(a for n,a in w.items() if n.startswith('FlightWing_'))<.05 and sum(w.get('Bone_%03d'%i,0) for i in range(24,31))<.05]
region_faces={label:[list(f.vertices) for f in body.data.polygons if all(i in ids for i in f.vertices)] for label,ids in regions.items()}
wing_ids={i for i,w in enumerate(weights) if sum(a for n,a in w.items() if n.startswith('FlightWing_'))>.50}
wing_faces=[list(f.vertices) for f in body.data.polygons if all(i in wing_ids for i in f.vertices)]
tail_length=sum(arm.data.bones['Bone_%03d'%i].length for i in range(24,31))*4
assert 4.08<tail_length<4.09
def frame(name,t):
 a=bpy.data.actions[name];arm.animation_data.action=a;arm.animation_data.action_slot=a.slots[0];f=t*60;sc.frame_set(math.floor(f),subframe=f%1);bpy.context.view_layer.update()
def surface():
 pts={};minimum=float('inf')
 for ob in meshes:
  ev=ob.evaluated_get(bpy.context.evaluated_depsgraph_get());me=ev.to_mesh();p=np.array([ev.matrix_world@v.co for v in me.vertices]);ev.to_mesh_clear();assert np.all(np.isfinite(p));pts[ob.name]=p;minimum=min(minimum,float(p[:,2].min()))
 return pts,minimum
report={'sourceSHA256':sha(baseline.read_bytes()),'approvedModelSHA256':approved['model'],'walkActionSHA256':approved['walk'],'bones':70,'tailLengthMeters':tail_length,'clips':{}}
for name,d in cfg['durations'].items():
 a=bpy.data.actions[name];assert abs(a.frame_range[0])<1e-6 and abs(a.frame_range[1]/60-d)<1e-6
 frame(name,0);initial=arm.matrix_world@arm.pose.bones['Bone_000'].head
 start_error=max(float(np.max(np.abs(np.array(p.matrix)-start_matrices[p.name]))) for p in arm.pose.bones)
 assert start_error<1e-4,(name,'start pose',start_error)
 floors=[];forward=[];yaws=[];head_pitches=[];jaw_angles=[];bone_error=0
 inside={label:0 for label in regions};overlaps={k:0 for k in ['hand-hand','foot-foot','hand-foot','distal-wing']}
 times=sorted(set([0,d,d*.22,d*.4,d*.55,d*.75]+[p[0] for points in cfg['curves'][name].values() for p in points])) if quick else [i/120 for i in range(round(d*120)+1)]
 for t in times:
  frame(name,t);points,low=surface();floors.append(low);root=arm.pose.bones['Bone_000'];position=arm.matrix_world@root.head;forward.append(initial.y-position.y)
  q=root.matrix.to_quaternion()@root.bone.matrix_local.to_quaternion().inverted();yaws.append(math.degrees(q.to_euler('XYZ').z))
  direction=arm.pose.bones['Head'].matrix.to_3x3()@Vector((0,1,0));head_pitches.append(math.degrees(math.asin(max(-1,min(1,-direction.normalized().z)))))
  jaw_angles.append(math.degrees(arm.pose.bones['Jaw'].rotation_quaternion.angle))
  for p in arm.pose.bones:
   target=.65 if p.name=='Bone_024' else 1
   assert max(abs(s-target) for s in p.scale)<1e-5
   bone_error=max(bone_error,abs((p.tail-p.head).length-p.bone.length*target))
  assert low>(.015 if name=='Die' else .3),(name,t,low)
  if name!='Die':
   p=[Vector(v) for v in points[body.name]];bm=bmesh.new()
   for i in torso_ids:bm.verts.new(p[i])
   bm.verts.ensure_lookup_table();bmesh.ops.convex_hull(bm,input=list(bm.verts),use_existing_faces=False);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));hull=BVHTree.FromBMesh(bm)
   for label,ids in regions.items():
    for i in ids:
     co,normal,_,distance=hull.find_nearest(p[i])
     if (p[i]-co).dot(normal)<-.004:inside[label]+=1
   bm.free();trees={label:BVHTree.FromPolygons(p,faces,all_triangles=False) for label,faces in region_faces.items()};wing_tree=BVHTree.FromPolygons(p,wing_faces,all_triangles=False)
   for tree in trees.values():overlaps['distal-wing']+=len(tree.overlap(wing_tree))
   overlaps['hand-hand']+=len(trees['handNear'].overlap(trees['handFar']));overlaps['foot-foot']+=len(trees['footNear'].overlap(trees['footFar']))
   for h in ['handNear','handFar']:
    for f in ['footNear','footFar']:overlaps['hand-foot']+=len(trees[h].overlap(trees[f]))
 frame(name,d);end={p.name:np.array(p.matrix) for p in arm.pose.bones}
 seam=max(float(np.max(np.abs(end[n]-start_matrices[n]))) for n in end)
 entry={'duration':d,'samples':len(times),'startMatrixError':start_error,'minimumWorldZ':min(floors),'maxBoneLengthError':bone_error,'maximumForwardMeters':max(forward),'rootYawDegrees':[min(yaws),max(yaws)],'headPitchDegrees':[min(head_pitches),max(head_pitches)],'jawMaximumDegrees':max(jaw_angles)}
 assert bone_error<1e-5
 if name!='Die':
  assert seam<1e-4,(name,'recovery',seam);entry['returnMatrixError']=seam
  entry['distalTorsoHullInsideSamples']=inside;entry['distalTriangleOverlaps']=overlaps
  assert not any(inside.values()) and not any(overlaps.values()),entry
 if name=='Attack1':assert 4.90<max(forward)<5.03 and max(jaw_angles)>40,entry
 if name=='Attack2':
  assert -90.02<min(yaws)<-89.98,entry
  frame(name,.35);p0,_=surface();start=p0[body.name][list(hand)].mean(axis=0)
  frame(name,.67);p1,_=surface();finish=p1[body.name][list(hand)].mean(axis=0)
  entry['rightClawArcMeters']={'windCentroid':start.tolist(),'strikeCentroid':finish.tolist(),'leftward':float(finish[0]-start[0]),'downward':float(start[2]-finish[2]),'forward':float(start[1]-finish[1])}
  assert finish[0]-start[0]>1 and start[2]-finish[2]>2 and start[1]-finish[1]>2,entry
 if name=='Attack3':assert min(head_pitches)<-45 and max(jaw_angles)>40,entry
 if name=='Die':
  frame(name,.4);raised={p.name:np.array(p.matrix_basis) for p in arm.pose.bones if p.name.startswith('FlightWing_')}
  frame(name,.8);entry['raisedWingHoldLocalMatrixError']=max(float(np.max(np.abs(np.array(arm.pose.bones[n].matrix_basis)-m))) for n,m in raised.items())
  assert entry['raisedWingHoldLocalMatrixError']<1e-4
  frame(name,d);pts,_=surface();p=pts[body.name];entry['finalTorsoZ']=[float(p[list(core),2].min()),float(p[list(core),2].max())];entry['finalHeadZ']=[float(p[list(head),2].min()),float(p[list(head),2].max())]
  final=p.copy();frame(name,2.25);p,_=surface();entry['finalHoldVertexError']=float(np.max(np.abs(p[body.name]-final)))
  assert entry['finalTorsoZ'][0]<.4 and entry['finalHeadZ'][0]<.45 and entry['finalHoldVertexError']<1e-5,entry
 report['clips'][name]=entry;print('COMBAT_CLIP_CHECKED',name,json.dumps(entry),flush=True)
out.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
def glb(path):
 b=path.read_bytes();n=struct.unpack_from('<I',b,12)[0];return json.loads(b[20:20+n]),b[28+n:]
j,data=glb(source.with_suffix('.glb'));old,olddata=glb(baseline.with_suffix('.glb'))
def images(j,b):
 return [sha(b[j['bufferViews'][i['bufferView']].get('byteOffset',0):j['bufferViews'][i['bufferView']].get('byteOffset',0)+j['bufferViews'][i['bufferView']]['byteLength']]) for i in j['images']]
assert images(j,data)==images(old,olddata) and j['materials']==old['materials']
def accessor(j,b,index):
 a=j['accessors'][index];v=j['bufferViews'][a['bufferView']];dims={'SCALAR':1,'VEC3':3,'VEC4':4}[a['type']];assert a['componentType']==5126
 return np.frombuffer(b,dtype='<f4',count=a['count']*dims,offset=v.get('byteOffset',0)+a.get('byteOffset',0)).reshape(-1,dims)
seams={}
for animation in j['animations']:
 name=animation['name'];d=2 if name=='Walk' else cfg['durations'][name];maximum=0
 for c in animation['channels']:
  sampler=animation['samplers'][c['sampler']];times=accessor(j,data,sampler['input']);values=accessor(j,data,sampler['output']);assert np.all(np.isfinite(values)) and abs(times[-1,0]-d)<1e-5
  if c['target']['path']=='rotation':assert np.max(np.abs(np.linalg.norm(values,axis=1)-1))<1e-5;error=min(np.max(np.abs(values[0]-values[-1])),np.max(np.abs(values[0]+values[-1])))
  else:error=np.max(np.abs(values[0]-values[-1]))
  maximum=max(maximum,float(error))
 if name!='Die':assert maximum<1e-4,(name,maximum)
 seams[name]=maximum
def walk_channels(j,b):
 a=next(a for a in j['animations'] if a['name']=='Walk');return {(j['nodes'][c['target']['node']]['name'],c['target']['path']):(accessor(j,b,a['samplers'][c['sampler']]['input'])[:,0],accessor(j,b,a['samplers'][c['sampler']]['output'])) for c in a['channels']}
newwalk=walk_channels(j,data);oldwalk=walk_channels(old,olddata)
for key,(times,values) in oldwalk.items():
 if key not in newwalk:
  node=next(n for n in j['nodes'] if n.get('name')==key[0]);default=node.get(key[1],{'rotation':[0,0,0,1],'translation':[0,0,0],'scale':[1,1,1]}[key[1]])
  assert np.max(np.abs(values-np.array(default)))<1e-5,key
 else:
  nt,nv=newwalk[key];assert np.array_equal(times,nt),key
  if key[1]=='rotation':assert np.max(np.abs(np.abs(np.sum(values*nv,axis=1))-1))<1e-5,key
  else:assert np.max(np.abs(values-nv))<1e-5,key
report['glb']={'sha256':sha(source.with_suffix('.glb').read_bytes()),'originalTextureBytesPreserved':True,'materialsPreserved':True,'walkExportChannelsPreserved':True,'loopChannelErrors':seams}
out.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print('COMBAT_VERIFY_PASS',flush=True)
