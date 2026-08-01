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

test('鑲寶石：只鑲手上真的有的種類，且不超過庫存', () => {
  const rule = {
    id: 'sock', cmd: 'gem.socket',
    socketEmpty: {
      equipment: 'panels.inv.equipment', gems: 'panels.gems.gems',
      preferTypes: ['garnet', 'ruby']          // garnet 沒貨，應退到 ruby
    }
  };
  const p = makePolicy([rule]);
  const cmds = p.decide({
    gameTimeSec: 100,
    panels: {
      inv: { equipment: {
        helmet: { id: 'h', sockets: [null, null] },
        chest: { id: 'c', sockets: [null] },
        boots: { id: 'b', sockets: [{ type: 'ruby', level: 1 }] }   // 已鑲滿
      } },
      gems: { gems: { ruby: { 1: 2 }, garnet: { 1: 0 } } }          // ruby 只有 2 顆
    }
  });
  assert.deepEqual(cmds.map((c) => c.args.type), ['ruby', 'ruby'],
    'garnet 庫存為 0 應退回 ruby——寫死種類時遊戲只會回「沒有這種寶石」');
  assert.deepEqual(cmds.map((c) => c.args.itemId), ['h', 'c'],
    '只鑲有空槽的部位，且送出數量不得超過庫存 2 顆');
});

/* ---- 分段策略（player_strategy.md 的寶石鑲嵌順序與技能升級優先順序）----
   分段的邊界是角色等級，錯段不會報錯，只會整場鑲錯寶石／點錯技能。 */

const BAND_RULE = {
  id: 'sock', cmd: 'gem.socket',
  socketEmpty: {
    equipment: 'panels.inv.equipment', gems: 'panels.gems.gems', levelPath: 'view.level',
    preferByLevel: [
      { maxLevel: 50, types: ['topaz', 'amethyst'] },
      { maxLevel: 100, types: ['onyx', 'amethyst'] },
      { mix: [['garnet'], ['coreFire', 'coreIce']] }
    ]
  }
};

function socketState(level, slots, gems) {
  const equipment = {};
  slots.forEach((id) => { equipment[id] = { id, sockets: [null] }; });
  return { gameTimeSec: 100, view: { level }, panels: { inv: { equipment }, gems: { gems } } };
}

test('鑲寶石：偏好序隨等級換段', () => {
  const p = makePolicy([BAND_RULE]);
  const stock = { topaz: { 1: 5 }, onyx: { 1: 5 }, amethyst: { 1: 5 } };

  const early = p.decide(socketState(50, ['a'], stock));
  assert.deepEqual(early.map((c) => c.args.type), ['topaz'], '前 50 級以生命(topaz)為首');

  const mid = p.decide(socketState(51, ['a'], stock));
  assert.deepEqual(mid.map((c) => c.args.type), ['onyx'],
    '51 級起改以吸血(onyx)為首——邊界值必須落在下一段，差一級就整場鑲錯');
});

test('鑲寶石：101 以後一半爆傷、一半屬性寶石，且屬性組平均分散', () => {
  const p = makePolicy([BAND_RULE]);
  const cmds = p.decide(socketState(101, ['a', 'b', 'c', 'd'], {
    garnet: { 1: 10 }, coreFire: { 1: 10 }, coreIce: { 1: 10 }
  }));
  const types = cmds.map((c) => c.args.type);
  assert.equal(types.filter((t) => t === 'garnet').length, 2, '一半鑲爆傷');
  assert.deepEqual(types, ['garnet', 'coreFire', 'garnet', 'coreIce'],
    '屬性組要輪流取用，否則六種屬性寶石會全押在清單第一個上');
});

test('鑲寶石：偏好的種類沒貨就退到有貨的，且不超過庫存', () => {
  const p = makePolicy([BAND_RULE]);
  const cmds = p.decide(socketState(10, ['a', 'b', 'c'], { topaz: { 1: 0 }, amethyst: { 2: 2 } }));
  assert.deepEqual(cmds.map((c) => c.args.type), ['amethyst', 'amethyst'],
    'topaz 庫存 0 應退到 amethyst；只有 2 顆就只能送 2 條——送超過庫存的每一條都會換回「沒有這種寶石」');
});

