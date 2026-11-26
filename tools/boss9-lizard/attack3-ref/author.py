"""Retarget accepted Attack1 strokes and author overlapping airborne recovery."""
import bpy,sys,json,struct,hashlib,math
from pathlib import Path
import numpy as np
from mathutils import Vector,Quaternion,Euler,Matrix
sys.dont_write_bytecode=True
sys.path.insert(0,str(Path(__file__).parent))
from rig import Rig,smooth,affine

source,blend,out=map(Path,sys.argv[sys.argv.index('--')+1:][:3])
spec=json.loads(Path(__file__).with_name('spec.json').read_text());duration=spec['duration'];fps=60 if '--draft' in sys.argv else spec['authorFPS'];reference_fps=spec['sourceFPS']
retarget=json.loads(Path(__file__).with_name('retarget.json').read_text())
recovery=json.loads(Path(__file__).with_name('recovery.json').read_text())
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
cache_path=out/'reference-samples.json';key={'sourceSHA256':spec['sourceSHA256'],'blendSHA256':hashlib.sha256(blend.read_bytes()).hexdigest(),'clip':spec['referenceClip'],'fps':reference_fps,'version':1}
saved=json.loads(cache_path.read_text()) if cache_path.exists() else None
if saved and saved.get('key')==key:
    cache=[{'q':{n:Quaternion(v) for n,v in p['q'].items()},'p':{n:Vector(v) for n,v in p['p'].items()},'c':{n:Vector(v) for n,v in p['c'].items()}} for p in saved['samples']]
else:
    for i in range(round(spec['sourceClipDuration']*reference_fps)+1):
        t=i/reference_fps;scene.frame_set(math.floor(t*24),subframe=t*24%1);rig.update()
        matrices={p.name:p.matrix.copy() for p in rig.arm.pose.bones}
        cache.append({'q':{n:m.to_quaternion() for n,m in matrices.items()},'p':{n:m.translation.copy() for n,m in matrices.items()},
                      'c':{s:Vector(h.skin(matrices,h.claws).mean(axis=0)) for s,h in rig.hands.items()}})
    cache_path.write_text(json.dumps({'key':key,'samples':[{k:{n:list(v) for n,v in items.items()} for k,items in p.items()} for p in cache]},separators=(',',':'))+'\n',encoding='utf-8')
print('ATTACK3_REFERENCE_READY',len(cache),flush=True)
idle={'q':base_q,'p':base_p,'c':idle_claws}
def sample(t):
    if t<=0 or t>=spec['sourceClipDuration']:return idle
    f=t*reference_fps;i=min(len(cache)-2,int(f));u=f-i;a,b=cache[i],cache[i+1]
    return {'q':{n:q.slerp(b['q'][n],u) for n,q in a['q'].items()},'p':{n:p.lerp(b['p'][n],u) for n,p in a['p'].items()},'c':{s:p.lerp(b['c'][s],u) for s,p in a['c'].items()}}
def source_time(t,side):
    keys=retarget['sourceTimes'][side]
    if t<=keys[0][0]:return keys[0][1]
    if t>=keys[-1][0]:return keys[-1][1]
    i=next(i for i in range(len(keys)-1) if keys[i][0]<=t<keys[i+1][0]);a,b=keys[i],keys[i+1];h=b[0]-a[0];u=(t-a[0])/h
    slopes=[]
    for j in [i,i+1]:
        if j==0 or j==len(keys)-1:m=0
        else:
            l=(keys[j][1]-keys[j-1][1])/(keys[j][0]-keys[j-1][0]);r=(keys[j+1][1]-keys[j][1])/(keys[j+1][0]-keys[j][0])
            m=0 if l*r<=0 else 2*l*r/(l+r)
        slopes.append(m)
    return (2*u**3-3*u*u+1)*a[1]+(u**3-2*u*u+u)*h*slopes[0]+(-2*u**3+3*u*u)*b[1]+(u**3-u*u)*h*slopes[1]

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
pad_data={}
for side,h in rig.hands.items():
    indices=sorted({i for tri in h.pad for i in tri});lookup={v:i for i,v in enumerate(indices)};influences=[]
    for name,weights in rig.weights.items():
        w=weights[indices]
        if not np.any(w>1e-8):continue
        inverse=np.array(rig.rest[name].inverted());local=rig.points[indices]@inverse[:3,:3].T+inverse[:3,3]
        influences.append((name,w,local))
    pad_data[side]=(np.array([[lookup[i] for i in tri] for tri in h.pad]),influences,len(indices))
