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
    UI: { dirty: {} },
    blog() {},
    fmt(value) { return String(value); }
  };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/skills.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  context.G = {
    player: {
      level: 1,
      reincarnations: 0,
      skillPointBudget: 100,
      skillPoints: 100,
      gold: 1e12,
      skills: {},
      skillUnlocks: {},
      fusions: [],
      loadout: []
    }
  };
  return context;
}

test('未達人物等級時不能學習，且技能解鎖提示包含人物等級', () => {
  const c = loadContext();
  const requiredLv = c.skillUnlockLevel('venomCloud');

  assert.ok(requiredLv > 1);
  assert.equal(c.skillUnlocked('venomCloud'), false);
  assert.equal(c.skillUnlockReason('venomCloud'), '需人物達到 Lv.' + requiredLv + ' 才解鎖');
  assert.equal(c.learnOrUpgradeSkill('venomCloud'), '需人物達到 Lv.' + requiredLv + ' 才解鎖');
  assert.equal(c.skillLevel('venomCloud'), 0);
});

test('達到人物等級後記錄永久解鎖，等級降低也不會重新鎖定', () => {
  const c = loadContext();

  c.G.player.level = c.skillUnlockLevel('venomCloud');
  assert.equal(c.skillUnlocked('venomCloud'), true);
  assert.equal(c.G.player.skillUnlocks.venomCloud, true);

  c.G.player.level = 1;
  assert.equal(c.skillUnlocked('venomCloud'), true);
  assert.equal(c.skillUnlockReason('venomCloud'), null);
});

test('既有已學會技能會被視為永久解鎖，避免舊存檔重新鎖定', () => {
  const c = loadContext();
  c.G.player.skills.venomCloud = 1;

  assert.equal(c.skillUnlocked('venomCloud'), true);
  assert.equal(c.G.player.skillUnlocks.venomCloud, true);
});

test('GM 降低人物等級時會重新判斷未學技能的解鎖狀態', () => {
  const c = loadContext();
  const requiredLv = c.skillUnlockLevel('venomCloud');

  c.G.player.level = requiredLv;
  assert.equal(c.skillUnlocked('venomCloud'), true);
  c.G.player.level = 1;
  c.recheckSkillUnlocksForGMLevelChange(requiredLv, 1);

  assert.equal(c.skillUnlocked('venomCloud'), false);
  assert.equal(c.G.player.skillUnlocks.venomCloud, undefined);
});

test('Skills 表含解鎖等級欄與可編輯說明，Tooltip 使用同一解鎖原因', () => {
  const config = fs.readFileSync(path.join(root, 'tools', 'config_tables.cjs'), 'utf8');
  const csv = fs.readFileSync(path.join(root, 'config', 'CSV', 'Skills.csv'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');
  const gm = fs.readFileSync(path.join(root, 'js', 'gm.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');

  assert.match(config, /'解鎖等級'/);
  assert.match(config, /達到門檻時會寫入玩家存檔，之後永久解鎖/);
  assert.match(csv.split(/\r?\n/, 1)[0], /標籤,解鎖等級/);
  const venomRow = csv.split(/\r?\n/).find((row) => row.startsWith('venomCloud,'));
  assert.ok(venomRow, 'Skills 表應包含 venomCloud');
  assert.match(venomRow, /^venomCloud,magic,poison,\d+,/);
  assert.match(ui, /: \(skillUnlockReason\(id\) \|\| tierLockReason\(id\)\);/);
  assert.match(ui, /skt-lock/);
  assert.match(ui, /skill-unlock-hint/);
  assert.match(css, /\.skill-unlock-hint\s*\{[\s\S]*color:\s*#f87171/);
  assert.match(gm, /recheckSkillUnlocksForGMLevelChange\(beforeLevel, level\)/);
});
