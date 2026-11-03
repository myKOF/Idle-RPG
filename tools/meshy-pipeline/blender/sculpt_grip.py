"""Blender: replace the damaged hand with a closed anatomical grip mesh.
blender -b --python sculpt_grip.py -- input.glb output.glb source.blend report.json
Rig, animation buffers and sword blade shape stay intact; repair right hand/bracer.
"""
import bpy
import bmesh
import math
import json
import struct
import hashlib
import sys
import tempfile
from pathlib import Path
import numpy as np
from mathutils import Matrix,Vector

class Glb:
    def __init__(self,file):
        self.raw=Path(file).read_bytes();n=struct.unpack_from('<I',self.raw,12)[0]
        self.j=json.loads(self.raw[20:20+n]);self.b=bytearray(self.raw[28+n:])
    def array(self,i):
        a=self.j['accessors'][i];v=self.j['bufferViews'][a['bufferView']]
        k={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}[a['type']]
        d=np.dtype({5121:'u1',5123:'<u2',5125:'<u4',5126:'<f4'}[a['componentType']])
        return np.ndarray((a['count'],k),dtype=d,buffer=self.b,offset=v.get('byteOffset',0)+a.get('byteOffset',0),strides=(v.get('byteStride',k*d.itemsize),d.itemsize)).copy()
    def add(self,vs,kind,component=5126):
        a=np.array(vs,dtype={5126:'<f4',5123:'<u2',5125:'<u4'}[component])
        if a.ndim==1:a=a[:,None]
        while len(self.b)%4:self.b.append(0)
        vi=len(self.j['bufferViews']);self.j['bufferViews'].append({'buffer':0,'byteOffset':len(self.b),'byteLength':a.nbytes});self.b.extend(a.tobytes())
        item={'bufferView':vi,'componentType':component,'count':len(a),'type':kind}
        if kind=='VEC3' and component==5126:item.update(min=a.min(0).tolist(),max=a.max(0).tolist())
        ai=len(self.j['accessors']);self.j['accessors'].append(item);return ai
    def save(self,file):
        self.j['buffers']=[{'byteLength':len(self.b)}];js=json.dumps(self.j,separators=(',',':')).encode();js+=b' '*(-len(js)%4);b=self.b+b'\0'*(-len(self.b)%4)
        Path(file).write_bytes(struct.pack('<III',0x46546c67,2,28+len(js)+len(b))+struct.pack('<II',len(js),0x4e4f534a)+js+struct.pack('<II',len(b),0x004e4942)+b)

src,dst,blend,report=map(Path,sys.argv[sys.argv.index('--')+1:])
g=Glb(src);old_binary=bytes(g.b);old_animation=json.dumps(g.j['animations'],sort_keys=True)
skin=g.j['skins'][0];names=[g.j['nodes'][i]['name'] for i in skin['joints']]
rh=names.index('RightHand');sw=names.index('Sword');rf=names.index('RightForeArm')
ibm=[Matrix(m.reshape((4,4))).transposed() for m in g.array(skin['inverseBindMatrices'])]
W=ibm[rh].inverted();S=ibm[sw].inverted()
wrist=W.translation
hand_forward=(W.to_quaternion()@Vector((0,1,0))).normalized()
axis=(S.to_quaternion()@Vector((0,1,0))).normalized()
X=(hand_forward-axis*hand_forward.dot(axis)).normalized()
Z=X.cross(axis).normalized()
basis=Matrix((X,axis,Z)).transposed()
center=wrist+hand_forward*.083+Z*.021
inv_basis=basis.inverted()
wrist_local=inv_basis@(wrist-center)
def world(p):return center+basis@Vector(p)

# Measure the actual leather shaft in the source sword frame.
weapon_primitives=[];shaft=[]
for p in g.j['meshes'][0]['primitives']:
    js=g.array(p['attributes']['JOINTS_0']);ws=g.array(p['attributes']['WEIGHTS_0'])
    if np.all(js[:,0]==sw) and np.all(ws[:,0]>.999):
        weapon_primitives.append(p)
        if 'TEXCOORD_0' in p['attributes']:
            for v in g.array(p['attributes']['POSITION']):
                q=ibm[sw]@Vector(v)
                if -.02<q.y/100<.065:shaft.append(q/100)
