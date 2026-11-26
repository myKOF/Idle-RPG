"""Bake articulated chest lids from the project's own chest illustrations.

blender -b --python-exit-code 1 -P tools/chest-opening/build.py -- SOURCE OUTPUT [--preview]
The user's external GIF is a motion reference only and is never an input.
"""
import bpy
import math
import sys
import json
from pathlib import Path
from mathutils import Vector, Quaternion
from bpy_extras.object_utils import world_to_camera_view

args = sys.argv[sys.argv.index('--') + 1:]
source, output = (Path(p).resolve() for p in args[:2])
preview = '--preview' in args
output.mkdir(parents=True, exist_ok=True)
NAMES = ('bronze', 'fine', 'epic', 'legendary', 'mythic')
chosen = (args[args.index('--quality')+1],) if '--quality' in args else NAMES[:1] if preview else NAMES
assert all(name in NAMES for name in chosen)
COLORS = ((.52,.55,.60,1), (.18,.40,.64,1), (.42,.24,.56,1), (.61,.30,.11,1), (.69,.51,.14,1))
scene = bpy.context.scene
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
scene.render.engine = 'BLENDER_EEVEE_NEXT'
scene.eevee.taa_render_samples = 16
scene.render.resolution_x = 320
scene.render.resolution_y = 320
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.view_settings.view_transform = 'Standard'
scene.view_settings.look = 'None'
scene.world.color = (.18,.18,.18)
for name, location, energy, size in (
    ('InsideKey',(-3,5,7),450,5),('InsideFill',(4,1,5),180,4)):
    bpy.ops.object.light_add(type='AREA',location=location)
    light=bpy.context.object
    light.name=name
    light.rotation_euler=(Vector((0,1.4,0))-light.location).to_track_quat('-Z','Y').to_euler()
    light.data.energy=energy
    light.data.shape='DISK'
    light.data.size=size
bpy.ops.object.camera_add(location=(0,1.4,10))
camera = bpy.context.object
camera.name = 'ChestCamera'
camera.data.type = 'ORTHO'
camera.data.ortho_scale = 3.2
scene.camera = camera

def mesh(name, vertices, faces, material, parent=None, projected=False):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.materials.append(material)
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    if projected:
        uv = data.uv_layers.new(name='OriginalIllustration')
        for poly in data.polygons:
            for li in poly.loop_indices:
                v = data.vertices[data.loops[li].vertex_index].co
                uv.data[li].uv = ((v.x*100+160)/320, v.y*100/220)
    if parent:
        obj.parent = parent
        obj.matrix_parent_inverse = parent.matrix_world.inverted()
    return obj

