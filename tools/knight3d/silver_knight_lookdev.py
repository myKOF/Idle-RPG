"""Static armor study. Leaves the six approved-to-review action sources intact.

The weapon has its own grip axis; a neutral wrist no longer has to point along
the blade. This module is deliberately not an animation replacement.
"""
import math
import bpy
from mathutils import Vector,Matrix,Quaternion

def reshape(ctx,rest,rig):
    mesh,shell,box=ctx['mesh'],ctx['shell'],ctx['box']
    steel,edge,dark,cloth,leather=[ctx[n] for n in ['steel','edge','darkmetal','cloth','leather']]
    burnished=ctx['hair'];burnished.name='07 | burnished silver cuirass'
    for mat,rgb,metal,rough in [
        (steel,(.34,.345,.35),.62,.47),(edge,(.56,.565,.57),.60,.42),
        (burnished,(.255,.265,.275),.58,.50),
        (dark,(.14,.145,.15),.25,.62),(cloth,(.070,.058,.045),0,.92),
        (leather,(.145,.090,.052),0,.77)]:
        mat.diffuse_color=(*rgb,1)
        bs=mat.node_tree.nodes.get('Principled BSDF')
        bs.inputs['Base Color'].default_value=(*rgb,1)
        bs.inputs['Metallic'].default_value=metal
        bs.inputs['Roughness'].default_value=rough

    weapon_names={'leather sword grip','small sword pommel','slender sword crossguard','long narrow steel blade'}
    keep=[]
    for obj,bone in ctx['parts']:
        if obj.name in weapon_names:
            if 'crossguard' in obj.name:
                for v in obj.data.vertices:v.co.x=-.45+(v.co.x+.45)*.55
            keep.append((obj,'weapon.R'))
        elif (bone=='head' and 'neck' not in obj.name) or bone.startswith('foot.') or (bone.startswith('hand.') and 'cuff' not in obj.name):
            # Keep the helmet, hand and foot foundation. Quiet the white boot bars.
            if 'sabaton plate' in obj.name:obj.data.materials[0]=steel
            keep.append((obj,bone))
        else:bpy.data.objects.remove(obj,do_unlink=True)
    ctx['parts'][:]=keep
    bpy.context.view_layer.objects.active=rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bone=rig.data.edit_bones.new('weapon.R')
    bone.head=(-.45,0,1.32);bone.tail=(-.45,0,1.16)
    bone.parent=rig.data.edit_bones['hand.R']
    bpy.ops.object.mode_set(mode='OBJECT')
    rest['weapon.R']=((-.45,0,1.32),(-.45,0,1.16),'hand.R')

    def form(name,rings,mat,bone,cx=0,crest=0,count=20):
        o=shell(name,rings,mat,bone,count,0)
        # Compute width before translating: translating during the scan makes the
        # opposite limb receive a different crest profile.
        width=max(abs(v.co.x) for v in o.data.vertices)
        for v in o.data.vertices:
            if v.co.y<0:v.co.y-=crest*max(0,1-abs(v.co.x)/width)**2
            v.co.x+=cx
        for p in o.data.polygons[:-2]:p.use_smooth=True
        return o

    # The silver harness sits over a readable warm charcoal arming garment.
    form('lookdev fitted arming garment',[(1.43,.205,.118,0),(1.68,.218,.13,0),
        (1.98,.272,.142,0),(2.20,.260,.125,0)],cloth,'chest',count=16)
    torso=form('lookdev anatomical breastplate',[(1.69,.202,.126,-.004),
        (1.79,.235,.151,-.004),(1.94,.279,.169,-.004),(2.06,.292,.171,0),
        (2.16,.272,.144,.005),(2.235,.193,.105,.009),(2.25,.105,.082,.006)],
        burnished,'chest',crest=.020,count=24)
    # Mild pectoral convexity; avoid a smooth cylindrical barrel or a robot V.
    for v in torso.data.vertices:
        if v.co.y<-.035:
            v.co.y-=.012*math.exp(-((abs(v.co.x)-.13)/.085)**2-((v.co.z-2.06)/.12)**2)
    mesh('lookdev breastplate restrained medial ridge',[(0,-.168,1.77),(-.008,-.194,1.98),
        (0,-.173,2.17),(.008,-.194,1.98)],[(0,1,2,3)],steel,'chest')
    form('lookdev curved lower breastplate',[(1.565,.204,.137,0),(1.65,.219,.145,0),
        (1.73,.230,.155,-.004),(1.79,.229,.151,-.006)],burnished,'chest',crest=.016,count=20)
    for j,z in enumerate([1.50,1.555]):
        form('lookdev close waist fauld '+str(j),[(z-.015,.222,.145,0),
            (z+.039,.226,.148,0)],steel,'pelvis',count=16)
    form('lookdev leather waist girdle',[(1.48,.229,.150,0),(1.535,.229,.150,0)],leather,'pelvis',count=16)
    box('lookdev iron belt clasp',(0,-.160,1.508),(.063,.014,.041),dark,'pelvis',.003)
    form('lookdev short mail skirt',[(1.175,.252,.155,.012),(1.32,.270,.162,.012),
        (1.48,.225,.141,.005)],cloth,'pelvis',count=20)
    form('lookdev low gorget',[(2.208,.128,.099,0),(2.265,.102,.080,0),
        (2.292,.081,.072,0)],steel,'chest',count=20)
    form('lookdev neck in arming collar',[(2.26,.069,.067,0),(2.41,.066,.067,0)],ctx['skin'],'head',count=16)

    # A strap conforms to the back curvature instead of disappearing inside it.
    vv=[]
    for j in range(8):
        t=j/7;z=2.17-.43*t;xx=-.215+.355*t
        for off in [-.020,.020]:
            x=xx+off;rx=.29 if z>1.88 else .24
            y=.17*math.sqrt(max(.12,1-(x/rx)**2))+.012
            vv.append((x,y,z))
    mesh('lookdev continuous leather back strap',vv,[(j*2,j*2+1,j*2+3,j*2+2) for j in range(7)],leather,'chest')

    for side,sign in [('R',-1),('L',1)]:
        ua,fa,hand='upper_arm.'+side,'forearm.'+side,'hand.'+side
        ctx['sphere']('lookdev padded elbow sleeve '+side,(sign*.42,0,1.79),
            (.065,.068,.077),cloth,fa,12)
        # Low shoulder cap follows the sloping clavicle; it does not rise beside
        # the helmet. The smaller lames cover the outside of a hanging upper arm.
        profiles=[(.222,2.245,.074),(.310,2.258,.112),(.416,2.217,.137),(.508,2.123,.113)]
        vv=[];ny=9
        for x,z,depth in profiles:
            for k in range(ny):
                q=-1.43+2.86*k/(ny-1)
                vv.append((sign*(x-.025*math.sin(q)**2),depth*math.sin(q),z-.115*(1-math.cos(q))))
        ff=[(j*ny+k,(j+1)*ny+k,(j+1)*ny+k+1,j*ny+k+1) for j in range(3) for k in range(ny-1)]
        mesh('lookdev sculpted center low shoulder cap '+side,vv,ff,steel,'chest',.003,True)
        for j,z in enumerate([2.095,2.025]):
            vv=[];nc=12
            for zz,rx,ry in [(z+.040,.112-j*.008,.128-j*.007),(z-.026,.108-j*.008,.123-j*.007)]:
                for k in range(nc):
                    q=-1.65+3.3*k/(nc-1)
                    vv.append((sign*(.408+rx*math.cos(q)),ry*math.sin(q),zz-.025*math.cos(q)))
            mesh('lookdev sculpted center shoulder lame '+side+str(j),vv,
                [(k,k+1,k+1+nc,k+nc) for k in range(nc-1)],steel,ua,.003,True)
        form('lookdev upper sleeve '+side,[(1.79,.072,.073,0),(1.98,.089,.087,0),
            (2.14,.097,.094,0)],cloth,ua,sign*.415,count=16)
        form('lookdev fitted rerebrace '+side,[(1.84,.076,.077,0),(1.98,.093,.090,0),
            (2.075,.094,.091,0)],steel,ua,sign*.415,crest=.008,count=18)
        form('lookdev elbow arming sleeve '+side,[(1.72,.065,.068,0),(1.86,.072,.071,0)],cloth,fa,sign*.42,count=16)
        # An outer elbow cup, not a closed metal tube with a visible end-disc.
        vv=[];nc=11
        for z,rx,ry in [(1.735,.063,.071),(1.79,.081,.089),(1.845,.069,.075)]:
            for k in range(nc):
                q=-1.75+3.5*k/(nc-1)
                vv.append((sign*(.42+rx*math.cos(q)),ry*math.sin(q)-.006,z))
        mesh('lookdev sculpted center elbow cup '+side,vv,
            [(j*nc+k,j*nc+k+1,(j+1)*nc+k+1,(j+1)*nc+k) for j in range(2) for k in range(nc-1)],
            steel,fa,.003,True)
        # Small leaf-shaped wing, rather than an exposed circular bearing.
        mesh('lookdev couter leaf '+side,[(sign*.448,-.012,1.844),(sign*.522,.010,1.803),
            (sign*.463,.012,1.726),(sign*.420,-.025,1.774)],[(0,1,2,3)],steel,fa,.003)
        form('lookdev tapered forearm plate '+side,[(1.38,.055,.061,-.004),
            (1.46,.064,.069,-.003),(1.59,.078,.082,0),(1.725,.076,.079,0)],steel,fa,sign*.445,crest=.010,count=20)
        form('lookdev fitted gauntlet cuff '+side,[(1.328,.058,.061,0),
            (1.39,.065,.068,0)],steel,hand,sign*.45,count=16)

        thigh,shin='thigh.'+side,'shin.'+side
        cx=sign*.17
        form('lookdev fitted thigh hose '+side,[(.79,.078,.081,0),(1.12,.107,.104,0),
            (1.43,.122,.112,0)],cloth,thigh,cx,count=16)
        form('lookdev cuisse anatomical plate '+side,[(.83,.076,.084,0),(.95,.090,.099,0),
            (1.15,.112,.113,0),(1.34,.118,.110,0)],steel,thigh,cx,crest=.009,count=20)
        # Broad tapered tassets: one main curved panel and one upper overlap,
        # instead of a white stack of narrow horizontal boxes.
        for j,(top,bottom) in enumerate([(1.435,1.315),(1.365,1.175)]):
            vv=[];nc=9
            for z,width in [(top,.118),(bottom,.096)]:
                for k in range(nc):
                    u=-1+2*k/(nc-1)
                    zz=z-.027*(1-u*u) if z==bottom else z
                    vv.append((cx+width*u,-.158-.024*(1-u*u),zz))
            mesh('lookdev curved hip plate tasset '+side+str(j),vv,
                [(k,k+1,k+1+nc,k+nc) for k in range(nc-1)],steel,'pelvis' if j==0 else thigh,.003,True)
        form('lookdev knee arming sleeve '+side,[(.705,.064,.071,0),(.86,.074,.074,0)],cloth,shin,sign*.18,count=16)
        form('lookdev shaped poleyn '+side,[(.705,.063,.077,-.006),(.785,.086,.096,-.012),
            (.86,.073,.080,-.006)],steel,shin,sign*.18,crest=.014,count=18)
        mesh('lookdev poleyn modest leaf '+side,[(sign*.212,-.033,.841),(sign*.287,-.015,.79),
            (sign*.228,-.020,.732),(sign*.190,-.051,.775)],[(0,1,2,3)],steel,shin,.003)
        form('lookdev fitted greave '+side,[(.16,.055,.063,.003),(.28,.062,.071,.005),
            (.45,.079,.089,.009),(.59,.088,.094,.008),(.72,.075,.080,0)],steel,shin,sign*.18,crest=.012,count=20)

    rig['design']='Revision 5 static armor study: low shoulders, natural wrists, separate weapon grip'
    rig['animation_status']='Frozen: the prior six-action assets are untouched'
    return rest,rig