/* ---- 換下寶石 ----
   沒有這條規則的話分段偏好序是裝飾用的：socketEmpty 只填空槽，
   前期鑲上的雜牌會把插槽佔死，等級跨段時身上也不會有任何變化。 */

const UNSOCKET_RULE = {
  id: 'unsock', cmd: 'gem.unsocket',
  unsocketOffPriority: {
    equipment: 'panels.inv.equipment', gems: 'panels.gems.gems', levelPath: 'view.level',
    maxPerDecision: 9,
    preferByLevel: [{ maxLevel: 50, types: ['topaz'] }, { types: ['garnet'] }]
  }
};

function unsockState(level, sockets, gems) {
  return {
    gameTimeSec: 100, view: { level },
    panels: { inv: { equipment: { helmet: { id: 'h', sockets } } }, gems: { gems } }
  };
}

test('換下寶石：拆掉不符當前偏好段的種類', () => {
  const p = makePolicy([UNSOCKET_RULE]);
  const cmds = p.decide(unsockState(10,
    [{ type: 'catseye', level: 1 }, { type: 'topaz', level: 2 }, { type: 'opal', level: 1 }],
    { topaz: { 2: 3 } }));
  assert.deepEqual(cmds.map((c) => c.args.index), [0, 2],
    '只拆非偏好的 catseye 與 opal，偏好且已是最高階的 topaz 不動');
});

test('換下寶石：偏好種類一顆都沒有時完全不動', () => {
  const p = makePolicy([UNSOCKET_RULE]);
  const cmds = p.decide(unsockState(10, [{ type: 'catseye', level: 1 }], { topaz: { 1: 0 } }));
  assert.deepEqual(cmds, [],
    '拆下來補不回去的話插槽會空著，比留著雜牌更糟');
});

test('換下寶石：同種類但階級低於庫存最高階也要換，且會收斂', () => {
  const p = makePolicy([UNSOCKET_RULE]);
  const low = p.decide(unsockState(10, [{ type: 'topaz', level: 1 }], { topaz: { 1: 1, 5: 2 } }));
  assert.deepEqual(low.map((c) => c.args.index), [0], '身上一級、庫存有五級就該換');

  const top = p.decide(unsockState(10, [{ type: 'topaz', level: 5 }], { topaz: { 1: 1, 5: 2 } }));
  assert.deepEqual(top, [],
    '已經是庫存最高階就不再換——不收斂的話每個決策點都會拆了又鑲，永遠來回');
});

test('換下寶石：融合寶石與空槽不動，且受單次上限限制', () => {
  const p = makePolicy([Object.assign({}, UNSOCKET_RULE, {
    unsocketOffPriority: Object.assign({}, UNSOCKET_RULE.unsocketOffPriority, { maxPerDecision: 1 })
  })]);
  const cmds = p.decide(unsockState(10,
    [null, { fused: { id: 'f1' } }, { type: 'opal', level: 1 }, { type: 'catseye', level: 1 }],
    { topaz: { 1: 5 } }));
  assert.deepEqual(cmds.map((c) => c.args.index), [2],
    '空槽與融合寶石都不該被拆；上限 1 顆時只送一條——一次拆光會害角色在補回來之前裸裝作戰');
});

test('換下寶石：replaceWith 讓拆與補在同一決策點成對送出', () => {
  const p = makePolicy([Object.assign({}, UNSOCKET_RULE, {
    unsocketOffPriority: Object.assign({}, UNSOCKET_RULE.unsocketOffPriority, { replaceWith: 'gem.socket' })
  })]);
  const cmds = p.decide(unsockState(10,
    [{ type: 'catseye', level: 1 }, { type: 'opal', level: 1 }], { topaz: { 3: 1 } }));
  assert.deepEqual(cmds.map((c) => c.name),
    ['gem.unsocket', 'gem.socket'],
    '拆一顆就要立刻補一顆——只拆不補的話空槽會被 socket-gems 的退路塞回雜牌');
  assert.equal(cmds[1].args.type, 'topaz');
  assert.equal(cmds.length, 2,
    'topaz 只有 1 顆，第二個雜牌就補不到偏好種類，必須放著不動而不是拆掉');
});

/* ---- 分解門檻與背包壓力閥 ----
   這兩條守的是同一個災難：背包滿了不只是換裝挑不到東西，而是整條掉落管線停擺
   （熔爐佇列推不進背包就回堵，新裝備直接丟棄）。角色會停在原地打幾十小時，
   畫面上完全正常，只是再也不會有任何東西掉下來。 */

