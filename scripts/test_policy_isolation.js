'use strict';
/* ============ 隔離反證測試 ============

   守門沒被驗證過，等於沒有守門。這支專門去做「策略層應該做不到的事」，
   每一項都必須失敗；任何一項成功就代表隔離破了。

   用法：node scripts/test_policy_isolation.js */

const path = require('path');
const fs = require('fs');
const { createPolicy } = require('./sim/policy');
const { createEngine } = require('./sim/engine');

const ROOT = path.resolve(__dirname, '..');
const policySrc = fs.readFileSync(path.join(ROOT, 'scripts/sim/policy.default.json'), 'utf8');
const policy = createPolicy(JSON.parse(policySrc));

/* 每一項都必須丟出例外（或回傳 undefined 代表那個東西根本不存在）。 */
const ATTEMPTS = [
  ['直接寫遊戲狀態', 'G.player.gold = 999999999'],
  ['讀遊戲狀態', 'G.player.level'],
  ['碰戰鬥狀態（module-level FIELD）', 'FIELD.player.hp = 1'],
  ['呼叫模擬層函式繞過指令表', 'getStats()'],
  ['自己算掉落', 'rollDrop(1, 1)'],
  ['取得 require 逃出沙箱', 'require("fs")'],
  ['取得 process', 'process.exit'],
  /* 建構子逃逸在 vm 裡拿到的是**沙箱自己的** globalThis，不是 Node 的。
     所以檢查的不是「能不能拿到 globalThis」，而是「拿到之後能不能碰到 Node 或遊戲」。 */
  ['用建構子逃逸拿到 Node 的 process', "this.constructor.constructor('return typeof process')()"],
  ['用建構子逃逸拿到 require', "this.constructor.constructor('return typeof require')()"],
  ['用建構子逃逸拿到遊戲狀態', "this.constructor.constructor('return typeof G')()"],
  ['自己造隨機數（會破壞決定論）', 'Math.random()'],
  ['讀真實時間（會破壞決定論）', 'Date.now()']
];

let failures = 0;
console.log('\n策略層隔離反證（每一項都必須失敗）\n');

for (const [name, src] of ATTEMPTS) {
  let outcome;
  let blocked = false;
  try {
    const v = policy.__evalInPolicyContext(src);
    outcome = 'return ' + String(v);
    /* 沒拋錯但拿到 undefined（或 typeof 檢查回 'undefined'），
       代表那個能力在沙箱裡根本不存在——一樣算擋住。 */
    blocked = (v === undefined || v === 'undefined');
  } catch (e) {
    outcome = e.constructor.name + ': ' + e.message.split('\n')[0];
    blocked = true;
  }
  console.log(`${blocked ? '✅ 擋住' : '❌ 沒擋住'}  ${name.padEnd(28)} ${outcome}`);
  if (!blocked) failures++;
}

/* 對照組：確認策略在正常路徑上仍然「有用」——它應該能根據 view 產出合法指令，
   而且那些指令名都存在於 js/worker/protocol.js 的指令表。否則隔離做對了但東西是死的。 */
console.log('\n對照組：策略仍能正常決策，且指令名都在協議指令表內\n');
const eng = createEngine({ seed: 1 }).boot(null);
const cmds = policy.decide({ view: eng.view(), gameTimeSec: 0 });
console.log(`  產出 ${cmds.length} 條指令`);
let unknown = 0;
for (const c of cmds) {
  if (!eng.ctx.commandSpec(c.name)) { console.log(`  ❌ 指令表內沒有 ${c.name}`); unknown++; }
}
if (!cmds.length) { console.log('  ❌ 策略一條指令都沒產出'); failures++; }
if (unknown) failures += unknown;
else console.log('  ✅ 全部通過 commandSpec 檢查');

console.log('\n──────── 結論 ────────');
console.log(failures === 0 ? '✅ PASS 策略層無法接觸遊戲狀態，且仍能正常決策' : `❌ FAIL ${failures} 項未通過`);
process.exit(failures === 0 ? 0 : 1);
