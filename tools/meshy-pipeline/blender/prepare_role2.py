"""Bind the licensed static Role2, remove its back swords and fused right hand.
blender -b --python prepare_role2.py -- Role2.glb approved-role.glb output.glb source.blend report.json
The reference rig, sword, closed forward grip and all six animation samples
are reused. Only this new skin is fitted and weighted in Blender.
"""
import bpy
import bmesh
import copy
import hashlib
import json
import math
from pathlib import Path
import struct
import sys
import tempfile
import numpy as np
from mathutils import Matrix, Quaternion, Vector

class Glb:
    def __init__(self, file):
        raw=Path(file).read_bytes();n=struct.unpack_from('<I',raw,12)[0]
        self.j=json.loads(raw[20:20+n]);self.b=bytearray(raw[28+n:])
    def array(self,index):
        a=self.j['accessors'][index];v=self.j['bufferViews'][a['bufferView']]
        k={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}[a['type']]
        dt=np.dtype({5121:'u1',5123:'<u2',5125:'<u4',5126:'<f4'}[a['componentType']])
        return np.ndarray((a['count'],k),dtype=dt,buffer=self.b,offset=v.get('byteOffset',0)+a.get('byteOffset',0),strides=(v.get('byteStride',dt.itemsize*k),dt.itemsize)).copy()
    def view(self,raw):
        while len(self.b)%4:self.b.append(0)
        i=len(self.j['bufferViews']);self.j['bufferViews'].append({'buffer':0,'byteOffset':len(self.b),'byteLength':len(raw)})
        self.b.extend(raw);return i
    def add(self,values,kind,component=5126):
        a=np.array(values,dtype={5121:'u1',5123:'<u2',5125:'<u4',5126:'<f4'}[component])
        if a.ndim==1:a=a[:,None]
        item={'bufferView':self.view(a.tobytes()),'componentType':component,'count':len(a),'type':kind}
        if kind=='VEC3' and component==5126:item.update(min=a.min(0).tolist(),max=a.max(0).tolist())
        i=len(self.j['accessors']);self.j['accessors'].append(item);return i
    def save(self,file):
        self.j['buffers']=[{'byteLength':len(self.b)}];js=json.dumps(self.j,separators=(',',':')).encode();js+=b' '*(-len(js)%4);binary=self.b+b'\0'*(-len(self.b)%4)
        Path(file).write_bytes(struct.pack('<III',0x46546c67,2,28+len(js)+len(binary))+struct.pack('<II',len(js),0x4e4f534a)+js+struct.pack('<II',len(binary),0x004e4942)+binary)

source,approved,output,blend,report=map(Path,sys.argv[sys.argv.index('--')+1:])
raw,ref=Glb(source),Glb(approved)
assert not raw.j.get('skins'), 'This authoring fit is for the supplied static Role2'
rp=raw.j['meshes'][0]['primitives'][0]
pos=raw.array(rp['attributes']['POSITION']);uv=raw.array(rp['attributes']['TEXCOORD_0']);faces=raw.array(rp['indices']).reshape(-1,3)
pos[:,1]-=pos[:,1].min()
x,y,z=pos.T
# The two scabbards form an X behind the torso. Select in their actual rear
# strips, including the guards/handles above the shoulders, not the pauldrons.
line=np.minimum(abs(x-.46*(y-1.25)),abs(x+.46*(y-1.25)))
handles=(abs(abs(x)-(.17+.32*(y-1.61)))<.045)&(y>=1.61)&(y<1.89)&(z<-.07)
guards=(abs(x)>.095)&(y>1.56)&(y<1.65)&(z<-.105)
swords=((line<.050)&(z<-.105)&(y>.91)&(y<1.61))|handles|guards
# Discard the static right fingers/glove and the tiny connecting web to the
# thigh. The approved closed right hand replaces them; retained leg boundaries
# are capped independently before any skin weights are generated.
right_hand=(x<-.211)&(y<1.012)&(y>.79)
remove_sword=swords[faces].any(1);remove_hand=right_hand[faces].any(1)
# The other glove also has a narrow web to the hip. Keep that glove, but remove
# the web at the anatomical gap rather than allowing a hand-to-leg triangle.
fx=x[faces];fy=y[faces]
left_web=(fx.min(1)<.215)&(fx.max(1)>.215)&(fy.mean(1)>.81)&(fy.mean(1)<1.005)
def lower_arm(p):
    ax,py,pz=abs(p[0]),p[1],p[2]
    if not (.99<py<1.405 and ax>.18):return False
    # Arms-down forearm centerline; exclude the rear hip pouches.
    q=Vector((ax,py,pz));distance=[]
    for first,last in [((.205,1.49,0),(.258,1.245,.008)),((.258,1.245,.008),(.273,1.005,.03))]:
        a,b=Vector(first),Vector(last);d=b-a;t=max(0,min(1,(q-a).dot(d)/d.length_squared));distance.append((q-(a+d*t)).length)
    return min(distance)<.115
