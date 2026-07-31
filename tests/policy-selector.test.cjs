/* 策略選擇器的回歸測試。

   這裡守的兩個 bug 都是**靜默失敗**：不會拋錯、不會有警告，13 個部位裡只有 2 個壞掉，
   看報表完全正常。沒有測試就只能靠人盯著存檔一格一格對。

   1. 換裝選擇器曾把「部位鍵去掉結尾數字」當成基礎部位（/\d+$/）。
      那段程式碼原本寫在樣板字串裡，反斜線被吃掉變成 /d+$/，
      於是 ring2 / weapon2 對不到背包物品，那兩個部位永遠不換裝。
      → 直譯器改放獨立 .js 檔（policy_interpreter.js），並改以遊戲提供的 item.slots 判斷。

   2. 修好 (1) 之後又踩到反面：雙手武器被塞進 weapon2，
      而遊戲為了騰出副手會把主手卸下（js/player.js:291），結果主手變空。
      → 部位歸屬一律以 equipSlotsForItem() 匯出的 item.slots 為準。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPolicy } = require('../scripts/sim/policy.js');

function makePolicy(rules) {
  return createPolicy({ name: 'test', decideEveryGameSec: 1, needPanels: ['inv'], lists: {}, rules });
}

const EQUIP_RULE = {
  id: 'eq', cmd: 'item.equip',
  bestPerSlot: { items: 'panels.inv.items', equippedScores: 'panels.inv.equipmentScores' }
};

function invPanel({ items, scores, rarities, equipment }) {
  return { items, equipmentScores: scores, equipmentRarities: rarities, equipment: equipment || {} };
}

test('換裝：ring2 這種帶數字的部位鍵也要能對到背包物品', () => {
  const p = makePolicy([EQUIP_RULE]);
  const cmds = p.decide({
    gameTimeSec: 100,
    panels: {
      inv: invPanel({
        items: [{ id: 'r1', slot: 'ring', slots: ['ring', 'ring2'], rarity: 3, score: 50 }],
        scores: { ring: 90, ring2: 0 },
        rarities: { ring: 3, ring2: -1 }
      })
    }
  });
  const slots = cmds.filter((c) => c.name === 'item.equip').map((c) => c.args.slotKey);
  assert.deepEqual(slots, ['ring2'],
    'ring 已有更好的裝備不該換；ring2 是空的，必須換上——先前這裡因為正規表示式的反斜線被吃掉而永遠不會觸發');
});

test('換裝：雙手武器不得被裝進副手（會害主手被卸下）', () => {
  const p = makePolicy([EQUIP_RULE]);
  const cmds = p.decide({
    gameTimeSec: 100,
    panels: {
      inv: invPanel({
        /* equipSlotsForItem() 對雙手武器只回 ['weapon'] */
        items: [{ id: 'w1', slot: 'weapon', slots: ['weapon'], rarity: 3, score: 50 }],
        scores: { weapon: 90, weapon2: 0 },
        rarities: { weapon: 3, weapon2: -1 }
      })
    }
  });
  const slots = cmds.filter((c) => c.name === 'item.equip').map((c) => c.args.slotKey);
  assert.deepEqual(slots, [],
    '雙手武器的合法部位只有 weapon，主手已有更好的就不該再塞進 weapon2');
});

test('強化：低品質依上限表停手，身上最高品質不設上限', () => {
  const rule = {
    id: 'up', cmd: 'item.upgrade',
    upgradePriority: {
      equippedRarities: 'panels.inv.equipmentRarities',
      equipment: 'panels.inv.equipment',
      capByRarity: [0, 0, 6, 11]
    }
  };
  const p = makePolicy([rule]);
  const cmds = p.decide({
    gameTimeSec: 100,
    panels: {
      inv: invPanel({
        items: [],
        scores: {},
        rarities: { helmet: 3, chest: 2, boots: 2, belt: 1 },
        equipment: {
          helmet: { id: 'h', upgrade: 99 },   // 最高品質：無上限，仍要繼續
          chest: { id: 'c', upgrade: 5 },     // R2 未達 6：要強化
          boots: { id: 'b', upgrade: 6 },     // R2 已達 6：停手
          belt: { id: 'be', upgrade: 0 }      // R1 上限 0：不強化
        }
      })
    }
  });
  const ids = cmds.filter((c) => c.name === 'item.upgrade').map((c) => c.args.itemId).sort();
  assert.deepEqual(ids, ['c', 'h'],
    '只有「最高品質」與「未達該品質上限」的部位該被強化');
});

test('強化：上限表沒列到的品質視為不強化，不能變成無限強化', () => {
  const rule = {
    id: 'up', cmd: 'item.upgrade',
    upgradePriority: {
      equippedRarities: 'panels.inv.equipmentRarities',
      equipment: 'panels.inv.equipment',
      capByRarity: [0, 0]            // 只列到 R1
    }
  };
  const p = makePolicy([rule]);
  const cmds = p.decide({
    gameTimeSec: 100,
    panels: {
      inv: invPanel({
        items: [], scores: {},
        rarities: { helmet: 5, chest: 3 },
        equipment: { helmet: { id: 'h', upgrade: 0 }, chest: { id: 'c', upgrade: 0 } }
      })
    }
  });
  const ids = cmds.filter((c) => c.name === 'item.upgrade').map((c) => c.args.itemId);
  assert.deepEqual(ids, ['h'],
    'R3 沒列在表上應視為不強化；只有最高品質 R5 該被強化——忘了填表不該變成資源黑洞');
});
