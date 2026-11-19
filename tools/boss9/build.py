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
arm=next(o for o in sc.objects if o.type=='ARMATURE')
body=next(o for o in sc.objects if o.type=='MESH')
arm.name='BOSS9_Dragon_Rig'
body.name='BOSS9_Dragon_SingleTail'
before={'vertices':len(body.data.vertices),'faces':len(body.data.polygons),'bones':len(arm.data.bones)}
tail_remove=['Bone_%03d'%i for i in range(24,31)]
tail_keep=['Bone_%03d'%i for i in range(16,24)]
old_neck=['Bone_%03d'%i for i in range(31,37)]
group_names={g.index:g.name for g in body.vertex_groups}
weights=[{group_names[g.group]:g.weight for g in v.groups} for v in body.data.vertices]

# The extra, thinner, screen-right branch is +X. Preserve the thick spiny branch.
cut=[]
for v,w in zip(body.data.vertices,weights):
    right=sum(w.get(n,0) for n in tail_remove)
    left=sum(w.get(n,0) for n in tail_keep)
    x,y,z=v.co
    if right>.27 and right>left*1.10 and (x>.095 or y>.345):
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

# Give the lower mandible its own seam so it opens instead of stretching a closed snout.
bm=bmesh.new();bm.from_mesh(body.data)
mouth_faces=[f for f in bm.faces if all(v.co.y<-.22 and .935<v.co.z<1.15 for v in f.verts)]
plane=Vector((0,-.25,1.045));normal=Vector((0,-.25,1)).normalized()
if mouth_faces:
    geom=set(mouth_faces)
    for f in mouth_faces:
        geom.update(f.edges);geom.update(f.verts)
    result=bmesh.ops.bisect_plane(bm,geom=list(geom),dist=.000002,plane_co=plane,plane_no=normal)
    seam=[e for e in result['geom_cut'] if isinstance(e,bmesh.types.BMEdge) and all(v.co.y<-.235 for v in e.verts)]
    bmesh.ops.split_edges(bm,edges=seam)
bm.verts.index_update()
jaw_seam={v.index for v in bm.verts if abs((v.co-plane).dot(normal))<.00001 and v.co.y<-.235
          and v.link_faces and all((f.calc_center_median()-plane).dot(normal)<.000001 for f in v.link_faces)}
mouth_rim=sorted(set((round(v.co.x,6),round(v.co.y,6)) for v in bm.verts
    if abs((v.co-plane).dot(normal))<.00001 and v.co.y<-.235))
bm.to_mesh(body.data);bm.free();body.data.update()

bpy.context.view_layer.objects.active=arm
arm.select_set(True);body.select_set(False)
bpy.ops.object.mode_set(mode='EDIT')
for name in tail_remove+old_neck:
    arm.data.edit_bones.remove(arm.data.edit_bones[name])
def bone(name,head,tail,parent):
    b=arm.data.edit_bones.new(name);b.head=head;b.tail=tail;b.parent=arm.data.edit_bones[parent];return b
bone('Neck_Base',(0,-.106,.78),(0,-.143,.935),'Bone_002')
bone('Neck_Upper',(0,-.143,.935),(0,-.182,1.065),'Neck_Base')
bone('Head',(0,-.182,1.065),(0,-.355,1.075),'Neck_Upper')
bone('Jaw',(0,-.245,1.045),(0,-.423,.997),'Head')
bone('MouthSocket',(0,-.399,1.035),(0,-.499,1.035),'Head')
arm.data.edit_bones['MouthSocket'].use_deform=False
bpy.ops.object.mode_set(mode='OBJECT')

