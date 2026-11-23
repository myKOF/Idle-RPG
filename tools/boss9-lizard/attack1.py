"""Author Attack1 in Blender, appending it without changing the accepted Walk GLB."""
import bpy, sys, json, math, struct, hashlib
import numpy as np
from pathlib import Path
from mathutils import Vector, Quaternion, Euler, Matrix

source, blend, out = map(Path, sys.argv[sys.argv.index('--') + 1:][:3])
out.mkdir(parents=True, exist_ok=True)
raw = source.read_bytes()
json_length = struct.unpack_from('<I', raw, 12)[0]
doc = json.loads(raw[20:20 + json_length])
original_binary = raw[28 + json_length:28 + json_length + doc['buffers'][0]['byteLength']]
data = bytearray(original_binary)
bpy.ops.wm.open_mainfile(filepath=str(blend))
scene = bpy.context.scene
arm = next(o for o in scene.objects if o.type == 'ARMATURE')
mesh = next(o for o in scene.objects if o.type == 'MESH')
scene.frame_set(0)
bpy.context.view_layer.update()
walk = arm.animation_data.action
assert walk.name == 'Walk'
baseline = {p.name: p.matrix_basis.copy() for p in arm.pose.bones}
rest = {b.name: b.matrix_local.copy() for b in arm.data.bones}
base_world = {p.name: p.matrix.copy() for p in arm.pose.bones}
convert = Euler((-math.pi / 2, 0, 0)).to_quaternion()
axis = .073
ground = -.744
duration, fps = 1.8, 240
rise_start, sweep_start, sweep_end, recovery_start = .12, .74, 1.12, 1.23
times = [i / fps for i in range(round(duration * fps) + 1)]
action = bpy.data.actions.new('Attack1')
arm.animation_data.action = action
scene.render.fps = 24

# Time, pelvis x/y/z, lumbar pitch/yaw/roll, rib yaw, head lift,
# right palm x/y/z, hand pitch/yaw, left palm x/y/z, right foot step.
# Coordinates are Blender Z-up; -Y is forward. Anatomical right is -X.
keys = [
 (0.00, 0,0,-.14, 0,0,0,0,0, -.44,-.62,-.436, 0,0, .48,-.62,-.442,0),
 (0.12, .025,.015,-.22, 5,-7,3,-4,-3, -.44,-.62,-.436, 0,0, .48,-.62,-.442,0),
 (0.34, .065,.025,-.195, -3,-17,19,-9,2, -.50,-.50,-.08, -25,-10, .48,-.62,-.442,0),
 (0.55, .08,.035,-.145, -10,-26,28,-12,9, -.55,-.39,.43, -60,-20, .48,-.62,-.442,0),
 (0.74, .08,.045,-.125, -13,-30,32,-13,13, -.56,-.33,.64, -78,-25, .48,-.62,-.442,0),
 (0.86, -.03,-.08,-.18, 7,-25,15,-6,-8, -.30,-1.20,.29, -30,4, .50,-.65,-.32,.06),
 (1.00, -.02,-.20,-.275, 20,5,-5,6,-15, .24,-1.32,-.16, 10,35, .53,-.51,-.18,.22),
 (1.12, .015,-.23,-.27, 23,29,-11,12,-12, .46,-1.26,-.35, 20,52, .53,-.43,-.16,.24),
 (1.23, .02,-.19,-.25, 18,23,-7,8,-8, .44,-1.20,-.31, 17,40, .52,-.45,-.20,.22),
 (1.48, .005,-.10,-.175, 8,9,-2,3,-3, -.15,-.90,-.26, 3,12, .50,-.54,-.31,.12),
 (1.80, 0,0,-.14, 0,0,0,0,0, -.44,-.62,-.436, 0,0, .48,-.62,-.442,0),
]
def sample(t):
    i = min(len(keys)-2, max(0, int(np.searchsorted(key_array[:,0], t, side='right')-1)))
    u = (t-keys[i][0])/(keys[i+1][0]-keys[i][0])
    u = min(1,max(0,u));dt=keys[i+1][0]-keys[i][0]
    return ((2*u**3-3*u*u+1)*key_array[i,1:]+(u**3-2*u*u+u)*dt*slopes[i]
            +(-2*u**3+3*u*u)*key_array[i+1,1:]+(u**3-u*u)*dt*slopes[i+1])

