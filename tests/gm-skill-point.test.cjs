'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadContext(hostname = 'localhost') {
  const context = {
    console,
    Math: Object.create(Math),
    setTimeout() {}, clearTimeout() {},
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
    location: { hostname: hostname },
    UI: { dirty: {} },
    blog() {}, floatText() {}, trackDps() {}, recordRunDamage() {},
    markStatsDirty() {}
  };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/strings_data.js', 'js/strings.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js',
    'js/combat.js', 'js/skills.js', 'js/skills2.js', 'js/talents.js', 'js/ui.js', 'js/gm_exec.js', 'js/ai-key-setting.js']
    .forEach((file) => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file }));
  context.G = {
    player: {
      skillMastery: { level: 0, xp: 0 },
      gold: 1e9,
      level: 100,
      reincarnations: 0,
      skills2: { levels: {}, ult: {} },
      talents: { levels: {} },
      loadout: []
    },
    tower: { highest: 100, active: false },
    stage: { current: 1, zone: 'desert' }
  };
  return context;
}

test('skill_point：指令格式與參數校驗', () => {
  const c = loadContext();
  const rEmpty = c.executeGMCommand('skill_point');
  assert.equal(rEmpty.ok, false);
  assert.match(rEmpty.message, /格式：skill_point 數量/);

  const rInvalid = c.executeGMCommand('skill_point abc');
  assert.equal(rInvalid.ok, false);
  assert.match(rInvalid.message, /格式：skill_point 數量/);
});

test('skill_point：增加技能點、各別名與正負扣除', () => {
  const c = loadContext();
  assert.equal(c.skills2PointView().available, 0);

  // 1. 基本指令增加 100 點
  const r1 = c.executeGMCommand('skill_point 100');
  assert.equal(r1.ok, true);
  assert.match(r1.message, /增加技能點 x100/);
  assert.equal(c.skills2PointView().available, 100);
  assert.equal(c.skills2PointView().total, 100);

  // 2. 別名測試：skillpoint、skillpoints、skill_points、sp
  assert.equal(c.executeGMCommand('skillpoint 50').ok, true);
  assert.equal(c.skills2PointView().available, 150);

  assert.equal(c.executeGMCommand('skillpoints 20').ok, true);
  assert.equal(c.skills2PointView().available, 170);

  assert.equal(c.executeGMCommand('skill_points 10').ok, true);
  assert.equal(c.skills2PointView().available, 180);

  assert.equal(c.executeGMCommand('sp 20').ok, true);
  assert.equal(c.skills2PointView().available, 200);

  // 3. 負數扣除
  const rSub = c.executeGMCommand('skill_point -50');
  assert.equal(rSub.ok, true);
  assert.match(rSub.message, /扣除技能點 x50/);
  assert.equal(c.skills2PointView().available, 150);

  // 4. 超額扣除下限為 0
  const rSubOver = c.executeGMCommand('skill_point -999');
  assert.equal(rSubOver.ok, true);
  assert.equal(c.skills2PointView().available, 0);
  assert.equal(c.G.player.skills2.legacyPointCredit, 0);
});

test('skill_point：點數與技能升級/降級/重選交互運作', () => {
  const c = loadContext();
  assert.equal(c.skills2PointView().available, 0);

  // 點數不足時無法升級第 2 階
  const failLearn = c.skills2Learn('thrust', 0);
  assert.match(failLearn, /技能點不足/);

  // 透過 GM 指令增加 5 點
  c.executeGMCommand('skill_point 5');
  assert.equal(c.skills2PointView().available, 5);

  // 升級 1 級
  const okLearn = c.skills2Learn('thrust', 0);
  assert.equal(okLearn, null);
  assert.equal(c.skills2Levels('thrust')[0], 2);
  assert.equal(c.skills2PointView().available, 4);
  assert.equal(c.skills2PointView().spent, 1);

  // 降級 1 級返還 1 點
  const okDown = c.skills2Downgrade('thrust', 0);
  assert.equal(okDown, null);
  assert.equal(c.skills2Levels('thrust')[0], 1);
  assert.equal(c.skills2PointView().available, 5);
  assert.equal(c.skills2PointView().spent, 0);
});

test('skill_point：非本機安全防護', () => {
  const c = loadContext('play.mygame.com');
  const res = c.executeGMCommand('skill_point 100');
  assert.equal(res.ok, false);
  assert.match(res.message, /僅能在本機開發環境/);
});

test('skill_point：AI 自然語言快徑解析', () => {
  const c = loadContext();
  assert.deepEqual(Array.from(c.AiKeySetting.parseFastPath('加技能點 100')), ['skill_point 100']);
  assert.deepEqual(Array.from(c.AiKeySetting.parseFastPath('技能點 50')), ['skill_point 50']);
  assert.deepEqual(Array.from(c.AiKeySetting.parseFastPath('增加技能點數 200點')), ['skill_point 200']);
  assert.deepEqual(Array.from(c.AiKeySetting.parseFastPath('扣除技能點 30')), ['skill_point -30']);
  assert.deepEqual(Array.from(c.AiKeySetting.parseFastPath('減少技能點數 10點')), ['skill_point -10']);
});
