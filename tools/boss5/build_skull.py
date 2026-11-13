"""Mini skull bullet for BOSS5 attack 2: the oni mask (with the new back of the head), decimated and recoloured green + emissive.
blender -b -P build_boss5_skull.py -- stage1.blend out_skull.glb"""
import bpy, sys, os
import numpy as np
from mathutils import Matrix
argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
RATIO = float(argv[2]) if len(argv) > 2 else 0.14
SCALE = float(argv[3]) if len(argv) > 3 else 0.30
bpy.ops.wm.open_mainfile(filepath=SRC)
mask = bpy.data.objects['Mask']
dome = bpy.data.objects['Dome']
dome.data.uv_layers[0].name = mask.data.uv_layers[0].name
for o in bpy.context.view_layer.objects:
    o.select_set(False)
mask.select_set(True)
dome.select_set(True)
bpy.context.view_layer.objects.active = mask
bpy.ops.object.join()
ob = mask
ob.name = 'Boss5Skull'
me = ob.data
for p in me.polygons:
    p.use_smooth = True
md = ob.modifiers.new('dec', 'DECIMATE')
md.decimate_type = 'COLLAPSE'
md.ratio = RATIO
md.use_collapse_triangulate = True
bpy.ops.object.modifier_apply(modifier='dec')
me = ob.data
print('SKULL tris', sum(len(p.vertices) - 2 for p in me.polygons))
me.transform(Matrix.Scale(SCALE, 4))


def green_image(src, name):
    w, h = src.size
    a = np.empty(w * h * 4, dtype=np.float32)
    src.pixels.foreach_get(a)
    a = a.reshape(-1, 4)
    a[:, [0, 1]] = a[:, [1, 0]]          # red <-> green: lacquer red becomes ghost green, white stays white
    n = bpy.data.images.new(name, w, h, alpha=False)
    n.colorspace_settings.name = src.colorspace_settings.name
    n.pixels.foreach_set(a.ravel())
    if max(w, h) > 1024:
        n.scale(1024, 1024)
    n.pack()
    return n


newmats = []
for m in list(me.materials):
    img = next((n.image for n in m.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image and 'metallic' not in n.image.name.lower() and 'normal' not in n.image.name.lower()), None)
    print('MAT', m.name, img.name if img else None)
    g = green_image(img, 'skull_' + m.name)
    nm = bpy.data.materials.new('Skull_' + m.name)
    nm.use_nodes = True
    nt = nm.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bs = nt.nodes.new('ShaderNodeBsdfPrincipled')
    tn = nt.nodes.new('ShaderNodeTexImage')
    tn.image = g
    nt.links.new(tn.outputs['Color'], bs.inputs['Base Color'])
    nt.links.new(tn.outputs['Color'], bs.inputs['Emission Color'])
    bs.inputs['Emission Strength'].default_value = 1.6
    bs.inputs['Roughness'].default_value = 0.5
    bs.inputs['Metallic'].default_value = 0.0
    nt.links.new(bs.outputs['BSDF'], out.inputs['Surface'])
    newmats.append(nm)
me.materials.clear()
for nm in newmats:
    me.materials.append(nm)
for o in bpy.context.view_layer.objects:
    o.select_set(False)
ob.select_set(True)
bpy.context.view_layer.objects.active = ob
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_animations=False, export_apply=False,
                          export_image_format='AUTO', export_normals=True, export_materials='EXPORT')
print('EXPORTED', OUT, os.path.getsize(OUT))
