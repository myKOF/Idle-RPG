"""Independently validate the preserved Walk and the delivered Attack1 geometry."""
import bpy, sys, json, struct, hashlib, math
import numpy as np
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree

source, fixed, blend, output = map(Path, sys.argv[sys.argv.index('--')+1:][:4])
def sha(b):return hashlib.sha256(b).hexdigest()
def glb(path):
    raw=path.read_bytes();n=struct.unpack_from('<I',raw,12)[0];j=json.loads(raw[20:20+n]);return j,raw[28+n:28+n+j['buffers'][0]['byteLength']]
old,oldbin=glb(source);new,newbin=glb(fixed)
assert newbin[:len(oldbin)]==oldbin,'Source mesh, weights, textures or Walk bytes changed'
for key in ['asset','nodes','skins','meshes','materials','images','textures','samplers','scenes','scene']:
    assert old.get(key)==new.get(key),key
assert new['accessors'][:len(old['accessors'])]==old['accessors']
assert new['bufferViews'][:len(old['bufferViews'])]==old['bufferViews']
assert len(new['animations'])==2 and new['animations'][0]==old['animations'][0]
clip=new['animations'][1];assert clip['name']=='Attack1' and len(clip['channels'])==219
build=json.loads(fixed.with_name('build.json').read_text());duration=3.6
def accessor(i):
    a=new['accessors'][i];v=new['bufferViews'][a['bufferView']];d={'SCALAR':1,'VEC3':3,'VEC4':4}[a['type']]
    assert a['componentType']==5126
    return np.frombuffer(newbin,dtype='<f4',count=a['count']*d,offset=v.get('byteOffset',0)+a.get('byteOffset',0)).reshape(-1,d)
seam=0
for c in clip['channels']:
    sampler=clip['samplers'][c['sampler']];times=accessor(sampler['input'])[:,0];v=accessor(sampler['output'])
    assert np.all(np.isfinite(v)) and np.all(np.diff(times)>0) and len(times)==433
    assert abs(times[0])<1e-6 and abs(times[-1]-duration)<1e-6
    if c['target']['path']=='rotation':
        assert np.max(np.abs(np.linalg.norm(v,axis=1)-1))<1e-5
        e=min(np.max(np.abs(v[0]-v[-1])),np.max(np.abs(v[0]+v[-1])))
    else:e=np.max(np.abs(v[0]-v[-1]))
    seam=max(seam,float(e))
assert seam<1e-5

