"""Limit only Role6 wrist swing, retaining its original axial wrist rotation."""
import math
import numpy as np
from mathutils import Matrix, Quaternion, Vector


def limit_wrists(glb, degrees=48):
    nodes=glb.j['nodes'];by_name={n.get('name'):i for i,n in enumerate(nodes)}
    parents={c:i for i,n in enumerate(nodes)for c in n.get('children',[])}
    hands=[by_name[n]for n in ['RightHand','LeftHand']]
    report={};maximum=math.radians(degrees)
    for animation in glb.j['animations']:
        tracks={};duration=0
        for channel in animation['channels']:
            sampler=animation['samplers'][channel['sampler']]
            times=glb.array(sampler['input']).reshape(-1);values=glb.array(sampler['output'])
            tracks[(channel['target']['node'],channel['target']['path'])]=(times,values)
            duration=max(duration,float(times[-1]))

        def sample(node,path,time,default):
            track=tracks.get((node,path))
            if track is None:return default
            times,values=track;k=int(np.searchsorted(times,time,side='right'))
            if k==0:return values[0]
            if k==len(times):return values[-1]
            t=(time-times[k-1])/(times[k]-times[k-1])
            if path=='rotation':
                a,b=values[k-1],values[k]
                q=Quaternion((a[3],a[0],a[1],a[2])).slerp(Quaternion((b[3],b[0],b[1],b[2])),float(t))
                return (q.x,q.y,q.z,q.w)
            return values[k-1]*(1-t)+values[k]*t

        # Keep original knots as well as 120Hz samples. A 48 degree target leaves
        # margin beneath the user's 50 degree maximum during interpolation.
        times=sorted(set([float(t)for t in np.linspace(0,duration,max(2,math.ceil(duration*120)+1))]+
                         [float(t)for hand in hands for t in tracks[(hand,'rotation')][0]]))
        outputs={h:[]for h in hands};stats={nodes[h]['name']:{'beforeMaxDegrees':0,'afterMaxDegrees':0,'changedSamples':0}for h in hands}
        for time in times:
            world={}
            def matrix(i):
                if i in world:return world[i]
                node=nodes[i]
                if 'matrix'in node:local=Matrix(np.array(node['matrix']).reshape(4,4)).transposed()
                else:
                    q=sample(i,'rotation',time,node.get('rotation',(0,0,0,1)))
                    local=Matrix.LocRotScale(Vector(sample(i,'translation',time,node.get('translation',(0,0,0)))),
                                            Quaternion((q[3],q[0],q[1],q[2])),
                                            Vector(sample(i,'scale',time,node.get('scale',(1,1,1)))))
                world[i]=(matrix(parents[i])@local)if i in parents else local
                return world[i]
            for hand in hands:
                h=matrix(hand);forearm=matrix(parents[hand]);axis=(h.translation-forearm.translation).normalized()
                current=h.to_quaternion();forward=current@Vector((0,1,0));angle=forward.angle(axis)
                stat=stats[nodes[hand]['name']];stat['beforeMaxDegrees']=max(stat['beforeMaxDegrees'],math.degrees(angle))
                if angle>maximum:
                    bend_axis=forward.cross(axis).normalized()
                    current=Quaternion(bend_axis,angle-maximum)@current
                    stat['changedSamples']+=1
                forward=current@Vector((0,1,0));stat['afterMaxDegrees']=max(stat['afterMaxDegrees'],math.degrees(forward.angle(axis)))
                local=forearm.to_quaternion().inverted()@current;local.normalize()
                row=[local.x,local.y,local.z,local.w]
                if outputs[hand] and sum(a*b for a,b in zip(row,outputs[hand][-1]))<0:row=[-v for v in row]
                outputs[hand].append(row)
        shared_input=glb.add(times,'SCALAR')
        for channel in animation['channels']:
            hand=channel['target']['node']
            if hand not in hands or channel['target']['path']!='rotation':continue
            if stats[nodes[hand]['name']]['changedSamples']==0:continue
            sampler={'input':shared_input,'output':glb.add(outputs[hand],'VEC4'),'interpolation':'LINEAR'}
            channel['sampler']=len(animation['samplers']);animation['samplers'].append(sampler)
        report[animation['name']]=stats
    return report
