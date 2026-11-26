"""Author a heavy quadruped collapse, appending one non-looping death clip."""
import bpy,sys,json,struct,hashlib,math
from pathlib import Path
import numpy as np
from mathutils import Vector,Quaternion,Euler
sys.dont_write_bytecode=True
sys.path.insert(0,str(Path(__file__).parent))
from rig import Rig,smooth,affine
source,blend,out=map(Path,sys.argv[sys.argv.index('--')+1:][:3])
spec=json.loads(Path(__file__).with_name('spec.json').read_text());duration=spec['duration'];fps=60 if '--draft' in sys.argv else spec['authorFPS']
raw=source.read_bytes();assert hashlib.sha256(raw).hexdigest()==spec['sourceSHA256']
n=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+n]);oldbin=raw[28+n:28+n+doc['buffers'][0]['byteLength']]
assert [a['name'] for a in doc['animations']]==spec['sourceClips']
bpy.ops.wm.open_mainfile(filepath=str(blend));scene=bpy.context.scene;scene.render.fps=24;rig=Rig();out.mkdir(parents=True,exist_ok=True)
base_p={n:m.translation.copy() for n,m in rig.base.items()};base_q={n:m.to_quaternion() for n,m in rig.base.items()};base_local={n:m.to_quaternion() for n,m in rig.baseline.items()}
fields=set().union(*(p.keys() for p in spec['poses']))-{'t'};rows=[];current={f:0.0 for f in fields}
forced={}
for key in spec['poses']:
    current.update({n:v for n,v in key.items() if n!='t'});rows.append((key['t'],current.copy()))
def value(name,t):
    if name in forced:return forced[name]
    if name not in fields:return 0.0
    if t<=rows[0][0]:return rows[0][1][name]
    if t>=rows[-1][0]:return rows[-1][1][name]
    i=next(i for i in range(len(rows)-1) if rows[i][0]<=t<rows[i+1][0]);a,b=rows[i],rows[i+1];h=b[0]-a[0];u=(t-a[0])/h;slopes=[]
    for j in [i,i+1]:
        if j==0 or j==len(rows)-1:m=0
        else:
            l=(rows[j][1][name]-rows[j-1][1][name])/(rows[j][0]-rows[j-1][0]);r=(rows[j+1][1][name]-rows[j][1][name])/(rows[j+1][0]-rows[j][0])
            m=0 if l*r<=0 else 2*l*r/(l+r)
        slopes.append(m)
    return (2*u**3-3*u*u+1)*a[1][name]+(u**3-2*u*u+u)*h*slopes[0]+(-2*u**3+3*u*u)*b[1][name]+(u**3-u*u)*h*slopes[1]

def rotate(name,axis,angle):
    local_axis=base_q[name].inverted()@Vector(axis).normalized();p=rig.arm.pose.bones[name]
    p.rotation_quaternion=p.rotation_quaternion@Quaternion(local_axis,math.radians(angle))
hinges={}
for side in ['R','L']:
    for key,names in [('elbow',rig.arms[side][1:4]),('knee',rig.legs[side][:3])]:
        a,b,c=[base_p[n] for n in names];hinges[(key,side)]=(b-a).cross(c-b).normalized()

def surface():
    e=rig.mesh.evaluated_get(bpy.context.evaluated_depsgraph_get());m=e.to_mesh();p=np.empty(len(m.vertices)*3);m.vertices.foreach_get('co',p);e.to_mesh_clear();return p.reshape(-1,3)
