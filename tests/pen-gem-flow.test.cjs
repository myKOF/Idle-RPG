/* 穿透寶石（piercePhys / pierceMagic）全流程測試：
   1. GM 指令發放 gem piercePhys 10 1 / gem pierceMagic 10 1
   2. 鑲嵌 (Inlay) 到裝備插槽與拆下 (Unsocket)
   3. 拆解 (Dismantle) 獲得一級寶石（帶 30% 損耗公式）
   4. 合成 (Combine) 低階寶石合成 5 階寶石
   5. 九宮格轉換 (Grid Transform) 寶石種類轉換
   6. 融合 (Fusion) 5 階寶石融合與 fusedStatValue 5 階等值倍率運算
*/

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadFullGameContext() {
  const context = {
    console,
    location: { hostname: 'localhost' },
    UI: { dirty: {}, convertSlots: [], gemFuseSlots: [null, null] }
  };
  context.window = context;
  vm.createContext(context);

  const files = [
    'js/util.js',
    'js/data.js',
    'js/player.js',
    'js/formula.js',
    'js/stats.js',
    'js/item.js',
    'js/gm_exec.js'
  ];

  files.forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });

  // 初始化 Player 狀態
  context.G = {
    player: {
      gold: 10000000,
      level: 100,
      reincarnations: 5, // 達到融合開放門檻 (3 轉)
      gems: {},
      fusedGems: [],
      skills: {},
      skillMastery: {}
    },
    equipment: context.SLOT_LIST.reduce((acc, slot) => {
      acc[slot] = null;
      return acc;
    }, {})
  };

  return context;
}

test('1. GM 發放 gem piercePhys 10 1 / gem pierceMagic 10 1 流程', () => {
  const ctx = loadFullGameContext();

  const r1 = ctx.executeGMCommand('gem piercePhys 10 1');
  assert.equal(r1.ok, true, 'GM 發放 gem piercePhys 10 1 應成功');
  assert.equal(ctx.gemCount('piercePhys', 10), 1, '玩家應持有 1 顆 10 階物理穿透寶石');

  const r2 = ctx.executeGMCommand('gem pierceMagic 10 1');
  assert.equal(r2.ok, true, 'GM 發放 gem pierceMagic 10 1 應成功');
  assert.equal(ctx.gemCount('pierceMagic', 10), 1, '玩家應持有 1 顆 10 階魔法穿透寶石');
});

test('2. 鑲嵌 (Inlay) 穿透寶石至裝備插槽、屬性加成與拆下 (Unsocket)', () => {
  const ctx = loadFullGameContext();
  ctx.executeGMCommand('gem piercePhys 10 1');
  ctx.executeGMCommand('gem pierceMagic 10 1');

  const baseStats = ctx.computeStats();

  // 創建有插槽的頭盔
  const helmet = { slot: 'helmet', rarity: 1, level: 1, upgrade: 0, affixes: [], sockets: [null], enchants: [] };
  ctx.G.equipment.helmet = helmet;

  // 鑲嵌 10 階 piercePhys 寶石至頭盔
  const sRes1 = ctx.socketGem(helmet, 'piercePhys');
  assert.equal(sRes1, null, '鑲嵌 piercePhys 寶石應成功');
  assert.equal(ctx.gemCount('piercePhys', 10), 0, '庫存 10 階 piercePhys 寶石應被消耗');

  const helmetStats = ctx.computeStats();
  const physVal = ctx.gemStatValue('piercePhys', 10); // 1600%
  assert.equal(physVal, 1600);
  assert.equal(Math.round((helmetStats.pPen - baseStats.pPen) * 100) / 100, 1600, '頭盔鑲嵌物理穿透寶石應加成 1600% 物穿');

  // 取下頭盔寶石
  const unRes = ctx.unsocketGem(helmet, 0);
  assert.equal(unRes, true, '取下頭盔寶石應成功');
  assert.equal(ctx.gemCount('piercePhys', 10), 1, '取下後寶石應回到庫存');
  assert.equal(Math.round((ctx.computeStats().pPen - baseStats.pPen) * 100) / 100, 0, '取下後屬性加成應還原');
});

test('3. 拆解 (Dismantle) 穿透寶石流程', () => {
  const ctx = loadFullGameContext();
  ctx.executeGMCommand('gem piercePhys 10 1');
  assert.equal(ctx.gemCount('piercePhys', 10), 1);

  // 拆解 10 階穿透寶石（損失 30%）
  const expectedYield = ctx.gemDismantleYield(10);
  assert.equal(expectedYield, 13778, '10 階寶石拆解依 30% 損耗公式應獲得 13778 顆 1 階寶石');

  const res = ctx.dismantleGem('piercePhys', 10);
  assert.equal(res.n, expectedYield);
  assert.equal(ctx.gemCount('piercePhys', 10), 0, '原 10 階寶石應已消耗');
  assert.equal(ctx.gemCount('piercePhys', 1), expectedYield, '拆解後應獲得指定數量 1 階物理穿透寶石');
});