arm_tags=np.array([lower_arm(p)for p in pos])
underarm_web=arm_tags[faces].any(1)&(~arm_tags[faces].all(1))&(fy.mean(1)>1.015)&(fy.mean(1)<1.40)
keep=~(remove_sword|remove_hand|left_web|underarm_web)
bpy.ops.wm.read_factory_settings(use_empty=True)
mesh=bpy.data.meshes.new('Role2 separated body without back weapons')
mesh.from_pydata(pos.tolist(),[],faces[keep].tolist());mesh.update()
layer=mesh.uv_layers.new(name='Role2 original UV')
for loop in mesh.loops:layer.data[loop.index].uv=uv[loop.vertex_index]
bm=bmesh.new();bm.from_mesh(mesh)
bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001)
uvlayer=bm.loops.layers.uv.active
isolated=[v for v in bm.verts if not v.link_faces]
bmesh.ops.delete(bm,geom=isolated,context='VERTS')
remaining=set(bm.verts);fragments=[];fragment_info=[]
while remaining:
    todo=[remaining.pop()];component=[]
    while todo:
        v=todo.pop();component.append(v)
        for edge in v.link_edges:
            other=edge.other_vert(v)
            if other in remaining:remaining.remove(other);todo.append(other)
    if len(component)<120 and all(v.co.y>1.56 and v.co.z<-.04 for v in component):
        fragments.extend(component)
        fragment_info.append({'vertices':len(component),'center':list(sum((v.co for v in component),Vector((0,0,0)))/len(component))})
if fragments:bmesh.ops.delete(bm,geom=fragments,context='VERTS')
def cap_region(v):return ('right'if v.co.x<0 else 'left')if lower_arm(v.co)else 'body'
filled=[]
for region in ['right','left','body']:
    boundary=[e for e in bm.edges if e.is_boundary and all(cap_region(v)==region for v in e.verts)]
    degree={}
    for e in boundary:
        for v in e.verts:degree[v]=degree.get(v,0)+1
    ends=[v for v,count in degree.items()if count==1]
    while len(ends)>=2:
        a=ends.pop();b=min(ends,key=lambda v:(v.co-a.co).length);ends.remove(b)
        edge=bm.edges.get((a,b))
        if edge is None:edge=bm.edges.new((a,b))
        if edge not in boundary:boundary.append(edge)
    filled+=bmesh.ops.holes_fill(bm,edges=list(set(boundary)),sides=0)['faces']
for face in filled:
    face.material_index=1
    for loop in face.loops:
        other=[l for l in loop.vert.link_loops if l.face not in filled]
        if other:loop[uvlayer].uv=other[0][uvlayer].uv
bmesh.ops.triangulate(bm,faces=list(bm.faces));bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
bm.to_mesh(mesh);bm.free();mesh.update()
obj=bpy.data.objects.new('Role2 body, independent right wrist and thigh',mesh);bpy.context.collection.objects.link(obj)

skin=ref.j['skins'][0];names=[ref.j['nodes'][i]['name']for i in skin['joints']]
target={name:Matrix(m.reshape(4,4)).transposed().inverted()for name,m in zip(names,ref.array(skin['inverseBindMatrices']))}
# Source anatomical landmarks, in the supplied arms-down model, feet at y=0.
heads={'Hips':(0,1.04,0),'Spine02':(0,1.18,0),'Spine01':(0,1.31,0),'Spine':(0,1.44,0),
       'neck':(0,1.57,0),'Head':(0,1.67,0),'head_end':(0,1.90,0),'headfront':(0,1.67,.15)}
for side,sign in [('Right',-1),('Left',1)]:
    for part,p in {'Shoulder':(.075,1.51,0),'Arm':(.205,1.49,0),'ForeArm':(.258,1.245,.008),
                   'Hand':(.273,1.005,.03),'UpLeg':(.105,.98,0),'Leg':(.105,.535,.015),
                   'Foot':(.11,.105,-.02),'ToeBase':(.11,.04,.12)}.items():
        heads[side+part]=Vector((sign*p[0],p[1],p[2]))
