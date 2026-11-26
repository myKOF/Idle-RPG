"""Bind the three supplied appearances to the approved BOSS9 rig and clips.

Run in Blender: -- PACKAGE. Original geometry/UVs are never re-exported;
only exact coincident-vertex weights are transferred. Blender downsizes PBR
images, renders portraits, and saves editable packed five-action scenes.
"""
import bpy, copy, hashlib, json, struct, sys, tempfile
from collections import Counter
from pathlib import Path
import numpy as np

pack = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
library = pack.parents[1]
inputs = json.loads((pack/'source/inputs.json').read_text())
out = pack/'exports'
out.mkdir(parents=True, exist_ok=True)
sha = lambda b: hashlib.sha256(b).hexdigest()

def load(file):
    raw = file.read_bytes()
    length = struct.unpack_from('<I', raw, 12)[0]
    return json.loads(raw[20:20+length]), raw[28+length:], sha(raw)

def data(g, binary, i):
    a = g['accessors'][i]
    v = g['bufferViews'][a['bufferView']]
    width = {'SCALAR':1, 'VEC2':2, 'VEC3':3, 'VEC4':4, 'MAT4':16}[a['type']]
    dtype = {5121:'u1', 5123:'<u2', 5125:'<u4', 5126:'<f4'}[a['componentType']]
    assert 'byteStride' not in v and 'sparse' not in a
    start = v.get('byteOffset',0)+a.get('byteOffset',0)
    return np.frombuffer(binary, dtype=dtype, count=a['count']*width, offset=start).reshape(a['count'],width)

def write(file, g, binary):
    binary += b'\0'*(-len(binary)%4)
    g['buffers'] = [{'byteLength':len(binary)}]
    text = json.dumps(g,separators=(',',':'),ensure_ascii=False).encode()
    text += b' '*(-len(text)%4)
    file.write_bytes(struct.pack('<IIIII',0x46546c67,2,28+len(text)+len(binary),len(text),0x4e4f534a)+text+struct.pack('<II',len(binary),0x004e4942)+binary)

def triangles(g, binary):
    p = g['meshes'][0]['primitives'][0]
    pos = data(g,binary,p['attributes']['POSITION'])
    indices = data(g,binary,p['indices']).reshape(-1,3)
    return Counter(tuple(sorted(pos[int(v)].tobytes() for v in face)) for face in indices)

master, master_bin, master_sha = load(library/inputs['master']['libraryPath'])
assert master_sha == inputs['master']['sha256']
portrait, _, portrait_sha = load(library/inputs['portraitPose']['libraryPath'])
assert portrait_sha == inputs['portraitPose']['sha256']
idle = next(a for a in portrait['animations'] if a['name']=='Idle')
assert list(a['name'] for a in master['animations']) == ['Walk','Attack1','Attack2','Attack3','Die']
p = master['meshes'][0]['primitives'][0]
positions = data(master,master_bin,p['attributes']['POSITION'])
joints = data(master,master_bin,p['attributes']['JOINTS_0'])
weights = data(master,master_bin,p['attributes']['WEIGHTS_0'])
mapping = {}
for i, pos in enumerate(positions):
    key = pos.tobytes()
    if key in mapping:
        other = mapping[key]
        assert np.array_equal(joints[i],joints[other]) and np.array_equal(weights[i],weights[other])
    mapping[key] = i
