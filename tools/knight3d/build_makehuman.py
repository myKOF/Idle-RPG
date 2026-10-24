"""MakeHuman anatomy -> fitted original silver harness, static review only.

Run in Blender. Official source checkouts stay outside the game repository.
The bundled .blend keeps the CC0 anatomy and the individual armor pieces.
"""
import argparse
import importlib
import json
import math
import hashlib
import subprocess
import sys
from pathlib import Path

sys.dont_write_bytecode = True
import bpy
import bmesh
import addon_utils
from mathutils import Vector, Matrix, Quaternion
from mathutils.bvhtree import BVHTree
from bpy_extras.object_utils import world_to_camera_view

p = argparse.ArgumentParser()
p.add_argument('--mpfb', required=True, help='Official mpfb2 Git checkout')
p.add_argument('--makehuman', required=True, help='Official MakeHuman Git checkout')
p.add_argument('--output', required=True)
p.add_argument('--preview', required=True)
p.add_argument('--inspect', action='store_true')
p.add_argument('--revision', type=int, choices=[6,7], default=6)
a = p.parse_args(sys.argv[sys.argv.index('--') + 1:])
OUT = Path(a.output).resolve()
PREVIEW = Path(a.preview).resolve()
if any((OUT/name).exists() for name in ['knight_batch1.blend','knight_lookdev.blend']):
    raise ValueError('Use a separate MakeHuman candidate folder; earlier animation/static packages are frozen.')
if a.revision==7 and OUT.name=='makehuman-r6':
    raise ValueError('R6 is frozen; use a separate makehuman-r7 output folder.')
OUT.mkdir(parents=True, exist_ok=True)
PREVIEW.mkdir(parents=True, exist_ok=True)
extension_repo = bpy.context.preferences.extensions.repos.new(
    name='Codex MakeHuman Source', module='codex_makehuman',
    custom_directory=str(Path(a.mpfb).resolve() / 'src'))
module_name = 'bl_ext.codex_makehuman.mpfb'
addon_utils.enable(module_name, default_set=True, persistent=False)
HumanService = importlib.import_module(module_name + '.services.humanservice').HumanService
TargetService = importlib.import_module(module_name + '.services.targetservice').TargetService

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
MACRO = TargetService.get_default_macro_info_dict()
MACRO.update(gender=1.0, age=.50, muscle=.62, weight=.43,
             proportions=.68, height=.60)
if a.revision==7:MACRO.update(muscle=.46,weight=.35,proportions=.62,height=.67)
MACRO['race'] = {'asian': .15, 'caucasian': .80, 'african': .05}
body = HumanService.create_human(macro_detail_dict=MACRO)
body.name = 'MakeHuman | original anatomical foundation'
rig = HumanService.add_builtin_rig(body, 'game_engine')
rig.name = 'MakeHuman_Knight_Rig'
bpy.context.view_layer.update()
info = {'macro': MACRO, 'vertices': len(body.data.vertices),
        'faces': len(body.data.polygons),
        'groups': [g.name for g in body.vertex_groups],
        'bones': {b.name: {'head': list(b.head_local), 'tail': list(b.tail_local),
                            'parent': b.parent.name if b.parent else None}
                  for b in rig.data.bones}}
(PREVIEW / 'anatomy-inspect.json').write_text(json.dumps(info, indent=2))
if a.inspect:
    bpy.ops.wm.save_as_mainfile(filepath=str(PREVIEW / 'anatomy-inspect.blend'))
    print('MAKEHUMAN_INSPECT', json.dumps({k:v for k,v in info.items() if k != 'groups'}))
    raise SystemExit(0)

# A fresh MakeHuman source, not a reshaped copy of the earlier mannequin.
HumanService.serialize_to_json_file(body, str(OUT / 'knight-human.json'))
mhm = ['# MakeHuman silver knight anatomy; armor and pose are in the .blend',
       'version v1.3.0', 'name Silver Knight']
for group, name, value in [
    ('macrodetails', 'Gender', MACRO['gender']), ('macrodetails', 'Age', MACRO['age']),
    ('macrodetails-universal', 'Muscle', MACRO['muscle']),
    ('macrodetails-universal', 'Weight', MACRO['weight']),
    ('macrodetails-height', 'Height', MACRO['height']),
    ('macrodetails-proportions', 'BodyProportions', MACRO['proportions']),
    *[('macrodetails', key.title(), value) for key, value in MACRO['race'].items()]]:
    mhm.append(f'modifier {group}/{name} {value}')
(OUT / 'knight.mhm').write_text('\n'.join(mhm) + '\n')

# Exercise the native preset import, rather than only saving a list of sliders.
settings=HumanService.get_default_deserialization_settings()
settings.update(clothes_deep_search=False,bodypart_deep_search=False,
                load_clothes=False,subdiv_levels=0,override_rig='NONE')
roundtrip=HumanService.deserialize_from_mhm(str(OUT/'knight.mhm'),settings)
bpy.context.view_layer.update();deps=bpy.context.evaluated_depsgraph_get()
mesh1=bpy.data.meshes.new_from_object(body.evaluated_get(deps))
mesh2=bpy.data.meshes.new_from_object(roundtrip.evaluated_get(deps))
assert len(mesh1.vertices)==len(mesh2.vertices)
error=max((v.co-w.co).length for v,w in zip(mesh1.vertices,mesh2.vertices))
assert error<1e-5,('Native MHM round trip changed anatomy',error)
(PREVIEW/'anatomy-roundtrip.json').write_text(json.dumps({'result':'PASS',
    'nativeMhmImportMaxVertexError':error,'bodyVertices':len(mesh1.vertices)},indent=2))
