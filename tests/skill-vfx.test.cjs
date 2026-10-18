/* 新版戰鬥 P6：技能／增益特效（潛力技能使用的 skillVfxSpec／skillVfxKind／skillVfxColor，js/skills.js）
   特效不逐一手寫，而是由技能既有資料推導，所以這裡驗的是「推導規則正確」＋「潛力技能表覆蓋率 100%」，
   而不是逐支技能的畫面。

   2026-09-29 舊技能系統整批移除：SKILL_VFX_OVERRIDE 特規、隕石專用特效、舊技能表全表覆蓋隨之刪除
   （全表覆蓋改為只掃潛力技能表）；高塔領域特效錨點原本用舊 skillRtOpenField 驗，改用新版火柱驗同一個約定。
   新版技能（skills2.js）自己組特效事件、Preset 來自表格欄位。 */
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
    blog() {}, floatText() {}, trackDps() {}, recordRunDamage() {}
  };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/combat.js', 'js/skills.js']
    .forEach((f) => vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), context, { filename: f }));
  context.G = { player: { level: 1, loadout: [], talents: { levels: {} } }, stage: { current: 1 }, tower: { active: false } };
  return context;
}








/* 高塔（單體 BOSS、無座標）：新版技能的場域特效仍要以 BOSS 圖層 'tb-float' 為錨點，
   不能退回玩家或野外場景（原本用舊「領域」機制驗，改用新版火柱驗同一個約定）。 */
test('高塔場域特效保留 BOSS 錨點，不退回玩家或野外場景', () => {
  const context = {
    console, Math: Object.create(Math), setTimeout() {}, clearTimeout() {},
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
    UI: { dirty: {} }, blog() {}, floatText() {}, trackDps() {}, recordRunDamage() {}
  };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/combat.js', 'js/skills.js', 'js/skills2.js']
    .forEach((f) => vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), context, { filename: f }));
  context.G = { player: { gold: 0, skills2: { levels: { firepillar: [1, 0, 0, 0, 0, 0, 0] } }, loadout: [] }, stage: { current: 1 } };
  context.getStats = () => ({
    atk: 1000, matk: 1000, hp: 1000, mp: 100, level: 10, aspd: 2, cdr: 0,
    critRate: 0, critDmg: 150, hit: 100, tenacity: 0,
    passives: {}, elemAtk: null, elemDmgPct: 0, elemDmgUp: 0,
    eliteDmg: 0, bossDmg: 0, normalDmg: 0, totalDmgPct: 0, dmgVsElem: null,
    aoeDmg: 0, globalDmgRed: 0
  });
  const emitted = [];
  context.playCombatVfx = (spec) => emitted.push(JSON.parse(JSON.stringify(spec)));
  context.resetSkillRT();

  const pEnt = { hp: 1000, mp: 100, shield: 0, shieldMax: 0, skillCds: {}, buffs: {}, dots: [], effects: {}, _lockTarget: null };
  // 高塔 BOSS：沒有 pos（無座標）、沒有 floatSel，錨點完全由 floatSel 參數決定
  const boss = { name: 'boss', maxHp: 1e9, hp: 1e9, def: 0, mdef: 0, level: 1, effects: {}, buffs: {}, dots: [], resist: {}, ctrlRes: 0, isBoss: true };

  assert.ok(context.castSkill2(pEnt, boss, 'firepillar', 'tb-float'), '火柱應可對高塔 BOSS 施放');
  for (let i = 1; i <= 4; i++) {
    context.GT = i * 0.5;
    context.tickSkill2(0.5, { pEnt, getEnemies: () => [boss], floatSel: 'tb-float', onDeaths() {} });
  }

  assert.ok(emitted.length > 0, '場域跳傷時應送出特效事件');
  emitted.forEach((spec) => {
    assert.deepEqual(spec.targets, ['tb-float'], '高塔場域應以 BOSS 圖層作為特效錨點');
    assert.equal(spec.area, null, '高塔仍維持無區域資料（座標制：area）');
  });
});
