"""Rearing helpers: hind-leg IK with planted hooves, custom visual bake."""
import bpy, math
from mathutils import Vector, Matrix

HIND = ("l", "r")

def add_hind_ik(arm):
    """IK on back_leg_ankle_* (chain 3) to an empty at the rest ankle tail; foot keeps its rest world rotation."""
    made = []
    for s in HIND:
        ank = arm.data.bones[f"back_leg_ankle_{s}"]; foot = arm.data.bones[f"back_leg_foot_{s}"]
        e = bpy.data.objects.new(f"IK_hind_{s}", None); bpy.context.scene.collection.objects.link(e)
        e.matrix_world = arm.matrix_world @ Matrix.Translation(ank.tail_local)
        c = arm.pose.bones[ank.name].constraints.new('IK'); c.target = e; c.chain_count = 3; c.use_tail = True
        r = bpy.data.objects.new(f"ROT_hind_{s}", None); bpy.context.scene.collection.objects.link(r)
        r.matrix_world = arm.matrix_world @ foot.matrix_local
        c2 = arm.pose.bones[foot.name].constraints.new('COPY_ROTATION'); c2.target = r
        c2.target_space = 'WORLD'; c2.owner_space = 'WORLD'
        made += [e, r]
    bpy.context.view_layer.update()
    return made

def bake_visual(arm, f0, f1, action):
    """Sample final (constraint-evaluated) pose matrices per frame, drop constraints, key them back."""
    sc = bpy.context.scene
    order = []
    def walk(b):
        order.append(b.name)
        for c in b.children: walk(c)
    for b in arm.data.bones:
        if b.parent is None: walk(b)
    samples = {}
    for f in range(f0, f1 + 1):
        sc.frame_set(f)
        samples[f] = {n: arm.pose.bones[n].matrix.copy() for n in order}
    for pb in arm.pose.bones:
        for c in list(pb.constraints): pb.constraints.remove(c)
    for o in [o for o in bpy.data.objects if o.name.startswith(("IK_hind_", "ROT_hind_"))]:
        bpy.data.objects.remove(o)
    # wipe keys and re-key every frame
    for fc in list(action.fcurves): action.fcurves.remove(fc)
    for f in range(f0, f1 + 1):
        for n in order:
            arm.pose.bones[n].matrix = samples[f][n]
            bpy.context.view_layer.update()
        for pb in arm.pose.bones:
            pb.keyframe_insert("rotation_quaternion", frame=f, group=pb.name)
            pb.keyframe_insert("location", frame=f, group=pb.name)
            pb.keyframe_insert("scale", frame=f, group=pb.name)