shaft=np.asarray(shaft)
shaft_center=np.array([(shaft[:,0].min()+shaft[:,0].max())/2,0.0,(shaft[:,2].min()+shaft[:,2].max())/2])
radius_x=float((shaft[:,0].max()-shaft[:,0].min())/2)
radius_z=float((shaft[:,2].max()-shaft[:,2].min())/2)
original_shaft_radii=[radius_x,radius_z]
shaft_center=np.array([.053,0,.005])
radius_x=radius_z=radius=.014

bpy.ops.wm.read_factory_settings(use_empty=True)
parts=[]
def object_mesh(name,vs,fs):
    me=bpy.data.meshes.new(name);me.from_pydata([world(v) for v in vs],[],fs);me.update()
    bm0=bmesh.new();bm0.from_mesh(me);bmesh.ops.recalc_face_normals(bm0,faces=list(bm0.faces));bm0.to_mesh(me);bm0.free()
    ob=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(ob);parts.append(ob);return ob

# Lofted palm, narrowed at the wrist and broad across the metacarpal heads.
vs=[];fs=[];rings=20
wx,wy,wz=wrist_local
sections=[(wx-.014,wy-.012,wz,.022,.014),(wx,wy,wz,.025,.015),
          (wx*.65,wy*.70,wz,.032,.018),(wx*.3,wy*.25,-.025,.041,.020),
          (-.004,0,-.025,.043,.017),(.006,0,-.025,.038,.014)]
for x,y,z,wide,thick in sections:
    for i in range(rings):
        a=i*math.tau/rings;vs.append((x,y+wide*math.cos(a),z+thick*math.sin(a)))
for k in range(len(sections)-1):
    for i in range(rings):fs.append((k*rings+i,k*rings+(i+1)%rings,(k+1)*rings+(i+1)%rings,(k+1)*rings+i))
fs.append(tuple(reversed(range(rings))));fs.append(tuple(range((len(sections)-1)*rings,len(vs))))
object_mesh('Palm and wrist transition',vs,fs)

def tube(name,points,radii,sides=12):
    vs=[];fs=[]
    for i,p in enumerate(points):
        p=Vector(p);d=Vector(points[min(i+1,len(points)-1)])-Vector(points[max(0,i-1)])
        d.normalize();a=d.cross(Vector((0,1,0)))
        if a.length<.01:a=d.cross(Vector((0,0,1)))
        a.normalize();b=d.cross(a).normalized()
        for k in range(sides):vs.append(p+(a*math.cos(k*math.tau/sides)+b*math.sin(k*math.tau/sides))*radii[i])
    for i in range(len(points)-1):
        for k in range(sides):fs.append((i*sides+k,i*sides+(k+1)%sides,(i+1)*sides+(k+1)%sides,(i+1)*sides+k))
    fs.append(tuple(reversed(range(sides))));fs.append(tuple(range((len(points)-1)*sides,len(vs))))
    return object_mesh(name,vs,fs)

finger_params=[('Index',.029,.0085,135),('Middle',.010,.009,145),('Ring',-.010,.0082,140),('Little',-.028,.0072,125)]
contact_samples=[]
for name,y,thick,end in finger_params:
    r=radius+thick+.0006
    angles=np.linspace(-100,end,22)
    points=[];radii=[]
    for i,a in enumerate(angles):
        t=i/(len(angles)-1);a=math.radians(a)
        # Slight knuckle swell and narrowing towards the fingertip.
        skin_r=thick*(1-.15*t)+.0005*math.sin(t*math.pi*3)**2
        points.append((r*math.cos(a),y,r*math.sin(a)))
        radii.append(skin_r)
    # Round fingertip rather than ending in the original pointed/folded mesh.
    last=Vector(points[-1]);tangent=(last-Vector(points[-2])).normalized()
    points.extend([last+tangent*thick*.45,last+tangent*thick*.7])
    radii.extend([thick*.5,.0008])
    tube(name+' three phalanges wrapped around handle',points,radii)
    contact_samples.append({'finger':name,'axisY':y,'centerRadius':r,'radius':thick})

