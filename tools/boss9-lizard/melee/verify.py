"""Independently validate the preserved Walk and the delivered Attack1 geometry."""
import bpy, sys, json, struct, hashlib, math
import numpy as np
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree

args=sys.argv[sys.argv.index('--')+1:]
source, fixed, blend, output = map(Path,args[:4])
prior_path=Path(args[4]) if len(args)>4 else None
def sha(b):return hashlib.sha256(b).hexdigest()
def glb(path):
    raw=path.read_bytes();n=struct.unpack_from('<I',raw,12)[0];j=json.loads(raw[20:20+n]);return j,raw[28+n:28+n+j['buffers'][0]['byteLength']]
old,oldbin=glb(source);new,newbin=glb(fixed)
assert newbin[:len(oldbin)]==oldbin,'Source mesh, weights, textures or Walk bytes changed'
for key in ['asset','nodes','skins','meshes','materials','images','textures','samplers','scenes','scene']:
    assert old.get(key)==new.get(key),key
assert new['accessors'][:len(old['accessors'])]==old['accessors']
assert new['bufferViews'][:len(old['bufferViews'])]==old['bufferViews']
assert len(new['animations'])==3 and new['animations'][0]==old['animations'][0]
clip=new['animations'][2];assert clip['name']=='BOSS9_Attack1' and len(clip['channels'])==219
build=json.loads(fixed.with_name('build.json').read_text());spec=json.loads(Path(__file__).with_name('spec.json').read_text());duration=2.4
assert spec['duration']==build['duration']==1
assert abs(build['timing']['sweepEnd']-build['timing']['riseStart']-1/2.4)<1e-6
def accessor(i,document=new,binary=newbin):
    a=document['accessors'][i];v=document['bufferViews'][a['bufferView']];d={'SCALAR':1,'VEC3':3,'VEC4':4}[a['type']]
    assert a['componentType']==5126
    return np.frombuffer(binary,dtype='<f4',count=a['count']*d,offset=v.get('byteOffset',0)+a.get('byteOffset',0)).reshape(-1,d)
seam=0
for c in clip['channels']:
    sampler=clip['samplers'][c['sampler']];times=accessor(sampler['input'])[:,0];v=accessor(sampler['output'])
    assert np.all(np.isfinite(v)) and np.all(np.diff(times)>0) and len(times)==577
    assert abs(times[0])<1e-6 and abs(times[-1]-spec['duration'])<1e-6
    if c['target']['path']=='rotation':
        assert np.max(np.abs(np.linalg.norm(v,axis=1)-1))<1e-5
        e=min(np.max(np.abs(v[0]-v[-1])),np.max(np.abs(v[0]+v[-1])))
    else:
        delta=v[-1]-v[0]
        if new['nodes'][c['target']['node']]['name']=='root' and c['target']['path']=='translation':delta=delta-np.array([0,0,.35])
        e=np.max(np.abs(delta))
    seam=max(seam,float(e))
assert seam<1e-5

def load(path):
    global loaded_duration
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if path.suffix=='.blend':bpy.ops.wm.open_mainfile(filepath=str(path))
    else:bpy.ops.import_scene.gltf(filepath=str(path))
    scene=bpy.context.scene;scene.render.fps=24
    arm=next(o for o in scene.objects if o.type=='ARMATURE');mesh=next(o for o in scene.objects if o.type=='MESH')
    action=next(a for a in bpy.data.actions if a.name=='BOSS9_Attack1')
    loaded_duration=action.frame_range[1]/24
    arm.animation_data.action=action;arm.animation_data.action_slot=action.slots[0]
    for track in arm.animation_data.nla_tracks:track.mute=True
    return arm,mesh
def frame(t):
    f=t/duration*loaded_duration*24;bpy.context.scene.frame_set(math.floor(f),subframe=f%1);bpy.context.view_layer.update()
def surface(mesh):
    e=mesh.evaluated_get(bpy.context.evaluated_depsgraph_get());me=e.to_mesh();v=np.empty(len(me.vertices)*3);me.vertices.foreach_get('co',v);e.to_mesh_clear();return v.reshape(-1,3)

