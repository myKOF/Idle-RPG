import bpy, sys
from mathutils import Vector
SRC, OUT_GLB, OUT_BLEND = sys.argv[sys.argv.index("--") + 1:][:3]
bpy.ops.wm.open_mainfile(filepath=SRC)
arm = bpy.data.objects["BOSS4_Armature"]; body = bpy.data.objects["BOSS4_Body"]
ad = arm.animation_data; ad.action = None
for t in ad.nla_tracks: t.mute = True
for pb in arm.pose.bones: pb.matrix_basis.identity()
bpy.context.view_layer.update()
gi = {g.index: g.name for g in body.vertex_groups}
low = [body.matrix_world @ v.co for v in body.data.vertices if (body.matrix_world @ v.co).z < 0.06 and not any(gi[g.group] == "weapon_r" for g in v.groups)]
cx = (min(p.x for p in low) + max(p.x for p in low)) / 2; cy = (min(p.y for p in low) + max(p.y for p in low)) / 2
top = arm.parent or arm
top.location = top.location - Vector((cx, cy, 0))
bpy.context.view_layer.update()
print("centred on the hooves: shifted by", round(-cx, 4), round(-cy, 4), "via", top.name)
bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
bpy.ops.object.select_all(action='DESELECT')
for o in bpy.data.objects:
    if o.type in ('ARMATURE', 'MESH', 'EMPTY'): o.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format='GLB', use_selection=True, export_animations=True,
                          export_animation_mode='ACTIONS', export_skins=True, export_force_sampling=True, export_frame_step=1,
                          export_anim_single_armature=True, export_reset_pose_bones=True, export_image_format='AUTO')
print("exported", OUT_GLB)
