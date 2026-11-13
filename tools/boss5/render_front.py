# Render the original mask from the front in orthographic, flat albedo -> front_albedo.png (1024, x,z in [-1,1])
import bpy, math, sys, os
argv=sys.argv[sys.argv.index('--')+1:]
src,out=argv
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
sc=bpy.context.scene
sc.render.engine='BLENDER_WORKBENCH'
sc.render.resolution_x=sc.render.resolution_y=1024
sc.render.film_transparent=True
sc.render.image_settings.file_format='PNG'; sc.render.image_settings.color_mode='RGBA'
sc.view_settings.view_transform='Standard'
sh=sc.display.shading; sh.light='FLAT'; sh.color_type='TEXTURE'; sh.show_cavity=False; sh.show_object_outline=False
sc.display.render_aa='OFF'
cd=bpy.data.cameras.new('c'); cd.type='ORTHO'; cd.ortho_scale=2.0
cam=bpy.data.objects.new('c',cd); sc.collection.objects.link(cam); sc.camera=cam
cam.location=(0,-5,0); cam.rotation_euler=(math.radians(90),0,0)
sc.render.filepath=out; bpy.ops.render.render(write_still=True)
