"""Author Role4's licensed reference sword in Blender, independently reviewable.
blender -b --python-exit-code 1 --python build_role4_sword.py -- OUTPUT_DIRECTORY REFERENCE_PNG ROLE4_GLB
The reference PNG is user-authorized in chat (2026-11-05). The sword is new solid geometry. Reference
proportions and visible ornaments are rebuilt, not a flattened photograph.
Grip origin is (0,0,0), glTF blade axis +Y, edge +X, face +Z, in metres.
"""
import bpy
import bmesh
import json
import math
import hashlib
from pathlib import Path
import sys
import struct
import tempfile
import numpy as np
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
out, reference, role_source = Path(args[0]), Path(args[1]), Path(args[2])
out.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
materials = {}

def material(name, color, metal, roughness):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Metallic'].default_value = metal
    bsdf.inputs['Roughness'].default_value = roughness
    materials[name] = mat
    return mat

silver = material('Polished silver cutting bevel', (.62, .65, .70), .95, .24)
dark = material('Blackened central steel', (.040, .045, .052), .82, .34)
bronze = material('Aged warm guard recess', (.045, .038, .030), .85, .34)
red = material('Crimson blade flame inlay', (.34, .006, .009), .55, .29)
inlay_material = red.copy()
inlay_material.name = 'Reference crimson vine relief'
red_light = material('Ruby lit facet', (.62, .018, .022), .35, .14)
red_dark = material('Ruby shadow facet', (.15, .001, .003), .4, .21)
leather = material('Black leather grip', (.012, .010, .009), 0, .63)
wrap = material('Raised leather binding', (.028, .024, .021), 0, .58)
parts = []
reference_image = bpy.data.images.load(str(reference), check_existing=False)
reference_image.pack()

engraved_blade = dark
engraved_guard = bronze

# Trace the visible outline in the supplied 284x484 reference. Deproject the
# weapon's image axis so the resulting model stands straight in its own frame.
origin = Vector((96, 262.5))
axis = (Vector((13, 403)) - origin).normalized()
cross = Vector((axis.y, -axis.x))
pixel_m = .00425
guard_y = .115

def trace(points):
    result = []
    for point in points:
        d = Vector(point) - origin
        result.append((d.dot(cross) * pixel_m, guard_y + d.dot(axis) * pixel_m))
    return result

def xyz(x, y, depth):
    # Blender Z up becomes glTF Y up; front is Blender -Y / glTF +Z.
    return (x, -depth, y)

def mesh_object(name, vertices, faces, mats, face_mats=None):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    for mat in mats:
        mesh.materials.append(mat)
    if face_mats:
        for face, index in zip(mesh.polygons, face_mats):
            face.material_index = index
    # UVs follow the reference camera projection on both solid faces. Leather,
    # cutting bevels and raised ruby remain physically shaded plain materials.
    uv = mesh.uv_layers.new(name='Licensed reference projection')
    for loop in mesh.loops:
        p = mesh.vertices[loop.vertex_index].co
        pixel = origin + cross*(p.x/pixel_m) + axis*((p.z-guard_y)/pixel_m)
        uv.data[loop.index].uv = (pixel.x/reference_image.size[0], 1-pixel.y/reference_image.size[1])
    bm = bmesh.new(); bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    bm.to_mesh(mesh); bm.free()
    parts.append(obj)
    return obj

def beveled_polygon(name, poly, inner, depth, edge_depth, core_mat, edge_mat=silver):
    n = len(poly)
    vertices = [xyz(x, y, z) for points, z in [(poly, edge_depth), (inner, depth), (poly, -edge_depth), (inner, -depth)] for x, y in points]
    faces, indices = [], []
    for i in range(n):
        j = (i + 1) % n
        faces.extend([(i, j, n+j, n+i), (2*n+j, 2*n+i, 3*n+i, 3*n+j), (j, i, 2*n+i, 2*n+j)])
        indices.extend([1, 1, 1])
    faces.extend([tuple(range(n, 2*n)), tuple(reversed(range(3*n, 4*n)))])
    indices.extend([0, 0])
    return mesh_object(name, vertices, faces, [core_mat, edge_mat], indices)

