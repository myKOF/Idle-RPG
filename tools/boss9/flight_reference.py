"""Replace only Walk on the reviewed model; author the supplied flight reference in Blender.

blender -b --python-exit-code 1 -P flight_reference.py -- V2.blend OUTPUT_DIR
"""
import bpy,sys,json,math,hashlib
sys.dont_write_bytecode=True
from pathlib import Path
from mathutils import Vector,Quaternion,Euler,Matrix
sys.path.insert(0,str(Path(__file__).parent))
import flight_rig

source,out=map(Path,sys.argv[sys.argv.index('--')+1:][:2]);out.mkdir(parents=True,exist_ok=True)
profile=json.loads((Path(__file__).with_name('flight_profile.json')).read_text(encoding='utf-8'))
bpy.ops.wm.open_mainfile(filepath=str(source));sc=bpy.context.scene
bpy.context.preferences.filepaths.save_version=0
assert sc.render.fps==60
arm=next(o for o in sc.objects if o.type=='ARMATURE')
body=bpy.data.objects['BOSS9_Dragon_SingleTail']
period=profile['period']
az=math.radians(profile['camera']['azimuth']);el=math.radians(profile['camera']['elevation'])
camera_out=Vector((-math.sin(az)*math.cos(el),-math.cos(az)*math.cos(el),math.sin(el)))
camera_right=Vector((math.cos(az),-math.sin(az),0));camera_up=camera_out.cross(camera_right).normalized()
pixels_per_unit=360/(profile['camera']['heightMeters']/4)
initial_root=arm.data.bones['Bone_000'].head_local+Vector((0,0,profile['hoverSourceUnits']))
camera_center=initial_root+camera_right*((320-profile['camera']['hipPixel'][0])/pixels_per_unit)+camera_up*((profile['camera']['hipPixel'][1]-180)/pixels_per_unit)
def action_hash(action):
    rows=[]
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                for fc in bag.fcurves:
                    rows.append([fc.data_path,fc.array_index,[(list(k.co),k.interpolation,list(k.handle_left),list(k.handle_right)) for k in fc.keyframe_points]])
    return hashlib.sha256(json.dumps(sorted(rows),sort_keys=True).encode()).hexdigest()
preserved={n:action_hash(bpy.data.actions[n]) for n in ['Attack1','Attack2','Attack3','Die']}
arm.animation_data.action=None;bpy.data.actions.remove(bpy.data.actions['Walk'])
for n in preserved:bpy.data.actions.remove(bpy.data.actions[n])
rest={p.name:p.bone.matrix_local.to_quaternion() for p in arm.pose.bones}
action=bpy.data.actions.new('Walk');action.use_fake_user=True;arm.animation_data.action=action

def curve(name,t):
    keys=profile['curves'][name];t=t%period
    for i in range(len(keys)-1):
        a,x=keys[i];b,y=keys[i+1]
        if a<=t<=b:
            prev=keys[i-1] if i else [keys[-2][0]-period,keys[-2][1]]
            nxt=keys[i+2] if i+2<len(keys) else [keys[1][0]+period,keys[1][1]]
            m0=(y-prev[1])/(b-prev[0]);m1=(nxt[1]-x)/(nxt[0]-a)
            u=(t-a)/(b-a);h=b-a
            return (2*u**3-3*u*u+1)*x+(u**3-2*u*u+u)*h*m0+(-2*u**3+3*u*u)*y+(u**3-u*u)*h*m1
    return keys[0][1]
def qxyz(x=0,y=0,z=0):return Euler(tuple(math.radians(v) for v in (x,y,z)),'XYZ').to_quaternion()
def local(name,x=0,y=0,z=0):arm.pose.bones[name].rotation_quaternion=rest[name].inverted()@qxyz(x,y,z)@rest[name]
def global_rotation(name,target,blend=1):
    p=arm.pose.bones[name]
    pre=p.parent.matrix@p.parent.bone.matrix_local.inverted()@p.bone.matrix_local if p.parent else p.bone.matrix_local
    target=pre.to_quaternion().inverted()@target
    p.rotation_quaternion=p.rotation_quaternion.slerp(target,blend)
def aim(name,direction):
    native=rest[name]@Vector((0,1,0));direction=Vector(direction).normalized()
    global_rotation(name,native.rotation_difference(direction)@rest[name])
