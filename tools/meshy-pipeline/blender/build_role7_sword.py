"""Author a new silver/gold ruby sword for Role7. No external sword mesh.

blender -b --python-exit-code 1 --python build_role7_sword.py -- OUTPUT_DIRECTORY
Canonical metre axes: blade +Y, cutting edge +X, decorated front +Z.
The approved Role6 grip cylinder and collar dimensions are retained.
"""
import bpy
import bmesh
import hashlib
import json
import math
import sys
from pathlib import Path
from mathutils import Vector

out = Path(sys.argv[sys.argv.index('--') + 1])
out.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
parts = []


def material(name, color, metal, rough):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get('Principled BSDF')
    for key, value in [('Base Color', (*color, 1)), ('Metallic', metal), ('Roughness', rough)]:
        shader.inputs[key].default_value = value
    return mat


gold = material('Role7 champagne gold engraving', (.67, .41, .13), 1, .25)
silver = material('Role7 polished silver', (.72, .78, .84), 1, .25)
edge = material('Role7 bright cutting bevel', (.92, .96, 1), 1, .17)
dark_gold = material('Role7 recessed gold', (.19, .088, .027), .9, .4)
leather = material('Role7 burgundy grip leather', (.082, .008, .012), .03, .7)
ruby = material('Role7 faceted ruby', (.43, .006, .017), .15, .16)
inlay = material('Role7 crimson blade inlay', (.21, .004, .009), .45, .3)


