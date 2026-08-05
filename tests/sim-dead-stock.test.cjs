/* 死庫存清單（panels.eval.deadStock）：背包常態水位的判準。

   這份清單會直接變成 item.salvage 指令，所以它列錯就是**真的把東西拆掉**，
   沒有回頭路。四件事必須釘死：

     1. locked 絕對不能出現。遊戲的 item.salvage **不檢查 locked**
        （js/worker/sim.worker.js：直接 splice 掉就拆），這一層是唯一的保護。
     2. 非裝備不能出現。
     3. 保留的必須剛好是「每個部位 itemScore 前 K 名的聯集」——換裝精算只看前
        candidatesPerSlot 名，所以被拆掉的本來就不可能被選中。這是這個判準
        唯一的正當性來源，不能是「大概差不多」。
     4. 截斷要如實回報。清單有長度上限，而「還有 300 件沒列出來」與
        「只剩 3 件」在報表上必須分得出來。

   刻意不用「同品質同部位、太古數沒比較多就拆」那種判準：實測 R5 裝等150 無太古
   合計 6,635，比 R5 裝等100 帶一條太古的 4,985 強 33%——跨過關卡 150 的那一刻，
   那條規則會把更強的新掉落當場拆掉。itemScore 含裝等與強化倍率，跨分段會自動排對。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { createEngine } = require('../scripts/sim/engine.js');

const CFG = { deadStock: { keepPerSlot: 3, maxPerRefresh: 1000 } };

function bootedEngine(seconds) {
  const engine = createEngine({ seed: 20260803 });
  engine.boot(null);
  engine.stepSeconds(seconds || 1800);
  /* 落點必須是「有對手」的正常決策點：沒有對手（剛死、復活中、剛過關）時
     eval 面板回 known:false 的空殼，deadStock 是 bagCount 0 的佔位物件，
     整包斷言會誤判。固定秒數的落點會被任何改動亂數流的功能位移
     （例：2026-08-05 雙手武器詞條 +1），所以不能靠挑秒數，要推進到條件成立。 */
  for (let i = 0; i < 300 && !(engine.panel('eval', { refreshSec: 0 }) || {}).known; i++) {
    engine.stepSeconds(1);
  }
  return engine;
}

/* 面板的規劃區塊有 refreshSec 快取，測試要拿到「當下這一份」就得讓它失效。
   refreshSec:0 代表每次都重算。 */
function deadStock(engine, over) {
  const params = Object.assign({}, CFG, { refreshSec: 0 }, over || {});
  const panel = engine.panel('eval', params);
  return panel && panel.deadStock;
}

test('沒宣告 deadStock 時整個機制關閉（其他策略行為不變）', () => {
  const engine = bootedEngine();
  const panel = engine.panel('eval', { refreshSec: 0 });
  assert.equal(panel.deadStock, null, '沒宣告就必須是 null，不能自作主張列出東西');
});

test('locked 的裝備絕對不會被列進死庫存', () => {
  const engine = bootedEngine();
  const inv = engine.ctx.G.inventory;
  assert.ok(inv.length > 10, '前提：背包要有夠多東西');

  /* 先取一份沒鎖定時的清單，確認這幾件本來會被列出來——
     否則「鎖了之後沒出現」可能只是因為它本來就不在清單上。 */
  const before = deadStock(engine);
  assert.ok(before.items.length > 0, '前提：本來要有死庫存可列');
  const victims = before.items.slice(0, 3).map((x) => x.id);
  assert.equal(victims.length, 3);

  for (const it of inv) if (victims.indexOf(it.id) >= 0) it.locked = true;

  const after = deadStock(engine);
  const listed = after.items.map((x) => x.id);
  for (const v of victims) {
    assert.equal(listed.indexOf(v), -1, `鎖定的 ${v} 不得出現在死庫存清單`);
  }
  assert.equal(after.bagCount, before.bagCount - 3, '鎖定的也不該算進掃描件數');
});

