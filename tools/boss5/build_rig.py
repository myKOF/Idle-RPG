"""BOSS5 (oni mask) rig + 5 clips -> GLB.   blender -b -P build_boss5.py -- stage1.blend out.glb [clipsToBuild,comma]
Z-up Blender, mask faces -Y (glTF +Z).  Bones: Root, Body, Eye_L(+X), Eye_R(-X), Shard_01..N (death burst).
All clips are 30 fps; every bone is keyed in every clip."""
import bpy, bmesh, math, sys, os, random
import numpy as np
from mathutils import Vector, Matrix, Quaternion, Euler
from mathutils.bvhtree import BVHTree
argv = sys.argv[sys.argv.index('--') + 1:]
FLAGS = [a for a in argv if a.startswith('--')]
argv = [a for a in argv if not a.startswith('--')]
SRC, OUT = argv[0], argv[1]
ONLY = set(argv[2].split(',')) if len(argv) > 2 else None
# --game: in-game variant. Like the BOSS3 clips, the strikes/walk keep their vertical motion but the horizontal root
# displacement is fixed (the game moves the body itself), and the death burst stays inside the 6.2 m NPC canvas.
GAME = '--game' in FLAGS
lock_xy = False
HOVER = 1.5
NSHARD = 14
FPS = 30
bpy.ops.wm.open_mainfile(filepath=SRC)
sc = bpy.context.scene
sc.render.fps = FPS
mask = bpy.data.objects['Mask']
dome = bpy.data.objects['Dome']
# ---- merge mask + dome into one mesh, lifted to hover height
for o in (mask, dome):
    o.data.transform(Matrix.Translation((0, 0, HOVER)))
    o.location = (0, 0, 0)
muv = mask.data.uv_layers[0].name
dome.data.uv_layers[0].name = muv
for o in bpy.context.view_layer.objects:
    o.select_set(False)
mask.select_set(True)
dome.select_set(True)
bpy.context.view_layer.objects.active = mask
bpy.ops.object.join()
body = mask
body.name = 'Boss5'
me = body.data
print("MATS", [m.name for m in me.materials], "UV", [u.name for u in me.uv_layers])
for p in me.polygons:
    p.use_smooth = True
# ---- eye glow orbs: eye socket centres from the front art (x=+-0.30, z=-0.025)
bvh = BVHTree.FromObject(body, bpy.context.evaluated_depsgraph_get())
EYE_X = 0.30
EYE_Z = -0.025 + HOVER
ys = []
for a in range(12):
    ang = a / 12 * 2 * math.pi
    o = Vector((EYE_X + 0.12 * math.cos(ang), -2, EYE_Z + 0.075 * math.sin(ang)))
    loc, n, idx, d = bvh.ray_cast(o, Vector((0, 1, 0)))
    if loc is not None and loc.y < 0.1:
        ys.append(loc.y)
print("EYE wall y", ys)
EYE_Y = (sum(ys) / len(ys) if ys else -0.30) + 0.09
emat = bpy.data.materials.new('EyeGlow')
emat.use_nodes = True
nt = emat.node_tree
nt.nodes.clear()
o_ = nt.nodes.new('ShaderNodeOutputMaterial')
b_ = nt.nodes.new('ShaderNodeBsdfPrincipled')
b_.inputs['Base Color'].default_value = (0.05, 0.0, 0.0, 1)
b_.inputs['Emission Color'].default_value = (1.0, 0.10, 0.02, 1)
b_.inputs['Emission Strength'].default_value = 6.0
nt.links.new(b_.outputs['BSDF'], o_.inputs['Surface'])
me.materials.append(emat)
eye_mi = len(me.materials) - 1
bm = bmesh.new()
bm.from_mesh(me)
for name, sx in (('Eye_L', +1), ('Eye_R', -1)):
    g = bmesh.ops.create_uvsphere(bm, u_segments=14, v_segments=8, radius=1.0)
    vs = g['verts']
    for v in vs:
        v.co = Vector((v.co.x * 0.115, v.co.y * 0.055, v.co.z * 0.065)) + Vector((sx * EYE_X, EYE_Y, EYE_Z))
    fs = {f for v in vs for f in v.link_faces}
    for f in fs:
        f.material_index = eye_mi
        f.smooth = True
