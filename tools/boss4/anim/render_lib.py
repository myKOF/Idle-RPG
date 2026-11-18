import bpy, math
from mathutils import Vector, Matrix

def bone_proxy(arm, name="BoneProxy", color=(1,0.5,0,1), only=None):
    """Build octahedral bone meshes (posed) for rendering."""
    import bmesh
    bm = bmesh.new()
    for pb in arm.pose.bones:
        if only and pb.name not in only: continue
        h = arm.matrix_world @ pb.head; t = arm.matrix_world @ pb.tail
        L = (t-h).length
        if L < 1e-6: continue
        d = (t-h).normalized()
        up = Vector((0,0,1)) if abs(d.z)<0.9 else Vector((1,0,0))
        x = d.cross(up).normalized(); y = d.cross(x).normalized()
        w = max(L*0.1, 0.004)
        m = h + d*L*0.15
        vs = [bm.verts.new(h), bm.verts.new(t)]
        ring = [bm.verts.new(m + x*w), bm.verts.new(m + y*w), bm.verts.new(m - x*w), bm.verts.new(m - y*w)]
        for i in range(4):
            a, b = ring[i], ring[(i+1)%4]
            bm.faces.new((vs[0], a, b)); bm.faces.new((vs[1], b, a))
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=w*0.9, matrix=Matrix.Translation(h))
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
    mat = bpy.data.materials.new(name+"Mat"); mat.diffuse_color = color
    me.materials.append(mat)
    return ob

def setup_scene(res=(900,900)):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.render.resolution_x, sc.render.resolution_y = res
    sh = sc.display.shading
    sh.light = 'STUDIO'; sh.color_type = 'MATERIAL'
    sh.show_cavity = True; sh.show_object_outline = True
    sc.render.film_transparent = False
    sh.background_type = 'VIEWPORT'
    return sc

def cam_ortho(name, loc, target, scale):
    cd = bpy.data.cameras.new(name); cd.type='ORTHO'; cd.ortho_scale=scale
    c = bpy.data.objects.new(name, cd); bpy.context.scene.collection.objects.link(c)
    c.location = loc
    dirv = (Vector(target)-Vector(loc))
    c.rotation_euler = dirv.to_track_quat('-Z','Y').to_euler()
    return c

def render(cam, path):
    sc = bpy.context.scene; sc.camera = cam
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
