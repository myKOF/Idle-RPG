"""Place the approved six-clip lizard at the game origin; render its portrait.

No resampling: the GLB retains the original binary and bone/animation data.
Blender owns the editable scene, uniform placement and portrait rendering.
"""
import bpy, sys, json, math, struct, hashlib, copy
from pathlib import Path
from mathutils import Vector

source, blend, out = map(Path, sys.argv[sys.argv.index('--') + 1:][:3])
out.mkdir(parents=True, exist_ok=True)
raw = source.read_bytes()
source_sha = hashlib.sha256(raw).hexdigest()
assert source_sha == '3df3a9e486bb5e513eea3236212b2e61c316cd8a8cf52f1fab2bb5bf3a25cca0'
size = struct.unpack_from('<I', raw, 12)[0]
doc = json.loads(raw[20:20+size])
binary = raw[28+size:]
original = copy.deepcopy(doc)
assert [a['name'] for a in doc['animations']] == ['Walk', 'Idle', 'BOSS9_Attack1', 'BOSS9_Attack2', 'BOSS9_Attack3', 'BOSS9_Death']

bpy.ops.wm.open_mainfile(filepath=str(blend))
scene = bpy.context.scene
arm = next(o for o in scene.objects if o.type == 'ARMATURE')
mesh = next(o for o in scene.objects if o.type == 'MESH')
arm.animation_data.action = bpy.data.actions['Idle']
arm.animation_data.action_slot = arm.animation_data.action.slots[0]
for track in arm.animation_data.nla_tracks:
    track.mute = True
scene.frame_set(0)
dg = bpy.context.evaluated_depsgraph_get()
evaluated = mesh.evaluated_get(dg)
surface = evaluated.to_mesh()
points = [evaluated.matrix_world @ v.co for v in surface.vertices]
evaluated.to_mesh_clear()
low = Vector([min(p[i] for p in points) for i in range(3)])
high = Vector([max(p[i] for p in points) for i in range(3)])
feet = [arm.matrix_world @ arm.pose.bones[n].head for n in ['rearFoot.R', 'rearFoot.L']]
center = (feet[0] + feet[1]) * .5
ground = -.744   # The approved authoring ground; retains the tiny original low toe.
scale = 1.8 / (high.z - ground)
shift = Vector((-center.x * scale, -center.y * scale, -ground * scale))
roots = [o for o in scene.objects if not o.parent]
wrapper = bpy.data.objects.new('BOSS9_GamePlacement', None)
scene.collection.objects.link(wrapper)
for o in roots:
    o.parent = wrapper
wrapper.scale = (scale,) * 3
wrapper.location = shift
bpy.context.view_layer.update()

# Convert Blender Z-up to glTF Y-up. Keep the approved animated scene beneath
# a single static parent; this cannot change bone lengths or relative motion.
node = len(doc['nodes'])
translation = [shift.x, shift.z, -shift.y]
doc['nodes'].append({'name': wrapper.name, 'children': doc['scenes'][doc.get('scene', 0)]['nodes'],
                     'translation': translation, 'scale': [scale] * 3})
doc['scenes'][doc.get('scene', 0)]['nodes'] = [node]
doc['asset'].setdefault('extras', {}).update(pbrEmbedded=True, approvedSourceSHA256=source_sha,
    locomotion={'feet': ['rearFoot.R','rearFoot.L'], 'hips':'hips'})
for a in doc['animations']:
    if 'previewOnly' in a.get('extras', {}):
        a['extras']['previewOnly'] = False
text = json.dumps(doc, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
text += b' ' * (-len(text) % 4)
result = struct.pack('<III', 0x46546c67, 2, 28+len(text)+len(binary)) + struct.pack('<II', len(text), 0x4e4f534a) + text + struct.pack('<II', len(binary), 0x004e4942) + binary
(out/'boss9.glb').write_bytes(result)
assert doc['nodes'][:-1] == original['nodes']
for a, b in zip(doc['animations'], original['animations']):
    assert a['channels'] == b['channels'] and a['samplers'] == b['samplers']

target = wrapper.matrix_world @ Vector((center.x, -.57, .25))
cam_data = bpy.data.cameras.new('BOSS9_Portrait')
cam_data.type = 'ORTHO'
cam_data.ortho_scale = 1.32
camera = bpy.data.objects.new(cam_data.name, cam_data)
scene.collection.objects.link(camera)
camera.location = target + Vector((.3, -6, .20))
camera.rotation_euler = (target-camera.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = camera
world = bpy.data.worlds.new('BOSS9_Studio')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = (.45, .50, .58, 1)
world.node_tree.nodes['Background'].inputs[1].default_value = .7
scene.world = world
for name, position, power in [('Key', (-3,-4,5),650), ('Fill',(4,-2,3),450), ('Rim',(1,3,4),800)]:
    data = bpy.data.lights.new(name, 'AREA')
    data.energy, data.shape, data.size = power, 'DISK', 4
    light = bpy.data.objects.new(name, data)
    scene.collection.objects.link(light)
    light.location = position
    light.rotation_euler = (target-light.location).to_track_quat('-Z','Y').to_euler()
scene.render.engine = 'BLENDER_EEVEE_NEXT'
scene.eevee.taa_render_samples = 32
scene.view_settings.view_transform = 'AgX'
scene.render.resolution_x = scene.render.resolution_y = 1080
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.filepath = str(out/'boss9_lizard.png')
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(out/'boss9.blend'), compress=True)
bpy.ops.render.render(write_still=True)
report = {'sourceSHA256': source_sha, 'glbSHA256': hashlib.sha256(result).hexdigest(),
          'binaryPreserved': True, 'sixAnimationTracksPreserved': True,
          'sourceBounds': [list(low), list(high)], 'sourceGround': ground,
          'placement': {'node': node, 'translation': translation, 'scale': scale},
          'portrait': [1080,1080], 'blender': bpy.app.version_string}
(out/'build.json').write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
print('BOSS9_GAME_BUILD_PASS', json.dumps(report), flush=True)
