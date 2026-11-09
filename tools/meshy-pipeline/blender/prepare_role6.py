"""Refit authorized Role6 skin; move the back shield to the left forearm.
blender -b --python prepare_role6.py -- Role6.glb approved-role.glb approved-sword.glb output.glb source.blend report.json
The authored gold sword is mounted on the unchanged reference rig.
The closed forward grip and all six animation samples are preserved.
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
from mathutils.kdtree import KDTree
from mathutils.bvhtree import BVHTree
from mathutils.geometry import barycentric_transform

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

source,approved,sword_file,output,blend,report=map(Path,sys.argv[sys.argv.index('--')+1:])
raw,ref,weapon=Glb(source),Glb(approved),Glb(sword_file)
assert hashlib.sha256(approved.read_bytes()).hexdigest()=='54f104457683618ee328edd05749476dffd11bc093e7dbeb92619f59a55b1222', 'Use the approved motion and forward-grip reference'
assert any(n.get('extras',{}).get('role6SwordV1') for n in weapon.j['nodes']), 'Use the authored Role6 reference sword'
assert hashlib.sha256(source.read_bytes()).hexdigest() == 'cdfe8ccab67419b94dffb805a45b06d5370196dd21b43d36a8945a38a77be901', 'Fit only the authorized Role6 source'
assert len(raw.j.get('skins', [])) == 1, 'Expected Role6 SmartRig source'
rp=raw.j['meshes'][0]['primitives'][0]
pos=raw.array(rp['attributes']['POSITION']);uv=raw.array(rp['attributes']['TEXCOORD_0']);faces=raw.array(rp['indices']).reshape(-1,3)
pos[:,1]-=pos[:,1].min()
source_height=float(pos[:,1].max())
# Canonical arms-down anatomy used by the established Role2 repair; source
# SmartRig animation is intentionally replaced by the approved six clips.
pos *= 1.909353/source_height
x,y,z=pos.T
# Detach both the decorated shield face and its near-body gold rim.
source_factor=1.909353/source_height
rx,ry,rz=pos.T/source_factor
width=np.interp(ry,[.50,.65,.90,1.25,1.45,1.52],[.02,.13,.22,.255,.26,.02])
shield_vertices=(ry>.5)&(ry<1.535)&(abs(rx)<width+.018)&(rz<(-.115-.06*(1.4-ry)))
rim_width=np.interp(ry,[.48,.60,.76,.93,1.34,1.45,1.49,1.54],[0,.11,.21,.255,.265,.26,.14,0])
shield_vertices|=(ry>.82)&(ry<1.54)&(abs(abs(rx)-rim_width)<.045)&(rz<-.065)
# The upper gold lip lies closer to the neck than the shield face. Separate
# that narrow arc by its actual geometry and original gold albedo, keeping hair.
im=raw.j['images'][raw.j['textures'][raw.j['materials'][0]['pbrMetallicRoughness']['baseColorTexture']['index']]['source']];view=raw.j['bufferViews'][im['bufferView']];offset=view.get('byteOffset',0)
with tempfile.TemporaryDirectory() as td:
    image_file=Path(td)/'source.png';image_file.write_bytes(raw.b[offset:offset+view['byteLength']]);image=bpy.data.images.load(str(image_file),check_existing=False);image.colorspace_settings.name='Non-Color';iw,ih=image.size;pixels=np.empty(iw*ih*4,np.float32);image.pixels.foreach_get(pixels);pixels=pixels.reshape(ih,iw,4)
    colors=pixels[np.clip(((1-uv[:,1])*ih).astype(int),0,ih-1),np.clip((uv[:,0]*iw).astype(int),0,iw-1),:3]
    golden=(colors[:,0]>.30)&(colors[:,1]>.18)&(colors[:,2]<colors[:,1]*.8)&(colors[:,0]>colors[:,1]*1.15);bpy.data.images.remove(image)
shield_vertices|=golden&(ry>1.40)&(ry<1.59)&(abs(rx)<.25)&(abs(ry-(1.575-.5*abs(rx)))<.04)&(rz<-.04)
remove_shield=shield_vertices[faces].any(1)
fc=pos[faces].mean(1)/source_factor
shield_faces=faces[remove_shield & (fc[:,2]<-.075) & (pos[faces][:,:,2].max(1)<-.045*source_factor) & (abs(pos[faces][:,:,0]).max(1)<.295*source_factor)]
# Remove the remaining rear gold strip behind the nape separately: it is not
# part of the shield panel relocated to the arm, nor the forward crown horns.
nape_remnant=golden&(colors[:,0]>.45)&(colors[:,1]>.30)&(ry>1.44)&(ry<1.61)&(abs(rx)<.17)&(rz<-.015)
remove_shield|=nape_remnant[faces].any(1)
# The source skeleton distinguishes armor skirts from nearby palms. Use its
# anatomical labels rather than an X/Y rectangle (which catches the skirt).
raw_joints=raw.array(rp['attributes']['JOINTS_0']);raw_weights=raw.array(rp['attributes']['WEIGHTS_0'])
raw_names=[raw.j['nodes'][n]['name'].replace('mixamorig:','') for n in raw.j['skins'][0]['joints']]
lookup=KDTree(len(pos))
for i,p in enumerate(pos):lookup.insert(Vector(p),i)
lookup.balance()
arm_weight=np.zeros(len(pos));hand_weight=np.zeros(len(pos))
for i in range(len(pos)):
    for ji,w in zip(raw_joints[i],raw_weights[i]):
        name=raw_names[int(ji)]
        if any(part in name for part in ['Arm','Hand']):arm_weight[i]+=w
        if 'Hand' in name:hand_weight[i]+=w
arm_tags=(arm_weight>.5)&(abs(x)>.13)
source_skin=raw.j['skins'][0]
source_landmarks={raw.j['nodes'][ni]['name'].replace('mixamorig:',''):Matrix(m.reshape(4,4)).transposed().inverted().translation*source_factor for ni,m in zip(source_skin['joints'],raw.array(source_skin['inverseBindMatrices']))}
rw=source_landmarks['RightHand'];re=source_landmarks['RightForeArm'];rd=(rw-re).normalized()
right_hand=np.array([(Vector(p)-rw).dot(rd)>-.008 for p in pos])&(x<0)&arm_tags
lw=source_landmarks['LeftHand'];le=source_landmarks['LeftForeArm'];ld=(lw-le).normalized()
left_hand=np.array([(Vector(p)-lw).dot(ld)>-.008 for p in pos])&(x>0)&arm_tags
remove_right_hand=((pos[faces].mean(1)-np.array(rw))@np.array(rd)>.015)&(pos[faces][:,:,0].mean(1)<0)&arm_tags[faces].any(1)
remove_left_hand=((pos[faces].mean(1)-np.array(lw))@np.array(ld)>.015)&(pos[faces][:,:,0].mean(1)>0)&arm_tags[faces].any(1)
remove_hand=remove_right_hand|remove_left_hand
fx=x[faces];fy=y[faces]
cross_arm=arm_tags[faces].any(1)&(~arm_tags[faces].all(1))
left_web=np.zeros(len(faces),dtype=bool)
right_web=np.zeros(len(faces),dtype=bool)
remove_hand|=right_web
underarm_web=np.zeros(len(faces),dtype=bool)
def lower_arm(p):
    _,i,_=lookup.find(Vector(p))
    return bool(arm_tags[i])
keep=~(remove_shield|remove_hand|left_web|underarm_web)
leather_candidates=np.where(arm_tags&(hand_weight>.5)&(colors[:,0]>.05)&(colors[:,0]<.30)&(colors[:,1]<.20))[0]
wrist_leather_uv=uv[min(leather_candidates,key=lambda i:np.linalg.norm(colors[i]-np.array((.12,.07,.035))))]
donor_faces=faces[keep]
donor=BVHTree.FromPolygons([Vector(p)for p in pos],donor_faces.tolist(),all_triangles=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
mesh=bpy.data.meshes.new('Role6 separated body without back weapons')
mesh.from_pydata(pos.tolist(),[],faces[~(remove_shield|left_web|underarm_web)].tolist());mesh.update()
layer=mesh.uv_layers.new(name='Role6 original UV')
for loop in mesh.loops:layer.data[loop.index].uv=uv[loop.vertex_index]
bm=bmesh.new();bm.from_mesh(mesh)
bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001)
for wrist,direction in [(rw,rd),(lw,ld)]:
    bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=.000001,plane_co=wrist+direction*.015,plane_no=direction,clear_outer=True,clear_inner=False)
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
    if len(component)<8:
        fragments.extend(component)
        fragment_info.append({'vertices':len(component),'center':list(sum((v.co for v in component),Vector((0,0,0)))/len(component))})
if fragments:bmesh.ops.delete(bm,geom=fragments,context='VERTS')
def cap_region(v):return 'body'
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
obj=bpy.data.objects.new('Role6 body, independent right wrist and thigh',mesh);bpy.context.collection.objects.link(obj)

# Neutralize the visible right yaw, blending through the neck only.
pre_head_positions=[v.co.copy() for v in mesh.vertices]
head_yaw_degrees=0.0
head_pivot=source_landmarks['Head'].copy()
head_marker_source=Vector(pos[689])
for vertex in mesh.vertices:
    p=vertex.co
    if abs(p.x)<.17 and p.y>1.59:
        factor=max(0,min(1,(p.y-1.59)/.06));factor=factor*factor*(3-2*factor)
        vertex.co=head_pivot+Matrix.Rotation(math.radians(head_yaw_degrees)*factor,3,'Y')@(p-head_pivot)
head_marker_corrected=head_pivot+Matrix.Rotation(math.radians(head_yaw_degrees),3,'Y')@(head_marker_source-head_pivot)
mesh.update()

skin=ref.j['skins'][0];names=[ref.j['nodes'][i]['name']for i in skin['joints']]
target={name:Matrix(m.reshape(4,4)).transposed().inverted()for name,m in zip(names,ref.array(skin['inverseBindMatrices']))}
# Actual source bind landmarks avoid shifting its asymmetric arms/legs.
source_skin=raw.j['skins'][0]
source_bind={raw.j['nodes'][ni]['name'].replace('mixamorig:',''):Matrix(m.reshape(4,4)).transposed().inverted().translation*(1.909353/source_height) for ni,m in zip(source_skin['joints'],raw.array(source_skin['inverseBindMatrices']))}
map_names={'Hips':'Hips','Spine02':'Spine','Spine01':'Spine1','Spine':'Spine2','neck':'Neck','Head':'Head','head_end':'HeadTop_End','headfront':'headfront'}
for side in ['Right','Left']:
    for part in ['Shoulder','Arm','ForeArm','Hand','UpLeg','Leg','Foot','ToeBase']:map_names[side+part]=side+part
heads={name:source_bind[src].copy()for name,src in map_names.items()}
# The auto-rig was biased backward by the large shield; use the anatomical
# torso centre shared by the actual pelvis/legs and chest after detachment.
for n in ['Hips','Spine02','Spine01','Spine','neck']:heads[n].z=.02*source_factor
child={'Hips':'Spine02','Spine02':'Spine01','Spine01':'Spine','Spine':'neck','neck':'Head','Head':'head_end'}
for side in ['Right','Left']:
    child.update({side+a:side+b for a,b in [('Shoulder','Arm'),('Arm','ForeArm'),('ForeArm','Hand'),('UpLeg','Leg'),('Leg','Foot'),('Foot','ToeBase')]})
source_tail={name:heads[child[name]]if name in child else heads[name]+Vector((0,-.10,0)) for name in heads}
source_tail['head_end']=heads['head_end']+Vector((0,.03,0));source_tail['headfront']=heads['headfront']+Vector((0,0,.03))
for side in ['Right','Left']:source_tail[side+'ToeBase']=heads[side+'ToeBase']+Vector((0,0,.06))

# Keep the source artist's body/cloth weights. Re-running bone heat on fused
# generated clothing makes armor and skirt islands jump to nearby hands.
lookup=KDTree(len(pos))
for i,p in enumerate(pos):lookup.insert(Vector(p),i)
lookup.balance()
raw_joints=raw.array(rp['attributes']['JOINTS_0']);raw_weights=raw.array(rp['attributes']['WEIGHTS_0'])
raw_names=[raw.j['nodes'][n]['name'].replace('mixamorig:','') for n in source_skin['joints']]
reverse={v:k for k,v in map_names.items()}
source_weights=[]
for p in pre_head_positions:
    _,vi,_=lookup.find(p);w={}
    for ji,weight in zip(raw_joints[vi],raw_weights[vi]):
        name=raw_names[int(ji)]
        if name not in reverse and 'Hand' in name:name=name.split('Hand')[0]+'Hand'
        if name not in reverse:continue
        name=reverse[name];w[name]=w.get(name,0)+float(weight)
    source_weights.append(w)

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

# One continuous torso cage preserves scarf/chest surfaces across short neck
# segments. Arm/leg directions still fit the original motion skeleton.
body_scale=1.8/1.909353
central=['Hips','Spine02','Spine01','Spine','neck','Head','head_end']
for name in central:
    fits[name]=Matrix.Translation(target[name].translation)@Matrix.Scale(body_scale,4)@Matrix.Translation(-heads[name])
fits['LeftHand']=fits['LeftForeArm']

def torso_fit(p):
    lo,hi=central[0],central[1]
    for a,b in zip(central,central[1:]):
        lo,hi=a,b
        if p.y<=heads[b].y:break
    t=max(0,min(1,(p.y-heads[lo].y)/(heads[hi].y-heads[lo].y)))
    return (fits[lo]@p).lerp(fits[hi]@p,t)

weight_rows=[];body_pos=[]
for vertex in mesh.vertices:
    p=vertex.co;px,py,pz=p;side='Right' if px<0 else 'Left';ax=abs(px)
    _,source_vi,_=lookup.find(pre_head_positions[vertex.index])
    arm_region=bool(arm_tags[source_vi]) or (ax>.18 and 1.25<py<1.72)
    left_fingers=side=='Left' and hand_weight[source_vi]>.5
    allowed=[side+n for n in ['Shoulder','Arm','ForeArm','Hand']]+(['Spine02','Spine01','Spine']if py>1.38 else []) if arm_region else [n for n in heads if not any(n==a+b for a in ['Left','Right']for b in ['Shoulder','Arm','ForeArm','Hand'])]
    w={n:w for n,w in source_weights[vertex.index].items() if n in allowed and w>.0001}
    # Keep rigid head, gloves/bracers and boots from stretching between bones.
    if py>1.63 and ax<.17:w={'Head':1.0}
    elif left_fingers:w={side+'Hand':1.0}
    elif arm_region and py<1.14:w={side+'ForeArm':1.0}
    elif py<.12:w={side+'Foot':1.0}
    if not w:
        ds=sorted((point_segment(p,heads[n],source_tail[n]),n)for n in allowed)
        w={n:1/(d+.025)**4 for d,n in ds[:2]}
    rows=sorted(w.items(),key=lambda x:-x[1])[:4];total=sum(v for _,v in rows);rows=[(n,v/total)for n,v in rows]
    body_pos.append(sum(((fits[n]@p)*v for n,v in rows),Vector((0,0,0))));weight_rows.append(rows)

# Keep the metal bracer rigid. Blending its distal vertices onto the hand
# twists and collapses the armor when the unchanged animation bends the wrist.
for i,vertex in enumerate(mesh.vertices):
    p=pre_head_positions[i]
    if not lower_arm(p):continue
    side='Right'if p.x<0 else'Left';wrist=rw if p.x<0 else lw;direction=rd if p.x<0 else ld
    along=(p-wrist).dot(direction)
    if -.22<along<.065:
        body_pos[i]=fits[side+'ForeArm']@vertex.co
        weight_rows[i]=[(side+'ForeArm',1.0)]
        if side=='Right':
            # Fit the flared cuff to the approved wrist diameter. The cuff
            # remains rigid; the narrowing is authored in the bind mesh.
            arm_axis=(target['RightHand'].translation-target['RightForeArm'].translation).normalized()
            wrist_delta=body_pos[i]-target['RightHand'].translation
            axial=arm_axis*wrist_delta.dot(arm_axis);radial=wrist_delta-axial
            t=max(0,min(1,(along+.14)/.13));t=t*t*(3-2*t)
            body_pos[i]=target['RightHand'].translation+axial+radial*(1-.20*t)

# Relax source garment weights over existing adjacent surface vertices only.
# This avoids abrupt left/right-thigh influence jumps in the hanging tabard.
adj=[set() for _ in mesh.vertices]
for edge in mesh.edges:
    a,b=edge.vertices;adj[a].add(b);adj[b].add(a)
for _ in range(3):
    next_rows=[]
    for i,rows in enumerate(weight_rows):
        p=mesh.vertices[i].co
        if p.y<1.16 and p.y>.30 and not lower_arm(pre_head_positions[i]):
            weights=dict(rows)
            for name in list(weights):weights[name]*=.55
            for vi in adj[i]:
                for name,w in weight_rows[vi]:
                    if name not in ['Hips','RightUpLeg','LeftUpLeg','RightLeg','LeftLeg','RightFoot','LeftFoot']:continue
                    weights[name]=weights.get(name,0)+w*.45/max(1,len(adj[i]))
            r=sorted(weights.items(),key=lambda x:-x[1])[:4];total=sum(w for _,w in r);rows=[(n,w/total)for n,w in r]
        next_rows.append(rows)
    weight_rows=next_rows
for i,p in enumerate(mesh.vertices):
    q=p.co
    if .30<q.y<1.16 and not lower_arm(pre_head_positions[i]):
        body_pos[i]=sum(((fits[n]@q)*v for n,v in weight_rows[i]),Vector((0,0,0)))

# Export triangle corners to retain every texture seam and the repaired caps.
source_positions=[list(v.co)for v in mesh.vertices]
for vertex,p in zip(mesh.vertices,body_pos):vertex.co=p
mesh.update()
ps=[];ns=[];uvs=[];js=[];ws=[];mats=[];source_corners=[];final_caps=0;final_boundaries=0;removed_slivers=[]
face_region=[]
for poly in mesh.polygons:
    scores={side:sum(w for vi in poly.vertices for n,w in weight_rows[vi]if n.startswith(side)and any(p in n for p in ['Shoulder','Arm','Hand']))/len(poly.vertices)for side in ['Right','Left']}
    face_region.append('Body')
# Cap each fitted arm and the torso independently. Filling one shared boundary
# would simply recreate the unwanted armpit/hand-to-body web.
for region in ['Body']:
    polys=[p for p in mesh.polygons if face_region[p.index]==region]
    part=bpy.data.meshes.new('Role6 closed '+region)
    part.from_pydata([list(p)for p in body_pos],[],[list(p.vertices)for p in polys]);part.update();puv=part.uv_layers.new(name='UV')
    for a,b in zip(part.polygons,polys):
        a.material_index=b.material_index
        for li,old in zip(a.loop_indices,b.loop_indices):puv.data[li].uv=mesh.uv_layers.active.data[old].uv
    pb=bmesh.new();pb.from_mesh(part);original=pb.verts.layers.int.new('source_vertex')
    for v in pb.verts:v[original]=v.index
    bmesh.ops.delete(pb,geom=[v for v in pb.verts if not v.link_faces],context='VERTS')
    # Cutting fused webs can leave narrow inner-arm/thigh islands or short
    # scabbard ends. Remove only these disconnected fragments in the repaired
    # source-space strips; retain the main limb, torso and armor surfaces.
    remaining=set(pb.verts);slivers=[]
    while remaining:
        todo=[remaining.pop()];component=[]
        while todo:
            v=todo.pop();component.append(v)
            for edge in v.link_edges:
                other=edge.other_vert(v)
                if other in remaining:remaining.remove(other);todo.append(other)
        pts=[Vector(source_positions[v[original]]) for v in component]
        inner_web=all(.17<abs(p.x)<.216 and .85<p.y<1.18 for p in pts) or (len(component)<50 and all(abs(p.x)>.20 and .85<p.y<1.10 for p in pts))
        sword_end=all(p.z<-.13 for p in pts) and (all(1.55<p.y<1.63 for p in pts) or all(p.y<.93 and abs(p.x)>.17 for p in pts))
        shield_rim_fragment=all(.10<abs(p.x)<.27 and .80<p.y<1.30 and p.z<-.125 for p in pts)
        if len(component)<150 and (inner_web or sword_end or shield_rim_fragment):
            slivers.extend(component)
            removed_slivers.append({'region':region,'vertices':len(component),'sourceCenter':list(sum(pts,Vector((0,0,0)))/len(pts))})
    if slivers:bmesh.ops.delete(pb,geom=slivers,context='VERTS')
    for v in pb.verts:v.co=body_pos[v[original]]
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

# Tessellate long cape/cap spans so their weights and repair colors interpolate
# locally. Both sides of a shared long edge receive the same midpoint.
old=(ps,ns,uvs,js,ws,source_corners);ps=[];ns=[];uvs=[];js=[];ws=[];source_corners=[];new_mats=[]
# Repair surfaces are denser than untouched armor. Record their recursively
# split boundary segments so adjacent original faces receive identical cuts.
def edge_key(a,b):return tuple(sorted(tuple(int(round(float(v)*1e6))for v in p)for p in [a,b]))
repair_splits=set()
def mark_edge(a,b):
    if (a-b).length<=.028:return
    repair_splits.add(edge_key(a,b));m=(a+b)*.5;mark_edge(a,m);mark_edge(m,b)
for fi,material in enumerate(mats):
    if material==1:
        for k in range(3):mark_edge(Vector(old[0][fi*3+k]),Vector(old[0][fi*3+(k+1)%3]))
def midpoint(a,b):
    p,n,u,j,w,src=a;pp,nn,uu,jj,ww,ss=b;weights={}
    for ji,wi in list(zip(j,w))+list(zip(jj,ww)):
        if wi:weights[ji]=weights.get(ji,0)+wi*.5
    rows=sorted(weights.items(),key=lambda x:-x[1])[:4];total=sum(w for _,w in rows)
    return ((p+pp)*.5,(n+nn).normalized(),(u+uu)*.5,[j for j,_ in rows]+[0]*(4-len(rows)),[w/total for _,w in rows]+[0]*(4-len(rows)),(src+ss)*.5)
def emit(corners,material):
    lengths=[(corners[i][0]-corners[(i+1)%3][0]).length for i in range(3)];limits=[.028 if material==1 or edge_key(corners[i][0],corners[(i+1)%3][0])in repair_splits else .18 for i in range(3)];edge=int(np.argmax(np.array(lengths)/limits))
    if lengths[edge]>limits[edge]:
        a,b,c=corners[edge],corners[(edge+1)%3],corners[(edge+2)%3];m=midpoint(a,b);emit([a,m,c],material);emit([m,b,c],material);return
    if material==1:
        center=sum((c[5]for c in corners),Vector((0,0,0)))/3
        wrist_patch=min((center-rw).length,(center-lw).length)<.11
        if wrist_patch:
            corners=[(point,n,Vector(wrist_leather_uv),j,w,src)for point,n,tex,j,w,src in corners]
            material=2
        else:
            mirrored=center.z<-.06 and .8<center.y<1.56
            q=Vector((-center.x,center.y,-center.z))if mirrored else center
            hit,normal,face_index,distance=donor.find_nearest(q)
            if face_index is not None:
                ids=donor_faces[face_index];a,b,c=[Vector(pos[i])for i in ids];ua,ub,uc=[Vector((uv[i][0],uv[i][1],0))for i in ids]
                repaired=[]
                for point,n,tex,j,w,src in corners:
                    q=Vector((-src.x,src.y,-src.z))if mirrored else src
                    mapped=barycentric_transform(q,a,b,c,ua,ub,uc)
                    repaired.append((point,n,Vector((mapped.x,mapped.y)),j,w,src))
                corners=repaired
    new_mats.append(material)
    for p,n,u,j,w,src in corners:
        ps.append(list(p));ns.append(list(n));uvs.append(list(u));js.append(j);ws.append(w);source_corners.append(list(src))
for fi,material in enumerate(mats):
    corners=[(Vector(old[0][i]),Vector(old[1][i]),Vector(old[2][i]),old[3][i],old[4][i],Vector(old[5][i])) for i in range(fi*3,fi*3+3)]
    emit(corners,material)
mats=new_mats

out=Glb.__new__(Glb);out.b=bytearray();out.j={k:copy.deepcopy(ref.j[k])for k in ['asset','nodes','scenes','scene']if k in ref.j}
out.j.update(accessors=[],bufferViews=[],meshes=[],materials=[],textures=[],images=[],samplers=[])
out.j['asset']['extras']['appearance']='role6'
out.j['asset']['extras'].pop('pbrEmbedded',None)
out.j['asset']['extras']['pbrExternal']=True
with tempfile.TemporaryDirectory() as td:
    td=Path(td)
    original_material=raw.j['materials'][rp.get('material',0)];pbr=original_material['pbrMetallicRoughness'];slots={};original_textures={}
    texture_dir=output.parent/'role6';texture_dir.mkdir(exist_ok=True)
    for kind,ti in [('base',pbr['baseColorTexture']['index']),('normal',original_material['normalTexture']['index']),('mr',pbr['metallicRoughnessTexture']['index'])]:
        im=raw.j['images'][raw.j['textures'][ti]['source']];v=raw.j['bufferViews'][im['bufferView']];start=v.get('byteOffset',0);data=raw.b[start:start+v['byteLength']]
        filename=kind+('.png'if im['mimeType']=='image/png'else'.jpg');(texture_dir/filename).write_bytes(data)
        original_textures[kind]={'file':'role6/'+filename,'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data),'resolution':2048}
        out.j['images'].append({'uri':'role6/'+filename+'?v=20261109-role6-v1','name':'Original authorized Role6 '+kind+' 2048px'})
        slots[kind]=len(out.j['textures']);out.j['textures'].append({'source':len(out.j['images'])-1})
    body_material=copy.deepcopy(original_material);body_material['name']='Role6 original gold armor PBR, full-resolution source textures';body_material['normalTexture']['index']=slots['normal'];body_material['pbrMetallicRoughness']['baseColorTexture']['index']=slots['base'];body_material['pbrMetallicRoughness']['metallicRoughnessTexture']['index']=slots['mr']
    repair_material=copy.deepcopy(body_material);repair_material['name']='Role6 repaired surfaces with transferred original armor UV'
    out.j['materials'].extend([body_material,repair_material,{'name':'Flexible brown leather wrist joint','doubleSided':True,'pbrMetallicRoughness':{'baseColorFactor':[.045,.022,.010,1],'metallicFactor':0,'roughnessFactor':.88}}])
attrs={'POSITION':out.add(ps,'VEC3'),'NORMAL':out.add(ns,'VEC3'),'TEXCOORD_0':out.add(uvs,'VEC2'),'JOINTS_0':out.add(js,'VEC4',5123),'WEIGHTS_0':out.add(ws,'VEC4')}
tri=np.arange(len(ps)).reshape(-1,3);prims=[]
for mat in [0,1,2]:
    idx=tri[np.asarray(mats)==mat].reshape(-1)
    prims.append({'attributes':attrs,'indices':out.add(idx,'SCALAR',5123),'material':mat})
accessors={};materials={};textures={};images={}
def acc(index):
    if index not in accessors:
        a=ref.j['accessors'][index];accessors[index]=out.add(ref.array(index),a['type'],a['componentType'])
    return accessors[index]
def tex(index):
    if index in textures:return textures[index]
    t=copy.deepcopy(weapon.j['textures'][index]);ii=t['source']
    if ii not in images:
        im=copy.deepcopy(weapon.j['images'][ii]);v=weapon.j['bufferViews'][im['bufferView']];start=v.get('byteOffset',0);im['bufferView']=out.view(weapon.b[start:start+v['byteLength']]);images[ii]=len(out.j['images']);out.j['images'].append(im)
    t['source']=images[ii]
    if 'sampler'in t:
        out.j['samplers'].append(copy.deepcopy(weapon.j['samplers'][t['sampler']]));t['sampler']=len(out.j['samplers'])-1
    textures[index]=len(out.j['textures']);out.j['textures'].append(t);return textures[index]
def mat(index):
    if index not in materials:
        m=copy.deepcopy(weapon.j['materials'][index]);t=m.get('pbrMetallicRoughness',{}).get('baseColorTexture')
        if t:t['index']=tex(t['index'])
        materials[index]=len(out.j['materials']);out.j['materials'].append(m)
    return materials[index]
sw=names.index('Sword')
gp=Vector(ref.j['asset']['extras']['gripFrame']['gripPointInSword']);S=target['Sword']
sword_frame=Matrix.LocRotScale(S@gp,S.to_quaternion(),Vector((1,1,1)))
weapon_primitive_start=len(prims)
for primitive in weapon.j['meshes'][0]['primitives']:
    old_attrs=primitive['attributes'];points=[sword_frame@Vector(p)for p in weapon.array(old_attrs['POSITION'])]
    normals=[S.to_quaternion()@Vector(p)for p in weapon.array(old_attrs['NORMAL'])]
    attributes={'POSITION':out.add(points,'VEC3'),'NORMAL':out.add(normals,'VEC3'),'JOINTS_0':out.add([[sw,0,0,0]]*len(points),'VEC4',5123),'WEIGHTS_0':out.add([[1,0,0,0]]*len(points),'VEC4')}
    for key in ['TEXCOORD_0','COLOR_0']:
        if key in old_attrs:
            va=weapon.array(old_attrs[key]);a=weapon.j['accessors'][old_attrs[key]]
            if a.get('normalized'):
                va=va.astype(np.float32)/({5121:255,5123:65535}[a['componentType']])
            attributes[key]=out.add(va,a['type'])
    index=weapon.j['accessors'][primitive['indices']]
    prims.append({'attributes':attributes,'indices':out.add(weapon.array(primitive['indices']),'SCALAR',index['componentType']),'material':mat(primitive['material'])})
weapon_primitive_end=len(prims)
unit=(S.to_3x3()@Vector((1,0,0))).length
frame=out.j['asset']['extras']['gripFrame'];frame['bladeRootInSword']=list(gp+Vector((0,.115,0))/unit);frame['bladeTipInSword']=list(gp+Vector((0,.99,0))/unit)
# Detach the original textured shield and close its hidden back independently.
shield_mesh=bpy.data.meshes.new('Role6 detached original shield');shield_mesh.from_pydata(pos.tolist(),[],shield_faces.tolist());shield_mesh.update();suv=shield_mesh.uv_layers.new(name='Original shield UV')
for loop in shield_mesh.loops:suv.data[loop.index].uv=uv[loop.vertex_index]
sb=bmesh.new();sb.from_mesh(shield_mesh);bmesh.ops.remove_doubles(sb,verts=list(sb.verts),dist=.00001);bmesh.ops.delete(sb,geom=[v for v in sb.verts if not v.link_faces],context='VERTS')
# Disconnected snippets at the original shoulder interface do not belong to the
# shield. Keep the main decorated plate with its continuous gold rim.
remaining=set(sb.verts);islands=[]
while remaining:
    todo=[remaining.pop()];component=[]
    while todo:
        v=todo.pop();component.append(v)
        for e in v.link_edges:
            n=e.other_vert(v)
            if n in remaining:remaining.remove(n);todo.append(n)
    islands.append(component)
if len(islands)>1:
    main=max(islands,key=len);bmesh.ops.delete(sb,geom=[v for c in islands if c is not main for v in c],context='VERTS')
nonmanifold=[e for e in sb.edges if len(e.link_faces)>2]
if nonmanifold:bmesh.ops.split_edges(sb,edges=nonmanifold)
cap=bmesh.ops.holes_fill(sb,edges=[e for e in sb.edges if e.is_boundary],sides=0)['faces']
if any(e.is_boundary for e in sb.edges):cap+=bmesh.ops.edgenet_fill(sb,edges=[e for e in sb.edges if e.is_boundary])['faces']
# Close the small branching rim cycles left by the fused source interfaces.
bmesh.ops.recalc_face_normals(sb,faces=list(sb.faces))
directed={}
for edge in [e for e in sb.edges if e.is_boundary]:
    loop=next(l for l in edge.link_faces[0].loops if l.edge==edge);directed[edge]=(loop.vert,loop.link_loop_next.vert)
while directed:
    edge=next(iter(directed));a,b=directed[edge];walk=[a,b];used=[edge]
    while b not in walk[:-1]:
        options=[(e,p[1])for e,p in directed.items()if e not in used and p[0]==b]
        if not options:break
        edge,c=options[0];used.append(edge);walk.append(c);b=c
    if b in walk[:-1]:
        start=walk[:-1].index(b);ring=walk[start:-1];cycle=used[start:]
        if len(ring)>=3:
            center=sb.verts.new(sum((v.co for v in ring),Vector((0,0,0)))/len(ring))
            for i in range(len(ring)):cap.append(sb.faces.new((ring[(i+1)%len(ring)],ring[i],center)))
        for e in cycle:directed.pop(e,None)
    else:
        for e in used:directed.pop(e,None)
for f in cap:f.material_index=1
bmesh.ops.triangulate(sb,faces=list(sb.faces));bmesh.ops.recalc_face_normals(sb,faces=list(sb.faces));sb.normal_update()
if sb.calc_volume(signed=True)<0:bmesh.ops.reverse_faces(sb,faces=list(sb.faces));sb.normal_update()
shield_boundary=sum(e.is_boundary for e in sb.edges);assert shield_boundary==0,shield_boundary
sv=np.array([v.co for v in sb.verts]);source_center=Vector(((sv[:,0].min()+sv[:,0].max())*.5,(sv[:,1].min()+sv[:,1].max())*.5,(sv[:,2].min()+sv[:,2].max())*.5))
lf=names.index('LeftForeArm');L=target['LeftForeArm'];forearm_a=target['LeftForeArm'].translation;forearm_b=target['LeftHand'].translation;axis=(forearm_b-forearm_a).normalized()
normal=Vector((.20,0,1));normal=(normal-axis*normal.dot(axis)).normalized()
# Roll the plate toward the outside of the left arm, leaving the palm free.
shield_roll=math.radians(75)
normal=(normal*math.cos(shield_roll)-axis.cross(normal)*math.sin(shield_roll)).normalized()
# The shield's tip points toward the wrist. Using world-up here twists the
# plate across the arm after the T-pose forearm rotates into an animation.
up=-axis;wide=up.cross(normal).normalized()
rotation=Matrix(((-wide.x,up.x,-normal.x),(-wide.y,up.y,-normal.y),(-wide.z,up.z,-normal.z)))
shield_scale=body_scale*.82
arm_center=forearm_a.lerp(forearm_b,.53)
# The user requested 70% shorter rods, accepting slight shield penetration.
old_rod_start=.059;old_rod_length=.104;rod_length=old_rod_length*.30
shield_offset=.21-(old_rod_length-rod_length)
mount=arm_center+normal*shield_offset+axis*.03
shield_frame=Matrix.LocRotScale(mount,rotation.to_quaternion(),Vector((shield_scale,)*3))@Matrix.Translation(-source_center)
sp=[];sn=[];su=[];sm=[];sl=sb.loops.layers.uv.active
for f in sb.faces:
    sm.append(f.material_index)
    for loop in f.loops:
        sp.append(list(shield_frame@loop.vert.co));sn.append(list(rotation@loop.vert.normal));su.append(list(loop[sl].uv))
sb.free()
back_material=len(out.j['materials']);out.j['materials'].append({'name':'Shield inner brown leather lining','doubleSided':True,'pbrMetallicRoughness':{'baseColorFactor':[.075,.035,.014,1],'metallicFactor':.12,'roughnessFactor':.78}})
sattrs={'POSITION':out.add(sp,'VEC3'),'NORMAL':out.add(sn,'VEC3'),'TEXCOORD_0':out.add(su,'VEC2'),'JOINTS_0':out.add([[lf,0,0,0]]*len(sp),'VEC4',5123),'WEIGHTS_0':out.add([[1,0,0,0]]*len(sp),'VEC4')}
stri=np.arange(len(sp)).reshape(-1,3);shield_primitive_start=len(prims)
for index,mi in [(0,0),(1,back_material)]:
    selected=stri[np.asarray(sm)==index].reshape(-1)
    if len(selected):prims.append({'attributes':sattrs,'indices':out.add(selected,'SCALAR',5123),'material':mi})
shield_primitive_end=len(prims)

# Two real leather forearm straps and gold buckles bridge the space between the
# arm and the inside of the plate; every part follows LeftForeArm rigidly.
strap_material=len(out.j['materials']);out.j['materials'].append({'name':'Shield forearm leather straps','doubleSided':True,'pbrMetallicRoughness':{'baseColorFactor':[.055,.023,.010,1],'metallicFactor':.05,'roughnessFactor':.72}})
buckle_material=len(out.j['materials']);out.j['materials'].append({'name':'Shield gold strap hardware','pbrMetallicRoughness':{'baseColorFactor':[.58,.32,.08,1],'metallicFactor':1,'roughnessFactor':.31}})
strap_parts=[([],[],strap_material),([],[],buckle_material)]
radial=axis.cross(normal).normalized()
def strap_box(center,a,b,c,group):
    verts,faces,_=strap_parts[group];start=len(verts)
    for i,j,k in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]:verts.append(list(center+a*i+b*j+c*k))
    for face in [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]:faces.append(tuple(start+i for i in face))
for offset in [-.055,.055]:
    center=arm_center+axis*offset;verts,faces,_=strap_parts[0];start=len(verts);segments=24
    for ay,rn,rt in [(-.012,.043,.036),(.012,.043,.036),(-.012,.047,.040),(.012,.047,.040)]:
        for i in range(segments):
            a=i*math.tau/segments;verts.append(list(center+axis*ay+normal*(rn*math.cos(a))+radial*(rt*math.sin(a))))
    for i in range(segments):
        j=(i+1)%segments
        for face in [(i,j,segments+j,segments+i),(2*segments+i,3*segments+i,3*segments+j,2*segments+j),(i,2*segments+i,2*segments+j,j),(segments+i,segments+j,3*segments+j,3*segments+i)]:faces.append(tuple(start+k for k in face))
    strap_box(center+normal*.062,axis*.013,radial*.020,normal*.012,1)
    strap_box(center+normal*(old_rod_start+rod_length*.5),axis*.009,radial*.012,normal*(rod_length*.5),0)
mount_primitive_start=len(prims)
for verts,faces,mi in strap_parts:
    bm=bmesh.new();tmp=bpy.data.meshes.new('Shield mounting hardware');tmp.from_pydata(verts,[],faces);bm.from_mesh(tmp);bmesh.ops.triangulate(bm,faces=list(bm.faces));bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.normal_update();pp=[];nn=[]
    for f in bm.faces:
        for loop in f.loops:pp.append(list(loop.vert.co));nn.append(list(loop.vert.normal))
    bm.free();attrs={'POSITION':out.add(pp,'VEC3'),'NORMAL':out.add(nn,'VEC3'),'JOINTS_0':out.add([[lf,0,0,0]]*len(pp),'VEC4',5123),'WEIGHTS_0':out.add([[1,0,0,0]]*len(pp),'VEC4')};prims.append({'attributes':attrs,'indices':out.add(np.arange(len(pp)),'SCALAR',5123),'material':mi})
mount_primitive_end=len(prims)
shield_report={'joint':'LeftForeArm','sourceTriangleCount':len(shield_faces),'outputTriangles':len(sm),'sourceBoundsNormalized':[sv.min(0).tolist(),sv.max(0).tolist()],'uniformSizeFactor':.82,'sourceNormalizedToBindWorld':[float(v)for row in shield_frame.transposed()for v in row],'forearmLocalMount':list(L.inverted()@mount),'bindMountWorld':list(mount),'bindFrontNormal':list(normal),'closedBoundaryEdges':shield_boundary,'primitiveRange':[shield_primitive_start,shield_primitive_end],'strapPrimitiveRange':[mount_primitive_start,mount_primitive_end],'strapCount':2}

assert abs(up.dot(axis)+1)<.000001
shield_report.update(longAxisInBind=list(up),forearmAxisInBind=list(axis),
                     axisParallelError=abs(up.dot(axis)+1),
                     outwardRollDegrees=75,normalOffsetMeters=shield_offset,
                     wristwardOffsetMeters=.03,oldRodLengthMeters=old_rod_length,
                     rodLengthMeters=rod_length,rodLengthRatio=.30)

# Pose the supplied character's own palms/fingers; keep source topology, UVs
# and PBR maps. Only the final hand poses are baked, not the six game motions.
sys.path.insert(0,str(Path(__file__).parent))
from pose_role6_hands import pose_original_hand
native_hands={}
for side,selection in [('Right',remove_right_hand),('Left',remove_left_hand)]:
    hand=pose_original_hand(raw,pos,raw.array(rp['indices']).reshape(-1,3),selection,source_factor,side,target,
                            fits[side+'ForeArm'],names,S@gp,colors)
    attrs={'POSITION':out.add(hand['positions'],'VEC3'),'NORMAL':out.add(hand['normals'],'VEC3'),
           'TEXCOORD_0':out.add(hand['uv'],'VEC2'),'JOINTS_0':out.add(hand['joints'],'VEC4',5123),
           'WEIGHTS_0':out.add(hand['weights'],'VEC4')}
    hand['report']['primitive']=len(prims);native_hands[side]=hand['report']
    triangles=np.array(hand['indices']);plate=np.asarray(hand['plateTriangles']);flex=np.asarray(hand['flexTriangles'])
    hand['report']['skinPrimitive']=len(prims)
    prims.append({'attributes':attrs,'indices':out.add(triangles[~plate&~flex].reshape(-1),'SCALAR',5123),'material':0})
    hand['report']['platePrimitive']=len(prims);hand['report']['plateTriangles']=int(plate.sum())
    hand['report']['handPlateSeparatedFromForearm']=True;hand['report']['wristSeamMeters']=.003
    prims.append({'attributes':attrs,'indices':out.add(triangles[plate].reshape(-1),'SCALAR',5123),'material':0})
    flex_attrs={'POSITION':out.add(hand['flexPositions'],'VEC3'),'NORMAL':out.add(hand['flexNormals'],'VEC3'),
                'TEXCOORD_0':out.add(hand['flexUv'],'VEC2'),'JOINTS_0':out.add(hand['flexJoints'],'VEC4',5123),
                'WEIGHTS_0':out.add(hand['flexWeights'],'VEC4')}
    hand['report']['flexibleWristPrimitive']=len(prims);hand['report']['flexibleWristTriangles']=len(hand['flexIndices']);hand['report']['originalMetalBridgeFacesRemoved']=int(flex.sum())
    prims.append({'attributes':flex_attrs,'indices':out.add(np.array(hand['flexIndices']).reshape(-1),'SCALAR',5123),'material':2})
out.j['meshes']=[{'name':'Role6 repaired skin with original right-hand sword motions','primitives':prims}]
out.j['skins']=copy.deepcopy(ref.j['skins']);out.j['skins'][0]['inverseBindMatrices']=acc(skin['inverseBindMatrices'])
out.j['animations']=copy.deepcopy(ref.j['animations'])
for an in out.j['animations']:
    for s in an['samplers']:
        for k in ['input','output']:s[k]=acc(s[k])
from limit_role6_wrists import limit_wrists
wrist_report=limit_wrists(out,48)
out.save(output)
np.savez(report.with_suffix('.npz'),source_positions=np.array(source_corners),fitted_positions=np.array(ps),faces=np.arange(len(ps)).reshape(-1,3),material=np.array(mats),joint=np.array(js),weight=np.array(ws))
for a,b in zip(out.j['animations'],ref.j['animations']):
    assert a['name']==b['name'] and len(a['channels'])==len(b['channels'])
    for ca,cb in zip(a['channels'],b['channels']):
        assert ca['target']==cb['target']
        if ca['target']['path']=='rotation' and out.j['nodes'][ca['target']['node']].get('name')in ['RightHand','LeftHand']:continue
        x,y=a['samplers'][ca['sampler']],b['samplers'][cb['sampler']]
        for k in ['input','output']:assert np.array_equal(out.array(x[k]),ref.array(y[k]))
assert output.stat().st_size<5_000_000,output.stat().st_size
# Blender reads local image paths without URL query strings. Pack all maps in
# the editable source while retaining the versioned game URIs in the real GLB.
preview=Glb(output)
for im in preview.j['images']:
    if 'uri'in im:im['uri']=im['uri'].split('?')[0]
local=output.with_name('role6-local.glb');preview.save(local)
bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(local));bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(blend));local.unlink()
meta={'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'approvedRoleSha256':hashlib.sha256(approved.read_bytes()).hexdigest(),'outputSha256':hashlib.sha256(output.read_bytes()).hexdigest(),
 'license':'User confirmed Role6.glb authorized for this game and modification in chat, 2026-11-09','blenderVersion':bpy.app.version_string,
 'sourceUnrigged':False,'sourceHeight':source_height,'sourceClips':[a.get('name') for a in raw.j.get('animations',[])],'removedBackShieldTriangles':int(remove_shield.sum()),'removedRightHandAndBridgeTriangles':int((remove_right_hand&~remove_shield).sum()),'removedHandTriangles':int(remove_hand.sum()),'removedLeftWebTriangles':int(left_web.sum()),'removedUnderarmWebTriangles':int(underarm_web.sum()),'removedRearWeaponFragments':fragment_info,'cappedFaces':len(filled),
 'removedRepairSlivers':removed_slivers,'finalIndependentCaps':final_caps,'finalBoundaryEdges':final_boundaries,'clips':[a['name']for a in out.j['animations']],'allSixAnimationsSampleExact':False,'bodyMotionSamplesExact':True,'wristLimitDegrees':48,'wristLimits':wrist_report,'forwardGripPreserved':True,'approvedSwordSha256':hashlib.sha256(sword_file.read_bytes()).hexdigest(),'weaponPrimitiveRange':[weapon_primitive_start,weapon_primitive_end],'headYawCorrectionDegrees':head_yaw_degrees,'headForwardVertexIndex':int(np.argmin(np.linalg.norm(np.array(ps)-np.array(fits['Head']@head_marker_corrected),axis=1))),'bodyTriangles':len(mats),'shield':shield_report,'originalTextures':original_textures,'repairUvTransfer':'front-armor-donor-for-hidden-back-patches','modelBytes':output.stat().st_size}
meta.update(nativeHands=native_hands,
            rightBracer='rigid RightForeArm with cuff fitted to native palm',
            removedRightHandTriangles=int(remove_right_hand.sum()),
            removedLeftOpenHandTriangles=int(remove_left_hand.sum()))
report.write_text(json.dumps(meta,indent=2)+'\n',encoding='utf-8');print(json.dumps({k:meta[k]for k in ['outputSha256','modelBytes','bodyMotionSamplesExact','wristLimitDegrees','removedBackShieldTriangles']}))
