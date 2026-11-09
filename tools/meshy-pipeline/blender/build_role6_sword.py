"""Author the licensed Role6 reference sword in Blender, in metre grip space.
Usage: blender -b --python-exit-code 1 --python build_role6_sword.py -- OUT_DIR REFERENCE_PNG
Canonical exported axes: blade +Y, edge +X, front +Z, palm grip origin (0,0,0).
"""
import bpy,bmesh,math,json,hashlib,sys
from pathlib import Path
from mathutils import Vector
out,reference=map(Path,sys.argv[sys.argv.index('--')+1:]);out.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)

def material(name,color,metal,rough):
 m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True;s=m.node_tree.nodes.get('Principled BSDF');s.inputs['Base Color'].default_value=(*color,1);s.inputs['Metallic'].default_value=metal;s.inputs['Roughness'].default_value=rough;return m
gold=material('Warm carved gold',(.62,.35,.095),1,.29)
edge_gold=material('Polished gold ridges',(.80,.49,.15),1,.22)
dark_gold=material('Recessed gold engraving',(.15,.07,.018),.9,.42)
silver=material('Flat silver blade',(.69,.74,.78),1,.24)
silver_edge=material('Bright silver cutting bevel',(.90,.94,.97),1,.17)
leather=material('Dark brown grip leather',(.055,.025,.012),.05,.67)
parts=[]
def xyz(p):return (p[0],-p[2],p[1] if p[1]>=0 else p[1]*.45)
def mesh(name,verts,faces,mats,indices=None):
 data=bpy.data.meshes.new(name);data.from_pydata([xyz(p)for p in verts],[],faces);data.update();ob=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(ob)
 for m in mats:data.materials.append(m)
 if indices:
  for poly,mi in zip(data.polygons,indices):poly.material_index=mi
 bm=bmesh.new();bm.from_mesh(data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(data);bm.free();parts.append(ob);return ob

def bevel(ob,width=.0015,segments=3):
 bpy.context.view_layer.objects.active=ob;ob.select_set(True);mod=ob.modifiers.new('Sculpted edge rounding','BEVEL');mod.width=width;mod.segments=segments;bpy.ops.object.modifier_apply(modifier=mod.name);ob.select_set(False)

def tube(name,points,radius,mat,sides=8):
 pts=[Vector(p)for p in points];verts=[]
 for i,p in enumerate(pts):
  axis=(pts[min(i+1,len(pts)-1)]-pts[max(0,i-1)]).normalized();basis=Vector((0,0,1))
  if abs(axis.dot(basis))>.9:basis=Vector((1,0,0))
  u=axis.cross(basis).normalized();v=axis.cross(u).normalized()
  for k in range(sides):verts.append(tuple(p+radius*(u*math.cos(k*math.tau/sides)+v*math.sin(k*math.tau/sides))))
 faces=[tuple(reversed(range(sides))),tuple((len(pts)-1)*sides+k for k in range(sides))]
 for i in range(len(pts)-1):
  for k in range(sides):faces.append((i*sides+k,i*sides+(k+1)%sides,(i+1)*sides+(k+1)%sides,(i+1)*sides+k))
 return mesh(name,verts,faces,[mat])

def ring(name,y0,y1,r0,r1,mat,sides=24):
 verts=[(r*math.cos(i*math.tau/sides),y,r*math.sin(i*math.tau/sides))for y,r in [(y0,r0),(y1,r1)]for i in range(sides)];faces=[tuple(reversed(range(sides))),tuple(sides+i for i in range(sides))]
 for i in range(sides):faces.append((i,(i+1)%sides,(i+1)%sides+sides,i+sides))
 return mesh(name,verts,faces,[mat])

# A straight, fully closed diamond section with separate cutting bevels.
stations=[(.115,.028),(.185,.027),(.72,.019),(.945,.009)]
section=[(-1,0),(-.58,.0038),(0,.0062),(.58,.0038),(1,0),(.58,-.0038),(0,-.0062),(-.58,-.0038)]
verts=[(x*w,y,z*(.8+.2*w/.028))for y,w in stations for x,z in section];faces=[];mi=[]
faces.append(tuple(reversed(range(8))));mi.append(0)
for k in range(len(stations)-1):
 for i in range(8):faces.append((k*8+i,k*8+(i+1)%8,(k+1)*8+(i+1)%8,(k+1)*8+i));mi.append(1 if i in [0,3,4,7]else 0)
tip=len(verts);verts.append((0,.99,0))
for i in range(8):faces.append(((len(stations)-1)*8+i,(len(stations)-1)*8+(i+1)%8,tip));mi.append(1 if i in [0,3,4,7]else 0)
mesh('Straight silver blade and cutting bevels',verts,faces,[silver,silver_edge],mi)

# Fine gold edging follows the reference without the older red inlay.
for side in [-1,1]:
 points=[(.024,.15,side*.002),(.023,.20,side*.003),(.0168,.72,side*.0023),(.0076,.945,side*.0012),(0,.983,side*.0003)]
 tube('Fine gold blade accent '+str(side),points,.0008,edge_gold,6)

# Mirrored crescent horns sweep toward the blade. The lower edge is continuous
# under the palm, with thick inner shoulders and thin pointed outer tips.
half=[(0,.084),(.038,.082),(.074,.083),(.104,.097),(.124,.123),(.130,.152),(.124,.178),(.114,.155),(.096,.142),(.071,.134),(.038,.135),(0,.140)]
profile=half+ [(-x,y)for x,y in reversed(half[1:-1])]
verts=[(x,y,z)for z in [-.014,.014]for x,y in profile];n=len(profile);faces=[tuple(reversed(range(n))),tuple(n+i for i in range(n))]
for i in range(n):faces.append((i,(i+1)%n,(i+1)%n+n,i+n))
guard=mesh('Symmetric horn crescent guard',verts,faces,[gold]);bevel(guard,.0022,3)
for front in [-1,1]:
 for sign in [-1,1]:
  pts=[(sign*x,y,front*.0157)for x,y in [(.012,.106),(.040,.104),(.071,.107),(.098,.119),(.114,.140),(.124,.174)]]
  tube('Raised guard scroll '+str((front,sign)),pts,.0012,edge_gold,8)
  pts=[(sign*x,y,front*.016)for x,y in [(.021,.122),(.047,.119),(.070,.123),(.090,.135)]]
  tube('Inset guard carving '+str((front,sign)),pts,.0009,dark_gold,6)

# The ornate throat and leaf medallion visually join hilt and blade.
for front in [-1,1]:
 outline=[(-.018,.114),(-.020,.141),(-.014,.176),(0,.229),(.014,.176),(.020,.141),(.018,.114)]
 v=[(x,y,front*z)for z in [.008,.012]for x,y in outline];n=len(outline);f=[tuple(reversed(range(n))),tuple(n+i for i in range(n))]
 for i in range(n):f.append((i,(i+1)%n,(i+1)%n+n,i+n))
 throat=mesh('Gold leaf forte '+str(front),v,f,[gold]);bevel(throat,.0008,2)
 for sign in [-1,1]:
  tube('Forte engraved vein '+str((front,sign)),[(sign*.013,.137,front*.013),(sign*.009,.164,front*.013),(0,.214,front*.013)],.00075,edge_gold,6)
ring('Gold guard ferrule',.060,.084,.017,.020,gold)
# The grip diameter remains compatible with the approved closed right hand.
ring('Wrapped leather grip',-.101,.061,.0135,.0135,leather)
for phase in [0,math.pi]:
 pts=[]
 for i in range(181):
  t=i/180;y=-.097+t*.152;a=phase+t*math.tau*5;pts.append((.0138*math.cos(a),y,.0138*math.sin(a)))
 tube('Gold grip binding '+str(phase),pts,.00045,edge_gold,6)
ring('Pommel collar',-.112,-.099,.017,.015,gold)
ring('Faceted leaf pommel lower',-.137,-.124,.003,.022,gold,12)
ring('Faceted leaf pommel upper',-.124,-.112,.022,.017,edge_gold,12)

# Clean the editable components and preserve the source before merging export.
for ob in parts:
 bpy.context.view_layer.objects.active=ob;ob.select_set(True)
 bm=bmesh.new();bm.from_mesh(ob.data);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.0000005);bmesh.ops.triangulate(bm,faces=list(bm.faces));bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(ob.data);bm.free();assert not ob.data.validate();ob.select_set(False)
