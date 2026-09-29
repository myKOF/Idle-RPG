/* ONE-TIME MIGRATION: loadoutCapClampV1
   裝載欄上限由 20 下修為 10 之後，舊存檔可能裝著超過上限的技能——
   equipSkillToLoadout 只擋「再裝上去」，不會回頭裁切，所以超額的格子會一直生效。
   登錄見 ONE_TIME_MIGRATIONS.md。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadMigrationContext() {
  const root = path.resolve(__dirname, '..');
  const context = {
    console,
    localStorage: {
      getItem() { return null; }, setItem() {}, removeItem() {}, key() { return null; }, length: 0
    },
    location: { reload() {} },
    window: {},
    document: { addEventListener() {} },
    UI: { dirty: {} }
  };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/item.js',
    'js/skills.js', 'js/talents.js', 'js/player.js', 'js/save.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

/* 遷移前的存檔＝沒有完成旗標。其餘欄位沿用 newGameState 以免踩到別的相容處理。 */
function oldSave(context, mutate) {
  const data = context.newGameState();
  delete data.loadoutCapClampV1;
  if (mutate) mutate(data);
  return data;
}

/* 裝載欄只接受新版技能群組（'sg:'）與潛力技能（'potential:'）；舊技能鍵會被 legacySkillRemovalV1 卸下。 */
function fakeLoadout(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push('sg:g' + i);
  return out;
}

/* 期望格數出處：config/Excel/game_parameters.xlsx「1-成長經驗」第 4 列「技能裝載欄」
   → a=每 a 級 +1 格、b=下限、c=上限，經 tools/apply_params.cjs 套進 LOADOUT_SIZE。
   依 AI_RULES.md 9.1 例外刻意釘住數值：參數表一改這裡就會紅，是預期行為。
   目前設定：a=50、b=4、c=6。 */
test('loadoutSizeFor：不讀 G，直接對存檔裡的等級與轉數算格數', () => {
  const c = loadMigrationContext();
  assert.equal(c.loadoutSizeFor(1, 0), 4);
  assert.equal(c.loadoutSizeFor(250, 0), 6);
  assert.equal(c.loadoutSizeFor(9999, 0), 6);   // 封頂＝param c
  assert.equal(c.loadoutSizeFor(1, 1), 6);      // 1 轉直接給滿
  // 髒資料不該讓格數變成 NaN 或 0：退回下限
  assert.equal(c.loadoutSizeFor(undefined, undefined), 4);
  assert.equal(c.loadoutSizeFor('abc', null), 4);
});

test('舊存檔超出上限的裝載欄會被裁掉，保留排在前面的格子並公告一次', () => {
  const c = loadMigrationContext();
  const data = oldSave(c, (d) => {
    d.player.level = 250;          // 0 轉 250 級 → 6 格
    d.player.reincarnations = 0;
    d.player.loadout = fakeLoadout(15);
  });
  c.migrateSave(data);
  assert.equal(data.player.loadout.length, 6);
  assert.deepEqual(Array.from(data.player.loadout), fakeLoadout(6));   // 保留前段、順序不變
  assert.match(data._loadoutCapClampNotice || '', /6 格/);
  assert.match(data._loadoutCapClampNotice || '', /9 個技能/);
  assert.equal(data.loadoutCapClampV1, true);
});

test('裁切只卸下技能，新版技能等級不動', () => {
  const c = loadMigrationContext();
  const data = oldSave(c, (d) => {
    d.player.level = 1;            // 0 轉 1 級 → 4 格
    d.player.skills2 = { levels: { thrust: [3, 1, 0, 0, 0, 0, 0] } };
    d.player.loadout = ['sg:thrust', 'sg:cleave', 'sg:knife', 'sg:gale', 'sg:fireball', 'sg:firehunt'];
  });
  c.migrateSave(data);
  assert.equal(data.player.loadout.length, 4);
  assert.deepEqual(Array.from(data.player.skills2.levels.thrust).slice(0, 2), [3, 1]);
});

test('未超出上限時不動裝載欄，也不公告', () => {
  const c = loadMigrationContext();
  const data = oldSave(c, (d) => {
    d.player.level = 1;
    d.player.loadout = ['sg:thrust', 'sg:cleave'];
  });
  c.migrateSave(data);
  assert.deepEqual(Array.from(data.player.loadout), ['sg:thrust', 'sg:cleave']);
  assert.equal(data._loadoutCapClampNotice, undefined);
  assert.equal(data.loadoutCapClampV1, true);
});

test('旗標寫入後重複讀檔不再修剪——玩家自己排的格數不該被一再干預', () => {
  const c = loadMigrationContext();
  const data = oldSave(c, (d) => {
    d.player.level = 1;
    d.player.loadout = fakeLoadout(8);
  });
  c.migrateSave(data);
  assert.equal(data.player.loadout.length, 4);

  // 第二次讀檔：即使裝載欄又被加長，也不再裁（遷移已完成）
  delete data._loadoutCapClampNotice;
  data.player.loadout = fakeLoadout(8);
  c.migrateSave(data);
  assert.equal(data.player.loadout.length, 8);
  assert.equal(data._loadoutCapClampNotice, undefined);
});

test('新帳號不觸發：newGameState 預帶完成旗標', () => {
  const c = loadMigrationContext();
  const fresh = c.newGameState();
  assert.equal(fresh.loadoutCapClampV1, true);

  fresh.player.loadout = fakeLoadout(8);   // 新帳號就算被塞爆也不是遷移該管的事
  c.migrateSave(fresh);
  assert.equal(fresh.player.loadout.length, 8);
  assert.equal(fresh._loadoutCapClampNotice, undefined);
});

test('先卸下舊技能，再算格數——順序反了會把新版技能裁掉', () => {
  const c = loadMigrationContext();
  const data = oldSave(c, (d) => {
    d.player.level = 1;   // 4 格
    // 前兩格是舊技能，會先被卸下（留下空格）；剩下的四個新版技能剛好等於上限，不該被裁
    d.player.loadout = ['powerSlash', 'iceLance', 'sg:thrust', 'sg:cleave', 'sg:knife', 'sg:gale'];
  });
  c.migrateSave(data);
  assert.deepEqual(Array.from(data.player.loadout), [null, null, 'sg:thrust', 'sg:cleave']);
  assert.match(data._loadoutCapClampNotice || '', /2 個技能/);   // 空格佔位，仍超額 2 格，裁掉最後兩個
});
