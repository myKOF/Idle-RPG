'use strict';
/* 存檔格式版本與上市後的遷移（Steam 任務 F，js/save-schema.js）：
   1. 登錄表自我檢查（版本逐一遞增、不可跳號、升版必須登錄遷移）
   2. 遷移執行器：依版本依序、只跑比存檔新的、重複讀檔冪等
   3. 真正的 migrateSave：上市前的存檔標成目前版本、新局不跑遷移、比遊戲新的存檔拒絕載入
   4. 開機攔截：比遊戲新的存檔不顯示開始選單，只能離開遊戲
   5. 遷移範本：上市後第一次升版時，照「遷移範本」那一段複製一份改寫即可 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

function loadSchemaOnly() {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'js', 'save-schema.js'), 'utf8'), ctx, { filename: 'js/save-schema.js' });
  return ctx;
}

/* 與 tests/task-chest-relic.test.cjs 相同的載入順序，加上 save-schema.js（放在 player.js 之前，與 index.html／Worker 一致） */
function loadGame() {
  const context = { console, UI: { dirty: {} }, GT: 0 };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/strings_data.js', 'js/strings.js', 'js/data.js', 'js/runeword_data.js', 'js/relic_data.js', 'js/relic.js',
   'js/chest_data.js', 'js/chest.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/item.js', 'js/runeword.js',
   'js/skills.js', 'js/skills2.js', 'js/talents.js', 'js/save-schema.js', 'js/player.js', 'js/factory.js', 'js/newforge.js',
   'js/save.js', 'js/tasks.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  context.blog = () => {};
  context.flog = () => {};
  context.addLog = () => {};
  context.FIELD = { player: null, monster: null, monsters: [] };
  context.G = context.newGameState();
  return context;
}

/* ---- 1. 登錄表 ---- */

test('上市基準：版本 1、沒有任何上市後遷移，登錄表自我檢查通過', () => {
  const s = loadSchemaOnly();
  assert.equal(s.SAVE_SCHEMA_VERSION, 1);
  assert.equal(s.SAVE_SCHEMA_MIGRATIONS.length, 0);
  assert.equal(s.saveSchemaRegistryErrors(s.SAVE_SCHEMA_MIGRATIONS, s.SAVE_SCHEMA_VERSION).length, 0);
});

test('登錄表錯誤：跳號、重複、名稱重複、升版卻沒登錄遷移都會被抓到', () => {
  const s = loadSchemaOnly();
  const m = (to, name) => ({ to, name, migrate() {} });
  assert.equal(s.saveSchemaRegistryErrors([m(2, 'a'), m(3, 'b')], 3).length, 0);
  assert.ok(s.saveSchemaRegistryErrors([m(3, 'a')], 3).length > 0, '跳號（1 → 3）');
  assert.ok(s.saveSchemaRegistryErrors([m(2, 'a'), m(2, 'b')], 2).length > 0, '重複版本');
  assert.ok(s.saveSchemaRegistryErrors([m(2, 'a'), m(3, 'a')], 3).length > 0, '名稱重複');
  assert.ok(s.saveSchemaRegistryErrors([], 2).length > 0, '升版卻沒有登錄遷移');
  assert.ok(s.saveSchemaRegistryErrors([m(2, 'a')], 1).length > 0, '登錄了遷移卻沒升版');
  assert.ok(s.saveSchemaRegistryErrors([{ to: 2, name: 'x' }], 2).length > 0, '沒有 migrate 函式');
});

test('saveSchemaOf：缺漏、負數、小數、字串一律視為 0（上市前的存檔）', () => {
  const s = loadSchemaOnly();
  for (const v of [undefined, null, -1, 1.5, '2', NaN]) assert.equal(s.saveSchemaOf({ saveSchema: v }), 0, String(v));
  assert.equal(s.saveSchemaOf(null), 0);
  assert.equal(s.saveSchemaOf({ saveSchema: 3 }), 3);
  assert.equal(s.saveSchemaTooNew({ saveSchema: 2 }, 1), true);
  assert.equal(s.saveSchemaTooNew({ saveSchema: 1 }, 1), false);
  assert.equal(s.saveSchemaTooNew({}, 1), false);
});

/* ---- 2. 遷移執行器（含遷移範本）----
   ★ 遷移範本：上市後要升版時，在 js/save-schema.js 改成 SAVE_SCHEMA_VERSION = 2，並登錄
       { to: 2, name: '描述V1', date: 'YYYY-MM-DD', migrate: function (data) { ... } }
     再照下面這個測試的寫法，為那筆遷移補三件事的測試：舊存檔被正確轉換、重複讀檔不再轉換、新局不受影響。 */
