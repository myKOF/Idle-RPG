'use strict';
/* BOSS6 動作的根位移處理：node tools/boss6/lock-root.cjs <in.glb> <out.glb>
   與 BOSS3 的做法相同：攻擊1／2／3 的 Hips 水平位移（glTF 的 x／z）固定在第一格，只保留垂直起伏（跳起、下蹲）——
   位移由遊戲自己驅動。Walk 與 Die 原樣。只改動畫取樣的二進位資料，其他位元不動。 */
const fs = require('fs');
const [src, dst] = process.argv.slice(2);
const b = fs.readFileSync(src);
const jl = b.readUInt32LE(12), j = JSON.parse(b.slice(20, 20 + jl).toString('utf8'));
const binStart = 28 + jl;
const bin = Buffer.from(b.slice(binStart));
const hips = j.nodes.findIndex(n => n.name === 'mixamorig:Hips');
for (const a of j.animations) {
  if (!['Attack1', 'Attack2', 'Attack3'].includes(a.name)) continue;
  const c = a.channels.find(c => c.target.node === hips && c.target.path === 'translation');
  const acc = j.accessors[a.samplers[c.sampler].output], v = j.bufferViews[acc.bufferView];
  const off = (v.byteOffset || 0) + (acc.byteOffset || 0), stride = v.byteStride || 12;
  const x0 = bin.readFloatLE(off), z0 = bin.readFloatLE(off + 8);
  let moved = 0;
  for (let i = 0; i < acc.count; i++) {
    const o = off + i * stride;
    moved = Math.max(moved, Math.abs(bin.readFloatLE(o) - x0), Math.abs(bin.readFloatLE(o + 8) - z0));
    bin.writeFloatLE(x0, o); bin.writeFloatLE(z0, o + 8);
  }
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < acc.count; i++) for (let k = 0; k < 3; k++) { const f = bin.readFloatLE(off + i * stride + k * 4); mn[k] = Math.min(mn[k], f); mx[k] = Math.max(mx[k], f); }
  acc.min = mn; acc.max = mx;
  console.log(a.name.padEnd(8), 'hips horizontal drift removed:', moved.toFixed(3), 'm; vertical range', (mx[1] - mn[1]).toFixed(2), 'm');
}
let text = JSON.stringify(j);
while (Buffer.byteLength(text) % 4) text += ' ';
const jb = Buffer.from(text, 'utf8');
const head = Buffer.alloc(20);
b.copy(head, 0, 0, 12);
head.writeUInt32LE(jb.length, 12);
head.writeUInt32LE(0x4E4F534A, 16);
const out = Buffer.concat([head, jb, b.slice(20 + jl, 28 + jl), bin]);   // the BIN chunk header (length + type) stays
out.writeUInt32LE(out.length, 8);
fs.writeFileSync(dst, out);
