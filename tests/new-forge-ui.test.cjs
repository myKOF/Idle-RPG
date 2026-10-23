'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');

function extract(name) {
  const start = ui.indexOf('function ' + name + '(');
  const next = ui.indexOf('\nfunction ', start + 1);
  assert.ok(start >= 0);
  return ui.slice(start, next < 0 ? undefined : next);
}

function button() {
  return { disabled: false, hidden: false, textContent: '', attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k] ?? null; },
    removeAttribute(k) { delete this.attrs[k]; } };
}

test('熔爐雙入口：未滿／處理中／目前上限／移除／轉生及絕對上限', () => {
  const top = button(), bottom = button();
  const nf = { furnaces: [], stats: { salvaged: 0, kept: 0 } };
  const player = { reincarnations: 0 };
  const context = {
    UI: {}, NEW_FORGE_MAX: 12, pending: false,
    $id: id => ({ 'nf-add-btn': top, 'nf-add-bottom-btn': bottom })[id],
    uiNewForgePanelSnapshot: () => ({ newForge: nf }),
    uiFactoryPanelSnapshot: () => ({ factory: {} }),
    uiHeaderPanelSnapshot: () => ({ player }),
    renderForgeExtras() {}, setTextIfChanged(el, value) { if (el) el.textContent = value; },
    newForgeMaxFurnaces: turns => Math.min(12, 2 + turns),
    fmt: String, nodePendingKey: id => id,
    isUiCommandPending() { return context.pending; }
  };
  vm.createContext(context);
  vm.runInContext(extract('renderNewForge'), context);
  const render = () => context.renderNewForge();
  render();
  assert.equal(bottom.hidden, false, '空爐也可由下方新增');
  assert.equal(top.disabled, false);
  assert.equal(top.attrs['data-ui-pending-key'], bottom.attrs['data-ui-pending-key']);
  context.pending = true; render();
  assert.equal(top.disabled, true); assert.equal(bottom.disabled, true);
  nf.furnaces = [{}, {}]; render();
  assert.equal(bottom.hidden, true); assert.equal(top.textContent, '已達最大數');
  assert.equal(top.attrs['data-ui-pending-key'], undefined, 'pending解鎖不得重啟達上限按鈕');
  context.pending = false; render();
  assert.equal(top.disabled, true);
  nf.furnaces.pop(); render();
  assert.equal(bottom.hidden, false); assert.equal(top.disabled, false);
  assert.equal(top.textContent, '＋ 添加熔爐');
  nf.furnaces.push({}); player.reincarnations = 1; render();
  assert.equal(top.disabled, false, '轉生提高目前上限後恢復');
  player.reincarnations = 100; nf.furnaces = Array(12).fill({}); render();
  assert.equal(top.disabled, true); assert.equal(bottom.hidden, true);
});

test('傳送帶沿正式武器分類與各部位圖示，舊快照可退回部位', () => {
  const context = { rarityTag: it => it.name };
  vm.createContext(context);
  for (const file of ['js/util.js', 'js/strings_data.js', 'js/strings.js', 'js/data.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
  vm.runInContext(extract('itemIconFile') + extract('nfBeltChipsHTML'), context);
  for (const weaponType of Object.keys(context.WEAPON_TYPES)) {
    const html = context.nfBeltChipsHTML({ belt: [{ rarity: 2, slot: 'weapon', name: '測試', weaponType }] });
    assert.ok(html.includes('images/' + context.WEAPON_TYPE_ICONS[weaponType]), weaponType);
  }
  for (const slot of Object.keys(context.SLOT_INFO)) {
    const html = context.nfBeltChipsHTML({ belt: [{ rarity: 1, slot, name: '測試' }] });
    assert.ok(html.includes('images/' + context.SLOT_INFO[slot].icon), slot);
  }
  assert.match(context.nfBeltChipsHTML({ belt: [] }), /傳送帶空/);
});
