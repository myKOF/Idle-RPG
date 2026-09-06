/* ============================================================
   vfx-preset-coverage.test.cjs — 「舊畫法還在不在」的覆蓋率守門

   為什麼要有這一條：Preset 化的最後一哩不是「有沒有做出 preset」，
   而是「Adapter 會不會接手」。tryPlay 只要回一次 false，那一則事件就退回
   js/vfx.js／battle-renderer.js 的舊畫法——於是同一個技能在同一場戰鬥裡
   同時出現新舊兩種畫面（2026-09-03 實機回報：風刃）。
   靜態 grep 抓不到這件事，因為退回與否取決於事件內容（有沒有目標、有沒有
   area、方位帶了沒），不是取決於原始碼裡有沒有出現某個字串。

   做法：真的跑一次模擬——每個群組七階全滿各施放一次，再把每個超神進化
   逐一選起來各施放一次——收集所有 VFX 事件，逐則餵給真正的 Adapter
   （NullBackend＋真的 vfx/presets/*.json），任何一則 tryPlay 回 false 就失敗。
   ============================================================ */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const VFXCore = require('../js/vfx-core.js');
const VFXRuntime = require('../js/vfx-runtime.js');

const PRESETS = fs.readdirSync(path.join(ROOT, 'vfx/presets'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'vfx/presets', f), 'utf8')));

/* Adapter 的畫面後端在這裡無關緊要：要驗的是「接手了沒」。
   幾何替身給的是固定座標，因為這一條不驗擺位（那是 vfx-runtime.test.cjs 的事）。 */
function makeAdapter() {
  const nul = { createNode: () => ({}), updateNode() {}, destroyNode() {}, destroy() {} };
  const a = VFXRuntime.create({
    core: VFXCore,
    resolver: { has: () => true, resolve: (id) => '/' + id },
    fxBackend: nul, zoneBackend: nul,
    ctx: {
      posOf: () => ({ x: 120, y: 40 }),
      playerPos: () => ({ x: 0, y: 0 }),
      footOf: () => ({ x: 0, y: 0 }),
      projectileTargetPoint: () => ({ x: 120, y: 40 })
    }
  });
  a.registerPresets(PRESETS);
  return a;
}

/* 模擬層：與 tests/skill2-*.test.cjs 同一套載入方式（沒有 DOM、沒有 Worker）。 */
function loadSim() {
  const c = {
    console, Math: Object.create(Math),
    setTimeout() {}, clearTimeout() {},
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
    UI: { dirty: {} },
    blog() {}, floatText() {}, trackDps() {}, recordRunDamage() {}
  };
  c.window = c;
  vm.createContext(c);
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/combat.js',
    'js/skills.js', 'js/skills2.js', 'js/legendary.js'].forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), c, { filename: f });
  });
  c.G = { player: { gold: 0, skills2: { levels: {}, ult: {} }, loadout: [] }, stage: { current: 1 } };
  c.legendaryOn = {};              // 由 castAndCollect 填；空的＝一個傳奇都沒裝
  c.getStats = () => ({
    legendaryEffects: c.legendaryOn, legendaryEffectMults: {},
    atk: 1000, matk: 500, hp: 1000, mp: 999999, level: 10, aspd: 2, cdr: 0,
    critRate: 0, critDmg: 150, hit: 100, tenacity: 0, shieldEff: 0,
    passives: {}, elemAtk: null, elemDmgPct: 0, elemDmgUp: {},
    eliteDmg: 0, bossDmg: 0, normalDmg: 0, totalDmgPct: 0, dmgVsElem: null,
    aoeDmg: 0, globalDmgRed: 0
  });
  c.GT = 0;
  /* 傷害結算不是這一條的受測對象，換成不會殺死任何人的替身：
     敵人先死光的話後半段事件根本不會發出來，覆蓋率就是假的。 */
  c.resolveHit = () => ({ dmg: 100, crit: false, miss: false, blocked: false, killed: false });
  c.applySkillFinalDamageMultiplier = function () {};
  c.enemyEventFloatTarget = (e) => 'e:' + (e && e.name);
  c.playerEventFloatTarget = (s) => s;
  return c;
}

