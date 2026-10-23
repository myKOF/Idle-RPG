"""Adult-proportioned silver knight, based on the supplied silhouette reference.

No shield, closed bucket helmet, oversized head, spherical shoulder armor or cube
boots. All geometry is original. Small face features are geometry, not a texture.
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
    rig['design']='Revision 2: adult slender silver knight, original geometry, no shield'
    rig['front']='-Y'
    rig['preview_status']='Revision candidate; not installed into game'
    rig['head_to_body_ratio']=7.5

    # Tailored cuirass, pronounced waist, long limbs, quiet dark articulation.
    shell('padded fitted torso',[(1.48,.21,.12,0),(1.74,.24,.135,0),
        (2.04,.29,.15,0),(2.20,.29,.13,0),(2.25,.22,.11,0)],cloth,'chest',12)
    shell('fitted silver breastplate',[(1.72,.205,.134,-.01),(1.84,.25,.157,-.01),
        (2.04,.302,.177,-.01),(2.16,.286,.15,0),(2.24,.17,.11,0)],steel,'chest',12)
    for i,z in enumerate([1.55,1.63,1.71]):
        shell('overlapping abdominal plate '+str(i),[(z-.025,.214+i*.003,.133,0),
              (z+.052,.218+i*.006,.14,0)],steel,'chest',12)
    shell('dark narrow waist belt',[(1.48,.226,.141,0),(1.54,.226,.141,0)],leather,'pelvis',12)
    box('small steel buckle',(0,-.153,1.51),(.085,.022,.052),darkmetal,'pelvis',.005)
    # The source has a dark diagonal back strap; retain the large readable line.
    mesh('diagonal back harness',[(-.24,.15,2.17),(-.185,.165,2.18),
        (.15,.151,1.76),(.10,.161,1.74)],[(0,1,2,3)],leather,'chest')
    shell('slender exposed neck',[(2.22,.073,.071,0),(2.42,.067,.068,0)],skin,'head',12)
    shell('low silver neck guard',[(2.215,.128,.10,0),(2.29,.104,.082,0)],edge,'chest',12)

    # Natural adult jaw, narrow facial planes and a short pale-ash hair silhouette.
    # Head height ~.36m at ~2.72m authoring scale; no childlike eyes or big visor.
    head=shell('adult face and jaw',[(2.365,.047,.058,-.015),(2.385,.067,.078,-.015),
        (2.415,.088,.093,-.016),(2.455,.104,.101,-.012),(2.495,.113,.105,-.006),
        (2.535,.115,.102,0),(2.565,.115,.101,.003),(2.595,.115,.102,.006),
        (2.625,.110,.097,.008),(2.665,.086,.078,.012),(2.69,.042,.040,.012)],skin,'head',24,0)
    for v in head.data.vertices:
        if v.co.y<-.025:
            # Restrained brow, eye sockets and cheek planes on a human face.
            eye=math.exp(-((abs(v.co.x)-.048)/.028)**2-((v.co.z-2.55)/.019)**2)
            brow=math.exp(-((abs(v.co.x)-.048)/.045)**2-((v.co.z-2.585)/.014)**2)
            cheek=math.exp(-((abs(v.co.x)-.071)/.028)**2-((v.co.z-2.50)/.025)**2)
            v.co.y+=.008*eye-.008*brow-.006*cheek
    for poly in head.data.polygons: poly.use_smooth=True
    for sign in [-1,1]:
        sphere('small natural ear '+str(sign),(sign*.115,.006,2.525),(.018,.023,.041),skin,'head',12)
        # Small human eye shapes, with narrow lids rather than large cartoon eyes.
        sphere('eye '+str(sign),(sign*.046,-.100,2.546),(.017,.010,.0065),sclera,'head',12)
        sphere('iris '+str(sign),(sign*.044,-.110,2.546),(.0045,.002,.005),black,'head',8)
        mesh('eyebrow '+str(sign),[(sign*.023,-.109,2.570),(sign*.069,-.098,2.566),
            (sign*.067,-.101,2.573),(sign*.025,-.111,2.577)],[(0,1,2,3)],hair,'head')
    mesh('straight nose planes',[(-.014,-.108,2.556),(.014,-.108,2.556),
        (0,-.151,2.507),(-.019,-.118,2.498),(.019,-.118,2.498)],
        [(0,1,2),(0,2,3),(1,4,2),(3,2,4)],skin,'head')
    mesh('subtle mouth',[(-.029,-.103,2.463),(.029,-.103,2.463),
        (.018,-.108,2.459),(-.018,-.108,2.459)],[(0,1,2,3)],leather,'head')
    vs=[]; count=16
    for ring in range(4):
        for i in range(count):
            angle=i*math.tau/count
            front=max(0,-math.sin(angle))
            if ring==0: z=2.525+.083*front; rx,ry=.119,.106
            elif ring==1: z=2.645; rx,ry=.110,.099
            elif ring==2: z=2.691; rx,ry=.072,.064
            else: z=2.711; rx,ry=.016,.016
            vs.append((rx*math.cos(angle),.009+ry*math.sin(angle),z))
    fs=[(r*count+i,r*count+(i+1)%count,(r+1)*count+(i+1)%count,(r+1)*count+i)
        for r in range(3) for i in range(count)]
    fs.append(tuple(range(48,64)))
    mesh('short swept ash hair',vs,fs,hair,'head',0,True)

    for side,sign in [('R',-1),('L',1)]:
        ua,fa,hand='upper_arm.'+side,'forearm.'+side,'hand.'+side
        # Sculpted sloping shoulder plates; intentionally no ball-shaped pauldrons.
        sphere('shoulder textile '+side,(sign*.38,0,2.23),(.115,.125,.115),cloth,ua,12)
        local_shell('sculpted fitted pauldron '+side,(sign*.39,0,0),
            [(2.13,.155,.143,0),(2.23,.173,.153,0),
             (2.305,.116,.114,0),(2.33,.044,.047,0)],steel,'chest',12)
        local_shell('thin pauldron lower overlap '+side,(sign*.395,0,0),
            [(2.105,.148,.137,0),(2.15,.161,.148,0)],edge,'chest',12)
        x=sign*.415
        local_shell('slim upper arm '+side,(x,0,0),[(1.86,.073,.076,0),
            (2.04,.09,.091,0),(2.15,.10,.102,0)],steel,ua,10)
        sphere('elbow cloth '+side,(sign*.42,0,1.79),(.074,.073,.079),cloth,fa,12)
        # A compact elbow wing replaces oversized spherical elbow armor.
        mesh('elbow guard '+side,[(sign*.42,-.08,1.87),(sign*.52,-.025,1.80),
             (sign*.42,.07,1.72),(sign*.37,-.065,1.77)],[(0,1,2,3)],steel,fa)
        local_shell('tapered vambrace '+side,(sign*.445,0,0),[(1.395,.059,.065,-.004),
            (1.49,.072,.075,-.004),(1.72,.082,.085,0)],steel,fa,10)
        local_shell('gauntlet cuff '+side,(sign*.45,0,0),[(1.345,.067,.070,0),
            (1.415,.071,.073,0)],edge,hand,10)
        box('fitted gauntlet '+side,(sign*.45,-.008,1.282),(.102,.107,.135),darkmetal,hand,.012)
        box('gauntlet back '+side,(sign*.45,-.055,1.30),(.101,.019,.10),steel,hand,.007)
        for i in range(4):
            fx=sign*.45+(i-1.5)*.024
            box('curled armored finger '+side+str(i),(fx,-.025,1.222),(.021,.077,.041),
                steel,hand,.006)
            sphere('gauntlet knuckle '+side+str(i),(fx,-.062,1.249),(.012,.012,.016),edge,hand,8)
        sphere('gauntlet thumb '+side,(sign*.45-sign*.058,-.020,1.282),(.024,.029,.048),
               steel,hand,12)

        thigh,shin,foot='thigh.'+side,'shin.'+side,'foot.'+side
        lx=sign*.17
        local_shell('dark fitted breeches '+side,(lx,0,0),[(.82,.080,.080,0),
            (1.14,.112,.112,0),(1.44,.132,.112,0)],cloth,thigh,10)
        local_shell('long thigh plates '+side,(lx,-.005,0),[(.86,.082,.086,0),
            (1.15,.117,.110,0),(1.37,.117,.105,0)],steel,thigh,10)
        # Thin split hip plates preserve a tapered waist without boxy shorts.
        mesh('tapered hip plate '+side,[(sign*.06,-.135,1.49),(sign*.285,-.085,1.48),
            (sign*.27,-.108,1.22),(sign*.105,-.16,1.25)],[(0,1,2,3)],steel,thigh)
        for i,z in enumerate([1.29,1.36,1.43]):
            mesh('hip plate overlapping lame '+side+str(i),
                [(sign*.082,-.155,z+.025),(sign*.270,-.113,z+.025),
                 (sign*.265,-.117,z-.011),(sign*.095,-.165,z-.018)],
                [(0,1,2,3)],edge,thigh,.004)
        sphere('knee articulation '+side,(sign*.18,0,.79),(.081,.080,.080),cloth,shin,12)
        mesh('angular knee plate '+side,[(sign*.18,-.092,.88),(sign*.27,-.048,.79),
            (sign*.18,-.108,.69),(sign*.095,-.065,.79)],[(0,1,2),(0,2,3)],edge,shin)
        local_shell('long tapered greave '+side,(sign*.18,0,0),[(.21,.055,.062,.005),
            (.38,.073,.077,.008),(.65,.089,.087,0),(.72,.080,.080,0)],steel,shin,10)
        # Long low sabaton, with a tapered toe instead of a rectangular block.
        cx=sign*.18
        vv=[(cx-.074,.09,.025),(cx+.074,.09,.025),(cx+.09,-.18,.025),
            (cx+.048,-.355,.025),(cx-.048,-.355,.025),(cx-.09,-.18,.025),
            (cx-.069,.075,.21),(cx+.069,.075,.21),(cx+.082,-.16,.115),
            (cx+.043,-.35,.065),(cx-.043,-.35,.065),(cx-.082,-.16,.115)]
        ff=[tuple(reversed(range(6))),tuple(range(6,12))]
        ff.extend((i,(i+1)%6,(i+1)%6+6,i+6) for i in range(6))
        mesh('slender pointed sabaton '+side,vv,ff,steel,foot)
        for i,y in enumerate([-.095,-.175,-.255]):
            z=.147-i*.029
            half=.081-i*.011
            mesh('overlapping sabaton plate '+side+str(i),
                [(cx-half,y+.026,z),(cx+half,y+.026,z),(cx+half*.95,y-.027,z-.012),
                 (cx-half*.95,y-.027,z-.012)],[(0,1,2,3)],edge,foot,.004)
        link('ankle black seam '+side,(cx-.064,-.025,.20),(cx+.064,-.025,.20),.010,leather,foot,8)

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