def color_material(name, color, front_only=False, lit=False, metallic=0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = color
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    out = nodes.new('ShaderNodeOutputMaterial')
    emission = nodes.new('ShaderNodeBsdfPrincipled' if lit else 'ShaderNodeEmission')
    emission.inputs['Base Color' if lit else 'Color'].default_value = color
    if lit:
        emission.inputs['Roughness'].default_value=.58
        emission.inputs['Metallic'].default_value=metallic
    if front_only:
        geom = nodes.new('ShaderNodeNewGeometry')
        mix = nodes.new('ShaderNodeMixShader')
        transparent = nodes.new('ShaderNodeBsdfTransparent')
        links.new(geom.outputs['Backfacing'],mix.inputs[0])
        links.new(emission.outputs[0],mix.inputs[1])
        links.new(transparent.outputs[0],mix.inputs[2])
        links.new(mix.outputs[0],out.inputs[0])
    else:
        links.new(emission.outputs[0],out.inputs[0])
    return mat

def image_material(name, filename, backing=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    image = bpy.data.images.load(str(filename), check_existing=True)
    image.pack()
    if backing is not None:
        # The illustration has a transparent silhouette. A solid shell cannot:
        # extend its own edge colours into unused UV pixels instead of exposing
        # the internal wall through an alpha cutout when the lid rotates.
        original=list(image.pixels[:]);width,height=image.size
        rows=[]
        for y in range(height):
            valid=[x for x in range(width) if original[(y*width+x)*4+3]>.95]
            rows.append(valid)
        valid_rows=[y for y,row in enumerate(rows) if row]
        extended=original[:]
        for y in range(height):
            sy=y if rows[y] else min(valid_rows,key=lambda row:abs(row-y))
            valid=rows[sy]
            for x in range(width):
                dst=(y*width+x)*4
                if original[dst+3]<=.95:
                    sx=min(valid,key=lambda column:abs(column-x))
                    src=(sy*width+sx)*4
                    extended[dst:dst+3]=original[src:src+3]
                extended[dst+3]=1
        image=image.copy();image.name=name+'_OpaqueEdgeColours'
        image.pixels[:]=extended;image.pack()
    texture = nodes.new('ShaderNodeTexImage')
    texture.image = image
    texture.interpolation = 'Linear'
    emission = nodes.new('ShaderNodeEmission')
    links.new(texture.outputs['Color'],emission.inputs['Color'])
    transparent = nodes.new('ShaderNodeBsdfTransparent' if backing is None else 'ShaderNodeEmission')
    if backing is not None:
        transparent.inputs['Color'].default_value=backing
    mix = nodes.new('ShaderNodeMixShader')
    links.new(texture.outputs['Alpha'],mix.inputs[0])
    links.new(transparent.outputs[0],mix.inputs[1])
    links.new(emission.outputs[0],mix.inputs[2])
    out = nodes.new('ShaderNodeOutputMaterial')
    links.new(mix.outputs[0],out.inputs[0])
    return mat

def point(px, py, depth=0):
    return Vector(((px-160)/100,(220-py)/100,depth))

A = point(70,73)
W = Vector((2.22,-.06,.15))
V = Vector((-.52,-.39,.90))
H = Vector((.06,.76,.15))
axis = W.normalized()
MOUTH_SIDE = .055
MOUTH_END = .075
INNER_SIDE = .12
INNER_WAIST = .075
INNER_END = .12
INNER_ARCH = .72
RECESS_OFFSET = .12
OPEN_DEGREES = 60
mouth_normal=W.cross(V).normalized()

def lining_surface(u,t):
    theta=math.pi*t
    f=INNER_END+(1-2*INNER_END)*(.5-.5*math.cos(theta))
    side=INNER_SIDE+INNER_WAIST*math.sin(theta)
    return A+W*(side+(1-2*side)*u)+V*f+H*(INNER_ARCH*math.sin(theta))-mouth_normal*RECESS_OFFSET

def lining_point(u,t,offset=0):
    p=lining_surface(u,t)
    tangent=lining_surface(u,min(1,t+.001))-lining_surface(u,max(0,t-.001))
    inward=W.cross(tangent).normalized()
    return p+inward*offset

def mouth_point(u,t):
    f=MOUTH_END+(1-2*MOUTH_END)*(.5-.5*math.cos(math.pi*t))
    return A+W*(MOUTH_SIDE+(1-2*MOUTH_SIDE)*u)+V*f

def rod(name, a, b, radius, mat, parent=None):
    delta = b-a
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=radius, depth=delta.length, location=(a+b)/2)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_mode = 'QUATERNION'
    obj.rotation_quaternion = delta.to_track_quat('Z','Y')
    obj.data.materials.append(mat)
    if parent:
        obj.parent = parent
        obj.matrix_parent_inverse = parent.matrix_world.inverted()
    return obj

def engraving(name, coords, material, parent, normal, radius=.006, origin=None):
    """Self-authored inset curves on the lid's local lining plane."""
    curve=bpy.data.curves.new(name,'CURVE')
    curve.dimensions='3D'
    curve.bevel_depth=radius
    curve.bevel_resolution=2
    spline=curve.splines.new('POLY')
    spline.points.add(len(coords)-1)
    for p,(u,t) in zip(spline.points,coords):
        v=lining_point(u,t,.018) if parent and origin is None else (A if origin is None else origin)+W*u+V*t+normal*.026
        p.co=(*v,1)
    obj=bpy.data.objects.new(name,curve)
    scene.collection.objects.link(obj)
    obj.data.materials.append(material)
    if parent:
        obj.parent=parent
        obj.matrix_parent_inverse=parent.matrix_world.inverted()
    return obj

def lining_texture(material, color):
    nodes,links=material.node_tree.nodes,material.node_tree.links
    noise=nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value=95
    noise.inputs['Detail'].default_value=2
    ramp=nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color=tuple(c*.55 for c in color[:3])+(1,)
    ramp.color_ramp.elements[1].color=tuple(c*1.5 for c in color[:3])+(1,)
    links.new(noise.outputs['Fac'],ramp.inputs[0])
    shader=next(n for n in nodes if n.type in ('EMISSION','BSDF_PRINCIPLED'))
    uv=nodes.new('ShaderNodeTexCoord')
    separate=nodes.new('ShaderNodeSeparateXYZ')
    links.new(uv.outputs['UV'],separate.inputs[0])
    phase=nodes.new('ShaderNodeMath');phase.operation='MULTIPLY';phase.inputs[1].default_value=math.pi
    links.new(separate.outputs['Y'],phase.inputs[0])
    depth=nodes.new('ShaderNodeMath');depth.operation='SINE';links.new(phase.outputs[0],depth.inputs[0])
    dark=nodes.new('ShaderNodeMath');dark.operation='MULTIPLY_ADD';dark.inputs[1].default_value=-.62;dark.inputs[2].default_value=1
    links.new(depth.outputs[0],dark.inputs[0])
    tint=nodes.new('ShaderNodeMixRGB');tint.blend_type='MULTIPLY';tint.inputs[0].default_value=1
    links.new(ramp.outputs['Color'],tint.inputs[1]);links.new(dark.outputs[0],tint.inputs[2])
    links.new(tint.outputs[0],shader.inputs['Base Color' if shader.type=='BSDF_PRINCIPLED' else 'Color'])

def cap_profile(name,points,material,parent,radius=.012):
    curve=bpy.data.curves.new(name,'CURVE');curve.dimensions='3D';curve.bevel_depth=radius;curve.bevel_resolution=2
    spline=curve.splines.new('POLY');spline.points.add(len(points)-1)
    for target,p in zip(spline.points,points):target.co=(*p,1)
    obj=bpy.data.objects.new(name,curve);scene.collection.objects.link(obj);curve.materials.append(material)
    obj.parent=parent;obj.matrix_parent_inverse=parent.matrix_world.inverted()

def decorate_lining(name, quality, parent, normal, metal, accent):
    def line(label, pts, radius=.006, material=metal):
        engraving(name+'_'+label,pts,material,parent,normal,radius)
    for inset in (.045,.070):
        line('InsetBorder',[(inset,inset),(1-inset,inset),(1-inset,1-inset),(inset,1-inset),(inset,inset)],.004)
    # Paired scrolls and leaf loops are drawn analytically, not copied from art.
    for mirror in (-1,1):
        for flip in (-1,1):
            coords=[]
            for i in range(45):
                a=i/44*math.pi*2.4
                r=.075*(1-i/60)
                coords.append((.5+mirror*(.225+r*math.cos(a)),.5+flip*(.23+r*2*math.sin(a))))
            line('Scroll',coords,.005)
    for u,t in ((.105,.16),(.895,.16),(.105,.84),(.895,.84)):
        for sign in (-1,1):
            line('CornerLeaf',[(u+sign*.028*math.sin(a),t+.065*math.sin(a)*math.cos(a)) for a in [i*math.pi/20 for i in range(41)]],.0045)
    # Central emblem uses distinct self-authored motifs per quality.
    sides=(4,4,6,5,8)[quality]
    ellipse=[(.5+.125*math.cos(a),.5+.25*math.sin(a)) for a in [i*math.tau/96 for i in range(97)]]
    line('CrestRing',ellipse,.008)
    star=[]
    for i in range(sides*2+1):
        a=i*math.pi/sides-math.pi/2
        r=1 if i%2==0 else .43
        star.append((.5+.10*r*math.cos(a),.5+.20*r*math.sin(a)))
    line('QualityCrest',star,.010,accent)
    line('CrestCore',[(.5+.026*math.cos(a),.5+.052*math.sin(a)) for a in [i*math.tau/32 for i in range(33)]],.009,accent)
    # Small studs catch the light at the inset corners and band joins.
    for u,t in ((.075,.075),(.925,.075),(.075,.925),(.925,.925)):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=8,ring_count=4,radius=.018,location=lining_point(u,t,.022))
        obj=bpy.context.object
        obj.name=name+'_InsetStud'
        obj.data.materials.append(metal)
        obj.parent=parent
        obj.matrix_parent_inverse=parent.matrix_world.inverted()

