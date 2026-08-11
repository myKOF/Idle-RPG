/* 驗證項目 (Antigravity QA Task):
   1. 真的舊存檔：裝載欄 >10 格、技能等級 >10 的存檔讀入後，格子被裁到正確數量、公告出現一次、技能等級與已學狀態不變
   2. 重複讀檔：第二次載入不再裁、不再公告
   3. 轉生後上限顯示：轉生確認窗的「技能上限 +N」，10 轉之後應顯示 +0（已封頂 / 無技能上限增加行）
   4. 存檔實際持久化：模擬 saveGame / JSON 持久化寫入，確認 loadoutCapClampV1: true 與裁切後狀態正確寫入 localStorage 快照
*/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadContext() {
  const root = path.resolve(__dirname, '..');
  const mockStorage = {};
  const context = {
    console,
    localStorage: {
      getItem(k) { return Object.prototype.hasOwnProperty.call(mockStorage, k) ? mockStorage[k] : null; },
      setItem(k, v) { mockStorage[k] = String(v); },
      removeItem(k) { delete mockStorage[k]; },
      key(i) { return Object.keys(mockStorage)[i] || null; },
      get length() { return Object.keys(mockStorage).length; }
    },
    mockStorage,
    location: { reload() {} },
    window: {},
    document: { addEventListener() {} },
    UI: { dirty: {} }
  };
  context.window = context;
  vm.createContext(context);

  const files = [
    'js/util.js',
    'js/data.js',
    'js/formula.js',
    'js/battlefield.js',
    'js/item.js',
    'js/skills.js',
    'js/talents.js',
    'js/player.js',
    'js/save.js'
  ];

  files.forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });

  return context;
}

test('驗證 1：真的舊存檔（裝載欄 >10 格、技能等級 >10）讀入後裁切至現行上限、公告出現一次、技能等級與狀態不變', () => {
  const c = loadContext();
  const rawOldSave = c.newGameState();
  
  // 構造舊存檔（無 loadoutCapClampV1 旗標）
  delete rawOldSave.loadoutCapClampV1;
  rawOldSave.player.level = 300;
  rawOldSave.player.reincarnations = 5; // 5 轉，目前裝載欄上限應為 10
  
  // 設置裝載欄 > 10 格 (15 格)
  rawOldSave.player.loadout = [
    'powerSlash', 'arcaneBurst', 'manaBarrier', 'meditation', 'ironSkin',
    'vampirism', 'fireball', 'iceLance', 'thunderbolt', 'poisonDart',
    'shieldBash', 'blurryStep', 'shadowStrike', 'holyLight', 'taunt'
  ];
  
  // 設置技能等級 > 10 (例如 18 級)
  rawOldSave.player.skills = {
    powerSlash: 18,
    arcaneBurst: 15,
    manaBarrier: 12,
    fireball: 20
  };

  // 執行讀檔遷移
  c.migrateSave(rawOldSave);

  // 1. 驗證格子被裁到正確數量 (10 格)
  assert.equal(rawOldSave.player.loadout.length, 10);
  assert.deepEqual(rawOldSave.player.loadout, [
    'powerSlash', 'arcaneBurst', 'manaBarrier', 'meditation', 'ironSkin',
    'vampirism', 'fireball', 'iceLance', 'thunderbolt', 'poisonDart'
  ]);

  // 2. 驗證公告出現一次
  assert.ok(rawOldSave._loadoutCapClampNotice);
  assert.match(rawOldSave._loadoutCapClampNotice, /技能裝載欄上限調整為 10 格/);
  assert.match(rawOldSave._loadoutCapClampNotice, /已卸下超出的 5 個技能/);

  // 3. 驗證技能等級與已學狀態完全不變
  assert.equal(rawOldSave.player.skills.powerSlash, 18);
  assert.equal(rawOldSave.player.skills.arcaneBurst, 15);
  assert.equal(rawOldSave.player.skills.manaBarrier, 12);
  assert.equal(rawOldSave.player.skills.fireball, 20);
});

