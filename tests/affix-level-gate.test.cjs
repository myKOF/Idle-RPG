'use strict';
/* 等級前不出現的屬性（AFFIX_LEVEL_GATES）：
   裝備掉落詞條隨機、洗煉（整件／單條）、詞條池提示、屬性面板列、參數表接線。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');

function loadGameContext() {
  const context = { console, UI: { dirty: {} } };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/item.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

const DEFAULT_GATED = [
  'elemDmgFire', 'elemDmgIce', 'elemDmgLightning', 'elemDmgPoison', 'elemDmgLight', 'elemDmgDark', 'elemDmgEarth', 'elemDmgWind',
  'resFire', 'resIce', 'resLightning', 'resPoison', 'resLight', 'resDark', 'resEarth', 'resWind', 'resAll'
];

// 每次 wpick 收到的候選詞條鍵（rollAffixes／rerollSingleAffix 都是先組池子再 wpick）
function capturePools(context) {
  const pools = [];
  // 每次挑池子裡的下一個鍵，免得 rollAffixes 一直抽到同一把而空轉到 guard 上限
  context.wpick = (pairs) => { pools.push(pairs.map(([key]) => key)); return pairs[(pools.length - 1) % pairs.length][0]; };
  return pools;
}

test('預設門檻：200 級（含）以前不出現屬性傷害提升、屬性抗性與全屬性抗性', () => {
  const context = loadGameContext();
  assert.deepEqual(Array.from(context.AFFIX_LEVEL_GATES, (g) => g.level), [200]);
  assert.deepEqual(Array.from(context.AFFIX_LEVEL_GATES[0].keys), DEFAULT_GATED);
  DEFAULT_GATED.forEach((key) => {
    assert.ok(context.AFFIX_POOL[key], key + ' 必須是詞條池存在的鍵');
    assert.equal(context.affixAvailableAtLevel(key, 1), false, key + ' @1');
    assert.equal(context.affixAvailableAtLevel(key, 200), false, key + ' @200（含）');
    assert.equal(context.affixAvailableAtLevel(key, 201), true, key + ' @201');
  });
  // 沒有門檻的詞條、沒給等級（呼叫端沒有裝備）都不擋
  assert.equal(context.affixAvailableAtLevel('hpFlat', 1), true);
  assert.equal(context.affixAvailableAtLevel('elemDmgFire', undefined), true);
  assert.equal(context.affixAvailableAtLevel('elemDmgFire', NaN), true);
});

test('裝備掉落：裝備等級 ≤ 門檻時，詞條池不含被擋的詞條；超過門檻才進池', () => {
  const context = loadGameContext();
  const pools = capturePools(context);
  // 神話品質＋飾品：minR 與部位都放行屬性傷害／抗性詞條
  context.rollAffixes(3, 6, 'ring', {}, undefined, 200);
  const at200 = pools.splice(0);
  context.rollAffixes(3, 6, 'ring', {}, undefined, 250);
  const at250 = pools.splice(0);
  assert.equal(at200.length, 3);
  assert.equal(at250.length, 3);
  at200.forEach((keys) => DEFAULT_GATED.forEach((k) => assert.equal(keys.includes(k), false, '200 級不該有 ' + k)));
  at250.forEach((keys) => DEFAULT_GATED.forEach((k) => assert.equal(keys.includes(k), true, '250 級應該有 ' + k)));
  assert.ok(at200[0].includes('hpFlat') || at200[0].includes('critRate'), '其餘詞條照常進池');
});

test('makeEquipment 以裝備等級過濾：200 級裝備洗不出被擋的詞條', () => {
  const context = loadGameContext();
  context.G = { player: { gold: 0, essence: 0 } };
  context.getStats = () => ({ luck: 0 });
  for (let i = 0; i < 300; i++) {
    const it = context.makeEquipment(200, { rarity: 6, level: 200, slot: 'ring' });
    it.affixes.forEach((a) => assert.equal(DEFAULT_GATED.includes(a.key), false, '200 級裝備不該出現 ' + a.key));
  }
  let seen = false;
  for (let i = 0; i < 600 && !seen; i++) {
    const it = context.makeEquipment(250, { rarity: 6, level: 250, slot: 'ring' });
    seen = it.affixes.some((a) => DEFAULT_GATED.includes(a.key));
  }
  assert.equal(seen, true, '250 級裝備應該有機會出現被擋的詞條');
});

test('洗煉：整件與單條都依裝備等級過濾', () => {
  const context = loadGameContext();
  context.G = { player: { gold: 999999999, essence: 99999, ancientEssence: 0 } };
  context.getStats = () => ({ luck: 0, affixCap: 0 });
  context.markStatsDirty = () => {};
  context.rollAncientAffixCount = () => 0;
  const it = context.makeEquipment(200, { rarity: 6, level: 200, slot: 'ring' });
  const pools = capturePools(context);

  assert.equal(context.rerollItemAffixes(it), null);
  assert.equal(context.rerollSingleAffix(it, it.affixes[0].key), null);
  assert.ok(pools.length >= 2);
  pools.forEach((keys) => DEFAULT_GATED.forEach((k) => assert.equal(keys.includes(k), false, '洗煉池含 ' + k)));

  it.level = 250;
  pools.length = 0;
  assert.equal(context.rerollSingleAffix(it, it.affixes[0].key), null);
  DEFAULT_GATED.forEach((k) => assert.equal(pools[0].includes(k), true, '250 級單條洗煉池缺 ' + k));
});

test('已在裝備上的詞條不受門檻影響：照常計入屬性', () => {
  const context = loadGameContext();
  const it = { level: 100, rarity: 6, slot: 'ring', affixes: [{ key: 'resFire', roll: context.STRENGTH_ROLL_MAX, ancient: false }] };
  assert.ok(context.affixValue(it, it.affixes[0]) > 0);
});

test('可自由改等級與屬性：換掉整張表、多組並存、同鍵取最高等級', () => {
  const context = loadGameContext();
  context.AFFIX_LEVEL_GATES = [
    { level: 100, keys: ['hit', 'hpFlat'] },
    { level: 300, keys: ['hit'] }
  ];
  assert.equal(context.affixGateLevel('hit'), 300);
  assert.equal(context.affixGateLevel('hpFlat'), 100);
  assert.equal(context.affixGateLevel('elemDmgFire'), 0);
  assert.equal(context.affixAvailableAtLevel('elemDmgFire', 1), true, '預設那組被換掉後不再擋');
  assert.equal(context.affixAvailableAtLevel('hit', 300), false);
  assert.equal(context.affixAvailableAtLevel('hit', 301), true);
  context.AFFIX_LEVEL_GATES = [];
  assert.equal(context.affixAvailableAtLevel('hit', 1), true, '空陣列＝全部放行');
});

test('詞條池提示（itemHeaderHTML）也不列出被擋的詞條', () => {
  const context = loadGameContext();
  context.G = { player: { gold: 0, essence: 0 }, settings: {} };
  context.getStats = () => ({ luck: 0 });
  const poolHtml = (level) => context.itemHeaderHTML({
    id: 1, kind: 'equip', slot: 'ring', rarity: 6, level, name: 'x', affixes: [], sockets: [], upgrade: 0
  });
  const low = poolHtml(200), high = poolHtml(250);
  assert.ok(high.includes('it-pool-item'), '詞條池提示的結構變了，這條測試要跟著改');
  assert.equal(low.includes(context.AFFIX_POOL.elemDmgFire.name), false);
  assert.equal(high.includes(context.AFFIX_POOL.elemDmgFire.name), true);
});

test('屬性面板列：只隱藏有門檻的那幾列，依角色等級切換', () => {
  const context = loadGameContext();
  const rows = [];
  context.STAT_GROUPS.forEach((g) => g.rows.forEach((r) => rows.push(r)));
  const find = (text) => {
    const row = rows.find((r) => String(r[0]).includes(text));
    assert.ok(row, '找不到面板列：' + text);
    return row;
  };
  // 面板目前有的屬性傷害提升與抗性列（風系目前沒有面板列）
  ['火屬性傷害提升', '冰屬性傷害提升', '雷屬性傷害提升', '毒屬性傷害提升', '聖屬性傷害提升', '暗屬性傷害提升', '地屬性傷害提升',
    '火焰抗性', '冰霜抗性', '雷電抗性', '劇毒抗性', '聖光抗性', '暗影抗性', '大地抗性'].forEach((text) => {
    const row = find(text);
    assert.equal(context.statPanelRowHiddenAtLevel(row, 1), true, text + ' @1');
    assert.equal(context.statPanelRowHiddenAtLevel(row, 200), true, text + ' @200');
    assert.equal(context.statPanelRowHiddenAtLevel(row, 201), false, text + ' @201');
  });
  // 沒有門檻的列（包含長得很像的「對火屬性敵人傷害」「物理抗性」）不受影響
  ['力量', '生命值', '對火屬性敵人傷害', '物理抗性', '魔法抗性', '控制抵抗'].forEach((text) => {
    assert.equal(context.statPanelRowHiddenAtLevel(find(text), 1), false, text + ' 不該被隱藏');
  });
  // 換掉門檻表後，面板列的快取要跟著失效
  context.AFFIX_LEVEL_GATES = [{ level: 50, keys: ['hit'] }];
  assert.equal(context.statPanelRowHiddenAtLevel(find('火焰抗性'), 1), false);
  assert.equal(context.statPanelRowHiddenAtLevel(find('命中率'), 50), true);
  assert.equal(context.statPanelRowHiddenAtLevel(find('命中率'), 51), false);
});

test('參數表：預設列存在，且 apply_params 能重建、能擋打錯的鍵', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'affix-gate-params-'));
  try {
    fs.mkdirSync(path.join(tmp, 'tools'));
    fs.cpSync(path.join(root, 'config/CSV'), path.join(tmp, 'config/CSV'), { recursive: true });
    fs.cpSync(path.join(root, 'js'), path.join(tmp, 'js'), { recursive: true });
    fs.copyFileSync(path.join(root, 'tools/apply_params.cjs'), path.join(tmp, 'tools/apply_params.cjs'));
    const csvPath = path.join(tmp, 'config/CSV/game_parameters.csv');
    const dataPath = path.join(tmp, 'js/data.js');
    const run = (...args) => execFileSync(process.execPath, ['tools/apply_params.cjs', ...args], { cwd: tmp, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

    const csv = fs.readFileSync(csvPath, 'utf8');
    const rowRe = /^(\d+,[^,]*,6-裝備,等級前不出現的屬性,.*)$/m;
    assert.match(csv, rowRe, '參數表缺少「6-裝備／等級前不出現的屬性」列');
    assert.match(run(), /將變更 0、錨點問題 0/, '預設列與 data.js 的預設值要一致');

    // 改成兩組：250 級擋一個、100 級擋另兩個
    const lines = csv.split('\r\n');
    const at = lines.findIndex((l) => l.includes(',6-裝備,等級前不出現的屬性,'));
    // 預設列尾端是 a~l：200,"{…逗號分隔…}",0×10（陣列格因含逗號而有引號）
    const tail = '250,{resFire},100,{hit;hpFlat},0,0,0,0,0,0,0,0';
    const replaced = lines[at].replace(/,200,"[^"]*",(?:0,){9}0$/, ',' + tail);
    assert.notEqual(replaced, lines[at], '預設列的 a~l 格式與預期不同');
    lines[at] = replaced;
    fs.writeFileSync(csvPath, lines.join('\r\n'));
    assert.match(run(), /將變更 1、/);
    run('--write');
    const data = fs.readFileSync(dataPath, 'utf8');
    assert.match(data, /\{ level: 250, keys: \['resFire'\] \}/);
    assert.match(data, /\{ level: 100, keys: \['hit', 'hpFlat'\] \}/);
    execFileSync(process.execPath, ['--check', dataPath]);
    assert.match(run(), /將變更 0、錨點問題 0/, '第二次套用不應再有變更');

    // 打錯詞條鍵：中止，且不改檔
    fs.writeFileSync(csvPath, lines.join('\r\n').replace('hpFlat', 'hpFlatt'));
    const before = fs.readFileSync(dataPath);
    assert.throws(() => run('--write'), /詞條池沒有的鍵：hpFlatt/);
    assert.deepEqual(fs.readFileSync(dataPath), before);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
