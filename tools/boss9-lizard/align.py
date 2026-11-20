"""Align actual skinned torso/head/tail centerlines with the running axis."""
import bpy,sys,json,math,struct,hashlib
import numpy as np
from pathlib import Path
from mathutils import Vector,Quaternion,Euler,Matrix
source,out=map(Path,sys.argv[sys.argv.index('--')+1:][:2]);out.mkdir(parents=True,exist_ok=True)
raw=source.read_bytes();length=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+length]);original_binary=raw[28+length:28+length+doc['buffers'][0]['byteLength']];data=bytearray(original_binary)
bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(source));sc=bpy.context.scene;sc.render.fps=24
arm=next(o for o in sc.objects if o.type=='ARMATURE');body=next(o for o in sc.objects if o.type=='MESH');original=arm.animation_data.action
rest={b.name:b.matrix_local.copy() for b in arm.data.bones};convert=Euler((-math.pi/2,0,0)).to_quaternion()
fingers=[p.name for p in arm.pose.bones['chest'].children_recursive]
tail=['tail1','tail2','tail3','tail_04','tail4','tail_06','tail_07']
controllers=['spine_02','spine_03','spine2','spine_05','spine_16']
touched=[*controllers,*tail,*fingers]
groups={g.index:g.name for g in body.vertex_groups}
weights=[{groups[g.group]:g.weight for g in v.groups} for v in body.data.vertices]
input_weights=[dict(w) for w in weights];weight_changes=[]
def smooth(a,b,x):
 u=max(0,min(1,(x-a)/(b-a)));return u*u*(3-2*u)
wa=doc['accessors'][doc['meshes'][0]['primitives'][0]['attributes']['WEIGHTS_0']];wv=doc['bufferViews'][wa['bufferView']];weight_offset=wv.get('byteOffset',0)+wa.get('byteOffset',0)
ja=doc['accessors'][doc['meshes'][0]['primitives'][0]['attributes']['JOINTS_0']];jv=doc['bufferViews'][ja['bufferView']];joint_offset=jv.get('byteOffset',0)+ja.get('byteOffset',0)
assert wa['componentType']==5126 and wa['count']==len(weights) and not wv.get('byteStride')
joint_type={5121:'B',5123:'H'}[ja['componentType']];joint_stride=4*(1 if joint_type=='B' else 2);joint_names=[doc['nodes'][i]['name'] for i in doc['skins'][0]['joints']]
for v in body.data.vertices:
 w=input_weights[v.index];amount=smooth(.14,.20,v.co.y)*smooth(.30,.50,sum(w.get(n,0) for n in tail)) if v.co.z>-.18 else 0
 if amount<1e-5 or sum(x for n,x in w.items() if n.startswith('rear'))<1e-5:continue
 ids=struct.unpack_from('<4'+joint_type,data,joint_offset+v.index*joint_stride);before=list(struct.unpack_from('<4f',data,weight_offset+v.index*16));after=[x*(1-amount) if joint_names[k].startswith('rear') else x for k,x in zip(ids,before)];total=sum(after);after=[x/total for x in after];struct.pack_into('<4f',data,weight_offset+v.index*16,*after)
 actual=struct.unpack_from('<4f',data,weight_offset+v.index*16)
 for k,x in zip(ids,actual):body.vertex_groups[joint_names[k]].add([v.index],x,'REPLACE')
 weight_changes.append({'vertex':v.index,'before':before,'after':list(actual),'rearRemoval':amount})
weights=[{groups[g.group]:g.weight for g in v.groups} for v in body.data.vertices]
bind=np.array([v.co for v in body.data.vertices])
regions={}
for name,ys,zs in [('pelvis',(-.05,.07),(.05,.35)),('waist',(-.28,-.16),(-.12,.45)),('rib',(-.48,-.36),(.0,.55)),('chest',(-.61,-.53),(.2,.5)),('skull',(-.83,-.72),(.18,.42)),('nose',(-.99,-.9),(.10,.3))]:
 regions[name]=[v.index for v in body.data.vertices if abs(v.co.x)<(.1 if name in ['pelvis','chest','skull','nose'] else .28) and ys[0]<v.co.y<ys[1] and zs[0]<v.co.z<zs[1]]
