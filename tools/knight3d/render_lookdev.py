"""Reopen and render only the static armor candidate; no action playback."""
import argparse,json,math,sys
from pathlib import Path
import bpy
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

p=argparse.ArgumentParser()
p.add_argument('--model',required=True)
p.add_argument('--preview',required=True)
a=p.parse_args(sys.argv[sys.argv.index('--')+1:])
root=Path(a.preview).resolve();root.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(Path(a.model).resolve()))
scene=bpy.context.scene;rig=bpy.data.objects['KNIGHT_RIG']
assert len(rig.data.bones)==17
assert not bpy.data.actions,'Static shape review must not introduce animation'
assert not rig.animation_data.action
body=next(o for o in rig.children if o.type=='MESH')
deps=bpy.context.evaluated_depsgraph_get();ev=body.evaluated_get(deps)
world=[ev.matrix_world@v.co for v in ev.data.vertices]
minimum=min(v.z for v in world)
assert minimum>=-.001,('Below floor',minimum)
metrics={'static':True,'bonesInEditableBlend':17,'actions':0,'minimumMeshZ':minimum,'hands':{}}
for side in ['R','L']:
    fore=rig.pose.bones['forearm.'+side];hand=rig.pose.bones['hand.'+side]
    arm=(fore.tail-fore.head).normalized();wrist=(hand.tail-hand.head).normalized()
    down=(rig.pose.bones['upper_arm.'+side].tail-rig.pose.bones['upper_arm.'+side].head).normalized()
    dot=arm.dot(wrist)
    assert dot>.999,('Bent wrist',side,dot)
    assert down.z<-.60,('Upper arm is raised',side,tuple(down))
    metrics['hands'][side]={'wristForearmDot':dot,'upperArmDownDot':-down.z}
weapon=rig.pose.bones['weapon.R'];hand=rig.pose.bones['hand.R']
blade=(weapon.tail-weapon.head).normalized();wrist=(hand.tail-hand.head).normalized()
assert abs(blade.dot(wrist))<.01,'Blade must cross the grip, not replace the forearm direction'
metrics['bladeWristDot']=blade.dot(wrist)
metrics['staticWristTargetMiss']=rig['static_wrist_target_miss']
assert metrics['staticWristTargetMiss']<1e-5
for pb in rig.pose.bones:
    assert all(math.isfinite(x) for row in pb.matrix for x in row)
try:
    prefs=bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type='CUDA';prefs.get_devices()
    for d in prefs.devices:d.use=d.type=='CUDA'
    scene.cycles.device='GPU' if any(d.use for d in prefs.devices) else 'CPU'
except Exception:scene.cycles.device='CPU'
scene.render.resolution_x=720;scene.render.resolution_y=720
scene.render.resolution_percentage=100;scene.cycles.samples=48
scene.cycles.use_denoising=True
scene.render.film_transparent=True;scene.render.image_settings.color_mode='RGBA'
for o in scene.objects:
    if o.type=='MESH' and o!=body:o.hide_render=True
camera=scene.camera;camera.data.ortho_scale=3.55
metrics['views']={}
for name,loc in [('reference',(0,-8.6,7.4)),('front',(0,-8.6,4.3)),
                 ('side',(8.6,0,4.3)),('back',(0,8.6,4.3))]:
    camera.location=loc
    camera.rotation_euler=(Vector((0,-.03,1.22))-camera.location).to_track_quat('-Z','Y').to_euler()
    bpy.context.view_layer.update()
    points={}
    for group in ['head','foot.R','foot.L','hand.R','hand.L','upper_arm.R','upper_arm.L']:
        index=body.vertex_groups[group].index
        coords=[world_to_camera_view(scene,camera,ev.matrix_world@v.co)
            for v in ev.data.vertices if any(g.group==index and g.weight>.5 for g in v.groups)]
        points[group]=[min(q.x for q in coords)*720,min(1-q.y for q in coords)*720,
                       max(q.x for q in coords)*720,max(1-q.y for q in coords)*720]
    feet=[rig.pose.bones['foot.'+s].matrix.translation for s in ['R','L']]
    contacts=[]
    for foot in feet:
        foot=foot.copy();foot.y-=.15;foot.z=0
        q=world_to_camera_view(scene,camera,foot);contacts.append([q.x*720,(1-q.y)*720])
    metrics['views'][name]={'groups':points,'contacts':contacts}
    scene.render.filepath=str(root/(name+'.png'))
    bpy.ops.render.render(write_still=True)
    print('LOOKDEV_VIEW',name,flush=True)
(root/'static-validation.json').write_text(json.dumps(metrics,indent=2),encoding='utf8')
print('LOOKDEV_STATIC_PASS',json.dumps(metrics['hands']),flush=True)
