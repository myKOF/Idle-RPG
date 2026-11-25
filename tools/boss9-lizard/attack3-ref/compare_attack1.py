"""Compare the actual new GLB against the retained, approved Attack1 GLB."""
import bpy,sys,json,math,hashlib
from pathlib import Path
import numpy as np
source,fixed,output=map(Path,sys.argv[sys.argv.index('--')+1:][:3])
build=json.loads(fixed.with_name('build.json').read_text());spec=build['spec'];hands=build['hands']
def load(p,clip):
    bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(p))
    scene=bpy.context.scene;scene.render.fps=24
    arm=next(o for o in scene.objects if o.type=='ARMATURE');mesh=next(o for o in scene.objects if o.type=='MESH')
    action=next(a for a in bpy.data.actions if a.name==clip);arm.animation_data.action=action;arm.animation_data.action_slot=action.slots[0]
    for track in arm.animation_data.nla_tracks:track.mute=True
    return arm,mesh
def pose(arm,mesh,t,side):
    f=t*24;bpy.context.scene.frame_set(math.floor(f),subframe=f%1);bpy.context.view_layer.update()
    e=mesh.evaluated_get(bpy.context.evaluated_depsgraph_get());m=e.to_mesh();p=np.empty(len(m.vertices)*3);m.vertices.foreach_get('co',p);e.to_mesh_clear();p=p.reshape(-1,3)
    h=hands[side];claw=p[h['clawIndices']];tri=p[np.array(h['padTriangles'])]
    normal=np.cross(tri[:,1]-tri[:,0],tri[:,2]-tri[:,0]).sum(axis=0);normal/=np.linalg.norm(normal)
    fingers=np.array([np.array(arm.pose.bones[b].head)-np.array(arm.pose.bones[a].head) for chain in h['chains'] for a,b in zip(chain,chain[1:])])
    fingers/=np.linalg.norm(fingers,axis=1)[:,None]
    return {'claw':claw,'normal':normal,'fingers':fingers}
trace_times=np.array([p['time'] for p in build['trace']])
def source_time(t,s):return float(np.interp(t,trace_times,[p['sourceTimes'][s] for p in build['trace']]))
# Recovery is intentionally replaced by the requested airborne retract/backswing.
# Preserve the accepted first attack through its slash end, before that change.
times={'R':sorted(set([p['time'] for p in build['trace'] if p['time']<=spec['strokes']['R']['end']]+list(spec['strokes']['R'].values()))),
       'L':sorted(set([p['time'] for p in build['trace'] if spec['strokes']['L']['start']<=p['time']<=spec['strokes']['L']['end']]+list(spec['strokes']['L'].values())))}
arm,mesh=load(source,'Idle');idle={s:pose(arm,mesh,0,s)['claw'].mean(axis=0) for s in ['R','L']}
arm,mesh=load(source,spec['referenceClip']);reference={s:[pose(arm,mesh,source_time(t,s),'R') for t in ts] for s,ts in times.items()}
arm,mesh=load(fixed,spec['id']);reflection=np.array([-1,1,1])
report={'sourceSHA256':hashlib.sha256(source.read_bytes()).hexdigest(),'glbSHA256':hashlib.sha256(fixed.read_bytes()).hexdigest(),'referenceClip':spec['referenceClip'],'samples':{s:len(ts) for s,ts in times.items()}}
for side,ts in times.items():
    surface=claw_error=palm_angle=active_palm_angle=finger_angle=0
    for t,ref in zip(ts,reference[side]):
        current=pose(arm,mesh,t,side)
        expected=ref['claw'].mean(axis=0) if side=='R' else idle['L']+(ref['claw'].mean(axis=0)-idle['R'])*reflection
        claw_error=max(claw_error,float(np.linalg.norm(current['claw'].mean(axis=0)-expected)))
        normal=ref['normal'] if side=='R' else ref['normal']*reflection
        angle=math.degrees(math.acos(float(np.clip(current['normal']@normal,-1,1))))
        palm_angle=max(palm_angle,angle)
        if spec['strokes'][side]['start']<=t<=spec['strokes'][side]['end']:active_palm_angle=max(active_palm_angle,angle)
        expected_fingers=ref['fingers'] if side=='R' else ref['fingers']*reflection
        finger_angle=max(finger_angle,float(np.degrees(np.arccos(np.clip(np.sum(current['fingers']*expected_fingers,axis=1),-1,1))).max()))
        if side=='R':surface=max(surface,float(np.linalg.norm(current['claw']-ref['claw'],axis=1).max()))
    report[side]={'maximumClawDifference':claw_error,'maximumPalmAngle':palm_angle,'maximumActivePalmAngle':active_palm_angle,'maximumFingerDirectionAngle':finger_angle,**({'maximumHandSurfaceDifference':surface} if side=='R' else {})}
print('ATTACK1_SOURCE_COMPARISON',json.dumps(report),flush=True)
assert report['R']['maximumHandSurfaceDifference']<.002 and report['R']['maximumActivePalmAngle']<.2 and report['R']['maximumFingerDirectionAngle']<.2,report
assert report['L']['maximumClawDifference']<.002 and report['L']['maximumActivePalmAngle']<.2 and report['L']['maximumFingerDirectionAngle']<.2,report
output.write_text(json.dumps(report,indent=2)+'\n');print('ATTACK1_SOURCE_COMPARISON_PASS',flush=True)
