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
orientations={}
for side,h in rig.hands.items():
    sign=-1 if side=='R' else 1
    orientations[side]={'up':h.orientation((0,-.65,.76),(sign*.20,.35,.92)),
                        'down':h.orientation((0,.83,-.55),(0,-.55,-.83))}

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

for t in times:
    scene.frame_set(math.floor(t*24),subframe=t*24%1);rig.reset()
    rise=smooth(timing['raiseStart'],timing['raised'],t)
    slash=smooth(timing['slashStart'],timing['slashEnd'],t)
    recover=smooth(timing['slashEnd'],timing['returnEnd'],t)
    envelope=rise*(1-recover)
    # The chest arches back before the legs and spine drive the downward grab.
    root_z=-.045*smooth(0,.10,t)*(1-rise)+.045*rise*(1-slash)-.035*slash*(1-recover)
    rig.translate('root',(0,0,root_z))
    pitch=(-28*rise*(1-slash)+16*slash)*(1-recover)
    rig.rotate('spine_02',(pitch*.55,0,0));rig.rotate('spine_03',(pitch*.3,0,0));rig.rotate('spine2',(pitch*.15,0,0))
    rig.head(10*rise*(1-slash)-6*slash,smooth(0,.20,t)*(1-recover))
    rig.rotate('spine_26',(14*rise*(1-slash)*(1-recover),0,0))
    opening=rise*(1-.75*slash)*(1-recover)
    for side,h in rig.hands.items():
        sign=-1 if side=='R' else 1;up,down=orientations[side]['up'],orientations[side]['down']
        raised=Vector((axis+sign*spec['clawTargets']['raised'][0],*spec['clawTargets']['raised'][1:]))
        lowered=Vector((axis+sign*spec['clawTargets']['lowered'][0],*spec['clawTargets']['lowered'][1:]))
        if t<timing['slashStart']:
            q=Quaternion().slerp(up,rise)
            idle_claw=h.head+h.shape(0)[1]
            claw=idle_claw.lerp(raised,rise)
            # Move out from the torso before going overhead.
            claw.x+=sign*.08*math.sin(math.pi*rise)
            palm=claw-q@h.shape(opening)[1]
        elif t<=timing['slashEnd']:
            q=up.slerp(down,slash)
            claw=raised.lerp(lowered,slash);claw.x+=sign*.035*math.sin(math.pi*slash)
            palm=claw-q@h.shape(opening)[1]
        else:
            q=down.slerp(Quaternion(),recover)
            start=lowered-down@h.shape(.25)[1]
            palm=start.lerp(h.head,recover)+Vector((0,-.08,.12))*math.sin(math.pi*recover)
        rig.arm_ik(side,palm,q,opening,envelope)
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
