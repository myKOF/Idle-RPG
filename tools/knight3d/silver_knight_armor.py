"""R7: thin medieval plate over genuine MakeHuman anatomy; static lookdev."""
import math
import bpy
import bmesh
from mathutils import Vector

def build(c):
    mesh,tube,skin,material=[c[n] for n in ['mesh','tube','skin','material']]
    rig,body,K,parts=[c[n] for n in ['rig','body','K','parts']]
    steel,edge,shade,cloth,mail,leather,black=[c[n] for n in ['steel','edge','shadowsteel','cloth','mail','leather','black']]
    bvh=c['anatomy_bvh']
    skinmat=material('08 natural face',(.48,.365,.285),0,.73)
    sclera=material('09 quiet eye whites',(.36,.34,.30),0,.52)
    iris=material('10 brown iris',(.055,.033,.020),0,.45)
    c['palette'].extend([skinmat,sclera,iris])
    # MPFB cleans orphan materials during body-part import. Keep the palette
    # swatches alive until the compact material is assembled by the caller.
    for mat in c['palette']:mat.use_fake_user=True

    def plate(name,vv,ff,mat,bone,smooth=True):
        return mesh(name,vv,ff,mat,bone,smooth=smooth,thickness=.0022*K)

    def torso(name,rows,mat,bone,n=28,crest=.006,lift=0):
        vv=[]
        for z,rx,ry,cy in rows:
            origin=Vector((0,cy*K,z*K));sizes=[]
            for direction,fallback in [((1,0,0),rx),((-1,0,0),rx),((0,-1,0),ry),((0,1,0),ry)]:
                hit,normal,idx,dist=bvh.ray_cast(origin,Vector(direction),.35*K)
                sizes.append((max(fallback*K,dist+.010*K) if hit is not None else fallback*K)+lift*K)
            width=max(sizes[:2])
            for j in range(n):
                q=math.tau*j/n
                depth=sizes[2] if math.cos(q)>0 else sizes[3]
                p=origin+Vector((width*math.sin(q),-depth*math.cos(q),0))
                p.y-=crest*K*max(0,math.cos(q))**6
                vv.append(p)
        ff=[(r*n+j,r*n+(j+1)%n,(r+1)*n+(j+1)%n,(r+1)*n+j) for r in range(len(rows)-1) for j in range(n)]
        return plate(name,vv,ff,mat,bone)

    def guard(name,bone,rows,mat,angle=1.95,crest=.004,n=12):
        b=rig.data.bones[bone];axis=(b.tail_local-b.head_local).normalized()
        front=Vector((0,-1,0));front=(front-axis*front.dot(axis)).normalized()
        side=axis.cross(front).normalized();vv=[]
        for t,rx,ry in rows:
            center=b.head_local+(b.tail_local-b.head_local)*t
            for j in range(n+1):
                q=-angle+2*angle*j/n
                d=(side*rx*math.sin(q)+front*ry*math.cos(q))*K
                hit,normal,idx,dist=bvh.ray_cast(center,d.normalized(),.15*K)
                if hit is not None:d=d.normalized()*max(d.length,dist+(.0105 if mat==leather else .007)*K)
                d+=front*crest*K*max(0,math.cos(q))**7
                vv.append(center+d)
        m=n+1;ff=[(r*m+j,r*m+j+1,(r+1)*m+j+1,(r+1)*m+j) for r in range(len(rows)-1) for j in range(n)]
        return plate(name,vv,ff,mat,bone)

    torso('R7 cuirass | continuous tapered breastplate',[
        (.995,.137,.108,.012),(1.06,.148,.117,.010),(1.18,.184,.129,.007),
        (1.27,.190,.124,.002),(1.326,.162,.108,-.003),(1.354,.079,.072,-.013)],steel,'spine_03')
    # One broad lower plate and one leather belt replace the stack of rings.
    torso('R7 plackart | close lower overlap',[
        (.944,.146,.111,.010),(1.005,.140,.113,.010),(1.065,.151,.121,.007)],shade,'spine_03',24,.008,.006)
    belt=torso('R7 belt | dark brown natural waist',[
        (.937,.155,.119,.010),(.978,.151,.116,.009)],leather,'pelvis',24,0,.008)
    tube('R7 belt | small iron buckle',[(x*K,-.133*K,z*K) for x,z in [(-.023,.943),(-.023,.970),(.023,.970),(.023,.943),(-.023,.943)]],.002*K,shade,'pelvis',5)
    torso('R7 arming skirt | split dark underskirt',[
        (.755,.161,.113,.012),(.855,.169,.115,.010),(.94,.149,.108,.010)],cloth,'pelvis',24,0)
    torso('R7 gorget | low fitted collar',[
        (1.326,.101,.086,-.013),(1.376,.071,.064,-.017),(1.395,.059,.057,-.020)],shade,'neck_01',24,0)

    for side,sgn in [('l',1),('r',-1)]:
        ua,fa,thigh,calf='upperarm_'+side,'lowerarm_'+side,'thigh_'+side,'calf_'+side
        sh=rig.data.bones[ua].head_local
        # Shallow roof over the deltoid. A sloping front edge, not a ball/socket.
        vv=[];n=10
        for x,z,depth in [(-.066,.027,.061),(-.008,.071,.100),(.070,.047,.112),(.131,-.041,.079)]:
            for j in range(n+1):
                q=-1.55+3.1*j/n
                p=sh+Vector((sgn*(x-.011*math.sin(q)**2),depth*math.sin(q),z-.040*math.sin(q)**2))*K
                vv.append(p)
        ff=[(r*(n+1)+j,(r+1)*(n+1)+j,(r+1)*(n+1)+j+1,r*(n+1)+j+1) for r in range(3) for j in range(n)]
        if sgn<0:ff=[tuple(reversed(f)) for f in ff]
        cap=plate('R7 spauldron | sloping thin crown '+side,vv,ff,steel,ua)
        # Inner crown remains at the clavicle; outer crown follows the upper arm.
        cap.vertex_groups['upperarm_'+side].remove(list(range(len(cap.data.vertices))))
        groups=[cap.vertex_groups.get(bn) or cap.vertex_groups.new(name=bn) for bn in ['clavicle_'+side,ua]]
        for v in cap.data.vertices:
            out=sgn*(v.co.x-sh.x)/K;w=max(0,min(1,(out+.05)/.15))
            groups[0].add([v.index],1-w,'REPLACE');groups[1].add([v.index],w,'REPLACE')
        # One small lapped outer piece; no circumferential shoulder rings.
        vv=[];nu=10
        for t,radius in [(.27,.086),(.48,.079)]:
            b=rig.data.bones[ua];axis=(b.tail_local-b.head_local).normalized()
            out=Vector((sgn,0,0));out=(out-axis*out.dot(axis)).normalized()
            fwd=out.cross(axis).normalized()
            if fwd.y>0:fwd=-fwd
            center=b.head_local+(b.tail_local-b.head_local)*t
            for j in range(nu+1):
                q=-1.4+2.8*j/nu
                vv.append(center+K*radius*(out*math.cos(q)+fwd*math.sin(q)))
        ff=[(j,j+1,nu+j+2,nu+j+1) for j in range(nu)]
        plate('R7 spauldron | single overlapping outer lame '+side,vv,ff,shade,ua)
        guard('R7 rerebrace | slim open upper-arm plate '+side,ua,[(.42,.056,.058),(.68,.054,.055),(.91,.044,.047)],steel,1.8)
        guard('R7 couter | shallow pointed elbow '+side,fa,[(-.025,.045,.046),(.055,.053,.052),(.14,.042,.044)],shade,1.45,.003,10)
        guard('R7 vambrace | long tapered forearm '+side,fa,[(.12,.046,.049),(.30,.049,.051),(.66,.037,.039),(.95,.027,.030)],steel,2.25,.008)
        guard('R7 wrist | thin flared cuff '+side,fa,[(.84,.033,.035),(1.01,.032,.033)],shade,2.0,.003,10)
        guard('R7 cuisse | long shaped thigh '+side,thigh,[(.07,.073,.074),(.27,.079,.076),(.59,.061,.063),(.90,.043,.047)],steel,2.15,.005)
        guard('R7 poleyn | shallow knee leaf '+side,calf,[(-.06,.044,.046),(.045,.053,.053),(.16,.042,.044)],steel,1.50,.005,10)
        guard('R7 greave | tapered shin ridge '+side,calf,[(.13,.043,.047),(.34,.050,.054),(.61,.042,.045),(.98,.027,.029)],steel,2.5,.007)

        # One broad, nearly flat angular tasset on each hip, with a central split.
        vv=[];nx=8
        for row,(z,w,cy) in enumerate([(.945,.080,-.134),(.865,.084,-.145),(.750,.061,-.146)]):
            for j in range(nx+1):
                u=-1+2*j/nx
                zz=z+(.025*abs(u)**3 if row==2 else 0)
                cx=sgn*(.092+.075*row/2)
                vv.append((K*(cx+w*u),K*(cy+.012*u*u),K*zz))
        ff=[(r*(nx+1)+j,(r+1)*(nx+1)+j,(r+1)*(nx+1)+j+1,r*(nx+1)+j+1) for r in range(2) for j in range(nx)]
        o=plate('R7 tasset | flat tapered thigh-hung plate '+side,vv,ff,steel,'pelvis')
        # A flat hanging plate keeps its shape in this static study. Animation
        # articulation will be assigned after the armor silhouette is approved.
        # Leather support straps remain visible in the articulation gaps.
        guard('R7 knee | brown retaining strap '+side,calf,[(.13,.049,.050),(.19,.047,.049)],leather,math.pi,0,14)
        ankle=rig.data.bones['foot_'+side].head_local
        vv=[];profiles=[(.065,.031,.031),(.008,.041,.062),(-.065,.043,.042),(-.145,.032,.024),(-.207,.011,.014)]
        for yy,w,h in profiles:
            for j in range(9):
                q=math.pi*j/8
                vv.append((ankle.x+K*w*math.cos(q),ankle.y+K*yy,K*(.012+h*math.sin(q))))
        ff=[(r*9+j,r*9+j+1,(r+1)*9+j+1,(r+1)*9+j) for r in range(4) for j in range(8)]
        ff.extend([tuple(reversed(range(9))),tuple(36+j for j in range(9))])
        plate('R7 sabaton | slim pointed foot '+side,vv,ff,steel,'foot_'+side)
        for yy,w,h in profiles[1:4]:
            pts=[(ankle.x+K*w*math.cos(q),ankle.y+K*yy,K*(.014+h*math.sin(q))) for q in [math.pi*j/8 for j in range(9)]]
            tube('R7 sabaton | quiet overlapping toe seam '+side+str(yy),pts,.0015*K,shade,'foot_'+side,5)

    # Retain a real human face under an open sallet, rather than a blank mask.
    head=rig.data.bones['head'];hz=head.head_local.z;hy=head.head_local.y
    d=c['full_anatomy_surface'].copy();o=bpy.data.objects.new('R7 face | MakeHuman human likeness',d);bpy.context.collection.objects.link(o)
    bm=bmesh.new();bm.from_mesh(d)
    bmesh.ops.delete(bm,geom=[v for v in bm.verts if v.co.z<hz-.090*K],context='VERTS')
    bm.to_mesh(d);bm.free();d.materials.clear();d.materials.append(skinmat)
    for f in d.polygons:f.material_index=0;f.use_smooth=True
    bpy.context.view_layer.objects.active=o
    mod=o.modifiers.new('Small-screen face reduction','DECIMATE');mod.ratio=.38
    bpy.ops.object.modifier_apply(modifier=mod.name)
    skin(o,'head');parts.append(o)
    eyes=c['HumanService'].add_mhclo_asset(str(c['Path'](c['a'].makehuman)/'makehuman/data/eyes/low-poly/low-poly.mhclo'),body,
         asset_type='Eyes',subdiv_levels=0,material_type='GAMEENGINE')
    eyes.name='R7 eyes | CC0 MakeHuman low-poly eyes'
    eyes.data.materials.clear()
    for mat in [sclera,iris,black]:eyes.data.materials.append(mat)
    centers=[]
    for sgn in [-1,1]:
        vv=[v.co for v in eyes.data.vertices if v.co.x*sgn>0]
        centers.append(sum(vv,Vector())/len(vv))
    eyez=sum(v.z for v in centers)/2
    for f in eyes.data.polygons:
        center=sum((eyes.data.vertices[vi].co for vi in f.vertices),Vector())/len(f.vertices)
        ec=centers[int(center.x>0)];r=math.hypot(center.x-ec.x,center.z-ec.z)
        f.material_index=(2 if r<.0045*K else 1) if center.y<ec.y and r<.010*K else 0
    parts.append(eyes)
    c['r7_eye_z']=eyez
    # Skull cap is closed at the back and crown; its front edge clears the eyes.
    vv=[];n=28;rows=8;center=Vector((0,hy+.012*K,hz+.075*K))
    for r in range(rows+1):
        t=r/rows
        for j in range(n):
            q=j*math.tau/n;front=max(0,math.cos(q))
            bottom=hz-.040*K+front**.55*max(0,eyez+.035*K-(hz-.040*K))
            limit=math.acos(max(-.99,min(.99,(bottom-center.z)/(.130*K))))
            theta=.025+(limit-.025)*t
            rx=.087*K*math.sin(theta);ry=.105*K*math.sin(theta)
            p=Vector((rx*math.sin(q),center.y-ry*math.cos(q),center.z+.130*K*math.cos(theta)))
            direction=p-center
            if direction.length>1e-5:
                hit,no,idx,dist=bvh.ray_cast(center,direction.normalized(),.25*K)
                if hit is not None and direction.length<dist+.005*K:p=center+direction.normalized()*(dist+.005*K)
            vv.append(p)
    ff=[(r*n+j,r*n+(j+1)%n,(r+1)*n+(j+1)%n,(r+1)*n+j) for r in range(rows) for j in range(n)]
    plate('R7 sallet | open-faced swept silver helmet',vv,ff,steel,'head')
    tube('R7 sallet | rolled brow and cheek opening',vv[-n:]+[vv[-n]],.0022*K,edge,'head',5)
    crest=[vv[r*n] for r in reversed(range(rows+1))]+[vv[r*n+n//2] for r in range(1,rows+1)]
    tube('R7 sallet | shallow median crest',crest,.0017*K,shade,'head',5)
