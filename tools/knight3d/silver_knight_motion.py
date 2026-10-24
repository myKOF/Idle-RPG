"""Continuous full-body sword animation with hip/chest separation and planted feet.

All targets are original key poses informed by the supplied sheets, without trails.
Absolute torso orientation includes axial twist; a tail direction alone cannot
represent turning around the spine. That distinction is essential for this rig.
"""
import math
import bpy
from mathutils import Vector, Matrix, Euler, Quaternion

def curve(t, keys):
    """Time-aware cubic Hermite, C1 through interior keys; no stop at every pose."""
    vector=isinstance(keys[0][1],(tuple,list,Vector))
    def val(k): return Vector(k[1]) if vector else k[1]
    if t<=keys[0][0]: return val(keys[0])
    if t>=keys[-1][0]: return val(keys[-1])
    for i in range(len(keys)-1):
        t1,p1=keys[i][0],val(keys[i])
        t2,p2=keys[i+1][0],val(keys[i+1])
        if t<=t2:
            p0=val(keys[max(0,i-1)]); t0=keys[max(0,i-1)][0]
            p3=val(keys[min(len(keys)-1,i+2)]); t3=keys[min(len(keys)-1,i+2)][0]
            m1=(p2-p0)/(t2-t0) if i>0 else p1*0
            m2=(p3-p1)/(t3-t1) if i+2<len(keys) else p2*0
            near=lambda a,b: (a-b).length<1e-8 if vector else abs(a-b)<1e-8
            if near(p1,p2): return p1
            if near(p0,p1): m1=p1*0
            if near(p3,p2): m2=p2*0
            u=(t-t1)/(t2-t1); dt=t2-t1
            return (2*u**3-3*u*u+1)*p1+(u**3-2*u*u+u)*dt*m1+\
                (-2*u**3+3*u*u)*p2+(u**3-u*u)*dt*m2

def rotate(angles): return Euler(angles,'XYZ').to_matrix()
def two_bone(a,target,l1,l2,pole):
    delta=target-a
    direction=delta.normalized()
    d=min(l1+l2-.001,max(.015,delta.length))
    target=a+direction*d
    polevec=pole-a
    bend=polevec-direction*polevec.dot(direction)
    if bend.length<.0001: bend=Vector((1,0,0))
    bend.normalize()
    along=(l1*l1-l2*l2+d*d)/(2*d)
    offset=math.sqrt(max(0,l1*l1-along*along))
    return a+direction*along+bend*offset,target

