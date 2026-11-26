"""Verify renamed clips against the real skin of the approved source."""
import bpy, sys, json, math, hashlib
from pathlib import Path
import numpy as np

source, game, blend, report = map(Path, sys.argv[sys.argv.index('--')+1:])
build = json.loads(game.with_name('build.json').read_text())
scale = build['placement']['scale']
shift = np.array(build['placement']['translation'])[[0,2,1]] * [1,-1,1]
names = ['Walk','BOSS9_Attack1','BOSS9_Attack2','BOSS9_Attack3','BOSS9_Death']
durations = [2/3,1.2,1.5,1.5,4]
reference = {}
errors = {}
for label, file in [('source',source),('glb',game),('blend',blend)]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if file.suffix == '.blend':
        bpy.ops.wm.open_mainfile(filepath=str(file))
    else:
        bpy.ops.import_scene.gltf(filepath=str(file))
    scene = bpy.context.scene
    scene.render.fps = 24
    arm = next(o for o in scene.objects if o.type == 'ARMATURE')
    mesh = next(o for o in scene.objects if o.type == 'MESH' and o.vertex_groups)
    for track in arm.animation_data.nla_tracks:
        track.mute = True
    maximum = 0
    for clip, duration in zip(names,durations):
        action = bpy.data.actions[clip if label == 'source' else build['animationNameMap'][clip]]
        arm.animation_data.action = action
        arm.animation_data.action_slot = action.slots[0]
        for i in range(9):
            t = duration*i/8
            f = t*24
            scene.frame_set(math.floor(f), subframe=f%1)
            e = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
            m = e.to_mesh()
            points = np.array([list(e.matrix_world @ v.co) for v in m.vertices])
            e.to_mesh_clear()
            assert np.isfinite(points).all()
            key = (clip,i)
            if label == 'source':
                reference[key] = points*scale+shift
            else:
                maximum = max(maximum,float(np.max(abs(points-reference[key]))))
    if label != 'source':
        assert maximum < 1e-5,(label,maximum)
        errors[label] = maximum
report.parent.mkdir(parents=True,exist_ok=True)
report.write_text(json.dumps({'clips':build['exportedClips'],'samplesPerFormat':45,'maximumVertexError':errors,
                             'uniformPlacementOnly':True,'glbSHA256':hashlib.sha256(game.read_bytes()).hexdigest(),
                             'blendSHA256':hashlib.sha256(blend.read_bytes()).hexdigest()},indent=2)+'\n',encoding='utf-8')
print('BOSS9_GAME_SKIN_PASS',errors,flush=True)
