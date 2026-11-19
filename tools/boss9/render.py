"""Render actual authored geometry for visual review (no mockups)."""
import bpy,sys,math,json
from pathlib import Path
from mathutils import Vector
source,out=map(Path,sys.argv[sys.argv.index('--')+1:][:2]);out.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(source))
sc=bpy.context.scene;arm=next(o for o in sc.objects if o.type=='ARMATURE')
sc.render.engine='BLENDER_WORKBENCH'
sc.display.shading.light='STUDIO';sc.display.shading.color_type='TEXTURE'
sc.display.shading.show_shadows=True;sc.display.shading.show_cavity=True
sc.display.shading.background_type='WORLD';sc.world.color=(.035,.045,.065)
sc.render.resolution_x=1100;sc.render.resolution_y=900;sc.render.resolution_percentage=100
sc.render.image_settings.file_format='PNG'
camdata=bpy.data.cameras.new('ReviewCamera');camdata.type='ORTHO';camdata.ortho_scale=10.8
cam=bpy.data.objects.new('ReviewCamera',camdata);sc.collection.objects.link(cam);sc.camera=cam
target=Vector((0,0,3.6));cam.location=target+Vector((10,-14,8));cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler()
for clip,seconds in [('Walk',0),('Walk',.4),('Walk',.8),('Attack1',.46),('Attack1',.62),('Attack2',.30),('Attack2',.59),('Attack3',1.1),('Die',.4),('Die',1.4),('Die',2.5)]:
    action=bpy.data.actions[clip];arm.animation_data.action=action;arm.animation_data.action_slot=action.slots[0]
    f=seconds*60;sc.frame_set(math.floor(f),subframe=f%1)
    sc.render.filepath=str(out/(clip+'_'+str(seconds)+'.png'));bpy.ops.render.render(write_still=True)
action=bpy.data.actions['Attack1'];arm.animation_data.action=action;arm.animation_data.action_slot=action.slots[0];sc.frame_set(28)
target=arm.matrix_world@arm.pose.bones['Head'].head;camdata.ortho_scale=2.6
cam.location=target+Vector((10,-4,0));cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler()
sc.render.filepath=str(out/'Jaw.png');bpy.ops.render.render(write_still=True)
