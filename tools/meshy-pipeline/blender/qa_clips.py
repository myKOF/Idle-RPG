"""Objective checks on the baked clips of a processed .blend. Writes a JSON report.

Usage:
  blender --background --python qa_clips.py -- <processed.blend> <report.json> [process.json]

Every number is measured, but only some checks are verdicts (marked PASS/WARN/FAIL); contact and
proximity counts are proxies, not proof. What a script cannot judge (does it look good, does the
cape clip the thigh) stays for a human.
"""
import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import kdtree

sys.path.insert(0, os.path.dirname(__file__))
import skin_fix

argv = sys.argv[sys.argv.index("--") + 1:]
blend, report_path = argv[0], argv[1]
cfg = json.load(open(argv[2], encoding="utf-8")) if len(argv) > 2 else {"clips": []}
loops = {c["name"]: c.get("loop", False) for c in cfg["clips"]}
holds = {c["name"]: c.get("holdLast", False) for c in cfg["clips"]}
hits = {c["name"]: c.get("hit", False) for c in cfg["clips"]}

bpy.ops.wm.open_mainfile(filepath=blend)
scene = bpy.context.scene
fps = scene.render.fps
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
body = next(o for o in bpy.data.objects if o.type == "MESH" and len(o.vertex_groups) > 0)
ad = arm.animation_data
hand = "Right"

# sword vertex set (rigid on the hand, near the blade axis) and the body set
names = {g.index: g.name for g in body.vertex_groups}
rest_world = np.array([(body.matrix_world @ v.co)[:] for v in body.data.vertices])
sign = -1.0 if hand == "Right" else 1.0
tip = np.array([sign * skin_fix.SWORD_TIP.x, skin_fix.SWORD_TIP.y, skin_fix.SWORD_TIP.z])
grip = np.array([sign * skin_fix.SWORD_GRIP.x, skin_fix.SWORD_GRIP.y, skin_fix.SWORD_GRIP.z])
axis = grip - tip
t = np.clip(((rest_world - tip) @ axis) / (axis @ axis), 0, 1)
dist = np.linalg.norm(rest_world - (tip + np.outer(t, axis)), axis=1)
weapon_group = "Sword" if "Sword" in body.vertex_groups else hand + "Hand"
on_hand = np.array([any(names[g.group] == weapon_group and g.weight >= 0.99 for g in v.groups) for v in body.data.vertices])
sword = np.where((dist < skin_fix.SWORD_RADIUS) & on_hand)[0]
sword_set = set(sword.tolist())
grip_dist = np.linalg.norm(rest_world - grip, axis=1)
near_grip = set(np.where(grip_dist < 0.15)[0].tolist())
body_idx = [i for i in range(len(rest_world)) if i not in sword_set and i not in near_grip]
tip_idx = int(sword[np.argmax(np.linalg.norm(rest_world[sword] - grip, axis=1))])


dominant = np.array([max(((names[g.group], g.weight) for g in v.groups), key=lambda kv: kv[1], default=("", 0))[0]
                     for v in body.data.vertices])
sword_mask = np.zeros(len(dominant), bool)
sword_mask[sword] = True
legs_mask = np.array([d.endswith(("UpLeg", "Leg", "Foot", "ToeBase")) for d in dominant]) & ~sword_mask
masks = {"legsFeet": legs_mask, "sword": sword_mask, "hipsCape": (dominant == "Hips") & ~sword_mask,
         "other": ~legs_mask & ~sword_mask & (dominant != "Hips")}


def evaluated_points():
    deps = bpy.context.evaluated_depsgraph_get()
    ev = body.evaluated_get(deps)
    me = ev.to_mesh()
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", co)
    ev.to_mesh_clear()
    m = np.array(ev.matrix_world)
    return co.reshape(-1, 3) @ m[:3, :3].T + m[:3, 3]


def head_world(name):
    return np.array(arm.matrix_world @ arm.pose.bones[name].head)


def rot_angle(a, b):
    return (a.to_3x3().inverted() @ b.to_3x3()).to_quaternion().angle