new_groups={n:body.vertex_groups.new(name=n) for n in ['Neck_Base','Neck_Upper','Head','Jaw']}
old_indices={g.index:g.name for g in body.vertex_groups}
for v in body.data.vertices:
    w={old_indices[g.group]:g.weight for g in v.groups}
    head_weight=sum(w.get(n,0) for n in old_neck)
    orphan=sum(w.get(n,0) for n in tail_remove)
    if orphan:
        body.vertex_groups['Bone_023'].add([v.index],w.get('Bone_023',0)+orphan,'REPLACE')
    if head_weight>.00001:
        x,y,z=v.co
        # Retain a smooth neck/head transition while the armored skull stays rigid.
        upper=max(0,min(1,(z-.88)/.13))
        neck=max(0,min(1,(z-.82)/.12))
        split=1.045+.25*(y+.25)
        jaw=1 if y<-.235 and (z<split-.000002 or v.index in jaw_seam) and z>.93 else 0
        if jaw:
            jw=max(0,min(1,(-y-.22)/.065))
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
    mesh.from_pydata([(x,y,1.045+.25*(y+.25)+offset) for x,y in hull],[],[list(range(len(hull)))])
    mesh.materials.append(oral)
    ob=bpy.data.objects.new(name,mesh);sc.collection.objects.link(ob)
    ob.vertex_groups.new(name=bone_name).add(list(range(len(hull))),1,'REPLACE')
    mod=ob.modifiers.new('Skin','ARMATURE');mod.object=arm;ob.parent=arm
    return ob
roof=cap('Mouth_Roof','Head',.0001)
lower=cap('Mandible_Interior','Jaw',-.0001)
tong=oral_mesh('Tongue',(0,-.335,1.026),(.015,.039,.0015),tongue,'Jaw')