# Opposed thumb crosses the outside of the index/middle fingers.
controls=[Vector((-.030,.013,-.024)),Vector((-.010,.062,-.005)),Vector((.026,.042,.043)),Vector((-.004,.020,.043))]
thumb_points=[];thumb_r=[]
for i in range(30):
    t=i/29;u=1-t;a,b,c,d=controls
    thumb_points.append(a*u**3+b*(3*u*u*t)+c*(3*u*t*t)+d*t**3)
    thumb_r.append(.013*(1-t)+.008*t)
thumb_points.extend([thumb_points[-1]+(thumb_points[-1]-thumb_points[-2]).normalized()*.003])
thumb_r.append(.001)
tube('Opposed thumb closing over index',thumb_points,thumb_r)

# Union the sculpt into one smooth, closed surface. All fingers retain separate
# silhouettes; the palm web joins them naturally at their roots.
bpy.ops.object.select_all(action='DESELECT')
for ob in parts:ob.select_set(True)
bpy.context.view_layer.objects.active=parts[0]
bpy.ops.object.join();hand=bpy.context.object
mod=hand.modifiers.new('Watertight hand sculpt','REMESH');mod.mode='VOXEL';mod.voxel_size=.0016;mod.use_smooth_shade=True
bpy.ops.object.modifier_apply(modifier=mod.name)
mod=hand.modifiers.new('Surface relaxation','SMOOTH');mod.factor=.40;mod.iterations=3
bpy.ops.object.modifier_apply(modifier=mod.name)

mod=hand.modifiers.new('Game hand surface budget','DECIMATE');mod.ratio=.12;mod.use_collapse_triangulate=True
bpy.ops.object.modifier_apply(modifier=mod.name)

# Carve the actual shaft clearance instead of merely asserting bone attachment.
vs=[];fs=[];sides=48
clearance=.0005
for y in (-.18,.14):
    for i in range(sides):
        a=i*math.tau/sides;vs.append(((radius_x+clearance)*math.cos(a),y,(radius_z+clearance)*math.sin(a)))
for i in range(sides):fs.append((i,(i+1)%sides,sides+(i+1)%sides,sides+i))
fs.extend([tuple(reversed(range(sides))),tuple(range(sides,2*sides))])
cutter=object_mesh('Measured oval shaft clearance',vs,fs)
bpy.context.view_layer.objects.active=hand
mod=hand.modifiers.new('Palm and finger shaft contact clearance','BOOLEAN');mod.operation='DIFFERENCE';mod.solver='EXACT';mod.object=cutter
bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(cutter,do_unlink=True)
bm=bmesh.new();bm.from_mesh(hand.data);bmesh.ops.triangulate(bm,faces=list(bm.faces));bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.normal_update()
closed=not any(e.is_boundary for e in bm.edges)
assert closed,'Hand sculpt must be watertight'
bm.to_mesh(hand.data);bm.free()
hand.data.update()
# Keep the decimated shaft cavity outside the finished leather winding.
for v in hand.data.vertices:
    q=inv_basis@(v.co-center);radial=math.hypot(q.x,q.z)
    if -.18<q.y<.14 and radial<radius+clearance and radial>.001:
        q.x*= (radius+clearance)/radial;q.z*= (radius+clearance)/radial;v.co=world(q)
hand.data.update()

