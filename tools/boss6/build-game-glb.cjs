'use strict';

const fs = require('node:fs');

function readTrack(gltf, data, animation, node) {
  const channel = animation.channels.find(({ target }) => target.node === node && target.path === 'translation');
  if (!channel) throw new Error('Missing translation track in ' + animation.name);
  const sampler = animation.samplers[channel.sampler];
  if (sampler.interpolation !== 'LINEAR') throw new Error('Expected linear translation in ' + animation.name);
  const time = gltf.accessors[sampler.input];
  const values = gltf.accessors[sampler.output];
  if (time.type !== 'SCALAR' || values.type !== 'VEC3' || time.count !== values.count) {
    throw new Error('Invalid translation track in ' + animation.name);
  }
  function accessor(a, size) {
    if (a.componentType !== 5126 || a.sparse) throw new Error('Expected dense float values in ' + animation.name);
    const view = gltf.bufferViews[a.bufferView];
    if (view.buffer !== 0) throw new Error('Expected embedded data in ' + animation.name);
    const start = (view.byteOffset || 0) + (a.byteOffset || 0);
    const stride = view.byteStride || size * 4;
    return {
      get: (i, axis) => data.readFloatLE(start + i * stride + axis * 4),
      set: (i, axis, value) => data.writeFloatLE(value, start + i * stride + axis * 4)
    };
  }
  const times = accessor(time, 1);
  const positions = accessor(values, 3);
  return {
    values,
    positions,
    time: i => times.get(i, 0),
    count: time.count
  };
}

function writeBounds(track) {
  const { positions, values, count } = track;
  if (!values.min && !values.max) return;
  values.min = Array.from({ length: 3 }, (_, axis) => Math.min(...Array.from({ length: count }, (_, i) => positions.get(i, axis))));
  values.max = Array.from({ length: 3 }, (_, axis) => Math.max(...Array.from({ length: count }, (_, i) => positions.get(i, axis))));
}

function buildGameGlb(source) {
  if (source.readUInt32LE(0) !== 0x46546c67 || source.readUInt32LE(4) !== 2) throw new Error('Expected GLB 2.0');
  const jsonEnd = 20 + source.readUInt32LE(12);
  const gltf = JSON.parse(source.subarray(20, jsonEnd).toString('utf8'));
  const bin = Buffer.from(source.subarray(jsonEnd + 8));
  const hips = gltf.nodes.findIndex(node => node.name === 'mixamorig:Hips');
  const sword = gltf.nodes.findIndex(node => node.name === 'Sword_Rigid');
  if (hips < 0 || sword < 0 || !gltf.nodes.some(node => node.children?.includes(hips) && node.children.includes(sword))) {
    throw new Error('The hips and sword need to share their armature parent');
  }
  for (const name of ['Attack1', 'Attack2', 'Attack3']) {
    const animation = gltf.animations.find(clip => clip.name === name);
    if (!animation) throw new Error('Missing clip ' + name);
    const root = readTrack(gltf, bin, animation, hips);
    const heldSword = readTrack(gltf, bin, animation, sword);
    if (root.count < 2) throw new Error('Expected at least two root keys in ' + name);
    // The engine moves the actor on the battlefield. Remove the same
    // horizontal motion from the hips and the separately baked sword so
    // a jump still rises without pulling the sword out of the hand.
    for (const axis of [0, 2]) {
      const start = root.positions.get(0, axis);
      let frame = 0;
      for (let i = 0; i < heldSword.count; i++) {
        const t = heldSword.time(i);
        while (frame + 1 < root.count - 1 && root.time(frame + 1) < t) frame++;
        const fraction = Math.min(1, Math.max(0, (t - root.time(frame)) / (root.time(frame + 1) - root.time(frame))));
        const past = root.positions.get(frame, axis);
        const next = root.positions.get(frame + 1, axis);
        const delta = past + (next - past) * fraction - start;
        heldSword.positions.set(i, axis, heldSword.positions.get(i, axis) - delta);
      }
      for (let i = 1; i < root.count; i++) root.positions.set(i, axis, start);
    }
    writeBounds(root);
    writeBounds(heldSword);
  }
  let text = JSON.stringify(gltf);
  text += ' '.repeat((4 - Buffer.byteLength(text) % 4) % 4);
  const json = Buffer.from(text);
  const header = Buffer.from(source.subarray(0, 20));
  header.writeUInt32LE(header.length + json.length + 8 + bin.length, 8);
  header.writeUInt32LE(json.length, 12);
  return Buffer.concat([header, json, source.subarray(jsonEnd, jsonEnd + 8), bin]);
}

if (require.main === module) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error('Usage: node build-game-glb.cjs <approved.glb> <boss6.glb>');
  fs.writeFileSync(output, buildGameGlb(fs.readFileSync(input)));
}
module.exports = { buildGameGlb };
