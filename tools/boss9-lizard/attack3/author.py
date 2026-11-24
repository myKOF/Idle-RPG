"""Retarget the approved Attack1 into a connected right/left 1.5s combo."""
import bpy,sys,json,struct,hashlib,math
from pathlib import Path
import numpy as np
from mathutils import Vector,Quaternion,Euler,Matrix
sys.dont_write_bytecode=True
sys.path.insert(0,str(Path(__file__).parent))
from rig import Rig,smooth,affine

source,blend,out=map(Path,sys.argv[sys.argv.index('--')+1:][:3])
spec=json.loads(Path(__file__).with_name('spec.json').read_text());duration=spec['duration'];fps=spec['authorFPS']
raw=source.read_bytes();assert hashlib.sha256(raw).hexdigest()==spec['sourceSHA256']
n=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+n]);oldbin=raw[28+n:28+n+doc['buffers'][0]['byteLength']]
assert [a['name'] for a in doc['animations']]==['Walk','Idle','BOSS9_Attack1','BOSS9_Attack2']
bpy.ops.wm.open_mainfile(filepath=str(blend));scene=bpy.context.scene;scene.render.fps=24;rig=Rig();out.mkdir(parents=True,exist_ok=True)
base_q={n:m.to_quaternion() for n,m in rig.base.items()};base_p={n:m.translation.copy() for n,m in rig.base.items()}
idle_claws={s:Vector(rig.initial_points[h.claws].mean(axis=0)) for s,h in rig.hands.items()}
reflect=Matrix.Diagonal((-1,1,1))
def mirrored(q):return (reflect@q.to_matrix()@reflect).to_quaternion()
def reflected(v):return Vector((-v[0],v[1],v[2]))

reference=next(a for a in bpy.data.actions if a.name==spec['referenceClip'])
rig.arm.animation_data.action=reference;rig.arm.animation_data.action_slot=reference.slots[0];cache=[]
cache_path=out/'reference-samples.json';key={'sourceSHA256':spec['sourceSHA256'],'blendSHA256':hashlib.sha256(blend.read_bytes()).hexdigest(),'clip':spec['referenceClip'],'fps':fps,'version':1}
saved=json.loads(cache_path.read_text()) if cache_path.exists() else None
if saved and saved.get('key')==key:
    cache=[{'q':{n:Quaternion(v) for n,v in p['q'].items()},'p':{n:Vector(v) for n,v in p['p'].items()},'c':{n:Vector(v) for n,v in p['c'].items()}} for p in saved['samples']]
else:
    for i in range(round(spec['referenceDuration']*fps)+1):
        t=i/fps;scene.frame_set(math.floor(t*24),subframe=t*24%1);rig.update()
        matrices={p.name:p.matrix.copy() for p in rig.arm.pose.bones}
        cache.append({'q':{n:m.to_quaternion() for n,m in matrices.items()},'p':{n:m.translation.copy() for n,m in matrices.items()},
                      'c':{s:Vector(h.skin(matrices,h.claws).mean(axis=0)) for s,h in rig.hands.items()}})
    cache_path.write_text(json.dumps({'key':key,'samples':[{k:{n:list(v) for n,v in items.items()} for k,items in p.items()} for p in cache]},separators=(',',':'))+'\n',encoding='utf-8')
print('ATTACK3_REFERENCE_READY',len(cache),flush=True)
idle={'q':base_q,'p':base_p,'c':idle_claws}
def sample(t):
    if t<=0 or t>=spec['referenceDuration']:return idle
    f=t*fps;i=min(len(cache)-2,int(f));u=f-i;a,b=cache[i],cache[i+1]
    return {'q':{n:q.slerp(b['q'][n],u) for n,q in a['q'].items()},'p':{n:p.lerp(b['p'][n],u) for n,p in a['p'].items()},'c':{s:p.lerp(b['c'][s],u) for s,p in a['c'].items()}}
def source_time(t,side):
    c=spec['cycles'][side];return max(0,min(spec['referenceDuration'],(t-c['start'])/(c['end']-c['start'])*spec['referenceDuration']))
