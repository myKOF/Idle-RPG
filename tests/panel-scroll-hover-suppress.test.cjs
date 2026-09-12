const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');

/* 2026-09-12 回報：快速捲動技能頁時戰鬥區幾乎完全停止。
   成因不在捲動本身，而在捲動會把格子一路送過游標底下，每一顆都觸發一次
   mouseover → showSkillTooltip（實測平均 6ms）＋ positionSkTooltip 的三次
   強制版面重算。整個 UI 外殼掛在 transform: scale() 底下，捲動已經走主執行緒
   重繪，再疊這一串，Pixi 的 ticker 就搶不到 frame。
   背包早就有同一條解法（UI.inventoryScrolling），這裡把它補到主捲動區。 */

test('主捲動區捲動中要擋掉懸停提示，並在停止後放開', () => {
  assert.match(ui, /panelScrolling: false,/);
  assert.match(ui, /panelScrollTimer: null,/);

  const bind = ui.slice(
    ui.indexOf("var workspaceScroller = document.querySelector('#workspace-area main')"),
    ui.indexOf('// 技能彈窗：右上 X / 點擊遮罩關閉')
  );
  assert.ok(bind.length > 0, '找不到主捲動區的繫結');

  // 捲動開始時收起提示：錨點正在移動，留著只會畫在錯的位置
  assert.match(bind, /if \(!UI\.panelScrolling\) hideTooltip\(\);/);
  assert.match(bind, /UI\.panelScrolling = true;/);
  // 最後一則捲動事件後才放掉，門檻與背包一致（120ms）
  assert.match(bind, /if \(UI\.panelScrollTimer\) clearTimeout\(UI\.panelScrollTimer\);/);
  assert.match(bind, /UI\.panelScrolling = false;\s*\}, 120\);/);
  // 捲動監聽必須是 passive：非 passive 會讓瀏覽器等 JS 才能捲，本身就是卡頓來源
  assert.match(bind, /addEventListener\('scroll', function \(\) \{[\s\S]*?\}, \{ passive: true \}\)/);
});

/* 這一條比「有沒有擋」更重要：擋的範圍必須限定在這個捲動區裡。
   若有人日後把它簡化成只看 UI.panelScrolling，戰鬥區與左側屬性列的提示
   會在捲動後的 120ms 內一起消失——那是使用者看得到、卻很難聯想到捲動的 bug。 */
test('抑制範圍只限主捲動區內的目標，捲動區外的提示不受影響', () => {
  assert.match(ui, /function panelScrollHoverSuppressed\(e\) \{[\s\S]*?workspaceScroller\.contains\(e\.target\)/);
});

test('mouseover 與 mouseout 都在最前面就短路，不做後續的 closest 連鎖', () => {
  const over = ui.slice(ui.indexOf("document.addEventListener('mouseover'"), ui.indexOf("document.addEventListener('mouseout'"));
  assert.match(over, /function \(e\) \{\s*\/\/[^\n]*\n\s*if \(panelScrollHoverSuppressed\(e\)\) return;/);

  const out = ui.slice(ui.indexOf("document.addEventListener('mouseout'"));
  assert.match(out, /function \(e\) \{\s*\/\/[^\n]*\n\s*if \(panelScrollHoverSuppressed\(e\)\) return;/);
});
