'use strict';
/* ============================================================
   skill2-thunderorb-critical-cap.test.cjs — 臨界雷劫子代雷球的數量上限

   2026-09-30 使用者回報：敵人多、我方攻擊低（打不死）時，整個遊戲越來越卡，連 UI 操作都卡。
   根因：超神【臨界雷劫】的靜止雷球每次命中對範圍內每個敵人各擲一次機率，成功就在原地再生一顆，
   平均子代數超過 1，數量沒有天花板。無畫面實測（32 隻打不死的敵人）：第 4 秒 84 顆、第 10 秒 4,144 顆、
   43k 命中／秒，Worker 要 7.5 秒才推進 1 遊戲秒；所有 UI 指令都排在它後面，往返從 29ms 變成數秒。

   使用者定案（2026-09-30）：硬上限 96。低於上限的行為要與沒有上限完全相同。
   這裡用遊戲自己的無畫面引擎（scripts/sim/engine.js，把 sim.worker.js 原封不動載進 vm）跑真的戰鬥。

   ⚠️ 後來補上的世代規則（電球不可再生電球，見 skill2-thunderorb-critical-generation.test.cjs）
   才是根因的修法：衍生代不再繁殖之後，32 隻打不死的敵人下穩態約 57 顆，遠低於 96，上限成了保底。
   所以這裡的情境把上限調小（TEST_CAP）才會真的咬到；預設值 96 另有一條測試釘住。
   ============================================================ */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const { createEngine } = require(path.join(root, 'scripts/sim/engine'));

/* 32 隻血量 ×1,000,000 的敵人＝「我方攻擊太低，打不死」；Lv.800 才有環體電球與伴生雷球。 */
function scenario(seconds, opts) {
  opts = opts || {};
  const eng = createEngine({ seed: 20260930 }).boot(null);
  const gm = (l) => eng.cmd('gm.exec', { line: l });
  ['level 800', 'sglv thunderorb max', 'sgult thunderorb 1', 'god 1', 'MP_lock'].forEach(gm);
  eng.state().player.loadout = ['sg:thunderorb'];
  gm('spawn 32 small 1000000');
  const ctx = eng.ctx;
  const read = (e) => vm.runInContext(e, ctx);
  if (opts.cap !== undefined) vm.runInContext('SG_THUNDERORB_MAX_FIELDS = ' + opts.cap, ctx);
  let hits = 0;
  const origHit = ctx.sgHitOne;
  ctx.sgHitOne = function () { hits++; return origHit.apply(this, arguments); };
  const perSec = Math.round(1 / eng.dt);
  const rows = [];
  let prevHits = 0;
  for (let s = 1; s <= seconds; s++) {
    eng.step(perSec);
    rows.push({
      s,
      orbs: read("SKILL2_RT.grounds.filter(function(f){return f.gid==='thunderorb'&&f.kind==='orb';}).length"),
      offspring: read("SKILL2_RT.grounds.filter(function(f){return f.gid==='thunderorb'&&f.kind==='orb'&&f.vfxTier===6;}).length"),
      hits: hits - prevHits
    });
    prevHits = hits;
  }
  return { rows, read };
}

const RUN_SECONDS = 14;
const TEST_CAP = 40;      // 世代規則之後穩態約 57 顆＞40，上限才會真的咬到
const capped = scenario(RUN_SECONDS, { cap: TEST_CAP });
const unbounded = scenario(RUN_SECONDS, { cap: 1e9 });

test('CRIT-CAP-1 數量有上限：衍生代永遠不超過上限，總場域只比上限多出施放時直接召喚的幾顆', () => {
  const peakOffspring = Math.max(...capped.rows.map((r) => r.offspring));
  const peakOrbs = Math.max(...capped.rows.map((r) => r.orbs));
  assert.ok(peakOffspring <= TEST_CAP, '衍生代最多 ' + peakOffspring);
  assert.ok(peakOrbs <= TEST_CAP + 8, '總雷球最多 ' + peakOrbs + '（飛行雷球是施放時直接召喚的，不受上限限制）');
});