groups=rig.groups
core_names={'hips','spine_02','spine_03','spine2','spine_05','spine_06','spine_22'}
core=[v.index for v in rig.mesh.data.vertices if sum(g.weight for g in v.groups if groups[g.group] in core_names)>.85]
assert len(core)>100
start_min=float(rig.initial_points[:,2].min());pivot=base_p['hips'];tails=['tail1','tail2','tail3','tail_04','tail4','tail_06','tail_07']
def pose(t):
    t=min(t,spec['holdFrom'])
    rig.reset()
    howl=spec.get('howl',{});roar=0
    if howl:
        roar=math.sin((t-howl['riseEnd'])*math.pi*4.6)*smooth(.12,.30,t)*(1-smooth(howl['holdEnd']-.07,howl['holdEnd']+.08,t))
    rotate('hips',(1,0,0),value('pelvis',t))
    for name,weight in [('spine_02',.20),('spine_03',.25),('spine2',.25),('spine_05',.30)]:
        rotate(name,(1,0,0),(value('torso',t)+roar*1.3)*weight);rotate(name,(0,0,1),value('torsoYaw',t)*weight)
    rotate('spine_17',(1,0,0),value('neck',t));rotate('spine_17',(0,0,1),value('neckYaw',t))
    rotate('spine_16',(1,0,0),value('head',t)-roar*.4);rotate('spine_16',(0,0,1),value('headYaw',t));rotate('spine_26',(1,0,0),value('jaw',t)+roar*1.5)
    for side in ['R','L']:
        yaw=value('armYaw'+side,t)
        for c in spec.get('armClearance',[]):
            if c['side']==side:yaw+=c['degrees']*smooth(c['start'],c['peakStart'],t)*(1-smooth(c['peakEnd'],c['end'],t))
        own=rig.arms[side];rotate(own[1],(1,0,0),value('armPitch'+side,t));rotate(own[1],(0,0,1),yaw);rotate(own[1],(0,1,0),value('arm'+side,t));rotate(own[2],hinges[('elbow',side)],value('elbow'+side,t))
        rotate(own[-1],rig.hands[side].side_axis,value('palm'+side,t))
        for chain in rig.digits[side]:
            rotate(chain[0],rig.hands[side].side_axis,value('curl',t)*.7)
            rotate(chain[1],rig.hands[side].side_axis,value('curl',t)*.3)
        leg=rig.legs[side];rotate(leg[0],(0,1,0),value('thigh'+side,t));rotate(leg[1],hinges[('knee',side)],value('knee'+side,t))
    for i,name in enumerate(tails):
        delayed=max(0,t-i*.035)
        wave=0
        onset=spec['impactTime']-.22
        if delayed>onset:wave=7*math.sin((delayed-onset)*12)*math.exp(-4*(delayed-onset))*smooth(onset,onset+.12,delayed)*(1-smooth(spec['holdFrom']-.25,spec['holdFrom'],t))
        rotate(name,(1,0,0),(value('tailPitch',delayed)*(.60**i)+wave*(.80**i)))
        rotate(name,(0,0,1),value('tailYaw',delayed)*([1,.35,-.12,.08,.05,.03,.02][i])+roar*(.4**i))
    rig.update()
    rotation=Euler((0,math.radians(value('roll',t)),0),'XYZ').to_quaternion();translation=Vector((value('x',t),value('y',t),0))
    rig.set('root',affine(rotation,pivot,pivot+translation)@rig.base['root'])
    before=surface();floor=spec['ground']+(start_min-spec['ground'])*(1-smooth(0,.35,t));offset=floor-float(before[:,2].min())
    impact=spec['impactTime'];bounce=.012*max(0,math.sin((t-(impact-.04))*math.pi/.18))*(1-smooth(impact+.03,impact+.16,t)) if impact-.04<t<impact+.16 else 0
    rig.translate('root',(0,0,offset+bounce))
    points=surface()
    return {'roll':value('roll',t),'minimumZ':float(points[:,2].min()),'coreGap':float(points[core,2].min()-spec['ground']),'root':list(rig.arm.pose.bones['root'].head)}