master_faces = triangles(master,master_bin)
reports = []
for variant in inputs['variants']:
    name = variant['name']
    source = pack/variant['path']
    original, original_bin, original_sha = load(source)
    assert original_sha == variant['sha256'] and triangles(original,original_bin)==master_faces
    primitive = original['meshes'][0]['primitives'][0]
    target_pos = data(original,original_bin,primitive['attributes']['POSITION'])
    indices = np.array([mapping[v.tobytes()] for v in target_pos])
    assert np.array_equal(positions[indices],target_pos)

    # Each artist source has 8K base color and 4K data maps. Retain originals
    # in the package and use 2K maps at the game's 512px render resolution.
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(source))
    textures = out/'textures'/name
    textures.mkdir(parents=True,exist_ok=True)
    pngs, image_report = [], []
    for image in original['images']:
        image_data = bpy.data.images[image['name']]
        before = list(image_data.size)
        image_data.scale(2048,2048)
        image_data.file_format = 'PNG'
        image_data.filepath_raw = str(textures/(image['name']+'.png'))
        image_data.save()
        raw = Path(image_data.filepath_raw).read_bytes()
        pngs.append(raw)
        view = original['bufferViews'][image['bufferView']]
        source_bytes = original_bin[view.get('byteOffset',0):view.get('byteOffset',0)+view['byteLength']]
        image_report.append({'name':image['name'],'sourceSize':before,'size':[2048,2048],
                             'sourceSHA256':sha(source_bytes),'sha256':sha(raw)})

    g = copy.deepcopy(master)
    old_views = g['bufferViews']
    old_images = {i['bufferView'] for i in g['images']}
    binary = bytearray()
    g['bufferViews'] = []
    def view(raw, properties=None):
        binary.extend(b'\0'*(-len(binary)%4))
        n = len(g['bufferViews'])
        g['bufferViews'].append(dict(properties or {},buffer=0,byteOffset=len(binary),byteLength=len(raw)))
        binary.extend(raw)
        return n
    views = {}
    for i, v in enumerate(old_views):
        if i in old_images:
            continue
        start = v.get('byteOffset',0)
        views[i] = view(master_bin[start:start+v['byteLength']], {k:v[k] for k in ['target'] if k in v})
    for a in g['accessors']:
        a['bufferView'] = views[a['bufferView']]
    def accessor(a, raw):
        result = copy.deepcopy(a)
        result['bufferView'] = view(raw)
        result.pop('byteOffset',None)
        g['accessors'].append(result)
        return len(g['accessors'])-1
    mesh = copy.deepcopy(original['meshes'][0])
    new_p = mesh['primitives'][0]
    geometry_hashes = {}
    for attr, ai in primitive['attributes'].items():
        raw = data(original,original_bin,ai).tobytes()
        new_p['attributes'][attr] = accessor(original['accessors'][ai],raw)
        geometry_hashes[attr] = sha(raw)
    raw = data(original,original_bin,primitive['indices']).tobytes()
    new_p['indices'] = accessor(original['accessors'][primitive['indices']],raw)
    geometry_hashes['indices'] = sha(raw)
    for attr, values in [('JOINTS_0',joints[indices]),('WEIGHTS_0',weights[indices])]:
        a = copy.deepcopy(master['accessors'][p['attributes'][attr]])
        a['count'] = len(target_pos)
        new_p['attributes'][attr] = accessor(a,values.tobytes())
    g['meshes'] = [mesh]
    for key in ['materials','textures','samplers']:
        if key in original:
            g[key] = copy.deepcopy(original[key])
        else:
            g.pop(key,None)
    g['images'] = [{'name':im['name'],'mimeType':'image/png','bufferView':view(raw)} for im,raw in zip(original['images'],pngs)]
    g['asset']['extras'].update(appearanceSourceSHA256=original_sha,approvedAnimationSHA256=master_sha)
    write(out/(name+'.glb'),g,bytes(binary))

    # The old authoring Idle exists only while composing the face portrait;
    # its accessor data already exists in the approved, unmodified buffers.
    portrait_doc = copy.deepcopy(g)
    portrait_doc['animations'].append(copy.deepcopy(idle))
    with tempfile.TemporaryDirectory(prefix='boss9-portrait-') as temp:
        transient = Path(temp)/'portrait.glb'
        write(transient,portrait_doc,bytes(binary))
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=str(transient))
    scene = bpy.context.scene
    arm = next(o for o in scene.objects if o.type=='ARMATURE')
    for track in arm.animation_data.nla_tracks:
        track.mute = True
    arm.animation_data.action = bpy.data.actions['Idle']
    arm.animation_data.action_slot = arm.animation_data.action.slots[0]
    scene.frame_set(0)
    from mathutils import Vector
    camera_data = bpy.data.cameras.new('BOSS9_Portrait')
    camera_data.type, camera_data.ortho_scale = 'ORTHO',1.32
    camera = bpy.data.objects.new(camera_data.name,camera_data)
    scene.collection.objects.link(camera)
    # glTF is imported as Blender Z-up: target is the approved face position.
    target = Vector((0,-.9474792,1.3080363))
    camera.location = target+Vector((.3,-6,.20))
    camera.rotation_euler = (target-camera.location).to_track_quat('-Z','Y').to_euler()
    scene.camera = camera
    world = bpy.data.worlds.new('BOSS9_Studio')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (.45,.50,.58,1)
    world.node_tree.nodes['Background'].inputs[1].default_value = .7
    scene.world = world
    for label, pos, energy in [('Key',(-3,-4,5),650),('Fill',(4,-2,3),450),('Rim',(1,3,4),800)]:
        lamp_data = bpy.data.lights.new(label,'AREA')
        lamp_data.energy, lamp_data.shape, lamp_data.size = energy,'DISK',4
        lamp = bpy.data.objects.new(label,lamp_data)
        scene.collection.objects.link(lamp)
        lamp.location = pos
        lamp.rotation_euler = (target-lamp.location).to_track_quat('-Z','Y').to_euler()
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
    scene.eevee.taa_render_samples = 32
    scene.view_settings.view_transform = 'AgX'
    scene.render.resolution_x = scene.render.resolution_y = 1080
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.use_stamp = False
    scene.render.filepath = str(out/(variant['portrait']+'.png'))
    bpy.ops.render.render(write_still=True)
    arm.animation_data.action = bpy.data.actions['Walk']
    arm.animation_data.action_slot = arm.animation_data.action.slots[0]
    bpy.data.actions.remove(bpy.data.actions['Idle'])
    scene.frame_set(0)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(out/(name+'.blend')),compress=True)
    reports.append({'name':name,'sourceSHA256':original_sha,'glbSHA256':sha((out/(name+'.glb')).read_bytes()),
                    'blendSHA256':sha((out/(name+'.blend')).read_bytes()),'vertices':len(target_pos),'triangles':len(master_faces),
                    'geometrySHA256':geometry_hashes,'exactPositionWeightTransfer':True,'animationsPreserved':True,
                    'skinPreserved':True,'textures':image_report})
    print('BOSS9_VARIANT_BUILD_PASS',name,flush=True)
(out/'build.json').write_text(json.dumps({'masterSHA256':master_sha,'variants':reports},indent=2)+'\n',encoding='utf8')