def pad_normal(side,source_pose=None):
    triangles,influences,count=pad_data[side];points=np.zeros((count,3))
    for name,w,local in influences:
        if source_pose is None:m=rig.arm.pose.bones[name].matrix;rotation=np.array(m.to_3x3());position=np.array(m.translation)
        else:rotation=np.array(source_pose['q'][name].to_matrix());position=np.array(source_pose['p'][name])
        points+=w[:,None]*(local@rotation.T+position)
    p=points[triangles];n=np.cross(p[:,1]-p[:,0],p[:,2]-p[:,0]).sum(axis=0)
    return Vector(n).normalized()

def retarget_fingers(p,amount,palm_rotation,carry=None,side='L'):
    result={};remove=palm_rotation.inverted()
    for source_chain,target_chain in zip(rig.digits['R'],rig.digits[side]):
        start=base_p[target_chain[0]].copy()
        for i,(source_name,name) in enumerate(zip(source_chain,target_chain)):
            if i<2:
                source_direction=p['p'][source_chain[i+1]]-p['p'][source_name]
                base_direction=base_p[target_chain[i+1]]-base_p[name]
            else:
                source_direction=delta(p,source_name)@rig.hands['R'].terminal[source_name]
                base_direction=rig.hands[side].terminal[name]
            desired=reflected(source_direction) if side=='L' else source_direction
            if carry is not None:desired=carry@desired
            desired=remove@desired;desired.normalize()
            q=Quaternion().slerp(base_direction.rotation_difference(desired),amount)
            result[name]=affine(q,base_p[name],start)@rig.base[name]
            if i<2:start+=q@base_direction
    return result

def curve(keys,t):
    if t<=keys[0][0]:return Vector(keys[0][1])
    if t>=keys[-1][0]:return Vector(keys[-1][1])
    i=next(i for i in range(len(keys)-1) if keys[i][0]<=t<keys[i+1][0]);a,b=keys[i],keys[i+1];h=b[0]-a[0];u=(t-a[0])/h;slopes=[]
    for j in [i,i+1]:
        if j==0 or j==len(keys)-1:m=np.zeros(3)
        else:
            l=(np.array(keys[j][1])-keys[j-1][1])/(keys[j][0]-keys[j-1][0]);r=(np.array(keys[j+1][1])-keys[j][1])/(keys[j+1][0]-keys[j][0])
            m=np.array([0 if x*y<=0 else 2*x*y/(x+y) for x,y in zip(l,r)])
        slopes.append(m)
    return Vector((2*u**3-3*u*u+1)*np.array(a[1])+(u**3-2*u*u+u)*h*slopes[0]+(-2*u**3+3*u*u)*np.array(b[1])+(u**3-u*u)*h*slopes[1])

recovery_keys={};end_rotations={}
for side in ['R','L']:
    end=sample(.75);start=end['c']['R'] if side=='R' else idle_claws['L']+reflected(end['c']['R']-idle_claws['R'])
    recovery_keys[side]=[[t,(list(start) if i==0 else list(idle_claws[side])) if p is None else p] for i,(t,p) in enumerate(recovery[side]['keys'])]
    d=delta(end,rig.arms['R'][-1]);end_rotations[side]=d if side=='R' else rig.hands['L'].orientation(reflected(d@rig.hands['R'].normal),reflected(d@rig.hands['R'].forward))

def recovery_rotation(side,t):
    h=rig.hands[side];back=recovery[side]['backTime'];end=spec['strokes'][side]['end'];sign=-1 if side=='R' else 1
    backward=h.orientation((-sign*.65,-.05,-.75),(sign*.75,.30,-.65))
    if t<=back:return end_rotations[side].slerp(backward,smooth(end,back,t))
    return backward.slerp(Quaternion(),smooth(back,duration,t))

def lean(t):
    weights={s:smooth(w['start']-.03,w['end'],t)*(1-smooth(w['end'],recovery[s]['backTime'],t)) for s,w in spec['strokes'].items()}
    d=weights['R']-weights['L'];a=recovery['bodyLeanDegrees']
    return (a['pitch']*max(weights.values()),a['roll']*d,a['yaw']*d)