report = {"fps": fps, "swordVertices": len(sword), "clips": {}}
rest_yaw = None
for action in sorted([a for a in bpy.data.actions if a.use_fake_user], key=lambda a: a.name):
    name = action.name
    ad.action = action
    if hasattr(action, "slots") and len(action.slots):
        ad.action_slot = action.slots[0]
    n = int(action.frame_end) + 1
    pts, poses, hips, toes, grips, tips = [], [], [], {"L": [], "R": []}, [], []
    for i in range(n):
        scene.frame_set(i)
        p = evaluated_points()
        pts.append(p)
        poses.append({pb.name: pb.matrix.copy() for pb in arm.pose.bones})
        hips.append(head_world("Hips"))
        toes["L"].append(head_world("LeftToeBase"))
        toes["R"].append(head_world("RightToeBase"))
        grips.append(head_world(hand + "Hand"))
        tips.append(p[tip_idx])
    hips, tips = np.array(hips), np.array(tips)
    c = {"frames": n, "seconds": round(n / fps, 2)}

    # facing at the start: lateral axis from the two hip joints, 0 deg = facing the rest direction
    lat = head_world("LeftUpLeg") - head_world("RightUpLeg")
    c["startYawDeg"] = None
    scene.frame_set(0)
    lat0 = head_world("LeftUpLeg") - head_world("RightUpLeg")
    c["startYawDeg"] = round(math.degrees(math.atan2(lat0[1], lat0[0])), 1)
    c["startHipsXY"] = [round(float(hips[0][0]), 3), round(float(hips[0][1]), 3)]

    # motion per frame (largest bone rotation step) and the loop seam
    steps = [max(rot_angle(poses[i][b], poses[i + 1][b]) for b in poses[i]) for i in range(n - 1)]
    seam = max(rot_angle(poses[-1][b], poses[0][b]) for b in poses[0])
    mean_step = float(np.mean(steps)) if steps else 0.0
    c["meanMaxBoneStepDeg"] = round(math.degrees(mean_step), 2)
    c["loopSeamDeg"] = round(math.degrees(seam), 2)
    c["loopSeamHipsM"] = round(float(np.linalg.norm(hips[-1] - hips[0])), 3)
    if loops.get(name):
        ok = seam <= 1.5 * max(mean_step, 1e-6) and np.linalg.norm(hips[-1] - hips[0]) < 0.03
        c["loopVerdict"] = "PASS" if ok else "WARN"
        c["loopNote"] = "last frame to first frame jump vs. a normal frame step (<=1.5x) and hips <3 cm"

    # feet: horizontal speed while a toe is on the ground (low relative to its own minimum)
    for side in ("L", "R"):
        z = np.array([p[2] for p in toes[side]])
        xy = np.array([p[:2] for p in toes[side]])
        contact = z < z.min() + 0.03
        sp = [np.linalg.norm(xy[i + 1] - xy[i]) * fps for i in range(n - 1) if contact[i] and contact[i + 1]]
        c[f"foot{side}"] = {"contactFrames": int(contact.sum()),
                            "contactSpeedMean": round(float(np.mean(sp)), 3) if sp else None,
                            "contactSpeedCV": round(float(np.std(sp) / np.mean(sp)), 2) if sp and np.mean(sp) > 1e-3 else None}

    # floor and body
    zmin = {k: round(float(min(p[m, 2].min() for p in pts)), 3) for k, m in masks.items()}
    c["minZByPart"] = zmin  # lowest point over the clip per part; legs/feet are what must touch the floor
    c["floorVerdict"] = "PASS" if zmin["legsFeet"] > -0.03 else "WARN"
    c["floorNote"] = "verdict on legs/feet only; cape (hips-weighted) and sword may dip into the floor"
    c["hipsEndZ"] = round(float(hips[-1][2]), 3)

    # death hold: nothing may still move over the last frames
    if holds.get(name):
        tail = [np.abs(pts[i + 1] - pts[i]).max() for i in range(n - 7, n - 1)]
        c["lastFramesMaxVertexMoveM"] = round(float(max(tail)), 4)
        c["holdVerdict"] = "PASS" if max(tail) < 0.003 else "WARN"

    # sword near the body (proximity proxy, not penetration)
    tree_counts = []
    for p in pts:
        tr = kdtree.KDTree(len(body_idx))
        for k, i in enumerate(body_idx):
            tr.insert(p[i], k)
        tr.balance()
        tree_counts.append(sum(1 for i in sword if tr.find(p[i])[2] < 0.02))
    c["swordNearBodyMaxVerts"] = int(max(tree_counts))
    c["swordNearBodyFrames"] = int(sum(1 for v in tree_counts if v > 0))

    # hit events from the sword tip speed (heuristic): impact = fastest frame
    if hits.get(name):
        sp = np.array([np.linalg.norm(tips[i + 1] - tips[i]) * fps for i in range(n - 1)])
        peak = int(np.argmax(sp))
        thr = 0.3 * sp[peak]
        s = peak
        while s > 0 and sp[s - 1] > thr:
            s -= 1
        r = peak
        while r < len(sp) - 1 and sp[r] > thr:
            r += 1
        moved = np.where(np.linalg.norm(tips - tips[0], axis=1) > 0.05)[0]
        c["events"] = {"windupStart": int(moved[0]) if len(moved) else 0, "swingStart": int(s), "impact": peak,
                       "recoverStart": int(r), "end": n - 1, "fps": fps, "peakTipSpeedMps": round(float(sp[peak]), 2),
                       "method": "sword tip speed: impact = fastest frame, swing/recover where speed passes 30% of peak (heuristic)"}
    report["clips"][name] = c
    print("QA", name, json.dumps(c)[:200])

with open(report_path, "w", encoding="utf-8") as fh:
    json.dump(report, fh, indent=2)
print("QA_DONE")
