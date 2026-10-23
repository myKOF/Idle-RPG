"""Original, rigid-skinned plate knight. Run with Blender --background --python.

No sprite pixels, external meshes, textures, fonts or animation files are imported.
Reference sheets inform only silhouette and gesture. Coordinates: front is -Y, Z up.
"""
import argparse
import importlib.util
import json
import math
import sys
from pathlib import Path
sys.dont_write_bytecode=True

import bpy
from mathutils import Matrix, Vector, Quaternion

parser = argparse.ArgumentParser()
parser.add_argument('--output', required=True)
parser.add_argument('--preview', required=True)
parser.add_argument('--render', choices=['none', 'stills', 'all'], default='stills')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
OUT = Path(args.output).resolve()
PREVIEW = Path(args.preview).resolve()
OUT.mkdir(parents=True, exist_ok=True)
PREVIEW.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for data in list(bpy.data.actions):
    bpy.data.actions.remove(data)

def material(name, rgb, metal=0, rough=.45):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*rgb, 1)
    mat.use_nodes = True
    bs = mat.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value = (*rgb, 1)
    bs.inputs['Metallic'].default_value = metal
    bs.inputs['Roughness'].default_value = rough
    return mat

steel = material('01 | neutral white silver plate', (.62, .64, .66), .55, .34)
edge = material('02 | quiet silver edge', (.80, .82, .84), .73, .29)
darkmetal = material('03 | recessed gunmetal', (.085, .085, .095), .50, .54)
cloth = material('04 | charcoal padded cloth', (.033, .033, .037), 0, .88)
leather = material('05 | walnut leather', (.105, .065, .042), 0, .73)
skin = material('06 | natural warm skin', (.46, .355, .28), 0, .80)
hair = material('07 | short pale ash hair', (.38, .35, .30), 0, .82)
black = material('08 | visor interior', (.005, .008, .012), .05, .92)
sclera = material('09 | natural sclera', (.55,.53,.49), 0, .53)

parts = []
def finish(obj, name, mat, bone=None, bevel=0, smooth=False):
    obj.name = name
    obj.data.materials.append(mat)
    if bevel:
        mod = obj.modifiers.new('crafted edge', 'BEVEL')
        mod.width = bevel
        mod.segments = 2
    if smooth:
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
    if bone:
        parts.append((obj, bone))
    return obj

def mesh(name, vertices, faces, mat, bone=None, bevel=0, smooth=False):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    return finish(obj, name, mat, bone, bevel, smooth)

def box(name, center, size, mat, bone=None, bevel=.025):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    obj = bpy.context.object
    obj.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(obj, name, mat, bone, bevel)

def sphere(name, center, size, mat, bone=None, segments=16):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=8, radius=1, location=center)
    obj = bpy.context.object
    obj.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(obj, name, mat, bone, smooth=True)

def link(name, a, b, radius, mat, bone=None, vertices=12):
    a, b = Vector(a), Vector(b)
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=(b-a).length,
                                     location=(a+b)/2)
    obj = bpy.context.object
    obj.rotation_mode = 'QUATERNION'
    obj.rotation_quaternion = (b-a).to_track_quat('Z', 'Y')
    return finish(obj, name, mat, bone, .008, True)

def shell(name, rings, mat, bone, count=12, bevel=.012):
    # rings: z, horizontal radius, depth radius, depth center. Elliptical metal shells.
    vs = [(rx*math.cos(i*2*math.pi/count), cy+ry*math.sin(i*2*math.pi/count), z)
          for z, rx, ry, cy in rings for i in range(count)]
    fs = []
    for j in range(len(rings)-1):
        for i in range(count):
            fs.append((j*count+i, j*count+(i+1)%count, (j+1)*count+(i+1)%count, (j+1)*count+i))
    fs += [tuple(reversed(range(count))), tuple((len(rings)-1)*count+i for i in range(count))]
    return mesh(name, vs, fs, mat, bone, bevel)

def local_shell(name, center, rings, mat, bone, count=10):
    obj = shell(name, rings, mat, bone, count)
    obj.location = center
    return obj

