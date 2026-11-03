"""Blender: mirror source motion, fit existing hero rig and append Attack4.

blender -b --python mirror_attack.py -- Attack4.glb role.glb candidate.glb candidate.blend report.json
Every existing animation and appearance buffer in the input is preserved.
"""
import copy
import hashlib
import json
import math
from pathlib import Path
import struct
import sys

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector


class Glb:
    def __init__(self, file):
        self.raw = Path(file).read_bytes()
        n = struct.unpack_from('<I', self.raw, 12)[0]
        self.j = json.loads(self.raw[20:20+n])
        self.b = bytearray(self.raw[28+n:])

    def array(self, i):
        a = self.j['accessors'][i]
        v = self.j['bufferViews'][a['bufferView']]
        k = {'SCALAR':1, 'VEC2':2, 'VEC3':3, 'VEC4':4, 'MAT4':16}[a['type']]
        dt = np.dtype({5121:'u1', 5123:'<u2', 5125:'<u4', 5126:'<f4'}[a['componentType']])
        return np.ndarray((a['count'],k), dtype=dt, buffer=self.b,
                          offset=v.get('byteOffset',0)+a.get('byteOffset',0),
                          strides=(v.get('byteStride',dt.itemsize*k),dt.itemsize)).copy()

    def add(self, values, kind):
        a = np.asarray(values,dtype='<f4')
        while len(self.b)%4: self.b.append(0)
        vi = len(self.j['bufferViews'])
        self.j['bufferViews'].append({'buffer':0,'byteOffset':len(self.b),'byteLength':a.nbytes})
        self.b.extend(a.tobytes())
        ai = len(self.j['accessors'])
        item = {'bufferView':vi,'componentType':5126,'count':len(a),'type':kind}
        if kind == 'SCALAR': item.update(min=[float(a.min())],max=[float(a.max())])
        self.j['accessors'].append(item)
        return ai

    def save(self, file):
        self.j['buffers']=[{'byteLength':len(self.b)}]
        text=json.dumps(self.j,separators=(',',':')).encode()
        text+=b' '*(-len(text)%4)
        binary=self.b+b'\0'*(-len(self.b)%4)
        Path(file).write_bytes(struct.pack('<III',0x46546c67,2,28+len(text)+len(binary))+
                               struct.pack('<II',len(text),0x4e4f534a)+text+
                               struct.pack('<II',len(binary),0x004e4942)+binary)


def quat(xyzw):
    return Quaternion((xyzw[3],*xyzw[:3]))


def rest(g):
    return [(Vector(n.get('translation',[0,0,0])),quat(n.get('rotation',[0,0,0,1])),
             Vector(n.get('scale',[1,1,1]))) for n in g.j['nodes']]


def parents(g):
    return {c:i for i,n in enumerate(g.j['nodes']) for c in n.get('children',[])}


def worlds(pose, parent):
    out={}
    def get(i):
        if i not in out:
            t,q,s=pose[i]
            m=Matrix.LocRotScale(t,q,s)
            out[i]=(get(parent[i])@m) if i in parent else m
        return out[i]
    for i in range(len(pose)): get(i)
    return out


def tracks(g, anim):
    out={}
    for c in anim['channels']:
        s=anim['samplers'][c['sampler']]
        assert s.get('interpolation','LINEAR') == 'LINEAR'
        out[(c['target']['node'],c['target']['path'])]=(g.array(s['input'])[:,0],g.array(s['output']))
    return out


def sample(base, channels, t):
    result=[(p.copy(),q.copy(),s.copy()) for p,q,s in base]
    for (i,path),(ts,vs) in channels.items():
        j=int(np.searchsorted(ts,t,side='right')-1)
        j=max(0,min(j,len(ts)-1));k=min(j+1,len(ts)-1)
        mix=max(0,min(1,(t-ts[j])/(ts[k]-ts[j]))) if ts[k]>ts[j] else 0
        p,q,s=result[i]
        if path=='rotation': q=quat(vs[j]).slerp(quat(vs[k]),mix)
        elif path=='translation': p=Vector(vs[j]).lerp(Vector(vs[k]),mix)
        elif path=='scale': s=Vector(vs[j]).lerp(Vector(vs[k]),mix)
        result[i]=(p,q,s)
    return result


