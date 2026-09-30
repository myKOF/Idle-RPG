'use strict';
/* ============================================================
   skills2-levels-memo.test.cjs — skills2Levels 的快取

   2026-09-30 CPU 剖析（臨界雷劫，32 隻敵人）：Worker 時間的 40% 花在每次命中都重算
   「這個群組現在幾級」（sgTierUnlockedBy 21%＋sgEffectiveLevels 14%＋…），真正算傷害的
   resolveHit 只有 6%。快取後穩態 357 → 210 ms／遊戲秒。

   快取的承諾只有一條：**結果與不快取位元相同**。所以這裡釘的是每一個會讓結果改變的輸入
   都會讓快取失效（等級、轉生數、存檔裡的等級陣列——就地改或整個換掉、各階解鎖門檻），
   回傳的是新陣列（呼叫端會就地改它），以及整場戰鬥前後存檔雜湊一致。
   ============================================================ */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const { createEngine } = require(path.join(root, 'scripts/sim/engine'));

function boot() {
  const eng = createEngine({ seed: 20260930 }).boot(null);
  const ctx = eng.ctx;
  const run = (e) => vm.runInContext(e, ctx);
  return { eng, ctx, run, gids: run('Object.keys(SKILLS2)') };
}
/* 不快取的參考實作（快取加入之前 skills2Levels 的原樣）。 */
const REF = "sgEffectiveLevels((typeof G !== 'undefined' && G && G.player && G.player.skills2) ? G.player.skills2.levels : null, GID)";
const ref = (run, gid) => JSON.parse(JSON.stringify(run(REF.replace('GID', JSON.stringify(gid)))));
const got = (run, gid) => JSON.parse(JSON.stringify(run('skills2Levels(' + JSON.stringify(gid) + ')')));

test('MEMO-1 任意狀態下，每個群組的結果都與不快取相同（隨機狀態＋就地修改＋整個換掉）', () => {
  const { run, gids } = boot();
  let seed = 12345;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  run('G.player.skills2 = G.player.skills2 || { levels: {} }; G.player.skills2.levels = G.player.skills2.levels || {};');
  let checks = 0;
  for (let round = 0; round < 120; round++) {
    const gid = gids[rnd(gids.length)];
    const tiers = run('SKILLS2[' + JSON.stringify(gid) + '].tiers.length');
    const arr = Array.from({ length: tiers }, () => rnd(4) === 0 ? rnd(14) : rnd(4) === 0 ? 0 : 10);
    if (rnd(2)) run('G.player.skills2.levels[' + JSON.stringify(gid) + '] = ' + JSON.stringify(arr));      // 整個換掉
    else {                                                                                                    // 就地改
      run('G.player.skills2.levels[' + JSON.stringify(gid) + '] = G.player.skills2.levels[' + JSON.stringify(gid) + '] || []');
      arr.forEach((v, i) => run('G.player.skills2.levels[' + JSON.stringify(gid) + '][' + i + '] = ' + v));
    }
    run('G.player.level = ' + (1 + rnd(900)) + '; G.player.reincarnations = ' + rnd(4));
    for (const g of gids) {
      assert.deepEqual(got(run, g), ref(run, g), 'round ' + round + ' ' + g);
      checks++;
    }
    // 連問兩次（第二次走快取）結果也一樣
    assert.deepEqual(got(run, gid), ref(run, gid));
  }
  assert.ok(checks > 2000);
});