test('分解門檻：跟著身上最低品質走，且只在需要改變時送指令', () => {
  const p = makePolicy([{
    id: 'sv', cmd: 'newforge.setQuality',
    salvageBelowEquipped: {
      equippedRarities: 'panels.inv.equipmentRarities',
      furnaces: 'panels.newforge.newForge.furnaces'
    }
  }]);
  const cmds = p.decide({
    gameTimeSec: 100,
    panels: {
      inv: { equipmentRarities: { helmet: 3, chest: 2, weapon2: -1 } },   // 最低是 2（空部位不算）
      newforge: { newForge: { furnaces: [{ id: 1, qualities: [true, false, false, false] }] } }
    }
  });
  assert.deepEqual(cmds.map((c) => [c.args.rarity, c.args.on]), [[1, true]],
    'R0 已經是 true 不用再送；R1 要打開；R2/R3 已經是 false 也不用送——' +
    '每次都送一整輪只會把指令統計淹掉');
});

test('分解門檻：空部位不能把門檻拉到地板', () => {
  const p = makePolicy([{
    id: 'sv', cmd: 'newforge.setQuality',
    salvageBelowEquipped: {
      equippedRarities: 'panels.inv.equipmentRarities',
      furnaces: 'panels.newforge.newForge.furnaces'
    }
  }]);
  const cmds = p.decide({
    gameTimeSec: 100,
    panels: {
      inv: { equipmentRarities: { helmet: 3, weapon2: -1 } },
      newforge: { newForge: { furnaces: [{ id: 1, qualities: [false, false, false, false] }] } }
    }
  });
  assert.deepEqual(cmds.map((c) => c.args.rarity), [0, 1, 2],
    '雙手武器讓 weapon2 永遠是 -1，若當成品質 0 就永遠只拆 R0，門檻升不上去');
});

test('背包壓力閥：未達使用率不動，達到才清到「身上最高品質往下一階」', () => {
  const rule = {
    id: 'bf', cmd: 'item.salvageBulk',
    salvageWhenFull: {
      count: 'panels.inv.count', cap: 'panels.inv.cap',
      equippedRarities: 'panels.inv.equipmentRarities',
      fullRatio: 0.9, belowMaxBy: 1
    }
  };
  const p = makePolicy([rule]);
  const st = (count, cap) => ({
    gameTimeSec: 100,
    panels: { inv: { count, cap, equipmentRarities: { helmet: 3, chest: 2 } } }
  });
  assert.deepEqual(p.decide(st(200, 300)), [], '三分之二滿：還有空間就別動庫存');
  const cmds = p.decide(st(298, 300));
  assert.deepEqual(cmds.map((c) => c.args.maxRarity), [2],
    '身上最高是 R3，清掉 R2 以下——留「配得上最好那件」的標準只在空間稀缺時才啟用');
});

/* ---- 附魔 ----
   遊戲規定每個部位只吃一種類別，送錯類別只會換回一句「XX 只能使用 OO 類附魔」，
   規則整場落空卻看不出來。 */

const ENCHANT_RULE = {
  id: 'ench', cmd: 'item.enchant',
  enchantPriority: {
    equipment: 'panels.inv.equipment',
    enchantInfo: 'panels.inv.equipmentEnchantInfo',
    books: 'panels.inv.books',
    byCategory: { util: ['vigor'], atk: ['ice'], def: ['fireRes', 'iceRes', 'lightningRes'] },
    spread: ['def'], maxPerDecision: 9
  }
};

function enchState(equipment, info, books) {
  return { gameTimeSec: 100, panels: { inv: { equipment, equipmentEnchantInfo: info, books } } };
}

test('附魔：依部位的類別挑書，不跨類別', () => {
  const p = makePolicy([ENCHANT_RULE]);
  const cmds = p.decide(enchState(
    { amulet: { id: 'a', enchants: [] }, weapon: { id: 'w', enchants: [] }, helmet: { id: 'h', enchants: [] } },
    { amulet: { cat: 'util', cap: 1 }, weapon: { cat: 'atk', cap: 1 }, helmet: { cat: 'def', cap: 1 } },
    { vigor: 1, ice: 1, fireRes: 1 }
  ));
  assert.deepEqual(cmds.map((c) => c.args.bookKey), ['vigor', 'ice', 'fireRes'],
    '功能部位放生命值、攻擊部位放冰凍、防禦部位放抗性');
});

