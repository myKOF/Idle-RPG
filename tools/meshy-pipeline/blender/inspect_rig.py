"""Inspect a rigged GLB: bone hierarchy, mesh islands and per-region skin weights.

Usage:
  blender --background --python inspect_rig.py -- <rigged.glb> <report.json>

Regions are derived from geometry, not from names, so the check works for any character:
  islands        connected mesh pieces (a weapon that does not touch the body is its own island)
  behind_lower   vertices behind the torso and below the hips (cloth that can drag with the legs)
"""
import json
import sys
from collections import defaultdict

import bmesh
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
model, report_path = argv[0], argv[1]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=model)

arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
# helper meshes without skin weights (e.g. bone display shapes) must not skew the measurements
meshes = [o for o in bpy.data.objects if o.type == "MESH" and len(o.vertex_groups) > 0]


def depth(bone):
    d = 0
    while bone.parent:
        bone, d = bone.parent, d + 1
    return d


bones = [{"name": b.name, "parent": b.parent.name if b.parent else None, "depth": depth(b)} for b in arm.data.bones]
report = {"model": model, "bones": bones, "boneCount": len(bones), "meshes": []}

pts_all = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
lo = Vector((min(p[i] for p in pts_all) for i in range(3)))
hi = Vector((max(p[i] for p in pts_all) for i in range(3)))
height = hi.z - lo.z
report["bbox"] = {"min": list(lo), "max": list(hi), "height": height}

for o in meshes:
    me = o.data
    gname = {g.index: g.name for g in o.vertex_groups}
    verts = [o.matrix_world @ v.co for v in me.vertices]
    weights = []
    for v in me.vertices:
        w = defaultdict(float)
        for g in v.groups:
            w[gname.get(g.group, str(g.group))] += g.weight
        weights.append(w)

    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    seen, islands = set(), []
    for v in bm.verts:
        if v.index in seen:
            continue
        stack, comp = [v], []
        seen.add(v.index)
        while stack:
            cur = stack.pop()
            comp.append(cur.index)
            for e in cur.link_edges:
                n = e.other_vert(cur)
                if n.index not in seen:
                    seen.add(n.index)
                    stack.append(n)
        islands.append(comp)
    bm.free()

    def summarize(idx):
        acc = defaultdict(float)
        for i in idx:
            top = max(weights[i].items(), key=lambda kv: kv[1])[0] if weights[i] else "(none)"
            acc[top] += 1
        total = sum(acc.values()) or 1
        top5 = sorted(acc.items(), key=lambda kv: -kv[1])[:5]
        return [{"bone": k, "share": round(v / total, 3)} for k, v in top5]

    def bbox(idx):
        ps = [verts[i] for i in idx]
        return {"min": [round(min(p[k] for p in ps), 3) for k in range(3)], "max": [round(max(p[k] for p in ps), 3) for k in range(3)]}

    unweighted = sum(1 for w in weights if not w)
    isl = sorted(islands, key=len, reverse=True)
    mesh_rep = {
        "name": o.name, "vertexCount": len(verts), "unweightedVertices": unweighted,
        "islands": [{"vertices": len(c), "bbox": bbox(c), "dominantBones": summarize(c)} for c in isl[:8]],
        "islandCount": len(isl),
    }

    # cloth behind the body below the hips: body depth is the median y of the torso band
    mid_z = lo.z + height * 0.65
    torso = [p.y for p in verts if abs(p.z - mid_z) < height * 0.05]
    back_y = (sorted(torso)[len(torso) // 2] if torso else 0) + height * 0.10
    lower = [i for i, p in enumerate(verts) if p.y > back_y and lo.z + height * 0.15 < p.z < lo.z + height * 0.50]
    mesh_rep["behind_lower"] = {"vertices": len(lower), "dominantBones": summarize(lower) if lower else []}
    # held item: vertices hanging below a hand, off to the side of the body
    held = {}
    for side in ("Left", "Right"):
        hb = arm.data.bones.get(f"{side}Hand")
        if not hb:
            continue
        hp = arm.matrix_world @ hb.head_local
        idx = [i for i, p in enumerate(verts) if p.z < hp.z - 0.08 and abs(p.x - hp.x) < 0.15 and abs(p.x) > 0.35]
        held[side + "Hand"] = {"vertices": len(idx), "dominantBones": summarize(idx) if idx else []}
    mesh_rep["held_below_hand"] = held
    mesh_rep["torso_back_y"] = round(back_y, 3)
    report["meshes"].append(mesh_rep)

with open(report_path, "w", encoding="utf-8") as f:
    json.dump(report, f, indent=2)
print("RIG_INSPECT_DONE", len(bones), "bones")
