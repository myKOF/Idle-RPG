'use strict';
/* 等級／轉生數門檻統一規則（2026-10-30）：
   1 轉 1 級 ≈ 0 轉 1000 級。只寫等級的門檻＝0 轉那一輪的等級，轉生過一律放行；
   只寫轉生數的門檻＝等級 1，到達轉數即可。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadGameContext(extra) {
  const context = { console, UI: { dirty: {} } };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/strings_data.js', 'js/strings.js', 'js/data.js'].concat(extra || []).forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

test('progressReached：只寫等級的門檻，轉生過就解除', () => {
  const c = loadGameContext();
  assert.equal(c.progressReached(199, 0, 200, 0), false);
  assert.equal(c.progressReached(200, 0, 200, 0), true);
  assert.equal(c.progressReached(1, 1, 200, 0), true, '1 轉 1 級 ≈ 0 轉 1000 級');
  assert.equal(c.progressReached(1, 1, c.MAX_LEVEL, 0), true, '連等級上限的門檻也一樣');
});

test('progressReached：只寫轉生數的門檻，1 級就夠', () => {
  const c = loadGameContext();
  assert.equal(c.progressReached(1, 1, 1, 2), false);
  assert.equal(c.progressReached(1, 2, 1, 2), true);
  assert.equal(c.progressReached(1, 3, 1, 2), true);
});

test('progressReached：兩者都寫＝第 N 轉的 L 級，更高轉數放行', () => {
  const c = loadGameContext();
  assert.equal(c.progressReached(50, 2, 100, 2), false);
  assert.equal(c.progressReached(100, 2, 100, 2), true);
  assert.equal(c.progressReached(1, 3, 100, 2), true);
  assert.equal(c.progressReached(1000, 1, 100, 2), false, '轉數不夠，等級再高也不行');
});

test('progressReached：等級不明且轉數相同時不放行（維持舊寫法），轉數較高仍放行', () => {
  const c = loadGameContext();
  assert.equal(c.progressReached(undefined, 0, 1, 0), false);
  assert.equal(c.progressReached(undefined, 1, 1, 0), true);
});

test('zeroRebirthLevel：0 轉原樣、轉生過一律大於可轉生等級', () => {
  const c = loadGameContext();
  assert.equal(c.zeroRebirthLevel(150, 0), 150);
  assert.ok(Number.isNaN(c.zeroRebirthLevel(undefined, 0)), '0 轉讀不到等級維持 NaN（詞條門檻視為不擋）');
  assert.ok(c.zeroRebirthLevel(1, 1) > c.REINCARNATION_LEVEL);
  assert.ok(c.zeroRebirthLevel(undefined, 2) > c.REINCARNATION_LEVEL);
});

test('屬性面板：1 轉 1 級的角色不再被 200 級門檻藏起屬性列', () => {
  const c = loadGameContext();
  const row = c.STAT_GROUPS[1].rows.find((r) => String(r[0]).indexOf('火屬性傷害提升') >= 0);
  assert.ok(row, '找得到「火屬性傷害提升」列');
  assert.equal(c.statPanelRowHiddenAtLevel(row, c.zeroRebirthLevel(50, 0)), true);
  assert.equal(c.statPanelRowHiddenAtLevel(row, c.zeroRebirthLevel(1, 1)), false);
});

test('各系統開放：等級與轉生數都走 progressReached', () => {
  const c = loadGameContext(['js/formula.js', 'js/player.js', 'js/item.js', 'js/gem_resonance.js', 'js/talents.js']);
  c.EQUIP_SET_UNLOCK_LEVELS[1] = 100;
  c.EQUIP_SET_UNLOCK_REINCARNATIONS[1] = 0;
  assert.equal(c.equipmentSetUnlockedAtLevel(1, 50, 0), false);
  assert.equal(c.equipmentSetUnlockedAtLevel(1, 1, 1), true, '只寫等級的方案門檻，轉生後放行');

  c.GEM_RESONANCE_UNLOCK_LEVEL = 500;
  c.GEM_RESONANCE_UNLOCK_REINCARNATION = 4;
  assert.equal(c.gemResonanceUnlockedAt(1, 3), false);
  assert.equal(c.gemResonanceUnlockedAt(1, 5), true, '轉數超過門檻的那一轉，不必再補等級');
  assert.equal(c.gemResonanceUnlockedAt(499, 4), false);
  assert.equal(c.gemResonanceUnlockedAt(500, 4), true);

  c.TALENT_UNLOCK_LEVEL = 1;
  c.TALENT_UNLOCK_REINCARNATION = 1;
  assert.equal(c.talentSystemUnlockedAt(1, 0), false);
  assert.equal(c.talentSystemUnlockedAt(1, 1), true);
});

test('技能欄鎖定提示與參數表同源（不得再寫死 (i-4+1)*50）', () => {
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  assert.doesNotMatch(ui, /\(i - 4 \+ 1\) \* 50/);
});
