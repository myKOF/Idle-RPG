"""Bake armor-aware cape deformation while retaining the approved body and grip.

blender -b --python-exit-code 1 --python refine_tower_boss_cape.py -- APPROVED.glb OUTPUT
The original cape mesh/UV is retained. A bilinear skin lattice encodes its
gravity drape plus conservative collision clearance against the animated body.
No runtime cloth simulation or morph-target sequence is required.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

PREFIX = 'CapeFit_'
ROWS, COLS = 15, 9
MARGIN = .028
FLOOR = .038


def action_curves(action):
    for layer in action.layers:
        for strip in layer.strips:
            for slot in action.slots:
                bag = strip.channelbag(slot)
                if bag:
                    yield from bag.fcurves


def original_motion_hash():
    record = []
    for action in sorted(bpy.data.actions, key=lambda a: a.name):
        for curve in action_curves(action):
            if PREFIX in curve.data_path:
                continue
            record.append((action.name, curve.data_path, curve.array_index,
                           [([p.co.x / bpy.context.scene.render.fps, p.co.y], p.interpolation)
                            for p in curve.keyframe_points]))
    return hashlib.sha256(json.dumps(record).encode()).hexdigest()


def mesh_tree(obj, graph):
    mesh = obj.evaluated_get(graph).data
    return BVHTree.FromPolygons([v.co.copy() for v in mesh.vertices],
                               [list(p.vertices) for p in mesh.polygons])


def bake(source, output):
    if source.suffix.lower() == '.glb':
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.context.scene.render.fps = 30
        bpy.ops.import_scene.gltf(filepath=str(source))
    else:
        bpy.ops.wm.open_mainfile(filepath=str(source))
    scene = bpy.context.scene
    arm, cape, body = (bpy.data.objects[n] for n in ['BOSS1_Rig', 'BOSS1_Cape', 'BOSS1_Body'])
    for track in list(arm.animation_data.nla_tracks):
        arm.animation_data.nla_tracks.remove(track)
    assert not any(b.name.startswith(PREFIX) for b in arm.data.bones), 'Use the approved input before refinement'
    original_hash = original_motion_hash()
    rest = np.array([tuple(v.co) for v in cape.data.vertices], dtype=np.float64)
    bounds = np.min(rest, axis=0), np.max(rest, axis=0)
    xs = np.linspace(bounds[0][0], bounds[1][0], COLS)
    zs = np.linspace(bounds[0][2], bounds[1][2], ROWS)
    count = ROWS * COLS
    weights = np.zeros((len(rest), count))
    for index, p in enumerate(rest):
        c = np.clip((p[0] - xs[0]) / (xs[-1] - xs[0]) * (COLS - 1), 0, COLS - 1.00001)
        r = np.clip((p[2] - zs[0]) / (zs[-1] - zs[0]) * (ROWS - 1), 0, ROWS - 1.00001)
        ci, ri = int(c), int(r)
        for dr, wr in [(0, 1 - (r - ri)), (1, r - ri)]:
            for dc, wc in [(0, 1 - (c - ci)), (1, c - ci)]:
                weights[index, (ri + dr) * COLS + ci + dc] = wr * wc
    # Face centers also constrain the surface between vertices, including the
    # long ornament triangles which would escape a vertex-only clearance test.
    faces = [list(p.vertices) for p in cape.data.polygons]
    collision_faces = [f for f in faces if min(rest[i, 2] for i in f) <= 1.505]
    sample_rest = np.vstack([rest, np.array([np.mean(rest[f], axis=0) for f in faces])])
    sample_weights = np.vstack([weights, np.array([np.mean(weights[f], axis=0) for f in faces])])
    seam = sample_rest[:, 2] > 1.505
    margins = np.full(len(sample_rest), MARGIN)
    margins[seam] = .003
    influence = [np.flatnonzero(w > 1e-9) for w in sample_weights]
    # Tikhonov regularization stabilizes unused edge nodes without smoothing
    # away native UV folds. The same least-squares operator is used per frame.
    fit = np.linalg.solve(weights.T @ weights + np.eye(count) * .00001, weights.T)
    actions = list(bpy.data.actions)
    snapshots = {}
    for action in actions:
        arm.animation_data.action = action
        arm.animation_data.action_slot = action.slots[0]
        clip = []
        for sample in range(math.ceil(action.frame_range[0] * 2), math.floor(action.frame_range[1] * 2) + 1):
            frame = sample / 2
            scene.frame_set(math.floor(frame), subframe=frame % 1)
            graph = bpy.context.evaluated_depsgraph_get()
            points = np.array([tuple(v.co) for v in cape.evaluated_get(graph).data.vertices])
            lateral = arm.pose.bones['mixamorig:LeftShoulder'].head - arm.pose.bones['mixamorig:RightShoulder'].head
            lateral.z = 0
            lateral.normalize()
            back = Vector((0, 0, 1)).cross(lateral).normalized()
            clip.append((frame, fit @ (points - rest), tuple(back)))
        snapshots[action.name] = clip
    # New bones encode translations in armature space, leaving every original
    # animation channel and every non-cape vertex group untouched.
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    names = []
    for r, z in enumerate(zs):
        for c, x in enumerate(xs):
            name = f'{PREFIX}{r:02}_{c:02}'
            bone = arm.data.edit_bones.new(name)
            bone.head, bone.tail = (x, .145, z), (x, .145, z - .06)
            names.append(name)
    bpy.ops.object.mode_set(mode='OBJECT')
    cape.vertex_groups.clear()
    for col, name in enumerate(names):
        group = cape.vertex_groups.new(name=name)
        for vertex in np.flatnonzero(weights[:, col] > 1e-9):
            group.add([int(vertex)], float(weights[vertex, col]), 'REPLACE')
    report = {'source': source.name, 'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
              'grid': [ROWS, COLS], 'collisionMarginMeters': MARGIN, 'floorMeters': FLOOR,
              'capeVertices': len(rest), 'surfaceSamples': len(sample_rest),
              'originalAnimationSha256': original_hash, 'clips': {}}
    for action in actions:
        arm.animation_data.action = action
        arm.animation_data.action_slot = action.slots[0]
        clip_report = {'frames': 0, 'maxBackwardCorrectionMeters': 0, 'minCapeZ': 100,
                       'maxInitialIntersectionPairs': 0, 'maxResidualIntersectionPairs': 0}
        previous = np.zeros(count)
        for frame, displacement, back_tuple in snapshots[action.name]:
            scene.frame_set(math.floor(frame), subframe=frame % 1)
            graph = bpy.context.evaluated_depsgraph_get()
            tree = mesh_tree(body, graph)
            surface = body.evaluated_get(graph).data
            body_positions = np.array([tuple(v.co) for v in surface.vertices])
            body_faces = [list(p.vertices) for p in surface.polygons]
            back = np.array(back_tuple)
            back_vector = Vector(back_tuple)
            base_points = rest + weights @ displacement
            initial_tree = BVHTree.FromPolygons([Vector(p) for p in base_points], collision_faces)
            clip_report['maxInitialIntersectionPairs'] = max(clip_report['maxInitialIntersectionPairs'],
                                                             len(tree.overlap(initial_tree)))
            # A short release avoids a one-frame snap when a boot/armor spike
            # ceases contact. Current-frame geometry always takes precedence.
            clearance = previous * .76
            displacement = displacement + clearance[:, None] * back[None, :]
            for iteration in range(4):
                samples = sample_rest + sample_weights @ displacement
                push, lift = np.zeros(count), np.zeros(count)
                for index, point in enumerate(samples):
                    origin = Vector(point) + back_vector * 4
                    hit, _, _, _ = tree.ray_cast(origin, -back_vector, 8)
                    deficit = max(0, (hit - Vector(point)).dot(back_vector) + margins[index]) if hit else 0
                    height = max(0, FLOOR - point[2])
                    if deficit > 1e-6:
                        nodes = influence[index]
                        push[nodes] = np.maximum(push[nodes], deficit)
                    if height > 1e-6:
                        nodes = influence[index]
                        lift[nodes] = np.maximum(lift[nodes], height)
                displacement += push[:, None] * back[None, :]
                displacement[:, 2] += lift
                clearance += push
                if max(np.max(push), np.max(lift)) < .00001:
                    break
            # Thin spikes can cross a triangle between its vertices and center.
            # Resolve complete triangle overlaps as a separate, conservative
            # constraint rather than treating point samples as collision proof.
            body_depths = body_positions @ back
            for iteration in range(12):
                positions = rest + weights @ displacement
                cloth_tree = BVHTree.FromPolygons([Vector(p) for p in positions], collision_faces)
                pairs = tree.overlap(cloth_tree)
                if not pairs:
                    break
                depths = positions @ back
                push = np.zeros(count)
                for body_face, cloth_face in pairs:
                    vertices = collision_faces[cloth_face]
                    deficit = max(0, float(np.max(body_depths[body_faces[body_face]])
                                           - np.min(depths[vertices]) + MARGIN))
                    nodes = np.flatnonzero(np.sum(weights[vertices], axis=0) > 1e-9)
                    push[nodes] = np.maximum(push[nodes], deficit)
                displacement += push[:, None] * back[None, :]
                clearance += push
            positions = rest + weights @ displacement
            residual = len(tree.overlap(BVHTree.FromPolygons([Vector(p) for p in positions], collision_faces)))
            clip_report['maxResidualIntersectionPairs'] = max(clip_report['maxResidualIntersectionPairs'], residual)
            assert residual == 0, (action.name, frame, 'unresolved cloth/armor intersection', residual)
            previous = clearance
            for index, name in enumerate(names):
                bone = arm.pose.bones[name]
                bone.location = arm.data.bones[name].matrix_local.to_3x3().inverted() @ Vector(displacement[index])
                bone.keyframe_insert(data_path='location', frame=frame, group=name)
            clip_report['frames'] += 1
            clip_report['maxBackwardCorrectionMeters'] = max(clip_report['maxBackwardCorrectionMeters'], float(np.max(clearance)))
            clip_report['minCapeZ'] = min(clip_report['minCapeZ'], float(np.min((rest + weights @ displacement)[:, 2])))
        report['clips'][action.name] = clip_report
        print('CAPE_COLLISION_BAKED', action.name, clip_report, flush=True)
    assert original_motion_hash() == original_hash, 'Approved body/grip animation changed'
    for action in actions:
        for curve in action_curves(action):
            if PREFIX in curve.data_path:
                for key in curve.keyframe_points:
                    key.interpolation = 'LINEAR'
    # Retiming keys and handles together preserves every approved pose in
    # seconds, while making the export retain the extra half-frame samples.
    for action in actions:
        for curve in action_curves(action):
            for key in curve.keyframe_points:
                key.co.x *= 2
                key.handle_left.x *= 2
                key.handle_right.x *= 2
    scene.render.fps *= 2
    assert original_motion_hash() == original_hash, 'Approved motion changed during FPS conversion'
    report['bakeFps'] = scene.render.fps
    arm['capeCollisionRig'] = f'{ROWS}x{COLS} bilinear skin; body-surface clearance baked at {scene.render.fps} fps'
    arm['capeCollisionMargin'] = MARGIN
    arm.animation_data.action = bpy.data.actions['Walk']
    arm.animation_data.action_slot = arm.animation_data.action.slots[0]
    scene.frame_set(0)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in (arm, cape, body, bpy.data.objects['BOSS1_Sword']):
        obj.select_set(True)
    output.mkdir(parents=True, exist_ok=True)
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(output / 'BOSS1_preview.blend'))
    bpy.ops.export_scene.gltf(filepath=str(output / 'BOSS1_preview.glb'), export_format='GLB',
                              use_selection=True, export_animations=True,
                              export_animation_mode='ACTIONS', export_force_sampling=True,
                              export_frame_range=False, export_nla_strips=False,
                              export_skins=True, export_morph=False, export_yup=True, export_extras=True)
    report['outputSha256'] = hashlib.sha256((output / 'BOSS1_preview.glb').read_bytes()).hexdigest()
    (output / 'cape-bake-qa.json').write_text(json.dumps(report, indent=2), encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    bake(args.source, args.output)
