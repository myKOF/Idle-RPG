'use strict';
/* 狀態雜湊。

   ⚠️ 一定要正規化（遞迴排序物件鍵）再雜湊。直接 sha256(JSON.stringify(G)) 會把
   「鍵的插入順序」也算進去——而插入順序只反映欄位第一次被寫入的先後，不是遊戲狀態。
   實測過：兩份內容完全相同的存檔，只因為 shownRes 的旗標латч順序不同就得到不同雜湊。
   拿那種雜湊去做 A/B 或跨環境比對，會得到大量假的不一致。

   陣列順序**保留**（那是有意義的：背包排序、技能配置、輸送帶）。 */

const crypto = require('crypto');

function canonical(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(canonical);
  const out = {};
  for (const k of Object.keys(v).sort()) out[k] = canonical(v[k]);
  return out;
}

function canonicalJson(objOrJson) {
  const obj = typeof objOrJson === 'string' ? JSON.parse(objOrJson) : objOrJson;
  return JSON.stringify(canonical(obj));
}

function stateHash(objOrJson) {
  return crypto.createHash('sha256').update(canonicalJson(objOrJson)).digest('hex');
}

module.exports = { canonical, canonicalJson, stateHash };
