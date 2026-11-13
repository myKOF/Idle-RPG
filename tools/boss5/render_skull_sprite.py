"""Side-on 256x256 transparent sprite of the green mini skull (face pointing to +X on screen, as VFX projectiles face +X).
blender -b -P render_skull_sprite.py -- boss5_skull.glb out.png"""
import bpy, sys, math
from mathutils import Vector
argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
sc = bpy.context.scene
sc.render.engine = 'BLENDER_EEVEE'
sc.render.resolution_x = sc.render.resolution_y = 256
sc.render.film_transparent = True
sc.render.image_settings.file_format = 'PNG'
sc.render.image_settings.color_mode = 'RGBA'
sc.view_settings.view_transform = 'Standard'
w = bpy.data.worlds.new('w')
sc.world = w
w.use_nodes = True
w.node_tree.nodes['Background'].inputs[0].default_value = (0.5, 0.6, 0.5, 1)
w.node_tree.nodes['Background'].inputs[1].default_value = 1.0
sun = bpy.data.lights.new('s', type='SUN')
sun.energy = 2.5
so = bpy.data.objects.new('s', sun)
sc.collection.objects.link(so)
so.rotation_euler = (math.radians(55), 0, math.radians(-40))
mesh = next(o for o in bpy.data.objects if o.type == 'MESH')
vs = [mesh.matrix_world @ v.co for v in mesh.data.vertices]
mn = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
mx = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
c = (mn + mx) / 2
cd = bpy.data.cameras.new('c')
cd.type = 'ORTHO'
cam = bpy.data.objects.new('c', cd)
sc.collection.objects.link(cam)
sc.camera = cam
a = math.radians(28)
cam.location = c + Vector((-math.cos(a) * 10, -math.sin(a) * 10, 0.6))
cam.rotation_euler = (c - cam.location).to_track_quat('-Z', 'Y').to_euler()
cd.ortho_scale = max(mx.x - mn.x, mx.y - mn.y, mx.z - mn.z) * 1.15
sc.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print('SPRITE', OUT)
