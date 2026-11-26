"""Compare actual skinned surfaces in each GLB and editable Blend to approval."""
import bpy, sys, json, math, hashlib
from pathlib import Path
from mathutils import Matrix
import numpy as np

pack = Path(sys.argv[sys.argv.index('--')+1]).resolve()
inputs = json.loads((pack/'source/inputs.json').read_text())
master = pack.parents[1]/inputs['master']['libraryPath']
clips = {'Walk':2/3,'Attack1':1.2,'Attack2':1.5,'Attack3':1.5,'Die':4}
reference = {}
reports = []
def load(file):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if file.suffix=='.blend':
        bpy.ops.wm.open_mainfile(filepath=str(file))
    else:
        bpy.ops.import_scene.gltf(filepath=str(file))
    scene = bpy.context.scene
    scene.render.fps = 24
    arm = next(o for o in scene.objects if o.type=='ARMATURE')
    mesh = next(o for o in scene.objects if o.type=='MESH' and o.vertex_groups)
    for track in arm.animation_data.nla_tracks:
        track.mute = True
    assert len(arm.pose.bones)==73
    assert sorted(a.name for a in bpy.data.actions)==sorted(clips)
    arm.animation_data.action = None
    for bone in arm.pose.bones:
        bone.matrix_basis = Matrix.Identity(4)
    scene.frame_set(0)
    return scene,arm,mesh

def points(mesh):
    e = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
    m = e.to_mesh()
    result = np.array([list(e.matrix_world @ v.co) for v in m.vertices])
    e.to_mesh_clear()
    assert np.isfinite(result).all()
    return result

scene,arm,mesh = load(master)
rest = np.array([list(v.co) for v in mesh.data.vertices])
keys = {tuple(np.round(v,6)):i for i,v in enumerate(rest)}
for clip,duration in clips.items():
    arm.animation_data.action = bpy.data.actions[clip]
    arm.animation_data.action_slot = arm.animation_data.action.slots[0]
    for i in range(9):
        frame = duration*i/8*24
        scene.frame_set(math.floor(frame),subframe=frame%1)
        reference[clip,i] = points(mesh)
for v in inputs['variants']:
    errors = {}
    for ext in ['glb','blend']:
        file = pack/'exports'/(v['name']+'.'+ext)
        scene,arm,mesh = load(file)
        remap = np.array([keys[tuple(np.round(list(p.co),6))] for p in mesh.data.vertices])
        maximum = 0
        for clip,duration in clips.items():
            arm.animation_data.action = bpy.data.actions[clip]
            arm.animation_data.action_slot = arm.animation_data.action.slots[0]
            for i in range(9):
                frame = duration*i/8*24
                scene.frame_set(math.floor(frame),subframe=frame%1)
                maximum = max(maximum,float(np.max(np.abs(points(mesh)-reference[clip,i][remap]))))
        assert maximum<1e-5,(v['name'],ext,maximum)
        if ext=='blend':
            used_images = {node.image for material in bpy.data.materials if material.use_nodes
                           for node in material.node_tree.nodes if node.type=='TEX_IMAGE'}
            assert len(used_images)==3
            assert all(image.packed_file and list(image.size)==[2048,2048] for image in used_images)
        errors[ext] = maximum
    reports.append({'name':v['name'],'maximumVertexError':errors,
                    'glbSHA256':hashlib.sha256((pack/'exports'/(v['name']+'.glb')).read_bytes()).hexdigest(),
                    'blendSHA256':hashlib.sha256((pack/'exports'/(v['name']+'.blend')).read_bytes()).hexdigest()})
    print('BOSS9_VARIANT_SKIN_PASS',v['name'],errors,flush=True)
(pack/'qa').mkdir(exist_ok=True)
(pack/'qa/skin.json').write_text(json.dumps({'samplesPerFormat':45,'variants':reports},indent=2)+'\n',encoding='utf8')
