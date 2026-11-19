"""Author four combat clips on the approved short-tail model; preserve Walk verbatim."""
import bpy,sys,json,math,hashlib
import numpy as np
sys.dont_write_bytecode=True
from pathlib import Path
from mathutils import Vector,Quaternion,Euler,Matrix
source,out=map(Path,sys.argv[sys.argv.index('--')+1:][:2]);out.mkdir(parents=True,exist_ok=True)
cfg=json.loads(Path(__file__).with_name('combat.json').read_text(encoding='utf-8'))
bpy.ops.wm.open_mainfile(filepath=str(source));sc=bpy.context.scene;bpy.context.preferences.filepaths.save_version=0
arm=next(o for o in sc.objects if o.type=='ARMATURE');body=bpy.data.objects['BOSS9_Dragon_SingleTail']
meshes=[o for o in arm.children_recursive if o.type=='MESH'];walk=bpy.data.actions['Walk']
rest={b.name:b.matrix_local.to_quaternion() for b in arm.data.bones}
restmat={b.name:b.matrix_local.copy() for b in arm.data.bones}
flat_wings={}
groups={g.index:g.name for g in body.vertex_groups}
for label in ['Near','Far']:
 points=np.array([v.co for v in body.data.vertices if sum(g.weight for g in v.groups if groups[g.group].startswith('FlightWing_'+label))>.8])
 _,_,axes=np.linalg.svd(points-points.mean(axis=0),full_matrices=False)
 span=Vector(axes[0]);normal=Vector(axes[-1])
 if span.dot(arm.data.bones['FlightWing_'+label+'Tip'].head_local-arm.data.bones['FlightWing_'+label+'Root'].head_local)<0:span.negate()
 if normal.z<0:normal.negate()
 native=Matrix((span,normal.cross(span),normal)).transposed()
 direction=Vector((1,.7 if label=='Near' else -.6,0)).normalized();up=Vector((0,0,1))
 flat_wings[label]=(Matrix((direction,up.cross(direction),up)).transposed()@native.inverted()).to_quaternion()
def action_hash(action):
 rows=[]
 for layer in action.layers:
  for strip in layer.strips:
   for bag in strip.channelbags:
    for fc in bag.fcurves:rows.append([fc.data_path,fc.array_index,[(list(k.co),k.interpolation,list(k.handle_left),list(k.handle_right)) for k in fc.keyframe_points]])
 return hashlib.sha256(json.dumps(sorted(rows),sort_keys=True).encode()).hexdigest()
walk_hash=action_hash(walk);walk.use_fake_user=True
arm.animation_data.action=walk;arm.animation_data.action_slot=walk.slots[0]
poses=[]
for f in range(121):
 sc.frame_set(f);bpy.context.view_layer.update()
 poses.append({p.name:(p.location.copy(),p.rotation_quaternion.copy(),p.scale.copy()) for p in arm.pose.bones})
def smooth(a,b,t):
 u=max(0,min(1,(t-a)/(b-a)));return u*u*(3-2*u)
def curve(clip,name,t):
 keys=cfg['curves'][clip][name]
 if t<=keys[0][0]:return keys[0][1]
 for (a,x),(b,y) in zip(keys,keys[1:]):
  if t<=b:return x+(y-x)*smooth(a,b,t)
 return keys[-1][1]
def qxyz(x=0,y=0,z=0):return Euler(tuple(math.radians(v) for v in (x,y,z)),'XYZ').to_quaternion()
def update():bpy.context.view_layer.update()
def base_pose(phase):
 f=max(0,min(120,phase*120));a=int(f);b=min(120,a+1);u=f-a
 for p in arm.pose.bones:
  x,y=poses[a][p.name],poses[b][p.name];p.rotation_mode='QUATERNION'
  p.location=x[0].lerp(y[0],u);p.rotation_quaternion=x[1].slerp(y[1],u);p.scale=x[2].lerp(y[2],u)
 update()
def add(n,x=0,y=0,z=0):
 p=arm.pose.bones[n];p.rotation_quaternion=rest[n].inverted()@qxyz(x,y,z)@rest[n]@p.rotation_quaternion
def global_rotation(n,q,blend=1):
 p=arm.pose.bones[n];pre=p.parent.matrix@p.parent.bone.matrix_local.inverted()@p.bone.matrix_local if p.parent else p.bone.matrix_local
 target=pre.to_quaternion().inverted()@q;p.rotation_quaternion=p.rotation_quaternion.slerp(target,blend)
