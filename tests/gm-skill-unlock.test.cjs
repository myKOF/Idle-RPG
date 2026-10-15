'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadContext(initialFloor) {
  const context = {
    console,
    Math: Object.create(Math),
    setTimeout() {}, clearTimeout() {},
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
    location: { hostname: 'localhost' },
    UI: { dirty: {} },
    blog() {}, floatText() {}, trackDps() {}, recordRunDamage() {}
  };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js',
    'js/combat.js', 'js/skills.js', 'js/skills2.js', 'js/talents.js', 'js/ui.js', 'js/gm_exec.js']
    .forEach((file) => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file }));
  context.G = {
    player: {
      gold: 1e9,
      level: 1,
      reincarnations: 0,
      skills2: { levels: {}, ult: {} },
      talents: { levels: {}, potentialLevels: {} },
      loadout: []
    },
    tower: { highest: initialFloor || 0, active: false },
    stage: { current: 1, zone: 'desert' }
  };
  return context;
}

test('skill_unlock：開關切換與別名、明確開關參數測試', () => {
  const c = loadContext(0);
  assert.equal(c.GM_TEST.skillUnlock, false);

  // 1. 執行一次：開啟
  const r1 = c.executeGMCommand('skill_unlock');
  assert.equal(r1.ok, true);
  assert.equal(r1.skillUnlock, true);
  assert.equal(c.GM_TEST.skillUnlock, true);
  assert.match(r1.message, /全技能限制已解鎖/);

  // 2. 再重複輸入一次：關閉恢復正常
  const r2 = c.executeGMCommand('skill_unlock');
  assert.equal(r2.ok, true);
  assert.equal(r2.skillUnlock, false);
  assert.equal(c.GM_TEST.skillUnlock, false);
  assert.match(r2.message, /已恢復技能正常限制條件/);

  // 3. 別名測試
  assert.equal(c.executeGMCommand('skillunlock').skillUnlock, true);
  assert.equal(c.executeGMCommand('skills_unlock').skillUnlock, false);
  assert.equal(c.executeGMCommand('skillsunlock').skillUnlock, true);

  // 4. 明確參數 on / off
  assert.equal(c.executeGMCommand('skill_unlock off').skillUnlock, false);
  assert.equal(c.executeGMCommand('skill_unlock on').skillUnlock, true);
  assert.equal(c.executeGMCommand('skill_unlock 0').skillUnlock, false);
  assert.equal(c.executeGMCommand('skill_unlock 1').skillUnlock, true);
});

test('skill_unlock 開啟時：1級角色可升級、裝配及使用高等級/高塔技能', () => {
  const c = loadContext(0); // 1級、0轉、封魔塔0層

  // 正常情況下：bloodrage（需要400級）鎖定
  const normalLvs = c.skills2Levels('bloodrage');
  assert.equal(normalLvs[0], 0, '未解鎖時第1階視為Lv.0');
  assert.equal(c.skills2Castable('bloodrage'), false, '未解鎖不可施放');
  assert.match(c.skills2Learn('bloodrage', 0), /需達到 400 級/);

  // 正常情況下：thrust 第 2 階學會後，第 3 階（需要50級）被等級門檻阻擋
  assert.equal(c.skills2Learn('thrust', 1), null); // 學會第 2 階
  assert.match(c.skills2Learn('thrust', 2), /需達到 50 級/);

  // 開啟 skill_unlock
  c.executeGMCommand('skill_unlock');
  assert.equal(c.GM_TEST.skillUnlock, true);

  // 1. bloodrage（需400級）立即解鎖並可施放、可裝載
  const unlockedLvs = c.skills2Levels('bloodrage');
  assert.equal(unlockedLvs[0], 1, 'skill_unlock 開啟後第1階預設開啟Lv.1');
  assert.equal(c.skills2Castable('bloodrage'), true, '可施放');
  assert.equal(c.equipSkillToLoadout('sg:bloodrage'), null, '可成功裝配進裝載欄');

  // 2. 學習等級限制解除：可升級 bloodrage 第 1 階
  assert.equal(c.skills2Learn('bloodrage', 0), null, '成功升級 bloodrage');
  assert.equal(c.skills2Levels('bloodrage')[0], 2);

  // 3. 學習 thrust 第 3 階（原需50級）：直接成功
  assert.equal(c.skills2Learn('thrust', 2), null, '無需達到50級即可升級');

  // 4. 超神進化（原需封魔塔30層）：無需通關封魔塔即可選擇
  // thrust 前7階練滿
  for (let t = 0; t < 7; t++) {
    c.G.player.skills2.levels.thrust[t] = 10;
  }
  assert.equal(c.skills2UltPick('thrust', 0), null, '封魔塔0層仍可選擇超神進化');
  assert.equal(c.skills2Ult('thrust').id, 'phantomOcta');

  // 5. 裝載欄滿槽解鎖
  assert.equal(c.loadoutSize(), c.LOADOUT_SIZE.max, '裝載欄解鎖上限6格');

  // 6. 潛力技能解鎖與升級（原需3轉）
  assert.equal(c.potentialUnlocked('velocityForce'), true);
  c.G.player.skillMastery = { level: 10, xp: 0 };
  c.G.player.reincarnationTalentPoints = 1;
  assert.equal(c.potentialUpgrade('velocityForce'), null, '0轉即可升級潛力技能');
});

test('skill_unlock 再次執行關閉時：恢復為正常限制條件', () => {
  const c = loadContext(0);
  c.executeGMCommand('skill_unlock'); // 開啟
  assert.equal(c.GM_TEST.skillUnlock, true);

  // 再次執行關閉
  c.executeGMCommand('skill_unlock');
  assert.equal(c.GM_TEST.skillUnlock, false);

  // 1. bloodrage（需400級）在1級角色身上重新鎖上（視為Lv.0）
  assert.equal(c.skills2Levels('bloodrage')[0], 0);
  assert.equal(c.skills2Castable('bloodrage'), false);
  assert.match(c.skills2Learn('bloodrage', 0), /需達到 400 級/);

  // 2. 超神進化門檻恢復（等級足夠且前7階全滿但塔層未達時，阻擋並提示封魔塔層數）
  c.G.player.level = 1000;
  c.G.player.skills2.levels.cleave = Array(7).fill(10);
  assert.match(c.skills2UltPick('cleave', 0), /需達到.*封魔塔/);

  // 3. 裝載欄恢復1級容量
  c.G.player.level = 1;
  assert.equal(c.loadoutSize(), 4);

  // 潛力無轉生解鎖限制，仍需支付威能點。
  c.G.player.reincarnationTalentPoints = 1;
  assert.equal(c.potentialUpgrade('velocityForce'), null, '潛力無轉生解鎖限制，仍需支付威能點');
});
