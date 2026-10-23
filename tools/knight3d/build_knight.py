"""Original, rigid-skinned plate knight. Run with Blender --background --python.

No sprite pixels, external meshes, textures, fonts or animation files are imported.
Reference sheets inform only silhouette and gesture. Coordinates: front is -Y, Z up.
"""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

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

steel = material('01 | satin silver plate', (.48, .55, .61), .72, .31)
edge = material('02 | polished bevels', (.73, .79, .82), .78, .26)
darkmetal = material('03 | recessed gunmetal', (.075, .10, .125), .65, .43)
cloth = material('04 | charcoal padded cloth', (.033, .043, .052), 0, .88)
leather = material('05 | walnut leather', (.105, .065, .042), 0, .73)
trim = material('06 | muted old brass', (.39, .285, .13), .70, .36)
shieldmat = material('07 | dark slate shield enamel', (.10, .15, .19), .40, .38)
black = material('08 | visor interior', (.005, .008, .012), .05, .92)

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

# Skeleton. All armor is weighted rigidly; joints have separate dark underlayers.
REST = {
    'root': ((0,0,0), (0,0,.3), None),
    'pelvis': ((0,0,1.10), (0,0,1.32), 'root'),
    'chest': ((0,0,1.32), (0,0,1.94), 'pelvis'),
    'head': ((0,0,1.94), (0,0,2.43), 'chest'),
}
for side, x in [('R', -.50), ('L', .50)]:
    REST['upper_arm.'+side] = ((x,0,1.87), (x,0,1.43), 'chest')
    REST['forearm.'+side] = ((x,0,1.43), (x,0,1.08), 'upper_arm.'+side)
    REST['hand.'+side] = ((x,0,1.08), (x,0,.92), 'forearm.'+side)
    lx = -.20 if side == 'R' else .20
    REST['thigh.'+side] = ((lx,0,1.10), (lx,0,.62), 'pelvis')
    REST['shin.'+side] = ((lx,0,.62), (lx,0,.15), 'thigh.'+side)
    REST['foot.'+side] = ((lx,0,.15), (lx,-.25,.10), 'shin.'+side)
armdata = bpy.data.armatures.new('Knight | articulated skeleton')
rig = bpy.data.objects.new('KNIGHT_RIG', armdata)
bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
for name, (head, tail, parent) in REST.items():
    bone = armdata.edit_bones.new(name)
    bone.head, bone.tail = head, tail
    if parent:
        bone.parent = armdata.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT')
rig.show_in_front = True
rig['design'] = 'Original procedural plate knight; reference: existing knight sprite gestures only'
rig['front'] = '-Y'
rig['preview_status'] = 'Batch 1 candidate; not installed into the game'

# Padded body and sculpted breastplate, three overlapping waist lames.
shell('padded doublet', [(1.17,.255,.16,0),(1.40,.30,.18,0),(1.77,.385,.195,0),
      (1.91,.31,.17,0)], cloth, 'chest', 16)
shell('breastplate | flared shoulders', [(1.37,.24,.165,-.012),(1.51,.32,.21,-.014),
      (1.76,.38,.225,-.012),(1.87,.31,.18,0),(1.92,.205,.14,0)], steel, 'chest', 12, .024)
# Raised tapered central ridge and small brass diamond; no texture dependencies.
mesh('breastplate central ridge', [(-.028,-.235,1.51),(.028,-.235,1.51),
     (.038,-.259,1.74),(0,-.283,1.82),(-.038,-.259,1.74)], [(0,1,2,3,4)], edge, 'chest', .008)
for i, z in enumerate([1.31,1.39,1.47]):
    shell('waist articulated lame %02d'%i, [(z-.035,.278+i*.014,.178+i*.006,0),
          (z+.04,.26+i*.018,.177+i*.007,0)], steel if i%2==0 else darkmetal, 'chest')
