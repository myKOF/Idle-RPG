"""Correct upper-body heading and misclassified finger animation on the supplied rig.

The GLB writer preserves the entire original mesh/material/skin buffers and replaces
only affected animation samplers with transforms evaluated in Blender.
"""
import bpy,sys,json,math,struct,hashlib,copy
from pathlib import Path
from mathutils import Vector,Quaternion,Euler,Matrix
source,out=map(Path,sys.argv[sys.argv.index('--')+1:][:2]);out.mkdir(parents=True,exist_ok=True)
raw=source.read_bytes();length=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+length]);original_binary=raw[28+length:28+length+doc['buffers'][0]['byteLength']];data=bytearray(original_binary)
bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(source));sc=bpy.context.scene;sc.render.fps=24
arm=next(o for o in sc.objects if o.type=='ARMATURE');body=next(o for o in sc.objects if o.type=='MESH');original=arm.animation_data.action
rest={b.name:b.matrix_local.copy() for b in arm.data.bones};convert=Euler((-math.pi/2,0,0)).to_quaternion()
fingers=[p.name for p in arm.pose.bones['chest'].children_recursive]
touched=['spine_02','spine_16',*fingers]
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
def local(n):
 p=arm.pose.bones[n];q=convert@deform(n)@convert.inverted();pos=convert@p.head
 if p.parent:
  pq=convert@deform(p.parent.name)@convert.inverted();pos=pq.inverted()@(pos-convert@p.parent.head);q=pq.inverted()@q
 return list(pos),[q.x,q.y,q.z,q.w],list(p.scale)
channels={n:{'translation':[],'rotation':[],'scale':[]} for n in touched};last={}
for index,t in enumerate(times):
 sc.frame_set(math.floor(t*24),subframe=(t*24)%1);restore(index)
 foot=Vector()
 for side in ['L','R']:
  v=arm.pose.bones['rearToe.'+side].head-arm.pose.bones['rearFoot.'+side].head;v.z=0;foot+=v.normalized()
 foot.normalize();yaw=math.atan2(foot.x,-foot.y);pitch=deform('spine_02').to_euler('XYZ').x
 before=deform('spine_02').to_euler('XYZ');set_deform('spine_02',Euler((pitch,0,yaw),'XYZ').to_quaternion())
 set_deform('spine_16',Euler((pitch,0,0),'XYZ').to_quaternion())
 for n in fingers:arm.pose.bones[n].matrix_basis=Matrix.Identity(4)
 update()
 for n in touched:
  p=arm.pose.bones[n];q=p.rotation_quaternion.copy()
  if n in last:q.make_compatible(last[n]);p.rotation_quaternion=q
  last[n]=q
  for channel in ['location','rotation_quaternion','scale']:p.keyframe_insert(channel,frame=t*24,group=n)
  translation,rotation,scale=local(n)
  for k,v in [('translation',translation),('rotation',rotation),('scale',scale)]:channels[n][k].append(v)
 metrics.append({'time':t,'footYawDegrees':math.degrees(yaw),'originalBodyEulerDegrees':[math.degrees(x) for x in before],'bodyEulerDegrees':[math.degrees(x) for x in deform('spine_02').to_euler('XYZ')]})
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
report={'sourceSHA256':hashlib.sha256(raw).hexdigest(),'glbSHA256':hashlib.sha256(binary).hexdigest(),'duration':duration,'bones':len(arm.data.bones),'fingers':fingers,'touchedBones':touched,'replacedChannels':replaced,'samples':metrics,'originalBinaryPrefixPreserved':bytes(data[:len(original_binary)])==original_binary}
(out/'build.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print('LIZARD_PREPARED',len(touched),'bones; original geometry buffers retained',flush=True)