arm,mesh=load(blend)
unchanged_error=0
if prior_path:
    prior,priorbin=glb(prior_path)
    allowed={'spine_17','spine_16'}
    for animation in [1,2]:
        before,after=prior['animations'][animation],new['animations'][animation]
        assert before['name']==after['name'] and len(before['channels'])==len(after['channels'])
        for a,b in zip(before['channels'],after['channels']):
            assert a['target']==b['target']
            sa,sb=before['samplers'][a['sampler']],after['samplers'][b['sampler']]
            before_times=accessor(sa['input'],prior,priorbin).astype(float)
            if animation==2:before_times=before_times*spec['duration']/duration
            np.testing.assert_allclose(before_times,accessor(sb['input']),rtol=0,atol=1e-7)
            if animation==1 or new['nodes'][b['target']['node']]['name'] not in allowed:
                unchanged_error=max(unchanged_error,float(np.max(np.abs(accessor(sa['output'],prior,priorbin)-accessor(sb['output'])))))
    assert unchanged_error<1e-5,unchanged_error
groups={g.index:g.name for g in mesh.vertex_groups}
def ids(names,threshold=.9):
    return {v.index for v in mesh.data.vertices if sum(g.weight for g in v.groups if groups[g.group] in names)>threshold}
regions={}
for name,bone in [('handR','spine_18'),('handL','chest'),('footL','rearFoot.L'),('footR','rearFoot.R'),('skull','spine_16')]:
    regions[name]=ids({bone,*[b.name for b in arm.pose.bones[bone].children_recursive]})
faces={n:[tuple(f.vertices) for f in mesh.data.polygons if set(f.vertices).issubset(index)] for n,index in regions.items()}
assert all(faces.values())
right_names={'spine_18',*[b.name for b in arm.pose.bones['spine_18'].children_recursive]}
claw_ids=sorted(i for i in ids(right_names,.99999) if mesh.data.vertices[i].co.z<-.40)
assert claw_ids==sorted(build['clawIndices']) and len(claw_ids)>30
finger_base_ids=sorted(ids({'spine_35','spine_38','spine_41'},.85))
finger_tip_ids=sorted(ids({'spine_33','spine_36','spine_39'},.85))
assert finger_base_ids==sorted(build['fingerBaseIndices']) and finger_tip_ids==sorted(build['fingerTipIndices'])
chains=[['spine_22','spine_21','spine_20','spine_19','spine_18'],['spine_06','spine_07','spine_08','spine_09','chest']]
chains += [['rearLeg.'+s+'_01','rearLwr.'+s,'rearHorselink.'+s,'rearFoot.'+s,'rearToe.'+s] for s in ['L','R']]
chains += [['spine_18',*chain] for chain in build['openHand']['digitChains']]
rest_lengths={(a,b):(arm.data.bones[b].head_local-arm.data.bones[a].head_local).length for chain in chains for a,b in zip(chain,chain[1:])}
# The accepted source has neck/head pose offsets relative to its edit bones.
# Preserve the physical links from that accepted Idle, including those offsets.
frame(0)
head_links=[('spine_05','spine_17'),('spine_17','spine_16')]
for a,b in head_links:rest_lengths[a,b]=(arm.pose.bones[b].head-arm.pose.bones[a].head).length
rest_points=np.array([v.co for v in mesh.data.vertices]);edges=np.array([e.vertices[:] for e in mesh.data.edges]);edge_lengths=np.linalg.norm(rest_points[edges[:,0]]-rest_points[edges[:,1]],axis=1)
valid_edges=edge_lengths>1e-4;edges=edges[valid_edges];edge_lengths=edge_lengths[valid_edges]
spec=json.loads(Path(__file__).with_name('spec.json').read_text())
assert build['spec']==spec and clip['extras']['AnimationNotifies']==spec['notifies']
assert clip['extras']['rootMotion']==spec['rootMotion']
assert new['animations'][1]['name']=='Idle'
def travel(t):
    u=min(1,max(0,(t-.5)));return .35*u*u*(3-2*u)
times=sorted([duration*i/576 for i in range(577)]+[duration*(i+.371)/576 for i in range(576)])
def curve_bow(points):
    p=np.array(points)[:,[0,2]];d=p[-1]-p[0];v=p-p[0]
    return float(np.max(abs(v[:,0]*d[1]-v[:,1]*d[0]))/np.linalg.norm(d))
def pad_normal(points):
    triangles=np.array(build['openHand']['padTriangles']);p=points[triangles]
    n=np.cross(p[:,1]-p[:,0],p[:,2]-p[:,0]).sum(axis=0);return n/np.linalg.norm(n)

def pad_up(points):return float(pad_normal(points)[2])

