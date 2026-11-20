"""Check untouched geometry/gait and the actual GLB skin, headings and fingers."""
import bpy,sys,json,math,struct,hashlib
import numpy as np
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree
original,fixed,blend,out=map(Path,sys.argv[sys.argv.index('--')+1:][:4])
def sha(b):return hashlib.sha256(b).hexdigest()
def glb(p):
 raw=p.read_bytes();n=struct.unpack_from('<I',raw,12)[0];j=json.loads(raw[20:20+n]);return j,raw[28+n:28+n+j['buffers'][0]['byteLength']]
old,oldbin=glb(original);new,newbin=glb(fixed);build=json.loads(fixed.with_name('build.json').read_text())
assert newbin[:len(oldbin)]==oldbin
for k in ['asset','nodes','skins','meshes','materials','images','textures','samplers','scenes','scene']:assert old.get(k)==new.get(k),k
assert new['accessors'][:len(old['accessors'])]==old['accessors'] and new['bufferViews'][:len(old['bufferViews'])]==old['bufferViews']
assert len(new['animations'])==1 and new['animations'][0]['name']=='Walk'
unchanged=0
for c0,c1 in zip(old['animations'][0]['channels'],new['animations'][0]['channels']):
 assert c0==c1
 name=old['nodes'][c0['target']['node']]['name']
 if name not in build['touchedBones']:
  assert old['animations'][0]['samplers'][c0['sampler']]==new['animations'][0]['samplers'][c1['sampler']];unchanged+=1
assert unchanged==177
def accessor(j,b,i):
 a=j['accessors'][i];v=j['bufferViews'][a['bufferView']];d={'SCALAR':1,'VEC3':3,'VEC4':4}[a['type']]
 assert a['componentType']==5126
 return np.frombuffer(b,dtype='<f4',count=a['count']*d,offset=v.get('byteOffset',0)+a.get('byteOffset',0)).reshape(-1,d)
channel_seam=0
for c in new['animations'][0]['channels']:
 s=new['animations'][0]['samplers'][c['sampler']];ts=accessor(new,newbin,s['input'])[:,0];values=accessor(new,newbin,s['output'])
 assert np.all(np.isfinite(values)) and np.all(np.diff(ts)>0) and abs(ts[0])<1e-6 and abs(ts[-1]-build['duration'])<1e-6
 if c['target']['path']=='rotation':
  assert np.max(np.abs(np.linalg.norm(values,axis=1)-1))<1e-5
  error=min(np.max(np.abs(values[0]-values[-1])),np.max(np.abs(values[0]+values[-1])))
 else:error=np.max(np.abs(values[0]-values[-1]))
 channel_seam=max(channel_seam,float(error))
assert channel_seam<1e-5
def load(path):
 bpy.ops.wm.read_factory_settings(use_empty=True)
 if path.suffix=='.blend':bpy.ops.wm.open_mainfile(filepath=str(path))
 else:bpy.ops.import_scene.gltf(filepath=str(path))
 a=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE');b=next(o for o in bpy.context.scene.objects if o.type=='MESH');bpy.context.scene.render.fps=24
 return a,b
def frame(t):
 f=t*24;bpy.context.scene.frame_set(math.floor(f),subframe=f%1);bpy.context.view_layer.update()
def surface(body):
 ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get());me=ev.to_mesh();v=np.empty(len(me.vertices)*3);me.vertices.foreach_get('co',v);ev.to_mesh_clear();p=v.reshape(-1,3);assert np.all(np.isfinite(p));return p
def statics(arm,body):
 groups={g.index:g.name for g in body.vertex_groups};return sha(json.dumps({'bones':[(b.name,b.parent.name if b.parent else None,[list(r) for r in b.matrix_local]) for b in arm.data.bones],'points':[list(v.co) for v in body.data.vertices],'faces':[list(f.vertices) for f in body.data.polygons],'uv':[[list(v.uv) for v in l.data] for l in body.data.uv_layers],'weights':[[[groups[g.group],g.weight] for g in v.groups] for v in body.data.vertices]},sort_keys=True).encode())
arm,body=load(original);baseline_static=statics(arm,body);rest={b.name:b.matrix_local.copy() for b in arm.data.bones};groups={g.index:g.name for g in body.vertex_groups};weights=[{groups[g.group]:g.weight for g in v.groups} for v in body.data.vertices]
rear=[n for n in rest if n.startswith('rear')]+['root','spine_12','spine_13','hips']
rear_ids=[v.index for v in body.data.vertices if sum(w for n,w in weights[v.index].items() if n.startswith('rear'))>.999]
finger_ids={v.index for v in body.data.vertices if sum(weights[v.index].get(n,0) for n in build['fingers'])>.90}
pure_finger_ids={i for i in finger_ids if sum(weights[i].get(n,0) for n in build['fingers'])>.99999}
foot_ids={v.index for v in body.data.vertices if sum(weights[v.index].get(n,0) for n in ['rearFoot.L','rearToe.L','rearFoot.R','rearToe.R'])>.65}
finger_faces=[list(f.vertices) for f in body.data.polygons if all(i in finger_ids for i in f.vertices)];foot_faces=[list(f.vertices) for f in body.data.polygons if all(i in foot_ids for i in f.vertices)]
assert finger_ids and finger_faces and foot_ids and foot_faces
cross_weights=sum(1 for v in body.data.vertices if v.co.y<-.45 and v.co.z<-.15 and abs(v.co.x)>.1 and sum(w for n,w in weights[v.index].items() if n.startswith('rear'))>.001)
assert cross_weights==0
duration=build['duration'];times=sorted([duration*i/80 for i in range(81)]+[duration*(i+.37)/80 for i in range(80)]);baseline=[]
for t in times:
 frame(t);baseline.append({'rear':{n:np.array(arm.pose.bones[n].matrix) for n in rear},'vertices':surface(body)[rear_ids]})
