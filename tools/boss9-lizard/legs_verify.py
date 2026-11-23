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
expected=bytearray(oldbin);weight_offset=build['weightAccessorByteOffset'];changed_vertices=set()
for change in build['weightChanges']:
 i=change['vertex'];assert i not in changed_vertices;changed_vertices.add(i)
 assert list(struct.unpack_from('<4f',oldbin,weight_offset+i*16))==change['before']
 assert change['rearRemoval']>0 and abs(sum(change['after'])-1)<1e-6
 struct.pack_into('<4f',expected,weight_offset+i*16,*change['after'])
assert newbin[:len(oldbin)]==expected
for k in ['asset','nodes','skins','meshes','materials','images','textures','samplers','scenes','scene']:assert old.get(k)==new.get(k),k
assert new['accessors'][:len(old['accessors'])]==old['accessors'] and new['bufferViews'][:len(old['bufferViews'])]==old['bufferViews']
assert len(new['animations'])==1 and new['animations'][0]['name']=='Walk'
unchanged=0
for c0,c1 in zip(old['animations'][0]['channels'],new['animations'][0]['channels']):
 assert c0==c1
 name=old['nodes'][c0['target']['node']]['name']
 if name not in build['touchedBones']:
  assert old['animations'][0]['samplers'][c0['sampler']]==new['animations'][0]['samplers'][c1['sampler']];unchanged+=1
assert unchanged==117
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
 def canonical(v):
  if isinstance(v,(list,tuple)):return [canonical(x) for x in v]
  return 0.0 if isinstance(v,float) and v==0 else v
 data={'bones':[(b.name,b.parent.name if b.parent else None,[list(r) for r in b.matrix_local]) for b in arm.data.bones],'points':[list(v.co) for v in body.data.vertices],'faces':[list(f.vertices) for f in body.data.polygons],'uv':[[list(v.uv) for v in l.data] for l in body.data.uv_layers]}
 return sha(json.dumps({k:canonical(v) for k,v in data.items()},sort_keys=True).encode())
arm,body=load(original);baseline_static=statics(arm,body);rest={b.name:b.matrix_local.copy() for b in arm.data.bones};groups={g.index:g.name for g in body.vertex_groups};weights=[{groups[g.group]:g.weight for g in v.groups} for v in body.data.vertices]
original_points=np.array([v.co for v in body.data.vertices]);original_faces=[list(f.vertices) for f in body.data.polygons];original_uv=[np.array([v.uv for v in layer.data]) for layer in body.data.uv_layers];original_parents={b.name:b.parent.name if b.parent else None for b in arm.data.bones}
def smooth(a,b,x):
 u=max(0,min(1,(x-a)/(b-a)));return u*u*(3-2*u)
expected_weights=[dict(w) for w in weights];expected_changed=set()
for v in body.data.vertices:
 w=weights[v.index];amount=smooth(.14,.20,v.co.y)*smooth(.30,.50,sum(w.get(n,0) for n in build['tail'])) if v.co.z>-.18 else 0
 if amount<1e-5 or sum(x for n,x in w.items() if n.startswith('rear'))<1e-5:continue
 expected_changed.add(v.index);updated={n:x*(1-amount) if n.startswith('rear') else x for n,x in w.items()};total=sum(updated.values());expected_weights[v.index]={n:x/total for n,x in updated.items()}