for n,ys in zip(tail,[(.23,.37),(.40,.52),(.55,.67),(.69,.79),(.81,.89),(.90,.95),(.96,1.01)]):
 regions[n]=[v.index for v in body.data.vertices if ys[0]<v.co.y<ys[1] and sum(input_weights[v.index].get(k,0) for k in tail)>.7]
assert all(len(ids)>2 for ids in regions.values()),[(n,len(ids)) for n,ids in regions.items()]
centers={n:Vector(bind[ids].mean(axis=0)) for n,ids in regions.items()}
bone_names=list(rest);bone_index={n:i for i,n in enumerate(bone_names)}
joint_ids=np.zeros((len(bind),4),dtype=int);joint_weights=np.zeros((len(bind),4))
for i,w in enumerate(weights):
 for k,(n,v) in enumerate(w.items()):joint_ids[i,k]=bone_index[n];joint_weights[i,k]=v
homogeneous=np.column_stack((bind,np.ones(len(bind))))
ownership={}
for n in bone_names:
 p=arm.pose.bones[n]
 while p and p.name not in controllers:p=p.parent
 ownership[n]=p.name if p else None
influence={r:np.array([np.mean([sum(v for n,v in weights[i].items() if ownership[n]==owner) for i in ids]) for owner in controllers]) for r,ids in regions.items()}
tail_influence=np.array([[np.mean([weights[i].get(n,0) for i in regions[r]])-np.mean([weights[i].get(n,0) for i in regions['pelvis']]) for n in tail] for r in tail])
fit_regions=['waist','rib','chest','skull','nose'];position_jacobian=np.array([influence[n]-influence['pelvis'] for n in fit_regions])
duration=doc['accessors'][doc['animations'][0]['samplers'][0]['input']]['max'][0]
count=160;times=[duration*i/count for i in range(count+1)];poses=[];metrics=[]
for t in times:
 f=t*24;sc.frame_set(math.floor(f),subframe=f%1);bpy.context.view_layer.update()
 poses.append({p.name:(p.location.copy(),p.rotation_quaternion.copy(),p.scale.copy()) for p in arm.pose.bones})
fixed=original.copy();fixed.name='Walk';arm.animation_data.action=fixed;arm.animation_data.action_slot=fixed.slots[0]
for layer in fixed.layers:
 for strip in layer.strips:
  for bag in strip.channelbags:
   for fc in list(bag.fcurves):
    if any('"'+n+'"' in fc.data_path for n in touched):bag.fcurves.remove(fc)

def update():bpy.context.view_layer.update()
def restore(index):
 for p in arm.pose.bones:
  p.rotation_mode='QUATERNION';p.location,p.rotation_quaternion,p.scale=poses[index][p.name]
 update()
def deform(n):return arm.pose.bones[n].matrix.to_quaternion()@rest[n].to_quaternion().inverted()
def set_deform(n,q):
 p=arm.pose.bones[n];pre=p.parent.matrix@p.parent.bone.matrix_local.inverted()@p.bone.matrix_local
 p.rotation_quaternion=pre.to_quaternion().inverted()@q@rest[n].to_quaternion();update()
def set_matrix(n,m):
 p=arm.pose.bones[n];pre=p.parent.matrix@p.parent.bone.matrix_local.inverted()@p.bone.matrix_local
 p.matrix_basis=pre.inverted()@m;update()
def affine(q,center,target):
 m=q.to_matrix().to_4x4();m.translation=target-q@center;return m
def surface():
 ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get());me=ev.to_mesh();p=np.empty(len(me.vertices)*3);me.vertices.foreach_get('co',p);ev.to_mesh_clear();return p.reshape(-1,3)
def skin_centers():
 matrices=np.array([arm.pose.bones[n].matrix@rest[n].inverted() for n in bone_names])
 result={}
 for n,ids in regions.items():
  p=np.einsum('nvij,nj,nv->ni',matrices[joint_ids[ids]],homogeneous[ids],joint_weights[ids])
  result[n]=Vector(p[:,:3].mean(axis=0))
 return result