S=Matrix.Diagonal(Vector((-1,1,1)))
def mirror_q(q): return (S@q.to_matrix()@S).to_quaternion().normalized()
def mirror_v(v): return Vector((-v.x,v.y,v.z))
def swap(name):
    return name.replace('Left','TEMP').replace('Right','Left').replace('TEMP','Right')
def deg(q): return math.degrees(q.angle)
def smooth(u):
    u=max(0,min(1,u))
    return u*u*(3-2*u)


def foot_data(g):
    p=g.j['meshes'][0]['primitives'][0]['attributes']
    pos=g.array(p['POSITION']);j=g.array(p['JOINTS_0']);w=g.array(p['WEIGHTS_0'])
    skin=g.j['skins'][0]
    names=[g.j['nodes'][n]['name'] for n in skin['joints']]
    feet=[i for i,n in enumerate(names) if 'Foot' in n or 'Toe' in n]
    mask=((np.isin(j,feet)*w).sum(1)>.7)&(pos[:,1]<.3)
    inv=g.array(skin['inverseBindMatrices']).reshape((-1,4,4)).transpose((0,2,1))
    return np.column_stack((pos[mask],np.ones(mask.sum()))),j[mask],w[mask],inv,skin['joints']


def foot_min(data,W):
    p,j,w,inv,nodes=data
    matrices=np.array([np.array(W[i]) for i in nodes])@inv
    result=np.zeros_like(p)
    for lane in range(4):
        result+=np.einsum('nij,nj->ni',matrices[j[:,lane]],p)*w[:,lane,None]
    return float(result[:,1].min())


source,body,out,blend,report=map(Path,sys.argv[sys.argv.index('--')+1:])
src,dst=Glb(source),Glb(body)
old_json=copy.deepcopy(dst.j)
old_bin=bytes(dst.b)
sr,dr=rest(src),rest(dst)
sp,dp=parents(src),parents(dst)
sn={n['name']:i for i,n in enumerate(src.j['nodes'])}
dn={n['name']:i for i,n in enumerate(dst.j['nodes'])}
SW,DW=worlds(sr,sp),worlds(dr,dp)
original=src.j['animations'][0]
tr=tracks(src,original)
duration=max(float(ts[-1]) for ts,_ in tr.values())
fps=30
times=np.linspace(0,duration,round(duration*fps)+1)
mapping={'Hips':'Hips','Spine02':'Spine','Spine01':'Spine1','Spine':'Spine2','neck':'Neck','Head':'Head'}
for side in ('Left','Right'):
    for part in ('Shoulder','Arm','ForeArm','Hand','UpLeg','Leg','Foot','ToeBase'):
        mapping[side+part]=swap(side+part)
source_id={n:sn['mixamorig:'+s] for n,s in mapping.items()}
direction={side+a:side+b for side in ('Left','Right') for a,b in
           [('Arm','ForeArm'),('ForeArm','Hand'),('UpLeg','Leg'),('Leg','Foot'),('Foot','ToeBase')]}
