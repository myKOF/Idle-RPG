'use strict';
/* 效能量測：跑 N 遊戲小時，回報實測步數/秒與縮時倍率。
   倍率是量測結果，不是設定值——這支存在的理由就是不讓任何人用估的。

   用法：node scripts/bench_sim.js [遊戲小時數] [seed] */

const { createEngine } = require('./sim/engine');

const hours = Number(process.argv[2] || 1);
const seed = Number(process.argv[3] || 20260730);

const t0 = process.hrtime.bigint();
const eng = createEngine({ seed }).boot(null);
const bootMs = Number(process.hrtime.bigint() - t0) / 1e6;

const totalSteps = Math.round((hours * 3600) / eng.dt);
const CHUNK = Math.max(1, Math.round(600 / eng.dt)); // 每 10 遊戲分鐘回報一次
let done = 0;
const t1 = process.hrtime.bigint();
let lastAt = t1;

while (done < totalSteps) {
  const n = Math.min(CHUNK, totalSteps - done);
  eng.step(n);
  done += n;
  const now = process.hrtime.bigint();
  const segSec = Number(now - lastAt) / 1e9;
  lastAt = now;
  const v = eng.view();
  process.stdout.write(
    `  遊戲 ${(done * eng.dt / 3600).toFixed(2)}h  本段 ${(n / segSec / 1000).toFixed(1)}k步/秒` +
    `  Lv.${v.level}  stage ${v.stage}\n`
  );
}

const elapsedSec = Number(process.hrtime.bigint() - t1) / 1e9;
const stepsPerSec = totalSteps / elapsedSec;
const speedup = (hours * 3600) / elapsedSec;
const v = eng.view();

console.log('\n──────── 實測 ────────');
console.log(`開機          ${bootMs.toFixed(0)} ms`);
console.log(`模擬時數      ${hours} h（${totalSteps.toLocaleString()} 步 × ${eng.dt}s）`);
console.log(`耗時          ${elapsedSec.toFixed(2)} s`);
console.log(`吞吐          ${(stepsPerSec / 1000).toFixed(1)}k 步/秒`);
console.log(`縮時倍率      ${Math.round(speedup).toLocaleString()}x`);
console.log(`→ 100 小時推估 ${(360000 / speedup).toFixed(1)} 秒`);
console.log(`結果          Lv.${v.level}  stage ${v.stage}  gold ${v.gold}  轉生 ${eng.state().player.reincarnations || 0}`);
