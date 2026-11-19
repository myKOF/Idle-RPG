"""Author the supplied dragon in Blender; no downloaded motions or replacement mesh.

blender -b --python-exit-code 1 -P tools/boss9/build.py -- INPUT.glb OUTPUT_DIR
The asset is meters, Z up in Blender, facing -Y; glTF is Y up, facing +Z.
"""
import bpy, bmesh, math, json, sys, hashlib
from pathlib import Path
from mathutils import Vector, Quaternion, Euler, Matrix

SOURCE, OUT = map(Path, sys.argv[sys.argv.index('--')+1:][:2])
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(SOURCE))
sc=bpy.context.scene
sc.render.fps=60
sc.unit_settings.system='METRIC'
bpy.context.preferences.filepaths.save_version=0
arm=next(o for o in sc.objects if o.type=='ARMATURE')
body=next(o for o in sc.objects if o.type=='MESH')
arm.name='BOSS9_Dragon_Rig'
body.name='BOSS9_Dragon_SingleTail'
before={'vertices':len(body.data.vertices),'faces':len(body.data.polygons),'bones':len(arm.data.bones)}
tail_remove=['Bone_%03d'%i for i in range(16,24)]
tail_keep=['Bone_%03d'%i for i in range(24,31)]
old_neck=['Bone_%03d'%i for i in range(31,37)]
group_names={g.index:g.name for g in body.vertex_groups}
weights=[{group_names[g.group]:g.weight for g in v.groups} for v in body.data.vertices]

# The user's corrected front-view selection keeps +X and removes the entire -X branch.
cut=[]
for v,w in zip(body.data.vertices,weights):
    unwanted=sum(w.get(n,0) for n in tail_remove)
    wanted=sum(w.get(n,0) for n in tail_keep)
    root_only=w.get('Bone_023',0)
    if unwanted>.30 and unwanted>wanted*1.10 and (unwanted-root_only>.1 or (v.co-arm.data.bones['Bone_023'].head_local).length>.12):
        cut.append(v.index)
bm=bmesh.new(); bm.from_mesh(body.data)
bm.verts.ensure_lookup_table()
bmesh.ops.delete(bm,geom=[bm.verts[i] for i in cut],context='VERTS')
# UV seams stay per loop when coincident seam vertices are welded.
bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.000002)
boundary=[e for e in bm.edges if e.is_boundary and e.calc_length()<.15 and all(v.co.y>.29 and abs(v.co.x)<.15 for v in e.verts)]
if boundary:
    bmesh.ops.holes_fill(bm,edges=boundary,sides=20)
bm.to_mesh(body.data); bm.free(); body.data.update()

# Straighten the source's sideways skull before authoring anatomical motions.
head_origin=Vector((.088,-.163,1.139))
head_center=Vector((0,-.182,1.139))
source_forward=Vector((-.225,-.228,-.101))
head_yaw=math.atan2(-source_forward.x,-source_forward.y)
head_pitch=math.atan2(source_forward.z,math.hypot(source_forward.x,source_forward.y))
head_fix=Quaternion((1,0,0),head_pitch)@Quaternion((0,0,1),head_yaw)
for v in body.data.vertices:
    w=sum(g.weight for g in v.groups if group_names[g.group] in old_neck)
    height=max(0,min(1,(v.co.z-.84)/.20))
    front=max(0,min(1,(-v.co.y-.22)/.09)) if v.co.z>.93 else 0
    v.co=v.co.lerp(head_center+head_fix@(v.co-head_origin),w*max(height,front))

# Give the lower mandible its own seam so it opens instead of stretching a closed snout.
bm=bmesh.new();bm.from_mesh(body.data)
mouth_faces=[f for f in bm.faces if all(v.co.y<-.29 and 1.015<v.co.z<1.22 for v in f.verts)]
plane=Vector((0,-.35,1.115));normal=Vector((0,0,1))
if mouth_faces:
    geom=set(mouth_faces)
    for f in mouth_faces:
        geom.update(f.edges);geom.update(f.verts)
    result=bmesh.ops.bisect_plane(bm,geom=list(geom),dist=.000002,plane_co=plane,plane_no=normal)
    seam=[e for e in result['geom_cut'] if isinstance(e,bmesh.types.BMEdge) and all(v.co.y<-.31 for v in e.verts)]
    bmesh.ops.split_edges(bm,edges=seam)