# Companion authoring modules share no game-runtime dependencies.
def companion(name):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(name+'.py'))
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
REST,rig=companion('silver_knight_geometry').build(globals())

# Keep actual bevels and curved armor surfaces. The previous blanket removal of
# edge geometry over-simplified the silhouette; invisible cloth alone is reduced.
# Join the result into one skinned mesh and one compact palette material.
discard_terms=()
kept=[]
for obj,bone in parts:
    if any(word in obj.name for word in discard_terms):
        bpy.data.objects.remove(obj,do_unlink=True)
        continue
    if any(n in obj.name for n in ['sculpted center','hip plate','knee plate','elbow guard','crossguard']):
        solid=obj.modifiers.new('real plate thickness','SOLIDIFY')
        solid.thickness=.012
        solid.offset=0
        bev=obj.modifiers.new('plate edge highlight','BEVEL')
        bev.width=.006
        bev.segments=2
    for modifier in list(obj.modifiers):
        if modifier.type=='BEVEL':
            modifier.limit_method='ANGLE'
            modifier.angle_limit=math.radians(42)
            modifier.width=min(modifier.width,.012)
            modifier.segments=2
            if any(n in obj.name for n in ['finger','knuckle','ankle','cuff','seam','collar edge','overlapping lame']):
                modifier.segments=1
    bpy.context.view_layer.objects.active=obj
    obj.select_set(True)
    for modifier in list(obj.modifiers):
        # Preserve any authoring modifiers before skinning.
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    if any(n in obj.name for n in ['breastplate','upper arm','vambrace','thigh plates','greave','neck guard','abdominal','pauldron']):
        for poly in obj.data.polygons[:-2]: poly.use_smooth=True
    if len(obj.data.polygons)>40 and any(n in obj.name for n in ['textile','cloth','breeches','articulation']):
        mod=obj.modifiers.new('small-screen polygon reduction','DECIMATE')
        mod.ratio=.55
        bpy.ops.object.modifier_apply(modifier=mod.name)
    group=obj.vertex_groups.new(name=bone)
    group.add(list(range(len(obj.data.vertices))),1,'REPLACE')
    kept.append((obj,bone))
parts=kept

