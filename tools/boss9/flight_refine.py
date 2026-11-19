"""Refine only limbs and tail on the accepted 70-bone flying dragon.

blender -b --python-exit-code 1 -P flight_refine.py -- ACCEPTED.blend OUT_DIR
"""
import bpy,sys,json,math,hashlib,heapq
sys.dont_write_bytecode=True
from pathlib import Path
from mathutils import Vector,Quaternion,Matrix
source,out=map(Path,sys.argv[sys.argv.index('--')+1:][:2]);out.mkdir(parents=True,exist_ok=True)
cfg=json.loads(Path(__file__).with_suffix('.json').read_text(encoding='utf-8'))
bpy.ops.wm.open_mainfile(filepath=str(source));sc=bpy.context.scene
bpy.context.preferences.filepaths.save_version=0
arm=next(o for o in sc.objects if o.type=='ARMATURE');body=bpy.data.objects['BOSS9_Dragon_SingleTail']
action=bpy.data.actions['Walk'];arm.animation_data.action=action;arm.animation_data.action_slot=action.slots[0]
tail=['Bone_%03d'%i for i in range(30,23,-1)]
limbs=['Bone_%03d'%i for i in list(range(6,16))+list(range(37,47))]
touched=set(tail+limbs)
def unchanged_hash():
 rows=[]
 for layer in action.layers:
  for strip in layer.strips:
   for bag in strip.channelbags:
    for fc in bag.fcurves:
     if not any('"'+n+'"' in fc.data_path for n in touched):
      rows.append([fc.data_path,fc.array_index,[(list(k.co),k.interpolation,list(k.handle_left),list(k.handle_right)) for k in fc.keyframe_points]])
 return hashlib.sha256(json.dumps(sorted(rows),sort_keys=True).encode()).hexdigest()
retained=unchanged_hash()
old={n:(arm.data.bones[n].head_local.copy(),arm.data.bones[n].tail_local.copy()) for n in tail}
root=old[tail[0]][0];ratio=cfg['tailLengthRatio'];original_length=sum((b-a).length for a,b in old.values())
group_names={g.index:g.name for g in body.vertex_groups}
weights=[{group_names[g.group]:g.weight for g in v.groups} for v in body.data.vertices]
chains={label:{'Bone_%03d'%i for i in indices} for label,indices in [('foreNear',range(42,47)),('foreFar',range(37,42)),('hind',range(6,16))]}
limb_names=set().union(*chains.values())
adj=[[] for _ in body.data.vertices]
for e in body.data.edges:
 a,b=e.vertices;distance=(body.data.vertices[a].co-body.data.vertices[b].co).length
 adj[a].append((b,distance));adj[b].append((a,distance))
seed_ids={v.index for v in body.data.vertices if v.co.z<.40 and sum(weights[v.index].get(n,0) for n in limb_names)>.25}
labels={};pending=[]
while seed_ids:
 start=seed_ids.pop();component={start};stack=[start]
 while stack:
  for j,_ in adj[stack.pop()]:
   if j in seed_ids:seed_ids.remove(j);component.add(j);stack.append(j)
 if len(component)<5:continue
 label=max(chains,key=lambda key:sum(weights[i].get(n,0) for i in component for n in chains[key]))
 for i in component:labels[i]=label;heapq.heappush(pending,(0,i,label))
dist={i:0 for i in labels}
while pending:
 d,i,label=heapq.heappop(pending)
 if d>dist[i]+1e-8:continue
 for j,length in adj[i]:
  v=body.data.vertices[j]
  if v.co.z>.64 or sum(weights[j].get(n,0) for n in limb_names)<.15:continue
  nd=d+length
  if nd<dist.get(j,float('inf')) and nd<.32:dist[j]=nd;labels[j]=label;heapq.heappush(pending,(nd,j,label))
skin_changes=[]
def ease(a,b,x):
 u=max(0,min(1,(x-a)/(b-a)));return u*u*(3-2*u)