assert expected_changed==changed_vertices
rear=['root','spine_12','spine_13','hips']
rear_ids=[v.index for v in body.data.vertices if sum(w for n,w in weights[v.index].items() if n.startswith('rear'))>.999]
finger_ids={v.index for v in body.data.vertices if sum(weights[v.index].get(n,0) for n in build['fingers'])>.90}
pure_finger_ids={i for i in finger_ids if sum(weights[i].get(n,0) for n in build['fingers'])>.99999}
foot_ids={v.index for v in body.data.vertices if sum(weights[v.index].get(n,0) for n in ['rearFoot.L','rearToe.L','rearFoot.R','rearToe.R'])>.65}
tail_ids={v.index for v in body.data.vertices if sum(weights[v.index].get(n,0) for n in build['tail'])>.5}
tail_edges=sorted({tuple(sorted((a,b))) for f in body.data.polygons for a,b in zip(f.vertices,list(f.vertices[1:])+[f.vertices[0]]) if a in tail_ids and b in tail_ids})
rest_points=np.array([v.co for v in body.data.vertices]);tail_edges=np.array([edge for edge in tail_edges if np.linalg.norm(rest_points[edge[0]]-rest_points[edge[1]])>1e-4]);edge_rest=np.linalg.norm(rest_points[tail_edges[:,0]]-rest_points[tail_edges[:,1]],axis=1)
regions={}
for name,ys,zs in [('pelvis',(-.05,.07),(.05,.35)),('waist',(-.28,-.16),(-.12,.45)),('rib',(-.48,-.36),(.0,.55)),('chest',(-.61,-.53),(.2,.5)),('skull',(-.83,-.72),(.18,.42)),('nose',(-.99,-.9),(.10,.3))]:
 regions[name]=[v.index for v in body.data.vertices if abs(v.co.x)<(.1 if name in ['pelvis','chest','skull','nose'] else .28) and ys[0]<v.co.y<ys[1] and zs[0]<v.co.z<zs[1]]
for n,ys in zip(build['tail'],[(.23,.37),(.40,.52),(.55,.67),(.69,.79),(.81,.89),(.90,.95),(.96,1.01)]):
 regions[n]=[v.index for v in body.data.vertices if ys[0]<v.co.y<ys[1] and sum(weights[v.index].get(k,0) for k in build['tail'])>.7]
body_regions=list(regions)
for side in ['L','R']:
 ids=[v.index for v in body.data.vertices if v.co.z<-.48 and v.co.y>.06 and sum(weights[v.index].get(n,0) for n in build['legChains'][side][2:])>.9]
 ys=original_points[ids,1];lower,upper=np.percentile(ys,[35,65]);regions['foot'+side]=ids;regions['heel'+side]=[i for i in ids if original_points[i,1]>=upper];regions['toe'+side]=[i for i in ids if original_points[i,1]<=lower]
assert regions==build['regions']
foot_masks={s:set(regions['foot'+s]) for s in ['L','R']}
side_faces={s:[list(f.vertices) for f in body.data.polygons if all(i in foot_masks[s] for i in f.vertices)] for s in ['L','R']}
finger_faces=[list(f.vertices) for f in body.data.polygons if all(i in finger_ids for i in f.vertices)];foot_faces=[list(f.vertices) for f in body.data.polygons if all(i in foot_ids for i in f.vertices)]
assert finger_ids and finger_faces and foot_ids and foot_faces
cross_weights=sum(1 for v in body.data.vertices if v.co.y<-.45 and v.co.z<-.15 and abs(v.co.x)>.1 and sum(w for n,w in weights[v.index].items() if n.startswith('rear'))>.001)
assert cross_weights==0
duration=build['duration'];times=sorted([duration*i/80 for i in range(81)]+[duration*(i+.37)/80 for i in range(80)]);baseline=[]
for t in times:
 frame(t);baseline.append({'rear':{n:np.array(arm.pose.bones[n].matrix) for n in rear},'ankles':{s:np.array(arm.pose.bones['rearFoot.'+s].head) for s in ['L','R']}})
