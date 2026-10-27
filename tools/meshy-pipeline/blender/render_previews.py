"""Render still previews of a model from several directions (Workbench, works headless).

Usage:
  blender --background --python render_previews.py -- <model> <outDir> [size]
Writes view_<name>.png for front, right, back, left and a 3/4 view.
"""
import math
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
model, out_dir = argv[0], argv[1]
size = int(argv[2]) if len(argv) > 2 else 768

bpy.ops.wm.read_factory_settings(use_empty=True)
if model.lower().endswith((".glb", ".gltf")):
    bpy.ops.import_scene.gltf(filepath=model)
else:
    bpy.ops.import_scene.fbx(filepath=model)

# the glTF importer adds bone-shape helper meshes (no skin weights) when a rig has joints; ignore them
for o in list(bpy.data.objects):
    if o.type == "MESH" and len(o.vertex_groups) == 0 and any(x.type == "ARMATURE" for x in bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
lo = Vector((min(p[i] for p in pts) for i in range(3)))
hi = Vector((max(p[i] for p in pts) for i in range(3)))
center = (lo + hi) / 2
extent = max(hi - lo)

scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.render.resolution_x = scene.render.resolution_y = size
scene.render.film_transparent = False
shading = scene.display.shading
shading.light = "FLAT"
shading.color_type = "TEXTURE"
shading.show_cavity = False
scene.world = bpy.data.worlds.new("w")
scene.world.color = (0.18, 0.19, 0.22)

cam_data = bpy.data.cameras.new("cam")
cam_data.type = "ORTHO"
cam_data.ortho_scale = extent * 1.15
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam

# glTF faces +Y in Blender after import (-Y is the front). yaw is degrees around Z.
views = {"front": 0, "right": 90, "back": 180, "left": 270, "three_quarter": 40}
dist = extent * 3
for name, yaw in views.items():
    a = math.radians(yaw)
    elev = math.radians(20 if name == "three_quarter" else 0)
    cam.location = center + Vector((math.sin(a) * math.cos(elev), -math.cos(a) * math.cos(elev), math.sin(elev))) * dist
    direction = center - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = f"{out_dir}/view_{name}.png"
    bpy.ops.render.render(write_still=True)
print("RENDER_DONE", list(views))