return_keys={}
def couple_forearm(side,t):
    weight=smooth(spec['strokes'][side]['end'],recovery[side]['collectTime'],t)
    if weight<=0:return
    own=rig.arms[side];lower,wrist,palm=own[2:];p=rig.arm.pose.bones[lower]
    saved={n:rig.arm.pose.bones[n].matrix.copy() for n in [wrist,*rig.hands[side].names]}
    axis=rig.arm.pose.bones[wrist].head-p.head;rest_axis=base_p[wrist]-base_p[lower]
    hand_delta=rig.arm.pose.bones[palm].matrix.to_quaternion()@base_q[palm].inverted()
    aligned=(hand_delta@rest_axis).rotation_difference(axis)@hand_delta
    current=p.matrix.to_quaternion()@base_q[lower].inverted()
    rig.set(lower,affine(current.slerp(aligned,weight),base_p[lower],p.head)@rig.base[lower])
    for n in sorted(saved,key=lambda n:len(rig.arm.pose.bones[n].parent_recursive)):rig.set(n,saved[n])

def return_floor(side):
    h=rig.hands[side];upper=rig.arms[side][1]
    for _ in range(3):
        points=h.skin({n:rig.arm.pose.bones[n].matrix for n in h.names},h.claws)
        lowest=points[points[:,2].argmin()];lift=spec['ground']-.001-lowest[2]
        if lift<=0:return
        p=rig.arm.pose.bones[upper];center=p.head.copy();v=Vector(lowest)-center;z=v.z+lift
        goal=Vector((v.x,v.y,0)).normalized()*math.sqrt(max(0,v.length_squared-z*z));goal.z=z
        rig.set(upper,affine(v.rotation_difference(goal),center,center)@p.matrix)