bpy.data.objects.remove(roundtrip,do_unlink=True)
bpy.data.meshes.remove(mesh1);bpy.data.meshes.remove(mesh2)

def material(name, rgb, metal=0, rough=.5):
    m = bpy.data.materials.new(name); m.diffuse_color = (*rgb, 1)
    if not m.use_nodes:m.use_nodes = True
    bs = m.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value = (*rgb, 1)
    bs.inputs['Metallic'].default_value = metal
    bs.inputs['Roughness'].default_value = rough
    return m

steel = material('01 satin silver main plates', (.54,.535,.525), .36,.57)
edge = material('02 rubbed silver rolled edges', (.66,.65,.63), .45,.46)
shadowsteel = material('03 shaded silver overlaps', (.38,.375,.365), .32,.61)
cloth = material('04 charcoal brown arming doublet', (.055,.043,.033), 0,.89)
mail = material('05 dark mail articulation', (.095,.088,.076), .40,.66)
leather = material('06 leather belts and gloves', (.095,.055,.027), 0,.72)
black = material('07 visor slit and seams', (.009,.012,.014), .15,.65)
palette = [steel,edge,shadowsteel,cloth,mail,leather,black]
parts = []

def skin(o, bone):
    g=o.vertex_groups.get(bone) or o.vertex_groups.new(name=bone)
    g.add(list(range(len(o.data.vertices))),1,'REPLACE')
    mod=o.modifiers.new('MakeHuman skeleton', 'ARMATURE');mod.object=rig
    o.parent=rig
    return o

def mesh(name, vv, ff, mat, bone=None, smooth=True, thickness=0):
    d=bpy.data.meshes.new(name);d.from_pydata(vv,[],ff);d.update()
    o=bpy.data.objects.new(name,d);bpy.context.collection.objects.link(o)
    d.materials.append(mat)
    for f in d.polygons:f.use_smooth=smooth
    if thickness:
        mod=o.modifiers.new('Folded plate thickness','SOLIDIFY');mod.thickness=thickness;mod.offset=-1
        mod.use_rim_only=True
        bpy.context.view_layer.objects.active=o
        bpy.ops.object.modifier_apply(modifier=mod.name)
    if bone:skin(o,bone)
    parts.append(o)
    return o

def tube(name, points, radius, mat, bone, n=6):
    vv=[]
    for i,pnt in enumerate(points):
        pnt=Vector(pnt);direction=Vector(points[min(i+1,len(points)-1)])-Vector(points[max(0,i-1)])
        direction.normalize();xx=direction.cross(Vector((0,0,1)))
        if xx.length<.01:xx=direction.cross(Vector((0,1,0)))
        xx.normalize();yy=direction.cross(xx).normalized()
        for j in range(n):
            q=j*math.tau/n;vv.append(pnt+radius*(xx*math.cos(q)+yy*math.sin(q)))
    ff=[(i*n+j,i*n+(j+1)%n,(i+1)*n+(j+1)%n,(i+1)*n+j)
        for i in range(len(points)-1) for j in range(n)]
    return mesh(name,vv,ff,mat,bone)

def ellipsoid(name, center, radii, mat, bone, seg=12, rows=6):
    vv=[]
    for i in range(rows+1):
        t=.015+(math.pi-.03)*i/rows
        for j in range(seg):
            q=j*math.tau/seg;vv.append((center[0]+radii[0]*math.sin(t)*math.cos(q),
                center[1]+radii[1]*math.sin(t)*math.sin(q),center[2]+radii[2]*math.cos(t)))
    ff=[(i*seg+j,i*seg+(j+1)%seg,(i+1)*seg+(j+1)%seg,(i+1)*seg+j)
        for i in range(rows) for j in range(seg)]
    return mesh(name,vv,ff,mat,bone)

def form(name, rings, mat, bone, count=24, ridge=0, cap=False):
    vv=[]
    for z,rx,ry,cy,cx in rings:
        for j in range(count):
            q=math.tau*j/count;x=rx*math.sin(q)
            y=-ry*math.cos(q)-ridge*max(0,math.cos(q))**7
            point=Vector((cx+x,cy+y,z))
            if name.startswith(('Cuirass','Plackart','Fauld','Belt','Mail','Gorget')):
                origin=Vector((cx,cy,z));direction=(point-origin).normalized()
                hit,normal,index,dist=anatomy_bvh.ray_cast(origin,direction,.35*K)
                if hit is not None:
                    gap=.012*K if name.startswith(('Belt','Fauld')) else .008*K
                    point=origin+direction*max((point-origin).length,dist+gap)
            vv.append(point)
    ff=[(i*count+j,i*count+(j+1)%count,(i+1)*count+(j+1)%count,(i+1)*count+j)
        for i in range(len(rings)-1) for j in range(count)]
    if cap:ff.extend([tuple(reversed(range(count))),tuple((len(rings)-1)*count+j for j in range(count))])
    return mesh(name,vv,ff,mat,bone,thickness=.0035*K)

