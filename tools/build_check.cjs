'use strict';
/* ============================================================
   build_check.cjs — 零建置專案的「編譯」檢查（npm run build）
   對 js/、tools/、tests/ 內所有 JS 檔執行 node --check 語法/編譯驗證，
   另外檢查遊戲檔案是否被寫成空檔（曾發生 combat.js 被並行工具清空事故）。
   任何一項失敗即以非零代碼結束（Error ≠ 0 → build 失敗）。
   ============================================================ */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const TARGETS = [
  { dir: 'js', ext: /\.js$/, mustNotBeEmpty: true },   // 遊戲程式：語法 + 防空檔
  { dir: 'tools', ext: /\.cjs$/, mustNotBeEmpty: false },
  { dir: 'tests', ext: /\.cjs$/, mustNotBeEmpty: false }
];

let checked = 0;
const errors = [];

for (const t of TARGETS) {
  const dir = path.join(root, t.dir);
  if (!fs.existsSync(dir)) continue;
  for (const name of fs.readdirSync(dir)) {
    if (!t.ext.test(name)) continue;
    const file = path.join(dir, name);
    const rel = t.dir + '/' + name;
    checked++;
    // 防空檔：遊戲檔案 0 byte 視為 build 失敗（index.html 仍會載入 → ReferenceError 卡 Loading）
    if (t.mustNotBeEmpty && fs.statSync(file).size === 0) {
      errors.push(rel + '：檔案為空（0 bytes）— 可能被編輯工具誤清空');
      continue;
    }
    const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (r.status !== 0) {
      errors.push(rel + '：語法錯誤\n' + (r.stderr || '').trim());
    }
  }
}

if (errors.length) {
  console.error('❌ build 失敗（' + errors.length + ' 個錯誤 / 共檢查 ' + checked + ' 檔）：\n');
  for (const e of errors) console.error('  ✗ ' + e + '\n');
  process.exit(1);
} else {
  console.log('✅ build 通過：' + checked + ' 個檔案語法/編譯檢查全數 OK，無空檔。');
}
