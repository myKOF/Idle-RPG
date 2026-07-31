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
