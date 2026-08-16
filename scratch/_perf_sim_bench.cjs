/* 模擬層（Worker 側）的每 tick 成本量測。
   回答：「20 多隻敵人互相包圍、雙方一邊移動一邊攻擊，尋路與攻擊判定會不會拖垮效能？」

   重點前提：模擬層跑在 Web Worker，tick 是 TICK_MS = 100ms（10 Hz），不是每幀 60Hz。
   所以就算單次 tick 比較貴，攤到每秒也只有 10 次。

   量三件事：
     1. bfTickApproach —— 逼近 + 互斥推擠（推擠是 O(n²)）
     2. bfTickPlayer   —— 我方朝目標移動
     3. 目標選取       —— bfSortedTargets / bfNearestOthers，技能每次施放都會叫

   用法：node scratch/_perf_sim_bench.cjs
*/
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadContext() {
  const context = {
    console,
    Math: Object.create(Math),
    setTimeout() {}, clearTimeout() {},
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
    UI: { dirty: {} },
    blog() {}, floatText() {}, trackDps() {}, recordRunDamage() {}
  };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/combat.js']
    .forEach((file) => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file }));
  context.G = { player: { gold: 0, skills2: { levels: {} }, loadout: [] }, stage: { current: 1 } };
  context.getStats = () => ({
    atk: 1000, matk: 0, hp: 1000, mp: 100, level: 10, aspd: 2, cdr: 0,
    critRate: 0, critDmg: 150, hit: 100, tenacity: 0,
    passives: {}, elemAtk: null, elemDmgPct: 0, elemDmgUp: 0,
    eliteDmg: 0, bossDmg: 0, normalDmg: 0, totalDmgPct: 0, dmgVsElem: null,
    aoeDmg: 0, globalDmgRed: 0
  });
  return context;
}

const ctx = loadContext();

/* 造 n 隻敵人，圍在我方周圍（模擬「被一堆敵人包圍」） */
function makeEnemies(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2;
    const r = 60 + (i % 4) * 34;
    out.push({
      name: 'e' + i, maxHp: 1e9, hp: 1e9, def: 0, mdef: 0, level: 170,
      effects: {}, buffs: {}, dots: [], resist: {}, ctrlRes: 0,
      pos: { x: Math.cos(ang) * r, y: Math.sin(ang) * r }
    });
  }
  return out;
}

function bench(label, fn, iters) {
  fn(); fn();                       // 暖機
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < iters; i++) fn();
  const t1 = process.hrtime.bigint();
  const perCall = Number(t1 - t0) / 1e6 / iters;
  console.log(
    label.padEnd(44) +
    ' 每次 ' + perCall.toFixed(4).padStart(9) + ' ms' +
    '　每秒 10 tick 共佔 ' + (perCall * 10).toFixed(3).padStart(7) + ' ms（' +
    (perCall * 10 / 1000 * 100).toFixed(3) + '% 的 Worker 時間）'
  );
  return perCall;
}

console.log('模擬層 tick 成本（TICK_MS = ' + (ctx.TICK_MS || 100) + 'ms，即每秒 10 次）\n');

for (const n of [10, 20, 25, 40]) {
  const enemies = makeEnemies(n);
  const pEnt = { hp: 1e9, mp: 100, shield: 0, skillCds: {}, buffs: {}, dots: [], effects: {}, _lockTarget: null };
  console.log('--- ' + n + ' 隻敵人 ---');
  bench('bfTickApproach（逼近 + O(n²) 互斥推擠）', () => ctx.bfTickApproach(enemies, 0.1), 20000);
  bench('bfTickPlayer（我方移動）', () => ctx.bfTickPlayer(enemies, 0.1, null, pEnt), 20000);
  bench('bfSortedTargets（依距離排序全場）', () => ctx.bfSortedTargets(enemies), 20000);
  bench('bfNearestOthers（彈射找下一跳，取全部）', () => ctx.bfNearestOthers(enemies[0], enemies, enemies.length), 20000);
  console.log('');
}

/* 技能施放時的目標選取會在同一個 tick 內被呼叫很多次（例如飛刀每次彈射一次）。
   這裡量「一次施放 40 次彈射」的目標選取總成本。 */
{
  const enemies = makeEnemies(25);
  console.log('--- 單次施放的目標選取總量（25 隻敵人）---');
  bench('40 次彈射各呼叫一次 bfNearestOthers', () => {
    for (let i = 0; i < 40; i++) ctx.bfNearestOthers(enemies[i % 25], enemies, enemies.length);
  }, 2000);
}