bm.verts.index_update()
jaw_seam={v.index for v in bm.verts if abs((v.co-plane).dot(normal))<.00001 and v.co.y<-.31
          and v.link_faces and all((f.calc_center_median()-plane).dot(normal)<.000001 for f in v.link_faces)}
mouth_rim=sorted(set((round(v.co.x,6),round(v.co.y,6)) for v in bm.verts
    if abs((v.co-plane).dot(normal))<.00001 and v.co.y<-.31))
bm.to_mesh(body.data);bm.free();body.data.update()

bpy.context.view_layer.objects.active=arm
arm.select_set(True);body.select_set(False)
bpy.ops.object.mode_set(mode='EDIT')
for name in tail_remove+old_neck:
    arm.data.edit_bones.remove(arm.data.edit_bones[name])
def bone(name,head,tail,parent):
    b=arm.data.edit_bones.new(name);b.head=head;b.tail=tail;b.parent=arm.data.edit_bones[parent];return b
bone('Neck_Base',(0,-.106,.78),(0,-.143,.935),'Bone_002')
bone('Neck_Upper',(0,-.143,.935),(0,-.182,1.139),'Neck_Base')
bone('Head',(0,-.182,1.139),(0,-.40,1.139),'Neck_Upper')
bone('Jaw',(0,-.295,1.115),(0,-.50,1.085),'Head')
bone('MouthSocket',(0,-.525,1.125),(0,-.625,1.125),'Head')
arm.data.edit_bones['MouthSocket'].use_deform=False
bpy.ops.object.mode_set(mode='OBJECT')

new_groups={n:body.vertex_groups.new(name=n) for n in ['Neck_Base','Neck_Upper','Head','Jaw']}
old_indices={g.index:g.name for g in body.vertex_groups}
for v in body.data.vertices:
    w={old_indices[g.group]:g.weight for g in v.groups}
    head_weight=sum(w.get(n,0) for n in old_neck)
    orphan=sum(w.get(n,0) for n in tail_remove)
    if orphan:
        body.vertex_groups['Bone_030'].add([v.index],w.get('Bone_030',0)+orphan,'REPLACE')
    if head_weight>.00001:
        x,y,z=v.co
        # Retain a smooth neck/head transition while the armored skull stays rigid.
        upper=max(0,min(1,(z-.99)/.11))
        neck=max(0,min(1,(z-.82)/.12))
        split=1.115
        jaw=1 if y<-.31 and (z<split-.000002 or v.index in jaw_seam) and z>1.015 else 0
        if jaw:
            jw=max(0,min(1,(-y-.29)/.065))
            distribution={'Jaw':jw,'Head':1-jw}
        else:
            distribution={'Head':upper,'Neck_Upper':(1-upper)*neck,'Neck_Base':(1-upper)*(1-neck)}
        for n,a in distribution.items():
            if a>0:new_groups[n].add([v.index],head_weight*a,'REPLACE')
for n in tail_remove+old_neck:
    body.vertex_groups.remove(body.vertex_groups[n])
for v in body.data.vertices:
    influences=sorted([(g.group,g.weight) for g in v.groups if g.weight>0],key=lambda x:-x[1])
    selected=influences[:4]
    total=sum(w for _,w in selected)
    for group,_ in influences[4:]:body.vertex_groups[group].remove([v.index])
    for group,w in selected:body.vertex_groups[group].add([v.index],w/total,'REPLACE')
for p in body.data.polygons:p.use_smooth=True

# Uncoil the retained right tail with skinning, then bind that extended shape as rest.
tail_chain=list(reversed(tail_keep))
old_tail={n:arm.data.bones[n].matrix_local.copy() for n in tail_chain}
tail_lengths={n:arm.data.bones[n].length for n in tail_chain}
tail_rest={};point=arm.data.bones[tail_chain[0]].head_local.copy()
for i,n in enumerate(tail_chain):
    old_direction=old_tail[n].to_3x3()@Vector((0,1,0))
    direction=Vector((.025*math.sin(i*.8),1,-.045+.012*i)).normalized()
    def frame_for(y):
        y=y.normalized();x=y.cross(Vector((0,0,1))).normalized();z=x.cross(y).normalized()
        return Matrix((x,y,z)).transposed().to_quaternion()
    rotation=frame_for(direction)@frame_for(old_direction).inverted()@old_tail[n].to_quaternion()
    tail_rest[n]=Matrix.LocRotScale(point,rotation,Vector((1,1,1)))
    point=point+direction*tail_lengths[n]