def aim(n,d,reference,blend=1):
 native=reference@(rest[n]@Vector((0,1,0)));direction=Vector(d).normalized()
 global_rotation(n,native.rotation_difference(direction)@reference@rest[n],blend);update()
def limb(upper,lower,target,pole,reference,blend=1):
 a=arm.pose.bones[upper].head.copy();delta=target-a;direction=delta.normalized()
 l1=arm.data.bones[upper].length;l2=arm.data.bones[lower].length;d=max(abs(l1-l2)+.0001,min(l1+l2-.0001,delta.length))
 target=a+direction*d;along=(l1*l1-l2*l2+d*d)/(2*d);side=pole-direction*pole.dot(direction);side.normalize()
 elbow=a+direction*along+side*math.sqrt(max(0,l1*l1-along*along))
 aim(upper,elbow-a,reference,blend);aim(lower,target-arm.pose.bones[lower].head,reference,blend)
def hang(wrist,tip,direction,reference,blend=1,twist=0):
 native=(arm.data.bones[tip].tail_local-arm.data.bones[wrist].head_local).normalized();direction=Vector(direction).normalized()
 q=Quaternion(direction,math.radians(twist))@(reference@native).rotation_difference(direction)@reference@rest[wrist]
 global_rotation(wrist,q,blend);update()
def set_world(n,m):
 p=arm.pose.bones[n];pre=p.parent.matrix@p.parent.bone.matrix_local.inverted()@p.bone.matrix_local
 p.matrix_basis=pre.inverted()@m
def bank_wing(label,degrees):
 if abs(degrees)<1e-8:return
 torso=arm.pose.bones['Bone_002'].matrix@restmat['Bone_002'].inverted()
 span=arm.data.bones['FlightWing_'+label+'Tip'].head_local-arm.data.bones['FlightWing_'+label+'Root'].head_local
 axis=torso.to_quaternion()@Vector((span.y,-span.x,0)).normalized();hinge=torso@arm.data.bones['FlightWing_'+label+'Root'].head_local
 g=Matrix.Translation(hinge)@Quaternion(axis,math.radians(degrees)).to_matrix().to_4x4()@Matrix.Translation(-hinge)
 matrices={part:arm.pose.bones['FlightWing_'+label+part].matrix.copy() for part in ['Root','Middle','Tip']}
 for part,m in matrices.items():set_world('FlightWing_'+label+part,g@m)
 update()
def death_wing(label,bank,sweep,fold):
 torso=arm.pose.bones['Bone_002'].matrix@restmat['Bone_002'].inverted();base=torso.to_quaternion()
 span=arm.data.bones['FlightWing_'+label+'Tip'].head_local-arm.data.bones['FlightWing_'+label+'Root'].head_local
 axis=Vector((span.y,-span.x,0)).normalized();previous=None
 for part,fraction in [('Root',.4+.25*(1-fold)),('Middle',.85+.10*(1-fold)),('Tip',1)]:
  n='FlightWing_'+label+part;native=arm.data.bones[n].head_local
  head=torso@native if previous is None else previous[0]+previous[2]@(native-previous[1])
  q=base@qxyz(0,0,sweep)@Quaternion(axis,math.radians(bank*fraction))
  if part!='Root':q=Quaternion(q@Vector((-1 if label=='Near' else 1,0,0)),math.radians(-3*math.sin(.35)*(.45 if part=='Middle' else 1)*(1-fold)))@q
  q=q.slerp(flat_wings[label],fold)
  m=q.to_matrix().to_4x4();m.translation=head-q@native;set_world(n,m@restmat[n]);previous=(head,native,q)
 update()
def minimum():
 deps=bpy.context.evaluated_depsgraph_get();low=float('inf')
 for ob in meshes:
  ev=ob.evaluated_get(deps);me=ev.to_mesh();low=min(low,min((ev.matrix_world@v.co).z for v in me.vertices));ev.to_mesh_clear()
 return low
