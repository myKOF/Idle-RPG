"""Inspect a GLB/FBX in Blender background mode and print a JSON report.

Usage:
  blender --background --python inspect_model.py -- <model> <report.json> [hardMax] [softMax]
"""
import json
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1:]
model, report_path = argv[0], argv[1]
hard_max = int(argv[2]) if len(argv) > 2 else 6000
soft_max = int(argv[3]) if len(argv) > 3 else 5000

bpy.ops.wm.read_factory_settings(use_empty=True)
if model.lower().endswith((".glb", ".gltf")):
    bpy.ops.import_scene.gltf(filepath=model)
else:
    bpy.ops.import_scene.fbx(filepath=model)

# the glTF importer adds bone-shape helper meshes (no skin weights) when a rig has joints; ignore them
has_rig = any(o.type == "ARMATURE" for o in bpy.data.objects)
meshes = [o for o in bpy.data.objects if o.type == "MESH" and not (has_rig and len(o.vertex_groups) == 0)]
armatures = [o for o in bpy.data.objects if o.type == "ARMATURE"]

tris = 0
for o in meshes:
    me = o.data
    me.calc_loop_triangles()
    tris += len(me.loop_triangles)

bones = [b.name for a in armatures for b in a.data.bones]
actions = [{"name": a.name, "frames": [round(a.frame_range[0]), round(a.frame_range[1])]} for a in bpy.data.actions]

bbox = None
try:
    from mathutils import Vector
    pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    if pts:
        bbox = {"min": [min(p[i] for p in pts) for i in range(3)], "max": [max(p[i] for p in pts) for i in range(3)]}
except Exception:
    pass

if tris > hard_max:
    poly_status = "FAIL"
elif tris > soft_max:
    poly_status = "WARN"
else:
    poly_status = "PASS"

report = {
    "model": model,
    "triangles": tris,
    "polyStatus": poly_status,
    "meshCount": len(meshes),
    "armatureCount": len(armatures),
    "boneCount": len(bones),
    "bones": bones,
    "actions": actions,
    "materials": len(bpy.data.materials),
    "images": [{"name": i.name, "size": list(i.size)} for i in bpy.data.images],
    "bbox": bbox,
}
with open(report_path, "w", encoding="utf-8") as f:
    json.dump(report, f, indent=2)
print("INSPECT_DONE", poly_status, tris)