tail_skin={n:tail_rest[n]@old_tail[n].inverted() for n in tail_chain}
tail_dual={}
for n,matrix in tail_skin.items():
    real=matrix.to_quaternion().normalized();t=matrix.translation
    dual=Quaternion((0,t.x,t.y,t.z))@real
    tail_dual[n]=(real,tuple(v*.5 for v in dual))
names={g.index:g.name for g in body.vertex_groups}
for v in body.data.vertices:
    co=v.co.copy();components=[];total=0
    for g in v.groups:
        n=names[g.group]
        if n in tail_dual:
            real,dual=tail_dual[n];components.append((g.weight,real,dual));total+=g.weight
    if total:
        if total<.999999:components.append((1-total,Quaternion((1,0,0,0)),(0,0,0,0)))
        reference=max(components,key=lambda c:c[0])[1]
        r=[0.0]*4;du=[0.0]*4
        for weight,real,dual in components:
            sign=-1 if reference.dot(real)<0 else 1
            for j in range(4):r[j]+=weight*sign*real[j];du[j]+=weight*sign*dual[j]
        norm=math.sqrt(sum(x*x for x in r));r=[x/norm for x in r];du=[x/norm for x in du]
        projection=sum(a*b for a,b in zip(r,du));du=[b-a*projection for a,b in zip(r,du)]
        qr=Quaternion(r);qd=Quaternion(du);translation=qd@qr.conjugated()
        v.co=qr@co+2*Vector((translation.x,translation.y,translation.z))
bpy.context.view_layer.objects.active=arm
bpy.ops.object.mode_set(mode='EDIT')
for n in tail_chain:
    b=arm.data.edit_bones[n];b.matrix=tail_rest[n];b.length=tail_lengths[n]
bpy.ops.object.mode_set(mode='OBJECT')
def mat(name,color,roughness=.65):
    m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
    node=m.node_tree.nodes.get('Principled BSDF');node.inputs['Base Color'].default_value=(*color,1);node.inputs['Roughness'].default_value=roughness
    return m
oral=mat('Mouth_Interior',(.009,.002,.001),1)
tongue=mat('Tongue_DarkCrimson',(.055,.006,.003),.95)
for material in [oral,tongue]:
    material.node_tree.nodes.get('Principled BSDF').inputs['Specular IOR Level'].default_value=0
def oral_mesh(name,center,scale,material,bone_name):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24,ring_count=12,radius=1,location=(0,0,0))
    ob=bpy.context.object;ob.name=name
    for v in ob.data.vertices:v.co=Vector(center)+Vector((v.co.x*scale[0],v.co.y*scale[1],v.co.z*scale[2]))
    ob.data.materials.append(material)
    ob.vertex_groups.new(name=bone_name).add(list(range(len(ob.data.vertices))),1,'REPLACE')
    mod=ob.modifiers.new('Skin','ARMATURE');mod.object=arm
    ob.parent=arm
    for p in ob.data.polygons:p.use_smooth=True
    return ob
def cross(a,b,c):return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
lo=[];hi=[]
for point in mouth_rim:
    while len(lo)>=2 and cross(lo[-2],lo[-1],point)<=0:lo.pop()
    lo.append(point)
for point in reversed(mouth_rim):
    while len(hi)>=2 and cross(hi[-2],hi[-1],point)<=0:hi.pop()
    hi.append(point)
hull=lo[:-1]+hi[:-1]
assert len(hull)>3,'Mouth seam must have a real contour'
def cap(name,bone_name,offset):
    mesh=bpy.data.meshes.new(name)
    mesh.from_pydata([(x,y,1.115+offset) for x,y in hull],[],[list(range(len(hull)))])
    mesh.materials.append(oral)
    ob=bpy.data.objects.new(name,mesh);sc.collection.objects.link(ob)
    ob.vertex_groups.new(name=bone_name).add(list(range(len(hull))),1,'REPLACE')
    mod=ob.modifiers.new('Skin','ARMATURE');mod.object=arm;ob.parent=arm
    return ob
