/* 傷害數字的時序：模擬層一瞬間結算完整段傷害，但畫面上子彈要飛、多段要一段一段打。
   這支測試釘的是「數字什麼時候跳出來」，不是傷害算得對不對。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadContext() {
  const context = {
    console, Math: Object.create(Math), UI: { dirty: {} }, GT: 0,
    RUN_STATS: { skills: {} },
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
    blog() {}, trackDps() {}, recordRunDamage() {}
  };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/battlefield.js', 'js/combat.js', 'js/skills.js']
    .forEach((f) => vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), context, { filename: f }));
  context.G = {
    player: { level: 1, skills: {}, loadout: [], fusions: [], talents: { levels: {}, potentialLevels: {} } },
    stage: { current: 1 }, tower: { active: false }
  };
  context.getStats = () => ({
    cdr: 0, castSpeed: 0, hp: 1000, mp: 1000, atk: 100, matk: 100,
    aoeDmg: 0, critRate: 0, critDmg: 150, pPen: 0, mPen: 0, hit: 999, level: 1,
    passives: {}, lifesteal: 0, manaSteal: 0, shieldEff: 0, skillTriggers: {}
  });
  return context;
}

function enemy(col, row) {
  return {
    hp: 1e9, maxHp: 1e9, def: 0, mdef: 0, dodge: 0, resist: {}, ctrlRes: 0,
    elite: false, isBoss: false, buffs: {}, dots: [], effects: {}, shield: 0,
    cell: { col, row, w: 1, h: 1 }
  };
}

// 收集每一則浮字的延遲；floatText 的第 7 個參數是 delayMs
function captureFloats(context) {
  const floats = [];
  context.floatText = (elId, text, cls, damageValue, ent, snap, delayMs) => {
    floats.push({ text, cls, delayMs: delayMs || 0 });
  };
  return floats;
}

test('投射物技能：傷害數字延後到子彈飛到才跳出', () => {
  const c = loadContext();
  const floats = captureFloats(c);
  const player = { hp: 1000, mp: 1000, atkCd: 0, skillCds: {}, skillGcd: 0, buffs: {}, dots: [], effects: {} };
  // 火球術：魔法系單體 → 投射物
  const sk = c.SKILLS.fireball;
  assert.ok(sk, '火球術應存在');
  assert.equal(c.skillVfxKind(sk, c.effectiveFx('fireball', sk, 1), sk.shape), 'projectile');

  c.castSkill(player, [enemy(1, 2)], 'fireball', 1, 'mv-float');
  const dmg = floats.filter((f) => /enemy-skill/.test(f.cls));
  assert.ok(dmg.length >= 1, '應該有傷害浮字');
  assert.ok(dmg[0].delayMs > 0, '投射物的傷害數字不能在發射當下就跳出來');
});

test('近戰技能：當場命中，數字不延後', () => {
  const c = loadContext();
  const floats = captureFloats(c);
  const player = { hp: 1000, mp: 1000, atkCd: 0, skillCds: {}, skillGcd: 0, buffs: {}, dots: [], effects: {} };
  // 強力斬：物理系單體 → 斬擊（沒有飛行時間）
  const sk = c.SKILLS.powerSlash;
  assert.equal(c.skillVfxKind(sk, c.effectiveFx('powerSlash', sk, 1), sk.shape), 'slash');

  c.castSkill(player, [enemy(1, 2)], 'powerSlash', 1, 'mv-float');
  const dmg = floats.filter((f) => /enemy-skill/.test(f.cls));
  assert.equal(dmg[0].delayMs, 0, '斬擊是當場發生，不該延後');
});

test('多段技：每一段各自一個傷害數字，且逐段錯開', () => {
  const c = loadContext();
  const floats = captureFloats(c);
  const player = { hp: 1000, mp: 1000, atkCd: 0, skillCds: {}, skillGcd: 0, buffs: {}, dots: [], effects: {} };
  // 奧術彈幕：4 段
  const fx = c.effectiveFx('arcaneBarrage', c.SKILLS.arcaneBarrage, 1);
  assert.equal(fx.hits, 4);

  c.castSkill(player, [enemy(1, 2)], 'arcaneBarrage', 1, 'mv-float');
  const dmg = floats.filter((f) => /enemy-skill/.test(f.cls));
  assert.equal(dmg.length, 4, '4 段應該有 4 個獨立的傷害數字，不是一個總和');

  // 逐段遞增錯開，間隔等於 VFX_HIT_STAGGER_SEC
  const step = Math.round(c.VFX_HIT_STAGGER_SEC * 1000);
  for (let i = 1; i < dmg.length; i++) {
    assert.equal(dmg[i].delayMs - dmg[i - 1].delayMs, step,
      '第 ' + (i + 1) + ' 段應比前一段晚 ' + step + 'ms');
  }
});

test('延遲只是顯示時序，不影響傷害結算', () => {
  const c = loadContext();
  captureFloats(c);
  const player = { hp: 1000, mp: 1000, atkCd: 0, skillCds: {}, skillGcd: 0, buffs: {}, dots: [], effects: {} };
  const target = enemy(1, 2);
  const before = target.hp;
  const out = c.castSkill(player, [target], 'arcaneBarrage', 1, 'mv-float');
  // 呼叫回來的當下血量就已經扣完了——延遲的是數字，不是傷害
  assert.ok(target.hp < before, '傷害必須在同一次呼叫內結算完畢');
  assert.ok(out.dmg > 0);
  assert.equal(Math.round(before - target.hp), Math.round(out.dmg));
});

test('浮字延遲會原樣送到顯示端（協議 v11 的 delayMs）', () => {
  const shim = fs.readFileSync(path.join(root, 'js/worker/shim.js'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  assert.match(shim, /delayMs:\s*\(delayMs > 0\) \? delayMs : 0/);
  assert.match(ui, /floatText\(event\.elId, event\.text, event\.cls, event\.damageValue, null, uiBattlePanelSnapshot\(\), event\.delayMs\)/);
  // 顯示端收到延遲就排程重播，不是丟掉
  assert.match(ui, /if \(delayMs > 0\) \{[\s\S]*?setTimeout\([\s\S]*?floatText\(elId, text, cls, damageValue, ent, battleSnapshot, 0\)/);
});