def slab(name, poly, z, thickness, mat):
    n = len(poly)
    vertices = [xyz(x, y, d) for d in [z-thickness/2, z+thickness/2] for x, y in poly]
    faces = [tuple(reversed(range(n))), tuple(range(n, 2*n))]
    faces += [(i, (i+1)%n, (i+1)%n+n, i+n) for i in range(n)]
    return mesh_object(name, vertices, faces, [mat])

blade = [(-.014,.142),(-.018,.158),(-.029,.174),(-.041,.181),
    (-.039,.194),(-.039,.25),(-.036,.36),(-.031,.49),(-.021,.64),
    (-.010,.745),(0,.806),(.010,.745),(.021,.64),(.031,.49),
    (.036,.36),(.039,.25),(.039,.194),(.041,.181),(.029,.174),
    (.018,.158),(.014,.142)]
blade_inner=[(x*.59,y if i!=10 else y-.018)for i,(x,y)in enumerate(blade)]
beveled_polygon('Straight tapered blade, silver bevels and black central steel',blade,blade_inner,.0048,.00045,dark)

def reference_inlay():
    reference_image.colorspace_settings.name='Non-Color'
    iw,ih=reference_image.size;pixels=np.empty(iw*ih*4,dtype=np.float32)
    reference_image.pixels.foreach_get(pixels);pixels=pixels.reshape(ih,iw,4)[::-1]
    def inside(point,poly):
        x,y=point;hit=False
        for i,(ax,ay)in enumerate(poly):
            bx,by=poly[(i+1)%len(poly)]
            if (ay>y)!=(by>y)and x<(bx-ax)*(y-ay)/(by-ay)+ax:hit=not hit
        return hit
    cells=[]
    for y in range(277,374):
        for x in range(20,96):
            r,g,b,a=pixels[y,x]
            if r>.16 and r>g*1.45 and r>b*1.35 and inside(trace([(x+.5,y+.5)])[0],blade_inner):cells.append((x,y))
    # Keep the licensed ornament, but normalize its width and brightness along
    # the blade. The source photo compressed the upper vine into a thin line.
    samples=np.array([(*trace([(x+.5,y+.5)])[0],pixels[y,x,0])for x,y in cells])
    rows=np.linspace(float(samples[:,1].min()),float(samples[:,1].max()),40)
    widths=[];centers=[];means=[]
    for y in rows:
        near=samples[np.abs(samples[:,1]-y)<.024]
        if not len(near):near=samples[np.argsort(np.abs(samples[:,1]-y))[:5]]
        lo,hi=float(near[:,0].min()),float(near[:,0].max())
        widths.append(max((hi-lo)/2,.002));centers.append((lo+hi)/2);means.append(float(near[:,2].mean()))
    y_min,y_max=float(rows[0]),float(rows[-1]);global_red=float(samples[:,2].mean())
    profile=sorted((y,abs(x))for x,y in blade_inner[:11])
    profile_y=np.array([p[0]for p in profile]);profile_x=np.array([p[1]for p in profile])
    cell_set=set(cells)
    def corner_key(point,cell):
        x,y=point
        neighbors=cell_set.intersection({(x-1,y-1),(x,y-1),(x-1,y),(x,y)})
        if len(neighbors)==2:
            a,b=list(neighbors)
            if abs(a[0]-b[0])==1 and abs(a[1]-b[1])==1:return(point,cell)
        return point
    for side in [-1,1]:
        vertices=[];faces=[];lookup={}
        for x,y in cells:
            face=[]
            for point in [(x,y),(x+1,y),(x+1,y+1),(x,y+1)]:
                key=corner_key(point,(x,y))
                if key not in lookup:lookup[key]=len(vertices);vertices.append(xyz(*trace([point])[0],side*.0052))
                face.append(lookup[key])
            faces.append(face)
        obj=mesh_object('Reference red vine relief '+str(side),vertices,faces,[inlay_material])
        bm=bmesh.new();bm.from_mesh(obj.data)
        remaining=set(bm.verts);tiny=[]
        while remaining:
            todo=[remaining.pop()];component=[]
            while todo:
                v=todo.pop();component.append(v)
                for e in v.link_edges:
                    q=e.other_vert(v)
                    if q in remaining:remaining.remove(q);todo.append(q)
            if len(component)<8:tiny.extend(component)
        bmesh.ops.delete(bm,geom=tiny,context='VERTS')
        for repeat in range(4):
            changes={}
            for v in bm.verts:
                adjacent=[e.other_vert(v)for e in v.link_edges if e.is_boundary]
                if len(adjacent)==2:changes[v]=v.co*.5+(adjacent[0].co+adjacent[1].co)*.25
            for v,q in changes.items():v.co=q
        bm.to_mesh(obj.data);bm.free()
        attr=obj.data.color_attributes.new(name='Reference crimson shading',type='FLOAT_COLOR',domain='POINT')
        for vertex,item in zip(obj.data.vertices,attr.data):
            old_x,old_y=vertex.co.x,vertex.co.z
            pixel=origin+cross*(vertex.co.x/pixel_m)+axis*((vertex.co.z-guard_y)/pixel_m)
            x=min(iw-1,max(0,int(pixel.x)));y=min(ih-1,max(0,int(pixel.y)))
            r,g,b=pixels[y,x,:3]
            gain=global_red/max(float(np.interp(old_y,rows,means)),.01)
            r=float(np.clip(r*gain,0,1));rgb=(r,min(g*gain,r*.30),min(b*gain,r*.32))
            item.color=tuple(float(v/12.92 if v<=.04045 else((v+.055)/1.055)**2.4)for v in rgb)+(1,)
            center=float(np.interp(old_y,rows,centers));half_width=float(np.interp(old_y,rows,widths))
            core_width=float(np.interp(old_y,profile_y,profile_x))
            # A constant fraction of the available dark core, tapered only at
            # the ends of the ornament rather than becoming dense at the root.
            end_fade=min(1,max(.25,(old_y-y_min)/.015),max(.25,(y_max-old_y)/.015))
            normalized=math.tanh((old_x-center)/half_width)/math.tanh(1.35)
            vertex.co.x=normalized*core_width*.83*end_fade
        solid=obj.modifiers.new('Solid crimson inlay','SOLIDIFY');solid.thickness=.00035;solid.offset=0
        bpy.context.view_layer.objects.active=obj;bpy.ops.object.modifier_apply(modifier=solid.name)