def local(n):
 p=arm.pose.bones[n];q=convert@deform(n)@convert.inverted();pos=convert@p.head
 if p.parent:
  pq=convert@deform(p.parent.name)@convert.inverted();pos=pq.inverted()@(pos-convert@p.parent.head);q=pq.inverted()@q
 return list(pos),[q.x,q.y,q.z,q.w],list(p.scale)
channels={n:{'translation':[],'rotation':[],'scale':[]} for n in touched};last={}
for index,t in enumerate(times):
 sc.frame_set(math.floor(t*24),subframe=(t*24)%1);restore(index)
 original_tail={n:arm.pose.bones[n].matrix@rest[n].inverted() for n in tail}
 p=surface();pelvis=Vector(p[regions['pelvis']].mean(axis=0));axis=pelvis.x
 pitch=deform('spine_02').to_euler('XYZ').x
 before=deform('spine_02').to_euler('XYZ')
 q=Euler((pitch,0,0),'XYZ').to_quaternion()
 v=q@(centers['chest']-centers['pelvis']);q=Quaternion((0,0,1),-math.atan2(v.x,-v.y))@q
 torso=affine(q,centers['pelvis'],pelvis);set_matrix('spine_02',torso@rest['spine_02'])
 skull=torso@centers['skull'];skull.x=axis
 v=q@(centers['nose']-centers['skull']);hq=Quaternion((0,0,1),-math.atan2(v.x,-v.y))@q
 set_matrix('spine_16',affine(hq,centers['skull'],skull)@rest['spine_16'])
 targets={};previous_rest=centers['pelvis'];previous_target=pelvis.copy();previous_old=pelvis.copy()
 for n in tail:
  old=original_tail[n]@centers[n];delta=old-previous_old;direction=Vector((0,max(.001,delta.y),delta.z)).normalized()
  target=previous_target+direction*(centers[n]-previous_rest).length;target.x=axis;targets[n]=target
  previous_target,previous_rest,previous_old=target,centers[n],old
 for i,n in enumerate(tail):
  other=tail[i+1] if i<len(tail)-1 else tail[i-1]
  tangent=centers[other]-centers[n];desired=targets[other]-targets[n]
  oldq=original_tail[n].to_quaternion();tq=(oldq@tangent).rotation_difference(desired)@oldq
  set_matrix(n,affine(tq,centers[n],targets[n])@rest[n])
 for n in fingers:arm.pose.bones[n].matrix_basis=Matrix.Identity(4)
 update()
 # Center actual skin, rather than equating a joint rotation with body alignment.
 def residual(c):return np.array([c[n].x-c['pelvis'].x for n in fit_regions])
 for _ in range(3):
  c=skin_centers();error=residual(c);hm=arm.pose.bones['spine_16'].matrix.copy();pivot=c['skull']
  rotation=Quaternion((0,0,1),.001).to_matrix().to_4x4();change=Matrix.Translation(pivot)@rotation@Matrix.Translation(-pivot)
  set_matrix('spine_16',change@hm);derivative=(residual(skin_centers())-error)/.001;set_matrix('spine_16',hm)
  delta=np.linalg.lstsq(np.column_stack((position_jacobian,derivative)),-error,rcond=1e-6)[0]
  assert max(abs(x) for x in delta[:-1])<.1 and abs(delta[-1])<.2,delta
  matrices={n:arm.pose.bones[n].matrix.copy() for n in controllers}
  for n,dx in zip(controllers,delta[:-1]):
   m=matrices[n];m.translation.x+=float(dx);set_matrix(n,m)
  rotation=Quaternion((0,0,1),float(delta[-1])).to_matrix().to_4x4();m=Matrix.Translation(pivot)@rotation@Matrix.Translation(-pivot)@arm.pose.bones['spine_16'].matrix;set_matrix('spine_16',m)
 c=skin_centers();axis=c['pelvis'].x;offset=np.linalg.lstsq(tail_influence,np.array([axis-c[n].x for n in tail]),rcond=1e-6)[0]
 assert np.max(np.abs(offset))<.1,offset
 matrices={n:arm.pose.bones[n].matrix.copy() for n in tail}
 for n,delta in zip(tail,offset):
  m=matrices[n];m.translation.x+=float(delta);set_matrix(n,m)
 for n in touched:
  p=arm.pose.bones[n];q=p.rotation_quaternion.copy()
  if n in last:q.make_compatible(last[n]);p.rotation_quaternion=q
  last[n]=q
  for channel in ['location','rotation_quaternion','scale']:p.keyframe_insert(channel,frame=t*24,group=n)
  translation,rotation,scale=local(n)
  for k,v in [('translation',translation),('rotation',rotation),('scale',scale)]:channels[n][k].append(v)
 p=surface();metrics.append({'time':t,'axisX':axis,'originalBodyEulerDegrees':[math.degrees(x) for x in before],'centers':{n:p[ids].mean(axis=0).tolist() for n,ids in regions.items()}})
