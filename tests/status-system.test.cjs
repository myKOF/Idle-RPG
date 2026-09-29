/* 狀態系統（2026-08-11 技能及狀態改造）
   技能＝一次性效果、狀態＝有持續時間的效果。本測試守住兩件事：
     1. 狀態表是唯一定義來源，且能與 config/CSV/Status.csv 完整往返
     2. 狀態的作用間隔只改變跳傷節奏、不改變總量
   （2026-09-29：舊技能系統整個移除，原本「技能 fx 以 status 陣列引用狀態」的第 3 項
    連同 skillStatusRefs／statusRefXxx 橋接一併刪除；新版技能引用狀態表的規則
    由 tests/skill2-status-slots.test.cjs 守住。） */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadContext() {
  const logs = [];
  const context = {
    console,
    Math: Object.create(Math),
    setTimeout() {}, clearTimeout() {},
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
    UI: { dirty: {} },
    blog(message) { logs.push(message); },
    floatText() {}, trackDps() {}, recordRunDamage() {},
    logs
  };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/combat.js', 'js/skills.js']
    .forEach((file) => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file }));
  context.G = { player: {}, stage: { current: 1 } };
  return context;
}
function enemy(hp) { return { name: '測試怪', maxHp: hp, hp: hp, effects: {}, buffs: {}, dots: [] }; }

/* ---- 1) 狀態表 ---- */

test('狀態表涵蓋使用者指定的必要欄位，且每一列都填得合法', () => {
  const c = loadContext();
  const ids = Object.keys(c.STATUS);
  assert.ok(ids.length >= 20, '狀態表至少要有主要狀態，目前 ' + ids.length);
  ids.forEach((id) => {
    const s = c.STATUS[id];
    // 使用者指定的七個必要欄位：狀態ID / 名稱 / 圖標 / 效果 / 傷害 / 持續時間 / 作用間隔
    assert.ok(s.name, id + ' 缺狀態名稱');
    assert.ok(s.icon, id + ' 缺狀態圖標');
    assert.ok(['dot', 'hot', 'stat', 'ctrl', 'shield'].includes(s.effect), id + ' 的狀態效果不合法：' + s.effect);
    assert.equal(typeof s.dmg, 'number', id + ' 的狀態傷害必須是數字');
    assert.ok(s.dur > 0, id + ' 的持續時間必須大於 0');
    assert.equal(typeof s.interval, 'number', id + ' 的作用間隔必須是數字');
    assert.ok(['buff', 'debuff', 'ctrl'].includes(s.kind), id + ' 的狀態分類不合法');
    if (s.effect !== 'dot') {
      assert.ok(s.key, id + ' 的狀態效果是 ' + s.effect + '，必須有效果鍵值');
    }
    assert.ok(['refresh', 'strongest', 'stack'].includes(s.stack), id + ' 的疊加規則不合法：' + s.stack);
    if (s.stack === 'stack') assert.ok(s.maxStacks > 1, id + ' 疊加規則為 stack，最大疊層必須大於 1');
  });
  // 火球術的例子：一次性魔法火屬性傷害 ＋ 火屬性持續傷害狀態
  assert.equal(c.STATUS.burn.effect, 'dot');
  assert.equal(c.STATUS.burn.elem, 'fire');
});

test('狀態表與 config/CSV/Status.csv 內容一致（撥離管線的唯一來源）', () => {
  const c = loadContext();
  const csv = fs.readFileSync(path.join(root, 'config/CSV/Status.csv'), 'utf8').replace(/^﻿/, '');
  const rows = csv.trim().split(/\r?\n/);
  const header = rows[0].split(',');
  assert.deepEqual(header.slice(0, 5), ['狀態ID', '狀態名稱', '狀態圖標', '狀態分類', '狀態效果']);
  assert.ok(header.includes('狀態傷害') && header.includes('持續時間') && header.includes('作用間隔時間'),
    'CSV 缺使用者指定的欄位');
  assert.equal(rows.length - 1, Object.keys(c.STATUS).length, 'CSV 列數與 STATUS 不一致');
});

