"""Reopen the editable source and inspect actual deformed surfaces and animation contracts."""
import bpy,sys,math,json
import numpy as np
from pathlib import Path
from mathutils import Vector,Quaternion
source,out=map(Path,sys.argv[sys.argv.index('--')+1:][:2])
bpy.ops.wm.open_mainfile(filepath=str(source));sc=bpy.context.scene
arm=next(o for o in sc.objects if o.type=='ARMATURE')
body=bpy.data.objects['BOSS9_Dragon_SingleTail']
groups={g.index:g.name for g in body.vertex_groups}
torso={v.index for v in body.data.vertices if sum(g.weight for g in v.groups if groups[g.group] in {'Bone_000','Bone_001','Bone_005','Bone_004','Bone_003','Bone_002'})>.65}
regions={'torso':torso,'head':{v.index for v in body.data.vertices if any(groups[g.group]=='Head' and g.weight>.7 for g in v.groups)}}
report={'blender':bpy.app.version_string,'bones':len(arm.data.bones),'clips':{},'images':[]}
for i in range(16,24):assert 'Bone_%03d'%i not in arm.data.bones
tail_chain=['Bone_%03d'%i for i in range(30,23,-1)]
for name in tail_chain:assert name in arm.data.bones
assert len(arm.data.bones)==64
for image in bpy.data.images:
    if image.type=='IMAGE':
        assert image.packed_file or image.source=='GENERATED'
        report['images'].append({'name':image.name,'size':list(image.size),'packed':bool(image.packed_file)})
def frame(action,t):
    arm.animation_data.action=action;arm.animation_data.action_slot=action.slots[0]
    f=t*60;sc.frame_set(math.floor(f),subframe=f%1);bpy.context.view_layer.update()
