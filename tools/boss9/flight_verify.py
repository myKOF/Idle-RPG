"""Inspect the reopened Blend, actual skinned surfaces and exported GLB."""
import bpy,sys,json,math,hashlib,struct
import numpy as np
from pathlib import Path
source,baseline,out=map(Path,sys.argv[sys.argv.index('--')+1:][:3])
def sha(data):return hashlib.sha256(data).hexdigest()
def packed():return {i.name:sha(bytes(i.packed_file.data)) for i in bpy.data.images if i.packed_file}
def action_hash(action):
 rows=[]
 for layer in action.layers:
  for strip in layer.strips:
   for bag in strip.channelbags:
    for fc in bag.fcurves:rows.append([fc.data_path,fc.array_index,[(list(k.co),k.interpolation,list(k.handle_left),list(k.handle_right)) for k in fc.keyframe_points]])
 return sha(json.dumps(sorted(rows),sort_keys=True).encode())
bpy.ops.wm.open_mainfile(filepath=str(baseline))
arm=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE');body=bpy.data.objects['BOSS9_Dragon_SingleTail']
before={'images':packed(),'bones':{b.name:np.array(b.matrix_local) for b in arm.data.bones},'vertices':np.array([v.co for v in body.data.vertices]),'faces':[list(f.vertices) for f in body.data.polygons],'uv':np.array([u.uv for u in body.data.uv_layers.active.data])}
groups={g.index:g.name for g in body.vertex_groups};wing={'Bone_%03d'%i for i in range(47,73)}
untouched=[v.index for v in body.data.vertices if sum(g.weight for g in v.groups if groups[g.group] in wing)<.025]
original_actions={n:action_hash(bpy.data.actions[n]) for n in ['Attack1','Attack2','Attack3','Die']}
baseline_sha=sha(baseline.read_bytes())
assert baseline_sha=='c412c1704d6f9f9b9315b5b2fc48163833fff83c8e88ee98a6268f74f6f40e70'
bpy.ops.wm.open_mainfile(filepath=str(source));sc=bpy.context.scene
arm=next(o for o in sc.objects if o.type=='ARMATURE');body=bpy.data.objects['BOSS9_Dragon_SingleTail']
assert set(a.name for a in bpy.data.actions)=={'Walk'}
assert len(arm.data.bones)==70 and packed()==before['images']
for n,m in before['bones'].items():assert np.max(np.abs(np.array(arm.data.bones[n].matrix_local)-m))<1e-5,n
assert [list(f.vertices) for f in body.data.polygons]==before['faces']
assert np.array_equal(np.array([u.uv for u in body.data.uv_layers.active.data]),before['uv'])
assert np.max(np.abs(np.array([v.co for v in body.data.vertices])[untouched]-before['vertices'][untouched]))<1e-6
assert all(abs(sum(g.weight for g in v.groups)-1)<1e-5 and len(v.groups)<=4 for v in body.data.vertices)
for n in ['Bone_%03d'%i for i in range(16,24)]:assert n not in arm.data.bones
for n in ['Bone_%03d'%i for i in range(24,31)]:assert n in arm.data.bones
groups={g.index:g.name for g in body.vertex_groups}
ids={v.index for v in body.data.vertices if sum(g.weight for g in v.groups if groups[g.group].startswith('FlightWing_'))>.05}
edges=np.array([e.vertices[:] for e in body.data.edges if all(i in ids for i in e.vertices)])
rest=np.array([v.co for v in body.data.vertices]);lengths=np.linalg.norm(rest[edges[:,0]]-rest[edges[:,1]],axis=1)
edges=edges[lengths>.005];lengths=lengths[lengths>.005]
action=bpy.data.actions['Walk'];arm.animation_data.action=action;arm.animation_data.action_slot=action.slots[0]
assert tuple(action.frame_range)==(0,120) and sc.render.fps==60
def sample(t):
 f=t*60;sc.frame_set(math.floor(f),subframe=f%1);bpy.context.view_layer.update()
 ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get());mesh=ev.to_mesh();points=np.array([v.co for v in mesh.vertices]);ev.to_mesh_clear()
 return points,{p.name:np.array(p.matrix) for p in arm.pose.bones}
