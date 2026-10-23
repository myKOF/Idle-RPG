"""Reopen a finished Blender candidate, render its skeletal clips and turntable."""
import argparse
import json
import math
import sys
from pathlib import Path
import bpy
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

p=argparse.ArgumentParser()
p.add_argument('--model',required=True)
p.add_argument('--preview',required=True)
p.add_argument('--validate-only',action='store_true')
p.add_argument('--sprite-preview',action='store_true',help='Transparent sprites with fixed camera/anchor, no turntable')
a=p.parse_args(sys.argv[sys.argv.index('--')+1:])
model=Path(a.model).resolve()
out=Path(a.preview).resolve()
out.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(model))
rig=bpy.data.objects['KNIGHT_RIG']
scene=bpy.context.scene
manifest=json.loads((model.parent/'manifest.json').read_text())
actions={name:bpy.data.actions.get(name) for name in manifest['clips']}
assert all(actions.values()), 'Missing animation'
assert len(rig.data.bones)==16
assert len([o for o in bpy.data.objects if o.type=='ARMATURE'])==1
assert not [i for i in bpy.data.images if i.source=='FILE' and i.users and not i.packed_file], \
    'External texture dependency'

try:
    prefs=bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type='CUDA'
    prefs.get_devices()
    gpu=False
    for device in prefs.devices:
        device.use=device.type=='CUDA'
        gpu=gpu or device.use
    scene.cycles.device='GPU' if gpu else 'CPU'
except Exception:
    scene.cycles.device='CPU'
scene.render.resolution_x=480
scene.render.resolution_y=480
scene.cycles.samples=32
scene.cycles.use_denoising=True
if a.sprite_preview:
    scene.render.film_transparent=True
    scene.render.image_settings.color_mode='RGBA'
    for obj in scene.objects:
        if obj.type=='MESH' and obj.parent!=rig:
            obj.hide_render=True
    rig.animation_data.action=actions['idle']
    scene.frame_set(1)
    bpy.context.view_layer.update()
    deps=bpy.context.evaluated_depsgraph_get()
    head_points=[]
    foot_points=[]
    for obj in rig.children:
        if obj.type!='MESH': continue
        ev=obj.evaluated_get(deps)
        head_id=obj.vertex_groups['head'].index
        feet={obj.vertex_groups[n].index for n in ['foot.R','foot.L']}
        for v in ev.data.vertices:
            groups={g.group for g in v.groups if g.weight>.5}
            q=world_to_camera_view(scene,scene.camera,ev.matrix_world@v.co)
            if head_id in groups: head_points.append((q.x*480,(1-q.y)*480))
            if feet.intersection(groups): foot_points.append((q.x*480,(1-q.y)*480))
    anchor=world_to_camera_view(scene,scene.camera,Vector((0,0,0)))
    (out/'sprite-projection.json').write_text(json.dumps({
        'anchorPixels':[anchor.x*480,(1-anchor.y)*480],
        'standingBodyHeightPixels':max(y for x,y in foot_points)-min(y for x,y in head_points),
        'headTopPixels':min(y for x,y in head_points),
        'camera':list(scene.camera.location),'resolution':480,
        'method':'One fixed scale and projected world-origin anchor for every pose'},indent=2))