# Uniform asset scale establishes useful physical meters, including the 30m emitter.
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
def pose(clip,t,d):
    u=t/d
    for p in arm.pose.bones:
        p.location=(0,0,0);p.rotation_quaternion=(1,0,0,0);p.scale=(1,1,1)
    # Every attack starts and ends at the same flying pose; idle is a periodic cycle.
    phase=2*math.pi*(u if clip=='Walk' else 2*u if clip=='Attack3' else u)
    flap=math.sin(phase)
    delayed=math.sin(phase-.45)-math.sin(-.45)
    bob=.025*(1-math.cos(phase))
    pitch=10+2.4*flap
    yaw=2*flap if clip=='Walk' else 1.2*flap
    roll=0
    thrust=0
    neck=-7
    skull=-3
    jaw=2
    wing_l=wing_r=0
    arm_right=(0,0,0)
    if clip=='Attack1':
        wind=curve(t,[(0,0),(.28,1),(.47,.7),(.66,0),(d,0)])
        strike=curve(t,[(0,0),(.38,0),(.62,1),(.79,.55),(1.15,0),(d,0)])
        jaw=2+curve(t,[(0,0),(.22,8),(.46,39),(.60,48),(.72,0),(.88,8),(1.2,0),(d,0)])
        neck+=-16*wind+21*strike;skull+=-13*wind+19*strike
        pitch+=-9*wind+12*strike;thrust=.15*strike-.045*wind
        wing_l=wing_r=9*wind-12*strike
    elif clip=='Attack2':
        wind=curve(t,[(0,0),(.30,1),(.43,.85),(.64,0),(d,0)])
        slash=curve(t,[(0,0),(.35,0),(.59,1),(.77,.55),(1.05,0),(d,0)])
        yaw+=-24*wind+32*slash;roll=8*wind-11*slash
        pitch+=-5*wind+8*slash;neck+=-4*wind+7*slash;skull+=-8*wind+10*slash
        arm_right=(30*wind-62*slash,12*wind-25*slash,-28*wind+54*slash)
        wing_l=13*wind-12*slash;wing_r=-7*wind+16*slash
        thrust=.045*slash
    elif clip=='Attack3':
        inhale=curve(t,[(0,0),(.5,1),(.77,.65),(1.0,0),(d,0)])
        breath=curve(t,[(0,0),(.55,0),(.83,1),(2.23,1),(2.60,0),(d,0)])
        pulse=math.sin(t*math.pi*14)*breath
        neck+=-17*inhale+4*breath+.6*pulse
        skull+=-12*inhale-9*breath+.5*pulse
        jaw+=12*inhale+43*breath+.8*pulse
        pitch+=-7*inhale+4*breath
        wing_l=wing_r=9*inhale+8*breath
        thrust=-.045*breath
        # Counter-rotate the head against the breathing torso so the jet stays aimed.
        skull=-pitch-neck-5*flap-1.8*delayed-30*inhale*(1-breath)
    elif clip=='Die':
        rear=curve(t,[(0,0),(.34,1),(.72,.85),(1.1,.45),(1.7,0),(d,0)])
        fall=smooth(.8,1.93,t)
        struggle=(1-smooth(.76,1.55,t))*smooth(.05,.28,t)
        flap=math.sin(t*math.pi*15)*struggle
        delayed=math.sin(t*math.pi*15-.5)*struggle
        pitch=10-40*rear-12*fall
        yaw=curve(t,[(0,0),(.72,-8),(1.5,13),(1.93,18),(d,18)])
        roll=curve(t,[(0,0),(.62,-9),(1.27,35),(1.93,86),(2.10,81),(2.24,85),(d,85)])
        neck=-7-19*rear+15*fall;skull=-3-17*rear+14*fall
        jaw=2+24*rear+8*fall
        bob=.12*rear
        wing_l=wing_r=20*rear-45*fall
    rotate('Bone_000',pitch,roll,yaw)
    root=arm.pose.bones['Bone_000']
    # Root translation is expressed in the root's local rest axes.
    world_shift=Vector((0,-thrust,.31+bob))
    if clip=='Die':world_shift+=Vector((0,.09*smooth(.8,1.93,t),-.7*smooth(.82,1.93,t)))
    root.location=rest['Bone_000'].inverted() @ world_shift
    rotate('Bone_005',2*flap,0,-yaw*.18)
    rotate('Bone_004',3*flap,0,yaw*.24)
    rotate('Bone_003',1.8*delayed,0,yaw*.15)
    rotate('Neck_Base',neck*.48,0,-yaw*.26)
    rotate('Neck_Upper',neck*.52,0,-yaw*.22)
    rotate('Head',skull,0,-yaw*.16)
    rotate('Jaw',jaw,0,0)
    # Spread each wing, drive a strong power stroke and a delayed wrist recovery.
    for sign,base,elbow,wrist,hand,extra in [(-1,'050','049','048','047',wing_l),(1,'054','053','052','051',wing_r)]:
        rotate('Bone_'+base,3*flap,sign*(25+28*flap+extra),sign*3*delayed)
        rotate('Bone_'+elbow,-3*delayed,sign*(5+10*delayed),0)
        rotate('Bone_'+wrist,2*delayed,sign*(4+6*delayed),0)
        rotate('Bone_'+hand,0,sign*3*delayed,sign*3*delayed)
    for name,side in [('Bone_041',1),('Bone_046',-1)]:
        right=arm_right if side==-1 else (0,0,0)
        rotate(name,-13+3*delayed+right[0],side*7+right[1],side*7+right[2])
    rotate('Bone_040',-15+5*flap,0,0)
    rotate('Bone_045',-15+5*flap+arm_right[0]*.22,0,arm_right[2]*.3)
    rotate('Bone_039',8+3*delayed,0,0)
    rotate('Bone_044',8+3*delayed,0,arm_right[2]*.12)
    for upper,knee,ankle,side in [('010','009','008',-1),('015','014','013',1)]:
        legwave=(math.sin(phase-.2)+math.sin(.2))*(1-smooth(1.7,2.2,t) if clip=='Die' else 1)
        rotate('Bone_'+upper,19+3*legwave,side*6,side*2*flap)
        rotate('Bone_'+knee,-22+4*delayed,0,0)
        rotate('Bone_'+ankle,10-3*delayed,0,0)
    for i,name in enumerate(reversed(tail_keep)):
        lag=math.sin(phase-.48*i)-math.sin(-.48*i)
        if clip=='Die':lag*=1-smooth(1.7,2.2,t)
        rotate(name,1.4*lag,1.3*lag,2.6*lag-yaw*.07)
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
        'rightClaw':'Bone_046 (anatomical right / -X)','notes':'Head rig replaced with anatomical neck, head and a split mandible; original PBR textures retained.'}
(OUT/'build.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print('BOSS9_BUILD_PASS',json.dumps({k:v for k,v in report.items() if k!='floor'}),flush=True)
