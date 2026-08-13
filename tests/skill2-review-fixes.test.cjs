/* 新版技能系統審查修正（2026-08-14）回歸測試：
     1. 暴風之舞化身期間普攻計時器不得累積欠帳（化身結束後不得連發補償攻擊）
     2. 化身期間玩家被暈眩時，自動施放暫停（節拍照走、不補發）
     3. 零日感染的剩餘持續傷害包含已累積未跳出的殘額（d.acc）
   （放獨立檔案：tests/skill2-system.test.cjs 當前由 Codex 的施法鎖任務佔用中。） */
const test = require('node:test');
const assert = require('node:assert/strict');
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
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/combat.js', 'js/skills.js', 'js/skills2.js']
    .forEach((file) => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file }));
  context.G = { player: { gold: 0, skills2: { levels: {} }, loadout: [] }, stage: { current: 1 } };
  context.getStats = () => ({
    atk: 1000, matk: 0, hp: 1000, mp: 100, level: 10, aspd: 2, cdr: 0,
    critRate: 0, critDmg: 150, hit: 100, tenacity: 0,
    passives: {}, elemAtk: null, elemDmgPct: 0, elemDmgUp: 0,
    eliteDmg: 0, bossDmg: 0, normalDmg: 0, totalDmgPct: 0, dmgVsElem: null,
    aoeDmg: 0, globalDmgRed: 0
  });
  context.resolveHit = function (attacker, defender) {
    defender.hp = Math.max(0, defender.hp - 100);
    return { dmg: 100, crit: false, miss: false, blocked: false, killed: defender.hp <= 0 };
  };
  context.applySkillFinalDamageMultiplier = function () {};
  return context;
}
function enemy(hp, x, y) {
  return { name: '測試怪', maxHp: hp, hp, def: 0, mdef: 0, level: 1,
    effects: {}, buffs: {}, dots: [], resist: {}, ctrlRes: 0, pos: { x, y } };
}
function playerEnt() {
  return { hp: 1000, mp: 100, shield: 0, shieldMax: 0, atkCd: 0.5, skillCds: {}, skillGcd: 0,
    buffs: {}, dots: [], effects: {}, _lockTarget: null };
}
function ctxOf(c, p, list) {
  return { pEnt: p, getEnemies: () => list, floatSel: 'mv-float', onDeaths() {} };
}

test('暴風之舞：化身期間普攻計時器夾回 0，不累積欠帳', () => {
  const c = loadContext();
  c.chance = () => false;
  c.G.player.skills2.levels.dualdance = [1, 1, 1, 1, 1, 1, 1];
  const p = playerEnt();
  const m = enemy(1e9, 40, 0);
  c.GT = 0;
  c.castSkill2(p, [m], 'dualdance', 'mv-float');
  assert.ok(c.skill2StormActive());
  // 模擬戰鬥迴圈在化身期間持續倒數普攻計時器（閘門只擋出手、不擋倒數）
  p.atkCd = -6;
  c.GT = 0.5;
  c.tickSkill2(0.1, ctxOf(c, p, [m]));
  assert.equal(p.atkCd, 0, '化身 tick 應把負值計時器夾回 0（普攻是取消、不是延後）');
});

test('暴風之舞：暈眩中自動施放暫停，節拍照走不補發', () => {
  const c = loadContext();
  c.chance = () => false;
  c.G.player.skills2.levels.dualdance = [1, 1, 1, 1, 1, 1, 1];
  const p = playerEnt();
  const m = enemy(1e9, 40, 0);
  c.GT = 0;
  c.castSkill2(p, [m], 'dualdance', 'mv-float');
  const hpAfterCast = m.hp;
  // 暈眩到化身結束之後
  p.effects.stun = 999;
  c.GT = 1.0;
  c.tickSkill2(0.1, ctxOf(c, p, [m]));
  assert.equal(m.hp, hpAfterCast, '暈眩期間不得自動施放');
  // 解除暈眩：只從下一個節拍（nextAt=1.05）繼續，先前錯過的不補發
  delete p.effects.stun;
  const missedBeats = m.hp;
  c.GT = 1.02; // 介於暈眩結束與下一個節拍之間
  c.tickSkill2(0.02, ctxOf(c, p, [m]));
  assert.equal(m.hp, missedBeats, '錯過的節拍不得補發');
  c.GT = 1.05; // 下一個合法節拍：恢復施放
  c.tickSkill2(0.03, ctxOf(c, p, [m]));
  assert.ok(m.hp < missedBeats, '解除暈眩後應於下一個節拍恢復自動施放');
});

test('零日感染：剩餘持續傷害包含已累積未跳出的殘額（d.acc）', () => {
  const c = loadContext();
  c.chance = () => false;
  c.G.player.skills2.levels.bloodblade = [1, 1, 1, 1, 1, 1, 1];
  const p = playerEnt();
  const m = enemy(1e9, 40, 0);
  c.GT = 0;
  c.castSkill2(p, [m], 'bloodblade', 'mv-float');
  const bleed = m.dots.find((d) => d.sid === 'sgBleed');
  assert.ok(bleed);
  // 模擬 tickStatuses 已累積 0.4 秒尚未跳出的殘額
  bleed.acc = 0.4;
  const expectMin = Math.round(bleed.dps * ((bleed.until - c.GT) + 0.4)) - 2;
  const hpBefore = m.hp;
  c.chance = () => true; // 下一次作用必定觸發零日感染
  c.tickSkill2(1.0, ctxOf(c, p, [m]));
  const dealt = hpBefore - m.hp;
  assert.ok(dealt >= expectMin, '立即結算應含殘額（實際 ' + dealt + '，期望至少 ' + expectMin + '）');
  assert.ok(!m.dots.some((d) => d.sid === 'sgBleed'), '狀態應被清除');
});