roof=cap('Mouth_Roof','Head',.0001)
lower=cap('Mandible_Interior','Jaw',-.0001)
tong=oral_mesh('Tongue',(0,-.405,1.117),(.018,.045,.0015),tongue,'Jaw')

# Uniform asset scale establishes physical meters for animation and particles.
asset=bpy.data.objects.new('BOSS9_Asset',None);sc.collection.objects.link(asset)
arm.parent=asset;asset.scale=(4,4,4)
asset['meters_per_source_unit']=4.0
asset['source_sha256']=hashlib.sha256(SOURCE.read_bytes()).hexdigest()
asset['source']='User supplied BOSS9.glb; mesh repair and all motions authored in Blender.'
asset['fire_config']='fire.json'

rest={p.name:p.bone.matrix_local.to_quaternion() for p in arm.pose.bones}
for p in arm.pose.bones:p.rotation_mode='QUATERNION'
def smooth(a,b,x):
    u=max(0,min(1,(x-a)/(b-a)));return u*u*(3-2*u)
def curve(t,points):
    if t<=points[0][0]:return points[0][1]
    for (a,x),(b,y) in zip(points,points[1:]):
        if t<=b:return x+(y-x)*smooth(a,b,t)
    return points[-1][1]
def rotate(name,x=0,y=0,z=0):
    q=Euler(tuple(math.radians(v) for v in (x,y,z)),'XYZ').to_quaternion()
    arm.pose.bones[name].rotation_quaternion=rest[name].inverted() @ q @ rest[name]

def global_rotation(name,target,blend=1):
    p=arm.pose.bones[name]
    pre=p.parent.matrix@p.parent.bone.matrix_local.inverted()@p.bone.matrix_local if p.parent else p.bone.matrix_local
    local=pre.to_quaternion().inverted()@target
    p.rotation_quaternion=p.rotation_quaternion.slerp(local,blend)

def aim(name,direction,blend=1):
    direction=Vector(direction).normalized()
    native=rest[name]@Vector((0,1,0))
    global_rotation(name,native.rotation_difference(direction)@rest[name],blend)

def limb(upper,lower,target,pole,blend):
    bpy.context.view_layer.update()
    a=arm.pose.bones[upper].head.copy()
    delta=target-a;distance=delta.length;direction=delta.normalized()
    l1=arm.data.bones[upper].length;l2=arm.data.bones[lower].length
    distance=max(abs(l1-l2)+.0001,min(l1+l2-.0001,distance))
    target=a+direction*distance
    along=(l1*l1-l2*l2+distance*distance)/(2*distance)
    side=Vector(pole)-direction*Vector(pole).dot(direction)
    side.normalize()
    elbow=a+direction*along+side*math.sqrt(max(0,l1*l1-along*along))
    aim(upper,elbow-a,blend);bpy.context.view_layer.update()
    aim(lower,target-arm.pose.bones[lower].head,blend);bpy.context.view_layer.update()