heads={k:Vector(v)for k,v in heads.items()}
child={'Hips':'Spine02','Spine02':'Spine01','Spine01':'Spine','Spine':'neck','neck':'Head','Head':'head_end'}
for side in ['Right','Left']:
    child.update({side+a:side+b for a,b in [('Shoulder','Arm'),('Arm','ForeArm'),('ForeArm','Hand'),('UpLeg','Leg'),('Leg','Foot'),('Foot','ToeBase')]})
source_tail={name:heads[child[name]]if name in child else heads[name]+Vector((0,-.10,0)) for name in heads}
source_tail['head_end']=heads['head_end']+Vector((0,.03,0));source_tail['headfront']=heads['headfront']+Vector((0,0,.03))
for side in ['Right','Left']:source_tail[side+'ToeBase']=heads[side+'ToeBase']+Vector((0,0,.06))

# Blender bone heat establishes the general skin; anatomical limits below
# prevent a near-by leg from ever influencing the arm/wrist.
arm=bpy.data.armatures.new('Role2 source anatomical rig');rig=bpy.data.objects.new('Role2 source rig',arm);bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active=rig;rig.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
for name in heads:
    bone=arm.edit_bones.new(name);bone.head=heads[name];bone.tail=source_tail[name]
parents={}
for ni,n in enumerate(ref.j['nodes']):
    for ci in n.get('children',[]):parents[ci]=ni
for name in heads:
    ni=next(i for i,n in enumerate(ref.j['nodes'])if n.get('name')==name)
    parent=ref.j['nodes'][parents[ni]].get('name') if ni in parents else None
    if parent in heads:arm.edit_bones[name].parent=arm.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT');bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);rig.select_set(True);bpy.context.view_layer.objects.active=rig
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
group_names={g.index:g.name for g in obj.vertex_groups}

def point_segment(p,a,b):
    d=b-a;t=max(0,min(1,(p-a).dot(d)/d.length_squared));return (p-(a+d*t)).length

fits={}
for name in heads:
    if name in child:
        a=source_tail[name]-heads[name];b=target[child[name]].translation-target[name].translation
        q=a.normalized().rotation_difference(b.normalized());scale=b.length/a.length
    else:
        a=source_tail[name]-heads[name]
        b=target[name].to_quaternion()@Vector((0,1,0))
        q=a.normalized().rotation_difference(b.normalized());scale=1.8/1.909353
    fits[name]=Matrix.LocRotScale(target[name].translation,q,Vector((scale,)*3))@Matrix.Translation(-heads[name])

weight_rows=[];body_pos=[]
for vertex in mesh.vertices:
    p=vertex.co;px,py,pz=p;side='Right' if px<0 else 'Left';ax=abs(px)
    arm_region=lower_arm(p) or (ax>.175 and 1.405<=py<1.58)
    left_fingers=side=='Left' and ax>.215 and .79<py<1.012
    allowed=list(heads)
    if arm_region or left_fingers:
        allowed=[side+n for n in ['Shoulder','Arm','ForeArm','Hand']]
        if py>1.38:allowed+=['Spine','Spine01','neck']
    elif py<.99 and ax<.215:
        allowed=['Hips']+[side+n for n in ['UpLeg','Leg','Foot','ToeBase']]
    elif py>=1.045:
        allowed=['Hips','Spine02','Spine01','Spine','neck','Head','head_end']
    w={group_names[g.group]:g.weight for g in vertex.groups if group_names[g.group] in allowed and g.weight>.0001}
    # Keep rigid head, gloves/bracers and boots from stretching between bones.
    if py>1.63:w={'Head':1.0}
    elif left_fingers:w={side+'Hand':1.0}
    elif arm_region and py<1.14:w={side+'ForeArm':1.0}
    elif py<.12:w={side+'Foot':1.0}
    if not w:
        ds=sorted((point_segment(p,heads[n],source_tail[n]),n)for n in allowed)
        w={n:1/(d+.025)**4 for d,n in ds[:2]}
    rows=sorted(w.items(),key=lambda x:-x[1])[:4];total=sum(v for _,v in rows);rows=[(n,v/total)for n,v in rows]
    body_pos.append(sum(((fits[n]@p)*v for n,v in rows),Vector((0,0,0))));weight_rows.append(rows)