action=bpy.data.actions.new(spec['id']);rig.arm.animation_data.action=action
if '--probe' in sys.argv:
    from mathutils.bvhtree import BVHTree
    roots={'handR':'spine_18','handL':'chest','footR':'rearFoot.R','footL':'rearFoot.L','skull':'spine_16'}
    regions={n:{bone,*[b.name for b in rig.arm.pose.bones[bone].children_recursive]} for n,bone in roots.items()}
    ids={n:{v.index for v in rig.mesh.data.vertices if sum(g.weight for g in v.groups if groups[g.group] in names)>.9} for n,names in regions.items()}
    ids['torso']=set(core)
    faces={n:[tuple(f.vertices) for f in rig.mesh.data.polygons if set(f.vertices).issubset(indices)] for n,indices in ids.items()}
    pairs=[('handR','handL'),('handR','skull'),('handL','skull'),('handR','footR'),('handR','footL'),('handL','footR'),('handL','footL'),('footR','footL'),('handR','torso'),('handL','torso')]
    if '--sweep' in sys.argv:
        import itertools
        parameters=[p.split(':') for p in sys.argv[sys.argv.index('--sweep')+1].split(';')];assert all(n in fields for n,_ in parameters)
        cases=list(itertools.product(*[[float(v) for v in values.split(',')] for _,values in parameters]));assert len(cases)<=100
        results=[]
        for values in cases:
            forced.clear();forced.update(zip([p[0] for p in parameters],values));sample_time=float(sys.argv[sys.argv.index('--sweep-time')+1]) if '--sweep-time' in sys.argv else duration;entry=pose(sample_time);points=surface()
            trees={n:BVHTree.FromPolygons([Vector(p) for p in points],f,all_triangles=False) for n,f in faces.items()}
            overlaps={a+'_'+b:len(trees[a].overlap(trees[b])) for a,b in pairs};collision={n:v for n,v in overlaps.items() if v}
            clearance=min(trees[region].find_nearest(Vector(points[i]))[3] for region in ['skull','torso','handR'] for i in ids['handL']) if not collision else 0
            results.append({'parameters':forced.copy(),'coreGap':entry['coreGap'],'clearance':clearance,'overlaps':collision})
        results.sort(key=lambda r:(bool(r['overlaps']),-r['clearance']))
        print('DEATH_SWEEP',json.dumps(results),flush=True);sys.exit(0)
    hits={};maximum_speed=0;previous=None;previous_t=None;keys=[]
    probe_times=[float(v) for v in sys.argv[sys.argv.index('--probe-times')+1].split(',')] if '--probe-times' in sys.argv else [i*.05 for i in range(round(duration/.05)+1)]
    for t in probe_times:
        entry=pose(t);points=surface();joints=np.array([p.head for p in rig.arm.pose.bones])
        if previous is not None:maximum_speed=max(maximum_speed,float(np.linalg.norm(joints-previous,axis=1).max())/(t-previous_t))
        previous=joints;previous_t=t;trees={n:BVHTree.FromPolygons([Vector(p) for p in points],f,all_triangles=False) for n,f in faces.items()}
        for a,b in pairs:
            count=len(trees[a].overlap(trees[b]))
            if count:hits.setdefault(a+'_'+b,[]).append([t,count])
        if round(t*100)%25==0 or '--probe-times' in sys.argv:
            low=int(points[:,2].argmin());weights=sorted([(groups[g.group],g.weight) for g in rig.mesh.data.vertices[low].groups],key=lambda p:-p[1])
            keys.append({'time':t,**entry,'regionFloor':{n:float(points[list(indices),2].min()) for n,indices in ids.items()},'lowestWeights':weights})
    print('DEATH_PROBE',json.dumps({'maximumJointSpeed':maximum_speed,'keys':keys,'overlaps':hits}),flush=True);sys.exit(0)