bm.to_mesh(me)
bm.free()
# ---- shard partition (faces of mask+dome only)
me.update()
fc = np.array([p.center[:] for p in me.polygons])
fm = np.array([p.material_index for p in me.polygons])
idx = np.where(fm != eye_mi)[0]
pts = fc[idx]
start = int(np.argmin(np.linalg.norm(pts - np.array([0, -0.4, HOVER]), axis=1)))
seeds = [start]
dist = np.linalg.norm(pts - pts[start], axis=1)
for _ in range(NSHARD - 1):
    k = int(np.argmax(dist))
    seeds.append(k)
    dist = np.minimum(dist, np.linalg.norm(pts - pts[k], axis=1))
S = pts[seeds]
assign = np.full(len(me.polygons), -1, dtype=int)
d2 = np.linalg.norm(pts[:, None, :] - S[None, :, :], axis=2)
assign[idx] = np.argmin(d2, axis=1)
# rebuild the mesh so that no vertex is shared between two shards (also removes bow-tie vertices),
# keeping UVs and the original smooth normals
cn = np.array([c.vector[:] for c in me.corner_normals]).reshape(-1, 3)
uvarr = np.empty(len(me.loops) * 2, dtype=np.float32)
me.uv_layers[0].data.foreach_get('uv', uvarr)
old_verts = [v.co[:] for v in me.vertices]
old_polys = [list(p.vertices) for p in me.polygons]
old_mat = [p.material_index for p in me.polygons]
vmap = {}
newverts = []
newpolys = []
for pi, pv in enumerate(old_polys):
    fr = int(assign[pi])
    nv = []
    for v in pv:
        key = (v, fr)
        if key not in vmap:
            vmap[key] = len(newverts)
            newverts.append(old_verts[v])
        nv.append(vmap[key])
    newpolys.append(nv)
newme = bpy.data.meshes.new('Boss5Mesh')
newme.from_pydata(newverts, [], newpolys)
newme.update()
newme.uv_layers.new(name=muv)
newme.uv_layers[0].data.foreach_set('uv', uvarr)
for m in me.materials:
    newme.materials.append(m)
newme.polygons.foreach_set('material_index', old_mat)
newme.polygons.foreach_set('use_smooth', [True] * len(newme.polygons))
newme.normals_split_custom_set(cn.tolist())
body.data = newme
me = newme
fa_ = assign.astype(np.int32)
print("shard split: verts", len(old_verts), '->', len(newverts), "faces", len(me.polygons))
vco = np.array([v.co[:] for v in me.vertices])
fa = np.array([p.area for p in me.polygons])
fn = np.array([p.normal[:] for p in me.polygons])
fcen = np.array([p.center[:] for p in me.polygons])
pm = np.array([p.material_index for p in me.polygons])
vfr = np.full(len(me.vertices), -1, dtype=int)
for p in me.polygons:
    if pm[p.index] != eye_mi:
        for vi in p.vertices:
            vfr[vi] = fa_[p.index]
shard_c = []
shard_n = []
shard_pts = []
for i in range(NSHARD):
    m = (fa_ == i) & (pm != eye_mi)
    w = fa[m]
    shard_c.append((fcen[m] * w[:, None]).sum(axis=0) / w.sum())
    nn = (fn[m] * w[:, None]).sum(axis=0)
    shard_n.append(nn / np.linalg.norm(nn))
    shard_pts.append(vco[np.where(vfr == i)[0]])
shard_c = np.array(shard_c)
print("shard face counts", [int(((fa_ == i) & (pm != eye_mi)).sum()) for i in range(NSHARD)])
# ---- armature
arm_d = bpy.data.armatures.new('Boss5Rig')
arm = bpy.data.objects.new('Boss5Rig', arm_d)
sc.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
arm.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
eb = arm_d.edit_bones


def mk(name, head, parent=None, ln=0.2):
    b = eb.new(name)
    b.head = Vector(head)
    b.tail = Vector(head) + Vector((0, 0, ln))
    b.roll = 0
    if parent:
        b.parent = eb[parent]
    return b


mk('Root', (0, 0, 0), None, 0.4)
mk('Body', (0, 0, HOVER), 'Root', 0.3)
mk('Eye_L', (EYE_X, EYE_Y, EYE_Z), 'Body', 0.08)
mk('Eye_R', (-EYE_X, EYE_Y, EYE_Z), 'Body', 0.08)
for i in range(NSHARD):
    mk('Shard_%02d' % (i + 1), shard_c[i], 'Body', 0.1)