palette=[steel,edge,darkmetal,cloth,leather,skin,hair,black,sclera]
def palette_image(name,orm=False):
    img=bpy.data.images.new(name,width=len(palette)*4,height=4,alpha=True)
    if orm: img.colorspace_settings.name='Non-Color'
    px=[]
    for y in range(4):
        for x in range(len(palette)*4):
            source=palette[x//4]
            bs=source.node_tree.nodes.get('Principled BSDF')
            rgba=(1,bs.inputs['Roughness'].default_value,bs.inputs['Metallic'].default_value,1) if orm else \
                tuple(source.diffuse_color)
            px.extend(rgba)
    img.pixels[:]=px
    img.pack()
    return img
base_img=palette_image('Knight compact palette')
orm_img=palette_image('Knight metal roughness',True)
unified=bpy.data.materials.new('Knight | single palette material')
unified.use_nodes=True
nodes=unified.node_tree.nodes
links=unified.node_tree.links
bs=nodes.get('Principled BSDF')
base=nodes.new('ShaderNodeTexImage'); base.image=base_img; base.interpolation='Closest'
orm=nodes.new('ShaderNodeTexImage'); orm.image=orm_img; orm.interpolation='Closest'
split=nodes.new('ShaderNodeSeparateColor')
links.new(base.outputs['Color'],bs.inputs['Base Color'])
links.new(orm.outputs['Color'],split.inputs['Color'])
links.new(split.outputs['Green'],bs.inputs['Roughness'])
links.new(split.outputs['Blue'],bs.inputs['Metallic'])
for obj,bone in parts:
    uv=obj.data.uv_layers.active or obj.data.uv_layers.new(name='Palette')
    uv.name='Palette'
    uv.active_render=True
    index=palette.index(obj.data.materials[0])
    for loop in uv.data:
        loop.uv=((index+.5)/len(palette),.5)
    obj.data.materials.clear()
    obj.data.materials.append(unified)
bpy.ops.object.select_all(action='DESELECT')
for obj,bone in parts: obj.select_set(True)
bpy.context.view_layer.objects.active=parts[0][0]
bpy.ops.object.join()
body=bpy.context.object
body.name='Knight | single skinned low-poly mesh'
# Joining objects can leave redundant identical material slots. Collapse them.
body.data.materials.clear()
body.data.materials.append(unified)
for poly in body.data.polygons: poly.material_index=0
parts=[(body,None)]

# One armature modifier per object, unit-weight rigid parts. This is editable
# skeletal animation (not a collection of unrelated rotating object animations).
for obj,bone in parts:
    mod=obj.modifiers.new('Knight skeleton','ARMATURE')
    mod.object=rig
    obj.parent=rig

motion=companion('silver_knight_motion')
vec=Vector
def pose(clip,t):
    motion.pose(rig,REST,clip,t)

CLIPS = {'idle':(30,2),'walk':(15,1),'attack1':(15,1),'attack2':(15,1),'cast':(15,1),'die':(30,2)}
actions={}
for clip,(frames,step) in CLIPS.items():
    rig.animation_data_create()
    action=bpy.data.actions.new(clip)
    rig.animation_data.action=action
    action.use_fake_user=True
    previous_quats={}
    for pb in rig.pose.bones: pb.rotation_mode='QUATERNION'
    for frame in range(1,frames+1):
        t=(frame-1)/(frames if clip in ['idle','walk'] else frames-1)
        pose(clip,t)
        for pb in rig.pose.bones:
            if pb.name in previous_quats and previous_quats[pb.name].dot(pb.rotation_quaternion)<0:
                pb.rotation_quaternion.negate()
            previous_quats[pb.name]=pb.rotation_quaternion.copy()
            pb.keyframe_insert('location',frame=frame,group=pb.name)
            pb.keyframe_insert('rotation_quaternion',frame=frame,group=pb.name)
            pb.keyframe_insert('scale',frame=frame,group=pb.name)
    # No Bezier overshoot between densely baked samples.
    curves=getattr(action,'fcurves',None)
    if curves is None:
        curves=[fc for layer in action.layers for strip in layer.strips
                for bag in strip.channelbags for fc in bag.fcurves]
    for fc in curves:
        for key in fc.keyframe_points:
            key.interpolation='LINEAR'
    actions[clip]=action

# Presentation studio. All elements are authored geometry and Blender lights.
scene=bpy.context.scene
scene.render.engine='CYCLES'
scene.cycles.samples=24
scene.cycles.use_denoising=True
scene.render.resolution_x=480
scene.render.resolution_y=480
scene.render.resolution_percentage=100
scene.render.fps=30
scene.render.image_settings.file_format='PNG'
scene.render.film_transparent=False
scene.world.color=(.15,.15,.15)
scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.28,.28,.28,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value=.55
scene.view_settings.view_transform='AgX'
floor=material('studio | neutral charcoal',(.035,.038,.042),.08,.76)
box('studio ground',(0,0,-.085),(200,200,.12),floor,bevel=0)
# A modest plinth grounds the feet without cluttering the silhouette.
bpy.ops.mesh.primitive_cylinder_add(vertices=96,radius=1.57,depth=.065,location=(0,0,-.042))
finish(bpy.context.object,'studio circular platform',floor,bevel=.015)
def area(name,position,power,color,size):
    data=bpy.data.lights.new(name,'AREA')
    data.energy=power
    data.color=color
    data.shape='DISK'
    data.size=size
    o=bpy.data.objects.new(name,data)
    bpy.context.collection.objects.link(o)
    o.location=position
    o.rotation_euler=(vec((0,0,1.3))-o.location).to_track_quat('-Z','Y').to_euler()
area('key softbox',(-3,-4,6),650,(1,.95,.88),4)
area('neutral fill',(4,-2,3.5),430,(.90,.94,1),3)
area('front silver reflection',(1,-6,3.9),460,(1,.98,.95),5)
area('rim strip',(1,3,4.6),850,(1,.98,.94),2.8)
camdata=bpy.data.cameras.new('presentation camera')
camera=bpy.data.objects.new('presentation camera',camdata)
bpy.context.collection.objects.link(camera)
camera.location=(5,-7,7.4)
camera.rotation_euler=(vec((0,-.03,1.50))-camera.location).to_track_quat('-Z','Y').to_euler()
camdata.type='ORTHO'
camdata.ortho_scale=4.20
scene.camera=camera

# Use GPU Cycles if available; CPU is deterministic fallback. Rendering can be
# switched independently without changing the saved meshes or skeletal clips.
try:
    prefs=bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type='CUDA'
    prefs.get_devices()
    gpu=False
    for device in prefs.devices:
        device.use=device.type=='CUDA'
        gpu=gpu or device.use
    if gpu:
        scene.cycles.device='GPU'
except Exception as error:
    print('CUDA unavailable:',error)

rig.animation_data.action=actions['idle']
scene.frame_start=1
scene.frame_end=30
scene.frame_set(1)
bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True)
bpy.context.view_layer.objects.active=rig
for area_ui in bpy.context.screen.areas if bpy.context.screen else []:
    if area_ui.type=='VIEW_3D':
        area_ui.spaces.active.region_3d.view_distance=5
        area_ui.spaces.active.region_3d.view_location=vec((0,0,1.3))
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'knight_batch1.blend'))

