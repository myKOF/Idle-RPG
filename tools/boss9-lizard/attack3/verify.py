"""Independent geometry checks for the appended two-claw animation."""
import bpy,sys,json,struct,hashlib,math
from pathlib import Path
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
source,fixed,blend,output=map(Path,sys.argv[sys.argv.index('--')+1:][:4])
spec=json.loads(Path(__file__).with_name('spec.json').read_text());duration=spec['duration'];fps=spec['authorFPS']
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def read(p):
    raw=p.read_bytes();n=struct.unpack_from('<I',raw,12)[0];j=json.loads(raw[20:20+n]);return j,raw[28+n:28+n+j['buffers'][0]['byteLength']]
old,oldbin=read(source);new,binary=read(fixed)
assert sha(source)==spec['sourceSHA256']
assert binary[:len(oldbin)]==oldbin
for key in ['asset','nodes','skins','meshes','materials','images','textures','samplers','scenes','scene']:assert old.get(key)==new.get(key),key
assert new['animations'][:4]==old['animations'] and len(new['animations'])==5
assert new['bufferViews'][:len(old['bufferViews'])]==old['bufferViews'] and new['accessors'][:len(old['accessors'])]==old['accessors']
clip=new['animations'][4];assert clip['name']==spec['id'] and len(clip['channels'])==219
build=json.loads(fixed.with_name('build.json').read_text());assert build['spec']==spec and build['sourceBinaryPreserved']
def accessor(index):
    a=new['accessors'][index];v=new['bufferViews'][a['bufferView']];size={'SCALAR':1,'VEC3':3,'VEC4':4}[a['type']]
    assert a['componentType']==5126
    return np.frombuffer(binary,dtype='<f4',offset=v.get('byteOffset',0)+a.get('byteOffset',0),count=a['count']*size).reshape(-1,size)
seam=0
for c in clip['channels']:
    s=clip['samplers'][c['sampler']];times=accessor(s['input'])[:,0];values=accessor(s['output'])
    assert len(times)==721 and abs(times[0])<1e-7 and abs(times[-1]-1.5)<1e-7 and np.all(np.diff(times)>0)
    assert np.all(np.isfinite(values))
    if c['target']['path']=='rotation':
        assert np.max(abs(np.linalg.norm(values,axis=1)-1))<1e-5
        error=min(np.max(abs(values[0]-values[-1])),np.max(abs(values[0]+values[-1])))
    else:error=np.max(abs(values[0]-values[-1]))
    seam=max(seam,float(error))
assert seam<1e-5
def load(path,action_name=spec['id']):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if path.suffix=='.blend':bpy.ops.wm.open_mainfile(filepath=str(path))
    else:bpy.ops.import_scene.gltf(filepath=str(path))
    scene=bpy.context.scene;scene.render.fps=24
    arm=next(o for o in scene.objects if o.type=='ARMATURE');mesh=next(o for o in scene.objects if o.type=='MESH')
    action=next(a for a in bpy.data.actions if a.name==action_name);arm.animation_data.action=action;arm.animation_data.action_slot=action.slots[0]
    for track in arm.animation_data.nla_tracks:track.mute=True
    return arm,mesh
def frame(t):
    f=t*24;bpy.context.scene.frame_set(math.floor(f),subframe=f%1);bpy.context.view_layer.update()
def surface(mesh):
    e=mesh.evaluated_get(bpy.context.evaluated_depsgraph_get());m=e.to_mesh();p=np.empty(len(m.vertices)*3);m.vertices.foreach_get('co',p);e.to_mesh_clear();return p.reshape(-1,3)
