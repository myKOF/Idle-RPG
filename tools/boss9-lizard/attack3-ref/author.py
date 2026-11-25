"""Author an overlapping right/left cross slash from the user's GIF timing and silhouettes."""
import bpy,sys,json,struct,hashlib,math
from pathlib import Path
import numpy as np
from mathutils import Vector,Quaternion,Euler
sys.dont_write_bytecode=True
sys.path.insert(0,str(Path(__file__).parent))
from rig import Rig,smooth,affine

source,blend,out=map(Path,sys.argv[sys.argv.index('--')+1:][:3])
spec=json.loads(Path(__file__).with_name('spec.json').read_text())
motion=json.loads(Path(__file__).with_name('motion.json').read_text())
duration=spec['duration'];fps=60 if '--draft' in sys.argv else spec['authorFPS']
raw=source.read_bytes();assert hashlib.sha256(raw).hexdigest()==spec['sourceSHA256']
n=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+n]);oldbin=raw[28+n:28+n+doc['buffers'][0]['byteLength']]
assert [a['name'] for a in doc['animations']]==['Walk','Idle','BOSS9_Attack1','BOSS9_Attack2']
bpy.ops.wm.open_mainfile(filepath=str(blend));scene=bpy.context.scene;scene.render.fps=24
rig=Rig();out.mkdir(parents=True,exist_ok=True)
base_p={n:m.translation.copy() for n,m in rig.base.items()}
base_q={n:m.to_quaternion() for n,m in rig.base.items()}
idle_claws={s:Vector(rig.initial_points[h.claws].mean(axis=0)) for s,h in rig.hands.items()}
reference=next(a for a in bpy.data.actions if a.name=='BOSS9_Attack1')
rig.arm.animation_data.action=reference;rig.arm.animation_data.action_slot=reference.slots[0]
scene.frame_set(13,subframe=.44);rig.update()
head='spine_16';approved_head=(rig.arm.pose.bones[head].matrix@rig.rest[head].inverted()).to_quaternion()
face_names=sorted([p.name for p in rig.arm.pose.bones[head].children_recursive],key=lambda n:len(rig.arm.pose.bones[n].parent_recursive))
face_open={n:rig.arm.pose.bones[head].matrix.to_quaternion().inverted()@rig.arm.pose.bones[n].matrix.to_quaternion() for n in face_names}
face_idle={n:base_q[head].inverted()@base_q[n] for n in face_names}
rig.reset()
diagnostic={'maximumTargetError':0}

def spline(keys,u):
    """Monotone cubic values: continuous velocity without intermediate pose holds."""
    if u<=keys[0][0]:return np.array(keys[0][1:],dtype=float)
    if u>=keys[-1][0]:return np.array(keys[-1][1:],dtype=float)
    i=next(i for i in range(len(keys)-1) if keys[i][0]<=u<keys[i+1][0])
    a,b=keys[i],keys[i+1];h=b[0]-a[0];x=(u-a[0])/h
    slopes=[]
    for j in [i,i+1]:
        if j==0 or j==len(keys)-1:m=np.zeros(len(a)-1)
        else:
            left=(np.array(keys[j][1:])-keys[j-1][1:])/(keys[j][0]-keys[j-1][0])
            right=(np.array(keys[j+1][1:])-keys[j][1:])/(keys[j+1][0]-keys[j][0])
            m=np.array([0 if l*r<=0 else 2*l*r/(l+r) for l,r in zip(left,right)])
        slopes.append(m)
    return (2*x**3-3*x*x+1)*np.array(a[1:])+(x**3-2*x*x+x)*h*slopes[0]+(-2*x**3+3*x*x)*np.array(b[1:])+(x**3-x*x)*h*slopes[1]

hand_keys={};rotations={}
for side,h in rig.hands.items():
    hand_keys[side]=[[k[0],*(k[1] if k[1] is not None else idle_claws[side]),k[4]] for k in motion[side]]
    rotations[side]=[(k[0],h.orientation(k[2],k[3]) if k[2] is not None else Quaternion()) for k in motion[side]]