def pose(clip,t,d):
    u=t/d
    for p in arm.pose.bones:
        p.location=(0,0,0);p.rotation_quaternion=(1,0,0,0);p.scale=(1,1,1)
    phase=2*math.pi*(u if clip=='Walk' else 2*u if clip=='Attack3' else u)
    flap=math.sin(phase)
    delayed=math.sin(phase-.45)-math.sin(-.45)
    bob=.025*(1-math.cos(phase))
    pitch=15+2*flap;yaw=0;roll=0;thrust=0
    neck=-5;head_angle=30;jaw=2;chest=0
    wing_up=.5-.5*math.cos(phase)
    wing_asym=0;claw_weight=0;claw_sweep=0
    fall=0;rear=0
    if clip=='Attack1':
        wind=curve(t,[(0,0),(.28,1),(.43,.7),(.62,0),(d,0)])
        strike=curve(t,[(0,0),(.40,0),(.65,1),(.82,.65),(1.20,0),(d,0)])
        jaw+=curve(t,[(0,0),(.22,8),(.46,39),(.60,48),(.73,0),(.88,8),(1.2,0),(d,0)])
        pitch+=-40*wind+30*strike;chest=-10*wind+12*strike
        neck+=-15*wind+20*strike;head_angle+=-55*wind+12*strike
        thrust=curve(t,[(0,0),(.28,-.10),(.43,0),(.66,1.25),(.82,.96),(1.28,0),(d,0)])
        bob+=.08*wind+.045*strike
    elif clip=='Attack2':
        wind=curve(t,[(0,0),(.30,1),(.42,1),(.66,0),(d,0)])
        slash=curve(t,[(0,0),(.40,0),(.65,1),(.82,.55),(1.10,0),(d,0)])
        yaw=curve(t,[(0,0),(.30,-90),(.42,-90),(.65,32),(.82,18),(1.15,0),(d,0)])
        roll=10*wind-14*slash;pitch+=-10*wind+12*slash
        chest=-7*wind+10*slash;neck+=-6*wind+8*slash
        head_angle+=-8*wind+10*slash
        claw_weight=smooth(.06,.26,t)*(1-smooth(.82,1.16,t))
        claw_sweep=smooth(.40,.67,t)
        wing_asym=.12*wind-.20*slash;thrust=.07*slash
    elif clip=='Attack3':
        inhale=curve(t,[(0,0),(.47,1),(.60,1),(.79,0),(d,0)])
        burst=curve(t,[(0,0),(.60,0),(.78,1),(1.0,.65),(2.1,.6),(2.55,0),(d,0)])
        breath=curve(t,[(0,0),(.64,0),(.81,1),(2.16,1),(2.55,0),(d,0)])
        pulse=math.sin(t*math.pi*12)*breath
        pitch+=-32*inhale+24*burst+.35*pulse
        chest=-10*inhale+10*burst;neck+=-20*inhale+15*burst
        head_angle=30-80*inhale*(1-breath)-22*breath
        jaw+=17*inhale+43*breath+.5*pulse
        thrust=.18*burst-.06*inhale;bob+=.09*inhale+.04*breath
    elif clip=='Die':
        rear=curve(t,[(0,0),(.40,1),(.85,1),(1.10,.7),(1.7,0),(d,0)])
        fall=smooth(.8,1.93,t)
        flap=0;delayed=0
        wing_up=smooth(.0,.32,t)*(1-smooth(1.0,1.65,t))
        pitch=15-55*rear-12*fall;chest=-12*rear
        yaw=curve(t,[(0,0),(.72,-8),(1.5,13),(1.93,18),(d,18)])
        roll=curve(t,[(0,0),(.62,-9),(1.27,35),(1.93,90),(2.10,86),(2.24,89),(d,89)])
        neck=-5-20*rear+15*fall
        head_angle=curve(t,[(0,30),(.42,-65),(.85,-70),(1.2,-20),(1.85,10),(d,10)])
        jaw=2+43*rear+8*fall;bob=.12*rear
    rotate('Bone_000',pitch,roll,yaw)
    root=arm.pose.bones['Bone_000']
    world_shift=Vector((0,-thrust,.42+bob))
    if clip=='Die':world_shift+=Vector((0,.09*fall,-.90*fall))
    root.location=rest['Bone_000'].inverted() @ world_shift
    rotate('Bone_005',2*flap+chest*.25,0,-yaw*.025)
    rotate('Bone_004',3*flap+chest*.45,0,yaw*.035)
    rotate('Bone_003',1.8*delayed+chest*.30,0,yaw*.02)
    rotate('Neck_Base',neck*.48,0,-yaw*.34 if clip=='Attack2' else 0)
    rotate('Neck_Upper',neck*.52,0,-yaw*.34 if clip=='Attack2' else 0)
    rotate('Jaw',jaw,0,0)
    for name,side in [('Bone_041',1),('Bone_046',-1)]:rotate(name,-13+3*delayed,side*7,side*7)
    rotate('Bone_040',-15+5*flap,0,0)
    rotate('Bone_045',-15+5*flap,0,0)
    rotate('Bone_039',8+3*delayed,0,0)
    rotate('Bone_044',8+3*delayed,0,0)
    for upper,knee,ankle,side in [('010','009','008',-1),('015','014','013',1)]:
        legwave=(math.sin(phase-.2)+math.sin(.2))*(1-smooth(1.7,2.2,t) if clip=='Die' else 1)
        rotate('Bone_'+upper,19+3*legwave,side*6,side*2*flap)
        rotate('Bone_'+knee,-22+4*delayed,0,0)
        rotate('Bone_'+ankle,10-3*delayed,0,0)
    bpy.context.view_layer.update()
    heading=Quaternion((0,0,1),math.radians(yaw))
    # Raise the complete wing: elbow/wrist placement plus unfurling all membrane digits.
    for side,upper,elbow,wrist,palm,digits in [
        (-1,'050','049','048','047',[56,55,59,58,57,63,62,61,60]),
        (1,'054','053','052','051',[65,64,68,67,66,72,71,70,69])]:
        upper='Bone_'+upper;elbow='Bone_'+elbow;wrist='Bone_'+wrist;palm='Bone_'+palm
        amount=max(0,min(1,wing_up+side*wing_asym))
        if amount>0:
            shoulder=arm.pose.bones[upper].head.copy()
            offset=Vector((side*(.24 if clip=='Die' else .53),.035,.64 if clip=='Die' else .41))
            limb(upper,elbow,shoulder+heading@offset,heading@Vector((side*.65,-.8,.3)),amount)
            aim(wrist,heading@(Vector((side*.40,.10,.90)) if clip=='Die' else Vector((side*.94,.12,.13))),amount);bpy.context.view_layer.update()
            plane_rotation=heading@Quaternion((1,0,0),math.radians(35 if clip=='Die' else 70))
            global_rotation(palm,plane_rotation@rest[palm],amount);bpy.context.view_layer.update()
            for index in ([] if clip=='Die' else digits):
                name='Bone_%03d'%index
                original=plane_rotation@rest[name]
                direction=original@Vector((0,1,0));flat=Vector((direction.x,direction.y,0)).normalized()
                global_rotation(name,direction.rotation_difference(flat)@original,amount)
                bpy.context.view_layer.update()
    if clip=='Attack2' and claw_weight>0:
        shoulder=arm.pose.bones['Bone_046'].head.copy()
        a=Vector((-.22,.08,.30));b=Vector((-.10,-.32,.11));c=Vector((.22,-.24,-.20));s=claw_sweep
        offset=(1-s)**2*a+2*(1-s)*s*b+s*s*c
        limb('Bone_046','Bone_045',shoulder+offset,Vector((-1,.3,.15)),claw_weight)
        rotate('Bone_044',8+18*claw_sweep*claw_weight,0,-22*claw_sweep*claw_weight)
        rotate('Bone_043',-8*claw_sweep*claw_weight,0,0)
    if clip=='Die':
        collapse=smooth(1.05,1.95,t)
        for name,values in {
            'Bone_050':(0,-45,-90),'Bone_049':(-8,-28,-18),
            'Bone_054':(25,40,130),'Bone_053':(-12,32,30),
            'Bone_052':(0,12,15),'Bone_068':(0,-45,0)}.items():
            p=arm.pose.bones[name]
            current=p.rotation_quaternion.copy()
            rotate(name,*values)
            p.rotation_quaternion=current.slerp(p.rotation_quaternion,collapse)
        rotate('Bone_041',-13+26*collapse,7+2*collapse,7+19*collapse)
        rotate('Bone_046',-13+15*collapse,-7-8*collapse,-7-11*collapse)
        rotate('Bone_010',19-24*collapse,-6,12*collapse)
        rotate('Bone_015',19-19*collapse,6+44*collapse,-35*collapse)
        rotate('Neck_Base',neck*.48,8*collapse,0)
        rotate('Neck_Upper',neck*.52,8*collapse,0)
    bpy.context.view_layer.update()
    head_yaw=0 if clip!='Die' else yaw
    head_roll=roll if clip=='Die' else 0
    target=Euler(tuple(math.radians(v) for v in (head_angle,head_roll,head_yaw)),'XYZ').to_quaternion()@rest['Head']
    global_rotation('Head',target);bpy.context.view_layer.update()
    # The extended tail trails behind the pelvis; its wave travels toward the tip.
    for i,name in enumerate(tail_chain):
        lag=math.sin(phase-.52*i)-math.sin(-.52*i)
        fade=1-smooth(1.45,2.18,t) if clip=='Die' else 1
        wave=(2.2*lag+1.0*math.sin(phase*.5)*math.sin(math.pi*u))*fade
        elevation=(1.1*lag+.7)*fade
        target=Quaternion((0,0,1),math.radians(yaw*(1-.012*i)+wave))@Quaternion((1,0,0),math.radians(elevation))@rest[name]
        if clip=='Die':target=Quaternion(target@Vector((0,1,0)),math.radians(roll*math.exp(-i*.5)))@target
        global_rotation(name,target);bpy.context.view_layer.update()

