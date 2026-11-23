"""Author Attack1 in Blender, appending it without changing the accepted Walk GLB."""
import bpy, sys, json, math, struct, hashlib
import numpy as np
from functools import lru_cache
from pathlib import Path
from mathutils import Vector, Quaternion, Euler, Matrix

source, blend, out = map(Path, sys.argv[sys.argv.index('--') + 1:][:3])
spec=json.loads(Path(__file__).with_name('spec.json').read_text())
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
axis = spec['axisX']
ground = spec['ground']
# Keep the approved 577 poses in their original authoring time coordinates;
# retime the animation data and all shared notifies together at export.
pose_rate=2.4/spec['duration']
duration, fps = 2.4, spec['authorFPS']/pose_rate
timing={n:t*pose_rate for n,t in spec['timing'].items()}
rise_start, sweep_start, sweep_end, recovery_start = (timing[n] for n in ['riseStart','sweepStart','sweepEnd','rightRelease'])
def smooth(a,b,t):
    u=min(1,max(0,(t-a)/(b-a)));return u*u*(3-2*u)
def travel(t):return spec['rootMotion']['distance']*smooth(spec['rootMotion']['start']*pose_rate,spec['rootMotion']['end']*pose_rate,t)
def approved_hand_advance(t):return .35*smooth(.5,1.5,t)
times = [i / fps for i in range(round(duration * fps) + 1)]
action = bpy.data.actions.new(spec['id'])
arm.animation_data.action = action
scene.render.fps = 24