test('MEMO-2 每一個輸入變動都會讓快取失效', () => {
  const { run } = boot();
  const gid = 'thunderorb';
  run('G.player.skills2.levels.thunderorb = [10,10,10,10,10,10,10]; G.player.level = 800; G.player.reincarnations = 0;');
  const base = got(run, gid);
  assert.deepEqual(base, ref(run, gid));
  assert.deepEqual(got(run, gid), base, '第二次（快取命中）');

  run('G.player.level = 500');                       // 人物等級降低 → 高階解鎖被收回
  assert.deepEqual(got(run, gid), ref(run, gid));
  assert.notDeepEqual(got(run, gid), base, '等級變了，結果必須跟著變（這項若相同，測試情境就沒有意義）');

  run('G.player.level = 800');
  assert.deepEqual(got(run, gid), base, '恢復後回到原結果');

  run('G.player.reincarnations = 1');                // 轉生數
  assert.deepEqual(got(run, gid), ref(run, gid));

  run('G.player.reincarnations = 0; G.player.skills2.levels.thunderorb[2] = 3');   // 就地改一格
  assert.deepEqual(got(run, gid), ref(run, gid));
  assert.equal(got(run, gid)[2], 3);

  run('G.player.skills2.levels.thunderorb = [1,1,1,1,1,1,1]');                     // 整個換一個陣列
  assert.deepEqual(got(run, gid), ref(run, gid));
  assert.equal(got(run, gid)[3], 1);

  run('G.player.skills2.levels.thunderorb = [10,10,10,10,10,10,10]');
  assert.deepEqual(got(run, gid), base);
});

test('MEMO-2b 轉生數改變且結果真的跟著變的情境（第 4 階要「1 轉」才開）', () => {
  const { run } = boot();
  run('G.player.skills2.levels.thunderorb = [10,10,10,10,10,10,10]; G.player.level = 999;');
  run('SKILLS2.thunderorb.tiers[3].unlock = { reinc: 1, lv: 1 }');
  run('G.player.reincarnations = 0');
  assert.equal(got(run, 'thunderorb')[3], 0, '0 轉：第 4 階鎖住');
  assert.deepEqual(got(run, 'thunderorb'), ref(run, 'thunderorb'));
  run('G.player.reincarnations = 1');
  assert.equal(got(run, 'thunderorb')[3], 10, '1 轉：解鎖');
  assert.deepEqual(got(run, 'thunderorb'), ref(run, 'thunderorb'));
  run('G.player.reincarnations = 0');
  assert.equal(got(run, 'thunderorb')[3], 0, '回到 0 轉：又鎖住');
  assert.deepEqual(got(run, 'thunderorb'), ref(run, 'thunderorb'));
});

test('MEMO-3 各階解鎖門檻就地被改也會失效（不假設 SKILLS2 永遠不動）', () => {
  const { run } = boot();
  run('G.player.skills2.levels.thunderorb = [10,10,10,10,10,10,10]; G.player.level = 600; G.player.reincarnations = 0;');
  const before = got(run, 'thunderorb');
  assert.deepEqual(before, ref(run, 'thunderorb'));
  run('SKILLS2.thunderorb.tiers[3].unlock = { reinc: 0, lv: 9999 }');    // 換一個門檻物件
  assert.deepEqual(got(run, 'thunderorb'), ref(run, 'thunderorb'));
  assert.equal(got(run, 'thunderorb')[3], 0, '門檻抬高之後第 4 階應被鎖上');
  run('SKILLS2.thunderorb.tiers[3].unlock.lv = 1');                      // 就地改同一個物件的欄位
  assert.deepEqual(got(run, 'thunderorb'), ref(run, 'thunderorb'));
  assert.equal(got(run, 'thunderorb')[3], 10, '門檻降回去應解鎖');
  run('SKILLS2.thunderorb.tiers[3].unlock.reinc = 5');
  assert.deepEqual(got(run, 'thunderorb'), ref(run, 'thunderorb'));
  assert.equal(got(run, 'thunderorb')[3], 0, '要 5 轉才開：鎖住');
  run('delete SKILLS2.thunderorb.tiers[3].unlock');                      // 門檻整個拿掉＝無門檻
  assert.deepEqual(got(run, 'thunderorb'), ref(run, 'thunderorb'));
  assert.equal(got(run, 'thunderorb')[3], 10, '沒有門檻：解鎖');
});

test('MEMO-4 回傳的一律是新陣列：呼叫端就地修改不會污染快取', () => {
  const { run } = boot();
  run('G.player.skills2.levels.thunderorb = [10,10,10,10,10,10,10]; G.player.level = 800;');
  run('skills2Levels("thunderorb")');                     // 暖機：之後每一次都是快取命中
  const a = run('skills2Levels("thunderorb")');
  const b = run('skills2Levels("thunderorb")');
  assert.notStrictEqual(a, b, '兩次快取命中拿到的不能是同一個陣列');
  const snapshot = JSON.stringify(b);
  a[0] = 999; a.push(7);
  assert.equal(JSON.stringify(run('skills2Levels("thunderorb")')), snapshot, '呼叫端改了自己那份，快取不受影響');
});

