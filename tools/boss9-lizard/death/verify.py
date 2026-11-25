"""Independently replay the native and GLB death, including off-key samples."""
import bpy,sys,json,struct,hashlib,math
from pathlib import Path
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
source,fixed,blend,output=map(Path,sys.argv[sys.argv.index('--')+1:][:4]);spec=json.loads(Path(__file__).with_name('spec.json').read_text());duration=spec['duration'];fps=spec['authorFPS']
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def read(p):
    raw=p.read_bytes();n=struct.unpack_from('<I',raw,12)[0];j=json.loads(raw[20:20+n]);return j,raw[28+n:28+n+j['buffers'][0]['byteLength']]
old,oldbin=read(source);new,binary=read(fixed);build=json.loads(fixed.with_name('build.json').read_text())
assert sha(source)==spec['sourceSHA256'] and build['spec']==spec and build['sampleFPS']==fps
assert binary[:len(oldbin)]==oldbin
for key in ['asset','nodes','skins','meshes','materials','images','textures','samplers','scenes','scene']:assert old.get(key)==new.get(key),key
assert new['animations'][:5]==old['animations'] and len(new['animations'])==6
assert new['bufferViews'][:len(old['bufferViews'])]==old['bufferViews'] and new['accessors'][:len(old['accessors'])]==old['accessors']
clip=new['animations'][-1];assert clip['name']==spec['id'] and len(clip['channels'])==219 and not clip['extras']['loop']
def accessor(index):
    a=new['accessors'][index];v=new['bufferViews'][a['bufferView']];size={'SCALAR':1,'VEC3':3,'VEC4':4}[a['type']]
    assert a['componentType']==5126
    return np.frombuffer(binary,dtype='<f4',offset=v.get('byteOffset',0)+a.get('byteOffset',0),count=a['count']*size).reshape(-1,size)
for c in clip['channels']:
    s=clip['samplers'][c['sampler']];times=accessor(s['input'])[:,0];values=accessor(s['output'])
    assert len(times)==round(duration*fps)+1 and times[0]==0 and abs(times[-1]-duration)<1e-6 and np.all(np.diff(times)>0) and np.all(np.isfinite(values))
    if c['target']['path']=='rotation':assert np.max(abs(np.linalg.norm(values,axis=1)-1))<1e-5
def load(p,clip_name=spec['id']):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if p.suffix=='.blend':bpy.ops.wm.open_mainfile(filepath=str(p))
    else:bpy.ops.import_scene.gltf(filepath=str(p))
    bpy.context.scene.render.fps=24;arm=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE');mesh=next(o for o in bpy.context.scene.objects if o.type=='MESH')
    a=next(a for a in bpy.data.actions if a.name==clip_name);arm.animation_data.action=a;arm.animation_data.action_slot=a.slots[0]
    for track in arm.animation_data.nla_tracks:track.mute=True
    return arm,mesh
def frame(t):
    f=t*24;bpy.context.scene.frame_set(math.floor(f),subframe=f%1);bpy.context.view_layer.update()
def surface(mesh):
    e=mesh.evaluated_get(bpy.context.evaluated_depsgraph_get());m=e.to_mesh();p=np.empty(len(m.vertices)*3);m.vertices.foreach_get('co',p);e.to_mesh_clear();return p.reshape(-1,3)
def signatures():
    result={}
    for a in bpy.data.actions:
        if a.name not in spec['sourceClips']:continue
        curves=[]
        for layer in a.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    for c in bag.fcurves:curves.append([c.data_path,c.array_index,[[*k.co,k.interpolation] for k in c.keyframe_points]])
        result[a.name]=hashlib.sha256(json.dumps(sorted(curves),separators=(',',':')).encode()).hexdigest()
    return result
arm,mesh=load(source.with_suffix('.blend'),'Idle');source_actions=signatures();assert len(source_actions)==5
arm,mesh=load(blend);assert signatures()==source_actions
arm,mesh=load(source,'Idle');frame(0);source_idle=surface(mesh);groups={g.index:g.name for g in mesh.vertex_groups}
def ids(names,threshold=.9):return {v.index for v in mesh.data.vertices if sum(g.weight for g in v.groups if groups[g.group] in names)>threshold}
roots={'handR':'spine_18','handL':'chest','footR':'rearFoot.R','footL':'rearFoot.L','skull':'spine_16'}
regions={n:ids({bone,*[b.name for b in arm.pose.bones[bone].children_recursive]}) for n,bone in roots.items()};regions['torso']=set(build['coreIndices'])
faces={n:[tuple(f.vertices) for f in mesh.data.polygons if set(f.vertices).issubset(indices)] for n,indices in regions.items()};assert all(faces.values())
links={(b.parent.name,b.name):(b.head-b.parent.head).length for b in arm.pose.bones if b.parent}
foot_shapes={s:sorted(i for i in ids({'rearHorselink.'+s,'rearFoot.'+s,'rearToe.'+s},.99999) if source_idle[i,2]<-.63) for s in ['R','L']}
assert all(len(v)>30 for v in foot_shapes.values())
def rigid_error(reference,current):
    a=reference-reference.mean(axis=0);b=current-current.mean(axis=0);u,_,vt=np.linalg.svd(a.T@b);r=u@vt
    if np.linalg.det(r)<0:u[:,-1]*=-1;r=u@vt
    return float(np.linalg.norm(a@r-b,axis=1).max())