for i,label in labels.items():
 v=body.data.vertices[i];w=weights[i]
 if sum(a for n,a in w.items() if n.startswith('FlightWing_'))>.05:continue
 allowed=chains[label]
 u=max(0,min(1,(v.co.z-.44)/.20));strength=1-u*u*(3-2*u)
 clean={n:a*(1-strength if n in limb_names and n not in allowed else 1) for n,a in w.items()}
 if label=='hind':
  near={'Bone_%03d'%n for n in range(6,11)};far={'Bone_%03d'%n for n in range(11,16)}
  mass=sum(clean.get(n,0) for n in near|far)
  factors=[ease(.02,.16,-v.co.x),ease(.02,.16,v.co.x)]
  parts=[{n:clean.get(n,0) for n in ns} for ns in [near,far]]
  for n in near|far:clean.pop(n,None)
  for ns,factor,fallback in zip(parts,factors,['Bone_009','Bone_014']):
   subtotal=sum(ns.values())
   if subtotal>1e-6:
    for n,a in ns.items():clean[n]=mass*factor*a/subtotal
   else:clean[fallback]=mass*factor
  clean['Bone_001']=clean.get('Bone_001',0)+mass*(1-sum(factors))
 else:
  protection=(1-ease(.02,.10,abs(v.co.x)))*ease(.40,.50,v.co.z)
  transfer=sum(a for n,a in clean.items() if n in limb_names)*protection
  for n in list(clean):
   if n in limb_names:clean[n]*=1-protection
  clean['Bone_002']=clean.get('Bone_002',0)+transfer
 clean=dict(sorted(clean.items(),key=lambda item:-item[1])[:4])
 total=sum(clean.values());clean={n:a/total for n,a in clean.items() if a>1e-7}
 if all(abs(clean.get(n,0)-a)<1e-7 for n,a in w.items()):continue
 for g in list(v.groups):body.vertex_groups[g.group].remove([i])
 for n,a in clean.items():body.vertex_groups[n].add([i],a,'REPLACE')
 weights[i]=clean;skin_changes.append(i)
normals=[n.vector.copy() for n in body.data.corner_normals]
tail_ids=[]
for v,w in zip(body.data.vertices,weights):
 total=sum(w.get(n,0) for n in tail)
 if total<1e-6:continue
 shift=Vector()
 for n in tail:
  if not w.get(n):continue
  a,b=old[n];axis=(b-a).normalized();center=a+axis*(v.co-a).dot(axis)
  shift+=(center-root)*w[n]
 v.co-=shift*(1-ratio);tail_ids.append(v.index)
for i,loop in enumerate(body.data.loops):
 w=weights[loop.vertex_index];normal=normals[i];delta=Vector()
 for n in tail:
  if not w.get(n):continue
  a,b=old[n];axis=(b-a).normalized();delta+=axis*normal.dot(axis)*(1/ratio-1)*w[n]
 normals[i]=(normal+delta).normalized()
body.data.normals_split_custom_set(normals);body.data.update()
sc.frame_set(0)
for p in arm.pose.bones:p.matrix_basis=Matrix.Identity(4)
bpy.context.view_layer.objects.active=arm;bpy.ops.object.mode_set(mode='EDIT')
for n in tail:
 b=arm.data.edit_bones[n];a,z=old[n];b.head=root+(a-root)*ratio;b.tail=root+(z-root)*ratio
bpy.ops.object.mode_set(mode='OBJECT')
for layer in action.layers:
 for strip in layer.strips:
  for bag in strip.channelbags:
   for fc in list(bag.fcurves):
    if any('"'+n+'"' in fc.data_path for n in touched):bag.fcurves.remove(fc)
rest={p.name:p.bone.matrix_local.to_quaternion() for p in arm.pose.bones}
def update():bpy.context.view_layer.update()
def global_rotation(n,q):
 p=arm.pose.bones[n];pre=p.parent.matrix@p.parent.bone.matrix_local.inverted()@p.bone.matrix_local
 p.rotation_quaternion=pre.to_quaternion().inverted()@q
def aim(n,d):
 d=Vector(d).normalized();native=rest[n]@Vector((0,1,0))
 global_rotation(n,native.rotation_difference(d)@rest[n]);update()
def hang_claw(wrist,tip,direction):
 native=arm.data.bones[tip].tail_local-arm.data.bones[wrist].head_local
 q=native.normalized().rotation_difference(Vector(direction).normalized())
 global_rotation(wrist,q@rest[wrist]);update()
def limb(upper,lower,target,pole):
 update();a=arm.pose.bones[upper].head.copy();delta=target-a;direction=delta.normalized()
 l1=arm.data.bones[upper].length;l2=arm.data.bones[lower].length
 d=max(abs(l1-l2)+.0001,min(l1+l2-.0001,delta.length));target=a+direction*d
 along=(l1*l1-l2*l2+d*d)/(2*d);side=Vector(pole)-direction*Vector(pole).dot(direction);side.normalize()
 elbow=a+direction*along+side*math.sqrt(max(0,l1*l1-along*along))
 aim(upper,elbow-a);aim(lower,target-arm.pose.bones[lower].head)