# Export triangle corners to retain every texture seam and the repaired caps.
source_positions=[list(v.co)for v in mesh.vertices]
for vertex,p in zip(mesh.vertices,body_pos):vertex.co=p
mesh.update()
ps=[];ns=[];uvs=[];js=[];ws=[];mats=[];source_corners=[];final_caps=0;final_boundaries=0
face_region=[]
for poly in mesh.polygons:
    scores={side:sum(w for vi in poly.vertices for n,w in weight_rows[vi]if n.startswith(side)and any(p in n for p in ['Shoulder','Arm','Hand']))/len(poly.vertices)for side in ['Right','Left']}
    face_region.append(max(scores,key=scores.get)if max(scores.values())>.5 else 'Body')
# Cap each fitted arm and the torso independently. Filling one shared boundary
# would simply recreate the unwanted armpit/hand-to-body web.
for region in ['Body','Right','Left']:
    polys=[p for p in mesh.polygons if face_region[p.index]==region]
    part=bpy.data.meshes.new('Role2 closed '+region)
    part.from_pydata([list(p)for p in body_pos],[],[list(p.vertices)for p in polys]);part.update();puv=part.uv_layers.new(name='UV')
    for a,b in zip(part.polygons,polys):
        a.material_index=b.material_index
        for li,old in zip(a.loop_indices,b.loop_indices):puv.data[li].uv=mesh.uv_layers.active.data[old].uv
    pb=bmesh.new();pb.from_mesh(part);original=pb.verts.layers.int.new('source_vertex')
    for v in pb.verts:v[original]=v.index
    bmesh.ops.delete(pb,geom=[v for v in pb.verts if not v.link_faces],context='VERTS')
    nonmanifold=[e for e in pb.edges if len(e.link_faces)>2]
    if nonmanifold:bmesh.ops.split_edges(pb,edges=nonmanifold)
    pl=pb.loops.layers.uv.active
    cap=bmesh.ops.holes_fill(pb,edges=[e for e in pb.edges if e.is_boundary],sides=0)['faces']
    remaining=[e for e in pb.edges if e.is_boundary]
    if remaining:cap+=bmesh.ops.edgenet_fill(pb,edges=remaining)['faces']
    # The generated static mesh also contains branching, non-planar boundary
    # loops. Close each oriented cycle with its own local fan, not one polygon
    # spanning unrelated arm/torso surfaces.
    directed={}
    for edge in [e for e in pb.edges if e.is_boundary]:
        loop=next(l for l in edge.link_faces[0].loops if l.edge==edge)
        directed[edge]=(loop.vert,loop.link_loop_next.vert)
    while directed:
        edge=next(iter(directed));a,b=directed[edge];walk=[a,b];walk_edges=[edge]
        while b not in walk[:-1]:
            options=[(e,pair[1])for e,pair in directed.items()if e not in walk_edges and pair[0]==b]
            if not options:break
            edge,c=options[0];walk_edges.append(edge);walk.append(c);b=c
        if b in walk[:-1]:
            start=walk[:-1].index(b);ring=walk[start:-1];cycle=walk_edges[start:]
            if len(ring)>=3:
                center=sum((v.co for v in ring),Vector((0,0,0)))/len(ring)
                ids=[v[original]for v in ring];weights={}
                for vi in ids:
                    for n,w in weight_rows[vi]:weights[n]=weights.get(n,0)+w/len(ids)
                rows=sorted(weights.items(),key=lambda x:-x[1])[:4];total=sum(w for _,w in rows);rows=[(n,w/total)for n,w in rows]
                ci=len(body_pos);body_pos.append(center);source_positions.append(np.mean([source_positions[i]for i in ids],axis=0).tolist());weight_rows.append(rows)
                cv=pb.verts.new(center);cv[original]=ci
                for i in range(len(ring)):
                    face=pb.faces.new((ring[(i+1)%len(ring)],ring[i],cv));cap.append(face)
            for e in cycle:directed.pop(e,None)
        else:
            print('Unclosed boundary',region,len(walk_edges))
            for e in walk_edges:directed.pop(e,None)
    final_caps+=len(cap)
    for face in cap:
        face.material_index=1
        for loop in face.loops:
            adjacent=[l for l in loop.vert.link_loops if l.face not in cap]
            if adjacent:loop[pl].uv=adjacent[0][pl].uv
    bmesh.ops.triangulate(pb,faces=list(pb.faces));bmesh.ops.recalc_face_normals(pb,faces=list(pb.faces));pb.normal_update()
    final_boundaries+=sum(e.is_boundary for e in pb.edges)
    print('Region repair',region,'boundary',sum(e.is_boundary for e in pb.edges))
    for face in pb.faces:
        mats.append(face.material_index)
        for loop in face.loops:
            vi=loop.vert[original];rows=weight_rows[vi]
            ps.append(list(loop.vert.co));ns.append(list(loop.vert.normal));uvs.append(list(loop[pl].uv));source_corners.append(source_positions[vi])
            js.append([names.index(n)for n,_ in rows]+[0]*(4-len(rows)));ws.append([v for _,v in rows]+[0]*(4-len(rows)))
    pb.free()
