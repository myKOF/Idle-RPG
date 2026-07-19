const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

/* ONE-TIME MIGRATION: talentTreesV2RespecV1（登錄於 ONE_TIME_MIGRATIONS.md）
   天賦系統 V2 改版：舊存檔天賦全數重置，依「舊制成本」（升到 Lv.L 共 L×(L+1)/2 點）退還天賦點。 */

function loadSaveContext() {
  const context = {
    console, Math, Date,
    window: {},
    localStorage: {
      getItem() { return null; },
      setItem() {},
      removeItem() {},
      key() { return null; },
      length: 0
    }
  };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/skills.js', 'js/talents.js', 'js/player.js', 'js/save.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

test('舊存檔首次載入：天賦重置並依舊制成本退還天賦點（含已不存在的舊節點 id）', () => {
  const context = loadSaveContext();
  const state = context.newGameState();
  delete state.talentTreesV2RespecV1;
  state.player.reincarnations = 5;
  state.player.reincarnationTalentPoints = 100;
  // 舊版節點 id（t3_crit 已不存在於新樹、t1_str 仍存在）：Lv.8 → 36 點、Lv.100 → 5050 點
  state.player.talents.levels = { t1_str: 8, t3_crit: 100 };
  state.player.talents.potentialLevels = { p1_time: 4 };

  context.migrateSave(state);

  assert.equal(state.talentTreesV2RespecV1, true);
  assert.equal(state.player.reincarnationTalentPoints, 100 + 36 + 5050);
  assert.equal(state.player.talents.levels.t1_str, 0); // sanitize 依新樹補 0
  assert.equal(state.player.talents.levels.t3_crit, undefined); // 舊 id 不再保留
  assert.equal(state.player.talents.potentialLevels.p1_time, 0);
  assert.match(state._talentRespecNotice || '', /退還 5086 點/);
  assert.equal(state._talentRespecConfirm, true); // 已 1 轉且曾升級天賦 → 一次性改版確認窗
});

test('已 1 轉且曾升級天賦才彈改版確認窗；0 轉（GM 邊界）即使有等級也不彈', () => {
  const context = loadSaveContext();
  const state = context.newGameState();
  delete state.talentTreesV2RespecV1;
  state.player.reincarnations = 0;
  state.player.talents.levels = { t1_str: 3 };

  context.migrateSave(state);

  assert.equal(state.talentTreesV2RespecV1, true);
  assert.equal(state.player.reincarnationTalentPoints, 6); // 仍退點（3×4/2）
  assert.equal(state._talentRespecConfirm, undefined);     // 但不彈確認窗
});

test('main.js 以共用確認窗顯示改版訊息，顯示後刪除旗標', () => {
  const main = fs.readFileSync(path.join(root, 'js', 'main.js'), 'utf8');
  assert.match(main, /G\._talentRespecConfirm/);
  assert.match(main, /showConfirmDialog\('天賦系統已重新改造，請重新配置！'/);
  assert.match(main, /delete G\._talentRespecConfirm/);
});

test('遷移旗標使重複載入不會再次退點', () => {
  const context = loadSaveContext();
  const state = context.newGameState();
  delete state.talentTreesV2RespecV1;
  state.player.reincarnations = 3;
  state.player.talents.levels = { t1_str: 10 };

  context.migrateSave(state);
  const after = state.player.reincarnationTalentPoints;
  assert.equal(after, 55);
  delete state._talentRespecNotice;
  delete state._talentRespecConfirm; // 模擬 main.js 顯示後刪除

  context.migrateSave(state);
  assert.equal(state.player.reincarnationTalentPoints, after);
  assert.equal(state._talentRespecNotice, undefined);
  assert.equal(state._talentRespecConfirm, undefined); // 不會再次彈窗
});

test('沒有任何天賦等級的舊存檔：只標記旗標、不退點、不顯示公告', () => {
  const context = loadSaveContext();
  const state = context.newGameState();
  delete state.talentTreesV2RespecV1;
  state.player.reincarnations = 2;
  state.player.reincarnationTalentPoints = 7;

  context.migrateSave(state);

  assert.equal(state.talentTreesV2RespecV1, true);
  assert.equal(state.player.reincarnationTalentPoints, 7);
  assert.equal(state._talentRespecNotice, undefined);
});

test('新建立帳號預設帶有完成旗標，不觸發重置退點', () => {
  const context = loadSaveContext();
  const state = context.newGameState();

  context.migrateSave(state);

  assert.equal(state.talentTreesV2RespecV1, true);
  assert.equal(state.talentTreesV2RespecV2, true);
  assert.equal(state.player.reincarnationTalentPoints, 0);
});

/* ---- ONE-TIME MIGRATION: talentTreesV2RespecV2（升級消耗改制第二次重置） ---- */

test('第二次重置：依前一版成本（每級 轉數+1）退點，條件與彈窗同 V1', () => {
  const context = loadSaveContext();
  const state = context.newGameState();
  delete state.talentTreesV2RespecV2; // V1 已完成（旗標保留）
  state.player.reincarnations = 5;
  state.player.reincarnationTalentPoints = 10;
  // 前一版成本：t1_str Lv.10 → 10×2 = 20、t5_fire Lv.4 → 4×6 = 24，合計 44
  state.player.talents.levels = { t1_str: 10, t5_fire: 4 };

  context.migrateSave(state);

  assert.equal(state.talentTreesV2RespecV2, true);
  assert.equal(state.player.reincarnationTalentPoints, 10 + 44);
  assert.equal(state.player.talents.levels.t1_str, 0);
  assert.equal(state.player.talents.levels.t5_fire, 0);
  assert.match(state._talentRespecNotice || '', /退還 44 點/);
  assert.equal(state._talentRespecConfirm, true);
});

test('第二次重置冪等：旗標存在不再退點；0 轉即使有等級也不彈窗', () => {
  const context = loadSaveContext();
  const state = context.newGameState();
  delete state.talentTreesV2RespecV2;
  state.player.reincarnations = 2;
  state.player.talents.levels = { t1_str: 10 };

  context.migrateSave(state);
  const after = state.player.reincarnationTalentPoints;
  assert.equal(after, 20);
  delete state._talentRespecNotice;
  delete state._talentRespecConfirm;
  context.migrateSave(state);
  assert.equal(state.player.reincarnationTalentPoints, after);
  assert.equal(state._talentRespecConfirm, undefined);

  // 0 轉（GM 邊界）：退點但不彈窗
  const s0 = context.newGameState();
  delete s0.talentTreesV2RespecV2;
  s0.player.reincarnations = 0;
  s0.player.talents.levels = { t1_str: 10 };
  context.migrateSave(s0);
  assert.equal(s0.player.reincarnationTalentPoints, 20);
  assert.equal(s0._talentRespecConfirm, undefined);
});

test('跳版舊檔（V1/V2 旗標皆缺）：V1 退舊制點數後 V2 不重複退點，彈窗只設一次', () => {
  const context = loadSaveContext();
  const state = context.newGameState();
  delete state.talentTreesV2RespecV1;
  delete state.talentTreesV2RespecV2;
  state.player.reincarnations = 3;
  state.player.talents.levels = { t1_str: 8 }; // 舊制：8×9/2 = 36

  context.migrateSave(state);

  assert.equal(state.talentTreesV2RespecV1, true);
  assert.equal(state.talentTreesV2RespecV2, true);
  assert.equal(state.player.reincarnationTalentPoints, 36); // 只退一次（V2 看到空天賦）
  assert.equal(state._talentRespecConfirm, true);
});