metrics={'openedWith':bpy.app.version_string,'clips':{},'externalTextures':0}
for name,clip in manifest['clips'].items():
    rig.animation_data.action=actions[name]
    folder=out/name
    folder.mkdir(exist_ok=True)
    minima={}
    motion=[]
    for frame in range(1,clip['frames']+1):
        scene.frame_set(frame)
        deps=bpy.context.evaluated_depsgraph_get()
        # Actual evaluated mesh vertices, including bevels and skin deformation.
        low=100
        for obj in rig.children:
            if obj.type!='MESH': continue
            ev=obj.evaluated_get(deps)
            mw=ev.matrix_world
            z=min((mw@v.co).z for v in ev.data.vertices)
            if z<low:
                low=z
                lowest=obj.name
        minima[frame]={'z':round(low,5),'part':lowest}
        assert low>=-.01, ('Mesh penetrates the presentation platform',name,frame,lowest,low)
        for pb in rig.pose.bones:
            assert all(math.isfinite(x) for row in pb.matrix for x in row), (name,frame,pb.name)
        motion.append({
            'hip':rig.pose.bones['pelvis'].matrix.translation.copy(),
            'hipQ':rig.pose.bones['pelvis'].matrix.to_quaternion(),
            'chestQ':rig.pose.bones['chest'].matrix.to_quaternion(),
            'footR':rig.pose.bones['foot.R'].matrix.translation.copy(),
            'footL':rig.pose.bones['foot.L'].matrix.translation.copy(),
            'leftFist':(rig.pose.bones['hand.L'].tail-rig.pose.bones['hand.L'].head).normalized(),
            'leftForearm':(rig.pose.bones['forearm.L'].tail-rig.pose.bones['forearm.L'].head).normalized(),
            'leftForward':Vector((math.sin(rig.pose.bones['chest'].matrix.to_euler().z),
                                 -math.cos(rig.pose.bones['chest'].matrix.to_euler().z),0)),
        })
        if manifest.get('offHand') and name in ['idle','attack1','attack2']:
            fist=motion[-1]['leftFist']
            assert fist.z>=0, (name,frame,'Off-hand fist points down',tuple(fist))
            assert fist.dot(motion[-1]['leftForearm'])>.70, (name,frame,'Bent off-hand wrist')
        if not a.validate_only and frame in clip['renderedFrames']:
            scene.render.filepath=str(folder/('%03d.png'%frame))
            bpy.ops.render.render(write_still=True)
            print('PREVIEW',name,frame,flush=True)
    first=motion[0]
    whole_body={
        'pelvisTravelMeters':max((f['hip']-first['hip']).length for f in motion),
        'pelvisRotationRadians':max(f['hipQ'].rotation_difference(first['hipQ']).angle for f in motion),
        'chestRotationRadians':max(f['chestQ'].rotation_difference(first['chestQ']).angle for f in motion),
        'footTravelMeters':max(max((f[k]-first[k]).length for f in motion) for k in ['footR','footL']),
    }
    off_hand={
        'minimumForwardDot':min(f['leftFist'].dot(f['leftForward']) for f in motion),
        'minimumForearmDot':min(f['leftFist'].dot(f['leftForearm']) for f in motion),
        'minimumFistZ':min(f['leftFist'].z for f in motion),
    }
    if manifest.get('offHand') and name in ['idle','attack1','attack2']:
        assert off_hand['minimumForwardDot']>.8, (name,'Off-hand fist faces away',off_hand)
    if manifest.get('revision',1)>=2 and name in ['attack1','attack2']:
        assert whole_body['pelvisTravelMeters']>.15, (name,'No weight transfer',whole_body)
        assert whole_body['pelvisRotationRadians']>.4, (name,'No hip turn',whole_body)
        assert whole_body['chestRotationRadians']>.75, (name,'No torso turn',whole_body)
        assert whole_body['footTravelMeters']>.25, (name,'No full-body step',whole_body)
    metrics['clips'][name]={'frames':clip['frames'],'minimumZ':min(x['z'] for x in minima.values()),
                            'perFrameFloor':minima,'wholeBody':whole_body,'offHand':off_hand}
if not a.validate_only and not a.sprite_preview:
    rig.animation_data.action=actions['idle']
    scene.frame_set(1)
    folder=out/'turntable'
    folder.mkdir(exist_ok=True)
    camera=scene.camera
    original=camera.location.copy()
    for i in range(24):
        angle=math.tau*i/24
        camera.location=(7*math.sin(angle),-7*math.cos(angle),4.4)
        camera.rotation_euler=(Vector((0,0,1.45))-camera.location).to_track_quat('-Z','Y').to_euler()
        scene.render.filepath=str(folder/('%03d.png'%i))
        bpy.ops.render.render(write_still=True)
        print('PREVIEW turntable',i,flush=True)
    camera.location=original
(out/'validation.json').write_text(json.dumps(metrics,indent=2),encoding='utf-8')
print('VALIDATION',json.dumps({k:v['minimumZ'] for k,v in metrics['clips'].items()}),flush=True)
print('RENDER_COMPLETE',flush=True)
