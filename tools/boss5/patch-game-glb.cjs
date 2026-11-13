'use strict';
/* 遊戲用 GLB 的材質微調：node tools/boss5/patch-game-glb.cjs <in.glb> <out.glb> [baseColorScale=0.5]
   遊戲的 3D 角色渲染（js/hero3d.js：ACES 色調映射＋環境光＋主光）會把飽和的朱紅曬成粉紅，
   所以把面具與後腦兩個材質的 baseColorFactor 乘上一個係數壓暗（只改 JSON 區塊，二進位資料不動）。 */
const fs = require('fs');
const [src, dst, kArg] = process.argv.slice(2);
const k = Number(kArg || 0.5);
const b = fs.readFileSync(src);
const jl = b.readUInt32LE(12), json = JSON.parse(b.slice(20, 20 + jl).toString('utf8'));
for (const m of json.materials) if (m.name === 'BakedMaterial' || m.name === 'DomeMat') m.pbrMetallicRoughness.baseColorFactor = [k, k, k, 1];
let text = JSON.stringify(json); while (Buffer.byteLength(text) % 4) text += ' ';
const jb = Buffer.from(text, 'utf8');
const head = Buffer.alloc(20); b.copy(head, 0, 0, 12);
head.writeUInt32LE(jb.length, 12); head.writeUInt32LE(0x4E4F534A, 16);
const rest = b.slice(20 + jl);
const out = Buffer.concat([head, jb, rest]);
out.writeUInt32LE(out.length, 8);
fs.writeFileSync(dst, out);
console.log('patched', dst, 'baseColorFactor', k, out.length);