# Select an existing clean skin texel, preserving the character's skin tone.
body_primitive=g.j['meshes'][0]['primitives'][0]
ja=g.array(body_primitive['attributes']['JOINTS_0']);wa=g.array(body_primitive['attributes']['WEIGHTS_0']);uv=g.array(body_primitive['attributes']['TEXCOORD_0'])
skin_uv=uv[((ja==rh)*wa).sum(1)>.99]
mat_index=body_primitive['material'];mat=g.j['materials'][mat_index]
tex=g.j['textures'][mat['pbrMetallicRoughness']['baseColorTexture']['index']]
im=g.j['images'][tex['source']];v=g.j['bufferViews'][im['bufferView']]
with tempfile.TemporaryDirectory() as td:
    f=Path(td)/'skin.png';f.write_bytes(g.b[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']])
    image=bpy.data.images.load(str(f));pixels=np.asarray(image.pixels[:]).reshape((image.size[1],image.size[0],4))
    colors=[]
    for u,v0 in skin_uv:
        c=pixels[min(image.size[1]-1,int(v0*image.size[1])),min(image.size[0]-1,int(u*image.size[0])),:3]
        colors.append(c)
    colors=np.asarray(colors);mask=(colors[:,0]>colors[:,1])&(colors[:,1]>colors[:,2])&(colors[:,0]>.45)
    median=np.median(colors[mask],axis=0);score=np.linalg.norm(colors-median,axis=1)
    chosen_uv=skin_uv[int(np.argmin(score))].tolist()
    bpy.data.images.remove(image)

removed=0
for p in g.j['meshes'][0]['primitives']:
    j=g.array(p['attributes']['JOINTS_0']);w=g.array(p['attributes']['WEIGHTS_0'])
    if np.all(j[:,0]==sw):continue
    faces=g.array(p['indices']).reshape((-1,3))
    hand_weight=((j==rh)*w).sum(1)
    tc=g.array(p['attributes']['TEXCOORD_0'])
    px=np.clip((tc[:,0]*pixels.shape[1]).astype(int),0,pixels.shape[1]-1);py=np.clip((tc[:,1]*pixels.shape[0]).astype(int),0,pixels.shape[0]-1)
    col=pixels[py,px,:3];is_skin=(col[:,0]>.60)&(col[:,1]>.40)&(col[:,0]>col[:,1])&(col[:,1]>col[:,2])
    hp=np.array([list(W.inverted()@Vector(v)) for v in g.array(p['attributes']['POSITION'])])
    armor=(hp[:,1]<2.0)&(~is_skin)&(hand_weight>.02)
    kill=(hand_weight>.70)&(~armor)
    keep=~(kill[faces].any(1)|((hand_weight[faces]>.05)&is_skin[faces]&(hp[faces,1]>.5)).any(1))
    if armor.any():
        j[armor]=[rf,0,0,0];w[armor]=[1,0,0,0]
        for key,values,fmt in [('JOINTS_0',j,'H'),('WEIGHTS_0',w,'f')]:
            acc=g.j['accessors'][p['attributes'][key]];view=g.j['bufferViews'][acc['bufferView']];offset=view.get('byteOffset',0)+acc.get('byteOffset',0);stride=view.get('byteStride',struct.calcsize(fmt)*4)
            for row in np.where(armor)[0]:struct.pack_into('<'+fmt*4,g.b,offset+int(row)*stride,*values[row])
    removed+=int((~keep).sum())
    p['indices']=g.add(faces[keep].reshape(-1),'SCALAR',5123 if g.j['accessors'][p['attributes']['POSITION']]['count']<65536 else 5125)

# Replace the distorted oversized leather shaft with a circular wrapped grip.
# Keep the original guard/pommel metal and the exact existing blade geometry.
for p in weapon_primitives:
    if 'TEXCOORD_0' not in p['attributes']:continue
    positions0=g.array(p['attributes']['POSITION'])
    local0=np.asarray([list(ibm[sw]@Vector(v)/100) for v in positions0])
    idx0=g.array(p['indices']).reshape((-1,3));centers=local0[idx0].mean(1)
    radial=np.linalg.norm((local0[:,[0,2]]-shaft_center[[0,2]]),axis=1)
    leather=(centers[:,1]>-.17)&(centers[:,1]<.085)&(radial[idx0].max(1)<.04)
    p['indices']=g.add(idx0[~leather].reshape(-1),'SCALAR',5123)
# A shallow helical relief gives the grip leather wrapping without a new image.
handle_pos=[];handle_norm=[];handle_idx=[]
qx=S.to_quaternion()@Vector((1,0,0));qz=S.to_quaternion()@Vector((0,0,1))
steps=46;sides=20
for k in range(steps+1):
    y=-.185+k*.28/steps
    for i in range(sides):
        a=i*math.tau/sides;r=radius+.0002*math.cos(a+y*math.tau/.009)
        normal=(qx*math.cos(a)+qz*math.sin(a)).normalized()
        handle_pos.append(list(center+axis*y+normal*r));handle_norm.append(list(normal))
for k in range(steps):
    for i in range(sides):
        a=k*sides+i;b=k*sides+(i+1)%sides;c=(k+1)*sides+(i+1)%sides;d=(k+1)*sides+i
        handle_idx.extend([a,c,b,a,d,c])
leather_mat=len(g.j['materials']);g.j['materials'].append({'name':'Right-hand leather grip repair','pbrMetallicRoughness':{'baseColorFactor':[.035,.019,.011,1],'metallicFactor':0,'roughnessFactor':.9}})
g.j['meshes'][0]['primitives'].append({'attributes':{'POSITION':g.add(handle_pos,'VEC3'),'NORMAL':g.add(handle_norm,'VEC3'),'JOINTS_0':g.add([[sw,0,0,0]]*len(handle_pos),'VEC4',5123),'WEIGHTS_0':g.add([[1,0,0,0]]*len(handle_pos),'VEC4')},'indices':g.add(handle_idx,'SCALAR',5123),'material':leather_mat})
# Translate, without rotating or shortening, the existing sword into the grip.
old_center=S@Vector(shaft_center*100)
weapon_delta=center-old_center
for p in weapon_primitives:
    positions=g.array(p['attributes']['POSITION'])+np.array(weapon_delta)
    p['attributes']['POSITION']=g.add(positions,'VEC3')

positions=[list(v.co) for v in hand.data.vertices]
normals=[list(v.normal) for v in hand.data.vertices]
faces=[list(p.vertices) for p in hand.data.polygons]
hand_joints=[];hand_weights=[]
for p in positions:
    t=(Vector(p)-wrist).dot(hand_forward);k=max(0,min(1,(.020-t)/.035))
    hand_joints.append([rh,rf,0,0]);hand_weights.append([1-k,k,0,0])
attributes={'POSITION':g.add(positions,'VEC3'),'NORMAL':g.add(normals,'VEC3'),
            'TEXCOORD_0':g.add([chosen_uv]*len(positions),'VEC2'),
            'JOINTS_0':g.add(hand_joints,'VEC4',5123),
            'WEIGHTS_0':g.add(hand_weights,'VEC4')}
g.j['meshes'][0]['primitives'].append({'attributes':attributes,'indices':g.add(np.array(faces).reshape(-1),'SCALAR',5123 if len(positions)<65536 else 5125),'material':mat_index})
inverse=S.inverted()
frame={'bladeAxisInSword':[0,1,0],'edgeAxisInSword':[1,0,0],'normalAxisInSword':[0,0,1],
       'gripPointInSword':list(inverse@center),
       'bladeRootInSword':list(inverse@(S@Vector((5.3,11.5,.5))+weapon_delta)),
       'bladeTipInSword':list(inverse@(S@Vector((5.3,85.460672,.5))+weapon_delta)),
       'type':'closed-diagonal-palm-grip','clearanceMeters':clearance,
       'shaftRadiusX':radius_x,'shaftRadiusZ':radius_z,'skinTexelUV':chosen_uv}
g.j['asset'].setdefault('extras',{})['gripFrame']=frame
assert json.dumps(g.j['animations'],sort_keys=True)==old_animation
# Only the right bracer's rigid weights in the appended appearance buffers change.
for anim in g.j['animations']:
    for sampler in anim['samplers']:
        for key in ['input','output']:
            acc=g.j['accessors'][sampler[key]];v=g.j['bufferViews'][acc['bufferView']];a=v.get('byteOffset',0);b=a+v['byteLength'];assert bytes(g.b[a:b])==old_binary[a:b]
g.save(dst)
hand_count=len(positions);hand_tri=len(faces)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(dst));bpy.ops.wm.save_as_mainfile(filepath=str(blend))
result={'inputSha256':hashlib.sha256(Path(src).read_bytes()).hexdigest(),'outputSha256':hashlib.sha256(Path(dst).read_bytes()).hexdigest(),
        'handVertices':hand_count,'handTriangles':hand_tri,'handWatertight':closed,'removedBrokenHandTriangles':removed,
        'existingAnimationsUnchanged':True,'bladeShapeUnchanged':True,'weaponTranslationOnly':list(weapon_delta),
        'fingerContacts':contact_samples,'gripFrame':frame,'blenderVersion':bpy.app.version_string}
Path(report).write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
print(json.dumps(result))