const M = 10;   // 1 米 = 10 個系統距離單位
function enemyAt(n) {
  return {
    name: 'E' + n, maxHp: 1e9, hp: 1e9, def: 0, mdef: 0, level: 1,
    effects: {}, buffs: {}, dots: [], resist: {}, ctrlRes: 0,
    pos: { x: (3 + n * 2) * M, y: ((n % 3) - 1) * M }
  };
}
function playerEnt() {
  return { hp: 1e9, mp: 999999, shield: 0, shieldMax: 0, skillCds: {}, buffs: {}, dots: [], effects: {}, _lockTarget: null };
}

/* 施放一次並跑滿 12 秒：飛行物、地板場域、環繞場域、狀態每跳的事件
   都是之後的 tick 才發出來的，只施放不跑 tick 會漏掉一大半。 */
function castAndCollect(gid, ultIdx, legendKey) {
  const c = loadSim();
  const specs = [];
  c.playCombatVfx = (s) => specs.push(s);
  c.G.player.skills2.levels[gid] = [10, 10, 10, 10, 10, 10, 10];
  if (ultIdx >= 0) c.G.player.skills2.ult[gid] = { pick: ultIdx, lv: 10 };
  if (legendKey) c.legendaryOn[legendKey] = true;
  c.G.player.loadout = [gid];
  const p = playerEnt();
  const es = [];
  for (let i = 0; i < 6; i++) es.push(enemyAt(i));
  c.castSkill2(p, es, gid, 'mv-float');
  const ctx = { pEnt: p, getEnemies: () => es, floatSel: 'mv-float', onDeaths() {}, onDamage() {} };
  for (let t = 0; t < 12; t += 0.05) { c.GT += 0.05; c.tickSkill2(0.05, ctx); }
  return specs;
}

test('COVER-1 每個群組七階全滿時，所有 VFX 事件都由 Preset 接手', function () {
  const gids = Object.keys(loadSim().SKILLS2);
  assert.ok(gids.length >= 20, '技能群組數量不對，載入可能失敗');
  const bad = [];
  let seen = 0;
  gids.forEach(function (gid) {
    const adapter = makeAdapter();
    castAndCollect(gid, -1).forEach(function (s) {
      seen++;
      if (adapter.tryPlay(s) !== true) {
        bad.push(gid + ' ' + (s.fxKind || '?') + '/' + (s.variant || '-') +
          '（vfx=' + (s.vfx ? Object.keys(s.vfx).join('+') : 'null') +
          ' targets=' + ((s.targets || []).length) + ' area=' + (s.area ? 'y' : 'n') + '）');
      }
      adapter.update(0.05);
    });
  });
  assert.ok(seen > 300, '收到的事件太少（' + seen + '），模擬可能沒跑起來');
  assert.deepEqual([...new Set(bad)], [], '這些事件仍會退回舊畫法');
});

test('COVER-2 每個超神進化選起來之後，所有 VFX 事件也都由 Preset 接手', function () {
  const base = loadSim();
  const bad = [];
  let picks = 0;
  Object.keys(base.SKILLS2).forEach(function (gid) {
    const ults = base.SKILLS2[gid].ult || [];
    ults.forEach(function (u, idx) {
      picks++;
      const adapter = makeAdapter();
      castAndCollect(gid, idx).forEach(function (s) {
        if (adapter.tryPlay(s) !== true) {
          bad.push(gid + ' U:' + u.id + ' ' + (s.fxKind || '?') + '/' + (s.variant || '-') +
            '（vfx=' + (s.vfx ? Object.keys(s.vfx).join('+') : 'null') +
            ' targets=' + ((s.targets || []).length) + ' area=' + (s.area ? 'y' : 'n') + '）');
        }
        adapter.update(0.05);
      });
    });
  });
  assert.ok(picks >= 50, '超神進化數量不對（' + picks + '），選取方式可能失效');
  assert.deepEqual([...new Set(bad)], [], '這些事件仍會退回舊畫法');
});