def delta(p,n):return p['q'][n]@base_q[n].inverted()
def opening(t):return smooth(.31,.49,t)*(1-smooth(.56,.70,t))
align=rig.hands['L'].orientation(reflected(rig.hands['R'].normal),reflected(rig.hands['R'].forward)).inverted()
def finger_shapes(p,side):
    palm=rig.arms['R'][-1];d=delta(p,palm);remove=affine(d,base_p[palm],p['p'][palm]).inverted();shape={}
    for rchain,lchain in zip(rig.digits['R'],rig.digits[side]):
        start=base_p[lchain[0]].copy()
        for i,(rname,name) in enumerate(zip(rchain,lchain)):
            m=p['q'][rname].to_matrix().to_4x4();m.translation=p['p'][rname];m=remove@m
            q=m.to_quaternion()@base_q[rname].inverted()
            if side=='L':q=align@mirrored(q)@align.inverted()
            shape[name]=affine(q,base_p[name],start)@rig.base[name]
            if i<2:start+=q@(base_p[lchain[i+1]]-base_p[name])
    return shape

limbs=set(sum(rig.arms.values(),[])+sum(rig.legs.values(),[]))
for hand in rig.hands.values():limbs.update(hand.names)
head_children=[p.name for p in rig.arm.pose.bones['spine_16'].children_recursive]
head_children.sort(key=lambda n:len(rig.arm.pose.bones[n].parent_recursive))
approved_head=sample(.56)['q']['spine_16']@rig.rest['spine_16'].to_quaternion().inverted()
central=[p.name for p in rig.arm.pose.bones if p.name not in limbs and p.name not in head_children]
central.sort(key=lambda n:len(rig.arm.pose.bones[n].parent_recursive))
def pose(t):
    rig.reset();tr=source_time(t,'R');tl=source_time(t,'L');right,left=sample(tr),sample(tl)
    root_r=right['p']['root']-base_p['root'];root_l=left['p']['root']-base_p['root']
    support=smooth(.25,.50,tl)*(1-smooth(.80,1.2,tl))
    rig.translate('root',root_r+reflected(root_l)+Vector((0,0,-spec['leftSupportDrop']*support)))
    for name in central:
        p=rig.arm.pose.bones[name];position=p.head.copy()
        if name=='hips':position+=(right['p'][name]-base_p[name]-root_r)+reflected(left['p'][name]-base_p[name]-root_l)
        q=delta(right,name)@mirrored(delta(left,name))@base_q[name]
        m=q.to_matrix().to_4x4();m.translation=position;rig.set(name,m)
    # Stabilize the full skull frame, including roll; a forward-axis-only
    # check misses a head tilted sideways around its viewing direction.
    rig.head(-6,smooth(0,.20,t)*(1-smooth(1.24,1.5,t)),approved_head)
    clearance=sum(smooth(a,b,t)*(1-smooth(c,d,t)) for a,b,c,d in [(.50,.62,.76,.90),(1.12,1.24,1.38,1.50)])
    if clearance>0:
        neck=rig.arm.pose.bones['spine_17'];skull=rig.arm.pose.bones['spine_16'];center=neck.head.copy();offset=skull.head-center;head_q=skull.matrix.to_quaternion()
        lift=offset.rotation_difference(offset+Vector((0,.025,.035))*clearance)
        rig.set(neck.name,affine(lift,center,center)@neck.matrix)
        m=head_q.to_matrix().to_4x4();m.translation=skull.head;rig.set(skull.name,m)
    # Facial/crest bones use the same approved local head pose on both
    # attacks. Mirroring their asymmetric rest axes twists the visible face.
    face=right if t<spec['cycles']['L']['start'] else left
    head_world=rig.arm.pose.bones['spine_16'].matrix.to_quaternion()
    for name in head_children:
        q=head_world@face['q']['spine_16'].inverted()@face['q'][name]
        m=q.to_matrix().to_4x4();m.translation=rig.arm.pose.bones[name].head;rig.set(name,m)
    targets={}
    for side in ['R','L']:
        own=rig.arms[side];other=rig.arms['L' if side=='R' else 'R'];h=rig.hands[side]
        for i in [0]:
            name=own[i];q=delta(right,name)@mirrored(delta(left,other[i]))@base_q[name]
            m=q.to_matrix().to_4x4();m.translation=rig.arm.pose.bones[name].head;rig.set(name,m)
        directions=[]
        for i in [1,2]:
            q=delta(right,own[i])@mirrored(delta(left,other[i]))
            directions.append(q@(base_p[own[i+1]]-base_p[own[i]]).normalized())
        hand_r=delta(right,own[-1]);hand_l=mirrored(delta(left,other[-1]))
        if side=='L':
            # Correct the asymmetric rest palms while preserving exact Idle.
            source_hand=rig.hands['R'];d=delta(left,other[-1])
            match=h.orientation(reflected(d@source_hand.normal),reflected(d@source_hand.forward))
            gate=smooth(.25,.50,tl)*(1-smooth(.80,1.2,tl));hand_l=hand_l.slerp(match,gate)
        q=hand_r@hand_l
        target=idle_claws[side]+right['c'][side]-idle_claws[side]+reflected(left['c']['L' if side=='R' else 'R']-idle_claws['L' if side=='R' else 'R'])
        targets[side]=target
        shape=finger_shapes(right,'R') if side=='R' else h.shape(opening(tl))[0]
        rig.arm_fk(side,*directions,q,opening(tr if side=='R' else tl),0,spec['ground']+.0001,target,shape_matrices=shape)
    for side in ['R','L']:rig.leg_ik(side)
    return tr,tl,targets

