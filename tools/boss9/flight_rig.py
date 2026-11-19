"""Build an open flight rest shape and six wing supports, without animated scale."""
import bpy
from mathutils import Vector,Quaternion,Matrix

SIDES=[('Near',-1,'050'),('Far',1,'054')]

def smooth(a,b,x):
    t=max(0,min(1,(x-a)/(b-a)))
    return t*t*(3-2*t)

def install(arm,body,opened,opened_normals,body_inverse,tips):
    groups={g.index:g.name for g in body.vertex_groups}
    original=[{groups[g.group]:g.weight for g in v.groups} for v in body.data.vertices]
    original_normals=[n.vector.copy() for n in body.data.corner_normals]
    shape_ownership={}
    wing={'Bone_%03d'%i for i in range(47,73)}
    bpy.context.view_layer.objects.active=arm
    bpy.ops.object.mode_set(mode='EDIT')
    axes={}
    for label,side,root in SIDES:
        hinge=arm.data.edit_bones['Bone_'+root].head.copy()
        axis=body_inverse@opened[tips[label.lower()]]-hinge
        axes[label]=(hinge,axis)
        for part,s in [('Root',0),('Middle',.35),('Tip',.70)]:
            b=arm.data.edit_bones.new('FlightWing_'+label+part)
            b.head=hinge+axis*s;b.tail=hinge+axis*(s+.30)
            b.parent=arm.data.edit_bones['Bone_002']
    bpy.ops.object.mode_set(mode='OBJECT')
    new={b.name:body.vertex_groups.new(name=b.name) for b in arm.data.bones if b.name.startswith('FlightWing_')}
    changed=[]
    for v,w in zip(body.data.vertices,original):
        total=sum(a for n,a in w.items() if n in wing)
        if total<.025:continue
        x=abs(v.co.x);label='Near' if v.co.x<0 else 'Far'
        ownership=max(smooth(.18,.36,x),smooth(.18,.27,x)*smooth(1.1,1.4,v.co.z))
        shape_ownership[v.index]=ownership
        v.co=v.co.lerp(body_inverse@opened[v.index],ownership)
        if x<.33:blend=[(label+'Root',1)]
        elif x<.67:
            t=smooth(.33,.67,x);blend=[(label+'Root',1-t),(label+'Middle',t)]
        else:
            t=smooth(.67,1.03,x);blend=[(label+'Middle',1-t),(label+'Tip',t)]
        for g in list(v.groups):body.vertex_groups[g.group].remove([v.index])
        nonwing={n:a for n,a in w.items() if n not in wing};remaining=sum(nonwing.values())
        if ownership<1:
            if remaining>1e-5:
                for n,a in nonwing.items():body.vertex_groups[n].add([v.index],(1-ownership)*a/remaining,'REPLACE')
            else:body.vertex_groups['Bone_002'].add([v.index],1-ownership,'REPLACE')
        for n,a in blend:
            if a*ownership>1e-8:new['FlightWing_'+n].add([v.index],a*ownership,'REPLACE')
        changed.append(v.index)
    neighbors=[set() for _ in body.data.vertices]
    for e in body.data.edges:
        a,b=e.vertices;neighbors[a].add(b);neighbors[b].add(a)
    collar=[i for i in changed if .10<abs(body.data.vertices[i].co.x)<.28 and body.data.vertices[i].co.z<1.12]
    for _ in range(8):
        coords=[v.co.copy() for v in body.data.vertices]
        for i in collar:
            if neighbors[i]:body.data.vertices[i].co=coords[i].lerp(sum((coords[j] for j in neighbors[i]),Vector())/len(neighbors[i]),.22)
    # Rebind against the opened surface, rather than the old folded coordinates.
    # Otherwise formerly separated folds can end up adjacent with different weights.
    for i in changed:
        v=body.data.vertices[i];w=original[i];x=abs(v.co.x);label='Near' if v.co.x<0 else 'Far'
        hinge,axis=axes[label];s=(v.co-hinge).dot(axis)/axis.length_squared
        ownership=smooth(0,.22,s)
        if s<.20:blend=[(label+'Root',1)]
        elif s<.55:
            t=smooth(.20,.55,s);blend=[(label+'Root',1-t),(label+'Middle',t)]
        else:
            t=smooth(.55,.90,s);blend=[(label+'Middle',1-t),(label+'Tip',t)]
        for g in list(v.groups):body.vertex_groups[g.group].remove([i])
        nonwing={n:a for n,a in w.items() if n not in wing and not (ownership>.01 and n in {'Bone_041','Bone_046'})};remaining=sum(nonwing.values())
        if ownership<1:
            if remaining>1e-5:
                for n,a in nonwing.items():body.vertex_groups[n].add([i],(1-ownership)*a/remaining,'REPLACE')
            else:body.vertex_groups['Bone_002'].add([i],1-ownership,'REPLACE')
        for n,a in blend:
            if a*ownership>1e-8:new['FlightWing_'+n].add([i],a*ownership,'REPLACE')
        influences=sorted([(g.group,g.weight) for g in v.groups if g.weight>0],key=lambda a:-a[1])[:4]
        for g in list(v.groups):body.vertex_groups[g.group].remove([i])
        total=sum(a for _,a in influences)
        for group,a in influences:body.vertex_groups[group].add([i],a/total,'REPLACE')
    normals=[];rotation=body_inverse.to_3x3()
    for loop,old,posed in zip(body.data.loops,original_normals,opened_normals):
        n=old.lerp(rotation@posed,shape_ownership.get(loop.vertex_index,0))
        normals.append(n.normalized() if n.length>1e-6 else old)
    body.data.normals_split_custom_set(normals)
    body.data.update()
    return changed

def set_world(arm,name,matrix):
    p=arm.pose.bones[name]
    pre=p.parent.matrix@p.parent.bone.matrix_local.inverted()@p.bone.matrix_local
    p.matrix_basis=pre.inverted()@matrix

def beat(arm,label,angle,tip_lag,power):
    torso=arm.pose.bones['Bone_002'].matrix@arm.data.bones['Bone_002'].matrix_local.inverted()
    base=torso.to_quaternion()
    span=arm.data.bones['FlightWing_'+label+'Tip'].head_local-arm.data.bones['FlightWing_'+label+'Root'].head_local
    # Beat perpendicular to the actual unfolded span, rather than a global axis.
    axis=Vector((span.y,-span.x,0)).normalized();relative=Quaternion(axis,angle)
    previous_head=None;previous_native=None;previous_q=None
    for part,amount,fraction in [('Root',0,.40+.23*power),('Middle',.45,.85+.10*power),('Tip',1,1)]:
        name='FlightWing_'+label+part
        native=arm.data.bones[name].head_local
        head=torso@native if previous_head is None else previous_head+previous_q@(native-previous_native)
        q=base@Quaternion().slerp(relative,fraction)
        span=q@Vector((-1 if label=='Near' else 1,0,0));q=Quaternion(span,tip_lag*amount)@q
        matrix=q.to_matrix().to_4x4();matrix.translation=head-q@native
        set_world(arm,name,matrix@arm.data.bones[name].matrix_local)
        previous_head=head;previous_native=native;previous_q=q
    bpy.context.view_layer.update()
