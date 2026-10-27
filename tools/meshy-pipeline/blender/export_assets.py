"""Export the processed character: one GLB with every clip, an FBX, and one GLB per clip.

Usage:
  blender --background --python export_assets.py -- <processed.blend> <outDir> <baseName>
Writes <outDir>/<baseName>.glb, <baseName>.fbx and <outDir>/clips/<ClipName>.glb (skeleton + that clip only).
"""
import os
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1:]
blend, out_dir, base = argv[0], argv[1], argv[2]
# optional: --max-texture N shrinks textures larger than N px (for in-game copies; the master keeps full size)
max_texture = int(argv[argv.index("--max-texture") + 1]) if "--max-texture" in argv else 0
bpy.ops.wm.open_mainfile(filepath=blend)
if max_texture:
    for img in bpy.data.images:
        if img.size[0] > max_texture or img.size[1] > max_texture:
            img.scale(min(img.size[0], max_texture), min(img.size[1], max_texture))
os.makedirs(os.path.join(out_dir, "clips"), exist_ok=True)

arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
body = next(o for o in bpy.data.objects if o.type == "MESH")
actions = sorted([a for a in bpy.data.actions if a.use_fake_user], key=lambda a: a.name)


def select(*objs):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


# every clip as its own glTF animation, in one file. The action assigned to the armature is skipped
# by the exporter's ACTIONS mode, so nothing may be assigned (a clip went missing that way).
arm.animation_data.action = None
select(arm, body)
bpy.ops.export_scene.gltf(filepath=os.path.join(out_dir, base + ".glb"), export_format="GLB", use_selection=True,
                          export_animations=True, export_animation_mode="ACTIONS", export_force_sampling=True,
                          export_image_format="AUTO", export_yup=True)

# FBX with every action as a take
bpy.ops.export_scene.fbx(filepath=os.path.join(out_dir, base + ".fbx"), use_selection=True, object_types={"ARMATURE", "MESH"},
                         add_leaf_bones=False, bake_anim=True, bake_anim_use_all_actions=True, bake_anim_use_nla_strips=False,
                         bake_anim_force_startend_keying=True, apply_scale_options="FBX_SCALE_ALL", path_mode="COPY",
                         embed_textures=True, mesh_smooth_type="FACE")

# one skeleton + single-clip GLB per clip
for a in actions:
    arm.animation_data.action = a
    if hasattr(a, "slots") and len(a.slots):
        arm.animation_data.action_slot = a.slots[0]
    select(arm)
    bpy.ops.export_scene.gltf(filepath=os.path.join(out_dir, "clips", a.name + ".glb"), export_format="GLB", use_selection=True,
                              export_animations=True, export_animation_mode="ACTIVE_ACTIONS", export_force_sampling=True,
                              export_yup=True)
print("EXPORT_DONE", [a.name for a in actions])
