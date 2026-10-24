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
    # Guard: one foot forward, knees soft, sword across torso, empty hand free.
    p=V((-.025,.015,1.25))
    hip=(.025,0,-.08); chest=(.18,-.025,-.14)
    right=V((-.44,-.285,1.53)); left=V((.45,-.36,1.65))
    sword=V((.64,-.27,.72)); free=V((.12,-.16,-1))
    footR=V((-.48,.19,.13)); footL=V((.48,-.23,.13))
    footyawR=-.12; footyawL=.10
    headyaw=-.04; headpitch=.12
    if clip=='idle':
        pulse=math.sin(t*math.tau)
        p.z+=.010*pulse
        chest=(.18+.012*pulse,-.025,-.14+.014*pulse)
        right.y-=.009*pulse
        left.z+=.008*math.sin(t*math.tau-.45)
    elif clip=='walk':
        phase=t*math.tau
        p=V((.025*math.sin(phase),-.015,1.20+.035*math.cos(2*phase)))
        hip=(.12,.035*math.sin(phase),.14*math.cos(phase))
        chest=(.54,-.045*math.sin(phase),-.19*math.cos(phase))
        for foot,offset,sign in [(footR,0,-1),(footL,math.pi,1)]:
            q=phase+offset
            foot.x=sign*.205
            foot.y=-.015+.43*math.cos(q)
            foot.z=.13+.245*max(0,math.sin(q))**1.35
        footyawR=-.04; footyawL=.04
        right=V((-.42,-.15+.21*math.cos(phase),1.65+.045*math.sin(phase)))
        left=V((.44,-.12-.29*math.cos(phase),1.64-.05*math.sin(phase)))
        sword=V((-.10,.52,.85))
        free=V((.1,-.4,-.8))
        headyaw=-.045*math.cos(phase-.25)
        headpitch=.38
    elif clip=='attack1':
        p=curve(t,[(0,(-.025,.015,1.25)),(.22,(-.10,.12,1.26)),
            (.40,(-.07,-.06,1.16)),(.59,(.12,-.23,1.11)),(.76,(.10,-.14,1.18)),
            (1,(-.025,.015,1.25))])
        hipyaw=curve(t,[(0,-.08),(.22,-.63),(.36,-.50),(.56,.65),(.76,.74),(1,-.08)])
        yaw=curve(t,[(0,-.14),(.25,-1.00),(.41,-.67),(.61,.98),(.78,1.04),(1,-.14)])
        hip=(.07,curve(t,[(0,0),(.25,-.065),(.60,.09),(1,0)]),hipyaw)
        chest=(curve(t,[(0,.18),(.24,.19),(.57,.92),(.76,.62),(1,.18)]),
               curve(t,[(0,-.025),(.25,-.13),(.60,.16),(1,-.025)]),yaw)
        right=curve(t,[(0,(-.44,-.285,1.53)),(.23,(-.62,.16,2.20)),
            (.40,(-.58,-.28,2.20)),(.56,(-.12,-.79,1.83)),
            (.69,(.45,-.48,1.54)),(.82,(.40,-.20,1.49)),(1,(-.44,-.285,1.53))])
        sword=curve(t,[(0,(.64,-.27,.72)),(.23,(-.40,.42,.81)),
            (.40,(-.80,-.29,.48)),(.56,(.35,-.91,-.10)),
            (.69,(.91,.12,-.38)),(.82,(.70,.38,-.30)),(1,(.64,-.27,.72))])
        left=curve(t,[(0,(.45,-.36,1.65)),(.24,(.53,-.22,1.73)),
            (.56,(.62,.03,1.59)),(.72,(.59,.25,1.60)),(1,(.45,-.36,1.65))])
        footL=curve(t,[(0,(.48,-.23,.13)),(.20,(.48,-.15,.13)),(.36,(.51,-.34,.235)),
            (.48,(.55,-.53,.13)),(.77,(.55,-.53,.13)),(1,(.48,-.23,.13))])
        footR=curve(t,[(0,(-.48,.19,.13)),(.25,(-.50,.25,.13)),
            (.60,(-.50,.28,.13)),(1,(-.48,.19,.13))])
        footyawR=curve(t,[(0,-.12),(.25,-.40),(.66,.48),(1,-.12)])
        footyawL=curve(t,[(0,.10),(.50,.30),(.77,.38),(1,.10)])
        headyaw=yaw*.32
        headpitch=chest[0]*.72
    elif clip=='attack2':
        # The second sheet is an overhead diagonal cleave, not an arm-only lift.
        p=curve(t,[(0,(-.025,.015,1.25)),(.25,(.05,.10,1.28)),
            (.43,(.035,-.13,1.20)),(.60,(-.07,-.27,1.12)),
            (.77,(-.05,-.17,1.20)),(1,(-.025,.015,1.25))])
        yaw=curve(t,[(0,-.14),(.28,-.66),(.43,-.30),(.62,.51),(.77,.47),(1,-.14)])
        hip=(curve(t,[(0,.025),(.25,-.015),(.60,.22),(1,.025)]),
             curve(t,[(0,0),(.28,.06),(.60,-.10),(1,0)]),
             curve(t,[(0,-.08),(.25,-.36),(.55,.36),(.76,.39),(1,-.08)]))
        chest=(curve(t,[(0,.18),(.26,-.11),(.44,.21),(.62,.93),(.77,.60),(1,.18)]),
               curve(t,[(0,-.025),(.28,-.08),(.59,.15),(1,-.025)]),yaw)
        right=curve(t,[(0,(-.44,-.285,1.53)),(.25,(-.27,.08,2.46)),
            (.39,(-.21,-.22,2.43)),(.56,(-.18,-.82,1.66)),
            (.69,(-.36,-.66,1.22)),(.82,(-.40,-.44,1.28)),(1,(-.44,-.285,1.53))])
        sword=curve(t,[(0,(.64,-.27,.72)),(.25,(.07,.15,.98)),
            (.39,(.07,-.36,.94)),(.56,(-.32,-.91,-.26)),
            (.69,(-.56,-.78,-.19)),(.82,(-.65,-.31,.39)),(1,(.64,-.27,.72))])
        left=curve(t,[(0,(.45,-.36,1.65)),(.25,(.55,-.08,1.72)),
            (.56,(.69,.08,1.77)),(.72,(.58,.23,1.67)),(1,(.45,-.36,1.65))])
        footR=curve(t,[(0,(-.48,.19,.13)),(.25,(-.49,.19,.13)),
            (.39,(-.50,-.16,.24)),(.53,(-.53,-.56,.13)),
            (.77,(-.53,-.56,.13)),(1,(-.48,.19,.13))])
        footL=curve(t,[(0,(.48,-.23,.13)),(.27,(.49,-.11,.13)),
            (.59,(.51,.15,.13)),(.77,(.50,.09,.13)),(1,(.48,-.23,.13))])
        footyawR=-.10+.17*math.sin(math.pi*t)
        footyawL=.10+.35*math.sin(math.pi*t)
        headyaw=yaw*.32
        headpitch=chest[0]*.74
    elif clip=='cast':
        pulse=math.sin(math.pi*t)**2
        p+=V((.025*pulse,-.04*pulse,.055*pulse))
        hip=(.025-.06*pulse,0,-.08-.16*pulse)
        chest=(.18-.22*pulse,-.025-.06*pulse,-.14-.32*pulse)
        right=curve(t,[(0,(-.44,-.285,1.53)),(.25,(-.40,-.23,2.20)),
            (.46,(-.28,-.11,2.50)),(.64,(-.25,-.16,2.49)),
            (.83,(-.48,-.37,1.96)),(1,(-.44,-.285,1.53))])
        sword=curve(t,[(0,(.64,-.27,.72)),(.28,(-.04,-.1,.99)),
            (.55,(.03,.02,1)),(.68,(.02,.02,1)),(.85,(-.55,-.30,.77)),(1,(.64,-.27,.72))])
        left=curve(t,[(0,(.45,-.36,1.65)),(.30,(.64,-.26,1.99)),
            (.58,(.68,-.32,2.09)),(.78,(.63,-.23,1.99)),(1,(.45,-.36,1.65))])
        free=V((.2,-.7,.7))
        headpitch=-.08*pulse
        headyaw=-.12*pulse
    elif clip=='die':
        c=max(0,min(1,(t-.23)/.68)); c=c*c*(3-2*c)
        flinch=math.sin(min(1,t/.3)*math.pi)*.04
        p=V((-.025,.015+.18*c,1.25*(1-c)+.245*c-flinch))
        hip=(-1.49*c,0,-.08+.12*c)
        chest=(-1.51*c-.08*math.sin(math.pi*t),-.025,-.14+.15*c)
        right=curve(t,[(0,(-.44,-.285,1.53)),(.20,(-.49,-.34,1.70)),
            (.56,(-.63,-.12,.75)),(.85,(-.64,.24,.18)),(1,(-.64,.24,.18))])
        left=curve(t,[(0,(.45,-.36,1.65)),(.24,(.55,-.18,1.55)),
            (.60,(.62,.18,.63)),(.88,(.60,.45,.20)),(1,(.60,.45,.20))])
        sword=curve(t,[(0,(.64,-.27,.72)),(.25,(-.50,-.70,.35)),
            (.63,(-.75,-.64,.08)),(.85,(-.75,-.66,.03)),(1,(-.75,-.66,.03))])
        footR=V((-.48*(1-c)-.29*c,-.82*c+.19*(1-c),.13))
        footL=V((.48*(1-c)+.34*c,-.69*c-.23*(1-c),.13))
        free=V((.2,-.9,0))
        headpitch=-1.47*c
        headyaw=-.04

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
        local=V((.34,-.32,.38))
        if clip=='attack1':
            local=curve(t,[(0,(.34,-.32,.38)),(.25,(.29,-.39,.43)),
                (.57,(.30,-.27,.35)),(.76,(.31,-.26,.36)),(1,(.34,-.32,.38))])
        elif clip=='attack2':
            local=curve(t,[(0,(.34,-.32,.38)),(.27,(.32,-.36,.46)),
                (.60,(.37,-.27,.34)),(.78,(.34,-.25,.36)),(1,(.34,-.32,.38))])
        left=chestbase+chestR@local
        free=rotate((0,0,chest[2]))@V((0,-1,.10))

    for side,sign,wrist,handdir in [('R',-1,right,sword),('L',1,left,free)]:
        shoulder=chestbase+chestR@V((sign*.38,0,.59))
        l1=(V(rest['upper_arm.'+side][1])-V(rest['upper_arm.'+side][0])).length
        l2=(V(rest['forearm.'+side][1])-V(rest['forearm.'+side][0])).length
        pole=shoulder+chestR@V((sign*.42,.30,-.26))
        if side=='L' and clip in ['idle','attack1','attack2']:
            pole=shoulder+chestR@V((.18,.04,-.57))
        if clip=='die':
            blend=max(0,min(1,(t-.30)/.40))
            blend=blend*blend*(3-2*blend)
            pole=pole.lerp(shoulder+V((sign*.8,0,0)),blend)
        elbow,wrist=two_bone(shoulder,wrist,l1,l2,pole)
        segment('upper_arm.'+side,shoulder,elbow)
        segment('forearm.'+side,elbow,wrist)
        if side=='L' and clip in ['idle','attack1','attack2']:
            forward=rotate((0,0,chest[2]))@V((0,-1,0))
            handdir=(forward*.75+(wrist-elbow).normalized()*.25).normalized()
            handdir.z=max(.04,min(.32,handdir.z))
        elif side=='L' and clip=='walk':
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
        segment('thigh.'+side,hiphead,knee)
        segment('shin.'+side,knee,ankle)
        yaw=footyawR if side=='R' else footyawL
        toe=ankle+rotate((0,0,yaw))@V((0,-.27,-.04))
        segment('foot.'+side,ankle,toe)
    bpy.context.view_layer.update()