test('程式端不得再有第二份狀態圖標／名稱對照表', () => {
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  assert.doesNotMatch(ui, /var BUFF_TIP_EMOJI = \{/);
  /* buffLabel（增益鍵 → 顯示名稱）原本在 js/skills.js；舊技能系統移除後搬進 js/status.js，
     與 statusName／statusIdByKey 放在一起。它必須只有這一份，且只是查狀態表。 */
  const status = fs.readFileSync(path.join(root, 'js/status.js'), 'utf8');
  assert.match(status, /function buffLabel\(key\) \{\s*return statusName\(statusIdByKey\(key\), key\);/);
  const definers = fs.readdirSync(path.join(root, 'js'))
    .filter((file) => file.endsWith('.js'))
    .filter((file) => /function buffLabel\(/.test(fs.readFileSync(path.join(root, 'js', file), 'utf8')));
  assert.deepEqual(definers, ['status.js'], 'buffLabel 只能定義在狀態表旁邊，不得在別處再有一份');
  const c = loadContext();
  assert.equal(c.buffLabel('atkUp'), c.STATUS.atkUp.name, '增益鍵的顯示名稱讀狀態表');
  assert.equal(c.buffLabel('不存在的鍵'), '不存在的鍵', '表上查無的鍵原樣回傳，供除錯辨識');
});

/* ---- 2) 作用間隔 ---- */

test('作用間隔決定跳傷節奏：滿一個間隔才結算一次', () => {
  const c = loadContext();
  const e = enemy(1000);
  c.GT = 0;
  c.applyStatus(e, 'burn', { base: 100, dmg: 50, dur: 3 }); // 每跳 50% × 技能傷害 100 = 50/秒
  c.GT += 0.5; c.tickStatuses(e, 0.5);
  assert.equal(e.hp, 1000, '未滿 1 秒不跳');
  c.GT += 0.5; c.tickStatuses(e, 0.5);
  assert.equal(e.hp, 950, '滿 1 秒跳一次');
});

test('作用間隔不改變總量：到期補跳不足一次間隔的餘額', () => {
  const c = loadContext();
  const slow = enemy(100000); const fast = enemy(100000);
  c.GT = 0;
  c.applyStatus(slow, 'burn', { base: 100, dmg: 100, dur: 5, interval: 2 });
  c.applyStatus(fast, 'burn', { base: 100, dmg: 100, dur: 5, interval: 0.5 });
  for (let i = 0; i < 60; i++) { c.GT += 0.1; c.tickStatuses(slow, 0.1); c.tickStatuses(fast, 0.1); }
  // 容差＝一幀的量（遊戲時鐘為累加浮點數）；重點是兩種間隔的總量一致
  const slowDealt = 100000 - slow.hp, fastDealt = 100000 - fast.hp;
  assert.ok(Math.abs(slowDealt - 500) <= 10, '間隔 2 秒的總傷害：' + slowDealt);
  assert.equal(Math.round(slowDealt), Math.round(fastDealt), '不同作用間隔的總傷害必須相同');
});

/* ---- 3) 狀態列舉（UI 用） ---- */

test('statusEntries 把控場／持續傷害／增益減益列成同一份清單', () => {
  const c = loadContext();
  const e = enemy(1000);
  c.GT = 0;
  c.applyStatus(e, 'burn', { base: 100, dur: 5 });
  c.applyStatus(e, 'stun', { dur: 2 });
  c.applyStatus(e, 'atkDown', { val: 20, dur: 4 });
  const list = c.statusEntries(e);
  const byId = {};
  list.forEach((x) => { byId[x.sid] = x; });
  assert.ok(byId.burn && byId.stun && byId.atkDown, '三種狀態都要列出：' + JSON.stringify(list));
  assert.equal(byId.burn.icon, c.STATUS.burn.icon);
  assert.equal(byId.stun.kind, 'ctrl');
  assert.equal(byId.atkDown.val, 20);
  assert.ok(byId.burn.remain > 4.9 && byId.burn.remain <= 5);
});

test('淨化只清負面狀態，不誤清自身增益', () => {
  const c = loadContext();
  const p = { hp: 100, effects: {}, buffs: {}, dots: [] };
  c.GT = 0;
  c.applyStatus(p, 'atkUp', { val: 30, dur: 10 });
  c.applyStatus(p, 'invuln', { dur: 10 });
  c.applyStatus(p, 'burn', { base: 100, dur: 10 });
  c.cleanse(p);
  assert.equal(c.statusActive(p, 'burn'), false, '負面持續傷害要清掉');
  assert.equal(c.statusActive(p, 'atkUp'), true, '自身增益要保留');
  assert.equal(c.statusActive(p, 'invuln'), true, '無敵要保留');
});

/* ---- 4) 護盾：有持續時間的狀態（2026-08-11） ---- */

test('護盾＝占施法者最大生命%，吃護盾效率，重放不疊高', () => {
  const c = loadContext();
  const p = { hp: 500, shield: 0, effects: {}, buffs: {}, dots: [] };
  c.GT = 0;
  const st = { hp: 1000, shieldEff: 0 };
  c.applyStatus(p, 'shield', { val: 20, dur: 15, stats: st });
  assert.equal(p.shield, 200, '1000 × 20%');
  // 重放：取 max 不累加
  c.applyStatus(p, 'shield', { val: 20, dur: 15, stats: st });
  assert.equal(p.shield, 200);
  // 護盾效率 +50%
  c.applyStatus(p, 'shield', { val: 20, dur: 15, stats: { hp: 1000, shieldEff: 50 } });
  assert.equal(p.shield, 300);
});

test('護盾到期會消失，未用完的部分一併回收', () => {
  const c = loadContext();
  const p = { hp: 500, shield: 0, effects: {}, buffs: {}, dots: [] };
  c.GT = 0;
  c.applyStatus(p, 'shield', { val: 20, dur: 5, stats: { hp: 1000, shieldEff: 0 } });
  assert.equal(p.shield, 200);
  assert.equal(c.statusActive(p, 'shield'), true);

  c.GT = 4; c.tickStatuses(p, 0.1);
  assert.equal(p.shield, 200, '未到期不該消失');

  c.GT = 5.1; c.tickStatuses(p, 0.1);
  assert.equal(p.shield, 0, '到期後未用完的護盾要消失');
  assert.equal(p.shieldMax, 0);
  assert.equal(c.statusActive(p, 'shield'), false);
});

test('護盾被打掉一部分後到期，只回收還沒被打掉的量', () => {
  const c = loadContext();
  const p = { hp: 500, shield: 0, effects: {}, buffs: {}, dots: [] };
  c.GT = 0;
  c.applyStatus(p, 'shield', { val: 20, dur: 5, stats: { hp: 1000, shieldEff: 0 } });
  p.shield -= 120;                       // 吸收掉 120，剩 80
  c.GT = 5.1; c.tickStatuses(p, 0.1);
  assert.equal(p.shield, 0);
});

test('護盾在狀態列以剩餘吸收量顯示，打完就不列', () => {
  const c = loadContext();
  const p = { hp: 500, shield: 0, effects: {}, buffs: {}, dots: [] };
  c.GT = 0;
  c.applyStatus(p, 'shield', { val: 20, dur: 10, stats: { hp: 1000, shieldEff: 0 } });
  const row = c.statusEntries(p).find((x) => x.sid === 'shield');
  assert.ok(row, '狀態列要有護盾');
  assert.equal(row.val, 200, '顯示剩餘吸收量');
  assert.equal(row.effect, 'shield');
  p.shield = 0;
  assert.equal(c.statusEntries(p).some((x) => x.sid === 'shield'), false, '打完就不列');
});

/* ---- 5) 疊層（stack 疊加規則） ---- */

test('stack 規則：層數累加至上限，效果值＝單層值 × 層數', () => {
  const c = loadContext();
  const e = enemy(100000);
  c.GT = 0;
  const cfg = { rule: 'stack', max: 3 };
  c.applyDot(e, 10, 10, '疊層測試', '', 1, cfg);
  assert.equal(e.dots[0].stacks, 1);
  assert.equal(e.dots[0].dps, 10);
  c.applyDot(e, 10, 10, '疊層測試', '', 1, cfg);
  assert.equal(e.dots[0].stacks, 2);
  assert.equal(e.dots[0].dps, 20);
  c.applyDot(e, 10, 10, '疊層測試', '', 1, cfg);
  c.applyDot(e, 10, 10, '疊層測試', '', 1, cfg);
  assert.equal(e.dots[0].stacks, 3, '不超過最大疊層');
  assert.equal(e.dots[0].dps, 30);
});

test('stack 規則：單層值取高（高等級重塗會拉高每一層）', () => {
  const c = loadContext();
  const e = enemy(100000);
  c.GT = 0;
  const cfg = { rule: 'stack', max: 3 };
  c.applyDot(e, 10, 10, '疊層測試', '', 1, cfg);
  c.applyDot(e, 25, 10, '疊層測試', '', 1, cfg);
  assert.equal(e.dots[0].unit, 25);
  assert.equal(e.dots[0].stacks, 2);
  assert.equal(e.dots[0].dps, 50, '單層 25 × 2 層');
});

test('stack 規則同樣適用於增益（單層值 × 層數）', () => {
  const c = loadContext();
  const p = { hp: 100, effects: {}, buffs: {}, dots: [] };
  c.GT = 0;
  const cfg = { rule: 'stack', max: 4 };
  c.applyBuff(p, 'atkUp', 5, 10, 'atkUp', cfg);
  c.applyBuff(p, 'atkUp', 5, 10, 'atkUp', cfg);
  c.applyBuff(p, 'atkUp', 5, 10, 'atkUp', cfg);
  assert.equal(c.buffVal(p, 'atkUp'), 15);
  assert.equal(c.statusEntries(p).find((x) => x.sid === 'atkUp').stacks, 3);
});

test('未指定疊加規則時維持原行為：持續傷害取高、增益後蓋前', () => {
  const c = loadContext();
  const e = enemy(100000);
  const p = { hp: 100, effects: {}, buffs: {}, dots: [] };
  c.GT = 0;
  c.applyDot(e, 30, 10, '燃燒');          // 狀態表 burn＝strongest
  c.applyDot(e, 10, 10, '燃燒');
  assert.equal(e.dots[0].dps, 30, '取高');
  assert.equal(e.dots[0].stacks, 1);
  c.applyBuff(p, 'atkUp', 30, 10);        // 狀態表 atkUp＝refresh
  c.applyBuff(p, 'atkUp', 10, 10);
  assert.equal(c.buffVal(p, 'atkUp'), 10, '後蓋前');
});

test('狀態表把疊加規則設成 stack 就會生效（不必改程式）', () => {
  const c = loadContext();
  const e = enemy(100000);
  c.GT = 0;
  c.STATUS.bleed.stack = 'stack';
  c.STATUS.bleed.maxStacks = 5;
  c.applyStatus(e, 'bleed', { base: 100, dmg: 10, dur: 10 });
  c.applyStatus(e, 'bleed', { base: 100, dmg: 10, dur: 10 });
  const dot = e.dots.find((d) => d.sid === 'bleed');
  assert.equal(dot.stacks, 2);
  assert.equal(dot.dps, 20, '單層 10 × 2 層');
});
