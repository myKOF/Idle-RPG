"""Pose the approved lizard using physical joint links, without changing its rig."""
import bpy, math
import numpy as np
from mathutils import Vector, Matrix, Quaternion, Euler

def smooth(a,b,t):
    u=max(0,min(1,(t-a)/(b-a)));return u*u*(3-2*u)

def affine(q,center,target):
    m=q.normalized().to_matrix().to_4x4();m.translation=target-m.to_3x3()@center;return m

def segment_q(a,b,normal,desired):
    def basis(v,n):
        y=v.normalized();x=(n-y*n.dot(y)).normalized();z=x.cross(y).normalized();x=y.cross(z)
        return Matrix((x,y,z)).transposed()
    return (basis(b,desired)@basis(a,normal).inverted()).to_quaternion()

class Rig:
    arms={'R':['spine_22','spine_21','spine_20','spine_19','spine_18'], 'L':['spine_06','spine_07','spine_08','spine_09','chest']}
    digits={'R':[['spine_32','spine_31','spine_30'],['spine_35','spine_34','spine_33'],['spine_38','spine_37','spine_36'],['spine_41','spine_40','spine_39']],
            'L':[['spine_29','spine_28','spine_27'],['neck1','neck2','head'],['frontUpr.R','frontLwr.R','frontToe.R'],['frontLwr.L','frontHorselink.L','frontToe.L']]}
    legs={s:['rearLeg.'+s+'_01','rearLwr.'+s,'rearHorselink.'+s,'rearFoot.'+s,'rearToe.'+s] for s in ['R','L']}
    def __init__(self):
        self.arm=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
        self.mesh=next(o for o in bpy.context.scene.objects if o.type=='MESH')
        idle=next(a for a in bpy.data.actions if a.name=='Idle')
        self.arm.animation_data.action=idle;self.arm.animation_data.action_slot=idle.slots[0]
        for track in self.arm.animation_data.nla_tracks:track.mute=True
        bpy.context.scene.frame_set(0);self.update()
        self.baseline={p.name:p.matrix_basis.copy() for p in self.arm.pose.bones}
        self.base={p.name:p.matrix.copy() for p in self.arm.pose.bones}
        self.rest={b.name:b.matrix_local.copy() for b in self.arm.data.bones}
        self.points=np.array([v.co for v in self.mesh.data.vertices],dtype=float)
        evaluated=self.mesh.evaluated_get(bpy.context.evaluated_depsgraph_get());me=evaluated.to_mesh()
        self.initial_points=np.array([v.co for v in me.vertices],dtype=float);evaluated.to_mesh_clear()
        self.groups={g.index:g.name for g in self.mesh.vertex_groups}
        self.weights={n:np.array([sum(g.weight for g in v.groups if self.groups[g.group]==n) for v in self.mesh.data.vertices]) for n in self.base}
        self.hands={s:Hand(self,s) for s in ['R','L']}
        self.max_clamp=0
    def update(self):bpy.context.view_layer.update()
    def reset(self):
        for p in self.arm.pose.bones:p.rotation_mode='QUATERNION';p.matrix_basis=self.baseline[p.name]
        self.update()
    def set(self,name,m):
        p=self.arm.pose.bones[name]
        pre=p.parent.matrix@p.parent.bone.matrix_local.inverted()@p.bone.matrix_local if p.parent else p.bone.matrix_local
        p.matrix_basis=pre.inverted()@m
        p.rotation_quaternion.normalize();p.scale=(1,1,1);self.update()
        # Imported bone inheritance can leave a small translation residual
        # after matrix-basis decomposition. Correct the head, not the scale.
        for _ in range(2):
            error=m.translation-p.head
            if error.length<2e-7:break
            p.location+=pre.to_3x3().inverted()@error;self.update()
    def rotate(self,name,angles):
        p=self.arm.pose.bones[name];c=p.head.copy();q=Euler(tuple(math.radians(x) for x in angles),'XYZ').to_quaternion()
        self.set(name,affine(q,c,c)@p.matrix)
    def translate(self,name,v):
        m=self.arm.pose.bones[name].matrix.copy();m.translation+=Vector(v);self.set(name,m)
    def arm_fk(self,side,upper_direction,forearm_direction,q,opening,spread,floor_limit,claw_target=None,pole_blend=0,shape_matrices=None):
        """Chest carries the shoulder; upper arm and forearm have separate arcs."""
        collar_name,upper,lower,wrist_name,palm_name=self.arms[side]
        r=[self.base[n].translation for n in [upper,lower,wrist_name]]
        collar=self.arm.pose.bones[collar_name];center=collar.head.copy()
        link=self.arm.pose.bones[upper].head-center
        lateral=Vector((-1 if side=='R' else 1,0,.02)).normalized()*link.length
        direction=Quaternion().slerp(link.rotation_difference(lateral),spread)
        self.set(collar_name,affine(direction,center,center)@collar.matrix)
        root=self.arm.pose.bones[upper].head.copy()
        elbow=root+upper_direction.normalized()*(r[1]-r[0]).length
        wrist=elbow+forearm_direction.normalized()*(r[2]-r[1]).length
        shaped=shape_matrices if shape_matrices is not None else self.hands[side].shape(opening)[0]
        local=self.hands[side].skin(shaped,self.hands[side].claws)-np.array(r[2])
        if claw_target is not None:
            goal=claw_target-q@Vector(local.mean(axis=0));v=goal-root
            lengths=[(r[i+1]-r[i]).length for i in range(2)]
            maximum=sum(lengths)*.999
            if v.length>maximum:
                # Scapula follows the reach before limiting the hand target.
                cl=(root-center).length;d=(goal-center).length
                if d>(cl+maximum)*.999:
                    limited=center+(goal-center).normalized()*(cl+maximum)*.999
                    self.max_clamp=max(self.max_clamp,(limited-goal).length);goal=limited;d=(goal-center).length
                direction=(goal-center).normalized();along=(cl*cl-maximum*maximum+d*d)/(2*d)
                lateral=root-center-direction*(root-center).dot(direction)
                if lateral.length<1e-6:lateral=Vector((-1 if side=='R' else 1,0,0)).cross(direction)
                moved=center+direction*along+lateral.normalized()*math.sqrt(max(0,cl*cl-along*along))
                delta=(root-center).rotation_difference(moved-center)
                self.set(collar_name,affine(delta,center,center)@self.arm.pose.bones[collar_name].matrix)
                oldroot=root;root=self.arm.pose.bones[upper].head.copy();elbow+=root-oldroot;v=goal-root
            if v.length>maximum:
                goal=root+v.normalized()*maximum
                self.max_clamp=max(self.max_clamp,(goal-(claw_target-q@Vector(local.mean(axis=0)))).length)
            v=goal-root;d=v.length;direction=v.normalized()
            # Stay outside/back/below the moving wrist axis; a parallel pole
            # makes the elbow plane flip during the fast inward release.
            outward=Vector((-1 if side=='R' else 1,1.60,-1.20)).normalized()
            pole=(elbow-root).normalized().lerp(outward,pole_blend)
            pole-=direction*pole.dot(direction);pole.normalize()
            along=(lengths[0]**2-lengths[1]**2+d*d)/(2*d)
            elbow=root+direction*along+pole*math.sqrt(max(0,lengths[0]**2-along*along));wrist=goal
        floor=float((local@np.array(q.to_matrix()).T+np.array(wrist))[:,2].min())
        if floor<floor_limit:
            # Lift the shoulder-to-wrist arc, preserving both physical lengths.
            v=wrist-root;z=v.z+(floor_limit-floor);assert z<v.length
            goal=Vector((v.x,v.y,0)).normalized()*math.sqrt(v.length*v.length-z*z);goal.z=z
            lift=v.rotation_difference(goal);elbow=root+lift@(elbow-root);wrist=root+lift@v
        normal=(r[1]-r[0]).cross(r[2]-r[1]).normalized()
        desired=(elbow-root).cross(wrist-elbow).normalized()
        for i,(name,start,end) in enumerate([(upper,root,elbow),(lower,elbow,wrist)]):
            delta=segment_q(r[i+1]-r[i],end-start,normal,desired)
            self.set(name,affine(delta,r[i],start)@self.base[name])
        hand=affine(q,r[2],wrist)
        self.set(wrist_name,hand@self.base[wrist_name]);self.set(palm_name,hand@self.base[palm_name])
        for n,m in shaped.items():self.set(n,hand@m)
        return wrist+q@Vector(local.mean(axis=0))
    def arm_ik(self,side,palm,q,opening,envelope):
        collar_name,upper,lower,wrist_name,palm_name=self.arms[side]
        names=[upper,lower,wrist_name,palm_name];r=[self.base[n].translation for n in names]
        hand=affine(q,r[3],palm);wrist=hand@r[2]
        collar=self.arm.pose.bones[collar_name];center=collar.head.copy();root=self.arm.pose.bones[upper].head.copy()
        lengths=[(r[i+1]-r[i]).length for i in range(2)];cl=(root-center).length;maximum=sum(lengths)*.995
        v=wrist-center;d=v.length
        if d>(cl+maximum)*.999:wrist=center+v.normalized()*(cl+maximum)*.999
        if (wrist-root).length>maximum:
            direction=(wrist-center).normalized();d=(wrist-center).length
            along=(cl*cl-maximum*maximum+d*d)/(2*d)
            lateral=root-center-direction*(root-center).dot(direction)
            if lateral.length<1e-6:lateral=Vector((-1 if side=='R' else 1,0,0)).cross(direction)
            goal=center+direction*along+lateral.normalized()*math.sqrt(max(0,cl*cl-along*along))
            self.set(collar_name,affine((root-center).rotation_difference(goal-center),center,center)@collar.matrix)
            root=self.arm.pose.bones[upper].head.copy()
        self.max_clamp=max(self.max_clamp,(palm-(wrist+q@(r[3]-r[2]))).length)
        direction=(wrist-root).normalized();d=(wrist-root).length
        base_axis=(r[2]-r[0]).normalized();base_pole=r[1]-r[0]-base_axis*(r[1]-r[0]).dot(base_axis);base_pole.normalize()
        # Keep the pole out/back from the lifting wrist axis; near-parallel
        # poles cause a rapid elbow-plane flip even with smooth hand targets.
        goal=Vector((-1 if side=='R' else 1,.80,.20)).normalized()
        pole=base_pole.lerp(goal,envelope);pole-=direction*pole.dot(direction);pole.normalize()
        along=(lengths[0]**2-lengths[1]**2+d*d)/(2*d)
        elbow=root+direction*along+pole*math.sqrt(max(0,lengths[0]**2-along*along))
        normal=(r[1]-r[0]).cross(r[2]-r[1]).normalized();desired=(elbow-root).cross(wrist-elbow).normalized()
        for i,(start,end) in enumerate([(root,elbow),(elbow,wrist)]):
            delta=segment_q(r[i+1]-r[i],end-start,normal,desired)
            self.set(names[i],affine(delta,r[i],start)@self.base[names[i]])
        hand=affine(q,r[2],wrist)
        self.set(wrist_name,hand@self.base[wrist_name]);self.set(palm_name,hand@self.base[palm_name])
        for n,m in self.hands[side].shape(opening)[0].items():self.set(n,hand@m)
    def leg_ik(self,side):
        # Lock hock/ankle/toe together: fixing just the toe bone still lets
        # blended ankle weights crush or twist the visible foot surface.
        names=self.legs[side];r=[self.base[n].translation for n in names[:3]]
        root=self.arm.pose.bones[names[0]].head.copy();target=r[2];v=target-root;d=v.length;direction=v.normalized()
        a,b=[(r[i+1]-r[i]).length for i in range(2)]
        assert abs(a-b)<d<a+b,'Fixed hock is unreachable: '+side
        base_axis=(r[2]-r[0]).normalized();pole=r[1]-r[0]-base_axis*(r[1]-r[0]).dot(base_axis)
        pole-=direction*pole.dot(direction);pole.normalize()
        along=(a*a-b*b+d*d)/(2*d);knee=root+direction*along+pole*math.sqrt(max(0,a*a-along*along))
        p=[root,knee,target];normal=(r[1]-r[0]).cross(r[2]-r[1]).normalized();desired=(knee-root).cross(target-knee).normalized()
        for i in range(2):self.set(names[i],affine(segment_q(r[i+1]-r[i],p[i+1]-p[i],normal,desired),r[i],p[i])@self.base[names[i]])
        for n in names[2:]:self.set(n,self.base[n])
    def head(self,pitch,weight,orientation=None):
        skull='spine_16';neck='spine_17';p=self.arm.pose.bones[skull]
        current=(p.matrix@self.rest[skull].inverted()).to_quaternion()
        desired=current.slerp(orientation if orientation is not None else Euler((math.radians(-pitch),0,0),'XYZ').to_quaternion(),weight)
        delta=desired@current.inverted();n=self.arm.pose.bones[neck];c=n.head.copy()
        neck_loc=n.location.copy();head_loc=p.location.copy()
        self.set(neck,affine(Quaternion().slerp(delta,.45),c,c)@n.matrix);n.location=neck_loc;self.update()
        current=(p.matrix@self.rest[skull].inverted()).to_quaternion();c=p.head.copy()
        self.set(skull,affine(desired@current.inverted(),c,c)@p.matrix);p.location=head_loc;self.update()

