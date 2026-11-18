"""Fill missing bone channels with rest keys in every action, export GLB with all actions, render Run check."""
import bpy, sys, os
D = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, D)
from posekit import *
OUTDIR = os.environ.get("BOSS4_OUTDIR", r"C:\Users\user\OneDrive\Desktop\BOSS4_output")
SRC = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else D + "/death.blend"
bpy.ops.wm.open_mainfile(filepath=SRC)
arm, body = objs()
for o in [o for o in bpy.data.objects if o.name == "Ground" or o.name.startswith("cam_")]:
    bpy.data.objects.remove(o)
for ca in list(body.data.color_attributes):
    if ca.name in ("viz", "w"): body.data.color_attributes.remove(ca)
ORDER = ["Walk", "Run", "Attack_Thrust", "Attack_Slash", "Attack_Power", "Death"]
for name in ORDER:
    a = bpy.data.actions[name]
    f0, f1 = (int(round(x)) for x in a.frame_range)
    have = {fc.data_path.split('"')[1] for fc in a.fcurves if fc.data_path.startswith("pose.bones")}
    arm.animation_data.action = a
    reset_pose(arm)
    missing = [pb.name for pb in arm.pose.bones if pb.name not in have]
    for n in missing:
        pb = arm.pose.bones[n]; pb.rotation_mode = 'QUATERNION'
        for f in (f0, f1):
            for path in ("rotation_quaternion", "location", "scale"):
                pb.keyframe_insert(path, frame=f, group=n)
    print(f"{name:14s} frames {f0}-{f1} ({(f1 - f0) / 24:.2f}s) filled {len(missing)} bones")
    a.use_fake_user = True
# NLA: one muted track per action so the exporter sees them all; no active action
ad = arm.animation_data
for t in list(ad.nla_tracks): ad.nla_tracks.remove(t)
ad.action = None
for name in ORDER:
    t = ad.nla_tracks.new(); t.name = name
    a = bpy.data.actions[name]; s = t.strips.new(name, int(a.frame_range[0]), a); t.mute = True
reset_pose(arm)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUTDIR, "BOSS4_animated.blend"))
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=os.path.join(OUTDIR, "BOSS4_animated.glb"), export_format='GLB', use_selection=True,
                          export_animations=True, export_animation_mode='ACTIONS', export_skins=True, export_force_sampling=True,
                          export_frame_step=1, export_anim_single_armature=True, export_reset_pose_bones=True)
print("exported")
