"""Bend the original Role6 finger surface while retaining its source UVs.

Called by prepare_role6.py. Finger joint rotations are baked into the supplied
hand geometry, then collapsed onto the unchanged game's hand/forearm joints.
No replacement mesh, reflection, remesh, or generated fingers are used.
"""
import math
import numpy as np
from mathutils import Matrix, Quaternion, Vector


def pose_original_hand(raw, source_positions, source_faces, selected_faces,
                       factor, side, target, forearm_fit, names, grip, source_colors):
    skin = raw.j['skins'][0]
    bone_names = [raw.j['nodes'][n]['name'].replace('mixamorig:', '') for n in skin['joints']]
    rest = {}
    for name, value in zip(bone_names, raw.array(skin['inverseBindMatrices'])):
        matrix = Matrix(value.reshape(4, 4)).transposed().inverted()
        matrix.translation *= factor
        rest[name] = matrix
    parents = {}
    for node in raw.j['nodes']:
        for child in node.get('children', []):
            parents[raw.j['nodes'][child]['name'].replace('mixamorig:', '')] = node['name'].replace('mixamorig:', '')

    hand = side + 'Hand'
    wrist = rest[hand].translation
    knuckles=[rest[hand+finger+'1'].translation for finger in ['Index','Middle','Ring','Pinky']]
    forward=(sum(knuckles,Vector((0,0,0)))/4-wrist).normalized()
    across = rest[hand+'Index1'].translation-rest[hand+'Pinky1'].translation
    across = (across-forward*across.dot(forward)).normalized()
    cross = forward.cross(across).normalized()
    source_basis = Matrix((forward, across, cross)).transposed()
    palm = -cross if side == 'Right' else cross
    flex_axis = forward.cross(palm).normalized()
    angles = {'Index': (38, 82, 70), 'Middle': (43, 88, 70),
              'Ring': (48, 88, 72), 'Pinky': (53, 90, 70),
              'Thumb': (35, 45, 50)} if side == 'Right' else {
                  'Index': (65, 95, 65), 'Middle': (75, 100, 65),
                  'Ring': (75, 100, 65), 'Pinky': (80, 105, 60),
                  'Thumb': (45, 55, 65)}
    H, S = target['RightHand'], target['Sword']
    blade = (S.to_quaternion() @ Vector((0, 1, 0))).normalized()
    hand_forward = (H.to_quaternion() @ Vector((0, 1, 0))).normalized()
    # Keep the true wrist direction. Forcing it perpendicular to the blade
    # adds about 46 degrees of artificial wrist bend to this reference rig.
    across_target=(blade-hand_forward*hand_forward.dot(blade)).normalized()
    if side == 'Left':
        mirror = Matrix.Diagonal(Vector((-1, 1, 1)))
        right_arm = (target['RightHand'].translation-target['RightForeArm'].translation).normalized()
        left_arm = (target['LeftHand'].translation-target['LeftForeArm'].translation).normalized()
        align = (mirror @ right_arm).rotation_difference(left_arm).to_matrix()
        hand_forward, across_target = align @ mirror @ hand_forward, align @ mirror @ across_target
    target_basis = Matrix((hand_forward, across_target, hand_forward.cross(across_target))).transposed()
    fit = target_basis @ Matrix.Diagonal(Vector((.78, .80, .80))) @ source_basis.inverted()
    rp = raw.j['meshes'][0]['primitives'][0]
    sj = raw.array(rp['attributes']['JOINTS_0'])
    sw = raw.array(rp['attributes']['WEIGHTS_0'])
    uv = raw.array(rp['attributes']['TEXCOORD_0'])
    faces = source_faces[selected_faces]
    used = sorted(set(int(i) for i in faces.reshape(-1)))
    remap = {old: new for new, old in enumerate(used)}
    source_points=[Vector(source_positions[i])for i in used]
    source_uv=[Vector(uv[i])for i in used]
    source_color=[Vector(source_colors[i])for i in used]
    original_normals=raw.array(rp['attributes']['NORMAL'])
    source_normals=[Vector(original_normals[i])for i in used]
    triangles=[[remap[int(i)]for i in face]for face in faces]
    provenance=np.flatnonzero(selected_faces).tolist()
    # Linear cuts add bending segments to the original coarse finger faces.
    # Their original shape and UV interpolation stay exact before posing.
    for _ in range(2):
        edge_points={};new_faces=[];new_provenance=[]
        def midpoint(a,b):
            key=tuple(sorted((a,b)))
            if key not in edge_points:
                edge_points[key]=len(source_points)
                source_points.append((source_points[a]+source_points[b])*.5)
                source_uv.append((source_uv[a]+source_uv[b])*.5)
                source_color.append((source_color[a]+source_color[b])*.5)
                source_normals.append((source_normals[a]+source_normals[b]).normalized())
            return edge_points[key]
        for (a,b,c),original_face in zip(triangles,provenance):
            ab,bc,ca=midpoint(a,b),midpoint(b,c),midpoint(c,a)
            new_faces.extend([(a,ab,ca),(ab,b,bc),(ca,bc,c),(ab,bc,ca)])
            new_provenance.extend([original_face]*4)
        triangles,provenance=new_faces,new_provenance
    points, weights, joints = [], [], []
    clearance_adjustments = []
    roots={finger:rest[hand+finger+'1'].translation for finger in ['Index','Middle','Ring','Pinky','Thumb']}
    tips={finger:rest[hand+finger+'4'].translation for finger in roots}
    world_palm=-target_basis.col[2].normalized() if side=='Right' else target_basis.col[2].normalized()
    finger_lengths={}
    for finger,root in roots.items():
        if finger=='Thumb':continue
        values=[]
        for p in source_points:
            u=(p-root).dot(forward)
            nearest=min(['Index','Middle','Ring','Pinky'],key=lambda f:abs((p-roots[f]).dot(across)))
            if nearest==finger and u>0 and abs((p-root).dot(across))<.018:values.append(u)
        finger_lengths[finger]=max((tips[finger]-root).dot(forward),max(values,default=0))
    finger_bounds={}
    for finger in ['Index','Middle','Ring','Pinky']:
        root=roots[finger];length=(tips[finger]-root).dot(forward);values=[]
        for q in source_points:
            u=(q-root).dot(forward)
            nearest=min(['Index','Middle','Ring','Pinky'],key=lambda f:abs((q-roots[f]).dot(across)))
            if nearest==finger and u>0 and abs((q-root).dot(across))<.018:
                rest_center=root+(tips[finger]-root)*(u/length);values.append((q-rest_center).dot(palm))
        finger_bounds[finger]=(float(np.quantile(values,.04)),float(np.quantile(values,.96)))
    mean_band=sum((roots[f]-wrist).dot(across)for f in finger_bounds)/4
    contact_tags=[]
    plate_triangle_mask=[]
    for tri in triangles:
        c=sum((source_points[i]for i in tri),Vector((0,0,0)))/3-wrist
        f,a,d=c.dot(forward),c.dot(across),c.dot(-palm)
        thumb_side_limit=(roots['Index']-wrist).dot(across)+.008
        plate_triangle_mask.append(d>-.004 and a<thumb_side_limit and ((f-.076)/.050)**2+((a-.003)/.058)**2<1.15)
    rigid_plate_vertices={i for tri,yes in zip(triangles,plate_triangle_mask)if yes for i in tri}
    plate_vertices=[i in rigid_plate_vertices for i in range(len(source_points))]
    pose_pin_vertices=[]
    for point,color in zip(source_points,source_color):
        q=point-wrist;f,a,d=q.dot(forward),q.dot(across),q.dot(-palm)
        pose_pin_vertices.append(-.004<f<.108 and abs(a)<.058 and d>-.002 and color.x>.30 and color.y>.23)
    for vertex_index,(point,color) in enumerate(zip(source_points,source_color)):
        q=point-wrist;longitudinal=q.dot(forward);lateral=q.dot(across);dorsal=q.dot(-palm)
        plate_vertex=pose_pin_vertices[vertex_index]
        placed=target[hand].translation+fit@(point-wrist)
        contact_tag=None
        # Auto-rig weights on this generated glove mix unrelated fingers.
        # Deform each original finger along a continuous arc measured from its
        # own source knuckle/tip, leaving the original palm plate intact.
        best=None
        for finger in ['Index','Middle','Ring','Pinky']:
            root=roots[finger];u=(point-root).dot(forward)
            distance=abs((point-root).dot(across))
            if u>-.004 and (best is None or distance<best[0]):best=(distance,finger,u)
        thumb_root=roots['Thumb'];thumb_direction=(tips['Thumb']-thumb_root).normalized()
        thumb_u=(point-thumb_root).dot(thumb_direction)
        thumb_distance=((point-thumb_root)-thumb_direction*thumb_u).length
        is_thumb=thumb_u>.006 and thumb_distance<.030 and (point-wrist).dot(forward)<.115
        if best is not None and best[0]<.024:
            _,finger,u=best;root=roots[finger];length=finger_lengths[finger]
            u=max(0,u);t=max(0,min(1,u/length));rest_length=(tips[finger]-root).dot(forward)
            rest_center=root+(tips[finger]-root)*(u/rest_length)
            across_offset=(point-rest_center).dot(across);palm_offset=(point-rest_center).dot(palm)
            if side=='Right':
                knuckle=target[hand].translation+fit@(root-wrist)
                radial=knuckle-grip-blade*(knuckle-grip).dot(blade)
                direction=1 if blade.cross(radial).dot(hand_forward)>0 else -1
                theta=math.radians(200)*t
                rotate=Matrix.Rotation(direction*theta,3,blade)
                lower,upper=finger_bounds[finger]
                palmar=max(0,min(1,(palm_offset-lower)/max(.001,upper-lower)))
                radius=.01435+(1-palmar)*.0115
                desired_band=((root-wrist).dot(across)-mean_band)*.94+across_offset*.94
                wrapped=grip+blade*desired_band+(rotate@radial.normalized())*radius
                transition=max(0,min(1,t/.18));transition=transition*transition*(3-2*transition)
                placed=placed.lerp(wrapped,transition)
                contact_tag=(finger,palmar,t)
            else:
                full_angle=math.radians(235);radius=length/full_angle;theta=min(1,u/length)*full_angle
                curled=root+forward*(radius*math.sin(theta))+palm*(radius*(1-math.cos(theta)))
                curled+=across*across_offset+(palm*math.cos(theta)-forward*math.sin(theta))*palm_offset
                placed=target[hand].translation+fit@(curled-wrist)
        def smoothstep(value):
            value=max(0,min(1,value));return value*value*(3-2*value)
        thumb_blend=smoothstep(((point-wrist).dot(across)-(roots['Index']-wrist).dot(across)-.010)/.020)*smoothstep((thumb_u-.002)/.015)*smoothstep((.195-(point-wrist).dot(forward))/.035)
        if (point-wrist).dot(forward)<.08 and abs((point-wrist).dot(across))<.03:thumb_blend=0
        if thumb_blend:
            length=(tips['Thumb']-thumb_root).length
            candidates=[(p-thumb_root).dot(thumb_direction)for p in source_points
                        if ((p-thumb_root)-thumb_direction*(p-thumb_root).dot(thumb_direction)).length<.035
                        and (p-wrist).dot(forward)<.195]
            length=max(length,max(candidates,default=0));t=max(0,min(1,thumb_u/length));v=1-t
            offset=point-thumb_root-thumb_direction*thumb_u
            if side=='Right':
                p0=target[hand].translation+fit@(thumb_root-wrist);direction=(fit@thumb_direction).normalized()
                p1=p0+direction*(length*.78/3);p3=grip+blade*.028+world_palm*.029;p2=p3+blade*.012-hand_forward*.012
                curve=p0*v**3+p1*(3*v*v*t)+p2*(3*v*t*t)+p3*t**3
                tangent=(p1-p0)*(3*v*v)+(p2-p1)*(6*v*t)+(p3-p2)*(3*t*t)
                thumb_placed=curve+direction.rotation_difference(tangent.normalized())@(fit@offset)
            else:
                p0=thumb_root;p1=p0+thumb_direction*(length/3)
                p3=roots['Index']-forward*.018-across*.005+palm*.026;p2=p3+across*.018-forward*.012
                curve=p0*v**3+p1*(3*v*v*t)+p2*(3*v*t*t)+p3*t**3
                tangent=(p1-p0)*(3*v*v)+(p2-p1)*(6*v*t)+(p3-p2)*(3*t*t)
                curled=curve+thumb_direction.rotation_difference(tangent.normalized())@offset
                thumb_placed=target[hand].translation+fit@(curled-wrist)
            placed=placed.lerp(thumb_placed,thumb_blend)
        if plate_vertex:placed=target[hand].translation+fit@(point-wrist);contact_tag=None
        if thumb_blend>.5:contact_tag=None
        contact_tags.append(contact_tag)
        # The hand back plate is a separate rigid part, not a blended extension
        # of the forearm plate. The small authored seam permits wrist motion.
        seam=max(0,min(1,(.025-longitudinal)/.04))*.003
        placed+=hand_forward*seam
        if side=='Right' and not plate_vertex:
            offset=placed-grip;distance=offset.dot(blade);radial=offset-blade*distance
            if -.045<distance<.055 and .0001<radial.length<.0143:
                amount=.0143-radial.length;placed+=radial.normalized()*amount;clearance_adjustments.append(amount)
        points.append(placed);joints.append([names.index(hand),0,0,0]);weights.append([1,0,0,0])
    # Relax bent source finger faces without replacing their topology/UVs.
    adjacency=[set()for _ in points]
    for face in triangles:
        for i in face:adjacency[i].update(j for j in face if j!=i)
    relaxation=[]
    for p,pinned in zip(source_points,pose_pin_vertices):
        f=(p-wrist).dot(forward);a=abs((p-wrist).dot(across))
        relaxation.append(0 if pinned else (max(0,min(1,(f-.075)/.04)) if f>.075 else (max(0,min(1,(a-.035)/.02)) if f>.02 else 0)))
    for _ in range(5):
        for strength in [.45,-.48]:
            previous=[p.copy()for p in points]
            for i,neighbors in enumerate(adjacency):
                if neighbors and relaxation[i]:
                    average=sum((previous[j]for j in neighbors),Vector((0,0,0)))/len(neighbors)
                    points[i]=previous[i]+(average-previous[i])*(strength*relaxation[i])
    finger_contacts={finger:0 for finger in finger_bounds}
    contact_vertices={finger:[]for finger in finger_bounds}
    if side=='Right':
        for i,(p,tag) in enumerate(zip(points,contact_tags)):
            offset=p-grip;distance=offset.dot(blade);radial=offset-blade*distance
            if radial.length<.0001:continue
            if tag is not None:
                finger,palmar,t=tag
                if .25<t<.98:
                    radius=max(.01435,min(.0285,radial.length))
                    if palmar>.82:radius=.01435;finger_contacts[finger]+=1;contact_vertices[finger].append(i)
                    points[i]=grip+blade*distance+radial.normalized()*radius
            elif -.045<distance<.055 and radial.length<.0143:
                points[i]=p+radial.normalized()*(.0143-radial.length)
    # Keep the accepted skin/finger pose independent of the armor split.
    # Apply rigid plate positions only after skin relaxation, so changing the
    # plate boundary cannot pull the already approved fingers around.
    for i,original in enumerate(source_points):
        if plate_vertices[i]:
            seam=max(0,min(1,(.025-(original-wrist).dot(forward))/.04))*.003
            points[i]=target[hand].translation+fit@(original-wrist)+hand_forward*seam
    # Pose only the original thumb with two rigid phalanges and a dual-
    # quaternion transition. The accepted four-finger surface is untouched.
    thumb_report={}
    thumb_normals={}
    if side=='Right':
        mcp_source=rest[hand+'Thumb3'].translation;ip_source=rest[hand+'Thumb4'].translation
        thumb_axis=(ip_source-mcp_source).normalized()
        thumb_edge=max((roots['Index']-wrist).dot(across)+.030,(mcp_source-wrist).dot(across)+.012)
        candidates=[p for p in source_points if (p-wrist).dot(across)>thumb_edge
                    and (p-wrist).dot(forward)<(roots['Index']-wrist).dot(forward)+.035
                    and (p-mcp_source).dot(thumb_axis)>0]
        furthest=max((p-mcp_source).dot(thumb_axis)for p in candidates)
        ends=[p for p in candidates if (p-mcp_source).dot(thumb_axis)>furthest-.004]
        tip_source=Vector(np.median(np.array([list(p)for p in ends]),axis=0))
        root_rest=target[hand].translation+fit@(mcp_source-wrist)
        root_radial=root_rest-grip-blade*(root_rest-grip).dot(blade)
        # Cup the native thenar pad against the handle before closing the thumb.
        # Leaving its open-hand position unchanged forces a long, flat reach.
        root_world=root_rest-root_radial.normalized()*.024+blade*.008
        ip_rest=target[hand].translation+fit@(ip_source-wrist)
        tip_rest=target[hand].translation+fit@(tip_source-wrist)
        length1=(ip_rest-root_rest).length;length2=(tip_rest-ip_rest).length
        blade_front=(S.to_quaternion()@Vector((0,0,1))).normalized()
        desired=grip+blade*.034+blade_front*.020
        desired-=(S.to_quaternion()@Vector((1,0,0)))*.014
        delta=desired-root_world;distance=max(abs(length1-length2)+.001,min(delta.length,length1+length2-.001))
        direction=delta.normalized();tip_target=root_world+direction*distance
        along=(length1**2-length2**2+distance**2)/(2*distance)
        height=math.sqrt(max(0,length1**2-along**2))
        bend=blade-direction*blade.dot(direction)
        if bend.length<.001:bend=hand_forward-direction*hand_forward.dot(direction)
        bend.normalize();ip_target=root_world+direction*along+bend*height
        def orient(rest_direction,posed_direction,pad_direction):
            # The glove's original thumb already has thickness and a pad.
            # Swing its native cross-section, rather than twisting the entire
            # web until its palm normal points exactly at the handle center.
            return rest_direction.normalized().rotation_difference(posed_direction.normalized())
        q1=orient(ip_rest-root_rest,ip_target-root_world,grip-ip_target)
        q2=orient(tip_rest-ip_rest,tip_target-ip_target,grip-tip_target)
        t1=root_world-q1@root_rest;t2=ip_target-q2@ip_rest
        def dual_components(qa,ta,qb,tb,weight):
            ar=np.array(list(qa));br=np.array(list(qb))
            ad=np.array(list(Quaternion((0,*ta))@qa))*.5;bd=np.array(list(Quaternion((0,*tb))@qb))*.5
            if ar@br<0:br=-br;bd=-bd
            real=ar*(1-weight)+br*weight;dual=ad*(1-weight)+bd*weight;norm=np.linalg.norm(real)
            real/=norm;dual/=norm;dual-=real*(real@dual)
            qr=Quaternion(real);qd=Quaternion(dual);translation=qd@qr.conjugated()
            return qr,Vector((translation.x,translation.y,translation.z))*2
        groups={}
        for i,p in enumerate(source_points):groups.setdefault(tuple(round(v,6)for v in p),[]).append(i)
        edited=[];normal_fit=fit.inverted().transposed();rest_surface_override={}
        for ids in groups.values():
            original=source_points[ids[0]]
            lateral=(original-wrist).dot(across);edge=(roots['Index']-wrist).dot(across)
            longitudinal=(original-wrist).dot(forward)
            web_edge=edge+.010+.20*(longitudinal-.070)
            strength=smoothstep((lateral-web_edge+.005)/.010)
            thumb_base=longitudinal<(roots['Index']-wrist).dot(forward) and lateral>edge-.005
            if (not strength and not thumb_base) or longitudinal>(roots['Index']-wrist).dot(forward)+.018:continue
            # The thumb web lies beyond the diagonal edge of the real index
            # finger. Do not use the old nearest-finger label here: it mixed
            # one side of the original thumb into the index finger surface.
            rest_point=target[hand].translation+fit@(original-wrist)
            source_u=(original-mcp_source).dot(thumb_axis)
            ip_u=(ip_source-mcp_source).length
            distal_u=(tip_source-mcp_source).dot(thumb_axis)
            if source_u>0 and lateral>edge+.012:
                if source_u<ip_u:center_source=mcp_source+thumb_axis*source_u
                else:center_source=ip_source+(tip_source-ip_source)*min(1,(source_u-ip_u)/max(.001,distal_u-ip_u))
                center_rest=target[hand].translation+fit@(center_source-wrist)
                offset=rest_point-center_rest
                axis_rest=(fit@thumb_axis).normalized()
                axial=axis_rest*offset.dot(axis_rest);radial=offset-axial
                if radial.length>.0001:
                    radius=.0095-.003*max(0,min(1,source_u/max(.001,distal_u)))
                    rounded=center_rest+axial+radial.normalized()*radius
                    rest_point=rest_point.lerp(rounded,smoothstep(source_u/.014)*strength)
            for i in ids:rest_surface_override[i]=rest_point.copy()
            metal=all(plate_vertices[i]for i in ids) and lateral<edge+.006
            if metal:rotation=Quaternion();translation=Vector((0,0,0))
            else:
                u=(original-mcp_source).dot(thumb_axis)
                joint=smoothstep((u-(ip_source-mcp_source).length+.005)/.010)
                rotation,translation=dual_components(q1,t1,q2,t2,joint)
                root_blend=smoothstep((u+.028)/.024)
                rotation,translation=dual_components(Quaternion(),Vector((0,0,0)),rotation,translation,strength*root_blend)
            posed=rotation@rest_point+translation
            for i in ids:
                points[i]=posed;edited.append(i)
                thumb_normals[i]=(rotation@(normal_fit@source_normals[i])).normalized()
        thumb_report={'method':'original two-phalange thumb with volume-preserving dual-quaternion joint',
                      'editedVertices':edited,'restSegmentLengthsMeters':[length1,length2],
                      'posedSegmentLengthsMeters':[(ip_target-root_world).length,(tip_target-ip_target).length],
                      'root':list(root_world),'interphalangealJoint':list(ip_target),'tip':list(tip_target),
                      'fourFingerGripRetained':True,
                      'sourceForward':list(forward),'sourceAcross':list(across),
                      'sourceWrist':list(wrist),'sourceIndexAcross':(roots['Index']-wrist).dot(across),
                      'sourceIndexForward':(roots['Index']-wrist).dot(forward)}
        # Solve the original thumb/web surface as one welded piece. UV islands
        # are render seams, not anatomical joints: relaxing them independently
        # leaves sharp fins where the thumb meets the palm. Keep the four curled
        # fingers and hand plate fixed while preserving local source edge lengths.
        vertex_group={};welded=[];members=[]
        for i,original in enumerate(source_points):
            key=tuple(round(v,6)for v in original)
            if key not in vertex_group:
                vertex_group[key]=len(welded);welded.append(original);members.append([])
            members[vertex_group[key]].append(i)
        vmap={i:gi for gi,ids in enumerate(members)for i in ids}
        neighbors=[set()for _ in welded]
        for face in triangles:
            ids=[vmap[i]for i in face]
            for i in ids:neighbors[i].update(j for j in ids if j!=i)
        rest_mesh=np.array([list(rest_surface_override.get(ids[0],target[hand].translation+fit@(p-wrist)))for p,ids in zip(welded,members)])
        posed_mesh=np.array([list(points[ids[0]])for ids in members])
        free=[];thumb_anchors=[];finger_anchors=[]
        for gi,(original,ids)in enumerate(zip(welded,members)):
            f=(original-wrist).dot(forward);a=(original-wrist).dot(across)
            u=(original-mcp_source).dot(thumb_axis)
            in_thumb=a>edge+.007+.20*(f-.070) and f<(roots['Index']-wrist).dot(forward)+.018
            plate=any(plate_vertices[i]for i in ids)
            tip=in_thumb and (u>furthest-.010 or abs(u)<.004 or abs(u-ip_u)<.0035)
            finger_contact=not in_thumb and any(i in contact_vertices[finger]for i in ids for finger in finger_bounds)
            if tip:thumb_anchors.append(gi)
            elif finger_contact:finger_anchors.append(gi)
            elif not plate and a>edge-.014 and .035<f<(roots['Index']-wrist).dot(forward)+.018:
                free.append(gi)
        free_lookup={gi:i for i,gi in enumerate(free)}
        lap=np.zeros((len(free),len(free)))
        for i,gi in enumerate(free):
            lap[i,i]=len(neighbors[gi])
            for gj in neighbors[gi]:
                if gj in free_lookup:lap[i,free_lookup[gj]]=-1
        if free:
            inverse=np.linalg.inv(lap)
            rotations=np.tile(np.eye(3),(len(welded),1,1))
            active=set(free)
            for gi in free:active.update(neighbors[gi])
            edge_data={gi:(np.array(sorted(neighbors[gi])),rest_mesh[gi]-rest_mesh[sorted(neighbors[gi])])for gi in active}
            for iteration in range(36):
                for gi,(ids,rest_edges)in edge_data.items():
                    covariance=(posed_mesh[gi]-posed_mesh[ids]).T@rest_edges
                    u,s,vt=np.linalg.svd(covariance)
                    sign=np.eye(3);sign[2,2]=np.linalg.det(u@vt)
                    rotations[gi]=u@sign@vt
                rhs=np.zeros((len(free),3))
                for i,gi in enumerate(free):
                    for gj in neighbors[gi]:
                        rhs[i]+=.5*(rotations[gi]+rotations[gj])@(rest_mesh[gi]-rest_mesh[gj])
                        if gj not in free_lookup:rhs[i]+=posed_mesh[gj]
                posed_mesh[free]=inverse@rhs
            for gi in free:
                for i in members[gi]:points[i]=Vector(posed_mesh[gi]);thumb_normals.pop(i,None)
        thumb_report.update(weldedWebRelaxationVertices=len(free),thumbTipAnchors=len(thumb_anchors),
                            originalUvSeamsWeldedForDeformation=True,fourFingerSurfaceContactAnchors=len(finger_anchors),
                            originalThumbCrossSectionRounded=True,thumbPadTarget='outside of index finger')
        # The former nearest-finger labels included part of the thenar web as
        # Index. Contact QA uses the actual distal index branch, beyond the web.
        old_index_contacts=contact_vertices['Index']
        contact_vertices['Index']=[i for i in old_index_contacts if (source_points[i]-wrist).dot(forward)>.135]
        finger_contacts['Index']=len(contact_vertices['Index'])
        thumb_report['oldWebContactLabelsExcluded']=len(old_index_contacts)-len(contact_vertices['Index'])
    # Preserve the artist's exact UV seams and topology. Area-weighted normals
    # are recalculated on the deformed source mesh, without changing vertices.
    normals = [Vector((0, 0, 0)) for _ in points]
    for ia, ib, ic in triangles:
        normal = (points[ib]-points[ia]).cross(points[ic]-points[ia])
        for i in (ia, ib, ic):
            normals[i] += normal
    # Smooth only the original glove across UV splits. Separate armor normals
    # retain the plate's edge, and source UVs/materials remain untouched.
    seam_groups={}
    for i,p in enumerate(source_points):
        if not plate_vertices[i]:seam_groups.setdefault(tuple(round(v,6)for v in p),[]).append(i)
    for ids in seam_groups.values():
        total=sum((normals[i]for i in ids),Vector((0,0,0)))
        for i in ids:normals[i]=total.copy()
    normals = [normal.normalized() for normal in normals]
    flex_triangles=[sum((source_points[i]-wrist).dot(forward)for i in triangle)/3<.034 and not plate_triangle_mask[ti] for ti,triangle in enumerate(triangles)]
    plate_triangles=plate_triangle_mask
    # A separate rounded leather wrist joint sits under the two rigid armor
    # pieces. It does not inherit their blended metal vertices or twist-flat.
    flex_positions=[];flex_normals=[];flex_joints=[];flex_weights=[];flex_indices=[]
    arm_direction=(target[hand].translation-target[side+'ForeArm'].translation).normalized()
    center=target[hand].translation+arm_direction*.024
    tangent=arm_direction.cross(Vector((0,0,1)))
    if tangent.length<.01:tangent=arm_direction.cross(Vector((1,0,0)))
    tangent.normalize();normal=arm_direction.cross(tangent).normalized()
    rings,segments=12,24
    for row in range(rings+1):
        phi=math.pi*row/rings
        for column in range(segments):
            theta=2*math.pi*column/segments
            offset=arm_direction*(.028*math.cos(phi))+(tangent*math.cos(theta)+normal*math.sin(theta))*(.021*math.sin(phi))
            flex_positions.append(center+offset)
            n=arm_direction*(math.cos(phi)/.028)+(tangent*math.cos(theta)+normal*math.sin(theta))*(math.sin(phi)/.021)
            flex_normals.append(n.normalized());flex_joints.append([names.index(side+'ForeArm'),0,0,0]);flex_weights.append([1,0,0,0])
    for row in range(rings):
        for column in range(segments):
            a=row*segments+column;b=row*segments+(column+1)%segments;c=(row+1)*segments+(column+1)%segments;d=(row+1)*segments+column
            if row>0:flex_indices.append([a,b,d])
            if row<rings-1:flex_indices.append([b,c,d])
    leather_candidates=[i for i,(p,c)in enumerate(zip(source_points,source_color))if (p-wrist).dot(palm)>.005 and .03<(p-wrist).dot(forward)<.09 and c.x<.35 and c.y<.25]
    leather=min(leather_candidates,key=lambda i:(source_color[i]-Vector((.12,.07,.035))).length)if leather_candidates else 0
    return {'positions': points, 'normals': normals, 'uv': source_uv,
            'joints': joints, 'weights': weights, 'indices': triangles,
            'plateTriangles':plate_triangles,'flexTriangles':flex_triangles,
            'flexPositions':flex_positions,'flexNormals':flex_normals,'flexJoints':flex_joints,
            'flexWeights':flex_weights,'flexUv':[source_uv[leather]]*len(flex_positions),'flexIndices':flex_indices,
            'report': {'source': 'Role6.glb original '+side+' hand',
                       'sourceVertexIds': used, 'sourceFaceIds': np.flatnonzero(selected_faces).tolist(),
                       'originalVertices': len(used), 'originalTriangles': len(faces),
                       'vertices': len(points), 'triangles': len(triangles),
                       'sourceSurfaceAndUvPreserved': True,'linearSubdivisionIterations':2,
                       'sourcePositionsBeforePose':[list(p)for p in source_points],
                       'sourceFaceForEachTriangle':provenance,
                       'fingerAnglesDegrees': angles,
                       'clearanceAdjustedVertices': len(clearance_adjustments),
                       'maximumClearanceAdjustmentMeters': max(clearance_adjustments, default=0),
                       'measuredPalmarContactVerticesByFinger':finger_contacts,'contactVertexIndicesByFinger':contact_vertices,'thumbAdjustment':thumb_report}}
