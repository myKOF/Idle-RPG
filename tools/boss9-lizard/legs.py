"""Run both rear legs in sagittal lanes while retaining the corrected body axis."""
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
chains={s:['rearLeg.'+s+'_01','rearLwr.'+s,'rearHorselink.'+s,'rearFoot.'+s,'rearToe.'+s] for s in ['L','R']}
controllers=['spine_02','spine_03','spine2','spine_05','spine_16',chains['L'][0],chains['R'][0]]
touched=list(dict.fromkeys([*controllers,*tail,*fingers,*chains['L'],*chains['R']]))
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
body_regions=list(regions)
for side in ['L','R']:
 ids=[v.index for v in body.data.vertices if v.co.z<-.48 and v.co.y>.06 and sum(input_weights[v.index].get(n,0) for n in chains[side][2:])>.9]
 ys=bind[ids,1];lower,upper=np.percentile(ys,[35,65]);regions['foot'+side]=ids
 regions['heel'+side]=[i for i in ids if bind[i,1]>=upper];regions['toe'+side]=[i for i in ids if bind[i,1]<=lower]
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
fit_regions=['waist','rib','chest','skull','nose','footL','footR']
position_jacobian=np.array([*(influence[n]-influence['pelvis'] for n in fit_regions),influence['toeL']-influence['heelL'],influence['toeR']-influence['heelR']])
lane_width=.20
duration=doc['accessors'][doc['animations'][0]['samplers'][0]['input']]['max'][0]
count=320;times=[duration*i/count for i in range(count+1)];poses=[];metrics=[]
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
def planar_fabrik(root,target,initial,lengths):
 points=[Vector((root.x,p.y,p.z)) for p in initial];points[0]=root.copy()
 for _ in range(100):
  points[-1]=target.copy()
  for i in range(2,-1,-1):points[i]=points[i+1]+(points[i]-points[i+1]).normalized()*lengths[i]
  points[0]=root.copy()
  for i in range(3):points[i+1]=points[i]+(points[i+1]-points[i]).normalized()*lengths[i]
  if (points[-1]-target).length<1e-7:break
 assert (points[-1]-target).length<1e-5,(points[-1],target)
 return points
def segment_rotation(vector,desired,normal):
 y=vector.normalized();x=(normal-y*normal.dot(y)).normalized();z=x.cross(y).normalized();x=y.cross(z)
 native=Matrix((x,y,z)).transposed();y=desired.normalized();x=Vector((1,0,0));z=x.cross(y).normalized()
 return (Matrix((x,y,z)).transposed()@native.inverted()).to_quaternion()
leg_metrics=[]
channels={n:{'translation':[],'rotation':[],'scale':[]} for n in touched};last={}
for index,t in enumerate(times):
 sc.frame_set(math.floor(t*24),subframe=(t*24)%1);restore(index)
 original_tail={n:arm.pose.bones[n].matrix@rest[n].inverted() for n in tail}
 p=surface();pelvis=Vector(p[regions['pelvis']].mean(axis=0));axis=pelvis.x
 phase_legs={}
 for side,sign in [('L',1),('R',-1)]:
  chain=chains[side];heads=[arm.pose.bones[n].head.copy() for n in chain];rest_heads=[rest[n].translation.copy() for n in chain]
  fp=max(-math.radians(65),min(math.radians(65),deform(chain[3]).to_euler('XYZ').x));fq=Euler((fp,0,0),'XYZ').to_quaternion()
  v=fq@(centers['toe'+side]-centers['heel'+side]);fq=Quaternion((0,0,1),-math.atan2(v.x,-v.y))@fq
  root=heads[0].copy();root.x=axis+sign*lane_width-(fq@(centers['foot'+side]-rest_heads[3])).x
  target=heads[3].copy();target.x=root.x;lengths=[(rest_heads[i+1]-rest_heads[i]).length for i in range(3)]
  points=planar_fabrik(root,target,heads[:4],lengths)
  normal=(rest_heads[1]-rest_heads[0]).cross(rest_heads[2]-rest_heads[1]).normalized()
  if normal.x<0:normal.negate()
  for i in range(3):
   qleg=segment_rotation(rest_heads[i+1]-rest_heads[i],points[i+1]-points[i],normal)
   set_matrix(chain[i],affine(qleg,rest_heads[i],points[i])@rest[chain[i]])
  foot=affine(fq,rest_heads[3],points[3]);set_matrix(chain[3],foot@rest[chain[3]]);set_matrix(chain[4],foot@rest[chain[4]])
  phase_legs[side]={'originalAnkle':list(heads[3]),'targetAnkle':list(points[3]),'linkLengths':lengths}
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
 def residual(c):return np.array([*(c[n].x-c['pelvis'].x-(lane_width if n=='footL' else -lane_width if n=='footR' else 0) for n in fit_regions),c['toeL'].x-c['heelL'].x,c['toeR'].x-c['heelR'].x])
 for _ in range(4):
  c=skin_centers();error=residual(c);derivatives=[];pivots=[c['skull'],arm.pose.bones[chains['L'][3]].head.copy(),arm.pose.bones[chains['R'][3]].head.copy()];yaw_bones=['spine_16',chains['L'][3],chains['R'][3]]
  for n,pivot in zip(yaw_bones,pivots):
   saved=arm.pose.bones[n].matrix.copy();rotation=Quaternion((0,0,1),.001).to_matrix().to_4x4();change=Matrix.Translation(pivot)@rotation@Matrix.Translation(-pivot)
   set_matrix(n,change@saved);derivatives.append((residual(skin_centers())-error)/.001);set_matrix(n,saved)
  delta=np.linalg.lstsq(np.column_stack((position_jacobian,*derivatives)),-error,rcond=1e-6)[0]
  assert max(abs(x) for x in delta[:len(controllers)])<.15 and max(abs(x) for x in delta[len(controllers):])<1.0,delta
  delta[len(controllers):]=np.clip(delta[len(controllers):],-.25,.25)
  matrices={n:arm.pose.bones[n].matrix.copy() for n in controllers}
  for n,dx in zip(controllers,delta[:len(controllers)]):
   m=matrices[n];m.translation.x+=float(dx);set_matrix(n,m)
  for n,pivot,angle in zip(yaw_bones,pivots,delta[len(controllers):]):
   if n!='spine_16':pivot=arm.pose.bones[n].head.copy()
   rotation=Quaternion((0,0,1),float(angle)).to_matrix().to_4x4();set_matrix(n,Matrix.Translation(pivot)@rotation@Matrix.Translation(-pivot)@arm.pose.bones[n].matrix)
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
 leg_metrics.append({'time':t,'legs':phase_legs})
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
report={'sourceSHA256':hashlib.sha256(raw).hexdigest(),'glbSHA256':hashlib.sha256(binary).hexdigest(),'duration':duration,'bones':len(arm.data.bones),'fingers':fingers,'tail':tail,'bodyRegions':body_regions,'legChains':chains,'laneWidth':lane_width,'legSamples':leg_metrics,'regions':regions,'bindCenters':{n:list(c) for n,c in centers.items()},'touchedBones':touched,'replacedChannels':replaced,'weightChanges':weight_changes,'weightAccessorByteOffset':weight_offset,'samples':metrics,'originalNonWeightBinaryPreserved':all(data[i]==v for i,v in enumerate(original_binary) if not(weight_offset<=i<weight_offset+wa['count']*16))}
(out/'build.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print('LIZARD_PREPARED',len(touched),'bones; original geometry buffers retained',flush=True)
