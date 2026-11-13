"""Transparent 1080x1080 portrait of the BOSS5 GLB (Walk first frame, slight 3/4 view, centred on the mask).
blender -b -P render_portrait.py -- boss5.glb out.png"""
import bpy, sys, math
from mathutils import Vector
argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
sc = bpy.context.scene
sc.frame_set(1)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
walk = bpy.data.actions.get('Walk')
if walk:
    arm.animation_data_create()
    arm.animation_data.action = walk
    sc.frame_set(0)
bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get()
mesh = next(o for o in bpy.data.objects if o.type == 'MESH')
ev = mesh.evaluated_get(dg)
pts = [ev.matrix_world @ Vector(c) for c in ev.bound_box]
mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
# the evaluated bound_box is the rest box; use the real skinned vertices instead
me = ev.to_mesh()
vs = [ev.matrix_world @ v.co for v in me.vertices if True]
vs = [v for v in vs if v.z > 0.3]            # skip nothing meaningful, just numeric safety
mn = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
mx = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
c = (mn + mx) / 2
print('BBOX', tuple(round(x, 3) for x in mn), tuple(round(x, 3) for x in mx))
sc.render.engine = 'BLENDER_EEVEE'
sc.render.resolution_x = sc.render.resolution_y = 1080
sc.render.film_transparent = True
sc.render.image_settings.file_format = 'PNG'
sc.render.image_settings.color_mode = 'RGBA'
sc.view_settings.view_transform = 'Standard'
w = bpy.data.worlds.new('w')
sc.world = w
w.use_nodes = True
w.node_tree.nodes['Background'].inputs[0].default_value = (0.55, 0.5, 0.58, 1)
w.node_tree.nodes['Background'].inputs[1].default_value = 1.1
sun = bpy.data.lights.new('s', type='SUN')
sun.energy = 3.2
so = bpy.data.objects.new('s', sun)
sc.collection.objects.link(so)
so.rotation_euler = (math.radians(55), 0, math.radians(-35))
fill = bpy.data.lights.new('f', type='SUN')
fill.energy = 1.0
fo = bpy.data.objects.new('f', fill)
sc.collection.objects.link(fo)
fo.rotation_euler = (math.radians(70), 0, math.radians(150))
cd = bpy.data.cameras.new('c')
cd.type = 'ORTHO'
cam = bpy.data.objects.new('c', cd)
sc.collection.objects.link(cam)
sc.camera = cam
yaw = math.radians(-22)      # slightly from the character's right front
dist = 20
cam.location = c + Vector((math.sin(yaw) * dist, -math.cos(yaw) * dist, 1.2))
cam.rotation_euler = (c - cam.location).to_track_quat('-Z', 'Y').to_euler()
cd.ortho_scale = max(mx.z - mn.z, mx.x - mn.x) * 1.12
sc.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print('PORTRAIT', OUT)
