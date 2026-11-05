"""Refit authorized Role4 bind-pose skin; remove rear weapons and fused hands.
blender -b --python prepare_role4.py -- Role4.glb approved-role.glb approved-sword.glb output.glb source.blend report.json
The approved symmetric v2 sword is mounted on the unchanged reference rig.
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
assert hashlib.sha256(sword_file.read_bytes()).hexdigest()=='9be98b40aee20fde05a3c5af928f64f5c22b0b51961668ce0eeae411c9334ea0', 'Use the user-approved symmetric second sword'
assert hashlib.sha256(source.read_bytes()).hexdigest() == '3d22a180e843ad253c23b8b555f53ebf742a8df595404df2b8957a05bfc8c9bb', 'Fit only the authorized Role4 source'
assert len(raw.j.get('skins', [])) == 1, 'Expected Role4 SmartRig source'
rp=raw.j['meshes'][0]['primitives'][0]
pos=raw.array(rp['attributes']['POSITION']);uv=raw.array(rp['attributes']['TEXCOORD_0']);faces=raw.array(rp['indices']).reshape(-1,3)
pos[:,1]-=pos[:,1].min()
source_height=float(pos[:,1].max())
# Canonical arms-down anatomy used by the established Role2 repair; source
# SmartRig animation is intentionally replaced by the approved six clips.
pos *= 1.909353/source_height
x,y,z=pos.T
# Source has one diagonal rear weapon, including its long blade and hilt.
line=abs(x+.47*(y-1.2*1.909353/source_height))
handles=(x<-.15*1.909353/source_height)&(y>1.55*1.909353/source_height)&(z<-.065*1.909353/source_height)
guards=(y>1.4*1.909353/source_height)&(y<1.56*1.909353/source_height)&(x<-.035*1.909353/source_height)&(z<-.12*1.909353/source_height)&(line<.11*1.909353/source_height)
swords=((line<.055*1.909353/source_height)&(z<-.115*1.909353/source_height)&(y>.65*1.909353/source_height)&(y<1.56*1.909353/source_height))|handles|guards
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
right_hand=(x<-.27)&(y<1.036)&(y>.85)&arm_tags
remove_sword=swords[faces].any(1);remove_hand=right_hand[faces].any(1)
fx=x[faces];fy=y[faces]
cross_arm=arm_tags[faces].any(1)&(~arm_tags[faces].all(1))
left_web=cross_arm&(fx.mean(1)>0)&(fy.mean(1)>.85)&(fy.mean(1)<1.07)
right_web=cross_arm&(fx.mean(1)<0)&(fy.mean(1)>.85)&(fy.mean(1)<1.07)
remove_hand|=right_web
underarm_web=cross_arm&(fy.mean(1)>=1.07)&(fy.mean(1)<1.37)
def lower_arm(p):
    _,i,_=lookup.find(Vector(p))
    return bool(arm_tags[i] and .85<p[1]<1.405)
keep=~(remove_sword|remove_hand|left_web|underarm_web)
bpy.ops.wm.read_factory_settings(use_empty=True)
mesh=bpy.data.meshes.new('Role4 separated body without back weapons')
mesh.from_pydata(pos.tolist(),[],faces[keep].tolist());mesh.update()
layer=mesh.uv_layers.new(name='Role4 original UV')
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
obj=bpy.data.objects.new('Role4 body, independent right wrist and thigh',mesh);bpy.context.collection.objects.link(obj)

# Neutralize the visible right yaw, blending through the neck only.
pre_head_positions=[v.co.copy() for v in mesh.vertices]
head_yaw_degrees=-20.0
head_pivot=Vector((.0112,1.6300,-.0309))
head_marker_source=Vector(pos[255])
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
    arm_region=bool(arm_tags[source_vi]) or (ax>.175 and 1.37<py<1.58)
    left_fingers=side=='Left' and hand_weight[source_vi]>.5
    allowed=list(heads)
    if arm_region or left_fingers:
        allowed=[side+n for n in ['Shoulder','Arm','ForeArm','Hand']]
        if py>1.38:allowed+=['Spine','Spine01','neck']
    elif py<1.15:
        allowed=['Hips']+[s+n for s in ['Right','Left'] for n in ['UpLeg','Leg','Foot','ToeBase']]
    elif py>=1.045:
        allowed=['Hips','Spine02','Spine01','Spine','neck','Head','head_end']
    w={n:w for n,w in source_weights[vertex.index].items() if n in allowed and w>.0001}
    # Keep rigid head, gloves/bracers and boots from stretching between bones.
    if py>1.63:w={'Head':1.0}
    elif left_fingers:w={side+'Hand':1.0}
    elif arm_region and py<1.14:w={side+'ForeArm':1.0}
    elif py<.12:w={side+'Foot':1.0}
    if not w:
        ds=sorted((point_segment(p,heads[n],source_tail[n]),n)for n in allowed)
        w={n:1/(d+.025)**4 for d,n in ds[:2]}
    rows=sorted(w.items(),key=lambda x:-x[1])[:4];total=sum(v for _,v in rows);rows=[(n,v/total)for n,v in rows]
    body_pos.append(torso_fit(p) if not arm_region and py>=heads['Hips'].y else sum(((fits[n]@p)*v for n,v in rows),Vector((0,0,0))));weight_rows.append(rows)

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
    face_region.append(max(scores,key=scores.get)if max(scores.values())>.5 else 'Body')
# Cap each fitted arm and the torso independently. Filling one shared boundary
# would simply recreate the unwanted armpit/hand-to-body web.
for region in ['Body','Right','Left']:
    polys=[p for p in mesh.polygons if face_region[p.index]==region]
    part=bpy.data.meshes.new('Role4 closed '+region)
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
        if len(component)<120 and (inner_web or sword_end):
            slivers.extend(component)
            removed_slivers.append({'region':region,'vertices':len(component),'sourceCenter':list(sum(pts,Vector((0,0,0)))/len(pts))})
    if slivers:bmesh.ops.delete(pb,geom=slivers,context='VERTS')
    # Fit each independent shell from its own anatomical weights, including
    # boundary vertices inherited from the generated fused surface.
    for v in pb.verts:
        vi=v[original];q=Vector(source_positions[vi]);rows=weight_rows[vi]
        allowed=[n for n in heads if not any(n==side+part for side in ['Right','Left']for part in ['Shoulder','Arm','ForeArm','Hand'])] if region=='Body' else [region+n for n in ['Shoulder','Arm','ForeArm','Hand']]
        rows=[(n,w)for n,w in rows if n in allowed]
        if not rows:rows=[(min(allowed,key=lambda n:point_segment(q,heads[n],source_tail[n])),1)]
        total=sum(w for _,w in rows)
        v.co=torso_fit(q) if region=='Body' and q.y>=heads['Hips'].y else sum(((fits[n]@q)*(w/total)for n,w in rows),Vector((0,0,0)))
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
            def is_arm(n):return any(n==side+part for side in ['Right','Left']for part in ['Shoulder','Arm','ForeArm','Hand'])
            allowed=[n for n in heads if not is_arm(n)] if region=='Body' else [region+n for n in ['Shoulder','Arm','ForeArm','Hand']]
            rows=[(n,w) for n,w in rows if n in allowed]
            if not rows:
                source_point=Vector(source_positions[vi]);nearest=min(allowed,key=lambda n:point_segment(source_point,heads[n],source_tail[n]));rows=[(nearest,1)]
            total=sum(w for _,w in rows);rows=[(n,w/total)for n,w in rows]
            ps.append(list(loop.vert.co));ns.append(list(loop.vert.normal));uvs.append(list(loop[pl].uv));source_corners.append(source_positions[vi])
            js.append([names.index(n)for n,_ in rows]+[0]*(4-len(rows)));ws.append([v for _,v in rows]+[0]*(4-len(rows)))
    pb.free()
assert final_boundaries==0,'Torso and arm repairs must be capped separately'

# Tessellate long cape/cap spans so their weights and repair colors interpolate
# locally. Both sides of a shared long edge receive the same midpoint.
old=(ps,ns,uvs,js,ws,source_corners);ps=[];ns=[];uvs=[];js=[];ws=[];source_corners=[];new_mats=[]
def midpoint(a,b):
    p,n,u,j,w,src=a;pp,nn,uu,jj,ww,ss=b;weights={}
    for ji,wi in list(zip(j,w))+list(zip(jj,ww)):
        if wi:weights[ji]=weights.get(ji,0)+wi*.5
    rows=sorted(weights.items(),key=lambda x:-x[1])[:4];total=sum(w for _,w in rows)
    return ((p+pp)*.5,(n+nn).normalized(),(u+uu)*.5,[j for j,_ in rows]+[0]*(4-len(rows)),[w/total for _,w in rows]+[0]*(4-len(rows)),(src+ss)*.5)
def emit(corners,material):
    lengths=[(corners[i][0]-corners[(i+1)%3][0]).length for i in range(3)];edge=int(np.argmax(lengths))
    if lengths[edge]>.18:
        a,b,c=corners[edge],corners[(edge+1)%3],corners[(edge+2)%3];m=midpoint(a,b);emit([a,m,c],material);emit([m,b,c],material);return
    new_mats.append(material)
    for p,n,u,j,w,src in corners:
        ps.append(list(p));ns.append(list(n));uvs.append(list(u));js.append(j);ws.append(w);source_corners.append(list(src))
for fi,material in enumerate(mats):
    corners=[(Vector(old[0][i]),Vector(old[1][i]),Vector(old[2][i]),old[3][i],old[4][i],Vector(old[5][i])) for i in range(fi*3,fi*3+3)]
    emit(corners,material)
mats=new_mats

out=Glb.__new__(Glb);out.b=bytearray();out.j={k:copy.deepcopy(ref.j[k])for k in ['asset','nodes','scenes','scene']if k in ref.j}
out.j.update(accessors=[],bufferViews=[],meshes=[],materials=[],textures=[],images=[],samplers=[])
out.j['asset']['extras']['appearance']='role4'
out.j['asset']['extras']['pbrEmbedded']=True
with tempfile.TemporaryDirectory() as td:
    td=Path(td)
    original_material=raw.j['materials'][rp.get('material',0)];pbr=original_material['pbrMetallicRoughness']
    slots={}
    for kind,ti in [('base',pbr['baseColorTexture']['index']),('normal',original_material['normalTexture']['index']),('mr',pbr['metallicRoughnessTexture']['index'])]:
        im=raw.j['images'][raw.j['textures'][ti]['source']];v=raw.j['bufferViews'][im['bufferView']];start=v.get('byteOffset',0)
        file=td/(kind+'.png');file.write_bytes(raw.b[start:start+v['byteLength']]);image=bpy.data.images.load(str(file),check_existing=False)
        if kind!='base':image.colorspace_settings.name='Non-Color'
        size=1024 if kind=='base'else 512;image.scale(size,size)
        if kind=='normal':
            pixels=np.empty(size*size*4,dtype=np.float32);image.pixels.foreach_get(pixels);pixels=pixels.reshape(-1,4);vectors=pixels[:,:3]*2-1;vectors/=np.maximum(np.linalg.norm(vectors,axis=1,keepdims=True),1e-6);pixels[:,:3]=vectors*.5+.5;image.pixels.foreach_set(pixels.reshape(-1))
        dest=td/(kind+('.jpg'if kind=='base'else'.png'))
        if kind=='base':
            scene=bpy.context.scene;scene.render.image_settings.file_format='JPEG';scene.render.image_settings.quality=92;scene.view_settings.view_transform='Standard';scene.view_settings.look='None';scene.view_settings.exposure=0;scene.view_settings.gamma=1;image.save_render(str(dest),scene=scene)
        else:image.filepath_raw=str(dest);image.file_format='PNG';image.save()
        out.j['images'].append({'bufferView':out.view(dest.read_bytes()),'mimeType':'image/jpeg'if kind=='base'else'image/png','name':'Authorized Role4 '+kind+' '+str(size)+'px'})
        slots[kind]=len(out.j['textures']);out.j['textures'].append({'source':len(out.j['images'])-1});bpy.data.images.remove(image)
    out.j['materials'].extend([
        {'name':'Role4 original armor, red cloth and skin PBR','doubleSided':True,'normalTexture':{'index':slots['normal']},'pbrMetallicRoughness':{'baseColorTexture':{'index':slots['base']},'metallicRoughnessTexture':{'index':slots['mr']},'metallicFactor':1,'roughnessFactor':1}},
        {'name':'Role4 independent closed repair surfaces','doubleSided':True,'pbrMetallicRoughness':{'baseColorFactor':[1,1,1,1],'metallicFactor':.35,'roughnessFactor':.65}}])
# Repair faces use colors sampled from nearby surviving body texture, rather
# than stretching unrelated atlas islands across the removed rear scabbard.
color_tree=KDTree(len(pos));available=0
for i,p in enumerate(pos):
    if swords[i]:continue
    if p[2]<-.08 and p[1]>1.1 and line[i]<.09:continue
    color_tree.insert(Vector(p),i);available+=1
color_tree.balance()
body_colors=np.full((len(ps),4),255,dtype=np.uint8)
base_image=raw.j['images'][raw.j['textures'][raw.j['materials'][rp.get('material',0)]['pbrMetallicRoughness']['baseColorTexture']['index']]['source']]
v=raw.j['bufferViews'][base_image['bufferView']];start=v.get('byteOffset',0)
with tempfile.TemporaryDirectory() as td:
    imgfile=Path(td)/'base.png';imgfile.write_bytes(raw.b[start:start+v['byteLength']]);image=bpy.data.images.load(str(imgfile),check_existing=False);image.colorspace_settings.name='Non-Color'
    iw,ih=image.size;pixels=np.empty(iw*ih*4,dtype=np.float32);image.pixels.foreach_get(pixels);pixels=pixels.reshape(ih,iw,4)
    for i,p in enumerate(source_corners):
        if mats[i//3]!=1:continue
        near=color_tree.find_n(Vector(p),8);rgb=np.zeros(3);total=0
        for co,vi,d in near:
            u,v=uv[vi];color=pixels[min(ih-1,max(0,int((1-v)*ih))),min(iw-1,max(0,int(u*iw))),:3];weight=1/(d+.008)**2;rgb+=color*weight;total+=weight
        rgb/=max(total,1e-9);rgb=np.where(rgb<=.04045,rgb/12.92,((rgb+.055)/1.055)**2.4)
        body_colors[i,:3]=np.clip(np.rint(rgb*255),0,255)
    bpy.data.images.remove(image)
attrs={'POSITION':out.add(ps,'VEC3'),'NORMAL':out.add(ns,'VEC3'),'TEXCOORD_0':out.add(uvs,'VEC2'),'JOINTS_0':out.add(js,'VEC4',5123),'WEIGHTS_0':out.add(ws,'VEC4')}
ci=out.add(body_colors,'VEC4',5121);out.j['accessors'][ci]['normalized']=True;attrs['COLOR_0']=ci
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
frame=out.j['asset']['extras']['gripFrame'];frame['bladeRootInSword']=list(gp+Vector((0,.115,0))/unit);frame['bladeTipInSword']=list(gp+Vector((0,.806,0))/unit)
# Copy the approved right-hand geometry and weights, retaining its true right
# handedness. Vertex colors give this character its fingerless armored glove.
hp=ref.j['meshes'][0]['primitives'][-1]
hand_attrs={k:acc(v)for k,v in hp['attributes'].items() if k!='TEXCOORD_0'}
ibms=[Matrix(a.reshape(4,4)).transposed()for a in ref.array(skin['inverseBindMatrices'])]
H=target['RightHand'];S=target['Sword'];center=S@Vector(ref.j['asset']['extras']['gripFrame']['gripPointInSword'])
a=(S.to_quaternion()@Vector((0,1,0))).normalized();f=(H.to_quaternion()@Vector((0,1,0))).normalized();hx=(f-a*f.dot(a)).normalized();hz=hx.cross(a).normalized();colors=[]
for v in ref.array(hp['attributes']['POSITION']):
    q=Vector(v)-center;cx,cy,cz=q.dot(hx),q.dot(a),q.dot(hz)
    color=(.018,.017,.016,1)
    if cz<-.008 and cx<.012:color=(.72,.47,.31,1)
    elif cz>.014 and -.05<cx<.005 and abs(cy)<.03:color=(.28,.30,.34,1)
    colors.append(color)
hand_attrs['COLOR_0']=out.add(colors,'VEC4');hm=len(out.j['materials']);out.j['materials'].append({'name':'Role4 armored silver glove','doubleSided':True,'pbrMetallicRoughness':{'baseColorFactor':[1,1,1,1],'metallicFactor':.18,'roughnessFactor':.65}})
prims.append({'attributes':hand_attrs,'indices':acc(hp['indices']),'material':hm})
out.j['meshes']=[{'name':'Role4 repaired skin with original right-hand sword motions','primitives':prims}]
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
assert output.stat().st_size<5_000_000,output.stat().st_size
bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(output));bpy.ops.wm.save_as_mainfile(filepath=str(blend))
meta={'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'approvedRoleSha256':hashlib.sha256(approved.read_bytes()).hexdigest(),'outputSha256':hashlib.sha256(output.read_bytes()).hexdigest(),
 'license':'User confirmed Role4.glb authorized for this game and modification in chat, 2026-11-05','blenderVersion':bpy.app.version_string,
 'sourceUnrigged':False,'sourceHeight':source_height,'sourceClips':[a.get('name') for a in raw.j.get('animations',[])],'removedBackSwordTriangles':int(remove_sword.sum()),'removedRightHandAndBridgeTriangles':int((remove_hand&~remove_sword).sum()),'removedLeftWebTriangles':int(left_web.sum()),'removedUnderarmWebTriangles':int(underarm_web.sum()),'removedRearWeaponFragments':fragment_info,'cappedFaces':len(filled),
 'removedRepairSlivers':removed_slivers,'finalIndependentCaps':final_caps,'finalBoundaryEdges':final_boundaries,'clips':[a['name']for a in out.j['animations']],'allSixAnimationsSampleExact':True,'forwardGripPreserved':True,'approvedSwordSha256':hashlib.sha256(sword_file.read_bytes()).hexdigest(),'weaponPrimitiveRange':[weapon_primitive_start,weapon_primitive_end],'headYawCorrectionDegrees':head_yaw_degrees,'headForwardVertexIndex':int(np.argmin(np.linalg.norm(np.array(ps)-np.array(fits['Head']@head_marker_corrected),axis=1))),'bodyTriangles':len(mats),'modelBytes':output.stat().st_size}
report.write_text(json.dumps(meta,indent=2)+'\n',encoding='utf-8');print(json.dumps(meta))