test('4. 合成 (Combine) 穿透寶石流程', () => {
  const ctx = loadFullGameContext();
  // 發放 3 顆 1 階物理穿透寶石
  ctx.addGem('piercePhys', 1, 3);
  assert.equal(ctx.gemCount('piercePhys', 1), 3);

  // 合成 1 顆 2 階
  const res1 = ctx.composeGems('piercePhys', 1);
  assert.equal(res1, null, '3 顆 1 階物理穿透寶石合成 2 階應成功');
  assert.equal(ctx.gemCount('piercePhys', 1), 0);
  assert.equal(ctx.gemCount('piercePhys', 2), 1);

  // 發放 3 顆 4 階魔法穿透寶石
  ctx.addGem('pierceMagic', 4, 3);
  const res2 = ctx.composeGems('pierceMagic', 4);
  assert.equal(res2, null, '3 顆 4 階魔法穿透寶石合成 5 階應成功');
  assert.equal(ctx.gemCount('pierceMagic', 4), 0);
  assert.equal(ctx.gemCount('pierceMagic', 5), 1);
});

test('5. 九宮格轉換 (Grid Transform) 穿透寶石流程', () => {
  const ctx = loadFullGameContext();
  ctx.addGem('ruby', 5, 2);
  assert.equal(ctx.gemCount('ruby', 5), 2);

  // 將 2 顆 5 階紅寶石放入轉換槽
  const convertSlots = [
    { type: 'ruby', lv: 5, n: 2 }
  ];

  // 轉換為 5 階物理穿透寶石
  const res = ctx.convertGems(convertSlots, 'piercePhys');
  assert.equal(res, null, '九宮格轉換為 piercePhys 應成功');
  assert.equal(ctx.gemCount('ruby', 5), 0, '原紅寶石應被消耗');
  assert.equal(ctx.gemCount('piercePhys', 5), 2, '應獲得 2 顆 5 階物理穿透寶石');
});

test('6. 融合 (Fusion) 穿透寶石流程與 fusedStatValue 5 階等值倍率運算', () => {
  const ctx = loadFullGameContext();
  // 準備 2 顆 5 階物理穿透寶石 & 1 顆 5 階紅寶石
  ctx.addGem('piercePhys', 5, 1);
  ctx.addGem('ruby', 5, 1);

  const ref1 = { kind: 'plain', type: 'piercePhys', lv: 5 };
  const ref2 = { kind: 'plain', type: 'ruby', lv: 5 };

  // 執行寶石融合
  let fuseRes = ctx.fuseGemsV2(ref1, ref2);
  // 如果隨機失敗，重複測試直到成功以驗證產出結構與 fusedStatValue 邏輯
  for (let i = 0; i < 50 && !fuseRes.result; i++) {
    ctx.addGem('piercePhys', 5, 1);
    ctx.addGem('ruby', 5, 1);
    fuseRes = ctx.fuseGemsV2(ref1, ref2);
  }

  assert.equal(fuseRes.err, undefined, '寶石融合不應報錯');
  assert.ok(fuseRes.result, '應包含融合結果');

  const fused = fuseRes.result;
  assert.equal(fused.level, 5);
  assert.ok(Array.isArray(fused.stats));
  assert.equal(fused.stats.length, 2);

  const physStat = fused.stats.find((s) => s.type === 'piercePhys');
  assert.ok(physStat, '融合寶石應包含 piercePhys 屬性');
  assert.ok(typeof physStat.mult === 'number', 'piercePhys 屬性應使用 5 階等值倍率 (mult)');

  // 驗證 fusedStatValue 計算：5 階 piercePhys 基礎值 = 50%
  const base5Val = ctx.gemStatValue('piercePhys', 5);
  assert.equal(base5Val, 50, '5 階物理穿透寶石基礎值應為 50%');

  const calculatedVal = ctx.fusedStatValue(physStat);
  const expectedVal = Math.round(base5Val * physStat.mult * 100) / 100;
  assert.equal(calculatedVal, expectedVal, 'fusedStatValue 應等於 50 * mult');

  // 測試將該融合寶石鑲嵌至裝備插槽
  const baseStats = ctx.computeStats();
  const chest = { slot: 'chest', rarity: 1, level: 1, upgrade: 0, affixes: [], sockets: [null], enchants: [] };
  ctx.G.equipment.chest = chest;

  const socketFusedRes = ctx.socketFusedGem(chest, fused.id);
  assert.equal(socketFusedRes, null, '鑲嵌融合寶石應成功');

  const socketedStats = ctx.computeStats();
  const pPenDiff = Math.round((socketedStats.pPen - baseStats.pPen) * 100) / 100;
  assert.equal(pPenDiff, calculatedVal, '裝備鑲嵌穿透融合寶石後，玩家物理穿透應增加 fusedStatValue 算出的數值');
});
