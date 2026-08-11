/* 穿透寶石（穿甲＝物穿／穿魔＝魔穿，2026-08-06 新增）。
   驗的是「這兩顆寶石真的會變成玩家的穿透」與「十個階級的數值就是企劃給的那串」，
   不是表裡有沒有那兩列——寶石只要 stat 指到 computeStats 既有的聚合桶就會生效。
   數值是需求直接指定的（10/20/30/40/50/100/200/400/800/1600%），所以逐級釘死；
   曲線本身由 base + linear 推導，改 base 會整串一起動，測試會立刻抓到。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const SPEC = [10, 20, 30, 40, 50, 100, 200, 400, 800, 1600];
const PEN_GEMS = [
  { type: 'piercePhys', stat: 'pPen', name: '穿甲寶石' },
  { type: 'pierceMagic', stat: 'mPen', name: '穿魔寶石' }
];

function loadGameContext() {
  const context = { console, UI: { dirty: {} } };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/item.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

function emptyEquipment(context) {
  return context.SLOT_LIST.reduce((equipment, slot) => {
    equipment[slot] = null;
    return equipment;
  }, {});
}

function statsWithHelmetSockets(context, sockets) {
  context.G = {
    player: { level: 1, reincarnations: 0, skills: {} },
    equipment: emptyEquipment(context)
  };
  context.G.equipment.helmet = { affixes: [], sockets: sockets, enchants: [] };
  return context.computeStats();
}

test('穿透寶石存在，物穿／魔穿各一，走線性曲線', () => {
  const context = loadGameContext();
  PEN_GEMS.forEach((g) => {
    const gem = context.GEM_TYPES[g.type];
    assert.ok(gem, '缺少' + g.name);
    assert.equal(gem.stat, g.stat);
    assert.equal(gem.pct, true);
    assert.equal(gem.linear, true, '穿透寶石走 linear 曲線，不是一般寶石的超線性曲線');
    assert.equal(gem.base, 10);
  });
  // 兩顆是對位關係：除了 stat 之外的數值設定必須完全一致
  const p = context.GEM_TYPES.piercePhys, m = context.GEM_TYPES.pierceMagic;
  assert.equal(p.base, m.base);
  assert.equal(p.linear, m.linear);
});

test('1~10 階數值 = 10/20/30/40/50/100/200/400/800/1600（需求指定值）', () => {
  const context = loadGameContext();
  PEN_GEMS.forEach((g) => {
    const actual = SPEC.map((_, i) => context.gemStatValue(g.type, i + 1));
    assert.deepEqual(actual, SPEC, g.name + ' 的階級數值不符需求');
  });
});

test('鑲上穿透寶石會實際提高 st.pPen／st.mPen，數值等於該階級的寶石值', () => {
  const context = loadGameContext();
  const before = statsWithHelmetSockets(context, []);
  PEN_GEMS.forEach((g) => {
    [1, 5, 10].forEach((level) => {
      const after = statsWithHelmetSockets(context, [{ type: g.type, level: level }]);
      const expected = context.gemStatValue(g.type, level);
      assert.equal(Math.round((after[g.stat] - before[g.stat]) * 100) / 100, expected,
        level + ' 階' + g.name + ' 應提供 ' + expected + '% ' + g.stat);
    });
  });
});

test('穿透寶石的穿透吃得到忽略防禦曲線（不設上限、不會爆成負防禦）', () => {
  const context = loadGameContext();
  // 10 階物穿寶石 1600% → 忽略防禦比率必為 (0,1) 之間；防禦乘區恆為正
  const st = statsWithHelmetSockets(context, [{ type: 'piercePhys', level: 10 }]);
  const ratio = context.penIgnoreRatio(st.pPen);
  assert.ok(ratio > 0 && ratio < 1, '忽略防禦比率應落在 (0,1)：' + ratio);
  assert.ok(context.penDefMultiplier(ratio) > 0, '防禦乘區不得歸零或轉負');
  // 穿透無上限，1600% 不該被 STAT_CAPS 夾掉
  assert.ok(st.pPen >= 1600, '穿透不設上限，10 階寶石的 1600% 應完整計入：' + st.pPen);
});

test('物理與魔法穿透 tips 的目前忽略防禦顯示至小數點點後四位', () => {
  const context = loadGameContext();
  const st = { pPen: 33854, mPen: 33854 };
  const pDesc = context.penetrationDesc(st, 'pPen', '物理');
  const mDesc = context.penetrationDesc(st, 'mPen', '魔法');
  assert.match(pDesc, /目前忽略防禦：\d+\.\d{4}%/);
  assert.match(mDesc, /目前忽略防禦：\d+\.\d{4}%/);
});

test('穿透寶石納入戰力評分，並自動進入掉落／商店／合成流程', () => {
  const context = loadGameContext();
  assert.ok(context.SCORE_WEIGHTS.pPen > 0, '穿透應有詞條池權重');
  assert.ok(context.SCORE_WEIGHTS.mPen > 0);
  const bare = context.itemScore({
    slot: 'helmet', rarity: 1, level: 1, upgrade: 0, affixes: [], sockets: [], enchants: []
  });
  PEN_GEMS.forEach((g) => {
    const scored = context.itemScore({
      slot: 'helmet', rarity: 1, level: 1, upgrade: 0,
      affixes: [], sockets: [{ type: g.type, level: 5 }], enchants: []
    });
    assert.ok(scored > bare, g.name + ' 應計入戰力評分');
    // randomGemType 直接取 GEM_TYPES 的鍵，新種類自動出現在所有隨機來源
    assert.ok(Object.keys(context.GEM_TYPES).indexOf(g.type) >= 0);
  });
});

test('Gems 表已同步兩列，套用參數時不會把寶石洗掉', () => {
  const csv = fs.readFileSync(path.join(root, 'config/CSV/Gems.csv'), 'utf8');
  // config_tables --apply 會由這張表重建 GEM_TYPES；表裡沒有就等於刪掉
  assert.match(csv, /^piercePhys,穿甲寶石,.*,pPen,物理穿透%,10,TRUE,TRUE$/m);
  assert.match(csv, /^pierceMagic,穿魔寶石,.*,mPen,魔法穿透%,10,TRUE,TRUE$/m);
});
