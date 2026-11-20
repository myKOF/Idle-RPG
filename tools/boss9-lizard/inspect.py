"""Import the newly supplied lizard without modifying it and record native rig data."""
import bpy,sys,json,hashlib
from pathlib import Path
source,out=map(Path,sys.argv[sys.argv.index('--')+1:][:2]);out.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(source))
sc=bpy.context.scene;sc.render.fps=24;arm=next(o for o in sc.objects if o.type=='ARMATURE');body=next(o for o in sc.objects if o.type=='MESH')
actions=list(bpy.data.actions)
report={'sourceSHA256':hashlib.sha256(source.read_bytes()).hexdigest(),'objects':[(o.name,o.type,[list(row) for row in o.matrix_world]) for o in sc.objects],'actions':[(a.name,list(a.frame_range)) for a in actions],'bones':{},'vertices':len(body.data.vertices),'faces':len(body.data.polygons),'samples':[]}
for b in arm.data.bones:report['bones'][b.name]={'parent':b.parent.name if b.parent else None,'head':list(b.head_local),'tail':list(b.tail_local),'length':b.length}
for a in actions:
 arm.animation_data.action=a;arm.animation_data.action_slot=a.slots[0]
 for f in [a.frame_range[0]+(a.frame_range[1]-a.frame_range[0])*i/4 for i in range(5)]:
  sc.frame_set(int(f),subframe=f%1);bpy.context.view_layer.update();report['samples'].append({'frame':f,'bones':{p.name:{'head':list(p.head),'tail':list(p.tail),'matrix':[list(r) for r in p.matrix]} for p in arm.pose.bones}})
groups={g.index:g.name for g in body.vertex_groups};report['weights']=[{groups[g.group]:g.weight for g in v.groups} for v in body.data.vertices];report['positions']=[list(v.co) for v in body.data.vertices]
sc.frame_set(int(actions[0].frame_range[0]));bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(out/'original.blend'))
(out/'inspection.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print('LIZARD_INSPECTED',json.dumps({k:v for k,v in report.items() if k in ['sourceSHA256','actions','vertices','faces']}),flush=True)