assert final_boundaries==0,'Torso and arm repairs must be capped separately'

out=Glb.__new__(Glb);out.b=bytearray();out.j={k:copy.deepcopy(ref.j[k])for k in ['asset','nodes','scenes','scene']if k in ref.j}
out.j.update(accessors=[],bufferViews=[],meshes=[],materials=[],textures=[],images=[],samplers=[])
out.j['asset']['extras']['appearance']='role2'
with tempfile.TemporaryDirectory() as td:
    td=Path(td);mi=raw.j['materials'][rp.get('material',0)]['pbrMetallicRoughness']['baseColorTexture']['index'];im=raw.j['images'][raw.j['textures'][mi]['source']];v=raw.j['bufferViews'][im['bufferView']];start=v.get('byteOffset',0)
    image_file=td/'body.jpg';image_file.write_bytes(raw.b[start:start+v['byteLength']]);image=bpy.data.images.load(str(image_file));image.scale(1024,1024);image.filepath_raw=str(td/'body.png');image.file_format='PNG';image.save();body_pixels=Path(image.filepath_raw).read_bytes();bpy.data.images.remove(image)
out.j['images'].append({'bufferView':out.view(body_pixels),'mimeType':'image/png','name':'Authorized Role2 body 1024px'})
out.j['textures'].append({'source':0});out.j['materials'].extend([
 {'name':'Role2 silver armor, blue cloth and skin','doubleSided':True,'pbrMetallicRoughness':{'baseColorTexture':{'index':0},'metallicFactor':.18,'roughnessFactor':.72}},
 {'name':'Role2 repaired rear chainmail and thigh','doubleSided':True,'pbrMetallicRoughness':{'baseColorTexture':{'index':0},'metallicFactor':.18,'roughnessFactor':.72}}])
attrs={'POSITION':out.add(ps,'VEC3'),'NORMAL':out.add(ns,'VEC3'),'TEXCOORD_0':out.add(uvs,'VEC2'),'JOINTS_0':out.add(js,'VEC4',5123),'WEIGHTS_0':out.add(ws,'VEC4')}
tri=np.arange(len(ps)).reshape(-1,3);prims=[]
for mat in [0,1]:
    idx=tri[np.asarray(mats)==mat].reshape(-1)
    prims.append({'attributes':attrs,'indices':out.add(idx,'SCALAR',5123),'material':mat})
accessors={};materials={};textures={};images={}
def acc(index):
    if index not in accessors:
        a=ref.j['accessors'][index];accessors[index]=out.add(ref.array(index),a['type'],a['componentType'])
    return accessors[index]
def tex(index):
    if index in textures:return textures[index]
    t=copy.deepcopy(ref.j['textures'][index]);ii=t['source']
    if ii not in images:
        im=copy.deepcopy(ref.j['images'][ii]);v=ref.j['bufferViews'][im['bufferView']];start=v.get('byteOffset',0);im['bufferView']=out.view(ref.b[start:start+v['byteLength']]);images[ii]=len(out.j['images']);out.j['images'].append(im)
    t['source']=images[ii]
    if 'sampler'in t:
        out.j['samplers'].append(copy.deepcopy(ref.j['samplers'][t['sampler']]));t['sampler']=len(out.j['samplers'])-1
    textures[index]=len(out.j['textures']);out.j['textures'].append(t);return textures[index]
def mat(index):
    if index not in materials:
        m=copy.deepcopy(ref.j['materials'][index]);t=m.get('pbrMetallicRoughness',{}).get('baseColorTexture')
        if t:t['index']=tex(t['index'])
        materials[index]=len(out.j['materials']);out.j['materials'].append(m)
    return materials[index]