test('附魔：六大抗性要輪流分散，不是全押第一個', () => {
  const p = makePolicy([ENCHANT_RULE]);
  const cmds = p.decide(enchState(
    { helmet: { id: 'h', enchants: [] }, chest: { id: 'c', enchants: [] }, legs: { id: 'l', enchants: [] } },
    { helmet: { cat: 'def', cap: 1 }, chest: { cat: 'def', cap: 1 }, legs: { cat: 'def', cap: 1 } },
    { fireRes: 5, iceRes: 5, lightningRes: 5 }
  ));
  assert.deepEqual(cmds.map((c) => c.args.bookKey), ['fireRes', 'iceRes', 'lightningRes'],
    '「六大屬性抗性平均」要真的分散到不同部位');
});

test('附魔：沒書、附魔欄已滿、普通品質都不送', () => {
  const p = makePolicy([ENCHANT_RULE]);
  const cmds = p.decide(enchState(
    {
      amulet: { id: 'a', enchants: [] },                       // 沒 vigor 書
      boots: { id: 'b', enchants: [{ key: 'vigor' }] },        // 欄位已滿
      helmet: { id: 'h', enchants: [] }                        // cap 0＝普通裝備
    },
    { amulet: { cat: 'util', cap: 1 }, boots: { cat: 'util', cap: 1 }, helmet: { cat: 'def', cap: 0 } },
    { vigor: 0, fireRes: 3 }
  ));
  assert.deepEqual(cmds, [],
    '這三種都會被遊戲回絕，先攔下來才不會把指令統計淹掉');
});

test('附魔：同一決策點不重複用光同一本書', () => {
  const p = makePolicy([ENCHANT_RULE]);
  const cmds = p.decide(enchState(
    { amulet: { id: 'a', enchants: [] }, boots: { id: 'b', enchants: [] } },
    { amulet: { cat: 'util', cap: 1 }, boots: { cat: 'util', cap: 1 } },
    { vigor: 1 }
  ));
  assert.equal(cmds.length, 1, '只有 1 本 vigor，第二個部位就不該再送');
});

/* ---- 關卡閘門（前期優先生存任務指南）----
   核心是不要讓關卡跑在裝備前面。閘門若因為算錯分母而永久關閉，
   模擬會整場卡在同一關——不會報錯，只會看起來「這個 seed 運氣很差」。 */

const GATE_RULE = {
  id: 'gate', cmd: 'stage.setAutoAdvance',
  stageGate: {
    stage: 'view.stage', equippedRarities: 'panels.inv.equipmentRarities', argKey: 'on',
    checkpoints: [
      { maxStage: 20, minRarity: 2, coverage: 1.0 },
      { maxStage: 50, minRarity: 4, coverage: 0.3 },
      { minRarity: 0, coverage: 0 }
    ]
  }
};

function gateState(stage, rarities) {
  return { gameTimeSec: 100, view: { stage }, panels: { inv: { equipmentRarities: rarities } } };
}

test('關卡閘門：品質沒到門檻就關掉自動推關', () => {
  const p = makePolicy([GATE_RULE]);
  assert.equal(p.decide(gateState(10, { helmet: 2, chest: 1 }))[0].args.on, false,
    '胸甲還是精良，未達「全身稀有」');
  assert.equal(p.decide(gateState(10, { helmet: 2, chest: 3 }))[0].args.on, true,
    '全部達到稀有以上就放行——更高品質也算達標');
});

test('關卡閘門：空部位不列入分母（否則閘門會永久關閉）', () => {
  const p = makePolicy([GATE_RULE]);
  assert.equal(p.decide(gateState(10, { helmet: 2, chest: 2, weapon2: -1 }))[0].args.on, true,
    '雙手武器會讓 weapon2 永遠是 -1，算進分母的話覆蓋率永遠到不了 100%，' +
    '模擬會整場卡在同一關而且看不出原因');
});

