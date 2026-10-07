'use strict';
/* bfTickApproach 成本量測：無頭引擎、等級 300、stage 60、場上補到 100 隻敵人。
   node scratch/_bf_approach_prof.cjs [steps] ；加 --cpu-prof 取 cpuprofile。
   同時輸出每步座標雜湊，改前後比對是否逐步一致。 */
const vm = require('vm');
const crypto = require('crypto');
let CTX = null;
const orig = vm.runInContext;
vm.runInContext = function (code, ctx, o) { if (ctx && ctx.postMessage && ctx.importScripts) CTX = ctx; return orig.call(this, code, ctx, o); };
const { createEngine } = require('../scripts/sim/engine');
const eng = createEngine({ seed: 20261007 }).boot(null);
const G = eng.state();
G.player.level = 300;
G.stage.current = 60; G.stage.best = Math.max(G.stage.best || 0, 60);
eng.step(20);
const steps = Number(process.argv[2] || 300);
let approachMs = 0, calls = 0, maxLive = 0;
const wrapped = CTX.bfTickApproach;
const h = crypto.createHash('sha1');
// 場上補到 100 隻：複製現有敵人
function topUp() {
  const f = CTX.FIELD; if (!f || !f.monsters) return;
  const src = f.monsters.filter(e => e && e.hp > 0);
  if (!src.length) return;
  let k = 0;
  while (f.monsters.filter(e => e && e.hp > 0).length < 100 && k < 200) {
    const s = src[k % src.length]; k++;
    const c = Object.assign({}, s, { pos: { x: s.pos.x + (k * 37 % 90) - 45, y: s.pos.y + (k * 53 % 90) - 45 }, hp: 1e12, maxHp: 1e12 });
    f.monsters.push(c);
  }
}
CTX.bfTickApproach = function (en, dt) {
  const t = process.hrtime.bigint();
  const r = wrapped.call(this, en, dt);
  approachMs += Number(process.hrtime.bigint() - t) / 1e6; calls++;
  let live = 0;
  for (const e of en) if (e && e.hp > 0 && e.pos) { live++; h.update(e.pos.x.toFixed(9) + ',' + e.pos.y.toFixed(9) + ';'); }
  maxLive = Math.max(maxLive, live); h.update('|');
  return r;
};
for (let i = 0; i < steps; i++) { topUp(); eng.step(1); }
console.log({ steps, calls, maxLive, approachMsPerCall: +(approachMs / Math.max(1, calls)).toFixed(3), hash: h.digest('hex') });