shell('belt leather', [(1.235,.288,.184,0),(1.30,.29,.187,0)], leather, 'pelvis')
box('belt buckle', (0,-.203,1.267), (.13,.045,.105), trim, 'pelvis', .012)
box('buckle inset', (0,-.230,1.267), (.073,.012,.052), darkmetal, 'pelvis', .004)
shell('neck mail collar', [(1.89,.16,.13,0),(2.01,.15,.12,0)], darkmetal, 'head', 16)
shell('gorget silver collar', [(1.91,.218,.174,0),(1.98,.176,.143,0)], edge, 'chest')
# Tassets each follow the thigh to keep running clearance.
for side, sign in [('R',-1),('L',1)]:
    obj=box('split armored tasset '+side, (sign*.215,-.12,1.11), (.30,.11,.30), steel,
            'thigh.'+side, .035)
    obj.rotation_euler[1]=sign*-.13
    for z in [1.04,1.115,1.19]:
        box('tasset articulation '+side+str(z),(sign*.215,-.184,z),(.245,.014,.014),darkmetal,'thigh.'+side,.003)
    # Short back and side cloth tabs, intentionally no cape in this reference.
    box('rear cloth tab '+side,(sign*.17,.12,1.06),(.26,.10,.32),cloth,'thigh.'+side,.035)

# Closed bascinet-style helmet: lower bevel, recessed eye slit, crown, nose and vents.
shell('helmet lower bevor', [(1.99,.16,.145,-.012),(2.04,.23,.207,-.035),
      (2.20,.25,.23,-.035),(2.25,.25,.22,-.025)], steel, 'head', 16, .016)
shell('helmet dark continuous eye slot', [(2.245,.249,.228,-.023),(2.305,.25,.227,-.023)], black, 'head', 16, .003)
shell('helmet crown', [(2.298,.26,.23,-.018),(2.43,.253,.219,0),
      (2.52,.18,.165,.005),(2.56,.065,.067,.005)], steel, 'head', 16, .019)
box('visor brow lip',(0,-.254,2.304),(.40,.035,.032),edge,'head',.012)
box('visor readable eye slit',(0,-.274,2.277),(.37,.022,.047),black,'head',.003)
mesh('pointed visor nose', [(-.038,-.263,2.292),(.038,-.263,2.292),(.042,-.277,2.17),
     (0,-.327,2.13),(-.042,-.277,2.17)], [(0,1,2,3,4)],edge,'head',.007)
for s in [-1,1]:
    for i in range(3):
        box('visor breathing vent %s %s'%(s,i),(s*(.085+i*.04),-.248+i*.01,2.16-i*.012),
            (.012,.016,.055),black,'head',.004)
    link('visor hinge '+str(s),(s*.247,-.02,2.28),(s*.275,-.02,2.28),.042,trim,'head')
    # Cheek line connects front and sides without a floating flat sticker.
    link('helmet cheek seam '+str(s),(s*.18,-.188,2.06),(s*.238,-.10,2.16),.009,darkmetal,'head')
link('helmet center crest ridge',(0,-.17,2.49),(0,.14,2.49),.025,edge,'head')