test('關卡閘門：部分覆蓋率門檻', () => {
  const p = makePolicy([GATE_RULE]);
  const four = (a, b, c, d) => ({ weapon: a, helmet: b, chest: c, legs: d });
  assert.equal(p.decide(gateState(45, four(4, 4, 1, 1)))[0].args.on, true, '2/4＝50%，已達 30%');
  assert.equal(p.decide(gateState(45, four(4, 1, 1, 1)))[0].args.on, false, '1/4＝25%，未達 30%');
  assert.equal(p.decide(gateState(45, four(1, 1, 1, 1)))[0].args.on, false, '0/4 未達 30%');
});

test('關卡閘門：coverage 為 0 的收尾段一律放行', () => {
  const p = makePolicy([GATE_RULE]);
  assert.equal(p.decide(gateState(100, { helmet: 0 }))[0].args.on, true,
    '指南只涵蓋前期，之後要交回各強度自己的推關策略，不能繼續卡著');
});

/* ---- 寶石轉換 ----
   偏好種類只佔 40 種寶石裡的少數，掉落又隨機，所以「挑有貨的鑲」永遠補不滿。
   轉換在遊戲裡是同階 1:1、數量不變、不花金幣，是既有庫存的重新分配。 */

const CONVERT_RULE = {
  id: 'conv', cmd: 'gem.convert',
  convertToPreferred: {
    gems: 'panels.gems.gems', levelPath: 'view.level',
    maxSlots: 9, maxPerSlot: 1000, maxCommands: 4,
    preferByLevel: [{ maxLevel: 50, types: ['topaz'] }, { mix: [['garnet'], ['coreFire']] }]
  }
};

function convState(level, gems) {
  return { gameTimeSec: 100, view: { level }, panels: { gems: { gems } } };
}

test('轉換寶石：雜牌逐 (種類,階級) 成格，偏好種類不動', () => {
  const p = makePolicy([CONVERT_RULE]);
  const cmds = p.decide(convState(10, {
    catseye: { 1: 4, 3: 2 }, opal: { 1: 1 },
    topaz: { 1: 9 },          // 已是偏好種類，不該被轉走
    onyx: { 1: 0 }            // 沒貨
  }));
  assert.equal(cmds.length, 1);
  assert.equal(cmds[0].args.targetType, 'topaz');
  assert.deepEqual(cmds[0].args.slots, [
    { type: 'catseye', lv: 1, n: 4 },
    { type: 'catseye', lv: 3, n: 2 },
    { type: 'opal', lv: 1, n: 1 }
  ], '轉換是同階進行的，所以每個 (種類, 階級) 各佔一格；偏好種類與零庫存都不入格');
});

test('轉換寶石：配額種類不能被當成雜牌轉走', () => {
  const p = makePolicy([Object.assign({}, CONVERT_RULE, {
    convertToPreferred: Object.assign({}, CONVERT_RULE.convertToPreferred, {
      quota: [{ type: 'malachite' }, { type: 'fluorite' }]
    })
  })]);
  const cmds = p.decide(convState(10, {
    catseye: { 1: 3 }, malachite: { 1: 2 }, fluorite: { 1: 2 }
  }));
  const converted = cmds.flatMap((c) => c.args.slots.map((s) => s.type));
  assert.deepEqual(converted, ['catseye'],
    '抗性寶石被轉走的話，鑲嵌的配額就永遠補不到——實測 20 小時後身上一顆抗性都沒有');
});

test('轉換寶石：目標在偏好種類之間輪流，不會轉成清一色', () => {
  const p = makePolicy([CONVERT_RULE]);
  const cmds = p.decide(convState(101, { catseye: { 1: 3 }, opal: { 1: 3 }, jade: { 1: 3 } }));
  assert.deepEqual(cmds.map((c) => c.args.targetType).sort(), ['coreFire', 'garnet'],
    '101 段是「一半爆傷、一半屬性」，全轉成同一種會把那個一半一半毀掉');
});

test('轉換寶石：單格數量與單次格數都不得超過遊戲上限', () => {
  const p = makePolicy([Object.assign({}, CONVERT_RULE, {
    convertToPreferred: Object.assign({}, CONVERT_RULE.convertToPreferred, { maxSlots: 2, maxPerSlot: 5 })
  })]);
  const cmds = p.decide(convState(10, {
    catseye: { 1: 900 }, opal: { 1: 3 }, jade: { 1: 3 }, agate: { 1: 3 }
  }));
  assert.equal(cmds[0].args.slots[0].n, 5, '單格數量要夾在上限內');
  for (const c of cmds) {
    assert.ok(c.args.slots.length <= 2, '單次格數不得超過上限——一格超標整批就被回絕');
  }
  assert.equal(cmds.reduce((a, c) => a + c.args.slots.length, 0), 4, '四種雜牌全部要被排進去');
});

