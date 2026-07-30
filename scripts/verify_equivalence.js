'use strict';
/* ============ 等價性與決定論驗證 ============

   harness 只要動過任何一行「什麼時候呼叫遊戲的什麼」，就必須證明它沒有改變遊戲。
   證明方式是最終狀態雜湊比對，不是推論、不是 grep、不是「我認為它是純顯示」。

   三項檢查：
     A. 決定論      同 seed 跑兩次 → G 雜湊必須相同（否則後面每個比對都沒意義）
     B. 改造等價    updateShownRes 改造前 vs 改造後 → G 雜湊必須相同
     C. 種子敏感度  不同 seed → G 雜湊必須不同（確認 seed 真的有接進去，不是常數）

   用法：node scripts/verify_equivalence.js [遊戲小時數] */

const { createEngine } = require('./sim/engine');
const { stateHash } = require('./sim/hash');

const hours = Number(process.argv[2] || 1);

function run(label, opts) {
  const t0 = Date.now();
  const eng = createEngine(opts).boot(null);
  eng.stepHours(hours);
  const json = eng.saveJson();
  const v = eng.view();
  const h = stateHash(json);
  console.log(`  ${label.padEnd(30)} ${h.slice(0, 16)}  Lv.${v.level} stage ${v.stage} gold ${v.gold}  (${((Date.now() - t0) / 1000).toFixed(1)}s, ${(json.length / 1024).toFixed(0)}KB)`);
  return h;
}

console.log(`\n模擬時數 ${hours}h／步長 0.1s（原生 TICK_MS）\n`);

console.log('A. 決定論：同 seed 兩次');
const a1 = run('seed=777 第一次', { seed: 777 });
const a2 = run('seed=777 第二次', { seed: 777 });

console.log('\nB. updateShownRes early-skip 改造是否改變 G');
const b1 = run('改造前的原始實作', { seed: 777, legacyShownRes: true });

console.log('\nC. 種子敏感度');
const c1 = run('seed=778', { seed: 778 });

const results = [
  ['A 決定論（同 seed 兩次雜湊相同）', a1 === a2],
  ['B updateShownRes 改造前後等價（雜湊相同）', a1 === b1],
  ['C 不同 seed 產生不同結果（雜湊不同）', a1 !== c1]
];

console.log('\n──────── 結論 ────────');
let ok = true;
for (const [name, pass] of results) {
  console.log(`${pass ? '✅ PASS' : '❌ FAIL'}  ${name}`);
  if (!pass) ok = false;
}
process.exit(ok ? 0 : 1);
