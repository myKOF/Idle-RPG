'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createEngine } = require('../scripts/sim/engine.js');
const source = fs.readFileSync('js/ui.js', 'utf8');
const tick = () => new Promise(setImmediate);

function mount() {
  const engine = createEngine({ seed: 37 }); engine.boot(null);
  const c = engine.ctx, floats = [], failures = [];
  c.document = { hidden: false, addEventListener() {}, getElementById() { return null; } };
  vm.runInContext(source, c, { filename: 'js/ui.js' });
  c.window = c; c.UI.tab = 'newforge';
  c.UiCanvas = { rect: button => button.rect };
  c.hideTooltip = () => {};
  c.showFloatingText = (button, text, color, point) => {
    const el = { button, text, color, point, style: {} }; floats.push(el); return el;
  };
  c.reportUiCommandFailure = (_label, error) => failures.push(error);
  c.isUiCommandPending = () => false;
  c.nodePendingKey = key => key;
  c.blog = () => {};
  c.renderTalents = () => {};
  c.uiSkillsPanelSnapshot = () => engine.panel('skills');
  c.sendUiCommand = (name, args) => Promise.resolve(engine.cmd(name, args).result);
  const panel = { isConnected: true, getClientRects: () => [{}] };
  function button(attrs = {}) {
    return {
      attrs, disabled: false, rect: { left: 20, top: 80, width: 100, height: 30 },
      getClientRects: () => [{}], getAttribute: key => attrs[key],
      closest(selector) { return selector.startsWith('.tab') ? panel : (attrs[selector.slice(1, -1)] !== undefined ? this : null); }
    };
  }
  return { engine, c, floats, failures, panel, button };
}
function listener(c, start, end) {
  const from = source.indexOf(start); assert.ok(from >= 0, start);
  const fragment = source.slice(from + start.length, source.indexOf(end, from));
  return vm.runInContext('(function () {' + fragment + '\n})', c);
}

test('成功判斷遵循正式指令回覆；錯誤、未回覆與非升級操作不顯示成功', () => {
  const { c } = mount();
  for (const command of ['chest.upgrade', 'gem.shopUpgrade', 'newforge.upgradePart', 'gem.resonanceUpgrade',
    'relic.upgrade', 'talent.upgrade', 'talent.max', 'skill2.learn', 'skill2.ultPick', 'newforge.unlockPartSlot']) {
    assert.equal(c.isSuccessfulUpgradeResult(command, null), true, command);
    assert.equal(c.isSuccessfulUpgradeResult(command, { result: null }), true, command);
    for (const result of [undefined, false, '金幣不足', { err: '滿級' }, { ok: false, result: null }]) {
      assert.equal(c.isSuccessfulUpgradeResult(command, result), false, command);
    }
  }
  assert.equal(c.isSuccessfulUpgradeResult('item.upgrade', 'ok'), true);
  for (const result of ['fail', 'poor', null]) assert.equal(c.isSuccessfulUpgradeResult('item.upgrade', result), false);
  assert.equal(c.isSuccessfulUpgradeResult('skill2.max', true), true);
  assert.equal(c.isSuccessfulUpgradeResult('skill2.max', null), false);
  assert.equal(c.isSuccessfulUpgradeResult('player.buyInvUpgrade', { cap: 50, cost: 10000 }), true);
  assert.equal(c.isSuccessfulUpgradeResult('player.buyInvUpgrade', { cap: 0, cost: 10000 }), false);
  for (const command of ['chest.open', 'gem.compose', 'talent.downgrade', 'skill2.delete', 'skill2.ultSwitch']) {
    assert.equal(c.isSuccessfulUpgradeResult(command, null), false);
  }
});

test('等待正式成功才出現一次，重繪移除按鈕仍使用點擊時的位置，且在遺物演出上層', () => {
  const { c, floats, button } = mount(), target = button();
  const accepted = c.makeUpgradeSuccessFeedback(target, 'chest.upgrade');
  assert.equal(floats.length, 0);
  target.rect = { left: 0, top: 0, width: 0, height: 0 }; target.getClientRects = () => [];
  accepted(null); accepted(null);
  assert.equal(floats.length, 1); assert.equal(floats[0].text, '升級成功');
  assert.equal(floats[0].point.x, 70); assert.equal(floats[0].point.y, 80);
  assert.ok(Number(floats[0].style.zIndex) > 15000);
});

test('回覆晚到且切頁、隱藏或面板已關閉時不在其他畫面飄字', () => {
  for (const hide of [f => { f.c.UI.tab = 'tower'; }, f => { f.c.document.hidden = true; },
    f => { f.panel.isConnected = false; }, f => { f.panel.getClientRects = () => []; },
    f => { f.c.GameClock = { isPaused: () => true }; }]) {
    const f = mount(), accepted = f.c.makeUpgradeSuccessFeedback(f.button(), 'newforge.upgradePart');
    hide(f); accepted(null); assert.equal(f.floats.length, 0);
  }
});

test('寶箱實際升級按鈕等到Worker扣款與升級後才浮字，缺金不顯示成功', async () => {
  const { c, engine, button, floats } = mount();
  vm.runInContext(fs.readFileSync('js/ui-chest.js', 'utf8'), c);
  const id = c.CHESTS[0].id, target = button({ 'data-chest-upgrade': String(id) });
  let click, finish;
  c.chestUiBind({ addEventListener: (_name, handler) => { click = handler; } });
  c.G.player.gold = 1e12;
  c.sendUiCommand = (name, args) => new Promise(resolve => { finish = () => resolve(engine.cmd(name, args).result); });
  const before = c.chestState(id).lv;
  click({ target }); assert.equal(floats.length, 0); assert.equal(c.chestState(id).lv, before);
  finish(); await tick(); assert.equal(c.chestState(id).lv, before + 1); assert.equal(floats.length, 1);
  c.G.player.gold = 0; click({ target }); finish(); await tick();
  assert.equal(c.chestState(id).lv, before + 1); assert.equal(floats.length, 1);
});