report = []
for name in chosen:
    quality=NAMES.index(name)
    for obj in list(scene.objects):
        if obj != camera and obj.type!='LIGHT':
            bpy.data.objects.remove(obj,do_unlink=True)
    illustration = image_material(name+'_Original',source/(name+'.png'))
    lid_art = image_material(name+'_OpaqueSideArt',source/(name+'.png'),tuple(c*.18+.025 for c in COLORS[quality][:3])+(1,))
    interior = color_material(name+'_Interior',(.012,.009,.008,1))
    wall = color_material(name+'_InteriorWalls',(.028,.022,.018,1))
    lining_color=((.045,.032,.022,1),(.017,.029,.050,1),(.030,.018,.045,1),(.050,.018,.009,1),(.025,.021,.012,1))[quality]
    lining = color_material(name+'_LidLining',lining_color,True,True)
    lining_texture(lining,lining_color)
    next(n for n in lining.node_tree.nodes if n.type=='BSDF_PRINCIPLED').inputs['Roughness'].default_value=.85
    trim = color_material(name+'_Metal',tuple(c*.24 for c in COLORS[quality][:3])+(1,),lit=True,metallic=.5)
    highlight = color_material(name+'_TrimHighlight',tuple(c*.45+.025 for c in COLORS[quality][:3])+(1,),lit=True,metallic=.6)
    accent = color_material(name+'_Engraving',tuple(c*.65+.045 for c in COLORS[quality][:3])+(1,),lit=True,metallic=.45)
    edge = color_material(name+'_ThickEdge',tuple(c*.30+.035 for c in COLORS[quality][:3])+(1,),lit=True,metallic=.3)
    corner_accent=color_material(name+'_RecessCornerHighlight',tuple(c*.30+.12 for c in COLORS[quality][:3])+(1,))
    slope_materials={label:color_material(name+'_RecessWall_'+label,tuple(c*gain+base for c in COLORS[quality][:3])+(1,),lit=True,metallic=.12)
                     for label,gain,base in (('Left',.16,.055),('Right',.25,.07),('Rear',.09,.025),('Front',.18,.05))}
    # The original front and right walls remain completely stationary.
    poly = [(0,112),(242,118),(300,78),(320,78),(320,220),(0,220)]
    body=mesh(name+'_FixedBody',[point(x,y,1.04) for x,y in poly],[tuple(range(len(poly)))],illustration,projected=True)
    corners = [A,A+W,A+W+V,A+V]
    floor = [p-Vector((0,.30,.085)) for p in corners]
    mesh(name+'_InteriorFloor',floor,[(0,1,2,3)],interior)
    for i in range(4):
        j=(i+1)%4
        mesh(name+'_InnerWall_'+str(i),[corners[i],corners[j],floor[j],floor[i]],[(0,1,2,3)],wall)
    floor_ink=color_material(name+'_FloorEmboss',tuple(c*.08+.004 for c in COLORS[quality][:3])+(1,))
    floor_normal=-W.cross(V).normalized()
    for inset in (.08,.12):
        engraving(name+'_CushionSeam',[(inset,inset),(1-inset,inset),(1-inset,1-inset),(inset,1-inset),(inset,inset)],floor_ink,None,floor_normal,.004,floor[0])
    for u in (.25,.5,.75):
        for t in (.25,.5,.75):
            engraving(name+'_QuiltDiamond',[(u-.055,t),(u,t-.11),(u+.055,t),(u,t+.11),(u-.055,t)],floor_ink,None,floor_normal,.003,floor[0])
    for i in range(4):
        rod(name+'_BodyRim_'+str(i),corners[i],corners[(i+1)%4],.018,trim)
    bpy.ops.object.empty_add(type='PLAIN_AXES',location=A)
    hinge = bpy.context.object
    hinge.name = name+'_RearHinge'
    # A real depth-bearing curved shell, rather than a rotating flat crop.
    vertices, faces = [], []
    nu, nt = 18, 24
    for u in range(nu+1):
        for t in range(nt+1):
            angle = math.pi*t/nt
            vertices.append(A+(u/nu)*W+(.5-.5*math.cos(angle))*V+math.sin(angle)*H)
    for u in range(nu):
        for t in range(nt):
            i=u*(nt+1)+t
            faces.append((i,i+1,i+nt+2,i+nt+1))
    outer=mesh(name+'_CurvedLid',vertices,faces,lid_art,hinge,True)
    # Each visible end is a complete textured semi-disc, including the area
    # inside its rim. Opaque backing prevents transparent illustration pixels
    # from cutting holes in the actual solid cap.
    for label,u in (('Left',0),('Right',nu)):
        cap=[vertices[u*(nt+1)+t] for t in range(nt+1)]
        endcap=mesh(name+'_OuterEndCap_'+label,cap,[tuple(range(len(cap)))],lid_art,hinge,True)
        # Sample the right end's complete illustrated panel for both solid ends.
        # The hidden left end has no separate painted pixels in the source view.
        for polygon in endcap.data.polygons:
            for li in polygon.loop_indices:
                index=endcap.data.loops[li].vertex_index
                theta=math.pi*index/nt
                source_x=280-40*(.5-.5*math.cos(theta))
                source_y=95-50*math.sin(theta)
                endcap.data.uv_layers.active.data[li].uv=(source_x/320,1-source_y/220)
        outward=V.cross(H).normalized()
        if outward.dot(W)<0:outward=-outward
        if u==0:outward=-outward
        for inset in (.89,.74):
            profile=[]
            for t in range(nt+1):
                theta=math.pi*t/nt
                profile.append(A+W*(u/nu)+V*(.5+inset*(-.5*math.cos(theta)))+H*(inset*math.sin(theta))+outward*.006)
            profile.append(profile[0])
            cap_profile(name+'_SideCapRib_'+label,profile,highlight,hinge,.010 if inset>.8 else .006)
        for t in (.22,.5,.78):
            theta=math.pi*t
            location=A+W*(u/nu)+V*(.5+.89*(-.5*math.cos(theta)))+H*(.89*math.sin(theta))+outward*.020
            bpy.ops.mesh.primitive_uv_sphere_add(segments=8,ring_count=4,radius=.018,location=location)
            rivet=bpy.context.object;rivet.name=name+'_SideCapRivet_'+label;rivet.data.materials.append(highlight)
            rivet.parent=hinge;rivet.matrix_parent_inverse=hinge.matrix_world.inverted()
    inner_vertices=[lining_point(u/nu,t/nt) for u in range(nu+1) for t in range(nt+1)]
    inner_faces=[tuple(reversed(face)) for face in faces]
    inside=mesh(name+'_InsideLid',inner_vertices,inner_faces,lining,hinge)
    uv=inside.data.uv_layers.new(name='RecessDepth')
    for polygon in inside.data.polygons:
        for li in polygon.loop_indices:
            index=inside.data.loops[li].vertex_index
            uv.data[li].uv=(index//(nt+1)/nu,index%(nt+1)/nt)
    for polygon in inside.data.polygons:
        polygon.use_smooth=True
    # Seal all four edges between the outer barrel and recessed inner barrel.
    # End walls are curved solid crescents, not transparent illustration caps.
    for label,indices in (
        ('Left',[t for t in range(nt+1)]),
        ('Right',[nu*(nt+1)+t for t in range(nt+1)]),
        ('Rear',[u*(nt+1) for u in range(nu+1)]),
        ('Front',[u*(nt+1)+nt for u in range(nu+1)])):
        wall_vertices=[vertices[i] for i in indices]+[inner_vertices[i] for i in indices]
        count=len(indices)
        wall_faces=[(i,i+1,i+1+count,i+count) for i in range(count-1)]
        mesh(name+'_LidWall_'+label,wall_vertices,wall_faces,edge,hinge)
    # The wide mouth remains forward. Clearly sloped walls descend into the
    # narrower and deeper curved lining, providing visible depth in this view.
    for label,u in (('Left',0),('Right',1)):
        wall_vertices=[mouth_point(u,t/nt) for t in range(nt+1)]+[lining_point(u,t/nt) for t in range(nt+1)]
        count=nt+1
        mesh(name+'_InnerSlope_'+label,wall_vertices,[(i,i+1,i+1+count,i+count) for i in range(count-1)],slope_materials[label],hinge)
    for label,t in (('Rear',0),('Front',1)):
        wall_vertices=[mouth_point(u/nu,t) for u in range(nu+1)]+[lining_point(u/nu,t) for u in range(nu+1)]
        count=nu+1
        mesh(name+'_InnerSlope_'+label,wall_vertices,[(i,i+1,i+1+count,i+count) for i in range(count-1)],slope_materials[label],hinge)
    inner_corners=[mouth_point(0,0),mouth_point(1,0),mouth_point(1,1),mouth_point(0,1)]
    rim_vertices=[p+mouth_normal*.025 for p in corners+inner_corners]
    mesh(name+'_SolidMouthRim',rim_vertices,[(i,(i+1)%4,(i+1)%4+4,i+4) for i in range(4)],highlight,hinge)
    for u,t in ((0,0),(1,0),(1,1),(0,1)):
        cap_profile(name+'_RecessCornerEdge',[mouth_point(u,t)+mouth_normal*.026,lining_point(u,t,.020)],corner_accent,hinge,.014)
    for u in (0,1):
        cap_profile(name+'_DeepSideEdge',[lining_point(u,i/24,.021) for i in range(25)],corner_accent,hinge,.008)
    for t in (0,1):
        cap_profile(name+'_DeepEndEdge',[lining_point(i/18,t,.021) for i in range(19)],corner_accent,hinge,.008)
    normal = W.cross(V).normalized()
    for u in (.18,.82):
        band=[lining_point(u+side*.014,t/24,.012) for t in range(25) for side in (-1,1)]
        ribbon=mesh(name+'_LiningBand',band,[(2*t,2*t+1,2*t+3,2*t+2) for t in range(24)],trim,hinge)
        for polygon in ribbon.data.polygons:
            polygon.use_smooth=True
        for t in (.10,.90):
            bpy.ops.mesh.primitive_uv_sphere_add(segments=8,ring_count=4,radius=.023,location=lining_point(u,t,.025))
            rivet=bpy.context.object
            rivet.name=name+'_LiningRivet'
            rivet.data.materials.append(highlight)
            rivet.parent=hinge
            rivet.matrix_parent_inverse=hinge.matrix_world.inverted()
    decorate_lining(name,quality,hinge,normal,highlight,accent)
    for i in range(4):
        rod(name+'_LidFrame_'+str(i),corners[i],corners[(i+1)%4],.025,highlight,hinge)
    for u in (.12,.88):
        rod(name+'_HingeBarrel',A+W*(u-.035),A+W*(u+.035),.045,highlight)
    hinge.rotation_mode = 'QUATERNION'
    scene.frame_start, scene.frame_end = 1, 25
    for frame in range(25):
        hinge.rotation_quaternion = Quaternion(axis,-math.radians(OPEN_DEGREES)*frame/24)
        hinge.keyframe_insert('rotation_quaternion',frame=frame+1)
    for fc in hinge.animation_data.action.fcurves:
        for key in fc.keyframe_points:
            key.interpolation='LINEAR'
    max_hinge_error=0
    body_vertices=[body.matrix_world@v.co for v in body.data.vertices]
    for frame in range(25):
        scene.frame_set(frame+1)
        bpy.context.view_layer.update()
        for index,expected in ((0,A),(nu*(nt+1),A+W)):
            actual=outer.matrix_world@outer.data.vertices[index].co
            max_hinge_error=max(max_hinge_error,(actual-expected).length)
        for v,expected in zip(body.data.vertices,body_vertices):
            assert ((body.matrix_world@v.co)-expected).length<1e-7
    assert max_hinge_error<1e-5,max_hinge_error
    scene.frame_set(25);bpy.context.view_layer.update()
    roof=outer.matrix_world@outer.data.vertices[9*(nt+1)+12].co
    front=(outer.matrix_world@outer.data.vertices[24].co+outer.matrix_world@outer.data.vertices[nu*(nt+1)+24].co)/2
    exposed_roof=(world_to_camera_view(scene,camera,roof).y-world_to_camera_view(scene,camera,front).y)*320
    assert exposed_roof>15,exposed_roof
    source_image=bpy.data.images.load(str(source/(name+'.png')),check_existing=True)
    pixels=source_image.pixels[:]
    cap_alpha=min(pixels[(y*320+x)*4+3] for y in range(125,175) for x in range(240,281))
    assert cap_alpha>.95,cap_alpha
    scene.frame_set(1)
    bpy.ops.wm.save_as_mainfile(filepath=str(output/(name+'.blend')))
    frames = [0,12,24] if preview else range(25)
    target = output/name
    target.mkdir(exist_ok=True)
    for frame in frames:
        scene.frame_set(frame+1)
        scene.render.filepath = str(target/(str(frame).zfill(2)+'.png'))
        bpy.ops.render.render(write_still=True)
    thicknesses=[(Vector(vertices[i])-Vector(inner_vertices[i])).length for i in range(len(vertices))]
    recess=abs((lining_point(.5,.5)-(A+W*.5+V*.5)).dot(mouth_normal))
    assert min(thicknesses)>.04 and recess>.3
    report.append({'name':name,'frames':len(frames),'axis':list(axis),'hingeA':list(A),'hingeB':list(A+W),'endDegrees':OPEN_DEGREES,'maxHingeError':max_hinge_error,'fixedBodySamples':25,'minShellThickness':min(thicknesses),'maxShellThickness':max(thicknesses),'liningRecessDepth':recess,'edgeWalls':4,'innerSurfaceVertices':len(inner_vertices),'opaqueTexturedEndCaps':2,'slopedCavityWalls':4,'mouthWidth':(1-2*MOUTH_SIDE)*W.length,'recessedCenterWidth':(1-2*(INNER_SIDE+INNER_WAIST))*W.length,'mouthRimFaces':4,'cornerHighlights':4,'exposedRoofPixels':exposed_roof,'capSourceAlphaMin':cap_alpha})
(output/'build-report.json').write_bytes(json.dumps(report,indent=2).encode('utf-8'))
