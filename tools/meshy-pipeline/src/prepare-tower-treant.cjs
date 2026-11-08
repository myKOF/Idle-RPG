'use strict';
// node prepare-tower-treant.cjs SOURCE_DIRECTORY OUTPUT.glb
// Keep the walk mesh/material/bind pose verbatim; copy only donor animation data.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const crypto = require('node:crypto');
const names = ['Walk', 'Attack1', 'Attack2', 'Attack3', 'Die'];
function load(file) {
  const b = fs.readFileSync(file), n = b.readUInt32LE(12), at = 20 + n;
  assert.equal(b.toString('ascii', 0, 4), 'glTF');
  return { json: JSON.parse(b.subarray(20, at)), bin: b.subarray(at + 8, at + 8 + b.readUInt32LE(at)),
    sha256: crypto.createHash('sha256').update(b).digest('hex') };
}
function prepare(source, output) {
  const base = load(path.join(source, 'BOSS2_Walk.glb')), d = base.json;
  const chunks = [base.bin], report = { sources: [], horizontalAttackRoot: 'fixed x/z at first key; vertical motion retained' };
  let length = base.bin.length;
  function append(bytes) {
    const padding = (4 - length % 4) % 4;
    chunks.push(Buffer.alloc(padding), bytes);
    const offset = length + padding; length = offset + bytes.length; return offset;
  }
  for (const semantic of names) {
    const file = 'BOSS2_' + semantic + '.glb', src = load(path.join(source, file)), j = src.json;
    assert.deepEqual(j.nodes, d.nodes, file + ': bind nodes differ');
    assert.deepEqual(j.skins, d.skins, file + ': skin differs');
    assert.equal(j.animations.length, 1);
    const a = structuredClone(j.animations[0]);
    if (semantic !== 'Walk') {
      const viewMap = new Map(), accessorMap = new Map();
      function copyAccessor(index) {
        if (accessorMap.has(index)) return accessorMap.get(index);
        const accessor = structuredClone(j.accessors[index]);
        assert.ok(!accessor.sparse, 'Sparse animation is unsupported');
        const vi = accessor.bufferView;
        if (!viewMap.has(vi)) {
          const view = structuredClone(j.bufferViews[vi]), begin = view.byteOffset || 0;
          view.byteOffset = append(Buffer.from(src.bin.subarray(begin, begin + view.byteLength)));
          view.buffer = 0; viewMap.set(vi, d.bufferViews.length); d.bufferViews.push(view);
        }
        accessor.bufferView = viewMap.get(vi);
        const result = d.accessors.length; accessorMap.set(index, result); d.accessors.push(accessor); return result;
      }
      a.samplers.forEach(s => { s.input = copyAccessor(s.input); s.output = copyAccessor(s.output); });
      if (semantic.startsWith('Attack')) {
        const channel = a.channels.find(c => c.target.path === 'translation' && d.nodes[c.target.node].name === 'mixamorig:Hips');
        const accessor = d.accessors[a.samplers[channel.sampler].output], view = d.bufferViews[accessor.bufferView];
        assert.equal(accessor.componentType, 5126); assert.equal(accessor.type, 'VEC3');
        // Locate the copied buffer view without touching any original geometry bytes.
        const all = Buffer.concat(chunks), start = view.byteOffset + (accessor.byteOffset || 0), stride = view.byteStride || 12;
        const fixed = Buffer.alloc(accessor.count * 12), first = [all.readFloatLE(start), all.readFloatLE(start + 8)];
        let minY = Infinity, maxY = -Infinity;
        for (let i = 0; i < accessor.count; i++) {
          const y = all.readFloatLE(start + i * stride + 4);
          fixed.writeFloatLE(first[0], i * 12); fixed.writeFloatLE(y, i * 12 + 4); fixed.writeFloatLE(first[1], i * 12 + 8);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        }
        accessor.bufferView = d.bufferViews.length; accessor.byteOffset = 0;
        accessor.min = [first[0], minY, first[1]]; accessor.max = [first[0], maxY, first[1]];
        d.bufferViews.push({ buffer: 0, byteOffset: append(fixed), byteLength: fixed.length });
      }
      d.animations.push(a);
    }
    report.sources.push({ file, sha256: src.sha256, semantic, clip: a.name,
      duration: Math.max(...a.samplers.map(s => (semantic === 'Walk' ? j : d).accessors[s.input].max[0])) });
  }
  d.buffers[0].byteLength = length;
  const jsonText = Buffer.from(JSON.stringify(d)), jsonPadding = (4 - jsonText.length % 4) % 4;
  const json = Buffer.concat([jsonText, Buffer.alloc(jsonPadding, 32)]), bin = Buffer.concat([...chunks, Buffer.alloc((4 - length % 4) % 4)]);
  const header = Buffer.alloc(20), binHeader = Buffer.alloc(8);
  header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + json.length + bin.length, 8);
  header.writeUInt32LE(json.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  binHeader.writeUInt32LE(bin.length); binHeader.writeUInt32LE(0x004e4942, 4);
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, Buffer.concat([header, json, binHeader, bin]));
  report.outputSha256 = crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex');
  fs.writeFileSync(output + '.qa.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
if (require.main === module) prepare(path.resolve(process.argv[2]), path.resolve(process.argv[3]));
module.exports = { prepare };