test('鑲寶石：生命／物理／魔法未達最低階級就不鑲', () => {
  const p = makePolicy([{
    id: 'sock', cmd: 'gem.socket',
    socketEmpty: {
      equipment: 'panels.inv.equipment', gems: 'panels.gems.gems', levelPath: 'view.level',
      minLevelByType: { topaz: 3 },
      preferByLevel: [{ types: ['topaz', 'amethyst'] }]
    }
  }]);
  const at = (topazLv) => p.decide(socketState(10, ['a'], {
    topaz: { [topazLv]: 5 }, amethyst: { 1: 5 }
  })).map((c) => c.args.type);

  assert.deepEqual(at(2), ['amethyst'],
    '只有二級黃玉時要跳過——socketGem 鑲的是庫存最高階，最高階沒到門檻就等於鑲不出合格的');
  assert.deepEqual(at(3), ['topaz'], '有三級就照偏好序鑲');
});

test('鑲寶石：抗性配額先補，且補滿就停', () => {
  const rule = {
    id: 'sock', cmd: 'gem.socket',
    socketEmpty: {
      equipment: 'panels.inv.equipment', gems: 'panels.gems.gems', levelPath: 'view.level',
      quota: [{ type: 'malachite', count: 1 }, { type: 'fluorite', count: 1 }],
      preferByLevel: [{ types: ['amethyst'] }]
    }
  };
  const p = makePolicy([rule]);
  const stock = { malachite: { 1: 9 }, fluorite: { 1: 9 }, amethyst: { 1: 9 } };

  assert.deepEqual(
    p.decide(socketState(10, ['a', 'b', 'c', 'd'], stock)).map((c) => c.args.type),
    ['malachite', 'fluorite', 'amethyst', 'amethyst'],
    '配額是「至少要有」不是「優先鑲滿」：各補一顆就交還給偏好序');

  /* 身上已經有的要算進配額，否則每次決策都會再補一顆，鑲滿整身抗性。 */
  const already = {
    gameTimeSec: 100, view: { level: 10 },
    panels: {
      inv: { equipment: {
        a: { id: 'a', sockets: [{ type: 'malachite', level: 1 }, null] },
        b: { id: 'b', sockets: [{ type: 'fluorite', level: 1 }, null] }
      } },
      gems: { gems: stock }
    }
  };
  assert.deepEqual(p.decide(already).map((c) => c.args.type), ['amethyst', 'amethyst'],
    '兩個配額都滿了就不再補');
});

test('鑲寶石：分段可以再掛條件（爆率未達標就不改鑲屬性寶石）', () => {
  const p = makePolicy([{
    id: 'sock', cmd: 'gem.socket',
    socketEmpty: {
      equipment: 'panels.inv.equipment', gems: 'panels.gems.gems', levelPath: 'view.level',
      preferByLevel: [
        { when: ['panels.header.stats.critRate', '>=', 100], mix: [['garnet'], ['coreFire']] },
        { types: ['amethyst'] }
      ]
    }
  }]);
  const at = (crit) => p.decide({
    gameTimeSec: 100, view: { level: 150 },
    panels: {
      inv: { equipment: { a: { id: 'a', sockets: [null] }, b: { id: 'b', sockets: [null] } } },
      gems: { gems: { garnet: { 1: 5 }, coreFire: { 1: 5 }, amethyst: { 1: 5 } } },
      header: { stats: { critRate: crit } }
    }
  }).map((c) => c.args.type);

  assert.deepEqual(at(120), ['garnet', 'coreFire'], '爆率破百才改鑲一半爆傷一半屬性');
  assert.deepEqual(at(80), ['amethyst', 'amethyst'],
    '爆率沒到就繼續補爆擊率——條件段後面一定要留一個無條件的收尾段，否則整條規則會靜靜停擺');
});

