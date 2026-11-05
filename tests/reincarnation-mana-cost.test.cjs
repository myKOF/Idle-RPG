'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function load() {
  const c = vm.createContext({ console, Math });
  for (const file of ['util', 'strings_data', 'strings', 'data', 'formula', 'skills2']) {
    vm.runInContext(read('js/' + file + '.js'), c);
  }
  c.G = { player: { level: 1, reincarnations: 0,
    skills2: { levels: { thrust: [1, 0, 0, 0, 0, 0, 0] }, ult: {} } } };
  // 固定測試表定消耗；不依賴使用者持續調整中的技能平衡值。
  c.SKILLS2.thrust.tiers[0].cost = 20;
  return c;
}

test('0轉維持原耗魔，各轉數與法力使用相同總倍率，讀舊檔即生效', () => {
  const c = load();
  const expected = [20, 30, 50, 70, 100, 140, 180, 220, 300, 380, 500,
    1200, 2000, 3000, 4000, 6000, 9000, 13000, 16000, 24000, 50000];
  for (let reinc = 0; reinc <= c.REINCARNATION_MAX; reinc++) {
    c.G.player.reincarnations = reinc;
    assert.equal(c.skills2ManaCost('thrust'), expected[reinc]);
    assert.equal(c.skills2ManaCost('thrust') / 20, c.reincarnationTotalMultiplier());
  }
  c.G.player.reincarnations = 0;
  assert.equal(c.skills2ManaCost('thrust'), 20, '換回0轉存檔不保留先前倍率');
});

test('各群組普通階、終極及反擊追加共用快照倍率，免費表格仍為0', () => {
  const c = load(), prog = { level: 999999, reinc: 2, towerHighest: 999999 };
  delete c.G; // 主執行緒完全沒有模擬狀態，不能偷偷依賴 G。
  for (const [gid, group] of Object.entries(c.SKILLS2)) {
    for (let i = 0; i < group.tiers.length; i++) {
      const levels = group.tiers.map((_, j) => j <= i ? 1 : 0);
      const expected = (group.tiers[i].cost || 0) * 2.5;
      assert.equal(c.skills2TierManaCost(gid, i, null, prog), expected);
      if (!c.skills2IsPassive(gid)) assert.equal(c.skills2ManaCost(gid, levels, {}, prog), expected);
      else if (gid === 'counter') {
        assert.equal(c.skills2TierTriggerMp(gid, i, prog), expected);
        assert.equal(c.skills2PassiveMinMp(gid, levels, {}, prog), expected);
      }
    }
    for (const [pick, ult] of (group.ult || []).entries()) {
      const raw = { [gid]: { pick, lv: 1 } }, levels = group.tiers.map(() => 10);
      const expected = (ult.cost || 0) * 2.5;
      assert.equal(c.skills2TierManaCost(gid, 0, ult.id, prog), expected);
      const cost = gid === 'counter' ? c.skills2PassiveMinMp(gid, levels, raw, prog)
        : c.skills2ManaCost(gid, levels, raw, prog);
      assert.equal(cost, c.skills2IsPassive(gid) && gid !== 'counter' ? 0 : expected);
    }
  }
  c.SKILLS2.thrust.tiers[0].cost = 0;
  assert.equal(c.skills2ManaCost('thrust', [1], {}, prog), 0);
});

test('GM解鎖不影響真實轉生耗魔，快照優先於模擬狀態', () => {
  const c = load();
  c.G.player.reincarnations = 10;
  c.GM_TEST = { skillUnlock: true };
  assert.equal(c.skills2ManaCost('thrust', [1], {}, { reinc: 1, skillUnlock: true }), 30);
  assert.equal(c.skills2ManaCost('thrust', [1], {}, { reinc: 0, skillUnlock: true }), 20);
  assert.equal(c.skills2ManaCost('thrust'), 500);
  c.skills2PointView = () => ({});
  const snapshot = c.skills2PanelView();
  assert.equal(snapshot.progress.reinc, 10);
  assert.equal(snapshot.progress.skillUnlock, true);
  assert.equal(c.skills2ManaCost('thrust', snapshot.levels.thrust, snapshot.ult, snapshot.progress), 500);
});

function prepareCast(c) {
  c.skills2Castable = () => true;
  c.getStats = () => ({});
  c.skills2CanReach = () => true;
  c.sgCastThrust = () => {};
  c.skills2Cooldown = () => 8;
  c.sgArmUltRepeat = () => {};
}

