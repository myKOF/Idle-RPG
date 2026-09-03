'use strict';
/* fill-vfx-cells.cjs — 依 vfx-catalog.cjs 把特效欄位填進 config/CSV/{Skills,Skills2,Status}.csv
   前置：tools/config_tables.cjs --gen 已把新欄位（空白）加進 CSV。
   之後：node tools/config_tables.cjs --apply --write 把 CSV 回寫成 JS 字面值。
   ⚠️ 會覆寫三張表的特效欄位（依目錄重填）；使用者已手動改過的格子會被蓋掉——
      正式上線後若只想補新列，改用手填或先備份。 */
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..', '..');
const SCR = __dirname;
const cat = require(path.join(SCR, 'vfx-catalog.cjs'));
const facts = JSON.parse(fs.readFileSync(path.join(SCR, 'skills-vfx-facts.json'), 'utf8'));

function csvParse(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = []; let f = '', row = [], q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f.length || row.length) { row.push(f); rows.push(row); }
  return rows;
}
function csvField(v) { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function csvStringify(rows) { return '\uFEFF' + rows.map(r => r.map(csvField).join(',')).join('\r\n') + '\r\n'; }
function colIdx(header, name) { const i = header.findIndex(h => String(h).split('\n')[0].trim() === name); if (i < 0) throw new Error('找不到欄位 ' + name); return i; }

const SKILL_COLS = [['施放特效', 'cast'], ['攻擊特效', 'attack'], ['飛行子彈', 'projectile'], ['受擊特效', 'hit'], ['地板特效', 'ground']];
const STATUS_COLS = [['施加特效', 'apply'], ['持續特效', 'aura'], ['作用特效', 'tick']];
const presetIds = new Set(Object.keys(cat.PRESETS));
const referenced = new Set();
function put(row, idx, id) { if (!id) { row[idx] = ''; return; } if (!presetIds.has(id)) throw new Error('目錄裡沒有這個 preset：' + id); referenced.add(id); row[idx] = id; }

/* ---- Skills ---- */
{
  const p = path.join(REPO, 'config/CSV/Skills.csv');
  const rows = csvParse(fs.readFileSync(p, 'utf8'));
  const h = rows[0]; const idI = colIdx(h, 'id'); const catI = colIdx(h, '系統分類');
  const cols = SKILL_COLS.map(c => [colIdx(h, c[0]), c[1]]);
  const byId = {}; facts.forEach(f => { byId[f.id] = f; });
  let filled = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]; const id = (row[idI] || '').trim(); if (!id) continue;
    while (row.length < h.length) row.push('');
    if ((row[catI] || '').trim() === 'potential') continue;
    const f = byId[id]; if (!f) { console.warn('Skills：facts 沒有', id); continue; }
    if (f.cat === 'passive') continue;               // 被動技能不會施放
    const roles = cat.skillRoles(f);
    cols.forEach(c => put(row, c[0], roles[c[1]] || ''));
    if (Object.keys(roles).length) filled++;
  }
  fs.writeFileSync(p, csvStringify(rows), 'utf8');
  console.log('Skills.csv 填了', filled, '列');
}

/* ---- Skills2 ---- */
{
  const p = path.join(REPO, 'config/CSV/Skills2.csv');
  const rows = csvParse(fs.readFileSync(p, 'utf8'));
  const h = rows[0]; const gI = colIdx(h, '群組ID'); const tI = colIdx(h, '階數'); const uI = colIdx(h, '超神ID');
  const cols = SKILL_COLS.map(c => [colIdx(h, c[0]), c[1]]);
  let filled = 0; const seenG = new Set();
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]; const gid = (row[gI] || '').trim(); if (!gid) continue;
    while (row.length < h.length) row.push('');
    const def = cat.SKILLS2_VFX[gid]; if (!def) { console.warn('Skills2：目錄沒有群組', gid); continue; }
    seenG.add(gid);
    const tier = Number(row[tI]);
    let roles = null;
    if (tier >= 8) { const uid = (row[uI] || '').trim(); roles = def.ult[uid] || null; }
    else roles = def.tiers[tier - 1] || null;
    cols.forEach(c => put(row, c[0], roles ? (roles[c[1]] || '') : ''));
    if (roles) filled++;
  }
  Object.keys(cat.SKILLS2_VFX).forEach(g => { if (!seenG.has(g)) console.warn('Skills2：CSV 沒有群組', g); });
  fs.writeFileSync(p, csvStringify(rows), 'utf8');
  console.log('Skills2.csv 填了', filled, '列');
}

/* ---- Status ---- */
{
  const p = path.join(REPO, 'config/CSV/Status.csv');
  const rows = csvParse(fs.readFileSync(p, 'utf8'));
  const h = rows[0]; const idI = colIdx(h, '狀態ID');
  const cols = STATUS_COLS.map(c => [colIdx(h, c[0]), c[1]]);
  let filled = 0, missing = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]; const id = (row[idI] || '').trim(); if (!id) continue;
    while (row.length < h.length) row.push('');
    const roles = cat.STATUS_VFX[id];
    if (!roles) { missing.push(id); continue; }
    cols.forEach(c => put(row, c[0], roles[c[1]] || ''));
    if (roles.apply || roles.aura || roles.tick) filled++;
  }
  if (missing.length) console.warn('Status：目錄沒有對應的狀態', missing.join(', '));
  fs.writeFileSync(p, csvStringify(rows), 'utf8');
  console.log('Status.csv 填了', filled, '列');
}

/* 目錄裡沒被任何表引用的 preset（普攻／敵方／潛力走 VFX_COMBAT_DEFAULTS） */
const defaults = new Set();
Object.values(cat.COMBAT_DEFAULTS).forEach(v => Object.values(v).forEach(x => defaults.add(x)));
const unreferenced = [...presetIds].filter(id => !referenced.has(id) && !defaults.has(id));
console.log('表格引用的 preset 數：', referenced.size, '／目錄總數：', presetIds.size);
if (unreferenced.length) console.log('未被表格或預設對應引用的 preset：', unreferenced.join(', '));
