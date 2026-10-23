"""Reopen a finished Blender candidate, render its skeletal clips and turntable."""
import argparse
import json
import math
import sys
from pathlib import Path
import bpy
from mathutils import Vector

p=argparse.ArgumentParser()
p.add_argument('--model',required=True)
p.add_argument('--preview',required=True)
p.add_argument('--validate-only',action='store_true')
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
metrics={'openedWith':bpy.app.version_string,'clips':{},'externalTextures':0}
for name,clip in manifest['clips'].items():
    rig.animation_data.action=actions[name]
    folder=out/name
    folder.mkdir(exist_ok=True)
    minima={}
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
        if not a.validate_only and frame in clip['renderedFrames']:
            scene.render.filepath=str(folder/('%03d.png'%frame))
            bpy.ops.render.render(write_still=True)
            print('PREVIEW',name,frame,flush=True)
    metrics['clips'][name]={'frames':clip['frames'],'minimumZ':min(x['z'] for x in minima.values()),
                            'perFrameFloor':minima}
if not a.validate_only:
    rig.animation_data.action=actions['idle']
    scene.frame_set(1)
    folder=out/'turntable'
    folder.mkdir(exist_ok=True)
    camera=scene.camera
    original=camera.location.copy()
    for i in range(24):
        angle=math.tau*i/24
        camera.location=(7*math.sin(angle),-7*math.cos(angle),3.4)
        camera.rotation_euler=(Vector((0,0,1.25))-camera.location).to_track_quat('-Z','Y').to_euler()
        scene.render.filepath=str(folder/('%03d.png'%i))
        bpy.ops.render.render(write_still=True)
        print('PREVIEW turntable',i,flush=True)
    camera.location=original
(out/'validation.json').write_text(json.dumps(metrics,indent=2),encoding='utf-8')
print('VALIDATION',json.dumps({k:v['minimumZ'] for k,v in metrics['clips'].items()}),flush=True)
print('RENDER_COMPLETE',flush=True)