arm,mesh=load(blend);frame(0);initial=surface(mesh);assert len(arm.pose.bones)==73
groups={g.index:g.name for g in mesh.vertex_groups}
def ids(names,threshold=.9):return {v.index for v in mesh.data.vertices if sum(g.weight for g in v.groups if groups[g.group] in names)>threshold}
regions={n:ids({bone,*[b.name for b in arm.pose.bones[bone].children_recursive]}) for n,bone in [('handR','spine_18'),('handL','chest'),('footR','rearFoot.R'),('footL','rearFoot.L'),('skull','spine_16')]}
faces={n:[tuple(f.vertices) for f in mesh.data.polygons if set(f.vertices).issubset(v)] for n,v in regions.items()};assert all(faces.values())
links={(b.parent.name,b.name):(b.head-b.parent.head).length for b in arm.pose.bones if b.parent and b.name!='hips'}
for side,h in build['hands'].items():
    names={h['palm'],*[b.name for b in arm.pose.bones[h['palm']].children_recursive]}
    assert len(h['chains'])==4 and all(len(c)==3 for c in h['chains'])
    assert set(sum(h['chains'],[]))==names-{h['palm']}
    assert sorted(h['clawIndices'])==sorted(i for i in ids(names,.99999) if mesh.data.vertices[i].co.z<-.40)
    for chain in h['chains']:
        for a,b in zip([h['palm'],*chain],chain):assert arm.pose.bones[b].parent.name==a
    for tri in h['padTriangles']:assert all(sum(g.weight for g in mesh.data.vertices[i].groups if groups[g.group]==h['palm'])>.65 for i in tri)
def normal(points,triangles):
    p=points[np.array(triangles)];n=np.cross(p[:,1]-p[:,0],p[:,2]-p[:,0]).sum(axis=0);return n/np.linalg.norm(n)
def torso(arm):
    v=arm.pose.bones['spine_05'].head-arm.pose.bones['hips'].head
    return math.degrees(math.atan2(v.z,-v.y))
def action_signatures():
    signatures={}
    for action in bpy.data.actions:
        if action.name not in ['Walk','Idle','BOSS9_Attack1','BOSS9_Attack2']:continue
        curves=[]
        for layer in action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    for c in bag.fcurves:curves.append([c.data_path,c.array_index,[[*k.co,k.interpolation] for k in c.keyframe_points]])
        signatures[action.name]=hashlib.sha256(json.dumps(sorted(curves),separators=(',',':')).encode()).hexdigest()
    return signatures
arm,mesh=load(source.with_suffix('.blend'),'Idle');original_actions=action_signatures();assert len(original_actions)==4
arm,mesh=load(blend);assert action_signatures()==original_actions
arm,mesh=load(source,'Idle');frame(0);source_idle=surface(mesh);source_heads={b.name:b.head.copy() for b in arm.pose.bones}
assert np.max(abs(initial-source_idle))<2e-5
foot_shapes={s:sorted(i for i in ids({'rearHorselink.'+s,'rearFoot.'+s,'rearToe.'+s},.99999) if source_idle[i,2]<-.63) for s in ['R','L']}
assert all(len(v)>30 for v in foot_shapes.values())
head_shapes=sorted(ids({'spine_16',*[b.name for b in arm.pose.bones['spine_16'].children_recursive]},.99999));assert len(head_shapes)>100

# Independently sample the retained GLB Attack1, not the author's target trace.
reference=next(a for a in bpy.data.actions if a.name==spec['referenceClip']);arm.animation_data.action=reference;arm.animation_data.action_slot=reference.slots[0]
reference_claws={s:[] for s in ['R','L']}
for i in range(round(spec['referenceDuration']*fps)+1):
    frame(i/fps);points=surface(mesh)
    for side,h in build['hands'].items():reference_claws[side].append(points[h['clawIndices']].mean(axis=0))
reference_claws={s:np.array(v) for s,v in reference_claws.items()};idle_claws={s:source_idle[h['clawIndices']].mean(axis=0) for s,h in build['hands'].items()}
def at(side,t):
    if t<=0 or t>=spec['referenceDuration']:return idle_claws[side]
    f=t*fps;i=min(len(reference_claws[side])-2,int(f));u=f-i;return reference_claws[side][i]*(1-u)+reference_claws[side][i+1]*u
def source_time(t,side):
    c=spec['cycles'][side];return max(0,min(spec['referenceDuration'],(t-c['start'])/(c['end']-c['start'])*spec['referenceDuration']))
