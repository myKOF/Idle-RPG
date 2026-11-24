"""Independent geometry checks for the appended two-claw animation."""
import bpy,sys,json,struct,hashlib,math
from pathlib import Path
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
source,fixed,blend,output=map(Path,sys.argv[sys.argv.index('--')+1:][:4])
spec=json.loads(Path(__file__).with_name('spec.json').read_text());duration=spec['duration'];fps=spec['authorFPS'];timing=spec['timing']
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def read(p):
    raw=p.read_bytes();n=struct.unpack_from('<I',raw,12)[0];j=json.loads(raw[20:20+n]);return j,raw[28+n:28+n+j['buffers'][0]['byteLength']]
old,oldbin=read(source);new,binary=read(fixed)
assert sha(source)=='7cc2450cdf682f287c35c291e843a8bff7315faeeaab4fa8d33e873abfe0f190'
assert binary[:len(oldbin)]==oldbin
for key in ['asset','nodes','skins','meshes','materials','images','textures','samplers','scenes','scene']:assert old.get(key)==new.get(key),key
assert new['animations'][:3]==old['animations'] and len(new['animations'])==4
assert new['bufferViews'][:len(old['bufferViews'])]==old['bufferViews'] and new['accessors'][:len(old['accessors'])]==old['accessors']
clip=new['animations'][3];assert clip['name']==spec['id'] and len(clip['channels'])==219
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
links={(b.parent.name,b.name):(b.head-b.parent.head).length for b in arm.pose.bones if b.parent}
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
        if action.name not in ['Walk','Idle','BOSS9_Attack1']:continue
        curves=[]
        for layer in action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    for c in bag.fcurves:curves.append([c.data_path,c.array_index,[[*k.co,k.interpolation] for k in c.keyframe_points]])
        signatures[action.name]=hashlib.sha256(json.dumps(sorted(curves),separators=(',',':')).encode()).hexdigest()
    return signatures