def limb(upper,lower,target,pole):
    bpy.context.view_layer.update();a=arm.pose.bones[upper].head.copy()
    delta=target-a;direction=delta.normalized();l1=arm.data.bones[upper].length;l2=arm.data.bones[lower].length
    d=max(abs(l1-l2)+.0001,min(l1+l2-.0001,delta.length));target=a+direction*d
    along=(l1*l1-l2*l2+d*d)/(2*d);side=Vector(pole)-direction*Vector(pole).dot(direction);side.normalize()
    elbow=a+direction*along+side*math.sqrt(max(0,l1*l1-along*along))
    aim(upper,elbow-a);bpy.context.view_layer.update();aim(lower,target-arm.pose.bones[lower].head);bpy.context.view_layer.update()

def pose(t,opening=False):
    phase=t/period*2*math.pi
    for p in arm.pose.bones:p.location=(0,0,0);p.scale=(1,1,1);p.rotation_quaternion=(1,0,0,0);p.rotation_mode='QUATERNION'
    pitch=curve('bodyPitch',t)
    local('Bone_000',pitch,0,.6*math.sin(phase))
    arm.pose.bones['Bone_000'].location=rest['Bone_000'].inverted()@Vector((0,0,profile['hoverSourceUnits']+curve('bodyBob',t)))
    local('Bone_005',-2*math.sin(phase-.35),0,0)
    local('Bone_004',-2.2*math.sin(phase-.50),0,0)
    local('Bone_003',-1.5*math.sin(phase-.65),0,0)
    neck=curve('neckPitch',t);local('Neck_Base',neck*.45);local('Neck_Upper',neck*.55)
    local('Jaw',.7+.4*math.sin(phase-.8))
    # Relaxed limbs hang below the body, then tuck during the power stroke.
    trail=.5-.5*math.cos(phase-.7)
    fore_trail=.5-.5*math.cos(phase-.25)
    bpy.context.view_layer.update()
    anchor=arm.pose.bones['Bone_000'].head.copy()
    for upper,lower,wrist,finger,side in [('041','040','039','038',1),('046','045','044','043',-1)]:
        limb('Bone_'+upper,'Bone_'+lower,anchor+Vector((side*.10,-.20,-.14+.24*fore_trail)),Vector((side*.4,1,0)))
        aim('Bone_'+wrist,Vector((0,-.10,-1)));bpy.context.view_layer.update()
        aim('Bone_'+finger,Vector((-side*.50,.15,-.85)));bpy.context.view_layer.update()
    for upper,knee,ankle,foot,side in [('010','009','008','007',-1),('015','014','013','012',1)]:
        limb('Bone_'+upper,'Bone_'+knee,anchor+Vector((side*.18,.10+.06*trail,-.18+.24*trail)),Vector((side,-.10,.05)))
        aim('Bone_'+ankle,Vector((0,.1,-1)));bpy.context.view_layer.update()
        aim('Bone_'+foot,Vector((0,-.12,-1)));bpy.context.view_layer.update()
    for side,upper,lower,wrist,palm,digits in [(-1,'050','049','048','047',[56,55,59,58,57,63,62,61,60]),(1,'054','053','052','051',[65,64,68,67,66,72,71,70,69])]:
        phi=curve('dihedral',t)
        lag_phi=curve('dihedral',t-.065)
        fold=max(0,curve('recoveryFold',t));sweep=curve('sweep',t)
        swing=Quaternion((0,1,0),math.radians(-side*phi))
        sweep_q=Quaternion((0,0,1),math.radians(side*sweep))
        fan=Quaternion((0,1,0),math.radians(-side*lag_phi))@sweep_q
        open_plane=Quaternion((1,0,0),math.radians(70-17*fold))
        plane=fan@open_plane
        shoulder=arm.pose.bones['Bone_'+upper].head.copy()
        which='near' if side==-1 else 'far';px=curve(which+'PalmX',t);py=curve(which+'PalmY',t)
        if not opening:
            flight_rig.beat(arm,which.title(),math.radians(phi-curve('dihedral',0)),math.radians(3*math.sin(phase-.35)),max(0,min(1,-phi/70)))
            continue
        hook=body.data.vertices[profile['wingHookVertices'][which]].co-arm.data.bones['Bone_'+palm].head_local
        offset=plane@hook;px-=offset.dot(camera_right)*pixels_per_unit;py+=offset.dot(camera_up)*pixels_per_unit
        plane_point=camera_center+camera_right*((px-320)/pixels_per_unit)-camera_up*((py-180)/pixels_per_unit)
        delta=plane_point-shoulder;projected=delta-camera_out*delta.dot(camera_out)
        reach=max(.84,projected.length+.0001)
        reach=min(reach,sum(arm.data.bones['Bone_'+n].length for n in [upper,lower,wrist])-.002)
        depth=math.sqrt(max(0,reach*reach-projected.length_squared))
        target=shoulder+projected+camera_out*(depth if side==-1 else -depth)
        direction=(target-shoulder).normalized();wrist_target=target-direction*arm.data.bones['Bone_'+wrist].length
        limb('Bone_'+upper,'Bone_'+lower,wrist_target,swing@Vector((side*.4,-.8,.25)))
        aim('Bone_'+wrist,target-arm.pose.bones['Bone_'+wrist].head);bpy.context.view_layer.update()
        global_rotation('Bone_'+palm,plane@rest['Bone_'+palm]);bpy.context.view_layer.update()
    global_rotation('Head',qxyz(curve('headPitch',t),0,.6*math.sin(phase))@rest['Head'])
    bpy.context.view_layer.update()
    tail=['Bone_%03d'%i for i in range(30,23,-1)]
    lift=[18,12,6,1,-5,-10,-14];sweep=[-9,-14,-22,-26,-26,-22,-16]
    for i,n in enumerate(tail):
        wave=math.sin(phase-.48*i-1.0)
        elevation=lift[i]+4.2*wave
        yaw=sweep[i]+3.2*math.sin(phase-.52*i-.6)
        direction=Quaternion((0,0,1),math.radians(yaw))@Vector((0,math.cos(math.radians(elevation)),math.sin(math.radians(elevation))))
        aim(n,direction);bpy.context.view_layer.update()
        p=arm.pose.bones[n];global_rotation(n,Quaternion(direction,math.radians(3*wave))@p.matrix.to_quaternion())
        bpy.context.view_layer.update()
    p=arm.pose.bones['Bone_024'];fin=Quaternion(camera_out,math.radians(profile['tailFinViewRotationDegrees']))@Quaternion((1,0,0),math.radians(65))@p.matrix.to_quaternion()
    global_rotation('Bone_024',fin);p.scale=(profile['tailFinScale'],)*3;bpy.context.view_layer.update()

