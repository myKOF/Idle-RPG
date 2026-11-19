"""Inspect the supplied dragon, including a numbered bone map and orthographic views."""
import bpy, json, sys
from pathlib import Path
from mathutils import Vector

source, output = map(Path, sys.argv[sys.argv.index('--')+1:][:2])
output.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(source))
scene = bpy.context.scene
arm = next(o for o in scene.objects if o.type == 'ARMATURE')
body = next(o for o in scene.objects if o.type == 'MESH')
pts = [body.matrix_world @ v.co for v in body.data.vertices]
bounds = [[min(p[a] for p in pts), max(p[a] for p in pts)] for a in range(3)]
weights={g.name:0 for g in body.vertex_groups}
names={g.index:g.name for g in body.vertex_groups}
for vertex in body.data.vertices:
    for group in vertex.groups:
        if group.weight>.2:
            weights[names[group.group]]+=1
report = {'bounds':bounds,'armMatrix':[list(r) for r in arm.matrix_world],
          'vertices':len(pts),'faces':len(body.data.polygons), 'bones':[
    {'name':b.name, 'parent':b.parent.name if b.parent else None,
     'head':list(arm.matrix_world @ b.head_local),'tail':list(arm.matrix_world @ b.tail_local),
     'weights':weights.get(b.name,0)}
    for b in arm.data.bones]}
(output/'inspect.json').write_text(json.dumps(report,indent=2))
print('BOSS9_INSPECT',json.dumps(report))
scene.render.engine='BLENDER_WORKBENCH'
scene.display.shading.light='STUDIO'
scene.display.shading.color_type='TEXTURE'
scene.display.shading.show_shadows=True
scene.display.shading.show_cavity=True
scene.display.shading.background_type='WORLD'
scene.world=bpy.data.worlds.new('InspectionWorld')
scene.world.color=(.045,.055,.075)
scene.render.resolution_x=1100
scene.render.resolution_y=900
scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
target=Vector([(b[0]+b[1])/2 for b in bounds])
extent=max(b[1]-b[0] for b in bounds)
cam_data=bpy.data.cameras.new('Inspection')
cam=bpy.data.objects.new('Inspection',cam_data)
scene.collection.objects.link(cam)
scene.camera=cam
cam_data.type='ORTHO'
cam_data.ortho_scale=extent*1.14
for name, direction in [('front',(0,-1,.25)),('back',(0,1,.4)),('side',(1,0,.1)),('top',(0,.001,1)),('iso',(1,-1,.65))]:
    cam.location=target+Vector(direction).normalized()*extent*3
    cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler()
    scene.render.filepath=str(output/(name+'.png'))
    bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=str(output/'inspection.blend'))
cam_data.ortho_scale=.65
target=Vector((0,-.18,1.14))
cam.location=target+Vector((3,0,0))
cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler()
scene.render.filepath=str(output/'head.png')
bpy.ops.render.render(write_still=True)