arm,mesh=load(source.with_suffix('.blend'),'Idle');original_actions=action_signatures();assert len(original_actions)==3
arm,mesh=load(blend);assert action_signatures()==original_actions
arm,mesh=load(source,'Idle');frame(0);source_idle=surface(mesh);source_heads={b.name:b.head.copy() for b in arm.pose.bones}
assert np.max(abs(initial-source_idle))<2e-5
count=round(duration*fps);samples=sorted([i/fps for i in range(count+1)]+[(i+.371)/fps for i in range(count)])
if '--quick' in sys.argv:samples=sorted(set([i*duration/120 for i in range(121)]+[timing['raised'],timing['slashStart'],timing['slashEnd']]))
results={};native={};equivalence=0
for label,path in [('blend',blend),('glb',fixed)]:
    arm,mesh=load(path);frame(0);first=surface(mesh);feet={n:arm.pose.bones[n].head.copy() for n in ['rearFoot.R','rearFoot.L']};root=arm.pose.bones['root'].head.copy();idle_torso=torso(arm);idle_chest=arm.pose.bones['spine_05'].head.copy()
    foot_drift=root_xy=link_error=scale_error=jump=speed=ground_error=below=0;previous=None;previous_t=None;claws={'R':[],'L':[]};normals={'R':[],'L':[]};raised=[];late_backs=[];extension=[];head_lead=[]
    collisions={n:0 for n in ['handR_footL','handR_footR','handL_footL','handL_footR','handR_skull','handL_skull','handR_handL','footL_footR']}
    for index,t in enumerate(samples):
        frame(t);points=surface(mesh);assert np.all(np.isfinite(points))
        joints=np.array([b.head for b in arm.pose.bones])
        if previous is not None:
            step=float(np.linalg.norm(joints-previous,axis=1).max());jump=max(jump,step);speed=max(speed,step/(t-previous_t))
        previous=joints;previous_t=t
        for bone in arm.pose.bones:scale_error=max(scale_error,max(abs(x-1) for x in bone.scale))
        for (a,b),length in links.items():link_error=max(link_error,abs((arm.pose.bones[b].head-arm.pose.bones[a].head).length-length))
        for n,p in feet.items():foot_drift=max(foot_drift,(arm.pose.bones[n].head-p).length)
        delta=arm.pose.bones['root'].head-root;root_xy=max(root_xy,math.hypot(delta.x,delta.y))
        floors={n:float(points[list(regions[n]),2].min()) for n in ['footR','footL','handR','handL']}
        for n in ['footR','footL']:ground_error=max(ground_error,abs(floors[n]-spec['ground']))
        below=max(below,spec['ground']-min(floors.values()))
        if t<=.02 or t>=timing['returnEnd']:
            for n in ['handR','handL']:ground_error=max(ground_error,abs(floors[n]-spec['ground']))
        vertices=[Vector(p) for p in points];trees={n:BVHTree.FromPolygons(vertices,polys,all_triangles=False) for n,polys in faces.items()}
        for pair in collisions:
            a,b=pair.split('_');collisions[pair]+=len(trees[a].overlap(trees[b]))
        for side,h in build['hands'].items():
            claws[side].append(points[h['clawIndices']].mean(axis=0));normals[side].append(normal(points,h['padTriangles']))
        if abs(t-1.10)<.0011:
            skin=arm.pose.bones['spine_16'].matrix@arm.data.bones['spine_16'].matrix_local.inverted()
            nose=skin.to_3x3()@Vector((0,-1,0));head_lead.append({'time':t,'headPitch':math.degrees(math.atan2(nose.z,-nose.y)),'claws':[claws[s][-1].tolist() for s in ['R','L']]})
        if timing['raised']<=t<=timing['holdEnd']:
            heads=arm.pose.bones;top=float(points[list(regions['skull']),2].max())
            pose={'chestLift':heads['spine_05'].head.z-idle_chest.z,'chestRetraction':heads['spine_05'].head.y-idle_chest.y,'torsoGain':torso(arm)-idle_torso,'torsoInclination':torso(arm),'tipAboveHead':min(max(float(points[ids,2].max()) for ids in h['tipGroups'])-top for h in build['hands'].values()),'minimumPadUp':min(normals[s][-1][2] for s in ['R','L']),'minimumPalmForward':min(-normals[s][-1][1] for s in ['R','L'])}
            angles=[];fore_up=[];upper_lateral=[]
            for names in [['spine_21','spine_20','spine_19'],['spine_07','spine_08','spine_09']]:
                shoulder,elbow,wrist=[heads[n].head for n in names];u=elbow-shoulder;f=wrist-elbow
                angles.append(math.degrees((-u).angle(f)));fore_up.append(f.normalized().z);upper_lateral.append(abs(u.normalized().x))
            skin=heads['spine_16'].matrix@arm.data.bones['spine_16'].matrix_local.inverted()
            pose.update(minimumElbowAngle=min(angles),maximumElbowAngle=max(angles),minimumForearmUp=min(fore_up),minimumUpperLateral=min(upper_lateral),headPitch=math.degrees(math.atan2(-(skin.to_3x3()@Vector((0,-1,0))).z,-(skin.to_3x3()@Vector((0,-1,0))).y)))
            # Forward is native -Y; skyward nose has positive Z.
            pose['headPitch']=-pose['headPitch']
            raised.append(pose)
            for h in build['hands'].values():
                for chain,group in zip(h['chains'],h['tipGroups']):
                    # Physical finger links plus its original terminal-tip offset.
                    tip_length=(Vector(source_idle[group].mean(axis=0))-source_heads[chain[-1]]).length
                    physical=sum(links[(a,b)] for a,b in zip(chain,chain[1:]))
                    extension.append(float(np.linalg.norm(points[group].mean(axis=0)-np.array(heads[chain[0]].head)))/(physical+tip_length))
        if timing['slashEnd']-.025<=t<=timing['slashEnd']:late_backs.append(min(normals[s][-1][1] for s in ['R','L']))
        if index%16==0 or index==len(samples)-1:
            if label=='blend':native[index]=points
            else:equivalence=max(equivalence,float(np.max(abs(points-native[index]))))
    ts=np.array(samples);stroke=(ts>=timing['slashStart'])&(ts<=timing['slashEnd']);paths={s:np.array(p)[stroke] for s,p in claws.items()};flow={}
    for s,p in paths.items():
        d=p[-1]-p[0];v=p[:,[0,2]]-p[0,[0,2]];chord=d[[0,2]]
        bow=float(np.max(abs(v[:,0]*chord[1]-v[:,1]*chord[0]))/np.linalg.norm(chord))
        flow[s]={'horizontalTravel':float(d[0]),'verticalTravel':float(d[2]),'chordDeviation':bow,'minimumSideClearance':float(np.min((p[:,0]-spec['axisX'])*(-1 if s=='R' else 1)))}
    progress={s:(p[:,2]-p[0,2])/(p[-1,2]-p[0,2]) for s,p in paths.items()}
    synchronization=float(np.max(abs(progress['R']-progress['L'])))
    values={k:min(float(r[k]) for r in raised) for k in raised[0]}
    values['maximumElbowAngle']=max(r['maximumElbowAngle'] for r in raised)
    lead=[]
    for sample in head_lead:
        drop=max((paths[s][0,2]-sample['claws'][i][2])/(paths[s][0,2]-paths[s][-1,2]) for i,s in enumerate(['R','L']))
        lead.append({'time':sample['time'],'headPitch':sample['headPitch'],'clawDropProgress':drop})
    entry={'samples':len(samples),'maximumJointStep':jump,'maximumJointSpeed':speed,'maximumScaleError':scale_error,'maximumLinkError':link_error,'maximumFootDrift':foot_drift,'rootHorizontalDrift':root_xy,'groundError':ground_error,'maximumBelowGround':below,'poseSeamError':float(np.max(abs(points-first))),'sourceIdleError':float(np.max(abs(first-source_idle))),'triangleOverlaps':collisions,'raised':values,'flow':flow,'maximumSynchronizationError':synchronization,'minimumLateDorsalForward':min(late_backs),'fingerExtensionMinimum':min(extension)}
    entry['headLeadsDownstroke']=lead
    print('ATTACK2_CHECK',label,json.dumps(entry),flush=True)
    assert scale_error<1e-5 and link_error<1e-5 and speed<30 and foot_drift<1e-4 and root_xy<1e-6,entry
    assert ground_error<.012 and below<.008 and entry['poseSeamError']<2e-5 and entry['sourceIdleError']<2e-5,entry
    assert sum(collisions.values())==0,entry
    assert values['chestLift']>.35 and values['chestRetraction']>.20 and values['torsoGain']>45 and values['torsoInclination']>55 and values['headPitch']>65,values
    assert values['minimumElbowAngle']>55 and max(r['maximumElbowAngle'] for r in raised)<115 and values['minimumForearmUp']>.9 and values['minimumUpperLateral']>.85,values
    assert values['tipAboveHead']>-.12 and values['minimumPadUp']>.15 and values['minimumPalmForward']>.65,values
    assert flow['R']['horizontalTravel']>0 and flow['L']['horizontalTravel']<0 and flow['R']['horizontalTravel']-flow['L']['horizontalTravel']>.12 and all(f['verticalTravel']<-1 and f['minimumSideClearance']>.22 for f in flow.values()),flow
    assert lead and all(r['headPitch']<45 and r['clawDropProgress']<.35 for r in lead),lead
    assert synchronization<.03 and min(late_backs)>.5 and min(extension)>.90,entry
    results[label]=entry
assert equivalence<2e-5,equivalence
report={'sourceSHA256':sha(source),'glbSHA256':sha(fixed),'duration':duration,'bones':73,'clips':[a['name'] for a in new['animations']],'sourceMeshAndThreeClipsPreserved':True,'preservedNativeActions':original_actions,'channelSeamError':seam,'nativeGLBMaximumVertexDifference':equivalence,'checks':results}
output.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print('ATTACK2_VERIFY_PASS',flush=True)