scale=DW[dn['Hips']].translation.y/SW[sn['mixamorig:Hips']].translation.y
start=worlds(sample(sr,tr,0),sp)[sn['mixamorig:Hips']].translation
sword_q=dr[dn['Sword']][1].copy()
grip=dst.j['asset'].get('extras',{}).get('gripFrame',{})
blade_local=Vector(grip.get('bladeAxisInSword',[0,1,0]))
edge_local=Vector(grip.get('edgeAxisInSword',[1,0,0]))
normal_local=Vector(grip.get('normalAxisInSword',[0,0,1]))
blade_in_hand=sword_q@blade_local
hand_correction=blade_in_hand.rotation_difference(Vector((0,1,0)))
poses=[];rotations={n:[] for n in mapping};rotations['Sword']=[];hips=[]
errors=[];rows=[];last_roll=None
source_feet,body_feet=foot_data(src),foot_data(dst)
for t in times:
    W=worlds(sample(sr,tr,float(t)),sp)
    pose=[(p.copy(),q.copy(),s.copy()) for p,q,s in dr]
    hp=W[sn['mixamorig:Hips']].translation
    delta=mirror_v(hp-start)*scale
    target=DW[dn['Hips']].translation+delta
    pose[dn['Hips']]=(DW[dp[dn['Hips']]].inverted()@target,pose[dn['Hips']][1],pose[dn['Hips']][2])
    for name in mapping:
        si=source_id[name];di=dn[name]
        q=mirror_q(W[si].to_quaternion())@mirror_q(SW[si].to_quaternion()).inverted()@DW[di].to_quaternion()
        if name in direction:
            child=direction[name]
            wanted=mirror_v(W[source_id[child]].translation-W[si].translation).normalized()
            localdir=DW[di].to_quaternion().inverted()@(DW[dn[child]].translation-DW[di].translation).normalized()
            current=q@localdir
            q=current.rotation_difference(wanted)@q
        elif name.endswith('Hand'):
            # Use the mirrored source wrist->middle knuckle as the hand direction.
            middle=sn['mixamorig:'+mapping[name]+'Middle1']
            wanted=mirror_v(W[middle].translation-W[si].translation).normalized()
            q=(q@Vector((0,1,0))).rotation_difference(wanted)@q
        parent_q=worlds(pose,dp)[dp[di]].to_quaternion() if di in dp else Quaternion()
        p,_,s=pose[di]
        pose[di]=(p,(parent_q.inverted()@q).normalized(),s)
    # Keep the blade and fist together in their existing grip frame. The fixed
    # anatomical offset is the same construction used by alignGripToHand.
    rh=dn['RightHand'];rf=dn['RightForeArm']
    p,q,s=pose[rh]
    pose[rh]=(p,q@hand_correction,s)
    natural=worlds(pose,dp)
    sword_world=natural[dn['Sword']].to_quaternion()
    blade=sword_world@blade_local
    edge=sword_world@edge_local
    # A double-edged sword has +/-X sharp edges, and +/-Z broad faces. Align
    # the sharp-edge axis with the enemy direction projected across the blade.
    forward=Vector((0,0,1))
    desired=forward-blade*forward.dot(blade)
    if desired.length>.03:
        desired.normalize()
        theta=math.atan2(blade.dot(edge.cross(desired)),edge.dot(desired))
        if last_roll is None:
            while theta>math.pi/2: theta-=math.pi
            while theta<-math.pi/2: theta+=math.pi
        else:
            choices=[theta+k*math.pi for k in range(-4,5)]
            theta=min(choices,key=lambda a:abs(a-last_roll))
    else: theta=last_roll or 0
    last_roll=theta
    # Correct the active swing, then release the correction during recovery.
    # Keeping a blade edge locked forward through recovery caused a 180-degree
    # palm flip even though a double-edged blade looked unchanged.
    weight=smooth(float(t)/.25)*(1-smooth((float(t)-1.5)/.45))
    theta*=weight
    p,q,s=pose[rh]
    pose[rh]=(p,(q@Quaternion(blade_in_hand.normalized(),theta)).normalized(),s)
    final=worlds(pose,dp)
    # Preserve the source's planted-foot height despite different leg lengths.
    source_floor=foot_min(source_feet,W)*scale
    ground_correction=source_floor-foot_min(body_feet,final)
    hi=dn['Hips'];p,q,s=pose[hi]
    local_delta=DW[dp[hi]].inverted().to_3x3()@Vector((0,ground_correction,0))
    pose[hi]=(p+local_delta,q,s)
    final=worlds(pose,dp)
    fw=final[dn['Sword']].to_quaternion()
    normal=fw@normal_local;edge=fw@edge_local;blade=fw@blade_local
    for name,child in direction.items():
        actual=(final[dn[child]].translation-final[dn[name]].translation).normalized()
        wanted=mirror_v(W[source_id[child]].translation-W[source_id[name]].translation).normalized()
        errors.append(math.degrees(actual.angle(wanted)))
    # Blade root/tip in the exact model bind coordinates (centimeters).
    tip=final[dn['Sword']]@Vector(grip.get('bladeTipInSword',[5.3,(.115+.7396067202091218)*100,.5]))
    root=final[dn['Sword']]@Vector(grip.get('bladeRootInSword',[5.3,11.5,.5]))
    rows.append({'t':float(t),'rightHand':list(final[rh].translation),'tip':list(tip),'bladeRoot':list(root),
                 'blade':list(blade),'edge':list(edge),'normal':list(normal),
                 'edgeForward':abs(edge.dot(forward)),'faceForward':abs(normal.dot(forward)),
                 'gripCorrectionDeg':math.degrees(theta),'edgeWeight':weight,
                 'footMin':foot_min(body_feet,final),'sourceFootMin':source_floor})
    for name in rotations:
        q=pose[dn[name]][1].normalized()
        vals=[q.x,q.y,q.z,q.w]
        if rotations[name] and sum(a*b for a,b in zip(vals,rotations[name][-1]))<0: vals=[-v for v in vals]
        rotations[name].append(vals)
    hips.append(list(pose[dn['Hips']][0]));poses.append(pose)