# Time, pelvis x/y/z, lumbar pitch/yaw/roll, rib yaw, head lift,
# right palm x/y/z, hand pitch/yaw, left palm x/y/z, right foot step.
# Coordinates are Blender Z-up; -Y is forward. Anatomical right is -X.
keys = [
 (0.00, 0,0,-.14, 0,0,0,0,0, -.44,-.62,-.436, 0,0, .48,-.62,-.442,0),
 (0.20, 0,0,-.23, -2,0,0,0,9, -.44,-.62,-.436, 0,0, .48,-.62,-.442,0),
 (0.50, 0,0,-.26, -8,-3,3,-2,18, -.44,-.62,-.436, 0,0, .48,-.62,-.442,0),
 (0.74, .05,0,-.21, -3,-17,19,-9,13, -.50,-.50,-.08, -25,-10, .48,-.62,-.442,0),
 (0.94, .08,0,-.25, -10,-26,36,-12,13, -.55,-.39,.43, -60,-20, .48,-.62,-.442,0),
 (1.12, .08,0,-.245, -13,-30,42,-13,13, -.56,-.33,.64, -78,-25, .48,-.62,-.442,0),
 (1.24, -.03,0,-.26, 7,-25,20,-6,-8, -.30,-1.20,.29, -30,4, .48,-.62,-.442,0),
 (1.38, -.02,0,-.285, 20,5,-5,6,-15, .24,-1.32,-.16, 10,35, .48,-.62,-.442,0),
 (1.50, .015,0,-.28, 23,29,-11,12,-12, .46,-1.26,-.35, 20,52, .48,-.62,-.442,0),
 (1.62, .015,0,-.28, 17,23,-6,8,-6, .26,-.90,-.436, 0,0, .48,-.62,-.442,0),
 (1.76, .01,0,-.25, 12,16,-3,5,-3, .26,-.90,-.436, 0,0, .48,-.62,-.27,0),
 (1.88, .005,0,-.22, 7,9,0,3,-1, .26,-.90,-.436, 0,0, .48,-.62,-.442,0),
 (2.06, 0,0,-.18, 3,3,0,1,0, -.15,-.74,-.24, 0,0, .48,-.62,-.442,0),
 (2.24, 0,0,-.14, 0,0,0,0,0, -.44,-.62,-.436, 0,0, .48,-.62,-.442,0),
 (2.40, 0,0,-.14, 0,0,0,0,0, -.44,-.62,-.436, 0,0, .48,-.62,-.442,0),
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
forward_q=Euler((forward_pitch,0,forward_yaw),'XYZ').to_quaternion()
old_raised_q=Euler((math.radians(-78),0,math.radians(-25)),'XYZ').to_quaternion()
digits=[['spine_32','spine_31','spine_30'],['spine_35','spine_34','spine_33'],['spine_38','spine_37','spine_36'],['spine_41','spine_40','spine_39']]
palm_head=rest['spine_18'].translation
palm_forward=(sum((rest[n].translation for n in ['spine_35','spine_38','spine_41']),Vector())/3-palm_head).normalized()
palm_side=(rest['spine_41'].translation-rest['spine_35'].translation).normalized()
volar_hint=palm_side.cross(palm_forward).normalized()
if volar_hint.z>0:volar_hint.negate()
palm_weights={v.index:sum(g.weight for g in v.groups if group_names[g.group]=='spine_18') for v in mesh.data.vertices}
pad_faces=[tuple(f.vertices) for f in mesh.data.polygons if all(palm_weights[i]>.65 for i in f.vertices) and f.normal.dot(volar_hint)>.5]
pad_triangles=[(p[0],p[i],p[i+1]) for p in pad_faces for i in range(1,len(p)-1)]
assert len(pad_triangles)>3,'No palm pad surface found'
pad_normal=Vector()
for a,b,c in pad_triangles:pad_normal+=(mesh.data.vertices[b].co-mesh.data.vertices[a].co).cross(mesh.data.vertices[c].co-mesh.data.vertices[a].co)
pad_normal.normalize()
palm_forward=(palm_forward-pad_normal*palm_forward.dot(pad_normal)).normalized()
palm_side=palm_forward.cross(pad_normal).normalized()
up_normal=Vector((0,-.8,.6)).normalized()
up_forward=Vector((-.35,.56,.75));up_forward=(up_forward-up_normal*up_forward.dot(up_normal)).normalized()
up_side=up_forward.cross(up_normal).normalized()
raised_q=(Matrix((up_side,up_forward,up_normal)).transposed()@Matrix((palm_side,palm_forward,pad_normal)).transposed().inverted()).to_quaternion()
tracked=sorted(set(claw_ids+finger_base_ids+finger_tip_ids))
tracked_positions=np.array([mesh.data.vertices[i].co for i in tracked],dtype=float)
tracked_lookup={i:j for j,i in enumerate(tracked)}
tracked_claw=[tracked_lookup[i] for i in claw_ids];tracked_base=[tracked_lookup[i] for i in finger_base_ids];tracked_tip=[tracked_lookup[i] for i in finger_tip_ids]
tracked_weights={n:np.array([sum(g.weight for g in mesh.data.vertices[i].groups if group_names[g.group]==n) for i in tracked]) for chain in digits for n in chain}
terminal_axes={}
for chain in digits:
    n=chain[-1];points=[v.co for v in mesh.data.vertices if sum(g.weight for g in v.groups if group_names[g.group]==n)>.85]
    assert points
    terminal_axes[n]=(sum(points,Vector())/len(points)-rest[n].translation).normalized()

def opening(t):return smooth(.62,.98,t)*(1-smooth(1.12,1.40,t))

@lru_cache(maxsize=1024)
def hand_shape(amount):
    if amount<1e-9:return {},claw_offset.copy(),finger_axis.copy()
    skins={};points=tracked_positions.copy()
    for chain,spread in zip(digits,[1.25,-.42,0,.42]):
        heads=[rest[n].translation for n in chain]
        aim=(palm_forward+palm_side*spread).normalized()
        d1=(aim+pad_normal*.10).normalized();d2=(aim+pad_normal*.22).normalized()
        goals=[(heads[1]-heads[0]).rotation_difference(aim),(heads[2]-heads[1]).rotation_difference(d1),terminal_axes[chain[-1]].rotation_difference(d2)]
        rotations=[Quaternion().slerp(goals[0],amount)]
        for i in [1,2]:rotations.append(rotations[-1]@Quaternion().slerp(goals[i-1].inverted()@goals[i],amount))
        starts=[heads[0]]
        for i in [0,1]:starts.append(starts[-1]+rotations[i]@(heads[i+1]-heads[i]))
        for n,q,head,start in zip(chain,rotations,heads,starts):
            m=q.to_matrix().to_4x4();m.translation=start-q@head;skins[n]=m
            a=np.array(m,dtype=float);changed=tracked_positions@a[:3,:3].T+a[:3,3]
            points+=tracked_weights[n][:,None]*(changed-tracked_positions)
    offset=Vector(points[tracked_claw].mean(axis=0))-palm_head
    direction=Vector(points[tracked_tip].mean(axis=0)-points[tracked_base].mean(axis=0)).normalized()
    return skins,offset,direction

def arc_claw(t):
    u=min(1,max(0,(t-sweep_start)/(sweep_end-sweep_start)));s=u*u*(3-2*u)
    start=Vector((axis-.56,-.33,.64))+old_raised_q@claw_offset
    end=Vector((axis+.46,-1.26,-.35))+Euler((math.radians(20),0,math.radians(52)),'XYZ').to_quaternion()@claw_offset
    end.z=-.30
    angle=s*math.pi/2
    target=start.copy()
    curve=.45
    target.x+=(end.x-start.x)*((1-curve)*s+curve*(1-math.cos(angle)-.16*math.sin(2*angle)))
    target.z+=(end.z-start.z)*((1-curve)*s+curve*math.sin(angle))
    v=min(1,u*2);v=v*v*(3-2*v)
    target.y=start.y+(end.y-start.y)*v
    return target

def flowing_hand(t):
    # Keep the approved arc's palm banking after the pounce is cancelled.
    # Its former advance supplies an orientation reference, not root motion.
    a=max(sweep_start,t-.0003);b=min(sweep_end,t+.0003)
    pa,pb=arc_claw(a),arc_claw(b);pa.y-=approved_hand_advance(a);pb.y-=approved_hand_advance(b)
    direction=(pb-pa).normalized()
    current_axis=hand_shape(opening(t))[2]
    q=(forward_q@current_axis).rotation_difference(direction)@forward_q
    # Preserve the open, upward palm into the downstroke. Banking develops
    # across the stroke instead of completing in its first few frames.
    return raised_q.slerp(q,smooth(sweep_start,sweep_end-.02,t))

end_hand=flowing_hand(sweep_end)
for i,k in enumerate(keys):
    row=list(k);old_q=Euler((math.radians(row[12]),0,math.radians(row[13])),'XYZ').to_quaternion()
    if 1.24<=row[0]<=1.50:row[12:14]=[math.degrees(forward_pitch),math.degrees(forward_yaw)]
    if row[0]==1.50:
        new_q=end_hand
        # Keep the existing R3 claw arc/recovery positions when turning the
        # wrist, including the hand-off between the sweep and recovery.
        old_claw=Vector((axis+row[9],row[10],row[11]))+old_q@claw_offset
        old_claw.z=-.30
        palm=old_claw-new_q@claw_offset;row[9:12]=[palm.x-axis,palm.y,palm.z]
    keys[i]=tuple(row)

key_array=np.array(keys,dtype=float)
# One C1 curve retains velocity at the interior lift poses.
h=np.diff(key_array[:,0]);secants=np.diff(key_array[:,1:],axis=0)/h[:,None]
slopes=np.zeros_like(key_array[:,1:])
for i in range(1,len(keys)-1):
    a,b=secants[i-1],secants[i];mask=a*b>0;w1,w2=2*h[i]+h[i-1],h[i]+2*h[i-1]
    slopes[i,mask]=(w1+w2)/(w1/a[mask]+w2/b[mask])

def hand_rotation(t,pitch,yaw):
    if sweep_start<=t<=sweep_end:return flowing_hand(t)
    if sweep_end<t<=timing['rightPlant']:
        return end_hand.slerp(Quaternion(),smooth(sweep_end,timing['rightPlant'],t))
    q=Euler((math.radians(pitch),0,math.radians(yaw)),'XYZ').to_quaternion()
    return q.slerp(raised_q,smooth(.74,1.04,t)) if t<sweep_start else q

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

stance_lifts=[]
def raise_support(t,pitch):
    # Measure the former support-arm bend, including its former root advance.
    # Raise the chest and body while the same left palm remains planted.
    gate=smooth(.5,.94,t)*(1-smooth(1.62,2.24,t))
    names=arms['L'];rh=[rest[n].translation for n in names]
    palm=Vector((axis+.48,-.62,-.442))
    q=Euler((0,0,math.radians(-5)),'XYZ').to_quaternion()
    wrist=palm-q@(rh[3]-rh[2])
    before=arm.pose.bones[names[0]].head.copy();before.y-=approved_hand_advance(t)
    a,b=[(rh[i+1]-rh[i]).length for i in range(2)]
    old_bend=math.acos(max(-1,min(1,((wrist-before).length_squared-a*a-b*b)/(2*a*b))))
    for name,share in [('spine_02',.60),('spine_03',.25),('spine2',.15)]:
        rotate(name,(-max(0,pitch)*share*.5*gate,0,0))
    collar=arm.pose.bones['spine_06'];center=collar.head.copy()
    offset=arm.pose.bones[names[0]].head-center
    spread=offset.rotation_difference(offset+Vector((.12,0,-.07))*gate)
    set_matrix('spine_06',affine(spread,center,center)@collar.matrix)
    shoulder=arm.pose.bones[names[0]].head.copy()
    minimum_bend=60-48*smooth(sweep_start,sweep_end,t)
    bend=max(math.radians(minimum_bend),old_bend*.5)
    distance2=a*a+b*b+2*a*b*math.cos(bend)
    horizontal=(shoulder.x-wrist.x)**2+(shoulder.y-wrist.y)**2
    lift=gate*max(0,wrist.z+math.sqrt(max(0,distance2-horizontal))-shoulder.z)
    root=arm.pose.bones['root'];m=root.matrix.copy();m.translation.z+=lift;set_matrix('root',m)
    stance_lifts.append(lift)

def face_enemy(t):
    # Stabilize the head in world space while the chest twists underneath it.
    # The neck takes part of the counter-rotation; the skull completes it.
    weight=smooth(0,.50,t)*(1-smooth(1.62,2.24,t))
    head=arm.pose.bones['spine_16']
    current=(head.matrix@rest['spine_16'].inverted()).to_quaternion()
    nod=math.radians(-6+2*math.sin(math.pi*t/duration))
    yaw=math.radians(1.5*math.sin(2*math.pi*t/duration))
    bank=math.radians(2*math.sin(2*math.pi*t/duration))
    target=Euler((-nod,bank,yaw),'XYZ').to_quaternion()
    desired=current.slerp(target,weight)
    counter=desired@current.inverted()
    neck=arm.pose.bones['spine_17'];pivot=neck.head.copy()
    neck_location=neck.location.copy();head_location=head.location.copy()
    set_matrix('spine_17',affine(Quaternion().slerp(counter,.45),pivot,pivot)@neck.matrix)
    neck.location=neck_location;update()
    # Slightly lift and retract the neck as the approved claw passes the
    # muzzle. Rotate the existing neck link; retain its physical length.
    clearance=smooth(.94,1.24,t)*(1-smooth(1.62,1.88,t))
    offset=head.head-neck.head
    lift=offset.rotation_difference(offset+Vector((0,.08,.12))*clearance)
    set_matrix('spine_17',affine(lift,pivot,pivot)@neck.matrix)
    neck.location=neck_location;update()
    current=(head.matrix@rest['spine_16'].inverted()).to_quaternion()
    pivot=head.head.copy()
    set_matrix('spine_16',affine(desired@current.inverted(),pivot,pivot)@head.matrix)
    head.location=head_location;update()

def pose_fingers(amount):
    if amount<1e-9:return
    skin=arm.pose.bones['spine_18'].matrix@rest['spine_18'].inverted()
    for n,m in hand_shape(amount)[0].items():set_matrix(n,skin@m@rest[n])

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

def arm_ik(side, palm, pitch, yaw, rotation=None):
    names=arms[side]; rh=[rest[n].translation for n in names]
    root=arm.pose.bones[names[0]].head.copy()
    hand_q=rotation if rotation is not None else Euler((math.radians(pitch),0,math.radians(yaw)),'XYZ').to_quaternion()
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
    else:
        support=smooth(.5,.94,t)*(1-smooth(1.62,2.24,t))
        pole=pole.lerp(Vector((1,-.05,1)),support)
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
    target=Vector((axis+sign*.27,.07 if side=='L' else .23,-.7408 if side=='L' else -.7386))
    p=[root.copy(),Vector((root.x,-.17-travel(t),-.30)),Vector((root.x,.30-travel(t),-.39)),target.copy()]
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
    output_t=t/pose_rate
    scene.frame_set(math.floor(output_t*24),subframe=(output_t*24)%1)
    for p in arm.pose.bones:p.rotation_mode='QUATERNION';p.matrix_basis=baseline[p.name]
    update()
    x,y,z,pitch,yaw,roll,rib,head,rx,ry,rz,hp,hy,lx,ly,lz,step=sample(t)
    root=arm.pose.bones['root'];m=root.matrix.copy();m.translation+=Vector((0,-travel(t),z));set_matrix('root',m)
    m=arm.pose.bones['hips'].matrix.copy();m.translation.x+=x;set_matrix('hips',m)
    rotate('hips',(0,yaw*.08,0))
    rotate('spine_02',(pitch*.60,0,yaw*.55))
    rotate('spine_03',(pitch*.25,roll*.5,yaw*.25))
    rotate('spine2',(pitch*.15,roll*.5,rib))
    raise_support(t,pitch)
    rotate('spine_16',(-head,0,-yaw*.30))
    rotate('spine_26',(max(0,head)*1.8,0,0))
    face_enemy(t)
    hand_q=hand_rotation(t,hp,hy)
    amount=opening(t);current_offset=hand_shape(amount)[1]
    palm=arc_claw(t)-hand_q@current_offset if sweep_start<=t<=sweep_end else Vector((axis+rx,ry,rz))
    if t<sweep_start and amount>0:
        previous_q=Euler((math.radians(hp),0,math.radians(hy)),'XYZ').to_quaternion()
        palm+=previous_q@claw_offset-hand_q@current_offset
    palm.y-=travel(t);arm_ik('R',palm,hp,hy,hand_q)
    pose_fingers(amount)
    arm_ik('L',Vector((axis+.48,-.62,-.442)),0,-5)
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
        for path in ['location','rotation_quaternion','scale']:p.keyframe_insert(path,frame=output_t*24,group=p.name)
        for kind,value in zip(['translation','rotation','scale'],local(p.name)):channels[p.name][kind].append(value)
    trace.append({'time':output_t,'joints':{n:list(arm.pose.bones[n].head) for n in ['hips','spine_16',*arms['R'],*arms['L'],*[n for c in legs.values() for n in c],tail[-1]]}})
for layer in action.layers:
    for strip in layer.strips:
        for bag in strip.channelbags:
            for curve in bag.fcurves:
                for key in curve.keyframe_points:key.interpolation='LINEAR'
walk.use_fake_user=True;action.use_fake_user=True
scene.frame_set(0);update()
idle_pose={p.name:p.matrix_basis.copy() for p in arm.pose.bones}
idle=bpy.data.actions.new('Idle');arm.animation_data.action=idle
for p in arm.pose.bones:
    p.matrix_basis=idle_pose[p.name]
    for f in [0,24]:
        for path in ['location','rotation_quaternion','scale']:p.keyframe_insert(path,frame=f,group=p.name)
idle.use_fake_user=True;arm.animation_data.action=action;arm.animation_data.action_slot=action.slots[0]
action['AnimationNotifies']=json.dumps(spec['notifies'])
for event in spec['notifies']:action.pose_markers.new(event['name']).frame=round(event['time']*24)
scene.frame_start=0;scene.frame_end=round(spec['duration']*24);scene.frame_set(0)
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(out/'boss9_attack1.blend'))