peak=0;worst95=0;worst99=0;minratio=1;scale_error=0;bone_error=0
for i in range(241):
 t=i/120;points,state=sample(t);assert np.all(np.isfinite(points)),t
 ratio=np.linalg.norm(points[edges[:,0]]-points[edges[:,1]],axis=1)/lengths
 peak=max(peak,float(ratio.max()));minratio=min(minratio,float(ratio.min()));worst95=max(worst95,float(np.quantile(ratio,.95)));worst99=max(worst99,float(np.quantile(ratio,.99)))
 for p in arm.pose.bones:
  target=.65 if p.name=='Bone_024' else 1
  scale_error=max(scale_error,max(abs(s-target) for s in p.scale))
  bone_error=max(bone_error,abs((p.tail-p.head).length-p.bone.length*target))
start,s0=sample(0);end,s1=sample(2)
seam=float(np.max(np.abs(start-end)));matrix_seam=max(float(np.max(np.abs(s0[n]-s1[n]))) for n in s0)
report={'samples':241,'durationSeconds':2,'bones':70,'newWingSupports':6,'vertices':len(rest),'faces':len(body.data.polygons),'wingEdgesOver5mm':len(edges),'wingStrainFromNewOpenedRest':{'maximum':peak,'maximum95thPercentile':worst95,'maximum99thPercentile':worst99,'minimum':minratio},'loopVertexErrorSourceUnits':seam,'loopBoneMatrixError':matrix_seam,'maxBoneLengthErrorSourceUnits':bone_error,'scaleError':scale_error,'tailFinConstantScale':.65,'images':packed(),'unchangedNonWingVertices':len(untouched),'sourceV2SHA256':baseline_sha,'originalFourActionsInUnmodifiedV2':original_actions}
# The collar is elastic; the membrane must not form long stretched spikes.
assert peak<1.95 and worst95<1.35,report
assert seam<1e-5 and matrix_seam<1e-5 and bone_error<1e-5 and scale_error<1e-5,report
def glb(path):
 b=path.read_bytes();assert b[:4]==b'glTF';n=struct.unpack_from('<I',b,12)[0];j=json.loads(b[20:20+n]);return j,b[28+n:]
j,data=glb(source.with_suffix('.glb'));old,olddata=glb(baseline.with_suffix('.glb'))
def images(j,b):
 return [sha(b[j['bufferViews'][i['bufferView']].get('byteOffset',0):j['bufferViews'][i['bufferView']].get('byteOffset',0)+j['bufferViews'][i['bufferView']]['byteLength']]) for i in j['images']]
assert images(j,data)==images(old,olddata)
assert [a['name'] for a in j['animations']]==['Walk'] and len(j['skins'][0]['joints'])==70
def accessor(i):
 a=j['accessors'][i];v=j['bufferViews'][a['bufferView']];assert a['componentType']==5126
 dims={'SCALAR':1,'VEC3':3,'VEC4':4,'MAT4':16}[a['type']]
 return np.frombuffer(data,dtype='<f4',count=a['count']*dims,offset=v.get('byteOffset',0)+a.get('byteOffset',0)).reshape(-1,dims)
export_seam=0
for c in j['animations'][0]['channels']:
 s=j['animations'][0]['samplers'][c['sampler']];times=accessor(s['input']);values=accessor(s['output']);assert np.all(np.isfinite(values)) and abs(times[-1,0]-2)<1e-6
 if c['target']['path']=='rotation':
  assert np.max(np.abs(np.linalg.norm(values,axis=1)-1))<1e-5
  delta=min(np.max(np.abs(values[0]-values[-1])),np.max(np.abs(values[0]+values[-1])))
 else:delta=np.max(np.abs(values[0]-values[-1]))
 export_seam=max(export_seam,float(delta))
assert export_seam<1e-5
report['glb']={'sha256':sha(source.with_suffix('.glb').read_bytes()),'clips':['Walk'],'loopChannelError':export_seam,'originalTextureBytesPreserved':True}
out.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print('FLIGHT_VERIFY_PASS',json.dumps(report),flush=True)