def pose(rig,rest,clip,t):
    # The established leg stance is retained only as a static display foundation.
    import importlib.util
    from pathlib import Path
    spec=importlib.util.spec_from_file_location('frozen_knight_motion',Path(__file__).with_name('silver_knight_motion.py'))
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    module.pose(rig,rest,'idle',0)
    def absolute(name,head,R):
        bone=rig.data.bones[name]
        rig.pose.bones[name].matrix=Matrix.Translation(head)@R.to_4x4()@Matrix.Translation(-bone.head_local)@bone.matrix_local
        bpy.context.view_layer.update()
    def segment(name,head,tail,roll=0):
        b=rig.data.bones[name];d=(tail-head).normalized()
        q=(b.tail_local-b.head_local).normalized().rotation_difference(d)
        if roll:q=Quaternion(d,roll)@q
        absolute(name,head,q.to_matrix())
        return q
    head=rig.pose.bones['head']
    orientation=head.matrix.to_3x3()@rig.data.bones['head'].matrix_local.to_3x3().inverted()
    absolute('head',head.head.copy()-Vector((0,0,.055)),orientation)
    errors={}
    for side,sign,target in [('R',-1,Vector((-.49,-.39,1.14))),('L',1,Vector((.49,-.38,1.20)))]:
        shoulder=rig.pose.bones['upper_arm.'+side].head.copy()
        pole=shoulder+Vector((sign*.10,.28,-.48))
        elbow,wrist=module.two_bone(shoulder,target,.4418,.4211,pole)
        segment('upper_arm.'+side,shoulder,elbow)
        segment('forearm.'+side,elbow,wrist)
        d=(wrist-elbow).normalized()
        q=Vector((0,0,-1)).rotation_difference(d)
        if side=='R':
            wanted=Vector((.73,-.34,.59));wanted=(wanted-d*wanted.dot(d)).normalized()
            current=q@Vector((1,0,0))
        else:
            wanted=Vector((0,-1,0));wanted=(wanted-d*wanted.dot(d)).normalized()
            current=q@Vector((0,-1,0))
        roll=math.atan2(d.dot(current.cross(wanted)),current.dot(wanted))
        q=segment('hand.'+side,wrist,wrist+d*.16,roll)
        if side=='R':
            grip=wrist+q@Vector((0,-.008,-.088))
            segment('weapon.R',grip,grip+wanted*.16)
        errors[side]=(wrist-target).length
    rig['static_wrist_target_miss']=max(errors.values())
    return errors
