'use strict';

/* 背包選取時，對應裝備欄的高亮長什麼樣子。

   這支測試換過一次設計，過程值得留著：

   舊版用「2px 內框 + 2px 向外 outline + filter: brightness()」。outline 的顏色
   沒辦法直接取到品質色，所以 js/ui.js 在 inline style 上多餵一個
   --eq-selection-border-color 自訂屬性給它用。而 brightness 會把整格提亮，
   結果是**品質色整個往黃色推**——橘色的傳說與金色的史詩尤其明顯，
   而品質色正是這個高亮本來要傳達的資訊。

   現在改成直接加粗原本的 border。border-color 在 js/ui.js 的 inline style 裡
   本來就已經是品質色，加粗不動顏色，也就不需要那個自訂屬性了。 */

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

test('選取黃框保持方角及向外描框，厚度在原比例上減2px', () => {
  const skin = fs.readFileSync(path.join(root, 'css/ashen-forge.css'), 'utf8');
  const rule = skin.match(/#workspace-area \.item-cell\.selected,\s*#workspace-area \.eq-slot\.selected\s*\{([^}]+)\}/)[1];
  assert.match(rule, /outline:\s*3px solid #ffe354/);
  assert.match(rule, /outline-offset:\s*0\s*;/);
  assert.match(rule, /border-radius:\s*0\s*!important/);
  assert.doesNotMatch(rule, /(?:^|;)\s*(?:width|height|padding|border-width):/);
  assert.match(skin, /#equip-grid\s*\{[^}]*container-type:\s*inline-size/);
  assert.match(skin, /#workspace-area #equip-grid \.eq-slot\.selected\s*\{\s*outline-width:\s*calc\(2\.2cqw - 2px\)/);
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

test('裝備欄的 border-color 就是稀有度顏色，高亮不必另外傳色', () => {
  /* 加粗方案成立的前提。這一行沒了的話高亮會變成預設色，
     而樣式表那邊完全看不出來。 */
  assert.match(ui, /border-color:'\s*\+\s*r\.color/);
});

test('不再輸出已經沒人用的 --eq-selection-border-color', () => {
  assert.doesNotMatch(ui, /--eq-selection-border-color/);
  assert.doesNotMatch(css, /--eq-selection-border-color/);
});
