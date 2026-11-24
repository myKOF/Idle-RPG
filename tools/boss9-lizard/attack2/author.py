"""Append a simultaneous two-claw Attack2 to the accepted BOSS9 asset."""
import bpy, sys, json, struct, hashlib, math
from pathlib import Path
import numpy as np
from mathutils import Vector, Quaternion, Euler
sys.dont_write_bytecode=True
sys.path.insert(0,str(Path(__file__).parent))
from rig import Rig,smooth

source,blend,out=map(Path,sys.argv[sys.argv.index('--')+1:][:3])
spec=json.loads(Path(__file__).with_name('spec.json').read_text());timing=spec['timing'];duration=spec['duration'];fps=spec['authorFPS']
raw=source.read_bytes();assert hashlib.sha256(raw).hexdigest()=='7cc2450cdf682f287c35c291e843a8bff7315faeeaab4fa8d33e873abfe0f190'
n=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+n]);oldbin=raw[28+n:28+n+doc['buffers'][0]['byteLength']]
assert [a['name'] for a in doc['animations']]==['Walk','Idle','BOSS9_Attack1']
bpy.ops.wm.open_mainfile(filepath=str(blend));scene=bpy.context.scene;rig=Rig();out.mkdir(parents=True,exist_ok=True)
action=bpy.data.actions.new(spec['id']);rig.arm.animation_data.action=action;scene.render.fps=24
axis=spec['axisX'];times=[i/fps for i in range(round(duration*fps)+1)]
converted=Euler((-math.pi/2,0,0)).to_quaternion()
channels={n:{'translation':[],'rotation':[],'scale':[]} for n in rig.base};trace=[];last={}
orientations={};directions={};motion=spec['motion']
for side,h in rig.hands.items():
    sign=-1 if side=='R' else 1
    orientations[side]={'up':h.orientation((0,-.94,.34),(sign*.05,.20,.98)),
                        'down':h.orientation((0,.83,-.55),(0,-.55,-.83))}
    names=rig.arms[side][1:4];r=[rig.base[n].translation for n in names]
    directions[side]=[(r[i+1]-r[i]).normalized() for i in range(2)]

def curve(name,t):return smooth(*motion[name],t)

def aim(base,target,amount):
    return Quaternion().slerp(base.rotation_difference(target),amount)@base

def phase(t):
    if t<timing['slashStart']:return 'Raise'
    if t<timing['slashEnd']:return 'Slash'
    if t<duration:return 'Recovery'
    return 'Idle'

def local(name):
    p=rig.arm.pose.bones[name];rest=rig.rest[name]
    q=converted@(p.matrix.to_quaternion()@rest.to_quaternion().inverted())@converted.inverted();pos=converted@p.head
    if p.parent:
        pq=converted@(p.parent.matrix.to_quaternion()@rig.rest[p.parent.name].to_quaternion().inverted())@converted.inverted()
        pos=pq.inverted()@(pos-converted@p.parent.head);q=pq.inverted()@q
    return list(pos),[q.x,q.y,q.z,q.w],list(p.scale)

def posebody(t):
    rig.reset()
    rise=curve('bodyRise',t);slash=curve('bodyFall',t)
    recover=smooth(timing['slashEnd'],timing['returnEnd'],t)
    envelope=rise*(1-slash)
    # Reference order: chest/head rise, shoulders spread, bent forearms follow.
    root_z=motion['rootLift']*envelope+.025*slash*(1-recover)
    rig.translate('root',(0,0,root_z))
    rig.rotate('hips',(motion['hipsPitch']*envelope,0,0))
    pitch=motion['spinePitch']*envelope+6*slash*(1-recover)
    rig.rotate('spine_02',(pitch*.55,0,0));rig.rotate('spine_03',(pitch*.3,0,0));rig.rotate('spine2',(pitch*.15,0,0))
    head_fall=curve('headFall',t)
    rig.head(motion['headPitch']*curve('headRise',t)*(1-head_fall)-6*head_fall,smooth(.12,.30,t)*(1-recover))
    rig.rotate('spine_26',(motion['jawOpen']*curve('headRise',t)*(1-smooth(1.02,1.25,t)),0,0))
    hand_fall=curve('handFall',t)
    opening=(motion['fingerOpening']*curve('handRise',t)*(1-hand_fall)+.12*hand_fall)*(1-recover)
    return envelope,slash,recover,hand_fall,opening

# Snapshot the raised pose so the release follows the reference's narrow arcs.
# FK supplies the elbow plane; the release solves the two physical arm links.
envelope,*_=posebody(timing['slashStart']);raised_claws={}
for side,h in rig.hands.items():
    sign=-1 if side=='R' else 1;u=Vector(motion['upperDirection']);u.x*=sign;f=Vector(motion['foreDirection']);f.x*=sign
    raised_claws[side]=rig.arm_fk(side,u,f,orientations[side]['up'],motion['fingerOpening'],.7*envelope,spec['ground']+.0001)

