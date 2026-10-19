'use strict';
// Pending changes are instructions, never a second source of game configuration.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const writeJson = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n', { flag: 'wx' });
function isValue(v) {
  return v === null || typeof v === 'string' || typeof v === 'boolean' ||
    (typeof v === 'number' && Number.isFinite(v)) ||
    (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1 &&
      typeof v.formula === 'string' && v.formula.startsWith('='));
}
function same(a, b) {
  // Excel's genuinely empty cell can be returned as either null or empty text.
  if ((a === null || a === '') && (b === null || b === '')) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}
function validate(p) {
  if (!p || p.version !== 1 || typeof p.agent !== 'string' || !p.agent.trim() || typeof p.task !== 'string' || !p.task.trim() ||
      !Array.isArray(p.changes) || !p.changes.length) throw Error('需要 version:1、agent、task 與非空 changes。');
  for (const c of p.changes) {
    if (!c || typeof c.workbook !== 'string' || !/^[^\\/:*?"<>|]+\.xlsx$/i.test(c.workbook) ||
        c.workbook.startsWith('~$') || c.workbook === '..xlsx') throw Error('workbook 必須是 config/Excel 內的單一 .xlsx 檔名。');
    if (typeof c.sheet !== 'string' || !c.sheet || !Number.isInteger(c.headerRow) || c.headerRow < 1 ||
        c.headerRow > 1048575 || typeof c.column !== 'string' || !c.column ||
        !c.key || Array.isArray(c.key) || typeof c.key !== 'object' || !Object.keys(c.key).length)
      throw Error('每項修改需要 sheet、headerRow、key 與 column。');
    if (Object.keys(c.key).some(k => !k || !isValue(c.key[k]) || c.key[k] === null ||
        c.key[k] === '' || typeof c.key[k] === 'object')) throw Error('主鍵只接受非空文字、數字或布林。');
    if (Object.hasOwn(c.key, c.column)) throw Error('不得修改定位用的主鍵欄。');
    if (!Object.hasOwn(c, 'before') || !Object.hasOwn(c, 'after') || !isValue(c.before) || !isValue(c.after))
      throw Error('before／after 必須明確指定為值、null 或 {formula:"=..."}。');
    if (c.approval && (c.approval.by !== 'user' || typeof c.approval.reason !== 'string' || !c.approval.reason.trim() ||
        !Object.hasOwn(c.approval, 'current') || !isValue(c.approval.current) ||
        !Object.hasOwn(c.approval, 'selected') || !isValue(c.approval.selected) || !Array.isArray(c.approval.proposals)))
      throw Error('approval 需要 by:user、reason、current、selected 及完整 proposals；只能於使用者明確同意後填寫。');
  }
  return p;
}
function decide(records) {
  const cells = new Map(), conflicts = [], actions = [];
  for (const r of records) {
    const id = JSON.stringify([r.workbook.toLowerCase(), r.sheet.toLowerCase(), r.address]);
    if (!cells.has(id)) cells.set(id, []);
    cells.get(id).push(r);
  }
  for (const group of cells.values()) {
    const r = group[0];
    const proposals = group.map(g => ({ agent: g.agent, task: g.task, before: g.before, after: g.after }));
    const canonical = a => a.map(v => JSON.stringify([v.agent, v.task, v.before, v.after])).sort().join('\n');
    const approved = group.every(g => g.approval && g.approval.by === 'user' && g.approval.reason &&
      same(g.approval.current, r.current) && same(g.approval.selected, r.approval?.selected) &&
      canonical(g.approval.proposals) === canonical(proposals));
    if (approved && (same(r.approval.selected, r.current) || group.some(g => same(g.after, r.approval.selected)))) {
      if (!same(r.current, r.approval.selected)) actions.push({ ...r, after: r.approval.selected });
      continue;
    }
    // A durable receipt proves this exact request already wrote this exact workbook.
    // Matching after alone cannot distinguish an interrupted run from a user's edit.
    if (group.every(g => g.recovered)) continue;
    if (group.length > 1 || !same(r.current, r.before) || group.some(g => g.approval)) {
      conflicts.push({ ...r, proposals, requests: group,
        reason: group.length > 1 ? '多份 Agent 修改同一格，必須詢問使用者（包含相同新值）' :
          'Excel 現值與原值不同或先前同意已失效，必須詢問使用者' });
    } else actions.push(r);
  }
  return { actions: conflicts.length ? [] : actions, conflicts };
}
function merge(root = ROOT) {
  const queue = path.join(root, 'config', 'param-patches');
  if (!fs.existsSync(queue)) { console.log('[param-patches] 沒有待合併修改。'); return 0; }
  const names = fs.readdirSync(queue).filter(n => n.endsWith('.json')).sort();
  if (!names.length) { console.log('[param-patches] 沒有待合併修改。'); return 0; }
  const patches = names.map(name => {
    const file = path.join(queue, name);
    return { file, hash: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), patch: validate(readJson(file)) };
  });
  if (process.platform !== 'win32') throw Error('合併需要 Windows 與 Microsoft Excel；待套用檔已保留。');
  const run = path.join(queue, 'archive', new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomUUID());
  fs.mkdirSync(run, { recursive: true });
  const manifest = path.join(run, 'manifest.json');
  writeJson(manifest, patches);
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(__dirname, 'merge-param-patches.ps1'), '-Root', root, '-Manifest', manifest,
    '-NodePath', process.execPath], { stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  return result.status === null ? 1 : result.status;
}
function main(args) {
  if (args[0] === '--stage' && args[1]) {
    const patch = validate(readJson(args[1]));
    const root = args[2] ? path.resolve(args[2]) : ROOT;
    const queue = path.join(root, 'config', 'param-patches');
    fs.mkdirSync(queue, { recursive: true });
    const out = path.join(queue, crypto.randomUUID() + '.json');
    writeJson(out, patch);
    console.log('[param-patches] 已暫存：' + out + '\n請儲存並關閉 Excel，再執行「套用參數.bat」。尚未套用至 Excel／CSV／遊戲。');
    return 0;
  }
  if (args[0] === '--merge') return merge(args[1] ? path.resolve(args[1]) : ROOT);
  if (args[0] === '--decide' && args[1] && args[2]) {
    writeJson(args[2], decide(readJson(args[1])));
    return 0;
  }
  throw Error('用法：node tools/param-patches.cjs --stage request.json | --merge');
}
module.exports = { validate, same, decide, merge };
if (require.main === module) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (e) { console.error('[param-patches] ' + e.message); process.exitCode = 1; }
}
