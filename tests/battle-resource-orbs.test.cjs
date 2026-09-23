const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ui = fs.readFileSync('js/ui.js', 'utf8');
const source = ui.slice(ui.indexOf('function renderBattleResourceOrbs()'), ui.indexOf('function renderBattle()'));
function setup() {
  const elements = new Map();
  const view = { hp: 25, hpMax: 100, mp: 30, mpMax: 60, shield: 200 };
  const player = { hp: 90, maxHp: 100, mp: 60, maxMp: 60, shield: 400, shieldMax: 400 };
  const ctx = { Math, Number, viewState: () => view, uiBattlePanelSnapshot: () => ({field:{player}}),
    $id(id) { if (!elements.has(id)) elements.set(id, {style:{}, attrs:{}}); return elements.get(id); },
    clamp: (n,a,b) => Math.min(b,Math.max(a,n)), fmtFull: n => String(n),
    setStyleIfChanged: (el,key,val) => { el.style[key] = val; },
    setAttrIfChanged: (el,key,val) => { el.attrs[key] = val; }
  };
  vm.createContext(ctx); vm.runInContext(source,ctx);
  return {ctx, view, player, elements, render: () => ctx.renderBattleResourceOrbs()};
}
test('圓瓶使用即時 TICK 數值，超過生命上限的護盾仍以液面高度扣減', () => {
  const s=setup();s.render();
  assert.equal(s.elements.get('battle-health-fill').style.height,'25%');
  assert.equal(s.elements.get('battle-mana-fill').style.height,'50%');
  assert.equal(s.elements.get('battle-shield-fill').style.height,'50%');
  assert.match(s.elements.get('battle-health-orb').attrs['data-tt-desc'], /生命：25 \/ 100<br>護盾：200 \/ 400/);
  assert.equal(s.elements.get('battle-health-orb').attrs['aria-label'], '生命：25 / 100，護盾：200 / 400');
  s.view.hp=10;s.view.shield=100;s.render();
  assert.equal(s.elements.get('battle-shield-fill').style.height,'25%');
  assert.match(s.elements.get('battle-health-orb').attrs['data-tt-desc'], /生命：10 \/ 100<br>護盾：100 \/ 400/);
  assert.equal(s.player.hp,90,'不得改動權威快照');
});
test('死亡、零容量與護盾耗盡皆清空，不殘留最低液面', () => {
  const s=setup();Object.assign(s.view,{hp:0,mp:0,shield:0,hpMax:0,mpMax:0});s.render();
  for(const id of ['battle-health-fill','battle-mana-fill','battle-shield-fill']) assert.equal(s.elements.get(id).style.height,'0%');
});
test('缺少 TICK 時使用 panel；新護盾超出舊容量不溢出瓶子', () => {
  const s=setup();for(const k of Object.keys(s.view)) delete s.view[k];s.render();
  assert.equal(s.elements.get('battle-health-fill').style.height,'90%');
  s.view.shield=600;s.render();
  assert.equal(s.elements.get('battle-shield-fill').style.height,'100%');
  assert.match(s.elements.get('battle-health-orb').attrs['data-tt-desc'], /600 \/ 600/);
});
test('即時圓瓶更新在開啟 tooltip 刷新之前，技能列沿配置上限繪製', () => {
  assert.match(ui,/renderBattleResourceOrbs\(\);\s*refreshOpenResourceTooltip\(\);/);
  assert.match(ui.slice(ui.indexOf('function renderBattleSkillBar'),ui.indexOf('var CD_UPDATE_HZ')),/var TOTAL_SLOTS = LOADOUT_SIZE.max/);
  const html=fs.readFileSync('index.html','utf8');
  assert.match(html,/id="battle-action-dock"[\s\S]*id="battle-xp-bar"[\s\S]*id="battle-buff-bar"[\s\S]*id="battle-skill-bar"/);
});
