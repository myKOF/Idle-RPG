/* 技能卸下：該技能掛在玩家身上的狀態與執行期殘留一併撤掉（嗜血狂怒、冰霜新星、環體電球）。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadContext() {
  const context = {
    console, Math: Object.create(Math), setTimeout() {}, clearTimeout() {},
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
    UI: { dirty: {} }, blog() {}, floatText() {}, trackDps() {}, recordRunDamage() {}
  };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/strings_data.js', 'js/strings.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/combat.js', 'js/skills.js', 'js/skills2.js']
    .forEach((file) => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file }));
  return context;
}

test('卸下技能：狀態與 RT 殘留被撤掉，其他技能的不受影響', () => {
  const c = loadContext();
  vm.runInContext('var p = { hp: 100, buffs: {}, effects: {}, dots: [] }; sgCurrentPlayerEnt = function () { return p; };' +
    'GT = 10; G = { player: { loadout: ["sg:bloodrage", "sg:frostnova", "sg:thunderorb"] } };' +
    'applyStatus(p, "sgBloodrage", { val: 40, dur: 8 }); applyStatus(p, "sgFrostbody", { dur: 6 }); applyStatus(p, "sgThunderOrb", { dur: 6 });' +
    'SKILL2_RT.rage = { until: GT + 8, pEnt: p, killCombo: 0 };', c);
  vm.runInContext('unequipSkillFromLoadout("sg:bloodrage"); unequipSkillFromLoadout("sg:frostnova");', c);
  assert.equal(vm.runInContext('statusActive(p, "sgBloodrage")', c), false);
  assert.equal(vm.runInContext('statusActive(p, "sgFrostbody")', c), false);
  assert.equal(vm.runInContext('SKILL2_RT.rage', c), null);
  assert.equal(vm.runInContext('statusActive(p, "sgThunderOrb")', c), true);
});