def pose(t):
 phase=2*math.pi*t/cfg['period']
 for n in touched:
  p=arm.pose.bones[n];p.rotation_mode='QUATERNION';p.location=(0,0,0);p.scale=(1,1,1);p.rotation_quaternion=(1,0,0,0)
 update()
 torso=arm.pose.bones['Bone_002'].matrix.to_quaternion()@rest['Bone_002'].inverted()
 forward=torso@Vector((0,-1,0));forward.z=0;forward.normalize()
 for upper,lower,wrist,finger,tip,side in [('041','040','039','038','037',1),('046','045','044','043','042',-1)]:
  shoulder=arm.pose.bones['Bone_'+upper].head.copy()
  target=shoulder+forward*(cfg['foreWristForward']+.012*math.sin(phase-.5))+Vector((side*cfg['foreWristOutward'],0,-cfg['foreWristDrop']+cfg['foreWristBob']*math.sin(phase-.65)))
  limb('Bone_'+upper,'Bone_'+lower,target,Vector((side*.20,.60,-.15)))
  hang_claw('Bone_'+wrist,'Bone_'+tip,(side*.03,-.10,-1))
 anchor=arm.pose.bones['Bone_000'].head.copy()
 for upper,knee,ankle,foot,tip,side in [('010','009','008','007','006',-1),('015','014','013','012','011',1)]:
  target=anchor+Vector((side*cfg['hindAnkleLateral'],cfg['hindAnkleBackward']+.018*math.sin(phase-.8),-cfg['hindAnkleDrop']+cfg['hindAnkleBob']*math.sin(phase-.7)))
  limb('Bone_'+upper,'Bone_'+knee,target,Vector((side*.35,-.55,-.2)))
  hang_claw('Bone_'+ankle,'Bone_'+tip,(side*.04,-.15,-1))
 for i,n in enumerate(tail):
  wave=math.sin(phase+.10-cfg['tailWaveLagPerJoint']*i)
  elevation=math.radians(cfg['tailLiftDegrees'][i]+cfg['tailWaveDegrees'][i]*wave)
  yaw=math.radians(cfg['tailYawDegrees'][i]+2.5*math.sin(phase-.4-.20*i))
  direction=Quaternion((0,0,1),yaw)@Vector((0,math.cos(elevation),math.sin(elevation)))
  aim(n,direction)
  global_rotation(n,Quaternion(direction,math.radians(2*wave))@arm.pose.bones[n].matrix.to_quaternion());update()
 az=math.radians(65);el=math.radians(12);view=Vector((-math.sin(az)*math.cos(el),-math.cos(az)*math.cos(el),math.sin(el)))
 n='Bone_024';p=arm.pose.bones[n]
 global_rotation(n,Quaternion(view,math.radians(-35))@Quaternion((1,0,0),math.radians(65))@p.matrix.to_quaternion());p.scale=(.65,)*3;update()
previous={}
for frame in range(121):
 sc.frame_set(frame);pose(frame/60)
 for n in sorted(touched):
  p=arm.pose.bones[n];q=p.rotation_quaternion.copy()
  if n in previous:q.make_compatible(previous[n]);p.rotation_quaternion=q
  previous[n]=q;p.keyframe_insert('rotation_quaternion',frame=frame,group=n)
 arm.pose.bones['Bone_024'].keyframe_insert('scale',frame=frame,group='Bone_024')
for layer in action.layers:
 for strip in layer.strips:
  for bag in strip.channelbags:
   for fc in bag.fcurves:
    if any('"'+n+'"' in fc.data_path for n in touched):
     for k in fc.keyframe_points:k.interpolation='LINEAR'
assert unchanged_hash()==retained
sc.frame_start=0;sc.frame_end=120;sc.frame_set(0)
bpy.ops.object.select_all(action='DESELECT')
for o in sc.objects:
 if o.type not in {'CAMERA','LIGHT'}:o.select_set(True)
bpy.context.view_layer.objects.active=arm
bpy.ops.wm.save_as_mainfile(filepath=str(out/'boss9_flight.blend'))
bpy.ops.export_scene.gltf(filepath=str(out/'boss9_flight.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='ACTIONS',export_frame_range=False,export_frame_step=1,export_force_sampling=True,export_anim_slide_to_zero=True,export_materials='EXPORT',export_yup=True,export_extras=True,export_def_bones=False)
report={'sourceSHA256':hashlib.sha256(source.read_bytes()).hexdigest(),'retainedWingTorsoHeadCurvesSHA256':retained,'tailLengthSourceUnitsBefore':original_length,'tailLengthSourceUnitsAfter':sum(arm.data.bones[n].length for n in tail),'tailLengthRatio':ratio,'tailVerticesModified':len(tail_ids),'limbVerticesReweighted':len(skin_changes),'configuration':cfg,'clips':['Walk']}
(out/'flight-build.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print('FLIGHT_REFINE_AUTHORED',json.dumps(report),flush=True)