test('MEMO-5 邊角：未知群組回 null、存檔沒有等級欄位、人物沒有等級／轉生欄位，都與不快取相同', () => {
  const { run } = boot();
  assert.equal(run('skills2Levels("no-such-group")'), null);
  run('delete G.player.skills2.levels.thunderorb');
  assert.deepEqual(got(run, 'thunderorb'), ref(run, 'thunderorb'));
  run('G.player.skills2.levels.thunderorb = [10,"7",null,NaN,undefined,3.9,-2]');   // 髒資料
  for (let i = 0; i < 3; i++) assert.deepEqual(got(run, 'thunderorb'), ref(run, 'thunderorb'), '第 ' + i + ' 次');
  run('var __lv = G.player.level, __rc = G.player.reincarnations; delete G.player.level; delete G.player.reincarnations;');
  try { assert.deepEqual(got(run, 'thunderorb'), ref(run, 'thunderorb')); }
  finally { run('G.player.level = __lv; G.player.reincarnations = __rc;'); }
});

test('MEMO-6 熱路徑真的省下重算：一場臨界雷劫戰鬥裡，sgEffectiveLevels 的呼叫次數遠少於命中次數', () => {
  const { eng, ctx, run } = boot();
  const gm = (l) => eng.cmd('gm.exec', { line: l });
  ['level 800', 'sglv thunderorb max', 'sgult thunderorb 1', 'god 1', 'MP_lock'].forEach(gm);
  eng.state().player.loadout = ['sg:thunderorb'];
  gm('spawn 32 small 1000000');
  let hits = 0, eff = 0;
  const oh = ctx.sgHitOne; ctx.sgHitOne = function () { hits++; return oh.apply(this, arguments); };
  const oe = ctx.sgEffectiveLevels; ctx.sgEffectiveLevels = function () { eff++; return oe.apply(this, arguments); };
  eng.step(70);     // 7 遊戲秒
  assert.ok(hits > 1000, '情境要有足夠的命中，實際 ' + hits);
  assert.ok(eff < hits / 5, '重算 ' + eff + ' 次，命中 ' + hits + ' 次');
});

function fightHash(useReference, seconds) {
  const eng = createEngine({ seed: 424242 }).boot(null);
  const ctx = eng.ctx;
  if (useReference) {
    vm.runInContext('skills2Levels = function (gid) { return ' + REF.replace('GID', 'gid') + '; }', ctx);
  }
  const startLevel = eng.state().player.level;
  eng.step(Math.round(seconds / eng.dt));
  const s = eng.state();
  return { hash: crypto.createHash('sha256').update(eng.saveJson()).digest('hex'), levelUps: s.player.level - startLevel, kills: s.player.totalKills };
}

test('MEMO-7 從零開始打 6 分鐘（含升級與技能解鎖）：整份存檔雜湊與不快取完全相同', () => {
  const a = fightHash(true, 360);
  const b = fightHash(false, 360);
  assert.ok(a.levelUps >= 3, '這場要真的升過級，快取的失效才被走過，實際升 ' + a.levelUps + ' 級');
  assert.equal(b.hash, a.hash);
});

test('MEMO-8 臨界雷劫 20 遊戲秒（打不死的敵人）：整份存檔雜湊與不快取完全相同', () => {
  function run30(useReference) {
    const eng = createEngine({ seed: 20260930 }).boot(null);
    const ctx = eng.ctx;
    const gm = (l) => eng.cmd('gm.exec', { line: l });
    ['level 800', 'sglv thunderorb max', 'sgult thunderorb 1', 'god 1', 'MP_lock'].forEach(gm);
    eng.state().player.loadout = ['sg:thunderorb'];
    gm('spawn 32 small 1000000');
    if (useReference) vm.runInContext('skills2Levels = function (gid) { return ' + REF.replace('GID', 'gid') + '; }', ctx);
    eng.step(200);
    return crypto.createHash('sha256').update(eng.saveJson()).digest('hex');
  }
  assert.equal(run30(false), run30(true));
});