def hand_rotation(side,u):
    keys=rotations[side]
    for (a,qa),(b,qb) in zip(keys,keys[1:]):
        if a<=u<=b:return qa.slerp(qb,smooth(a,b,u))
    return keys[-1][1]

def pose(t):
    u=t/duration;rig.reset();pitch,roll,yaw,lift=spline(motion['body'],u)
    rig.translate('root',(0,0,lift))
    for name,amount in [('hips',.15),('spine_02',.15),('spine_03',.20),('spine2',.20),('spine_05',.30)]:
        rig.rotate(name,(pitch*amount,roll*amount,yaw*amount))
    gate=smooth(0,.10,u)*(1-smooth(.87,1,u));rig.head(-6,gate,approved_head)
    clearance=sum(smooth(a,b,u)*(1-smooth(c,d,u)) for a,b,c,d in [(.23,.28,.36,.41),(.60,.63,.73,.78)])
    if clearance>0:
        neck=rig.arm.pose.bones['spine_17'];skull=rig.arm.pose.bones[head];center=neck.head.copy();offset=skull.head-center;head_q=skull.matrix.to_quaternion()
        lift=offset.rotation_difference(offset+Vector((0,.06,.05))*clearance)
        rig.set(neck.name,affine(lift,center,center)@neck.matrix)
        m=head_q.to_matrix().to_4x4();m.translation=skull.head;rig.set(skull.name,m)
    jaw=gate*(.5+.35*math.sin(math.pi*min(1,u/.74)))
    head_q=rig.arm.pose.bones[head].matrix.to_quaternion()
    for name in face_names:
        m=(head_q@face_idle[name].slerp(face_open[name],jaw)).to_matrix().to_4x4()
        m.translation=rig.arm.pose.bones[name].head;rig.set(name,m)
    for i,name in enumerate(['tail1','tail2','tail3','tail_04','tail4','tail_06','tail_07']):
        lag=max(0,u-i*.015);bp,br,by,_=spline(motion['body'],lag)
        tail_gate=1-smooth(.80,1,u)
        rig.rotate(name,(-bp*.035*tail_gate,-br*.045*tail_gate,-by*.075*tail_gate))
    targets={}
    for side,h in rig.hands.items():
        x,y,z,opening=spline(hand_keys[side],u);target=Vector((x,y,z));q=hand_rotation(side,u)
        upper,lower,wrist=rig.arms[side][1:4]
        d1=base_p[lower]-base_p[upper];d2=base_p[wrist]-base_p[lower]
        # The elbow stays outside the body; the shoulder follows the reach.
        targets[side]=target
        arm_gate=smooth(0,.12,u)*(1-smooth(.84,1,u))
        actual=rig.arm_fk(side,d1,d2,q,float(opening),0,spec['ground']+.0001,target,pole_blend=.72*arm_gate)
        error=(target-actual).length
        if error>diagnostic['maximumTargetError']:diagnostic.update(maximumTargetError=error,time=t,side=side,target=list(target),actual=list(actual))
    for side in ['R','L']:rig.leg_ik(side)
    return targets

action=bpy.data.actions.new(spec['id']);rig.arm.animation_data.action=action
converted=Euler((-math.pi/2,0,0)).to_quaternion()
channels={n:{'translation':[],'rotation':[],'scale':[]} for n in rig.base};trace=[];last={}
def local(name):
    p=rig.arm.pose.bones[name];q=converted@(p.matrix.to_quaternion()@rig.rest[name].to_quaternion().inverted())@converted.inverted();pos=converted@p.head
    if p.parent:
        pq=converted@(p.parent.matrix.to_quaternion()@rig.rest[p.parent.name].to_quaternion().inverted())@converted.inverted();pos=pq.inverted()@(pos-converted@p.parent.head);q=pq.inverted()@q
    return list(pos),[q.x,q.y,q.z,q.w],list(p.scale)