bpy.ops.object.mode_set(mode='OBJECT')
# attachment points (children of the Body bone): mouth muzzle for flame / skulls, back for the mist trail
fx_objs = []
def add_fx(name, loc):
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = 'ARROWS'
    e.empty_display_size = 0.15
    sc.collection.objects.link(e)
    e.parent = arm
    e.parent_type = 'BONE'
    e.parent_bone = 'Body'
    bn = arm.data.bones['Body']
    e.matrix_parent_inverse = (bn.matrix_local @ Matrix.Translation((0, bn.length, 0))).inverted()
    e.location = loc
    fx_objs.append(e)
add_fx('Fx_Mouth', (0, -0.50, HOVER - 0.52))
add_fx('Fx_Back', (0, 0.60, HOVER - 0.10))
# weights
for i in range(NSHARD):
    body.vertex_groups.new(name='Shard_%02d' % (i + 1))
vg_eL = body.vertex_groups.new(name='Eye_L')
vg_eR = body.vertex_groups.new(name='Eye_R')
eye_idx = set()
for p in me.polygons:
    if pm[p.index] == eye_mi:
        for vi in p.vertices:
            eye_idx.add(vi)
for vi in eye_idx:
    (vg_eL if me.vertices[vi].co.x > 0 else vg_eR).add([vi], 1.0, 'REPLACE')
for vi in range(len(me.vertices)):
    if vi in eye_idx:
        continue
    body.vertex_groups['Shard_%02d' % (int(vfr[vi]) + 1)].add([vi], 1.0, 'REPLACE')
body.parent = arm
md = body.modifiers.new('Armature', 'ARMATURE')
md.object = arm
# ---- animation helpers
pb = arm.pose.bones
for b in pb:
    b.rotation_mode = 'QUATERNION'
rest = {b.name: arm.data.bones[b.name].matrix_local.copy() for b in pb}
head = {b.name: Vector(arm.data.bones[b.name].head_local) for b in pb}
PB = Vector((0, 0, HOVER))


def rotm(rx=0, ry=0, rz=0):
    return Euler((math.radians(rx), math.radians(ry), math.radians(rz)), 'XYZ').to_matrix().to_4x4()


def body_D(y=0, z=0, x=0, pitch=0, roll=0, yaw=0, s=(1, 1, 1)):
    """y>0 = forward (-Y world). pitch>0 = lean forward. All about the mask centre."""
    S = Matrix.Diagonal((s[0], s[1], s[2], 1))
    if lock_xy:
        x = y = 0
    return Matrix.Translation((x, -y, z)) @ Matrix.Translation(PB) @ rotm(pitch, roll, yaw) @ S @ Matrix.Translation(-PB)


def clamp01(t):
    return max(0.0, min(1.0, t))


def smooth(t):
    t = clamp01(t)
    return t * t * (3 - 2 * t)


def ein(t):
    t = clamp01(t)
    return t * t


def eout(t):
    t = clamp01(t)
    return 1 - (1 - t) ** 2


def lerp(a, b, t):
    return a + (b - a) * t


def track(f, keys):
    """keys: (frame, value[, ease]); ease shapes the segment that ENDS at that key"""
    if f <= keys[0][0]:
        return keys[0][1]
    for a, b in zip(keys, keys[1:]):
        if f <= b[0]:
            t = (f - a[0]) / (b[0] - a[0])
            e = b[2] if len(b) > 2 else 'smooth'
            t = {'smooth': smooth, 'in': ein, 'out': eout, 'lin': clamp01}[e](t)
            return lerp(a[1], b[1], t)
    return keys[-1][1]


def eye_scale(t, f1=2.3, f2=5.7, boost=1.0):
    return boost * (0.92 + 0.12 * math.sin(2 * math.pi * f1 * t) + 0.08 * math.sin(2 * math.pi * f2 * t + 1.0))


def reset_pose():
    for b in pb:
        b.location = (0, 0, 0)
        b.rotation_quaternion = (1, 0, 0, 0)
        b.scale = (1, 1, 1)