class Hand:
    def __init__(self,rig,side):
        self.rig=rig;self.side=side;self.palm=rig.arms[side][-1];self.chains=rig.digits[side]
        self.head=rig.base[self.palm].translation.copy()
        self.names={self.palm,*[b.name for b in rig.arm.pose.bones[self.palm].children_recursive]}
        weight=sum(rig.weights[n] for n in self.names)
        self.claws=np.flatnonzero((weight>.99999)&(rig.points[:,2]<-.40)).tolist()
        assert len(self.claws)>30
        self.tip_groups=[np.flatnonzero(rig.weights[c[-1]]>.85).tolist() for c in self.chains]
        self.base_groups=[np.flatnonzero(rig.weights[c[0]]>.85).tolist() for c in self.chains[1:]]
        self.forward=(sum((rig.base[c[0]].translation for c in self.chains[1:]),Vector())/3-self.head).normalized()
        self.side_axis=(rig.base[self.chains[-1][0]].translation-rig.base[self.chains[1][0]].translation).normalized()
        hint=self.side_axis.cross(self.forward).normalized()
        if hint.z>0:hint.negate()
        initial=rig.initial_points
        self.pad=[]
        for f in rig.mesh.data.polygons:
            if not all(rig.weights[self.palm][i]>.65 for i in f.vertices):continue
            a,b,c=[Vector(initial[i]) for i in list(f.vertices)[:3]]
            if (b-a).cross(c-a).normalized().dot(hint)>.5:
                ids=list(f.vertices);self.pad.extend((ids[0],ids[i],ids[i+1]) for i in range(1,len(ids)-1))
        assert self.pad,'Missing palm surface '+side
        normal=Vector()
        for a,b,c in self.pad:normal+=(Vector(initial[b])-Vector(initial[a])).cross(Vector(initial[c])-Vector(initial[a]))
        self.normal=normal.normalized();self.forward-=self.normal*self.forward.dot(self.normal);self.forward.normalize()
        self.side_axis=self.forward.cross(self.normal).normalized()
        self.terminal={c[-1]:(Vector(initial[self.tip_groups[j]].mean(axis=0))-rig.base[c[-1]].translation).normalized() for j,c in enumerate(self.chains)}
        self.thumb_sign=1 if (rig.base[self.chains[0][0]].translation-self.head).dot(self.side_axis)>0 else -1
        self.cache={}
    def skin(self,changed,indices=None):
        rig=self.rig;source=rig.points if indices is None else rig.points[indices];points=np.zeros_like(source)
        for name in self.names:
            m=np.array(changed.get(name,rig.base[name])@rig.rest[name].inverted())
            weights=rig.weights[name] if indices is None else rig.weights[name][indices]
            points+=weights[:,None]*(source@m[:3,:3].T+m[:3,3])
        return points
    def shape(self,amount):
        amount=round(amount,8)
        if amount in self.cache:return self.cache[amount]
        rig=self.rig;changed={}
        for chain,spread in zip(self.chains,[self.thumb_sign*1.05,-.38,0,.38]):
            heads=[rig.base[n].translation for n in chain]
            aim=(self.forward+self.side_axis*spread).normalized()
            directions=[aim,(aim+self.normal*.10).normalized(),(aim+self.normal*.22).normalized()]
            start=heads[0].copy()
            for i,name in enumerate(chain):
                old=heads[i+1]-heads[i] if i<2 else self.terminal[name]
                q=Quaternion().slerp(old.rotation_difference(directions[i]),amount)
                changed[name]=affine(q,heads[i],start)@rig.base[name]
                if i<2:start+=q@(heads[i+1]-heads[i])
        points=self.skin(changed,self.claws)
        result=(changed,Vector(points.mean(axis=0))-self.head)
        self.cache[amount]=result;return result
    def orientation(self,normal,forward):
        n=Vector(normal).normalized();f=Vector(forward);f=(f-n*f.dot(n)).normalized();s=f.cross(n).normalized()
        return (Matrix((s,f,n)).transposed()@Matrix((self.side_axis,self.forward,self.normal)).transposed().inverted()).to_quaternion()
