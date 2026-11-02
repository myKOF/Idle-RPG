"""Blender: shorten the current hero sword without re-exporting animation/skin buffers.

blender -b --python shorten-sword.py -- input.glb output.glb editable.blend report.json
The input must be the unshortened grips36 revision (recorded in the asset library).
"""
import hashlib
import json
import struct
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


def sha(data):
    return hashlib.sha256(data).hexdigest()


src, dst, blend, report = map(Path, sys.argv[sys.argv.index("--") + 1:])
original = src.read_bytes()
data = bytearray(original)
json_len = struct.unpack_from("<I", data, 12)[0]
gltf = json.loads(data[20:20 + json_len])
bin_start = 28 + json_len


def accessor(index):
    a = gltf["accessors"][index]
    view = gltf["bufferViews"][a["bufferView"]]
    count = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}[a["type"]]
    fmt = {5121: "B", 5123: "H", 5125: "I", 5126: "f"}[a["componentType"]]
    width = struct.calcsize(fmt) * count
    offset = bin_start + view.get("byteOffset", 0) + a.get("byteOffset", 0)
    stride = view.get("byteStride", width)
    return [struct.unpack_from("<" + fmt * count, data, offset + i * stride)
            for i in range(a["count"])], offset, stride


prim = gltf["meshes"][0]["primitives"][0]
pos, offset, stride = accessor(prim["attributes"]["POSITION"])
joints, _, _ = accessor(prim["attributes"]["JOINTS_0"])
weights, _, _ = accessor(prim["attributes"]["WEIGHTS_0"])
skin = gltf["skins"][0]
sword = next(i for i, n in enumerate(skin["joints"]) if gltf["nodes"][n]["name"] == "Sword")
ibm, _, _ = accessor(skin["inverseBindMatrices"])
inv = Matrix([ibm[sword][i:i + 4] for i in range(0, 16, 4)]).transposed()
bind = inv.inverted()
local = {i: inv @ Vector(p) for i, p in enumerate(pos)
         if sum(w for j, w in zip(joints[i], weights[i]) if j == sword) > 0.999}
low = min(p.y for p in local.values())
high = max(p.y for p in local.values())
# Existing sword construction defines the blade root in Sword bind coordinates.
root = 23.0
target = high - (high - low) * 0.10
factor = (target - root) / (high - root)
assert 0 < factor < 1

# Author the edit with Blender mesh vertices; retain the original glTF vertex order.
bpy.ops.wm.read_factory_settings(use_empty=True)
mesh = bpy.data.meshes.new("SwordLengthEdit")
mesh.from_pydata(pos, [], [])
changed = []
for i, p in local.items():
    if p.y <= root:
        continue
    p.y = root + (p.y - root) * factor
    mesh.vertices[i].co = bind @ p
    struct.pack_into("<3f", data, offset + i * stride, *mesh.vertices[i].co)
    changed.append(i)

allowed = {offset + i * stride + k for i in changed for k in range(12)}
assert all(a == b or i in allowed for i, (a, b) in enumerate(zip(original, data)))
new_local = {i: inv @ Vector(struct.unpack_from("<3f", data, offset + i * stride)) for i in local}
new_low = min(p.y for p in new_local.values())
new_high = max(p.y for p in new_local.values())
ratio = (new_high - new_low) / (high - low)
assert abs(ratio - 0.9) < 1e-6
assert max(abs(new_local[i][k] - p[k]) for i, p in local.items() for k in (0, 2)) < 1e-4
dst.parent.mkdir(parents=True, exist_ok=True)
dst.write_bytes(data)
bpy.data.meshes.remove(mesh)

# Keep the complete textured, rigged result editable, with all imported actions.
bpy.ops.import_scene.gltf(filepath=str(dst))
for obj in bpy.context.scene.objects:
    obj["sword_length_ratio"] = ratio
    obj["sword_length_source_sha256"] = sha(original)
bpy.ops.wm.save_as_mainfile(filepath=str(blend))
result = {"inputSha256": sha(original), "outputSha256": sha(data),
          "changedVertices": len(changed), "swordMin": low, "swordMaxBefore": high,
          "swordMaxAfter": new_high, "totalLengthRatio": ratio, "bladeRoot": root,
          "bladeLengthRatio": factor, "unchangedOutsideBladePositions": True,
          "animations": [a["name"] for a in gltf["animations"]],
          "blenderVersion": bpy.app.version_string}
report.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
print(json.dumps(result))
