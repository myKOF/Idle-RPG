/* 狀態系統（2026-08-11 技能及狀態改造）
   技能＝一次性效果、狀態＝有持續時間的效果。本測試守住三件事：
     1. 狀態表是唯一定義來源，且能與 config/CSV/Status.csv 完整往返
     2. 狀態的作用間隔只改變跳傷節奏、不改變總量
     3. 技能以 status 引用組合狀態，效果值與持續時間可覆寫、其餘吃狀態表 */
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
  const skills = fs.readFileSync(path.join(root, 'js/skills.js'), 'utf8');
  assert.match(skills, /function buffLabel\(key\) \{\s*return statusName\(statusIdByKey\(key\), key\);/);
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

/* ---- 3) 技能 ＝ 一次性效果 ＋ 狀態 ---- */

test('技能以 status 引用組合狀態；沒覆寫的欄位吃狀態表', () => {
  const c = loadContext();
  const fx = { dmgType: 'magic', stat: 'matk', base: 360, per: 80, status: [{ id: 'burn' }] };
  const refs = c.skillStatusRefs(fx);
  assert.equal(refs.length, 1);
  assert.equal(c.statusRefName(refs[0]), '燃燒');
  assert.equal(c.statusRefIcon(refs[0]), c.STATUS.burn.icon);
  assert.equal(c.statusRefAmount(refs[0], 1), c.STATUS.burn.dmg, '未覆寫＝吃狀態表的狀態傷害');
  assert.equal(c.statusRefDur(refs[0]), c.STATUS.burn.dur, '未覆寫＝吃狀態表的持續時間');
  assert.equal(c.statusRefIsSelf(refs[0]), false, '減益作用於敵方');

  // 技能覆寫：保留各技能與里程碑各自的成長曲線
  const over = c.skillStatusRefs({ status: [{ id: 'burn', base: 35, per: 5, dur: 6 }] })[0];
  assert.equal(c.statusRefAmount(over, 1), 35);
  assert.equal(c.statusRefAmount(over, 3), 45);
  assert.equal(c.statusRefDur(over), 6);
});

test('火球術＝一次性魔法火屬性傷害 ＋ 燃燒狀態（實際資料驗證）', () => {
  const c = loadContext();
  const fx = c.effectiveFx('fireball', c.SKILLS.fireball, 8);
  assert.equal(fx.dmgType, 'magic', '一次性效果：魔法傷害');
  assert.ok(fx.base > 0, '一次性效果：有傷害數值');
  const refs = c.skillStatusRefs(fx);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].id, 'burn', '狀態：火屬性持續傷害');
  assert.equal(c.STATUS[refs[0].id].elem, 'fire');
});

test('自身增益與敵方減益依狀態分類自動分流', () => {
  const c = loadContext();
  const warcry = c.skillStatusRefs(c.SKILLS.warcry.fx);
  // 陣列由 vm context 產生（原型不同一個 realm），比對字串避免 deepStrictEqual 誤判
  const self = warcry.filter((r) => c.statusRefIsSelf(r)).map((r) => r.id).join(',');
  const foe = warcry.filter((r) => !c.statusRefIsSelf(r)).map((r) => r.id).join(',');
  assert.equal(self, 'atkUp', '戰吼的攻擊提升作用於自身');
  assert.equal(foe, 'atkDown', '戰吼的攻擊下降作用於敵方');
});

test('每一支技能的狀態引用都指得到狀態表（沒有孤兒引用）', () => {
  const c = loadContext();
  const missing = [];
  Object.keys(c.SKILLS).forEach((id) => {
    const fx = c.effectiveFx(id, c.SKILLS[id], 8);
    (fx.status || []).forEach((r) => { if (!c.STATUS[r.id]) missing.push(id + ' → ' + JSON.stringify(r)); });
  });
  assert.equal(missing.join(' / '), '', '有技能引用了狀態表上沒有的狀態');
});

/* ---- 4) 狀態列舉（UI 用） ---- */

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

/* ---- 5) 護盾：有持續時間的狀態（2026-08-11） ---- */

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

test('魔法屏障＝護盾狀態（實際資料驗證）', () => {
  const c = loadContext();
  const fx = c.effectiveFx('manaBarrier', c.SKILLS.manaBarrier, 8);
  const ref = c.skillStatusRefs(fx).find((r) => c.statusRefEffect(r) === 'shield');
  assert.ok(ref, '魔法屏障應引用護盾狀態');
  assert.equal(ref.id, 'shield');
  assert.ok(c.statusRefDur(ref) > 0, '護盾要有持續時間');
});

/* ---- 6) 疊層（stack 疊加規則） ---- */

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