# Limbs: rounded articulated plates and intentionally exposed dark joints.
for side, sign in [('R',-1),('L',1)]:
    x = sign*.50
    ua, fa, hand = 'upper_arm.'+side, 'forearm.'+side, 'hand.'+side
    sphere('shoulder socket '+side,(x,0,1.86),(.18,.17,.18),cloth,ua)
    sphere('pauldron '+side,(x,0,1.89),(.255,.255,.18),steel,ua)
    sphere('pauldron lower flange '+side,(x,-.01,1.80),(.236,.223,.10),edge,ua)
    for dx in [-.11,.11]:
        sphere('pauldron rivet '+side+str(dx),(x+dx,-.225,1.88),(.016,.012,.016),trim,ua,8)
    local_shell('rerebrace '+side,(x,0,0),[(1.46,.123,.12,0),(1.62,.145,.14,0),
        (1.77,.16,.155,0)],steel,ua)
    sphere('elbow textile '+side,(x,0,1.43),(.115,.12,.125),cloth,fa)
    sphere('elbow metal couter '+side,(x,.065,1.43),(.14,.14,.12),darkmetal,fa)
    local_shell('vambrace '+side,(x,0,0),[(1.10,.105,.098,0),(1.18,.125,.12,0),
        (1.36,.14,.135,0)],steel,fa)
    local_shell('wrist cuff '+side,(x,0,0),[(1.08,.116,.108,0),(1.13,.117,.108,0)],edge,fa)
    box('gauntlet '+side,(x,-.015,1.018),(.18,.18,.19),steel,hand,.04)
    for dz in [-.035,.005,.045]:
        box('finger plates '+side+str(dz),(x,-.115,1.01+dz),(.145,.035,.027),darkmetal,hand,.006)
    lx=sign*.20
    thigh,shin,foot='thigh.'+side,'shin.'+side,'foot.'+side
    local_shell('padded thigh '+side,(lx,0,0),[(.64,.13,.13,0),(1.08,.17,.16,0)],cloth,thigh)
    local_shell('cuisses '+side,(lx,0,0),[(.69,.135,.137,-.012),(.91,.165,.151,-.012),
        (1.01,.16,.15,-.012)],steel,thigh)
    sphere('knee joint '+side,(lx,0,.62),(.128,.13,.13),cloth,shin)
    sphere('poleyn '+side,(lx,-.095,.62),(.16,.125,.14),edge,shin)
    local_shell('greave '+side,(lx,0,0),[(.18,.108,.105,.012),(.31,.121,.12,.012),
        (.51,.142,.137,0),(.56,.126,.12,0)],steel,shin)
    link('greave central ridge '+side,(lx,-.112,.22),(lx,-.143,.51),.013,edge,shin)
    box('ankle leather '+side,(lx,-.025,.15),(.21,.24,.17),leather,foot,.03)
    box('sabatons '+side,(lx,-.14,.10),(.26,.44,.17),steel,foot,.055)
    box('boot sole '+side,(lx,-.14,.033),(.262,.442,.047),darkmetal,foot,.016)
    for y in [-.05,-.14,-.23]:
        box('sabatons overlap '+side+str(y),(lx,y,.175),(.225,.026,.016),darkmetal,foot,.004)

# Sword geometry in hand.R rest space, blade points down. A diamond cross section
# gives four real reflective facets; full blade mesh, no trail or transparent VFX.
sx=-.50
link('sword wrapped grip',(sx,0,1.18),(sx,0,.99),.040,leather,'hand.R')
for z in [1.01,1.045,1.08,1.115,1.15]:
    link('grip binding '+str(z),(sx,0,z-.005),(sx,0,z+.005),.042,darkmetal,'hand.R')
sphere('sword pommel',(sx,0,1.23),(.061,.048,.065),trim,'hand.R')
box('sword curved crossguard',(sx,0,.964),(.37,.073,.065),trim,'hand.R',.025)
vs=[]
for z,w in [(.934,.078),(.80,.075),(.02,.048),(-.12,0.002)]:
    vs += [(sx-w,0,z),(sx,-.024,z),(sx+w,0,z),(sx,.024,z)]
fs=[]
for j in range(3):
    for k in range(4):
        fs.append((j*4+k,j*4+(k+1)%4,(j+1)*4+(k+1)%4,(j+1)*4+k))
fs += [(0,3,2,1),(12,13,14,15)]
blade=mesh('sword | four facet blade',vs,fs,edge,'hand.R',.002)
link('blade fuller',(sx,-.025,.79),(sx,-.025,.20),.009,darkmetal,'hand.R',8)

# Shield at left hand, kite silhouette with raised rim, backed panel and boss.
# A slight longitudinal convexity catches light and reads from all eight angles.
outline=[(-.27,.33),(0,.40),(.27,.33),(.25,-.08),(.17,-.29),(0,-.46),(-.17,-.29),(-.25,-.08)]
def kite(name, factor, front, mat):
    vv=[(.50+px*factor,front,pz*factor+1.18) for px,pz in outline]
    vv += [(.50,front-.065,1.20)]
    ff=[(i,(i+1)%8,8) for i in range(8)]
    o=mesh(name,vv,ff,mat,'hand.L',.012)
    solid=o.modifiers.new('shield thickness','SOLIDIFY')
    solid.thickness=.045
    return o
kite('shield | thick silver rim',1,-.225,edge)
kite('shield | slate convex face',.88,-.252,shieldmat)
box('shield heraldic vertical',(.50,-.329,1.20),(.047,.022,.50),trim,'hand.L',.008)
box('shield heraldic crossbar',(.50,-.326,1.28),(.255,.022,.045),trim,'hand.L',.008)
sphere('shield central boss',(.50,-.35,1.28),(.065,.034,.065),steel,'hand.L')
for px,pz in outline:
    sphere('shield rim rivet '+str((px,pz)),(.50+px*.945,-.258,1.18+pz*.945),
           (.012,.01,.012),trim,'hand.L',8)