pose(0,opening=True)
ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get());mesh=ev.to_mesh()
opened=[v.co.copy() for v in mesh.vertices];opened_normals=[n.vector.copy() for n in mesh.corner_normals];ev.to_mesh_clear()
body_inverse=arm.data.bones['Bone_002'].matrix_local@arm.pose.bones['Bone_002'].matrix.inverted()
for p in arm.pose.bones:p.matrix_basis=Matrix.Identity(4)
bpy.context.view_layer.update()
reweighted=flight_rig.install(arm,body,opened,opened_normals,body_inverse,profile['wingTipVertices'])
rest={p.name:p.bone.matrix_local.to_quaternion() for p in arm.pose.bones}
previous={}
for frame in range(round(period*60)+1):
    sc.frame_set(frame);pose(frame/60)
    for p in arm.pose.bones:
        q=p.rotation_quaternion.copy()
        if p.name in previous:q.make_compatible(previous[p.name]);p.rotation_quaternion=q
        previous[p.name]=q
        p.keyframe_insert('rotation_quaternion',frame=frame,group=p.name)
        if p.name.startswith('FlightWing_'):p.keyframe_insert('location',frame=frame,group=p.name)
    arm.pose.bones['Bone_000'].keyframe_insert('location',frame=frame,group='Bone_000')
    arm.pose.bones['Bone_024'].keyframe_insert('scale',frame=frame,group='Bone_024')
for layer in action.layers:
    for strip in layer.strips:
        for bag in strip.channelbags:
            for fc in bag.fcurves:
                for k in fc.keyframe_points:k.interpolation='LINEAR'
arm.animation_data.action=action;arm.animation_data.action_slot=action.slots[0]
sc.frame_start=0;sc.frame_end=120;sc.frame_set(0)
bpy.ops.object.select_all(action='DESELECT')
for o in sc.objects:
    if o.type not in {'CAMERA','LIGHT'}:o.select_set(True)
bpy.context.view_layer.objects.active=arm
bpy.ops.wm.save_as_mainfile(filepath=str(out/'boss9_flight.blend'))
bpy.ops.export_scene.gltf(filepath=str(out/'boss9_flight.glb'),export_format='GLB',use_selection=True,
 export_animations=True,export_animation_mode='ACTIONS',export_frame_range=False,export_frame_step=1,
 export_force_sampling=True,export_anim_slide_to_zero=True,export_materials='EXPORT',export_yup=True,
 export_extras=True,export_def_bones=False)
report={'reference':profile['reference'],'period':period,'originalActionHashes':preserved,'sourceBlendSHA256':hashlib.sha256(source.read_bytes()).hexdigest(),'source':'Flight-only review package. Source v2 and its four other actions remain untouched. Six wing supports added and wing skinning replaced.','reweightedVertices':len(reweighted)}
(out/'flight-build.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print('FLIGHT_REFERENCE_AUTHORED',json.dumps(report),flush=True)
