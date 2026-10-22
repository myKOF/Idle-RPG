'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

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
