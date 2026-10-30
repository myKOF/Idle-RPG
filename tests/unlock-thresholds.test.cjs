const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadContext() {
  const root = path.resolve(__dirname, '..');
  const context = { console, Math };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/strings_data.js', 'js/strings.js', 'js/data.js', 'js/formula.js', 'js/player.js', 'js/forge.js', 'js/item.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  context.reincarnationCount = () => Number(context.G.player.reincarnations || 0);
  return context;
}

const saveSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'save.js'), 'utf8');

test('裝備套裝預設全解鎖（第 1/2/3 套開局即開放）', () => {
  const context = loadContext();
  context.G = { player: { level: 1, reincarnations: 0 } };
  assert.equal(context.equipmentSetUnlocked(0), true);
  assert.equal(context.equipmentSetUnlocked(1), true);
  assert.equal(context.equipmentSetUnlocked(2), true);
  assert.equal(context.equipmentSetUnlockedAtLevel(0, 1, 0), true);
  assert.equal(context.equipmentSetUnlockedAtLevel(1, 1, 0), true);
  assert.equal(context.equipmentSetUnlockedAtLevel(2, 1, 0), true);
  assert.match(saveSource, /equipmentSetUnlockedAtLevel/);
  assert.match(saveSource, /data\.player\s*&&\s*data\.player\.reincarnations/);
});

test('神鑄需達 system_unlock 表的等級與轉生數，開放後永久保留', () => {
  const context = loadContext();
  // config/CSV/system_unlock.csv「神鑄系統」＝ 1/2
  context.G = { player: { level: 1, reincarnations: context.FORGE_UNLOCK_REINCARNATION - 1 }, forge: { unlocked: false } };
  assert.equal(context.forgeUnlocked(), false);

  context.G.player.reincarnations = context.FORGE_UNLOCK_REINCARNATION;
  assert.equal(context.forgeUnlocked(), true);

  context.G.player.reincarnations = 0;
  assert.equal(context.forgeUnlocked(), true);
});

test('神鑄四功能依 system_unlock 表的轉生數逐一開放（裝備神鑄／太古精鑄／神級寶石／神聖刻印）', () => {
  const context = loadContext();
  const csv = fs.readFileSync(path.join(__dirname, '..', 'config', 'CSV', 'system_unlock.csv'), 'utf8');
  const need = {};
  [['equip', '裝備神鑄'], ['ancient', '太古精鑄'], ['gem', '神級寶石'], ['imprint', '神聖刻印']].forEach(([mode, name]) => {
    const row = csv.split(/\r?\n/).map((l) => l.split(',')).find((c) => c[1] === name);
    assert.ok(row, name + ' 必須在 system_unlock 表內');
    const m = /^1\/(\d+)$/.exec(row[2]);
    assert.ok(m, name + ' 等級欄必須是 1：' + row[2]);
    need[mode] = Number(m[1]);
    assert.equal(context.divineForgeUnlock(mode), need[mode], mode + ' 程式常數與表一致');
  });
  context.G = { player: { level: 1, reincarnations: 0 }, forge: { unlocked: true } };
  Object.keys(need).forEach((mode) => {
    context.G.player.reincarnations = need[mode] - 1;
    assert.equal(context.forgeOperationUnlocked(mode), false, mode);
    context.G.player.reincarnations = need[mode];
    assert.equal(context.forgeOperationUnlocked(mode), true, mode);
  });
});

test('技能裝載欄第 3~6 格、詞條門檻、神界都在 system_unlock 表，且程式常數與表一致', () => {
  const context = loadContext();
  const csv = fs.readFileSync(path.join(__dirname, '..', 'config', 'CSV', 'system_unlock.csv'), 'utf8');
  const row = (name) => {
    const hit = csv.split(/\r?\n/).map((l) => l.split(',')).find((c) => c[1] === name);
    assert.ok(hit, name + ' 必須在 system_unlock 表內');
    const m = /^(\d+)\/(\d+)$/.exec(hit[2]);
    assert.ok(m, name + ' 格式須為 等級/轉生：' + hit[2]);
    return { level: Number(m[1]), reinc: Number(m[2]) };
  };
  [3, 4, 5, 6].forEach((n, i) => {
    const t = row('技能裝載欄 第' + n + '格');
    assert.equal(context.LOADOUT_SLOT_UNLOCKS[i].level, t.level, '第' + n + '格等級');
    assert.equal(context.LOADOUT_SLOT_UNLOCKS[i].reinc, t.reinc, '第' + n + '格轉生');
  });
  assert.equal(context.LOADOUT_SIZE.max, 6);
  assert.ok(row('神界'), '神界索引列');
  // 表上「從這級起出現」＝程式內「這級（含）以前不出現」+1
  const gateLevels = Array.from(context.AFFIX_LEVEL_GATES, (g) => g.level);
  assert.deepEqual(gateLevels, [row('元素傷害詞條').level - 1]);
  assert.equal(row('元素傷害詞條').level, row('屬性抗性詞條').level);
});
