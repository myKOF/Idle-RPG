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

test('熟練度經驗需求依參數表：⌊1240×L³+20⌋', () => {
  const c = loadGameContext();
  assert.equal(c.skillMasteryXpForLevel(0), 20);
  assert.equal(c.skillMasteryXpForLevel(1), 1260);
  assert.equal(c.skillMasteryXpForLevel(10), 1240020);
});

test('新角色0轉1→1000級的打怪經驗對應熟練度300級與300點，存讀保留', () => {
  const { createEngine } = require('../scripts/sim/engine.js');
  const e = createEngine({ seed: 1031 }).boot(null), c = e.ctx;
  let xp = 0;
  for (let level = 1; level < 1000; level++) xp += c.xpForLevel(level);
  assert.equal(xp, 4990005039960, '角色升級需求沒有改動');
  c.gainXp(xp);
  c.gainSkillMasteryXp(Math.round(xp * c.SKILL_MASTERY_XP_RATE / 100));
  assert.equal(c.G.player.level, 1000);
  assert.equal(c.G.player.reincarnations, 0);
  assert.equal(c.G.player.skillMastery.level, 300);
  assert.equal(c.G.player.skillMastery.xp, 714613980);
  assert.equal(c.skillMasteryXpForLevel(300), 33480000020);
  assert.equal(e.panel('skills').skills2.points.total, 300);
  const reloaded = createEngine({ seed: 1032 }).boot(JSON.parse(e.saveJson()));
  assert.deepEqual(JSON.parse(JSON.stringify(reloaded.ctx.G.player.skillMastery)), { level: 300, xp: 714613980 });
});

test('提高需求不倒扣既有熟練度等級與經驗，後續按新需求累積', () => {
  const { createEngine } = require('../scripts/sim/engine.js');
  const e = createEngine({ seed: 1031 }).boot(null);
  e.ctx.G.player.skillMastery = { level: 400, xp: 1000 };
  const reloaded = createEngine({ seed: 1032 }).boot(JSON.parse(e.saveJson()));
  assert.deepEqual(JSON.parse(JSON.stringify(reloaded.ctx.G.player.skillMastery)), { level: 400, xp: 1000 });
  reloaded.ctx.gainSkillMasteryXp(1000);
  assert.equal(reloaded.ctx.G.player.skillMastery.level, 400);
  assert.equal(reloaded.ctx.G.player.skillMastery.xp, 2000);
  assert.equal(reloaded.panel('skills').skills2.points.total, 400);
});
