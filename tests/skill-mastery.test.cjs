/* 技能熟練度與技能點（2026-07-30 熟練度制；2026-09-29 舊版技能移除後只剩潛力技能花點）。
   原本與融合技測試同檔（skill-fusion-rework），融合系統移除時抽出。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadGameContext() {
  const context = {
    console,
    Math: Object.create(Math),
    setTimeout() {}, clearTimeout() {},
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
    UI: { dirty: {} },
    RUN_STATS: { skills: {} },
    blog() {}, floatText() {}, trackDps() {}, recordRunDamage() {},
    markStatsDirty() {}
  };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/strings_data.js', 'js/strings.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/combat.js', 'js/skills.js', 'js/talents.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  context.G = {
    player: {
      level: 999, xp: 0, reincarnations: 3,
      gold: 10000000,
      skillMastery: { level: 0, xp: 0 },
      talents: { levels: {} },
      loadout: []
    },
    stage: { current: 1 }
  };
  return context;
}

test('技能熟練度：經驗升級與上限封頂，不再產生技能點', () => {
  const c = loadGameContext();
  const p = c.G.player;
  assert.equal(c.totalSkillPoints, undefined);
  c.gainSkillMasteryXp(c.skillMasteryXpForLevel(0)); // 升 1 級
  assert.equal(p.skillMastery.level, 1);
  assert.equal(p.skillPoints, undefined);
  // 上限封頂
  p.skillMastery.level = c.SKILL_MASTERY_MAX_LEVEL;
  c.gainSkillMasteryXp(999999999);
  assert.equal(p.skillMastery.level, c.SKILL_MASTERY_MAX_LEVEL);
  assert.equal(p.skillMastery.xp, 0);
});


test('技能熟練度未升級時也刷新技能面板進度', () => {
  const c = loadGameContext();
  c.UI.dirty.skills = false;
  c.gainSkillMasteryXp(1);
  assert.equal(c.G.player.skillMastery.xp, 1);
  assert.equal(c.UI.dirty.skills, true);
});

test('熟練度經驗需求依參數表：⌊30×L³+20⌋', () => {
  const c = loadGameContext();
  assert.equal(c.skillMasteryXpForLevel(0), 20);
  assert.equal(c.skillMasteryXpForLevel(1), 50);
  assert.equal(c.skillMasteryXpForLevel(10), 30020);
});
