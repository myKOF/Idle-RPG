"""Adult-proportioned silver knight, based on the supplied silhouette reference.

No shield, oversized head, spherical shoulder armor or cube boots. The fitted
silver sallet is original geometry, without an external model or texture.
"""
import math
import bpy

def build(ctx):
    mesh,box,sphere,link,shell,local_shell=[ctx[n] for n in
        ('mesh','box','sphere','link','shell','local_shell')]
    steel,edge,darkmetal,cloth,leather,skin,hair,black,sclera=[ctx[n] for n in
        ('steel','edge','darkmetal','cloth','leather','skin','hair','black','sclera')]
    rest={
        'root':((0,0,0),(0,0,.3),None),
        'pelvis':((0,0,1.44),(0,0,1.64),'root'),
        'chest':((0,0,1.64),(0,0,2.24),'pelvis'),
        'head':((0,0,2.24),(0,0,2.60),'chest'),
    }
    for side,sign in [('R',-1),('L',1)]:
        rest['upper_arm.'+side]=((sign*.38,0,2.23),(sign*.42,0,1.79),'chest')
        rest['forearm.'+side]=((sign*.42,0,1.79),(sign*.45,0,1.37),'upper_arm.'+side)
        rest['hand.'+side]=((sign*.45,0,1.37),(sign*.45,0,1.21),'forearm.'+side)
        rest['thigh.'+side]=((sign*.16,0,1.44),(sign*.18,0,.79),'pelvis')
        rest['shin.'+side]=((sign*.18,0,.79),(sign*.18,0,.13),'thigh.'+side)
        rest['foot.'+side]=((sign*.18,0,.13),(sign*.18,-.27,.09),'shin.'+side)
    data=bpy.data.armatures.new('Silver Knight | adult articulated skeleton')
    rig=bpy.data.objects.new('KNIGHT_RIG',data)
    bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active=rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    for name,(head,tail,parent) in rest.items():
        bone=data.edit_bones.new(name)
        bone.head,bone.tail=head,tail
        if parent: bone.parent=data.edit_bones[parent]
    bpy.ops.object.mode_set(mode='OBJECT')
    rig.show_in_front=True
    rig['design']='Revision 4: sculpted silver plate harness, fitted sallet, grounded wide guard'
    rig['front']='-Y'
    rig['preview_status']='Revision candidate; not installed into game'
    rig['head_to_body_ratio']=7.5

    # A coherent harness: shaped breastplate, plackart and fitted mail underneath.
    # Dark narrow seams sit behind the plate overlaps, not between separate tubes.
    def armor(name, rings, mat, bone, cx=0, ridge=0, count=16):
        o=shell(name,rings,mat,bone,count,.006)
        for v in o.data.vertices:
            if v.co.y<0:
                width=max(.04,max(abs(q.co.x) for q in o.data.vertices))
                v.co.y-=ridge*max(0,1-abs(v.co.x)/width)**2
            v.co.x+=cx
        for poly in o.data.polygons[:-2]:
            poly.use_smooth=not (('greave' in name or 'cuisse' in name or 'vambrace' in name or 'poleyn' in name) and poly.normal.y<-.45)
        return o
    shell('fitted dark arming doublet',[(1.45,.21,.12,0),(1.80,.27,.14,0),
        (2.12,.315,.155,0),(2.26,.225,.11,0)],cloth,'chest',12,0)
    armor('sculpted silver breastplate',[(1.70,.225,.145,-.008),
        (1.82,.292,.177,-.006),(2.01,.340,.182,0),(2.135,.331,.154,0),
        (2.23,.243,.112,0),(2.28,.100,.084,0)],steel,'chest',ridge=.045)
    # Curved side panels and a restrained central ridge catch light like formed plate.
    mesh('breastplate raised sternum',[(0,-.239,1.84),(-.016,-.220,1.98),
        (0,-.225,2.18),(.016,-.220,1.98)],[(0,1,2,3)],edge,'chest')
    for sign in [-1,1]:
        mesh('breastplate clavicle edge '+str(sign),[(sign*.065,-.104,2.252),
            (sign*.242,-.106,2.215),(sign*.318,-.093,2.14),
            (sign*.299,-.116,2.135),(sign*.225,-.129,2.192),
            (sign*.065,-.126,2.232)],[(0,1,2,3,4,5)],edge,'chest')
        mesh('breastplate side flute '+str(sign),[(sign*.203,-.153,1.75),
            (sign*.291,-.129,2.03),(sign*.303,-.116,2.045),
            (sign*.217,-.156,1.747)],[(0,1,2,3)],darkmetal,'chest')
    armor('curved articulated plackart',[(1.555,.219,.147,0),
        (1.66,.244,.158,0),(1.76,.257,.174,-.005),(1.835,.264,.168,-.008)],steel,'chest',ridge=.024)
    for i,z in enumerate([1.515,1.572]):
        armor('waist fauld overlapping lame '+str(i),[(z-.018,.232,.147,0),
            (z+.046,.242,.154,0)],edge if i==0 else steel,'pelvis',count=12)
    shell('dark narrow waist belt',[(1.49,.242,.158,0),(1.535,.242,.158,0)],leather,'pelvis',12,0)
    box('small steel buckle',(0,-.168,1.51),(.075,.018,.046),darkmetal,'pelvis',.003)
    mesh('diagonal back harness',[(-.25,.159,2.17),(-.202,.174,2.18),
        (.15,.169,1.76),(.10,.177,1.74)],[(0,1,2,3)],leather,'chest')
    shell('slender exposed neck',[(2.22,.073,.071,0),(2.42,.067,.068,0)],skin,'head',12,0)
    armor('silver gorget',[(2.215,.161,.122,0),(2.275,.130,.100,0),
        (2.315,.090,.079,0)],steel,'chest')

    # Only the exposed lower face remains under the helmet; hidden eyes/ears and
    # scalp geometry do not earn their cost at the gameplay display size.
    shell('adult exposed jaw',[(2.365,.047,.058,-.015),(2.39,.073,.083,-.016),
        (2.435,.100,.098,-.012),(2.49,.111,.105,-.006),
        (2.56,.113,.101,0)],skin,'head',16,0)
    mesh('straight nose planes',[(-.014,-.108,2.556),(.014,-.108,2.556),
        (0,-.151,2.507),(-.019,-.118,2.498),(.019,-.118,2.498)],
        [(0,1,2),(0,2,3),(1,4,2),(3,2,4)],skin,'head')
    mesh('subtle mouth',[(-.029,-.103,2.463),(.029,-.103,2.463),
        (.018,-.108,2.459),(-.018,-.108,2.459)],[(0,1,2,3)],leather,'head')
    vs=[]; count=20
    for ring in range(4):
        for i in range(count):
            angle=i*math.tau/count
            front=max(0,-math.sin(angle))
            if ring==0: z=2.475+.115*front; rx,ry=.132,.124
            elif ring==1: z=2.642; rx,ry=.129,.122
            elif ring==2: z=2.705; rx,ry=.086,.082
            else: z=2.735; rx,ry=.012,.018
            # Restrained rear neck flare, no plume or exaggerated ornament.
            yy=.012+ry*math.sin(angle)
            if ring==0 and yy>0: yy+=.025
            vs.append((rx*math.cos(angle),yy,z))
    fs=[(r*count+i,r*count+(i+1)%count,(r+1)*count+(i+1)%count,(r+1)*count+i)
        for r in range(3) for i in range(count)]
    fs.append(tuple(range(3*count,4*count)))
    mesh('fitted silver sallet crown',vs,fs,steel,'head',0,True)
    # Dark ocular band under a bright angular brow reads at battle size.
    mesh('sallet narrow eye opening',[(-.112,-.102,2.555),(0,-.143,2.558),
        (.112,-.102,2.555),(.112,-.104,2.578),(0,-.145,2.580),
        (-.112,-.104,2.578)],[(0,1,4,5),(1,2,3,4)],black,'head',0)
    mesh('sallet raised brow',[(-.119,-.098,2.584),(0,-.152,2.590),
        (.119,-.098,2.584),(.113,-.095,2.614),(0,-.140,2.626),
        (-.113,-.095,2.614)],[(0,1,4,5),(1,2,3,4)],edge,'head',0)
    for sign in [-1,1]:
        mesh('sallet tapered cheek '+str(sign),[(sign*.121,-.078,2.572),
            (sign*.132,.040,2.555),(sign*.098,.026,2.408),
            (sign*.058,-.111,2.410),(sign*.077,-.127,2.490)],
            [(0,1,2,3,4)],steel,'head',.004)
        sphere('sallet visor pivot '+str(sign),(sign*.132,-.002,2.567),
            (.008,.014,.014),darkmetal,'head',8)

    for side,sign in [('R',-1),('L',1)]:
        ua,fa,hand='upper_arm.'+side,'forearm.'+side,'hand.'+side
        # Angular swept roof and flared lower lame, with a strong raised ridge.
        # This is a folded plate surface, rather than a shaded shoulder sphere.
        cx=sign*.385
        profiles=[(-.115,2.235,.093),(-.035,2.315,.145),(.105,2.300,.171),
                  (.205,2.205,.158),(.221,2.095,.114)]
        ny=7
        for layer in range(2):
            vv=[]
            for xx,z,dep in profiles:
                if layer:xx=xx*.86;z-=.065;dep*=.94
                for k in range(ny):
                    q=-math.pi*.47+k*math.pi*.94/(ny-1)
                    sx=xx-.040*abs(math.sin(q))**2
                    vv.append((cx+sign*sx,dep*math.sin(q),z-.12*(1-math.cos(q))))
            ff=[(r*ny+j,(r+1)*ny+j,(r+1)*ny+j+1,r*ny+j+1)
                for r in range(4) for j in range(ny-1)]
            mesh('sculpted center shoulder plate '+side+str(layer),vv,ff,steel,ua,.004,True)
            front=[vv[i*ny] for i in range(5)]
            mesh('pauldron rolled rim '+side+str(layer),front+
                [(x,y-.003,z+.013) for x,y,z in front],
                [(i,i+1,i+6,i+5) for i in range(4)],edge,ua)
        mesh('pauldron raised ridge '+side,[(cx+sign*xx,-.009,z+.006) for xx,z,dep in profiles]+
            [(cx+sign*xx,.009,z+.006) for xx,z,dep in profiles],
            [(i,i+1,i+6,i+5) for i in range(4)],edge,ua)
        armor('rerebrace upper arm '+side,[(1.82,.074,.079,0),
            (1.94,.102,.099,0),(2.10,.120,.111,0),(2.17,.104,.103,0)],steel,ua,sign*.415,ridge=.018,count=12)
        sphere('recessed elbow mail '+side,(sign*.42,0,1.79),(.074,.071,.078),cloth,fa,12)
        armor('shaped elbow cop '+side,[(1.715,.077,.082,-.008),
            (1.79,.101,.110,-.008),(1.86,.085,.087,-.008)],steel,fa,sign*.42,ridge=.018,count=12)
        mesh('elbow side wing '+side,[(sign*.43,.018,1.87),(sign*.565,.028,1.80),
            (sign*.48,.032,1.70),(sign*.41,.02,1.77)],[(0,1,2,3)],steel,fa,.004)
        armor('shaped tapered vambrace '+side,[(1.365,.062,.068,-.005),
            (1.44,.078,.079,0),(1.58,.092,.096,0),(1.735,.086,.090,0)],steel,fa,sign*.445,ridge=.014,count=12)
        armor('gauntlet flared cuff '+side,[(1.325,.062,.065,0),
            (1.405,.081,.082,0)],edge,hand,sign*.45,count=10)
        box('fitted gauntlet '+side,(sign*.45,-.008,1.282),(.102,.107,.135),darkmetal,hand,.010)
        box('gauntlet back '+side,(sign*.45,-.055,1.30),(.101,.019,.10),steel,hand,.006)
        for i in range(4):
            fx=sign*.45+(i-1.5)*.024
            box('curled armored finger '+side+str(i),(fx,-.025,1.222),(.021,.077,.041),steel,hand,.004)
            sphere('gauntlet knuckle '+side+str(i),(fx,-.062,1.249),(.012,.012,.016),edge,hand,8)
        sphere('gauntlet thumb '+side,(sign*.45-sign*.058,-.020,1.282),(.024,.029,.048),steel,hand,12)

        thigh,shin,foot='thigh.'+side,'shin.'+side,'foot.'+side
        lx=sign*.17
        armor('dark fitted breeches '+side,[(.78,.081,.083,0),(1.12,.12,.116,0),
            (1.44,.137,.124,0)],cloth,thigh,lx,count=10)
        armor('anatomical fluted cuisse '+side,[(.80,.082,.090,0),(.91,.097,.106,0),
            (1.14,.132,.128,0),(1.36,.142,.128,0)],steel,thigh,lx,ridge=.018,count=12)
        # Three wide curved tasset lames replace the square ladder-like hip tabs.
        for j,z in enumerate([1.395,1.325,1.255]):
            vs=[];nc=7
            for zz,width,depth in [(z+.055,.145,.153),(z-.040,.134,.160)]:
                for k in range(nc):
                    q=math.pi*1.04+k*math.pi*.92/(nc-1)
                    vs.append((lx+width*math.cos(q),depth*math.sin(q)-.025,zz+.018*math.cos(q*2)))
            fs=[(k,k+1,k+1+nc,k+nc) for k in range(nc-1)]
            mesh('curved hip plate tasset '+side+str(j),vs,fs,steel,thigh,.003)
            mesh('tasset edge '+side+str(j),[(x,y-.003,zz) for x,y,zz in vs[nc:]]+
                [(x,y-.004,zz+.012) for x,y,zz in vs[nc:]],
                [(k,k+1,k+1+nc,k+nc) for k in range(nc-1)],edge,thigh)
        sphere('recessed knee mail '+side,(sign*.18,0,.79),(.079,.078,.078),cloth,shin,12)
        armor('formed angular poleyn '+side,[(.695,.068,.080,-.012),
            (.79,.105,.110,-.018),(.875,.083,.088,-.010)],steel,shin,sign*.18,ridge=.021,count=12)
        mesh('poleyn side wing '+side,[(sign*.19,-.040,.865),(sign*.335,.009,.795),
            (sign*.27,-.017,.72),(sign*.18,-.05,.735)],[(0,1,2,3)],steel,shin,.004)
        armor('anatomical ridged greave '+side,[(.15,.061,.070,.002),
            (.26,.068,.078,.003),(.43,.096,.107,.008),(.59,.106,.111,.008),
            (.72,.087,.092,0)],steel,shin,sign*.18,ridge=.023,count=12)
        mesh('greave central ridge '+side,[(sign*.18,-.106,.20),
            (sign*.18-.012,-.124,.45),(sign*.18,-.125,.675),
            (sign*.18+.012,-.124,.45)],[(0,1,2,3)],edge,shin)
        cx=sign*.18
        vv=[(cx-.075,.09,.025),(cx+.075,.09,.025),(cx+.095,-.17,.025),
            (cx+.042,-.355,.025),(cx-.042,-.355,.025),(cx-.095,-.17,.025),
            (cx-.068,.075,.205),(cx+.068,.075,.205),(cx+.088,-.15,.118),
            (cx+.039,-.35,.067),(cx-.039,-.35,.067),(cx-.088,-.15,.118)]
        ff=[tuple(reversed(range(6))),tuple(range(6,12))]
        ff.extend((i,(i+1)%6,(i+1)%6+6,i+6) for i in range(6))
        mesh('slender pointed sabaton '+side,vv,ff,steel,foot,.004)
        for i,y in enumerate([-.09,-.16,-.23,-.29]):
            z=.148-i*.023;half=.083-i*.012
            mesh('overlapping sabaton plate '+side+str(i),[(cx-half,y+.022,z),
                (cx+half,y+.022,z),(cx+half*.92,y-.024,z-.010),
                (cx-half*.92,y-.024,z-.010)],[(0,1,2,3)],edge,foot)

    # Long slender longsword, muted steel fittings, no gold ornaments or VFX.
    sx=-.45
    link('leather sword grip',(sx,0,1.43),(sx,0,1.205),.026,leather,'hand.R',10)
    sphere('small sword pommel',(sx,0,1.46),(.035,.031,.046),darkmetal,'hand.R',12)
    mesh('slender sword crossguard',[(sx-.21,0,1.19),(sx-.16,-.022,1.17),
        (sx+.16,-.022,1.17),(sx+.21,0,1.19),(sx+.16,.022,1.205),
        (sx-.16,.022,1.205)],[(0,1,2,3,4,5)],edge,'hand.R')
    vs=[]
    for z,w in [(1.163,.047),(1.03,.045),(.30,.030),(.14,.001)]:
        vs.extend([(sx-w,0,z),(sx,-.011,z),(sx+w,0,z),(sx,.011,z)])
    fs=[(r*4+i,r*4+(i+1)%4,(r+1)*4+(i+1)%4,(r+1)*4+i) for r in range(3) for i in range(4)]
    fs.extend([(0,3,2,1),(12,13,14,15)])
    mesh('long narrow steel blade',vs,fs,edge,'hand.R')
    return rest,rig