def heading(v):return math.degrees(math.atan2(v.x,-v.y))
def angle_error(a,b):return abs((a-b+180)%360-180)
results={}
for label,path in [('blend',blend),('glb',fixed)]:
 arm,body=load(path);assert statics(arm,body)==baseline_static and len(arm.data.bones)==73
 rear_error=0;vertex_error=0;roll_error=0;body_heading=0;head_heading=0;head_forward=0;finger_basis_error=0;rigid_error=0;minimum_distance=1e6;overlaps=0;bone_error=0;ends=[];minimum_z=1e6;maximum_z=-1e6
 for index,t in enumerate(times):
  frame(t);p=surface(body);rear_error=max(rear_error,max(float(np.max(np.abs(np.array(arm.pose.bones[n].matrix)-baseline[index]['rear'][n]))) for n in rear));vertex_error=max(vertex_error,float(np.max(np.abs(p[rear_ids]-baseline[index]['vertices']))))
  direction=Vector()
  for side in ['L','R']:
   v=arm.pose.bones['rearToe.'+side].head-arm.pose.bones['rearFoot.'+side].head;v.z=0;direction+=v.normalized()
  yaw=heading(direction)
  for n,kind in [('spine_05','body'),('spine_16','head')]:
   q=arm.pose.bones[n].matrix.to_quaternion()@rest[n].to_quaternion().inverted();e=q.to_euler('XYZ');v=q@Vector((0,-1,0));error=angle_error(heading(v),yaw)
   if kind=='body':body_heading=max(body_heading,error);roll_error=max(roll_error,abs(math.degrees(e.y)))
   else:head_heading=max(head_heading,error);head_forward=max(head_forward,angle_error(heading(v),0))
  for n in build['fingers']:finger_basis_error=max(finger_basis_error,float(np.max(np.abs(np.array(arm.pose.bones[n].matrix_basis)-np.eye(4)))))
  palm=arm.pose.bones['chest'].matrix@rest['chest'].inverted();inv=palm.inverted()
  for i in pure_finger_ids:rigid_error=max(rigid_error,((inv@Vector(p[i]))-body.data.vertices[i].co).length)
  fp=[Vector(v) for v in p];overlaps+=len(BVHTree.FromPolygons(fp,finger_faces,all_triangles=False).overlap(BVHTree.FromPolygons(fp,foot_faces,all_triangles=False)))
  tree=KDTree(len(foot_ids))
  for k,i in enumerate(foot_ids):tree.insert(fp[i],k)
  tree.balance()
  for i in finger_ids:minimum_distance=min(minimum_distance,tree.find(fp[i])[2])
  for pb in arm.pose.bones:
   assert max(abs(s-1) for s in pb.scale)<1e-5
   bone_error=max(bone_error,abs((pb.tail-pb.head).length-pb.bone.length))
  minimum_z=min(minimum_z,float(p[:,2].min()));maximum_z=max(maximum_z,float(p[:,2].max()))
  if index in [0,len(times)-1]:ends.append(p)
 seam=float(np.max(np.abs(ends[0]-ends[1])))
 entry={'samples':len(times),'rearBoneMatrixError':rear_error,'rearSurfaceVertexError':vertex_error,'bodyRollMaximumDegrees':roll_error,'bodyVsFeetHeadingErrorDegrees':body_heading,'headVsFeetHeadingErrorDegrees':head_heading,'headVsForwardHeadingErrorDegrees':head_forward,'fingerLocalBasisError':finger_basis_error,'fingerRigidToPalmError':rigid_error,'fingerToFootMinimumVertexDistance':minimum_distance,'fingerFootTriangleOverlaps':overlaps,'boneLengthError':bone_error,'loopVertexError':seam,'verticalBounds':[minimum_z,maximum_z]}
 print('LIZARD_CHECK',label,json.dumps(entry),flush=True)
 assert rear_error<1e-5 and vertex_error<1e-5 and roll_error<.05 and body_heading<.2 and head_forward<.2,entry
 assert finger_basis_error<1e-5 and rigid_error<1e-5 and minimum_distance>.04 and overlaps==0 and bone_error<1e-5 and seam<1e-5,entry
 results[label]=entry
report={'sourceSHA256':sha(original.read_bytes()),'glbSHA256':sha(fixed.read_bytes()),'bones':73,'duration':duration,'unchangedAnimationChannels':unchanged,'glbLoopChannelError':channel_seam,'originalGeometryMaterialBinaryPreserved':True,'staticModelSHA256':baseline_static,'forelimbVerticesWeightedToRearLegs':cross_weights,'fingerVertices':len(finger_ids),'pureFingerVertices':len(pure_finger_ids),'footVertices':len(foot_ids),'checks':results}
out.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print('LIZARD_VERIFY_PASS',flush=True)
