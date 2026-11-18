'use strict';

/* 已穿裝備與背包共用品質邊框，選取描邊畫在邊框外。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');

function selectionRule() {
  const match = css.match(/\.eq-slot\.inventory-selection-match\s*\{([\s\S]*?)\n\}/);
  assert.ok(match, '找不到背包選取對應裝備欄樣式');
  return match[1];
}

test('銅邊主題將同品質選取描邊畫在裝備格外，部位提示的黃虛線只供空格使用', () => {
  const skin = fs.readFileSync(path.join(root, 'css/brass-and-slate.css'), 'utf8');
  const rule = skin.match(/:is\(#inventory-grid \.item-cell, #equip-grid \.eq-slot\)\.selected\s*\{([^}]+)\}/)[1];
  assert.match(rule, /outline:\s*2px solid var\(--item-frame-color, var\(--bs-gold\)\)/);
  assert.match(rule, /outline-offset:\s*1px\s*;/);
  const matchSelectors = Array.from(skin.matchAll(/^([^\n{]+\.inventory-selection-match)\s*\{/gm), m => m[1].trim());
  assert.deepEqual(matchSelectors, ['body #game-layout #equip-grid .eq-slot.empty.inventory-selection-match']);
});

test('背包選取對應裝備欄以加粗原本的品質邊框呈現', () => {
  assert.match(selectionRule(), /border-width:\s*3px\s*!important/);
});

test('不得用 filter 提亮——那會把品質色往黃色推', () => {
  /* 這是換掉舊設計的唯一理由，所以用哨兵釘住，避免下次調高亮又加回來。 */
  assert.doesNotMatch(selectionRule(), /filter:/);
});

test('神話、創世與神鑄裝備的背包選取匹配使用品質光暈', () => {
  for (const [className, color] of [
    ['eff-mythic', '#fde68a'],
    ['eff-genesis', '#a5f3fc'],
    ['eff-godforged', '#f5d0fe']
  ]) {
    const selector = new RegExp(
      '\\.eq-slot\\.inventory-selection-match\\[class~="' + className + '"\\]\\s*\\{[\\s\\S]*?box-shadow:[^;]*' + color + '[^;]*!important'
    );
    assert.match(css, selector, className + ' should keep a visible selected glow');
  }
});

test('不得用 outline——顏色餵不進去，而 border-color 本來就是品質色', () => {
  assert.doesNotMatch(selectionRule(), /outline/);
});

test('背包及裝備欄的外框沿用同一個品質色', () => {
  for (const section of [
    ui.slice(ui.indexOf('function itemCellHTML('), ui.indexOf('function itemCellNodeFromHtml(')),
    ui.slice(ui.indexOf('function renderEquip('), ui.indexOf('function equipFlashActive('))
  ]) {
    assert.match(section, /itemFrameColor\(it\.rarity\)/);
    assert.match(section, /--item-frame-color:' \+ frameColor \+ ';border-color:var\(--item-frame-color\)/);
  }
});

test('不再輸出已經沒人用的 --eq-selection-border-color', () => {
  assert.doesNotMatch(ui, /--eq-selection-border-color/);
  assert.doesNotMatch(css, /--eq-selection-border-color/);
});