action=bpy.data.actions.new(spec['id']);rig.arm.animation_data.action=action
if '--probe' in sys.argv:
    from mathutils.bvhtree import BVHTree
    groups=rig.groups
    descendants={n:{bone,*[b.name for b in rig.arm.pose.bones[bone].children_recursive]} for n,bone in [('handR','spine_18'),('handL','chest'),('footR','rearFoot.R'),('footL','rearFoot.L'),('skull','spine_16')]}
    regions={n:{v.index for v in rig.mesh.data.vertices if sum(g.weight for g in v.groups if groups[g.group] in names)>.9} for n,names in descendants.items()}
    faces={n:[tuple(f.vertices) for f in rig.mesh.data.polygons if set(f.vertices).issubset(ids)] for n,ids in regions.items()}
    previous=None;previous_t=None;maximum=0;hits={};links={};floors=1;error=0;worst={};body_error={}
    probe_times=[float(v) for v in sys.argv[sys.argv.index('--probe-times')+1].split(',')] if '--probe-times' in sys.argv else [i*.01 for i in range(151)]
    for t in probe_times:
        _,_,targets=pose(t);joints=np.array([p.head for p in rig.arm.pose.bones])
        if previous is not None:maximum=max(maximum,float(np.linalg.norm(joints-previous,axis=1).max())/(t-previous_t))
        previous=joints
        previous_t=t
        e=rig.mesh.evaluated_get(bpy.context.evaluated_depsgraph_get());me=e.to_mesh();points=[v.co.copy() for v in me.vertices];e.to_mesh_clear()
        trees={n:BVHTree.FromPolygons(points,polys,all_triangles=False) for n,polys in faces.items()}
        for a,b in [('handR','handL'),('handR','skull'),('handL','skull'),('handR','footR'),('handR','footL'),('handL','footR'),('handL','footL'),('footR','footL')]:
            count=len(trees[a].overlap(trees[b]))
            if count:hits.setdefault(a+'_'+b,[]).append([t,count])
        for s,h in rig.hands.items():
            actual=Vector(np.array([points[j] for j in h.claws]).mean(axis=0));err=(actual-targets[s]).length
            if err>error:error=err;worst={'time':t,'side':s}
        if t<.62:
            ref=sample(source_time(t,'R'))
            for n in central:body_error[n]=max(body_error.get(n,0),(rig.arm.pose.bones[n].head-ref['p'][n]).length)
        floors=min(floors,min(points[j].z for ids in regions.values() for j in ids))
        for p in rig.arm.pose.bones:
            if p.parent:
                base=(base_p[p.name]-base_p[p.parent.name]).length;d=abs((p.head-p.parent.head).length-base)
                if d>1e-5:links[p.name]=max(links.get(p.name,0),d)
    print('ATTACK3_PROBE',json.dumps({'jointSpeed':maximum,'clawTargetError':error,'worstTarget':worst,'bodyPositionError':body_error,'clamp':rig.max_clamp,'floor':floors,'variableLinks':links,'overlaps':hits}),flush=True)
    sys.exit(0)

