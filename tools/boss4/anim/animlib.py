"""Shared helpers for BOSS4 posing / rendering."""
import bpy, math, os, sys
from mathutils import Vector, Matrix, Quaternion
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from render_lib import setup_scene, cam_ortho, render  # noqa

def objs():
    return bpy.data.objects['BOSS4_Armature'], bpy.data.objects['BOSS4_Body']

def reset_pose(arm):
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'; pb.matrix_basis.identity()
    bpy.context.view_layer.update()

def rot_world(arm, name, axis, deg, pivot=None):
    """Rotate a pose bone (and its children) about a world axis through its current head."""
    pb = arm.pose.bones[name]
    M = arm.matrix_world.inverted() @ (arm.matrix_world @ pb.matrix)
    h = (pb.matrix.to_translation()) if pivot is None else Vector(pivot)
    R = Matrix.Translation(h) @ Matrix.Rotation(math.radians(deg), 4, Vector(axis).normalized()) @ Matrix.Translation(-h)
    pb.matrix = R @ pb.matrix
    bpy.context.view_layer.update()

def aim_bone(arm, name, target_dir, up_hint=None):
    """Swing a bone (keeping its head) so that its Y axis points along target_dir (armature space)."""
    pb = arm.pose.bones[name]
    cur = (pb.matrix.to_3x3() @ Vector((0, 1, 0))).normalized()
    q = cur.rotation_difference(Vector(target_dir).normalized())
    h = pb.matrix.to_translation()
    pb.matrix = Matrix.Translation(h) @ q.to_matrix().to_4x4() @ Matrix.Translation(-h) @ pb.matrix
    bpy.context.view_layer.update()

def head(arm, name): return arm.pose.bones[name].matrix.to_translation().copy()
def tail(arm, name):
    pb = arm.pose.bones[name]; return (pb.matrix @ Vector((0, pb.length, 0))).copy() if False else pb.tail.copy()

def key_all(arm, frame, names=None):
    for pb in arm.pose.bones:
        if names and pb.name not in names: continue
        pb.keyframe_insert("rotation_quaternion", frame=frame)
        pb.keyframe_insert("location", frame=frame)

def materials_plain(body, col=(0.78, 0.78, 0.8, 1)):
    m = bpy.data.materials.new("plain"); m.diffuse_color = col
    body.data.materials.clear(); body.data.materials.append(m)