color_node=inlay_material.node_tree.nodes.new('ShaderNodeVertexColor');color_node.layer_name='Reference crimson shading'
inlay_material.node_tree.links.new(color_node.outputs['Color'],inlay_material.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
reference_inlay()

guard = trace([(73,254),(75,249),(79,246),(83,245),(82,249),(87,252),
    (94,253),(99,253),(102,257),(103,262),(107,266),(112,267),
    (111,272),(107,276),(106,272),(101,268),(97,268),(93,273),
    (88,273),(85,269),(83,263),(83,259),(79,256),(74,256)])
center = Vector((0, guard_y))
def smooth_polygon(poly, steps=4):
    result=[]
    for i in range(len(poly)):
        p0,p1,p2,p3=[Vector(poly[j%len(poly)]) for j in [i-1,i,i+1,i+2]]
        for k in range(steps):
            t=k/steps
            p=.5*((2*p1)+(-p0+p2)*t+(2*p0-5*p1+4*p2-p3)*t*t+(-p0+3*p1-3*p2+p3)*t*t*t)
            result.append(tuple(p))
    return result
def mirror_guard(poly):
    """Clip to the left silhouette, then mirror exactly around grip X=0."""
    left=[]
    for i,p in enumerate(poly):
        previous=poly[i-1];inside=p[0]<=0;was_inside=previous[0]<=0
        if inside!=was_inside:
            t=-previous[0]/(p[0]-previous[0])
            left.append((0,previous[1]+t*(p[1]-previous[1])))
        if inside:left.append(p)
    start=next(i for i,p in enumerate(left)if abs(p[0])<1e-8 and left[(i+1)%len(left)][0]<-1e-8)
    left=left[start:]+left[:start]
    assert abs(left[0][0])<1e-8 and abs(left[-1][0])<1e-8
    return left+[(-x,y)for x,y in reversed(left[1:-1])]
guard=smooth_polygon(mirror_guard(guard))
guard_inner = [tuple(center+(Vector(p)-center)*.91) for p in guard]
guard_obj=beveled_polygon('Swept hooked quillons with silver rim and warm recess',guard,guard_inner,.007,.0034,bronze)

def bake_guard_detail():
    """Bake only licensed fine ornament onto our newly built solid guard."""
    data=role_source.read_bytes();jn=struct.unpack_from('<I',data,12)[0]
    raw=json.loads(data[20:20+jn]);binary=data[28+jn:]
    def arr(index):
        a=raw['accessors'][index];v=raw['bufferViews'][a['bufferView']];k={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']]
        dt=np.dtype({5121:'u1',5123:'<u2',5125:'<u4',5126:'<f4'}[a['componentType']])
        return np.ndarray((a['count'],k),dtype=dt,buffer=binary,offset=v.get('byteOffset',0)+a.get('byteOffset',0),strides=(v.get('byteStride',dt.itemsize*k),dt.itemsize)).copy()
    rp=raw['meshes'][0]['primitives'][0];p=arr(rp['attributes']['POSITION']);uv=arr(rp['attributes']['TEXCOORD_0']);tri=arr(rp['indices']).reshape(-1,3)
    axis=Vector((.47,-1,0)).normalized();edge=Vector((-axis.y,axis.x,0));ts=p@np.array(axis);xs=p@np.array(edge)
    verts=[];faces=[];uvs=[]
    for face in tri:
        t=float(ts[face].mean());x=float(xs[face].mean());z=float(p[face,2].mean())
        if not(-1.44<t<-1.30 and abs(x-.513)<.12 and z<-.112):continue
        faces.append(tuple(range(len(verts),len(verts)+3)))
        for i in face:
            verts.append(xyz(float(xs[i]-.513),float(ts[i]+1.4623865316),float(-(p[i,2]+.145)*.35)))
            u,v=uv[i];uvs.append((u,1-v))
    src=mesh_object('Temporary authorized guard detail bake source',verts,faces,[bronze]);parts.remove(src)
    for loop in src.data.loops:src.data.uv_layers.active.data[loop.index].uv=uvs[loop.vertex_index]
    ti=raw['materials'][0]['pbrMetallicRoughness']['baseColorTexture']['index'];im=raw['images'][raw['textures'][ti]['source']];v=raw['bufferViews'][im['bufferView']];start=v.get('byteOffset',0)
    with tempfile.TemporaryDirectory()as td:
        file=Path(td)/'licensed.png';file.write_bytes(binary[start:start+v['byteLength']]);image=bpy.data.images.load(str(file),check_existing=False);image.pack()
    mat=bpy.data.materials.new('Temporary licensed emission color');mat.use_nodes=True;n=mat.node_tree.nodes;n.clear();tex=n.new('ShaderNodeTexImage');tex.image=image;emission=n.new('ShaderNodeEmission');output=n.new('ShaderNodeOutputMaterial');mat.node_tree.links.new(tex.outputs['Color'],emission.inputs['Color']);mat.node_tree.links.new(emission.outputs[0],output.inputs['Surface']);src.data.materials[0]=mat
    for obj in parts:obj.hide_render=True
    bpy.ops.object.camera_add(location=(0,-3,.115));camera=bpy.context.object;camera.name='Temporary guard bake camera';camera.rotation_euler=(Vector((0,0,.115))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=.23
    scene=bpy.context.scene;scene.camera=camera;scene.render.engine='CYCLES';scene.cycles.samples=1;scene.cycles.use_denoising=False;scene.render.resolution_x=512;scene.render.resolution_y=512;scene.render.resolution_percentage=100
    scene.world=bpy.data.worlds.new('Temporary dark bake background');scene.world.color=(.005,.005,.005);scene.render.image_settings.file_format='PNG';scene.view_settings.view_transform='Standard';scene.view_settings.look='None';scene.view_settings.exposure=0;scene.view_settings.gamma=1
    scene.render.filepath=str(out/'guard-detail.png');bpy.ops.render.render(write_still=True)
    baked=bpy.data.images.load(str(out/'guard-detail.png'),check_existing=False)
    bw,bh=baked.size;rgba=np.empty(bw*bh*4,dtype=np.float32);baked.pixels.foreach_get(rgba);rgba=rgba.reshape(bh,bw,4)
    rgba[:,bw//2:]=rgba[:,:bw//2][:,::-1]
    # The ruby is the only red feature on the guard. Neutralize the old baked
    # ruby underneath it, so no red fringe appears even at an oblique angle.
    r,g,b=rgba[:,:,0],rgba[:,:,1],rgba[:,:,2]
    red_pixels=(r>g*1.4)&(r>b*1.35)&(r>.025)
    value=.2126*r+.7152*g+.0722*b
    for channel in range(3):rgba[:,:,channel][red_pixels]=value[red_pixels]
    baked.pixels.foreach_set(rgba.reshape(-1));baked.filepath_raw=str(out/'guard-detail.png');baked.file_format='PNG';baked.save();baked.pack()
    material_guard=material('Rebuilt guard with licensed high resolution ornament', (1,1,1),.82,.34)
    texture=material_guard.node_tree.nodes.new('ShaderNodeTexImage');texture.image=baked;material_guard.node_tree.links.new(texture.outputs['Color'],material_guard.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
    guard_obj.data.materials[0]=material_guard
    for loop in guard_obj.data.loops:
        p=guard_obj.data.vertices[loop.vertex_index].co;guard_obj.data.uv_layers.active.data[loop.index].uv=(p.x/.23+.5,(p.z-.115)/.23+.5)
    bpy.data.objects.remove(src,do_unlink=True);bpy.data.objects.remove(camera,do_unlink=True)
    for obj in parts:obj.hide_render=False
bake_guard_detail()

gem = [(-.014,.138),(.014,.138),(.016,.100),(0,.090),(-.016,.100)]
gc = sum((Vector(p) for p in gem), Vector((0, 0))) / len(gem)
bezel = [tuple(gc+(Vector(p)-gc)*1.20) for p in gem]
bezeled = [tuple(gc+(Vector(p)-gc)*.94) for p in gem]
beveled_polygon('Silver ruby bezel', bezel, bezeled, .0105, .008, dark)
for side in [-1,1]:
    n = len(gem)
    vertices = [xyz(x,y,side*.0108) for x,y in gem] + [xyz(gc.x,gc.y,side*.017)]
    faces = [(i,(i+1)%n,n) for i in range(n)] + [tuple(reversed(range(n)))]
    mesh_object('Faceted ruby guard jewel '+str(side), vertices, faces, [red_light,red,red_dark], [0,1,2,1,0,2])

def cylinder(name, radius, length, y, mat, vertices=16):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=length, location=(0,0,y))
    obj=bpy.context.object;obj.name=name;obj.data.materials.append(mat)
    bevel=obj.modifiers.new('Soft machined edge','BEVEL');bevel.width=.0007;bevel.segments=1
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    parts.append(obj)
    return obj

cylinder('Grip core matching approved 28mm hand opening', .014, .176, -.005, leather)
cylinder('Upper silver grip collar', .016, .011, .0885, silver)
cylinder('Lower crimson pommel collar', .0172, .012, -.098, red)
cylinder('Pommel silver ring', .0185, .005, -.107, silver)

curve=bpy.data.curves.new('Spiral black leather wrap','CURVE');curve.dimensions='3D'
curve.bevel_depth=.00060;curve.bevel_resolution=1;curve.resolution_u=1;curve.use_fill_caps=True
spline=curve.splines.new('POLY');steps=17*16;spline.points.add(steps)
for i,p in enumerate(spline.points):
    t=i/steps;angle=t*17*2*math.pi
    p.co=(.0143*math.cos(angle),.0143*math.sin(angle),-.087+t*.165,1)
obj=bpy.data.objects.new('Continuous raised leather binding',curve);bpy.context.collection.objects.link(obj);obj.data.materials.append(wrap);parts.append(obj)

bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=6,radius=1,location=(0,0,-.120))
obj=bpy.context.object;obj.name='Faceted domed silver pommel';obj.scale=(.021,.021,.016);obj.data.materials.append(silver);parts.append(obj)

# Keep the editable part construction and export one compact, applied mesh.
for image in bpy.data.images:
    if image.packed_file:image.filepath='//'+Path(image.name).stem+'.png'
for obj in parts:obj.select_set(False)
bpy.ops.wm.save_as_mainfile(filepath=str(out/'role4-sword.blend'))
bpy.ops.object.select_all(action='DESELECT')
for obj in parts:obj.select_set(True)
bpy.context.view_layer.objects.active=parts[0]
bpy.ops.object.convert(target='MESH')
bpy.ops.object.join();obj=bpy.context.object;obj.name='Role4 reference sword'
bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
bpy.ops.export_scene.gltf(filepath=str(out/'role4-sword.glb'),export_format='GLB',use_selection=True,export_yup=True,export_extras=True)
report={'reference':'User-authorized codex-clipboard-c400eec7-e636-4887-ac31-ac3b7361012b.png, 2026-11-05',
    'referenceSha256':hashlib.sha256(reference.read_bytes()).hexdigest(),'sourceRoleSha256':hashlib.sha256(role_source.read_bytes()).hexdigest(),
    'outputSha256':hashlib.sha256((out/'role4-sword.glb').read_bytes()).hexdigest(),
    'blenderVersion':bpy.app.version_string,'construction':'New solid geometry from the licensed visible design: straight tapered silver bevels, dark core, geometric crimson flame/vines, hooked guard, ruby, black wrapped grip and silver pommel',
    'gripOriginMeters':[0,0,0],'bladeAxis':[0,1,0],'edgeAxis':[1,0,0],'faceAxis':[0,0,1],
    'gripRadiusMeters':.014,'guardFromGripMeters':guard_y,'bladeTipFromGripMeters':max(y for x,y in blade),
    'pommelEndFromGripMeters':-.136,'triangles':sum(len(p.vertices)-2 for p in obj.data.polygons),'vertices':len(obj.data.vertices),
    'license':'User explicitly states reference is licensed and requests exact replication; unseen reverse face uses matching symmetric detailing',
    'detailSource':'New geometric outline and red inlay rebuilt from the authorized reference; fine guard color baked in Blender from authorized Role4 material',
    'revision':2,'guardMirrorAxis':'X=0','guardTextureMirrored':True,'oldGuardRedPigmentNeutralized':True,
    'inlayDistribution':'Blade-width normalized with local brightness balancing',
    'stage':'Second independent sword candidate after user symmetry, ruby coverage and ornament distribution feedback; not yet installed in the game or Role4 character'}
(out/'sword-report.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report))