def load(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if path.suffix=='.blend':bpy.ops.wm.open_mainfile(filepath=str(path))
    else:bpy.ops.import_scene.gltf(filepath=str(path))
    scene=bpy.context.scene;scene.render.fps=24
    arm=next(o for o in scene.objects if o.type=='ARMATURE');mesh=next(o for o in scene.objects if o.type=='MESH')
    action=next(a for a in bpy.data.actions if a.name=='Attack1')
    arm.animation_data.action=action;arm.animation_data.action_slot=action.slots[0]
    for track in arm.animation_data.nla_tracks:track.mute=True
    return arm,mesh
def frame(t):
    f=t*24;bpy.context.scene.frame_set(math.floor(f),subframe=f%1);bpy.context.view_layer.update()
def surface(mesh):
    e=mesh.evaluated_get(bpy.context.evaluated_depsgraph_get());me=e.to_mesh();v=np.empty(len(me.vertices)*3);me.vertices.foreach_get('co',v);e.to_mesh_clear();return v.reshape(-1,3)

arm,mesh=load(blend)
groups={g.index:g.name for g in mesh.vertex_groups}
def ids(names):
    return {v.index for v in mesh.data.vertices if sum(g.weight for g in v.groups if groups[g.group] in names)>.9}
regions={}
for name,bone in [('handR','spine_18'),('handL','chest'),('footL','rearFoot.L'),('footR','rearFoot.R'),('skull','spine_16')]:
    regions[name]=ids({bone,*[b.name for b in arm.pose.bones[bone].children_recursive]})
faces={n:[tuple(f.vertices) for f in mesh.data.polygons if set(f.vertices).issubset(index)] for n,index in regions.items()}
assert all(faces.values())
chains=[['spine_22','spine_21','spine_20','spine_19','spine_18'],['spine_06','spine_07','spine_08','spine_09','chest']]
chains += [['rearLeg.'+s+'_01','rearLwr.'+s,'rearHorselink.'+s,'rearFoot.'+s,'rearToe.'+s] for s in ['L','R']]
rest_lengths={(a,b):(arm.data.bones[b].head_local-arm.data.bones[a].head_local).length for chain in chains for a,b in zip(chain,chain[1:])}
rest_points=np.array([v.co for v in mesh.data.vertices]);edges=np.array([e.vertices[:] for e in mesh.data.edges]);edge_lengths=np.linalg.norm(rest_points[edges[:,0]]-rest_points[edges[:,1]],axis=1)
valid_edges=edge_lengths>1e-4;edges=edges[valid_edges];edge_lengths=edge_lengths[valid_edges]
times=sorted([duration*i/432 for i in range(433)]+[duration*(i+.371)/432 for i in range(432)])
native={};results={};equivalence=0
for label,path in [('blend',blend),('glb',fixed)]:
    arm,mesh=load(path);bone_error=link_error=jump=loop=0;previous=None;ends=[];issues=[]
    collision={p:0 for p in ['handR_footL','handR_footR','handL_footL','handL_footR','handR_skull','handL_skull','handR_handL','footL_footR']}
    foot_contact=left_contact=below_ground=0;edge_p95=edge_p99=edge_max=0;heads=[]
    for index,t in enumerate(times):
        frame(t);p=surface(mesh);assert np.all(np.isfinite(p))
        current=np.array([b.head for b in arm.pose.bones]);heads.append(current)
        if previous is not None:
            steps=np.linalg.norm(current-previous,axis=1);largest=float(steps.max());jump=max(jump,largest)
            if largest>.10:issues.append({'time':t,'step':largest,'bone':list(arm.pose.bones)[int(np.argmax(steps))].name})
        previous=current
        for b in arm.pose.bones:
            assert max(abs(s-1) for s in b.scale)<1e-5
            bone_error=max(bone_error,abs((b.tail-b.head).length-b.bone.length))
        for (a,b),length in rest_lengths.items():link_error=max(link_error,abs((arm.pose.bones[b].head-arm.pose.bones[a].head).length-length))
        floors={n:float(p[list(regions[n]),2].min()) for n in ['footL','footR','handL','handR']}
        foot_contact=max(foot_contact,abs(floors['footL']-build['ground']))
        if t<2.2 or t>3.599:
            contact=abs(floors['handL']-build['ground']);left_contact=max(left_contact,contact)
            if contact>.008:issues.append({'time':t,'leftHandGroundError':contact})
        below_ground=max(below_ground,build['ground']-min(floors.values()))
        vertices=[Vector(v) for v in p]
        trees={n:BVHTree.FromPolygons(vertices,polys,all_triangles=False) for n,polys in faces.items()}
        for pair in collision:
            a,b=pair.split('_');overlaps=len(trees[a].overlap(trees[b]));collision[pair]+=overlaps
            if overlaps:issues.append({'time':t,'collision':pair,'triangles':overlaps})
        ratios=np.linalg.norm(p[edges[:,0]]-p[edges[:,1]],axis=1)/edge_lengths
        edge_p95=max(edge_p95,float(np.percentile(ratios,95)));edge_p99=max(edge_p99,float(np.percentile(ratios,99)));edge_max=max(edge_max,float(ratios.max()))
        if index in [0,len(times)-1]:ends.append(p)
        if index%8==0 or index==len(times)-1:
            if label=='blend':native[index]=p
            else:equivalence=max(equivalence,float(np.max(np.abs(p-native[index]))))
    loop=float(np.max(np.abs(ends[0]-ends[1])))
    hi={b.name:i for i,b in enumerate(arm.pose.bones)};h=np.array(heads)
    ranges={n:np.ptp(h[:,hi[n]],axis=0).tolist() for n in ['hips','spine_16','spine_18','chest','tail_07','rearFoot.R']}
    result={'samples':len(times),'boneLengthError':bone_error,'limbJointLinkError':link_error,'maximumAdjacentJointStep':jump,'loopVertexError':loop,'supportFootGroundError':foot_contact,'supportHandGroundError':left_contact,'maximumBelowGround':below_ground,'triangleOverlaps':collision,'edgeStretchP95':edge_p95,'edgeStretchP99':edge_p99,'edgeStretchMaximum':edge_max,'jointMotionRanges':ranges}
    print('ATTACK1_CHECK',label,json.dumps(result),flush=True)
    print('ATTACK1_DIAGNOSTICS',json.dumps(issues),flush=True)
    assert bone_error<1e-5 and link_error<1e-5 and jump<.12 and loop<1e-5,result
    assert foot_contact<.005 and left_contact<.008 and below_ground<.008,result
    assert sum(collision.values())==0,result
    assert ranges['spine_18'][2]>1.0 and ranges['hips'][1]>.2 and ranges['spine_16'][2]>.15 and max(ranges['tail_07'])>.15
    results[label]=result
assert equivalence<2e-5,equivalence
report={'sourceSHA256':sha(source.read_bytes()),'glbSHA256':sha(fixed.read_bytes()),'bones':73,'clips':['Walk','Attack1'],'duration':duration,'sourceBinaryAndWalkPreserved':True,'channelLoopError':seam,'nativeGLBMaximumVertexDifference':equivalence,'checks':results}
output.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print('ATTACK1_VERIFY_PASS',flush=True)
