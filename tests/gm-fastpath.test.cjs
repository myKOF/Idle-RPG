'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

test('護手部位洗出命中率使用hit且不捏造數值，支援同類說法與明確數值', () => {
  const ai = loadAiKeyContext();
  for (const text of ['把護手部位洗出命中率屬性', '請幫我把護手部位洗出命中率屬性',
    '護手洗出命中率', '將手套的部位洗成命中詞條', '把護手洗為命中率屬性']) {
    assert.deepEqual(Array.from(ai.parseFastPath(text)), ['modequip gloves hit'], text);
  }
  assert.deepEqual(Array.from(ai.parseFastPath('把護手部位命中率設為50%')), ['modequip gloves hit 50']);
  assert.deepEqual(Array.from(ai.parseFastPath('把護手部位洗出攻速屬性')), ['modequip gloves aspd']);
  for (const text of ['不要把護手部位洗出命中率屬性', '把護手部位洗出命中率屬性嗎？',
    '把護手部位洗出命中率屬性但不要改任何原詞條', '把護手部位洗出未知屬性',
    '把護手部位洗出命中率50%屬性', '把護手部位洗出太古命中率屬性',
    '把護手部位洗出命中率屬性且強化100']) {
    assert.equal(ai.parseFastPath(text), null, text);
  }
});

test('混沌戒指來源詞條替換使用品質條件，不猜左右或詞條序號', () => {
  const ai = loadAiKeyContext();
  for (const prompt of ['將我身上的混沌戒指的物理攻擊的太古詞條洗成冷卻縮減',
    '請把身上的混沌戒指物理攻擊太古詞條改成冷卻縮減']) {
    assert.deepEqual(Array.from(ai.parseFastPath(prompt)), ['modequip worn:ring:chaos replace 物理攻擊 cdr ancient']);
  }
  for (const prompt of ['不要將我身上的混沌戒指的物理攻擊的太古詞條洗成冷卻縮減',
    '將我身上的混沌戒指的物理攻擊的太古詞條洗成冷卻縮減但其他太古也改掉']) {
    assert.equal(ai.parseFastPath(prompt), null);
  }
  assert.throws(() => ai.applyAffixOverflowPolicy(['modequip ring cdr ancient'], '將我身上的混沌戒指的物理攻擊的太古詞條洗成冷卻縮減'), /拒絕/);
  assert.throws(() => ai.applyAffixOverflowPolicy(['modequip worn:ring:chaos 4 cdr ancient'], '將我身上的混沌戒指的物理攻擊的太古詞條洗成冷卻縮減'), /拒絕/);
  assert.deepEqual(Array.from(ai.parseFastPath('將身上的混沌戒指的物理攻擊百分比太古詞條洗成冷卻縮減')),
    ['modequip worn:ring:chaos replace atkPct cdr ancient']);
});

function loadAiKeyContext() {
  const context = {
    console,
    Math,
    parseInt,
    parseFloat,
    location: { hostname: 'localhost' },
    localStorage: {
      _data: {},
      getItem(k) { return this._data[k] || null; },
      setItem(k, v) { this._data[k] = String(v); },
      removeItem(k) { delete this._data[k]; }
    }
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);

  const fileContent = fs.readFileSync(path.join(root, 'js/ai-key-setting.js'), 'utf8');
  vm.runInContext(fileContent, context, { filename: 'js/ai-key-setting.js' });
  return context.AiKeySetting;
}

test('FastPath 本地直譯：複合指令（加全身強化+50神話4太古裝備、加金幣1000億）', () => {
  const ai = loadAiKeyContext();
  const cmds = ai.parseFastPath('加全身強化+50神話4太古裝備、加金幣1000億');
  assert.ok(Array.isArray(cmds));
  assert.equal(cmds.length, 2);
  assert.equal(cmds[0], 'equipset mythic 500 50 4 wear');
  assert.equal(cmds[1], 'gold 100000000000');
});

test('FastPath 本地直譯：身上的裝備改成全太古 / 全身+50', () => {
  const ai = loadAiKeyContext();
  const c1 = ai.parseFastPath('把身上的裝備改成全太古');
  assert.deepEqual(Array.from(c1), ['modequip wear ancient all']);

  const c2 = ai.parseFastPath('全身太古');
  assert.deepEqual(Array.from(c2), ['modequip wear ancient all']);

  const c3 = ai.parseFastPath('全身強化+50');
  assert.deepEqual(Array.from(c3), ['modequip wear +50']);

  const c4 = ai.parseFastPath('全身+100');
  assert.deepEqual(Array.from(c4), ['modequip wear +100']);
});

test('FastPath 本地直譯：材料與貨幣（金幣、碎片、精華、魔塵）', () => {
  const ai = loadAiKeyContext();
  assert.deepEqual(Array.from(ai.parseFastPath('加金幣100萬')), ['gold 1000000']);
  assert.deepEqual(Array.from(ai.parseFastPath('加裝備碎片1000億')), ['scrap 100000000000']);
  assert.deepEqual(Array.from(ai.parseFastPath('加附魔精華5000')), ['essence 5000']);
  assert.deepEqual(Array.from(ai.parseFastPath('加魔塵20000')), ['dust 20000']);
});