test('保留的剛好是「每個部位 itemScore 前 K 名的聯集」', () => {
  const engine = bootedEngine();
  const ctx = engine.ctx;
  const K = 3;
  const ds = deadStock(engine, { deadStock: { keepPerSlot: K, maxPerRefresh: 1000 } });

  /* 用遊戲的函式自己重算一次期望值，不抄評估器的實作。 */
  const inv = ctx.G.inventory.filter((it) => it && !it.locked && it.kind === 'equip');
  const scored = inv.map((it) => ({
    id: it.id,
    slots: ctx.equipSlotsForItem(it) || [],
    score: ctx.itemScore(it)
  }));
  const expectKeep = new Set();
  for (const slot of ctx.SLOT_LIST) {
    const cands = scored.filter((x) => x.slots.indexOf(slot) >= 0)
      .sort((a, b) => (b.score - a.score) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    cands.slice(0, K).forEach((x) => expectKeep.add(x.id));
  }

  const listed = new Set(ds.items.map((x) => x.id));
  for (const x of scored) {
    if (expectKeep.has(x.id)) {
      assert.equal(listed.has(x.id), false, `${x.id} 是某個部位的前 ${K} 名，不該被拆`);
    } else {
      assert.equal(listed.has(x.id), true, `${x.id} 在每個部位都排不進前 ${K} 名，應該列為死庫存`);
    }
  }
  assert.equal(ds.total, scored.length - expectKeep.size);
});

test('K 越大留得越多（判準真的吃 keepPerSlot，不是寫死的）', () => {
  const engine = bootedEngine();
  const a = deadStock(engine, { deadStock: { keepPerSlot: 1, maxPerRefresh: 1000 } });
  const b = deadStock(engine, { deadStock: { keepPerSlot: 8, maxPerRefresh: 1000 } });
  assert.ok(a.total > b.total, `K=1 應該比 K=8 拆得多（${a.total} vs ${b.total}）`);
});

test('截斷如實回報，而且先拆分數最低的', () => {
  const engine = bootedEngine();
  const full = deadStock(engine, { deadStock: { keepPerSlot: 3, maxPerRefresh: 1000 } });
  assert.ok(full.total > 5, '前提：死庫存要夠多才測得到截斷');

  const cut = deadStock(engine, { deadStock: { keepPerSlot: 3, maxPerRefresh: 5 } });
  assert.equal(cut.items.length, 5);
  assert.equal(cut.total, full.total, 'total 必須是真實總數，不是截斷後的數量');
  assert.equal(cut.truncated, full.total - 5, '被截掉幾件要說出來，不做無聲截斷');

  /* 截斷保留的必須是分數最低的那幾件 */
  const lowest = full.items.slice(0, 5).map((x) => x.id);
  assert.deepEqual(cut.items.map((x) => x.id), lowest);
});

test('清單裡的 id 都真的拆得掉（拆完背包件數對得起來）', () => {
  const engine = bootedEngine();
  const ds = deadStock(engine, { deadStock: { keepPerSlot: 3, maxPerRefresh: 10 } });
  assert.ok(ds.items.length > 0);
  const before = engine.ctx.G.inventory.length;
  let ok = 0;
  for (const row of ds.items) {
    const res = engine.cmd('item.salvage', { itemId: row.id });
    assert.ok(res && !res.err, `拆 ${row.id} 失敗：${res && res.err}`);
    ok++;
  }
  assert.equal(engine.ctx.G.inventory.length, before - ok);
});

test('沒有對手時給的是空清單而不是 null（避免灌爆 BAD_PATHS）', () => {
  const engine = createEngine({ seed: 99 });
  engine.boot(null);
  /* 還沒開打就建面板：evalFoe() 取不到對手，走的是空殼那一條路 */
  const panel = engine.panel('eval', Object.assign({}, CFG, { refreshSec: 0 }));
  if (panel.known === false) {
    assert.notEqual(panel.deadStock, null, '機制開著時，空殼也要給同形物件');
    assert.equal(panel.deadStock.items.length, 0);
  }
});
