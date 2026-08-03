/* 同一件裝備不得同時佔兩個欄位。

   戒指與武器各有主副兩欄，而「把已經戴在 ring 的那只再裝到 ring2」是完全合法的呼叫
   （resolveItem 會從裝備欄找到它）。舊的 equipItem 直接 eq[key] = it，於是兩個欄位
   指向**同一個物件**，兩次呼叫都回成功、沒有任何警告。

   後果不是只有屬性被算兩次：
     存檔  JSON.stringify 把同一個物件寫成兩份，id 相同
     讀檔  變成兩個獨立物件共用一個 id
     之後  resolveItem 回「ambiguous item id（命中 2 個）」——
           那件裝備從此不能強化、不能洗煉、也不能卸下，永久磚掉

   而且會自我繁殖：item.unequip 只清掉找到的第一個欄位就 break，接著 addToInventory
   讓背包與裝備欄同時持有；下一次換裝再 addToInventory 一次，背包裡就出現兩份。

   實測 84 個模擬存檔有 74 個含重複 id（最舊的批次就有），單一存檔中位數 2~19 組。
   這一支盯的是「裝到另一個欄位＝移動，不是複製」。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { createEngine } = require('../scripts/sim/engine.js');

/* 撿兩只戒指回來（用遊戲自己的掉落，不手捏物件）。 */
function bootWithRings(seed) {
  const e = createEngine({ seed }).boot(null);
  const c = e.ctx;
  e.stepSeconds(3600);
  const rings = c.G.inventory.filter(
    (i) => i && i.kind === 'equip' && (c.equipSlotsForItem(i) || []).indexOf('ring') >= 0
  );
  return { e, c, rings };
}

/* 存檔裡（裝備欄＋背包）出現重複 id 的組數。 */
function dupeGroups(json) {
  const g = JSON.parse(json);
  const seen = new Map();
  const dup = new Set();
  const note = (it, where) => {
    if (!it || !it.id) return;
    if (seen.has(it.id)) dup.add(it.id);
    else seen.set(it.id, where);
  };
  for (const k in (g.equipment || {})) note(g.equipment[k], 'eq:' + k);
  (g.inventory || []).forEach((it, i) => note(it, 'inv:' + i));
  return [...dup];
}

test('把同一件裝備裝到第二個欄位＝移動，原欄位要空出來', () => {
  const { e, c, rings } = bootWithRings(4242);
  assert.ok(rings.length >= 1, '前提：一小時內至少撿到一只戒指');
  const a = rings[0];

  assert.equal(c.runCommand('item.equip', { itemId: a.id, slotKey: 'ring' }).ok, true);
  assert.equal(c.G.equipment.ring.id, a.id);

  assert.equal(c.runCommand('item.equip', { itemId: a.id, slotKey: 'ring2' }).ok, true);
  assert.equal(c.G.equipment.ring2.id, a.id);
  assert.equal(c.G.equipment.ring, null, 'ring 必須空出來——留著就是同一個物件佔兩欄');
  assert.notEqual(c.G.equipment.ring, c.G.equipment.ring2);

  assert.deepEqual(dupeGroups(e.saveJson()), [], '存檔不得出現重複 id');
});

test('磚掉的證據：舊的別名形狀存檔讀回來之後連卸下都做不到', () => {
  /* 這一支是反證：修正的價值在於「不會產生這種存檔」，所以要先確認那種存檔
     真的救不回來，否則這整條修正只是潔癖。

     ⚠️ 必須在**活的物件圖**上製造別名（兩欄指向同一個物件），不能改 JSON 之後再讀。
     兩者的存檔長得不一樣：活的別名會讓同一份內容被序列化到多個位置（實測同一個 id
     出現 4 次），而手改 JSON 只多一份——後者在讀檔時會被既有的修復流程換掉，
     於是測不出問題。第一版就是這樣寫的，結果 upgrade 回 ok，看起來像修正沒必要。 */
  const { e, c, rings } = bootWithRings(777);
  const a = rings[0];
  c.runCommand('item.equip', { itemId: a.id, slotKey: 'ring' });
  c.G.equipment.ring2 = c.G.equipment.ring;          // 舊 equipItem 造成的形狀

  const json = e.saveJson();
  const e2 = createEngine({ seed: 1 }).boot(JSON.parse(json));
  assert.equal(e2.ctx.G.equipment.ring.id, e2.ctx.G.equipment.ring2.id,
    '前提：讀回來是兩個共用 id 的獨立物件');

  for (const [cmd, args] of [
    ['item.upgrade', { itemId: a.id }],
    ['item.unequip', { itemId: a.id, slotKey: 'ring2' }]
  ]) {
    const res = e2.ctx.runCommand(cmd, args);
    assert.equal(res.ok, false, cmd + ' 在重複 id 下應該失敗');
    assert.match(res.error, /ambiguous item id/,
      cmd + ' 應回 ambiguous item id，實際：' + res.error);
  }
});