def minimum():
    deps=bpy.context.evaluated_depsgraph_get()
    value=float('inf')
    for ob in [body,roof,lower,tong]:
        ev=ob.evaluated_get(deps);me=ev.to_mesh();mw=ev.matrix_world
        value=min(value,min((mw@v.co).z for v in me.vertices));ev.to_mesh_clear()
    return value

durations={'Walk':1.6,'Attack1':1.5,'Attack2':1.2,'Attack3':3,'Die':2.5}
floor=[]
ad=arm.animation_data_create()
for clip,d in durations.items():
    action=bpy.data.actions.new(clip);action.use_fake_user=True;ad.action=action
    previous={}
    # 60Hz authored keys retain precise contacts and sub-frame timing.
    for frame in range(round(d*60)+1):
        t=frame/60;sc.frame_set(frame);pose(clip,t,d);bpy.context.view_layer.update()
        if clip=='Die':
            z=minimum()
            # Blend the ballistic path into a surface-constrained side landing.
            contact=smooth(1.47,1.92,t)
            delta=(.04-z)*contact
            if z+delta<.025:delta=.025-z
            arm.pose.bones['Bone_000'].location+=rest['Bone_000'].inverted() @ Vector((0,0,delta/4))
            bpy.context.view_layer.update()
            floor.append([t,minimum(),delta])
        for p in arm.pose.bones:
            q=p.rotation_quaternion.copy()
            if p.name in previous and previous[p.name].dot(q)<0:q.negate();p.rotation_quaternion=q
            previous[p.name]=q
            p.keyframe_insert('rotation_quaternion',frame=frame,group=p.name)
        arm.pose.bones['Bone_000'].keyframe_insert('location',frame=frame,group='Bone_000')
    for layer in action.layers:
        for strip in layer.strips:
            for channelbag in strip.channelbags:
                for fc in channelbag.fcurves:
                    for k in fc.keyframe_points:k.interpolation='LINEAR'
    print('AUTHORED',clip,d,flush=True)
    ad.action=None