for t in times:
    scene.frame_set(math.floor(t*24),subframe=t*24%1)
    envelope,slash,recover,hand_fall,opening=posebody(t)
    for side,h in rig.hands.items():
        sign=-1 if side=='R' else 1;up,down=orientations[side]['up'],orientations[side]['down']
        u=Vector(motion['upperDirection']);u.x*=sign
        f=Vector(motion['foreDirection']);f.x*=sign
        upper=aim(directions[side][0],u,curve('upperRise',t)*(1-curve('upperFall',t)))
        fore=aim(directions[side][1],f,curve('foreRise',t)*(1-curve('foreFall',t)))
        q=Quaternion().slerp(up,curve('handRise',t)).slerp(down,hand_fall).slerp(Quaternion(),recover)
        target=None
        if t>=timing['slashStart']:
            grab=Vector((axis+sign*motion['grabClaw'][0],*motion['grabClaw'][1:]))
            down_progress=curve('foreFall',t)
            target=raised_claws[side].lerp(grab,down_progress)
            target.x+=sign*motion['grabBow']*math.sin(math.pi*down_progress)
            target=target.lerp(h.head+h.shape(0)[1],recover)
        rig.arm_fk(side,upper,fore,q,opening,.7*envelope,spec['ground']+.0001,target)
    for side in ['R','L']:rig.leg_ik(side)
    for i,name in enumerate(['tail1','tail2','tail3','tail_04','tail4','tail_06','tail_07']):
        gate=math.sin(math.pi*t/duration)**2
        rig.rotate(name,(gate*(-2.5*(1-slash)+2*slash)*(1+i*.12),0,gate*1.5*math.sin(2*math.pi*t/duration-i*.35)))
    for p in rig.arm.pose.bones:
        q=p.rotation_quaternion.copy()
        if p.name in last:q.make_compatible(last[p.name]);p.rotation_quaternion=q
        last[p.name]=q
        for kind in ['location','rotation_quaternion','scale']:p.keyframe_insert(kind,frame=t*24,group=p.name)
        for kind,v in zip(['translation','rotation','scale'],local(p.name)):channels[p.name][kind].append(v)
    trace.append({'time':t,'phase':phase(t),'joints':{n:list(rig.arm.pose.bones[n].head) for n in ['hips','spine_05','spine_16',*sum(rig.arms.values(),[]),*sum(rig.legs.values(),[])]}})
for layer in action.layers:
    for strip in layer.strips:
        for bag in strip.channelbags:
            for curve in bag.fcurves:
                for k in curve.keyframe_points:k.interpolation='LINEAR'
for a in bpy.data.actions:a.use_fake_user=True
scene.frame_start=0;scene.frame_end=round(duration*24);scene.frame_set(0)
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(out/'boss9_attack2.blend'))
data=bytearray(oldbin)
def append(values,kind):
    while len(data)%4:data.append(0)
    offset=len(data);flat=[x for v in values for x in v] if isinstance(values[0],list) else values
    data.extend(struct.pack('<%df'%len(flat),*flat));view=len(doc['bufferViews']);doc['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':len(flat)*4})
    a={'bufferView':view,'componentType':5126,'count':len(values),'type':kind}
    if kind=='SCALAR':a.update(min=[min(values)],max=[max(values)])
    index=len(doc['accessors']);doc['accessors'].append(a);return index
time_accessor=append(times,'SCALAR');clip={'name':spec['id'],'samplers':[],'channels':[],'extras':{'previewOnly':True,'duration':duration,'timing':timing,'rootMotion':False}}
for c in doc['animations'][2]['channels']:
    target=c['target'];name=doc['nodes'][target['node']]['name'];kind=target['path'];idx=len(clip['samplers'])
    output=append(channels[name][kind],'VEC4' if kind=='rotation' else 'VEC3')
    clip['samplers'].append({'input':time_accessor,'output':output,'interpolation':'LINEAR'});clip['channels'].append({'sampler':idx,'target':target})
doc['animations'].append(clip);doc['buffers'][0]['byteLength']=len(data)
encoded=json.dumps(doc,separators=(',',':'),ensure_ascii=False).encode()
while len(encoded)%4:encoded+=b' '
while len(data)%4:data.append(0)
binary=struct.pack('<III',0x46546c67,2,28+len(encoded)+len(data))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+struct.pack('<II',len(data),0x004e4942)+data
(out/'boss9_attack2.glb').write_bytes(binary)
report={'sourceSHA256':hashlib.sha256(raw).hexdigest(),'glbSHA256':hashlib.sha256(binary).hexdigest(),'sourceBinaryPreserved':data[:len(oldbin)]==oldbin,'spec':spec,'maximumArmTargetClamp':rig.max_clamp,'bones':len(rig.base),'trace':trace,'hands':{s:{'palm':h.palm,'chains':h.chains,'clawIndices':h.claws,'tipGroups':h.tip_groups,'baseGroups':h.base_groups,'padTriangles':h.pad} for s,h in rig.hands.items()}}
(out/'build.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print('ATTACK2_AUTHORED',duration,'seconds',len(times),'poses; maximum clamp',rig.max_clamp,flush=True)