def pose(t):
    rig.reset();tr=source_time(t,'R');tl=source_time(t,'L');right,left=sample(tr),sample(tl)
    handoff=smooth(*retarget['bodyHandoff'],t)
    root_r=right['p']['root']-base_p['root'];root_l=left['p']['root']-base_p['root']
    support=smooth(.05,.25,tl)*(1-smooth(.80,1.2,tl))*smooth(.55,.68,t)
    root_delta=root_r.lerp(reflected(root_l),handoff)+Vector((0,0,-spec['leftSupportDrop']*support))
    rig.translate('root',root_delta)
    for name in central:
        p=rig.arm.pose.bones[name];position=p.head.copy()
        if name=='hips':position+=(right['p'][name]-base_p[name]-root_r).lerp(reflected(left['p'][name]-base_p[name]-root_l),handoff)
        q=delta(right,name).slerp(mirrored(delta(left,name)),handoff)@base_q[name]
        m=q.to_matrix().to_4x4();m.translation=position;rig.set(name,m)
    extra=lean(t)
    for name,weight in [('hips',.4),('spine_02',.25),('spine_03',.15),('spine2',.1),('spine_05',.1)]:rig.rotate(name,tuple(v*weight for v in extra))
    rig.rotate('tail1',tuple(-.15*v for v in lean(max(0,t-.04))))
    rig.head(-6,smooth(0,.20,t)*(1-smooth(1.24,1.5,t)),approved_head)
    clearance=sum(smooth(a,b,t)*(1-smooth(c,d,t)) for a,b,c,d in [(.47,.56,.68,.80),(recovery['L']['collectTime']-.10,recovery['L']['collectTime'],recovery['L']['backTime'],recovery['L']['backTime']+.14)])
    if clearance>0:
        neck=rig.arm.pose.bones['spine_17'];skull=rig.arm.pose.bones['spine_16'];center=neck.head.copy();offset=skull.head-center;head_q=skull.matrix.to_quaternion()
        lift=offset.rotation_difference(offset+Vector((0,.025,.035))*clearance)
        rig.set(neck.name,affine(lift,center,center)@neck.matrix)
        m=head_q.to_matrix().to_4x4();m.translation=skull.head;rig.set(skull.name,m)
    head_world=rig.arm.pose.bones['spine_16'].matrix.to_quaternion()
    for name in head_children:
        qr=right['q']['spine_16'].inverted()@right['q'][name];ql=left['q']['spine_16'].inverted()@left['q'][name]
        m=(head_world@qr.slerp(ql,handoff)).to_matrix().to_4x4();m.translation=rig.arm.pose.bones[name].head;rig.set(name,m)
    targets={}
    for side in ['R','L']:
        own=rig.arms[side];other=rig.arms['L' if side=='R' else 'R'];h=rig.hands[side]
        if side in return_keys and t>recovery[side]['backTime']:
            progress=smooth(recovery[side]['backTime'],duration,t)
            for name,key in return_keys[side].items():
                start_q=key.to_quaternion();end=rig.baseline[name]
                m=start_q.slerp(end.to_quaternion(),progress).to_matrix().to_4x4()
                m.translation=key.translation.lerp(end.translation,progress)
                rig.arm.pose.bones[name].matrix_basis=m
            rig.update();couple_forearm(side,t);return_floor(side)
            matrices={n:rig.arm.pose.bones[n].matrix for n in h.names}
            targets[side]=Vector(h.skin(matrices,h.claws).mean(axis=0))
            continue
        rw=1 if side=='R' else 1-handoff;lw=handoff if side=='R' else 1
        def combined(name,other_name):return Quaternion().slerp(delta(right,name),rw)@Quaternion().slerp(mirrored(delta(left,other_name)),lw)
        name=own[0];q=combined(name,other[0])@base_q[name]
        m=q.to_matrix().to_4x4();m.translation=rig.arm.pose.bones[name].head;rig.set(name,m)
        directions=[combined(own[i],other[i])@(base_p[own[i+1]]-base_p[own[i]]).normalized() for i in [1,2]]
        hand_r=Quaternion().slerp(delta(right,own[-1]),rw);hand_l=Quaternion().slerp(mirrored(delta(left,other[-1])),lw)
        gate=smooth(.30,.50,tl)*(1-smooth(.80,1.05,tl))
        if side=='L':
            d=delta(left,other[-1]);source_hand=rig.hands['R']
            match=h.orientation(reflected(d@source_hand.normal),reflected(d@source_hand.forward));hand_l=Quaternion().slerp(match,gate)
        q=hand_r@hand_l;template_q=q.copy();carry=Quaternion()
        target=idle_claws[side]+(right['c'][side]-idle_claws[side])*rw+reflected(left['c']['L' if side=='R' else 'R']-idle_claws['L' if side=='R' else 'R'])*lw
        if side=='L':
            # The earlier lift passes the head while the torso is still
            # handing off. Clear the crest, then rejoin the accepted peak.
            target.x+=.08*smooth(.43,.49,t)*(1-smooth(.57,spec['strokes']['L']['start'],t))
        if t>spec['strokes'][side]['end']:
            target=curve(recovery_keys[side],t);q=recovery_rotation(side,t);carry=q@template_q.inverted()
            envelope=smooth(spec['strokes'][side]['end'],recovery[side]['collectTime'],t)*(1-smooth(recovery[side]['backTime'],duration,t))
            # Keep the elbow below the shoulder; extend the claw out/down
            # with the forearm instead of leaving an upturned elbow and hook.
            directions[0]=directions[0].lerp(Vector((-1 if side=='R' else 1,.15,-.2)).normalized(),envelope).normalized()
        targets[side]=target
        shape=finger_shapes(right,'R') if side=='R' else retarget_fingers(left,gate,q,carry)
        lift_pole=smooth(.43,.49,t)*(1-smooth(.60,.72,t)) if side=='L' else 0
        rig.arm_fk(side,*directions,q,opening(tr if side=='R' else tl),0,spec['ground']+.0001,target,pole_blend=lift_pole,shape_matrices=shape)
        if side=='L' and gate>0:
            expected=carry@reflected(pad_normal('R',left))
            for _ in range(5):
                current=pad_normal('L');correction=Quaternion().slerp(current.rotation_difference(expected),gate)
                q=correction@q;shape=retarget_fingers(left,gate,q,carry)
                rig.arm_fk(side,*directions,q,opening(tl),0,spec['ground']+.0001,target,pole_blend=lift_pole,shape_matrices=shape)
        if side=='R':
            correction_weight=smooth(.25,.35,t)*(1-smooth(.55,.70,t))
            if correction_weight>0:
                expected=carry@pad_normal('R',right)
                for _ in range(5):
                    correction=Quaternion().slerp(pad_normal('R').rotation_difference(expected),correction_weight)
                    q=correction@q;shape=retarget_fingers(right,1,q,carry,'R')
                    rig.arm_fk(side,*directions,q,opening(tr),0,spec['ground']+.0001,target,shape_matrices=shape)
        couple_forearm(side,t)
    for side in ['R','L']:rig.leg_ik(side)
    return tr,tl,targets