test('CRIT-CAP-2 這個情境沒有上限時會超過 TEST_CAP（證明上限真的有咬到，不是空轉）', () => {
  const peak = Math.max(...unbounded.rows.map((r) => r.offspring));
  assert.ok(peak > TEST_CAP + 10, '取消上限後衍生代應明顯超過 ' + TEST_CAP + '，實際 ' + peak);
});

test('CRIT-CAP-2b 預設上限是 96（使用者 2026-09-30 定案）', () => {
  assert.equal(unbounded.read('SG_THUNDERORB_MAX_FIELDS = 96; SG_THUNDERORB_MAX_FIELDS'), 96);
  const fs = require('node:fs');
  assert.match(fs.readFileSync(path.join(root, 'js/skills2.js'), 'utf8'), /var SG_THUNDERORB_MAX_FIELDS = 96;/);
});

test('CRIT-CAP-3 低於上限時與沒有上限完全相同：同一個種子，到頂之前每一秒的數量與命中數一致', () => {
  let compared = 0;
  for (let i = 0; i < unbounded.rows.length; i++) {
    const u = unbounded.rows[i], c = capped.rows[i];
    if (u.orbs >= TEST_CAP || c.orbs >= TEST_CAP) break;       // 到頂那一秒起才允許分歧
    assert.deepEqual({ orbs: c.orbs, hits: c.hits }, { orbs: u.orbs, hits: u.hits }, '第 ' + u.s + ' 秒');
    compared++;
  }
  assert.ok(compared >= 2, '至少要比對到頂之前的 2 秒，實際 ' + compared);
});

test('CRIT-CAP-4 上限不是把機制關掉：到頂後在上限附近停留，期間雷球持續命中敵人', () => {
  const nearCap = capped.rows.filter((r) => r.orbs >= TEST_CAP * 0.9);
  assert.ok(nearCap.length >= 3, '應有至少 3 秒停留在上限附近，實際 ' + nearCap.length);
  nearCap.forEach((r) => assert.ok(r.hits > 0, '第 ' + r.s + ' 秒沒有任何命中'));
  capped.rows.forEach((r, i) => assert.ok(r.orbs <= unbounded.rows[i].orbs, '第 ' + r.s + ' 秒有上限的數量不該比沒上限多'));
});

test('CRIT-CAP-5 上限確實壓低了命中頻率（相對沒有上限的同一場戰鬥）', () => {
  const tailHits = (x) => x.rows.filter((r) => r.s >= 8).reduce((a, r) => a + r.hits, 0);
  assert.ok(tailHits(capped) < tailHits(unbounded), '有上限 ' + tailHits(capped) + '、無上限 ' + tailHits(unbounded));
});

test('CRIT-CAP-6 上限是可調的單一常數（改小就更小）', () => {
  const small = scenario(9, { cap: 24 });
  const peak = Math.max(...small.rows.map((r) => r.offspring));
  assert.ok(peak <= 24, '上限 24 時衍生代最多 ' + peak);
});

test('CRIT-CAP-7 到頂就不擲骰、不進冷卻，且兩條生成路徑都檢查（伴生雷球命中處與衍生代的 onHit）', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync(path.join(root, 'js/skills2.js'), 'utf8');
  const start = src.indexOf('function sgSpawnStationaryThunderOrb(');
  const body = src.slice(start, src.indexOf('function sgThunderorbBurstHook(', start));
  assert.match(body, /if \(sgThunderorbAtCap\(\)\) return;\s*\n\s*var critical = cfg\.critical;/, '入口要擋（伴生雷球那條路徑走這裡）');
  const onHit = body.slice(body.indexOf('onHit: (critical && !derived)'));
  const iCap = onHit.indexOf('sgThunderorbAtCap()');
  const iRoll = onHit.indexOf('chance(critical.chance)');
  const iCd = onHit.indexOf('thunderCriticalNextAt = GT');
  assert.ok(iCap > 0 && iCap < iRoll && iRoll < iCd, '順序要是：檢查上限 → 擲骰 → 設冷卻');
});