def make_action(name, nframes, posefn):
    act = bpy.data.actions.new(name)
    arm.animation_data_create()
    arm.animation_data.action = act
    prevq = {}
    for f in range(0, nframes + 1):
        Ds = posefn(f)
        for b in pb:
            D = Ds.get(b.name, Matrix.Identity(4))
            basis = rest[b.name].inverted() @ D @ rest[b.name]
            loc, rot, scl = basis.decompose()
            pq = prevq.get(b.name)
            if pq is not None and pq.dot(rot) < 0:
                rot = Quaternion((-rot.w, -rot.x, -rot.y, -rot.z))
            prevq[b.name] = rot
            b.location = loc
            b.rotation_quaternion = rot
            b.scale = scl
            b.keyframe_insert('location', frame=f)
            b.keyframe_insert('rotation_quaternion', frame=f)
            b.keyframe_insert('scale', frame=f)
    act.use_fake_user = True
    reset_pose()
    arm.animation_data.action = None
    return act


def eyes_D(sc_):
    out = {}
    for n in ('Eye_L', 'Eye_R'):
        c = head[n]
        S = Matrix.Diagonal((sc_, sc_, sc_, 1))
        out[n] = Matrix.Translation(c) @ S @ Matrix.Translation(-c)
    return out


clips = {}


# ================= Walk (loop 1.0s): hover, lean 20deg, bob =================
def walk(f):
    t = f / 30.0
    ph = 2 * math.pi * t
    D = {'Body': body_D(y=-0.05 * math.sin(ph + 0.8), z=0.12 * math.sin(ph), pitch=20 + 2.5 * math.sin(ph + 0.6),
                        roll=3.0 * math.sin(ph), yaw=1.2 * math.sin(ph + 1.5))}
    D.update(eyes_D(eye_scale(t, 2, 5)))
    return D


clips['Walk'] = (30, walk)


# ================= Attack1: face ram 6m and back =================
def atk1(f):
    t = f / 30.0
    y = track(f, [(0, 0), (12, -0.8, 'smooth'), (14, -0.9, 'lin'), (19, 6.0, 'in'), (24, 6.0, 'lin'), (54, 0, 'smooth')])
    z = track(f, [(0, 0), (12, 0.25, 'smooth'), (19, -0.25, 'in'), (24, -0.2, 'lin'), (54, 0, 'smooth')])
    pitch = track(f, [(0, 20), (12, -22, 'smooth'), (14, -24, 'lin'), (19, 30, 'in'), (24, 28, 'lin'), (54, 20, 'smooth')])
    sq = track(f, [(0, 1), (19, 1, 'lin'), (20, 0.84, 'out'), (23, 1.0, 'smooth')])
    s = (1 + (1 - sq) * 0.5, sq, 1 + (1 - sq) * 0.5)
    sh = 0
    if 19 <= f <= 26:
        sh = 0.09 * (1 - (f - 19) / 7.0) * (1 if f % 2 else -1)
    D = {'Body': body_D(y=y, z=z, x=sh, pitch=pitch, roll=sh * 40, s=s)}
    eb_ = 1.5 if 8 <= f <= 24 else 1.0
    D.update(eyes_D(eye_scale(t, boost=eb_)))
    return D


clips['Attack1'] = (54, atk1)


# ================= Attack2: inhale then spit 3 skulls (release at frame 14) =================
def atk2(f):
    t = f / 30.0
    y = track(f, [(0, 0), (12, 0.35, 'smooth'), (14, -0.55, 'in'), (24, 0, 'out')])
    z = track(f, [(0, 0), (12, 0.20, 'smooth'), (14, 0.0, 'in'), (30, 0, 'smooth')])
    pitch = track(f, [(0, 20), (12, -14, 'smooth'), (14, 32, 'in'), (20, 14, 'out'), (26, 22, 'smooth'), (34, 20, 'smooth')])
    puff = track(f, [(0, 1.0), (12, 1.14, 'smooth'), (14, 0.96, 'in'), (22, 1.0, 'out')])
    roll = 1.5 * math.sin(t * 9) * max(0, 1 - (f - 14) / 18) if f > 14 else 0
    D = {'Body': body_D(y=y, z=z, pitch=pitch, roll=roll, s=(puff, puff, puff))}
    eb_ = track(f, [(0, 1.0), (12, 1.7, 'smooth'), (16, 1.2, 'out'), (24, 1.0, 'smooth')])
    D.update(eyes_D(eye_scale(t, boost=eb_)))
    return D


clips['Attack2'] = (40, atk2)