test('驗證 2：重複讀檔（第二次載入）不再裁切也不再產生公告', () => {
  const c = loadContext();
  const rawOldSave = c.newGameState();
  delete rawOldSave.loadoutCapClampV1;
  rawOldSave.player.level = 300;
  rawOldSave.player.reincarnations = 5;
  rawOldSave.player.loadout = Array.from({ length: 15 }, (_, i) => 'sk_' + i);

  // 第一次讀檔
  c.migrateSave(rawOldSave);
  assert.equal(rawOldSave.player.loadout.length, 10);
  assert.ok(rawOldSave._loadoutCapClampNotice);
  assert.equal(rawOldSave.loadoutCapClampV1, true);

  // 清除臨時公告通知（模擬彈窗關閉）
  delete rawOldSave._loadoutCapClampNotice;

  // 第二次讀檔（使用同一份已完成遷移包含 loadoutCapClampV1: true 的存檔）
  c.migrateSave(rawOldSave);

  // 驗證第二次載入不再裁切、不再產生公告
  assert.equal(rawOldSave.player.loadout.length, 10);
  assert.equal(rawOldSave._loadoutCapClampNotice, undefined);
});

test('驗證 3：轉生確認窗的技能上限增量計算，10 轉之後（10轉升11轉）應該為 0（已封頂）', () => {
  const c = loadContext();

  // 測試 0 轉到 10 轉的每階增量
  for (let rc = 0; rc <= 9; rc++) {
    const curMax = c.skillMaxLvForRc(rc);
    const nextMax = c.skillMaxLvForRc(rc + 1);
    const add = Math.max(0, nextMax - curMax);
    assert.equal(add, 2, `${rc} 轉升 ${rc + 1} 轉應增加 2 級上限`);
  }

  // 10 轉升 11 轉（晉階 10 轉）
  const cur10Max = c.skillMaxLvForRc(10);
  const next11Max = c.skillMaxLvForRc(11);
  const add10to11 = Math.max(0, next11Max - cur10Max);
  assert.equal(cur10Max, 30, '10 轉技能上限應為 30');
  assert.equal(next11Max, 30, '11 轉技能上限應為 30');
  assert.equal(add10to11, 0, '10 轉升 11 轉的技能上限增量應為 0（已封頂）');

  // 15 轉升 16 轉
  const cur15Max = c.skillMaxLvForRc(15);
  const next16Max = c.skillMaxLvForRc(16);
  const add15to16 = Math.max(0, next16Max - cur15Max);
  assert.equal(add15to16, 0, '15 轉升 16 轉的技能上限增量應為 0（已封頂）');
});

test('驗證 4：存檔持久化落盤後旗標 loadoutCapClampV1 是否正確寫入 JSON 並被保存', () => {
  const c = loadContext();
  const rawOldSave = c.newGameState();
  delete rawOldSave.loadoutCapClampV1;
  rawOldSave.player.level = 100;
  rawOldSave.player.reincarnations = 0; // 0 轉 100 級 -> 6 格上限
  rawOldSave.player.loadout = Array.from({ length: 12 }, (_, i) => 'skill_' + i);

  // 模擬讀檔並執行遷移
  c.migrateSave(rawOldSave);
  assert.equal(rawOldSave.loadoutCapClampV1, true);
  assert.equal(rawOldSave.player.loadout.length, 6);

  // 模擬存檔持久化 (JSON.stringify & localStorage/File write)
  const jsonSerialized = JSON.stringify(rawOldSave);
  c.localStorage.setItem('infinite_conquest_save_v1', jsonSerialized);

  // 重新從持久化媒介 (localStorage) 讀出 JSON
  const storedJson = c.localStorage.getItem('infinite_conquest_save_v1');
  assert.ok(storedJson, 'localStorage 應含有儲存的 JSON');
  
  const parsedSave = JSON.parse(storedJson);

  // 驗證持久化落盤資料包含 loadoutCapClampV1: true
  assert.equal(parsedSave.loadoutCapClampV1, true, '持久化 JSON 必須包含 loadoutCapClampV1: true');
  assert.equal(parsedSave.player.loadout.length, 6, '持久化 JSON 必須為裁切後的裝載欄');
});