times=[i/fps for i in range(round(duration*fps)+1)]
for index,t in enumerate(times):
    scene.frame_set(math.floor(t*24),subframe=t*24%1);targets=pose(t)
    for p in rig.arm.pose.bones:
        q=p.rotation_quaternion.copy()
        if p.name in last:q.make_compatible(last[p.name]);p.rotation_quaternion=q
        last[p.name]=q
        for kind in ['location','rotation_quaternion','scale']:p.keyframe_insert(kind,frame=t*24,group=p.name)
        for kind,value in zip(['translation','rotation','scale'],local(p.name)):channels[p.name][kind].append(value)
    trace.append({'time':t,'targets':{s:list(v) for s,v in targets.items()}})
    if index%60==0:print('ATTACK3_REF_FRAME',index,'/',len(times),flush=True)
for layer in action.layers:
    for strip in layer.strips:
        for bag in strip.channelbags:
            for curve in bag.fcurves:
                for k in curve.keyframe_points:k.interpolation='LINEAR'
for a in bpy.data.actions:a.use_fake_user=True
scene.frame_start=0;scene.frame_end=round(duration*24);scene.frame_set(0);bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(out/'boss9_attack3.blend'),compress=True)
data=bytearray(oldbin)
def append(values,kind):
    while len(data)%4:data.append(0)
    offset=len(data);flat=[x for v in values for x in v] if isinstance(values[0],list) else values;data.extend(struct.pack('<%df'%len(flat),*flat))
    view=len(doc['bufferViews']);doc['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':len(flat)*4});a={'bufferView':view,'componentType':5126,'count':len(values),'type':kind}
    if kind=='SCALAR':a.update(min=[min(values)],max=[max(values)])
    index=len(doc['accessors']);doc['accessors'].append(a);return index
ta=append(times,'SCALAR');clip={'name':spec['id'],'samplers':[],'channels':[],'extras':{'previewOnly':True,'duration':duration,'strokes':spec['strokes'],'rootMotion':False,'referenceSHA256':spec['referenceSHA256']}}
for c in doc['animations'][2]['channels']:
    target=c['target'];name=doc['nodes'][target['node']]['name'];kind=target['path'];idx=len(clip['samplers']);output=append(channels[name][kind],'VEC4' if kind=='rotation' else 'VEC3')
    clip['samplers'].append({'input':ta,'output':output,'interpolation':'LINEAR'});clip['channels'].append({'sampler':idx,'target':target})
doc['animations'].append(clip);doc['buffers'][0]['byteLength']=len(data);encoded=json.dumps(doc,separators=(',',':'),ensure_ascii=False).encode()
while len(encoded)%4:encoded+=b' '
while len(data)%4:data.append(0)
binary=struct.pack('<III',0x46546c67,2,28+len(encoded)+len(data))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+struct.pack('<II',len(data),0x004e4942)+data
(out/'boss9_attack3.glb').write_bytes(binary)
report={'sourceSHA256':hashlib.sha256(raw).hexdigest(),'glbSHA256':hashlib.sha256(binary).hexdigest(),'sourceBinaryPreserved':data[:len(oldbin)]==oldbin,'spec':spec,'sampleFPS':fps,'maximumArmTargetClamp':rig.max_clamp,'targetDiagnostic':diagnostic,'bones':len(rig.base),'trace':trace,'hands':{s:{'palm':h.palm,'chains':h.chains,'clawIndices':h.claws,'tipGroups':h.tip_groups,'baseGroups':h.base_groups,'padTriangles':h.pad} for s,h in rig.hands.items()}}
(out/'build.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print('ATTACK3_REF_AUTHORED',len(times),'poses; clamp',rig.max_clamp,'target',json.dumps(diagnostic),flush=True)