# ================= Attack3: lean back, then jet a flame (flame frames 22..48) =================
def atk3(f):
    t = f / 30.0
    pitch = track(f, [(0, 20), (21, -32, 'smooth'), (24, 12, 'in'), (50, 14, 'smooth'), (66, 20, 'smooth')])
    y = track(f, [(0, 0), (21, 0.5, 'smooth'), (24, -0.45, 'in'), (50, -0.35, 'lin'), (66, 0, 'smooth')])
    z = track(f, [(0, 0), (21, 0.4, 'smooth'), (24, 0.05, 'in'), (50, 0.05, 'lin'), (66, 0, 'smooth')])
    tr = 0.0
    if f < 21:
        tr = 0.025 * (f / 21.0) ** 2
    elif 24 <= f <= 50:
        tr = 0.012
    jit = tr * (math.sin(f * 2.9) + 0.6 * math.sin(f * 5.3 + 1))
    D = {'Body': body_D(y=y, z=z, x=jit, pitch=pitch + jit * 30, roll=jit * 60)}
    eb_ = track(f, [(0, 1.0), (21, 1.9, 'smooth'), (24, 1.5, 'lin'), (50, 1.5, 'lin'), (66, 1.0, 'smooth')])
    D.update(eyes_D(eye_scale(t, boost=eb_)))
    return D


clips['Attack3'] = (66, atk3)
# ================= Die: rise + violent shake, shatter at frame 60, burst & settle =================
SHATTER = 60
DIE_FRAMES = 120