def append(values,kind):
    while len(data)%4:data.append(0)
    offset=len(data);flat=[x for row in values for x in row] if isinstance(values[0],list) else values
    data.extend(struct.pack('<%df'%len(flat),*flat));view=len(doc['bufferViews']);doc['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':len(flat)*4})
    a={'bufferView':view,'componentType':5126,'count':len(values),'type':kind}
    if kind=='SCALAR':a.update(min=[min(values)],max=[max(values)])
    index=len(doc['accessors']);doc['accessors'].append(a);return index

time_accessor=append([t/pose_rate for t in times],'SCALAR');clip={'name':spec['id'],'samplers':[],'channels':[],'extras':{'AnimationNotifies':spec['notifies'],'rootMotion':spec['rootMotion'],'phases':spec['phases']}}
for original_channel in doc['animations'][0]['channels']:
    target=original_channel['target'];name=doc['nodes'][target['node']]['name'];kind=target['path'];values=channels[name][kind]
    output=append(values,'VEC4' if kind=='rotation' else 'VEC3');index=len(clip['samplers'])
    clip['samplers'].append({'input':time_accessor,'output':output,'interpolation':'LINEAR'});clip['channels'].append({'sampler':index,'target':target})
idle_clip={'name':'Idle','samplers':[],'channels':[]};idle_time=append([0,1],'SCALAR')
for c in doc['animations'][0]['channels']:
    target=c['target'];name=doc['nodes'][target['node']]['name'];kind=target['path'];v=channels[name][kind][0]
    output=append([v,v],'VEC4' if kind=='rotation' else 'VEC3');i=len(idle_clip['samplers'])
    idle_clip['samplers'].append({'input':idle_time,'output':output,'interpolation':'LINEAR'});idle_clip['channels'].append({'sampler':i,'target':target})