def state():return {p.name:(p.matrix.copy(),p.location.copy()) for p in arm.pose.bones}
base=None
expected={'Walk':1.6,'Attack1':1.5,'Attack2':1.2,'Attack3':3,'Die':2.5}
for name,d in expected.items():
    action=bpy.data.actions[name]
    assert abs(action.frame_range[0])<.001 and abs(action.frame_range[1]/60-d)<.001
    frame(action,0);start=state()
    if base is None:base=start
    floor=[];length_error=0;angles=[];forward_distances=[];root_yaws=[];tail_min_alignment=1;tail_extension=1
    initial_root=arm.matrix_world@arm.pose.bones['Bone_000'].head
    for i in range(round(d*120)+1):
        t=i/120;frame(action,t)
        ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get());mesh=ev.to_mesh()
        points=[ev.matrix_world@v.co for v in mesh.vertices];ev.to_mesh_clear()
        assert all(math.isfinite(x) for p in points for x in p)
        z=min(p.z for p in points);floor.append(z)
        facing=(arm.pose.bones['Head'].matrix.to_3x3()@Vector((0,1,0))).normalized()
        angles.append({'pitch':math.degrees(math.asin(-facing.z)), 'yaw':math.degrees(math.atan2(facing.x,-facing.y))})
        delta=arm.pose.bones['Bone_000'].matrix.to_quaternion()@arm.data.bones['Bone_000'].matrix_local.to_quaternion().inverted()
        root_yaw=delta.to_euler('XYZ').z;root_yaws.append(math.degrees(root_yaw))
        backward=Quaternion((0,0,1),root_yaw)@Vector((0,1,0))
        for n in tail_chain:
            direction=(arm.pose.bones[n].tail-arm.pose.bones[n].head).normalized()
            tail_min_alignment=min(tail_min_alignment,direction.dot(backward))
        extent=(arm.pose.bones[tail_chain[-1]].tail-arm.pose.bones[tail_chain[0]].head).length
        tail_extension=min(tail_extension,extent/sum(arm.data.bones[n].length for n in tail_chain))
        current_root=arm.matrix_world@arm.pose.bones['Bone_000'].head
        forward_distances.append(initial_root.y-current_root.y)
        for p in arm.pose.bones:
            length_error=max(length_error,abs((p.tail-p.head).length-p.bone.length))
        if name!='Die':assert z>.15,(name,t,z)
        else:assert z>.015,(name,t,z)
    frame(action,d);end=state()
    deviation=max(abs(start[n][0][r][c]-end[n][0][r][c]) for n in start for r in range(4) for c in range(4))
    if name!='Die':assert deviation<.0001,(name,deviation)
    frame(action,0)
    start_error=max(abs(base[n][0][r][c]-start[n][0][r][c]) for n in start for r in range(4) for c in range(4))
    assert start_error<.0001,(name,start_error)
    assert length_error<.00001,(name,length_error)
    assert tail_min_alignment>.75,(name,'tail curled',tail_min_alignment)
    assert tail_extension>.85,(name,'tail extension',tail_extension)
    result={'duration':d,'samples':len(floor),'minimumWorldZ':min(floor),'maxBoneLengthError':length_error,'startEndMatrixDifference':deviation,
        'headPitchRange':[min(a['pitch'] for a in angles),max(a['pitch'] for a in angles)],'headYawRange':[min(a['yaw'] for a in angles),max(a['yaw'] for a in angles)],
        'maximumForwardMeters':max(forward_distances),'rootYawRange': [min(root_yaws),max(root_yaws)],
        'tailMinimumBackwardAlignment':tail_min_alignment,'tailMinimumExtensionRatio':tail_extension}
    if name=='Walk':
        assert max(abs(a['pitch']-30) for a in angles)<.01
        assert max(abs(a['yaw']) for a in angles)<.01
        frame(action,.8)
        ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get());mesh=ev.to_mesh();pts=[ev.matrix_world@v.co for v in mesh.vertices];ev.to_mesh_clear()
        wing_planes={}
        for side,indices in {'left':[56,55,59,58,57,63,62,61,60],'right':[65,64,68,67,66,72,71,70,69]}.items():
            bones={'Bone_%03d'%i for i in indices}
            ids={v.index for v in body.data.vertices if sum(g.weight for g in v.groups if groups[g.group] in bones)>.70}
            coords=np.array([pts[i] for i in ids]);center=coords.mean(axis=0);_,_,vectors=np.linalg.svd(coords-center,full_matrices=False)
            normal=vectors[-1];angle=math.degrees(math.acos(min(1,abs(normal[2]))))
            wing_planes[side]={'angleToGroundDegrees':angle,'worldZRange':[float(coords[:,2].min()),float(coords[:,2].max())]}
            assert angle<20,(side,'wing membrane not level',angle)
        result['upstrokeWingPlanes']=wing_planes
    elif name=='Attack1':assert 4.97<max(forward_distances)<5.03,max(forward_distances)
    elif name=='Attack2':
        assert -90.1<min(root_yaws)<-89.9,root_yaws
        frame(action,.30);claw_start=arm.matrix_world@arm.pose.bones['Bone_043'].tail
        frame(action,.67);claw_end=arm.matrix_world@arm.pose.bones['Bone_043'].tail
        result['clawHighRightToLowLeft']={'start':list(claw_start),'end':list(claw_end),'leftwardMeters':claw_end.x-claw_start.x,'dropMeters':claw_start.z-claw_end.z}
        assert claw_end.x-claw_start.x>1,result['clawHighRightToLowLeft']
        assert claw_start.z-claw_end.z>1,result['clawHighRightToLowLeft']
    if name=='Die':
        frame(action,d);a=state();frame(action,2.3);b=state()
        result['endHoldDifference']=max(abs(a[n][0][r][c]-b[n][0][r][c]) for n in a for r in range(4) for c in range(4))
        assert result['endHoldDifference']<.0001
        frame(action,d);ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get());mesh=ev.to_mesh();pts=[ev.matrix_world@v.co for v in mesh.vertices];ev.to_mesh_clear()
        result['contactRegions']={n:[min(pts[i].z for i in indices),max(pts[i].z for i in indices)] for n,indices in regions.items()}
        assert result['contactRegions']['torso'][0]<.40,result['contactRegions']
        assert result['contactRegions']['head'][0]<.40,result['contactRegions']
        result['rootUp']=list(arm.matrix_world.to_quaternion()@arm.pose.bones['Bone_000'].matrix.to_quaternion()@arm.data.bones['Bone_000'].matrix_local.to_quaternion().inverted()@Vector((0,0,1)))
    report['clips'][name]=result
out.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print('BOSS9_VERIFY_PASS',json.dumps(report),flush=True)