def limb(name, bone, rows, mat, count=18, arc=math.pi, start=-math.pi):
    count=min(count,16)
    b=rig.data.bones[bone];axis=(b.tail_local-b.head_local).normalized()
    front=Vector((0,-1,0));front=(front-axis*front.dot(axis)).normalized()
    lateral=axis.cross(front).normalized();vv=[];reverse=False
    if name.startswith('Pauldron'):
        sign=1 if bone.endswith('_l') else -1
        if lateral.x*sign<0:lateral=-lateral;reverse=True
    for t,rx,ry in rows:
        center=b.head_local+(b.tail_local-b.head_local)*t
        for j in range(count+1):
            q=start+(arc-start)*j/count
            delta=K*(rx*math.sin(q)*lateral+ry*math.cos(q)*front)
            if name.startswith('Pauldron | fitted crown'):
                if math.sin(q)<0:delta*=.65
                if t>.35:center_offset=axis*(.025*K*max(0,math.cos(q))**3)
                else:center_offset=Vector((0,0,0))
            else:center_offset=Vector((0,0,0))
            if name.startswith(('Rerebrace','Vambrace','Cuisse','Greave')):
                hit,normal,index,dist=anatomy_bvh.ray_cast(center,delta.normalized(),.15*K)
                if hit is not None:delta=delta.normalized()*max(delta.length,dist+.006*K)
            vv.append(center+delta+center_offset)
    nc=count+1
    ff=[(i*nc+j,i*nc+j+1,(i+1)*nc+j+1,(i+1)*nc+j)
        for i in range(len(rows)-1) for j in range(count)]
    if reverse:ff=[tuple(reversed(f)) for f in ff]
    return mesh(name,vv,ff,mat,bone,thickness=.003*K)

K = rig.data.bones['upperarm_l'].head_local.z / 1.2608943
def rings(data):return [(z*K,x*K,y*K,cy*K,cx*K) for z,x,y,cy,cx in data]

# Keep the original MakeHuman model, shape keys and standard weights for editing.
# Only a reduced covered-body copy participates in the small-screen candidate.
deps=bpy.context.evaluated_depsgraph_get()
base_mesh=bpy.data.meshes.new_from_object(body.evaluated_get(deps),preserve_all_data_layers=True,depsgraph=deps)
if a.revision==7:full_anatomy_surface=base_mesh.copy()
anatomy_bvh=BVHTree.FromPolygons([v.co for v in base_mesh.vertices],
                               [list(f.vertices) for f in base_mesh.polygons])
suit=body.copy();suit.data=base_mesh;bpy.context.collection.objects.link(suit)
suit.name='Anatomical arming suit and genuine MakeHuman hands'
for mod in list(suit.modifiers):suit.modifiers.remove(mod)
# Hidden face geometry must not poke through the closed helmet's visor.
bm=bmesh.new();bm.from_mesh(suit.data)
cut=rig.data.bones['head'].head_local.z-.075*K
bmesh.ops.delete(bm,geom=[v for v in bm.verts if v.co.z>cut],context='VERTS')
# Fully covered skin is omitted. The original uncut anatomy remains editable
# in the hidden MakeHuman source, while elbows/knees/hands keep real weights.
deform=bm.verts.layers.deform.active
remove=[]
for f in bm.faces:
    c=f.calc_center_median();weights={}
    for v in f.verts:
        for gi,w in v[deform].items():
            name=suit.vertex_groups[gi].name
            if name in rig.data.bones:weights[name]=weights.get(name,0)+w
    dominant=max(weights,key=weights.get) if weights else ''
    covered=dominant.startswith(('spine_','pelvis')) and .98*K<c.z<1.36*K
    if a.revision==7:covered=abs(c.x)<.22*K and .970*K<c.z<1.36*K
    if dominant.startswith(('upperarm_','lowerarm_','thigh_','calf_')):
        bn=rig.data.bones[dominant];axis=bn.tail_local-bn.head_local
        t=(c-bn.head_local).dot(axis)/axis.length_squared
        lo,hi=(.48,.95) if dominant.startswith('upperarm') else ((.12,.98) if dominant.startswith(('lowerarm','calf')) else (.09,.89))
        covered=lo<t<hi
        if a.revision==7:covered=False
    if covered:remove.append(f)
bmesh.ops.delete(bm,geom=remove,context='FACES')
loose=[v for v in bm.verts if not v.link_faces]
if loose:bmesh.ops.delete(bm,geom=loose,context='VERTS')
bm.to_mesh(suit.data);bm.free()
suit.data.materials.clear();suit.data.materials.append(cloth);suit.data.materials.append(leather)
for f in suit.data.polygons:
    names={suit.vertex_groups[g.group].name for vi in f.vertices for g in suit.data.vertices[vi].groups if g.weight>.3}
    f.material_index=int(any(n.startswith(('hand_','index_','thumb_','middle_','ring_','pinky_')) for n in names))
    f.use_smooth=True
bpy.context.view_layer.objects.active=suit
dec=suit.modifiers.new('Covered body reduction','DECIMATE');dec.ratio=.19
bpy.ops.object.modifier_apply(modifier=dec.name)
mod=suit.modifiers.new('MakeHuman skeleton','ARMATURE');mod.object=rig
parts.append(suit)
body.hide_render=True;body.hide_set(True)
body['source']='MakeHuman CC0 hm08 anatomy with macro targets via official MPFB'

if a.revision==7:
    spec=importlib.util.spec_from_file_location('silver_knight_armor',Path(__file__).with_name('silver_knight_armor.py'))
    armor=importlib.util.module_from_spec(spec);spec.loader.exec_module(armor)
    armor.build(globals())