box('shield back arm strap',(.50,-.13,1.20),(.18,.12,.085),leather,'hand.L',.01)

# At the game's roughly 60-80px character height, remove subpixel hardware.
# Optimize before binding/animation: preserve silhouette, remove invisible seams,
# collapse small triangles, then join into one mesh with one palette material.
discard_terms=('rivet','breathing vent','cheek seam','finger plates','grip binding',
               'tasset articulation','sabatons overlap','blade fuller','central ridge')
kept=[]
for obj,bone in parts:
    if any(word in obj.name for word in discard_terms):
        bpy.data.objects.remove(obj,do_unlink=True)
        continue
    for modifier in list(obj.modifiers):
        if modifier.type=='BEVEL':
            obj.modifiers.remove(modifier)
    bpy.context.view_layer.objects.active=obj
    obj.select_set(True)
    for modifier in list(obj.modifiers):
        # Shield thickness remains real silhouette geometry.
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    if len(obj.data.polygons)>40:
        mod=obj.modifiers.new('small-screen polygon reduction','DECIMATE')
        mod.ratio=.30
        bpy.ops.object.modifier_apply(modifier=mod.name)
    group=obj.vertex_groups.new(name=bone)
    group.add(list(range(len(obj.data.vertices))),1,'REPLACE')
    kept.append((obj,bone))
parts=kept