const TEMPLATE = [
  { to: 2, name: 'renameGoldToCoinsV1', date: '2027-01-01', migrate(d) { d.coins = d.gold || 0; delete d.gold; } },
  { to: 3, name: 'coinsTimesTenV1', date: '2027-02-01', migrate(d) { d.coins *= 10; } }
];

test('遷移範本：從 0／1 開始的存檔依序跑完所有遷移；已是 2 的只跑 3', () => {
  const s = loadSchemaOnly();
  const old = { gold: 5 };
  const r = s.applySaveSchemaMigrations(old, 1, { version: 3, migrations: TEMPLATE });
  assert.equal(JSON.stringify(r.applied), JSON.stringify(['renameGoldToCoinsV1', 'coinsTimesTenV1']));
  assert.deepEqual({ ...old }, { coins: 50, saveSchema: 3 });

  const mid = { coins: 7, saveSchema: 2 };
  const r2 = s.applySaveSchemaMigrations(mid, 2, { version: 3, migrations: TEMPLATE });
  assert.equal(JSON.stringify(r2.applied), JSON.stringify(['coinsTimesTenV1']));
  assert.equal(mid.coins, 70);
});

test('遷移範本：重複讀檔不再轉換（冪等），版本號是唯一的判斷依據', () => {
  const s = loadSchemaOnly();
  const d = { gold: 5 };
  s.applySaveSchemaMigrations(d, 0, { version: 3, migrations: TEMPLATE });
  const again = s.applySaveSchemaMigrations(d, s.saveSchemaOf(d), { version: 3, migrations: TEMPLATE });
  assert.equal(again.applied.length, 0);
  assert.equal(d.coins, 50);
});

test('比遊戲新的存檔：執行器什麼都不做、也不把版本號往下改', () => {
  const s = loadSchemaOnly();
  const d = { coins: 1, saveSchema: 9 };
  const r = s.applySaveSchemaMigrations(d, 9, { version: 3, migrations: TEMPLATE });
  assert.equal(r.applied.length, 0);
  assert.equal(d.saveSchema, 9);
});

test('登錄表有錯時拒絕執行（不會跑一半）', () => {
  const s = loadSchemaOnly();
  let ran = false;
  const bad = [{ to: 3, name: 'skip', migrate() { ran = true; } }];
  assert.throws(() => s.applySaveSchemaMigrations({}, 0, { version: 3, migrations: bad }), /登錄表錯誤/);
  assert.equal(ran, false);
});

/* ---- 3. 真正的 migrateSave ---- */

test('新局：newGameState 直接帶目前版本', () => {
  const c = loadGame();
  assert.equal(c.newGameState().saveSchema, c.SAVE_SCHEMA_VERSION);
});

test('上市前的存檔（沒有 saveSchema）：跑完既有相容處理後標成目前版本', () => {
  const c = loadGame();
  const old = JSON.parse(JSON.stringify(c.newGameState()));
  delete old.saveSchema;
  const out = c.migrateSave(old);
  assert.equal(out.saveSchema, c.SAVE_SCHEMA_VERSION);
});

test('migrateSave 在 mergeDefaults 之前取得版本：補完預設值的舊存檔仍會跑遷移', () => {
  const c = loadGame();
  // 模擬上市後升到版本 2：舊存檔（版本 1）必須跑到遷移，不能因為 newGameState 帶著 2 被 merge 成「已是最新」
  vm.runInContext(`
    SAVE_SCHEMA_VERSION = 2;
    SAVE_SCHEMA_MIGRATIONS.push({ to: 2, name: 'probeV1', migrate: function (d) { d._probeRan = (d._probeRan || 0) + 1; } });
  `, c);
  const v1 = JSON.parse(JSON.stringify(c.newGameState()));
  v1.saveSchema = 1;
  const out = c.migrateSave(v1);
  assert.equal(out._probeRan, 1);
  assert.equal(out.saveSchema, 2);
  c.migrateSave(out);
  assert.equal(out._probeRan, 1, '重複讀檔不再跑');
  const fresh = c.migrateSave(c.newGameState());
  assert.equal(fresh._probeRan, undefined, '新局不跑遷移');

  /* 會出事的那種：存檔根本沒有 saveSchema（上市前的存檔）。mergeDefaults 會從 newGameState 補上「目前版本 2」，
     若在 merge 之後才讀版本，就會誤判成已是最新、整批遷移被跳過。 */
  const prelaunch = JSON.parse(JSON.stringify(c.newGameState()));
  delete prelaunch.saveSchema;
  const out2 = c.migrateSave(prelaunch);
  assert.equal(out2._probeRan, 1, '上市前的存檔也要跑到上市後的遷移');
});

