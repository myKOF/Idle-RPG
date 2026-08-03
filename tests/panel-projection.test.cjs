/* 面板投影（panelParams）：策略可以宣告「這一塊我不看，別建」。

   這個機制省的是**真錢**——背包清單要對每一件跑一次 itemScore（遍歷詞條、寶石、
   附魔），深局 300 件時單次 4.4 ms，而極限策略每 5 遊戲秒建一次面板。
   實測佔 headless 總 CPU 的 16%，而 ROI 策略一次都沒讀過它。

   代價是它會**靜靜壞掉**：宣告錯了不會報錯，只是規則永遠取不到值、永遠不觸發，
   報表上看起來只像「AI 就是不換裝」。所以這裡釘住三件事：

     1. 切掉 items 之後，其餘每一個欄位都必須一字不差——背包壓力閥（count / cap）、
        換裝門檻（equipmentScores / equipmentRarities）、附魔（books /
        equipmentEnchantInfo）全部靠它們，少一個就是另一種靜默失真。
     2. 不傳參數時行為完全不變（真人玩家的 UI 走的是這條路）。
     3. 宣告了不建、卻又有規則指到它時，策略必須**拒絕開跑**而不是安靜跑完。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createEngine } = require('../scripts/sim/engine.js');
const { createPolicy } = require('../scripts/sim/policy.js');

const ROOT = path.resolve(__dirname, '..');
const SIM_DIR = path.join(ROOT, 'scripts', 'sim');

function bootedEngine() {
  const engine = createEngine({ seed: 4242 });
  engine.boot(null);
  /* 跑一段讓背包真的有東西——空背包的話這支測試會在兩邊都是空陣列的情況下通過。 */
  engine.stepSeconds(600);
  return engine;
}

test('inv 面板：items:false 只切掉清單，其餘欄位一字不差', () => {
  const engine = bootedEngine();
  const full = engine.panel('inv');
  const lean = engine.panel('inv', { items: false });

  assert.ok(full.items.length > 0, '前提：背包要有東西，否則這支測試證明不了任何事');
  /* 用長度而不是 deepEqual([])：面板是在 vm context 裡建的，那邊的 Array 是另一個
     realm 的原型，deepStrictEqual 會因為原型不同而失敗——與內容無關。 */
  assert.equal(lean.items.length, 0, 'items 應該被切掉');

  const keys = Object.keys(full).filter((k) => k !== 'items');
  assert.ok(keys.length >= 8, '欄位數不對，投影可能漏建了東西');
  for (const k of keys) {
    assert.deepEqual(lean[k], full[k], `欄位 ${k} 在切掉 items 之後必須完全相同`);
  }
  /* 背包壓力閥用的就是這兩個數字，切掉清單不能讓它們一起消失。 */
  assert.equal(lean.count, full.items.length, 'count 必須仍是真實件數');
  assert.ok(lean.cap > 0, 'cap 必須仍在');
});

test('inv 面板：不傳參數時行為與改造前相同（UI 走的是這條路）', () => {
  const engine = bootedEngine();
  const a = engine.panel('inv');
  const b = engine.panel('inv', undefined);
  const c = engine.panel('inv', {});
  assert.equal(a.items.length, b.items.length);
  assert.equal(a.items.length, c.items.length);
  assert.ok(a.items.length > 0);
});

test('哨兵：宣告不建卻又有規則指到它，策略必須拒絕開跑', () => {
  const roi = JSON.parse(fs.readFileSync(path.join(SIM_DIR, 'policy.extreme.roi.json'), 'utf8'));
  /* 對照組：現行策略必須載得起來 */
  assert.doesNotThrow(() => createPolicy(roi));

  const bad = JSON.parse(JSON.stringify(roi));
  bad.rules.push({ id: 'x', bestPerSlot: { items: 'panels.inv.items' } });
  assert.throws(() => createPolicy(bad), /panels\.inv\.items/,
    '指到被切掉的面板欄位時必須大聲失敗');

  /* 前綴也要抓到：panels.inv.items[0].id 這種更深的路徑同樣取不到值 */
  const deeper = JSON.parse(JSON.stringify(roi));
  deeper.rules.push({ id: 'y', args: { $path: 'panels.inv.items.0.id' } });
  assert.throws(() => createPolicy(deeper), /panels\.inv\.items/);
});

test('哨兵不得被說明文字誤觸（_依據 裡提到路徑是正常的）', () => {
  const p = {
    name: 'x', decideEveryGameSec: 5, needPanels: ['inv'],
    panelParams: { inv: { items: false, items_依據: '本策略不讀 panels.inv.items，所以不建' } },
    rules: []
  };
  assert.doesNotThrow(() => createPolicy(p),
    '散文提及不算使用——否則「寫了註解就開不了機」');
});

test('ROI 策略確實宣告了不建 inv.items，而且真的沒有規則在讀它', () => {
  const roi = JSON.parse(fs.readFileSync(path.join(SIM_DIR, 'policy.extreme.roi.json'), 'utf8'));
  assert.equal(roi.panelParams && roi.panelParams.inv && roi.panelParams.inv.items, false);
  const policy = createPolicy(roi);
  assert.ok(policy.needPanels.indexOf('inv') >= 0, 'inv 面板本身仍然要建（其餘欄位還在用）');
});

test('其餘策略沒有宣告，行為不變', () => {
  for (const f of fs.readdirSync(SIM_DIR).filter((x) => /^policy\..+\.json$/.test(x))) {
    if (f === 'policy.extreme.roi.json') continue;
    const p = createPolicy(JSON.parse(fs.readFileSync(path.join(SIM_DIR, f), 'utf8')));
    assert.equal(p.panelParams, null, `${f} 不應該有 panelParams`);
  }
});