palette=[steel,edge,darkmetal,cloth,leather,trim,shieldmat,black]
def palette_image(name,orm=False):
    img=bpy.data.images.new(name,width=32,height=4,alpha=True)
    if orm: img.colorspace_settings.name='Non-Color'
    px=[]
    for y in range(4):
        for x in range(32):
            source=palette[x//4]
            bs=source.node_tree.nodes.get('Principled BSDF')
            rgba=(1,bs.inputs['Roughness'].default_value,bs.inputs['Metallic'].default_value,1) if orm else \
                tuple(source.diffuse_color)
            px.extend(rgba)
    img.pixels[:]=px
    img.pack()
    return img
base_img=palette_image('Knight compact palette | 32x4')
orm_img=palette_image('Knight metal roughness | 32x4',True)
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
        loop.uv=((index+.5)/8,.5)
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

def clamp(a, lo, hi): return min(hi,max(lo,a))
def lerp(a,b,t): return a*(1-t)+b*t
def smooth(t):
    t=clamp(t,0,1)
    return t*t*(3-2*t)
def vec(v): return Vector(v)
def mixkeys(t, keys):
    for i in range(len(keys)-1):
        a,pa=keys[i]; b,pb=keys[i+1]
        if t<=b:
            u=smooth((t-a)/(b-a))
            return vec(pa).lerp(vec(pb),u)
    return vec(keys[-1][1])
def two_bone(a, target, length1, length2, pole):
    delta=target-a
    d=clamp(delta.length,.025,length1+length2-.002)
    direction=delta.normalized()
    target=a+direction*d
    polevec=vec(pole)-a
    bend=(polevec-direction*polevec.dot(direction)).normalized()
    along=(length1*length1-length2*length2+d*d)/(2*d)
    offset=math.sqrt(max(0,length1*length1-along*along))
    return a+direction*along+bend*offset,target

def set_segment(name, head, tail, twist=0):
    rest=rig.data.bones[name]
    src=(rest.tail_local-rest.head_local).normalized()
    dst=(tail-head).normalized()
    delta=src.rotation_difference(dst)
    if twist:
        delta=Quaternion(dst,twist) @ delta
    rig.pose.bones[name].matrix = Matrix.Translation(head) @ delta.to_matrix().to_4x4() @ \
        Matrix.Translation(-rest.head_local) @ rest.matrix_local

def pose(clip,t):
    # Every frame is a complete pose. Pelvis and feet never inherit stale state.
    p=vec((0,0,1.10))
    lean=0; yaw=0; collapse=0
    right=vec((-.53,-.14,1.08)); left=vec((.52,-.19,1.25))
    sword=vec((-.12,-.50,-.84)); shield_dir=vec((0,0,-1))
    footR=vec((-.23,-.045,.15)); footL=vec((.23,.07,.15))
    if clip=='idle':
        p.z+=.011*math.sin(t*math.tau)
        right.y-=.012*math.sin(t*math.tau)
        lean=.025
    elif clip=='walk':
        phase=t*math.tau
        p.z-=.06+.022*math.cos(phase*2)
        lean=.18; yaw=.055*math.sin(phase)
        for f,offset in [(footR,0),(footL,math.pi)]:
            a=phase+offset
            f.y=-.03+.31*math.cos(a)
            f.z=.15+.16*max(0,math.sin(a))
        right=vec((-.56,.12*math.cos(phase)-.12,1.24))
        left=vec((.51,-.24-.06*math.cos(phase),1.37))
        sword=vec((-.08,.68,.66))
    elif clip=='attack1':
        # Overhead wind-up into a broad cross-body waist-height cut.
        right=mixkeys(t,[(0,(-.53,-.14,1.12)),(.26,(-.64,.02,2.22)),
              (.40,(-.65,-.28,2.16)),(.64,(.20,-.65,1.47)),(.80,(.20,-.41,1.26)),(1,(-.53,-.14,1.12))])
        sword=mixkeys(t,[(0,(-.12,-.50,-.84)),(.26,(-.36,.25,.90)),
              (.40,(-.72,-.20,.60)),(.64,(.94,-.20,-.23)),(.80,(.76,.15,-.62)),(1,(-.12,-.50,-.84))])
        yaw=lerp(-.33,.54,smooth((t-.32)/.39))*math.sin(math.pi*t)
        p.y=-.12*math.sin(math.pi*t); p.z-=.07*math.sin(math.pi*t)
        left=vec((.49,-.26,1.35)); footR.y=-.17
    elif clip=='attack2':
        # Low preparation into a rising diagonal slash, then controlled recovery.
        right=mixkeys(t,[(0,(-.53,-.14,1.12)),(.24,(-.67,.10,1.02)),
              (.42,(-.58,-.34,1.23)),(.63,(-.05,-.56,2.10)),(.78,(-.30,-.31,2.17)),(1,(-.53,-.14,1.12))])
        sword=mixkeys(t,[(0,(-.12,-.50,-.84)),(.24,(-.7,.22,-.65)),
              (.42,(-.52,-.5,-.65)),(.63,(.30,-.15,.94)),(.78,(-.20,.1,.95)),(1,(-.12,-.50,-.84))])
        p.z-=.12*math.sin(math.pi*t)**2
        yaw=-.38*math.sin(t*math.tau)
        left=vec((.53,-.26,1.32)); footL.y=-.18
    elif clip=='cast':
        right=mixkeys(t,[(0,(-.53,-.14,1.12)),(.25,(-.58,-.18,2.11)),
              (.50,(-.32,-.33,2.30)),(.67,(-.32,-.39,2.25)),(.85,(-.65,-.40,1.63)),(1,(-.53,-.14,1.12))])
        sword=mixkeys(t,[(0,(-.12,-.50,-.84)),(.25,(-.1,-.05,1)),
              (.50,(.04,.03,1)),(.67,(.04,.03,1)),(.85,(-.7,-.5,.1)),(1,(-.12,-.50,-.84))])
        left=mixkeys(t,[(0,(.52,-.19,1.25)),(.38,(.72,-.08,1.72)),
              (.67,(.72,-.08,1.72)),(1,(.52,-.19,1.25))])
        yaw=.12*math.sin(math.pi*t)
        p.z+=.025*math.sin(math.pi*t)
    elif clip=='die':
        collapse=smooth((t-.24)/.65)
        lean=-collapse*math.pi*.49
        p.z=lerp(1.10,.29,collapse)
        p.y=lerp(0,.18,collapse)
        right=mixkeys(t,[(0,(-.53,-.14,1.08)),(.25,(-.58,-.34,1.30)),
              (.63,(-.61,-.16,.53)),(1,(-.57,-.13,.18))])
        left=mixkeys(t,[(0,(.52,-.19,1.25)),(.25,(.54,-.24,1.22)),
              (.65,(.65,.02,.58)),(1,(.69,.15,.32))])
        sword=vec((-.54,-.8,-.03)).normalized().lerp(vec((-.12,-.50,-.84)),1-collapse)
        shield_dir=vec((0,-collapse,-max(.06,1-collapse))).normalized()
        footR=vec((-.28,-.72*collapse,.15))
        footL=vec((.37,-.58*collapse,.15))
    torso_rot=Matrix.Rotation(yaw,4,'Z') @ Matrix.Rotation(lean,4,'X')
    def upper(v): return p+torso_rot.to_3x3()@vec(v)
    chestbase=upper((0,0,.22)); chesttop=upper((0,0,.84)); headtop=upper((0,0,1.33))
    set_segment('root',vec((0,0,0)),vec((0,0,.3)))
    set_segment('pelvis',p,p+vec((0,0,.22)))
    set_segment('chest',chestbase,chesttop)
    set_segment('head',chesttop,headtop)
    bpy.context.view_layer.update()
    for side,sign,wrist,blade_dir in [('R',-1,right,sword),('L',1,left,shield_dir)]:
        shoulder=upper((sign*.50,0,.77))
        # Elbows bend away from ribcage, slightly rearward during guard.
        pole=shoulder+vec((sign*.52,.34,-.31))
        elbow,wrist=two_bone(shoulder,wrist,.44,.35,pole)
        set_segment('upper_arm.'+side,shoulder,elbow)
        bpy.context.view_layer.update()
        set_segment('forearm.'+side,elbow,wrist)
        bpy.context.view_layer.update()
        set_segment('hand.'+side,wrist,wrist+blade_dir.normalized()*.16)
        hip=p+vec((sign*.20,0,0))
        foot=footR if side=='R' else footL
        knee,ankle=two_bone(hip,foot,.48,.47,hip+vec((sign*.06,-1,0)))
        set_segment('thigh.'+side,hip,knee)
        bpy.context.view_layer.update()
        set_segment('shin.'+side,knee,ankle)
        bpy.context.view_layer.update()
        toe=ankle+vec((0,-.25,-.05))
        set_segment('foot.'+side,ankle,toe)
    bpy.context.view_layer.update()

CLIPS = {'idle':(30,2),'walk':(15,1),'attack1':(15,1),'attack2':(15,1),'cast':(15,1),'die':(30,2)}
actions={}
for clip,(frames,step) in CLIPS.items():
    rig.animation_data_create()
    action=bpy.data.actions.new(clip)
    rig.animation_data.action=action
    action.use_fake_user=True
    for frame in range(1,frames+1):
        t=(frame-1)/(frames if clip in ['idle','walk'] else frames-1)
        pose(clip,t)
        for pb in rig.pose.bones:
            pb.rotation_mode='QUATERNION'
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
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.19,.23,.29,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value=.45
scene.view_settings.view_transform='AgX'
floor=material('studio | blue charcoal',(.026,.039,.054),.08,.76)
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
area('key softbox',(-3,-4,6),650,(1,.91,.78),4)
area('cool fill',(4,-2,3.5),430,(.68,.82,1),3)
area('rim strip',(1,3,4.6),850,(.76,.88,1),2.8)
camdata=bpy.data.cameras.new('presentation camera')
camera=bpy.data.objects.new('presentation camera',camdata)
bpy.context.collection.objects.link(camera)
camera.location=(3.6,-6.5,3.4)
camera.rotation_euler=(vec((0,-.03,1.35))-camera.location).to_track_quat('-Z','Y').to_euler()
camdata.type='ORTHO'
camdata.ortho_scale=4.25
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

manifest={'status':'preview candidate; no game integration','front':'-Y','up':'Z',
          'units':'meters, stylized proportion','blender':bpy.app.version_string,
          'bones':len(rig.data.bones),'meshParts':len(parts),
          'vertices':sum(len(o.data.vertices) for o,b in parts),
          'faces':sum(len(o.data.polygons) for o,b in parts),
          'triangles':sum(len(poly.vertices)-2 for poly in body.data.polygons),
          'materials':[unified.name], 'paletteTextures':{'count':2,'size':[32,4]},
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