bpy.ops.wm.save_as_mainfile(filepath=str(out/'role6-sword.blend'))
bpy.ops.object.select_all(action='DESELECT')
for ob in parts:ob.select_set(True)
bpy.context.view_layer.objects.active=parts[0];bpy.ops.object.join();obj=bpy.context.object;obj.name='Role6 reference gold crescent sword';obj['role6SwordV1']=True
bpy.ops.export_scene.gltf(filepath=str(out/'role6-sword.glb'),export_format='GLB',export_yup=True,export_extras=True,export_animations=False,export_cameras=False,export_lights=False,use_selection=True)
raw=(out/'role6-sword.glb').read_bytes();report={'referenceSha256':hashlib.sha256(reference.read_bytes()).hexdigest(),'outputSha256':hashlib.sha256(raw).hexdigest(),'blenderVersion':bpy.app.version_string,'license':'Role6 model and reference artwork explicitly authorized by user in chat, 2026-11-09','parts':len(parts),'triangles':sum(len(p.vertices)-2 for p in obj.data.polygons),'gripRadiusMeters':.0135,'guardRootY':.115,'bladeTipY':.99,'pommelEndY':-.06165,'rearHiltLengthFactor':.45,'axes':'blade +Y / edge +X / front +Z / grip at origin; source image hidden details reasonably completed'}
(out/'role6-sword.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print(json.dumps(report))
