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
  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/battlefield.js', 'js/item.js',
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

function fakeLoadout(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push('sk' + i);
  return out;
}

/* 期望格數出處：config/Excel/game_parameters.xlsx「1-成長經驗」第 4 列「技能裝載欄」
   → a=每 a 級 +1 格、b=下限、c=上限，經 tools/apply_params.cjs 套進 LOADOUT_SIZE。
   依 AI_RULES.md 9.1 例外刻意釘住數值：參數表一改這裡就會紅，是預期行為。
   目前設定：a=50、b=4、c=10。 */
test('loadoutSizeFor：不讀 G，直接對存檔裡的等級與轉數算格數', () => {
  const c = loadMigrationContext();
  assert.equal(c.loadoutSizeFor(1, 0), 4);
  assert.equal(c.loadoutSizeFor(250, 0), 9);
  assert.equal(c.loadoutSizeFor(9999, 0), 10);   // 封頂＝param c
  assert.equal(c.loadoutSizeFor(1, 1), 10);      // 1 轉直接給滿
  // 髒資料不該讓格數變成 NaN 或 0：退回下限
  assert.equal(c.loadoutSizeFor(undefined, undefined), 4);
  assert.equal(c.loadoutSizeFor('abc', null), 4);
});

test('舊存檔超出上限的裝載欄會被裁掉，保留排在前面的格子並公告一次', () => {
  const c = loadMigrationContext();
  const data = oldSave(c, (d) => {
    d.player.level = 250;          // 0 轉 250 級 → 9 格
    d.player.reincarnations = 0;
    d.player.loadout = fakeLoadout(15);
  });
  c.migrateSave(data);
  assert.equal(data.player.loadout.length, 9);
  assert.deepEqual(data.player.loadout, fakeLoadout(9));   // 保留前段、順序不變
  assert.match(data._loadoutCapClampNotice || '', /9 格/);
  assert.match(data._loadoutCapClampNotice || '', /6 個技能/);
  assert.equal(data.loadoutCapClampV1, true);
});

test('裁切只卸下技能，等級與已學狀態不動', () => {
  const c = loadMigrationContext();
  const data = oldSave(c, (d) => {
    d.player.level = 1;            // 0 轉 1 級 → 4 格
    d.player.skills = { powerSlash: 3, arcaneBurst: 5, manaBarrier: 2, meditation: 1 };
    d.player.loadout = ['powerSlash', 'arcaneBurst', 'manaBarrier', 'meditation', 'ironSkin', 'vampirism'];
  });
  c.migrateSave(data);
  assert.equal(data.player.loadout.length, 4);
  // 被卸下的 ironSkin/vampirism 本來就沒學；已學技能等級一個都不能少
  assert.equal(data.player.skills.powerSlash, 3);
  assert.equal(data.player.skills.arcaneBurst, 5);
  assert.equal(data.player.skills.manaBarrier, 2);
  assert.equal(data.player.skills.meditation, 1);
});

test('未超出上限時不動裝載欄，也不公告', () => {
  const c = loadMigrationContext();
  const data = oldSave(c, (d) => {
    d.player.level = 1;
    d.player.loadout = ['powerSlash', 'arcaneBurst'];
  });
  c.migrateSave(data);
  assert.deepEqual(data.player.loadout, ['powerSlash', 'arcaneBurst']);
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

test('先清出被融合佔用的素材，再算格數——順序反了會裁得比上限少', () => {
  const c = loadMigrationContext();
  const data = oldSave(c, (d) => {
    d.player.level = 1;   // 4 格
    d.player.skills = { powerSlash: 1, iceLance: 1, meditation: 1, ironSkin: 1, vampirism: 1, toughness: 1 };
    // 前兩格是融合素材，會先被清出；清完剩 4 個，剛好等於上限，不該再被裁
    d.player.loadout = ['powerSlash', 'iceLance', 'meditation', 'ironSkin', 'vampirism', 'toughness'];
    d.player.fusions = [{ id: 'f1', name: '測試融合', components: ['powerSlash', 'iceLance'], componentLevels: { powerSlash: 1, iceLance: 1 }, seed: 1, algo: 2 }];
  });
  c.migrateSave(data);
  assert.deepEqual(data.player.loadout, ['meditation', 'ironSkin', 'vampirism', 'toughness']);
  assert.equal(data._loadoutCapClampNotice, undefined);   // 清完就沒超額，不該公告
});