leg_ids={i for i,w in enumerate(weights) if sum(v for n,v in w.items() if n.startswith('rear'))>.8}
leg_edges=np.array(sorted({tuple(sorted((a,b))) for f in body.data.polygons for a,b in zip(f.vertices,list(f.vertices[1:])+[f.vertices[0]]) if a in leg_ids and b in leg_ids and np.linalg.norm(original_points[a]-original_points[b])>1e-4}));leg_edge_rest=np.linalg.norm(original_points[leg_edges[:,0]]-original_points[leg_edges[:,1]],axis=1)
def heading(v):return math.degrees(math.atan2(v.x,-v.y))
def angle_error(a,b):return abs((a-b+180)%360-180)
results={}
for label,path in [('blend',blend),('glb',fixed)]:
 arm,body=load(path);assert len(arm.data.bones)==73
 static_error=float(np.max(np.abs(np.array([v.co for v in body.data.vertices])-original_points)))
 assert static_error<1e-7 and [list(f.vertices) for f in body.data.polygons]==original_faces
 assert {b.name:b.parent.name if b.parent else None for b in arm.data.bones}==original_parents
 assert all(np.max(np.abs(np.array(b.matrix_local)-np.array(rest[b.name])))<1e-7 for b in arm.data.bones)
 assert all(np.max(np.abs(np.array([v.uv for v in layer.data])-old))<1e-7 for layer,old in zip(body.data.uv_layers,original_uv))
 groups={g.index:g.name for g in body.vertex_groups}
 for v in body.data.vertices:
  actual={groups[g.group]:g.weight for g in v.groups}
  assert all(abs(actual.get(n,0)-expected_weights[v.index].get(n,0))<1e-6 for n in set(actual)|set(expected_weights[v.index]))
 rear_error=0;finger_basis_error=0;rigid_error=0;minimum_distance=1e6;overlaps=0;bone_error=0;ends=[];minimum_z=1e6;maximum_z=-1e6
 offsets={n:0 for n in body_regions};head_forward=0;whole_heading=0;chest_heading=0;tail_p95=0;tail_p99=0;tail_max=0
 lanes={s:0 for s in ['L','R']};foot_heading={s:0 for s in ['L','R']};ankle_yz_error=0;link_error=0;leg_plane_error=0;foot_overlaps=0;leg_p95=0;leg_p99=0;leg_max=0;jump=0;previous_joints=None;foot_paths={s:[] for s in ['L','R']}
 for index,t in enumerate(times):
  frame(t);p=surface(body);rear_error=max(rear_error,max(float(np.max(np.abs(np.array(arm.pose.bones[n].matrix)-baseline[index]['rear'][n]))) for n in rear))
  c={n:Vector(p[ids].mean(axis=0)) for n,ids in regions.items()};axis=c['pelvis'].x
  for n in body_regions:offsets[n]=max(offsets[n],abs(c[n].x-axis))
  all_joints=[]
  for s,sign in [('L',1),('R',-1)]:
   lanes[s]=max(lanes[s],abs(c['foot'+s].x-axis-sign*build['laneWidth']));foot_heading[s]=max(foot_heading[s],angle_error(heading(c['toe'+s]-c['heel'+s]),0));foot_paths[s].append([float(c['foot'+s].x-axis),float(c['foot'+s].y),float(c['foot'+s].z)])
   assert c['toe'+s].y<c['heel'+s].y-.01
   chain=build['legChains'][s];heads=[arm.pose.bones[n].head.copy() for n in chain];all_joints.extend(heads)
   ankle_yz_error=max(ankle_yz_error,float(np.max(np.abs(np.array(heads[3])[1:]-baseline[index]['ankles'][s][1:]))))
   leg_plane_error=max(leg_plane_error,max(abs(q.x-heads[0].x) for q in heads[:4]))
   for a,b in zip(chain,chain[1:]):link_error=max(link_error,abs((arm.pose.bones[b].head-arm.pose.bones[a].head).length-(rest[b].translation-rest[a].translation).length))
  joints=np.array(all_joints)
  if previous_joints is not None:jump=max(jump,float(np.max(np.linalg.norm(joints-previous_joints,axis=1))))
  previous_joints=joints
  head_forward=max(head_forward,angle_error(heading(c['nose']-c['skull']),0))
  whole_heading=max(whole_heading,angle_error(heading(c['nose']-c['tail_07']),0))
  chest_heading=max(chest_heading,angle_error(heading(c['nose']-c['chest']),0))
  ratio=np.linalg.norm(p[tail_edges[:,0]]-p[tail_edges[:,1]],axis=1)/edge_rest
  tail_p95=max(tail_p95,float(np.percentile(ratio,95)));tail_p99=max(tail_p99,float(np.percentile(ratio,99)));tail_max=max(tail_max,float(ratio.max()))
  ratio=np.linalg.norm(p[leg_edges[:,0]]-p[leg_edges[:,1]],axis=1)/leg_edge_rest;leg_p95=max(leg_p95,float(np.percentile(ratio,95)));leg_p99=max(leg_p99,float(np.percentile(ratio,99)));leg_max=max(leg_max,float(ratio.max()))
  for n in build['fingers']:finger_basis_error=max(finger_basis_error,float(np.max(np.abs(np.array(arm.pose.bones[n].matrix_basis)-np.eye(4)))))
  palm=arm.pose.bones['chest'].matrix@rest['chest'].inverted();inv=palm.inverted()
  for i in pure_finger_ids:rigid_error=max(rigid_error,((inv@Vector(p[i]))-body.data.vertices[i].co).length)
  fp=[Vector(v) for v in p];overlaps+=len(BVHTree.FromPolygons(fp,finger_faces,all_triangles=False).overlap(BVHTree.FromPolygons(fp,foot_faces,all_triangles=False)))
  foot_overlaps+=len(BVHTree.FromPolygons(fp,side_faces['L'],all_triangles=False).overlap(BVHTree.FromPolygons(fp,side_faces['R'],all_triangles=False)))
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
 entry={'samples':len(times),'importedStaticVertexError':static_error,'pelvisRootMatrixError':rear_error,'actualRegionMaximumAxisOffset':offsets,'actualHeadForwardErrorDegrees':head_forward,'actualTailToNoseHeadingErrorDegrees':whole_heading,'actualChestToNoseHeadingErrorDegrees':chest_heading,'footLaneErrors':lanes,'footHeadingErrorsDegrees':foot_heading,'originalAnkleYZError':ankle_yz_error,'legLinkLengthError':link_error,'legSagittalPlaneError':leg_plane_error,'maximumAdjacentJointStep':jump,'footFootTriangleOverlaps':foot_overlaps,'footPaths':foot_paths,'legEdgeStretchP95':leg_p95,'legEdgeStretchP99':leg_p99,'legEdgeStretchMaximum':leg_max,'tailEdgeStretchP95':tail_p95,'tailEdgeStretchP99':tail_p99,'tailEdgeStretchMaximum':tail_max,'fingerLocalBasisError':finger_basis_error,'fingerRigidToPalmError':rigid_error,'fingerToFootMinimumVertexDistance':minimum_distance,'fingerFootTriangleOverlaps':overlaps,'boneLengthError':bone_error,'loopVertexError':seam,'verticalBounds':[minimum_z,maximum_z]}
 summary={k:v for k,v in entry.items() if k!='footPaths'};print('LEGS_CHECK',label,json.dumps(summary),flush=True)
 assert rear_error<1e-5 and max(offsets.values())<.012 and head_forward<.15 and whole_heading<.1 and chest_heading<.15,summary
 assert max(lanes.values())<.001 and max(foot_heading.values())<.5 and ankle_yz_error<.002 and link_error<1e-5 and leg_plane_error<1e-5 and jump<.08 and foot_overlaps==0,summary
 assert leg_p95<1.4 and leg_p99<1.8 and leg_max<3.5,summary
 assert tail_p95<1.35 and tail_p99<1.8 and tail_max<3.5,summary
 assert finger_basis_error<1e-5 and rigid_error<1e-5 and minimum_distance>.04 and overlaps==0 and bone_error<1e-5 and seam<1e-5,summary
 results[label]=entry
report={'sourceSHA256':sha(original.read_bytes()),'glbSHA256':sha(fixed.read_bytes()),'bones':73,'duration':duration,'unchangedAnimationChannels':unchanged,'glbLoopChannelError':channel_seam,'originalGeometryMaterialsPreserved':True,'onlyDeclaredTailWeightBytesChanged':True,'tailWeightRepairVertices':len(changed_vertices),'staticGeometrySHA256':baseline_static,'forelimbVerticesWeightedToRearLegs':cross_weights,'fingerVertices':len(finger_ids),'pureFingerVertices':len(pure_finger_ids),'footVertices':len(foot_ids),'checks':results}
out.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print('LIZARD_VERIFY_PASS',flush=True)