anim={'name':'Attack4','channels':[],'samplers':[]}
time_accessor=dst.add(times,'SCALAR')
def channel(name,kind,values):
    si=len(anim['samplers'])
    anim['samplers'].append({'input':time_accessor,'output':dst.add(values,'VEC4' if kind=='rotation' else 'VEC3'),'interpolation':'LINEAR'})
    anim['channels'].append({'sampler':si,'target':{'node':dn[name],'path':kind}})
for name,values in rotations.items(): channel(name,'rotation',values)
channel('Hips','translation',hips)
dst.j['animations'].append(anim)
assert dst.j['animations'][:-1]==old_json['animations']
assert dst.j['meshes']==old_json['meshes'] and dst.j['nodes']==old_json['nodes']
assert bytes(dst.b[:len(old_bin)])==old_bin
dst.save(out)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(out))
for ob in bpy.context.scene.objects:
    ob['motion_authoring']='Mirror Shield_Push_Left across X=0, swap left/right, retain existing right-hand grip; candidate only'
bpy.ops.wm.save_as_mainfile(filepath=str(blend))
sha=lambda file:hashlib.sha256(Path(file).read_bytes()).hexdigest()
result={'sourceSha256':sha(source),'bodySha256':sha(body),'outputSha256':sha(out),
        'sourceClip':original['name'],'candidateClip':'Attack4','duration':duration,'fps':fps,'frames':len(times),
        'mirroredAxis':'X','wholeBodyLeftRightSwapped':True,'existingAnimationsUnchanged':True,
        'meshAndBackSwordRemovalUnchanged':True,'fixedSwordLocalRotation':True,
        'maxLimbDirectionErrorDeg':max(errors),'maxFaceForwardDuringSwing':max(r['faceForward'] for r in rows if r['edgeWeight']>.999),
        'maxFootHeightError':max(abs(r['footMin']-r['sourceFootMin']) for r in rows),
        'maxGripRollCorrectionDeg':max(abs(r['gripCorrectionDeg']) for r in rows),
        'rows':rows,'blenderVersion':bpy.app.version_string}
Path(report).write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
print(json.dumps({k:v for k,v in result.items() if k!='rows'}))