test('實際施放／自動排程擋住不足法力，足額依轉生與符文乘區扣魔', () => {
  const c = load(); prepareCast(c);
  c.G.player.reincarnations = 1;
  c.rwManaCostFactor = () => 1.2;
  const enemy = { hp: 100 }, p = { hp: 100, mp: 35 };
  assert.equal(c.castSkill2(p, [enemy], 'thrust', ''), null);
  assert.equal(p.mp, 35);
  assert.equal(p.skillCds, undefined);
  c.G.player.loadout = ['sg:thrust'];
  const skills = read('js/skills.js');
  vm.runInContext(skills.slice(skills.indexOf('function pickAndCastSkill('), skills.indexOf('function tickSkillCds(')), c);
  c.skillCastInProgress = () => false; c.ensureSkillReadyOrder = () => {};
  let jobs = 0; c.beginSkillCast = () => { jobs++; return { casting: true }; };
  p._skillReadyQueue = ['sg:thrust']; p._skillReadyQueued = { 'sg:thrust': true };
  assert.equal(c.pickAndCastSkill(p, [enemy], ''), null);
  assert.equal(jobs, 0);
  p.mp = 36;
  assert.ok(c.pickAndCastSkill(p, [enemy], '')); assert.equal(jobs, 1);
  assert.ok(c.castSkill2(p, [enemy], 'thrust', '')); assert.equal(p.mp, 0);
  assert.equal(p.skillCds['sg:thrust'], 8);
  for (const opts of [{ repeat: true }, { storm: true }]) {
    const free = { hp: 100, mp: 0 };
    assert.ok(c.castSkill2(free, [enemy], 'thrust', '', opts));
    assert.equal(free.mp, 0); assert.equal(free.skillCds, undefined);
  }
  c.gmMpLockActive = () => true;
  assert.ok(c.castSkill2(p, [enemy], 'thrust', '')); assert.equal(p.mp, 0);
});

test('自動施放與反擊本體／追加實際扣除增幅後消耗，GM鎖魔不扣', () => {
  const c = load();
  c.G.player.reincarnations = 2;
  c.rwManaCostFactor = () => 1.2;
  const p = { mp: 59 };
  assert.equal(c.sgAutoCastCanPay(p, 'thrust'), false);
  p.mp = 60; assert.equal(c.sgAutoCastCanPay(p, 'thrust'), true);
  c.sgAutoCastPay(p, 'thrust'); assert.equal(p.mp, 0);
  c.G.player.skills2.levels.counter = [1, 0, 0, 0, 0, 0, 0];
  c.SKILLS2.counter.tiers[0].cost = 20; c.SKILLS2.counter.tiers[5].cost = 40;
  p.mp = 49; assert.equal(c.sgCounterPayMp(p), false); assert.equal(p.mp, 49);
  p.mp = 150; assert.equal(c.sgCounterPayMp(p), true); assert.equal(p.mp, 100);
  assert.equal(c.sgCounterPayMp(p, 5), true); assert.equal(p.mp, 0);
  c.gmMpLockActive = () => true;
  assert.equal(c.sgCounterPayMp(p, 5), true); c.sgAutoCastPay(p, 'thrust'); assert.equal(p.mp, 0);
});

test('技能標頭／反擊完整提示使用UI快照耗魔，轉生確認只加指定短句', () => {
  const c = load(); delete c.G;
  const ui = read('js/ui.js');
  for (const [from, to] of [
    ['function sgUiUnlockProgress(', 'function sgUiTotalLevel('],
    ['function sgbMetaText(', '/* 未解鎖階段']
  ]) vm.runInContext(ui.slice(ui.indexOf(from), ui.indexOf(to, ui.indexOf(from))), c);
  const snapshot = { skills2: { levels: { thrust: [1], counter: [1] }, ult: {},
    progress: { level: 1, reinc: 1, skillUnlock: true } } };
  assert.match(c.sgbMetaText('thrust', 0, snapshot), /30 MP/);
  c.SKILLS2.counter.tiers[0].cost = 20;
  assert.match(c.sgbMetaText('counter', 0, snapshot), /30/);
  assert.match(c.describeSkill2Group('counter', [1], {}, snapshot.skills2.progress), /🔵30 MP/);
  const text = c.STR(2146, '轉生', 50, '轉生', 1, 2, 1, 2, 1, 2, 1, 2);
  assert.equal(text.split('技能法力消耗增加').length - 1, 1);
  assert.match(text, /・技能法力消耗增加・<br>/);
  assert.doesNotMatch(text, /技能法力消耗增加[^<・]*(?:%|倍|\d)/);
});

test('真Worker轉生指令與讀檔：法力及技能耗魔同比改變，skills面板同步真實轉數', () => {
  const { createEngine } = require('../scripts/sim/engine.js');
  const e = createEngine({ seed: 20261105 }).boot(null), c = e.ctx, p = e.state().player;
  const cost0 = c.skills2ManaCost('knife'), mp0 = c.getStats().mp;
  p.level = c.REINCARNATION_LEVEL;
  assert.equal(e.cmd('player.reincarnate').ok, true);
  assert.equal(p.reincarnations, 1); assert.equal(p.level, 1);
  assert.equal(c.getStats().mp, Math.round(mp0 * 1.5));
  assert.equal(c.skills2ManaCost('knife'), cost0 * 1.5);
  assert.equal(e.panel('skills').skills2.progress.reinc, 1);
  const restored = createEngine({ seed: 20261105 }).boot(JSON.parse(e.saveJson()));
  assert.equal(restored.ctx.skills2ManaCost('knife'), cost0 * 1.5);
  assert.equal(restored.panel('skills').skills2.progress.reinc, 1);
});
