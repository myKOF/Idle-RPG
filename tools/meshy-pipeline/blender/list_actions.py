"""List armatures, bones and actions (with frame ranges and fps) of one or more files.

Usage:
  blender --background --python list_actions.py -- <report.json> <file> [<file> ...]
"""
import json
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1:]
report_path, files = argv[0], argv[1:]
out = {}

for f in files:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if f.lower().endswith((".glb", ".gltf")):
        bpy.ops.import_scene.gltf(filepath=f)
    else:
        bpy.ops.import_scene.fbx(filepath=f)
    arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    skinned = [o for o in bpy.data.objects if o.type == "MESH" and len(o.vertex_groups) > 0]
    out[f] = {
        "fps": bpy.context.scene.render.fps,
        "armatures": [{"name": a.name, "bones": len(a.data.bones)} for a in arms],
        "skinnedMeshes": [{"name": m.name, "verts": len(m.data.vertices)} for m in skinned],
        "actions": [
            {"name": a.name, "start": round(a.frame_range[0], 2), "end": round(a.frame_range[1], 2),
             "frames": round(a.frame_range[1] - a.frame_range[0] + 1, 2), "fcurves": len(a.fcurves)}
            for a in bpy.data.actions
        ],
        "boneNames": sorted(b.name for a in arms for b in a.data.bones),
    }

with open(report_path, "w", encoding="utf-8") as fh:
    json.dump(out, fh, indent=2)
print("LIST_DONE", len(files))