test('關卡閘門：品質沒到門檻時要退回安全關卡區間', () => {
  const rule = {
    id: 'gate', cmd: 'stage.setAutoAdvance',
    stageGate: {
      stage: 'view.stage', equippedRarities: 'panels.inv.equipmentRarities',
      argKey: 'on', retreatCmd: 'stage.go',
      checkpoints: [{ maxStage: 40, minRarity: 3, coverage: 1.0, park: [21, 25] }, { minRarity: 0, coverage: 0 }]
    }
  };
  const p = makePolicy([rule]);
  const at = (stage, rar) => p.decide(gateState(stage, rar));

  const high = at(38, { helmet: 2 });
  assert.deepEqual(high.map((c) => c.name), ['stage.go', 'stage.setAutoAdvance']);
  assert.equal(high[0].args.delta, -13, '38 關要退回區間上緣 25');
  assert.equal(high[1].args.on, false);

  const low = at(21, { helmet: 2 });
  assert.deepEqual(low.map((c) => c.name), ['stage.setAutoAdvance'], '已在區間內就不用退');
  assert.equal(low[0].args.on, false, '區間內、品質未達標：停在原地刷');

  assert.equal(at(30, { helmet: 3 })[0].args.on, true, '品質達標就放行，不受安全關卡區間限制');
});

test('學技能：清單隨等級換段', () => {
  const p = createPolicy({
    name: 'test', decideEveryGameSec: 1, needPanels: [],
    lists: { early: ['toughness'], mid: ['keenEye'], late: ['sharpBlade'] },
    rules: [{
      id: 'learn', cmd: 'skill.learn',
      expand: [{ key: 'id', listByLevel: [
        { maxLevel: 50, list: 'early' }, { maxLevel: 100, list: 'mid' }, { list: 'late' }
      ] }]
    }]
  });
  const at = (lv) => p.decide({ gameTimeSec: 100, view: { level: lv }, panels: {} }).map((c) => c.args.id);
  assert.deepEqual(at(1), ['toughness']);
  assert.deepEqual(at(50), ['toughness'], '50 級仍屬前期');
  assert.deepEqual(at(51), ['keenEye']);
  assert.deepEqual(at(101), ['sharpBlade'], '沒有 maxLevel 的段是最後一段');
});

test('合成寶石：nonEmpty 只送手上真的有貨的種類', () => {
  const p = createPolicy({
    name: 'test', decideEveryGameSec: 1, needPanels: [], lists: {},
    rules: [{
      id: 'compose', cmd: 'gem.composeAll',
      expand: [
        { key: 'type', path: 'panels.gems.gems', nonEmpty: true },
        { key: 'level', values: [1, 2] }
      ]
    }]
  });
  const cmds = p.decide({
    gameTimeSec: 100,
    panels: { gems: { gems: { ruby: { 1: 3 }, topaz: { 1: 0, 2: 0 }, onyx: { 2: 1 } } } }
  });
  assert.deepEqual([...new Set(cmds.map((c) => c.args.type))].sort(), ['onyx', 'ruby'],
    'topaz 全階都是 0 就不該送——遊戲開局會把 40 種寶石全部建好且數量為 0，不篩會送出上百條必敗指令');
  assert.equal(cmds.length, 4, '兩種有貨 × 兩個階級');
});

test('洗詞條：只洗不在目標清單的詞條，太古詞條不動', () => {
  const rule = {
    id: 'rr', cmd: 'item.rerollAffix',
    rerollOffTarget: {
      equipment: 'panels.inv.equipment', targetList: 'targetAffixes',
      minRarity: 3, keepAncient: true
    }
  };
  const p = createPolicy({
    name: 'test', decideEveryGameSec: 1, needPanels: ['inv'],
    lists: { targetAffixes: ['atkPct', 'critDmg'] }, rules: [rule]
  });
  const cmds = p.decide({
    gameTimeSec: 100,
    panels: { inv: { equipment: {
      helmet: { id: 'h', rarity: 3, affixes: [
        { key: 'atkPct' },                 // 目標，保留
        { key: 'defPct' },                 // 非目標，要洗
        { key: 'evasion', ancient: true }  // 太古，不動
      ] },
      boots: { id: 'b', rarity: 2, affixes: [{ key: 'defPct' }] }   // 低於 minRarity
    } } }
  });
  assert.deepEqual(cmds.map((c) => c.args.affixKey), ['defPct']);
  assert.deepEqual(cmds.map((c) => c.args.itemId), ['h'], '獨特以下不洗，避免前期吸乾精華');
});