def mesh(name, vertices, faces, materials, indices=None):
    data = bpy.data.meshes.new(name)
    # Blender Z-up -> glTF Y-up, preserving the canonical grip-space axes.
    data.from_pydata([(x, -z, y) for x, y, z in vertices], [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    for mat in materials:
        data.materials.append(mat)
    if indices is not None:
        for face, index in zip(data.polygons, indices):
            face.material_index = index
    parts.append(obj)
    return obj


def bevel(obj, width=.001, segments=3):
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    modifier = obj.modifiers.new('Rounded carved metal edges', 'BEVEL')
    modifier.width, modifier.segments = width, segments
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.select_set(False)


def tube(name, points, radius, mat, sides=8):
    points = [Vector(p) for p in points]
    vertices = []
    for i, point in enumerate(points):
        axis = (points[min(i + 1, len(points) - 1)] - points[max(0, i - 1)]).normalized()
        basis = Vector((0, 0, 1)) if abs(axis.z) < .9 else Vector((1, 0, 0))
        u = axis.cross(basis).normalized()
        v = axis.cross(u).normalized()
        vertices.extend(point + radius * (u * math.cos(k * math.tau / sides) + v * math.sin(k * math.tau / sides)) for k in range(sides))
    faces = [tuple(reversed(range(sides))), tuple((len(points) - 1) * sides + k for k in range(sides))]
    for i in range(len(points) - 1):
        faces.extend((i * sides + k, i * sides + (k + 1) % sides,
                      (i + 1) * sides + (k + 1) % sides, (i + 1) * sides + k) for k in range(sides))
    return mesh(name, vertices, faces, [mat])


def ring(name, y0, y1, r0, r1, mat, sides=24):
    vertices = [(r * math.cos(k * math.tau / sides), y, r * math.sin(k * math.tau / sides))
                for y, r in [(y0, r0), (y1, r1)] for k in range(sides)]
    faces = [tuple(reversed(range(sides))), tuple(sides + k for k in range(sides))]
    faces.extend((k, (k + 1) % sides, sides + (k + 1) % sides, sides + k) for k in range(sides))
    return mesh(name, vertices, faces, [mat])


def plate(name, profile, z0, z1, mat):
    count = len(profile)
    vertices = [(x, y, z) for z in [z0, z1] for x, y in profile]
    faces = [tuple(reversed(range(count))), tuple(count + k for k in range(count))]
    faces.extend((k, (k + 1) % count, count + (k + 1) % count, count + k) for k in range(count))
    return mesh(name, vertices, faces, [mat])


def gem(name, x, y, rx, ry, front, z, depth):
    points = [(x, y + ry), (x + rx, y), (x, y - ry), (x - rx, y)]
    vertices = [(a, b, front * z) for a, b in points]
    vertices += [(x + (a - x) * .55, y + (b - y) * .55, front * (z + depth)) for a, b in points]
    vertices += [(x, y, front * (z - .002))]
    faces = [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (4, 5, 6, 7)]
    faces += [(k, (k + 1) % 4, 8) for k in range(4)]
    mesh(name, vertices, faces, [ruby])


# A new taper and a diamond spine; the same blade root/tip distances retain
# the accepted hit direction and clearance envelope.
stations = [(.115, .029), (.22, .031), (.60, .023), (.85, .015), (.945, .0065)]
section = [(-1, 0), (-.62, .0038), (0, .0062), (.62, .0038), (1, 0), (.62, -.0038), (0, -.0062), (-.62, -.0038)]
vertices = [(x * width, y, z * (.55 + .45 * width / .031)) for y, width in stations for x, z in section]
faces, mats = [tuple(reversed(range(8)))], [0]
for row in range(len(stations) - 1):
    for k in range(8):
        faces.append((row * 8 + k, row * 8 + (k + 1) % 8, (row + 1) * 8 + (k + 1) % 8, (row + 1) * 8 + k))
        mats.append(1 if k in [0, 3, 4, 7] else 0)
tip = len(vertices)
vertices.append((0, .99, 0))
for k in range(8):
    faces.append(((len(stations) - 1) * 8 + k, (len(stations) - 1) * 8 + (k + 1) % 8, tip))
    mats.append(1)
mesh('Role7 silver diamond blade', vertices, faces, [silver, edge], mats)

half = [(0, .082), (.035, .080), (.065, .094), (.088, .120), (.112, .158),
        (.107, .174), (.091, .153), (.070, .135), (.042, .125), (.021, .130), (0, .141)]
profile = half + [(-x, y) for x, y in reversed(half[1:-1])]
bevel(plate('Role7 mirrored swept wing guard', profile, -.012, .012, gold), .0017)
for front in [-1, 1]:
    for sign in [-1, 1]:
        shape = [(sign * x, y) for x, y in [(.025, .096), (.049, .096), (.074, .115), (.097, .146), (.068, .128), (.039, .116)]]
        bevel(plate('Silver guard feather', shape, front * .012, front * .014, silver), .0008)
        tube('Raised mirrored gold guard scroll', [(sign * x, y, front * .0155) for x, y in [(.020, .119), (.041, .113), (.065, .121), (.089, .143), (.107, .170)]], .001, gold)
    rim = [(-.016, .111), (0, .090), (.016, .111), (0, .139)]
    bevel(plate('Central gold ruby setting', rim, front * .013, front * .017, gold), .0008)
    gem('Central ruby fully inside its gold setting', 0, .113, .0118, .0185, front, .018, .004)
    leaf = [(-.021, .144), (-.019, .181), (0, .246), (.019, .181), (.021, .144)]
    bevel(plate('Silver and gold blade throat', leaf, front * .006, front * .009, gold), .0007, 2)
    gem('Forte ruby', 0, .171, .008, .020, front, .010, .002)
    # Smooth, uniformly spaced ornamentation on both blade faces.
    tube('Crimson central blade inlay', [(0, y, front * z) for y, z in [(.239, .0064), (.41, .0059), (.62, .0051), (.78, .0043), (.87, .0038)]], .0012, inlay, 6)
    for y in [.270 + .075 * i for i in range(8)]:
        width = .013 * (1 - (y - .27) / 1.1)
        z = .0065 - (y - .27) * .0032
        for sign in [-1, 1]:
            tube('Evenly spaced gold blade engraving', [(sign * width, y - .010, front * (z - .001)), (0, y + .012, front * z)], .00055, gold, 6)

# Exact accepted grip and collar radii: skin and wrist poses stay unchanged.
ring('Role7 burgundy leather grip', -.04545, .061, .0135, .0135, leather)
for phase in [0, math.pi]:
    points = []
    for k in range(181):
        t = k / 180
        # Match the original negative-Y compression of the Role6 binding.
        y = -.097 + t * .152
        if y < 0:
            y *= .45
        angle = phase + t * math.tau * 5
        points.append((.0138 * math.cos(angle), y, .0138 * math.sin(angle)))
    tube('Role7 gold leather lacing', points, .00045, gold, 6)
ring('Role7 guard ferrule', .060, .084, .017, .020, gold)
ring('Role7 pommel collar', -.0504, -.04455, .017, .015, gold)
ring('Role7 ruby pommel lower', -.06165, -.0558, .003, .022, gold, 12)
ring('Role7 ruby pommel upper', -.0558, -.0504, .022, .017, silver, 12)
for front in [-1, 1]:
    gem('Role7 pommel ruby', 0, -.055, .009, .0045, front, .018, .002)

for obj in parts:
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=.0000005)
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(obj.data)
    bm.free()
    assert not obj.data.validate()
bpy.ops.wm.save_as_mainfile(filepath=str(out / 'role7-sword.blend'))
bpy.ops.object.select_all(action='DESELECT')
for obj in parts:
    obj.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
obj = bpy.context.object
obj.name = 'Role7 authored ruby wing sword'
obj['role7SwordV1'] = True
bpy.ops.export_scene.gltf(filepath=str(out / 'role7-sword.glb'), export_format='GLB', export_yup=True,
                          export_extras=True, export_animations=False, export_cameras=False,
                          export_lights=False, use_selection=True)
report = {'authoring': 'Original procedural Blender sword matching the authorized Role7 armor palette',
          'outputSha256': hashlib.sha256((out / 'role7-sword.glb').read_bytes()).hexdigest(),
          'blenderVersion': bpy.app.version_string, 'parts': len(parts),
          'triangles': len(obj.data.polygons), 'gripRadiusMeters': .0135,
          'guardRootY': .115, 'bladeTipY': .99, 'pommelEndY': -.06165,
          'axes': 'blade +Y / edge +X / front +Z; original Role6 grip origin'}
(out / 'role7-sword.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print(json.dumps(report))