def pose(rig,rest,clip,t):
    V=Vector
    # Reference's low, broad guard: front knee loaded, chest over the base,
    # rear leg bracing. Targets stay reachable instead of silently straightening.
    guard=V((-.025,.035,1.02))
    p=guard.copy()
    hip=(.12,0,-.10); chest=(.57,-.045,-.20)
    right=V((-.55,-.47,1.26)); left=V((.45,-.40,1.45))
    sword=V((.68,.04,.73)); free=V((.12,-.9,.10))
    footR=V((-.70,.19,.13)); footL=V((.70,-.23,.13))
    footyawR=-.20; footyawL=.24
    headyaw=-.06;headpitch=.30
    if clip=='idle':
        pulse=math.sin(t*math.tau)
        p.z+=.009*pulse
        chest=(.57+.016*pulse,-.045,-.20+.018*pulse)
        right.y-=.012*pulse
        right.z+=.006*pulse
    elif clip=='walk':
        phase=t*math.tau
        p=V((.035*math.sin(phase),-.035,1.055+.045*math.cos(phase*2)))
        hip=(.21,.06*math.sin(phase),.22*math.cos(phase))
        chest=(.78,-.07*math.sin(phase),-.30*math.cos(phase))
        for foot,offset,sign in [(footR,0,-1),(footL,math.pi,1)]:
            q=phase+offset
            foot.x=sign*.25
            foot.y=-.015+.61*math.cos(q)
            foot.z=.13+.31*max(0,math.sin(q))**1.1
        footyawR=-.07;footyawL=.08
        right=V((-.40,-.37+.27*math.cos(phase),1.39+.05*math.sin(phase)))
        left=V((.42,-.29-.34*math.cos(phase),1.38-.07*math.sin(phase)))
        sword=V((-.12,.79,.60))
        headyaw=-.07*math.cos(phase-.2);headpitch=.43
    elif clip=='attack1':
        # Coil, front-foot plant, fast cutting beat, long weighted follow-through.
        p=curve(t,[(0,tuple(guard)),(.18,(-.04,.08,1.07)),
            (.35,(.15,-.13,.93)),(.46,(.23,-.27,.855)),
            (.65,(.17,-.22,.87)),(.82,(.06,-.02,.965)),(1,tuple(guard))])
        hipyaw=curve(t,[(0,-.10),(.20,-.69),(.30,-.57),(.46,.72),(.65,.82),(.82,.27),(1,-.10)])
        yaw=curve(t,[(0,-.20),(.22,-1.13),(.30,-.98),(.47,1.05),(.63,1.13),(.82,.30),(1,-.20)])
        hip=(curve(t,[(0,.12),(.22,.08),(.48,.31),(.7,.24),(1,.12)]),
             curve(t,[(0,0),(.22,-.10),(.47,.13),(1,0)]),hipyaw)
        chest=(curve(t,[(0,.57),(.20,.40),(.34,.68),(.47,1.03),(.66,.91),(.83,.70),(1,.57)]),
               curve(t,[(0,-.045),(.23,-.17),(.49,.21),(.7,.10),(1,-.045)]),yaw)
        right=curve(t,[(0,(-.55,-.47,1.26)),(.20,(-.64,.02,1.98)),
            (.30,(-.59,-.27,2.02)),(.43,(-.24,-1.00,1.39)),
            (.55,(.37,-.72,1.17)),(.68,(.47,-.38,1.16)),
            (.83,(.10,-.43,1.22)),(1,(-.55,-.47,1.26))])
        sword=curve(t,[(0,(.68,.04,.73)),(.20,(-.56,.52,.64)),
            (.30,(-.84,-.20,.48)),(.43,(-.02,-.98,-.12)),
            (.55,(.97,-.05,-.24)),(.68,(.77,.58,-.25)),
            (.83,(.74,.35,.57)),(1,(.68,.04,.73))])
        footR=curve(t,[(0,(-.70,.19,.13)),(.22,(-.74,.24,.13)),
            (.70,(-.74,.24,.13)),(1,(-.70,.19,.13))])
        footL=curve(t,[(0,(.70,-.23,.13)),(.15,(.70,-.23,.13)),
            (.25,(.80,-.42,.28)),(.35,(.88,-.58,.13)),
            (.70,(.88,-.58,.13)),(.85,(.78,-.37,.20)),(1,(.70,-.23,.13))])
        footyawR=curve(t,[(0,-.20),(.22,-.50),(.46,.25),(.72,.38),(1,-.20)])
        footyawL=curve(t,[(0,.24),(.25,-.18),(.50,.52),(.70,.59),(1,.24)])
        headyaw=yaw*.32;headpitch=chest[0]*.57
    elif clip=='attack2':
        # Original Melee2 turns through the back silhouette before facing front.
        # Rotate the entire body/feet/weapon, not just the shoulder or sword arm.
        spin=curve(t,[(0,-.20),(.13,-.38),(.25,-1.48),(.39,-2.85),
            (.53,-4.05),(.67,-5.65),(.82,-math.tau-.20),(1,-math.tau-.20)])
        yawR=rotate((0,0,spin+.20))
        p=curve(t,[(0,tuple(guard)),(.23,(-.02,.04,1.10)),(.42,(.02,-.04,1.08)),
            (.64,(-.09,-.12,.87)),(.80,(-.06,-.02,.97)),(1,tuple(guard))])
        hip=(curve(t,[(0,.12),(.25,.03),(.47,.12),(.65,.30),(1,.12)]),
             .06*math.sin(math.pi*t),spin+.10)
        chest=(curve(t,[(0,.57),(.23,.22),(.42,.35),(.62,.98),(.76,.72),(1,.57)]),
               -.045+.12*math.sin(math.tau*t),spin)
        local_wrist=curve(t,[(0,(-.525,-.505,.24)),(.19,(-.35,-.17,1.10)),
            (.33,(-.18,-.04,1.29)),(.46,(-.12,-.36,.98)),
            (.61,(-.40,-.78,.34)),(.73,(-.49,-.58,.19)),
            (.86,(-.56,-.49,.23)),(1,(-.525,-.505,.24))])
        right=p+yawR@local_wrist
        sword=yawR@curve(t,[(0,(.68,.04,.73)),(.23,(.0,.28,.96)),
            (.39,(.07,.04,1)),(.52,(-.30,-.86,.41)),
            (.64,(-.58,-.75,-.31)),(.79,(-.10,-.40,.91)),(1,(.68,.04,.73))])
        # Alternating circular steps keep the hips supported throughout the turn.
        for foot,sign,phase_offset in [(footR,-1,0),(footL,1,math.pi)]:
            phase=(t-.12)/.62*math.tau
            spread=curve(t,[(0,.70),(.24,.49),(.52,.46),(.72,.70),(1,.70)])
            q=yawR@V((sign*spread,-sign*.21,0))
            foot.x=q.x;foot.y=q.y-.02
            foot.z=.13+.21*max(0,math.sin(phase+phase_offset)) if .12<t<.75 else .13
        # Restore the exact guard footprint during recovery.
        if t>.78:
            u=min(1,(t-.78)/.22);u=u*u*(3-2*u)
            footR=footR.lerp(V((-.70,.19,.13)),u)
            footL=footL.lerp(V((.70,-.23,.13)),u)
        footyawR=spin+.00;footyawL=spin+.44
        headyaw=spin+.12;headpitch=chest[0]*.56
    elif clip=='cast':
        spin=curve(t,[(0,-.20),(.16,-.65),(.33,-2.35),(.47,-3.15),
            (.60,-3.55),(.77,-5.2),(.91,-math.tau-.20),(1,-math.tau-.20)])
        yawR=rotate((0,0,spin+.20))
        p=curve(t,[(0,tuple(guard)),(.28,(-.03,.05,1.10)),(.50,(-.03,.0,1.14)),
            (.75,(-.06,-.12,.88)),(.88,(-.06,-.10,.84)),(1,tuple(guard))])
        hip=(.12,0,spin+.10)
        chest=(curve(t,[(0,.57),(.35,.20),(.55,.12),(.78,.90),(.89,.96),(1,.57)]),-.045,spin)
        wrist=curve(t,[(0,(-.525,-.505,.24)),(.25,(-.29,-.20,1.02)),
            (.44,(-.23,-.11,1.20)),(.58,(-.24,-.15,1.17)),
            (.77,(-.46,-.73,.29)),(.88,(-.50,-.65,.18)),(1,(-.525,-.505,.24))])
        right=p+yawR@wrist
        sword=yawR@curve(t,[(0,(.68,.04,.73)),(.28,(-.04,.10,.99)),
            (.44,(.02,.02,1)),(.59,(.02,.02,1)),(.77,(-.22,-.95,-.21)),
            (.88,(.16,-.92,-.35)),(1,(.68,.04,.73))])
        left=p+yawR@V((.55,-.22,.60))
        free=yawR@V((.2,-.7,.6))
        for foot,sign,offset in [(footR,-1,0),(footL,1,math.pi)]:
            spread=curve(t,[(0,.70),(.3,.52),(.6,.49),(.83,.69),(1,.70)])
            q=yawR@V((sign*spread,-sign*.21,0))
            foot.x=q.x;foot.y=q.y-.02
            foot.z=.13+.18*max(0,math.sin((t-.12)/.72*math.tau+offset)) if .12<t<.87 else .13
        if t>.90:
            u=min(1,(t-.90)/.1);u=u*u*(3-2*u)
            footR=footR.lerp(V((-.70,.19,.13)),u);footL=footL.lerp(V((.70,-.23,.13)),u)
        footyawR=spin;footyawL=spin+.44
        headyaw=spin+.12;headpitch=.22
    elif clip=='die':
        c=max(0,min(1,(t-.61)/.29));c=c*c*(3-2*c)
        flinch=math.sin(min(1,t/.28)*math.pi)*.055
        p=V((-.025,.035+.18*c,1.02*(1-c)+.265*c-flinch))
        hip=(.12*(1-c)-1.49*c,0,-.10+.12*c)
        chest=(.57*(1-c)-1.51*c-.11*math.sin(math.pi*t),-.045*(1-c),-.20+.18*c)
        right=curve(t,[(0,(-.55,-.47,1.26)),(.20,(-.57,-.51,1.45)),
            (.58,(-.58,-.40,1.31)),(.74,(-.66,-.12,.72)),(.90,(-.67,.24,.195)),(1,(-.67,.24,.195))])
        left=curve(t,[(0,(.45,-.40,1.45)),(.24,(.57,-.30,1.40)),
            (.58,(.60,-.25,1.30)),(.74,(.64,.18,.63)),(.92,(.62,.45,.22)),(1,(.62,.45,.22))])
        sword=curve(t,[(0,(.68,.04,.73)),(.25,(-.50,-.70,.35)),
            (.63,(-.75,-.64,.08)),(.85,(-.75,-.66,.03)),(1,(-.75,-.66,.03))])
        footR=V((-.70*(1-c)-.29*c,-.82*c+.19*(1-c),.13))
        footL=V((.70*(1-c)+.34*c,-.69*c-.23*(1-c),.13))
        free=V((.2,-.9,0));headpitch=.30*(1-c)-1.47*c;headyaw=-.04

    target_miss={'wrist':0.0,'ankle':0.0}
    # Contact splines may overshoot an exactly flat plateau by a few millimeters.
    # Clamp only the ankle target to its authored contact height, never the torso.
    footR.z=max(.13,footR.z); footL.z=max(.13,footL.z)
    hipR=rotate(hip); chestR=rotate(chest)
    def absolute(name,head,R):
        bone=rig.data.bones[name]
        rig.pose.bones[name].matrix=Matrix.Translation(head) @ R.to_4x4() @ \
            Matrix.Translation(-bone.head_local) @ bone.matrix_local
        bpy.context.view_layer.update()
    def segment(name,head,tail,twist=0):
        bone=rig.data.bones[name]
        src=(bone.tail_local-bone.head_local).normalized()
        dst=(tail-head).normalized()
        q=src.rotation_difference(dst)
        if twist: q=Quaternion(dst,twist)@q
        absolute(name,head,q.to_matrix())
    absolute('root',V((0,0,0)),Matrix.Identity(3))
    absolute('pelvis',p,hipR)
    chestbase=p+hipR@V((0,0,.20))
    absolute('chest',chestbase,chestR)
    neck=chestbase+chestR@V((0,0,.60))
    absolute('head',neck,rotate((headpitch,chest[1]*.3,headyaw)))

    # With the shield removed, the off hand is a forward-facing chest guard.
    # Keep its target in the moving torso frame rather than leaving a world-space
    # wrist behind the body during a turn. The elbow bends down, not out like a wing.
    if clip in ['idle','attack1','attack2']:
        local=V((.35,-.34,.32))
        if clip=='attack1':
            local=curve(t,[(0,(.35,-.34,.32)),(.22,(.31,-.38,.38)),
                (.46,(.33,-.30,.31)),(.70,(.34,-.27,.30)),(1,(.35,-.34,.32))])
        elif clip=='attack2':
            local=curve(t,[(0,(.35,-.34,.32)),(.26,(.34,-.34,.43)),
                (.61,(.35,-.30,.31)),(.78,(.35,-.30,.31)),(1,(.35,-.34,.32))])
        left=chestbase+chestR@local
        free=rotate((0,0,chest[2]))@V((0,-1,.10))

    for side,sign,wrist,handdir in [('R',-1,right,sword),('L',1,left,free)]:
        shoulder=chestbase+chestR@V((sign*.38,0,.59))
        if clip=='die':
            # Shoulder-relative recoil follows the late fall instead of pulling
            # the hands toward the ground while the torso is still standing.
            if side=='R':
                offset=curve(t,[(0,(-.13,-.17,-.42)),(.22,(-.18,-.28,-.30)),
                    (.58,(-.22,-.18,-.42)),(.90,(-.29,-.565,-.10)),(1,(-.29,-.565,-.10))])
            else:
                offset=curve(t,[(0,(.12,-.06,-.25)),(.25,(.20,-.22,-.30)),
                    (.58,(.23,-.20,-.32)),(.92,(.24,-.355,-.08)),(1,(.24,-.355,-.08))])
            wrist=shoulder+offset
        l1=(V(rest['upper_arm.'+side][1])-V(rest['upper_arm.'+side][0])).length
        l2=(V(rest['forearm.'+side][1])-V(rest['forearm.'+side][0])).length
        pole=shoulder+chestR@V((sign*.42,.30,-.26))
        if side=='L' and clip in ['idle','attack1','attack2']:
            pole=shoulder+chestR@V((.18,.04,-.57))
        if clip=='die':
            blend=max(0,min(1,(t-.30)/.40))
            blend=blend*blend*(3-2*blend)
            pole=pole.lerp(shoulder+V((sign*.8,0,0)),blend)
        wrist_goal=wrist.copy()
        elbow,wrist=two_bone(shoulder,wrist,l1,l2,pole)
        target_miss['wrist']=max(target_miss['wrist'],(wrist-wrist_goal).length)
        segment('upper_arm.'+side,shoulder,elbow)
        segment('forearm.'+side,elbow,wrist)
        if side=='L' and clip in ['idle','attack1','attack2']:
            forward=rotate((0,0,chest[2]))@V((0,-1,0))
            handdir=(forward*.75+(wrist-elbow).normalized()*.25).normalized()
            handdir.z=max(.04,min(.32,handdir.z))
        elif side=='L' and clip in ['walk','cast']:
            handdir=(wrist-elbow).normalized()
        handroll=0
        if clip=='die' and side=='R':
            d=handdir.normalized()
            q=V((0,0,-1)).rotation_difference(d)
            current=q@V((1,0,0))
            flat=V((d.y,-d.x,0)).normalized()
            if flat.dot(current)<0: flat=-flat
            angle=math.atan2(d.dot(current.cross(flat)),current.dot(flat))
            blend=max(0,min(1,(t-.30)/.45))
            blend=blend*blend*(3-2*blend)
            handroll=angle*blend
        segment('hand.'+side,wrist,wrist+handdir.normalized()*.16,handroll)
        hiphead=p+hipR@V((sign*.16,0,0))
        foot=footR if side=='R' else footL
        pole=hiphead+rotate((0,0,hip[2]*.4))@V((sign*.07,-1,0))
        l1=(V(rest['thigh.'+side][1])-V(rest['thigh.'+side][0])).length
        l2=(V(rest['shin.'+side][1])-V(rest['shin.'+side][0])).length
        knee,ankle=two_bone(hiphead,foot,l1,l2,pole)
        target_miss['ankle']=max(target_miss['ankle'],(ankle-foot).length)
        segment('thigh.'+side,hiphead,knee)
        segment('shin.'+side,knee,ankle)
        yaw=footyawR if side=='R' else footyawL
        # A direction-only quaternion flips the sole during a 180-degree turn.
        # Preserve the full yaw matrix so planted sabatons remain flat.
        absolute('foot.'+side,ankle,rotate((0,0,yaw)))
    bpy.context.view_layer.update()

    return target_miss