sw=names.index('Sword')
for p in ref.j['meshes'][0]['primitives'][:-1]:
    if np.all(ref.array(p['attributes']['JOINTS_0'])[:,0]==sw):
        prims.append({'attributes':{k:acc(v)for k,v in p['attributes'].items()},'indices':acc(p['indices']),'material':mat(p['material'])})
# Copy the approved right-hand geometry and weights, retaining its true right
# handedness. Vertex colors give this character its fingerless armored glove.
hp=ref.j['meshes'][0]['primitives'][-1]
hand_attrs={k:acc(v)for k,v in hp['attributes'].items() if k!='TEXCOORD_0'}
ibms=[Matrix(a.reshape(4,4)).transposed()for a in ref.array(skin['inverseBindMatrices'])]
H=target['RightHand'];S=target['Sword'];center=S@Vector(ref.j['asset']['extras']['gripFrame']['gripPointInSword'])
a=(S.to_quaternion()@Vector((0,1,0))).normalized();f=(H.to_quaternion()@Vector((0,1,0))).normalized();hx=(f-a*f.dot(a)).normalized();hz=hx.cross(a).normalized();colors=[]
for v in ref.array(hp['attributes']['POSITION']):
    q=Vector(v)-center;cx,cy,cz=q.dot(hx),q.dot(a),q.dot(hz)
    color=(.035,.022,.014,1)
    if cz<-.008 and cx<.012:color=(.72,.47,.31,1)
    elif cz>.014 and -.05<cx<.005 and abs(cy)<.03:color=(.45,.49,.55,1)
    colors.append(color)
hand_attrs['COLOR_0']=out.add(colors,'VEC4');hm=len(out.j['materials']);out.j['materials'].append({'name':'Role2 fingerless leather glove and silver hand plate','doubleSided':True,'pbrMetallicRoughness':{'baseColorFactor':[1,1,1,1],'metallicFactor':.18,'roughnessFactor':.65}})
prims.append({'attributes':hand_attrs,'indices':acc(hp['indices']),'material':hm})
out.j['meshes']=[{'name':'Role2 repaired skin with original right-hand sword motions','primitives':prims}]
out.j['skins']=copy.deepcopy(ref.j['skins']);out.j['skins'][0]['inverseBindMatrices']=acc(skin['inverseBindMatrices'])
out.j['animations']=copy.deepcopy(ref.j['animations'])
for an in out.j['animations']:
    for s in an['samplers']:
        for k in ['input','output']:s[k]=acc(s[k])
out.save(output)
np.savez(report.with_suffix('.npz'),source_positions=np.array(source_corners),fitted_positions=np.array(ps),faces=np.arange(len(ps)).reshape(-1,3),material=np.array(mats),joint=np.array(js),weight=np.array(ws))
for a,b in zip(out.j['animations'],ref.j['animations']):
    assert a['name']==b['name'] and a['channels']==b['channels']
    for x,y in zip(a['samplers'],b['samplers']):
        for k in ['input','output']:assert np.array_equal(out.array(x[k]),ref.array(y[k]))
assert output.stat().st_size<5_000_000
bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(output));bpy.ops.wm.save_as_mainfile(filepath=str(blend))
meta={'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'approvedRoleSha256':hashlib.sha256(approved.read_bytes()).hexdigest(),'outputSha256':hashlib.sha256(output.read_bytes()).hexdigest(),
 'license':'User confirmed Role2.glb authorized for this game and modification in chat, 2026-11-04','blenderVersion':bpy.app.version_string,
 'sourceUnrigged':True,'removedBackSwordTriangles':int(remove_sword.sum()),'removedRightHandAndBridgeTriangles':int((remove_hand&~remove_sword).sum()),'removedLeftWebTriangles':int(left_web.sum()),'removedUnderarmWebTriangles':int(underarm_web.sum()),'removedRearWeaponFragments':fragment_info,'cappedFaces':len(filled),
 'finalIndependentCaps':final_caps,'finalBoundaryEdges':final_boundaries,'clips':[a['name']for a in out.j['animations']],'allSixAnimationsSampleExact':True,'originalSwordAndForwardGripPreserved':True,'bodyTriangles':len(mats),'modelBytes':output.stat().st_size}
report.write_text(json.dumps(meta,indent=2)+'\n',encoding='utf-8');print(json.dumps(meta))