def build_die():
    rng = random.Random(11)
    nr = np.random.default_rng(11)
    Dp = body_D(y=0, z=1.3, pitch=0)
    center0 = Dp @ PB
    jit = [[rng.uniform(-1, 1) for _ in range(6)] for _ in range(200)]

    def body_pose(f):
        if f >= SHATTER:
            return Dp
        base_z = track(f, [(0, 0), (45, 1.3, 'smooth'), (SHATTER, 1.3, 'lin')])
        pitch = track(f, [(0, 20), (45, 0, 'smooth')])
        amp = (0.004 + 0.14 * (f / 45.0) ** 2.2) if f <= 45 else 0.14 + 0.07 * (f - 45) / (SHATTER - 45)
        j = jit[f]
        return body_D(y=amp * 0.7 * j[0], x=amp * 0.7 * j[1], z=base_z + amp * 0.5 * j[2], pitch=pitch + amp * 60 * j[3],
                      roll=amp * 70 * j[4], yaw=amp * 60 * j[5])
    g = 9.8
    dt = 1 / 240.0
    T = (DIE_FRAMES - SHATTER) / 30.0
    traj = {}
    for i in range(NSHARD):
        c = Vector(shard_c[i])
        cw = Dp @ c
        u = (cw - center0)
        u.z *= 0.5
        if u.length < 1e-6:
            u = Vector((0, -1, 0))
        u.normalize()
        sp = 2.0 + 3.2 * nr.random()
        hs = 0.33 if GAME else 1.0
        v = Vector(((u.x * sp + nr.normal(0, 0.4)) * hs, (u.y * sp + nr.normal(0, 0.4)) * hs, 2.2 + 3.0 * nr.random() + u.z * 2.0))
        w = Vector(nr.normal(0, 1, 3))
        w.normalize()
        w *= 5 + 8 * nr.random()
        pts_rel = shard_pts[i] - shard_c[i]
        if len(pts_rel) > 300:
            pts_rel = pts_rel[::max(1, len(pts_rel) // 300)]
        q = Dp.to_quaternion()
        nvec = Vector(shard_n[i])
        up = Vector((0, 0, 1)) if nr.random() < 0.75 else Vector((0, 0, -1))
        qf = nvec.rotation_difference(up)
        qf = Quaternion((0, 0, 1), nr.uniform(0, 2 * math.pi)) @ qf
        tilt_ax = Vector((nr.normal(), nr.normal(), 0))
        if tilt_ax.length > 1e-6:
            tilt_ax.normalize()
            qf = Quaternion(tilt_ax, math.radians(nr.uniform(0, 28))) @ qf
        pos = cw.copy()
        state = 'air'
        bounces = 0
        rest_t = 0.0
        q0 = q.copy()
        frames = {}
        nsteps = int(T / dt)
        for s in range(nsteps + 1):
            tt = s * dt
            if s % 8 == 0:
                frames[int(round(tt * 30))] = (pos.copy(), q.copy())
            if state == 'air':
                v.z -= g * dt
                pos += v * dt
                wl = w.length
                if wl > 1e-6:
                    q = Quaternion(w / wl, wl * dt) @ q
                q.normalize()
                R = np.array(q.to_matrix())
                minz = (pts_rel @ R.T)[:, 2].min() + pos.z
                if minz < 0 and v.z < 0:
                    pos.z -= minz
                    if abs(v.z) > 1.2 and bounces < 3:
                        v.z = -v.z * 0.32
                        v.x *= 0.6
                        v.y *= 0.6
                        w *= 0.45
                        bounces += 1
                    else:
                        state = 'rest'
                        rest_t = 0
                        q0 = q.copy()
            else:
                rest_t += dt
                a = smooth(rest_t / 0.45)
                q = q0.slerp(qf, a)
                pos.x += v.x * dt
                pos.y += v.y * dt
                v.x *= math.exp(-5 * dt)
                v.y *= math.exp(-5 * dt)
                R = np.array(q.to_matrix())
                minz = (pts_rel @ R.T)[:, 2].min()
                pos.z = -minz + 0.004
        last = frames[max(frames)]
        for f in range(0, DIE_FRAMES + 1 - SHATTER):
            if f not in frames:
                frames[f] = last
        if GAME:
            # keep every shard inside the NPC canvas: |x| <= 3.0 (depth), |y| <= 2.4 (screen width)
            st = cw
            fpos = frames[max(frames)][0]
            for ax, lim in ((0, 3.0), (1, 2.4)):
                d = fpos[ax] - st[ax]
                if abs(d) > 1e-6 and abs(fpos[ax]) > lim:
                    k = max(0.0, (lim * (1 if d > 0 else -1) - st[ax]) / d)
                    for f_ in frames:
                        p_, q_ = frames[f_]
                        p_[ax] = st[ax] + (p_[ax] - st[ax]) * k
        traj[i] = frames
        fp = frames[max(frames)][0]
        print('SHARD', i + 1, 'rest at x=%.2f y=%.2f' % (fp.x, fp.y))

    def die(f):
        D = {'Body': body_pose(f)}
        if f < SHATTER:
            es = track(f, [(0, 1.0), (40, 1.3, 'smooth'), (SHATTER - 2, 2.0, 'in'), (SHATTER, 1.0, 'lin')])
        else:
            es = 0.001
        D.update(eyes_D(max(es * (0.9 + 0.1 * math.sin(f * 1.7)), 0.001)))
        for i in range(NSHARD):
            c = Vector(shard_c[i])
            if f < SHATTER:
                crack = smooth((f - 28) / (SHATTER - 28)) * 0.07
                u = (c - PB)
                u.normalize()
                j = jit[(f + i * 7) % 200]
                off = u * crack * (0.6 + 0.4 * abs(j[0])) + Vector((j[1], j[2], j[3])) * crack * 0.25
                Dr = Matrix.Translation(off) @ Matrix.Translation(c) @ rotm(crack * 40 * j[4], crack * 40 * j[5], crack * 30 * j[0]) @ Matrix.Translation(-c)
                D['Shard_%02d' % (i + 1)] = Dr
            else:
                pos, q = traj[i][f - SHATTER]
                Dw = Matrix.Translation(pos) @ q.to_matrix().to_4x4() @ Matrix.Translation(-c)
                D['Shard_%02d' % (i + 1)] = Dp.inverted() @ Dw
        return D
    return die


clips['Die'] = (DIE_FRAMES, None)
acts = {}
order = ['Walk', 'Attack1', 'Attack2', 'Attack3', 'Die']
for name in order:
    if ONLY and name not in ONLY:
        continue
    n, fn = clips[name]
    lock_xy = GAME and name != 'Die'
    if name == 'Die':
        fn = build_die()
    acts[name] = make_action(name, n, fn)
    print("ACTION", name, n + 1, "frames")
reset_pose()
# ---- export
for o in bpy.context.view_layer.objects:
    o.select_set(False)
for o in [body, arm] + fx_objs:
    o.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_animations=True,
                          export_animation_mode='ACTIONS', export_force_sampling=True, export_optimize_animation_size=False,
                          export_skins=True, export_def_bones=False, export_yup=True, export_apply=False,
                          export_image_format='AUTO', export_normals=True, export_materials='EXPORT')
bpy.ops.wm.save_as_mainfile(filepath=os.path.splitext(OUT)[0] + '.blend')
print("EXPORTED", OUT, os.path.getsize(OUT))