floor_samples=[]
def pose(clip,t,d):
 base_pose(0 if clip=='Die' else t/d)
 root=arm.pose.bones['Bone_000'];base_root=(root.matrix.to_quaternion()@rest['Bone_000'].inverted()).to_euler('XYZ')
 base_head=(arm.pose.bones['Head'].matrix.to_quaternion()@rest['Head'].inverted()).to_euler('XYZ')
 pitch=math.degrees(base_root.x);yaw=math.degrees(base_root.z);roll=0;chest=0;neck=0;head=math.degrees(base_head.x);jaw=0;shift=Vector();wind=0;strike=0;fall=0
 if clip=='Attack1':
  wind=curve(clip,'wind',t);strike=curve(clip,'strike',t)
  pitch+=-35*wind+22*strike;chest=-10*wind+12*strike;neck=-15*wind+16*strike
  head+=-50*wind+10*strike;jaw=curve(clip,'jaw',t)
  shift=Vector((0,-cfg['biteForwardMeters']/4*curve(clip,'travel',t),.09*wind+.035*strike))
 elif clip=='Attack2':
  wind=curve(clip,'wind',t);strike=curve(clip,'slash',t);yaw=curve(clip,'yaw',t)
  roll=8*wind-12*strike;pitch+=-8*wind+10*strike;chest=-6*wind+9*strike;neck=-5*wind+7*strike;head+=-6*wind+6*strike
  shift=Vector((0,-.06*strike,.025*wind))
 elif clip=='Attack3':
  wind=curve(clip,'wind',t);strike=curve(clip,'strike',t);breath=curve(clip,'breath',t)
  pulse=.35*math.sin(t*math.pi*10)*breath
  pitch+=-28*wind+18*strike+pulse;chest=-9*wind+9*strike;neck=-17*wind+12*strike
  head=head*(1-breath)+8*breath-65*wind*(1-breath);jaw=17*wind+43*breath
  shift=Vector((0,.05*wind-.20*strike,.10*wind+.025*breath))
 else:
  wind=curve(clip,'rear',t);fall=curve(clip,'fall',t)
  pitch=15-50*wind-10*fall;roll=curve(clip,'roll',t);yaw=curve(clip,'yaw',t)
  chest=-10*wind;neck=-20*wind+10*fall;head=curve(clip,'head',t);jaw=43*wind+8*fall
  shift=Vector((0,.08*fall,.15*wind-1.55*fall))
 root.rotation_quaternion=rest['Bone_000'].inverted()@qxyz(pitch,roll,yaw)@rest['Bone_000']
 root.location+=rest['Bone_000'].inverted()@shift
 for n,f in [('Bone_005',.25),('Bone_004',.45),('Bone_003',.30)]:add(n,chest*f)
 add('Neck_Base',neck*.45,0,-yaw*.25 if clip=='Attack2' else 8*fall);add('Neck_Upper',neck*.55,0,-yaw*.25 if clip=='Attack2' else 8*fall)
 add('Jaw',jaw);update()
 reference=(root.matrix.to_quaternion()@rest['Bone_000'].inverted())
 if clip!='Die':
  for n,sign in [('Bone_041',1),('Bone_046',-1)]:
   if clip!='Attack2' or sign==1:add(n,-3*wind+3*strike,0,sign*(2*wind-2*strike))
  for n,side in [('Bone_010',-1),('Bone_015',1)]:add(n,2*wind-2*strike,side*1.5*strike)
  update()
 if clip=='Attack2':
  weight=smooth(.05,.26,t)*(1-smooth(.82,1.17,t));s=smooth(.40,.67,t);heading=Quaternion((0,0,1),math.radians(yaw))
  start=heading@Vector((-.20,.08,.28));control=Vector((-.80,-.80,1.20));end=Vector((.25,-.45,-.15))
  offset=(1-s)**2*start+2*(1-s)*s*control+s*s*end
  if weight>0:
   shoulder=arm.pose.bones['Bone_046'].head.copy();pole=(heading@Vector((-.7,.20,.35))).lerp(Vector((-.3,-.6,.10)),s)
   limb('Bone_046','Bone_045',shoulder+offset,pole,reference,weight)
   direction=(heading@Vector((-.50,-.30,.80))).lerp(Vector((.65,-.25,-.72)),smooth(.52,.67,t)).normalized()
   hang('Bone_044','Bone_042',direction,reference,weight,20-40*s)
  bank_wing('Near',8*wind-7*strike);bank_wing('Far',-7*wind+8*strike)
 elif clip=='Attack1':bank_wing('Near',5*wind-3*strike);bank_wing('Far',5*wind-3*strike)
 elif clip=='Attack3':bank_wing('Near',4*wind);bank_wing('Far',4*wind)
 else:
  fold=smooth(.98,1.95,t);bank=curve(clip,'wingBank',t)
  for label in ['Near','Far']:death_wing(label,bank,cfg['deathWingSweepDegrees'][label]*fold,fold)
  for upper,lower,wrist,tip,side in [('041','040','039','037',1),('046','045','044','042',-1)]:
   shoulder=arm.pose.bones['Bone_'+upper].head.copy();target=shoulder+reference@Vector((-.20 if side==1 else .025,-.13,-.25))
   limb('Bone_'+upper,'Bone_'+lower,target,reference@Vector((side*.12,.4,-.2)),reference,fall)
   hang('Bone_'+wrist,'Bone_'+tip,reference@Vector((-.4 if side==1 else -.03,-.10,-1)),reference,fall)
  for upper,knee,ankle,tip,side in [('010','009','008','006',-1),('015','014','013','011',1)]:
   target=(root.matrix@restmat['Bone_000'].inverted())@(arm.data.bones['Bone_000'].head_local+Vector((-.20 if side==-1 else -.10,-.05,-.24)))
   limb('Bone_'+upper,'Bone_'+knee,target,reference@Vector((side*.05,-.8,-.1)),reference,fall)
   hang('Bone_'+ankle,'Bone_'+tip,reference@Vector((side*.04,-.15,-1)),reference,fall)
 update()
 head_yaw=.17*yaw if clip=='Attack2' else yaw
 global_rotation('Head',qxyz(head,roll*(1 if clip=='Die' else .35),head_yaw)@rest['Head']);update()
 if clip=='Attack2':
  for i in range(7):add('Bone_%03d'%(30-i),0,0,(-yaw*.025)*(i/6));update()
 if clip=='Die':
  for i in range(7):
   n='Bone_%03d'%(30-i);elevation=math.radians([5,3,1,0,-3,-5,-7][i])
   aim(n,reference@Vector((0,math.cos(elevation),math.sin(elevation))),reference,fall)
  z=minimum();contact=smooth(1.45,2.0,t);delta=(.035-z)*contact
  if z+delta<.025:delta=.025-z
  root.location+=rest['Bone_000'].inverted()@Vector((0,0,delta/4));update();floor_samples.append([t,minimum(),delta])