else:
    # Cuirass: one continuous hammered breastplate, a distinct plackart and a low
    # articulated waist. Its silhouette follows chest/rib cage, not a narrow tube.
    form('Cuirass | swept anatomical breastplate',rings([
        (1.07,.138,.100,.010,0),(1.115,.155,.116,.006,0),
        (1.205,.181,.125,.004,0),(1.285,.188,.119,.002,0),
        (1.333,.157,.100,-.002,0),(1.355,.094,.077,-.010,0)]),steel,'spine_03',32,.008*K)
    plackart=form('Plackart | pointed overlapping lower cuirass',rings([
        (.982,.130,.102,.010,0),(1.03,.137,.109,.009,0),(1.09,.151,.117,.006,0),
        (1.134,.149,.118,.003,0)]),shadowsteel,'spine_02',28,.014*K)
    rim=[plackart.data.vertices[3*28+i].co.copy() for i in range(28)]
    rim.append(rim[0].copy())
    tube('Plackart | rolled upper overlap',rim,.0023*K,edge,'spine_02')
    for j,z in enumerate([.925,.963,.998]):
        form('Fauld | curved articulated waist '+str(j),rings([
            (z,.151,.109,.006,0),(z+.029,.144,.108,.006,0)]),steel,'pelvis',24,.002*K)
    form('Belt | brown leather at natural waist',rings([
        (.948,.156,.116,.008,0),(.975,.153,.115,.008,0)]),leather,'pelvis',24)
    tube('Belt | restrained iron buckle',[(x*K,-.113*K,z*K) for x,z in [(-.025,.95),(-.025,.978),(.025,.978),(.025,.95),(-.025,.95)]],.003*K,shadowsteel,'pelvis')
    form('Mail | short split skirt foundation',rings([
        (.775,.163,.108,.008,0),(.87,.175,.112,.008,0),(.94,.144,.097,.007,0)]),mail,'pelvis',24)
    form('Gorget | fitted throat and collar',rings([
        (1.325,.105,.088,-.012,0),(1.375,.078,.067,-.014,0),
        (1.407,.061,.060,-.020,0)]),shadowsteel,'neck_01',24)

    # Rolled breastplate rim; restrained highlights give legible plate boundaries.
    for z,rx,ry,cy in [(1.355,.094,.077,-.010),(1.07,.138,.100,.010)]:
        pts=[(K*rx*math.sin(q),K*(cy-ry*math.cos(q)),K*z) for q in [math.tau*i/32 for i in range(33)]]
        tube('Cuirass | folded perimeter '+str(z),pts,.0025*K,edge,'spine_03')

    for side,sgn in [('l',1),('r',-1)]:
        ua,fa,hand='upperarm_'+side,'lowerarm_'+side,'hand_'+side
        # A shallow, fitted, sloping shoulder with three actual overlapping lames.
        # The shoulder ends well above the elbow, leaving an anatomical upper arm.
        limb('Pauldron | fitted crown '+side,ua,[(-.18,.025,.035),(-.06,.087,.086),
             (.15,.102,.098),(.34,.098,.091),(.48,.083,.079)],steel,20)
        for j,t in enumerate([.34,.48]):
            limb('Pauldron | overlapping lame '+side+str(j),ua,
                 [(t-.06,.100-j*.009,.097-j*.009),(t+.07,.095-j*.009,.093-j*.009)],
                 shadowsteel if j else steel,16,math.pi+.15,-.15)
        limb('Rerebrace | tapered upper arm '+side,ua,[(.48,.064,.062),(.70,.060,.060),(.93,.047,.049)],steel)
        limb('Couter | fitted elbow leaf '+side,fa,[(-.08,.047,.050),(.02,.059,.063),(.15,.046,.047)],shadowsteel,18,2.0,-2.0)
        limb('Vambrace | long anatomical forearm '+side,fa,[(.12,.046,.049),(.31,.053,.054),
             (.64,.041,.042),(.91,.030,.032)],steel,22)
        limb('Gauntlet | flared wrist cuff '+side,fa,[(.85,.038,.040),(1.00,.037,.037)],shadowsteel,18)
        # Human fingers keep their original topology and phalanges; small dorsal
        # plates sit on them rather than making a rectangular robot fist.
        # The MakeHuman hand is a leather glove; its human metacarpals and fingers
        # remain visible instead of being replaced by ellipsoid knuckles.
        thigh,calf='thigh_'+side,'calf_'+side
        limb('Cuisse | shaped thigh '+side,thigh,[(.09,.080,.077),(.27,.083,.078),(.56,.068,.068),(.88,.046,.050)],steel,22)
        limb('Poleyn | curved knee cup '+side,calf,[(-.09,.045,.043),(.02,.056,.052),(.15,.045,.045)],steel,18,1.95,-1.95)
        limb('Greave | calf and narrow ankle '+side,calf,[(.12,.046,.049),(.33,.053,.058),(.57,.048,.049),(.90,.028,.032),(.98,.026,.030)],steel,22)
        for j in range(2):
            # Wide thigh-hung tassets, with curved fronts and tapered corners.
            ztop=.934-.080*j;zbot=.842-.080*j;vv=[];nx=10
            for row,z in enumerate([ztop,(ztop+zbot)/2,zbot]):
                width=.075-.006*row;cx=sgn*.089
                for i in range(nx+1):
                    u=-1+2*i/nx
                    vv.append((K*(cx+width*u),K*(-.115-.026*(1-u*u)),
                               K*(z+.018*abs(u)**3 if row==2 else z)))
            ff=[(r*(nx+1)+i,(r+1)*(nx+1)+i,(r+1)*(nx+1)+i+1,r*(nx+1)+i+1) for r in range(2) for i in range(nx)]
            mesh('Tasset | broad curved overlap '+side+str(j),vv,ff,steel,thigh,thickness=.004*K)
            tube('Tasset | lower folded lip '+side+str(j),vv[-nx-1:],.002*K,edge,thigh)
        # Foot armor has a real heel/instep/toe shape, built around the MH ankle.
        ankle=rig.data.bones['foot_'+side].head_local
        cx=ankle.x;cy=ankle.y
        vv=[];profiles=[(.065,.033,.034),(.015,.044,.070),(-.055,.049,.050),(-.14,.041,.028),(-.21,.015,.017)]
        for yy,w,h in profiles:
            for i in range(9):
                q=math.pi*i/8
                vv.append((cx+K*w*math.cos(q),cy+K*yy,K*(.012+h*math.sin(q))))
        ff=[(r*9+i,r*9+i+1,(r+1)*9+i+1,(r+1)*9+i) for r in range(4) for i in range(8)]
        ff.extend([tuple(reversed(range(9))),tuple(36+i for i in range(9))])
        mesh('Sabaton | continuous pointed foot '+side,vv,ff,shadowsteel,'foot_'+side,thickness=.003*K)
        for yy,w,h in profiles[1:4]:
            pts=[(cx+K*w*math.cos(q),cy+K*yy,K*(.015+h*math.sin(q))) for q in [math.pi*i/8 for i in range(9)]]
            tube('Sabaton | overlapping toe joint '+side+str(yy),pts,.0028*K,steel,'foot_'+side)

    # A compact late-medieval sallet with a close visor and bevor, not a sphere
    # perched on a separate cylindrical neck. No bare scalp is visible.
    head=rig.data.bones['head'];hz=head.head_local.z;hy=head.head_local.y
    helmet_rings=[]
    for dz,rx,ry,shift in [(-.030,.070,.080,.003),(.025,.084,.093,.005),
                          (.090,.081,.092,.010),(.140,.060,.073,.014),(.168,.012,.017,.013)]:
        helmet_rings.append((hz+K*dz,K*rx,K*ry,hy+K*shift,0))
    form('Sallet | swept fitted skull and rear tail',helmet_rings,steel,'head',28,cap=True)
    # Visor front panels and a narrow continuous sight slit.
    for zlo,zhi,ry,mat,name in [(.035,.051,.099,black,'sight slit'),(-.036,.032,.101,shadowsteel,'angular visor')]:
        vv=[];n=16
        for dz in [zlo,zhi]:
            for i in range(n+1):
                q=-1.45+2.90*i/n
                vv.append((K*.087*math.sin(q),hy-K*ry*math.cos(q)-K*.014*math.cos(q)**5,
                           hz+K*(dz-.014*math.cos(q))))
        mesh('Sallet | '+name,vv,[(i,i+1,n+2+i,n+1+i) for i in range(n)],mat,'head',thickness=.003*K)
    form('Bevor | overlapping pointed chin guard',[(hz+K*dz,K*rx,K*ry,hy+K*cy,0)
         for dz,rx,ry,cy in [(-.075,.052,.074,-.001),(-.046,.067,.091,-.002),(-.018,.074,.097,0)]],steel,'head',24,.010*K)
    for sgn in [-1,1]:
        ellipsoid('Sallet | visor pivot '+str(sgn),(sgn*.084*K,hy,hz+.038*K),(.005*K,.011*K,.011*K),edge,'head',8,4)
    points=[]
    for i in range(17):
        q=-1.4+2.8*i/16
        points.append((K*.087*math.sin(q),hy-K*.101*math.cos(q)-K*.014*math.cos(q)**5,
                       hz+K*(.052-.014*math.cos(q))))
    tube('Sallet | defined visor brow',points,.0024*K,edge,'head')
    tube('Sallet | restrained median crest',[(0,hy-.091*K,hz+.089*K),
         (0,hy-.063*K,hz+.146*K),(0,hy+.012*K,hz+.170*K),
         (0,hy+.085*K,hz+.098*K)],.0022*K,edge,'head')