converted=Euler((-math.pi/2,0,0)).to_quaternion();channels={n:{'translation':[],'rotation':[],'scale':[]} for n in rig.base};trace=[];last={}
def local(name):
    p=rig.arm.pose.bones[name];q=converted@(p.matrix.to_quaternion()@rig.rest[name].to_quaternion().inverted())@converted.inverted();pos=converted@p.head
    if p.parent:
        pq=converted@(p.parent.matrix.to_quaternion()@rig.rest[p.parent.name].to_quaternion().inverted())@converted.inverted();pos=pq.inverted()@(pos-converted@p.parent.head);q=pq.inverted()@q
    return list(pos),[q.x,q.y,q.z,q.w],list(p.scale)
times=[i/fps for i in range(round(duration*fps)+1)]
for t in times:
    scene.frame_set(math.floor(t*24),subframe=t*24%1);tr,tl,targets=pose(t)
    for p in rig.arm.pose.bones:
        q=p.rotation_quaternion.copy()
        if p.name in last:q.make_compatible(last[p.name]);p.rotation_quaternion=q
        last[p.name]=q
        for kind in ['location','rotation_quaternion','scale']:p.keyframe_insert(kind,frame=t*24,group=p.name)
        for kind,value in zip(['translation','rotation','scale'],local(p.name)):channels[p.name][kind].append(value)
    trace.append({'time':t,'sourceTimes':{'R':tr,'L':tl},'targets':{s:list(v) for s,v in targets.items()},'joints':{n:list(rig.arm.pose.bones[n].head) for n in ['hips','spine_05','spine_16',*sum(rig.arms.values(),[]),*sum(rig.legs.values(),[])]}})
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
ta=append(times,'SCALAR');clip={'name':spec['id'],'samplers':[],'channels':[],'extras':{'previewOnly':True,'duration':duration,'strokes':spec['strokes'],'rootMotion':False}}
for c in doc['animations'][2]['channels']:
    target=c['target'];name=doc['nodes'][target['node']]['name'];kind=target['path'];idx=len(clip['samplers']);output=append(channels[name][kind],'VEC4' if kind=='rotation' else 'VEC3')
    clip['samplers'].append({'input':ta,'output':output,'interpolation':'LINEAR'});clip['channels'].append({'sampler':idx,'target':target})
doc['animations'].append(clip);doc['buffers'][0]['byteLength']=len(data);encoded=json.dumps(doc,separators=(',',':'),ensure_ascii=False).encode()
while len(encoded)%4:encoded+=b' '
while len(data)%4:data.append(0)
binary=struct.pack('<III',0x46546c67,2,28+len(encoded)+len(data))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+struct.pack('<II',len(data),0x004e4942)+data
(out/'boss9_attack3.glb').write_bytes(binary)
report={'sourceSHA256':hashlib.sha256(raw).hexdigest(),'glbSHA256':hashlib.sha256(binary).hexdigest(),'sourceBinaryPreserved':data[:len(oldbin)]==oldbin,'spec':spec,'maximumArmTargetClamp':rig.max_clamp,'bones':len(rig.base),'trace':trace,'hands':{s:{'palm':h.palm,'chains':h.chains,'clawIndices':h.claws,'tipGroups':h.tip_groups,'baseGroups':h.base_groups,'padTriangles':h.pad} for s,h in rig.hands.items()}}
(out/'build.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print('ATTACK3_AUTHORED',len(times),'poses; clamp',rig.max_clamp,flush=True)