for layer in fixed.layers:
 for strip in layer.strips:
  for bag in strip.channelbags:
   for fc in bag.fcurves:
    if any('"'+n+'"' in fc.data_path for n in touched):
     for k in fc.keyframe_points:k.interpolation='LINEAR'
bpy.data.actions.remove(original);fixed.use_fake_user=True;sc.frame_start=0;sc.frame_end=16;sc.frame_set(0);bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(out/'boss9_lizard.blend'))

def append(values,kind):
 while len(data)%4:data.append(0)
 offset=len(data);flat=[v for row in values for v in row] if isinstance(values[0],list) else values
 data.extend(struct.pack('<%df'%len(flat),*flat));view=len(doc['bufferViews']);doc['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':len(flat)*4})
 a={'bufferView':view,'componentType':5126,'count':len(values),'type':kind}
 if kind=='SCALAR':a['min']=[min(values)];a['max']=[max(values)]
 index=len(doc['accessors']);doc['accessors'].append(a);return index
time_accessor=append(times,'SCALAR');animation=doc['animations'][0];animation['name']='Walk';replaced=[]
for c in animation['channels']:
 name=doc['nodes'][c['target']['node']]['name'];kind=c['target']['path']
 if name not in touched:continue
 values=channels[name][kind]
 if kind=='rotation':
  previous=None
  for v in values:
   if previous and sum(x*y for x,y in zip(previous,v))<0:v[:]=[-x for x in v]
   previous=v
 output=append(values,'VEC4' if kind=='rotation' else 'VEC3');animation['samplers'][c['sampler']]={'input':time_accessor,'output':output,'interpolation':'LINEAR'};replaced.append([name,kind])
doc['buffers'][0]['byteLength']=len(data);text=json.dumps(doc,separators=(',',':'),ensure_ascii=False).encode('utf-8')
while len(text)%4:text+=b' '
while len(data)%4:data.append(0)
binary=struct.pack('<III',0x46546c67,2,12+8+len(text)+8+len(data))+struct.pack('<II',len(text),0x4e4f534a)+text+struct.pack('<II',len(data),0x004e4942)+data
(out/'boss9_lizard.glb').write_bytes(binary)
report={'sourceSHA256':hashlib.sha256(raw).hexdigest(),'glbSHA256':hashlib.sha256(binary).hexdigest(),'duration':duration,'bones':len(arm.data.bones),'fingers':fingers,'tail':tail,'regions':regions,'bindCenters':{n:list(c) for n,c in centers.items()},'touchedBones':touched,'replacedChannels':replaced,'weightChanges':weight_changes,'weightAccessorByteOffset':weight_offset,'samples':metrics,'originalNonWeightBinaryPreserved':all(data[i]==v for i,v in enumerate(original_binary) if not(weight_offset<=i<weight_offset+wa['count']*16))}
(out/'build.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print('LIZARD_PREPARED',len(touched),'bones; original geometry buffers retained',flush=True)