pairs=[('handR','handL'),('handR','skull'),('handL','skull'),('handR','footR'),('handR','footL'),('handL','footR'),('handL','footL'),('footR','footL'),('handR','torso'),('handL','torso')]
count=round(duration*fps);samples=sorted([i/fps for i in range(count+1)]+[(i+.371)/fps for i in range(count)])
results={};native={};equivalence=0
for label,path in [('blend',blend),('glb',fixed)]:
    arm,mesh=load(path);frame(0);first=surface(mesh);start_error=float(np.max(abs(first-source_idle)));root_q=arm.pose.bones['root'].matrix.to_quaternion().copy()
    head_q=arm.pose.bones['spine_16'].matrix.to_quaternion().copy();jaw_q=arm.pose.bones['spine_26'].matrix_basis.to_quaternion().copy();howl_sky=90;howl_jaw=180
    frame(spec['holdFrom']);corpse=surface(mesh);hold_error=0
    scale_error=link_error=speed=foot_error=floor_error=0;previous=None;previous_t=None;collisions={a+'_'+b:0 for a,b in pairs};collision_times={};worst_speed={};ground_max=0;final_core_gap=0;final_head_gap=0
    for index,t in enumerate(samples):
        if index%240==0:print('DEATH_VALIDATE',label,index,'/',len(samples),flush=True)
        frame(t);points=surface(mesh);assert np.all(np.isfinite(points));joints=np.array([p.head for p in arm.pose.bones])
        if previous is not None:
            v=float(np.linalg.norm(joints-previous,axis=1).max())/(t-previous_t)
            if v>speed:speed=v;worst_speed={'from':previous_t,'to':t}
        previous=joints;previous_t=t
        if spec['howl']['riseEnd']<=t<=spec['howl']['holdEnd']:
            forward=(arm.pose.bones['spine_16'].matrix.to_quaternion()@head_q.inverted())@Vector((0,-1,0))
            howl_sky=min(howl_sky,math.degrees(math.atan2(forward.z,math.hypot(forward.x,forward.y))))
            angle=math.degrees(jaw_q.rotation_difference(arm.pose.bones['spine_26'].matrix_basis.to_quaternion()).angle)
            howl_jaw=min(howl_jaw,min(angle,abs(360-angle)))
        for p in arm.pose.bones:scale_error=max(scale_error,max(abs(x-1) for x in p.scale))
        for (a,b),length in links.items():link_error=max(link_error,abs((arm.pose.bones[b].head-arm.pose.bones[a].head).length-length))
        for s,indices in foot_shapes.items():foot_error=max(foot_error,rigid_error(source_idle[indices],points[indices]))
        lowest=float(points[:,2].min())
        # Retain the source's tiny low toe tip at Idle; once collapse begins,
        # the full mesh must stay above the preview ground, with a small thud.
        floor=float(source_idle[:,2].min()) if t<.35 else spec['ground']
        floor_error=max(floor_error,floor-lowest)
        if t>=.35:ground_max=max(ground_max,lowest-spec['ground'])
        if t>=spec['holdFrom']:
            hold_error=max(hold_error,float(np.max(abs(points-corpse))))
            final_core_gap=max(final_core_gap,float(points[build['coreIndices'],2].min()-spec['ground']))
            final_head_gap=max(final_head_gap,float(points[list(regions['skull']),2].min()-spec['ground']))
        vertices=[Vector(p) for p in points];trees={n:BVHTree.FromPolygons(vertices,f,all_triangles=False) for n,f in faces.items()}
        for a,b in pairs:
            hits=len(trees[a].overlap(trees[b]));collisions[a+'_'+b]+=hits
            if hits:collision_times.setdefault(a+'_'+b,[]).append(t)
        if index%16==0 or index==len(samples)-1:
            if label=='blend':native[index]=points
            else:equivalence=max(equivalence,float(np.max(abs(points-native[index]))))
    delta=arm.pose.bones['root'].matrix.to_quaternion()@root_q.inverted();roll=math.degrees((delta@Vector((0,0,1))).angle(Vector((0,0,1))))
    entry={'samples':len(samples),'startIdleError':start_error,'maximumScaleError':scale_error,'maximumLinkError':link_error,'maximumJointSpeed':speed,'maximumSpeedLocation':worst_speed,'maximumFootRigidError':foot_error,'footShapeVertices':{s:len(v) for s,v in foot_shapes.items()},'maximumBelowGround':floor_error,'maximumGroundLift':ground_max,'endHoldError':hold_error,'endCoreClearance':final_core_gap,'endHeadClearance':final_head_gap,'finalRollDegrees':roll,'minimumHowlSkyDegrees':howl_sky,'minimumHowlJawDegrees':howl_jaw,'howlHoldSeconds':spec['howl']['holdEnd']-spec['howl']['riseEnd'],'triangleOverlaps':collisions,'collisionTimes':collision_times}
    print('DEATH_CHECK',label,json.dumps(entry),flush=True)
    assert start_error<2e-5 and scale_error<1e-5 and link_error<1e-5 and speed<12,entry
    assert foot_error<.0005 and floor_error<.002 and ground_max<.018,entry
    assert hold_error<2e-5 and final_core_gap<.08 and final_head_gap<.15 and roll>70,entry
    assert howl_sky>65 and howl_jaw>25 and entry['howlHoldSeconds']>=.95,entry
    assert sum(collisions.values())==0,entry
    results[label]=entry
assert equivalence<2e-5,equivalence
report={'sourceSHA256':sha(source),'glbSHA256':sha(fixed),'duration':duration,'bones':73,'sourceMeshAndFiveClipsPreserved':True,'preservedNativeActions':source_actions,'clips':[a['name'] for a in new['animations']],'nativeGLBMaximumVertexDifference':equivalence,'checks':results}
output.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print('DEATH_VERIFY_PASS',flush=True)
