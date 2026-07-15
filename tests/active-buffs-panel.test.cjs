const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadCombat() {
  const context = { console, Math, window: {} };
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/combat.js'].forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), context, { filename: f });
  });
  return context;
}

test('activePlayerBuffs：過濾過期、依固定順序、附剩餘秒數', () => {
  const c = loadCombat();
  c.GT = 100;
  const ent = { buffs: {
    evasionUp: { val: 2588, until: 108 },   // 生效，剩 8s
    atkUp: { val: 1609, until: 103.2 },     // 生效，剩 ceil(3.2)=4s
    defUp: { val: 50, until: 90 },          // 已過期（until <= GT）
  } };
  const list = c.activePlayerBuffs(ent);
  assert.equal(list.length, 2);
  assert.equal(list.map((b) => b.key).join(','), 'atkUp,evasionUp'); // 依 PLAYER_BUFF_ORDER
  assert.equal(list[0].val, 1609);
  assert.equal(list[0].remain, 4);
  assert.equal(list[1].key, 'evasionUp');
  assert.equal(list[1].remain, 8);
});

test('activePlayerBuffs：無實體/無增益回傳空陣列', () => {
  const c = loadCombat();
  assert.equal(c.activePlayerBuffs(null).length, 0);
  assert.equal(c.activePlayerBuffs({}).length, 0);
  assert.equal(c.activePlayerBuffs({ buffs: {} }).length, 0);
});

test('ui.js 屬性面板接上「目前技能增益」清單', () => {
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  assert.match(ui, /id="active-buffs"/);
  assert.match(ui, /目前技能增益/);
  assert.match(ui, /activePlayerBuffs\(currentCombatPlayerEntity\(\)\)/);
  // 高塔優先取 TOWER.player、否則 FIELD.player
  assert.match(ui, /G\.tower\.active[\s\S]*?TOWER\.player/);
});

test('戰鬥區玩家狀態/增益按鈕可顯示增益詳情（懸停＋點擊切換）', () => {
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(ui, /function showBuffTooltip\(anchorEl\)/);
  // 懸停顯示、點擊切換、mouseout 收起皆掛上 [data-buff-tip]
  assert.match(ui, /closest\('\[data-buff-tip\]'\)[\s\S]*?showBuffTooltip/);
  assert.match(ui, /\[data-buff-tip\][\s\S]*?hideTooltip/);
  // 兩個戰鬥場景的玩家狀態列與增益按鈕都有 data-buff-tip
  assert.equal((html.match(/data-buff-tip/g) || []).length, 4);
  assert.match(html, /id="tp-status" data-buff-tip/);
  assert.match(html, /id="pv-status" data-buff-tip/);
  assert.equal((html.match(/class="info-btn buff-btn" data-buff-tip/g) || []).length, 2);
});

test('增益 tooltip 每 tick 即時刷新；面板數值用綠色', () => {
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  // 抽出共用內容 + tooltip 開啟中每 tick 刷新
  assert.match(ui, /function buffTooltipDesc\(\)/);
  assert.match(ui, /function refreshBuffTooltip\(\)/);
  assert.match(ui, /renderBattle\(\);[\s\S]*?refreshBuffTooltip\(\)/); // uiTick 內接上
  assert.match(ui, /\[data-buff-tip\]'\)[\s\S]*?descEl\.innerHTML = buffTooltipDesc\(\)/);
  // 面板「目前技能增益」數值內嵌綠色（與 tooltip 相同 var(--good)），不再倚賴被移除的 CSS
  assert.match(ui, /buff-val" style="color:var\(--good\)"/);
});