test('比遊戲新的存檔：migrateSave 拒絕載入（丟例外、內容一個欄位都不改），訊息走 String 表', () => {
  const c = loadGame();
  const future = JSON.parse(JSON.stringify(c.newGameState()));
  future.saveSchema = c.SAVE_SCHEMA_VERSION + 1;
  future.someFutureField = { keep: true };
  const before = JSON.stringify(future);
  assert.throws(() => c.migrateSave(future), (e) => e.code === 'SAVE_SCHEMA_TOO_NEW' && /較新的遊戲版本/.test(e.message));
  assert.equal(JSON.stringify(future), before);
});

/* ---- 4. 開機攔截 ---- */

function fakeDom() {
  const appended = [];
  const el = () => ({ style: {}, children: [], textContent: '', setAttribute() {}, addEventListener() {}, focus() {},
    appendChild(c) { this.children.push(c); }, querySelectorAll() { return []; } });
  const document = { createElement: el, querySelectorAll: () => [], body: { appendChild: (n) => appended.push(n) } };
  return { document, appended };
}

function loadStartFlow() {
  const dom = fakeDom();
  const ctx = { console, document: dom.document, location: { reload() {} } };
  ctx.window = ctx;
  vm.createContext(ctx);
  ['js/util.js', 'js/strings_data.js', 'js/strings.js', 'js/save-schema.js', 'js/save_origin.js'].forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
  });
  return { ctx, appended: dom.appended };
}

test('開機關卡：比遊戲新的存檔顯示攔截畫面且永遠不放行；同版本與上市前的存檔照常放行', () => {
  const { ctx, appended } = loadStartFlow();
  let passed = null;
  const future = { saveSchema: ctx.SAVE_SCHEMA_VERSION + 1, player: { level: 9 }, stage: { current: 3 } };
  assert.equal(ctx.SaveOrigin.isTooNew(future), true);
  ctx.SaveOrigin.gate(future, { source: 'own', fallback: { saveSchema: 1 } }, (s) => { passed = s; });
  assert.equal(passed, null, '比遊戲新的存檔不能交給開機流程，也不能退回較舊的快取');
  assert.equal(appended.length, 1, '要顯示攔截畫面');
  const texts = JSON.stringify(appended[0], (k, v) => (k === 'style' ? undefined : v));
  assert.match(texts, /較新的遊戲版本/);
  assert.match(texts, /離開遊戲/);
  const buttons = [];
  (function walk(n) { if (n.type === 'button') buttons.push(n.textContent); (n.children || []).forEach(walk); })(appended[0]);
  assert.equal(JSON.stringify(buttons), JSON.stringify(['離開遊戲']), '攔截畫面只有「離開遊戲」，不提供新遊戲或繼續');

  ctx.SaveOrigin.gate({ saveSchema: ctx.SAVE_SCHEMA_VERSION }, { source: 'own' }, (s) => { passed = s; });
  assert.ok(passed, '同版本放行');
  passed = null;
  ctx.SaveOrigin.gate({ player: {} }, { source: 'own' }, (s) => { passed = s; });
  assert.ok(passed, '上市前的存檔（沒有 saveSchema）放行，交給 migrateSave 標版本');
});

test('接線：save-schema.js 在 player.js／save.js 之前載入（index.html 與 Worker 都是），開始選單先檢查再顯示', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const at = (s) => html.indexOf(s);
  assert.ok(at('js/save-schema.js') > 0 && at('js/save-schema.js') < at('js/player.js') && at('js/player.js') < at('js/save.js'));
  const worker = fs.readFileSync(path.join(root, 'js', 'worker', 'sim.worker.js'), 'utf8');
  assert.ok(worker.indexOf('../save-schema.js') > 0 && worker.indexOf('../save-schema.js') < worker.indexOf('../player.js'));
  const menu = fs.readFileSync(path.join(root, 'js', 'start-menu.js'), 'utf8');
  assert.match(menu, /function prepare\(save, info\) \{[\s\S]{0,400}SaveOrigin\.isTooNew\(save\)[\s\S]{0,80}SaveOrigin\.showTooNew\(save\);\s*return;/);
});