count=round(duration*fps);samples=sorted([i/fps for i in range(count+1)]+[(i+.371)/fps for i in range(count)])
if '--quick' in sys.argv:samples=sorted(set([i*duration/120 for i in range(121)]+[t for w in spec['strokes'].values() for t in w.values()]))
results={};native={};equivalence=0
for label,path in [('blend',blend),('glb',fixed)]:
    arm,mesh=load(path);frame(0);first=surface(mesh);feet={n:arm.pose.bones[n].head.copy() for n in ['rearFoot.R','rearFoot.L']};root=arm.pose.bones['root'].head.copy()
    peak_heads=[]
    for side in ['R','L']:
        frame(spec['strokes'][side]['start']);peak_heads.append(surface(mesh)[head_shapes]-np.array(arm.pose.bones['spine_16'].head))
    head_shape_match=float(np.linalg.norm(peak_heads[0]-peak_heads[1],axis=1).max())
    foot_drift=root_xy=link_error=scale_error=jump=speed=ground_error=below=foot_shape_error=head_roll=0;previous=None;previous_t=None;claws={'R':[],'L':[]};normals={'R':[],'L':[]};raised={s:[] for s in ['R','L']};gaze=0;target_error={s:0 for s in ['R','L']};support_error={s:0 for s in ['R','L']};speed_location={}
    collisions={n:0 for n in ['handR_footL','handR_footR','handL_footL','handL_footR','handR_skull','handL_skull','handR_handL','footL_footR']};link_location={}
    for index,t in enumerate(samples):
        frame(t);points=surface(mesh);assert np.all(np.isfinite(points));joints=np.array([b.head for b in arm.pose.bones])
        if previous is not None:
            distances=np.linalg.norm(joints-previous,axis=1);step=float(distances.max());jump=max(jump,step)
            if step/(t-previous_t)>speed:speed=step/(t-previous_t);speed_location={'from':previous_t,'to':t,'bone':list(arm.pose.bones)[int(distances.argmax())].name}
        previous=joints;previous_t=t
        for bone in arm.pose.bones:scale_error=max(scale_error,max(abs(x-1) for x in bone.scale))
        for (a,b),length in links.items():
            err=abs((arm.pose.bones[b].head-arm.pose.bones[a].head).length-length)
            if err>link_error:link_error=err;link_location={'time':t,'parent':a,'bone':b}
        for n,p in feet.items():foot_drift=max(foot_drift,(arm.pose.bones[n].head-p).length)
        for v in foot_shapes.values():foot_shape_error=max(foot_shape_error,float(np.linalg.norm(points[v]-source_idle[v],axis=1).max()))
        delta=arm.pose.bones['root'].head-root;root_xy=max(root_xy,math.hypot(delta.x,delta.y))
        floors={n:float(points[list(regions[n]),2].min()) for n in ['footR','footL','handR','handL']}
        for n in ['footR','footL']:ground_error=max(ground_error,abs(floors[n]-spec['ground']))
        below=max(below,spec['ground']-min(floors.values()))
        if t<=.01 or t>=duration-.005:
            for n in ['handR','handL']:ground_error=max(ground_error,abs(floors[n]-spec['ground']))
        vertices=[Vector(p) for p in points];trees={n:BVHTree.FromPolygons(vertices,polys,all_triangles=False) for n,polys in faces.items()}
        for pair in collisions:
            a,b=pair.split('_');collisions[pair]+=len(trees[a].overlap(trees[b]))
        tr,tl=source_time(t,'R'),source_time(t,'L')
        for side,h in build['hands'].items():
            other='L' if side=='R' else 'R';actual=points[h['clawIndices']].mean(axis=0);claws[side].append(actual);normals[side].append(normal(points,h['padTriangles']))
            mirrored=(at(other,tl)-idle_claws[other])*np.array([-1,1,1]);expected=at(side,tr)+mirrored
            target_error[side]=max(target_error[side],float(np.linalg.norm(actual-expected)))
            w=spec['strokes'][side]
            if w['start']-.008<=t<=w['start']:
                extensions=[]
                for chain,group in zip(h['chains'],h['tipGroups']):
                    tip_length=(Vector(source_idle[group].mean(axis=0))-source_heads[chain[-1]]).length
                    length=sum(links[(a,b)] for a,b in zip(chain,chain[1:]))+tip_length
                    extensions.append(float(np.linalg.norm(points[group].mean(axis=0)-np.array(arm.pose.bones[chain[0]].head)))/length)
                raised[side].append({'lift':float(actual[2]-idle_claws[side][2]),'palmUp':float(normals[side][-1][2]),'fingerExtension':min(extensions)})
            ow=spec['strokes'][other]
            if ow['start']<=t<=ow['end']:
                support_error[side]=max(support_error[side],float(np.linalg.norm(actual-idle_claws[side])))
                ground_error=max(ground_error,abs(floors['hand'+side]-spec['ground']))
        active=any(w['start']<=t<=w['end'] for w in spec['strokes'].values())
        if active:
            skin=arm.pose.bones['spine_16'].matrix@arm.data.bones['spine_16'].matrix_local.inverted();nose=skin.to_3x3()@Vector((0,-1,0));gaze=max(gaze,math.degrees(nose.angle(Vector((0,-1,0)))))
            up=skin.to_3x3()@Vector((0,0,1));head_roll=max(head_roll,abs(math.degrees(math.atan2(up.x,up.z))))
        if index%16==0 or index==len(samples)-1:
            if label=='blend':native[index]=points
            else:equivalence=max(equivalence,float(np.max(abs(points-native[index]))))
    ts=np.array(samples);flow={}
    for side,values in claws.items():
        values=np.array(values);w=spec['strokes'][side];p=values[(ts>=w['start'])&(ts<=w['end'])];d=p[-1]-p[0]
        flow[side]={'horizontalTravel':float(d[0]),'verticalTravel':float(d[2]),'maximumHeightTime':float(ts[values[:,2].argmax()]),'minimumRaisedLift':min(r['lift'] for r in raised[side]),'minimumRaisedPalmUp':min(r['palmUp'] for r in raised[side]),'minimumFingerExtension':min(r['fingerExtension'] for r in raised[side])}
    entry={'samples':len(samples),'maximumJointStep':jump,'maximumJointSpeed':speed,'maximumSpeedLocation':speed_location,'maximumScaleError':scale_error,'maximumLinkError':link_error,'maximumFootDrift':foot_drift,'rootHorizontalDrift':root_xy,'groundError':ground_error,'maximumBelowGround':below,'poseSeamError':float(np.max(abs(points-first))),'sourceIdleError':float(np.max(abs(first-source_idle))),'triangleOverlaps':collisions,'flow':flow,'maximumReferencePathError':target_error,'supportDriftDuringOtherStrike':support_error,'maximumHeadGazeAngle':gaze}
    entry['maximumLinkLocation']=link_location
    entry['maximumFootShapeError']=foot_shape_error;entry['maximumHeadRoll']=head_roll;entry['footShapeVertices']={s:len(v) for s,v in foot_shapes.items()}
    entry['peakHeadShapeDifference']=head_shape_match
    print('ATTACK3_CHECK',label,json.dumps(entry),flush=True)
    assert scale_error<1e-5 and link_error<1e-5 and speed<30 and foot_drift<1e-4 and root_xy<1e-6,entry
    assert ground_error<.012 and below<.008 and entry['poseSeamError']<2e-5 and entry['sourceIdleError']<2e-5,entry
    assert sum(collisions.values())==0,entry
    assert foot_shape_error<.0005 and head_roll<5 and head_shape_match<.002 and all(f['minimumFingerExtension']>.97 for f in flow.values()),entry
    assert flow['R']['horizontalTravel']>.8 and flow['L']['horizontalTravel']<-.8 and all(f['verticalTravel']<-.7 and f['minimumRaisedLift']>.7 and f['minimumRaisedPalmUp']>.4 for f in flow.values()),flow
    assert flow['R']['maximumHeightTime']<.6 and flow['L']['maximumHeightTime']>.85 and flow['L']['maximumHeightTime']-flow['R']['maximumHeightTime']>.45,flow
    assert max(target_error.values())<.01 and max(support_error.values())<.003 and gaze<20,entry
    results[label]=entry
assert equivalence<2e-5,equivalence
report={'sourceSHA256':sha(source),'glbSHA256':sha(fixed),'duration':duration,'bones':73,'clips':[a['name'] for a in new['animations']],'sourceMeshAndFourClipsPreserved':True,'preservedNativeActions':original_actions,'channelSeamError':seam,'nativeGLBMaximumVertexDifference':equivalence,'checks':results}
output.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print('ATTACK3_VERIFY_PASS',flush=True)
