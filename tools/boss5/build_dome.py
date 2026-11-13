# Stage 1: close the back of the mask with a skull dome, paint its texture from the front-face art, save .blend
import bpy, bmesh, math, sys, os
import numpy as np
from mathutils import Vector
argv=sys.argv[sys.argv.index('--')+1:]
SRC, FRONT, OUTDIR = argv[0], argv[1], argv[2]
DEPTH=float(argv[3]) if len(argv)>3 else 0.5
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
mask=[o for o in bpy.data.objects if o.type=='MESH'][0]
mask.name='Mask'
me=mask.data
ymax=max(v.co.y for v in me.vertices)

# ---------- 1. dome texture (planar projection from the front art) ----------
img=bpy.data.images.load(FRONT); img.colorspace_settings.name='Non-Color'
W,H=img.size
px=np.empty(W*H*4,dtype=np.float32); img.pixels.foreach_get(px); px=px.reshape(H,W,4)   # row0 = bottom (v=0)
alpha=px[...,3]
valid=alpha>0.5
def erode(m,n):
    for _ in range(n):
        m=m&np.roll(m,1,0)&np.roll(m,-1,0)&np.roll(m,1,1)&np.roll(m,-1,1)
    return m
def dilate(m,n):
    for _ in range(n):
        m=m|np.roll(m,1,0)|np.roll(m,-1,0)|np.roll(m,1,1)|np.roll(m,-1,1)
    return m
def fill(col,v,iters=80):
    col=col.copy(); v=v.copy()
    for _ in range(iters):
        if v.all(): break
        acc=np.zeros_like(col); cnt=np.zeros(v.shape)
        for dy in(-1,0,1):
            for dx in(-1,0,1):
                s=np.roll(np.roll(v,dy,0),dx,1); c=np.roll(np.roll(col,dy,0),dx,1)
                acc+=c*s[...,None]; cnt+=s
        nv=(~v)&(cnt>0)
        col[nv]=(acc/np.maximum(cnt,1)[...,None])[nv]; v|=nv
    return col
rgb=px[...,:3].copy()
yy,xx=np.mgrid[0:H,0:W]
X=(xx+0.5)/W*2-1; Z=(yy+0.5)/H*2-1
# horn pixels (dark red/black) above the brows -> remove
horn=(rgb[...,0]<0.62)&(Z>0.09)&valid
horn=dilate(horn,10)
good=erode(valid,5)&~horn
rgb=fill(rgb,good)
# base red = median of strongly red face pixels
red=(rgb[...,0]>0.85)&(rgb[...,1]<0.2)&(Z>-0.2)&(Z<0.5)&good
base=np.median(rgb[red],axis=0); print("BASE RED",base)
def sstep(a,b,x):
    t=np.clip((x-a)/(b-a),0,1); return t*t*(3-2*t)
w=sstep(0.09,0.20,Z)[...,None]
rng=np.random.default_rng(5)
# gentle low-frequency shading on the plain part so it is not flat
g=rng.random((18,18))
def zoom(a,Hn,Wn):
    ys=np.linspace(0,a.shape[0]-1,Hn); xs=np.linspace(0,a.shape[1]-1,Wn)
    t=np.array([np.interp(ys,np.arange(a.shape[0]),a[:,j]) for j in range(a.shape[1])]).T
    return np.array([np.interp(xs,np.arange(a.shape[1]),t[i]) for i in range(Hn)])
n=zoom(g,H,W)
n=(n-n.mean())/(n.std()+1e-6)
plain=np.clip(base[None,None,:]*(1+0.018*n[...,None]),0,1)
out=rgb*w+plain*(1-w)
res=np.concatenate([out,np.ones((H,W,1),dtype=np.float32)],axis=2).astype(np.float32)
os.makedirs(OUTDIR,exist_ok=True)
tex=bpy.data.images.new('boss5_dome_albedo',W,H,alpha=False); tex.colorspace_settings.name='Non-Color'
tex.pixels.foreach_set(res.ravel()); tex.filepath_raw=os.path.join(OUTDIR,'boss5_dome_albedo.png'); tex.file_format='PNG'; tex.save()
np.save(os.path.join(OUTDIR,'base_red.npy'),base)

# ---------- 2. rim contour -> dome ----------
mm=bmesh.new(); mm.from_mesh(me); bmesh.ops.remove_doubles(mm,verts=mm.verts,dist=1e-5); mm.faces.ensure_lookup_table()
cen0=Vector((0,0.2,0.1)); cls={}
for f in mm.faces: cls[f]=1 if f.normal.dot(cen0-f.calc_center_median())>0 else 0
bnd=[e for e in mm.edges if len(e.link_faces)==2 and cls[e.link_faces[0]]!=cls[e.link_faces[1]]]
bset=set(bnd); seen=set(); comps=[]
for e in bnd:
    if e in seen: continue
    st=[e]; seen.add(e); comp=[]
    while st:
        x=st.pop(); comp.append(x)
        for v in x.verts:
            for ne in v.link_edges:
                if ne in bset and ne not in seen: seen.add(ne); st.append(ne)
    comps.append(comp)
def span(c):
    vs={v for e in c for v in e.verts}; zs=[v.co.z for v in vs]; return max(zs)-min(zs)