def angle(a,b):return float(np.degrees(np.arccos(np.clip(np.dot(a,b),-1,1))))
def extension_values(points):
    values=[]
    for chain,indices in zip(build['openHand']['digitChains'],build['openHand']['allTipGroups']):
        r=[arm.data.bones[n].head_local for n in chain]
        end=rest_points[indices].mean(axis=0);length=sum((b-a).length for a,b in zip(r,r[1:]))+np.linalg.norm(end-np.array(r[-1]))
        values.append(float(np.linalg.norm(points[indices].mean(axis=0)-np.array(arm.pose.bones[chain[0]].head))/length))
    return values
reference=None
if prior_path:
    arm,mesh=load(prior_path);old_claws=[];old_tips=[[],[],[]]
    frame(0)
    for a,b in head_links:assert abs((arm.pose.bones[b].head-arm.pose.bones[a].head).length-rest_lengths[a,b])<1e-5
    for t in np.linspace(1.12,1.5,97):
        frame(float(t));p=surface(mesh);old_claws.append(p[claw_ids].mean(axis=0))
        for group,indices in zip(old_tips,build['fingerTipGroups']):group.append(p[indices].mean(axis=0))
    frame(1.12);p=surface(mesh)
    reference={'clawBow':curve_bow(old_claws),'tipBows':[curve_bow(p) for p in old_tips],'peakPadUp':pad_up(p),'peakExtensions':extension_values(p),'peakNormal':pad_normal(p),'claws':np.array(old_claws)}
    frame(1.5);reference['endNormal']=pad_normal(surface(mesh))