converted=Euler((-math.pi/2,0,0)).to_quaternion();channels={n:{'translation':[],'rotation':[],'scale':[]} for n in rig.base};last={};trace=[]
def local(name):
    p=rig.arm.pose.bones[name];q=converted@(p.matrix.to_quaternion()@rig.rest[name].to_quaternion().inverted())@converted.inverted();pos=converted@p.head
    if p.parent:
        pq=converted@(p.parent.matrix.to_quaternion()@rig.rest[p.parent.name].to_quaternion().inverted())@converted.inverted();pos=pq.inverted()@(pos-converted@p.parent.head);q=pq.inverted()@q
    return list(pos),[q.x,q.y,q.z,q.w],list(p.scale)
times=[i/fps for i in range(round(duration*fps)+1)]
for index,t in enumerate(times):
    if index%120==0:print('DEATH_FRAME',index,'/',len(times),flush=True)
    scene.frame_set(math.floor(t*24),subframe=t*24%1);entry=pose(t)
    for p in rig.arm.pose.bones:
        q=p.rotation_quaternion.copy()
        if p.name in last:q.make_compatible(last[p.name]);p.rotation_quaternion=q
        last[p.name]=q
        for kind in ['location','rotation_quaternion','scale']:p.keyframe_insert(kind,frame=t*24,group=p.name)
        for kind,value_ in zip(['translation','rotation','scale'],local(p.name)):channels[p.name][kind].append(value_)
    trace.append({'time':t,**entry})
for layer in action.layers:
    for strip in layer.strips:
        for bag in strip.channelbags:
            for c in bag.fcurves:
                for k in c.keyframe_points:k.interpolation='LINEAR'
for a in bpy.data.actions:a.use_fake_user=True
scene.frame_start=0;scene.frame_end=round(duration*24);scene.frame_set(0);bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(out/'boss9_death.blend'),compress=True)
data=bytearray(oldbin)
def append(values,kind):
    while len(data)%4:data.append(0)
    offset=len(data);flat=[x for v in values for x in v] if isinstance(values[0],list) else values;data.extend(struct.pack('<%df'%len(flat),*flat))
    view=len(doc['bufferViews']);doc['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':len(flat)*4});a={'bufferView':view,'componentType':5126,'count':len(values),'type':kind}
    if kind=='SCALAR':a.update(min=[min(values)],max=[max(values)])
    index=len(doc['accessors']);doc['accessors'].append(a);return index
ta=append(times,'SCALAR');clip={'name':spec['id'],'samplers':[],'channels':[],'extras':{'previewOnly':True,'duration':duration,'loop':False,'holdFrom':spec['holdFrom']}}
for c in doc['animations'][2]['channels']:
    target=c['target'];name=doc['nodes'][target['node']]['name'];kind=target['path'];idx=len(clip['samplers']);output=append(channels[name][kind],'VEC4' if kind=='rotation' else 'VEC3')
    clip['samplers'].append({'input':ta,'output':output,'interpolation':'LINEAR'});clip['channels'].append({'sampler':idx,'target':target})
doc['animations'].append(clip);doc['buffers'][0]['byteLength']=len(data);encoded=json.dumps(doc,separators=(',',':'),ensure_ascii=False).encode()
while len(encoded)%4:encoded+=b' '
while len(data)%4:data.append(0)
binary=struct.pack('<III',0x46546c67,2,28+len(encoded)+len(data))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+struct.pack('<II',len(data),0x004e4942)+data
(out/'boss9_death.glb').write_bytes(binary)
report={'sourceSHA256':hashlib.sha256(raw).hexdigest(),'glbSHA256':hashlib.sha256(binary).hexdigest(),'sourceBinaryPreserved':data[:len(oldbin)]==oldbin,'spec':spec,'sampleFPS':fps,'bones':len(rig.base),'trace':trace,'coreIndices':core,'hands':{s:{'palm':h.palm,'chains':h.chains,'clawIndices':h.claws,'tipGroups':h.tip_groups,'padTriangles':h.pad} for s,h in rig.hands.items()}}
(out/'build.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print('DEATH_AUTHORED',len(times),'poses',flush=True)