action=bpy.data.actions.new(spec['id']);rig.arm.animation_data.action=action
for side in ['R','L']:
    pose(recovery[side]['backTime'])
    names=set(rig.arms[side])|rig.hands[side].names
    names=sorted(names,key=lambda n:len(rig.arm.pose.bones[n].parent_recursive))
    return_keys[side]={n:rig.arm.pose.bones[n].matrix_basis.copy() for n in names}
    shift=max((m.translation-rig.baseline[n].translation).length for n,m in return_keys[side].items())
    print('ATTACK3_RETURN_KEY',side,'local translation residual',shift,flush=True)
if '--probe' in sys.argv:
    from mathutils.bvhtree import BVHTree
    groups=rig.groups
    descendants={n:{bone,*[b.name for b in rig.arm.pose.bones[bone].children_recursive]} for n,bone in [('handR','spine_18'),('handL','chest'),('footR','rearFoot.R'),('footL','rearFoot.L'),('skull','spine_16')]}
    regions={n:{v.index for v in rig.mesh.data.vertices if sum(g.weight for g in v.groups if groups[g.group] in names)>.9} for n,names in descendants.items()}
    faces={n:[tuple(f.vertices) for f in rig.mesh.data.polygons if set(f.vertices).issubset(ids)] for n,ids in regions.items()}
    previous=None;previous_t=None;maximum=0;hits={};links={};floors=1;error=0;worst={};body_error={};palm_error=0;source_surface_error=0
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
        if t<=spec['strokes']['R']['end']:
            ref=sample(source_time(t,'R'));h=rig.hands['R']
            palm_error=max(palm_error,math.degrees(pad_normal('R').angle(pad_normal('R',ref))))
            matrices={n:q.to_matrix().to_4x4() for n,q in ref['q'].items()}
            for n,m in matrices.items():m.translation=ref['p'][n]
            expected=h.skin(matrices,h.claws)
            source_surface_error=max(source_surface_error,float(np.linalg.norm(np.array([points[i] for i in h.claws])-expected,axis=1).max()))
        if t<.62:
            ref=sample(source_time(t,'R'))
            for n in central:body_error[n]=max(body_error.get(n,0),(rig.arm.pose.bones[n].head-ref['p'][n]).length)
        floors=min(floors,min(points[j].z for ids in regions.values() for j in ids))
        for p in rig.arm.pose.bones:
            if p.parent:
                base=(base_p[p.name]-base_p[p.parent.name]).length;d=abs((p.head-p.parent.head).length-base)
                if d>1e-5:links[p.name]=max(links.get(p.name,0),d)
    print('ATTACK3_PROBE',json.dumps({'jointSpeed':maximum,'clawTargetError':error,'worstTarget':worst,'firstPalmError':palm_error,'firstHandSurfaceError':source_surface_error,'bodyPositionError':body_error,'clamp':rig.max_clamp,'floor':floors,'variableLinks':links,'overlaps':hits}),flush=True)
    sys.exit(0)

converted=Euler((-math.pi/2,0,0)).to_quaternion();channels={n:{'translation':[],'rotation':[],'scale':[]} for n in rig.base};trace=[];last={}
def local(name):
    p=rig.arm.pose.bones[name];q=converted@(p.matrix.to_quaternion()@rig.rest[name].to_quaternion().inverted())@converted.inverted();pos=converted@p.head
    if p.parent:
        pq=converted@(p.parent.matrix.to_quaternion()@rig.rest[p.parent.name].to_quaternion().inverted())@converted.inverted();pos=pq.inverted()@(pos-converted@p.parent.head);q=pq.inverted()@q
    return list(pos),[q.x,q.y,q.z,q.w],list(p.scale)
times=[i/fps for i in range(round(duration*fps)+1)]
for index,t in enumerate(times):
    if index%120==0:print('ATTACK3_REBUILD_FRAME',index,'/',len(times),flush=True)
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
report={'sourceSHA256':hashlib.sha256(raw).hexdigest(),'glbSHA256':hashlib.sha256(binary).hexdigest(),'sourceBinaryPreserved':data[:len(oldbin)]==oldbin,'spec':spec,'sampleFPS':fps,'maximumArmTargetClamp':rig.max_clamp,'bones':len(rig.base),'trace':trace,'hands':{s:{'palm':h.palm,'chains':h.chains,'clawIndices':h.claws,'tipGroups':h.tip_groups,'baseGroups':h.base_groups,'padTriangles':h.pad} for s,h in rig.hands.items()}}
(out/'build.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print('ATTACK3_AUTHORED',len(times),'poses; clamp',rig.max_clamp,flush=True)