results={};native={};equivalence=0;idle_difference=0
for label,path in [('blend',blend),('glb',fixed)]:
    arm,mesh=load(path);frame(0);first=surface(mesh);root0=arm.pose.bones['root'].head.copy();hip0=arm.pose.bones['hips'].head.z
    planted={n:arm.pose.bones[n].head.copy() for n in ['spine_18','chest']}
    bone_error=link_error=jump=root_error=contact_error=below=0;previous=None;end=None
    collision={p:0 for p in ['handR_footL','handR_footR','handL_footL','handL_footR','handR_skull','handL_skull','handR_handL','footL_footR']}
    minimum_hip=hip0;windup_hand_drift=0;max_edges=[0,0,0];contacts=[];claws=[];finger=[];normals=[];tip_clearance=[];tip_paths=[[],[],[]];up_values=[];open_extensions=[];open_tip_rises=[];head_yaw=[];head_pitch=[];head_bank=[]
    for index,t in enumerate(times):
        frame(t);p=surface(mesh);assert np.all(np.isfinite(p));end=p
        current=np.array([b.head for b in arm.pose.bones])
        if previous is not None:jump=max(jump,float(np.linalg.norm(current-previous,axis=1).max()))
        previous=current
        for b in arm.pose.bones:
            assert max(abs(s-1) for s in b.scale)<1e-5
            bone_error=max(bone_error,abs((b.tail-b.head).length-b.bone.length))
        for (a,b),length in rest_lengths.items():link_error=max(link_error,abs((arm.pose.bones[b].head-arm.pose.bones[a].head).length-length))
        delta=arm.pose.bones['root'].head-root0
        root_error=max(root_error,abs(delta.x),abs(delta.y+travel(t)))
        if t<=.5:
            minimum_hip=min(minimum_hip,arm.pose.bones['hips'].head.z)
            for n in planted:windup_hand_drift=max(windup_hand_drift,(arm.pose.bones[n].head-planted[n]).length)
        floors={n:float(p[list(regions[n]),2].min()) for n in ['handR','handL','footR','footL']}
        expected=[]
        if t<=1.62 or t>=1.88:expected.append('handL')
        if t<=.5 or 1.62<=t<=1.88 or t>=2.24:expected.append('handR')
        if t<=1.04 or t>=1.4:expected.append('footL')
        if t<=.55 or .93<=t<=1.68 or t>=1.90:expected.append('footR')
        for name in expected:contact_error=max(contact_error,abs(floors[name]-spec['ground']))
        below=max(below,spec['ground']-min(floors.values()))
        vertices=[Vector(v) for v in p];trees={n:BVHTree.FromPolygons(vertices,polys,all_triangles=False) for n,polys in faces.items()}
        for pair in collision:
            a,b=pair.split('_');collision[pair]+=len(trees[a].overlap(trees[b]))
        ratios=np.linalg.norm(p[edges[:,0]]-p[edges[:,1]],axis=1)/edge_lengths
        for k,value in enumerate([np.percentile(ratios,95),np.percentile(ratios,99),ratios.max()]):max_edges[k]=max(max_edges[k],float(value))
        claws.append(p[claw_ids].mean(axis=0));v=p[finger_tip_ids].mean(axis=0)-p[finger_base_ids].mean(axis=0);finger.append(v/np.linalg.norm(v))
        normals.append(pad_normal(p))
        if .50<=t<=1.62:
            skin=arm.pose.bones['spine_16'].matrix@arm.data.bones['spine_16'].matrix_local.inverted()
            direction=skin.to_3x3()@Vector((0,-1,0));direction.normalize()
            up=skin.to_3x3()@Vector((0,0,1));up.normalize()
            head_yaw.append(math.degrees(math.atan2(direction.x,-direction.y)))
            head_pitch.append(math.degrees(math.asin(direction.z)))
            head_bank.append(math.degrees(math.atan2(up.x,up.z)))
        tip_clearance.append(float(p[finger_tip_ids,2].min()-spec['ground']))
        for group,indices in zip(tip_paths,build['fingerTipGroups']):group.append(p[indices].mean(axis=0))
        if 1.04<=t<=1.12:
            up_values.append(pad_up(p));open_extensions.append(extension_values(p))
            open_tip_rises.append(float(p[finger_tip_ids,2].mean()-arm.pose.bones['spine_18'].head.z))
        if index%16==0 or index==len(times)-1:
            if label=='blend':native[index]=p
            else:equivalence=max(equivalence,float(np.max(np.abs(p-native[index]))))
    pose_seam=float(np.max(np.abs(end-first-np.array([0,-.35,0]))))
    attack=arm.animation_data.action
    idle=next(a for a in bpy.data.actions if a.name=='Idle');arm.animation_data.action=idle;arm.animation_data.action_slot=idle.slots[0];frame(0)
    idle_difference=max(idle_difference,float(np.max(np.abs(surface(mesh)-first))))
    arm.animation_data.action=attack;arm.animation_data.action_slot=attack.slots[0]
    ts=np.array(times);cp=np.array(claws);fd=np.array(finger);pn=np.array(normals);mask=(ts>=1.40)&(ts<=1.48)
    velocity=np.gradient(cp,ts,axis=0);velocity/=np.linalg.norm(velocity,axis=1).clip(1e-9)[:,None]
    alignment=np.sum(fd[mask]*velocity[mask],axis=1)
    a=int(np.argmin(abs(ts-1.12)));z=int(np.argmin(abs(ts-1.50)));m=int(np.argmin(abs(ts-1.31)));late=int(np.argmin(abs(ts-1.424)))
    delta=cp[z]-cp[a];chord=delta[[0,2]];path=cp[a:z+1][:,[0,2]]-cp[a,[0,2]]
    bow=float(np.max(abs(path[:,0]*chord[1]-path[:,1]*chord[0]))/np.linalg.norm(chord))
    step_angle=np.degrees(np.arccos(np.clip(np.sum(fd[a:z]*fd[a+1:z+1],axis=1),-1,1)))
    flow={'minimumTangentAlignment':float(alignment.min()),'maximumFingerDirectionStepDegrees':float(step_angle.max()),'horizontalTravel':float(delta[0]),'verticalTravel':float(delta[2]),'arcChordDeviation':bow,'middleHorizontalProgress':float((cp[m,0]-cp[a,0])/delta[0]),'middleVerticalProgress':float((cp[m,2]-cp[a,2])/delta[2]),'lateHorizontalTravel':float(cp[z,0]-cp[late,0]),'lateVerticalDrop':float(cp[late,2]-cp[z,2]),'lateMinimumTipClearance':float(np.array(tip_clearance)[(ts>=1.42)&(ts<=1.5)].min()),'directionSamples':[{'time':float(ts[i]),'vector':fd[i].tolist()} for i in [a,m,z]]}
    # The raised palm must remain upward into the stroke. Both its surface
    # normal and finger heading then progress through intermediate poses.
    # Early tangent locking would force the rejected immediate flip.
    stages=[int(np.argmin(abs(ts-t))) for t in [1.12,1.20,1.30,1.40,1.50]]
    total=angle(pn[a],pn[z]);fractions=[angle(pn[a],pn[i])/total for i in stages]
    headings=[float(np.degrees(np.arctan2(fd[i,0],fd[i,2]))) for i in stages]
    transition={'sampleTimes':[float(ts[i]/duration*spec['duration']) for i in stages],'padUp':[float(pn[i,2]) for i in stages],'normalProgress':fractions,'fingerHeadingDegrees':headings,'totalNormalTurnDegrees':total,'maximumNormalStepDegrees':max(angle(pn[i],pn[i+1]) for i in range(a,z)),'peakNormalChangeDegrees':angle(reference['peakNormal'],pn[a]) if reference else None,'endNormalChangeDegrees':angle(reference['endNormal'],pn[z]) if reference else None}
    tip_bows=[curve_bow(np.array(p)[a:z+1]) for p in tip_paths]
    hand={'minimumPadUp':min(up_values),'minimumFingerExtension':float(np.min(open_extensions)),'minimumTipRiseAbovePalm':min(open_tip_rises),'tipArcBows':tip_bows,'referenceClawBow':reference['clawBow'] if reference else None,'arcBowRatio':bow/reference['clawBow'] if reference else None,'tipArcBowRatios':[n/o for n,o in zip(tip_bows,reference['tipBows'])] if reference else None}
    if reference:
        comparison=np.array([np.interp(ts[a:z+1],np.linspace(1.12,1.5,97),reference['claws'][:,i]) for i in range(3)]).T
        hand['maximumReferenceClawPathDifference']=float(np.linalg.norm(cp[a:z+1]-comparison,axis=1).max())
    entry={'samples':len(times),'boneLengthError':bone_error,'limbLinkError':link_error,'maximumJointStep':jump,'rootMotionError':root_error,'windupHipDrop':hip0-minimum_hip,'windupHandDrift':windup_hand_drift,'plantedGroundError':contact_error,'maximumBelowGround':below,'idlePoseAtAdvancedPositionError':pose_seam,'triangleOverlaps':collision,'edgeStretchP95':max_edges[0],'edgeStretchP99':max_edges[1],'edgeStretchMaximum':max_edges[2],'flow':flow,'openHand':hand,'palmTransition':transition}
    entry['headTracking']={'maximumAbsYawDegrees':max(abs(v) for v in head_yaw),'minimumPitchDegrees':min(head_pitch),'maximumPitchDegrees':max(head_pitch),'maximumAbsBankDegrees':max(abs(v) for v in head_bank)}
    print('MELEE_CHECK',label,json.dumps(entry),flush=True)
    assert bone_error<1e-5 and link_error<1e-5 and jump<.12 and root_error<1e-5 and pose_seam<1e-5,entry
    assert entry['windupHipDrop']>.08 and windup_hand_drift<.012 and contact_error<.012 and below<.008,entry
    assert sum(collision.values())==0,entry
    assert entry['headTracking']['maximumAbsYawDegrees']<3 and -8<min(head_pitch)<max(head_pitch)<-2 and entry['headTracking']['maximumAbsBankDegrees']<3,entry['headTracking']
    assert flow['minimumTangentAlignment']>.82 and flow['maximumFingerDirectionStepDegrees']<6,flow
    assert flow['horizontalTravel']>.7 and flow['verticalTravel']<-.9 and .08<bow<.28 and .25<flow['middleHorizontalProgress']<.55 and .45<flow['middleVerticalProgress']<.75,flow
    assert flow['lateHorizontalTravel']>.15 and .03<flow['lateVerticalDrop']<.15 and flow['lateMinimumTipClearance']>.05,flow
    assert hand['minimumPadUp']>.45 and hand['minimumFingerExtension']>.94 and hand['minimumTipRiseAbovePalm']>.10,hand
    assert transition['padUp'][1]>.25 and .05<fractions[1]<.30 and .35<fractions[2]<.75 and fractions[3]>.85,transition
    assert abs(headings[1]-headings[0])<25 and 25<headings[2]<85 and headings[3]>95,transition
    assert transition['maximumNormalStepDegrees']<6,transition
    if reference:
        assert .9<hand['arcBowRatio']<1.1 and hand['maximumReferenceClawPathDifference']<.06,hand
        assert transition['peakNormalChangeDegrees']<.2 and transition['endNormalChangeDegrees']<.2,transition
    results[label]=entry
assert equivalence<2e-5 and idle_difference<2e-5,(equivalence,idle_difference)
report={'sourceSHA256':sha(source.read_bytes()),'glbSHA256':sha(fixed.read_bytes()),'bones':73,'clips':['Walk','Idle',spec['id']],'duration':spec['duration'],'sourceBinaryAndWalkPreserved':True,'nativeGLBMaximumVertexDifference':equivalence,'idleAttackPoseDifference':idle_difference,'channelPoseSeamError':seam,'notifies':spec['notifies'],'previousRevisionSHA256':sha(prior_path.read_bytes()) if prior_path else None,'unchangedIdleAndNonHeadChannelError':unchanged_error if prior_path else None,'checks':results}
output.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print('MELEE_VERIFY_PASS',flush=True)