manifest={'revision':2,'previewPrefix':'knight_revision2_handfix','offHand':'forward-facing chest guard','shield':False,'proportions':'adult slender, approximately 7.5 heads','status':'preview candidate; no game integration','front':'-Y','up':'Z',
          'units':'meters, stylized proportion','blender':bpy.app.version_string,
          'bones':len(rig.data.bones),'meshParts':len(parts),
          'vertices':sum(len(o.data.vertices) for o,b in parts),
          'faces':sum(len(o.data.polygons) for o,b in parts),
          'triangles':sum(len(poly.vertices)-2 for poly in body.data.polygons),
          'materials':[unified.name], 'paletteTextures':{'count':2,'size':[len(palette)*4,4]},
          'clips':{},'external_assets':[], 'blade_trails':False}
for clip,(frames,step) in CLIPS.items():
    rendered=list(range(1,frames+1,step))
    # Include exact terminal death pose even when rendering every other frame.
    if clip=='die' and rendered[-1]!=frames:
        rendered.append(frames)
    manifest['clips'][clip]={'frames':frames,'fps':30,'duration':frames/30,
        'loop':clip in ['idle','walk'],'renderedFrames':rendered}
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
(PREVIEW/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')

# Export six named skeletal actions as separate glTF clips; studio excluded.
for track in list(rig.animation_data.nla_tracks):
    rig.animation_data.nla_tracks.remove(track)
for clip,action in actions.items():
    track=rig.animation_data.nla_tracks.new()
    track.name=clip
    strip=track.strips.new(clip,1,action)
    strip.action_frame_start=1
    strip.action_frame_end=CLIPS[clip][0]
rig.animation_data.action=None
for track in rig.animation_data.nla_tracks:
    track.mute=True
bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True)
for obj,bone in parts:
    obj.select_set(True)
export_options=dict(filepath=str(OUT/'knight_batch1.glb'),export_format='GLB',
    use_selection=True,export_animations=True,export_animation_mode='ACTIONS',
    export_force_sampling=True,export_frame_range=False,export_nla_strips=True,
    export_skins=True,export_yup=True,export_apply=False)
supported=bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
bpy.ops.export_scene.gltf(**{k:v for k,v in export_options.items() if k in supported})
rig.animation_data.action=actions['idle']
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'knight_batch1.blend'))

if args.render!='none':
    for clip,(frames,step) in CLIPS.items():
        rig.animation_data.action=actions[clip]
        indices=manifest['clips'][clip]['renderedFrames'] if args.render=='all' else \
            [1,frames//2+1,frames]
        folder=PREVIEW/clip
        folder.mkdir(exist_ok=True)
        for f in indices:
            scene.frame_set(f)
            scene.render.filepath=str(folder/('%03d.png'%f))
            bpy.ops.render.render(write_still=True)
            print('KNIGHT_RENDER',clip,f,flush=True)
    rig.animation_data.action=actions['idle']
    scene.frame_set(1)
print('KNIGHT_BATCH_COMPLETE',str(OUT),flush=True)