# Export only authored character objects; the flame is a real runtime particle emitter.
for image in bpy.data.images:
    if image.source=='FILE' and not image.packed_file:image.pack()
ad.action=bpy.data.actions['Walk'];ad.action_slot=ad.action.slots[0]
sc.frame_start=0;sc.frame_end=96;sc.frame_set(0)
sc.world=bpy.data.worlds.new('PreviewWorld');sc.world.color=(.035,.04,.055)
for ob in sc.objects:ob.select_set(False)
for ob in [asset,arm,body,roof,lower,tong]:ob.select_set(True)
bpy.context.view_layer.objects.active=arm
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'boss9.blend'))
bpy.ops.export_scene.gltf(filepath=str(OUT/'boss9.glb'),export_format='GLB',use_selection=True,
    export_animations=True,export_animation_mode='ACTIONS',export_frame_range=False,
    export_frame_step=1,export_force_sampling=True,export_anim_slide_to_zero=True,
    export_materials='EXPORT',export_yup=True,export_extras=True,export_def_bones=False)
report={'sourceSHA256':asset['source_sha256'],'blender':bpy.app.version_string,
        'before':before,'after':{'vertices':len(body.data.vertices),'faces':len(body.data.polygons),'bones':len(arm.data.bones)},
        'removedBones':tail_remove,'removedTailVertices':len(cut),'durations':durations,
        'floor':floor,'mouthSocket':'MouthSocket','metersPerSourceUnit':4,
        'rightClaw':'Bone_046 (anatomical right / -X)',
        'headRestCorrectionDegrees':[math.degrees(head_pitch),0,math.degrees(head_yaw)],
        'retainedTailBones':tail_chain,'tailLengthMeters':sum(tail_lengths.values())*4,
        'tailSelection':'Keep source +X / front-view right; remove source -X / front-view left.',
        'revision':2,'notes':'Straightened skull, anatomical mandible, uncoiled retained right tail; original PBR textures retained.'}
(OUT/'build.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print('BOSS9_BUILD_PASS',json.dumps({k:v for k,v in report.items() if k!='floor'}),flush=True)