# Static combat stance: wide grounded legs, lowered pelvis, forward chest.
def aim(name, origin, direction, twist=0, front_hint=None):
    b=rig.data.bones[name];d=Vector(direction).normalized()
    rest=(b.tail_local-b.head_local).normalized()
    q=rest.rotation_difference(d)
    if front_hint is not None:
        f0=Vector((0,-1,0));f0=(f0-rest*f0.dot(rest)).normalized();f0=q@f0
        f1=Vector(front_hint);f1=(f1-d*f1.dot(d)).normalized()
        angle=math.atan2(d.dot(f0.cross(f1)),f0.dot(f1));q=Quaternion(d,angle)@q
    if twist:q=Quaternion(d,twist) @ q
    rig.pose.bones[name].matrix=Matrix.Translation(origin) @ q.to_matrix().to_4x4() @ b.matrix_local.to_3x3().to_4x4()
    bpy.context.view_layer.update()

def ik2(start,end,la,lb,pole):
    vec=end-start;dist=vec.length;axis=vec.normalized()
    assert abs(la-lb)<dist<la+lb,(dist,la,lb)
    along=(la*la-lb*lb+dist*dist)/(2*dist)
    p=Vector(pole)-start;p=(p-axis*p.dot(axis)).normalized()
    return start+axis*along+p*math.sqrt(max(0,la*la-along*along))

pelvis=rig.data.bones['pelvis']
pelvis_head=pelvis.head_local+Vector((0,-.020*K,-.180*K))
rig.pose.bones['pelvis'].matrix=(Matrix.Translation(pelvis_head) @
    Matrix.Rotation(-.07,4,'Z') @ Matrix.Rotation(.035,4,'X') @
    pelvis.matrix_local.to_3x3().to_4x4())
for name in ['spine_01','spine_02','spine_03']:
    pb=rig.pose.bones[name];pb.rotation_mode='XYZ';pb.rotation_euler=(.05,0,.025)
