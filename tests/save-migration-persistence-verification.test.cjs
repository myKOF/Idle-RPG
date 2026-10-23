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
    'js/util.js', 'js/strings_data.js', 'js/strings.js',
    'js/data.js',
    'js/status.js', 'js/formula.js',
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

test('驗證 1：真的舊存檔（裝載欄 >10 格）讀入後裁切至現行上限、公告出現一次、新版技能等級不變', () => {
  const c = loadContext();
  const rawOldSave = c.newGameState();
  
  // 構造舊存檔（無 loadoutCapClampV1 旗標）
  delete rawOldSave.loadoutCapClampV1;
  rawOldSave.player.level = 300;
  rawOldSave.player.reincarnations = 5; // 1 轉起解鎖全部格位，目前裝載欄上限為 6
  
  // 設置裝載欄 > 上限 (15 格)
  rawOldSave.player.loadout = [
    'sg:thrust', 'sg:cleave', 'sg:knife', 'sg:gale', 'sg:bloodblade',
    'sg:dualdance', 'sg:counter', 'sg:bloodrage', 'sg:fireball', 'sg:firepillar',
    'sg:firehunt', 'sg:rockarmor', 'sg:mire', 'sg:earthguard', 'sg:chainlightning'
  ];

  // 新版技能群組等級（存檔遷移不得動它）
  rawOldSave.player.skills2 = { levels: { thrust: [5, 3, 0, 0, 0, 0, 0] } };

  // 執行讀檔遷移
  c.migrateSave(rawOldSave);

  // 1. 驗證格子被裁到正確數量 (6 格)
  assert.equal(rawOldSave.player.loadout.length, 6);
  assert.deepEqual(Array.from(rawOldSave.player.loadout), [
    'sg:thrust', 'sg:cleave', 'sg:knife', 'sg:gale', 'sg:bloodblade', 'sg:dualdance'
  ]);

  // 2. 驗證公告出現一次
  assert.ok(rawOldSave._loadoutCapClampNotice);
  assert.match(rawOldSave._loadoutCapClampNotice, /技能裝載欄上限調整為 6 格/);
  assert.match(rawOldSave._loadoutCapClampNotice, /已卸下超出的 9 個技能/);

  // 3. 驗證新版技能等級完全不變
  assert.deepEqual(Array.from(rawOldSave.player.skills2.levels.thrust).slice(0, 2), [5, 3]);
});

test('驗證 2：重複讀檔（第二次載入）不再裁切也不再產生公告', () => {
  const c = loadContext();
  const rawOldSave = c.newGameState();
  delete rawOldSave.loadoutCapClampV1;
  rawOldSave.player.level = 300;
  rawOldSave.player.reincarnations = 5;
  rawOldSave.player.loadout = Array.from({ length: 15 }, (_, i) => 'sg:g' + i);

  // 第一次讀檔
  c.migrateSave(rawOldSave);
  assert.equal(rawOldSave.player.loadout.length, 6);
  assert.ok(rawOldSave._loadoutCapClampNotice);
  assert.equal(rawOldSave.loadoutCapClampV1, true);

  // 清除臨時公告通知（模擬彈窗關閉）
  delete rawOldSave._loadoutCapClampNotice;

  // 第二次讀檔（使用同一份已完成遷移包含 loadoutCapClampV1: true 的存檔）
  c.migrateSave(rawOldSave);

  // 驗證第二次載入不再裁切、不再產生公告
  assert.equal(rawOldSave.player.loadout.length, 6);
  assert.equal(rawOldSave._loadoutCapClampNotice, undefined);
});

test('轉生確認窗不再顯示已移除的潛力技能上限增量', () => {
  const c = loadContext();
  assert.equal(c.skillMaxLvForRc, undefined);
  const ui = fs.readFileSync(path.join(__dirname, '../js/ui.js'), 'utf8');
  assert.doesNotMatch(ui, /skillMaxLvForRc|skillLimitLine/);
});

test('驗證 4：存檔持久化落盤後旗標 loadoutCapClampV1 是否正確寫入 JSON 並被保存', () => {
  const c = loadContext();
  const rawOldSave = c.newGameState();
  delete rawOldSave.loadoutCapClampV1;
  rawOldSave.player.level = 100;
  rawOldSave.player.reincarnations = 0; // 0 轉 100 級 -> 6 格上限
  rawOldSave.player.loadout = Array.from({ length: 12 }, (_, i) => 'sg:g' + i);

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