# Follow the visible claw cluster, rather than merely moving a wrist joint.
right_hand_names={'spine_18',*[b.name for b in arm.pose.bones['spine_18'].children_recursive]}
group_names={g.index:g.name for g in mesh.vertex_groups}
claw_ids=[v.index for v in mesh.data.vertices if v.co.z<-.40 and sum(g.weight for g in v.groups if group_names[g.group] in right_hand_names)>.99999]
assert len(claw_ids)>30
finger_base_ids=[v.index for v in mesh.data.vertices if sum(g.weight for g in v.groups if group_names[g.group] in {'spine_35','spine_38','spine_41'})>.85]
finger_tip_ids=[v.index for v in mesh.data.vertices if sum(g.weight for g in v.groups if group_names[g.group] in {'spine_33','spine_36','spine_39'})>.85]
assert len(finger_base_ids)>20 and len(finger_tip_ids)>20
evaluated=mesh.evaluated_get(bpy.context.evaluated_depsgraph_get());skin=evaluated.to_mesh()
claw_initial=Vector(np.mean([skin.vertices[i].co for i in claw_ids],axis=0))
base_mean=Vector(np.mean([skin.vertices[i].co for i in finger_base_ids],axis=0))
tip_mean=Vector(np.mean([skin.vertices[i].co for i in finger_tip_ids],axis=0));evaluated.to_mesh_clear()
hand_inverse=(base_world['spine_18']@rest['spine_18'].inverted()).inverted()
claw_bind=hand_inverse@claw_initial
claw_offset=claw_bind-rest['spine_18'].translation
finger_axis=((hand_inverse@tip_mean)-(hand_inverse@base_mean)).normalized()
# Aim the actual long-claw tips toward the enemy (-Y), 15 degrees below
# horizontal. The wrist angle is derived from the skin rather than guessed.
plane_length=math.hypot(finger_axis.y,finger_axis.z)
forward_pitch=math.atan2(finger_axis.z,-finger_axis.y)-math.asin(-math.sin(math.radians(15))/plane_length)
pitched=Quaternion((1,0,0),forward_pitch)@finger_axis
forward_yaw=math.atan2(-pitched.x,-pitched.y)
for i,k in enumerate(keys):
    row=list(k);old_q=Euler((math.radians(row[12]),0,math.radians(row[13])),'XYZ').to_quaternion()
    if .86<=row[0]<=1.23:row[12:14]=[math.degrees(forward_pitch),math.degrees(forward_yaw)]
    if row[0]==1.48:row[12:14]=[math.degrees(forward_pitch)*.5,math.degrees(forward_yaw)*.5]
    if row[0]>=1.12:
        new_q=Euler((math.radians(row[12]),0,math.radians(row[13])),'XYZ').to_quaternion()
        # Keep the existing R3 claw arc/recovery positions when turning the
        # wrist, including the hand-off between the sweep and recovery.
        old_claw=Vector((axis+row[9],row[10],row[11]))+old_q@claw_offset
        palm=old_claw-new_q@claw_offset;row[9:12]=[palm.x-axis,palm.y,palm.z]
    keys[i]=tuple(row)

key_array=np.array(keys,dtype=float)
# One C1 curve retains velocity at the interior lift poses.
h=np.diff(key_array[:,0]);secants=np.diff(key_array[:,1:],axis=0)/h[:,None]
slopes=np.zeros_like(key_array[:,1:])
for i in range(1,len(keys)-1):
    a,b=secants[i-1],secants[i];mask=a*b>0;w1,w2=2*h[i]+h[i-1],h[i]+2*h[i-1]
    slopes[i,mask]=(w1+w2)/(w1/a[mask]+w2/b[mask])

def sweep_palm(t,pitch,yaw):
    u=min(1,max(0,(t-sweep_start)/(sweep_end-sweep_start)));s=u*u*(3-2*u)
    start=Vector((axis-.56,-.33,.64))+Euler((math.radians(-78),0,math.radians(-25)),'XYZ').to_quaternion()@claw_offset
    end=Vector((axis+.46,-1.26,-.35))+Euler((math.radians(20),0,math.radians(52)),'XYZ').to_quaternion()@claw_offset
    # A bowed quarter-ellipse: descend along the outside of the raised arm,
    # then carry the claw horizontally across the low part of the swing.
    # A small outward bow matches the user's red curve near its upper end.
    angle=s*math.pi/2
    target=start.copy()
    target.x+=(end.x-start.x)*(1-math.cos(angle)-.16*math.sin(2*angle))
    target.z+=(end.z-start.z)*math.sin(angle)
    v=min(1,u*2);v=v*v*(3-2*v)
    target.y=start.y+(end.y-start.y)*v
    q=Euler((math.radians(pitch),0,math.radians(yaw)),'XYZ').to_quaternion()
    return target-q@claw_offset