bpy.context.view_layer.update()
for side,sgn in [('l',1),('r',-1)]:
    thigh,calf='thigh_'+side,'calf_'+side
    hip=rig.pose.bones[thigh].head.copy()
    ankle=Vector((sgn*.430*K,(-.13 if side=='r' else .09)*K,.067*K))
    yaw_angle=math.radians(sgn*-19)
    pole=Vector((sgn*.30*K,-.50*K,.43*K))
    front_hint=None
    if a.revision==7:
        # In the original SE view the sword-side foot is behind the other foot.
        ankle.x=sgn*.290*K
        ankle.y=(.40 if side=='r' else -.36)*K
        yaw_angle=math.radians(sgn*(60 if side=='r' else 8))
        front_hint=Vector((math.sin(yaw_angle),-math.cos(yaw_angle),0))
        pole=hip+front_hint*.55*K+Vector((sgn*.12,0,-.35))*K
    knee=ik2(hip,ankle,rig.data.bones[thigh].length,rig.data.bones[calf].length,
             pole)
    aim(thigh,hip,knee-hip,front_hint=front_hint);aim(calf,knee,ankle-knee,front_hint=front_hint)
    foot='foot_'+side;b=rig.data.bones[foot]
    yaw=Matrix.Rotation(yaw_angle,4,'Z')
    rig.pose.bones[foot].matrix=Matrix.Translation(ankle) @ yaw @ b.matrix_local.to_3x3().to_4x4()
    bpy.context.view_layer.update()
    ua,fa,hand='upperarm_'+side,'lowerarm_'+side,'hand_'+side
    shoulder=rig.pose.bones[ua].head.copy()
    wrist=Vector((sgn*.285*K,(-.265 if side=='r' else -.29)*K,(.82 if side=='r' else 1.02)*K))
    elbow_pole=Vector((sgn*.50*K,.075*K,1.00*K))
    if a.revision==7:
        wrist=Vector((sgn*.30*K,(-.265 if side=='r' else -.27)*K,(.82 if side=='r' else .92)*K))
        elbow_pole=Vector((sgn*.48*K,.08*K,.74*K))
    elbow=ik2(shoulder,wrist,rig.data.bones[ua].length,rig.data.bones[fa].length,
              elbow_pole)
    aim(ua,shoulder,elbow-shoulder);aim(fa,elbow,wrist-elbow)
    # Palm continues the forearm, with the fist directed into the guard.
    aim(hand,wrist,wrist-elbow,math.radians(sgn*32))
    for finger in ['index','middle','ring','pinky']:
        for j,angle in [(1,1.10),(2,1.35),(3,1.10)]:
            pb=rig.pose.bones[f'{finger}_{j:02d}_{side}'];pb.rotation_mode='XYZ'
            pb.rotation_euler.x=angle
    for j,angle in [(1,.55),(2,.95),(3,.65)]:
        pb=rig.pose.bones[f'thumb_{j:02d}_{side}'];pb.rotation_mode='XYZ';pb.rotation_euler.x=angle
bpy.context.view_layer.update()

# Sword is modeled around the posed grip; its axis is independent of the wrist.
hand=rig.pose.bones['hand_r'];grip=hand.head+(hand.tail-hand.head).normalized()*.055*K
blade_axis=Vector((.76,.07,.64)).normalized()
wide=Vector((-blade_axis.z,0,blade_axis.x)).normalized();depth=blade_axis.cross(wide).normalized()
def weapon_mesh(name,rows,mat):
    vv=[]
    for t,w,d in rows:
        c=grip+blade_axis*t*K
        vv.extend([c+wide*w*K,c+depth*d*K,c-wide*w*K,c-depth*d*K])
    ff=[(j*4+i,j*4+(i+1)%4,(j+1)*4+(i+1)%4,(j+1)*4+i) for j in range(len(rows)-1) for i in range(4)]
    ff.extend([(3,2,1,0),tuple((len(rows)-1)*4+i for i in range(4))])
    o=mesh(name,vv,ff,mat,smooth=False)
    # Convert the posed geometry to the hand's rest space for editable parenting.
    inv=(hand.matrix @ rig.data.bones['hand_r'].matrix_local.inverted()).inverted()
    for v in o.data.vertices:v.co=inv@v.co
    skin(o,'hand_r')
weapon_mesh('Sword | dark leather handle',[(-.078,.012,.011),(.025,.012,.011)],leather)
weapon_mesh('Sword | double edged blade',[(.045,.024,.006),(.61,.018,.004),(.75,0,0)],steel)
pts=[grip+blade_axis*.030*K+wide*x*K for x in [-.080,0,.080]]
o=tube('Sword | narrow curved crossguard',pts,.008*K,shadowsteel,'hand_r')
inv=(hand.matrix @ rig.data.bones['hand_r'].matrix_local.inverted()).inverted()
for v in o.data.vertices:v.co=inv@v.co
pommel=grip-blade_axis*.095*K
o=ellipsoid('Sword | compact pommel',pommel,(.018*K,)*3,shadowsteel,'hand_r',10,5)
for v in o.data.vertices:v.co=inv@v.co