test('原地重裝同一個欄位不會回報「換下了一件」', () => {
  /* replaced 會被呼叫端拿去 addToInventory。回報自己的話，那件裝備會被複製一份進背包。 */
  const { c, rings } = bootWithRings(999);
  const a = rings[0];
  c.runCommand('item.equip', { itemId: a.id, slotKey: 'ring' });
  const res = c.runCommand('item.equip', { itemId: a.id, slotKey: 'ring' });
  assert.equal(res.ok, true);
  assert.equal(res.result.replaced, null, '原地重裝沒有任何裝備被換下來');
  assert.equal(c.G.inventory.filter((i) => i && i.id === a.id).length, 0,
    '背包裡不該多出同一件');
});

test('雙手武器仍然照舊把副手卸下（原本的行為不能被改壞）', () => {
  const e = createEngine({ seed: 20260808 }).boot(null);
  const c = e.ctx;
  e.stepSeconds(7200);
  const twoH = c.G.inventory.find((i) => i && i.kind === 'equip' && c.isTwoHandItem && c.isTwoHandItem(i));
  const offHand = c.G.inventory.find(
    (i) => i && i.kind === 'equip' && (c.equipSlotsForItem(i) || []).indexOf('weapon2') >= 0
      && !(c.isTwoHandItem && c.isTwoHandItem(i))
  );
  if (!twoH || !offHand) return;                       // 這個 seed 沒撿到，不強求

  c.runCommand('item.equip', { itemId: offHand.id, slotKey: 'weapon2' });
  assert.equal(c.G.equipment.weapon2.id, offHand.id);
  c.runCommand('item.equip', { itemId: twoH.id, slotKey: 'weapon' });
  assert.equal(c.G.equipment.weapon.id, twoH.id);
  assert.equal(c.G.equipment.weapon2, null, '雙手武器要把副手擠下來');
  assert.equal(c.G.inventory.filter((i) => i && i.id === offHand.id).length, 1,
    '被擠下來的副手回背包，而且只有一份');
});

test('策略不會把同一件背包裝備同時送去兩個欄位', () => {
  /* 觸發這個 bug 的是策略：評估器是逐部位獨立精算的，一只好戒指必然同時成為
     ring 與 ring2 的最佳候選。舊的 bestPerSlot 有 used 去重，換成 equipByPower 時漏掉。 */
  const { createPolicy } = require('../scripts/sim/policy.js');
  const p = createPolicy({
    name: 'test-equip-dedupe',
    decideEveryGameSec: 10,
    needPanels: ['eval'],
    rules: [{
      id: 'equip', cmd: 'item.equip',
      equipByPower: { source: 'panels.eval.slotUpgrades', minGainPct: 1 }
    }]
  });
  const cmds = p.decide({
    gameTimeSec: 10, view: {},
    panels: {
      eval: {
        slotUpgrades: {
          /* 同一個 itemId 同時是兩只戒指的最佳候選——評估器真的會這樣回 */
          ring: { itemId: 'same-ring', gain: 50, worth: true },
          ring2: { itemId: 'same-ring', gain: 50, worth: true },
          amulet: { itemId: 'other', gain: 30, worth: true }
        }
      }
    }
  });
  const ids = cmds.filter((c) => c.name === 'item.equip').map((c) => c.args.itemId);
  assert.deepEqual(ids.sort(), ['other', 'same-ring'],
    'same-ring 只能送一次，否則第二條會把第一條的成果搬走');
});