def update(): bpy.context.view_layer.update()

def set_matrix(name, matrix):
    p = arm.pose.bones[name]
    pre = p.parent.matrix @ p.parent.bone.matrix_local.inverted() @ p.bone.matrix_local if p.parent else p.bone.matrix_local
    p.matrix_basis = pre.inverted() @ matrix
    update()

def rotate(name, angles):
    p = arm.pose.bones[name]; pivot = p.head.copy()
    q = Euler(tuple(math.radians(a) for a in angles),'XYZ').to_quaternion()
    set_matrix(name, Matrix.Translation(pivot) @ q.to_matrix().to_4x4() @ Matrix.Translation(-pivot) @ p.matrix)

def affine(q, center, target):
    m=q.to_matrix().to_4x4(); m.translation=target-q@center; return m

def segment_q(a,b,normal,desired_normal):
    y=a.normalized(); x=(normal-y*normal.dot(y)).normalized(); z=x.cross(y).normalized(); x=y.cross(z)
    old=Matrix((x,y,z)).transposed()
    y=b.normalized(); x=(desired_normal-y*desired_normal.dot(y)).normalized(); z=x.cross(y).normalized(); x=y.cross(z)
    return (Matrix((x,y,z)).transposed()@old.inverted()).to_quaternion()

arms={'R':['spine_21','spine_20','spine_19','spine_18'], 'L':['spine_07','spine_08','spine_09','chest']}
collars={'R':'spine_22','L':'spine_06'}
legs={s:['rearLeg.'+s+'_01','rearLwr.'+s,'rearHorselink.'+s,'rearFoot.'+s,'rearToe.'+s] for s in ['L','R']}
tail=['tail1','tail2','tail3','tail_04','tail4','tail_06','tail_07']
reach_errors=[]
last_poles={}
initial_poles={}

def arm_ik(side, palm, pitch, yaw):
    names=arms[side]; rh=[rest[n].translation for n in names]
    root=arm.pose.bones[names[0]].head.copy()
    hand_q=Euler((math.radians(pitch),0,math.radians(yaw)),'XYZ').to_quaternion()
    wrist=palm-hand_q@(rh[3]-rh[2])
    lengths=[(rh[i+1]-rh[i]).length for i in range(2)]
    # Let the clavicle follow a reaching arm before solving elbow/wrist.
    # Its shoulder stays on its original length sphere; no bone is stretched.
    collar=arm.pose.bones[collars[side]]; center=collar.head.copy()
    clavicle_length=(root-center).length; maximum=sum(lengths)*.995
    v=wrist-center; d=v.length; total=clavicle_length+maximum
    if d>total*.999:wrist=center+v.normalized()*total*.999
    if (wrist-root).length>maximum:
        direction=(wrist-center).normalized();d=(wrist-center).length
        along=(clavicle_length**2-maximum**2+d*d)/(2*d)
        lateral=root-center-direction*(root-center).dot(direction)
        if lateral.length<1e-6:lateral=Vector((-1 if side=='R' else 1,0,0)).cross(direction)
        shoulder=center+direction*along+lateral.normalized()*math.sqrt(max(0,clavicle_length**2-along*along))
        delta=(root-center).rotation_difference(shoulder-center)
        set_matrix(collars[side],affine(delta,center,center)@collar.matrix)
        root=arm.pose.bones[names[0]].head.copy()
    v=wrist-root; distance=v.length; maximum=sum(lengths)*.995
    if distance>maximum: wrist=root+v.normalized()*maximum
    reach_errors.append((palm-(wrist+hand_q@(rh[3]-rh[2]))).length)
    v=wrist-root; d=v.length; direction=v.normalized()
    pole=Vector((-1 if side=='R' else 1,.55,.05))
    if side=='R':
        u=min(1,max(0,(t-sweep_start)/(sweep_end-sweep_start)));u=u*u*(3-2*u)
        recovery=min(1,max(0,(t-recovery_start)/(duration-recovery_start)));recovery=recovery*recovery*(3-2*recovery)
        u*=1-recovery
        pole= pole.lerp(Vector((-.4,.7,1)),u)
    preferred=(pole-direction*pole.dot(direction)).normalized()
    if side in last_poles:
        pole=last_poles[side]-direction*last_poles[side].dot(direction)
        if pole.length<1e-5:pole=preferred.copy()
        pole.normalize()
        if t>recovery_start:
            goal=initial_poles[side]-direction*initial_poles[side].dot(direction);goal.normalize()
            turn=pole.rotation_difference(goal)
            alpha=(1/fps)/max(1/fps,duration-t+1/fps)
            pole=Quaternion((1,0,0,0)).slerp(turn,alpha)@pole
        else:
            if preferred.dot(pole)<0:preferred.negate()
            pole=pole.lerp(preferred,.10).normalized()
    else:pole=preferred
    if t==0:initial_poles[side]=pole.copy()
    last_poles[side]=pole.copy()
    a=(lengths[0]**2-lengths[1]**2+d*d)/(2*d)
    elbow=root+direction*a+pole*math.sqrt(max(0,lengths[0]**2-a*a))
    normal=(rh[1]-rh[0]).cross(rh[2]-rh[1]).normalized()
    desired_normal=(elbow-root).cross(wrist-elbow).normalized()
    for i,(start,end) in enumerate([(root,elbow),(elbow,wrist)]):
        q=segment_q(rh[i+1]-rh[i],end-start,normal,desired_normal)
        set_matrix(names[i],affine(q,rh[i],start)@rest[names[i]])
    hand=affine(hand_q,rh[2],wrist)
    set_matrix(names[2],hand@rest[names[2]])
    set_matrix(names[3],hand@rest[names[3]])