test('FastPath 本地直譯：常用功能（技能滿級、鑲滿寶石、等級、背包、無敵）', () => {
  const ai = loadAiKeyContext();
  assert.deepEqual(Array.from(ai.parseFastPath('全技能滿級')), ['skillmax all']);
  assert.deepEqual(Array.from(ai.parseFastPath('技能全部解鎖')), ['skill_unlock on']);
  assert.deepEqual(Array.from(ai.parseFastPath('全身鑲滿10級寶石')), ['socketall 10']);
  assert.deepEqual(Array.from(ai.parseFastPath('等級設為1000')), ['level 1000']);
  assert.deepEqual(Array.from(ai.parseFastPath('背包容量擴充到2000')), ['bag 2000']);
  assert.deepEqual(Array.from(ai.parseFastPath('開啟無敵')), ['god 1']);
  assert.deepEqual(Array.from(ai.parseFastPath('跳關到亡靈山脈240關')), ['stage 亡靈山脈 240']);
});

test('FastPath 本地直譯：無法規則解析時回傳 null 回退給 Gemini API', () => {
  const ai = loadAiKeyContext();
  const unknown = ai.parseFastPath('把項鍊加上吸血、吸魔、寶石鑲嵌效率100且為太古');
  assert.equal(unknown, null);
});

test('白話通關與跳關分流，完整辨識設定句；否定／疑問／額外需求不部分執行', () => {
  const ai = loadAiKeyContext();
  for (const text of ['亡靈山脈400關改為已通關狀態', '請幫我將亡靈山脈第400關設為已通關',
    '把亡靈山脈400關標記為通關', '調整亡靈山脈400關為已通關狀態', '亡靈山脈通關到400關']) {
    assert.deepEqual(Array.from(ai.parseFastPath(text)), ['stage_clear 亡靈山脈 400'], text);
  }
  assert.deepEqual(Array.from(ai.parseFastPath('亡靈山脈400關設為已通關，然後加金幣10')), ['stage_clear 亡靈山脈 400', 'gold 10']);
  assert.deepEqual(Array.from(ai.parseFastPath('跳關到亡靈山脈400關')), ['stage 亡靈山脈 400']);
  for (const text of ['不要把亡靈山脈400關設為已通關', '亡靈山脈400關設為未通關',
    '亡靈山脈400關設為已通關嗎？', '亡靈山脈400關設為已通關但不要動前面場景']) {
    assert.equal(ai.parseFastPath(text), null, text);
  }
});

test('常用白話：語助詞、數量後綴、數字在資源前後與中文單位', () => {
  const ai = loadAiKeyContext();
  const cases = [
    ['請幫我加金幣1000億個', ['gold 100000000000']],
    ['麻煩幫我給我1.5萬金幣，謝謝', ['gold 15000']],
    ['幫我給我1.5萬個金幣', ['gold 15000']],
    ['加附魔精華2兆份', ['essence 2000000000000']],
    ['請扣除金幣2.5萬枚', ['gold -25000']],
    ['幫我減少裝備碎片300個', ['scrap -300']],
    ['請加技能點數100點', ['skill_point 100']],
    ['幫我加所有寶石100顆', ['gem all 100']],
    ['請給我所有符文10個', ['rune all 10']],
    ['請幫我全身鑲滿10級寶石', ['socketall 10']],
    ['幫我等級設為1000', ['level 1000']],
    ['請幫我背包容量擴充到2000', ['bag 2000']]
  ];
  for (const [prompt, expected] of cases) {
    const actual = ai.parseFastPath(prompt);
    assert.deepEqual(actual && Array.from(actual), expected, prompt);
  }
});

test('常用白話：多資源共用數量及完整複合句不呼叫雲端', () => {
  const ai = loadAiKeyContext();
  assert.deepEqual(Array.from(ai.parseFastPath('幫我把全身裝備強化+50，然後加金幣1000億個，而且給我所有符文10顆')),
    ['modequip wear +50', 'gold 100000000000', 'rune all 10']);
  assert.deepEqual(Array.from(ai.parseFastPath('金幣、裝備碎片、附魔精華各加1000億個')),
    ['gold 100000000000', 'scrap 100000000000', 'essence 100000000000']);
  assert.deepEqual(Array.from(ai.parseFastPath('請加金幣和魔塵各100萬')),
    ['gold 1000000', 'dust 1000000']);
});

test('常用白話：裝備修改保留目標、小數與太古語意', () => {
  const ai = loadAiKeyContext();
  for (const [prompt, command] of [
    ['幫我把項鍊吸血改成12.5%', 'modequip amulet lifesteal 12.5'],
    ['請把主手武器物攻改成5萬且為太古', 'modequip weapon atkFlat 50000 ancient'],
    ['把選中的裝備寶石鑲嵌效率設為100', 'modequip sel gemEff 100'],
    ['請全身裝備強化到+100', 'modequip wear +100'],
    ['把項鍊改成全太古', 'modequip amulet ancient all'],
    ['把全身裝備改成非太古', 'modequip wear ancient none'],
    ['當前裝備太古', 'modequip wear ancient all'],
    ['全身換500級神鑄混沌裝備', 'equipset chaosGodforged 500 0 0 wear'],
    ['請加全身強化+50的神話4太古裝備', 'equipset mythic 500 50 4 wear']
  ]) assert.deepEqual(Array.from(ai.parseFastPath(prompt)), [command], prompt);
});

test('未完整理解時整句回退，不吞條件、不發錯全套、不部分執行', () => {
  const ai = loadAiKeyContext();
  for (const prompt of [
    '加金幣1000億，幫我調整掉寶規則',
    '加全身神話裝備但不要換掉武器',
    '把項鍊改成神話裝備',
    '把項鍊物攻改成100%',
    '給我一件神話裝備',
    '加全身100級200級神話裝備',
    '扣除金幣-100',
    '加金幣100但是不要真的加',
    '把項鍊加上吸血、吸魔、寶石鑲嵌效率100且為太古'
  ]) assert.equal(ai.parseFastPath(prompt), null, prompt);
});
