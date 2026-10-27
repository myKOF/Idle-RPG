"""Render every action of a rigged file to a PNG sequence (Workbench, headless).

Usage:
  blender --background --python render_clips.py -- <file> <outDir> [size] [rename.json]
Writes <outDir>/<ClipName>/f0001.png ... and <outDir>/<ClipName>/info.json (frames, fps).
Camera is fixed for all clips so motion (lunges, falls) stays readable.
"""
import json
import math
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
model, out_dir = argv[0], argv[1]
size = int(argv[2]) if len(argv) > 2 else 480
rename = json.loads(open(argv[3], encoding="utf-8").read()) if len(argv) > 3 else {}

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=model)
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
# helper meshes without skin weights (bone display shapes) must not be rendered
for o in list(bpy.data.objects):
    if o.type == "MESH" and len(o.vertex_groups) == 0:
        bpy.data.objects.remove(o, do_unlink=True)

if "--fix" in argv:
    sys.path.insert(0, __import__("os").path.dirname(__file__))
    import skin_fix
    skinned = next(o for o in bpy.data.objects if o.type == "MESH" and len(o.vertex_groups) > 0)
    print("SKIN_FIX", skin_fix.apply(skinned, arm))

scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.render.resolution_x = scene.render.resolution_y = size
scene.render.image_settings.file_format = "PNG"
sh = scene.display.shading
sh.light = "FLAT"  # texture colors as painted; STUDIO lighting made the gold read dark
sh.color_type = "TEXTURE"
sh.show_cavity = False
sh.show_object_outline = True
sh.object_outline_color = (0.05, 0.05, 0.05)
scene.world = bpy.data.worlds.new("w")
scene.world.color = (0.30, 0.32, 0.36)

# ground with a grid so sliding feet and falls are readable
img = bpy.data.images.new("grid", 512, 512)
px = []
for y in range(512):
    for x in range(512):
        v = 0.62 if ((x // 32) + (y // 32)) % 2 == 0 else 0.48  # 0.5 m squares on the 8 m plane
        px += [v, v, v + 0.02, 1.0]
img.pixels = px
mat = bpy.data.materials.new("floor")
mat.use_nodes = True
tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
tex.image = img
mat.node_tree.links.new(tex.outputs["Color"], mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"])
bpy.ops.mesh.primitive_plane_add(size=8, location=(0, 0, -0.005))
floor = bpy.context.object
floor.data.materials.append(mat)

cam_data = bpy.data.cameras.new("cam")
cam_data.type = "ORTHO"
cam_data.ortho_scale = 2.5
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
yaw, elev, dist = math.radians(35), math.radians(22), 8
target = Vector((0, 0, 0.9))
cam.location = target + Vector((math.sin(yaw) * math.cos(elev), -math.cos(yaw) * math.cos(elev), math.sin(elev))) * dist
cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()

ad = arm.animation_data or arm.animation_data_create()
info = {}
for action in list(bpy.data.actions):
    if action.name in rename and rename[action.name] is None:
        continue  # a null in the rename map skips the action
    name = rename.get(action.name, action.name).replace("|", "_")
    if name == "Armature_clip0_baselayer":
        continue  # rest pose only
    ad.action = action
    if hasattr(action, "slots") and len(action.slots):
        ad.action_slot = action.slots[0]
    start, end = int(math.floor(action.frame_range[0])), int(math.ceil(action.frame_range[1]))
    scene.frame_start, scene.frame_end = start, end
    count = 0
    for n, fr in enumerate(range(start, end + 1), 1):
        scene.frame_set(fr)
        scene.render.filepath = f"{out_dir}/{name}/f{n:04d}.png"
        bpy.ops.render.render(write_still=True)
        count += 1
    info[name] = {"frames": count, "fps": scene.render.fps, "action": action.name}
    with open(f"{out_dir}/{name}/info.json", "w", encoding="utf-8") as fh:
        json.dump(info[name], fh)
print("CLIPS_DONE", json.dumps(info))