def leg_ik(side, step):
    names=legs[side]; rh=[rest[n].translation for n in names]
    root=arm.pose.bones[names[0]].head.copy()
    sign=1 if side=='L' else -1
    target=Vector((axis+sign*.27,.07 if side=='L' else .23-step,-.7408 if side=='L' else -.7386))
    if side=='R': target.z+=.055*math.sin(math.pi*min(1,max(0,step/.24)))
    p=[root.copy(),Vector((root.x,-.17,-.30)),Vector((root.x,.30,-.39)),target.copy()]
    lengths=[(rh[i+1]-rh[i]).length for i in range(3)]
    for _ in range(80):
        p[-1]=target.copy()
        for i in range(2,-1,-1):p[i]=p[i+1]+(p[i]-p[i+1]).normalized()*lengths[i]
        p[0]=root.copy()
        for i in range(3):p[i+1]=p[i]+(p[i+1]-p[i]).normalized()*lengths[i]
        if (p[-1]-target).length<1e-7:break
    normal=(rh[1]-rh[0]).cross(rh[2]-rh[1]).normalized()
    if normal.x<0:normal.negate()
    for i in range(3):
        q=segment_q(rh[i+1]-rh[i],p[i+1]-p[i],normal,Vector((1,0,0)))
        set_matrix(names[i],affine(q,rh[i],p[i])@rest[names[i]])
    # Keep claws aimed forward, with their original natural toe cant.
    q=Quaternion((0,0,1),-.16 if side=='L' else -.20)
    foot=affine(q,rh[3],p[3]);set_matrix(names[3],foot@rest[names[3]]);set_matrix(names[4],foot@rest[names[4]])

def local(name):
    p=arm.pose.bones[name];q=convert@(p.matrix.to_quaternion()@rest[name].to_quaternion().inverted())@convert.inverted();pos=convert@p.head
    if p.parent:
        pq=convert@(p.parent.matrix.to_quaternion()@rest[p.parent.name].to_quaternion().inverted())@convert.inverted()
        pos=pq.inverted()@(pos-convert@p.parent.head);q=pq.inverted()@q
    return list(pos),[q.x,q.y,q.z,q.w],list(p.scale)

