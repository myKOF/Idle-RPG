"""Verify the formal gargoyle source, final tail rig and all retargeted actions.

blender -b --python-exit-code 1 -P verify_game.py -- FORMAL.blend USER.glb REPORT.json
"""
import bpy
import json
import math
import sys
from pathlib import Path
from mathutils import Vector

blend, source, report_file = map(Path, sys.argv[sys.argv.index('--') + 1:])
bpy.ops.wm.open_mainfile(filepath=str(blend))
scene = bpy.context.scene
arm = next(o for o in scene.objects if o.type == 'ARMATURE')
body = next(o for o in scene.objects if o.type == 'MESH' and o.vertex_groups)
assert scene.render.fps == 150
durations = {'Walk': 1.6, 'Attack1': 2.6/1.5, 'Attack2': 2.08, 'Attack3': 2.4, 'Die': 113/30}
assert set(bpy.data.actions.keys()) == set(durations)


def surface(name, frame):
    action = bpy.data.actions[name]
    arm.animation_data.action = action
    arm.animation_data.action_slot = action.slots[0]
    integer = math.floor(frame)
    scene.frame_set(integer, subframe=frame-integer)
    bpy.context.view_layer.update()
    assert all(math.isfinite(v) for p in arm.pose.bones for row in p.matrix for v in row)
    for p in arm.pose.bones:
        assert abs((p.tail-p.head).length/p.bone.length-1) < .0001, (name, frame, p.name, 'bone stretch')
    obj = body.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = obj.to_mesh()
    points = [obj.matrix_world @ v.co for v in mesh.vertices]
    obj.to_mesh_clear()
    assert all(math.isfinite(v) for p in points for v in p)
    return points


report = {'clips': {}, 'tailNames': ['Bone_'+str(i).zfill(3) for i in range(22,14,-1)]}
base = surface('Walk', 0)
for name, seconds in durations.items():
    end = round(seconds*150)
    assert abs(bpy.data.actions[name].frame_range[1]-end) < .0001
    lows, spans, tips = [], [], []
    # 30 FPS across all actions; test every 150 FPS sample through the ground contact.
    frames = sorted(set(range(0,end+1,5)) | {end} | (set(range(round(end*.50),end+1)) if name=='Die' else set()))
    for frame in frames:
        points = surface(name, frame)
        lows.append(min(p.z for p in points))
        spans.append(max(max(p[i] for p in points)-min(p[i] for p in points) for i in range(3)))
        tips.append(arm.pose.bones['Bone_015'].head.copy())
    assert min(lows) > .005, (name, 'ground penetration', min(lows))
    assert max(spans) < 4, (name, 'exploding mesh')
    start, final = surface(name, 0), surface(name, end)
    error = max((p-q).length for p,q in zip(start,final))
    if name!='Die':
        assert error < .0001, (name, 'return seam',error)
        assert max((p-q).length for p,q in zip(start,base)) < .0001
    else:
        still = surface(name,end-5)
        assert max((p-q).length for p,q in zip(final,still)) < .0001
        assert abs(min(p.z for p in final)-.025) < .0001
        root = arm.pose.bones['Bone_000']
        up = (root.matrix @ root.bone.matrix_local.inverted()).to_3x3() @ Vector((0,0,1))
        assert abs(up.z)<.2, ('death must lie on its side',list(up))
    report['clips'][name] = {'seconds': seconds, 'samples': len(frames), 'lowestSurface': min(lows),
                            'tailTipTravel': max((p-tips[0]).length for p in tips), 'returnError': error if name!='Die' else None}

# Import the user's file afresh: require the supplied final mesh, UV, weights and rig.
rest = {b.name: b.matrix_local.copy() for b in arm.data.bones}
existing = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=str(source))
added = set(bpy.data.objects)-existing
donor_arm = next(o for o in added if o.type=='ARMATURE')
donor = next(o for o in added if o.type=='MESH' and o.vertex_groups)
assert len(body.data.vertices)==len(donor.data.vertices)==18029
assert [tuple(p.vertices) for p in body.data.polygons]==[tuple(p.vertices) for p in donor.data.polygons]
assert max((a.co-b.co).length for a,b in zip(body.data.vertices,donor.data.vertices))<.00001
assert max((a.uv-b.uv).length for a,b in zip(body.data.uv_layers.active.data,donor.data.uv_layers.active.data))<.000001
weights = lambda obj,v: {obj.vertex_groups[g.group].name: round(g.weight,7) for g in v.groups}
assert all(weights(body,a)==weights(donor,b) for a,b in zip(body.data.vertices,donor.data.vertices))
rig_error = max(abs(rest[b.name][r][c]-b.matrix_local[r][c]) for b in donor_arm.data.bones for r in range(4) for c in range(4))
assert rig_error<.00001, ('final rest skeleton changed',rig_error)
report.update(vertices=len(body.data.vertices), sourceMeshUVWeightsRetained=True, sourceRigMatrixError=rig_error)
report_file.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print('BOSS8_GAME_QA_PASS',json.dumps(report),flush=True)