for clip,d in cfg['durations'].items():
 action=bpy.data.actions.new(clip);action.use_fake_user=True;arm.animation_data.action=action;previous={}
 for frame in range(round(d*60)+1):
  sc.frame_set(frame);pose(clip,frame/60,d)
  for p in arm.pose.bones:
   q=p.rotation_quaternion.copy()
   if p.name in previous:q.make_compatible(previous[p.name]);p.rotation_quaternion=q
   previous[p.name]=q
   for channel in ['rotation_quaternion','location','scale']:p.keyframe_insert(channel,frame=frame,group=p.name)
 for layer in action.layers:
  for strip in layer.strips:
   for bag in strip.channelbags:
    for fc in bag.fcurves:
     for k in fc.keyframe_points:k.interpolation='LINEAR'
 print('AUTHORED',clip,d,flush=True)
assert action_hash(walk)==walk_hash
arm.animation_data.action=walk;arm.animation_data.action_slot=walk.slots[0];sc.frame_start=0;sc.frame_end=180;sc.frame_set(0)
bpy.ops.object.select_all(action='DESELECT')
for ob in sc.objects:
 if ob.type not in {'CAMERA','LIGHT'}:ob.select_set(True)
bpy.context.view_layer.objects.active=arm
bpy.ops.wm.save_as_mainfile(filepath=str(out/'boss9.blend'))
bpy.ops.export_scene.gltf(filepath=str(out/'boss9.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='ACTIONS',export_frame_range=False,export_frame_step=1,export_force_sampling=True,export_anim_slide_to_zero=True,export_materials='EXPORT',export_yup=True,export_extras=True,export_def_bones=False)
report={'sourceSHA256':hashlib.sha256(source.read_bytes()).hexdigest(),'walkActionSHA256':walk_hash,'configuration':cfg,'deathFloorSamples':floor_samples,'geometry':'Approved model, short-tail rest skeleton, all meshes, weights, UV and materials unchanged.'}
(out/'combat-build.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print('COMBAT_AUTHORED',flush=True)