test('COVER-3 超神進化真的有選起來（守住上面兩條不會變成空轉）', function () {
  const c = loadSim();
  const gid = 'windblade';
  c.G.player.skills2.levels[gid] = [10, 10, 10, 10, 10, 10, 10];
  c.G.player.skills2.ult[gid] = { pick: 0, lv: 10 };
  const u = c.skills2Ult(gid);
  assert.ok(u, 'sgUltPickOf 讀不到選取結果——存檔欄位的形狀改了');
  assert.equal(u.id, c.SKILLS2[gid].ult[0].id);
});

test('COVER-4 每個新版技能的傳奇特效裝上之後，所有 VFX 事件也都由 Preset 接手', function () {
  /* 傳奇特效會改寫施放流程（風蝕、旋風劍舞、暴雨梨花…），有些畫面只有裝上它才發得出來。
     一次只裝一個：同時全裝的話，先觸發的那一個可能把後面的分支蓋掉。 */
  const base = loadSim();
  const legends = Object.keys(base.PASSIVE_POOL).filter(function (k) {
    const d = base.PASSIVE_POOL[k];
    return d && d.fx && d.relatedSkill && base.SKILLS2[d.relatedSkill];
  });
  assert.ok(legends.length >= 20, '找到的新版技能傳奇太少（' + legends.length + '），關聯欄可能改了');
  const bad = [];
  legends.forEach(function (k) {
    const gid = base.PASSIVE_POOL[k].relatedSkill;
    const adapter = makeAdapter();
    castAndCollect(gid, -1, k).forEach(function (s) {
      if (adapter.tryPlay(s) !== true) {
        bad.push(gid + ' 傳奇:' + k + ' ' + (s.fxKind || '?') + '/' + (s.variant || '-') +
          '（vfx=' + (s.vfx ? Object.keys(s.vfx).join('+') : 'null') +
          ' targets=' + ((s.targets || []).length) + ' area=' + (s.area ? 'y' : 'n') + '）');
      }
      adapter.update(0.05);
    });
  });
  assert.deepEqual([...new Set(bad)], [], '這些事件仍會退回舊畫法');
});

test('COVER-5 舊版技能表（SKILLS）的施放事件也都由 Preset 接手', function () {
  /* 舊技能走 castSkill（js/skills.js）這條完全不同的施放路徑，特效欄卻是同一組
     （Skills.csv 的五個欄位）。只驗 skills2 的話，這一半的舊畫法會留著沒人發現。 */
  const base = loadSim();
  /* 被動技能不會被施放（fill-vfx-cells 也是照這條跳過它們，特效欄一律留空）。
     castSkill 硬叫得動它們，但那是測試自己造出來的情境，不是遊戲裡會發生的事。 */
  const ids = Object.keys(base.SKILLS).filter((id) => base.SKILLS[id].cat !== 'passive');
  const skipped = Object.keys(base.SKILLS).length - ids.length;
  assert.ok(ids.length >= 10, '舊技能表載入失敗（' + ids.length + '）');
  assert.ok(skipped > 0, '一個被動技能都沒有——cat 欄位的值改了，這條會變成空轉');
  const bad = [];
  let cast = 0;
  ids.forEach(function (id) {
    const c = loadSim();
    const specs = [];
    c.playCombatVfx = (s) => specs.push(s);
    const p = playerEnt();
    const es = [];
    for (let i = 0; i < 6; i++) es.push(enemyAt(i));
    /* 被動／非施放型技能會自己拒絕施放，那不是缺漏；只看真的送出事件的那些。 */
    try { c.castSkill(p, es, id, 10, 'mv-float'); } catch (e) { return; }
    if (!specs.length) return;
    cast++;
    const adapter = makeAdapter();
    specs.forEach(function (s) {
      if (adapter.tryPlay(s) !== true) {
        bad.push(id + ' ' + (s.fxKind || '?') + '/' + (s.variant || '-') +
          '（vfx=' + (s.vfx ? Object.keys(s.vfx).join('+') : 'null') +
          ' targets=' + ((s.targets || []).length) + ' area=' + (s.area ? 'y' : 'n') + '）');
      }
      adapter.update(0.05);
    });
  });
  assert.ok(cast >= 10, '真的送出事件的舊技能太少（' + cast + '）');
  assert.deepEqual([...new Set(bad)], [], '這些事件仍會退回舊畫法');
});