# Compact atlas: one material and two tiny embedded maps in the runtime copy.
def palette_image(name, orm=False):
    img=bpy.data.images.new(name,width=len(palette)*4,height=4,alpha=True)
    if orm:img.colorspace_settings.name='Non-Color'
    px=[]
    for y in range(4):
        for x in range(len(palette)*4):
            m=palette[x//4];bs=m.node_tree.nodes.get('Principled BSDF')
            rgba=(1,bs.inputs['Roughness'].default_value,bs.inputs['Metallic'].default_value,1) if orm else tuple(m.diffuse_color)
            px.extend(rgba)
    img.pixels[:]=px;img.pack();return img
base_img=palette_image('Silver knight palette');orm_img=palette_image('Silver knight ORM',True)
unified=material('Silver Knight | compact palette',(.5,.5,.5))
nodes=unified.node_tree.nodes;links=unified.node_tree.links;bs=nodes.get('Principled BSDF')
tex=nodes.new('ShaderNodeTexImage');tex.image=base_img;tex.interpolation='Closest'
orm=nodes.new('ShaderNodeTexImage');orm.image=orm_img;orm.interpolation='Closest'
sep=nodes.new('ShaderNodeSeparateColor')
links.new(tex.outputs['Color'],bs.inputs['Base Color']);links.new(orm.outputs['Color'],sep.inputs['Color'])
links.new(sep.outputs['Green'],bs.inputs['Roughness']);links.new(sep.outputs['Blue'],bs.inputs['Metallic'])
for o in parts:
    uv=o.data.uv_layers.active or o.data.uv_layers.new(name='Palette')
    for f in o.data.polygons:
        index=palette.index(o.data.materials[f.material_index])
        for li in f.loop_indices:uv.data[li].uv=((index+.5)/len(palette),.5)
    o.data.materials.clear();o.data.materials.append(unified)
    for f in o.data.polygons:f.material_index=0

scene=bpy.context.scene
scene.render.engine='CYCLES';scene.cycles.samples=40
scene.render.resolution_x=scene.render.resolution_y=900;scene.render.resolution_percentage=100
scene.render.film_transparent=True
scene.world.color=(.20,.20,.20)
scene.view_settings.view_transform='AgX'
def light(name,loc,power,size):
    d=bpy.data.lights.new(name,'AREA');d.energy=power;d.shape='DISK';d.size=size*K
    o=bpy.data.objects.new(name,d);scene.collection.objects.link(o);o.location=Vector(loc)*K
    o.rotation_euler=(Vector((0,0,.9*K))-o.location).to_track_quat('-Z','Y').to_euler()
light('Key | large softbox',(-3,-4,5),420,4)
light('Fill | neutral',(3,-1,3),260,3)
light('Rim | plate outline',(0,3,4),500,3)
if a.revision==7:light('Face | soft low frontal fill',(0,-4,2),70,3)
camdata=bpy.data.cameras.new('Review camera');camera=bpy.data.objects.new('Review camera',camdata)
scene.collection.objects.link(camera);scene.camera=camera;camdata.type='ORTHO';camdata.ortho_scale=2.16*K
reference_location=(-3.0,-7.5,6.7) if a.revision==7 else (0,-6,5.1)
camera.location=Vector(reference_location)*K
camera.rotation_euler=(Vector((0,-.02,.77))*K-camera.location).to_track_quat('-Z','Y').to_euler()

for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            area.spaces.active.region_3d.view_perspective='CAMERA'
            area.spaces.active.shading.type='MATERIAL'
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);bpy.context.view_layer.objects.active=rig
rig['review_stage']='Static anatomy and armor shape only; six earlier actions frozen'
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'knight_makehuman.blend'))

# Static runtime copy is baked from the same visible evaluated geometry.
bpy.context.view_layer.update();deps=bpy.context.evaluated_depsgraph_get();copies=[]
for o in parts:
    d=bpy.data.meshes.new_from_object(o.evaluated_get(deps),preserve_all_data_layers=True,depsgraph=deps)
    cp=bpy.data.objects.new('EXPORT '+o.name,d);scene.collection.objects.link(cp);cp.matrix_world=o.matrix_world.copy();copies.append(cp)
bpy.ops.object.select_all(action='DESELECT')
for o in copies:o.select_set(True)
bpy.context.view_layer.objects.active=copies[0];bpy.ops.object.join();baked=copies[0]
baked.name='SilverKnight_Static_MakeHuman'
bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
assert min(v.co.z for v in baked.data.vertices)>-.025*K,'Geometry crosses floor'
bpy.ops.export_scene.gltf(filepath=str(OUT/'knight_makehuman.glb'),export_format='GLB',use_selection=True,
    export_animations=False,export_skins=False,export_yup=True)
triangles=sum(len(f.vertices)-2 for f in baked.data.polygons)
source_info={}
for name,path in [('makehuman',a.makehuman),('mpfb2',a.mpfb)]:
    source_info[name]={'repository':f'https://github.com/makehumancommunity/{name}.git',
       'upstreamCommit':subprocess.check_output(['git','-C',path,'rev-parse','origin/master']).decode().strip(),
       'baseMeshSha256':hashlib.sha256((Path(path)/('makehuman/data/3dobjs/base.obj' if name=='makehuman' else 'src/mpfb/data/3dobjs/base.obj')).read_bytes()).hexdigest()}
manifest={'stage':'static shape review, restarted from MakeHuman','revision':a.revision, 'blender':bpy.app.version_string,
    'sources':source_info,'anatomyAssetLicense':'CC0-1.0','macro':MACRO,
    'triangles':triangles,'editableBones':len(rig.data.bones),'actions':len(bpy.data.actions),
    'runtime':{'meshes':1,'materials':1,'paletteMapSize':[len(palette)*4,4],'skins':0,'animations':0},
    'reference':'Existing knight sprites; no sprite pixels imported into model or textures',
    'limits':'Static candidate only. Shape approval, animation reconstruction and gameplay GPU validation remain.'}
(OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

# Reopen the editable delivered artifact for honest four-view renders.
bpy.ops.wm.open_mainfile(filepath=str(OUT/'knight_makehuman.blend'))
scene=bpy.context.scene;rig=bpy.data.objects['MakeHuman_Knight_Rig'];camera=scene.camera
assert not bpy.data.actions
try:
    prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='CUDA';prefs.get_devices()
    for d in prefs.devices:d.use=d.type=='CUDA'
    scene.cycles.device='GPU' if any(d.use for d in prefs.devices) else 'CPU'
except Exception:scene.cycles.device='CPU'
metrics={'views':{},'triangles':triangles,'static':True,'anatomySource':source_info,'scale':K,
         'nativeMhmRoundtripMaxVertexError':error,'hands':{},'feet':{},'revision':a.revision}
if a.revision==7:
    pelvis_deform=rig.pose.bones['pelvis'].matrix@rig.data.bones['pelvis'].matrix_local.inverted()
    for side,sgn in [('l',1),('r',-1)]:
        bn=rig.data.bones['foot_'+side];deform=rig.pose.bones[bn.name].matrix@bn.matrix_local.inverted()
        heel=deform@Vector((bn.head_local.x,bn.head_local.y+.065*K,.012*K))
        toe=deform@Vector((bn.head_local.x,bn.head_local.y-.207*K,.012*K))
        forward=(toe-heel).normalized();outward=pelvis_deform.to_3x3()@Vector((sgn,0,0))
        bodyfront=pelvis_deform.to_3x3()@Vector((0,-1,0))
        assert forward.dot(outward)>.15,('Actual shoe points inward',side,list(forward))
        assert forward.dot(bodyfront)>.35,('Shoe points backwards',side)
        assert abs(toe.z-heel.z)<.005*K,'Do not fix toe-in by rolling the sole'
        calf=rig.data.bones['calf_'+side];cd=rig.pose.bones[calf.name].matrix@calf.matrix_local.inverted()
        knee_front=(cd.to_3x3()@Vector((0,-1,0))).normalized()
        assert knee_front.dot(forward)>.6,'Knee plate and toe must face the same outward quadrant'
        metrics['feet'][side]={'toe':list(toe),'heel':list(heel),'forward':list(forward),
            'outwardDot':forward.dot(outward),'bodyForwardDot':forward.dot(bodyfront),
            'kneeToeDot':knee_front.dot(forward),'soleHeightDifference':abs(toe.z-heel.z)}
for side in ['l','r']:
    fa=rig.pose.bones['lowerarm_'+side];hand=rig.pose.bones['hand_'+side]
    wrist=(hand.tail-hand.head).normalized();forearm=(fa.tail-fa.head).normalized()
    assert wrist.dot(forearm)>.999,'Wrist must continue the human forearm'
    metrics['hands'][side]={'wristForearmDot':wrist.dot(forearm),
                             'forwardComponent':-wrist.y,'verticalComponent':wrist.z}
for name,loc in [('reference',reference_location),('front',(0,-7,2.6)),('side',(7,0,2.6)),('back',(0,7,2.6))]:
    camera.location=Vector(loc)*K
    camera.rotation_euler=(Vector((0,-.02,.77))*K-camera.location).to_track_quat('-Z','Y').to_euler()
    bpy.context.view_layer.update();deps=bpy.context.evaluated_depsgraph_get();coords=[]
    for o in scene.objects:
        if o.type=='MESH' and not o.hide_render:
            ev=o.evaluated_get(deps)
            coords.extend(world_to_camera_view(scene,camera,ev.matrix_world@v.co) for v in ev.data.vertices)
    bbox=[min(q.x for q in coords)*900,min(1-q.y for q in coords)*900,
          max(q.x for q in coords)*900,max(1-q.y for q in coords)*900]
    assert min(bbox[:2])>0 and max(bbox[2:])<900,('Clipped render',name,bbox)
    contacts=[]
    for side in ['l','r']:
        foot=rig.pose.bones['foot_'+side].head.copy();foot.y-=.08*K;foot.z=0
        if a.revision==7:
            foot=(Vector(metrics['feet'][side]['heel'])+Vector(metrics['feet'][side]['toe']))/2;foot.z=0
        q=world_to_camera_view(scene,camera,foot);contacts.append([q.x*900,(1-q.y)*900])
    footprints=[]
    if a.revision==7:
        for side in ['l','r']:
            ends=[]
            for key in ['heel','toe']:
                p=Vector(metrics['feet'][side][key]);p.z=0
                q=world_to_camera_view(scene,camera,p);ends.append([q.x*900,(1-q.y)*900])
            footprints.append(ends)
    orientation=world_to_camera_view(scene,camera,Vector((0,-.30,.80))*K)-world_to_camera_view(scene,camera,Vector((0,0,.80))*K)
    metrics['views'][name]={'bounds':bbox,'contacts':contacts,'footprints':footprints,'projectedForwardXY':[orientation.x,orientation.y]}
    if name=='reference' and a.revision==7:
        assert orientation.x>0,'SE source faces screen-right; rotate the model rather than mirroring either image'
        assert contacts[0][1]>contacts[1][1],'The source SE shield-side foot is in front of the sword-side foot'
    scene.render.filepath=str(PREVIEW/(name+'.png'));bpy.ops.render.render(write_still=True)
    print('MAKEHUMAN_VIEW',name,flush=True)
(PREVIEW/'static-validation.json').write_text(json.dumps(metrics,indent=2))
print('MAKEHUMAN_STATIC_READY',triangles,flush=True)