test('零件工坊實際點擊路徑成功浮字，滿級或缺金不顯示成功', async () => {
  const { c, button, floats } = mount();
  const from = source.indexOf("    var upgrade = e.target && e.target.closest ? e.target.closest('[data-nf-partupgrade]')");
  const handler = vm.runInContext('(function(e){' + source.slice(from, source.indexOf('    // 零件裝配晶片', from)) + '})', c);
  const target = button({ 'data-nf-partupgrade': 'scrapForge' }); c.G.player.gold = 1e12;
  handler({ target }); await tick(); assert.equal(c.G.factory.partLevels.scrapForge, 2); assert.equal(floats.length, 1);
  c.G.player.gold = 0; handler({ target }); await tick(); assert.equal(floats.length, 1);
  c.G.player.gold = 1e12; c.G.factory.partLevels.scrapForge = c.PART_MAX_TIER;
  handler({ target }); await tick(); assert.equal(floats.length, 1);
});

test('饋贈只使用成功回呼；商人不在場或傳輸失敗不會把空結果誤判成成功', async () => {
  const { c, button, floats } = mount();
  const click = listener(c, "upgradeBtn.addEventListener('click', function () {", '\n      });');
  const target = button(); c.G.player.gold = 1e12;
  c.addMerchantInvitations(1); assert.equal(c.openMysteryMerchant(), null);
  const before = c.G.player.gemShop.level;
  click.call(target); await tick(); assert.equal(c.G.player.gemShop.level, before + 1); assert.equal(floats.length, 1);
  c.closeMysteryMerchant(); click.call(target); await tick(); assert.equal(floats.length, 1);
  c.sendUiCommand = () => Promise.reject(new Error('offline'));
  click.call(target); await tick(); assert.equal(floats.length, 1);
});

test('威能與技能單級／一鍵滿級都依實際升級回覆浮字，已滿級空操作與降級不浮字', async () => {
  const { c, button, floats } = mount(), target = button();
  c.G.player.reincarnations = 6; c.G.player.gold = 1e15;
  await c.runTalentUiAction('talent.upgrade', 't1_str', null, target);
  assert.equal(c.talentLevel('t1_str'), 1); assert.equal(floats.length, 1);
  c.G.player.gold = 0; await c.runTalentUiAction('talent.upgrade', 't1_str', null, target);
  assert.equal(floats.length, 1);
  c.G.player.level = 999; c.G.player.gold = 1e15; c.G.player.skillMastery = { level: 480, xp: 0 };
  const group = 'icearrow', previous = c.skills2Levels(group)[0];
  await c.runSkill2UiAction('skill2.learn', group, 0, target);
  assert.equal(c.skills2Levels(group)[0], previous + 1); assert.equal(floats.length, 2);
  await c.runSkill2MaxAction(group, 0, target);
  assert.equal(c.skills2Levels(group)[0], c.SG_TIER_MAX_LV); assert.equal(floats.length, 3);
  await c.runSkill2MaxAction(group, 0, target); assert.equal(floats.length, 3);
  await c.runSkill2UiAction('skill2.downgrade', group, 0, target); assert.equal(floats.length, 3);
});

test('背包擴充只在正式容量增加時提示，資源不足不誤報', async () => {
  const { c, button, floats } = mount();
  const click = listener(c, "if (invExpand) invExpand.addEventListener('click', function () {", '\n  });');
  const target = button(), before = c.G.player.invUpgrades || 0; c.G.player.gold = 1e12;
  click.call(target); await tick(); assert.equal(c.G.player.invUpgrades, before + 1); assert.equal(floats.length, 1);
  c.G.player.gold = 0; click.call(target); await tick(); assert.equal(floats.length, 1);
});

test('熔爐零件槽擴充成功才浮字；原有缺金提示仍保留', async () => {
  const { c, engine, button, floats } = mount(), handlers = {};
  c.$id = id => id === 'tab-newforge' ? {
    querySelector: () => null, addEventListener: (name, handler) => { handlers[name] = handler; }
  } : null;
  c.uiNewForgePanelSnapshot = () => engine.panel('newforge');
  c.bindNewForgeEvents();
  const furnace = c.G.newForge.furnaces[0], before = furnace.partSlots;
  const target = button({ 'data-nf-fid': String(furnace.id), 'data-nf-unlockslot': '' });
  target.hasAttribute = key => Object.hasOwn(target.attrs, key);
  target.closest = selector => selector === 'button' ? target : null;
  c.G.player.gold = 1e12; handlers.click({ target }); await tick();
  assert.equal(furnace.partSlots, before + 1); assert.equal(floats[0].text, '升級成功');
  c.G.player.gold = 0; handlers.click({ target }); await tick();
  assert.equal(furnace.partSlots, before + 1); assert.equal(floats.length, 2); assert.equal(floats[1].text, c.STR(91));
});

test('首次終極進化學到Lv.1顯示成功，重選拒絕不重複顯示', async () => {
  const { c, button, floats } = mount(), group = 'thrust';
  c.G.player.level = 1000; c.G.player.reincarnations = 10; c.G.tower.highest = 150;
  c.G.player.gold = 1e20; c.G.player.skillMastery = { level: 480, xp: 0 };
  c.G.player.skills2.levels[group] = Array(7).fill(10);
  await c.runSkill2UltPick(group, 0, button());
  assert.equal(c.skills2Ult(group).lv, 1); assert.equal(floats.length, 1);
  await c.runSkill2UltPick(group, 1, button()); assert.equal(floats.length, 1);
});