rimc=max(comps,key=span)
rv=list({v for e in rimc for v in e.verts})
print('RIM verts',len(rv))
zc=0.02
right=sorted([(math.atan2(v.co.z-zc,v.co.x),v.co.x,v.co.y,v.co.z) for v in rv if v.co.x>=-0.02])
right=[r for r in right if -math.pi/2-0.05<=r[0]<=math.pi/2+0.05]
N=72
def contour(th):
    # th in [-pi/2,pi/2] on the +x side, interpolate (x,y,z)
    for i in range(len(right)-1):
        a_,b_=right[i],right[i+1]
        if a_[0]<=th<=b_[0]:
            t=(th-a_[0])/max(b_[0]-a_[0],1e-9)
            return [a_[k]*(1-t)+b_[k]*t for k in (1,2,3)]
    r=min(right,key=lambda q:abs(q[0]-th)); return [r[1],r[2],r[3]]
P=[]
for i in range(N):
    th=2*math.pi*i/N
    if math.cos(th)>=0:
        p=contour(math.atan2(math.sin(th),math.cos(th)))
    else:
        p=contour(math.atan2(math.sin(th),-math.cos(th)))
        p=[-p[0],p[1],p[2]]
    P.append(p)
P=np.array(P)
for _ in range(2):
    P=(np.roll(P,2,0)+np.roll(P,1,0)+P+np.roll(P,-1,0)+np.roll(P,-2,0))/5
c0=P.mean(axis=0); print('c0',c0)
# push the contour out to the mask's real outer skin (the class boundary sits inside the wall)
from mathutils.bvhtree import BVHTree
bvh=BVHTree.FromObject(mask,bpy.context.evaluated_depsgraph_get())
P2=P.copy(); moved=[]
for i in range(N):
    d=Vector((P[i][0]-c0[0],0,P[i][2]-c0[2])); 
    if d.length<1e-6: continue
    d.normalize()
    o=Vector(P[i])-d*0.07; best=0.07; cur=o.copy(); travelled=0
    for _ in range(8):
        loc,nm,idx,dist=bvh.ray_cast(cur,d)
        if loc is None: break
        travelled=(loc-o).dot(d)
        if travelled>0.07+0.08: break
        best=max(best,travelled); cur=loc+d*0.002
    P2[i]=np.array(Vector(P[i])+d*(best-0.07)); moved.append(best-0.07)
print('outer push avg %.3f max %.3f'%(sum(moved)/len(moved),max(moved)))
P=P2
for _ in range(2):
    P=(np.roll(P,2,0)+np.roll(P,1,0)+P+np.roll(P,-1,0)+np.roll(P,-2,0))/5

nrm=Vector((0,1.0,-0.14)).normalized()
K=16
bm=bmesh.new(); rings=[]
skirt=[]
for i in range(N):
    q=P[i]-c0
    skirt.append(bm.verts.new(Vector(c0)+Vector(q)*1.0-nrm*0.12))
rings.append(skirt)
for k in range(K):
    phi=k/K*math.pi/2
    row=[]
    for i in range(N):
        th=2*math.pi*i/N
        e=1.1-0.25*math.sin(th)
        f=math.cos(phi)**e*(1+0.012*math.exp(-phi/0.12))
        q=P[i]-c0
        pos=Vector(c0)+nrm*DEPTH*(math.sin(phi)**0.92)+Vector(q)*f
        row.append(bm.verts.new(pos))
    rings.append(row)
apex=bm.verts.new(Vector(c0)+nrm*DEPTH+Vector((0,0,0.03)))
for k in range(K):
    for i in range(N):
        j=(i+1)%N
        bm.faces.new((rings[k][i],rings[k][j],rings[k+1][j],rings[k+1][i]))
for i in range(N):
    j=(i+1)%N
    bm.faces.new((rings[K][i],rings[K][j],apex))
zc=float(c0[2])
uv=bm.loops.layers.uv.new('UVMap')
for f in bm.faces:
    for l in f.loops:
        c=l.vert.co; l[uv].uv=((c.x+1)/2,(c.z+1)/2)
bmesh.ops.recalc_face_normals(bm,faces=bm.faces)
dm=bpy.data.meshes.new('Dome'); bm.to_mesh(dm); bm.free()
dome=bpy.data.objects.new('Dome',dm); bpy.context.scene.collection.objects.link(dome)
for p in dm.polygons: p.use_smooth=True
# check normals face outward (away from centre)
cen=Vector((0,0.1,zc)); outward=sum(1 for p in dm.polygons if (p.center-cen).dot(p.normal)>0)
print("dome normals outward",outward,"/",len(dm.polygons))
if outward<len(dm.polygons)/2:
    bm=bmesh.new(); bm.from_mesh(dm); bmesh.ops.reverse_faces(bm,faces=bm.faces); bm.to_mesh(dm); bm.free()
# material
dt=bpy.data.images.load(os.path.join(OUTDIR,'boss5_dome_albedo.png'))
mat=bpy.data.materials.new('DomeMat'); mat.use_nodes=True
nt=mat.node_tree; nt.nodes.clear()
out_n=nt.nodes.new('ShaderNodeOutputMaterial'); bs=nt.nodes.new('ShaderNodeBsdfPrincipled'); tn=nt.nodes.new('ShaderNodeTexImage'); tn.image=dt
nt.links.new(tn.outputs['Color'],bs.inputs['Base Color']); nt.links.new(bs.outputs['BSDF'],out_n.inputs['Surface'])
bs.inputs['Metallic'].default_value=0.0; bs.inputs['Roughness'].default_value=0.45
mat.use_backface_culling=False
dm.materials.append(mat)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUTDIR,'stage1.blend'))