channels={n:{'translation':[],'rotation':[],'scale':[]} for n in rest}
last={}; trace=[]
for t in times:
    scene.frame_set(math.floor(t*24),subframe=(t*24)%1)
    for p in arm.pose.bones:p.rotation_mode='QUATERNION';p.matrix_basis=baseline[p.name]
    update()
    x,y,z,pitch,yaw,roll,rib,head,rx,ry,rz,hp,hy,lx,ly,lz,step=sample(t)
    root=arm.pose.bones['root'];m=root.matrix.copy();m.translation+=Vector((x,y,z));set_matrix('root',m)
    rotate('hips',(0,yaw*.08,0))
    rotate('spine_02',(pitch*.60,0,yaw*.55))
    rotate('spine_03',(pitch*.25,roll*.5,yaw*.25))
    rotate('spine2',(pitch*.15,roll*.5,rib))
    rotate('spine_16',(-head,0,-yaw*.30))
    rotate('spine_26',(max(0,head)*1.2,0,0))
    palm=sweep_palm(t,hp,hy) if sweep_start<=t<=sweep_end else Vector((axis+rx,ry,rz))
    arm_ik('R',palm,hp,hy)
    arm_ik('L',Vector((axis+lx,ly,lz)),0,-5)
    for side in ['L','R']:leg_ik(side,step)
    # Tail opposes the torso twist with a delayed wave through its full length.
    for i,n in enumerate(tail):
        delayed=sample(max(0,t-.025*i));dyaw=delayed[4]
        envelope=math.sin(math.pi*t/duration)**2
        rotate(n,(envelope*(1.4+i*.20),0,-dyaw*(.11+.018*i)*envelope))
    for p in arm.pose.bones:
        q=p.rotation_quaternion.copy()
        if p.name in last:q.make_compatible(last[p.name]);p.rotation_quaternion=q
        last[p.name]=q
        for path in ['location','rotation_quaternion','scale']:p.keyframe_insert(path,frame=t*24,group=p.name)
        for kind,value in zip(['translation','rotation','scale'],local(p.name)):channels[p.name][kind].append(value)
    trace.append({'time':t,'joints':{n:list(arm.pose.bones[n].head) for n in ['hips','spine_16',*arms['R'],*arms['L'],*[n for c in legs.values() for n in c],tail[-1]]}})
for layer in action.layers:
    for strip in layer.strips:
        for bag in strip.channelbags:
            for curve in bag.fcurves:
                for key in curve.keyframe_points:key.interpolation='LINEAR'
walk.use_fake_user=True;action.use_fake_user=True
scene.frame_start=0;scene.frame_end=44;scene.frame_set(0)
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(out/'boss9_attack1.blend'))

def append(values,kind):
    while len(data)%4:data.append(0)
    offset=len(data);flat=[x for row in values for x in row] if isinstance(values[0],list) else values
    data.extend(struct.pack('<%df'%len(flat),*flat));view=len(doc['bufferViews']);doc['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':len(flat)*4})
    a={'bufferView':view,'componentType':5126,'count':len(values),'type':kind}
    if kind=='SCALAR':a.update(min=[min(values)],max=[max(values)])
    index=len(doc['accessors']);doc['accessors'].append(a);return index

time_accessor=append(times,'SCALAR');clip={'name':'Attack1','samplers':[],'channels':[]}
for original_channel in doc['animations'][0]['channels']:
    target=original_channel['target'];name=doc['nodes'][target['node']]['name'];kind=target['path'];values=channels[name][kind]
    output=append(values,'VEC4' if kind=='rotation' else 'VEC3');index=len(clip['samplers'])
    clip['samplers'].append({'input':time_accessor,'output':output,'interpolation':'LINEAR'});clip['channels'].append({'sampler':index,'target':target})
doc['animations'].append(clip);doc['buffers'][0]['byteLength']=len(data)
text=json.dumps(doc,separators=(',',':'),ensure_ascii=False).encode()
while len(text)%4:text+=b' '
while len(data)%4:data.append(0)
binary=struct.pack('<III',0x46546c67,2,28+len(text)+len(data))+struct.pack('<II',len(text),0x4e4f534a)+text+struct.pack('<II',len(data),0x004e4942)+data
(out/'boss9_attack1.glb').write_bytes(binary)
report={'sourceSHA256':hashlib.sha256(raw).hexdigest(),'glbSHA256':hashlib.sha256(binary).hexdigest(),'duration':duration,'fps':fps,'bones':len(rest),'ground':ground,'keys':[list(k) for k in keys],'trace':trace,'maximumArmTargetClamp':max(reach_errors),'sourceBinaryPreserved':data[:len(original_binary)]==original_binary,'clawIndices':claw_ids,'fingerBaseIndices':finger_base_ids,'fingerTipIndices':finger_tip_ids,'fingerAim':{'forwardPitchDegrees':math.degrees(forward_pitch),'forwardYawDegrees':math.degrees(forward_yaw),'targetTipInclinationDegrees':-15},'timing':{'riseStart':rise_start,'sweepStart':sweep_start,'sweepEnd':sweep_end,'riseAndSweepSeconds':sweep_end-rise_start},'curve':'R3 curved claw path retained; raise tips upward then aim forward and slightly down through the sweep and follow-through','reference':'Latest user instruction: forward-facing fingers during the slash, not a downward ground stab','recovery':'Return to starting stance by 1.8 s'}
(out/'build.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print('ATTACK1_PREPARED',duration,'seconds; maximum arm reach adjustment',max(reach_errors),flush=True)