doc['animations'].extend([idle_clip,clip]);doc['buffers'][0]['byteLength']=len(data)
text=json.dumps(doc,separators=(',',':'),ensure_ascii=False).encode()
while len(text)%4:text+=b' '
while len(data)%4:data.append(0)
binary=struct.pack('<III',0x46546c67,2,28+len(text)+len(data))+struct.pack('<II',len(text),0x4e4f534a)+text+struct.pack('<II',len(data),0x004e4942)+data
(out/'boss9_attack1.glb').write_bytes(binary)
tip_groups=[[v.index for v in mesh.data.vertices if sum(g.weight for g in v.groups if group_names[g.group]==n)>.85] for n in ['spine_33','spine_36','spine_39']]
report={'sourceSHA256':hashlib.sha256(raw).hexdigest(),'glbSHA256':hashlib.sha256(binary).hexdigest(),'duration':duration,'fps':fps,'bones':len(rest),'ground':ground,'keys':[list(k) for k in keys],'trace':trace,'maximumArmTargetClamp':max(reach_errors),'sourceBinaryPreserved':data[:len(original_binary)]==original_binary,'clawIndices':claw_ids,'fingerBaseIndices':finger_base_ids,'fingerTipIndices':finger_tip_ids,'fingerTipGroups':tip_groups,'spec':spec,'timing':{'riseStart':rise_start,'sweepStart':sweep_start,'sweepEnd':sweep_end,'riseAndSweepSeconds':sweep_end-rise_start},'reference':'User confirmed whole right-arm/claw arc coupling; palm banks with the arc, no fixed 90-degree yaw','recovery':'Right claw plants in Recovery; return to Idle at original planted stance'}
report['openHand']={'padTriangles':pad_triangles,'padNormalBind':list(pad_normal),'digitChains':digits,'peakTime':sweep_start,'targetNormal':list(up_normal),'allTipGroups':[[v.index for v in mesh.data.vertices if sum(g.weight for g in v.groups if group_names[g.group]==chain[-1])>.85] for chain in digits]}
report['arcCurvature']=.45
report['duration']=spec['duration'];report['fps']=spec['authorFPS']
report['keys']=[[k[0]/pose_rate,*k[1:]] for k in keys]
report['timing']={n:spec['timing'][n] for n in ['riseStart','sweepStart','sweepEnd']}
report['timing']['riseAndSweepSeconds']=spec['timing']['sweepEnd']-spec['timing']['riseStart']
report['openHand']['peakTime']=spec['timing']['sweepStart']
report['headTracking']={'neck':'spine_17','skull':'spine_16','bindForward':[0,-1,0],'bindUp':[0,0,1],'neckShare':.45,'fullFrom':spec['timing']['riseStart'],'fullThrough':spec['timing']['rightPlant']}
report['headTracking']['clearanceDirection']=[0,.08,.12]
report['stance']={'fixedFeet':True,'fixedLeftPalm':True,'bodyPitchRetention':.5,'supportBendRetention':.5,'minimumSupportBendDegrees':12,'raisedSupportBendDegrees':60,'supportElbowPole':[1,-.05,1],'supportCollarDirection':[.12,0,-.07],'maximumBodyLift':max(stance_lifts),'rootAdvance':spec['rootMotion']['distance']}
(out/'build.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print('ATTACK1_PREPARED',spec['duration'],'seconds; maximum arm reach adjustment',max(reach_errors),flush=True)
